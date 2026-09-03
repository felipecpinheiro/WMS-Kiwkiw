"""
WMS Kiwkiw - Router de Faturamento (reescrito em 31/08/2026)
============================================================
Fechamento mensal por (seller x mês). Toda a matemática está em
`backend/services/billing_calc.py`; os documentos em
`backend/services/billing_docs.py`.

`billing_configs` e as colunas comerciais de `Seller` NÃO são mais lidas
nem escritas por este módulo (ficam para rollback).

Permissão: por padrão `require_billing_access` (admin + acesso ao Financeiro
liberado — ver "Acesso Protegido ao Financeiro" abaixo), EXCETO:
  * os dois endpoints de `seller-params` e os de `seller-box-prices`, usados
    pela aba "Comercial" do cadastro de Sellers (`require_manager_or_above`,
    sem o portão — decisão do dono do sistema, 02/09/2026);
  * o bloco `/billing/my/...` (02/09/2026), usado pela aba "Financeiro" do
    Portal do Seller: `require_authenticated` + `current_user.seller_id`
    obrigatório. O seller NUNCA informa um `seller_id` — ele vem do token —
    e o payload devolvido é podado das tarifas do contrato.

Acesso Protegido ao Financeiro (02/09/2026): mesmo sendo admin, os 11
endpoints de valores em R$ (box-prices, closing, close, reopen, pdf, excel,
consolidated + excel + pdfs.zip) exigem uma janela de 4h liberada por um
código de 6 dígitos enviado por e-mail (ou o código-mestre de emergência).
`require_billing_access` (backend/auth.py) checa isso; o fluxo de pedir/
confirmar o código está em `backend/routers/billing_access.py`.
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
from ..auth import require_manager_or_above, require_billing_access, require_authenticated
from .. import models, schemas
from ..models import FileType, OrderStatus
from ..timezone_utils import now_brasilia
from ..services import billing_calc as calc
from ..services import billing_docs as docs

router = APIRouter(prefix="/billing", tags=["Faturamento"])

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

# Unificação de 01/09/2026: TODO parâmetro de cobrança vive só em
# `billing_seller_params`. A aba Comercial de Sellers e o Faturamento de mês
# ABERTO leem/gravam o mesmo registro; mês FECHADO usa o snapshot congelado em
# `billing_monthly_closings`. Não há mais parâmetro "só do mês".


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
    # Fonte única: grava TODOS os parâmetros no default do seller. É o mesmo
    # registro que o Faturamento de mês aberto lê e grava.
    for f in calc.PARAM_FIELDS:
        setattr(row, f, getattr(body, f))
    _audit(db, current_user, "UPDATE_SELLER_PARAMS", seller_id, body.model_dump())
    db.commit()
    db.refresh(row)
    return row


# ── tabela global de caixas ──────────────────────────────────────────────────

@router.get("/box-prices")
def get_box_prices(
    current_user: models.User = Depends(require_billing_access),
    db: Session = Depends(get_db),
):
    by_key = {r.box_key: r.price for r in db.query(models.BillingBoxPrice).all()}
    ordered = list(calc.CANONICAL_BOXES) + [k for k in by_key if k not in calc.CANONICAL_BOXES]
    return {"prices": [{"box_key": k, "price": by_key.get(k)} for k in ordered]}


@router.put("/box-prices")
def put_box_prices(
    body: schemas.BillingBoxPricesIn,
    current_user: models.User = Depends(require_billing_access),
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


# ── preço de caixa por seller (aba "Caixas" do cadastro) ─────────────────────

def _seller_box_prices_dict(db: Session, seller_id: int) -> dict:
    return {
        r.box_key: r.price
        for r in db.query(models.BillingSellerBoxPrice)
        .filter(models.BillingSellerBoxPrice.seller_id == seller_id).all()
        if r.price is not None
    }


def _effective_box_prices(db: Session, seller_id: int) -> dict:
    """Global sobrescrito pelo preço do seller onde houver."""
    eff = _box_prices_dict(db)
    eff.update(_seller_box_prices_dict(db, seller_id))
    return eff


@router.get("/seller-box-prices/{seller_id}")
def get_seller_box_prices(
    seller_id: int,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    _seller_or_404(db, seller_id)
    by_key = {
        r.box_key: r.price
        for r in db.query(models.BillingSellerBoxPrice)
        .filter(models.BillingSellerBoxPrice.seller_id == seller_id).all()
    }
    return {"prices": [{"box_key": k, "price": by_key.get(k)}
                       for k in calc.CANONICAL_BOXES]}


@router.put("/seller-box-prices/{seller_id}")
def put_seller_box_prices(
    seller_id: int,
    body: schemas.BillingSellerBoxPricesIn,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    _seller_or_404(db, seller_id)
    rows = {
        r.box_key: r
        for r in db.query(models.BillingSellerBoxPrice)
        .filter(models.BillingSellerBoxPrice.seller_id == seller_id).all()
    }
    for item in body.prices:
        r = rows.get(item.box_key)
        if item.price is None:
            if r is not None:
                db.delete(r)          # sem valor = volta a usar o global
        elif r is None:
            db.add(models.BillingSellerBoxPrice(
                seller_id=seller_id, box_key=item.box_key, price=item.price))
        else:
            r.price = item.price
    _audit(db, current_user, "UPDATE_SELLER_BOX_PRICES", seller_id,
           {"prices": [i.model_dump() for i in body.prices]})
    db.commit()
    return get_seller_box_prices(seller_id, current_user, db)


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
    box_prices = _effective_box_prices(db, seller.id)

    if closing and closing.status == "closed":
        params = calc.params_from_obj(closing)
        cubagem = closing.cubagem_m3 or 0.0
        valor_segurado = closing.valor_segurado or 0.0
        adjustments = _adjustments_list(closing)
        computed = calc.read_frozen(db, closing)
    else:
        # Mês aberto: os parâmetros vêm SEMPRE do default do seller (fonte
        # única). As colunas de parâmetro do `closing`, se a linha existir, só
        # voltam a valer quando o mês é fechado (snapshot congelado).
        params = calc.default_params_for_seller(db, seller.id)
        cubagem = params["cubagem_m3"]
        valor_segurado = params["valor_segurado"]
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
    current_user: models.User = Depends(require_billing_access),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _seller_or_404(db, seller_id)
    return _build_payload(db, seller, ref_month)


@router.put("/closing/{seller_id}/{ref_month}")
def put_closing(
    seller_id: int, ref_month: str,
    body: schemas.BillingClosingDraftIn,
    current_user: models.User = Depends(require_billing_access),
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

    # Fonte única: os parâmetros do rascunho vão para o default do seller
    # (billing_seller_params) — o mesmo registro da aba Comercial. A linha do
    # `closing` guarda só o que é do mês: ajustes avulsos e overrides de NF.
    sp = _get_or_create_params(db, seller_id)
    for f in calc.PARAM_FIELDS:
        setattr(sp, f, getattr(body, f))

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


# O endpoint `apply-forward` foi removido na unificação de 01/09/2026: com a
# fonte única, todo mês aberto já lê o mesmo `billing_seller_params` — não há
# nada para "aplicar aos meses seguintes".


@router.post("/closing/{seller_id}/{ref_month}/close")
def close_month(
    seller_id: int, ref_month: str,
    current_user: models.User = Depends(require_billing_access),
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
        closing = models.BillingMonthlyClosing(seller_id=seller_id, ref_month=ref_month,
                                               status="open")
        db.add(closing)
        db.flush()
    if closing.status == "closed":
        raise HTTPException(409, "Mês já está fechado.")

    # Snapshot: congela os parâmetros ATUAIS do seller (fonte única) na linha do
    # fechamento. A partir daqui a fatura desse mês não muda mais se o seller for
    # editado; reabrir apaga o snapshot e volta a seguir o default do seller.
    sp = _get_or_create_params(db, seller_id)
    for f in calc.PARAM_FIELDS:
        setattr(closing, f, getattr(sp, f))

    params = calc.params_from_obj(closing)
    computed = calc.compute_live(
        db, seller_id, ref_month, params,
        closing.cubagem_m3 or 0.0, closing.valor_segurado or 0.0,
        _overrides_dict(closing), _adjustments_list(closing),
        _effective_box_prices(db, seller_id),
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
    current_user: models.User = Depends(require_billing_access),
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
    current_user: models.User = Depends(require_billing_access),
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
    current_user: models.User = Depends(require_billing_access),
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


# ── portal do seller (aba "Financeiro") ──────────────────────────────────────
#
# Escopo pelo TOKEN: não existe parâmetro `seller_id` nestas rotas, então não há
# como um seller pedir a fatura de outro. Na prática só o role `client` passa —
# admin/manager/operator têm `seller_id` nulo e caem no 403.

# Campos podados do payload antes de devolver ao seller: são as tarifas do
# contrato (o "como se calcula"), que ele não deve enxergar no portal.
_SELLER_HIDDEN_TOP = ("params", "box_prices", "grupo_a")
_SELLER_HIDDEN_FATURA = ("min_atingiu_piso", "soma_real_b2c", "floor_b2c")


def _my_seller(db: Session, current_user: models.User) -> models.Seller:
    if not current_user.seller_id:
        raise HTTPException(403, "Usuário sem seller vinculado")
    return _seller_or_404(db, current_user.seller_id)


def _strip_for_seller(payload: dict) -> dict:
    for k in _SELLER_HIDDEN_TOP:
        payload.pop(k, None)
    fatura = payload.get("fatura")
    if isinstance(fatura, dict):
        for k in _SELLER_HIDDEN_FATURA:
            fatura.pop(k, None)
    return payload


@router.get("/my/{ref_month}")
def get_my_closing(
    ref_month: str,
    current_user: models.User = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _my_seller(db, current_user)
    return _strip_for_seller(_build_payload(db, seller, ref_month))


@router.get("/my/{ref_month}/pdf")
def my_closing_pdf(
    ref_month: str,
    current_user: models.User = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _my_seller(db, current_user)
    payload = _build_payload(db, seller, ref_month)
    buf = io.BytesIO(docs.invoice_pdf_bytes(payload))
    fname = f"fatura_{_ascii(payload['seller_name'])}_{ref_month}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/my/{ref_month}/excel")
def my_closing_excel(
    ref_month: str,
    current_user: models.User = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    seller = _my_seller(db, current_user)
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
    current_user: models.User = Depends(require_billing_access),
    db: Session = Depends(get_db),
):
    _check_month(ref_month)
    rows = _consolidated_rows(db, ref_month)
    return {"ref_month": ref_month, "rows": rows}


@router.get("/consolidated/{ref_month}/excel")
def consolidated_excel(
    ref_month: str,
    current_user: models.User = Depends(require_billing_access),
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
    current_user: models.User = Depends(require_billing_access),
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
