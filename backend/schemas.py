"""
WMS Kiwkiw - Schemas Pydantic
Define os contratos de entrada/saída da API (validação e serialização).
"""

from pydantic import BaseModel, EmailStr, field_validator, computed_field
from typing import Optional, List, Any
from datetime import date, datetime
from enum import Enum


# ============================================================
# AUTH
# ============================================================

class LoginRequest(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    user_id: int
    name: str
    unit_id: Optional[int] = None
    seller_id: Optional[int] = None
    force_password_change: bool = False

class TokenData(BaseModel):
    user_id: Optional[int] = None
    role: Optional[str] = None
    unit_id: Optional[int] = None
    seller_id: Optional[int] = None
    seller_ids: Optional[List[int]] = None

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ============================================================
# USUÁRIOS
# ============================================================

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "operator"
    unit_id: Optional[int] = None
    seller_id: Optional[int] = None
    seller_ids: Optional[List[int]] = None  # grupo de sellers (manager/operator)

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    unit_id: Optional[int] = None
    seller_id: Optional[int] = None        # seller principal (client)
    seller_ids: Optional[List[int]] = None  # grupo de sellers (manager/operator)
    active: Optional[bool] = None
    force_password_change: Optional[bool] = None

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    unit_id: Optional[int] = None
    unit_name: Optional[str] = None    # nome da unidade (enriquecido no router)
    seller_id: Optional[int] = None    # seller principal (client)
    seller_name: Optional[str] = None  # nome do seller principal
    seller_ids: List[int] = []         # grupo de sellers (manager/operator)
    seller_names: List[str] = []       # nomes dos sellers do grupo
    active: bool
    force_password_change: bool = False
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


# ============================================================
# UNIDADES
# ============================================================

class UnitCreate(BaseModel):
    name: str
    code: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    responsible: Optional[str] = None
    phone: Optional[str] = None

class UnitUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    responsible: Optional[str] = None
    phone: Optional[str] = None
    active: Optional[bool] = None

class UnitResponse(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    responsible: Optional[str] = None
    phone: Optional[str] = None
    active: bool
    # Lista de IDs dos sellers associados (para o frontend)
    seller_ids: Optional[List[int]] = None

    class Config:
        from_attributes = True


# ============================================================
# SELLERS
# ============================================================

class SellerCreate(BaseModel):
    name: str
    trade_name: Optional[str] = None   # se omitido, usa name
    cnpj: Optional[str] = None
    email: Optional[str] = None
    contact_email: Optional[str] = None
    code: Optional[str] = None
    active: Optional[bool] = True
    unit_id: Optional[int] = None
    # Campos comerciais / cobrança
    caixa_b2b: Optional[float] = None
    manuseio_b2b: Optional[float] = None
    qtd_franquia_b2b: Optional[int] = None
    valor_adicional_b2b: Optional[float] = None
    num_min_pedidos: Optional[int] = None
    preco_unitario: Optional[float] = None
    caixa_inclusa: Optional[bool] = False
    seguro_incluso: Optional[bool] = False
    armazenagem_incluso: Optional[bool] = False
    valor_segurado: Optional[float] = None
    franquia: Optional[float] = None
    preco_adicional: Optional[float] = None
    caixa1: Optional[str] = None
    caixa2: Optional[str] = None
    caixa3: Optional[str] = None
    caixa4: Optional[str] = None
    caixa5: Optional[str] = None
    caixa6: Optional[str] = None
    caixa7: Optional[str] = None
    caixa8: Optional[str] = None
    manuseio: Optional[float] = None
    caixa_prop: Optional[bool] = False
    mes_reajuste: Optional[int] = None
    unit_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    # Outros apelidos para match automático na importação (separados por ";")
    other_aliases: Optional[str] = None

class SellerUpdate(BaseModel):
    name: Optional[str] = None
    trade_name: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    contact_email: Optional[str] = None
    code: Optional[str] = None
    active: Optional[bool] = None      # campo canônico no modelo DB
    # Campos comerciais / cobrança
    caixa_b2b: Optional[float] = None
    manuseio_b2b: Optional[float] = None
    qtd_franquia_b2b: Optional[int] = None
    valor_adicional_b2b: Optional[float] = None
    num_min_pedidos: Optional[int] = None
    preco_unitario: Optional[float] = None
    caixa_inclusa: Optional[bool] = None
    seguro_incluso: Optional[bool] = None
    armazenagem_incluso: Optional[bool] = None
    valor_segurado: Optional[float] = None
    franquia: Optional[float] = None
    preco_adicional: Optional[float] = None
    caixa1: Optional[str] = None
    caixa2: Optional[str] = None
    caixa3: Optional[str] = None
    caixa4: Optional[str] = None
    caixa5: Optional[str] = None
    caixa6: Optional[str] = None
    caixa7: Optional[str] = None
    caixa8: Optional[str] = None
    manuseio: Optional[float] = None
    caixa_prop: Optional[bool] = None
    mes_reajuste: Optional[int] = None
    unit_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    # Outros apelidos para match automático na importação (separados por ";")
    other_aliases: Optional[str] = None
    unit_id: Optional[int] = None

class SellerResponse(BaseModel):
    id: int
    name: str
    trade_name: str
    cnpj: Optional[str] = None
    email: Optional[str] = None
    unit_id: Optional[int] = None
    active: bool
    # Campos comerciais / cobrança
    caixa_b2b: Optional[float] = None
    manuseio_b2b: Optional[float] = None
    qtd_franquia_b2b: Optional[int] = None
    valor_adicional_b2b: Optional[float] = None
    num_min_pedidos: Optional[int] = None
    preco_unitario: Optional[float] = None
    caixa_inclusa: Optional[bool] = False
    seguro_incluso: Optional[bool] = False
    armazenagem_incluso: Optional[bool] = False
    valor_segurado: Optional[float] = None
    franquia: Optional[float] = None
    preco_adicional: Optional[float] = None
    caixa1: Optional[str] = None
    caixa2: Optional[str] = None
    caixa3: Optional[str] = None
    caixa4: Optional[str] = None
    caixa5: Optional[str] = None
    caixa6: Optional[str] = None
    caixa7: Optional[str] = None
    caixa8: Optional[str] = None
    manuseio: Optional[float] = None
    caixa_prop: Optional[bool] = False
    mes_reajuste: Optional[int] = None
    unit_name: Optional[str] = None       # legado (campo texto direto do seller)
    unit_display_name: Optional[str] = None  # derivado do relacionamento unit FK
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    code: Optional[str] = None
    # Outros apelidos para match automático na importação (separados por ";")
    other_aliases: Optional[str] = None
    # Estatísticas de SKU (enriquecidas pelo list_sellers)
    total_skus: Optional[int] = 0
    skus_with_stock: Optional[int] = 0

    class Config:
        from_attributes = True

    @computed_field  # type: ignore[misc]
    @property
    def is_active(self) -> bool:
        """
        Alias de `active` exposto ao frontend.
        Antes era `is_active: Optional[bool] = True` — campo solto que sempre
        retornava True porque o ORM não possui o atributo `is_active`. Resultado:
        botões Inativar/Excluir de seller pareciam não funcionar (status nunca
        mudava na tela). @computed_field garante que reflete o valor real de `active`.
        """
        return self.active


# ============================================================
# PRODUTOS
# ============================================================

class ProductCreate(BaseModel):
    seller_id: int
    sku: str
    name: str
    barcode_seller: Optional[str] = None
    unit_value: Optional[float] = 0.0
    box_type: Optional[str] = None
    is_input: Optional[bool] = False

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    barcode_seller: Optional[str] = None
    unit_value: Optional[float] = None
    box_type: Optional[str] = None
    is_input: Optional[bool] = None
    photo_url: Optional[str] = None
    active: Optional[bool] = None

class ProductResponse(BaseModel):
    id: int
    seller_id: int
    seller_name: Optional[str] = None
    sku: str
    name: str
    barcode_seller: Optional[str] = None
    unit_value: float
    box_type: Optional[str] = None
    is_input: bool = False
    photo_url: Optional[str] = None
    active: bool

    class Config:
        from_attributes = True


# ============================================================
# KITS
# ============================================================

class KitItemCreate(BaseModel):
    component_sku: str
    component_name: Optional[str] = None
    quantity: int = 1

class KitCreate(BaseModel):
    seller_id: int
    kit_sku: str
    kit_name: str
    items: List[KitItemCreate]

class KitItemResponse(BaseModel):
    id: int
    component_sku: str
    component_name: Optional[str] = None
    quantity: int

    class Config:
        from_attributes = True

class KitResponse(BaseModel):
    id: int
    seller_id: int
    seller_name: Optional[str] = None
    kit_sku: str
    kit_name: str
    items: List[KitItemResponse] = []
    active: bool

    class Config:
        from_attributes = True


# ============================================================
# ALGORITMO DE CAIXA
# ============================================================

class BoxRuleCreate(BaseModel):
    seller_id: int
    num_products: int
    score: int
    box_type: str

class BoxRuleResponse(BaseModel):
    id: int
    seller_id: int
    num_products: int
    score: int
    box_type: str

    class Config:
        from_attributes = True


# ============================================================
# PEDIDOS
# ============================================================

class OrderItemCreate(BaseModel):
    sku: str
    product_name: str
    quantity: int

class OrderCreate(BaseModel):
    erp_code: Optional[str] = None
    nf_number: str
    customer_name: str
    order_date: date
    seller_id: int
    unit_id: Optional[int] = None
    carrier: Optional[str] = None
    expedition_date: Optional[date] = None
    nature: Optional[str] = None
    danfe_key: Optional[str] = None
    file_type: str = "saida"
    for_billing: bool = True
    items: List[OrderItemCreate] = []

class OrderItemResponse(BaseModel):
    id: int
    sku: str
    product_name: str
    quantity: int
    is_kit_component: bool
    original_kit_sku: Optional[str] = None
    scanned_qty: int = 0

    class Config:
        from_attributes = True

class OrderResponse(BaseModel):
    id: int
    erp_code: Optional[str] = None
    nf_number: str
    customer_name: str
    order_date: date
    seller_id: int
    seller_name: Optional[str] = None
    unit_id: Optional[int] = None
    carrier: Optional[str] = None
    status: str
    expedition_date: Optional[date] = None
    nature: Optional[str] = None
    danfe_key: Optional[str] = None
    for_billing: bool
    imported_at: datetime
    session_id: Optional[int] = None
    # Vazio = a NF ainda não baixou estoque (falta transportadora ou produto
    # cadastrado). Ver services/stock_manager.py — 06/08/2026.
    stock_applied_at: Optional[datetime] = None
    items: List[OrderItemResponse] = []

    class Config:
        from_attributes = True


# ============================================================
# SESSÕES DE SEPARAÇÃO
# ============================================================

class PickingSessionCreate(BaseModel):
    session_date: date
    unit_id: int
    seller_id: Optional[int] = None
    source_file: Optional[str] = None

class PickingSessionResponse(BaseModel):
    id: int
    session_date: date
    unit_id: int
    seller_id: Optional[int] = None
    status: str
    total_orders: int
    completed_orders: int
    check_transport: bool
    check_separation: bool
    check_planning: bool
    check_stock: bool
    all_checks_ok: bool
    separation_pdf: Optional[str] = None
    expedition_pdf: Optional[str] = None
    created_at: datetime
    # Configurações de nível de arquivo (herdadas por todos os pedidos da sessão)
    file_type: Optional[str] = "Saída"
    for_billing: Optional[bool] = True
    source_file: Optional[str] = None
    sellers: List[str] = []

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_with_checks(cls, session):
        # Extrai enums via .value para evitar 'OrderStatus.PENDING' no JSON
        ft = getattr(session, "file_type", None)
        if ft is not None and hasattr(ft, "value"):
            ft = ft.value
        status = session.status
        if status is not None and hasattr(status, "value"):
            status = status.value
        data = {
            "id": session.id,
            "session_date": session.session_date,
            "unit_id": session.unit_id,
            "seller_id": session.seller_id,
            "status": str(status) if status is not None else "pending",
            "total_orders": session.total_orders,
            "completed_orders": session.completed_orders,
            "check_transport": session.check_transport,
            "check_separation": session.check_separation,
            "check_planning": session.check_planning,
            "check_stock": session.check_stock,
            "all_checks_ok": session.all_checks_ok,
            "separation_pdf": session.separation_pdf,
            "expedition_pdf": session.expedition_pdf,
            "created_at": session.created_at,
            "file_type": ft or "Saída",
            "for_billing": bool(getattr(session, "for_billing", True)),
            "source_file": getattr(session, "source_file", None),
            "sellers": list({
                o.seller.trade_name
                for o in getattr(session, "orders", [])
                if o.seller and o.seller.trade_name
            }),
        }
        return cls(**data)


class PickingSessionConfigUpdate(BaseModel):
    """Payload para reconfigurar tipo/faturamento de uma sessão já importada."""
    file_type: Optional[str] = None  # 'Entrada' | 'Saída'
    for_billing: Optional[bool] = None


# ============================================================
# BIPAGEM (SCANNING)
# ============================================================

class ScanRequest(BaseModel):
    """Payload enviado quando operador escaneia um código de barras."""
    session_id: int
    order_id: int
    barcode: str
    operator_id: int
    # Quantidade bipada de uma vez. Só é aceita > 1 em NF de ENTRADA — numa caixa
    # com 1.000 itens iguais, bipar unidade a unidade é inviável. O default 1
    # mantém qualquer chamada anterior funcionando sem alteração.
    quantity: int = 1

class ScanResponse(BaseModel):
    """Resposta ao scan: OK, ERRO, COMPLETO, etc."""
    success: bool
    message: str
    status: str                          # "ok", "error", "order_complete", "session_complete"
    sku: Optional[str] = None
    product_name: Optional[str] = None
    photo_url: Optional[str] = None
    items_remaining: int = 0
    order_progress: Optional[dict] = None
    # Quanto ESTE bipe passou do que a NF previa (só ocorre em Entrada).
    # 0 = bipe normal. > 0 = chegou mais do que a NF dizia: a tela avisa o
    # operador para comunicar a empresa. Ver process_scan em routers/scanning.py.
    over_quantity: int = 0

class InterruptRequest(BaseModel):
    session_id: int
    order_id: int
    operator_id: int
    reason: Optional[str] = None

class ScanningLogResponse(BaseModel):
    id: int
    session_id: int
    order_id: int
    sku: str
    barcode_scanned: str
    quantity: int
    operator_id: int
    operator_name: Optional[str] = None
    timestamp: datetime
    is_interrupted: bool
    is_error: bool
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# ESTOQUE
# ============================================================

class StockMovementCreate(BaseModel):
    seller_id: int
    sku: str
    product_name: Optional[str] = None
    movement_date: date
    movement_type: str  # "Entrada" ou "Saída"
    quantity: int
    nf_number: Optional[str] = None
    nature: Optional[str] = None
    observation: Optional[str] = None

class StockPositionResponse(BaseModel):
    id: int
    seller_id: int
    sku: str
    product_name: Optional[str] = None
    initial_stock: int
    total_in: int
    total_out: int
    current_stock: int
    unit_value: float
    level: Optional[str] = None
    supply_type: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# DASHBOARD / COCKPIT
# ============================================================

class DashboardStats(BaseModel):
    """Dados para o cockpit gerencial do dia."""
    today: date
    total_orders_today: int
    orders_completed: int
    orders_pending: int
    orders_scanning: int
    completion_rate: float
    active_sessions: int
    units_summary: List[dict]
    sellers_with_orders: List[dict]
    sellers_no_orders: List[dict] = []    # sellers ativos sem pedidos hoje
    sessions_today: List[dict] = []       # histórico de uploads do dia
    recent_scans: List[dict]
    alerts: List[dict]
    operators_summary: List[dict] = []    # agrupamento por operador
    orders_no_operator: int = 0            # pedidos sem nenhum scan no dia
    checks: dict = {
        "transport": False,
        "separation": False,
        "planning": False,
        "stock": False,
        "products_registered": True,
        "missing_products": [],
        "all_ok": False,
    }

class SellerDashboard(BaseModel):
    """Dados para o cockpit do seller."""
    seller_id: int
    seller_name: str
    date_from: date
    date_to: date
    total_orders: int
    orders_completed: int
    orders_pending: int
    completion_rate: float
    recent_orders: List[dict]
    stock_alerts: List[dict]


# ============================================================
# BULK IMPORT / SCANNING AUXILIARES
# ============================================================

class ProductBulkItem(BaseModel):
    sku: str
    seller_name: str  # será matched ao seller por name/trade_name
    name: str
    unit_value: Optional[float] = None
    box_type: Optional[str] = None
    barcode_seller: Optional[str] = None

class KitComponentBulk(BaseModel):
    sku: str
    quantity: int = 1

class KitBulkItem(BaseModel):
    seller_name: str
    kit_sku: str
    components: List[KitComponentBulk]

class KitBulkImport(BaseModel):
    items: List[KitBulkItem]

class OpenByNfeRequest(BaseModel):
    nfe_key: str
    operator_id: Optional[int] = None
    force_seller_lock: bool = False


# ============================================================
# IMPORTAÇÃO
# ============================================================



class BillingConfigCreate(BaseModel):
    seller_id: int
    config_key: str
    config_value: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None


class BillingConfigResponse(BaseModel):
    id: int
    seller_id: int
    config_key: str
    config_value: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

    class Config:
        from_attributes = True

class DuplicateOrderInfo(BaseModel):
    """Detalhe de um pedido já existente detectado na importação."""
    nf_number: str
    seller_name: str
    existing_order_id: Optional[int] = None
    existing_session_id: Optional[int] = None
    existing_imported_at: Optional[datetime] = None


class InactiveSellerInfo(BaseModel):
    """Seller inativo referenciado por linhas do arquivo sendo importado."""
    seller_id: int
    seller_name: str
    nf_numbers: List[str] = []


class UnmatchedSellerInfo(BaseModel):
    """Nome de seller no arquivo que não bateu com nenhum cadastro (ativo ou inativo)."""
    seller_name: str
    nf_numbers: List[str] = []


class MissingCarrierOrderInfo(BaseModel):
    """Pedido importado sem transportadora — bloqueia bipagem e PDFs até ser preenchido."""
    order_id: int
    session_id: int
    nf_number: str
    seller_name: str
    customer_name: Optional[str] = None


class NegativeStockInfo(BaseModel):
    """SKU que ficou negativo após a baixa de estoque da importação."""
    seller_id: int
    seller_name: Optional[str] = None
    sku: str
    product_name: Optional[str] = None
    current_stock: int = 0          # posição depois da baixa
    applied_qty: int = 0            # delta assinado desta importação
    was_negative_before: bool = False


class PendingStockOrderInfo(BaseModel):
    """NF que NÃO baixou estoque na importação e o motivo."""
    order_id: int
    nf_number: str
    seller_id: int
    seller_name: Optional[str] = None
    customer_name: Optional[str] = None
    missing_carrier: bool = False
    missing_skus: List[str] = []


class MissingProductInfo(BaseModel):
    """SKU sem produto cadastrado que está segurando a baixa de estoque."""
    seller_id: int
    seller_name: Optional[str] = None
    sku: str
    product_name: Optional[str] = None
    nf_numbers: List[str] = []


class StockApplyReport(BaseModel):
    """Resultado da baixa de estoque — usado no import e no destravamento."""
    applied_orders: int = 0
    pending_orders: List[PendingStockOrderInfo] = []
    missing_products: List[MissingProductInfo] = []
    negatives: List[NegativeStockInfo] = []


# ============================================================
# RESOLUÇÃO EM LOTE DAS PENDÊNCIAS DE ESTOQUE (10/08/2026)
# ============================================================
# Subir arquivo é o core da operação: parar tudo para completar transportadora
# NF a NF (foram 6.703 de uma vez) inviabiliza o dia. Estes dois lotes existem
# para resolver o aviso do Dashboard sem trocar de tela.

class CarrierUpdateItem(BaseModel):
    order_id: int
    carrier: str


class BatchCarrierRequest(BaseModel):
    updates: List[CarrierUpdateItem] = []


class BatchCarrierResult(BaseModel):
    updated: int = 0             # transportadoras gravadas
    stock_applied: int = 0       # dessas, quantas NFs baixaram estoque agora
    still_pending: int = 0       # continuam presas — faltava também SKU sem produto
    negatives: List[NegativeStockInfo] = []


class SkuResolutionItem(BaseModel):
    """
    Uma decisão sobre um SKU sem produto cadastrado.

    action="create" -> cria o produto com o SKU que veio na NF (usa `name`).
    action="link"   -> este SKU na verdade é o produto `target_product_id`;
                       os itens das NFs PENDENTES são reescritos para o SKU
                       dele. Se o produto estiver inativo, é reativado — senão
                       a NF continuaria presa. Ver relink_sku_in_pending_orders.
    """
    seller_id: int
    sku: str
    action: str                              # "create" | "link"
    name: Optional[str] = None               # create
    barcode_seller: Optional[str] = None     # create
    target_product_id: Optional[int] = None  # link


class BatchSkuRequest(BaseModel):
    resolutions: List[SkuResolutionItem] = []


class BatchSkuResult(BaseModel):
    created: int = 0
    linked: int = 0
    reactivated: int = 0
    orders_relinked: int = 0
    stock_applied: int = 0
    negatives: List[NegativeStockInfo] = []


class ImportResult(BaseModel):
    """Resultado completo de uma importação (equivale ao retorno de import_excel_orders)."""
    success: bool = False
    message: str = ""
    session_id: Optional[int] = None
    session_date: Optional[str] = None
    total_rows: int = 0
    orders_imported: int = 0
    orders_with_kits: int = 0
    errors: List[str] = []
    warnings: List[str] = []
    requires_confirmation: bool = False
    duplicates: List[DuplicateOrderInfo] = []
    inactive_sellers: List[InactiveSellerInfo] = []
    unmatched_sellers: List[UnmatchedSellerInfo] = []
    missing_carrier_orders: List[MissingCarrierOrderInfo] = []
    stock: Optional[StockApplyReport] = None
