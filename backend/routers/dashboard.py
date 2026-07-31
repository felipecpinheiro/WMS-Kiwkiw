"""
WMS Kiwkiw - Router do Cockpit / Dashboard
Dados gerenciais para o master e portal do seller.

REGRA DE DATA (importante):
-----------------------------
O filtro de data do dashboard usa SEMPRE o timestamp do upload
(`Order.imported_at` / `PickingSession.created_at`), NUNCA a data
de emissão da NF (`Order.order_date`). A data da NF fica guardada
só para auditoria. Default = hoje; o usuário pode escolher um dia
passado via parâmetro `target_date`.
"""

import os
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from ..database import get_db
from ..auth import get_current_user
from .. import models, schemas
from ..timezone_utils import now_brasilia, today_brasilia

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# ─── Helpers ─────────────────────────────────────────────────────

def _imported_on(target: date):
    """Expressão SQL: DATE(imported_at) == target. Compatível SQLite/PG."""
    return func.date(models.Order.imported_at) == target


def _session_created_on(target: date):
    """Expressão SQL para sessões criadas na data alvo."""
    return func.date(models.PickingSession.created_at) == target


@router.get("/available-dates", response_model=list[date])
def available_dates(
    limit: int = 30,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna as últimas N datas que tiveram uploads (pra alimentar o
    date-picker do dashboard). Ordenadas da mais recente pra mais antiga.
    """
    rows = (
        db.query(func.date(models.Order.imported_at).label("d"))
        .group_by("d")
        .order_by(func.date(models.Order.imported_at).desc())
        .limit(limit)
        .all()
    )
    # func.date() retorna string em SQLite; normaliza para date
    out = []
    for (d,) in rows:
        if isinstance(d, date):
            out.append(d)
        elif isinstance(d, str):
            try:
                out.append(datetime.strptime(d, "%Y-%m-%d").date())
            except ValueError:
                continue
    return out


@router.get("/debug")
def debug_state(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Endpoint de diagnóstico — retorna o estado bruto do banco.
    Abrir em http://localhost:8000/dashboard/debug com token válido
    (o próprio frontend envia o token, então basta navegar por lá).
    """
    today = today_brasilia()
    orders_total = db.query(func.count(models.Order.id)).scalar() or 0
    sessions_total = db.query(func.count(models.PickingSession.id)).scalar() or 0

    # Agrupa orders por DATE(imported_at)
    by_date = db.query(
        func.date(models.Order.imported_at).label("d"),
        func.count(models.Order.id).label("c"),
    ).group_by("d").order_by("d").all()

    sessions = db.query(models.PickingSession).order_by(models.PickingSession.id.desc()).limit(10).all()

    return {
        "server_today": today.isoformat(),
        "orders_total": orders_total,
        "sessions_total": sessions_total,
        "orders_by_import_date": [{"date": str(d), "count": c} for d, c in by_date],
        "recent_sessions": [
            {
                "id": s.id,
                "session_date": s.session_date.isoformat() if s.session_date else None,
                "created_at_date": s.created_at.date().isoformat() if s.created_at else None,
                "unit_id": s.unit_id,
                "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                "total_orders": s.total_orders,
                "has_separation_pdf": bool(s.separation_pdf),
                "has_expedition_pdf": bool(s.expedition_pdf),
            }
            for s in sessions
        ],
        "current_user": {
            "id": current_user.id,
            "name": current_user.name,
            "unit_id": current_user.unit_id,
            "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
        },
    }


# ─── Endpoint principal ──────────────────────────────────────────

@router.get("/master", response_model=schemas.DashboardStats)
def master_dashboard(
    target_date: Optional[date] = None,
    unit_id: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cockpit gerencial. Mostra o que foi importado no dia `target_date`
    (default = hoje). Pode filtrar por unidade.
    Manager: restrito automaticamente aos sellers vinculados.
    """
    target = target_date or today_brasilia()
    user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role

    # ── Sellers do gerente (filtra automaticamente se role=manager) ─
    manager_seller_ids: list[int] = []
    if user_role == "manager":
        manager_seller_ids = [s.id for s in (current_user.sellers or [])]

    # ── Base: orders importados no dia alvo ─────────────────────
    # Filtragem por unidade via seller.unit_id — não usa Order.unit_id
    # (campo denormalizado que pode estar desatualizado em pedidos históricos)
    # Pedido cancelado (ex.: duplicata de upload removida) nunca entra nas
    # estatísticas do cockpit — só fica rastreável na Trilha de Auditoria.
    # Pedido de seller inativo também não entra nas estatísticas — mesma lógica
    # do cancelado (ver CLAUDE.md → "Seller inativo — onde pode e onde não pode aparecer").
    active_sellers = db.query(models.Seller.id).filter(models.Seller.active == True).scalar_subquery()
    base_filter = [
        _imported_on(target),
        models.Order.status != models.OrderStatus.CANCELLED,
        models.Order.seller_id.in_(active_sellers),
    ]
    if unit_id:
        sellers_in_unit = db.query(models.Seller.id).filter(
            models.Seller.unit_id == unit_id,
        ).scalar_subquery()
        base_filter.append(models.Order.seller_id.in_(sellers_in_unit))
    if manager_seller_ids:
        base_filter.append(models.Order.seller_id.in_(manager_seller_ids))

    total = db.query(func.count(models.Order.id)).filter(*base_filter).scalar() or 0

    # Contadores por status (enum → valor nativo do SQLAlchemy)
    status_counts: dict[str, int] = {}
    for status_enum in models.OrderStatus:
        c = db.query(func.count(models.Order.id)).filter(
            *base_filter,
            models.Order.status == status_enum,
        ).scalar() or 0
        status_counts[status_enum.value] = c

    interrupted = status_counts.get(models.OrderStatus.INTERRUPTED.value, 0)
    # No Dashboard Master, interrompido conta como concluído para a logística interna
    # (não afeta o Portal do Seller, que tem sua própria contagem em seller_dashboard()).
    completed = status_counts.get(models.OrderStatus.COMPLETED.value, 0) + interrupted
    scanning = status_counts.get(models.OrderStatus.SCANNING.value, 0)
    pending = total - completed
    completion_rate = round((completed / total * 100) if total > 0 else 0, 1)

    # ── Sessões criadas no dia alvo ─────────────────────────────
    session_filter = [_session_created_on(target)]
    if unit_id:
        session_filter.append(models.PickingSession.unit_id == unit_id)

    active_sessions = db.query(func.count(models.PickingSession.id)).filter(
        *session_filter,
        models.PickingSession.status != models.OrderStatus.COMPLETED,
    ).scalar() or 0

    # ── Resumo por unidade ──────────────────────────────────────
    # Deriva a unidade de cada pedido pelo seller (seller.unit_id),
    # evitando depender do campo denormalizado order.unit_id.
    units = db.query(models.Unit).filter(models.Unit.active == True).order_by(models.Unit.name).all()
    units_summary = []
    for unit in units:
        if unit_id and unit_id != unit.id and user_role != "admin":
            units_summary.append({
                "unit_id": unit.id, "unit_name": unit.name,
                "total": 0, "completed": 0, "pct": 0,
            })
            continue

        # Sellers ATIVOS que pertencem a esta unidade. Este bloco monta o próprio
        # filtro (não reaproveita base_filter), então o recorte precisa ser explícito.
        sellers_of_unit = db.query(models.Seller.id).filter(
            models.Seller.unit_id == unit.id,
            models.Seller.active == True,
        ).scalar_subquery()

        unit_filter = [
            _imported_on(target),
            models.Order.seller_id.in_(sellers_of_unit),
        ]
        if manager_seller_ids:
            unit_filter.append(models.Order.seller_id.in_(manager_seller_ids))

        u_total = db.query(func.count(models.Order.id)).filter(*unit_filter).scalar() or 0
        u_done  = db.query(func.count(models.Order.id)).filter(
            *unit_filter,
            models.Order.status.in_([models.OrderStatus.COMPLETED, models.OrderStatus.INTERRUPTED]),
        ).scalar() or 0
        units_summary.append({
            "unit_id": unit.id,
            "unit_name": unit.name,
            "total": u_total,
            "completed": u_done,
            "pct": round((u_done / u_total * 100) if u_total > 0 else 0, 1),
        })

    # ── Sellers com pedidos no dia alvo ─────────────────────────
    # Usa case() para somar pedidos COMPLETED ou INTERRUPTED (interrompido conta como
    # concluído no Dashboard Master) — portável entre SQLite e PG
    completed_expr = func.sum(
        case((models.Order.status.in_([models.OrderStatus.COMPLETED, models.OrderStatus.INTERRUPTED]), 1), else_=0)
    ).label("completed_count")

    sellers_rows = db.query(
        models.Seller.id,
        models.Seller.trade_name,
        func.count(models.Order.id).label("order_count"),
        completed_expr,
    ).join(
        models.Order, models.Order.seller_id == models.Seller.id
    ).filter(
        *base_filter,
    ).group_by(models.Seller.id, models.Seller.trade_name).all()

    sellers_with_orders = [
        {
            "seller_id": r.id,
            "seller_name": r.trade_name,
            "total": r.order_count,
            "completed": int(r.completed_count or 0),
            "pct": round((int(r.completed_count or 0) / r.order_count * 100) if r.order_count > 0 else 0, 1),
        }
        for r in sellers_rows
    ]

    # ── Scans recentes (últimas 2 horas, independente do target_date) ──
    two_hours_ago = now_brasilia() - timedelta(hours=2)
    recent_logs = db.query(models.ScanningLog).filter(
        models.ScanningLog.timestamp >= two_hours_ago,
        models.ScanningLog.is_error == False,
    ).order_by(models.ScanningLog.timestamp.desc()).limit(10).all()

    recent_scans = [
        {
            "timestamp": log.timestamp.strftime("%H:%M:%S"),
            "operator": log.operator.name if log.operator else "N/A",
            "sku": log.sku,
            "order_nf": log.order.nf_number if log.order else "N/A",
        }
        for log in recent_logs
    ]

    # ── Alertas ─────────────────────────────────────────────────
    alerts = []
    no_carrier = db.query(func.count(models.Order.id)).filter(
        *base_filter, models.Order.carrier == None,
    ).scalar() or 0
    if no_carrier > 0:
        alerts.append({"type": "warning", "message": f"{no_carrier} pedidos sem transportadora definida"})
    if interrupted > 0:
        alerts.append({"type": "error", "message": f"{interrupted} pedidos interrompidos — verificar com operador"})

    # ── Lê configurações de checagens ───────────────────────────────────────
    def _setting(key: str, default: str = "true") -> str:
        obj = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
        return obj.value if obj else default

    cfg_transportadora  = _setting("check_transportadora")       == "true"
    cfg_nf_unicas       = _setting("check_nf_unicas")            == "true"
    cfg_produtos        = _setting("check_produtos_cadastrados")  == "true"

    # Expõe quais checks estão habilitados para o frontend renderizar corretamente
    checks_enabled = {
        "transportadora":       cfg_transportadora,
        "nf_unicas":            cfg_nf_unicas,
        "produtos_cadastrados": cfg_produtos,
    }

    # ── Checagens P6/P8/P10/P12 sobre a última sessão do dia ────────────────
    checks = {
        "transport":   None,   # None = desabilitado, True/False = resultado
        "separation":  False,
        "planning":    False,
        "stock":       None,   # antigo nome para NF únicas
        "all_ok":      False,
    }

    last_session = db.query(models.PickingSession).filter(
        *session_filter,
    ).order_by(models.PickingSession.id.desc()).first()

    if last_session:
        session_orders = db.query(models.Order).filter(
            models.Order.session_id == last_session.id
        ).all()
        if session_orders:
            checks["separation"] = bool(last_session.check_separation)
            checks["planning"]   = bool(last_session.check_planning)

            if cfg_nf_unicas:
                keys = [o.danfe_key for o in session_orders if o.danfe_key]
                checks["stock"] = len(keys) == len(set(keys))

    orders_today = db.query(models.Order).filter(*base_filter).all()

    # ── Checagem: Transportadora ─────────────────────────────────────────────
    orders_no_carrier = []
    if cfg_transportadora:
        orders_no_carrier = [
            {
                "order_id": o.id,
                "nf_number": o.nf_number,
                "seller_name": o.seller.trade_name if o.seller else "?",
                "seller_id": o.seller_id,
                "customer_name": o.customer_name,
            }
            for o in orders_today if not o.carrier
        ]
        checks["transport"] = len(orders_no_carrier) == 0
    checks["missing_carriers"] = orders_no_carrier[:30]

    # ── Checagem: Produtos cadastrados ────────────────────────────────────────
    missing_products = []
    if cfg_produtos:
        for order in orders_today:
            for item in order.items:
                prod = db.query(models.Product).filter(
                    models.Product.seller_id == order.seller_id,
                    models.Product.sku == item.sku,
                    models.Product.active == True,
                ).first()
                if not prod:
                    entry = {
                        "sku": item.sku,
                        "product_name": item.product_name,
                        "seller_id": order.seller_id,
                        "seller_name": order.seller.trade_name if order.seller else "?",
                    }
                    if not any(e["sku"] == entry["sku"] and e["seller_id"] == entry["seller_id"]
                               for e in missing_products):
                        missing_products.append(entry)
        checks["products_registered"] = len(missing_products) == 0
    else:
        checks["products_registered"] = None  # desabilitado
    checks["missing_products"] = missing_products[:20]

    # ── all_ok: considera apenas checks habilitados ───────────────────────────
    enabled_results = [
        v for k, v in checks.items()
        if k in ("transport", "separation", "planning", "stock", "products_registered")
        and v is not None   # None = check desabilitado, não entra no cálculo
    ]
    checks["all_ok"] = all(enabled_results) if enabled_results else True
    checks["checks_enabled"] = checks_enabled

    # ── Sellers ativos SEM pedidos hoje ─────────────────────
    # Para gerente: só mostra os sellers que ele gerencia sem pedidos
    # Precisa respeitar o mesmo filtro de unidade usado em sellers_with_orders —
    # senão um seller de outra unidade sempre cai aqui como "sem pedidos", mesmo
    # tendo pedido hoje na unidade dele.
    sellers_query = db.query(models.Seller).filter(models.Seller.active == True)
    if manager_seller_ids:
        sellers_query = sellers_query.filter(models.Seller.id.in_(manager_seller_ids))
    if unit_id:
        sellers_query = sellers_query.filter(models.Seller.unit_id == unit_id)
    all_active_sellers = sellers_query.all()
    seller_ids_with_orders = {r["seller_id"] for r in sellers_with_orders}
    sellers_no_orders = [
        {"seller_id": s.id, "seller_name": s.trade_name}
        for s in all_active_sellers
        if s.id not in seller_ids_with_orders
    ]

    # ── Histórico de sessões/uploads do dia ──────────────────
    sessions_today_raw = db.query(models.PickingSession).filter(
        *session_filter
    ).order_by(models.PickingSession.created_at.desc()).all()

    sessions_today_list = []
    for sess in sessions_today_raw:
        # Sellers distintos nesta sessão (com pedido ainda ativo, não cancelado)
        sess_sellers = db.query(models.Seller.id, models.Seller.trade_name).join(
            models.Order, models.Order.seller_id == models.Seller.id
        ).filter(
            models.Order.session_id == sess.id,
            models.Order.status != models.OrderStatus.CANCELLED,
        ).distinct().all()
        snames = [r[1] for r in sess_sellers]
        sellers_in_session = [{"seller_id": r[0], "seller_name": r[1]} for r in sess_sellers]

        # PDF: armazenado como caminho completo — pega só o nome do arquivo
        sep_pdf = os.path.basename(sess.separation_pdf) if sess.separation_pdf else None
        exp_pdf = os.path.basename(sess.expedition_pdf) if sess.expedition_pdf else None

        ft = sess.file_type.value if hasattr(sess.file_type, 'value') else str(sess.file_type)

        sessions_today_list.append({
            "session_id": sess.id,
            "source_file": sess.source_file,
            "total_orders": sess.total_orders,
            "created_at": sess.created_at.strftime("%H:%M") if sess.created_at else None,
            "seller_names": snames,
            "sellers_in_session": sellers_in_session,
            "file_type": ft,
            "separation_pdf": sep_pdf,
            "expedition_pdf": exp_pdf,
            "check_separation": bool(sess.separation_pdf or sess.check_separation),
            "check_planning": bool(sess.expedition_pdf or sess.check_planning),
        })

    # ── Agrupamento por operador ────────────────────────────────────────
    # Para cada operador que fez scans no dia, mostra total bipado e pedidos concluídos
    operator_rows = db.query(
        models.User.id,
        models.User.name,
        func.count(models.ScanningLog.id).label("scans"),
        func.count(models.ScanningLog.order_id.distinct()).label("orders_touched"),
    ).outerjoin(
        models.ScanningLog,
        (models.ScanningLog.operator_id == models.User.id) &
        (func.date(models.ScanningLog.timestamp) == target),
    ).filter(
        models.User.role == "operator",
        models.User.active == True,
    ).group_by(models.User.id, models.User.name).all()

    # Pedidos concluídos por operador (último scan é do operador que fechou)
    completed_by_op = {}
    logs_today = db.query(models.ScanningLog).join(
        models.Order, models.Order.id == models.ScanningLog.order_id
    ).filter(
        func.date(models.ScanningLog.timestamp) == target,
        *([models.Order.unit_id == unit_id] if unit_id else []),
    ).all()
    for log in logs_today:
        if log.operator_id not in completed_by_op:
            completed_by_op[log.operator_id] = set()
        if log.order and log.order.status in (models.OrderStatus.COMPLETED, models.OrderStatus.INTERRUPTED):
            completed_by_op[log.operator_id].add(log.order_id)

    operators_summary = []
    for r in operator_rows:
        ops = {
            "operator_id":   r.id,
            "operator_name": r.name,
            "scans":         int(r.scans or 0),
            "orders_touched": int(r.orders_touched or 0),
            "orders_completed": len(completed_by_op.get(r.id, set())),
        }
        operators_summary.append(ops)

    # Pedidos sem operador associado (nunca foram bipados)
    orders_no_scan = db.query(func.count(models.Order.id)).filter(
        *base_filter,
        ~models.Order.id.in_(
            db.query(models.ScanningLog.order_id).filter(
                func.date(models.ScanningLog.timestamp) == target
            )
        ),
    ).scalar() or 0

    operators_summary.sort(key=lambda x: x["scans"], reverse=True)

    return schemas.DashboardStats(
        today=target,
        total_orders_today=total,
        orders_completed=completed,
        orders_pending=pending,
        orders_scanning=scanning,
        completion_rate=completion_rate,
        active_sessions=active_sessions,
        units_summary=units_summary,
        sellers_with_orders=sellers_with_orders,
        sellers_no_orders=sellers_no_orders,
        sessions_today=sessions_today_list,
        recent_scans=recent_scans,
        alerts=alerts,
        checks=checks,
        operators_summary=operators_summary,
        orders_no_operator=orders_no_scan,
    )


# ─── Portal do seller ────────────────────────────────────────────

@router.get("/seller", response_model=schemas.SellerDashboard)
def seller_dashboard(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cockpit do seller. Filtra pedidos pelo dia do upload (imported_at).
    Aceita range de datas (date_from / date_to). Default = hoje.
    """
    from fastapi import HTTPException
    user_role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
    if user_role not in ["client", "admin"]:
        raise HTTPException(status_code=403, detail="Acesso negado")

    seller_id = current_user.seller_id
    if not seller_id and user_role != "admin":
        raise HTTPException(status_code=400, detail="Usuário sem seller associado")

    today = today_brasilia()
    start = date_from or today
    end   = date_to   or today

    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()

    # Filtra pelo range de datas de upload (imported_at), excluindo cancelados
    base_filter = [
        func.date(models.Order.imported_at) >= start,
        func.date(models.Order.imported_at) <= end,
        models.Order.status != models.OrderStatus.CANCELLED,
    ]
    if seller_id:
        base_filter.append(models.Order.seller_id == seller_id)

    total = db.query(func.count(models.Order.id)).filter(*base_filter).scalar() or 0
    completed = db.query(func.count(models.Order.id)).filter(
        *base_filter, models.Order.status == models.OrderStatus.COMPLETED,
    ).scalar() or 0
    pending = total - completed
    interrupted = db.query(func.count(models.Order.id)).filter(
        *base_filter, models.Order.status == models.OrderStatus.INTERRUPTED,
    ).scalar() or 0
    completion_rate = round(((completed + interrupted) / total * 100) if total > 0 else 0, 1)

    recent_orders = db.query(models.Order).filter(
        *base_filter
    ).order_by(models.Order.imported_at.desc()).limit(500).all()

    orders_list = [
        {
            "id": o.id,
            "nf_number": o.nf_number,
            "customer_name": o.customer_name,
            "carrier": o.carrier,
            "order_date": str(o.order_date) if o.order_date else None,
            "imported_at": o.imported_at.isoformat() if o.imported_at else None,
            "status": o.status.value if hasattr(o.status, 'value') else o.status,
            "items_count": len(o.items),
        }
        for o in recent_orders
    ]

    low_stock = db.query(models.StockPosition).filter(
        models.StockPosition.seller_id == seller_id,
        models.StockPosition.current_stock <= 10,
        models.StockPosition.current_stock > 0,
    ).limit(10).all() if seller_id else []

    stock_alerts = [
        {
            "sku": p.sku,
            "product_name": p.product_name,
            "current_stock": p.current_stock,
        }
        for p in low_stock
    ]

    return {
        "seller_id": seller_id or 0,
        "seller_name": seller.trade_name if seller else "Seller",
        "date_from": start,
        "date_to": end,
        "total_orders": total,
        "orders_completed": completed,
        "orders_pending": pending,
        "completion_rate": completion_rate,
        "recent_orders": orders_list,
        "stock_alerts": stock_alerts,
    }
