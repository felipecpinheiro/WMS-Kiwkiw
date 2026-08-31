"""
WMS Kiwkiw - Router de Bipagem (Scanning)
Coração da aplicação dos operadores.
Reproduz e aprimora a lógica da macro 'Worksheet_Change' do Scan Manuseio.
"""

import csv
import io
import os
from datetime import datetime, date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from ..database import get_db
from ..auth import get_current_user, require_internal, require_manager_or_above, require_admin, get_user_seller_ids
from ..timezone_utils import now_brasilia, today_brasilia, end_of_day
from ..services.stock_manager import (
    update_stock_position,
    apply_stock_for_order,
    apply_stock_for_entry,
    reverse_stock_for_order,
    order_has_stock_applied,
    orders_missing_product_skus,
    orders_with_scan_overage,
    is_entrada_order,
)
from .. import models, schemas

router = APIRouter(prefix="/scanning", tags=["Bipagem"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIT_DIR = os.path.join(BASE_DIR, "data", "audit")

# Teto de unidades por bipe. Existe para pegar erro de digitação — sem ele, o
# operador que digita o código de barras dentro do campo de quantidade lança
# alguns milhões de peças no estoque. Nenhuma caixa real chega perto disso.
MAX_SCAN_QUANTITY = 9999


# Marcadores gravados como ScanningLog para carimbar eventos que não são bipagem.
# Ambos usam quantity=0 e is_error=False, então não contaminam contagem nenhuma.
PAUSE_SKU = "PAUSE"
RESUME_SKU = "RESUME"

# ⚠️ Marcadores NUNCA são bipagem: precisam ficar fora de toda contagem. Eles
# passariam nos filtros de "bipagem real" (is_error=False, is_interrupted=False),
# então a exclusão é explícita em _active_scan_filters e na produtividade —
# senão pausar uma NF inflaria o número de bipes do operador.
MARKER_SKUS = (PAUSE_SKU, RESUME_SKU)


def _is_entrada(order) -> bool:
    """
    Esta NF é de ENTRADA? Delega para a fonte de verdade em stock_manager, que é
    quem decide a regra de estoque a partir do mesmo teste.

    Só a Entrada aceita bipagem por quantidade, admite receber quantidade
    diferente da NF e tem o botão Finalizar (24/08/2026).
    """
    return is_entrada_order(order)


@router.get("/sessions", response_model=List[schemas.PickingSessionResponse])
def list_sessions(
    unit_id: Optional[int] = None,
    status: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista sessões de separação. Filtra por unidade do operador automaticamente."""
    from sqlalchemy.orm import joinedload as _jl
    query = db.query(models.PickingSession).options(
        _jl(models.PickingSession.orders).joinedload(models.Order.seller)
    )

    user_role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role

    # Operador só vê sessões da própria unidade
    if user_role == "operator" and current_user.unit_id:
        query = query.filter(models.PickingSession.unit_id == current_user.unit_id)
    elif unit_id:
        query = query.filter(models.PickingSession.unit_id == unit_id)

    if status:
        query = query.filter(models.PickingSession.status == status)
    if date_from:
        query = query.filter(models.PickingSession.session_date >= date_from)
    if date_to:
        query = query.filter(models.PickingSession.session_date <= date_to)

    sessions = query.order_by(models.PickingSession.created_at.desc()).limit(50).all()

    return [
        schemas.PickingSessionResponse.from_orm_with_checks(s)
        for s in sessions
    ]


def _build_item_dict(item: models.OrderItem, seller_id: int, item_scan_counts: dict, db: Session) -> dict:
    """
    Monta o dict de um item para a resposta do scanner.
    Quando o OrderItem não tem product linkado (produto cadastrado APÓS o import),
    faz lookup por seller_id + sku para recuperar barcode, foto e product_id corretos.
    Isso evita o bug de abrir o modal em modo 'criar' para produtos já existentes.
    """
    product = item.product
    if product is None:
        # Produto pode ter sido cadastrado depois da importação — busca pelo SKU+seller
        product = db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku == item.sku,
        ).first()
        if product:
            # Persiste o link para evitar nova busca nas próximas requisições
            item.product_id = product.id
            try:
                db.flush()
            except Exception:
                pass

    return {
        "sku": item.sku,
        "product_name": item.product_name,
        "quantity": item.quantity,
        "scanned": item_scan_counts.get((item.order_id, item.sku), 0),
        "barcode_seller": product.barcode_seller if product else None,
        "barcode_kiwkiw": product.barcode_kiwkiw if product else None,
        "photo_url": product.photo_url if product else None,
        "product_id": product.id if product else None,
    }


@router.get("/sessions/{session_id}/orders")
def get_session_orders(
    session_id: int,
    seller_id: Optional[int] = None,
    include_inactive: bool = False,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    Retorna lista de pedidos da sessão para a interface de bipagem.
    Equivalente ao MENU do Scan Manuseio.

    include_inactive: só tem efeito para admin — usado pelo toggle "Mostrar
    NFs inativas". Filtro exclusivo: liga → mostra SÓ as NFs inativas (não as
    ativas + inativas juntas). Os totais de progresso da sessão (cabeçalho)
    sempre refletem só as NFs ativas, independente do toggle.
    """
    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    show_inactive = include_inactive and user_role == "admin"

    status_filters = [models.Order.status != models.OrderStatus.CANCELLED]
    if show_inactive:
        status_filters.append(models.Order.status == models.OrderStatus.INACTIVE)
    else:
        status_filters.append(models.Order.status != models.OrderStatus.INACTIVE)

    orders_query = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(
        models.Order.session_id == session_id,
        *status_filters,
        # Seller inativo não aparece na operação — ver CLAUDE.md.
        models.Order.seller_id.in_(
            db.query(models.Seller.id).filter(models.Seller.active == True).scalar_subquery()
        ),
    )
    if seller_id:
        orders_query = orders_query.filter(models.Order.seller_id == seller_id)
    orders = orders_query.order_by(models.Order.nf_number).all()

    # ── NF com SKU sem produto cadastrado fica FORA do manuseio ────────────────
    # Ela é impossível de bipar (sem produto não há barcode_seller pra casar), e
    # antes disso o operador só descobria errando na bancada. Volta sozinha
    # quando o produto for cadastrado. Ver order_ids_missing_product().
    held_map = orders_missing_product_skus(db, [o.id for o in orders])
    held_orders = [
        {
            "order_id": o.id,
            "nf_number": o.nf_number,
            "seller_name": o.seller.trade_name if o.seller else None,
            "missing_skus": held_map[o.id],
        }
        for o in orders if o.id in held_map
    ]
    orders = [o for o in orders if o.id not in held_map]

    # Conta itens escaneados por pedido e por (pedido, sku) em 2 consultas agrupadas,
    # em vez de 1 query por pedido + 1 query por item de cada pedido (N+1 — ver CLAUDE.md).
    # Join com Order para respeitar reactivated_at: bipagem anterior ao corte de um
    # ciclo (NF que foi inativada e depois reativada) não conta pro ciclo atual.
    order_ids = [order.id for order in orders]

    scan_counts = {}
    item_scan_counts = {}
    if order_ids:
        order_totals = db.query(
            models.ScanningLog.order_id,
            func.sum(models.ScanningLog.quantity),
        ).join(
            models.Order, models.Order.id == models.ScanningLog.order_id
        ).filter(
            models.ScanningLog.order_id.in_(order_ids),
            models.ScanningLog.is_interrupted == False,
            models.ScanningLog.is_error == False,
            models.ScanningLog.sku.notin_(MARKER_SKUS),
            or_(
                models.Order.reactivated_at.is_(None),
                models.ScanningLog.timestamp > models.Order.reactivated_at,
            ),
        ).group_by(models.ScanningLog.order_id).all()
        scan_counts = {order_id: total or 0 for order_id, total in order_totals}

        item_totals = db.query(
            models.ScanningLog.order_id,
            models.ScanningLog.sku,
            func.sum(models.ScanningLog.quantity),
        ).join(
            models.Order, models.Order.id == models.ScanningLog.order_id
        ).filter(
            models.ScanningLog.order_id.in_(order_ids),
            models.ScanningLog.is_error == False,
            models.ScanningLog.is_interrupted == False,
            models.ScanningLog.sku.notin_(MARKER_SKUS),
            or_(
                models.Order.reactivated_at.is_(None),
                models.ScanningLog.timestamp > models.Order.reactivated_at,
            ),
        ).group_by(models.ScanningLog.order_id, models.ScanningLog.sku).all()
        item_scan_counts = {(order_id, sku): total or 0 for order_id, sku, total in item_totals}

    # Quais NFs estão pausadas — em lote, nunca 1 consulta por pedido.
    paused_ids = _paused_order_ids(db, order_ids)

    result = []
    for order in orders:
        total_items = sum(item.quantity for item in order.items)
        scanned = scan_counts.get(order.id, 0)
        order_status = order.status.value if hasattr(order.status, 'value') else order.status

        result.append({
            "id": order.id,
            "nf_number": order.nf_number,
            "customer_name": order.customer_name,
            "seller": order.seller.trade_name if order.seller else None,
            "seller_id": order.seller_id,
            "carrier": order.carrier,
            "status": order_status,
            "is_inactive": order_status == "inactive",
            # Entrada/Saída da NF — o Scanner precisa disto para decidir se
            # mostra o campo de quantidade (só entrada). Vem do PEDIDO, não da
            # sessão: divergem na NF órfã deixada de fora pelo config de sessão.
            # Formato igual ao de /session-cards ("entrada"/"saida").
            "file_type": "entrada" if _is_entrada(order) else "saida",
            # Conferência de entrada pausada — continua EM ABERTO, só sinaliza
            # que alguém parou no meio (contagem que leva dias). Ver /pause.
            "is_paused": order.id in paused_ids,
            "total_items": total_items,
            "scanned_items": scanned,
            "remaining": max(0, total_items - scanned),
            "completion_pct": round((scanned / total_items * 100) if total_items > 0 else 0, 1),
            "items": [
                _build_item_dict(item, order.seller_id, item_scan_counts, db)
                for item in order.items
            ],
        })

    # Totais/progresso da sessão (cabeçalho) sempre refletem só as NFs ativas
    # — independente do toggle "Mostrar NFs inativas" ter filtrado a lista
    # abaixo para mostrar só as inativas.
    if show_inactive:
        operational_query = db.query(models.Order).filter(
            models.Order.session_id == session_id,
            models.Order.status != models.OrderStatus.CANCELLED,
            models.Order.status != models.OrderStatus.INACTIVE,
            models.Order.seller_id.in_(
                db.query(models.Seller.id).filter(models.Seller.active == True).scalar_subquery()
            ),
        )
        if seller_id:
            operational_query = operational_query.filter(models.Order.seller_id == seller_id)
        operational_orders = operational_query.all()
    else:
        operational_orders = orders

    total = len(operational_orders)
    # Pedidos interrompidos contam como "feitos" para efeitos de progresso
    completed = sum(
        1 for o in operational_orders
        if (o.status.value if hasattr(o.status, 'value') else o.status) in ("completed", "interrupted")
    )

    return {
        "session_id": session_id,
        "session_date": session.session_date,
        "total_orders": total,
        "completed_orders": completed,
        "pending_orders": total - completed,
        "completion_pct": round((completed / total * 100) if total > 0 else 0, 1),
        "orders": result,
        # NFs seguradas por falta de produto cadastrado — não entram em `orders`
        # nem nos totais. Expostas para a tela poder dizer que elas existem, em
        # vez de simplesmente sumirem.
        "held_orders": held_orders,
    }


@router.post("/sessions/{session_id}/open-by-nfe")
def open_order_by_nfe(
    session_id: int,
    request: schemas.OpenByNfeRequest,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """Abre um pedido pelo scan da chave de acesso da NFe (código extenso da etiqueta)."""
    nfe_key = request.nfe_key.strip()
    if not nfe_key:
        raise HTTPException(status_code=400, detail="Chave NFe é obrigatória")

    # Match by danfe_key or nf_number
    order = db.query(models.Order).filter(
        models.Order.session_id == session_id,
        (models.Order.danfe_key == nfe_key) | (models.Order.nf_number == nfe_key),
    ).first()

    if not order:
        preview = nfe_key[:20] + "..." if len(nfe_key) > 20 else nfe_key
        return {"success": False, "message": f"Nenhum pedido encontrado para a chave '{preview}' nesta sessão"}

    order_status = order.status.value if hasattr(order.status, 'value') else order.status
    if order_status == "completed":
        return {"success": False, "message": f"Pedido NF {order.nf_number} já está concluído"}
    # B: pedido interrompido é uma finalização manual — não pode ser reaberto via bipagem
    if order_status == "interrupted":
        return {"success": False, "message": f"Pedido NF {order.nf_number} foi interrompido e não pode ser reaberto. Contate o supervisor."}
    if order_status == "inactive":
        admin_name = _get_deactivation_admin_name(order.id, db)
        return {"success": False, "blocked_reason": "inactive", "message": f"Esta NF foi inativada por {admin_name}."}

    is_entrada = _is_entrada(order)

    # Pedido sem transportadora não pode ser bipado — ver CLAUDE.md.
    # Preencher em Dashboard → aviso fixo no topo (ou na hora do import).
    #
    # ⚠️ NÃO se aplica à ENTRADA (24/08/2026): como o produto está chegando, não
    # interessa por qual transportadora ele veio — interessa que chegou. A
    # transportadora também deixou de destravar estoque de entrada, que agora
    # entra pela contagem na finalização.
    if not order.carrier and not is_entrada:
        return {"success": False, "message": f"Pedido NF {order.nf_number} está sem transportadora. Preencha a transportadora no Dashboard antes de biper."}

    # NF com SKU sem produto cadastrado é impossível de bipar (sem produto não
    # existe barcode_seller pra casar). Bloqueia aqui com uma mensagem que diz
    # o que fazer, em vez de deixar o operador errar item por item na bancada.
    faltantes = orders_missing_product_skus(db, [order.id]).get(order.id)
    if faltantes:
        return {
            "success": False,
            "blocked_reason": "missing_product",
            "message": (
                f"NF {order.nf_number} não pode ser manuseada: "
                f"{'SKU sem cadastro' if len(faltantes) == 1 else 'SKUs sem cadastro'} "
                f"({', '.join(faltantes[:5])}{'…' if len(faltantes) > 5 else ''}). "
                f"Cadastre o produto no Dashboard e a NF volta sozinha."
            ),
        }

    # ── Aviso de NF duplicada: mesma NF já sendo bipada por OUTRO operador ──
    # Não bloqueia (decisão do usuário em 01/08/2026) — dois operadores nunca
    # deveriam abrir a mesma NF, mas se acontecer, avisa em vez de travar.
    # Usa o último scan real (is_error=False) para saber quem está bipando —
    # mesmo critério de "atividade real" do lock por seller logo abaixo.
    duplicate_warning = None
    if order_status == "scanning":
        last_scan = db.query(models.ScanningLog).filter(
            *_active_scan_filters(order)
        ).order_by(models.ScanningLog.timestamp.desc()).first()
        if last_scan and last_scan.operator_id and last_scan.operator_id != current_user.id:
            other_operator = db.query(models.User).filter(
                models.User.id == last_scan.operator_id
            ).first()
            other_name = other_operator.name if other_operator else "outro operador"
            duplicate_warning = (
                f"⚠️ ATENÇÃO: a NF {order.nf_number} já está sendo bipada por {other_name}. "
                "Confirme antes de continuar para não bipar a mesma caixa duas vezes."
            )

    # NF de entrada pausada volta a ficar ativa ao ser reaberta: grava o
    # marcador de retomada para o card parar de mostrar "pausada". O status
    # nunca mudou (continua SCANNING), então não há nada a restaurar além disso.
    was_paused = False
    if is_entrada and _is_paused(order, db):
        was_paused = True
        db.add(models.ScanningLog(
            session_id=session_id,
            order_id=order.id,
            sku=RESUME_SKU,
            barcode_scanned=RESUME_SKU,
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            error_message="Conferência retomada",
        ))
        db.commit()

    return {
        "success": True,
        "order_id": order.id,
        "nf_number": order.nf_number,
        "customer_name": order.customer_name,
        "status": order_status,
        "message": (
            f"Conferência da NF {order.nf_number} retomada de onde parou"
            if was_paused else f"Pedido NF {order.nf_number} aberto com sucesso"
        ),
        "warning": duplicate_warning,
    }


@router.get("/sessions/{session_id}/scan-logs")
def get_session_scan_logs(
    session_id: int,
    order_id: Optional[int] = None,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """Retorna o log de bipagens de uma sessão (para exibição em tempo real)."""
    query = db.query(models.ScanningLog).options(
        joinedload(models.ScanningLog.operator),
        joinedload(models.ScanningLog.order),
    ).filter(
        models.ScanningLog.session_id == session_id,
    )
    if order_id:
        query = query.filter(models.ScanningLog.order_id == order_id)

    logs = query.order_by(models.ScanningLog.timestamp.desc()).limit(50).all()

    result = []
    for log in logs:
        result.append({
            "id": log.id,
            "timestamp": log.timestamp.strftime("%H:%M:%S"),
            "sku": log.sku,
            "barcode_scanned": log.barcode_scanned,
            "quantity": log.quantity,
            "is_error": log.is_error,
            "error_message": log.error_message if log.is_error else None,
            "operator_name": log.operator.name if log.operator else "N/A",
            "order_nf": log.order.nf_number if log.order else "N/A",
        })

    return result


@router.get("/debug/sessions-raw")
def debug_sessions_raw(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    DIAGNÓSTICO: retorna a contagem crua das tabelas envolvidas e as 20
    sessões mais recentes sem passar pelo Pydantic, para detectar casos em
    que a resposta do /sessions fica vazia por erro de serialização.
    """
    from sqlalchemy import func as _f
    total_sessions  = db.query(_f.count(models.PickingSession.id)).scalar() or 0
    total_orders    = db.query(_f.count(models.Order.id)).scalar() or 0
    orders_no_sess  = db.query(_f.count(models.Order.id)).filter(
        models.Order.session_id.is_(None)
    ).scalar() or 0

    sessions = (
        db.query(models.PickingSession)
          .order_by(models.PickingSession.created_at.desc())
          .limit(20)
          .all()
    )
    return {
        "total_sessions": total_sessions,
        "total_orders": total_orders,
        "orders_without_session": orders_no_sess,
        "current_user": {
            "id": current_user.id,
            "role": current_user.role.value if hasattr(current_user.role, "value") else current_user.role,
            "unit_id": current_user.unit_id,
        },
        "sessions": [
            {
                "id": s.id,
                "session_date": str(s.session_date),
                "unit_id": s.unit_id,
                "status": s.status.value if hasattr(s.status, "value") else s.status,
                "file_type": s.file_type.value if (s.file_type and hasattr(s.file_type, "value")) else s.file_type,
                "for_billing": bool(s.for_billing),
                "total_orders": s.total_orders,
                "completed_orders": s.completed_orders,
                "source_file": s.source_file,
                "created_at": str(s.created_at) if s.created_at else None,
            }
            for s in sessions
        ],
    }


@router.patch("/sessions/{session_id}/config")
def update_session_config(
    session_id: int,
    payload: schemas.PickingSessionConfigUpdate,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Atualiza as configurações de nível de arquivo de uma sessão:
      - file_type (Entrada/Saída)
      - for_billing (considerar para faturamento)
    A mudança é propagada para TODOS os pedidos da sessão para manter consistência.
    """
    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    changed_fields = []

    if payload.file_type is not None:
        ft = payload.file_type.strip()
        # ⚠️ Era `models.FileType.IN`, que NÃO existe (o enum tem IMPORT/EXPORT)
        # — trocar o tipo para "Entrada" estourava AttributeError → 500.
        new_file_type = (
            models.FileType.IMPORT if ft.lower() in ("entrada", "in")
            else models.FileType.EXPORT
        )

        # O file_type define o SINAL do movimento de estoque (06/08/2026).
        # Se a sessão já baixou estoque, trocar o tipo sem mexer no estoque
        # deixaria os movimentos com o sinal errado, em silêncio. Então:
        # estorna com o sinal antigo, troca, e baixa de novo com o novo.
        resigned_orders = 0
        skipped_order_ids = []  # NFs órfãs — ficam de fora da troca de tipo
        skipped_nf_numbers = []
        if new_file_type != session.file_type:
            # ⚠️ Excedente de conferência bloqueia a troca (17/08/2026). O
            # estorno abaixo leva o excedente junto (saldo líquido do order_id),
            # mas o re-lançamento repõe só a quantidade da NF — o excedente
            # sumiria do estoque em silêncio.
            #
            # Bloqueia a SESSÃO INTEIRA, não só as NFs afetadas: troca parcial de
            # tipo deixaria a sessão com pedidos de tipos diferentes sem ninguém
            # perceber. Diferente das NFs órfãs logo abaixo, que são anomalia de
            # dados — aqui é dado legítimo que precisa de decisão humana.
            session_order_ids = [
                r[0] for r in db.query(models.Order.id).filter(
                    models.Order.session_id == session_id
                ).all()
            ]
            with_overage = orders_with_scan_overage(db, session_order_ids)
            if with_overage:
                nfs = [
                    r[0] for r in db.query(models.Order.nf_number).filter(
                        models.Order.id.in_(with_overage)
                    ).order_by(models.Order.nf_number).all()
                ]
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"{len(nfs)} NF(s) desta sessão têm excedente de conferência "
                        f"lançado no estoque (foi recebido mais do que a NF previa): "
                        f"{', '.join(nfs[:10])}{'...' if len(nfs) > 10 else ''}. "
                        f"Trocar o tipo apagaria esse excedente. Ajuste o estoque "
                        f"manualmente antes, pela tela de Estoque."
                    ),
                )
            applied_orders = db.query(models.Order).options(
                joinedload(models.Order.items),
                joinedload(models.Order.seller),
            ).filter(
                models.Order.session_id == session_id,
                models.Order.stock_applied_at.isnot(None),
            ).all()
            for order in applied_orders:
                result = reverse_stock_for_order(
                    order, db,
                    observation=(
                        f"ESTORNO — tipo do arquivo da sessão {session_id} alterado para "
                        f"'{ft}' por {current_user.name}. Reverte a baixa feita com o tipo anterior."
                    ),
                    operator_id=current_user.id,
                )
                if result == -1:
                    # NF órfã (nenhum movimento vinculado — ex: vínculo perdido numa
                    # reconciliação de estoque). Não reaplica: duplicaria o estoque
                    # já refletido no saldo reconciliado. Fica de fora da troca de
                    # tipo desta sessão, pra não ficar com file_type divergente do
                    # que baixou de fato; precisa de conferência manual.
                    skipped_order_ids.append(order.id)
                    skipped_nf_numbers.append(order.nf_number)
                    continue
                order.file_type = new_file_type
                apply_stock_for_order(order, db, operator_id=current_user.id)
                resigned_orders += 1

        session.file_type = new_file_type
        # Propaga para todos os pedidos da sessão, exceto as NFs órfãs deixadas
        # de fora acima (essas mantêm o file_type antigo até conferência manual)
        propagate_q = db.query(models.Order).filter(
            models.Order.session_id == session_id
        )
        if skipped_order_ids:
            propagate_q = propagate_q.filter(models.Order.id.notin_(skipped_order_ids))
        propagate_q.update({"file_type": session.file_type}, synchronize_session=False)
        changed_fields.append("file_type")
        if resigned_orders:
            changed_fields.append(f"estoque re-lançado em {resigned_orders} NF(s)")
        if skipped_nf_numbers:
            changed_fields.append(
                f"ATENÇÃO: {len(skipped_nf_numbers)} NF(s) não foram alteradas por falta de "
                f"confirmação de reversão de estoque — verifique manualmente: "
                f"{', '.join(skipped_nf_numbers)}"
            )

    if payload.for_billing is not None:
        session.for_billing = bool(payload.for_billing)
        db.query(models.Order).filter(
            models.Order.session_id == session_id
        ).update({"for_billing": session.for_billing}, synchronize_session=False)
        changed_fields.append("for_billing")

    # Registra auditoria
    if changed_fields:
        db.add(models.AuditLog(
            entity_type="PickingSession",
            entity_id=session_id,
            action="CONFIG_UPDATE",
            detail=f"Campos alterados: {', '.join(changed_fields)} por user_id={current_user.id}",
            user_id=current_user.id,
        ))
    db.commit()

    return {
        "message": "Configuração atualizada",
        "session_id": session_id,
        "file_type": session.file_type.value if hasattr(session.file_type, 'value') else session.file_type,
        "for_billing": session.for_billing,
        "changed_fields": changed_fields,
    }


def _finalize_order(order: models.Order, session_id: int | None, db: Session) -> None:
    """
    Marca o pedido como COMPLETED e atualiza a contagem/fechamento da sessão.

    Compartilhada entre process_scan (conclusão pelo último bipe) e
    save_order_box (conclusão pelo cadastro da caixa, quando ela era a última
    pendência de uma NF de saída — ver CLAUDE.md, "Caixa obrigatória na
    SAÍDA"). Não faz commit: quem chama decide quando commitar.
    """
    order.status = models.OrderStatus.COMPLETED

    if session_id is None:
        return

    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        return

    # +1: a sessão do banco usa autoflush=False (database.py), então a query
    # abaixo ainda não enxerga o order.status = COMPLETED setado acima.
    session.completed_orders = db.query(models.Order).filter(
        models.Order.session_id == session_id,
        models.Order.status == models.OrderStatus.COMPLETED,
    ).count() + 1

    if session.completed_orders >= session.total_orders:
        session.status = models.OrderStatus.COMPLETED
        session.completed_at = now_brasilia()


@router.post("/scan", response_model=schemas.ScanResponse)
def process_scan(
    request: schemas.ScanRequest,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    Processa um scan de código de barras.

    Lógica equivalente à macro 'Worksheet_Change' do Scan Manuseio:
    1. Valida se o código escaneado pertence ao pedido atual
    2. Verifica se o item já foi completamente bipado
    3. Se todos os itens do pedido estão bipados, marca como COMPLETO
    4. Registra em log de auditoria com timestamp exato

    IMPORTANTE: Resistente a erros - operador não consegue bipar o errado
                sem receber alerta claro.
    """
    # Busca o pedido
    order = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == request.order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    # Pedido já concluído ou cancelado não pode ser bipado
    order_status = order.status.value if hasattr(order.status, 'value') else order.status
    if order_status in ["completed", "cancelled"]:
        return schemas.ScanResponse(
            success=False,
            message=f"Pedido {order.nf_number} já está {order_status}. Não é possível bipar.",
            status="error",
            items_remaining=0,
        )
    if order_status == "inactive":
        admin_name = _get_deactivation_admin_name(order.id, db)
        return schemas.ScanResponse(
            success=False,
            message=f"Esta NF foi inativada por {admin_name}.",
            status="inactive",
            items_remaining=0,
        )

    is_entrada = _is_entrada(order)

    # Pedido sem transportadora não pode ser bipado — mesma trava de
    # open_order_by_nfe, aqui como segunda camada de defesa. Ver CLAUDE.md.
    #
    # ⚠️ NÃO se aplica à ENTRADA (24/08/2026): na entrada o que importa é que a
    # mercadoria chegou, não por qual transportadora — e a transportadora deixou
    # de ter qualquer efeito no estoque dela, que agora entra pela contagem.
    if not order.carrier and not is_entrada:
        return schemas.ScanResponse(
            success=False,
            message=f"Pedido {order.nf_number} está sem transportadora. Preencha antes de continuar a bipagem.",
            status="error",
            items_remaining=0,
        )

    # ── Bipagem por quantidade — SÓ NA ENTRADA (17/08/2026) ─────────────────
    # Numa entrada, uma caixa pode ter 1.000 peças iguais e bipar unidade a
    # unidade é inviável. Na saída cada peça bipada é uma conferência real de
    # separação, então lá continua 1 por bipe.
    qty = request.quantity

    if qty < 1 or qty > MAX_SCAN_QUANTITY:
        raise HTTPException(
            status_code=400,
            detail=f"Quantidade inválida: use um número de 1 a {MAX_SCAN_QUANTITY}.",
        )
    # Trava de servidor: o campo só aparece na Entrada, mas a tela não pode ser
    # a única guarda — uma chamada forjada lançaria estoque errado na saída.
    if qty > 1 and not is_entrada:
        raise HTTPException(
            status_code=400,
            detail="Bipagem por quantidade só é permitida em NF de entrada.",
        )

    # Valida o código de barras escaneado.
    # Aceita APENAS barcode_seller (código físico na etiqueta do seller).
    # Fallback: se o OrderItem não tem product linkado (produto cadastrado após
    # o import), busca por seller_id + sku para recuperar o barcode atualizado.
    matched_item = None
    for item in order.items:
        product = item.product
        if product is None and order.seller_id:
            # Produto pode ter sido cadastrado/atualizado após o import
            product = db.query(models.Product).filter(
                models.Product.seller_id == order.seller_id,
                models.Product.sku == item.sku,
            ).first()
            if product:
                item.product_id = product.id
                try:
                    db.flush()
                except Exception:
                    pass
        if product and product.barcode_seller:
            if request.barcode.strip() == product.barcode_seller.strip():
                matched_item = item
                break

    if not matched_item:
        # ERRO: código não pertence a este pedido
        error_log = models.ScanningLog(
            session_id=request.session_id,
            order_id=request.order_id,
            sku=request.barcode,
            barcode_scanned=request.barcode,
            quantity=0,
            operator_id=request.operator_id,
            is_error=True,
            error_message=f"Código '{request.barcode}' não pertence ao pedido {order.nf_number}",
        )
        db.add(error_log)
        db.commit()

        return schemas.ScanResponse(
            success=False,
            message=f"⚠️ ATENÇÃO: Código '{request.barcode}' NÃO pertence ao pedido {order.nf_number}. Verifique o produto!",
            status="error",
            items_remaining=_count_remaining(order, db),
        )

    # Conta quantas unidades desse SKU já foram bipadas neste pedido
    already_scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
        *_active_scan_filters(order),
        models.ScanningLog.sku == matched_item.sku,
    ).scalar() or 0

    expected_qty = matched_item.quantity
    # Esperado REAL do SKU no pedido — consolida o caso de o mesmo SKU aparecer
    # em dois itens (componente de kit + linha avulsa, ver CLAUDE.md). Usado só
    # para decidir o excedente: com dois itens de 4 e 5, bipar 6 não é excedente,
    # e usar matched_item.quantity (4) lançaria 2 peças fantasma no estoque.
    # O bloqueio e as mensagens seguem usando matched_item.quantity, para a
    # saída continuar se comportando exatamente como antes.
    expected_sku_total = sum(it.quantity for it in order.items if it.sku == matched_item.sku)

    # Na SAÍDA, item já completo continua barrando exatamente como sempre.
    # Na ENTRADA não barra: o que vale para o estoque é o que chegou
    # fisicamente. Se o seller mandou mais do que a NF diz, o operador registra
    # o que contou e o sistema avisa para a empresa ser comunicada.
    if already_scanned >= expected_qty and not is_entrada:
        return schemas.ScanResponse(
            success=False,
            message=f"⚠️ SKU '{matched_item.sku}' já foi bipado {already_scanned}x (esperado: {expected_qty}x). Item completo!",
            status="already_done",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=_count_remaining(order, db),
        )

    # Excedente DESTE bipe — só a parte que passa do que a NF previa.
    # A conta é incremental de propósito: o operador pode chegar ao excedente em
    # etapas (bipa 1000, depois mais 200), e usar o total a cada bipe contaria o
    # mesmo excedente várias vezes.
    over_qty = (
        max(0, already_scanned + qty - expected_sku_total)
        - max(0, already_scanned - expected_sku_total)
    )

    # Registra o scan com sucesso
    log = models.ScanningLog(
        session_id=request.session_id,
        order_id=request.order_id,
        sku=matched_item.sku,
        barcode_scanned=request.barcode,
        quantity=qty,
        operator_id=request.operator_id,
        is_error=False,
    )

    if over_qty > 0:
        # ⚠️ 24/08/2026: o excedente NÃO vai mais para o estoque na hora.
        # A quantidade contada inteira (inclusive a sobra) entra de uma vez na
        # FINALIZAÇÃO (POST /orders/{id}/finalize-entry). Lançar aqui e de novo
        # lá duplicaria a sobra. apply_scan_overage() continua existindo em
        # stock_manager só para os movimentos já gravados serem reconhecidos.
        #
        # is_error continua False: não é erro do operador, é uma ocorrência.
        # O GET /scanning/audit-log devolve error_message sem filtrar is_error,
        # então isto aparece na Trilha de Auditoria e no CSV de bipagem.
        log.error_message = (
            f"EXCEDENTE — bipado {over_qty} além do previsto na NF "
            f"({expected_sku_total}). Entra no estoque na finalização."
        )

    db.add(log)

    # Atualiza status do pedido para "scanning" se ainda estava pending
    if order_status == "pending":
        order.status = models.OrderStatus.SCANNING

    # Verifica se o pedido está completo
    remaining = _count_remaining_after_scan(order, matched_item.sku, db, qty)

    scan_response = None
    # Sufixo do aviso de excedente — vai junto da mensagem de sucesso para o
    # operador ver na hora que precisa comunicar a empresa.
    over_suffix = (
        f" ⚠️ {over_qty} A MAIS do que a NF previa ({expected_sku_total}) — comunique a empresa."
        if over_qty > 0 else ""
    )

    # ── ENTRADA NUNCA CONCLUI SOZINHA (24/08/2026) ──────────────────────────
    # Bater a quantidade da NF não significa que a conferência acabou: a caixa
    # seguinte pode trazer mais peças do mesmo SKU. Se a NF fechasse aqui, o
    # operador perderia o direito de continuar bipando (pedido completed recusa
    # scan) e a sobra ficaria fora do estoque. Só o botão Finalizar conclui —
    # é ele que dispara a conferência e a entrada no estoque.
    if is_entrada:
        db.commit()
        new_scanned = already_scanned + qty
        scan_response = schemas.ScanResponse(
            success=True,
            message=f"✔ {matched_item.product_name} [{matched_item.sku}] — {new_scanned}/{expected_qty} contado(s){over_suffix}",
            status="ok",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=remaining,
            order_progress=_build_progress(order, db),
            over_quantity=over_qty,
        )
        _save_audit_csv(log, order, current_user)
        return scan_response

    if remaining == 0:
        # Caixa obrigatória na SAÍDA (17/08/2026): sem ela, o pedido fica
        # "aguardando caixa" — todos os itens batem 100%, mas o status não vira
        # COMPLETED. Isso automaticamente também segura a próxima NF, já que o
        # Scanner só libera scanPhase='nfe' quando o pedido ativo está completed.
        # Na ENTRADA não se aplica — nunca exigiu caixa.
        if not is_entrada and not order.box_used:
            db.commit()
            scan_response = schemas.ScanResponse(
                success=True,
                message=(
                    f"Bipagem registrada — falta cadastrar a caixa pra concluir "
                    f"a NF {order.nf_number}.{over_suffix}"
                ),
                status="awaiting_box",
                sku=matched_item.sku,
                product_name=matched_item.product_name,
                photo_url=matched_item.product.photo_url if matched_item.product else None,
                items_remaining=0,
                order_progress=_build_progress(order, db),
                over_quantity=over_qty,
            )
        else:
            _finalize_order(order, request.session_id, db)
            db.commit()

            scan_response = schemas.ScanResponse(
                success=True,
                message=f"✅ PEDIDO {order.nf_number} COMPLETO! Todos os {expected_qty} itens bipados.{over_suffix}",
                status="order_complete",
                sku=matched_item.sku,
                product_name=matched_item.product_name,
                photo_url=matched_item.product.photo_url if matched_item.product else None,
                items_remaining=0,
                order_progress=_build_progress(order, db),
                over_quantity=over_qty,
            )
    else:
        db.commit()
        new_scanned = already_scanned + qty
        scan_response = schemas.ScanResponse(
            success=True,
            message=f"✔ {matched_item.product_name} [{matched_item.sku}] — {new_scanned}/{expected_qty} bipado(s){over_suffix}",
            status="ok",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=remaining,
            order_progress=_build_progress(order, db),
            over_quantity=over_qty,
        )

    # Grava trilha de auditoria em CSV
    _save_audit_csv(log, order, current_user)

    return scan_response


@router.post("/interrupt", response_model=dict)
def interrupt_order(
    request: schemas.InterruptRequest,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    Interrompe um pedido em progresso.
    Equivalente ao 'Sub pedidointerrompido()' do Scan Manuseio.

    Comportamento:
    - Muda status para INTERRUPTED (não volta a PENDING)
    - Sensibiliza o estoque como se fosse um pedido concluído
    - Registra log de auditoria com carimbo de interrompido
    """
    # Carrega o pedido COM itens e seller para poder atualizar o estoque
    order = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == request.order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    # ⚠️ ENTRADA NÃO INTERROMPE (24/08/2026) — trava de servidor, não cosmética.
    # INTERRUPTED é carimbo definitivo: a NF não reabre e conta como FEITA no
    # kanban. Numa entrada isso deixaria a mercadoria fora do estoque para
    # sempre, sem ninguém perceber, já que o estoque dela só entra no Finalizar.
    # Quem quer sair no meio da contagem usa Pausar; quem acabou, Finalizar.
    if _is_entrada(order):
        raise HTTPException(
            status_code=400,
            detail=(
                "NF de entrada não pode ser interrompida. Use Pausar para "
                "continuar depois, ou Finalizar para encerrar a conferência."
            ),
        )

    # Registra interrupção no log de bipagem
    log = models.ScanningLog(
        session_id=request.session_id,
        order_id=request.order_id,
        sku="INTERRUPT",
        barcode_scanned="INTERRUPT",
        quantity=0,
        operator_id=request.operator_id,
        is_interrupted=True,
        error_message=request.reason or "Pedido interrompido pelo operador",
    )
    db.add(log)

    # Muda status para INTERRUPTED (carimbo definitivo — não volta para PENDING)
    order.status = models.OrderStatus.INTERRUPTED

    # ── Atualiza contador completed_orders da sessão ────────────────────────────
    # Igual ao fluxo de conclusão normal: recontamos para incluir interrupted.
    if order.session_id:
        session = db.query(models.PickingSession).filter(
            models.PickingSession.id == order.session_id
        ).first()
        if session:
            session.completed_orders = db.query(models.Order).filter(
                models.Order.session_id == order.session_id,
                models.Order.status.in_([
                    models.OrderStatus.COMPLETED,
                    models.OrderStatus.INTERRUPTED,
                ]),
            ).count()

    # ── Estoque NÃO é tocado aqui (06/08/2026) ─────────────────────────────────
    # A NF já baixou estoque na importação. Interromper não devolve nada: a
    # decisão do dono do sistema é que a baixa permanece e, se houver
    # divergência física, o acerto é feito na mão pela tela de Estoque.
    stock_updated = bool(getattr(order, "stock_applied_at", None))

    # Log de auditoria do sistema
    audit = models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="INTERRUPT",
        detail=(
            f"Pedido NF {order.nf_number} interrompido. "
            f"Motivo: {request.reason or 'Não informado'}. "
            f"Estoque {'já baixado na importação' if stock_updated else 'ainda não baixado (NF pendente)'}."
        ),
        user_id=current_user.id,
    )
    db.add(audit)
    db.commit()

    return {
        "success": True,
        "message": f"Pedido {order.nf_number} interrompido e registrado.",
        "stock_updated": stock_updated,
    }


def _build_entry_conference(order: models.Order, db: Session) -> dict:
    """
    Conferência final de uma NF de ENTRADA: esperado (NF) x contado (bipagem),
    SKU a SKU. É o que a tela mostra antes de o operador confirmar.

    Consolida SKU repetido em dois OrderItem (componente de kit + linha avulsa),
    porque o que entra no estoque é por SKU, não por linha da NF.
    """
    expected = _expected_by_sku(order)
    counted = _scanned_by_sku(order, db)
    names = {it.sku: it.product_name for it in order.items}

    lines = []
    for sku in sorted(set(expected) | set(counted)):
        exp = int(expected.get(sku, 0) or 0)
        cnt = int(counted.get(sku, 0) or 0)
        if exp == 0 and cnt == 0:
            continue
        if cnt == exp:
            status = "ok"
        elif cnt == 0:
            status = "missing"
        elif cnt > exp:
            status = "over"
        else:
            status = "short"
        lines.append({
            "sku": sku,
            "product_name": names.get(sku) or sku,
            "expected": exp,
            "counted": cnt,
            "diff": cnt - exp,
            "status": status,
        })

    divergent = [ln for ln in lines if ln["status"] != "ok"]
    return {
        "lines": lines,
        "divergent_count": len(divergent),
        "total_expected": sum(ln["expected"] for ln in lines),
        "total_counted": sum(ln["counted"] for ln in lines),
    }


@router.post("/orders/{order_id}/finalize-entry")
def finalize_entry_order(
    order_id: int,
    body: dict,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    FINALIZA a conferência de uma NF de ENTRADA (24/08/2026).

    É aqui — e só aqui — que o estoque de entrada entra, pela quantidade que o
    operador CONTOU, não pela que a NF diz. Ver o cabeçalho de
    services/stock_manager.py.

    Fluxo em 2 passos, o mesmo padrão de cancel-duplicate-orders:
      body {}                  -> devolve a conferência, não muda NADA no banco
      body {"confirm": true}   -> lança o estoque e conclui a NF

    Qualquer operador pode finalizar (decisão do dono do sistema, 24/08/2026).
    """
    order = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if not _is_entrada(order):
        raise HTTPException(
            status_code=400,
            detail="Finalizar conferência só existe em NF de entrada.",
        )

    order_status = order.status.value if hasattr(order.status, "value") else order.status
    if order_status in ("completed", "cancelled", "inactive"):
        raise HTTPException(
            status_code=409,
            detail=f"NF {order.nf_number} já está {order_status} — não pode ser finalizada.",
        )

    conference = _build_entry_conference(order, db)

    if not body.get("confirm"):
        # Preview: nada é gravado. O operador ainda pode voltar e continuar
        # contando de onde parou.
        return {
            "success": True,
            "confirmed": False,
            "order_id": order.id,
            "nf_number": order.nf_number,
            **conference,
        }

    # ── Confirmado: estoque entra pela contagem ─────────────────────────────
    expected = _expected_by_sku(order)
    counted = _scanned_by_sku(order, db)

    result = apply_stock_for_entry(
        order=order,
        db=db,
        counted=counted,
        expected=expected,
        operator_id=current_user.id,
        operator_name=current_user.name if current_user else None,
    )

    _finalize_order(order, order.session_id, db)

    # Auditoria: uma linha com o resumo da conferência. As observações por SKU
    # divergente ficam no próprio movimento de estoque, que é onde o time olha.
    if result["divergences"]:
        resumo = "; ".join(
            f"{d['sku']}: contado {d['counted']} x NF {d['expected']}"
            for d in result["divergences"][:20]
        )
        if len(result["divergences"]) > 20:
            resumo += f" (+{len(result['divergences']) - 20} SKU)"
    else:
        resumo = "sem divergência"

    db.add(models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="FINALIZE_ENTRY",
        detail=(
            f"Conferência de entrada da NF {order.nf_number} finalizada por "
            f"{current_user.name}. Estoque "
            f"{'lançado pela contagem' if result['applied'] else 'NÃO lançado (' + str(result['skipped']) + ')'}. "
            f"Divergências: {resumo}."
        ),
        user_id=current_user.id,
    ))

    db.commit()

    if result["applied"]:
        msg = f"✅ NF {order.nf_number} finalizada. Estoque atualizado pela contagem."
    elif result["skipped"] == "already_applied":
        # NF importada ANTES de 24/08/2026: o estoque dela já entrou no import
        # pela quantidade da NF. Concluir sem lançar de novo é o correto.
        msg = (
            f"✅ NF {order.nf_number} finalizada. O estoque desta NF já havia "
            f"entrado na importação (regra anterior) — nada foi lançado de novo."
        )
    else:
        msg = f"✅ NF {order.nf_number} finalizada. Estoque não alterado ({result['skipped']})."

    return {
        "success": True,
        "confirmed": True,
        "order_id": order.id,
        "nf_number": order.nf_number,
        "message": msg,
        "stock_applied": result["applied"],
        "stock_skipped_reason": result["skipped"],
        "divergences": result["divergences"],
        **conference,
    }


@router.post("/orders/{order_id}/pause")
def pause_entry_order(
    order_id: int,
    body: dict,
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    PAUSA a conferência de uma NF de ENTRADA (24/08/2026).

    Diferente de INTERROMPER, que é carimbo definitivo (a NF não reabre e conta
    como feita): pausar deixa tudo como está — status SCANNING, bipes salvos —
    e a NF continua CONTANDO COMO EM ABERTO no kanban. Existe porque marca com
    muitos SKUs leva DIAS para ser conferida.

    Não é status: grava um marcador PAUSE como ScanningLog (quantity=0,
    is_error=False, não entra em contagem nenhuma). Reabrir pela chave da NF
    grava o RESUME correspondente. Escolhido assim para não alterar o enum
    OrderStatus no Postgres de produção.
    """
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if not _is_entrada(order):
        raise HTTPException(
            status_code=400,
            detail="Pausar só existe em NF de entrada. Na saída, use Interromper.",
        )

    order_status = order.status.value if hasattr(order.status, "value") else order.status
    if order_status in ("completed", "cancelled", "inactive"):
        raise HTTPException(
            status_code=409,
            detail=f"NF {order.nf_number} está {order_status} — não há conferência para pausar.",
        )

    db.add(models.ScanningLog(
        session_id=order.session_id,
        order_id=order.id,
        sku=PAUSE_SKU,
        barcode_scanned=PAUSE_SKU,
        quantity=0,
        operator_id=current_user.id,
        is_error=False,
        error_message=(body.get("reason") or "Conferência pausada pelo operador"),
    ))

    db.add(models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="PAUSE_ENTRY",
        detail=(
            f"Conferência de entrada da NF {order.nf_number} pausada por "
            f"{current_user.name}. Motivo: {body.get('reason') or 'não informado'}."
        ),
        user_id=current_user.id,
    ))
    db.commit()

    return {
        "success": True,
        "message": f"Conferência da NF {order.nf_number} pausada. Ela continua em aberto para retomar depois.",
        "order_id": order.id,
    }


@router.post("/sessions/{session_id}/force-complete")
def force_complete_session(
    session_id: int,
    body: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    [ADMIN] Finaliza sem bipagem todos os pedidos pendentes de um seller numa sessão.

    Comportamento idêntico à conclusão normal:
    - Status dos pedidos → COMPLETED
    - Estoque NÃO é tocado (desde 06/08/2026 a baixa acontece na importação)
    - Contador da sessão atualizado
    - Registra ScanningLog (sku=FORCE_COMPLETE) + AuditLog por pedido
    - Registra AuditLog de resumo do lote

    Body: { "seller_id": int }
    """
    seller_id = body.get("seller_id")

    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Busca pedidos não concluídos (inclui INTERRUPTED — admin pode forçar conclusão de interrompidos)
    orders_q = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(
        models.Order.session_id == session_id,
        models.Order.status.notin_([
            models.OrderStatus.COMPLETED,
            models.OrderStatus.CANCELLED,
            models.OrderStatus.INACTIVE,
        ]),
    )
    if seller_id:
        orders_q = orders_q.filter(models.Order.seller_id == seller_id)
    orders = orders_q.all()

    if not orders:
        return {"success": True, "forced": 0, "message": "Todos os pedidos já estavam concluídos"}

    forced = 0
    now = now_brasilia()
    seller_name = orders[0].seller.trade_name if orders[0].seller else f"Seller {seller_id}"

    for order in orders:
        # Muda status para COMPLETED
        order.status = models.OrderStatus.COMPLETED

        # ScanningLog especial — marca que foi forçado pelo admin
        db.add(models.ScanningLog(
            session_id=session_id,
            order_id=order.id,
            sku="FORCE_COMPLETE",
            barcode_scanned="FORCE_COMPLETE",
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            is_interrupted=False,
            error_message=f"Finalizado sem bipagem pelo admin {current_user.name}",
        ))

        # Estoque não é tocado: a NF já baixou na importação (06/08/2026).

        # AuditLog individual por pedido
        db.add(models.AuditLog(
            entity_type="Order",
            entity_id=order.id,
            action="FORCE_COMPLETE",
            detail=(
                f"Pedido NF {order.nf_number} ({order.customer_name}) "
                f"finalizado sem bipagem pelo admin. "
                f"Seller: {seller_name}. Sessão: {session_id}."
            ),
            user_id=current_user.id,
        ))
        forced += 1

    # Atualiza contadores da sessão
    session.completed_orders = db.query(models.Order).filter(
        models.Order.session_id == session_id,
        models.Order.status.in_([
            models.OrderStatus.COMPLETED,
            models.OrderStatus.INTERRUPTED,
        ]),
    ).count() + forced  # +forced pois ainda não commitou

    if session.completed_orders >= session.total_orders:
        session.status = models.SessionStatus.COMPLETED if hasattr(models, 'SessionStatus') else "completed"
        session.completed_at = now

    # AuditLog de resumo do lote
    db.add(models.AuditLog(
        entity_type="PickingSession",
        entity_id=session_id,
        action="FORCE_COMPLETE_BATCH",
        detail=(
            f"Finalização em lote sem bipagem | Admin: {current_user.name} | "
            f"Seller: {seller_name} | Pedidos forçados: {forced} | "
            f"Sessão: {session_id}"
        ),
        user_id=current_user.id,
    ))

    db.commit()

    return {
        "success": True,
        "forced": forced,
        "message": f"{forced} pedido(s) de {seller_name} finalizados sem bipagem. Estoque atualizado.",
    }


@router.post("/sessions/{session_id}/cancel-handling")
def cancel_handling_session(
    session_id: int,
    body: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    [ADMIN] Cancela todos os pedidos de um seller numa sessão — como se fossem excluídos da fila.

    Comportamento:
    - Status dos pedidos → CANCELLED
    - Estoque É ESTORNADO se a NF já tiver baixado (06/08/2026: a baixa passou
      a acontecer na importação, então até pedido PENDING pode estar baixado —
      antes desta data este endpoint nunca mexia em estoque, de propósito)
    - Contador da sessão atualizado
    - Registra ScanningLog (sku=CANCELLED) + AuditLog por pedido
    - Se todos os pedidos da sessão estiverem cancelados/concluídos → sessão → completed

    Body: { "seller_id": int }
    """
    seller_id = body.get("seller_id")

    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Busca pedidos ainda ativos do seller nessa sessão
    orders_q = db.query(models.Order).options(
        joinedload(models.Order.seller),
    ).filter(
        models.Order.session_id == session_id,
        models.Order.status.notin_([
            models.OrderStatus.COMPLETED,
            models.OrderStatus.CANCELLED,
            models.OrderStatus.INTERRUPTED,
            models.OrderStatus.INACTIVE,
        ]),
    )
    if seller_id:
        orders_q = orders_q.filter(models.Order.seller_id == seller_id)
    orders = orders_q.all()

    if not orders:
        raise HTTPException(status_code=400, detail="Nenhum pedido ativo encontrado para este seller")

    now = now_brasilia()
    seller_name = orders[0].seller.trade_name if orders[0].seller else f"Seller {seller_id}"
    cancelled = 0
    stock_reversed_count = 0
    stock_reversal_failed = []  # NFs órfãs — não foi possível confirmar reversão automática

    for order in orders:
        # Estorna ANTES de trocar o status — depois de CANCELLED o pedido
        # entra em STOCK_BLOCKED_STATUSES e a NF não pode mais ser reavaliada.
        reversed_here = False
        reversal_failed = False
        if order_has_stock_applied(order, db):
            result = reverse_stock_for_order(
                order, db,
                observation=(
                    f"ESTORNO — NF {order.nf_number} cancelada (manuseio desnecessário) por "
                    f"{current_user.name} em {now.strftime('%d/%m/%Y %H:%M')}. "
                    f"Reverte o saldo desta NF (nunca edita o movimento original)."
                ),
                operator_id=current_user.id,
            )
            if result == -1:
                reversal_failed = True
                stock_reversal_failed.append(order.nf_number)
            else:
                reversed_here = True
                stock_reversed_count += 1

        order.status = models.OrderStatus.CANCELLED

        # ScanningLog especial — cancellation admin
        db.add(models.ScanningLog(
            session_id=session_id,
            order_id=order.id,
            sku="CANCELLED",
            barcode_scanned="CANCELLED",
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            is_interrupted=False,
            error_message=f"Cancelado pelo admin {current_user.name} — manuseio desnecessário",
        ))

        # AuditLog individual
        if reversal_failed:
            estoque_detail = (
                "Não foi possível confirmar reversão automática de estoque "
                "(nenhum movimento vinculado a esta NF) — verificar manualmente."
            )
        elif reversed_here:
            estoque_detail = "Estoque revertido via movimento de estorno."
        else:
            estoque_detail = "Estoque não impactado (NF ainda não havia baixado)."
        db.add(models.AuditLog(
            entity_type="Order",
            entity_id=order.id,
            action="CANCEL_HANDLING",
            detail=(
                f"Pedido NF {order.nf_number} ({order.customer_name}) "
                f"cancelado pelo admin (manuseio desnecessário). "
                f"Seller: {seller_name}. Sessão: {session_id}. {estoque_detail}"
            ),
            user_id=current_user.id,
        ))
        cancelled += 1

    # Verifica se a sessão pode ser encerrada
    # (todos os pedidos concluídos/interrompidos/cancelados)
    active_remaining = db.query(models.Order).filter(
        models.Order.session_id == session_id,
        models.Order.status.notin_([
            models.OrderStatus.COMPLETED,
            models.OrderStatus.CANCELLED,
            models.OrderStatus.INTERRUPTED,
            models.OrderStatus.INACTIVE,
        ]),
    ).count() - cancelled  # -cancelled pois ainda não commitou

    if active_remaining <= 0:
        session.status = "completed"
        session.completed_at = now

    # AuditLog de resumo
    db.add(models.AuditLog(
        entity_type="PickingSession",
        entity_id=session_id,
        action="CANCEL_HANDLING_BATCH",
        detail=(
            f"Cancelamento em lote | Admin: {current_user.name} | "
            f"Seller: {seller_name} | Pedidos cancelados: {cancelled} | "
            f"Com reversão de estoque: {stock_reversed_count} | "
            f"Falha ao confirmar reversão: {len(stock_reversal_failed)} | Sessão: {session_id}"
        ),
        user_id=current_user.id,
    ))

    db.commit()

    message = (
        f"{cancelled} pedido(s) de {seller_name} cancelados — "
        f"{stock_reversed_count} com reversão de estoque."
    )
    if stock_reversal_failed:
        message += (
            f" ATENÇÃO: {len(stock_reversal_failed)} NF(s) sem confirmação de reversão "
            f"automática — verifique manualmente o estoque destas NFs: "
            f"{', '.join(stock_reversal_failed)}."
        )

    return {
        "success": True,
        "cancelled": cancelled,
        "stock_reversed": stock_reversed_count,
        "stock_reversal_failed": stock_reversal_failed,
        "message": message,
    }


@router.post("/sessions/{session_id}/cancel-duplicate-orders")
def cancel_duplicate_orders(
    session_id: int,
    body: dict,
    current_user: models.User = Depends(require_manager_or_above),
    user_seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """
    Cancela (soft — status vira CANCELLED, nada é apagado) os pedidos de um
    ou mais sellers dentro de uma sessão. Usado pra corrigir upload duplicado
    de arquivo (ex.: cliente subiu o mesmo Excel duas vezes).

    Diferente de /cancel-handling (admin, "manuseio desnecessário"):
    - Aceita manager (restrito aos sellers que ele atende, via user_seller_ids).
    - Aceita vários sellers de uma vez.
    - Cobre também pedidos JÁ concluídos/interrompidos: reverte o estoque
      sensibilizado criando um novo movimento de estorno (nunca apaga ou
      edita o movimento original — auditável nos dois lados).
    - Fluxo de 2 passos: sem `confirm=true`, só devolve um preview (nada é
      alterado); precisa reenviar com `confirm=true` pra executar, caso
      exista pedido já bipado (parcial ou concluído) entre os selecionados.

    Body: { "seller_ids": [int, ...], "confirm": bool = False }
    """
    seller_ids = body.get("seller_ids") or []
    confirm = bool(body.get("confirm", False))
    if not seller_ids:
        raise HTTPException(status_code=400, detail="Informe ao menos um seller_id")

    if user_seller_ids is not None:
        not_allowed = [sid for sid in seller_ids if sid not in user_seller_ids]
        if not_allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Você não tem acesso ao(s) seller(s): {not_allowed}",
            )

    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    orders = db.query(models.Order).options(
        joinedload(models.Order.seller),
    ).filter(
        models.Order.session_id == session_id,
        models.Order.seller_id.in_(seller_ids),
        models.Order.status != models.OrderStatus.CANCELLED,
        models.Order.status != models.OrderStatus.INACTIVE,
    ).all()

    if not orders:
        raise HTTPException(
            status_code=400,
            detail="Nenhum pedido ativo encontrado para os sellers informados nesta sessão",
        )

    # ── Classifica cada pedido: pendente / bipagem parcial / estoque sensibilizado ──
    preview = []
    any_needs_confirmation = False
    for order in orders:
        # ⚠️ Desde 06/08/2026 NÃO dá pra deduzir isso pelo status: a NF baixa
        # estoque na importação, então um pedido PENDING já pode estar baixado.
        stock_touched = order_has_stock_applied(order, db)
        has_real_scans = db.query(models.ScanningLog.id).filter(
            *_active_scan_filters(order)
        ).first() is not None

        if stock_touched:
            bucket = "stock_reversal"
            any_needs_confirmation = True
        elif has_real_scans:
            bucket = "partial_scan"
            any_needs_confirmation = True
        else:
            bucket = "pending"

        preview.append({
            "order_id": order.id,
            "nf_number": order.nf_number,
            "seller_id": order.seller_id,
            "seller_name": order.seller.trade_name if order.seller else None,
            "status": order.status.value if hasattr(order.status, "value") else order.status,
            "bucket": bucket,
        })

    if any_needs_confirmation and not confirm:
        return {
            "requires_confirmation": True,
            "preview": preview,
            "message": "Alguns pedidos já têm bipagem registrada. Confira antes de confirmar.",
        }

    # ── Executa ──────────────────────────────────────────────────────────────
    now = now_brasilia()
    cancelled = 0
    stock_reversed_count = 0
    stock_reversal_failed = []  # NFs órfãs — não foi possível confirmar reversão automática
    summary_lines = []
    bucket_by_order = {p["order_id"]: p["bucket"] for p in preview}

    for order in orders:
        bucket = bucket_by_order.get(order.id, "pending")
        reversal_failed = False

        if bucket == "stock_reversal":
            reversed_skus = reverse_stock_for_order(
                order, db,
                observation=(
                    f"ESTORNO — NF {order.nf_number} cancelada (duplicata) por "
                    f"{current_user.name} em {now.strftime('%d/%m/%Y %H:%M')}. "
                    f"Reverte o saldo desta NF (nunca edita o movimento original)."
                ),
                operator_id=current_user.id,
            )
            if reversed_skus == -1:
                reversal_failed = True
                stock_reversal_failed.append(order.nf_number)
                summary_lines.append(
                    f"NF {order.nf_number} foi cancelada — ATENÇÃO: não foi possível confirmar "
                    f"reversão automática de estoque (nenhum movimento vinculado a esta NF). "
                    f"Verifique manualmente."
                )
            else:
                stock_reversed_count += 1
                summary_lines.append(
                    f"NF {order.nf_number} foi cancelada — estoque revertido ({reversed_skus} SKU(s))"
                )
        elif bucket == "partial_scan":
            summary_lines.append(f"NF {order.nf_number}: bipagem parcial descartada (sem impacto de estoque)")
        else:
            summary_lines.append(f"NF {order.nf_number}: cancelada (pendente, sem impacto)")

        order.status = models.OrderStatus.CANCELLED

        db.add(models.ScanningLog(
            session_id=session_id,
            order_id=order.id,
            sku="CANCELLED",
            barcode_scanned="CANCELLED",
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            is_interrupted=False,
            error_message=f"Cancelado por {current_user.name} — pedido duplicado",
        ))

        if reversal_failed:
            estoque_detail = (
                "Não foi possível confirmar reversão automática de estoque "
                "(nenhum movimento vinculado a esta NF) — verificar manualmente."
            )
        elif bucket == "stock_reversal":
            estoque_detail = "Estoque revertido via movimento de estorno."
        else:
            estoque_detail = "Estoque não impactado (pedido não havia sido concluído)."
        db.add(models.AuditLog(
            entity_type="Order",
            entity_id=order.id,
            action="CANCEL_DUPLICATE",
            detail=(
                f"Pedido NF {order.nf_number} ({order.customer_name}) cancelado por duplicidade de upload. "
                f"Seller: {order.seller.trade_name if order.seller else order.seller_id}. Sessão: {session_id}. "
                + estoque_detail
            ),
            user_id=current_user.id,
        ))
        cancelled += 1

    db.add(models.AuditLog(
        entity_type="PickingSession",
        entity_id=session_id,
        action="CANCEL_DUPLICATE_BATCH",
        detail=(
            f"Cancelamento de pedidos duplicados em lote | Usuário: {current_user.name} | "
            f"Sellers: {seller_ids} | Pedidos cancelados: {cancelled} | "
            f"Com reversão de estoque: {stock_reversed_count} | "
            f"Falha ao confirmar reversão: {len(stock_reversal_failed)} | Sessão: {session_id}"
        ),
        user_id=current_user.id,
    ))

    db.commit()

    final_message = f"{cancelled} pedido(s) cancelado(s) — {stock_reversed_count} com reversão de estoque."
    if stock_reversal_failed:
        final_message += (
            f" ATENÇÃO: {len(stock_reversal_failed)} NF(s) sem confirmação de reversão automática "
            f"— verifique manualmente o estoque destas NFs: {', '.join(stock_reversal_failed)}."
        )

    return {
        "requires_confirmation": False,
        "cancelled": cancelled,
        "stock_reversed": stock_reversed_count,
        "stock_reversal_failed": stock_reversal_failed,
        "summary": summary_lines,
        "message": final_message,
    }


@router.post("/orders/{order_id}/deactivate")
def deactivate_order(
    order_id: int,
    body: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    [ADMIN] Inativa uma NF individual — botão rápido do Scanner/Pedidos.

    Funciona em qualquer status. Se o pedido já tinha baixado estoque
    (completed/interrupted), reverte com um movimento de estorno — mesma
    lógica de cancel_duplicate_orders, sem editar/apagar o movimento
    original. Fica invisível em toda a operação (Pedidos, Manuseios,
    Dashboard, Scanner) — só reaparece via o toggle "Mostrar NFs inativas"
    (admin) e na Trilha de Auditoria.

    Body: { "reason": str } — motivo obrigatório, vai para o AuditLog.
    """
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Informe o motivo da inativação")

    order = db.query(models.Order).options(
        joinedload(models.Order.seller),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if order.status == models.OrderStatus.INACTIVE:
        raise HTTPException(status_code=400, detail="Este pedido já está inativo")
    if order.status == models.OrderStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Este pedido já está cancelado")

    now = now_brasilia()
    seller_name = order.seller.trade_name if order.seller else f"Seller {order.seller_id}"

    # ⚠️ Não olhar o status aqui: desde 06/08/2026 a NF baixa estoque na
    # importação, então PENDING já pode estar baixado.
    stock_reversed = False
    stock_reversal_failed = False
    if order_has_stock_applied(order, db):
        reversed_skus = reverse_stock_for_order(
            order, db,
            observation=(
                f"ESTORNO — NF {order.nf_number} inativada por {current_user.name} "
                f"em {now.strftime('%d/%m/%Y %H:%M')}. Motivo: {reason}. "
                f"Reverte o saldo desta NF (nunca edita o movimento original)."
            ),
            operator_id=current_user.id,
        )
        if reversed_skus == -1:
            stock_reversal_failed = True
        else:
            stock_reversed = reversed_skus > 0

    order.status = models.OrderStatus.INACTIVE

    if order.session_id:
        db.add(models.ScanningLog(
            session_id=order.session_id,
            order_id=order.id,
            sku="INACTIVE",
            barcode_scanned="INACTIVE",
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            is_interrupted=False,
            error_message=f"Inativado pelo admin {current_user.name} — motivo: {reason}",
        ))

    if stock_reversal_failed:
        estoque_detail = (
            "Não foi possível confirmar reversão automática de estoque "
            "(nenhum movimento vinculado a esta NF) — verificar manualmente."
        )
    elif stock_reversed:
        estoque_detail = "Estoque revertido via movimento de estorno."
    else:
        estoque_detail = "Estoque não impactado (pedido ainda não havia sido concluído)."
    db.add(models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="DEACTIVATE_NF",
        detail=(
            f"NF {order.nf_number} ({order.customer_name}) inativada por {current_user.name}. "
            f"Seller: {seller_name}. Motivo: {reason}. " + estoque_detail
        ),
        user_id=current_user.id,
    ))

    db.commit()

    message = f"NF {order.nf_number} inativada"
    if stock_reversal_failed:
        message += (
            " — ATENÇÃO: não foi possível confirmar reversão automática de estoque "
            "(nenhum movimento vinculado a esta NF). Verifique manualmente."
        )
    elif stock_reversed:
        message += " — estoque revertido."
    else:
        message += "."

    return {
        "success": True,
        "message": message,
        "stock_reversed": stock_reversed,
        "stock_reversal_failed": stock_reversal_failed,
    }


@router.post("/orders/{order_id}/reactivate")
def reactivate_order(
    order_id: int,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    [ADMIN] Reativa uma NF inativada. Sempre volta para `pending`, do zero —
    nunca restaura o status/andamento anterior de bipagem.

    `reactivated_at` marca o corte de ciclo da BIPAGEM: os scans anteriores
    deixam de contar para o progresso deste pedido.

    Estoque (06/08/2026): a NF volta a baixar NA HORA, se estiver liberada
    (tem transportadora e todos os SKUs cadastrados). Não espera bipagem —
    a baixa deixou de acontecer lá. Se estiver pendente, baixa sozinha
    quando a pendência for resolvida.
    """
    order = db.query(models.Order).options(
        joinedload(models.Order.seller),
        joinedload(models.Order.items),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if order.status != models.OrderStatus.INACTIVE:
        raise HTTPException(status_code=400, detail="Este pedido não está inativo")

    now = now_brasilia()
    seller_name = order.seller.trade_name if order.seller else f"Seller {order.seller_id}"

    order.status = models.OrderStatus.PENDING
    order.reactivated_at = now

    # Volta a baixar estoque imediatamente (só desta NF).
    stock_report = apply_stock_for_order(order, db, operator_id=current_user.id)
    stock_applied = order.id in stock_report["applied"]
    stock_pending = stock_report["pending"][0] if stock_report["pending"] else None

    if order.session_id:
        db.add(models.ScanningLog(
            session_id=order.session_id,
            order_id=order.id,
            sku="REACTIVATED",
            barcode_scanned="REACTIVATED",
            quantity=0,
            operator_id=current_user.id,
            is_error=False,
            is_interrupted=False,
            error_message=f"Reativado pelo admin {current_user.name}",
        ))

    db.add(models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="REACTIVATE_NF",
        detail=(
            f"NF {order.nf_number} ({order.customer_name}) reativada por {current_user.name}. "
            f"Seller: {seller_name}. Voltou como pendente — bipagem anterior não conta mais. "
            + ("Estoque baixado novamente." if stock_applied
               else "Estoque NÃO baixado: NF pendente (falta transportadora ou produto cadastrado).")
        ),
        user_id=current_user.id,
    ))

    db.commit()

    return {
        "success": True,
        "message": (
            f"NF {order.nf_number} reativada — voltou para pendente."
            + (" Estoque baixado novamente." if stock_applied
               else " Atenção: estoque não baixou (NF pendente).")
        ),
        "stock_applied": stock_applied,
        "stock_pending": stock_pending,
        "negatives": stock_report["negatives"],
    }


@router.get("/audit-log")
def get_audit_log(
    session_id: Optional[int] = None,
    order_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = Query(default=200, le=5000),
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """Retorna trilha de auditoria completa da bipagem."""
    query = db.query(models.ScanningLog).options(
        joinedload(models.ScanningLog.operator),
        joinedload(models.ScanningLog.order).joinedload(models.Order.seller),
    )

    if session_id:
        query = query.filter(models.ScanningLog.session_id == session_id)
    if order_id:
        query = query.filter(models.ScanningLog.order_id == order_id)
    if operator_id:
        query = query.filter(models.ScanningLog.operator_id == operator_id)
    if date_from:
        query = query.filter(models.ScanningLog.timestamp >= date_from)
    if date_to:
        # Usa o fim do dia (23:59:59) — senão "timestamp <= date_to" equivale a
        # comparar com date_to 00:00:00 e descarta TODAS as bipagens daquele dia.
        query = query.filter(models.ScanningLog.timestamp <= end_of_day(date_to))

    logs = query.order_by(models.ScanningLog.timestamp.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d/%m/%Y %H:%M:%S"),
            "order_nf": log.order.nf_number if log.order else None,
            "order_customer": log.order.customer_name if log.order else None,
            "seller_name": (log.order.seller.trade_name if log.order and log.order.seller else None),
            "sku": log.sku,
            "barcode": log.barcode_scanned,
            "quantity": log.quantity,
            "operator": log.operator.name if log.operator else None,
            "is_error": log.is_error,
            "is_interrupted": log.is_interrupted,
            "error_message": log.error_message,
        }
        for log in logs
    ]


@router.get("/interrupted-orders")
def get_interrupted_orders(
    unit_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = Query(default=500, le=5000),
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Retorna o histórico completo de pedidos interrompidos (marcador sku='INTERRUPT' em ScanningLog)."""
    query = db.query(models.ScanningLog).options(
        joinedload(models.ScanningLog.operator),
        joinedload(models.ScanningLog.order).joinedload(models.Order.seller).joinedload(models.Seller.unit),
    ).filter(models.ScanningLog.sku == "INTERRUPT")

    if operator_id:
        query = query.filter(models.ScanningLog.operator_id == operator_id)
    if date_from:
        query = query.filter(models.ScanningLog.timestamp >= date_from)
    if date_to:
        query = query.filter(models.ScanningLog.timestamp <= end_of_day(date_to))
    if seller_id or unit_id:
        query = query.join(models.ScanningLog.order)
        if seller_id:
            query = query.filter(models.Order.seller_id == seller_id)
        if unit_id:
            query = query.join(models.Order.seller).filter(models.Seller.unit_id == unit_id)

    logs = query.order_by(models.ScanningLog.timestamp.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d/%m/%Y %H:%M:%S"),
            "order_nf": log.order.nf_number if log.order else None,
            "order_customer": log.order.customer_name if log.order else None,
            "seller_name": (log.order.seller.trade_name if log.order and log.order.seller else None),
            "unit_name": (log.order.seller.unit.name if log.order and log.order.seller and log.order.seller.unit else None),
            "operator": log.operator.name if log.operator else None,
            "reason": log.error_message,
        }
        for log in logs
    ]


# ============================================================
# STATUS DAS NFs (aba "Status das NFs" da Auditoria)
# ============================================================

# Intervalo maximo aceito no filtro de datas. Existe para nao varrer
# orders/order_items/scanning_logs de um periodo longo numa unica request.
NF_STATUS_MAX_DAYS = 7
# Teto de linhas. A TELA e o CSV usam o mesmo teto de proposito: o CSV tem
# que ser exatamente o que o usuario esta vendo antes de mandar pro cliente.
NF_STATUS_LIMIT = 500

_NF_STATUS_SITUACAO = {
    "COMPLETED": "1 - FINALIZADA",
    "INTERRUPTED": "2 - INTERROMPIDA (conta como feita)",
    "SCANNING": "3 - EM BIPAGEM (comecou, nao terminou)",
}


def _nf_status_rows(
    db: Session,
    seller_id: int,
    date_from: date,
    date_to: date,
    limit: int = NF_STATUS_LIMIT,
) -> tuple[list[dict], int]:
    """
    Monta a lista NF a NF de um seller num intervalo de upload (`imported_at`).

    Devolve (linhas, total_sem_limite). Nao faz N+1: as somas de itens e de
    bipagem saem de duas queries agrupadas por order_id.
    """
    base = db.query(models.Order).filter(
        models.Order.seller_id == seller_id,
        models.Order.status != models.OrderStatus.CANCELLED,
        models.Order.status != models.OrderStatus.INACTIVE,
        models.Order.imported_at >= date_from,
        models.Order.imported_at <= end_of_day(date_to),
    )

    total = base.count()
    orders = base.order_by(
        models.Order.imported_at.desc(), models.Order.nf_number
    ).limit(limit).all()

    if not orders:
        return [], total

    order_ids = [o.id for o in orders]

    # Itens previstos por pedido
    itens_map = dict(
        db.query(
            models.OrderItem.order_id,
            func.sum(models.OrderItem.quantity),
        )
        .filter(models.OrderItem.order_id.in_(order_ids))
        .group_by(models.OrderItem.order_id)
        .all()
    )

    # Bipagem real: exclui erro e o marcador de interrupcao (sku='INTERRUPT').
    # coalesce porque registros antigos tem NULL nesses booleanos.
    scan_ok = [
        func.coalesce(models.ScanningLog.is_error, False) == False,        # noqa: E712
        func.coalesce(models.ScanningLog.is_interrupted, False) == False,  # noqa: E712
    ]

    bip_map = {
        row[0]: (row[1], row[2])
        for row in db.query(
            models.ScanningLog.order_id,
            func.sum(models.ScanningLog.quantity),
            func.max(models.ScanningLog.timestamp),
        )
        .filter(models.ScanningLog.order_id.in_(order_ids), *scan_ok)
        .group_by(models.ScanningLog.order_id)
        .all()
    }

    # Operador do ultimo scan de cada pedido: ordena crescente e deixa o
    # ultimo sobrescrever, evitando uma subquery correlacionada por pedido.
    operador_map: dict[int, str] = {}
    for order_id, operator_name in (
        db.query(models.ScanningLog.order_id, models.User.name)
        .join(models.User, models.User.id == models.ScanningLog.operator_id)
        .filter(models.ScanningLog.order_id.in_(order_ids), *scan_ok)
        .order_by(models.ScanningLog.timestamp)
        .all()
    ):
        operador_map[order_id] = operator_name

    rows = []
    for o in orders:
        status_raw = (o.status.value if hasattr(o.status, "value") else o.status) or ""
        status_raw = status_raw.upper()
        bipado, ultimo_scan = bip_map.get(o.id, (None, None))
        rows.append({
            "order_id": o.id,
            "nf": o.nf_number,
            "situacao": _NF_STATUS_SITUACAO.get(status_raw, "4 - NAO BIPADA"),
            "cliente_final": o.customer_name,
            "transportadora": o.carrier,
            "itens_previstos": int(itens_map.get(o.id) or 0),
            "itens_bipados": int(bipado or 0),
            "ultimo_scan": ultimo_scan.strftime("%d/%m/%Y %H:%M:%S") if ultimo_scan else None,
            "operador": operador_map.get(o.id),
            "chave_danfe": o.danfe_key,
            "data_nf": o.order_date.strftime("%d/%m/%Y") if o.order_date else None,
            "importado_em": o.imported_at.strftime("%d/%m/%Y %H:%M:%S") if o.imported_at else None,
            "sessao": o.session_id,
            "status_bruto": status_raw,
        })

    return rows, total


def _nf_status_validate(
    db: Session,
    allowed_seller_ids: Optional[List[int]],
    seller_id: int,
    date_from: date,
    date_to: date,
) -> models.Seller:
    """Valida intervalo e escopo do seller. Devolve o seller."""
    if date_to < date_from:
        raise HTTPException(
            status_code=400,
            detail="A data final nao pode ser anterior a data inicial.",
        )
    if (date_to - date_from).days > NF_STATUS_MAX_DAYS - 1:
        raise HTTPException(
            status_code=400,
            detail=f"Intervalo maximo de {NF_STATUS_MAX_DAYS} dias. Reduza o periodo.",
        )

    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    if not seller:
        raise HTTPException(status_code=404, detail=f"Seller {seller_id} nao encontrado")

    # None = admin (convencao do token). Lista = escopo restrito.
    if allowed_seller_ids is not None and seller_id not in allowed_seller_ids:
        raise HTTPException(
            status_code=403,
            detail="Voce nao tem acesso a este seller.",
        )
    return seller


@router.get("/nf-status")
def get_nf_status(
    seller_id: int = Query(...),
    date_from: date = Query(...),
    date_to: date = Query(...),
    current_user: models.User = Depends(require_manager_or_above),
    allowed_seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """
    Status NF a NF de um seller: quais ja foram bipadas/finalizadas e quais nao.

    Filtra pela data de UPLOAD (`imported_at`), como o Dashboard — nao pela
    data da NF. Pedido cancelado nao aparece.
    """
    _nf_status_validate(db, allowed_seller_ids, seller_id, date_from, date_to)
    rows, total = _nf_status_rows(db, seller_id, date_from, date_to)
    return {
        "rows": rows,
        "total": total,
        "limit": NF_STATUS_LIMIT,
        "truncated": total > len(rows),
    }


@router.get("/nf-status/export/csv")
def export_nf_status_csv(
    seller_id: int = Query(...),
    date_from: date = Query(...),
    date_to: date = Query(...),
    current_user: models.User = Depends(require_manager_or_above),
    allowed_seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """Exporta em CSV exatamente as mesmas linhas de `GET /scanning/nf-status`."""
    seller = _nf_status_validate(db, allowed_seller_ids, seller_id, date_from, date_to)
    rows, _ = _nf_status_rows(db, seller_id, date_from, date_to)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow([
        "NF", "Situacao", "Cliente Final", "Transportadora",
        "Itens Previstos", "Itens Bipados", "Ultimo Scan", "Operador",
        "Chave DANFE", "Data NF", "Importado em", "Sessao", "Status Bruto",
    ])
    for r in rows:
        writer.writerow([
            r["nf"], r["situacao"], r["cliente_final"] or "", r["transportadora"] or "",
            r["itens_previstos"], r["itens_bipados"], r["ultimo_scan"] or "",
            r["operador"] or "", r["chave_danfe"] or "", r["data_nf"] or "",
            r["importado_em"] or "", r["sessao"] or "", r["status_bruto"],
        ])

    output.seek(0)
    nome = (seller.trade_name or seller.name or str(seller_id)).replace(" ", "_")
    filename = f"status_nfs_{nome}_{date_from.isoformat()}_a_{date_to.isoformat()}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/system-audit-log")
def get_system_audit_log(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    user_id_filter: Optional[int] = Query(default=None, alias="user_id"),
    limit: int = Query(default=500, le=5000),
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Retorna a trilha de auditoria completa do sistema.
    Registra TODAS as ações: cadastros, uploads, mudanças de estoque,
    interrupções, configurações — não apenas bipagens.
    """
    from datetime import datetime as _dt
    query = db.query(models.AuditLog).options(
        joinedload(models.AuditLog.user)
    )

    if date_from:
        query = query.filter(models.AuditLog.timestamp >= date_from)
    if date_to:
        # Inclui o dia inteiro até 23:59:59
        day_end = _dt.combine(date_to, _dt.max.time())
        query = query.filter(models.AuditLog.timestamp <= day_end)
    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(models.AuditLog.action == action)
    if user_id_filter:
        query = query.filter(models.AuditLog.user_id == user_id_filter)

    logs = query.order_by(models.AuditLog.timestamp.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d/%m/%Y %H:%M:%S") if log.timestamp else None,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "action": log.action,
            "detail": log.detail,
            "user": log.user.name if log.user else "Sistema",
            "user_id": log.user_id,
        }
        for log in logs
    ]


@router.get("/productivity")
def operator_productivity(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    unit_id: Optional[int] = None,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Relatório de produtividade por operador.

    Conta apenas BIPAGENS REAIS: registros de erro (código que não pertence ao
    pedido) e o marcador de interrupção (sku='INTERRUPT', quantity=0) ficam de
    fora — senão errar muito aumentaria a "produtividade" do operador. É o mesmo
    par de filtros usado para contar bipagem no process_scan.
    """
    query = db.query(
        models.User.name.label("operator"),
        func.count(models.ScanningLog.id).label("total_scans"),
        func.sum(models.ScanningLog.quantity).label("total_items"),
    ).join(
        models.ScanningLog, models.User.id == models.ScanningLog.operator_id
    ).filter(
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
        # Pausar/retomar não é bipagem — ver MARKER_SKUS.
        models.ScanningLog.sku.notin_(MARKER_SKUS),
    ).group_by(models.User.id, models.User.name)

    # Manager enxerga só os operadores da própria unidade; admin vê todas.
    user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if user_role != "admin":
        query = query.filter(models.User.unit_id == current_user.unit_id)

    if date_from:
        query = query.filter(models.ScanningLog.timestamp >= date_from)
    if date_to:
        # end_of_day é obrigatório: a tela abre com date_to = hoje, e
        # 'timestamp <= hoje 00:00:00' excluiria todas as bipagens do dia.
        query = query.filter(models.ScanningLog.timestamp <= end_of_day(date_to))

    results = query.all()

    return [
        {
            "operator": r.operator,
            "total_scans": r.total_scans,
            "total_items": int(r.total_items or 0),
        }
        for r in results
    ]



def _save_audit_csv(log: models.ScanningLog, order: models.Order, user: models.User) -> None:
    """
    Grava trilha de auditoria em CSV particionado por seller/data.
    Formato: data/audit/<seller_trade_name>/<YYYYMMDD>/bipagem.csv
    Colunas: timestamp, nf_number, customer_name, sku, barcode_scanned,
             quantity, is_error, error_message, operator
    """
    import csv
    from datetime import datetime as _dt

    try:
        BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        audit_root = os.path.join(BASE_DIR, "data", "audit")

        seller_name = (
            order.seller.trade_name.replace(" ", "_")
            if order.seller and order.seller.trade_name
            else "SEM_SELLER"
        )
        date_str = now_brasilia().strftime("%Y%m%d")
        audit_dir = os.path.join(audit_root, seller_name, date_str)
        os.makedirs(audit_dir, exist_ok=True)

        csv_path = os.path.join(audit_dir, "bipagem.csv")
        file_exists = os.path.exists(csv_path)

        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow([
                    "timestamp", "nf_number", "customer_name",
                    "sku", "barcode_scanned", "quantity",
                    "is_error", "error_message", "operator",
                ])
            writer.writerow([
                now_brasilia().strftime("%Y-%m-%d %H:%M:%S"),
                order.nf_number,
                order.customer_name,
                log.sku,
                log.barcode_scanned,
                log.quantity,
                log.is_error,
                log.error_message or "",
                user.name if user else "desconhecido",
            ])
    except Exception as _e:
        # Auditoria nunca pode quebrar o fluxo de bipagem
        print(f"[audit_csv] erro ao gravar: {_e}")


# ============================================================
# Funções auxiliares
# ============================================================

def _active_scan_filters(order: models.Order) -> list:
    """
    Filtros padrão de 'bipagem real' de um pedido — exclui erro/interrupção e,
    se a NF já foi reativada depois de inativada, ignora bipagem anterior ao
    corte do ciclo novo (order.reactivated_at). Ver deactivate_order/
    reactivate_order.

    ⚠️ `reactivated_at` hoje é corte só de BIPAGEM. O estoque não depende mais
    dele: quem responde "esta NF está baixada?" é order.stock_applied_at
    (ver services/stock_manager.py, mudança de 06/08/2026).
    """
    filters = [
        models.ScanningLog.order_id == order.id,
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
        # Marcadores de pausa/retomada não são bipagem — ver MARKER_SKUS.
        models.ScanningLog.sku.notin_(MARKER_SKUS),
    ]
    if order.reactivated_at:
        filters.append(models.ScanningLog.timestamp > order.reactivated_at)
    return filters


def _get_deactivation_admin_name(order_id: int, db: Session) -> str:
    """Nome do admin que inativou a NF pela última vez, via AuditLog — usado
    nas mensagens de rejeição quando alguém tenta biper uma NF inativa."""
    log = db.query(models.AuditLog).filter(
        models.AuditLog.entity_type == "Order",
        models.AuditLog.entity_id == order_id,
        models.AuditLog.action == "DEACTIVATE_NF",
    ).order_by(models.AuditLog.id.desc()).first()
    if log and log.user_id:
        user = db.query(models.User).filter(models.User.id == log.user_id).first()
        if user:
            return user.name
    return "um administrador"


def _paused_order_ids(db: Session, order_ids: List[int]) -> set:
    """
    Quais destes pedidos estão PAUSADOS agora — em 2 consultas, nunca 1 por
    pedido (ver CLAUDE.md sobre N+1 nas telas de manuseio).

    Pausa não é status: é o último marcador PAUSE/RESUME gravado como
    ScanningLog. Foi a forma escolhida em 24/08/2026 para não precisar alterar
    o enum OrderStatus no Postgres de produção. Se o último marcador é PAUSE,
    está pausado; se é RESUME (ou não há marcador), não está.
    """
    if not order_ids:
        return set()

    # id do último marcador de cada pedido
    last_ids = [
        row[0] for row in db.query(func.max(models.ScanningLog.id)).filter(
            models.ScanningLog.order_id.in_(order_ids),
            models.ScanningLog.sku.in_([PAUSE_SKU, RESUME_SKU]),
        ).group_by(models.ScanningLog.order_id).all()
    ]
    if not last_ids:
        return set()

    return {
        row[0] for row in db.query(models.ScanningLog.order_id).filter(
            models.ScanningLog.id.in_(last_ids),
            models.ScanningLog.sku == PAUSE_SKU,
        ).all()
    }


def _is_paused(order: models.Order, db: Session) -> bool:
    """Versão de UM pedido — usar _paused_order_ids em lista/card."""
    return order.id in _paused_order_ids(db, [order.id])


def _expected_by_sku(order: models.Order) -> dict:
    """
    Quanto o pedido espera de CADA SKU. Consolida itens repetidos: o mesmo SKU
    pode aparecer em dois OrderItem (componente de kit + linha avulsa — ver
    CLAUDE.md), e nesse caso o esperado do SKU é a soma dos dois.
    """
    expected = {}
    for item in order.items:
        expected[item.sku] = expected.get(item.sku, 0) + item.quantity
    return expected


def _scanned_by_sku(order: models.Order, db: Session) -> dict:
    """Quanto já foi bipado de cada SKU — 1 consulta agrupada, nunca 1 por item."""
    return {
        sku: int(total or 0)
        for sku, total in db.query(
            models.ScanningLog.sku,
            func.sum(models.ScanningLog.quantity),
        ).filter(
            *_active_scan_filters(order)
        ).group_by(models.ScanningLog.sku).all()
    }


def _remaining_from(expected: dict, scanned: dict) -> int:
    """
    Soma o que falta, SKU a SKU.

    ⚠️ Contar pelo total do pedido (soma de tudo esperado menos soma de tudo
    bipado) dá resultado errado desde que a entrada passou a aceitar excedente
    (17/08/2026): 200 peças a mais de um SKU compensavam 200 que faltavam de
    outro, e o pedido fechava com item nunca conferido. Só o excedente é
    descartado aqui — o resto continua exigindo bipagem.
    """
    return sum(
        max(0, qty - scanned.get(sku, 0))
        for sku, qty in expected.items()
    )


def _count_remaining(order: models.Order, db: Session) -> int:
    """Conta itens restantes para bipar no pedido."""
    return _remaining_from(_expected_by_sku(order), _scanned_by_sku(order, db))


def _count_remaining_after_scan(
    order: models.Order,
    just_scanned_sku: str,
    db: Session,
    just_scanned_qty: int = 1,
) -> int:
    """
    Conta itens restantes considerando o bipe que acabou de acontecer.

    `just_scanned_qty` é a quantidade deste bipe (1 na saída; pode ser N na
    entrada, onde o operador digita a quantidade da caixa). O log ainda não foi
    commitado, por isso ele entra na conta à mão.
    """
    scanned = _scanned_by_sku(order, db)
    scanned[just_scanned_sku] = scanned.get(just_scanned_sku, 0) + just_scanned_qty
    return _remaining_from(_expected_by_sku(order), scanned)


def _build_progress(order: models.Order, db: Session) -> dict:
    """Constrói objeto de progresso do pedido — retorna dict com scanned/qty por SKU."""
    # 1 consulta agrupada por SKU em vez de 1 por item (N+1 — ver CLAUDE.md).
    scanned_by_sku = dict(
        db.query(
            models.ScanningLog.sku,
            func.sum(models.ScanningLog.quantity),
        ).filter(
            *_active_scan_filters(order)
        ).group_by(models.ScanningLog.sku).all()
    )

    items_progress = []
    for item in order.items:
        scanned = scanned_by_sku.get(item.sku, 0) or 0
        items_progress.append({
            "sku": item.sku,
            "product_name": item.product_name,
            "quantity": item.quantity,
            "scanned": int(scanned),
            "done": int(scanned) >= item.quantity,
        })

    total = sum(i["quantity"] for i in items_progress)
    total_scanned = sum(i["scanned"] for i in items_progress)

    return {
        "items": items_progress,
        "total": total,
        "scanned": total_scanned,
        "pct": round(total_scanned / total * 100) if total > 0 else 0,
        "complete": total_scanned >= total,
    }


# ============================================================
# CARDS DE MANUSEIO — quebrado por sessão + seller
# ============================================================

@router.get("/session-cards")
def session_cards(
    unit_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna uma lista de cards, um por (session, seller).
    Se um upload contém 3 sellers, retorna 3 cards separados.
    Cada card tem contagens de pedidos e status derivado dessa combinação.
    """
    from sqlalchemy.orm import joinedload as _jl

    user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role

    # Sellers vinculados ao usuário logado (operador ou gerente).
    # Usado para filtrar cards no nível do servidor — mais seguro que filtrar no frontend.
    my_seller_ids: list[int] = []
    if user_role in ("operator", "manager"):
        my_seller_ids = [s.id for s in (current_user.sellers or [])]

    # Busca sessões com filtros de data/unidade
    q = db.query(models.PickingSession).options(
        _jl(models.PickingSession.orders).joinedload(models.Order.seller)
    )

    # Filtra sessões:
    # - Operador/Gerente com sellers vinculados → só sessões que contenham seus sellers
    # - Admin com unit_id explícito → filtra por sellers da unidade
    # NÃO usa PickingSession.unit_id pois pode estar desatualizado (importado pelo admin)
    from sqlalchemy import exists as _exists

    # Quando o filtro por unidade é usado (ramo abaixo), guarda o conjunto de
    # seller_ids da unidade para re-aplicar o filtro por CARD (não só por sessão) —
    # uma sessão/upload pode conter sellers de unidades diferentes misturados,
    # e sem isso o card de um seller de outra unidade vaza para este filtro.
    allowed_seller_ids_for_unit: Optional[set] = None

    if user_role in ("operator", "manager") and my_seller_ids:
        q = q.filter(
            _exists().where(
                (models.Order.session_id == models.PickingSession.id) &
                (models.Order.seller_id.in_(my_seller_ids))
            )
        )
    elif unit_id:
        # Admin filtrou por unidade explicitamente: restringe via sellers da unidade
        seller_ids_in_unit = [
            row[0] for row in db.query(models.Seller.id).filter(
                models.Seller.unit_id == unit_id,
                models.Seller.active == True,
            ).all()
        ]
        allowed_seller_ids_for_unit = set(seller_ids_in_unit)
        q = q.filter(
            _exists().where(
                (models.Order.session_id == models.PickingSession.id) &
                (models.Order.seller_id.in_(seller_ids_in_unit))
            )
        )

    if date_from:
        q = q.filter(models.PickingSession.session_date >= date_from)
    if date_to:
        q = q.filter(models.PickingSession.session_date <= date_to)

    # ⚠️ O teto de 100 sessões só vale quando NÃO há filtro de data.
    #
    # Era um `limit(100)` fixo, aplicado DEPOIS do filtro de período: com ~15
    # sessões por dia útil, qualquer intervalo acima de ~6 dias descartava as
    # sessões mais antigas EM SILÊNCIO e a tela mostrava totais menores que a
    # realidade (01/08→31/08 mostrava 3.210 de 14.303 pedidos, ~22%).
    # Havendo `date_from`, o próprio período já limita o volume; sem ele o teto
    # continua protegendo contra varrer o histórico inteiro.
    q = q.order_by(models.PickingSession.created_at.desc())
    if not date_from:
        q = q.limit(100)
    sessions = q.all()

    # NFs seguradas por falta de produto cadastrado — ficam fora do manuseio.
    # UMA consulta para todas as sessões da tela (não uma por card/pedido).
    all_order_ids = [o.id for s in sessions for o in s.orders]
    held_ids = set(orders_missing_product_skus(db, all_order_ids).keys())

    # Conferências de entrada pausadas — UMA consulta para a tela inteira, pelo
    # mesmo motivo de held_ids (nunca uma por card/pedido). NF pausada continua
    # contando como EM ABERTO; isto aqui só alimenta o aviso do card.
    paused_ids = _paused_order_ids(db, all_order_ids)

    cards = []
    for session in sessions:
        # Agrupa ordens por seller dentro desta sessão
        seller_orders: dict = {}
        for order in session.orders:
            sid = order.seller_id

            # ── Seller inativo não aparece na operação ──────────────────────────
            # Ver CLAUDE.md. Pedido sem seller (anomalia de dados) segue visível
            # como "Sem seller" — escondê-lo tornaria a anomalia invisível.
            if order.seller is not None and not order.seller.active:
                continue
            # ───────────────────────────────────────────────────────────────────

            # ── Filtra por sellers vinculados (operador e gerente) ──────────────
            # Se my_seller_ids está vazio e o usuário é operador/gerente, não exibe nada
            # (usuário sem sellers vinculados → kanban vazio, não tudo)
            if user_role in ("operator", "manager"):
                if not my_seller_ids or sid not in my_seller_ids:
                    continue
            # ───────────────────────────────────────────────────────────────────

            # ── Filtra por unidade no nível do card (não só da sessão) ──────────
            # Sessão pode ter sellers de unidades diferentes no mesmo upload —
            # o card só deve valer para o filtro se o PRÓPRIO seller é da unidade.
            if allowed_seller_ids_for_unit is not None and sid not in allowed_seller_ids_for_unit:
                continue
            # ───────────────────────────────────────────────────────────────────

            if sid not in seller_orders:
                seller_orders[sid] = {
                    "seller_id": sid,
                    "seller_name": order.seller.trade_name if order.seller else "Sem seller",
                    "orders": [],
                }
            seller_orders[sid]["orders"].append(order)

        # Se a sessão não tem ordens visíveis para este usuário, pula
        if not seller_orders:
            continue

        for sid, info in seller_orders.items():
            all_orders = info["orders"]

            # Exclui pedidos cancelados do total visível no kanban.
            # Se TODOS estiverem cancelados/inativos → não exibe o card.
            active_orders = [
                o for o in all_orders
                if (o.status.value if hasattr(o.status, "value") else o.status) not in ("cancelled", "inactive")
            ]
            if not active_orders:
                continue  # seller totalmente cancelado/inativo — remove o card

            # NF com SKU sem produto cadastrado sai do manuseio e dos totais —
            # é impossível de bipar. Fica contabilizada em `held_orders` para o
            # card poder avisar que ela existe. Volta sozinha ao cadastrar.
            held_here = [o for o in active_orders if o.id in held_ids]
            active_orders = [o for o in active_orders if o.id not in held_ids]
            if not active_orders:
                # Tudo que sobrou está segurado — o card ainda aparece, mas só
                # para mostrar a pendência (senão o seller sumiria do kanban).
                held_only_card = True
            else:
                held_only_card = False

            orders = active_orders
            total = len(orders)

            # Concluído / interrompido contam como "feitos" no kanban
            completed = sum(
                1 for o in orders
                if (o.status.value if hasattr(o.status, "value") else o.status) in ("completed", "interrupted")
            )
            # ⚠️ O status é "scanning" — "in_progress" NÃO existe no OrderStatus.
            # Comparando com o nome errado esta contagem era sempre 0, e a NF que
            # estava aberta na bancada caía em `pending`: o card só saía de
            # "A Iniciar" quando a PRIMEIRA NF fosse concluída.
            in_prog = sum(
                1 for o in orders
                if (o.status.value if hasattr(o.status, "value") else o.status) == "scanning"
            )

            if completed == total and total > 0:
                status = "completed"
            elif completed > 0 or in_prog > 0:
                status = "in_progress"
            else:
                status = "pending"

            pending = total - completed - in_prog

            # Conferências de entrada pausadas neste card.
            paused = sum(1 for o in orders if o.id in paused_ids)

            # Pedidos sem transportadora — bloqueados pra bipagem (ver
            # open_order_by_nfe/process_scan). Reaproveita o loop de `orders`
            # já em memória, sem query nova.
            #
            # ⚠️ Na ENTRADA a transportadora deixou de bloquear (24/08/2026),
            # então contar aqui mostraria um impedimento que não existe mais.
            pending_carrier = sum(
                1 for o in orders if not o.carrier and not _is_entrada(o)
            )

            # Derive unit from seller relationship
            unit_id_val = None
            unit_name_val = None
            if info["orders"]:
                first_order = info["orders"][0]
                if first_order.seller and first_order.seller.unit_id:
                    unit_id_val = first_order.seller.unit_id
                if first_order.seller and first_order.seller.unit:
                    unit_name_val = first_order.seller.unit.name

            ft_val = session.file_type.value if hasattr(session.file_type, "value") else session.file_type
            file_type_val = "entrada" if (ft_val or "").lower() == "entrada" else "saida"

            cards.append({
                "card_id": f"{session.id}_{sid}",
                "session_id": session.id,
                "seller_id": sid,
                "seller_name": info["seller_name"],
                "session_date": str(session.session_date),
                "created_at": session.created_at.isoformat() if session.created_at else None,
                "unit_id": unit_id_val,
                "unit_name": unit_name_val,
                "status": status,
                "file_type": file_type_val,
                "total_orders": total,
                "completed_orders": completed,
                "in_progress_orders": in_prog,
                "pending_orders": pending,
                "pending_carrier_orders": pending_carrier,
                # Conferências de entrada pausadas — já contadas em
                # pending_orders (continuam em aberto); serve só para o badge.
                "paused_orders": paused,
                # NFs fora do manuseio por falta de produto cadastrado.
                # Não entram em total_orders nem no progresso.
                "held_orders": len(held_here),
                "held_only": held_only_card,
            })

    return cards




# ============================================================
# CAIXA SUGERIDA
# ============================================================

def _suggest_box_for_order(order, db) -> str | None:
    """
    Calcula a caixa sugerida para um pedido usando o algoritmo de caixa do seller.

    Lógica:
        num_products = soma das quantidades de todos os itens do pedido
        score        = soma de (quantidade × box_type_do_produto) por item
                       O box_type do produto (ex: "1", "2") representa o "peso" do produto
                       Ex: 3 itens com box_type=1 → score=3
                           2 itens box_type=1 + 1 item box_type=2 → score=4

    Busca em BoxAlgorithm o registro onde (seller_id, num_products, score) coincide.
    """
    if not order.items:
        return None

    seller_id   = order.seller_id
    total_qty   = sum(item.quantity for item in order.items)
    total_score = 0

    for item in order.items:
        product = db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku       == item.sku,
        ).first()
        if product and product.box_type:
            try:
                total_score += int(product.box_type) * item.quantity
            except (ValueError, TypeError):
                pass  # box_type não numérico — ignora

    rule = db.query(models.BoxAlgorithm).filter(
        models.BoxAlgorithm.seller_id    == seller_id,
        models.BoxAlgorithm.num_products == total_qty,
        models.BoxAlgorithm.score        == total_score,
    ).first()

    return rule.box_type if rule else None


@router.get("/orders/{order_id}/suggested-box")
def get_suggested_box(
    order_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna a caixa sugerida para um pedido (via algoritmo de caixa do seller)
    e a caixa já salva pelo operador (box_used), se houver.
    """
    order = db.query(models.Order).options(
        joinedload(models.Order.items),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Pedido não encontrado")

    suggested = _suggest_box_for_order(order, db)
    return {
        "order_id":  order_id,
        "suggested": suggested,            # None → N.A
        "box_used":  order.box_used,       # operador pode ter ajustado
        "effective": order.box_used or suggested,  # valor a usar
    }


@router.patch("/orders/{order_id}/box")
def save_order_box(
    order_id: int,
    body: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Salva a caixa escolhida pelo operador para o pedido.
    Body: { "box_used": "c1" }
    """
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Pedido não encontrado")

    box = (body.get("box_used") or "").strip() or None
    order.box_used = box

    db.add(models.AuditLog(
        entity_type="Order", entity_id=order_id, action="UPDATE_BOX",
        user_id=current_user.id,
        detail=f"Caixa definida: {box or 'removida'}",
    ))

    # Caixa obrigatória na SAÍDA (17/08/2026): se o pedido já estava com todos
    # os itens bipados e só esperava a caixa para concluir, cadastrá-la agora
    # conclui o pedido na hora — mesma lógica de process_scan, via
    # _finalize_order. Não se aplica a pedido já concluído/cancelado nem
    # quando a caixa está sendo apagada (box=None).
    order_status = order.status.value if hasattr(order.status, 'value') else order.status
    order_completed = False
    if box and order_status not in ("completed", "cancelled") and _count_remaining(order, db) == 0:
        _finalize_order(order, order.session_id, db)
        order_completed = True

    db.commit()
    return {"order_id": order_id, "box_used": order.box_used, "order_completed": order_completed}
