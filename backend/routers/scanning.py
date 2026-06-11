"""
WMS Kiwkiw - Router de Bipagem (Scanning)
Coração da aplicação dos operadores.
Reproduz e aprimora a lógica da macro 'Worksheet_Change' do Scan Manuseio.
"""

import csv
import os
from datetime import datetime, date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ..database import get_db
from ..auth import get_current_user, require_internal, require_manager_or_above, require_admin
from .. import models, schemas

router = APIRouter(prefix="/scanning", tags=["Bipagem"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIT_DIR = os.path.join(BASE_DIR, "data", "audit")


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
    current_user: models.User = Depends(require_internal),
    db: Session = Depends(get_db),
):
    """
    Retorna lista de pedidos da sessão para a interface de bipagem.
    Equivalente ao MENU do Scan Manuseio.
    """
    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    orders_query = db.query(models.Order).options(
        joinedload(models.Order.items).joinedload(models.OrderItem.product),
        joinedload(models.Order.seller),
    ).filter(
        models.Order.session_id == session_id
    )
    if seller_id:
        orders_query = orders_query.filter(models.Order.seller_id == seller_id)
    orders = orders_query.order_by(models.Order.nf_number).all()

    # Conta itens escaneados para cada pedido
    scan_counts = {}
    for order in orders:
        scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
            models.ScanningLog.order_id == order.id,
            models.ScanningLog.is_interrupted == False,
            models.ScanningLog.is_error == False,
        ).scalar() or 0
        scan_counts[order.id] = scanned

    # Per-item scan counts
    item_scan_counts = {}
    for order in orders:
        for item in order.items:
            scanned_for_item = db.query(func.sum(models.ScanningLog.quantity)).filter(
                models.ScanningLog.order_id == order.id,
                models.ScanningLog.sku == item.sku,
                models.ScanningLog.is_error == False,
                models.ScanningLog.is_interrupted == False,
            ).scalar() or 0
            item_scan_counts[(order.id, item.sku)] = scanned_for_item

    result = []
    for order in orders:
        total_items = sum(item.quantity for item in order.items)
        scanned = scan_counts.get(order.id, 0)

        result.append({
            "id": order.id,
            "nf_number": order.nf_number,
            "customer_name": order.customer_name,
            "seller": order.seller.trade_name if order.seller else None,
            "seller_id": order.seller_id,
            "carrier": order.carrier,
            "status": order.status.value if hasattr(order.status, 'value') else order.status,
            "total_items": total_items,
            "scanned_items": scanned,
            "remaining": max(0, total_items - scanned),
            "completion_pct": round((scanned / total_items * 100) if total_items > 0 else 0, 1),
            "items": [
                _build_item_dict(item, order.seller_id, item_scan_counts, db)
                for item in order.items
            ],
        })

    total = len(orders)
    # Pedidos interrompidos contam como "feitos" para efeitos de progresso
    completed = sum(
        1 for o in orders
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

    # ── Lock por (sessão + seller): só 1 NF com atividade real por seller por sessão.
    # Um pedido só bloqueia se estiver em "scanning" E tiver ao menos 1 scan log
    # registrado (bipagem real). Isso evita locks fantasma de aberturas sem atividade.
    if order.seller_id is not None:
        scanning_orders_same_seller = db.query(models.Order).filter(
            models.Order.session_id == session_id,
            models.Order.seller_id == order.seller_id,
            models.Order.status == models.OrderStatus.SCANNING,
            models.Order.id != order.id,
        ).all()

        for conflicting in scanning_orders_same_seller:
            has_real_activity = db.query(models.ScanningLog).filter(
                models.ScanningLog.order_id == conflicting.id,
                models.ScanningLog.is_error == False,
            ).first() is not None

            if has_real_activity:
                seller_name = (order.seller.name
                               if order.seller else f"Seller {order.seller_id}")
                return {
                    "success": False,
                    "message": (
                        f"A NF {conflicting.nf_number} de {seller_name} está sendo bipada. "
                        "Finalize ou interrompa-a antes de abrir outro pedido do mesmo seller."
                    ),
                }
            else:
                # Lock fantasma: sem atividade real → libera o pedido travado
                conflicting.status = models.OrderStatus.PENDING
                db.commit()

    return {
        "success": True,
        "order_id": order.id,
        "nf_number": order.nf_number,
        "customer_name": order.customer_name,
        "status": order_status,
        "message": f"Pedido NF {order.nf_number} aberto com sucesso",
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
        if ft.lower() in ("entrada", "in"):
            session.file_type = models.FileType.IN
        else:
            session.file_type = models.FileType.EXPORT
        # Propaga para todos os pedidos da sessão
        db.query(models.Order).filter(
            models.Order.session_id == session_id
        ).update({"file_type": session.file_type}, synchronize_session=False)
        changed_fields.append("file_type")

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

    # Conta quantas vezes esse SKU já foi bipado neste pedido
    already_scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
        models.ScanningLog.order_id == order.id,
        models.ScanningLog.sku == matched_item.sku,
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
    ).scalar() or 0

    expected_qty = matched_item.quantity

    if already_scanned >= expected_qty:
        # Item já foi completamente bipado
        return schemas.ScanResponse(
            success=False,
            message=f"⚠️ SKU '{matched_item.sku}' já foi bipado {already_scanned}x (esperado: {expected_qty}x). Item completo!",
            status="already_done",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=_count_remaining(order, db),
        )

    # Registra o scan com sucesso
    log = models.ScanningLog(
        session_id=request.session_id,
        order_id=request.order_id,
        sku=matched_item.sku,
        barcode_scanned=request.barcode,
        quantity=1,
        operator_id=request.operator_id,
        is_error=False,
    )
    db.add(log)

    # Atualiza status do pedido para "scanning" se ainda estava pending
    if order_status == "pending":
        order.status = models.OrderStatus.SCANNING

    # Verifica se o pedido está completo
    remaining = _count_remaining_after_scan(order, matched_item.sku, db)

    scan_response = None

    if remaining == 0:
        # Pedido completo!
        order.status = models.OrderStatus.COMPLETED

        # Atualiza contagem da sessão
        session = db.query(models.PickingSession).filter(
            models.PickingSession.id == request.session_id
        ).first()
        if session:
            session.completed_orders = db.query(models.Order).filter(
                models.Order.session_id == request.session_id,
                models.Order.status == models.OrderStatus.COMPLETED,
            ).count() + 1  # +1 pois ainda não commitou

            # Verifica se toda a sessão está completa
            if session.completed_orders >= session.total_orders:
                session.status = models.OrderStatus.COMPLETED
                session.completed_at = datetime.now()

        # ── Atualiza estoque em tempo real ──────────────────────────
        # Cria StockMovement e atualiza StockPosition para cada item do pedido.
        try:
            from ..services.stock_manager import update_stock_from_order
            update_stock_from_order(order, db)
        except Exception as _stock_err:
            # Não bloqueia o scan em caso de erro de estoque
            pass

        db.commit()

        scan_response = schemas.ScanResponse(
            success=True,
            message=f"✅ PEDIDO {order.nf_number} COMPLETO! Todos os {expected_qty} itens bipados.",
            status="order_complete",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=0,
            order_progress=_build_progress(order, db),
        )
    else:
        db.commit()
        new_scanned = already_scanned + 1
        scan_response = schemas.ScanResponse(
            success=True,
            message=f"✔ {matched_item.product_name} [{matched_item.sku}] — {new_scanned}/{expected_qty} bipado(s)",
            status="ok",
            sku=matched_item.sku,
            product_name=matched_item.product_name,
            photo_url=matched_item.product.photo_url if matched_item.product else None,
            items_remaining=remaining,
            order_progress=_build_progress(order, db),
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

    # ── Sensibiliza o estoque (idêntico ao fluxo de concluído) ──────────────────
    # Para fins de workflow, INTERRUPTED == COMPLETED com carimbo diferente.
    # O estoque é debitado integralmente para manter a acurácia.
    stock_updated = False
    try:
        from ..services.stock_manager import update_stock_from_order
        update_stock_from_order(order, db)
        stock_updated = True
    except Exception as _stock_err:
        # Nunca bloqueia o fluxo de bipagem por erro de estoque
        print(f"[interrupt] erro ao atualizar estoque: {_stock_err}")

    # Log de auditoria do sistema
    audit = models.AuditLog(
        entity_type="Order",
        entity_id=order.id,
        action="INTERRUPT",
        detail=(
            f"Pedido NF {order.nf_number} interrompido. "
            f"Motivo: {request.reason or 'Não informado'}. "
            f"Estoque {'sensibilizado' if stock_updated else 'NÃO atualizado (erro)'}."
        ),
        user_id=current_user.id,
    )
    db.add(audit)
    db.commit()

    return {
        "success": True,
        "message": (
            f"Pedido {order.nf_number} interrompido e registrado. "
            f"{'Estoque atualizado.' if stock_updated else 'Atenção: estoque não foi atualizado.'}"
        ),
        "stock_updated": stock_updated,
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
    - Estoque sensibilizado via update_stock_from_order()
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
        ]),
    )
    if seller_id:
        orders_q = orders_q.filter(models.Order.seller_id == seller_id)
    orders = orders_q.all()

    if not orders:
        return {"success": True, "forced": 0, "message": "Todos os pedidos já estavam concluídos"}

    from ..services.stock_manager import update_stock_from_order

    forced = 0
    now = datetime.now()
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

        # Sensibiliza estoque exatamente como conclusão normal
        try:
            update_stock_from_order(order, db)
        except Exception as _e:
            pass  # Não bloqueia — mesma política do fluxo normal

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
    - Estoque NÃO é sensibilizado (pedido não foi processado)
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
        ]),
    )
    if seller_id:
        orders_q = orders_q.filter(models.Order.seller_id == seller_id)
    orders = orders_q.all()

    if not orders:
        raise HTTPException(status_code=400, detail="Nenhum pedido ativo encontrado para este seller")

    now = datetime.now()
    seller_name = orders[0].seller.trade_name if orders[0].seller else f"Seller {seller_id}"
    cancelled = 0

    for order in orders:
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
        db.add(models.AuditLog(
            entity_type="Order",
            entity_id=order.id,
            action="CANCEL_HANDLING",
            detail=(
                f"Pedido NF {order.nf_number} ({order.customer_name}) "
                f"cancelado pelo admin (manuseio desnecessário). "
                f"Seller: {seller_name}. Sessão: {session_id}. "
                f"Estoque NÃO sensibilizado."
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
            f"Sessão: {session_id} | Estoque NÃO movimentado."
        ),
        user_id=current_user.id,
    ))

    db.commit()

    return {
        "success": True,
        "cancelled": cancelled,
        "message": f"{cancelled} pedido(s) de {seller_name} cancelados. Estoque não alterado.",
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
        joinedload(models.ScanningLog.order),
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
        query = query.filter(models.ScanningLog.timestamp <= date_to)

    logs = query.order_by(models.ScanningLog.timestamp.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d/%m/%Y %H:%M:%S"),
            "order_nf": log.order.nf_number if log.order else None,
            "order_customer": log.order.customer_name if log.order else None,
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
    Conta bipagens, erros e pedidos concluídos por operador.
    """
    query = db.query(
        models.User.name.label("operator"),
        func.count(models.ScanningLog.id).label("total_scans"),
        func.sum(models.ScanningLog.quantity).label("total_items"),
        func.sum(
            func.cast(models.ScanningLog.is_error, models.Integer if False else models.ScanningLog.is_error.__class__)
        ).label("errors"),
    ).join(
        models.ScanningLog, models.User.id == models.ScanningLog.operator_id
    ).group_by(models.User.id, models.User.name)

    if date_from:
        query = query.filter(models.ScanningLog.timestamp >= date_from)
    if date_to:
        query = query.filter(models.ScanningLog.timestamp <= date_to)

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
        date_str = _dt.now().strftime("%Y%m%d")
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
                _dt.now().strftime("%Y-%m-%d %H:%M:%S"),
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

def _count_remaining(order: models.Order, db: Session) -> int:
    """Conta itens restantes para bipar no pedido."""
    total = sum(item.quantity for item in order.items)
    scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
        models.ScanningLog.order_id == order.id,
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
    ).scalar() or 0
    return max(0, total - scanned)


def _count_remaining_after_scan(
    order: models.Order,
    just_scanned_sku: str,
    db: Session,
) -> int:
    """Conta itens restantes considerando que acabou de bipar 1 item do SKU."""
    total = sum(item.quantity for item in order.items)
    scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
        models.ScanningLog.order_id == order.id,
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
    ).scalar() or 0
    # +1 pois o log atual ainda não foi commitado
    return max(0, total - scanned - 1)


def _build_progress(order: models.Order, db: Session) -> dict:
    """Constrói objeto de progresso do pedido — retorna dict com scanned/qty por SKU."""
    items_progress = []
    for item in order.items:
        scanned = db.query(func.sum(models.ScanningLog.quantity)).filter(
            models.ScanningLog.order_id == order.id,
            models.ScanningLog.sku == item.sku,
            models.ScanningLog.is_error == False,
            models.ScanningLog.is_interrupted == False,
        ).scalar() or 0
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

    if user_role in ("operator", "manager") and my_seller_ids:
        q = q.filter(
            _exists().where(
                (models.Order.session_id == models.PickingSession.id) &
                (models.Order.seller_id.in_(my_seller_ids))
            )
        )
    elif unit_id:
        # Admin filtrou por unidade explicitamente: restringe via sellers da unidade
        sellers_in_unit = db.query(models.Seller.id).filter(
            models.Seller.unit_id == unit_id,
            models.Seller.active == True,
        ).subquery()
        q = q.filter(
            _exists().where(
                (models.Order.session_id == models.PickingSession.id) &
                (models.Order.seller_id.in_(sellers_in_unit))
            )
        )

    if date_from:
        q = q.filter(models.PickingSession.session_date >= date_from)
    if date_to:
        q = q.filter(models.PickingSession.session_date <= date_to)

    sessions = q.order_by(models.PickingSession.created_at.desc()).limit(100).all()

    cards = []
    for session in sessions:
        # Agrupa ordens por seller dentro desta sessão
        seller_orders: dict = {}
        for order in session.orders:
            sid = order.seller_id

            # ── Filtra por sellers vinculados (operador e gerente) ──────────────
            # Se my_seller_ids está vazio e o usuário é operador/gerente, não exibe nada
            # (usuário sem sellers vinculados → kanban vazio, não tudo)
            if user_role in ("operator", "manager"):
                if not my_seller_ids or sid not in my_seller_ids:
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
            # Se TODOS estiverem cancelados → não exibe o card.
            active_orders = [
                o for o in all_orders
                if (o.status.value if hasattr(o.status, "value") else o.status) != "cancelled"
            ]
            if not active_orders:
                continue  # seller totalmente cancelado — remove o card

            orders = active_orders
            total = len(orders)

            # Concluído / interrompido contam como "feitos" no kanban
            completed = sum(
                1 for o in orders
                if (o.status.value if hasattr(o.status, "value") else o.status) in ("completed", "interrupted")
            )
            in_prog = sum(
                1 for o in orders
                if (o.status.value if hasattr(o.status, "value") else o.status) == "in_progress"
            )

            if completed == total and total > 0:
                status = "completed"
            elif completed > 0 or in_prog > 0:
                status = "in_progress"
            else:
                status = "pending"

            pending = total - completed - in_prog

            # Derive unit from seller relationship
            unit_id_val = None
            unit_name_val = None
            if info["orders"]:
                first_order = info["orders"][0]
                if first_order.seller and first_order.seller.unit_id:
                    unit_id_val = first_order.seller.unit_id
                if first_order.seller and first_order.seller.unit:
                    unit_name_val = first_order.seller.unit.name

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
                "total_orders": total,
                "completed_orders": completed,
                "in_progress_orders": in_prog,
                "pending_orders": pending,
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
    db.commit()
    return {"order_id": order_id, "box_used": order.box_used}
