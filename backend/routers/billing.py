"""
WMS Kiwkiw - Router de Faturamento (reescrito em 31/08/2026)
============================================================
Fechamento mensal por (seller x mês). Toda a matemática está em
`backend/services/billing_calc.py`; os documentos em
`backend/services/billing_docs.py`.

`billing_configs` e as colunas comerciais de `Seller` NÃO são mais lidas
nem escritas por este módulo (ficam para rollback).

Permissão: tudo `require_admin`, EXCETO os dois endpoints de
`seller-params`, usados pela aba "Comercial" do cadastro de Sellers
(`require_manager_or_above`).
"""

import io
import json
import re
import zipfile
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..auth import require_manager_or_above, require_admin
from .. import models, schemas
from ..models import FileType, OrderStatus
from ..timezone_utils import now_brasilia
from ..services import billing_calc as calc
from ..services import billing_docs as docs

router = APIRouter(prefix="/billing", tags=["Faturamento"])

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _check_month(ref_month: str):
    if not _MONTH_RE.match(ref_month):
        raise HTTPException(400, "ref_month deve ser 'YYYY-MM'")


def _audit(db: Session, user, action: str, entity_id: Optional[int], detail: dict):
    db.add(models.AuditLog(
        entity_type="Billing", entity_id=entity_id, action=action,
        detail=json.dumps(detail, ensure_ascii=False, default=str),
        user_id=user.id, timestamp=now_brasilia(),
    ))


def _seller_or_404(db: Session, seller_id: int) -> models.Seller:
    s = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    if not s:
        raise HTTPException(404, f"Seller {seller_id} não encontrado")
    return s


# ── seller-params ────────────────────────────────────────────────────────────

def _get_or_create_params(db: Session, seller_id: int) -> models.BillingSellerParams:
    row = db.query(models.BillingSellerParams).filter(
        models.BillingSellerParams.seller_id == seller_id
    ).first()
    if row is None:
        row = models.BillingSellerParams(seller_id=seller_id, **calc.DEFAULT_PARAMS)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/seller-params/{seller_id}", response_model=schemas.BillingSellerParamsOut)
def get_seller_params(
    seller_id: int,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    _seller_or_404(db, seller_id)
    return _get_or_create_params(db, seller_id)


@router.put("/seller-params/{seller_id}", response_model=schemas.BillingSellerParamsOut)
def put_seller_params(
    seller_id: int,
    body: schemas.BillingSellerParamsIn,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    _seller_or_404(db, seller_id)
    row = _get_or_create_params(db, seller_id)
    # adic_produto_b2b é parâmetro só-do-mês (vive no fechamento). Não é gravado
    # no default do seller — a aba Comercial de Sellers não o edita e um PUT sem
    # o campo zeraria o valor.
    for f in calc.PARAM_FIELDS:
        if f == "adic_produto_b2b":
            continue
        setattr(row, f, getattr(body, f))
    _audit(db, current_user, "UPDATE_SELLER_PARAMS", seller_id, body.model_dump())
    db.commit()
    db.refresh(row)
    return row


# ── tabela global de caixas ──────────────────────────────────────────────────

@router.get("/box-prices")
def get_box_prices(
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    by_key = {r.box_key: r.price for r in db.query(models.BillingBoxPrice).all()}
    ordered = list(calc.CANONICAL_BOXES) + [k for k in by_key if k not in calc.CANONICAL_BOXES]
    return {"prices": [{"box_key": k, "price": by_key.get(k)} for k in ordered]}


@router.put("/box-prices")
def put_box_prices(
    body: schemas.BillingBoxPricesIn,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    by_key = {r.box_key: r for r in db.query(models.BillingBoxPrice).all()}
    for item in body.prices:
        r = by_key.get(item.box_key)
        if r is None:
            r = models.BillingBoxPrice(box_key=item.box_key)
            db.add(r)
        r.price = item.price
    _audit(db, current_user, "UPDATE_BOX_PRICES", None,
           {"prices": [i.model_dump() for i in body.prices]})
    db.commit()
    return get_box_prices(current_user, db)


# ── fechamento ───────────────────────────────────────────────────────────────

def _box_prices_dict(db: Session) -> dict:
    return {r.box_key: r.price for r in db.query(models.BillingBoxPrice).all()}


def _overrides_dict(closing: Optional[models.BillingMonthlyClosing]) -> dict:
    if not closing:
        return {}
    return {
        o.order_id: {
            "channel_override": o.channel_override,
            "b2b_adicional": o.b2b_adicional,
            "note": o.note,
        }
        for o in closing.nf_overrides
    }


def _adjustments_list(closing: Optional[models.BillingMonthlyClosing]) -> list:
    if not closing:
        return []
    return [
        {"descricao": a.descricao, "obs": a.obs, "sign": a.sign, "valor": a.valor}
        for a in closing.adjustments
    ]


def _build_payload(db: Session, seller: models.Seller, ref_month: str) -> dict:
    closing = (
        db.query(models.BillingMonthlyClosing)
        .options(
            joinedload(models.BillingMonthlyClosing.nf_overrides),
            joinedload(models.BillingMonthlyClosing.adjustments),
        )
        .filter(
            models.BillingMonthlyClosing.seller_id == seller.id,
            models.BillingMonthlyClosing.ref_month == ref_month,
        )
        .first()
    )
    box_prices = _box_prices_dict(db)

    if closing and closing.status == "closed":
        params = calc.params_from_obj(closing)
        cubagem = closing.cubagem_m3 or 0.0
        valor_segurado = closing.valor_segurado or 0.0
        adjustments = _adjustments_list(closing)
        computed = calc.read_frozen(db, closing)
    else:
        if closing:
            params = calc.params_from_obj(closing)
            cubagem = closing.cubagem_m3 or 0.0
            valor_segurado = closing.valor_segurado or 0.0
        else:
            params = calc.prefill_params(db, seller.id, ref_month)
            cubagem = 0.0
            valor_segurado = 0.0
        adjustments = _adjustments_list(closing)
        computed = calc.compute_live(
            db, seller.id, ref_month, params, cubagem, valor_segurado,
            _overrides_dict(closing), adjustments, box_prices,
        )

    return {
        "seller_id": seller.id,
        "seller_name": seller.trade_name or seller.name,
        "seller_active": seller.active,
        "ref_month": ref_month,
        "status": "closed" if (closing and closing.status == "closed") else "open",
        "persisted": closing is not None,
        "closed_at": closing.closed_at.isoformat() if (closing and closing.closed_at) else None,
        "closed_by_id": closing.closed_by_id if closing else None,
        "params": params,
        "cubagem_m3": cubagem,
        "valor_segurado": valor_segurado,
        "adjustments": adjustments,
        "box_prices": [{"box_key": k, "price": v} for k, v in box_prices.items()],
        "grupo_a": sorted(calc.parse_grupo_a(params.get("tipos_caixa_inclusos") or "")),
        **computed,
    }


@router.get("/closing/{seller_id}/{ref_month}")
def get_closing(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    return _build_payload(db, seller, ref_month)


@router.put("/closing/{seller_id}/{ref_month}")
def put_closing(
    seller_id: int, ref_month: str,
    body: schemas.BillingClosingDraftIn,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)

    closing = db.query(models.BillingMonthlyClosing).filter(
        models.BillingMonthlyClosing.seller_id == seller_id,
        models.BillingMonthlyClosing.ref_month == ref_month,
    ).first()
    if closing and closing.status == "closed":
        raise HTTPException(409, "Mês fechado. Reabra para editar.")
    if closing is None:
        closing = models.BillingMonthlyClosing(seller_id=seller_id, ref_month=ref_month,
                                               status="open")
        db.add(closing)
        db.flush()

    for f in calc.PARAM_FIELDS:
        setattr(closing, f, getattr(body, f))
    closing.cubagem_m3 = body.cubagem_m3
    closing.valor_segurado = body.valor_segurado

    db.query(models.BillingClosingAdjustment).filter(
        models.BillingClosingAdjustment.closing_id == closing.id
    ).delete(synchronize_session=False)
    for a in body.adjustments:
        db.add(models.BillingClosingAdjustment(
            closing_id=closing.id, descricao=a.descricao or "", obs=a.obs or "",
            sign=1 if (a.sign or 1) >= 0 else -1, valor=a.valor or 0.0,
        ))

    db.query(models.BillingClosingNF).filter(
        models.BillingClosingNF.closing_id == closing.id
    ).delete(synchronize_session=False)
    for o in body.nf_overrides:
        ch = o.channel_override if o.channel_override in ("b2c", "b2b") else None
        if ch is None and o.b2b_adicional is None and not o.note:
            continue
        db.add(models.BillingClosingNF(
            closing_id=closing.id, order_id=o.order_id, channel_override=ch,
            b2b_adicional=o.b2b_adicional, note=o.note,
        ))

    db.commit()
    return _build_payload(db, seller, ref_month)


@router.post("/closing/{seller_id}/{ref_month}/apply-forward")
def apply_forward(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    _seller_or_404(db, seller_id)
    src = db.query(models.BillingMonthlyClosing).filter(
        models.BillingMonthlyClosing.seller_id == seller_id,
        models.BillingMonthlyClosing.ref_month == ref_month,
    ).first()
    if src is None:
        raise HTTPException(400, "Salve o rascunho deste mês antes de aplicar aos seguintes.")
    src_params = calc.params_from_obj(src)

    # default do seller (adic_produto_b2b é só-do-mês, não desce pro default)
    row = _get_or_create_params(db, seller_id)
    for f in calc.PARAM_FIELDS:
        if f == "adic_produto_b2b":
            continue
        setattr(row, f, src_params[f])

    # meses futuros ainda abertos
    future = db.query(models.BillingMonthlyClosing).filter(
        models.BillingMonthlyClosing.seller_id == seller_id,
        models.BillingMonthlyClosing.ref_month > ref_month,
        models.BillingMonthlyClosing.status == "open",
    ).all()
    for c in future:
        for f in calc.PARAM_FIELDS:
            setattr(c, f, src_params[f])

    _audit(db, current_user, "APPLY_FORWARD", src.id,
           {"ref_month": ref_month, "meses_afetados": [c.ref_month for c in future]})
    db.commit()
    return {"ok": True, "meses_afetados": [c.ref_month for c in future]}


@router.post("/closing/{seller_id}/{ref_month}/close")
def close_month(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    closing = db.query(models.BillingMonthlyClosing).options(
        joinedload(models.BillingMonthlyClosing.nf_overrides),
        joinedload(models.BillingMonthlyClosing.adjustments),
    ).filter(
        models.BillingMonthlyClosing.seller_id == seller_id,
        models.BillingMonthlyClosing.ref_month == ref_month,
    ).first()
    if closing is None:
        # cria a partir do que estiver pré-preenchido
        params = calc.prefill_params(db, seller_id, ref_month)
        closing = models.BillingMonthlyClosing(seller_id=seller_id, ref_month=ref_month,
                                               status="open", **params)
        db.add(closing)
        db.flush()
    if closing.status == "closed":
        raise HTTPException(409, "Mês já está fechado.")

    params = calc.params_from_obj(closing)
    computed = calc.compute_live(
        db, seller_id, ref_month, params,
        closing.cubagem_m3 or 0.0, closing.valor_segurado or 0.0,
        _overrides_dict(closing), _adjustments_list(closing), _box_prices_dict(db),
    )
    calc.freeze(db, closing, computed)
    closing.status = "closed"
    closing.closed_at = now_brasilia()
    closing.closed_by_id = current_user.id
    _audit(db, current_user, "CLOSE_MONTH", closing.id,
           {"ref_month": ref_month, "total_geral": computed["fatura"]["total_geral"]})
    db.commit()
    return _build_payload(db, seller, ref_month)


@router.post("/closing/{seller_id}/{ref_month}/reopen")
def reopen_month(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    closing = db.query(models.BillingMonthlyClosing).filter(
        models.BillingMonthlyClosing.seller_id == seller_id,
        models.BillingMonthlyClosing.ref_month == ref_month,
    ).first()
    if closing is None or closing.status != "closed":
        raise HTTPException(409, "Mês não está fechado.")
    calc.clear_snapshot(db, closing)
    closing.status = "open"
    closing.closed_at = None
    closing.closed_by_id = None
    _audit(db, current_user, "REOPEN_MONTH", closing.id, {"ref_month": ref_month})
    db.commit()
    return _build_payload(db, seller, ref_month)


# ── documentos ───────────────────────────────────────────────────────────────

def _ascii(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s or "")


@router.get("/closing/{seller_id}/{ref_month}/pdf")
def closing_pdf(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    payload = _build_payload(db, seller, ref_month)
    buf = io.BytesIO(docs.invoice_pdf_bytes(payload))
    fname = f"fatura_{_ascii(payload['seller_name'])}_{ref_month}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/closing/{seller_id}/{ref_month}/excel")
def closing_excel(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    payload = _build_payload(db, seller, ref_month)
    buf = io.BytesIO(docs.invoice_xlsx_bytes(payload))
    fname = f"fatura_{_ascii(payload['seller_name'])}_{ref_month}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── consolidado ──────────────────────────────────────────────────────────────

def _sellers_for_month(db: Session, ref_month: str) -> list[models.Seller]:
    start, end = calc.month_range(ref_month)
    ids_with_nf = {
        r[0] for r in db.query(models.Order.seller_id).filter(
            models.Order.imported_at >= start,
            models.Order.imported_at <= end,
            models.Order.status != OrderStatus.CANCELLED,
            or_(models.Order.file_type.is_(None), models.Order.file_type != FileType.IMPORT),
            or_(models.Order.for_billing.is_(None), models.Order.for_billing == True),  # noqa: E712
        ).distinct().all()
    }
    ids_with_closing = {
        r[0] for r in db.query(models.BillingMonthlyClosing.seller_id).filter(
            models.BillingMonthlyClosing.ref_month == ref_month
        ).all()
    }
    ids = ids_with_nf | ids_with_closing
    if not ids:
        return []
    return db.query(models.Seller).filter(models.Seller.id.in_(ids)).order_by(
        models.Seller.trade_name.asc()
    ).all()


def _consolidated_rows(db: Session, ref_month: str) -> list[dict]:
    rows = []
    for seller in _sellers_for_month(db, ref_month):
        payload = _build_payload(db, seller, ref_month)
        f = payload["fatura"]
        rows.append({
            "seller_id": seller.id,
            "seller_name": payload["seller_name"],
            "active": seller.active,
            "nf_count": payload["n_b2c"] + payload["n_b2b"],
            "b2c": f["subtotal_b2c"],
            "b2b": f["subtotal_b2b"],
            "seguro": f["seguro"],
            "armazenagem": f["armazenagem"],
            "avulsos": f["avulsos"],
            "total": f["total_geral"],
            "status": "fechado" if payload["status"] == "closed"
                      else ("em aberto" if payload["persisted"] else "não iniciado"),
        })
    return rows


@router.get("/consolidated/{ref_month}")
def get_consolidated(
    ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    rows = _consolidated_rows(db, ref_month)
    return {"ref_month": ref_month, "rows": rows}


@router.get("/consolidated/{ref_month}/excel")
def consolidated_excel(
    ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    rows = _consolidated_rows(db, ref_month)
    buf = io.BytesIO(docs.consolidated_xlsx_bytes(ref_month, rows))
    fname = f"consolidado_{ref_month}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/consolidated/{ref_month}/pdfs.zip")
def consolidated_zip(
    ref_month: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for seller in _sellers_for_month(db, ref_month):
            payload = _build_payload(db, seller, ref_month)
            zf.writestr(f"fatura_{_ascii(payload['seller_name'])}_{ref_month}.pdf",
                        docs.invoice_pdf_bytes(payload))
    buf.seek(0)
    fname = f"faturas_{ref_month}.zip"
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})
