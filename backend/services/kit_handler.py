"""
WMS Kiwkiw - Serviço de Tratamento de Kits
Faz o split de SKUs de kit nos seus componentes reais.
Reproduz a lógica da planilha de tratamento de kits.
"""

from typing import List, Tuple
from sqlalchemy.orm import Session
from .. import models


def expand_kit_items(
    seller_id: int,
    sku: str,
    product_name: str,
    quantity: int,
    db: Session,
) -> List[Tuple[str, str, int, bool, str]]:
    """
    Verifica se o SKU é um kit e expande para seus componentes.

    Retorna lista de tuplas:
      (sku, product_name, quantity, is_kit_component, original_kit_sku)

    Se não for kit, retorna o próprio item sem modificação.
    """
    # Busca o kit no banco de dados
    kit = db.query(models.Kit).filter(
        models.Kit.seller_id == seller_id,
        models.Kit.kit_sku == sku,
        models.Kit.active == True,
    ).first()

    if not kit or not kit.items:
        # Não é um kit, retorna o item original
        return [(sku, product_name, quantity, False, None)]

    # É um kit: expande para os componentes, multiplicando pela quantidade do kit
    expanded = []
    for item in kit.items:
        component_name = item.component_name or item.component_sku
        expanded.append((
            item.component_sku,
            component_name,
            item.quantity * quantity,   # Multiplica pela qtd de kits
            True,                        # is_kit_component = True
            sku,                         # original_kit_sku
        ))

    return expanded


def process_order_items(
    seller_id: int,
    raw_items: List[dict],
    db: Session,
) -> List[dict]:
    """
    Processa lista de itens de pedido, expandindo kits.

    raw_items: lista de dicts com {sku, product_name, quantity}
    Retorna lista processada com kits expandidos.
    """
    processed = []

    for item in raw_items:
        expanded = expand_kit_items(
            seller_id=seller_id,
            sku=item["sku"],
            product_name=item["product_name"],
            quantity=item["quantity"],
            db=db,
        )

        for (sku, name, qty, is_kit, original_sku) in expanded:
            processed.append({
                "sku": sku,
                "product_name": name,
                "quantity": qty,
                "is_kit_component": is_kit,
                "original_kit_sku": original_sku,
            })

    return processed


def get_kit_summary(seller_id: int, db: Session) -> List[dict]:
    """Retorna resumo de todos os kits de um seller."""
    kits = db.query(models.Kit).filter(
        models.Kit.seller_id == seller_id,
        models.Kit.active == True,
    ).all()

    return [
        {
            "kit_sku": k.kit_sku,
            "kit_name": k.kit_name,
            "components": [
                {
                    "sku": i.component_sku,
                    "name": i.component_name,
                    "quantity": i.quantity,
                }
                for i in k.items
            ],
        }
        for k in kits
    ]
