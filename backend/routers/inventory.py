"""
WMS Kiwkiw - Router de Estoque
Consulta, exportação e movimentações de estoque.
"""

import csv
import io
import json
import tempfile
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..auth import get_current_user, require_master_or_above, require_admin
from .. import models
from ..services.stock_manager import (
    get_stock_report, update_stock_position, get_sku_history, calculate_stock_level,
)

router = APIRouter(prefix="/inventory", tags=["Estoque"])

EDIT_PASSPHRASE = "k&ksmt$"


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO DE SENHA (resposta imediata, sem abrir janela de edição)
# ─────────────────────────────────────────────────────────

@router.post("/verify-passphrase")
def verify_passphrase(
    body: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Verifica a senha de edição de movimentações imediatamente.
    Retorna 200 se correta, 403 se incorreta.
    Permite que o frontend barre o acesso SEM abrir a janela de edição.
    """
    passphrase = body.get("passphrase", "")
    if passphrase != EDIT_PASSPHRASE:
        raise HTTPException(status_code=403, detail="Senha de edição incorreta")
    return {"valid": True}


# ─────────────────────────────────────────────────────────
# POSIÇÃO DE ESTOQUE
# ─────────────────────────────────────────────────────────

@router.get("/stock/{seller_id}")
def get_stock(
    seller_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna posição de estoque de um seller.
    Sellers só acessam o próprio estoque.
    """
    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else current_user.role
    )
    if user_role == "seller" and current_user.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    return get_stock_report(seller_id, db)


# ─────────────────────────────────────────────────────────
# HISTÓRICO / GRÁFICO DE SKU
# ─────────────────────────────────────────────────────────

@router.get("/sku-history/{seller_id}/{sku}")
def sku_history(
    seller_id: int,
    sku: str,
    days: int = Query(90, ge=7, le=365),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna histórico de movimentações de um SKU para o popup de análise.
    Inclui gráfico diário e estatísticas de média de consumo.
    """
    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else current_user.role
    )
    if user_role == "seller" and current_user.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    return get_sku_history(seller_id=seller_id, sku=sku, db=db, days=days)


# ─────────────────────────────────────────────────────────
# MOVIMENTAÇÕES
# ─────────────────────────────────────────────────────────

@router.get("/movements/{seller_id}")
def get_movements(
    seller_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sku: Optional[str] = None,
    movement_type: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna histórico de movimentações de estoque com filtros opcionais.
    """
    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else current_user.role
    )
    if user_role == "seller" and current_user.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    q = db.query(models.StockMovement).filter(
        models.StockMovement.seller_id == seller_id
    )

    if date_from:
        q = q.filter(models.StockMovement.movement_date >= date_from)
    if date_to:
        q = q.filter(models.StockMovement.movement_date <= date_to)
    if sku:
        q = q.filter(models.StockMovement.sku.ilike(f"%{sku}%"))
    if movement_type:
        try:
            mt_enum = models.MovementType(movement_type)
            q = q.filter(models.StockMovement.movement_type == mt_enum)
        except ValueError:
            pass

    movements = q.order_by(models.StockMovement.movement_date.desc()).all()

    result = []
    for m in movements:
        mt = (
            m.movement_type.value
            if hasattr(m.movement_type, "value")
            else m.movement_type
        )
        result.append({
            "id": m.id,
            "seller_id": m.seller_id,
            "sku": m.sku,
            "product_name": m.product_name,
            "movement_date": str(m.movement_date),
            "movement_type": mt,
            "quantity": m.quantity,
            "adjusted_quantity": m.adjusted_quantity,
            "nf_number": m.nf_number,
            "nature": m.nature,
            "order_id": m.order_id,
            "session_id": m.session_id,
            "observation": m.observation,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })

    return result


@router.post("/movements/manual", status_code=201)
def create_manual_movement(
    body: dict,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Cria uma movimentação manual de estoque (entrada ou saída).
    Requer papel master ou superior.
    """
    seller_id = body.get("seller_id")
    sku = body.get("sku", "").strip()
    movement_type_str = body.get("movement_type", "")
    quantity = int(body.get("quantity", 0))
    movement_date_str = body.get("movement_date") or str(date.today())
    observation = body.get("observation", "")
    nf_number = body.get("nf_number", "")
    product_name = body.get("product_name", sku)

    if not seller_id or not sku or not movement_type_str or quantity <= 0:
        raise HTTPException(
            status_code=422,
            detail="seller_id, sku, movement_type e quantity (>0) são obrigatórios",
        )

    # Normaliza tipo: aceita "Saida" / "saida" / "Saída" / "Entrada" etc.
    _type_norm = {
        'entrada': 'Entrada',
        'saida': 'Saída',
        'saída': 'Saída',
    }
    movement_type_str = _type_norm.get(movement_type_str.lower().strip(), movement_type_str)

    try:
        mt_enum = models.MovementType(movement_type_str)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"movement_type deve ser um de: {[e.value for e in models.MovementType]}",
        )

    try:
        mov_date = date.fromisoformat(movement_date_str)
    except ValueError:
        mov_date = date.today()

    # Resolves product_name from DB if not provided
    if not product_name or product_name == sku:
        prod = db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku == sku,
        ).first()
        if prod:
            product_name = prod.name

    movement = models.StockMovement(
        seller_id=seller_id,
        sku=sku,
        product_name=product_name,
        movement_date=mov_date,
        movement_type=mt_enum,
        quantity=quantity,
        adjusted_quantity=quantity,
        nf_number=nf_number or None,
        observation=observation or None,
        operator_id=current_user.id,
        created_at=datetime.now(),
    )
    db.add(movement)

    update_stock_position(
        seller_id=seller_id,
        sku=sku,
        product_name=product_name,
        movement_type=mt_enum,
        quantity=quantity,
        db=db,
    )

    # ── Trilha de auditoria: registra lançamento manual ──────────────────────
    seller_obj = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_label = seller_obj.trade_name if seller_obj else str(seller_id)
    db.add(models.AuditLog(
        entity_type="StockMovement",
        entity_id=None,  # será preenchido após commit se necessário
        action="MANUAL_MOVEMENT",
        detail=(
            f"Lançamento manual | Tipo: {movement_type_str} | SKU: {sku} | "
            f"Qtd: {quantity} | Seller: {seller_label} | "
            f"Data: {mov_date} | NF: {nf_number or '-'} | "
            f"Obs: {observation or '-'}"
        ),
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(movement)

    mt_val = (
        movement.movement_type.value
        if hasattr(movement.movement_type, "value")
        else movement.movement_type
    )
    return {
        "id": movement.id,
        "sku": movement.sku,
        "product_name": movement.product_name,
        "movement_type": mt_val,
        "quantity": movement.quantity,
        "movement_date": str(movement.movement_date),
        "observation": movement.observation,
    }


@router.post("/movements/bulk", status_code=201)
def create_bulk_movements(
    body: dict,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Importação em lote de movimentações de estoque.
    Muito mais eficiente que chamar /movements/manual N vezes:
    - Pré-carrega produtos e posições de estoque com 2 queries únicas
    - Atualiza posições em memória (sem query por linha)
    - Insere todos os movimentos com um único commit
    """
    seller_id = body.get("seller_id")
    rows = body.get("rows", [])

    if not seller_id:
        raise HTTPException(status_code=422, detail="seller_id é obrigatório")
    if not rows:
        raise HTTPException(status_code=422, detail="Nenhuma linha fornecida")

    _type_norm = {
        'entrada': 'Entrada',
        'saida': 'Saída',
        'saída': 'Saída',
    }

    # ── 1. Pré-carrega todos os produtos do seller em memória ─────────────────
    skus_in_batch = {r.get("sku", "").strip() for r in rows if r.get("sku", "").strip()}
    products_by_sku: dict[str, str] = {
        p.sku: p.name
        for p in db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku.in_(skus_in_batch),
        ).all()
    }

    # ── 2. Pré-carrega todas as posições de estoque em memória ───────────────
    positions_by_sku: dict[str, models.StockPosition] = {
        p.sku: p
        for p in db.query(models.StockPosition).filter(
            models.StockPosition.seller_id == seller_id,
            models.StockPosition.sku.in_(skus_in_batch),
        ).all()
    }

    movements_to_add: list[models.StockMovement] = []
    ok = 0
    errors: list[str] = []
    now = datetime.now()

    # ── 3. Processa cada linha sem tocar no banco ─────────────────────────────
    for i, row in enumerate(rows):
        try:
            sku = row.get("sku", "").strip()
            if not sku:
                errors.append(f"Linha {i + 1}: SKU vazio")
                continue

            raw_type = row.get("movement_type", "")
            mt_str = _type_norm.get(raw_type.lower().strip(), raw_type)
            try:
                mt_enum = models.MovementType(mt_str)
            except ValueError:
                errors.append(f"Linha {i + 1}: tipo inválido '{raw_type}'")
                continue

            quantity = int(row.get("quantity", 0))
            if quantity <= 0:
                errors.append(f"Linha {i + 1}: quantidade inválida")
                continue

            movement_date_str = row.get("movement_date") or str(date.today())
            try:
                mov_date = date.fromisoformat(movement_date_str)
            except ValueError:
                mov_date = date.today()

            product_name = products_by_sku.get(sku, sku)
            nf_number = row.get("nf_number") or None
            observation = row.get("observation") or None

            # Cria objeto de movimento (ainda não persiste)
            movements_to_add.append(models.StockMovement(
                seller_id=seller_id,
                sku=sku,
                product_name=product_name,
                movement_date=mov_date,
                movement_type=mt_enum,
                quantity=quantity,
                adjusted_quantity=quantity,
                nf_number=nf_number,
                observation=observation,
                operator_id=current_user.id,
                created_at=now,
            ))

            # Atualiza posição em memória (zero queries extras)
            if sku not in positions_by_sku:
                pos = models.StockPosition(
                    seller_id=seller_id,
                    sku=sku,
                    product_name=product_name,
                    initial_stock=0,
                    total_in=0,
                    total_out=0,
                    current_stock=0,
                )
                db.add(pos)
                positions_by_sku[sku] = pos

            pos = positions_by_sku[sku]
            if mt_enum == models.MovementType.IN:
                pos.total_in += quantity
            else:
                pos.total_out += quantity
            pos.current_stock = pos.initial_stock + pos.total_in - pos.total_out
            pos.level = calculate_stock_level(pos.current_stock)
            pos.updated_at = now
            if not pos.product_name:
                pos.product_name = product_name

            ok += 1

        except Exception as e:
            errors.append(f"Linha {i + 1}: {str(e)}")

    # ── 4. Um único insert em lote + commit ──────────────────────────────────
    if movements_to_add:
        db.bulk_save_objects(movements_to_add)

    # Trilha de auditoria resumida (1 registro para o lote inteiro)
    seller_obj = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_label = seller_obj.trade_name if seller_obj else str(seller_id)
    db.add(models.AuditLog(
        entity_type="StockMovement",
        entity_id=None,
        action="BULK_IMPORT",
        detail=(
            f"Importação em lote | Seller: {seller_label} | "
            f"Linhas OK: {ok} | Erros: {len(errors)}"
        ),
        user_id=current_user.id,
    ))

    db.commit()

    return {"imported": ok, "errors": errors}


@router.put("/movements/{movement_id}")
def update_movement(
    movement_id: int,
    body: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Edita uma movimentação existente.
    Requer papel admin + senha especial.
    A diferença de quantidade é refletida na posição de estoque.
    """
    passphrase = body.get("passphrase", "")
    if passphrase != EDIT_PASSPHRASE:
        raise HTTPException(status_code=403, detail="Senha de edição incorreta")

    movement = db.query(models.StockMovement).filter(
        models.StockMovement.id == movement_id
    ).first()
    if not movement:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")

    # Campos editáveis
    old_qty = movement.quantity
    old_type = movement.movement_type

    if "quantity" in body and body["quantity"] is not None:
        new_qty = int(body["quantity"])
        if new_qty <= 0:
            raise HTTPException(status_code=422, detail="Quantidade deve ser > 0")

        # Reverte o efeito antigo na posição e aplica o novo
        position = db.query(models.StockPosition).filter(
            models.StockPosition.seller_id == movement.seller_id,
            models.StockPosition.sku == movement.sku,
        ).first()

        if position:
            if old_type == models.MovementType.IN:
                position.total_in = max(0, position.total_in - old_qty + new_qty)
            else:
                position.total_out = max(0, position.total_out - old_qty + new_qty)
            position.current_stock = position.initial_stock + position.total_in - position.total_out
            from ..services.stock_manager import calculate_stock_level
            position.level = calculate_stock_level(position.current_stock)
            position.updated_at = datetime.now()

        movement.quantity = new_qty
        movement.adjusted_quantity = new_qty

    if "observation" in body:
        movement.observation = body["observation"]
    if "nf_number" in body:
        movement.nf_number = body["nf_number"]
    if "movement_date" in body and body["movement_date"]:
        try:
            movement.movement_date = date.fromisoformat(body["movement_date"])
        except ValueError:
            pass

    # ── Trilha de auditoria: registra edição manual ──────────────────────────
    db.add(models.AuditLog(
        entity_type="StockMovement",
        entity_id=movement_id,
        action="EDIT_MOVEMENT",
        detail=(
            f"Edição de movimentação #{movement_id} | "
            f"SKU: {movement.sku} | Seller: {movement.seller_id} | "
            f"Nova Qtd: {movement.quantity} | Data: {movement.movement_date}"
        ),
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(movement)

    mt_val = (
        movement.movement_type.value
        if hasattr(movement.movement_type, "value")
        else movement.movement_type
    )
    return {
        "id": movement.id,
        "sku": movement.sku,
        "quantity": movement.quantity,
        "movement_type": mt_val,
        "movement_date": str(movement.movement_date),
        "observation": movement.observation,
    }


# ─────────────────────────────────────────────────────────
# SKU LOOKUP
# ─────────────────────────────────────────────────────────

@router.get("/sku-lookup")
def sku_lookup(
    seller_id: int,
    sku: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Verifica se um SKU está cadastrado para o seller informado.
    Retorna nome do produto e barcode caso encontrado.
    """
    product = db.query(models.Product).filter(
        models.Product.seller_id == seller_id,
        models.Product.sku == sku,
    ).first()

    if product:
        return {
            "found": True,
            "sku": product.sku,
            "name": product.name,
            "barcode_seller": product.barcode_seller,
        }

    # Tenta pelo barcode
    product = db.query(models.Product).filter(
        models.Product.seller_id == seller_id,
        models.Product.barcode_seller == sku,
    ).first()

    if product:
        return {
            "found": True,
            "sku": product.sku,
            "name": product.name,
            "barcode_seller": product.barcode_seller,
        }

    return {"found": False, "sku": sku}


# ─────────────────────────────────────────────────────────
# EXPORTAÇÃO CSV
# ─────────────────────────────────────────────────────────

@router.get("/stock/{seller_id}/export/csv")
def export_stock_csv(
    seller_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Exporta posição de estoque em CSV para download.
    """
    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else current_user.role
    )
    if user_role == "seller" and current_user.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    positions = db.query(models.StockPosition).filter(
        models.StockPosition.seller_id == seller_id
    ).order_by(models.StockPosition.sku).all()

    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_name = seller.name if seller else str(seller_id)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow([
        "SKU", "Produto", "Estoque Inicial", "Total Entradas",
        "Total Saidas", "Estoque Atual", "Nivel", "Tipo Insumo",
        "Valor Unit.", "Atualizado em",
    ])

    for p in positions:
        writer.writerow([
            p.sku,
            p.product_name or "",
            p.initial_stock,
            p.total_in,
            p.total_out,
            p.current_stock,
            p.level or "",
            p.supply_type or "",
            p.unit_value or 0,
            p.updated_at.strftime("%d/%m/%Y %H:%M") if p.updated_at else "",
        ])

    output.seek(0)
    filename = f"estoque_{seller_name}_{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/movements/{seller_id}/export/csv")
def export_movements_csv(
    seller_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sku: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Exporta movimentações de estoque em CSV para download.
    """
    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else current_user.role
    )
    if user_role == "seller" and current_user.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    q = db.query(models.StockMovement).filter(
        models.StockMovement.seller_id == seller_id
    )
    if date_from:
        q = q.filter(models.StockMovement.movement_date >= date_from)
    if date_to:
        q = q.filter(models.StockMovement.movement_date <= date_to)
    if sku:
        q = q.filter(models.StockMovement.sku.ilike(f"%{sku}%"))

    movements = q.order_by(models.StockMovement.movement_date.desc()).all()

    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    seller_name = seller.name if seller else str(seller_id)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow([
        "ID", "Data", "SKU", "Produto", "Tipo", "Quantidade",
        "Qtd Ajustada", "NF", "Natureza", "Observacao", "Criado em",
    ])

    for m in movements:
        mt = (
            m.movement_type.value
            if hasattr(m.movement_type, "value")
            else m.movement_type
        )
        writer.writerow([
            m.id,
            str(m.movement_date),
            m.sku,
            m.product_name or "",
            mt,
            m.quantity,
            m.adjusted_quantity or m.quantity,
            m.nf_number or "",
            m.nature or "",
            m.observation or "",
            m.created_at.strftime("%d/%m/%Y %H:%M") if m.created_at else "",
        ])

    output.seek(0)
    filename = f"movimentacoes_{seller_name}_{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────
# IMPORTAÇÃO DE HISTÓRICO (Excel DETALHADO)
# ─────────────────────────────────────────────────────────

def _parse_history_excel(file_bytes: bytes):
    """
    Faz o parse do Excel no formato DETALHADO.
    Linha 1: cabeçalho mesclado (ignorado)
    Linha 2: nomes das colunas
    Linha 3+: dados
    Colunas: B=Log, C=Tipo, D=Data, E=SKU, F=Quantidade, H=Nome, I=Observação, AB=#NF
    """
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="openpyxl não instalado no servidor. Execute: pip install openpyxl",
        )

    from io import BytesIO
    # read_only=True usa streaming — muito mais rápido para arquivos grandes
    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True, read_only=True)

    # Encontra a aba DETALHADO (case-insensitive)
    sheet = None
    for name in wb.sheetnames:
        if "detalha" in name.lower():
            sheet = wb[name]
            break
    if sheet is None:
        raise HTTPException(
            status_code=422,
            detail="Aba 'DETALHADO' não encontrada no arquivo Excel.",
        )

    rows = []
    # Pula linhas 1 (merge) e 2 (cabeçalho), lê a partir da linha 3
    for i, row in enumerate(sheet.iter_rows(values_only=True, min_row=3)):
        # Garante acesso seguro a qualquer índice (linhas curtas retornam None)
        def _cell(idx: int):
            return row[idx] if len(row) > idx else None

        data   = _cell(1)   # col B (Log — timestamp da movimentação)
        tipo   = _cell(2)   # col C
        sku    = _cell(4)   # col E
        qty    = _cell(5)   # col F
        nome   = _cell(7)   # col H
        obs    = _cell(8)   # col I
        nf     = _cell(27)  # col AB

        # Ignora linhas sem SKU ou quantidade
        if not sku or qty is None:
            continue
        sku = str(sku).strip()
        if not sku:
            continue

        try:
            qty_int = int(float(qty))
        except (ValueError, TypeError):
            continue
        if qty_int <= 0:
            continue

        # Normaliza tipo
        tipo_str = str(tipo).strip() if tipo else "Entrada"
        if tipo_str.lower() in ("saida", "saída", "out", "s"):
            tipo_norm = "Saida"
        else:
            tipo_norm = "Entrada"

        # Normaliza data
        if isinstance(data, datetime):
            mov_date = data.date()
        elif isinstance(data, date) and not isinstance(data, datetime):
            mov_date = data
        else:
            mov_date = date.today()

        rows.append({
            "sku": sku,
            "product_name_from_sheet": str(nome).strip() if nome else sku,
            "movement_type": tipo_norm,
            "movement_date": str(mov_date),
            "quantity": qty_int,
            "observation": str(obs).strip() if obs else None,
            "nf_number": str(nf).strip() if nf else None,
        })

    wb.close()  # libera memória do workbook read_only
    return rows


@router.post("/import-history/{seller_id}/analyze")
async def analyze_history(
    seller_id: int,
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Fase 1: analisa o Excel e retorna SKUs não cadastrados.
    Não importa nada — apenas lê e informa o que precisa ser cadastrado.
    """
    file_bytes = await file.read()
    try:
        rows = _parse_history_excel(file_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha ao processar o Excel: {exc}")

    if not rows:
        raise HTTPException(status_code=422, detail="Nenhuma linha válida encontrada no arquivo. Verifique se a aba DETALHADO existe e tem dados a partir da linha 3.")

    # Descobre SKUs únicos presentes no arquivo
    sku_names: dict = {}  # sku -> nome sugerido pela planilha
    for r in rows:
        if r["sku"] not in sku_names:
            sku_names[r["sku"]] = r["product_name_from_sheet"]

    # Quais SKUs já estão cadastrados?
    existing_skus = {
        p.sku for p in db.query(models.Product.sku).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku.in_(list(sku_names.keys())),
        ).all()
    }

    unknown = [
        {"sku": sku, "suggested_name": name, "count": sum(1 for r in rows if r["sku"] == sku)}
        for sku, name in sku_names.items()
        if sku not in existing_skus
    ]

    return {
        "total_rows": len(rows),
        "total_skus": len(sku_names),
        "unknown_skus": sorted(unknown, key=lambda x: x["sku"]),
        "already_registered": len(sku_names) - len(unknown),
    }


@router.post("/import-history/{seller_id}/execute")
async def execute_history_import(
    seller_id: int,
    file: UploadFile = File(...),
    product_names: str = Form("{}"),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Fase 2: importa o histórico de movimentações.
    - product_names: JSON {sku: name} para produtos a cadastrar
    - Cria produtos novos, depois importa todas as movimentações
    - Recalcula posições de estoque
    """
    file_bytes = await file.read()
    rows = _parse_history_excel(file_bytes)

    # Cadastra produtos novos
    try:
        names_map: dict = json.loads(product_names)
    except Exception:
        names_map = {}

    products_created = 0
    for sku, name in names_map.items():
        if not name or not name.strip():
            continue
        existing = db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku == sku,
        ).first()
        if not existing:
            prod = models.Product(
                seller_id=seller_id,
                sku=sku,
                name=name.strip(),
            )
            db.add(prod)
            products_created += 1

    if products_created:
        db.commit()

    # Importa movimentações
    imported = 0
    skipped_dup = 0
    errors = []

    for r in rows:
        try:
            mov_date = date.fromisoformat(r["movement_date"])
        except Exception:
            mov_date = date.today()

        try:
            mt = (
                models.MovementType.IN
                if r["movement_type"] == "Entrada"
                else models.MovementType.OUT
            )
        except Exception:
            errors.append(f"Tipo inválido: {r['movement_type']} (SKU {r['sku']})")
            continue

        # Resolve nome do produto
        product_name = names_map.get(r["sku"]) or r["product_name_from_sheet"]
        prod = db.query(models.Product).filter(
            models.Product.seller_id == seller_id,
            models.Product.sku == r["sku"],
        ).first()
        if prod:
            product_name = prod.name

        # Cria movimento
        movement = models.StockMovement(
            seller_id=seller_id,
            sku=r["sku"],
            product_name=product_name,
            movement_date=mov_date,
            movement_type=mt,
            quantity=r["quantity"],
            adjusted_quantity=r["quantity"],
            nf_number=r["nf_number"],
            observation=r["observation"],
            operator_id=current_user.id,
            created_at=datetime.now(),
        )
        db.add(movement)

        # Atualiza posição
        update_stock_position(
            seller_id=seller_id,
            sku=r["sku"],
            product_name=product_name,
            movement_type=mt,
            quantity=r["quantity"],
            db=db,
        )
        imported += 1

    db.commit()

    return {
        "imported": imported,
        "products_created": products_created,
        "skipped": skipped_dup,
        "errors": errors[:10],  # primeiros 10 erros
    }
