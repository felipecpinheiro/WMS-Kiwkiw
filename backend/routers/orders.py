"""
WMS Kiwkiw - Router de Pedidos
Importação, listagem e gestão de pedidos.
"""

import io
import os
import json
from typing import Optional, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func

from ..database import get_db
from ..auth import get_current_user, require_admin, require_manager_or_above
from .. import models, schemas
from ..services.order_import import import_excel_orders
from ..services.import_progress import get_progress
from ..services.pdf_generator import generate_separation_bytes, generate_expedition_bytes, generate_pdfs_for_session
from ..services.audit_export import export_session_to_csv
from ..services.stock_manager import (
    apply_stock_for_orders,
    apply_stock_for_order,
    reverse_stock_for_order,
    evaluate_orders_for_stock,
    release_pending_orders_for_sku,
    relink_sku_in_pending_orders,
    order_has_scan_overage,
    STOCK_ERA_CUTOFF,
)
from ..timezone_utils import today_brasilia, now_brasilia

router = APIRouter(prefix="/orders", tags=["Pedidos"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
EXPORT_DIR = os.path.join(BASE_DIR, "data", "exports")


def _missing_carrier_orders(db: Session, session_id: int) -> list:
    """
    Pedidos da sessão sem transportadora — bloqueiam bipagem (ver open_order_by_nfe
    e process_scan em scanning.py) e geração de PDF de separação/expedição até
    serem preenchidos (PATCH /orders/{id}/carrier). Ver CLAUDE.md.
    """
    return db.query(models.Order).options(
        joinedload(models.Order.seller)
    ).filter(
        models.Order.session_id == session_id,
        models.Order.status != models.OrderStatus.CANCELLED,
        models.Order.status != models.OrderStatus.INACTIVE,
        (models.Order.carrier == None) | (models.Order.carrier == ""),
        models.Order.seller_id.in_(
            db.query(models.Seller.id).filter(models.Seller.active == True).scalar_subquery()
        ),
    ).all()


# Endpoint SÍNCRONO de propósito: todo o trabalho aqui (leitura de Excel, laço de
# persistência) é bloqueante. Declarado como `def`, o FastAPI o executa no
# threadpool; como `async def` ele rodaria no event loop e travaria a API inteira
# — bipagem, dashboard e login — durante toda a importação.
@router.post("/import", response_model=schemas.ImportResult)
def import_orders(
    file: UploadFile = File(..., description="Arquivo Excel com pedidos do ERP"),
    unit_id: int = Form(..., description="ID da unidade"),
    file_type: str = Form("Saída", description="'Entrada' ou 'Saída' (aplica-se a TODOS os pedidos do arquivo)"),
    for_billing: bool = Form(True, description="Considerar este arquivo para faturamento (aplica-se a TODOS os pedidos)"),
    force_duplicates: bool = Form(False, description="Se True, reimporta mesmo havendo NFs já presentes no banco"),
    inactive_seller_decisions: Optional[str] = Form(
        None, description='JSON {"<seller_id>": "reactivate"|"ignore"} — decisões para sellers inativos encontrados no arquivo'
    ),
    seller_link_decisions: Optional[str] = Form(
        None, description='JSON {"<seller_name>": {"action": "create", "unit_id": int} | {"action": "link", "seller_id": int}} — decisões para nomes de seller não reconhecidos no arquivo'
    ),
    upload_id: Optional[str] = Form(
        None, description="Id gerado pelo frontend para acompanhar o progresso via GET /orders/import/progress"
    ),
    current_user: models.User = Depends(require_admin),  # SOMENTE ADMIN importa pedidos
    db: Session = Depends(get_db),
):
    """
    Importa arquivo Excel de pedidos.
    Equivalente à macro 'colar_info()' do importador.

    `file_type` e `for_billing` são configurações de NÍVEL DE SESSÃO —
    todos os pedidos importados desse arquivo herdam essas flags.

    Se o arquivo contiver NFs já importadas e `force_duplicates=False`,
    a resposta vem com `requires_confirmation=true` e a lista de duplicados;
    o frontend deve então repetir a chamada com `force_duplicates=true`.

    Se o arquivo referenciar sellers inativos, a resposta vem com
    `requires_confirmation=true` e a lista em `inactive_sellers`; o frontend
    deve repetir a chamada enviando `inactive_seller_decisions` com a decisão
    ("reactivate" ou "ignore") para cada `seller_id` listado.

    Se o arquivo referenciar nomes de seller que não batem com nenhum
    cadastro, a resposta vem com `requires_confirmation=true` e a lista em
    `unmatched_sellers`; o frontend deve repetir a chamada enviando
    `seller_link_decisions` com a decisão para cada nome listado.
    """
    if not file.filename.endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Apenas arquivos Excel são aceitos (.xlsx, .xlsm, .xls)")

    # Valida file_type
    # ⚠️ Era `models.FileType.IN`, que NÃO existe — o enum tem IMPORT/EXPORT.
    # Marcar o arquivo como "Entrada" estourava AttributeError → 500 no import.
    file_type_enum = models.FileType.IMPORT if file_type.strip().lower() in ("entrada", "in") else models.FileType.EXPORT

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Salva arquivo temporário — sanitizar nome para evitar path traversal
    safe_name = os.path.basename(file.filename or "upload.xlsx").replace("..", "")
    file_path = os.path.join(UPLOAD_DIR, f"{today_brasilia().strftime('%Y%m%d')}_{safe_name}")
    with open(file_path, "wb") as f:
        f.write(file.file.read())

    # Decisões de sellers inativos vêm como JSON {"<seller_id>": "reactivate"|"ignore"}
    decisions_dict = {}
    if inactive_seller_decisions:
        try:
            raw_decisions = json.loads(inactive_seller_decisions)
            decisions_dict = {int(k): v for k, v in raw_decisions.items()}
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=400, detail="inactive_seller_decisions inválido — esperado JSON {seller_id: decisão}")

    # Decisões de sellers não reconhecidos vêm como JSON
    # {"<seller_name>": {"action": "create", "unit_id": int} | {"action": "link", "seller_id": int}}
    seller_link_decisions_dict = {}
    if seller_link_decisions:
        try:
            seller_link_decisions_dict = json.loads(seller_link_decisions)
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=400, detail="seller_link_decisions inválido — esperado JSON {seller_name: decisão}")

    # Importa pedidos — passa as configs de nível de sessão
    result = import_excel_orders(
        file_path=file_path,
        unit_id=unit_id,
        db=db,
        created_by_id=current_user.id,
        file_type=file_type_enum,
        for_billing=for_billing,
        force_duplicates=force_duplicates,
        inactive_seller_decisions=decisions_dict,
        seller_link_decisions=seller_link_decisions_dict,
        upload_id=upload_id,
    )

    if getattr(result, "requires_confirmation", False):
        return result

    if result.success and result.session_id:
        session = db.query(models.PickingSession).filter(
            models.PickingSession.id == result.session_id
        ).first()
        if session:
            # CSV de auditoria (sempre)
            try:
                os.makedirs(EXPORT_DIR, exist_ok=True)
                csv_paths = export_session_to_csv(session, db, EXPORT_DIR)
                db.commit()
                if csv_paths:
                    result.warnings.append(f"{len(csv_paths)} CSV(s) de auditoria gerado(s)")
            except Exception as e:
                db.rollback()
                result.warnings.append(f"Aviso: CSV de auditoria não gerado: {str(e)}")

            # ── Transportadora pendente ────────────────────────────────────
            # Pedido sem transportadora não pode ser bipado nem ter PDF gerado
            # (ver CLAUDE.md). A pessoa completa pelo modal do Dashboard — na
            # hora (abre sozinho com missing_carrier_orders) ou depois, pelo
            # aviso fixo alimentado por GET /dashboard/master.
            missing = _missing_carrier_orders(db, session.id)
            if missing:
                result.warnings.append(
                    f"{len(missing)} pedido(s) sem transportadora — bipagem e PDFs ficam bloqueados até completar"
                )
                result.missing_carrier_orders = [
                    schemas.MissingCarrierOrderInfo(
                        order_id=o.id,
                        session_id=o.session_id,
                        nf_number=o.nf_number,
                        seller_name=o.seller.trade_name if o.seller else "?",
                        customer_name=o.customer_name,
                    )
                    for o in missing
                ]
            else:
                # Modo local (SQLite) → salva PDFs em disco e registra caminho na sessão.
                # Modo produção (PostgreSQL) → PDFs gerados sob demanda via endpoint.
                database_url = os.getenv("DATABASE_URL", "")
                is_local = not database_url.startswith(("postgresql", "postgres"))
                if is_local:
                    from ..routers.settings import _get_or_create as _get_setting
                    pdf_base = _get_setting(db, "pdf_base_folder").value or os.path.join(BASE_DIR, "data", "exports", "pdfs")
                    try:
                        pdf_results = generate_pdfs_for_session(session, db, pdf_base)
                        if pdf_results:
                            sep_path, exp_path = pdf_results[0]
                            session.separation_pdf = sep_path
                            session.expedition_pdf = exp_path
                            session.check_separation = True
                            session.check_planning = True
                            db.commit()
                            result.warnings.append("PDFs de separação e expedição salvos (modo local)")
                    except Exception as e:
                        result.warnings.append(f"Aviso: PDF local não gerado: {str(e)}")

    return result


@router.get("/import/progress", response_model=schemas.ImportProgressInfo)
def get_import_progress(
    upload_id: str = Query(..., description="Id gerado pelo frontend na hora do upload"),
    current_user: models.User = Depends(require_admin),
):
    """
    Progresso de um import em andamento. Lê só o contador em memória do
    processo (services/import_progress.py) — nunca consulta o banco, pra não
    competir com bipagem/dashboard durante o polling do frontend.

    Se o upload_id não for encontrado (import ainda não chegou nessa fase,
    já expirou, ou o processo reiniciou no meio do import), devolve
    `found=False` — o frontend trata isso como "sem informação ainda", não
    como erro.
    """
    entry = get_progress(upload_id)
    if entry is None:
        return schemas.ImportProgressInfo(found=False)
    return schemas.ImportProgressInfo(
        found=True,
        processed=entry["processed"],
        total=entry["total"],
        done=entry["done"],
        success=entry["success"],
    )


@router.get("/sessions/{session_id}/pdf/separation")
def download_separation_pdf(
    session_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Gera e baixa o PDF de separação da sessão. Marca check_separation na sessão."""
    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    missing = _missing_carrier_orders(db, session_id)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{len(missing)} pedido(s) desta sessão estão sem transportadora. Preencha antes de gerar o PDF.",
        )

    try:
        data, filename = generate_separation_bytes(session, db)
        session.check_separation = True
        db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF de separação: {str(e)}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/pdf/expedition")
def download_expedition_pdf(
    session_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Gera e baixa o PDF de expedição da sessão. Marca check_planning na sessão."""
    session = db.query(models.PickingSession).filter(
        models.PickingSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    missing = _missing_carrier_orders(db, session_id)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{len(missing)} pedido(s) desta sessão estão sem transportadora. Preencha antes de gerar o PDF.",
        )

    try:
        data, filename = generate_expedition_bytes(session, db)
        session.check_planning = True
        db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF de expedição: {str(e)}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/", response_model=List[schemas.OrderResponse])
def list_orders(
    session_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    unit_id: Optional[int] = None,
    status: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista pedidos com filtros.

    include_inactive: só tem efeito para admin — usado pelo toggle "Mostrar
    NFs inativas" da tela de Pedidos.
    """
    query = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    )

    # Pedido cancelado (ex.: duplicata de upload removida) nunca aparece
    # nesta tela, pra ninguém — só fica rastreável na Trilha de Auditoria.
    query = query.filter(models.Order.status != models.OrderStatus.CANCELLED)

    # NF inativada some da tela pra todo mundo — só admin com o toggle ligado
    # a enxerga de novo. Ver deactivate_order/reactivate_order em scanning.py.
    user_role_for_inactive = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
    if not (include_inactive and user_role_for_inactive == "admin"):
        query = query.filter(models.Order.status != models.OrderStatus.INACTIVE)

    # Pedido de seller inativo também não aparece, pra ninguém — mesma lógica.
    # Ver CLAUDE.md → "Seller inativo — onde pode e onde não pode aparecer".
    active_sellers = db.query(models.Seller.id).filter(models.Seller.active == True).scalar_subquery()
    query = query.filter(models.Order.seller_id.in_(active_sellers))

    # Restrição por role: seller só vê os próprios pedidos
    user_role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
    if user_role == "client" and current_user.seller_id:
        query = query.filter(models.Order.seller_id == current_user.seller_id)

    if session_id:
        query = query.filter(models.Order.session_id == session_id)
    if seller_id:
        query = query.filter(models.Order.seller_id == seller_id)
    if unit_id:
        # Filtra por Seller.unit_id (não Order.unit_id, campo denormalizado que
        # pode estar desatualizado em pedidos históricos — ver CLAUDE.md).
        # O recorte de seller ativo já foi aplicado acima, para toda a query.
        sellers_in_unit = db.query(models.Seller.id).filter(
            models.Seller.unit_id == unit_id,
        ).scalar_subquery()
        query = query.filter(models.Order.seller_id.in_(sellers_in_unit))
    if status:
        query = query.filter(models.Order.status == status)
    if date_from:
        query = query.filter(models.Order.order_date >= date_from)
    if date_to:
        query = query.filter(models.Order.order_date <= date_to)
    if search:
        query = query.filter(
            or_(
                models.Order.nf_number.ilike(f"%{search}%"),
                models.Order.customer_name.ilike(f"%{search}%"),
                models.Order.danfe_key.ilike(f"%{search}%"),
            )
        )

    orders = query.order_by(models.Order.imported_at.desc()).offset(offset).limit(limit).all()

    result = []
    for order in orders:
        order_dict = {
            "id": order.id,
            "erp_code": order.erp_code,
            "nf_number": order.nf_number,
            "customer_name": order.customer_name,
            "order_date": order.order_date,
            "seller_id": order.seller_id,
            "seller_name": order.seller.trade_name if order.seller else None,
            "unit_id": order.unit_id,
            "carrier": order.carrier,
            "status": order.status.value if hasattr(order.status, 'value') else order.status,
            "expedition_date": order.expedition_date,
            "nature": order.nature,
            "danfe_key": order.danfe_key,
            "for_billing": order.for_billing,
            "imported_at": order.imported_at,
            "session_id": order.session_id,
            "stock_applied_at": order.stock_applied_at,
            "items": [
                {
                    "id": item.id,
                    "sku": item.sku,
                    "product_name": item.product_name,
                    "quantity": item.quantity,
                    "is_kit_component": item.is_kit_component,
                    "original_kit_sku": item.original_kit_sku,
                }
                for item in order.items
            ],
        }
        result.append(schemas.OrderResponse(**order_dict))

    return result


# ⚠️ Rota estática ANTES da parametrizada `/{order_id}` — senão o FastAPI
# tenta casar "pending-stock" com order_id:int e devolve 422. Mesma armadilha
# já documentada em /kits/expansion-log.
def _pending_stock_base_query(db: Session):
    """
    Recorte único de "NF ainda não baixou estoque, dentro da era atual, sem
    estar cancelada/inativa, de seller ativo". Compartilhado por
    GET /pending-stock e POST /pending-stock/retry — não duplicar o filtro,
    senão os dois endpoints divergem em silêncio (ver CLAUDE.md).
    """
    return db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).join(models.Seller, models.Order.seller_id == models.Seller.id).filter(
        models.Order.stock_applied_at.is_(None),
        # Corte de era: NF anterior a 06/08/2026 tem a coluna vazia mas o
        # estoque já baixado pela regra antiga. Sem este filtro o aviso somava
        # o histórico inteiro (6.703 NFs em 10/08/2026) e, pior, oferecia
        # "resolver" notas que baixariam o estoque uma segunda vez.
        # Ver STOCK_ERA_CUTOFF em services/stock_manager.py.
        models.Order.imported_at >= STOCK_ERA_CUTOFF,
        models.Order.status.notin_([
            models.OrderStatus.CANCELLED,
            models.OrderStatus.INACTIVE,
        ]),
        models.Seller.active == True,  # noqa: E712
    )


@router.get("/pending-stock", response_model=schemas.StockApplyReport)
def list_pending_stock_orders(
    session_id: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    NFs que ainda NÃO baixaram estoque e o motivo (06/08/2026).

    Alimenta o aviso fixo do Dashboard e o modal de cadastro de produto.
    Segue o mesmo recorte do resto da operação: seller ativo e sem pedido
    cancelado/inativo.
    """
    q = _pending_stock_base_query(db)
    if session_id:
        q = q.filter(models.Order.session_id == session_id)

    orders = q.all()
    if not orders:
        return schemas.StockApplyReport()

    evaluation = evaluate_orders_for_stock(orders, db)
    pending, missing = [], {}
    for o in orders:
        ev = evaluation[o.id]
        pending.append(schemas.PendingStockOrderInfo(
            order_id=o.id,
            nf_number=o.nf_number,
            seller_id=o.seller_id,
            seller_name=o.seller.trade_name if o.seller else None,
            customer_name=o.customer_name,
            missing_carrier=ev["missing_carrier"],
            missing_skus=ev["missing_skus"],
            can_apply=ev["can_apply"],
        ))
        for sku in ev["missing_skus"]:
            key = (o.seller_id, sku)
            if key not in missing:
                missing[key] = schemas.MissingProductInfo(
                    seller_id=o.seller_id,
                    seller_name=o.seller.trade_name if o.seller else None,
                    sku=sku,
                    product_name=next((i.product_name for i in o.items if i.sku == sku), sku),
                    nf_numbers=[],
                )
            if o.nf_number not in missing[key].nf_numbers:
                missing[key].nf_numbers.append(o.nf_number)

    return schemas.StockApplyReport(
        applied_orders=0,
        pending_orders=pending,
        missing_products=list(missing.values()),
        negatives=[],
    )


@router.post("/pending-stock/retry", response_model=schemas.StockApplyReport)
def retry_pending_stock_orders(
    payload: schemas.PendingStockRetryRequest,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Reavalia e reaplica NFs pendentes (19/08/2026).

    Existe para o caso em que a NF já não tem mais motivo nenhum bloqueando
    (transportadora ok, todos os SKUs cadastrados — `can_apply=true` no
    GET /pending-stock) mas nunca foi reaplicada, porque o que a destravou
    veio de um caminho que não chama release_pending_orders_for_sku (ex:
    cadastro de produto em massa — ver stock_manager.py). Não é mágica: só
    roda a MESMA `apply_stock_for_orders` que o import e os outros dois
    endpoints de resolução já usam.

    order_ids=None pega todo o recorte pendente atual; uma NF fora dele (já
    baixada, cancelada, de seller inativo) é simplesmente ignorada.
    """
    q = _pending_stock_base_query(db)
    if payload.order_ids:
        q = q.filter(models.Order.id.in_(payload.order_ids))

    orders = q.all()
    if not orders:
        return schemas.StockApplyReport()

    report = apply_stock_for_orders(orders, db, operator_id=current_user.id)
    db.add(models.AuditLog(
        entity_type="Order", entity_id=0, action="RETRY_PENDING_STOCK",
        user_id=current_user.id,
        detail=(
            f"Nova tentativa de baixa em lote: {len(report['applied'])} NF(s) "
            f"baixaram estoque; {len(report['pending'])} continuam pendentes."
        ),
    ))
    db.commit()

    pending = [schemas.PendingStockOrderInfo(**p, can_apply=False) for p in report["pending"]]
    missing: dict = {}
    for p in report["pending"]:
        for sku in p["missing_skus"]:
            key = (p["seller_id"], sku)
            if key not in missing:
                missing[key] = schemas.MissingProductInfo(
                    seller_id=p["seller_id"], seller_name=p["seller_name"],
                    sku=sku, product_name=sku, nf_numbers=[],
                )
            if p["nf_number"] not in missing[key].nf_numbers:
                missing[key].nf_numbers.append(p["nf_number"])

    return schemas.StockApplyReport(
        applied_orders=len(report["applied"]),
        pending_orders=pending,
        missing_products=list(missing.values()),
        negatives=[schemas.NegativeStockInfo(**n) for n in report["negatives"]],
    )


# ⚠️ Assim como /pending-stock, as duas rotas de lote abaixo ficam ANTES de
# `/{order_id}` — senão o FastAPI tenta casar "batch-carrier" com order_id:int.
@router.patch("/batch-carrier", response_model=schemas.BatchCarrierResult)
def batch_update_carrier(
    payload: schemas.BatchCarrierRequest,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Preenche a transportadora de VÁRIAS NFs de uma vez (10/08/2026).

    Existe porque a falta de transportadora é a pendência mais comum e chegou a
    segurar 6.703 NFs num dia só — resolver uma a uma pelo PATCH
    /orders/{id}/carrier é inviável na prática.

    ⚠️ UMA chamada a apply_stock_for_orders para o lote inteiro. Chamar
    apply_stock_for_order por NF traria de volta o N+1 que já derrubou esta
    base três vezes (ver CLAUDE.md).

    Transação única: se qualquer linha falhar, nada é gravado.
    """
    updates = payload.updates or []
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhuma transportadora informada")

    # Transportadora vazia não destrava nada e ainda apagaria o valor de quem
    # já tinha — recusa antes de tocar no banco.
    empty = [u.order_id for u in updates if not (u.carrier or "").strip()]
    if empty:
        raise HTTPException(
            status_code=400,
            detail=f"{len(empty)} NF(s) sem transportadora preenchida",
        )

    by_id = {u.order_id: u.carrier.strip() for u in updates}
    orders = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(models.Order.id.in_(list(by_id.keys()))).all()

    found = {o.id for o in orders}
    missing = [oid for oid in by_id if oid not in found]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Pedido(s) não encontrado(s): {', '.join(map(str, missing[:10]))}",
        )

    for order in orders:
        order.carrier = by_id[order.id]

    report = apply_stock_for_orders(orders, db, operator_id=current_user.id)
    applied = set(report["applied"])

    for order in orders:
        db.add(models.AuditLog(
            entity_type="Order", entity_id=order.id, action="UPDATE_CARRIER",
            user_id=current_user.id,
            detail=(
                f"Transportadora (lote): {order.carrier}."
                + (" Estoque baixado automaticamente." if order.id in applied else "")
            ),
        ))
    db.add(models.AuditLog(
        entity_type="Order", entity_id=0, action="BATCH_UPDATE_CARRIER",
        user_id=current_user.id,
        detail=(
            f"Lote de transportadoras: {len(orders)} NF(s) atualizada(s), "
            f"{len(applied)} baixaram estoque."
        ),
    ))
    db.commit()

    return schemas.BatchCarrierResult(
        updated=len(orders),
        stock_applied=len(applied),
        still_pending=len(orders) - len(applied),
        negatives=report["negatives"],
    )


@router.post("/batch-resolve-sku", response_model=schemas.BatchSkuResult)
def batch_resolve_sku(
    payload: schemas.BatchSkuRequest,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Resolve em lote os SKUs sem produto cadastrado que seguram a baixa
    (10/08/2026). Duas ações por SKU:

      create -> cadastra o produto com o SKU que veio na NF. É o caminho
                normal; o cadastro completo (barcode, caixa) fica para depois,
                o importante é não parar o fluxo.
      link   -> "esse SKU na verdade é este outro produto". Reescreve os itens
                das NFs pendentes para o SKU do produto escolhido. Ver
                relink_sku_in_pending_orders para o porquê e os limites.

    Transação única: se qualquer resolução falhar, nada é gravado.
    """
    resolutions = payload.resolutions or []
    if not resolutions:
        raise HTTPException(status_code=400, detail="Nenhuma resolução informada")

    created = linked = reactivated = orders_relinked = 0
    applied_orders: set = set()
    negatives: list = []

    for r in resolutions:
        sku = (r.sku or "").strip()
        if not sku:
            raise HTTPException(status_code=400, detail="Resolução sem SKU")

        seller = db.query(models.Seller).filter(models.Seller.id == r.seller_id).first()
        if not seller:
            raise HTTPException(status_code=404, detail=f"Seller {r.seller_id} não encontrado")

        if r.action == "create":
            name = (r.name or "").strip()
            if not name:
                raise HTTPException(
                    status_code=400,
                    detail=f"SKU '{sku}': informe o nome do produto",
                )
            existing = db.query(models.Product).filter(
                models.Product.seller_id == r.seller_id,
                models.Product.sku == sku,
            ).first()
            if existing:
                # Num lote, 400 aqui derrubaria as outras dezenas de linhas por
                # causa de um SKU que alguém cadastrou no meio do caminho.
                # Inativo -> reativa (era o que a pessoa queria); ativo -> nada
                # a fazer, só destrava.
                if not existing.active:
                    existing.active = True
                    # ⚠️ A sessão é autoflush=False: sem este flush a reativação
                    # fica só na memória e o SELECT de _registered_sku_pairs
                    # continua vendo o produto inativo — a NF não baixaria, em
                    # silêncio. Pego em teste.
                    db.flush()
                    reactivated += 1
                    db.add(models.AuditLog(
                        entity_type="Product", entity_id=existing.id, action="REACTIVATE",
                        user_id=current_user.id,
                        detail=f"Produto reativado ao resolver pendência de estoque: SKU={sku} | Seller={seller.trade_name}",
                    ))
                product = existing
            else:
                product = models.Product(
                    seller_id=r.seller_id,
                    sku=sku,
                    name=name,
                    barcode_seller=(r.barcode_seller or "").strip() or None,
                )
                db.add(product)
                db.flush()
                created += 1
                db.add(models.AuditLog(
                    entity_type="Product", entity_id=product.id, action="CREATE",
                    user_id=current_user.id,
                    detail=f"Produto criado ao resolver pendência de estoque: SKU={sku} | Nome={name} | Seller={seller.trade_name}",
                ))

            report = release_pending_orders_for_sku(
                r.seller_id, sku, db, operator_id=current_user.id
            )

        elif r.action == "link":
            if not r.target_product_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"SKU '{sku}': nenhum produto escolhido para vincular",
                )
            target = db.query(models.Product).filter(
                models.Product.id == r.target_product_id
            ).first()
            if not target:
                raise HTTPException(
                    status_code=404,
                    detail=f"Produto {r.target_product_id} não encontrado",
                )
            if target.seller_id != r.seller_id:
                # Estoque é indexado por (seller_id, sku): apontar para produto
                # de outro seller baixaria o estoque de quem não vendeu.
                raise HTTPException(
                    status_code=400,
                    detail=f"Produto '{target.sku}' é de outro seller — não pode ser vinculado ao SKU '{sku}'",
                )
            if not target.active:
                # Vincular a produto inativo deixaria a NF presa do mesmo jeito.
                target.active = True
                # Mesmo motivo do flush no ramo "create": sem ele, o caso em que
                # o produto escolhido tem o MESMO SKU da NF não passa pelo flush
                # interno do relink e a NF fica pendente sem ninguém perceber.
                db.flush()
                reactivated += 1
                db.add(models.AuditLog(
                    entity_type="Product", entity_id=target.id, action="REACTIVATE",
                    user_id=current_user.id,
                    detail=f"Produto reativado ao vincular SKU '{sku}': SKU={target.sku} | Seller={seller.trade_name}",
                ))

            result = relink_sku_in_pending_orders(
                r.seller_id, sku, target, db, operator_id=current_user.id
            )
            report = result["stock"]
            if target.sku != sku:
                linked += 1
                orders_relinked += result["orders_touched"]
                db.add(models.AuditLog(
                    entity_type="Product", entity_id=target.id, action="RELINK_SKU",
                    user_id=current_user.id,
                    detail=(
                        f"SKU '{sku}' das NFs pendentes reapontado para '{target.sku}' "
                        f"({result['orders_touched']} NF(s)) | Seller={seller.trade_name}"
                    ),
                ))
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Ação inválida '{r.action}' para o SKU '{sku}' (use 'create' ou 'link')",
            )

        applied_orders.update(report["applied"])
        negatives.extend(report["negatives"])

    db.add(models.AuditLog(
        entity_type="Product", entity_id=0, action="BATCH_RESOLVE_SKU",
        user_id=current_user.id,
        detail=(
            f"Lote de SKUs pendentes: {created} criado(s), {linked} vinculado(s), "
            f"{reactivated} reativado(s) — {len(applied_orders)} NF(s) baixaram estoque."
        ),
    ))
    db.commit()

    return schemas.BatchSkuResult(
        created=created,
        linked=linked,
        reactivated=reactivated,
        orders_relinked=orders_relinked,
        stock_applied=len(applied_orders),
        negatives=negatives,
    )


@router.get("/{order_id}", response_model=schemas.OrderResponse)
def get_order(
    order_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Busca pedido por ID."""
    order = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    # 1 consulta agrupada por SKU em vez de 1 por item (N+1 — ver CLAUDE.md).
    # Se a NF foi reativada depois de inativada, ignora bipagem anterior ao
    # corte do ciclo novo — ver order.reactivated_at / deactivate_order em
    # scanning.py.
    scan_filters = [
        models.ScanningLog.order_id == order.id,
        models.ScanningLog.is_error == False,
        models.ScanningLog.is_interrupted == False,
    ]
    if order.reactivated_at:
        scan_filters.append(models.ScanningLog.timestamp > order.reactivated_at)
    item_scan_counts = dict(
        db.query(
            models.ScanningLog.sku,
            func.sum(models.ScanningLog.quantity),
        ).filter(
            *scan_filters
        ).group_by(models.ScanningLog.sku).all()
    )
    item_scan_counts = {sku: item_scan_counts.get(sku, 0) or 0 for sku in {item.sku for item in order.items}}

    return schemas.OrderResponse(
        id=order.id,
        erp_code=order.erp_code,
        nf_number=order.nf_number,
        customer_name=order.customer_name,
        order_date=order.order_date,
        seller_id=order.seller_id,
        seller_name=order.seller.trade_name if order.seller else None,
        unit_id=order.unit_id,
        carrier=order.carrier,
        status=order.status.value if hasattr(order.status, 'value') else order.status,
        expedition_date=order.expedition_date,
        nature=order.nature,
        danfe_key=order.danfe_key,
        for_billing=order.for_billing,
        imported_at=order.imported_at,
        session_id=order.session_id,
        stock_applied_at=order.stock_applied_at,
        items=[
            schemas.OrderItemResponse(
                id=item.id,
                sku=item.sku,
                product_name=item.product_name,
                quantity=item.quantity,
                is_kit_component=item.is_kit_component,
                original_kit_sku=item.original_kit_sku,
                scanned_qty=item_scan_counts.get(item.sku, 0),
            )
            for item in order.items
        ],
    )


@router.patch("/{order_id}/config")
def configure_order(
    order_id: int,
    file_type: Optional[str] = None,
    for_billing: Optional[bool] = None,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Configura tipo do arquivo (entrada/saída) e se é para faturamento.

    ⚠️ O file_type define o SINAL do movimento de estoque (06/08/2026). Se a NF
    já baixou, trocar o tipo sem mexer no estoque deixaria o movimento com o
    sinal errado em silêncio — então estorna com o sinal antigo e baixa de novo
    com o novo. Antes desta data o valor era gravado como string crua na coluna
    Enum, o que também estava errado.
    """
    order = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    resigned = False
    if file_type is not None:
        new_file_type = (
            models.FileType.IMPORT if str(file_type).strip().lower() in ("entrada", "in")
            else models.FileType.EXPORT
        )
        if new_file_type != order.file_type:
            # ⚠️ NF com excedente de conferência bipado (17/08/2026) não troca de
            # tipo: o estorno abaixo leva o excedente junto (trabalha por saldo
            # líquido do order_id), mas o re-lançamento só repõe a quantidade da
            # NF — o excedente sumiria do estoque em silêncio.
            if order_has_scan_overage(order.id, db):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"A NF {order.nf_number} tem excedente de conferência lançado no "
                        f"estoque (foi recebido mais do que a NF previa). Trocar o tipo "
                        f"apagaria esse excedente. Ajuste o estoque manualmente antes, "
                        f"pela tela de Estoque."
                    ),
                )
            if order.stock_applied_at:
                result = reverse_stock_for_order(
                    order, db,
                    observation=(
                        f"ESTORNO — tipo da NF {order.nf_number} alterado para '{file_type}' "
                        f"por {current_user.name} em {now_brasilia().strftime('%d/%m/%Y %H:%M')}. "
                        f"Reverte a baixa feita com o tipo anterior."
                    ),
                    operator_id=current_user.id,
                )
                if result == -1:
                    # NF órfã (nenhum movimento vinculado — ex: vínculo perdido numa
                    # reconciliação de estoque). NÃO reaplicar automaticamente: o
                    # efeito desta NF já pode estar embutido no saldo reconciliado,
                    # e um novo lançamento duplicaria a quantidade. Bloqueia a troca
                    # de tipo até conferência manual.
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Não foi possível confirmar a baixa atual da NF {order.nf_number} "
                            f"(nenhum movimento de estoque vinculado a ela). A troca de tipo foi "
                            f"bloqueada para evitar duplicar o estoque — verifique manualmente "
                            f"antes de tentar de novo."
                        ),
                    )
                order.file_type = new_file_type
                apply_stock_for_order(order, db, operator_id=current_user.id)
                resigned = True
            else:
                order.file_type = new_file_type

    if for_billing is not None:
        order.for_billing = for_billing

    db.commit()
    return {
        "message": (
            "Configuração atualizada"
            + (" — estoque re-lançado com o novo sinal." if resigned else "")
        ),
        "stock_resigned": resigned,
    }


@router.patch("/{order_id}/carrier")
def update_order_carrier(
    order_id: int,
    data: dict,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Atualiza transportadora de um pedido.

    Falta de transportadora é um dos dois motivos que seguram a baixa de
    estoque (06/08/2026). Preencher aqui destrava a NF NA HORA — sem precisar
    de nenhuma outra ação. Ver services/stock_manager.py.
    """
    order = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    carrier = data.get("carrier", "").strip()
    order.carrier = carrier or None

    stock_report = apply_stock_for_order(order, db, operator_id=current_user.id)
    stock_applied = order.id in stock_report["applied"]

    db.add(models.AuditLog(
        entity_type="Order", entity_id=order_id, action="UPDATE_CARRIER",
        user_id=current_user.id,
        detail=(
            f"Transportadora: {carrier or 'removida'}."
            + (" Estoque baixado automaticamente." if stock_applied else "")
        ),
    ))
    db.commit()
    return {
        "message": (
            "Transportadora atualizada"
            + (" — estoque baixado." if stock_applied else "")
        ),
        "carrier": order.carrier,
        "stock_applied": stock_applied,
        "negatives": stock_report["negatives"],
        "pending": stock_report["pending"][0] if stock_report["pending"] else None,
    }
