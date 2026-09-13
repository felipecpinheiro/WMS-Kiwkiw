"""
WMS Kiwkiw - Router de Insumos do Cliente (13/09/2026)

Insumo = material sem código de barras (adesivo, cartão, caixa própria...) que
o seller manda pra Kiwkiw usar no próprio pedido. Não dá pra bipar, então isso
NUNCA sensibiliza estoque nem faturamento — é um saldo ESTIMADO
(entradas - consumo calculado por regra), gerenciado pelo PRÓPRIO seller no
Portal (role=client). Ver cálculo em services/supply_calc.py.

Acesso:
  * client -> só o próprio seller_id (via `_supply_seller_id`), pode criar/
    editar/apagar insumo, entrada e regra livremente.
  * admin  -> só leitura, passando `?seller_id=` (suporte).
  * Ninguém mais (manager/operator) mexe aqui — decisão do dono do sistema.

Os 4 insumos das caixas próprias (ver PROPRIO_BOXES) nascem TRAVADOS
(`locked=True`): nome e regra fixos, a API recusa qualquer alteração de nome,
regra ou exclusão — só as entradas (quantidade/data) continuam livres. Mesmo a
tela escondendo os botões, o servidor revalida (mesma lógica de Devoluções:
não confiar só na tela).
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..auth import get_current_user
from ..timezone_utils import today_brasilia
from .. import models, schemas
from ..services import supply_calc

router = APIRouter(prefix="/client-supplies", tags=["Insumos do Cliente"])

_RULE_TYPES_SELLER = {"PER_ORDER", "SKU_OCCURRENCE", "SKU_QUANTITY"}


def _seller_id_for_write(current_user: models.User) -> int:
    """Só client mexe. Precisa ter seller_id vinculado."""
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role != "client":
        raise HTTPException(status_code=403, detail="Acesso negado — só o seller gerencia seus insumos")
    if not current_user.seller_id:
        raise HTTPException(status_code=400, detail="Usuário sem seller associado")
    return current_user.seller_id


def _seller_id_for_read(current_user: models.User, seller_id_param: Optional[int]) -> int:
    """client -> o próprio; admin -> exige `?seller_id=` (leitura de suporte)."""
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role == "client":
        if not current_user.seller_id:
            raise HTTPException(status_code=400, detail="Usuário sem seller associado")
        return current_user.seller_id
    if role == "admin":
        if not seller_id_param:
            raise HTTPException(status_code=422, detail="Informe seller_id")
        return seller_id_param
    raise HTTPException(status_code=403, detail="Acesso negado")


def _get_supply(db: Session, seller_id: int, supply_id: int) -> models.ClientSupply:
    supply = (
        db.query(models.ClientSupply)
        .options(joinedload(models.ClientSupply.entries), joinedload(models.ClientSupply.rules))
        .filter(models.ClientSupply.id == supply_id, models.ClientSupply.seller_id == seller_id)
        .first()
    )
    if not supply:
        raise HTTPException(status_code=404, detail="Insumo não encontrado")
    return supply


def _to_out(db: Session, supply: models.ClientSupply) -> dict:
    bal = supply_calc.compute_balance(db, supply)
    return {
        "id": supply.id,
        "seller_id": supply.seller_id,
        "name": supply.name,
        "count_from_date": supply.count_from_date,
        "locked": supply.locked,
        "box_key": supply.box_key,
        "entries": [e for e in supply.entries if e.active],
        "rules": [r for r in supply.rules if r.active],
        **bal,
    }


# ─────────────────────────────────────────────────────────
# LISTAGEM
# ─────────────────────────────────────────────────────────

@router.get("", response_model=list[schemas.ClientSupplyOut])
def list_supplies(
    seller_id: Optional[int] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_read(current_user, seller_id)

    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role == "client":
        # Garante os 4 insumos de caixa própria antes de listar — idempotente.
        supply_calc.ensure_locked_box_supplies(db, sid, today_brasilia())

    supplies = (
        db.query(models.ClientSupply)
        .options(joinedload(models.ClientSupply.entries), joinedload(models.ClientSupply.rules))
        .filter(models.ClientSupply.seller_id == sid, models.ClientSupply.active == True)  # noqa: E712
        .order_by(models.ClientSupply.locked.desc(), models.ClientSupply.name.asc())
        .all()
    )
    return [_to_out(db, s) for s in supplies]


@router.get("/movements", response_model=list[schemas.ClientSupplyMovementOut])
def list_movements(
    seller_id: Optional[int] = Query(None),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Extrato combinado (entradas + consumo estimado por pedido) — sub-aba Movimentos."""
    sid = _seller_id_for_read(current_user, seller_id)
    return supply_calc.list_movements(db, sid)


# ─────────────────────────────────────────────────────────
# INSUMO
# ─────────────────────────────────────────────────────────

@router.post("", response_model=schemas.ClientSupplyOut, status_code=201)
def create_supply(
    body: schemas.ClientSupplyIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Nome é obrigatório")
    supply = models.ClientSupply(
        seller_id=sid, name=body.name.strip(), count_from_date=body.count_from_date,
        locked=False, active=True,
    )
    db.add(supply)
    db.commit()
    db.refresh(supply)
    return _to_out(db, supply)


@router.put("/{supply_id}", response_model=schemas.ClientSupplyOut)
def update_supply(
    supply_id: int,
    body: schemas.ClientSupplyIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    supply = _get_supply(db, sid, supply_id)
    if supply.locked and body.name.strip() != supply.name:
        raise HTTPException(status_code=400, detail="Este insumo é travado — o nome não pode ser alterado")
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Nome é obrigatório")
    supply.name = body.name.strip()
    supply.count_from_date = body.count_from_date
    db.commit()
    db.refresh(supply)
    return _to_out(db, supply)


@router.delete("/{supply_id}", status_code=204)
def delete_supply(
    supply_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    supply = _get_supply(db, sid, supply_id)
    if supply.locked:
        raise HTTPException(status_code=400, detail="Este insumo é travado — não pode ser removido")
    supply.active = False
    db.commit()


# ─────────────────────────────────────────────────────────
# ENTRADAS
# ─────────────────────────────────────────────────────────

@router.post("/{supply_id}/entries", response_model=schemas.ClientSupplyOut, status_code=201)
def add_entry(
    supply_id: int,
    body: schemas.ClientSupplyEntryIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    supply = _get_supply(db, sid, supply_id)
    if body.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")
    db.add(models.ClientSupplyEntry(
        supply_id=supply.id, quantity=body.quantity, entry_date=body.entry_date,
        note=body.note.strip(), active=True,
    ))
    db.commit()
    return _to_out(db, _get_supply(db, sid, supply_id))


@router.put("/entries/{entry_id}", response_model=schemas.ClientSupplyOut)
def update_entry(
    entry_id: int,
    body: schemas.ClientSupplyEntryIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    entry = (
        db.query(models.ClientSupplyEntry)
        .join(models.ClientSupply, models.ClientSupply.id == models.ClientSupplyEntry.supply_id)
        .filter(models.ClientSupplyEntry.id == entry_id, models.ClientSupply.seller_id == sid)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada não encontrada")
    if body.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")
    entry.quantity = body.quantity
    entry.entry_date = body.entry_date
    entry.note = body.note.strip()
    db.commit()
    return _to_out(db, _get_supply(db, sid, entry.supply_id))


@router.delete("/entries/{entry_id}", response_model=schemas.ClientSupplyOut)
def delete_entry(
    entry_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    entry = (
        db.query(models.ClientSupplyEntry)
        .join(models.ClientSupply, models.ClientSupply.id == models.ClientSupplyEntry.supply_id)
        .filter(models.ClientSupplyEntry.id == entry_id, models.ClientSupply.seller_id == sid)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada não encontrada")
    entry.active = False
    supply_id = entry.supply_id
    db.commit()
    return _to_out(db, _get_supply(db, sid, supply_id))


# ─────────────────────────────────────────────────────────
# REGRAS
# ─────────────────────────────────────────────────────────

@router.post("/{supply_id}/rules", response_model=schemas.ClientSupplyOut, status_code=201)
def add_rule(
    supply_id: int,
    body: schemas.ClientSupplyRuleIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    supply = _get_supply(db, sid, supply_id)
    if supply.locked:
        raise HTTPException(status_code=400, detail="Este insumo é travado — a regra não pode ser alterada")
    if body.rule_type not in _RULE_TYPES_SELLER:
        raise HTTPException(status_code=422, detail=f"Tipo de regra inválido: {body.rule_type}")
    if body.rule_type != "PER_ORDER" and not (body.sku or "").strip():
        raise HTTPException(status_code=422, detail="Informe o SKU para esta regra")
    if body.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantidade precisa ser maior que zero")
    db.add(models.ClientSupplyRule(
        supply_id=supply.id,
        rule_type=models.SupplyRuleType(body.rule_type),
        sku=(body.sku or "").strip() or None,
        quantity=body.quantity,
        active=True,
    ))
    db.commit()
    return _to_out(db, _get_supply(db, sid, supply_id))


@router.delete("/rules/{rule_id}", response_model=schemas.ClientSupplyOut)
def delete_rule(
    rule_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sid = _seller_id_for_write(current_user)
    rule = (
        db.query(models.ClientSupplyRule)
        .join(models.ClientSupply, models.ClientSupply.id == models.ClientSupplyRule.supply_id)
        .filter(models.ClientSupplyRule.id == rule_id, models.ClientSupply.seller_id == sid)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Regra não encontrada")
    if rule.supply.locked:
        raise HTTPException(status_code=400, detail="Este insumo é travado — a regra não pode ser removida")
    rule.active = False
    supply_id = rule.supply_id
    db.commit()
    return _to_out(db, _get_supply(db, sid, supply_id))
