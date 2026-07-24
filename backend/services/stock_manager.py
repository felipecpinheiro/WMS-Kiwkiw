"""
WMS Kiwkiw - Serviço de Gestão de Estoque
Atualiza posições de estoque a partir das movimentações.
Reproduz a lógica da macro 'atualizar_estoque()'.
"""

import csv
import os
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict
from collections import defaultdict

from sqlalchemy.orm import Session
from sqlalchemy import func, text

from .. import models
from ..timezone_utils import now_brasilia, today_brasilia

# Mapa de normalização para valores legados ('IN'/'OUT') no campo movement_type
_MT_NORM = {
    "IN":     models.MovementType.IN,
    "OUT":    models.MovementType.OUT,
    "E":      models.MovementType.IN,
    "S":      models.MovementType.OUT,
    "ENTRADA":models.MovementType.IN,
    "SAÍDA":  models.MovementType.OUT,
    "SAIDA":  models.MovementType.OUT,
}


def _normalize_movement_type(raw) -> models.MovementType:
    """Converte valor de movement_type (incluindo legados 'IN'/'OUT') para enum."""
    if isinstance(raw, models.MovementType):
        return raw
    s = str(raw or "").strip().upper()
    return _MT_NORM.get(s, models.MovementType.OUT)


def calculate_stock_level(current_stock: int) -> str:
    """
    Classifica o nível de estoque.
    Baseado na lógica da planilha ESTOQUE (coluna Nível).
    """
    if current_stock > 600:
        return "ALTO"
    elif current_stock > 300:
        return "MÉDIO"
    else:
        return "BAIXO"


def update_stock_from_session(session: models.PickingSession, db: Session) -> Dict:
    """
    Atualiza o estoque a partir de uma sessão de picking concluída.
    Cria movimentos de saída para cada pedido bipado.
    """
    updated_skus = 0
    errors = []

    # Busca pedidos completos da sessão
    orders = db.query(models.Order).filter(
        models.Order.session_id == session.id,
        models.Order.status == models.OrderStatus.COMPLETED,
    ).all()

    for order in orders:
        for item in order.items:
            try:
                # Determina tipo de movimento pela natureza do pedido
                from .order_import import NATURE_TYPE_MAP
                movement_type_str = NATURE_TYPE_MAP.get(order.nature or "", "Saída")
                movement_type = (
                    models.MovementType.IN
                    if movement_type_str == "Entrada"
                    else models.MovementType.OUT
                )

                # Cria movimento de estoque
                movement = models.StockMovement(
                    seller_id=order.seller_id,
                    sku=item.sku,
                    product_name=item.product_name,
                    # Usa a data real de finalização (hoje), não a data do ERP
                    movement_date=today_brasilia(),
                    movement_type=movement_type,
                    quantity=item.quantity,
                    adjusted_quantity=item.quantity,
                    nf_number=order.nf_number,
                    nature=order.nature,
                    order_id=order.id,
                    session_id=session.id,
                )
                db.add(movement)

                # Atualiza posição de estoque
                update_stock_position(
                    seller_id=order.seller_id,
                    sku=item.sku,
                    product_name=item.product_name,
                    movement_type=movement_type,
                    quantity=item.quantity,
                    db=db,
                )
                updated_skus += 1

            except Exception as e:
                errors.append(f"Erro ao atualizar SKU {item.sku}: {str(e)}")

    # Marca checagem de estoque como concluída
    session.check_stock = True
    db.commit()

    return {
        "updated_skus": updated_skus,
        "errors": errors,
    }


def update_stock_from_order(order, db: Session) -> None:
    """
    Atualiza estoque quando um pedido individual é concluído no scanner.
    Chamado em tempo real, no momento que o último item é bipado.
    Evita duplicata: não cria movimento se já existe um para esta order_id.
    """
    # Evita dupla contagem — usa SQL raw para não crashar com enum legado
    from .. import models as _m
    existing_count = db.execute(
        text("SELECT COUNT(*) FROM stock_movements WHERE order_id = :oid"),
        {"oid": order.id},
    ).scalar()
    if existing_count:
        return

    from .order_import import NATURE_TYPE_MAP
    movement_type_str = NATURE_TYPE_MAP.get(order.nature or "", "Saída")
    movement_type = (
        _m.MovementType.IN
        if movement_type_str == "Entrada"
        else _m.MovementType.OUT
    )

    for item in order.items:
        movement = _m.StockMovement(
            seller_id=order.seller_id,
            sku=item.sku,
            product_name=item.product_name,
            # Usa a data real de conclusão/interrupção (hoje), não a data do ERP
            movement_date=today_brasilia(),
            movement_type=movement_type,
            quantity=item.quantity,
            adjusted_quantity=item.quantity,
            nf_number=order.nf_number,
            nature=order.nature,
            order_id=order.id,
            session_id=order.session_id,
        )
        db.add(movement)

        update_stock_position(
            seller_id=order.seller_id,
            sku=item.sku,
            product_name=item.product_name or item.sku,
            movement_type=movement_type,
            quantity=item.quantity,
            db=db,
        )


def update_stock_position(
    seller_id: int,
    sku: str,
    product_name: str,
    movement_type: models.MovementType,
    quantity: int,
    db: Session,
) -> models.StockPosition:
    """
    Atualiza (ou cria) a posição atual de estoque para um seller+SKU.
    """
    position = db.query(models.StockPosition).filter(
        models.StockPosition.seller_id == seller_id,
        models.StockPosition.sku == sku,
    ).first()

    if not position:
        position = models.StockPosition(
            seller_id=seller_id,
            sku=sku,
            product_name=product_name,
            initial_stock=0,
            total_in=0,
            total_out=0,
            current_stock=0,
        )
        db.add(position)
        # A sessão usa autoflush=False: sem o flush, esta posição continuaria
        # apenas na memória e a próxima chamada para o MESMO sku não a
        # encontraria na query acima — criando uma segunda posição e violando
        # a unique (seller_id, sku) no commit. Acontece sempre que um SKU tem
        # mais de uma movimentação no mesmo lote (import de histórico, ou o
        # mesmo SKU em dois pedidos da mesma sessão de bipagem).
        db.flush()

    if movement_type == models.MovementType.IN:
        position.total_in += quantity
    else:
        position.total_out += quantity

    position.current_stock = position.initial_stock + position.total_in - position.total_out
    position.level = calculate_stock_level(position.current_stock)
    position.updated_at = now_brasilia()

    if not position.product_name:
        position.product_name = product_name

    return position


def get_stock_report(seller_id: int, db: Session) -> List[Dict]:
    """
    Gera relatório de estoque para um seller.
    Retorna a visão completa de posições de estoque.
    """
    positions = db.query(models.StockPosition).filter(
        models.StockPosition.seller_id == seller_id,
    ).order_by(models.StockPosition.sku).all()

    sixty_days_ago = today_brasilia() - timedelta(days=60)

    # Pré-carrega saídas dos últimos 60 dias via SQL raw (suporta valores legados 'OUT'/'Saída')
    out_rows = db.execute(
        text("""
            SELECT sku, SUM(quantity) as total
            FROM stock_movements
            WHERE seller_id = :sid
              AND (movement_type = 'Saída' OR UPPER(movement_type) IN ('OUT','SAIDA','S'))
              AND movement_date >= :cutoff
            GROUP BY sku
        """),
        {"sid": seller_id, "cutoff": str(sixty_days_ago)},
    ).fetchall()
    out_60d_map = {r.sku: (r.total or 0) for r in out_rows}

    result = []
    for p in positions:
        # Média de saídas nos últimos 60 dias
        out_60d = out_60d_map.get(p.sku, 0)
        avg_daily = round(out_60d / 60, 2)
        days_projection = round(p.current_stock / avg_daily) if avg_daily > 0 else None

        result.append({
            "sku": p.sku,
            "product_name": p.product_name,
            "initial_stock": p.initial_stock,
            "total_in": p.total_in,
            "total_out": p.total_out,
            "current_stock": p.current_stock,
            "unit_value": p.unit_value,
            "level": p.level,
            "supply_type": p.supply_type,
            "updated_at": p.updated_at.strftime("%d/%m/%Y %H:%M") if p.updated_at else None,
            "avg_daily_sales_60d": avg_daily,
            "days_projection": days_projection,
        })
    return result


def get_sku_history(seller_id: int, sku: str, db: Session, days: int = 90) -> dict:
    """
    Retorna histórico de movimentações de um SKU para popup de análise no frontend.
    Inclui: gráfico diário de saídas/entradas, média de vendas 60d, projeção de duração.
    """
    start_date = today_brasilia() - timedelta(days=days)
    sixty_days_ago = today_brasilia() - timedelta(days=60)


    # Raw SQL para evitar falha do ORM com valores legados ('IN'/'OUT')
    rows = db.execute(
        text("""
            SELECT movement_date, movement_type, quantity
            FROM stock_movements
            WHERE seller_id = :seller_id
              AND sku = :sku
              AND movement_date >= :start_date
            ORDER BY movement_date
        """),
        {"seller_id": seller_id, "sku": sku, "start_date": str(start_date)},
    ).fetchall()

    # Converte rows para objetos simples com movement_type normalizado
    movements = [
        {
            "movement_date": date.fromisoformat(r.movement_date) if isinstance(r.movement_date, str) else r.movement_date,
            "movement_type": _normalize_movement_type(r.movement_type),
            "quantity": r.quantity,
        }
        for r in rows
    ]

    # Posição atual
    position = db.query(models.StockPosition).filter(
        models.StockPosition.seller_id == seller_id,
        models.StockPosition.sku == sku,
    ).first()
    current_stock = position.current_stock if position else 0
    product_name = position.product_name if position else sku

    # Agrega por dia
    daily_agg: Dict[str, dict] = {}
    for m in movements:
        d = m["movement_date"].strftime("%d/%m") if m["movement_date"] else "?"
        if d not in daily_agg:
            daily_agg[d] = {"date": d, "saidas": 0, "entradas": 0}
        if m["movement_type"] == models.MovementType.OUT:
            daily_agg[d]["saidas"] += m["quantity"]
        else:
            daily_agg[d]["entradas"] += m["quantity"]

    chart_data = list(daily_agg.values())

    # Métricas
    total_out_60d = sum(
        m["quantity"] for m in movements
        if m["movement_type"] == models.MovementType.OUT
        and m["movement_date"] and m["movement_date"] >= sixty_days_ago
    )
    total_in_60d = sum(
        m["quantity"] for m in movements
        if m["movement_type"] == models.MovementType.IN
        and m["movement_date"] and m["movement_date"] >= sixty_days_ago
    )
    total_sales = sum(m["quantity"] for m in movements if m["movement_type"] == models.MovementType.OUT)
    avg_daily = round(total_out_60d / 60, 2)
    days_remaining = round(current_stock / avg_daily) if avg_daily > 0 else None

    return {
        "sku": sku,
        "product_name": product_name,
        "current_stock": current_stock,
        "avg_daily_sales_60d": avg_daily,
        "total_sales_period": total_sales,
        "total_in_60d": total_in_60d,
        "days_remaining": days_remaining,
        "chart_data": chart_data,
        "period_days": days,
    }


def export_stock_to_csv(seller_id: int, db: Session, output_dir: str) -> Optional[str]:
    """
    Exporta estoque para CSV organizado por seller/data.
    """
    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_name = seller.trade_name if seller else f"seller_{seller_id}"

    today = today_brasilia()
    output_subdir = os.path.join(
        output_dir,
        seller_name.replace(" ", "_"),
        today.strftime("%Y%m%d"),
    )
    os.makedirs(output_subdir, exist_ok=True)

    output_path = os.path.join(output_subdir, "estoque.csv")
    positions = get_stock_report(seller_id, db)

    if not positions:
        return None

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(positions[0].keys()))
        writer.writeheader()
        writer.writerows(positions)

    return output_path


def export_movements_to_csv(
    seller_id: int,
    db: Session,
    output_dir: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> str:
    """
    Exporta movimentações de estoque para CSV de auditoria.
    """
    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_name = seller.trade_name if seller else f"seller_{seller_id}"

    # Raw SQL para evitar falha do ORM com valores legados ('IN'/'OUT')
    conds = ["seller_id = :seller_id"]
    params: dict = {"seller_id": seller_id}
    if start_date:
        conds.append("movement_date >= :start_date")
        params["start_date"] = str(start_date)
    if end_date:
        conds.append("movement_date <= :end_date")
        params["end_date"] = str(end_date)

    where_clause = " AND ".join(conds)
    movements = db.execute(
        text(
            "SELECT movement_date, movement_type, sku, product_name, quantity,"
            " nf_number, nature, observation, created_at"
            " FROM stock_movements"
            " WHERE " + where_clause +
            " ORDER BY movement_date, sku"
        ),
        params,
    ).fetchall()

    today = today_brasilia()
    output_subdir = os.path.join(
        output_dir,
        seller_name.replace(" ", "_"),
        today.strftime("%Y%m%d"),
    )
    os.makedirs(output_subdir, exist_ok=True)
    output_path = os.path.join(output_subdir, "movimentacoes.csv")

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Data", "Tipo", "SKU", "Produto", "Quantidade",
            "NF", "Natureza", "Observacao", "Criado em"
        ])
        for m in movements:
            raw_mt = m.movement_type or ""
            mt = _MT_NORM.get(raw_mt.upper(), models.MovementType.OUT).value
            # movement_date é string YYYY-MM-DD vindo do SQL raw
            md = m.movement_date or ""
            if md and not isinstance(md, str):
                md = md.strftime("%d/%m/%Y")
            elif md:
                try:
                    md = date.fromisoformat(md).strftime("%d/%m/%Y")
                except ValueError:
                    pass
            ca = m.created_at or ""
            if ca and not isinstance(ca, str):
                ca = ca.strftime("%d/%m/%Y %H:%M:%S")
           