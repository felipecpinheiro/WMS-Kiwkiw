"""
WMS Kiwkiw - Router de Cadastros
Produtos, Kits, Algoritmo de Caixa, Sellers, Unidades e Usuários.
"""

import os, shutil
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user, require_master_or_above, require_admin
from .. import models, schemas

router = APIRouter(prefix="/cadastros", tags=["Cadastros"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MEDIA_DIR = os.path.join(BASE_DIR, "data", "media", "products")


# ============================================================
# PRODUTOS
# ============================================================

@router.get("/products")
def list_products(
    seller_id: Optional[int] = None,
    search: Optional[str] = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 100,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lista produtos com paginação server-side.
    Retorna { items, total, page, page_size, pages }.
    page_size máximo: 500. Para buscas sem paginação use page_size=0 (retorna tudo — use com filtros).
    """
    from sqlalchemy.orm import joinedload

    page_size = max(1, min(page_size, 500)) if page_size > 0 else 0
    page = max(1, page)

    query = db.query(models.Product).options(joinedload(models.Product.seller))
    if seller_id:
        query = query.filter(models.Product.seller_id == seller_id)
    if active_only:
        query = query.filter(models.Product.active == True)
    if search:
        term = f"%{search}%"
        query = query.filter(
            models.Product.sku.ilike(term) |
            models.Product.name.ilike(term) |
            models.Product.barcode_seller.ilike(term)
        )

    total = query.count()
    query = query.order_by(models.Product.sku)

    if page_size > 0:
        query = query.offset((page - 1) * page_size).limit(page_size)

    rows = query.all()

    items = [
        {
            "id": p.id,
            "seller_id": p.seller_id,
            "seller_name": p.seller.trade_name if p.seller else None,
            "sku": p.sku,
            "name": p.name,
            "barcode_seller": p.barcode_seller,
            "unit_value": p.unit_value or 0.0,
            "box_type": p.box_type,
            "is_input": bool(p.is_input),
            "photo_url": p.photo_url,
            "active": p.active,
        }
        for p in rows
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)) if page_size > 0 else 1,
    }


@router.post("/products", response_model=schemas.ProductResponse)
def create_product(
    product: schemas.ProductCreate,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    existing = db.query(models.Product).filter(
        models.Product.seller_id == product.seller_id,
        models.Product.sku == product.sku,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"SKU '{product.sku}' já cadastrado para este seller")

    p = models.Product(**product.model_dump())
    db.add(p)
    db.flush()  # Gera o ID sem commitar

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    seller = db.query(models.Seller).filter(models.Seller.id == p.seller_id).first()
    db.add(models.AuditLog(
        entity_type="Product",
        entity_id=p.id,
        action="CREATE",
        detail=f"Produto criado: SKU={p.sku} | Nome={p.name} | Seller={seller.trade_name if seller else p.seller_id}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(p)
    return schemas.ProductResponse(
        id=p.id, seller_id=p.seller_id,
        seller_name=seller.trade_name if seller else None,
        sku=p.sku, name=p.name, barcode_seller=p.barcode_seller,
        unit_value=p.unit_value or 0.0, box_type=p.box_type,
        is_input=bool(p.is_input), photo_url=p.photo_url, active=p.active,
    )


@router.put("/products/{product_id}", response_model=schemas.ProductResponse)
def update_product(
    product_id: int,
    data: schemas.ProductUpdate,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    changed = {f: v for f, v in data.model_dump(exclude_none=True).items()}
    for field, value in changed.items():
        setattr(product, field, value)

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    seller = db.query(models.Seller).filter(models.Seller.id == product.seller_id).first()
    db.add(models.AuditLog(
        entity_type="Product",
        entity_id=product_id,
        action="UPDATE",
        detail=(
            f"Produto atualizado: SKU={product.sku} | Seller={seller.trade_name if seller else product.seller_id} | "
            f"Campos: {', '.join(changed.keys())}"
        ),
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(product)
    return schemas.ProductResponse(
        id=product.id, seller_id=product.seller_id,
        seller_name=seller.trade_name if seller else None,
        sku=product.sku, name=product.name, barcode_seller=product.barcode_seller,
        unit_value=product.unit_value or 0.0, box_type=product.box_type,
        is_input=bool(product.is_input), photo_url=product.photo_url, active=product.active,
    )


@router.post("/products/{product_id}/photo")
async def upload_product_photo(
    product_id: int,
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """Upload de foto do produto para exibição durante a bipagem."""
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Apenas imagens são aceitas")

    os.makedirs(MEDIA_DIR, exist_ok=True)
    ext = file.filename.split(".")[-1]
    file_path = os.path.join(MEDIA_DIR, f"product_{product_id}.{ext}")

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    product.photo_url = f"/media/products/product_{product_id}.{ext}"
    db.commit()

    return {"photo_url": product.photo_url}


# ============================================================
# KITS
# ============================================================

@router.get("/kits", response_model=List[schemas.KitResponse])
def list_kits(
    seller_id: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Kit).filter(models.Kit.active == True)
    if seller_id:
        query = query.filter(models.Kit.seller_id == seller_id)
    return query.order_by(models.Kit.kit_sku).all()


@router.post("/kits", response_model=schemas.KitResponse)
def create_kit(
    kit: schemas.KitCreate,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    existing = db.query(models.Kit).filter(
        models.Kit.seller_id == kit.seller_id,
        models.Kit.kit_sku == kit.kit_sku,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Kit '{kit.kit_sku}' já cadastrado")

    k = models.Kit(
        seller_id=kit.seller_id,
        kit_sku=kit.kit_sku,
        kit_name=kit.kit_name,
    )
    db.add(k)
    db.flush()

    for item in kit.items:
        ki = models.KitItem(
            kit_id=k.id,
            component_sku=item.component_sku,
            component_name=item.component_name,
            quantity=item.quantity,
        )
        db.add(ki)

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    seller = db.query(models.Seller).filter(models.Seller.id == kit.seller_id).first()
    comps = ", ".join(f"{i.component_sku}×{i.quantity}" for i in kit.items)
    db.add(models.AuditLog(
        entity_type="Kit",
        entity_id=k.id,
        action="CREATE",
        detail=f"Kit criado: SKU={kit.kit_sku} | Nome={kit.kit_name} | Seller={seller.trade_name if seller else kit.seller_id} | Componentes: {comps}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(k)
    return k


@router.put("/kits/{kit_id}", response_model=schemas.KitResponse)
def update_kit(
    kit_id: int,
    kit: schemas.KitCreate,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    existing = db.query(models.Kit).filter(models.Kit.id == kit_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Kit não encontrado")
    existing.kit_name = kit.kit_name
    db.query(models.KitItem).filter(models.KitItem.kit_id == kit_id).delete()
    for item in kit.items:
        ki = models.KitItem(
            kit_id=kit_id,
            component_sku=item.component_sku,
            component_name=item.component_name,
            quantity=item.quantity,
        )
        db.add(ki)

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    comps = ", ".join(f"{i.component_sku}×{i.quantity}" for i in kit.items)
    db.add(models.AuditLog(
        entity_type="Kit",
        entity_id=kit_id,
        action="UPDATE",
        detail=f"Kit atualizado: SKU={existing.kit_sku} | Nome={kit.kit_name} | Novos componentes: {comps}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(existing)
    return existing


@router.delete("/kits/{kit_id}")
def delete_kit(
    kit_id: int,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    kit = db.query(models.Kit).filter(models.Kit.id == kit_id).first()
    if not kit:
        raise HTTPException(status_code=404, detail="Kit não encontrado")
    kit.active = False

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    db.add(models.AuditLog(
        entity_type="Kit",
        entity_id=kit_id,
        action="DELETE",
        detail=f"Kit desativado: SKU={kit.kit_sku} | Nome={kit.kit_name}",
        user_id=current_user.id,
    ))

    db.commit()
    return {"message": "Kit desativado"}


@router.post("/products/bulk-paste")
def bulk_paste_products(
    items: List[schemas.ProductBulkItem],
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """Upsert em massa de produtos via colagem de tabela."""
    results = {"created": 0, "updated": 0, "skipped": 0, "errors": []}

    # Cache sellers
    sellers_cache = {}
    all_sellers = db.query(models.Seller).all()
    for s in all_sellers:
        sellers_cache[s.trade_name.lower()] = s
        sellers_cache[s.name.lower()] = s

    for item in items:
        if not item.sku or not item.name or not item.seller_name:
            results["skipped"] += 1
            continue

        seller = sellers_cache.get(item.seller_name.lower())
        if not seller:
            results["errors"].append(f"Seller '{item.seller_name}' não encontrado")
            results["skipped"] += 1
            continue

        existing = db.query(models.Product).filter(
            models.Product.seller_id == seller.id,
            models.Product.sku == item.sku,
        ).first()

        if existing:
            existing.name = item.name
            if item.box_type:
                existing.box_type = item.box_type
            if item.barcode_seller:
                existing.barcode_seller = item.barcode_seller
            if item.unit_value is not None:
                existing.unit_value = item.unit_value
            results["updated"] += 1
        else:
            p = models.Product(
                seller_id=seller.id,
                sku=item.sku,
                name=item.name,
                box_type=item.box_type,
                barcode_seller=item.barcode_seller,
                unit_value=item.unit_value or 0.0,
            )
            db.add(p)
            results["created"] += 1

    db.commit()
    return results


@router.post("/products/bulk-upload")
async def bulk_upload_products(
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """
    Upload de planilha Excel de cadastro de produtos.
    Colunas esperadas (linha 1): SKU, SELLER (ou CLIENTE), NOME,
    Valor Unitário, Caixa usada, cod barras cliente.
    Faz upsert: atualiza produtos existentes, cria novos.
    Commita em lotes de 500 para suportar planilhas grandes (20k+ linhas).
    """
    import openpyxl, io as _io

    if not file.filename.lower().endswith(('.xlsx', '.xlsm', '.xls')):
        raise HTTPException(status_code=400, detail="Apenas arquivos Excel (.xlsx) são aceitos")

    content = await file.read()

    try:
        # read_only=True: streaming — 3-5× mais rápido para arquivos grandes
        wb = openpyxl.load_workbook(_io.BytesIO(content), data_only=True, read_only=True)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Não foi possível abrir o arquivo: {e}")

    ws = wb.active

    # ── Detecta linha de cabeçalho (procura 'SKU' nas primeiras 5 linhas) ──────
    header_row_idx = None
    header_map: dict = {}
    preview_rows = []
    for row in ws.iter_rows(min_row=1, max_row=5, values_only=True):
        preview_rows.append(row)

    for ri, row in enumerate(preview_rows, 1):
        for ci, val in enumerate(row):
            if val and str(val).upper().strip() == 'SKU':
                header_row_idx = ri
                for ci2, cv in enumerate(row):
                    if cv:
                        header_map[str(cv).upper().strip()] = ci2
                break
        if header_row_idx:
            break

    wb.close()

    if not header_row_idx:
        raise HTTPException(status_code=400, detail="Cabeçalho não encontrado. Esperava coluna 'SKU' nas primeiras 5 linhas.")

    # ── Resolve índices de coluna (aceita variações de nome) ─────────────────
    def _col(*keys):
        for k in keys:
            v = header_map.get(k.upper().strip())
            if v is not None:
                return v
        return None

    sku_col      = _col('SKU')
    seller_col   = _col('SELLER', 'CLIENTE', 'CLIENT')
    name_col     = _col('NOME', 'NAME')
    value_col    = _col('VALOR UNITÁRIO', 'VALOR', 'UNIT VALUE', 'UNITÁRIO')
    box_col      = _col('CAIXA USADA', 'CAIXA', 'BOX', 'CAIXA USADA')
    barcode_col  = _col(
        'COD BARRAS CLIENTE', 'COD DE BARRAS', 'COD BARRAS',
        'CÓDIGO DE BARRAS', 'BARCODE', 'EAN',
    )

    if sku_col is None or seller_col is None or name_col is None:
        missing = [n for n, v in [('SKU', sku_col), ('SELLER/CLIENTE', seller_col), ('NOME', name_col)] if v is None]
        raise HTTPException(status_code=400, detail=f"Colunas obrigatórias não encontradas: {', '.join(missing)}")

    # ── Cache de sellers (trade_name e name, case-insensitive) ───────────────
    all_sellers = db.query(models.Seller).all()
    sellers_cache: dict = {}
    for s in all_sellers:
        sellers_cache[s.trade_name.strip().lower()] = s
        sellers_cache[s.name.strip().lower()] = s
        # também guarda sem espaços extras
        if s.code:
            sellers_cache[s.code.strip().lower()] = s

    # ── Cache de produtos existentes: (seller_id, sku) → Product ─────────────
    existing_products: dict = {}
    for p in db.query(models.Product).all():
        existing_products[(p.seller_id, p.sku)] = p

    results = {"created": 0, "updated": 0, "skipped": 0, "errors": [], "sellers_not_found": set()}
    BATCH = 500
    pending = 0

    # Re-abre em read_only para iterar as linhas de dados
    wb2 = openpyxl.load_workbook(_io.BytesIO(content), data_only=True, read_only=True)
    ws2 = wb2.active

    for row_num, row in enumerate(ws2.iter_rows(min_row=header_row_idx + 1, values_only=True), header_row_idx + 1):
        def _v(idx):
            return row[idx] if idx is not None and len(row) > idx else None

        raw_sku    = _v(sku_col)
        raw_seller = _v(seller_col)
        raw_name   = _v(name_col)

        if not raw_sku or not raw_seller or not raw_name:
            results["skipped"] += 1
            continue

        sku        = str(raw_sku).strip()
        seller_key = str(raw_seller).strip()
        name       = str(raw_name).strip()

        if not sku or not seller_key or not name:
            results["skipped"] += 1
            continue

        # Valor unitário
        raw_val = _v(value_col)
        try:
            unit_value = float(raw_val) if raw_val is not None else 0.0
        except (ValueError, TypeError):
            unit_value = 0.0

        # Caixa e código de barras
        raw_box     = _v(box_col)
        raw_barcode = _v(barcode_col)
        box_type    = str(raw_box).strip()    if raw_box    else None
        barcode     = str(raw_barcode).strip() if raw_barcode else None
        # Normaliza variações de "Própria"
        if box_type and box_type.lower() in ('propria', 'própria', 'prop.', 'próp.', 'popria', 'propria '):
            box_type = 'Própria'

        # Resolve seller
        seller = sellers_cache.get(seller_key.lower())
        if not seller:
            results["sellers_not_found"].add(seller_key)
            results["skipped"] += 1
            continue

        key = (seller.id, sku)
        existing = existing_products.get(key)

        if existing:
            existing.name       = name
            existing.unit_value = unit_value
            if box_type:
                existing.box_type = box_type
            if barcode:
                existing.barcode_seller = barcode
            results["updated"] += 1
        else:
            prod = models.Product(
                seller_id=seller.id,
                sku=sku,
                name=name,
                unit_value=unit_value,
                box_type=box_type,
                barcode_seller=barcode,
            )
            db.add(prod)
            existing_products[key] = prod   # evita duplicata na mesma planilha
            results["created"] += 1

        pending += 1
        if pending >= BATCH:
            db.commit()
            pending = 0

    if pending:
        db.commit()

    wb2.close()

    # Converte set para lista para serialização JSON
    results["sellers_not_found"] = sorted(results["sellers_not_found"])

    # ── Trilha de auditoria: registra import em lote ─────────────────────────
    db.add(models.AuditLog(
        entity_type="Product",
        entity_id=None,
        action="BULK_UPLOAD",
        detail=(
            f"Upload em lote de produtos: arquivo={file.filename} | "
            f"Criados={results['created']} | Atualizados={results['updated']} | "
            f"Ignorados={results['skipped']}"
        ),
        user_id=current_user.id,
    ))
    db.commit()

    return results


@router.post("/kits/bulk-import")
def bulk_import_kits(
    payload: schemas.KitBulkImport,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """Import em massa de kits."""
    all_sellers = db.query(models.Seller).all()
    sellers_cache = {}
    for s in all_sellers:
        sellers_cache[s.trade_name.lower()] = s
        sellers_cache[s.name.lower()] = s

    # Cache products for name lookup
    all_products = db.query(models.Product).filter(models.Product.active == True).all()
    prod_cache = {}
    for p in all_products:
        prod_cache[(p.seller_id, p.sku)] = p

    results = {"created": 0, "updated": 0, "skipped": 0, "errors": []}

    for item in payload.items:
        seller = sellers_cache.get(item.seller_name.lower())
        if not seller:
            results["errors"].append(f"Seller '{item.seller_name}' não encontrado")
            results["skipped"] += 1
            continue

        if not item.kit_sku or not item.components:
            results["skipped"] += 1
            continue

        # Get kit name from product if exists
        prod = prod_cache.get((seller.id, item.kit_sku))
        kit_name = prod.name if prod else item.kit_sku

        # Check if kit exists
        existing = db.query(models.Kit).filter(
            models.Kit.seller_id == seller.id,
            models.Kit.kit_sku == item.kit_sku,
        ).first()

        if existing:
            # Update: remove old items and recreate
            db.query(models.KitItem).filter(models.KitItem.kit_id == existing.id).delete()
            kit = existing
            kit.kit_name = kit_name
            results["updated"] += 1
        else:
            kit = models.Kit(
                seller_id=seller.id,
                kit_sku=item.kit_sku,
                kit_name=kit_name,
            )
            db.add(kit)
            db.flush()
            results["created"] += 1

        for comp in item.components:
            comp_prod = prod_cache.get((seller.id, comp.sku))
            ki = models.KitItem(
                kit_id=kit.id,
                component_sku=comp.sku,
                component_name=comp_prod.name if comp_prod else comp.sku,
                quantity=comp.quantity,
            )
            db.add(ki)

    db.commit()
    return results


# ============================================================
# ALGORITMO DE CAIXA
# ============================================================

@router.get("/box-algorithm/{seller_id}", response_model=List[schemas.BoxRuleResponse])
def get_box_algorithm(
    seller_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(models.BoxAlgorithm).filter(
        models.BoxAlgorithm.seller_id == seller_id
    ).order_by(models.BoxAlgorithm.num_products, models.BoxAlgorithm.score).all()


@router.post("/box-algorithm", response_model=schemas.BoxRuleResponse)
def create_box_rule(
    rule: schemas.BoxRuleCreate,
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    existing = db.query(models.BoxAlgorithm).filter(
        models.BoxAlgorithm.seller_id == rule.seller_id,
        models.BoxAlgorithm.num_products == rule.num_products,
        models.BoxAlgorithm.score == rule.score,
    ).first()

    if existing:
        existing.box_type = rule.box_type
        db.commit()
        db.refresh(existing)
        return existing

    r = models.BoxAlgorithm(**rule.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.get("/box-algorithm/{seller_id}/calculate")
def calculate_box(
    seller_id: int,
    num_products: int,
    score: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Calcula a caixa para um pedido dado nº de produtos e score."""
    # Busca a regra mais próxima
    rule = db.query(models.BoxAlgorithm).filter(
        models.BoxAlgorithm.seller_id == seller_id,
        models.BoxAlgorithm.num_products <= num_products,
        models.BoxAlgorithm.score <= score,
    ).order_by(
        models.BoxAlgorithm.num_products.desc(),
        models.BoxAlgorithm.score.desc(),
    ).first()

    if not rule:
        return {"box_type": "Propria", "message": "Regra não encontrada, usar caixa própria"}

    return {"box_type": rule.box_type, "num_products": num_products, "score": score}


# ============================================================
# SELLERS
# ============================================================

@router.get("/sellers", response_model=List[schemas.SellerResponse])
def list_sellers(
    active_only: bool = False,   # False = retorna todos; True = só ativos (para dropdowns)
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Seller)
    if active_only:
        query = query.filter(models.Seller.active == True)
    return query.order_by(models.Seller.trade_name).all()


@router.post("/sellers", response_model=schemas.SellerResponse)
def create_seller(
    seller: schemas.SellerCreate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    data = seller.model_dump()
    # trade_name não pode ser nulo no banco; usa name como fallback
    if not data.get('trade_name'):
        data['trade_name'] = data['name']
    s = models.Seller(**data)
    db.add(s)
    db.flush()

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    db.add(models.AuditLog(
        entity_type="Seller",
        entity_id=s.id,
        action="CREATE",
        detail=f"Seller cadastrado: {s.trade_name} (razão: {s.name})",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(s)
    return s


@router.put("/sellers/{seller_id}", response_model=schemas.SellerResponse)
def update_seller(
    seller_id: int,
    data: schemas.SellerUpdate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    if not seller:
        raise HTTPException(status_code=404, detail="Seller não encontrado")
    changed = {f: v for f, v in data.model_dump(exclude_none=True).items()}
    for field, value in changed.items():
        setattr(seller, field, value)

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    db.add(models.AuditLog(
        entity_type="Seller",
        entity_id=seller_id,
        action="UPDATE",
        detail=f"Seller atualizado: {seller.trade_name} | Campos: {', '.join(changed.keys())}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(seller)
    return seller


@router.delete("/sellers/{seller_id}")
def delete_seller(
    seller_id: int,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    if not seller:
        raise HTTPException(status_code=404, detail="Seller não encontrado")
    seller.active = False
    db.commit()
    return {"message": "Seller desativado"}


# ============================================================
# UNIDADES
# ============================================================

@router.get("/units", response_model=List[schemas.UnitResponse])
def list_units(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(models.Unit).filter(models.Unit.active == True).all()


@router.post("/units", response_model=schemas.UnitResponse)
def create_unit(
    unit: schemas.UnitCreate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    u = models.Unit(**unit.model_dump())
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ============================================================
# USUÁRIOS
# ============================================================

@router.get("/users", response_model=List[schemas.UserResponse])
def list_users(
    unit_id: Optional[int] = None,
    role: Optional[str] = None,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(models.User)
    if unit_id:
        query = query.filter(models.User.unit_id == unit_id)
    if role:
        query = query.filter(models.User.role == role)
    return query.order_by(models.User.name).all()


@router.post("/users", response_model=schemas.UserResponse)
def create_user(
    user: schemas.UserCreate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..auth import hash_password
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    u = models.User(
        name=user.name,
        email=user.email,
        password_hash=hash_password(user.password),
        role=user.role,
        unit_id=user.unit_id,
        seller_id=user.seller_id,
    )
    db.add(u)
    db.flush()

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    db.add(models.AuditLog(
        entity_type="User",
        entity_id=u.id,
        action="CREATE",
        detail=f"Usuário criado: {u.name} | email={u.email} | role={u.role.value if hasattr(u.role, 'value') else u.role}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(u)
    return u


@router.put("/users/{user_id}", response_model=schemas.UserResponse)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..auth import hash_password
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    update_data = data.model_dump(exclude_none=True)
    if "password" in update_data:
        update_data["password_hash"] = hash_password(update_data.pop("password"))

    for field, value in update_data.items():
        setattr(user, field, value)

    # ── Trilha de auditoria ──────────────────────────────────────────────────
    db.add(models.AuditLog(
        entity_type="User",
        entity_id=user_id,
        action="UPDATE",
        detail=f"Usuário atualizado: {user.name} | Campos: {', '.join(k for k in update_data if k != 'password_hash')}",
        user_id=current_user.id,
    ))

    db.commit()
    db.refresh(user)
    return user


# ============================================================
# EXPERIENCE FILE — upload e servir roteiro de unboxing do seller
# ============================================================

EXPERIENCE_DIR = os.path.join(BASE_DIR, "data", "media", "experience")


@router.post("/sellers/{seller_id}/experience-file")
def upload_experience_file(
    seller_id: int,
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_master_or_above),
    db: Session = Depends(get_db),
):
    """Salva o arquivo PPT/PDF de roteiro de experiencia do seller."""
    seller = db.query(models.Seller).filter(models.Seller.id == seller_id).first()
    if not seller:
        raise HTTPException(status_code=404, detail="Seller nao encontrado")

    allowed = {".pdf", ".ppt", ".pptx"}
    _, ext = os.path.splitext(file.filename or "")
    if ext.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Extensao nao permitida. Use: {', '.join(allowed)}")

    os.makedirs(EXPERIENCE_DIR, exist_ok=True)

    dest_name = f"seller_{seller_id}{ext.lower()}"
    dest_path = os.path.join(EXPERIENCE_DIR, dest_name)

    with open(dest_path, "wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        from sqlalchemy import text
        db.execute(
            text("UPDATE sellers SET experience_file_path = :p WHERE id = :id"),
            {"p": dest_name, "id": seller_id},
        )
        db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar arquivo: {e}")

    return {"filename": dest_name, "path": f"/media/experience/{dest_name}"}
