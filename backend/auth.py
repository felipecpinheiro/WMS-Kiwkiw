"""
WMS Kiwkiw - Autenticação JWT
Gerencia login, tokens e controle de acesso por role.
"""

from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from . import models, schemas

# Configurações de segurança
SECRET_KEY = "wms-kiwkiw-secret-key-change-in-production-2024"  # Em produção: variável de ambiente
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def hash_password(password: str) -> str:
    """Gera hash bcrypt da senha."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica senha contra hash armazenado."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user: models.User) -> str:
    """Cria token JWT com dados do usuário."""
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    data = {
        "sub": str(user.id),
        "role": user.role.value if hasattr(user.role, 'value') else user.role,
        "unit_id": user.unit_id,
        "seller_id": user.seller_id,
        "exp": expire,
    }
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> schemas.TokenData:
    """Decodifica e valida token JWT."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        role = payload.get("role")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido",
            )
        return schemas.TokenData(user_id=int(user_id), role=role)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    """Dependency: retorna usuário autenticado a partir do token."""
    token_data = decode_token(credentials.credentials)
    user = db.query(models.User).filter(
        models.User.id == token_data.user_id,
        models.User.active == True
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou inativo",
        )
    return user


def require_roles(*roles: str):
    """Dependency factory: exige que o usuário tenha um dos roles especificados."""
    def checker(current_user: models.User = Depends(get_current_user)):
        user_role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
        if user_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado. Role necessário: {', '.join(roles)}",
            )
        return current_user
    return checker


# Shortcuts para os roles mais comuns
require_admin = require_roles("admin")
require_master_or_above = require_roles("admin", "master")
require_operator_or_above = require_roles("admin", "master", "operator")
require_seller = require_roles("seller")
