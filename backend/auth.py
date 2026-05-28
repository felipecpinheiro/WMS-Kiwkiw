"""
WMS Kiwkiw - Autenticação JWT e Controle de Acesso
Gerencia login, tokens e verificação de roles.

Perfis suportados:
  admin    → Administrador: acesso total, único que importa pedidos e cadastra usuários/sellers
  manager  → Gerente: vê/edita apenas seus grupos de sellers, sem cadastrar usuários
  operator → Operador: bipagem dos sellers que atende, sem cadastrar produtos
  client   → Cliente (seller): somente leitura — estoque e cards de manuseio do seu seller
"""

from datetime import datetime, timedelta
from typing import Optional, List
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from . import models, schemas

# Fix: passlib 1.7.4 incompatível com bcrypt 4.x
import bcrypt as _bcrypt
if not hasattr(_bcrypt, '__about__'):
    _bcrypt.__about__ = type('_about', (), {'__version__': _bcrypt.__version__})()
    
# ---------------------------------------------------------------------------
# Configurações de segurança
# ---------------------------------------------------------------------------
# Em produção: substitua por variável de ambiente (ex: os.getenv("SECRET_KEY"))
SECRET_KEY = "wms-kiwkiw-secret-key-change-in-production-2024"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ---------------------------------------------------------------------------
# Hierarquia de roles (ordem crescente de privilégio)
# ---------------------------------------------------------------------------
ROLE_HIERARCHY = {
    "client":   0,
    "operator": 1,
    "manager":  2,
    "admin":    3,
}


def hash_password(password: str) -> str:
    """Gera hash bcrypt da senha."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica senha contra hash armazenado."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user: "models.User") -> str:
    """
    Cria token JWT com dados do usuário.

    Campos no payload:
      sub         → ID do usuário (string)
      role        → perfil (admin | manager | operator | client)
      unit_id     → unidade física do usuário (nullable)
      seller_id   → seller principal vinculado (nullable, usado para 'client')
      seller_ids  → lista de seller IDs que o usuário pode acessar
                    (gerente/operador: seus grupos; admin: None = sem filtro)
    """
    role = user.role.value if hasattr(user.role, "value") else user.role

    # Monta lista de seller_ids acessíveis
    seller_ids: Optional[List[int]] = None
    if role == "admin":
        seller_ids = None  # admin vê tudo — sem filtro
    elif hasattr(user, "sellers") and user.sellers:
        # manager/operator: lista dos sellers associados (many-to-many)
        seller_ids = [s.id for s in user.sellers]
    elif user.seller_id:
        # client ou usuário com seller único
        seller_ids = [user.seller_id]

    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user.id),
        "role": role,
        "unit_id": user.unit_id,
        "seller_id": user.seller_id,   # seller principal (client)
        "seller_ids": seller_ids,       # grupo de sellers (manager/operator)
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> "schemas.TokenData":
    """Decodifica e valida token JWT. Lança 401 se inválido/expirado."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        role = payload.get("role")
        if user_id is None or role is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido: campos obrigatórios ausentes",
            )
        return schemas.TokenData(
            user_id=int(user_id),
            role=role,
            unit_id=payload.get("unit_id"),
            seller_id=payload.get("seller_id"),
            seller_ids=payload.get("seller_ids"),
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> "models.User":
    """Dependency: retorna o usuário autenticado a partir do Bearer token."""
    token_data = decode_token(credentials.credentials)
    user = db.query(models.User).filter(
        models.User.id == token_data.user_id,
        models.User.active == True,
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou inativo",
        )
    return user


# ---------------------------------------------------------------------------
# Factories de verificação de role
# ---------------------------------------------------------------------------

def require_roles(*roles: str):
    """
    Dependency factory: exige que o usuário tenha exatamente um dos roles listados.
    Lança 403 se o role não estiver na lista.
    """
    def checker(current_user: "models.User" = Depends(get_current_user)):
        user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
        if user_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado. Role necessário: {', '.join(roles)}",
            )
        return current_user
    return checker


def require_min_role(min_role: str):
    """
    Dependency factory: exige que o usuário tenha role >= min_role na hierarquia.
    Exemplo: require_min_role("manager") aceita manager e admin.
    """
    min_level = ROLE_HIERARCHY.get(min_role, 99)

    def checker(current_user: "models.User" = Depends(get_current_user)):
        user_role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
        user_level = ROLE_HIERARCHY.get(user_role, -1)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado. Nível mínimo necessário: {min_role}",
            )
        return current_user
    return checker


def get_user_seller_ids(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Optional[List[int]]:
    """
    Dependency auxiliar: retorna a lista de seller_ids do token.
    None = admin (sem filtro). Lista vazia ou lista = escopo restrito.
    Usado nos routers para filtrar queries automaticamente.
    """
    token_data = decode_token(credentials.credentials)
    return token_data.seller_ids


# ---------------------------------------------------------------------------
# Shortcuts prontos para uso nos routers
# ---------------------------------------------------------------------------

# Somente administrador
require_admin = require_roles("admin")

# Administrador ou gerente (ex: editar produtos, estoque do grupo)
require_manager_or_above = require_min_role("manager")

# Qualquer usuário interno (admin, manager, operator) — exclui client
require_internal = require_min_role("operator")

# Qualquer usuário autenticado (incluindo client)
require_authenticated = require_min_role("client")
