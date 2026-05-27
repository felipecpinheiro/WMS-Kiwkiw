"""
WMS Kiwkiw - Matriz de Permissões
Define o que cada perfil pode fazer no sistema.

Uso nos routers:
    from .permissions import Permission, check_permission

    @router.post("/orders/upload")
    def upload_orders(user = Depends(get_current_user)):
        check_permission(user, Permission.IMPORT_ORDERS)
        ...

Regras gerais:
  - Botão de UPLOAD (importar pedidos): somente admin
  - Botões de EXPORTAÇÃO (CSV, PDF): todos os perfis
  - Cadastro de usuários/sellers/configurações gerais: somente admin
  - Cadastro/edição de produtos: admin e manager (somente do seu grupo)
  - Edição de estoque: admin e manager (somente do seu grupo)
  - Bipagem (scan): admin, manager, operator (filtrado pelos sellers do usuário)
  - Interrupção de pedido: admin, manager, operator (com justificativa obrigatória)
  - Visualização de dashboard: admin (tudo), manager (seu grupo), client (seu seller)
  - Portal client: somente leitura — estoque e cards de manuseio do próprio seller
"""

from enum import Enum
from typing import Optional, List
from fastapi import HTTPException, status


# ---------------------------------------------------------------------------
# Enumeração de todas as permissões do sistema
# ---------------------------------------------------------------------------

class Permission(str, Enum):
    # ---- Pedidos / Importação ----
    IMPORT_ORDERS       = "import_orders"        # Upload do arquivo de pedidos (SOMENTE ADMIN)
    VIEW_ORDERS         = "view_orders"           # Visualizar lista de pedidos
    VIEW_ORDER_DETAIL   = "view_order_detail"     # Ver detalhes de um pedido
    INTERRUPT_ORDER     = "interrupt_order"       # Interromper pedido (com justificativa)

    # ---- Bipagem / Scan ----
    SCAN_BARCODE        = "scan_barcode"          # Usar interface de bipagem
    VIEW_SCAN_HISTORY   = "view_scan_history"     # Consultar histórico de bipagem

    # ---- Produtos / Cadastro ----
    VIEW_PRODUCTS       = "view_products"         # Listar produtos
    CREATE_PRODUCT      = "create_product"        # Cadastrar novo produto
    EDIT_PRODUCT        = "edit_product"          # Editar produto existente
    DELETE_PRODUCT      = "delete_product"        # Remover produto

    # ---- Estoque ----
    VIEW_STOCK          = "view_stock"            # Ver estoque
    EDIT_STOCK          = "edit_stock"            # Ajustar estoque manualmente
    EXPORT_STOCK        = "export_stock"          # Exportar relatório de estoque (CSV/PDF)

    # ---- Kits / Algoritmo de Caixas ----
    VIEW_KITS           = "view_kits"             # Ver cadastro de kits
    MANAGE_KITS         = "manage_kits"           # Criar/editar/remover kits
    VIEW_BOX_ALGO       = "view_box_algo"         # Ver algoritmo de caixas
    MANAGE_BOX_ALGO     = "manage_box_algo"       # Editar algoritmo de caixas

    # ---- Sellers / Clientes ----
    VIEW_SELLERS        = "view_sellers"          # Listar sellers
    CREATE_SELLER       = "create_seller"         # Cadastrar novo seller (SOMENTE ADMIN)
    EDIT_SELLER         = "edit_seller"           # Editar dados do seller (SOMENTE ADMIN)
    DELETE_SELLER       = "delete_seller"         # Remover seller (SOMENTE ADMIN)

    # ---- Usuários ----
    VIEW_USERS          = "view_users"            # Listar usuários
    CREATE_USER         = "create_user"           # Cadastrar novo usuário (SOMENTE ADMIN)
    EDIT_USER           = "edit_user"             # Editar usuário (SOMENTE ADMIN)
    DELETE_USER         = "delete_user"           # Remover/inativar usuário (SOMENTE ADMIN)

    # ---- Dashboard / Relatórios ----
    VIEW_DASHBOARD      = "view_dashboard"        # Acessar cockpit/dashboard
    VIEW_REPORTS        = "view_reports"          # Ver relatórios gerenciais
    EXPORT_REPORTS      = "export_reports"        # Exportar relatórios (todos os perfis)

    # ---- Configurações Gerais ----
    VIEW_SETTINGS       = "view_settings"         # Ver configurações do sistema
    EDIT_SETTINGS       = "edit_settings"         # Editar configurações (SOMENTE ADMIN)

    # ---- Auditoria ----
    VIEW_AUDIT_LOG      = "view_audit_log"        # Consultar trilha de auditoria

    # ---- Faturamento ----
    VIEW_BILLING        = "view_billing"          # Ver dados de cobrança
    EDIT_BILLING        = "edit_billing"          # Editar configurações de cobrança (SOMENTE ADMIN)

    # ---- Unidades ----
    VIEW_UNITS          = "view_units"            # Ver unidades
    MANAGE_UNITS        = "manage_units"          # Criar/editar unidades (SOMENTE ADMIN)


# ---------------------------------------------------------------------------
# Mapeamento de permissões por role
# ---------------------------------------------------------------------------

ROLE_PERMISSIONS: dict[str, set[Permission]] = {

    # ------------------------------------------------------------------
    # ADMIN — acesso total sem restrição de grupo/seller
    # ------------------------------------------------------------------
    "admin": {p for p in Permission},  # todas as permissões

    # ------------------------------------------------------------------
    # MANAGER (Gerente) — vê e edita somente seu grupo de sellers
    #   • Não cadastra usuários, sellers ou configurações gerais
    #   • Pode editar produtos e estoque do seu grupo
    #   • Vê dashboard do seu grupo
    #   • Pode interromper pedidos (com justificativa)
    # ------------------------------------------------------------------
    "manager": {
        # Pedidos
        Permission.VIEW_ORDERS,
        Permission.VIEW_ORDER_DETAIL,
        Permission.INTERRUPT_ORDER,
        # Bipagem
        Permission.SCAN_BARCODE,
        Permission.VIEW_SCAN_HISTORY,
        # Produtos (do seu grupo)
        Permission.VIEW_PRODUCTS,
        Permission.CREATE_PRODUCT,
        Permission.EDIT_PRODUCT,
        # (DELETE_PRODUCT intencionalmente ausente — só admin remove)
        # Estoque (do seu grupo)
        Permission.VIEW_STOCK,
        Permission.EDIT_STOCK,
        Permission.EXPORT_STOCK,
        # Kits e caixas
        Permission.VIEW_KITS,
        Permission.MANAGE_KITS,
        Permission.VIEW_BOX_ALGO,
        Permission.MANAGE_BOX_ALGO,
        # Sellers (somente leitura)
        Permission.VIEW_SELLERS,
        # Usuários (somente leitura — não cadastra nem edita)
        Permission.VIEW_USERS,
        # Dashboard / Relatórios
        Permission.VIEW_DASHBOARD,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_REPORTS,
        # Configurações (somente leitura — não edita)
        Permission.VIEW_SETTINGS,
        # Auditoria
        Permission.VIEW_AUDIT_LOG,
        # Faturamento (somente leitura)
        Permission.VIEW_BILLING,
        # Unidades
        Permission.VIEW_UNITS,
    },

    # ------------------------------------------------------------------
    # OPERATOR (Operador) — foco em bipagem dos sellers que atende
    #   • Não vê sellers que não são seus
    #   • Não cadastra produtos
    #   • Pode interromper pedido com justificativa obrigatória
    #   • Exportação permitida
    # ------------------------------------------------------------------
    "operator": {
        # Pedidos (somente leitura + interrupção com justificativa)
        Permission.VIEW_ORDERS,
        Permission.VIEW_ORDER_DETAIL,
        Permission.INTERRUPT_ORDER,
        # Bipagem
        Permission.SCAN_BARCODE,
        Permission.VIEW_SCAN_HISTORY,
        # Produtos (somente leitura — não cadastra)
        Permission.VIEW_PRODUCTS,
        # Estoque (somente leitura + exportação)
        Permission.VIEW_STOCK,
        Permission.EXPORT_STOCK,
        # Kits (somente leitura)
        Permission.VIEW_KITS,
        Permission.VIEW_BOX_ALGO,
        # Dashboard básico
        Permission.VIEW_DASHBOARD,
        Permission.EXPORT_REPORTS,
    },

    # ------------------------------------------------------------------
    # CLIENT (Cliente / Seller) — portal somente leitura
    #   • Vê apenas seu próprio estoque
    #   • Vê seus cards de manuseio (status de pedidos)
    #   • Não edita nada, não acessa bipagem interna
    #   • Exportação de estoque permitida
    # ------------------------------------------------------------------
    "client": {
        Permission.VIEW_STOCK,
        Permission.EXPORT_STOCK,
        Permission.VIEW_ORDERS,          # seus próprios pedidos
        Permission.VIEW_ORDER_DETAIL,    # detalhes dos seus pedidos
        Permission.EXPORT_REPORTS,
    },
}


# ---------------------------------------------------------------------------
# Função de verificação (usada nos routers)
# ---------------------------------------------------------------------------

def check_permission(user: any, permission: Permission) -> None:
    """
    Verifica se o usuário tem a permissão solicitada.
    Lança HTTPException 403 se não tiver.

    Uso:
        check_permission(current_user, Permission.IMPORT_ORDERS)
    """
    role = user.role.value if hasattr(user.role, "value") else user.role
    allowed = ROLE_PERMISSIONS.get(role, set())
    if permission not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Seu perfil ({role}) não tem permissão para: {permission.value}",
        )


def has_permission(user: any, permission: Permission) -> bool:
    """
    Retorna True se o usuário tem a permissão. Não lança exceção.
    Útil para renderização condicional via /me endpoint.
    """
    role = user.role.value if hasattr(user.role, "value") else user.role
    return permission in ROLE_PERMISSIONS.get(role, set())


def get_user_permissions(user: any) -> List[str]:
    """
    Retorna todas as permissões do usuário como lista de strings.
    Enviado no /me para o frontend renderizar botões condicionalmente.
    """
    role = user.role.value if hasattr(user.role, "value") else user.role
    return [p.value for p in ROLE_PERMISSIONS.get(role, set())]


# ---------------------------------------------------------------------------
# Constantes para o frontend (exportadas via /me ou /config)
# ---------------------------------------------------------------------------

# Ações que sempre ficam ocultas para o role 'client'
CLIENT_HIDDEN_ACTIONS = [
    "import_orders",
    "scan_barcode",
    "create_product",
    "edit_product",
    "delete_product",
    "edit_stock",
    "manage_kits",
    "manage_box_algo",
    "create_seller",
    "edit_seller",
    "create_user",
    "edit_user",
    "edit_settings",
    "view_audit_log",
]

# Botão de upload (importar pedidos) — somente admin
UPLOAD_ROLES = {"admin"}

# Botões de exportação — todos os perfis
EXPORT_ROLES = {"admin", "manager", "operator", "client"}
