"""
WMS Kiwkiw - Router de Pedidos
Importação, listagem e gestão de pedidos.
"""

import os
import aiofiles
from typing import Optional, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_

from ..database import get_db
from ..auth import get_current_user, require_admin, require_manager_or_above
from .. import models, schemas
from ..services.order_import import import_excel_orders
from ..services.pdf_generator import generate_separation_report, generate_expedition_report
from ..services.audit_export import export_session_to_csv, organize_pdfs_by_session

router = APIRouter(prefix="/orders", tags=["Pedidos"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
EXPORT_DIR = os.path.join(BASE_DIR, "data", "exports")


@router.post("/import", response_model=schemas.ImportResult)
async def import_orders(
    file: UploadFile = File(..., description="Arquivo Excel com pedidos do ERP"),
    unit_id: int = Form(..., description="ID da unidade"),
    file_type: str = Form("Saída", description="'Entrada' ou 'Saída' (aplica-se a TODOS os pedidos do arquivo)"),
    for_billing: bool = Form(True, description="Considerar este arquivo para faturamento (aplica-se a TODOS os pedidos)"),
    force_duplicates: bool = Form(False, description="Se True, reimporta mesmo havendo NFs já presentes no banco"),
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
    """
    if not file.filename.endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400, detail="Apenas arquivos Excel são aceitos (.xlsx, .xlsm, .xls)")

    # Valida file_type
    file_type_enum = models.FileType.IN if file_type.strip().lower() in ("entrada", "in") else models.FileType.EXPORT

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Salva arquivo temporário
    file_path = os.path.join(UPLOAD_DIR, f"{date.today().strftime('%Y%m%d')}_{file.filename}")
    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Importa pedidos — passa as configs de nível de sessão
    result = await import_excel_orders(
        file_path=file_path,
        unit_id=unit_id,
        db=db,
        created_by_id=current_user.id,
        file_type=file_type_enum,
        for_billing=for_billing,
        force_duplicates=force_duplicates,
    )

    # Se o serviço pediu confirmação (duplicatas), devolve direto sem gerar PDFs
    if getattr(result, "requires_confirmation", False):
        return result

    # Gera PDFs + CSV de auditoria automaticamente se importação bem-sucedida.
    # Estrutura final em data/exports/<unidade>/<seller>/<data>/
    if result.success and result.session_id:
        session = db.query(models.PickingSession).options(
            joinedload(models.PickingSession.unit)
        ).filter(models.PickingSession.id == result.session_id).first()
        if session:
            try:
                os.makedirs(EXPORT_DIR, exist_ok=True)
                # Gera PDFs em pasta temporária "flat" (nome padrão do gerador)
                sep_tmp = generate_separation_report(session, db, EXPORT_DIR)
                exp_tmp = generate_expedition_report(session, db, EXPORT_DIR)
                # Move PDFs para <unidade>/ALL_SELLERS/<data>/
                sep_path, exp_path = organize_pdfs_by_session(
                    session, db, EXPORT_DIR, sep_tmp, exp_tmp
                )
                session.separation_pdf = sep_path
                session.expedition_pdf = exp_path
                session.check_separation = True
                session.check_planning = True

                # CSV por seller em <unidade>/<seller>/<data>/
                csv_paths = export_session_to_csv(session, db, EXPORT_DIR)
                db.commit()

                result.warnings.append(
                    f"PDFs + {len(csv_paths)} CSV(s) de auditoria gerados em {os.path.relpath(os.path.dirname(sep_path or ''), BASE_DIR) if sep_path else 'data/exports'}"
                )
            except Exception as e:
                db.rollback()
                result.warnings.append(f"Aviso: PDFs/CSV não gerados automaticamente: {str(e)}")

    return result


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

    # Restrição por role: seller só vê os próprios pedidos
    user_role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
    if user_role == "client" and current_user.seller_id:
        query = query.filter(models.Order.seller_id == current_user.seller_id)

    if session_id:
        query = query.filter(models.Order.session_id == session_id)
    if seller_id:
        query = query.filter(models.Order.seller_id == seller_id)
    if unit_id:
        query = query.filter(models.Order.unit_id == unit_id)
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
        items=[
            schemas.OrderItemResponse(
                id=item.id,
                sku=item.sku,
                product_name=item.product_name,
                quantity=item.quantity,
                is_kit_component=item.is_kit_component,
                original_kit_sku=item.original_kit_sku,
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
    """Atualiza a transportadora de um pedido (usado no Dashboard quando falta transportadora)."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido nao encontrado")
    carrier = data.get("carrier", "").strip()
    if not carrier:
        raise HTTPException(status_code=400, detail="Transportadora nao pode ser vazia")
    order.carrier = carrier
    db.commit()
    return {"success": True, "order_id": order_id, "carrier": carrier}
