"""
WMS Kiwkiw - Modelos do Banco de Dados
Todos os modelos SQLAlchemy do sistema.
"""

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text,
    ForeignKey, Enum, Date, UniqueConstraint, Index, Table
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from .database import Base
from .timezone_utils import now_brasilia


# ============================================================
# ENUMS
# ============================================================

class UserRole(str, enum.Enum):
    ADMIN    = "admin"      # Administrador: acesso total, único que importa pedidos
    MANAGER  = "manager"    # Gerente: vê/edita somente seu grupo de sellers
    OPERATOR = "operator"   # Operador: bipagem dos sellers que atende
    CLIENT   = "client"     # Cliente (seller): portal somente leitura

class OrderStatus(str, enum.Enum):
    PENDING = "pending"          # Importado, aguardando validação
    VALIDATED = "validated"      # Checagens OK
    SEPARATING = "separating"    # Relatório gerado, aguardando separação
    SCANNING = "scanning"        # Em processo de bipagem
    COMPLETED = "completed"      # Todos pedidos bipados
    INTERRUPTED = "interrupted"  # Pedido interrompido pelo operador
    CANCELLED = "cancelled"      # Cancelado

class MovementType(str, enum.Enum):
    IN = "Entrada"
    OUT = "Saída"

class FileType(str, enum.Enum):
    IMPORT = "entrada"
    EXPORT = "saida"


# ============================================================
# TABELAS DE ASSOCIAÇÃO
# ============================================================

# Associação muitos-para-muitos: usuário ↔ sellers que atende.
# Usada por operadores (sellers que bipam) e gerentes (grupo de sellers).
# Clientes (role=client) usam apenas o FK seller_id (portal single-seller).
user_sellers = Table(
    "user_sellers",
    Base.metadata,
    Column("user_id",   Integer, ForeignKey("users.id",   ondelete="CASCADE"), primary_key=True),
    Column("seller_id", Integer, ForeignKey("sellers.id", ondelete="CASCADE"), primary_key=True),
)


# ============================================================
# UNIDADES E USUÁRIOS
# ============================================================

class Unit(Base):
    """Unidade/armazém físico da Kiwkiw."""
    __tablename__ = "units"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)               # Ex: "Unidade 1 - SP"
    code = Column(String(20), nullable=True)                 # Código curto, ex: "UN1"
    location = Column(String(200))                           # Endereço completo (legado)
    city = Column(String(100), nullable=True)                # Cidade
    state = Column(String(2), nullable=True)                 # UF (ex: SP, RJ)
    responsible = Column(String(100))                        # Responsável
    phone = Column(String(30), nullable=True)                # Telefone
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_brasilia)

    # Relacionamentos
    users = relationship("User", back_populates="unit")
    picking_sessions = relationship("PickingSession", back_populates="unit")
    sellers = relationship("Seller", back_populates="unit", foreign_keys="Seller.unit_id")


class User(Base):
    """Usuários do sistema (admin, master, operadores, sellers)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.OPERATOR)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)   # Nulo para admin/seller
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True) # Para role=seller
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_brasilia)
    last_login = Column(DateTime, nullable=True)

    # Relacionamentos
    unit   = relationship("Unit",   back_populates="users")
    seller = relationship("Seller", back_populates="users", foreign_keys=[seller_id])

    # Sellers atendidos por este usuário (manager/operator — many-to-many)
    # Para client: use seller_id (FK simples) + portal single-seller
    sellers = relationship("Seller", secondary="user_sellers", lazy="select")

    scanning_logs = relationship("ScanningLog", back_populates="operator")
    audit_logs    = relationship("AuditLog",    back_populates="user")


# ============================================================
# SELLERS E PRODUTOS
# ============================================================

class Seller(Base):
    """Sellers/clientes atendidos pela Kiwkiw."""
    __tablename__ = "sellers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)           # Razão social
    trade_name = Column(String(100), nullable=False)     # Apelido (ex: LORM, QOLOR)
    cnpj = Column(String(20), unique=True, nullable=True)
    email = Column(String(150), nullable=True)
    active = Column(Boolean, default=True)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)
    created_at = Column(DateTime, default=now_brasilia)

    # Campos comerciais / cobrança
    caixa_b2b = Column(Float, nullable=True)
    manuseio_b2b = Column(Float, nullable=True)
    qtd_franquia_b2b = Column(Integer, nullable=True)
    valor_adicional_b2b = Column(Float, nullable=True)
    num_min_pedidos = Column(Integer, nullable=True)
    preco_unitario = Column(Float, nullable=True)
    caixa_inclusa = Column(Boolean, default=False)
    seguro_incluso = Column(Boolean, default=False)
    armazenagem_incluso = Column(Boolean, default=False)
    valor_segurado = Column(Float, nullable=True)
    franquia = Column(Float, nullable=True)
    preco_adicional = Column(Float, nullable=True)
    caixa1 = Column(String(50), nullable=True)
    caixa2 = Column(String(50), nullable=True)
    caixa3 = Column(String(50), nullable=True)
    caixa4 = Column(String(50), nullable=True)
    caixa5 = Column(String(50), nullable=True)
    caixa6 = Column(String(50), nullable=True)
    caixa7 = Column(String(50), nullable=True)
    caixa8 = Column(String(50), nullable=True)
    manuseio = Column(Float, nullable=True)
    caixa_prop = Column(Boolean, default=False)
    mes_reajuste = Column(Integer, nullable=True)  # 1-12
    unit_name = Column(String(100), nullable=True)  # UNIDADE
    contact_name = Column(String(150), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    contact_email = Column(String(150), nullable=True)   # adicionado via migrate_sellers_v2
    code = Column(String(50), nullable=True)             # código / trade name curto
    # Outros apelidos/strings do seller usados para match automático na importação.
    # Formato: strings separadas por ponto-e-vírgula, ex: "MERU SERVICOS EMPRESARIAIS;EDITORA LTDA"
    other_aliases = Column(Text, nullable=True)

    # Propriedade auxiliar: Pydantic from_attributes procura `is_active` no modelo
    @property
    def is_active(self):
        return self.active

    @property
    def unit_display_name(self) -> str | None:
        """Nome da unidade via FK — exposto ao Pydantic como campo virtual."""
        try:
            return self.unit.name if self.unit else None
        except Exception:
            return None

    # Relacionamentos
    users = relationship("User", back_populates="seller")
    products = relationship("Product", back_populates="seller")
    kits = relationship("Kit", back_populates="seller")
    box_algorithms = relationship("BoxAlgorithm", back_populates="seller")
    billing_configs = relationship("BillingConfig", back_populates="seller")
    stock_movements = relationship("StockMovement", back_populates="seller")
    picking_sessions = relationship("PickingSession", back_populates="seller")
    unit = relationship("Unit", back_populates="sellers", foreign_keys=[unit_id])


class Product(Base):
    """Cadastro de produtos por seller."""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    sku = Column(String(100), nullable=False)
    name = Column(String(300), nullable=False)
    barcode_seller = Column(String(50), nullable=True)     # Cód barras do seller
    barcode_kiwkiw = Column(String(50), nullable=True)     # Cód barras interno Kiwkiw
    unit_value = Column(Float, default=0.0)                # Valor unitário
    box_type = Column(String(50), nullable=True)           # Caixa padrão usada
    score    = Column(Integer, default=0, nullable=False)     # Score para algoritmo de caixa
    photo_url = Column(String(300), nullable=True)         # Foto do produto (para bipagem visual)
    is_input = Column(Boolean, default=False)              # É insumo (embalagem)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_brasilia)

    # Chave composta: seller + SKU é único
    __table_args__ = (UniqueConstraint("seller_id", "sku", name="uq_seller_sku"),)

    # Relacionamentos
    seller = relationship("Seller", back_populates="products")
    stock_movements = relationship("StockMovement", back_populates="product")
    order_items = relationship("OrderItem", back_populates="product")


class Kit(Base):
    """Kits: combinações de SKUs que aparecem como um único produto no ERP."""
    __tablename__ = "kits"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    kit_sku = Column(String(100), nullable=False)          # SKU do kit no ERP
    kit_name = Column(String(300), nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_brasilia)

    __table_args__ = (UniqueConstraint("seller_id", "kit_sku", name="uq_seller_kit_sku"),)

    seller = relationship("Seller", back_populates="kits")
    items = relationship("KitItem", back_populates="kit", cascade="all, delete-orphan")


class KitItem(Base):
    """Componentes de cada kit (split de kits em SKUs reais)."""
    __tablename__ = "kit_items"

    id = Column(Integer, primary_key=True, index=True)
    kit_id = Column(Integer, ForeignKey("kits.id"), nullable=False)
    component_sku = Column(String(100), nullable=False)    # SKU do componente real
    component_name = Column(String(300), nullable=True)
    quantity = Column(Integer, default=1, nullable=False)  # Quantidade por kit

    kit = relationship("Kit", back_populates="items")


class BoxAlgorithm(Base):
    """
    Algoritmo de caixa: matriz (num_produtos x score) → tipo de caixa.
    Reproduz a lógica da aba 'Algoritimo caixas'.
    """
    __tablename__ = "box_algorithms"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    num_products = Column(Integer, nullable=False)          # Linha: número de produtos
    score = Column(Integer, nullable=False)                  # Coluna: score do produto
    box_type = Column(String(50), nullable=False)            # Caixa resultante (c1, c2, etc.)

    __table_args__ = (UniqueConstraint("seller_id", "num_products", "score", name="uq_box_rule"),)

    seller = relationship("Seller", back_populates="box_algorithms")


# ============================================================
# PEDIDOS
# ============================================================

class Order(Base):
    """
    Pedidos importados do processo de captura dos ERPs.
    Reproduz a aba '1. excel' do importador.
    """
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    erp_code = Column(String(50), nullable=True)            # cód erp
    nf_number = Column(String(20), nullable=False)          # # NF
    customer_name = Column(String(300), nullable=False)     # cliente
    order_date = Column(Date, nullable=False)               # data
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)
    carrier  = Column(String(100), nullable=True)           # transportadora
    box_used = Column(String(50), nullable=True)              # Caixa utilizada (calculada ou ajustada pelo operador)
    status = Column(Enum(OrderStatus), default=OrderStatus.PENDING)
    expedition_date = Column(Date, nullable=True)           # data expedicao
    nature = Column(String(200), nullable=True)             # natureza da operação
    danfe_key = Column(String(100), nullable=True, index=True)  # chave danfe (44 dígitos)
    nf_key = Column(String(50), nullable=True)              # chave = NF+seller
    file_type = Column(Enum(FileType), default=FileType.EXPORT)  # entrada ou saída
    for_billing = Column(Boolean, default=True)             # considerar para faturamento
    imported_at = Column(DateTime, default=now_brasilia)
    session_id = Column(Integer, ForeignKey("picking_sessions.id"), nullable=True)

    # Relacionamentos
    seller = relationship("Seller")
    unit = relationship("Unit")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    session = relationship("PickingSession", back_populates="orders")
    scanning_logs = relationship("ScanningLog", back_populates="order")

    __table_args__ = (
        Index("ix_orders_nf_seller", "nf_number", "seller_id"),
        Index("ix_orders_status", "status"),
        Index("ix_orders_date", "order_date"),
    )


class OrderItem(Base):
    """Itens de cada pedido (SKUs)."""
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)  # pode não existir no cadastro
    sku = Column(String(100), nullable=False)
    product_name = Column(String(300), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    is_kit_component = Column(Boolean, default=False)       # Item resultante do split de kit
    original_kit_sku = Column(String(100), nullable=True)   # SKU original do kit (antes do split)

    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")


# ============================================================
# SESSÕES DE SEPARAÇÃO / BIPAGEM
# ============================================================

class PickingSession(Base):
    """
    Sessão de separação do dia.
    Agrupa os pedidos de uma rotina (importação diária).
    """
    __tablename__ = "picking_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_date = Column(Date, nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=False)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True)   # Nulo = todos os sellers
    status = Column(Enum(OrderStatus), default=OrderStatus.PENDING)
    total_orders = Column(Integer, default=0)
    completed_orders = Column(Integer, default=0)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_brasilia)
    completed_at = Column(DateTime, nullable=True)

    # Configuração do arquivo (nível de sessão — aplica-se a todos os pedidos do upload)
    file_type = Column(Enum(FileType), default=FileType.EXPORT, nullable=False)   # Entrada ou Saída
    for_billing = Column(Boolean, default=True, nullable=False)                    # Considerar para faturamento

    # Flags de validação (Checagens do MENU: P6/P8/P10/P12)
    check_transport = Column(Boolean, default=False)      # Validar expedição e transporte
    check_separation = Column(Boolean, default=False)     # Relatório de separação gerado
    check_planning = Column(Boolean, default=False)       # Relatório de planejamento gerado
    check_stock = Column(Boolean, default=False)          # Estoque atualizado

    # Arquivos gerados
    separation_pdf = Column(String(300), nullable=True)   # Caminho do PDF de separação
    expedition_pdf = Column(String(300), nullable=True)   # Caminho do PDF de expedição
    source_file = Column(String(300), nullable=True)      # Arquivo Excel original

    # Relacionamentos
    unit = relationship("Unit", back_populates="picking_sessions")
    seller = relationship("Seller", back_populates="picking_sessions")
    created_by = relationship("User")
    orders = relationship("Order", back_populates="session")
    scanning_logs = relationship("ScanningLog", back_populates="session")

    @property
    def all_checks_ok(self) -> bool:
        return self.check_transport and self.check_separation and self.check_planning


class ScanningLog(Base):
    """
    Trilha de auditoria completa da bipagem.
    Registra cada scan com horário exato, operador e detalhe.
    """
    __tablename__ = "scanning_logs"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("picking_sessions.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    sku = Column(String(100), nullable=False)
    barcode_scanned = Column(String(100), nullable=False)   # O que foi lido pelo scanner
    quantity = Column(Integer, default=1)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    timestamp = Column(DateTime, default=now_brasilia)        # Horário exato do scan
    is_interrupted = Column(Boolean, default=False)         # Pedido foi interrompido
    error_message = Column(String(500), nullable=True)      # Erro se houver
    is_error = Column(Boolean, default=False)               # Scan com erro

    # Relacionamentos
    session = relationship("PickingSession", back_populates="scanning_logs")
    order = relationship("Order", back_populates="scanning_logs")
    operator = relationship("User", back_populates="scanning_logs")


# ============================================================
# ESTOQUE
# ============================================================

class StockMovement(Base):
    """
    Movimentações de estoque (entradas e saídas).
    Reproduz a aba 'DETALHADO' das planilhas de estoque.
    """
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    sku = Column(String(100), nullable=False)
    product_name = Column(String(300), nullable=True)
    movement_date = Column(Date, nullable=False)
    movement_type = Column(Enum(MovementType), nullable=False)
    quantity = Column(Integer, nullable=False)
    adjusted_quantity = Column(Integer, nullable=True)      # Quantidade após ajuste manual
    nf_number = Column(String(20), nullable=True)
    nature = Column(String(200), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    session_id = Column(Integer, ForeignKey("picking_sessions.id"), nullable=True)
    observation = Column(Text, nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_brasilia)
    # Localização no armazém
    floor = Column(String(20), nullable=True)               # Andar
    zone = Column(String(20), nullable=True)                # Zona
    block = Column(String(20), nullable=True)               # Bloco
    position = Column(String(20), nullable=True)            # Posição

    seller = relationship("Seller", back_populates="stock_movements")
    product = relationship("Product", back_populates="stock_movements")


class StockPosition(Base):
    """
    Posição atual do estoque por seller+SKU.
    Calculada a partir dos movimentos (desnormalizada para performance).
    """
    __tablename__ = "stock_positions"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    sku = Column(String(100), nullable=False)
    product_name = Column(String(300), nullable=True)
    initial_stock = Column(Integer, default=0)
    total_in = Column(Integer, default=0)
    total_out = Column(Integer, default=0)
    current_stock = Column(Integer, default=0)           # initial + in - out
    unit_value = Column(Float, default=0.0)
    level = Column(String(20), nullable=True)            # ALTO / MÉDIO / BAIXO
    supply_type = Column(String(50), nullable=True)      # Insumo: CAIXA, CARD, etc.
    updated_at = Column(DateTime, default=now_brasilia)

    __table_args__ = (UniqueConstraint("seller_id", "sku", name="uq_stock_seller_sku"),)


# ============================================================
# FATURAMENTO
# ============================================================

class BillingConfig(Base):
    """
    Configurações de cobrança por seller.
    Reproduz a aba 'Cadastro Cobrança'.
    """
    __tablename__ = "billing_configs"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    config_key = Column(String(100), nullable=False)         # Ex: "Preço Unitário"
    config_value = Column(String(200), nullable=True)
    valid_from = Column(Date, nullable=True)
    valid_to = Column(Date, nullable=True)

    __table_args__ = (UniqueConstraint("seller_id", "config_key", name="uq_billing_config"),)

    seller = relationship("Seller", back_populates="billing_configs")


# ============================================================
# AUDITORIA
# ============================================================

class AuditLog(Base):
    """
    Log de auditoria geral do sistema.
    Registra todas as ações importantes.
    """
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(50), nullable=False)        # Entidade afetada (Order, Product, etc.)
    entity_id = Column(Integer, nullable=True)
    action = Column(String(50), nullable=False)             # CREATE, UPDATE, DELETE, IMPORT, EXPORT
    detail = Column(Text, nullable=True)                    # JSON com detalhes da ação
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=now_brasilia)

    user = relationship("User", back_populates="audit_logs")


# ============================================================
# CONFIGURAÇÕES GERAIS DO SISTEMA
# ============================================================

class AppSetting(Base):
    """
    Armazena configurações globais da aplicação em formato key/value.
    Exemplos: pasta de inbox, pasta processada, intervalo do watcher, etc.
    """
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    description = Column(String(300), nullable=True)
    updated_at = Column(DateTime, default=now_brasilia, onupdate=now_brasilia)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
