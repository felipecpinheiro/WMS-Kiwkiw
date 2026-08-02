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
from ..services.pdf_generator import generate_separation_bytes, generate_expedition_bytes, generate_pdfs_for_session
from ..services.audit_export import export_session_to_csv
from ..timezone_utils import today_brasilia

router = APIRouter(prefix="/orders", tags=["Pedidos"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
EXPORT_DIR = os.path.join(BASE_DIR, "data", "exports")


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
    file_type_enum = models.FileType.IN if file_type.strip().lower() in ("entrada", "in") else models.FileType.EXPORT

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
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista pedidos com filtros."""
    query = db.query(models.Order).options(
        joinedload(models.Order.items),
        joinedload(models.Order.seller),
    )

    # Pedido cancelado (ex.: duplicata de upload removida) nunca aparece
    # nesta tela, pra ninguém — só fica rastreável na Trilha de Auditoria.
    query = query.filter(models.Order.status != models.OrderStatus.CANCELLED)

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
    item_scan_counts = dict(
        db.query(
            models.ScanningLog.sku,
            func.sum(models.ScanningLog.quantity),
        ).filter(
            models.ScanningLog.order_id == order.id,
            models.ScanningLog.is_error == False,
            models.ScanningLog.is_interrupted == False,
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
    """Configura tipo do arquivo (entrada/saída) e se é para faturamento."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    if file_type is not None:
        order.file_type = file_type
    if for_billing is not None:
        order.for_billing = for_billing

    db.commit()
    return {"message": "Configuração atualizada"}


@router.patch("/{order_id}/carrier")
def update_order_carrier(
    order_id: int,
    data: dict,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """Atualiza transportadora de um pedido."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    carrier = data.get("carrier", "").strip()
    order.carrier = carrier or None
    db.add(models.AuditLog(
        entity_type="Order", entity_id=order_id, action="UPDATE_CARRIER",
        user_id=current_user.id,
        detail=f"Transportadora: {carrier or 'removida'}",
    ))
    db.commit()
    return {"message": "Transportadora atualizada", "carrier": order.carrier}
