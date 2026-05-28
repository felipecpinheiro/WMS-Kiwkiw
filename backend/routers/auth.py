"""
WMS Kiwkiw - Router de Autenticação
Endpoints de login, logout e refresh de token.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..auth import verify_password, create_access_token, hash_password, get_current_user
from .. import models, schemas

router = APIRouter(prefix="/auth", tags=["Autenticação"])


@router.post("/login", response_model=schemas.Token)
def login(request: schemas.LoginRequest, db: Session = Depends(get_db)):
    """Realiza login e retorna token JWT."""
    user = db.query(models.User).filter(
        models.User.email == request.email,
        models.User.active == True,
    ).first()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha incorretos",
        )

    # Atualiza último login
    user.last_login = datetime.now()
    db.commit()

    token = create_access_token(user)
    role = user.role.value if hasattr(user.role, 'value') else user.role

    return schemas.Token(
        access_token=token,
        token_type="bearer",
        role=role,
        user_id=user.id,
        name=user.name,
        unit_id=user.unit_id,
        seller_id=user.seller_id,
    )


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    """Retorna dados do usuário autenticado (enriquecido com nomes e seller_ids)."""
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    return schemas.UserResponse(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        role=role,
        unit_id=current_user.unit_id,
        unit_name=current_user.unit.name if current_user.unit else None,
        seller_id=current_user.seller_id,
        seller_name=(current_user.seller.trade_name if current_user.seller else None),
        seller_ids=[s.id for s in (current_user.sellers or [])],
        seller_names=[s.trade_name for s in (current_user.sellers or [])],
        active=current_user.active,
        created_at=current_user.created_at,
        last_login=current_user.last_login,
    )


@router.post("/change-password")
def change_password(
    old_password: str,
    new_password: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Altera senha do usuário autenticado."""
    if not verify_password(old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Nova senha deve ter pelo menos 6 caracteres")

    current_user.password_hash = hash_password(new_password)
    db.commit()
    return {"message": "Senha alterada com sucesso"}
