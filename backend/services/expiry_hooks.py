"""
WMS Kiwkiw - Pontos de integração do Controle de Vencimentos (03/11/2026).

Este módulo é a cola entre a camada de vencimentos (NOVA) e os fluxos antigos
(inbound, bipagem, estoque). Ele mantém `routers/scanning.py` e
`services/stock_manager.py` sem conhecer a feature — eles chamam o hook; o
hook decide o que fazer.

Regras invioláveis:
  * NUNCA escreve em stock_movements / stock_positions.
  * Falha aqui NUNCA pode derrubar o fluxo chamador — todo hook se encapsula
    em try/except e registra em AuditLog como "EXPIRY_HOOK_ERROR".

A Fase 2 só define `attach_from_schedule` e `activate_a_chegar` (+ o par de
limpeza em cancelamento). O FEFO e o estorno entram na Fase 3.
"""

from __future__ import annotations

import json
import traceback
from datetime import date
from typing import List, Optional, Sequence

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .. import models
from ..timezone_utils import now_brasilia
from . import expiry_calc


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _audit(db: Session, *, entity_type: str, entity_id: Optional[int], action: str,
           detail: Optional[dict] = None, user_id: Optional[int] = None) -> None:
    db.add(models.AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        detail=json.dumps(detail, ensure_ascii=False, default=str) if detail else None,
        user_id=user_id,
        timestamp=now_brasilia(),
    ))


def _is_discontinued(db: Session, seller_id: int, sku: str) -> bool:
    return db.query(models.DiscontinuedSku.id).filter(
        models.DiscontinuedSku.seller_id == seller_id,
        models.DiscontinuedSku.sku == sku,
    ).first() is not None


def _active_product(db: Session, seller_id: int, sku: str) -> Optional[models.Product]:
    return db.query(models.Product).filter(
        models.Product.seller_id == seller_id,
        models.Product.sku == sku,
        models.Product.active == True,  # noqa: E712
    ).first()


# ──────────────────────────────────────────────────────────────────────
# 1) Agendamento de Inbound — cadastro de "a chegar"
# ──────────────────────────────────────────────────────────────────────

class ExpiryAttachError(ValueError):
    """Erro de validação ao gravar vencimentos de uma NF agendada."""


def check_lot_date(
    db: Session, *, seller_id: int, sku: str, lot_name: Optional[str],
    expiry_date: date, exclude_ids: Sequence[int] = (),
) -> Optional[str]:
    """
    Regra do lote (09/11/2026): o mesmo lote do mesmo SKU tem SEMPRE o mesmo
    vencimento. Devolve a mensagem de erro, ou None se estiver tudo certo.
    Compara o nome ignorando maiúscula/minúscula; só linhas ativas contam
    (a_chegar e ativo). Sem lote -> nada a checar.
    """
    if not lot_name:
        return None
    q = db.query(models.ExpiryLine.expiry_date).filter(
        models.ExpiryLine.seller_id == seller_id,
        models.ExpiryLine.sku == sku,
        models.ExpiryLine.active == True,  # noqa: E712
        func.lower(models.ExpiryLine.lot_name) == lot_name.lower(),
        models.ExpiryLine.expiry_date != expiry_date,
    )
    if exclude_ids:
        q = q.filter(models.ExpiryLine.id.notin_(list(exclude_ids)))
    other = q.first()
    if other is None:
        return None
    return (
        f"O lote {lot_name!r} do SKU {sku} já existe com vencimento "
        f"{other[0].strftime('%d/%m/%Y')} — o mesmo lote precisa ter sempre o mesmo vencimento"
    )


def attach_from_schedule(
    db: Session,
    *,
    seller_id: int,
    nf: models.InboundNf,
    xml_items: Sequence[dict],       # [{"sku","quantity","tracks":[...]}, ...]
    items_payload: Sequence[dict],   # [{"sku","expiry_date_text","quantity"}, ...]
    user_id: Optional[int],
) -> List[models.ExpiryLine]:
    """
    Grava `ExpiryLine` com `state='a_chegar'` para a NF `nf`. Revalida tudo:
      * SKU com produto ativo (nunca criar produto por aqui)
      * SKU não descontinuado
      * data parseável (dd/mm/aaaa ou mm/aaaa)
      * qty > 0
      * Σ por SKU ≤ quantidade do mesmo SKU no XML

    Lança `ExpiryAttachError` com mensagem agregada se qualquer coisa falhar —
    e nada é gravado (o commit é responsabilidade do chamador).

    Idempotente por lote: se já existem linhas `a_chegar` para esta NF, apaga
    primeiro (soft-delete) e grava as novas. Útil para o PUT de edição.
    """
    xml_totals: dict[str, int] = {}
    for it in xml_items:
        sku = (it.get("sku") or "").strip()
        xml_totals[sku] = xml_totals.get(sku, 0) + int(it.get("quantity") or 0)

    # Linhas "a chegar" desta NF que este PUT vai substituir (ficam fora da
    # checagem de lote x data — serão apagadas logo abaixo).
    anteriores = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.origin_inbound_nf_id == nf.id,
        models.ExpiryLine.state == "a_chegar",
        models.ExpiryLine.active == True,  # noqa: E712
    ).all()
    anteriores_ids = [ln.id for ln in anteriores]

    # 1. Parse + validações por linha
    errs: list[str] = []
    somas: dict[str, int] = {}
    linhas_prontas: list[tuple[str, date, int, Optional[str]]] = []
    lote_datas: dict[tuple[str, str], date] = {}   # (sku, lote.lower()) -> data no próprio lote enviado

    for i, raw in enumerate(items_payload, start=1):
        sku = (raw.get("sku") or "").strip()
        if not sku:
            errs.append(f"Linha {i}: SKU vazio")
            continue
        if sku not in xml_totals:
            errs.append(f"Linha {i}: SKU {sku!r} não existe na NF")
            continue
        if _active_product(db, seller_id, sku) is None:
            errs.append(f"Linha {i}: SKU {sku!r} sem produto ativo")
            continue
        if _is_discontinued(db, seller_id, sku):
            errs.append(f"Linha {i}: SKU {sku!r} está descontinuado")
            continue
        try:
            parsed = expiry_calc.parse_expiry_date(raw.get("expiry_date_text") or "")
        except ValueError as exc:
            errs.append(f"Linha {i} ({sku}): {exc}")
            continue
        try:
            qty = int(raw.get("quantity") or 0)
        except (TypeError, ValueError):
            errs.append(f"Linha {i} ({sku}): quantidade inválida")
            continue
        if qty <= 0:
            errs.append(f"Linha {i} ({sku}): quantidade precisa ser > 0")
            continue
        try:
            lote = expiry_calc.normalize_lot(raw.get("lot_name"))
        except ValueError as exc:
            errs.append(f"Linha {i} ({sku}): {exc}")
            continue
        if lote:
            key = (sku, lote.lower())
            prev = lote_datas.get(key)
            if prev is not None and prev != parsed:
                errs.append(
                    f"Linha {i} ({sku}): o lote {lote!r} aparece com vencimentos diferentes "
                    f"({prev.strftime('%d/%m/%Y')} e {parsed.strftime('%d/%m/%Y')})"
                )
                continue
            lote_datas[key] = parsed
            conflito = check_lot_date(
                db, seller_id=seller_id, sku=sku, lot_name=lote,
                expiry_date=parsed, exclude_ids=anteriores_ids,
            )
            if conflito:
                errs.append(f"Linha {i} ({sku}): {conflito}")
                continue

        somas[sku] = somas.get(sku, 0) + qty
        linhas_prontas.append((sku, parsed, qty, lote))

    for sku, soma in somas.items():
        if soma > xml_totals.get(sku, 0):
            errs.append(
                f"SKU {sku}: soma dos vencimentos ({soma}) maior que a quantidade da NF "
                f"({xml_totals.get(sku, 0)})"
            )

    if errs:
        raise ExpiryAttachError("; ".join(errs))

    # 2. Apaga "a chegar" existentes dessa NF (idempotência do PUT)
    for ln in anteriores:
        ln.active = False
        _audit(db, entity_type="ExpiryLine", entity_id=ln.id,
               action="REPLACE_FROM_SCHEDULE",
               detail={"nf_id": nf.id, "sku": ln.sku, "qty": int(ln.qty_atual)},
               user_id=user_id)

    # 3. Grava
    criadas: list[models.ExpiryLine] = []
    for sku, parsed, qty, lote in linhas_prontas:
        prod = _active_product(db, seller_id, sku)
        line = models.ExpiryLine(
            seller_id=seller_id,
            product_id=prod.id if prod else None,
            sku=sku,
            expiry_date=parsed,
            lot_name=lote,
            qty_inicial=qty,
            qty_atual=qty,
            state="a_chegar",
            origin_type="inbound",
            origin_inbound_nf_id=nf.id,
            origin_nf_number=nf.nf_number,
            active=True,
            created_by_id=user_id,
        )
        db.add(line)
        criadas.append(line)
    db.flush()
    for line in criadas:
        _audit(db, entity_type="ExpiryLine", entity_id=line.id,
               action="CREATE_FROM_SCHEDULE",
               detail={"nf_id": nf.id, "sku": line.sku,
                       "qty": int(line.qty_atual),
                       "expiry_date": str(line.expiry_date),
                       "lot_name": line.lot_name},
               user_id=user_id)
    return criadas


def discard_a_chegar_from_nf(db: Session, *, nf_id: int, user_id: Optional[int]) -> int:
    """
    Chamado quando o seller cancela o agendamento ou remove a NF. Soft-delete
    nas linhas `a_chegar`. Linha já `ativo` (a NF foi conferida antes) NÃO é
    tocada — aquele vencimento já virou real.

    Nunca lança; devolve a contagem apagada. Encapsulado com try/except porque
    é hook — nunca pode derrubar o cancelamento do agendamento.
    """
    try:
        lines = db.query(models.ExpiryLine).filter(
            models.ExpiryLine.origin_inbound_nf_id == nf_id,
            models.ExpiryLine.state == "a_chegar",
            models.ExpiryLine.active == True,  # noqa: E712
        ).all()
        count = 0
        for ln in lines:
            ln.active = False
            _audit(db, entity_type="ExpiryLine", entity_id=ln.id,
                   action="CANCEL_FROM_SCHEDULE",
                   detail={"nf_id": nf_id, "sku": ln.sku,
                           "qty": int(ln.qty_atual)},
                   user_id=user_id)
            count += 1
        return count
    except Exception as exc:
        _audit(db, entity_type="ExpiryHook", entity_id=nf_id,
               action="DISCARD_A_CHEGAR_ERROR",
               detail={"nf_id": nf_id, "error": repr(exc),
                       "traceback": traceback.format_exc(limit=4)},
               user_id=user_id)
        return 0


# ──────────────────────────────────────────────────────────────────────
# 2) Finalização da entrada — ativação dos "a chegar"
# ──────────────────────────────────────────────────────────────────────

def activate_a_chegar(db: Session, *, order: models.Order, user_id: Optional[int]) -> int:
    """
    Chamado DEPOIS de `apply_stock_for_entry` no `finalize_entry_order`.
    Vira `state` de todas as linhas `a_chegar` associadas à `InboundNf` deste
    `order` para `ativo`.

    Encapsulado com try/except: a camada de vencimentos NUNCA pode fazer o
    operador refazer a conferência. Falha aqui vira AuditLog e segue.
    Retorna a contagem ativada (0 se não há InboundNf ou nada a ativar).
    """
    try:
        if not order.inbound_appointment_id:
            return 0
        nf = db.query(models.InboundNf).filter(
            models.InboundNf.order_id == order.id,
            models.InboundNf.active == True,  # noqa: E712
        ).first()
        if nf is None:
            return 0
        lines = db.query(models.ExpiryLine).filter(
            models.ExpiryLine.origin_inbound_nf_id == nf.id,
            models.ExpiryLine.state == "a_chegar",
            models.ExpiryLine.active == True,  # noqa: E712
        ).all()
        if not lines:
            return 0
        for ln in lines:
            ln.state = "ativo"
        db.flush()
        _audit(db, entity_type="ExpiryHook", entity_id=order.id,
               action="ACTIVATE_A_CHEGAR",
               detail={"nf_id": nf.id, "count": len(lines)},
               user_id=user_id)
        return len(lines)
    except Exception as exc:
        _audit(db, entity_type="ExpiryHook", entity_id=order.id,
               action="ACTIVATE_A_CHEGAR_ERROR",
               detail={"order_id": order.id, "error": repr(exc),
                       "traceback": traceback.format_exc(limit=4)},
               user_id=user_id)
        return 0


# ──────────────────────────────────────────────────────────────────────
# 3) Conferência da entrada — leitura para o Finalizar
# ──────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# 4) FEFO na baixa de saída (Fase 3, 03/11/2026)
# ──────────────────────────────────────────────────────────────────────
# Cada chamada é encapsulada em SAVEPOINT próprio (db.begin_nested()). Falha
# aqui NUNCA pode derrubar o import nem reverter stock_movements/stock_positions.
# A ordem canônica de lock é (seller_id, sku, expiry_date, id) — a mesma do
# estorno — para evitar deadlock entre import e estorno concorrentes.

def _is_saida_order(order) -> bool:
    """Entrada não entra no FEFO (vencimentos já cadastrados no agendamento)."""
    ft = getattr(order, "file_type", None)
    ft_val = ft.value if hasattr(ft, "value") else ft
    # file_type NULLABLE: NULL = default EXPORT (saída). IMPORT = entrada.
    return ft_val is None or str(ft_val).lower() not in ("entrada", "import")


def _reserved_qty_by_line(db: Session, line_ids: list[int]) -> dict[int, int]:
    """Σ pedidos de descarte/retirada `solicitado` por `expiry_line_id`."""
    if not line_ids:
        return {}
    from sqlalchemy import func
    rows = db.query(
        models.ExpiryDisposal.expiry_line_id,
        func.coalesce(func.sum(models.ExpiryDisposal.qty), 0),
    ).filter(
        models.ExpiryDisposal.status == "solicitado",
        models.ExpiryDisposal.expiry_line_id.in_(line_ids),
    ).group_by(models.ExpiryDisposal.expiry_line_id).all()
    return {int(lid): int(q or 0) for lid, q in rows}


def _already_allocated_for_order(db: Session, order_id: int) -> bool:
    return db.query(models.ExpiryAllocation.id).filter(
        models.ExpiryAllocation.order_id == order_id,
        models.ExpiryAllocation.reversed_at.is_(None),
    ).first() is not None


def _upsert_vencido_notice(db: Session, *, seller_id: int, sku: str,
                           expiry_date: date, order_id: int,
                           quantity: int, user_id: Optional[int],
                           lot_name: Optional[str] = None) -> None:
    """Dedupe por (type, seller, sku, expiry_date) enquanto não resolvido."""
    existing = db.query(models.ExpiryNotice).filter(
        models.ExpiryNotice.type == "vencido_enviado",
        models.ExpiryNotice.seller_id == seller_id,
        models.ExpiryNotice.sku == sku,
        models.ExpiryNotice.expiry_date == expiry_date,
        models.ExpiryNotice.resolved_at.is_(None),
    ).first()
    payload = json.dumps({
        "order_id": order_id,
        "quantity": int(quantity),
        "lot_name": lot_name,
    }, ensure_ascii=False, default=str)
    if existing:
        existing.payload = payload
        existing.order_id = order_id
    else:
        db.add(models.ExpiryNotice(
            type="vencido_enviado",
            seller_id=seller_id,
            sku=sku,
            expiry_date=expiry_date,
            order_id=order_id,
            payload=payload,
        ))


def allocate_fefo_for_order(
    db: Session, *, order, operator_id: Optional[int], today: Optional[date] = None,
) -> int:
    """
    FEFO para UMA NF de saída. Isolado em savepoint — falha nunca derruba o
    estoque. Retorna o número de alocações criadas (0 se não há vencimentos
    ou se nada se aplica).
    """
    if not _is_saida_order(order):
        return 0
    if _already_allocated_for_order(db, order.id):
        return 0

    today = today or now_brasilia().date()
    allocations_criadas = 0

    savepoint = db.begin_nested()
    try:
        # qty esperada por SKU (consolida kit + linha avulsa com mesmo SKU)
        qty_por_sku: dict[str, int] = {}
        for it in order.items:
            qty_por_sku[it.sku] = qty_por_sku.get(it.sku, 0) + int(it.quantity or 0)

        skus = sorted(qty_por_sku.keys())
        if not skus:
            savepoint.commit()
            return 0

        # Lock + leitura das linhas ativas do seller/SKUs em ordem canônica.
        lines = db.query(models.ExpiryLine).filter(
            models.ExpiryLine.seller_id == order.seller_id,
            models.ExpiryLine.sku.in_(skus),
            models.ExpiryLine.state == "ativo",
            models.ExpiryLine.active == True,  # noqa: E712
            models.ExpiryLine.qty_atual > 0,
        ).order_by(
            models.ExpiryLine.seller_id.asc(),
            models.ExpiryLine.sku.asc(),
            models.ExpiryLine.expiry_date.asc(),
            models.ExpiryLine.id.asc(),
        ).with_for_update().all()

        reserved = _reserved_qty_by_line(db, [l.id for l in lines])

        lines_by_sku: dict[str, list[expiry_calc.LineView]] = {}
        line_by_id: dict[int, models.ExpiryLine] = {}
        for ln in lines:
            disp = int(ln.qty_atual) - int(reserved.get(ln.id, 0))
            if disp <= 0:
                continue
            lines_by_sku.setdefault(ln.sku, []).append(expiry_calc.LineView(
                id=ln.id, expiry_date=ln.expiry_date, qty_disponivel=disp,
            ))
            line_by_id[ln.id] = ln

        for sku in skus:
            needed = qty_por_sku[sku]
            if needed <= 0:
                continue
            views = lines_by_sku.get(sku, [])
            if not views:
                continue
            allocs = expiry_calc.fefo_allocate(views, needed, today)
            for alloc in allocs:
                ln = line_by_id[alloc.line_id]
                res = db.execute(
                    text("""UPDATE expiry_lines
                              SET qty_atual = qty_atual - :q,
                                  active = CASE WHEN qty_atual - :q <= 0 THEN :inactive ELSE active END
                            WHERE id = :id AND qty_atual >= :q"""),
                    {"q": int(alloc.quantity), "id": int(ln.id), "inactive": False},
                )
                if (res.rowcount or 0) != 1:
                    # Linha mudou entre o SELECT e o UPDATE — raríssimo (temos FOR
                    # UPDATE), mas se ocorrer sob SQLite ou algum caminho sem lock,
                    # abortar o savepoint é mais seguro que subalocar.
                    raise RuntimeError(
                        f"FEFO: UPDATE atômico não aplicou (line_id={ln.id}, q={alloc.quantity})"
                    )

                db.add(models.ExpiryAllocation(
                    order_id=order.id,
                    expiry_line_id=ln.id,
                    seller_id=order.seller_id,
                    sku=sku,
                    quantity=int(alloc.quantity),
                    data_copiada=alloc.expiry_date,
                    lot_copiado=ln.lot_name,
                    vencido_na_alocacao=bool(alloc.vencido),
                ))
                allocations_criadas += 1
                if alloc.vencido:
                    _upsert_vencido_notice(
                        db, seller_id=order.seller_id, sku=sku,
                        expiry_date=alloc.expiry_date, order_id=order.id,
                        quantity=int(alloc.quantity), user_id=operator_id,
                        lot_name=ln.lot_name,
                    )

        db.flush()
        if allocations_criadas:
            _audit(db, entity_type="ExpiryHook", entity_id=order.id,
                   action="FEFO_ALLOCATE",
                   detail={"order_id": order.id, "allocations": allocations_criadas},
                   user_id=operator_id)
        savepoint.commit()
        return allocations_criadas

    except Exception as exc:
        try:
            savepoint.rollback()
        except Exception:
            pass
        _audit(db, entity_type="ExpiryHook", entity_id=order.id,
               action="FEFO_ALLOCATE_ERROR",
               detail={"order_id": order.id, "error": repr(exc),
                       "traceback": traceback.format_exc(limit=4)},
               user_id=operator_id)
        return 0


def allocate_fefo_for_orders(
    db: Session, *, orders: Sequence, operator_id: Optional[int],
) -> int:
    """
    Versão em lote (import). Cada order roda em savepoint próprio dentro de
    `allocate_fefo_for_order` — falha de um não contamina os outros.
    """
    total = 0
    for order in orders:
        total += allocate_fefo_for_order(db, order=order, operator_id=operator_id)
    return total


def reverse_fefo_for_order(
    db: Session, *, order, operator_id: Optional[int],
) -> int:
    """
    Devolve as quantidades às linhas originais, usando `data_copiada`. Se a
    linha de origem foi apagada ou editada para outra data, **recria** uma
    linha nova com `expiry_date = data_copiada` (item 19 do prompt).

    Encapsulado em savepoint. Retorna o número de reversões aplicadas.
    """
    savepoint = db.begin_nested()
    try:
        rows = db.query(models.ExpiryAllocation).filter(
            models.ExpiryAllocation.order_id == order.id,
            models.ExpiryAllocation.reversed_at.is_(None),
        ).all()
        if not rows:
            savepoint.commit()
            return 0

        # soma por (expiry_line_id, data_copiada) via função pura
        alloc_rows = [
            expiry_calc.AllocRow(
                expiry_line_id=r.expiry_line_id,
                data_copiada=r.data_copiada,
                quantity=int(r.quantity or 0),
            )
            for r in rows
        ]
        reversals = expiry_calc.reverse_allocations(alloc_rows)

        # pre-carrega linhas que existem (ordem canônica + FOR UPDATE)
        line_ids = sorted({r.expiry_line_id for r in reversals if r.expiry_line_id})
        existing: dict[int, models.ExpiryLine] = {}
        if line_ids:
            lines = db.query(models.ExpiryLine).filter(
                models.ExpiryLine.id.in_(line_ids),
            ).order_by(
                models.ExpiryLine.seller_id.asc(),
                models.ExpiryLine.sku.asc(),
                models.ExpiryLine.expiry_date.asc(),
                models.ExpiryLine.id.asc(),
            ).with_for_update().all()
            existing = {ln.id: ln for ln in lines}

        # Para recriação quando a linha original foi apagada: precisamos de um
        # sku (vem da alocação) e seller_id (vem do order).
        rev_count = 0
        for rev in reversals:
            # Encontra o SKU (e o lote copiado) correspondente a este reversal
            sku = None
            lote_rev = None
            for r in rows:
                if r.expiry_line_id == rev.expiry_line_id and r.data_copiada == rev.data_copiada:
                    sku = r.sku
                    lote_rev = r.lot_copiado
                    break
            if sku is None:
                continue

            ln = existing.get(rev.expiry_line_id) if rev.expiry_line_id else None
            if ln is not None and ln.active and ln.expiry_date == rev.data_copiada:
                # Devolve direto à linha original, atômico
                db.execute(
                    text("UPDATE expiry_lines SET qty_atual = qty_atual + :d WHERE id = :id"),
                    {"d": int(rev.delta), "id": int(ln.id)},
                )
            else:
                # Linha apagada / data editada: cria linha nova com data copiada
                prod = _active_product(db, order.seller_id, sku)
                new_line = models.ExpiryLine(
                    seller_id=order.seller_id,
                    product_id=prod.id if prod else None,
                    sku=sku,
                    expiry_date=rev.data_copiada,
                    lot_name=lote_rev,
                    qty_inicial=int(rev.delta),
                    qty_atual=int(rev.delta),
                    state="ativo",
                    origin_type="estorno",
                    origin_nf_number=order.nf_number,
                    active=True,
                    created_by_id=operator_id,
                )
                db.add(new_line)
                db.flush()
                _audit(db, entity_type="ExpiryLine", entity_id=new_line.id,
                       action="RECREATE_FROM_REVERSAL",
                       detail={"order_id": order.id, "sku": sku,
                               "qty": int(rev.delta),
                               "data_copiada": str(rev.data_copiada)},
                       user_id=operator_id)
            rev_count += 1

        # Marca todas as alocações do order como revertidas
        now = now_brasilia()
        for r in rows:
            r.reversed_at = now

        if rev_count:
            _audit(db, entity_type="ExpiryHook", entity_id=order.id,
                   action="FEFO_REVERSE",
                   detail={"order_id": order.id, "count": rev_count},
                   user_id=operator_id)
        savepoint.commit()
        return rev_count

    except Exception as exc:
        try:
            savepoint.rollback()
        except Exception:
            pass
        _audit(db, entity_type="ExpiryHook", entity_id=order.id,
               action="FEFO_REVERSE_ERROR",
               detail={"order_id": order.id, "error": repr(exc),
                       "traceback": traceback.format_exc(limit=4)},
               user_id=operator_id)
        return 0


def allocations_for_order(db: Session, order_id: int) -> dict[str, list[dict]]:
    """Para o Scanner: `{sku: [{expiry_date, quantity, vencido}]}` numa só query."""
    rows = db.query(models.ExpiryAllocation).filter(
        models.ExpiryAllocation.order_id == order_id,
        models.ExpiryAllocation.reversed_at.is_(None),
    ).order_by(
        models.ExpiryAllocation.sku.asc(),
        models.ExpiryAllocation.data_copiada.asc(),
        models.ExpiryAllocation.id.asc(),
    ).all()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r.sku, []).append({
            "expiry_date": r.data_copiada,
            "quantity": int(r.quantity),
            "vencido": bool(r.vencido_na_alocacao),
            "lot_name": r.lot_copiado,
        })
    return out


# ──────────────────────────────────────────────────────────────────────
# 3) Conferência da entrada — leitura para o Finalizar
# ──────────────────────────────────────────────────────────────────────

def pending_lines_for_order(db: Session, order: models.Order) -> dict[str, list[dict]]:
    """
    Devolve `{sku: [{"expiry_date": ..., "quantity": ...}, ...]}` com as
    linhas `a_chegar` desta NF. Agrupa por SKU, ordena data ASC. Usado:
      * pelo painel do item na bipagem de entrada
      * pelo preview da conferência do Finalizar
    """
    if not order.inbound_appointment_id:
        return {}
    nf = db.query(models.InboundNf).filter(
        models.InboundNf.order_id == order.id,
        models.InboundNf.active == True,  # noqa: E712
    ).first()
    if nf is None:
        return {}
    rows = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.origin_inbound_nf_id == nf.id,
        models.ExpiryLine.state == "a_chegar",
        models.ExpiryLine.active == True,  # noqa: E712
    ).order_by(
        models.ExpiryLine.sku.asc(),
        models.ExpiryLine.expiry_date.asc(),
        models.ExpiryLine.id.asc(),
    ).all()
    out: dict[str, list[dict]] = {}
    for ln in rows:
        out.setdefault(ln.sku, []).append({
            "expiry_date": ln.expiry_date,
            "quantity": int(ln.qty_atual),
            "line_id": ln.id,
            "lot_name": ln.lot_name,
        })
    return out
