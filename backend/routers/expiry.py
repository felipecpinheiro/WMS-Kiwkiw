"""
WMS Kiwkiw - Router de Controle de Vencimentos (03/11/2026) — Fase 1.

Camada INFORMATIVA. Nenhum endpoint aqui escreve em stock_movements nem em
stock_positions — essa trava é por desenho (ver cabeçalho de expiry_calc.py).
ÚNICA EXCEÇÃO (09/11/2026): POST /disposals/{id}/fulfill?launch_stock=true,
por ação explícita do gerente, lança a Saída do descarte/retirada no estoque.

Acesso:
  * client  -> só o próprio seller_id (via token). Cria/edita/apaga linhas,
               configura dias de aviso, abre e cancela pedidos de descarte.
  * admin   -> lê qualquer seller com `?seller_id=`; atende pedidos no escopo
               do próprio get_user_seller_ids (admin = sem filtro).
  * manager -> lê e atende dentro dos sellers que atende (`get_user_seller_ids`).
  * operator-> só leitura das listagens.

Fase 1 não integra com import nem com bipagem; esses pontos entram nas fases
2 (agendamento + ativação na entrada) e 3 (FEFO na saída + Scanner + estorno).
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import List, Optional

import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..auth import get_current_user, get_user_seller_ids
from ..database import get_db
from ..services import expiry_calc, expiry_hooks
from ..timezone_utils import now_brasilia, today_brasilia


router = APIRouter(prefix="/vencimentos", tags=["Vencimentos"])


# ───────────────────────────────────────────────────────────────────────
# Escopo
# ───────────────────────────────────────────────────────────────────────

def _role(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else user.role


def _seller_for_write(user: models.User) -> int:
    """Só client grava linha/config/pedido — sempre no próprio seller_id."""
    if _role(user) != "client":
        raise HTTPException(status_code=403, detail="Acesso negado — só o seller gerencia seus vencimentos")
    if not user.seller_id:
        raise HTTPException(status_code=400, detail="Usuário sem seller associado")
    _assert_seller_active(user)
    return user.seller_id


def _assert_seller_active(user: models.User) -> None:
    sel = getattr(user, "seller", None)
    if sel is not None and not sel.active:
        raise HTTPException(status_code=404, detail="Seller não encontrado")


def _seller_for_read(user: models.User, seller_id_param: Optional[int], db: Session) -> int:
    r = _role(user)
    if r == "client":
        if not user.seller_id:
            raise HTTPException(status_code=400, detail="Usuário sem seller associado")
        _assert_seller_active(user)
        return user.seller_id
    # admin / manager / operator precisam passar o seller
    if not seller_id_param:
        raise HTTPException(status_code=422, detail="Informe seller_id")
    sel = db.query(models.Seller).filter(
        models.Seller.id == seller_id_param,
        models.Seller.active == True,  # noqa: E712
    ).first()
    if not sel:
        raise HTTPException(status_code=404, detail="Seller não encontrado")
    return sel.id


def _assert_scope(user: models.User, seller_id: int, seller_ids: Optional[List[int]]) -> None:
    """Para operações de leitura/admin: `seller_ids=None` (admin) libera tudo."""
    if seller_ids is None:
        return
    if seller_id not in seller_ids:
        raise HTTPException(status_code=403, detail="Fora do escopo do usuário")


# ───────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────

def _active_product(db: Session, seller_id: int, sku: str) -> Optional[models.Product]:
    return db.query(models.Product).filter(
        models.Product.seller_id == seller_id,
        models.Product.sku == sku,
        models.Product.active == True,  # noqa: E712
    ).first()


def _is_discontinued(db: Session, seller_id: int, sku: str) -> bool:
    return db.query(models.DiscontinuedSku.id).filter(
        models.DiscontinuedSku.seller_id == seller_id,
        models.DiscontinuedSku.sku == sku,
    ).first() is not None


def _sku_balance(db: Session, seller_id: int, sku: str) -> int:
    """Saldo atual do SKU (`stock_positions.current_stock`). 0 se não existe."""
    row = db.query(models.StockPosition.current_stock).filter(
        models.StockPosition.seller_id == seller_id,
        models.StockPosition.sku == sku,
    ).first()
    return int(row[0]) if row and row[0] is not None else 0


def _reserved_by_sku(db: Session, seller_id: int) -> dict[str, dict[int, int]]:
    """
    Reservas de pedidos de descarte/retirada em "solicitado", agrupadas por
    SKU -> {expiry_line_id: qty}. Uma consulta só, N+1 fora.
    """
    rows = db.query(
        models.ExpiryDisposal.sku,
        models.ExpiryDisposal.expiry_line_id,
        func.coalesce(func.sum(models.ExpiryDisposal.qty), 0),
    ).filter(
        models.ExpiryDisposal.seller_id == seller_id,
        models.ExpiryDisposal.status == "solicitado",
    ).group_by(
        models.ExpiryDisposal.sku, models.ExpiryDisposal.expiry_line_id,
    ).all()
    out: dict[str, dict[int, int]] = {}
    for sku, line_id, qty in rows:
        out.setdefault(sku, {})[int(line_id)] = int(qty or 0)
    return out


def _soma_linhas_ativas(db: Session, seller_id: int, sku: str, exclude_id: Optional[int] = None) -> int:
    """Σ qty_atual das linhas ativas (`a_chegar` conta — já é compromisso)."""
    q = db.query(func.coalesce(func.sum(models.ExpiryLine.qty_atual), 0)).filter(
        models.ExpiryLine.seller_id == seller_id,
        models.ExpiryLine.sku == sku,
        models.ExpiryLine.active == True,  # noqa: E712
    )
    if exclude_id is not None:
        q = q.filter(models.ExpiryLine.id != exclude_id)
    return int(q.scalar() or 0)


def _config_days(db: Session, seller_id: int) -> int:
    row = db.query(models.ExpiryAlertConfig.default_days).filter(
        models.ExpiryAlertConfig.seller_id == seller_id,
    ).first()
    return int(row[0]) if row else 30


def _override_days_map(db: Session, seller_id: int) -> dict[str, int]:
    rows = db.query(models.ExpiryAlertOverride.sku, models.ExpiryAlertOverride.days).filter(
        models.ExpiryAlertOverride.seller_id == seller_id,
    ).all()
    return {sku: int(d) for sku, d in rows}


def _write_audit(
    db: Session, *, entity_type: str, entity_id: Optional[int], action: str,
    detail: Optional[dict] = None, user_id: Optional[int] = None,
) -> None:
    db.add(models.AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        detail=json.dumps(detail, ensure_ascii=False, default=str) if detail else None,
        user_id=user_id,
        timestamp=now_brasilia(),
    ))


def _line_to_out(
    line: models.ExpiryLine, *, today: date, aviso_dias: int,
    reserved_map: dict[str, dict[int, int]],
    product_names: dict[str, Optional[str]],
) -> dict:
    reserved = reserved_map.get(line.sku, {}).get(line.id, 0)
    disponivel = max(0, int(line.qty_atual) - reserved)
    return {
        "id": line.id,
        "seller_id": line.seller_id,
        "sku": line.sku,
        "product_name": product_names.get(line.sku),
        "expiry_date": line.expiry_date,
        "lot_name": line.lot_name,
        "qty_inicial": int(line.qty_inicial),
        "qty_atual": int(line.qty_atual),
        "qty_reservada": int(reserved),
        "qty_disponivel": int(disponivel),
        "state": line.state,
        "origin_type": line.origin_type,
        "origin_nf_number": line.origin_nf_number,
        "situation": expiry_calc.situation(line.expiry_date, today, aviso_dias),
        "days_remaining": expiry_calc.days_remaining(line.expiry_date, today),
        "aviso_dias": aviso_dias,
        "created_at": line.created_at,
    }


# ───────────────────────────────────────────────────────────────────────
# Listagens
# ───────────────────────────────────────────────────────────────────────

@router.get("/lines", response_model=List[schemas.ExpiryLineOut])
def list_lines(
    seller_id: Optional[int] = Query(None),
    sku: Optional[str] = Query(None),
    include_a_chegar: bool = Query(True),
    situation_filter: Optional[str] = Query(None, description="vencido | aviso | ok"),
    search: Optional[str] = Query(None, description="busca em SKU, nome do produto ou lote"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_read(current_user, seller_id, db)

    q = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.seller_id == sid,
        models.ExpiryLine.active == True,  # noqa: E712
    )
    if not include_a_chegar:
        q = q.filter(models.ExpiryLine.state == "ativo")
    if sku:
        q = q.filter(models.ExpiryLine.sku == sku.strip())
    lines = q.order_by(models.ExpiryLine.expiry_date.asc(), models.ExpiryLine.id.asc()).all()

    # Nome de produto numa consulta só (sem N+1).
    skus = sorted({l.sku for l in lines})
    product_names: dict[str, Optional[str]] = {}
    if skus:
        prods = db.query(models.Product.sku, models.Product.name).filter(
            models.Product.seller_id == sid,
            models.Product.sku.in_(skus),
            models.Product.active == True,  # noqa: E712
        ).all()
        product_names = {s: n for s, n in prods}

        if search:
            needle = search.strip().lower()
            allowed = {
                s for s in skus
                if needle in s.lower() or (product_names.get(s) or "").lower().find(needle) >= 0
            }
            lines = [
                l for l in lines
                if l.sku in allowed or needle in (l.lot_name or "").lower()
            ]

    today = today_brasilia()
    default_days = _config_days(db, sid)
    overrides = _override_days_map(db, sid)
    reserved_map = _reserved_by_sku(db, sid)

    out: list[dict] = []
    for l in lines:
        aviso = overrides.get(l.sku, default_days)
        row = _line_to_out(l, today=today, aviso_dias=aviso,
                           reserved_map=reserved_map, product_names=product_names)
        if situation_filter and row["situation"] != situation_filter:
            continue
        out.append(row)
    return out


# ───────────────────────────────────────────────────────────────────────
# CRUD de linha
# ───────────────────────────────────────────────────────────────────────

def _validate_new_line(db: Session, seller_id: int, sku: str, qty: int, exclude_id: Optional[int] = None) -> None:
    """Trava comum entre POST /lines e PUT /lines/{id}."""
    if not sku or not sku.strip():
        raise HTTPException(status_code=422, detail="SKU é obrigatório")
    if qty is None or qty <= 0:
        raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")
    prod = _active_product(db, seller_id, sku)
    if prod is None:
        raise HTTPException(status_code=422, detail=f"SKU {sku!r} não tem produto ativo cadastrado")
    if _is_discontinued(db, seller_id, sku):
        raise HTTPException(status_code=422, detail=f"SKU {sku!r} está descontinuado")
    saldo = _sku_balance(db, seller_id, sku)
    cadastrado = _soma_linhas_ativas(db, seller_id, sku, exclude_id=exclude_id)
    if cadastrado + qty > saldo:
        raise HTTPException(
            status_code=422,
            detail=f"Quantidade excederia o saldo do SKU — saldo {saldo}, já cadastrado {cadastrado}",
        )


@router.post("/lines", response_model=schemas.ExpiryLineOut, status_code=201)
def create_line(
    body: schemas.ExpiryLineIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    sku = (body.sku or "").strip()
    try:
        parsed = expiry_calc.parse_expiry_date(body.expiry_date_text or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        lote = expiry_calc.normalize_lot(body.lot_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    _validate_new_line(db, sid, sku, int(body.quantity))

    conflito = expiry_hooks.check_lot_date(
        db, seller_id=sid, sku=sku, lot_name=lote, expiry_date=parsed,
    )
    if conflito:
        raise HTTPException(status_code=422, detail=conflito)

    prod = _active_product(db, sid, sku)
    line = models.ExpiryLine(
        seller_id=sid,
        product_id=prod.id if prod else None,
        sku=sku,
        expiry_date=parsed,
        lot_name=lote,
        qty_inicial=int(body.quantity),
        qty_atual=int(body.quantity),
        state="ativo",
        origin_type="portal",
        active=True,
        created_by_id=current_user.id,
    )
    db.add(line)
    db.flush()
    _write_audit(
        db, entity_type="ExpiryLine", entity_id=line.id, action="CREATE",
        detail={"sku": sku, "expiry_date": parsed, "qty": int(body.quantity), "lot_name": lote},
        user_id=current_user.id,
    )
    db.commit()
    db.refresh(line)
    return _single_line_out(db, sid, line)


def _single_line_out(db: Session, seller_id: int, line: models.ExpiryLine) -> dict:
    default_days = _config_days(db, seller_id)
    override = db.query(models.ExpiryAlertOverride.days).filter(
        models.ExpiryAlertOverride.seller_id == seller_id,
        models.ExpiryAlertOverride.sku == line.sku,
    ).first()
    aviso = int(override[0]) if override else default_days
    product_name = None
    prod = _active_product(db, seller_id, line.sku)
    if prod:
        product_name = prod.name
    reserved_map = _reserved_by_sku(db, seller_id)
    return _line_to_out(
        line, today=today_brasilia(), aviso_dias=aviso,
        reserved_map=reserved_map, product_names={line.sku: product_name},
    )


@router.put("/lines/{line_id}", response_model=schemas.ExpiryLineOut)
def update_line(
    line_id: int,
    body: schemas.ExpiryLineEditIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    line = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.id == line_id,
        models.ExpiryLine.seller_id == sid,
        models.ExpiryLine.active == True,  # noqa: E712
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="Linha de vencimento não encontrada")

    antes = {"expiry_date": str(line.expiry_date), "qty_atual": int(line.qty_atual)}
    new_date: Optional[date] = None
    new_qty: Optional[int] = None

    if body.expiry_date_text is not None:
        try:
            new_date = expiry_calc.parse_expiry_date(body.expiry_date_text)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    if body.quantity is not None:
        new_qty = int(body.quantity)
        if new_qty <= 0:
            raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")
        # Σ pedidos de descarte/retirada em "solicitado" nesta linha
        reserved_here = int(db.query(
            func.coalesce(func.sum(models.ExpiryDisposal.qty), 0)
        ).filter(
            models.ExpiryDisposal.expiry_line_id == line.id,
            models.ExpiryDisposal.status == "solicitado",
        ).scalar() or 0)
        if new_qty < reserved_here:
            raise HTTPException(
                status_code=422,
                detail=f"Quantidade abaixo do reservado em pedidos de descarte/retirada ({reserved_here})",
            )
        # Trava do saldo global do SKU
        saldo = _sku_balance(db, sid, line.sku)
        soma_outras = _soma_linhas_ativas(db, sid, line.sku, exclude_id=line.id)
        if soma_outras + new_qty > saldo:
            raise HTTPException(
                status_code=422,
                detail=f"Quantidade excederia o saldo do SKU — saldo {saldo}, outras linhas {soma_outras}",
            )
        line.qty_atual = new_qty

    # Lote (09/11/2026): omitido = não muda; "" = tira o lote. O mesmo lote do
    # mesmo SKU precisa manter sempre o mesmo vencimento — vale para trocar o
    # lote e para trocar a data de uma linha que tem lote.
    antes["lot_name"] = line.lot_name
    final_lote = line.lot_name
    if body.lot_name is not None:
        try:
            final_lote = expiry_calc.normalize_lot(body.lot_name)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    final_date = new_date if new_date is not None else line.expiry_date
    if final_lote and (final_lote != line.lot_name or final_date != line.expiry_date):
        conflito = expiry_hooks.check_lot_date(
            db, seller_id=sid, sku=line.sku, lot_name=final_lote,
            expiry_date=final_date, exclude_ids=[line.id],
        )
        if conflito:
            raise HTTPException(status_code=422, detail=conflito)
    line.lot_name = final_lote

    if new_date is not None:
        line.expiry_date = new_date

    db.flush()
    _write_audit(
        db, entity_type="ExpiryLine", entity_id=line.id, action="UPDATE",
        detail={
            "antes": antes,
            "depois": {"expiry_date": str(line.expiry_date), "qty_atual": int(line.qty_atual),
                       "lot_name": line.lot_name},
        },
        user_id=current_user.id,
    )
    db.commit()
    db.refresh(line)
    return _single_line_out(db, sid, line)


@router.delete("/lines/{line_id}", status_code=204)
def delete_line(
    line_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    line = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.id == line_id,
        models.ExpiryLine.seller_id == sid,
        models.ExpiryLine.active == True,  # noqa: E712
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="Linha de vencimento não encontrada")
    reserved_here = int(db.query(
        func.coalesce(func.sum(models.ExpiryDisposal.qty), 0)
    ).filter(
        models.ExpiryDisposal.expiry_line_id == line.id,
        models.ExpiryDisposal.status == "solicitado",
    ).scalar() or 0)
    if reserved_here > 0:
        raise HTTPException(
            status_code=422,
            detail="Linha com pedido de descarte/retirada em aberto — cancele o pedido antes",
        )
    line.active = False
    _write_audit(
        db, entity_type="ExpiryLine", entity_id=line.id, action="DELETE",
        detail={"sku": line.sku, "expiry_date": str(line.expiry_date), "qty_atual": int(line.qty_atual)},
        user_id=current_user.id,
    )
    db.commit()
    return Response(status_code=204)


# ───────────────────────────────────────────────────────────────────────
# Validação de lote (usado na Fase 2 — endpoint existe desde já)
# ───────────────────────────────────────────────────────────────────────

@router.post("/lines/validate-batch", response_model=schemas.ExpiryBatchValidateOut)
def validate_batch(
    body: schemas.ExpiryBatchValidateIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    nf = db.query(models.InboundNf).join(
        models.InboundAppointment, models.InboundAppointment.id == models.InboundNf.appointment_id,
    ).filter(
        models.InboundNf.id == body.inbound_nf_id,
        models.InboundAppointment.seller_id == sid,
    ).first()
    if not nf:
        raise HTTPException(status_code=404, detail="NF do agendamento não encontrada")

    # Quantidades do XML por SKU — vêm do Order criado pelo agendamento ao
    # virar RECEBIDO. Em Fase 1 pode não existir ainda; nesse caso aceitamos
    # a validação só com as regras de cada linha (sem a trava "soma ≤ XML").
    xml_totals: dict[str, int] = {}
    if nf.order_id:
        items = db.query(models.OrderItem).filter(models.OrderItem.order_id == nf.order_id).all()
        for it in items:
            xml_totals[it.sku] = xml_totals.get(it.sku, 0) + int(it.quantity or 0)

    totals_by_sku: dict[str, dict] = {}
    errors: list[str] = []
    warnings: list[str] = []

    today = today_brasilia()
    for i, item in enumerate(body.items, start=1):
        sku = (item.sku or "").strip()
        if not sku:
            errors.append(f"Linha {i}: SKU vazio")
            continue
        try:
            parsed = expiry_calc.parse_expiry_date(item.expiry_date_text or "")
        except ValueError as exc:
            errors.append(f"Linha {i} ({sku}): {exc}")
            continue
        qty = int(item.quantity or 0)
        if qty <= 0:
            errors.append(f"Linha {i} ({sku}): quantidade precisa ser > 0")
            continue
        try:
            lote = expiry_calc.normalize_lot(item.lot_name)
        except ValueError as exc:
            errors.append(f"Linha {i} ({sku}): {exc}")
            continue
        if lote:
            conflito = expiry_hooks.check_lot_date(
                db, seller_id=sid, sku=sku, lot_name=lote, expiry_date=parsed,
                exclude_ids=[
                    ln.id for ln in db.query(models.ExpiryLine.id).filter(
                        models.ExpiryLine.origin_inbound_nf_id == nf.id,
                        models.ExpiryLine.state == "a_chegar",
                    ).all()
                ],
            )
            if conflito:
                errors.append(f"Linha {i} ({sku}): {conflito}")
                continue
        if _active_product(db, sid, sku) is None or _is_discontinued(db, sid, sku):
            # SKUs sem produto / descontinuados são FILTRADOS no front, mas se
            # chegarem aqui, só avisam — não é a decisão deste endpoint cadastrar
            # produto.
            warnings.append(f"Linha {i} ({sku}): SKU sem produto ativo ou descontinuado")
            continue
        if parsed < today:
            warnings.append(f"Linha {i} ({sku}): data já vencida ({parsed.strftime('%d/%m/%Y')})")

        bucket = totals_by_sku.setdefault(sku, {"soma": 0, "xml": xml_totals.get(sku, 0)})
        bucket["soma"] += qty

    for sku, info in totals_by_sku.items():
        xml_qty = info["xml"]
        if xml_qty and info["soma"] > xml_qty:
            errors.append(f"SKU {sku}: soma {info['soma']} maior que a quantidade da NF ({xml_qty})")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "totals_by_sku": totals_by_sku,
    }


# ───────────────────────────────────────────────────────────────────────
# Configuração de aviso
# ───────────────────────────────────────────────────────────────────────

@router.get("/alert-config", response_model=schemas.ExpiryAlertConfigOut)
def get_alert_config(
    seller_id: Optional[int] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_read(current_user, seller_id, db)
    default_days = _config_days(db, sid)
    overs = db.query(models.ExpiryAlertOverride.sku, models.ExpiryAlertOverride.days).filter(
        models.ExpiryAlertOverride.seller_id == sid,
    ).all()
    return {
        "default_days": default_days,
        "overrides": [{"sku": s, "days": int(d)} for s, d in overs],
    }


@router.put("/alert-config", response_model=schemas.ExpiryAlertConfigOut)
def put_alert_config(
    body: schemas.ExpiryAlertConfigIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    if body.default_days < 0 or body.default_days > 3650:
        raise HTTPException(status_code=422, detail="Dias de aviso fora da faixa (0..3650)")
    row = db.query(models.ExpiryAlertConfig).filter(
        models.ExpiryAlertConfig.seller_id == sid,
    ).first()
    antes = int(row.default_days) if row else 30
    if row:
        row.default_days = int(body.default_days)
    else:
        db.add(models.ExpiryAlertConfig(seller_id=sid, default_days=int(body.default_days)))
    _write_audit(
        db, entity_type="ExpiryAlertConfig", entity_id=sid, action="UPDATE",
        detail={"antes": antes, "depois": int(body.default_days)},
        user_id=current_user.id,
    )
    db.commit()
    return get_alert_config(seller_id=None, current_user=current_user, db=db)


@router.put("/alert-config/sku", response_model=schemas.ExpiryAlertConfigOut)
def put_alert_override(
    body: schemas.ExpiryAlertOverrideIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    sku = (body.sku or "").strip()
    if not sku:
        raise HTTPException(status_code=422, detail="SKU é obrigatório")
    row = db.query(models.ExpiryAlertOverride).filter(
        models.ExpiryAlertOverride.seller_id == sid,
        models.ExpiryAlertOverride.sku == sku,
    ).first()

    if body.days is None:
        if row:
            db.delete(row)
            _write_audit(
                db, entity_type="ExpiryAlertOverride", entity_id=row.id, action="DELETE",
                detail={"sku": sku}, user_id=current_user.id,
            )
    else:
        if body.days < 0 or body.days > 3650:
            raise HTTPException(status_code=422, detail="Dias de aviso fora da faixa (0..3650)")
        if row:
            antes = int(row.days)
            row.days = int(body.days)
            _write_audit(
                db, entity_type="ExpiryAlertOverride", entity_id=row.id, action="UPDATE",
                detail={"sku": sku, "antes": antes, "depois": int(body.days)},
                user_id=current_user.id,
            )
        else:
            new = models.ExpiryAlertOverride(seller_id=sid, sku=sku, days=int(body.days))
            db.add(new)
            db.flush()
            _write_audit(
                db, entity_type="ExpiryAlertOverride", entity_id=new.id, action="CREATE",
                detail={"sku": sku, "days": int(body.days)}, user_id=current_user.id,
            )
    db.commit()
    return get_alert_config(seller_id=None, current_user=current_user, db=db)


# ───────────────────────────────────────────────────────────────────────
# Pedidos de descarte / retirada
# ───────────────────────────────────────────────────────────────────────

@router.post("/disposals", response_model=schemas.ExpiryDisposalOut, status_code=201)
def create_disposal(
    body: schemas.ExpiryDisposalIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    if body.type not in ("descarte", "retirada"):
        raise HTTPException(status_code=422, detail="Tipo inválido — use descarte ou retirada")
    if body.qty is None or int(body.qty) <= 0:
        raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")

    line = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.id == body.expiry_line_id,
        models.ExpiryLine.seller_id == sid,
        models.ExpiryLine.active == True,  # noqa: E712
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="Linha de vencimento não encontrada")

    # Regra de 09/11/2026: descarte/retirada só de vencimento JÁ vencido
    # (mesmo critério da tela: data < hoje; no dia do vencimento ainda é válido).
    if line.expiry_date >= today_brasilia():
        raise HTTPException(
            status_code=422,
            detail="Só é possível pedir descarte/retirada de vencimento já vencido",
        )

    ja_reservado = int(db.query(
        func.coalesce(func.sum(models.ExpiryDisposal.qty), 0)
    ).filter(
        models.ExpiryDisposal.expiry_line_id == line.id,
        models.ExpiryDisposal.status == "solicitado",
    ).scalar() or 0)
    if ja_reservado + int(body.qty) > int(line.qty_atual):
        raise HTTPException(
            status_code=422,
            detail=f"Quantidade excede o disponível na linha ({int(line.qty_atual) - ja_reservado})",
        )
    obs = (body.obs or "").strip() or None
    if obs and len(obs) > 500:
        raise HTTPException(status_code=422, detail="Observação acima de 500 caracteres")

    disp = models.ExpiryDisposal(
        seller_id=sid,
        expiry_line_id=line.id,
        sku=line.sku,
        type=body.type,
        qty=int(body.qty),
        obs=obs,
        status="solicitado",
        requested_by_id=current_user.id,
    )
    db.add(disp)
    db.flush()
    notice = models.ExpiryNotice(
        type="disposal",
        seller_id=sid,
        sku=line.sku,
        expiry_date=line.expiry_date,
        disposal_id=disp.id,
    )
    db.add(notice)
    _write_audit(
        db, entity_type="ExpiryDisposal", entity_id=disp.id, action="CREATE",
        detail={
            "sku": line.sku, "type": body.type, "qty": int(body.qty),
            "expiry_date": str(line.expiry_date),
        },
        user_id=current_user.id,
    )
    db.commit()
    db.refresh(disp)
    return _disposal_to_out(db, disp, line)


def _disposal_to_out(db: Session, disp: models.ExpiryDisposal, line: Optional[models.ExpiryLine] = None) -> dict:
    if line is None:
        line = db.query(models.ExpiryLine).filter(models.ExpiryLine.id == disp.expiry_line_id).first()
    prod = _active_product(db, disp.seller_id, disp.sku) if disp.sku else None
    return {
        "id": disp.id,
        "seller_id": disp.seller_id,
        "expiry_line_id": disp.expiry_line_id,
        "sku": disp.sku,
        "type": disp.type,
        "qty": int(disp.qty),
        "obs": disp.obs,
        "status": disp.status,
        "requested_at": disp.requested_at,
        "fulfilled_at": disp.fulfilled_at,
        "cancelled_at": disp.cancelled_at,
        "product_name": prod.name if prod else None,
        "expiry_date": line.expiry_date if line else None,
        "lot_name": line.lot_name if line else None,
    }


@router.delete("/disposals/{disposal_id}", status_code=204)
def cancel_disposal(
    disposal_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)
    disp = db.query(models.ExpiryDisposal).filter(
        models.ExpiryDisposal.id == disposal_id,
        models.ExpiryDisposal.seller_id == sid,
    ).first()
    if not disp:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if disp.status != "solicitado":
        raise HTTPException(status_code=400, detail="Só é possível cancelar enquanto o pedido está Solicitado")
    disp.status = "cancelado"
    disp.cancelled_at = now_brasilia()
    _resolve_disposal_notice(db, disp)
    _write_audit(
        db, entity_type="ExpiryDisposal", entity_id=disp.id, action="CANCEL",
        detail={"sku": disp.sku, "qty": int(disp.qty)}, user_id=current_user.id,
    )
    db.commit()
    return Response(status_code=204)


def _resolve_disposal_notice(db: Session, disp: models.ExpiryDisposal) -> None:
    db.query(models.ExpiryNotice).filter(
        models.ExpiryNotice.type == "disposal",
        models.ExpiryNotice.disposal_id == disp.id,
        models.ExpiryNotice.resolved_at.is_(None),
    ).update({"resolved_at": now_brasilia()}, synchronize_session=False)


@router.get("/disposals", response_model=List[schemas.ExpiryDisposalOut])
def list_disposals(
    seller_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_read(current_user, seller_id, db)
    q = db.query(models.ExpiryDisposal).filter(models.ExpiryDisposal.seller_id == sid)
    if status_filter:
        q = q.filter(models.ExpiryDisposal.status == status_filter)
    disps = q.order_by(models.ExpiryDisposal.requested_at.desc()).all()
    # evita N+1
    line_ids = [d.expiry_line_id for d in disps]
    lines = {}
    if line_ids:
        for l in db.query(models.ExpiryLine).filter(models.ExpiryLine.id.in_(line_ids)).all():
            lines[l.id] = l
    out = []
    for d in disps:
        out.append(_disposal_to_out(db, d, lines.get(d.expiry_line_id)))
    return out


@router.post("/disposals/{disposal_id}/fulfill", response_model=schemas.ExpiryDisposalOut)
def fulfill_disposal(
    disposal_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    launch_stock: bool = Query(False, description="Também lança Saída no estoque do seller"),
):
    """
    Atende um pedido de descarte/retirada. Por padrão só baixa a linha de
    vencimento (camada informativa, não toca o estoque).

    EXCEÇÃO ÚNICA (09/11/2026): com `launch_stock=true`, por ação explícita do
    gerente, também grava uma Saída em stock_movements + posição, na MESMA
    transação. A Saída nasce SEM order_id (como Devoluções) para o estorno de
    NF não varrê-la junto.
    """
    if _role(current_user) not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Só admin/manager atendem pedidos")

    disp = db.query(models.ExpiryDisposal).filter(models.ExpiryDisposal.id == disposal_id).first()
    if not disp:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    _assert_scope(current_user, disp.seller_id, seller_ids)
    if disp.status != "solicitado":
        raise HTTPException(status_code=400, detail="Pedido não está em Solicitado")

    # Checagens do lançamento no estoque ANTES de qualquer alteração.
    stock_prod = None
    if launch_stock:
        stock_prod = _active_product(db, disp.seller_id, disp.sku)
        if _is_discontinued(db, disp.seller_id, disp.sku):
            raise HTTPException(
                status_code=400,
                detail=f"SKU {disp.sku} está descontinuado e não aceita movimentação de estoque.",
            )

    # Decremento ATÔMICO (UPDATE ... WHERE qty_atual >= :q RETURNING id).
    # Em SQLite não tem RETURNING pra UPDATE em todas as versões, mas o lock
    # da transação resolve — fazemos SELECT ... FOR UPDATE no Postgres via
    # with_for_update para evitar lost update com outro atendimento paralelo.
    db_bind = db.get_bind()
    is_postgres = db_bind.dialect.name == "postgresql"
    if is_postgres:
        line = db.query(models.ExpiryLine).filter(
            models.ExpiryLine.id == disp.expiry_line_id
        ).with_for_update().first()
    else:
        line = db.query(models.ExpiryLine).filter(
            models.ExpiryLine.id == disp.expiry_line_id
        ).first()
    if not line:
        raise HTTPException(status_code=404, detail="Linha de vencimento não encontrada")
    if int(line.qty_atual) < int(disp.qty):
        raise HTTPException(status_code=409, detail="Quantidade da linha menor que o pedido — ajuste a linha primeiro")

    line.qty_atual = int(line.qty_atual) - int(disp.qty)
    if line.qty_atual <= 0:
        line.active = False
        line.qty_atual = 0
    disp.status = "atendido"
    disp.fulfilled_by_id = current_user.id
    disp.fulfilled_at = now_brasilia()
    _resolve_disposal_notice(db, disp)

    stock_movement_id = None
    if launch_stock:
        from ..services.stock_manager import update_stock_position
        tipo_txt = "Descarte" if disp.type == "descarte" else "Retirada"
        exp_txt = line.expiry_date.strftime("%d/%m/%Y") if line.expiry_date else "-"
        nome = stock_prod.name if stock_prod else disp.sku
        mov = models.StockMovement(
            seller_id=disp.seller_id,
            sku=disp.sku,
            product_name=nome,
            movement_date=today_brasilia(),
            movement_type=models.MovementType.OUT,
            quantity=int(disp.qty),
            adjusted_quantity=int(disp.qty),
            nature=f"{tipo_txt} de vencimento",
            observation=(
                f"{tipo_txt} de vencimento ({exp_txt}) — pedido #{disp.id} atendido por "
                f"{current_user.name} em {now_brasilia().strftime('%d/%m/%Y')}."
            ),
            operator_id=current_user.id,
            created_at=now_brasilia(),
        )
        db.add(mov)
        update_stock_position(
            seller_id=disp.seller_id, sku=disp.sku, product_name=nome,
            movement_type=models.MovementType.OUT, quantity=int(disp.qty), db=db,
        )
        db.flush()
        stock_movement_id = mov.id

    _write_audit(
        db, entity_type="ExpiryDisposal", entity_id=disp.id, action="FULFILL",
        detail={
            "sku": disp.sku, "qty": int(disp.qty), "line_id": line.id,
            "linha_apagada": not line.active,
            "launch_stock": bool(launch_stock),
            "stock_movement_id": stock_movement_id,
        },
        user_id=current_user.id,
    )
    db.commit()
    return _disposal_to_out(db, disp, line)


# ───────────────────────────────────────────────────────────────────────
# Avisos de gerência
# ───────────────────────────────────────────────────────────────────────

@router.get("/notices", response_model=List[schemas.ExpiryNoticeOut])
def list_notices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
):
    if _role(current_user) not in ("admin", "manager", "operator"):
        raise HTTPException(status_code=403, detail="Só usuários internos")
    q = db.query(models.ExpiryNotice).filter(models.ExpiryNotice.resolved_at.is_(None))
    if seller_ids is not None:
        if not seller_ids:
            return []
        q = q.filter(models.ExpiryNotice.seller_id.in_(seller_ids))
    # dismissed por este usuário
    dismissed_ids = {
        r[0] for r in db.query(models.ExpiryNoticeDismissal.notice_id).filter(
            models.ExpiryNoticeDismissal.user_id == current_user.id,
        ).all()
    }
    notices = q.order_by(models.ExpiryNotice.created_at.desc()).all()
    notices = [n for n in notices if n.id not in dismissed_ids]

    # nomes de seller/produto numa consulta só
    seller_ids_set = {n.seller_id for n in notices}
    sellers = {}
    if seller_ids_set:
        for s in db.query(models.Seller).filter(models.Seller.id.in_(seller_ids_set)).all():
            sellers[s.id] = s

    out: list[dict] = []
    for n in notices:
        disp = n.disposal
        product_name = None
        if n.sku:
            prod = _active_product(db, n.seller_id, n.sku)
            product_name = prod.name if prod else None
        notice_lot = None
        if disp is not None and disp.line is not None:
            notice_lot = disp.line.lot_name
        elif n.payload:
            try:
                notice_lot = (json.loads(n.payload) or {}).get("lot_name")
            except (ValueError, TypeError):
                notice_lot = None
        out.append({
            "id": n.id,
            "type": n.type,
            "lot_name": notice_lot,
            "seller_id": n.seller_id,
            "seller_name": sellers.get(n.seller_id).name if sellers.get(n.seller_id) else None,
            "sku": n.sku,
            "product_name": product_name,
            "expiry_date": n.expiry_date,
            "order_id": n.order_id,
            "nf_number": None,
            "disposal_id": n.disposal_id,
            "disposal_type": disp.type if disp else None,
            "disposal_qty": int(disp.qty) if disp else None,
            "payload": n.payload,
            "created_at": n.created_at,
        })
    return out


@router.get("/notices/count")
def notices_count(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
):
    """Contagem de avisos não resolvidos no escopo do usuário, já descontando
    os dismissals próprios. Só admin/manager usam — operator/client -> 0."""
    if _role(current_user) not in ("admin", "manager"):
        return {"total": 0}
    q = db.query(models.ExpiryNotice.id).filter(models.ExpiryNotice.resolved_at.is_(None))
    if seller_ids is not None:
        if not seller_ids:
            return {"total": 0}
        q = q.filter(models.ExpiryNotice.seller_id.in_(seller_ids))
    dismissed_ids = {
        r[0] for r in db.query(models.ExpiryNoticeDismissal.notice_id).filter(
            models.ExpiryNoticeDismissal.user_id == current_user.id,
        ).all()
    }
    ids = [r[0] for r in q.all()]
    total = sum(1 for i in ids if i not in dismissed_ids)
    return {"total": total}


@router.post("/notices/{notice_id}/dismiss", status_code=204)
def dismiss_notice(
    notice_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _role(current_user) not in ("admin", "manager", "operator"):
        raise HTTPException(status_code=403, detail="Só usuários internos")
    notice = db.query(models.ExpiryNotice).filter(models.ExpiryNotice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="Aviso não encontrado")
    exists = db.query(models.ExpiryNoticeDismissal).filter(
        models.ExpiryNoticeDismissal.notice_id == notice.id,
        models.ExpiryNoticeDismissal.user_id == current_user.id,
    ).first()
    if not exists:
        db.add(models.ExpiryNoticeDismissal(notice_id=notice.id, user_id=current_user.id))
        db.commit()
    return Response(status_code=204)


@router.post("/notices/{notice_id}/resolve", status_code=204)
def resolve_notice(
    notice_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
):
    if _role(current_user) not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Só admin/manager resolvem")
    notice = db.query(models.ExpiryNotice).filter(models.ExpiryNotice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="Aviso não encontrado")
    _assert_scope(current_user, notice.seller_id, seller_ids)
    if notice.resolved_at is None:
        notice.resolved_at = now_brasilia()
        _write_audit(
            db, entity_type="ExpiryNotice", entity_id=notice.id, action="RESOLVE",
            detail={"type": notice.type}, user_id=current_user.id,
        )
        db.commit()
    return Response(status_code=204)


# ───────────────────────────────────────────────────────────────────────
# Modal de login (Portal)
# ───────────────────────────────────────────────────────────────────────

@router.get("/login-modal", response_model=schemas.ExpiryLoginModalOut)
def login_modal(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_for_write(current_user)   # garante client
    today = today_brasilia()
    dismissed = db.query(models.ExpiryLoginModalDismissal).filter(
        models.ExpiryLoginModalDismissal.user_id == current_user.id,
        models.ExpiryLoginModalDismissal.dismissed_date == today,
    ).first()
    if dismissed:
        return {"show": False, "counts": {}, "top": []}

    default_days = _config_days(db, sid)
    overrides = _override_days_map(db, sid)

    lines = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.seller_id == sid,
        models.ExpiryLine.active == True,  # noqa: E712
        models.ExpiryLine.state == "ativo",
    ).all()

    reserved_map = _reserved_by_sku(db, sid)
    skus = sorted({l.sku for l in lines})
    product_names: dict[str, Optional[str]] = {}
    if skus:
        prods = db.query(models.Product.sku, models.Product.name).filter(
            models.Product.seller_id == sid, models.Product.sku.in_(skus),
            models.Product.active == True,  # noqa: E712
        ).all()
        product_names = {s: n for s, n in prods}

    enriched = []
    for l in lines:
        aviso = overrides.get(l.sku, default_days)
        row = _line_to_out(l, today=today, aviso_dias=aviso,
                           reserved_map=reserved_map, product_names=product_names)
        if row["situation"] in ("vencido", "aviso"):
            enriched.append(row)

    # ordem: vencidos primeiro, depois dias crescentes
    enriched.sort(key=lambda r: (0 if r["situation"] == "vencido" else 1, r["days_remaining"], r["id"]))

    counts = {
        "vencidos": sum(1 for r in enriched if r["situation"] == "vencido"),
        "aviso":    sum(1 for r in enriched if r["situation"] == "aviso"),
    }
    return {
        "show": bool(enriched),
        "counts": counts,
        "top": enriched[:5],
    }


@router.get("/export.xlsx")
def export_xlsx(
    seller_id: Optional[int] = Query(None),
    sku: Optional[str] = Query(None),
    situation_filter: Optional[str] = Query(None),
    include_a_chegar: bool = Query(True),
    search: Optional[str] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Exporta a aba Vencimentos em Excel (openpyxl, em memória).

    Respeita os mesmos filtros da tela. Escopo = o mesmo de GET /lines.
    """
    rows = list_lines(
        seller_id=seller_id, sku=sku, include_a_chegar=include_a_chegar,
        situation_filter=situation_filter, search=search,
        current_user=current_user, db=db,
    )

    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "VENCIMENTOS"
    headers = ["SKU", "Produto", "Lote", "Vencimento", "Qtd atual", "Qtd inicial",
               "Dias restantes", "Situação", "Estado", "Origem (NF)"]
    ws.append(headers)
    for r in rows:
        ws.append([
            r["sku"],
            r.get("product_name") or "",
            r.get("lot_name") or "",
            r["expiry_date"].strftime("%d/%m/%Y") if r.get("expiry_date") else "",
            int(r.get("qty_atual") or 0),
            int(r.get("qty_inicial") or 0),
            int(r.get("days_remaining") or 0),
            r.get("situation") or "",
            r.get("state") or "",
            r.get("origin_nf_number") or "",
        ])

    ws_help = wb.create_sheet("INSTRUCOES")
    ws_help.append(["Esta planilha reflete os vencimentos cadastrados no WMS Kiwkiw."])
    ws_help.append(["Situação: vencido / aviso (dentro do prazo de aviso) / ok."])
    ws_help.append(["Estado: a_chegar (cadastrado em agendamento, ainda não conferido) / ativo."])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="VENCIMENTOS.xlsx"'},
    )


@router.post("/login-modal/dismiss", status_code=204)
def dismiss_login_modal(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _seller_for_write(current_user)
    today = today_brasilia()
    exists = db.query(models.ExpiryLoginModalDismissal).filter(
        models.ExpiryLoginModalDismissal.user_id == current_user.id,
        models.ExpiryLoginModalDismissal.dismissed_date == today,
    ).first()
    if not exists:
        db.add(models.ExpiryLoginModalDismissal(user_id=current_user.id, dismissed_date=today))
        db.commit()
    return Response(status_code=204)
