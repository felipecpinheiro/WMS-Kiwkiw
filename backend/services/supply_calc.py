"""
WMS Kiwkiw - Cálculo de saldo estimado de Insumos do Cliente (13/09/2026)

Insumo = material sem código de barras que o seller manda pra Kiwkiw usar no
próprio pedido (adesivo, cartão, caixa própria...). Não dá pra bipar, então
isso NUNCA toca em stock_movements/stock_positions — é só um saldo ESTIMADO,
calculado por regra, pra informar o seller. Ver o aviso fixo na tela do Portal.

saldo_estimado = Σ entradas (quantity, sempre, indepentende de data) -
                  Σ consumo estimado (pedidos de saída, a partir de
                  `count_from_date` do insumo, aplicando cada regra ativa).
"""

from datetime import date as _date

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models


def _saida_query(db: Session, seller_id: int, count_from_date):
    """Pedidos de saída não cancelados do seller, a partir da data."""
    return db.query(models.Order).filter(
        models.Order.seller_id == seller_id,
        models.Order.status != models.OrderStatus.CANCELLED,
        or_(models.Order.file_type.is_(None),
            models.Order.file_type != models.FileType.IMPORT),
        models.Order.imported_at >= count_from_date,
    )


_RULE_DESC = {
    models.SupplyRuleType.PER_ORDER: lambda r: "todo pedido",
    models.SupplyRuleType.BOX_OCCURRENCE: lambda r: f'caixa "{r.box_key}"',
    models.SupplyRuleType.SKU_OCCURRENCE: lambda r: f'SKU "{r.sku}" no pedido',
    models.SupplyRuleType.SKU_QUANTITY: lambda r: f'SKU "{r.sku}" (por unidade)',
}


def _consumo_rows_regra(db: Session, seller_id: int, rule: models.ClientSupplyRule, count_from_date) -> list[dict]:
    """
    Uma linha por PEDIDO que a regra alcançou, com a quantidade consumida
    naquele pedido — é o que alimenta tanto o total agregado (compute_balance)
    quanto o extrato detalhado (list_movements). Única fonte de verdade: os
    dois nunca podem divergir.

    ⚠️ PER_ORDER e BOX_OCCURRENCE geram 1 linha por pedido de saída do período
    inteiro — pode ser bastante linha num seller de alto volume. Aceito por
    ora (mesma decisão de "não paginar por enquanto" do Portal/Movimentações);
    se um seller reclamar de lentidão aqui, é o primeiro lugar a olhar.
    """
    base = _saida_query(db, seller_id, count_from_date)
    cols = (models.Order.id, models.Order.nf_number, models.Order.order_date, models.Order.imported_at)
    desc = _RULE_DESC[rule.rule_type](rule)

    if rule.rule_type == models.SupplyRuleType.PER_ORDER:
        rows = base.with_entities(*cols).all()
        qty = int(rule.quantity or 0)
        return [{"order_id": r[0], "nf_number": r[1], "order_date": r[2], "imported_at": r[3],
                  "quantity": qty, "rule_desc": desc} for r in rows]

    if rule.rule_type == models.SupplyRuleType.BOX_OCCURRENCE:
        # normaliza_box não é aplicado aqui de propósito: desde que a caixa só
        # é escolhida pelos botões canônicos, box_used já grava a chave exata.
        rows = base.filter(models.Order.box_used == rule.box_key).with_entities(*cols).all()
        qty = int(rule.quantity or 0)
        return [{"order_id": r[0], "nf_number": r[1], "order_date": r[2], "imported_at": r[3],
                  "quantity": qty, "rule_desc": desc} for r in rows]

    if not rule.sku:
        return []

    if rule.rule_type == models.SupplyRuleType.SKU_OCCURRENCE:
        rows = (
            base.join(models.OrderItem, models.OrderItem.order_id == models.Order.id)
            .filter(models.OrderItem.sku == rule.sku)
            .with_entities(*cols)
            .distinct()
            .all()
        )
        qty = int(rule.quantity or 0)
        return [{"order_id": r[0], "nf_number": r[1], "order_date": r[2], "imported_at": r[3],
                  "quantity": qty, "rule_desc": desc} for r in rows]

    if rule.rule_type == models.SupplyRuleType.SKU_QUANTITY:
        rows = (
            base.join(models.OrderItem, models.OrderItem.order_id == models.Order.id)
            .filter(models.OrderItem.sku == rule.sku)
            .with_entities(*cols, func.sum(models.OrderItem.quantity))
            .group_by(*cols)
            .all()
        )
        mult = int(rule.quantity or 0)
        return [{"order_id": r[0], "nf_number": r[1], "order_date": r[2], "imported_at": r[3],
                  "quantity": int(r[4] or 0) * mult, "rule_desc": desc} for r in rows]

    return []


def compute_balance(db: Session, supply: models.ClientSupply) -> dict:
    """{total_entradas, consumo_estimado, saldo_estimado} de um insumo."""
    total_entradas = sum(
        e.quantity for e in supply.entries if e.active
    )
    consumo = sum(
        row["quantity"]
        for r in supply.rules if r.active
        for row in _consumo_rows_regra(db, supply.seller_id, r, supply.count_from_date)
    )
    return {
        "total_entradas": total_entradas,
        "consumo_estimado": consumo,
        "saldo_estimado": total_entradas - consumo,
    }


def list_movements(db: Session, seller_id: int) -> list[dict]:
    """
    Extrato combinado de TODOS os insumos do seller: entradas + consumo
    estimado por pedido. Alimenta a sub-aba "Movimentos" — mesmo espírito da
    Movimentações de Estoque, mas isto NUNCA é `stock_movements`.
    """
    supplies = (
        db.query(models.ClientSupply)
        .filter(models.ClientSupply.seller_id == seller_id, models.ClientSupply.active == True)  # noqa: E712
        .all()
    )
    out: list[dict] = []
    for s in supplies:
        for e in s.entries:
            if not e.active:
                continue
            out.append({
                "movement_date": e.entry_date, "type": "entrada", "supply_id": s.id, "supply_name": s.name,
                "quantity": e.quantity, "note": e.note or None, "nf_number": None, "rule_desc": None,
            })
        for r in s.rules:
            if not r.active:
                continue
            for row in _consumo_rows_regra(db, seller_id, r, s.count_from_date):
                out.append({
                    "movement_date": row["order_date"] or (row["imported_at"].date() if row["imported_at"] else None),
                    "type": "consumo", "supply_id": s.id, "supply_name": s.name,
                    "quantity": row["quantity"], "note": None,
                    "nf_number": row["nf_number"], "rule_desc": row["rule_desc"],
                })
    out.sort(key=lambda m: m["movement_date"] or _date.min, reverse=True)
    return out


# ── caixas próprias travadas ─────────────────────────────────────────────────

from .billing_calc import PROPRIO_BOXES  # noqa: E402


def ensure_locked_box_supplies(db: Session, seller_id: int, today) -> None:
    """
    Garante que o seller tenha os 4 insumos travados de caixa própria.
    Idempotente — chamada sempre que a aba Insumos é aberta. Nunca sobrescreve
    o que já existe (o seller pode ter mudado a data de início dele).
    """
    existentes = {
        s.box_key for s in db.query(models.ClientSupply).filter(
            models.ClientSupply.seller_id == seller_id,
            models.ClientSupply.locked == True,  # noqa: E712
        ).all()
    }
    faltando = [b for b in PROPRIO_BOXES if b not in existentes]
    if not faltando:
        return
    for box_key in faltando:
        supply = models.ClientSupply(
            seller_id=seller_id,
            name=box_key,
            count_from_date=today,
            locked=True,
            box_key=box_key,
            active=True,
        )
        db.add(supply)
        db.flush()
        db.add(models.ClientSupplyRule(
            supply_id=supply.id,
            rule_type=models.SupplyRuleType.BOX_OCCURRENCE,
            box_key=box_key,
            quantity=1,
            active=True,
        ))
    db.commit()
