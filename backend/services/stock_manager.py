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
from sqlalchemy import func, text, bindparam

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
#
# ── ÚNICA EXCEÇÃO: EXCEDENTE DE CONFERÊNCIA NA ENTRADA (17/08/2026) ─────────
# A frase "a bipagem NÃO mexe mais em estoque" tem exatamente uma exceção, e ela
# é estreita de propósito:
#
#   - só em NF de ENTRADA;
#   - só o EXCEDENTE, isto é, o que foi bipado ALÉM do que a NF previa;
#   - NUNCA a quantidade da NF, que continua baixando exclusivamente no import.
#
# Motivo: na entrada acontece de o seller mandar mais do que a NF diz, e o que
# vale para o estoque é o que chegou fisicamente. O operador registra o que
# contou; a diferença vira um movimento próprio via apply_scan_overage().
#
# ⚠️ NÃO reintroduzir baixa de estoque em process_scan além disso — nem para a
# quantidade da NF, nem em interrupt/force-complete. Ver routers/scanning.py.

# Status em que a NF não deve baixar estoque de jeito nenhum.
STOCK_BLOCKED_STATUSES = (
    models.OrderStatus.CANCELLED,
    models.OrderStatus.INACTIVE,
)


# ── CORTE DE ERA (10/08/2026) ──────────────────────────────────────────────
# `stock_applied_at` nasceu em 06/08/2026 e NÃO houve backfill. Toda NF anterior
# a isso tem a coluna vazia, inclusive as que já baixaram estoque pela regra
# antiga (na conclusão da bipagem). Sem este corte:
#
#   1. o aviso do Dashboard contava o histórico inteiro (6.703 NFs em 10/08,
#      quase todas já corretas);
#   2. pior — "resolver" uma delas (preencher transportadora, cadastrar
#      produto) chamava a baixa DE NOVO e o estoque saía duas vezes. Reproduzido
#      em teste: 90 -> 80, dois movimentos para a mesma NF.
#
# O corte é 07/08 e não 06/08 de propósito: a feature subiu em algum momento do
# dia 06 e uma NF importada antes do deploy naquele mesmo dia também é da era
# antiga. Esconder uma NF a mais só deixa de mexer no estoque; deixar uma a
# menos de fora corrompe o estoque em silêncio.
#
# ⚠️ Consequência aceita pelo dono do sistema em 10/08/2026: NF anterior ao
# corte que ficou PENDENTE de verdade (nunca bipada, nunca baixou) fica
# invisível no aviso para sempre. Foi a opção escolhida sabendo disso.
STOCK_ERA_CUTOFF = datetime(2026, 8, 7, 0, 0, 0)


def is_pre_stock_era(order) -> bool:
    """
    Esta NF é anterior à baixa-na-importação? Se for, o estoque dela já foi
    tratado pela regra antiga e ninguém deve mexer.

    ⚠️ `imported_at` ausente conta como NÃO sendo da era antiga (ou seja,
    baixa normalmente). É o caso do próprio import, onde o objeto pode ainda
    não ter o default preenchido — tratar como era antiga ali faria a
    importação parar de baixar estoque em silêncio, que é justamente o
    desastre oposto.
    """
    imported = getattr(order, "imported_at", None)
    return imported is not None and imported < STOCK_ERA_CUTOFF


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
    # ⚠️ `is_pre_stock_era` é a trava que impede a BAIXA DUPLA de NF antiga —
    # não é cosmética. A coluna sozinha não basta: NF anterior a 06/08/2026 tem
    # a coluna vazia e o estoque já baixado. Sem isso, preencher a transportadora
    # de uma nota velha subtraía o mesmo item de novo.
    candidates = [
        o for o in orders
        if o.status not in STOCK_BLOCKED_STATUSES
        and not getattr(o, "stock_applied_at", None)
        and not is_pre_stock_era(o)
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


# Marca gravada em StockMovement.observation para todo excedente de conferência.
# É por ela que order_has_scan_overage() reconhece o movimento depois — então o
# prefixo NÃO pode mudar sem migrar os registros existentes.
OVERAGE_TAG = "EXCEDENTE DE CONFERENCIA"


def apply_scan_overage(
    order,
    sku: str,
    product_name: Optional[str],
    quantity: int,
    db: Session,
    operator_id: Optional[int] = None,
    expected_qty: Optional[int] = None,
    operator_name: Optional[str] = None,
) -> models.StockPosition:
    """
    Lança no estoque o que foi bipado ALÉM do que a NF previa (só ENTRADA).

    É a única exceção à regra de que a bipagem não mexe em estoque — ver o
    cabeçalho deste arquivo antes de mexer aqui.

    `quantity` é só a DIFERENÇA deste bipe, já calculada por quem chama
    (process_scan), nunca o total bipado: chamar duas vezes com o total dobraria
    o estoque.

    O movimento nasce com o `order_id` da NF de propósito — é isso que faz o
    estorno existente recolher o excedente junto, sem código novo, já que
    reverse_stock_for_order() trabalha por SALDO LÍQUIDO por SKU do order_id.
    """
    if quantity <= 0:
        raise ValueError("apply_scan_overage exige quantidade positiva")

    movement_type = order_stock_sign(order)
    detalhe = f", NF previa {expected_qty}" if expected_qty is not None else ""
    quem = f" por {operator_name}" if operator_name else ""
    observation = (
        f"{OVERAGE_TAG} — recebido {quantity} a mais do que a NF {order.nf_number}"
        f"{detalhe}. Registrado na bipagem{quem} (contagem física)."
    )

    # ORM e não SQL puro: o SQLAlchemy grava o NOME do enum ('IN'), que é o
    # rótulo válido em produção. Gravar o .value ('Entrada') estoura
    # InvalidTextRepresentation no Postgres e aborta a transação. Ver CLAUDE.md.
    db.add(models.StockMovement(
        seller_id=order.seller_id,
        sku=sku,
        product_name=product_name or sku,
        movement_date=today_brasilia(),
        movement_type=movement_type,
        quantity=quantity,
        adjusted_quantity=quantity,
        nf_number=order.nf_number,
        nature=order.nature,
        order_id=order.id,
        session_id=order.session_id,
        operator_id=operator_id,
        observation=observation,
    ))

    # NÃO tocar em order.stock_applied_at: a NF continua baixada pelo import.
    # Isto aqui é um movimento ADICIONAL, não uma nova baixa.
    return update_stock_position(
        seller_id=order.seller_id,
        sku=sku,
        product_name=product_name or sku,
        movement_type=movement_type,
        quantity=quantity,
        db=db,
    )


def order_has_scan_overage(order_id: int, db: Session) -> bool:
    """
    Esta NF tem excedente de conferência lançado no estoque?

    Usada para BLOQUEAR a troca de file_type da NF: os endpoints de config
    estornam tudo e re-lançam apenas a quantidade da NF, o que apagaria o
    excedente do estoque em silêncio. Consulta indexada por order_id
    (ix_stock_movements_order_id, criado em 30/07/2026).
    """
    return db.execute(
        text(
            "SELECT 1 FROM stock_movements "
            "WHERE order_id = :oid AND observation LIKE :tag LIMIT 1"
        ),
        {"oid": order_id, "tag": f"{OVERAGE_TAG}%"},
    ).first() is not None


def orders_with_scan_overage(db: Session, order_ids: List[int]) -> List[int]:
    """
    Versão em lote de order_has_scan_overage — devolve os order_ids que têm
    excedente. Uma consulta só (o config de SESSÃO precisa checar a sessão
    inteira; item a item seria o N+1 que já derrubou esta base 3 vezes).
    """
    if not order_ids:
        return []
    stmt = text(
        "SELECT DISTINCT order_id FROM stock_movements "
        "WHERE order_id IN :oids AND observation LIKE :tag"
    ).bindparams(bindparam("oids", expanding=True))
    rows = db.execute(stmt, {"oids": list(order_ids), "tag": f"{OVERAGE_TAG}%"}).fetchall()
    return [r[0] for r in rows]


def orders_missing_product_skus(db: Session, order_ids: List[int]) -> Dict[int, List[str]]:
    """
    Dos pedidos informados, quais têm SKU SEM produto ativo cadastrado no
    seller — e QUAIS SKUs são. Devolve {order_id: [sku, ...]}; pedido que não
    aparece no dicionário está completo.

    Esses pedidos são impossíveis de bipar: o match da bipagem é pelo
    `barcode_seller` do produto, e sem produto não existe barcode — o operador
    levaria erro atrás de erro até desistir e interromper. Por isso ficam fora
    do manuseio até alguém cadastrar o produto (que também destrava a baixa de
    estoque, via release_pending_orders_for_sku).

    ⚠️ O critério é `(seller_id, sku)` no cadastro de produtos, NUNCA o FK
    `OrderItem.product_id`: esse FK é resolvido no import e fica NULO quando o
    produto é cadastrado depois — exatamente o caso que esta função existe pra
    tratar. Usar o FK reporta como "faltando" um SKU que já tem produto.

    UMA consulta agrupada, não uma por pedido — é chamada de tela de lista.
    """
    if not order_ids:
        return {}
    rows = db.execute(text("""
        SELECT oi.order_id, oi.sku
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
         WHERE oi.order_id IN :ids
           AND NOT EXISTS (
                 SELECT 1
                   FROM products p
                  WHERE p.seller_id = o.seller_id
                    AND p.sku = oi.sku
                    AND p.active
           )
    """).bindparams(bindparam("ids", expanding=True)), {"ids": list(order_ids)}).fetchall()

    out: Dict[int, List[str]] = {}
    for order_id, sku in rows:
        out.setdefault(order_id, [])
        if sku not in out[order_id]:
            out[order_id].append(sku)
    for skus in out.values():
        skus.sort()
    return out


def pending_orders_with_sku(db: Session, seller_id: int, sku: str) -> List:
    """
    NFs deste seller que ainda NÃO baixaram estoque e contêm este SKU.

    É o recorte que o modal de pendências mostra e o único que pode ser
    reescrito com segurança (ver relink_sku_in_pending_orders).
    """
    return db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(
        models.Order.seller_id == seller_id,
        models.Order.stock_applied_at.is_(None),
        # Corte de era direto no SQL: sem ele, cadastrar um produto varria as
        # NFs antigas que contêm aquele SKU e rebaixava todas de uma vez, em
        # silêncio — o caminho mais perigoso dos três, porque roda sozinho.
        models.Order.imported_at >= STOCK_ERA_CUTOFF,
        models.Order.status.notin_(STOCK_BLOCKED_STATUSES),
        models.Order.id.in_(
            db.query(models.OrderItem.order_id)
              .filter(models.OrderItem.sku == sku)
              .scalar_subquery()
        ),
    ).all()


def relink_sku_in_pending_orders(
    seller_id: int,
    sku: str,
    target_product,
    db: Session,
    operator_id: Optional[int] = None,
) -> Dict:
    """
    "Esse SKU da NF na verdade é este outro produto" (10/08/2026).

    Reescreve `order_items.sku` das NFs PENDENTES deste seller: o que veio como
    `sku` passa a apontar para o SKU de `target_product`. Existe porque alguns
    sellers cadastram dois SKUs quase idênticos para o mesmo item por
    divergência interna deles — a NF chega com um SKU que não existe no
    cadastro, mas o produto físico existe com outro código.

    ⚠️ SÓ toca em NF que ainda não baixou estoque. NF já baixada tem
    `stock_movements` gravados naquele SKU; reescrever o item deixaria o
    movimento órfão, apontando para um SKU que não está mais no pedido.
    `pending_orders_with_sku` já aplica esse recorte.

    ⚠️ Isto NÃO cria um de-para persistente (decisão do dono do sistema em
    10/08/2026): vale só para as NFs que estão pendentes agora. Se o mesmo SKU
    errado vier num import futuro, ele fica pendente de novo. A tabela de
    de-para (aba `ACERTO SKU` da planilha antiga) continua fora do WMS.

    Se a NF já tiver o SKU de destino nela, as quantidades são SOMADAS numa
    linha só — mesmo comportamento que o import já tem para SKU repetido.

    Devolve {"orders_touched": n, "stock": <relatório de apply_stock_for_orders>}.
    """
    old_sku = str(sku)
    new_sku = target_product.sku

    orders = pending_orders_with_sku(db, seller_id, old_sku)
    touched = 0

    if new_sku != old_sku:
        for order in orders:
            old_items = [it for it in order.items if it.sku == old_sku]
            if not old_items:
                continue

            target_item = next((it for it in order.items if it.sku == new_sku), None)
            if target_item is None:
                # Promove a primeira linha do SKU errado a linha do SKU certo.
                target_item = old_items.pop(0)
                target_item.sku = new_sku
                target_item.product_name = target_product.name or target_item.product_name
            target_item.product_id = target_product.id

            # Sobras (SKU de destino já existia na NF, ou o SKU errado aparecia
            # em mais de uma linha): soma na linha sobrevivente e descarta.
            # `cascade="all, delete-orphan"` em Order.items faz o DELETE.
            for extra in old_items:
                target_item.quantity = (target_item.quantity or 0) + (extra.quantity or 0)
                order.items.remove(extra)

            touched += 1

        # autoflush=False nesta sessão: sem o flush explícito o UPDATE/DELETE
        # dos itens só sairia depois dos INSERTs de movimento.
        db.flush()

    # A coleção em memória já reflete a reescrita, então dá para baixar direto.
    report = apply_stock_for_orders(orders, db, operator_id=operator_id) if orders else {
        "applied": [], "pending": [], "negatives": [], "missing_skus": {}
    }
    return {"orders_touched": touched, "stock": report}


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
    orders = pending_orders_with_sku(db, seller_id, sku)
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

    Devolve quantos SKUs foram estornados (0 = havia movimento mas o saldo já
    era zero — reversão legítima, sem nada a fazer).

    Devolve -1 quando NÃO existe nenhum movimento vinculado a este order_id —
    NF órfã (ex: vínculo perdido numa reconciliação de estoque a partir de
    planilha externa). Nesse caso NÃO zera stock_applied_at: não sabemos se a
    NF está ou não refletida no estoque atual, e zerar às cegas habilitaria
    uma baixa duplicada se algo tentar reaplicar estoque para ela depois.
    Quem chama deve tratar esse caso mostrando aviso para conferência manual,
    em vez de assumir que o estorno funcionou.
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

    if not rows:
        return -1

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
           