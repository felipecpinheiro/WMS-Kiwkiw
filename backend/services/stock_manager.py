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

from sqlalchemy.orm import Session, joinedload
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


# ==================================================================
# BAIXA DE ESTOQUE NA IMPORTAÇÃO (06/08/2026)
# ==================================================================
# Até 06/08/2026 o estoque era sensibilizado quando o pedido era CONCLUÍDO na
# bipagem. Isso deixava o estoque do seller defasado por até ~24h (vendeu
# segunda 20h, manuseio na terça 17h) — inviável para o seller acompanhar.
#
# Agora a baixa acontece no fim da IMPORTAÇÃO, NF a NF. A bipagem NÃO mexe mais
# em estoque: virou conferência e auditoria.
#
# Uma NF só baixa se estiver liberada:
#   - transportadora preenchida
#   - todos os SKUs dela com produto ATIVO cadastrado no seller
# Sem isso ela fica pendente (stock_applied_at vazio) e baixa SOZINHA quando a
# pendência for resolvida — ver apply_stock_for_order() chamado no
# PATCH /orders/{id}/carrier e no cadastro/reativação de produto.
#
# ⚠️ O SINAL vem do file_type do pedido (configuração de NÍVEL DE ARQUIVO), e
# NÃO da natureza da NF: arquivo "Entrada" soma tudo, qualquer outro subtrai
# tudo. O NATURE_TYPE_MAP deixou de decidir sinal de movimento.

# Status em que a NF não deve baixar estoque de jeito nenhum.
STOCK_BLOCKED_STATUSES = (
    models.OrderStatus.CANCELLED,
    models.OrderStatus.INACTIVE,
)


def order_stock_sign(order) -> models.MovementType:
    """
    Sinal do movimento a partir do file_type do pedido.
    Tolerante a valor legado gravado como texto ('entrada'/'Entrada').
    """
    raw = getattr(order, "file_type", None)
    raw = raw.value if hasattr(raw, "value") else raw
    if str(raw or "").strip().lower() in ("entrada", "import", "in"):
        return models.MovementType.IN
    return models.MovementType.OUT


def order_has_stock_applied(order, db: Session) -> bool:
    """
    Esta NF está com estoque baixado neste momento?

    Cobre as duas eras sem precisar de backfill em produção:
      - a partir de 06/08/2026: a coluna stock_applied_at responde direto;
      - antes disso: não existia a coluna, a baixa acontecia na conclusão da
        bipagem — então pedido COMPLETED/INTERRUPTED daquela época está
        baixado. Confirmamos pelo movimento real (consulta indexada por
        order_id, e só no caminho de estorno — nunca em tela de lista).
    """
    if getattr(order, "stock_applied_at", None):
        return True
    if order.status not in (models.OrderStatus.COMPLETED, models.OrderStatus.INTERRUPTED):
        return False
    return db.execute(
        text("SELECT 1 FROM stock_movements WHERE order_id = :oid LIMIT 1"),
        {"oid": order.id},
    ).first() is not None


def _registered_sku_pairs(db: Session, pairs: set) -> set:
    """
    Dado um conjunto de (seller_id, sku), devolve os que TÊM produto ativo.
    Uma consulta só, com dois IN — usa o índice uq_seller_sku (mesmo padrão
    da correção do master_dashboard). Não fazer isso item a item dentro de
    laço: é o N+1 que já derrubou esta base 3 vezes.
    """
    if not pairs:
        return set()
    seller_ids = {p[0] for p in pairs}
    skus = {p[1] for p in pairs}
    rows = db.query(models.Product.seller_id, models.Product.sku).filter(
        models.Product.seller_id.in_(seller_ids),
        models.Product.sku.in_(skus),
        models.Product.active == True,  # noqa: E712
    ).all()
    return {(r[0], r[1]) for r in rows}


def evaluate_orders_for_stock(orders: List, db: Session) -> Dict[int, Dict]:
    """
    Para cada pedido, diz se ele pode baixar estoque e o que está faltando.
    Devolve {order_id: {"missing_carrier", "missing_skus", "can_apply"}}.
    """
    pairs = set()
    for o in orders:
        for it in o.items:
            pairs.add((o.seller_id, it.sku))
    registered = _registered_sku_pairs(db, pairs)

    result = {}
    for o in orders:
        missing_carrier = not (o.carrier or "").strip()
        missing_skus = sorted({
            it.sku for it in o.items
            if (o.seller_id, it.sku) not in registered
        })
        result[o.id] = {
            "missing_carrier": missing_carrier,
            "missing_skus": missing_skus,
            "can_apply": (not missing_carrier) and (not missing_skus),
        }
    return result


def _write_stock_for_order(order, db: Session, operator_id: Optional[int] = None) -> Dict:
    """
    Grava os movimentos de UMA NF e carimba stock_applied_at.
    Não valida nada — quem chama já decidiu que pode. Devolve as posições
    tocadas: {(seller_id, sku): (position, delta_assinado)}.
    """
    movement_type = order_stock_sign(order)
    signal = 1 if movement_type == models.MovementType.IN else -1
    touched = {}

    for item in order.items:
        db.add(models.StockMovement(
            seller_id=order.seller_id,
            sku=item.sku,
            product_name=item.product_name,
            # Data em que a Kiwkiw importou o arquivo — não a data da NF.
            movement_date=today_brasilia(),
            movement_type=movement_type,
            quantity=item.quantity,
            adjusted_quantity=item.quantity,
            nf_number=order.nf_number,
            nature=order.nature,
            order_id=order.id,
            session_id=order.session_id,
            operator_id=operator_id,
        ))
        position = update_stock_position(
            seller_id=order.seller_id,
            sku=item.sku,
            product_name=item.product_name or item.sku,
            movement_type=movement_type,
            quantity=item.quantity,
            db=db,
        )
        key = (order.seller_id, item.sku)
        prev_pos, prev_delta = touched.get(key, (position, 0))
        touched[key] = (position, prev_delta + signal * item.quantity)

    order.stock_applied_at = now_brasilia()
    return touched


def apply_stock_for_orders(
    orders: List,
    db: Session,
    operator_id: Optional[int] = None,
) -> Dict:
    """
    Baixa o estoque de um LOTE de NFs (usado na importação).

    Idempotente: pula quem já baixou e quem está cancelado/inativo.
    Não commita — quem chama decide. Se qualquer coisa estourar aqui, a
    exceção sobe: o import inteiro deve ser desfeito (regra do usuário).

    Devolve:
      applied       -> [order_id, ...] que baixaram agora
      pending       -> [{order_id, nf_number, seller_id, seller_name,
                         customer_name, missing_carrier, missing_skus}]
      negatives     -> [{seller_id, seller_name, sku, product_name,
                         current_stock, applied_qty, was_negative_before}]
      missing_skus  -> {(seller_id, sku)} agregado, para o modal de cadastro
    """
    candidates = [
        o for o in orders
        if o.status not in STOCK_BLOCKED_STATUSES
        and not getattr(o, "stock_applied_at", None)
    ]

    applied: List[int] = []
    pending: List[Dict] = []
    negatives: List[Dict] = []
    missing_pairs: Dict = {}

    if not candidates:
        return {"applied": applied, "pending": pending,
                "negatives": negatives, "missing_skus": missing_pairs}

    evaluation = evaluate_orders_for_stock(candidates, db)

    # Foto do estoque ANTES de aplicar, para saber quem já estava negativo.
    pairs = {
        (o.seller_id, it.sku)
        for o in candidates
        if evaluation[o.id]["can_apply"]
        for it in o.items
    }
    before = {}
    if pairs:
        seller_ids = {p[0] for p in pairs}
        skus = {p[1] for p in pairs}
        for row in db.query(
            models.StockPosition.seller_id,
            models.StockPosition.sku,
            models.StockPosition.current_stock,
        ).filter(
            models.StockPosition.seller_id.in_(seller_ids),
            models.StockPosition.sku.in_(skus),
        ).all():
            before[(row[0], row[1])] = row[2] or 0

    touched_all: Dict = {}
    for order in candidates:
        ev = evaluation[order.id]
        if not ev["can_apply"]:
            seller = getattr(order, "seller", None)
            pending.append({
                "order_id": order.id,
                "nf_number": order.nf_number,
                "seller_id": order.seller_id,
                "seller_name": seller.trade_name if seller else None,
                "customer_name": order.customer_name,
                "missing_carrier": ev["missing_carrier"],
                "missing_skus": ev["missing_skus"],
            })
            for sku in ev["missing_skus"]:
                key = (order.seller_id, sku)
                if key not in missing_pairs:
                    name = next(
                        (it.product_name for it in order.items if it.sku == sku),
                        sku,
                    )
                    missing_pairs[key] = {
                        "seller_id": order.seller_id,
                        "seller_name": seller.trade_name if seller else None,
                        "sku": sku,
                        "product_name": name,
                        "nf_numbers": [],
                    }
                if order.nf_number not in missing_pairs[key]["nf_numbers"]:
                    missing_pairs[key]["nf_numbers"].append(order.nf_number)
            continue

        touched = _write_stock_for_order(order, db, operator_id=operator_id)
        applied.append(order.id)
        for key, (position, delta) in touched.items():
            prev_pos, prev_delta = touched_all.get(key, (position, 0))
            touched_all[key] = (position, prev_delta + delta)

    # Relatório de negativos — feito DEPOIS da baixa, sobre a posição final.
    seller_names = {
        o.seller_id: (o.seller.trade_name if getattr(o, "seller", None) else None)
        for o in candidates
    }
    for (seller_id, sku), (position, delta) in touched_all.items():
        if (position.current_stock or 0) < 0:
            negatives.append({
                "seller_id": seller_id,
                "seller_name": seller_names.get(seller_id),
                "sku": sku,
                "product_name": position.product_name or sku,
                "current_stock": position.current_stock or 0,
                "applied_qty": delta,
                "was_negative_before": before.get((seller_id, sku), 0) < 0,
            })
    negatives.sort(key=lambda n: ((n["seller_name"] or ""), n["sku"]))

    return {
        "applied": applied,
        "pending": pending,
        "negatives": negatives,
        "missing_skus": missing_pairs,
    }


def apply_stock_for_order(order, db: Session, operator_id: Optional[int] = None) -> Dict:
    """
    Versão de UMA NF — usada quando a pendência é resolvida (transportadora
    preenchida, produto cadastrado). Mesmo relatório do lote.
    """
    return apply_stock_for_orders([order], db, operator_id=operator_id)


def release_pending_orders_for_sku(
    seller_id: int,
    sku: str,
    db: Session,
    operator_id: Optional[int] = None,
) -> Dict:
    """
    Destrava as NFs que estavam seguradas por falta deste SKU.

    Chamado depois de cadastrar / reativar / renomear o SKU de um produto.
    Só pega NF que ainda não baixou e que não está cancelada/inativa; a
    própria apply_stock_for_orders reavalia se ainda falta alguma coisa
    (outro SKU sem cadastro, transportadora), então NF com mais de uma
    pendência continua segura até a última ser resolvida.
    """
    orders = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(
        models.Order.seller_id == seller_id,
        models.Order.stock_applied_at.is_(None),
        models.Order.status.notin_(STOCK_BLOCKED_STATUSES),
        models.Order.id.in_(
            db.query(models.OrderItem.order_id)
              .filter(models.OrderItem.sku == sku)
              .scalar_subquery()
        ),
    ).all()
    if not orders:
        return {"applied": [], "pending": [], "negatives": [], "missing_skus": {}}
    return apply_stock_for_orders(orders, db, operator_id=operator_id)


def reverse_stock_for_order(
    order,
    db: Session,
    observation: str,
    operator_id: Optional[int] = None,
) -> int:
    """
    Estorna o estoque de UMA NF e limpa stock_applied_at.

    Trabalha pelo SALDO LÍQUIDO por SKU (soma das entradas menos as saídas de
    todos os movimentos deste order_id), criando um movimento no sentido
    oposto para zerar. Isso é correto independente de quantos ciclos de
    baixa/estorno/reativação a NF já teve, e nunca edita ou apaga o movimento
    original — os dois lados ficam auditáveis.

    Devolve quantos SKUs foram estornados (0 = não havia o que estornar).
    """
    # ⚠️ CAST(... AS TEXT) é obrigatório: em produção movement_type é um ENUM
    # NATIVO do Postgres, e comparar a coluna direto com 'Entrada' (que não é
    # rótulo válido do tipo) estoura InvalidTextRepresentation e ABORTA a
    # transação inteira. O SQLite aceitaria sem reclamar — teste local não pega.
    # Os dois formatos convivem no banco por razões históricas (ver CLAUDE.md).
    rows = db.execute(text("""
        SELECT sku,
               MAX(product_name) AS product_name,
               SUM(CASE WHEN CAST(movement_type AS TEXT) IN ('IN', 'Entrada') THEN quantity ELSE 0 END) AS total_in,
               SUM(CASE WHEN CAST(movement_type AS TEXT) IN ('IN', 'Entrada') THEN 0 ELSE quantity END) AS total_out
          FROM stock_movements
         WHERE order_id = :oid
         GROUP BY sku
    """), {"oid": order.id}).fetchall()

    reversed_count = 0
    for row in rows:
        sku = row[0]
        product_name = row[1] or sku
        net = (row[2] or 0) - (row[3] or 0)
        if net == 0:
            continue
        # net > 0 → a NF somou estoque; estorno subtrai. E vice-versa.
        reverse_type = models.MovementType.OUT if net > 0 else models.MovementType.IN
        quantity = abs(net)

        db.add(models.StockMovement(
            seller_id=order.seller_id,
            sku=sku,
            product_name=product_name,
            movement_date=today_brasilia(),
            movement_type=reverse_type,
            quantity=quantity,
            adjusted_quantity=quantity,
            nf_number=order.nf_number,
            nature=order.nature,
            order_id=order.id,
            session_id=order.session_id,
            operator_id=operator_id,
            observation=observation,
        ))
        update_stock_position(
            seller_id=order.seller_id,
            sku=sku,
            product_name=product_name,
            movement_type=reverse_type,
            quantity=quantity,
            db=db,
        )
        reversed_count += 1

    order.stock_applied_at = None
    return reversed_count


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

    # Pré-carrega saídas dos últimos 60 dias via SQL raw (suporta valores legados 'OUT'/'Saída').
    # CAST obrigatório: movement_type é ENUM nativo no PostgreSQL e comparar com
    # 'Saída' dispara InvalidTextRepresentation (o UPPER também não aceita enum).
    out_rows = db.execute(
        text("""
            SELECT sku, SUM(quantity) as total
            FROM stock_movements
            WHERE seller_id = :sid
              AND UPPER(CAST(movement_type AS VARCHAR)) IN ('OUT','S','SAIDA','SAÍDA')
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
           