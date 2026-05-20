"""
WMS Kiwkiw - Router de Faturamento
Configurações de cobrança por seller e relatórios de faturamento.
"""

from typing import Optional, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user, require_master_or_above, require_admin
from .. import models, schemas

router = APIRouter(prefix="/billing", tags=["Faturamento"])


@router.get("/config/{seller_id}", response_model=List[schemas.BillingConfigResponse])
def get_billing_config(
    seller_id: int,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """Retorna configurações de cobrança de um seller."""
    return db.query(models.BillingConfig).filter(
        models.BillingConfig.seller_id == seller_id
    ).all()


@router.post("/config", response_model=schemas.BillingConfigResponse)
def upsert_billing_config(
    config: schemas.BillingConfigCreate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Cria ou atualiza configuração de cobrança (upsert por seller+chave)."""
    existing = db.query(models.BillingConfig).filter(
        models.BillingConfig.seller_id == config.seller_id,
        models.BillingConfig.config_key == config.config_key,
    ).first()

    if existing:
        existing.config_value = config.config_value
        existing.valid_from = config.valid_from
        existing.valid_to = config.valid_to
        db.commit()
        db.refresh(existing)
        return existing

    c = models.BillingConfig(**config.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("/report/{seller_id}")
def billing_report(
    seller_id: int,
    date_from: date = Query(...),
    date_to: date = Query(...),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Gera relatório de faturamento para um seller em um período.
    Calcula manuseio, caixas, seguro e armazenagem.
    """
    # Busca configurações de cobrança
    configs = db.query(models.BillingConfig).filter(
        models.BillingConfig.seller_id == seller_id
    ).all()
    config_dict = {c.config_key: c.config_value for c in configs}

    # Busca pedidos do período
    orders = db.query(models.Order).filter(
        models.Order.seller_id == seller_id,
        models.Order.order_date >= date_from,
        models.Order.order_date <= date_to,
        models.Order.for_billing == True,
        models.Order.status == "completed",
    ).all()

    total_orders = len(orders)
    unit_price = float(config_dict.get("Preço Unitário", 0))
    franchise = int(config_dict.get("Franquia", 1))
    franchise_qty = int(config_dict.get("Número Mínimo de Pedidos", 0))
    handling = float(config_dict.get("Manuseio", 0))
    storage = float(config_dict.get("Armazenagem", 0) if config_dict.get("Armazenagem Incluso", "0") != "0" else 0)

    # Calcula faturamento
    base = total_orders * unit_price
    franchise_value = 0
    if franchise and total_orders > franchise_qty:
        excess = total_orders - franchise_qty
        additional_price = float(config_dict.get("Preço Adicional", 0))
        franchise_value = excess * additional_price

    total = base + franchise_value + storage

    return {
        "seller_id": seller_id,
        "period_from": date_from.strftime("%d/%m/%Y"),
        "period_to": date_to.strftime("%d/%m/%Y"),
        "total_orders": total_orders,
        "unit_price": unit_price,
        "base_value": round(base, 2),
        "franchise_value": round(franchise_value, 2),
        "storage": round(storage, 2),
        "total": round(total, 2),
        "config": config_dict,
        "orders": [
            {
                "nf": o.nf_number,
                "customer": o.customer_name,
                "date": o.order_date.strftime("%d/%m/%Y"),
                "items": len(o.items),
            }
            for o in orders[:100]  # limita para não sobrecarregar
        ],
    }
