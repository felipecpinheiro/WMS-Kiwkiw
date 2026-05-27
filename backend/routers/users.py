"""
WMS Kiwkiw - Router de Gestão de Usuários
Somente o admin pode criar, editar e inativar usuários.

Endpoints:
  GET    /users              → lista todos os usuários (admin) ou somente do grupo (manager)
  POST   /users              → cria novo usuário (admin only)
  GET    /users/{id}         → detalha usuário
  PUT    /users/{id}         → edita usuário (admin only)
  DELETE /users/{id}         → inativa usuário (admin only) — nunca deleta fisicamente
  POST   /users/{id}/reset-password → redefine senha (admin only)
  GET    /users/me/permissions      → lista permissões do usuário logado (todos os perfis)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user, require_admin, require_manager_or_above
from ..permissions import get_user_permissions, check_permission, Permission
from .. import models, schemas

router = APIRouter(prefix="/users", tags=["Usuários"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_role_str(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else user.role


def _seller_ids_of(user: models.User) -> List[int]:
    """Retorna a lista de seller_ids acessíveis ao usuário."""
    role = _get_role_str(user)
    if role == "admin":
        return []  # sem filtro
    if hasattr(user, "seller_ids") and user.seller_ids:
        return [s.id for s in user.seller_ids]
    if user.seller_id:
        return [user.seller_id]
    return []


# ---------------------------------------------------------------------------
# GET /users/me/permissions — qualquer perfil autenticado
# ---------------------------------------------------------------------------

@router.get("/me/permissions", summary="Permissões do usuário logado")
def get_my_permissions(current_user: models.User = Depends(get_current_user)):
    """
    Retorna todas as permissões do usuário logado como lista de strings.
    O frontend usa isso para renderizar (ou ocultar) botões e seções.
    """
    role = _get_role_str(current_user)
    return {
        "user_id": current_user.id,
        "name": current_user.name,
        "role": role,
        "unit_id": current_user.unit_id,
        "seller_id": current_user.seller_id,
        "seller_ids": _seller_ids_of(current_user),
        "permissions": get_user_permissions(current_user),
        # Atalhos booleanos que o frontend consome diretamente
        "can_upload": role == "admin",
        "can_export": True,  # todos os perfis
        "can_manage_users": role == "admin",
        "can_manage_sellers": role == "admin",
        "can_edit_products": role in ("admin", "manager"),
        "can_edit_stock": role in ("admin", "manager"),
        "can_scan": role in ("admin", "manager", "operator"),
        "can_interrupt_order": role in ("admin", "manager", "operator"),
        "can_view_audit": role in ("admin", "manager"),
        "can_edit_settings": role == "admin",
    }


# ---------------------------------------------------------------------------
# GET /users — lista usuários
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[schemas.UserResponse], summary="Lista de usuários")
def list_users(
    active_only: bool = True,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    """
    Admin: vê todos os usuários.
    Manager: vê somente usuários do seu grupo de sellers.
    """
    query = db.query(models.User)
    if active_only:
        query = query.filter(models.User.active == True)

    role = _get_role_str(current_user)
    if role != "admin":
        # Manager filtra por sellers do seu grupo
        seller_ids = _seller_ids_of(current_user)
        if seller_ids:
            query = query.filter(models.User.seller_id.in_(seller_ids))
        else:
            # Manager sem sellers configurados: não vê ninguém por segurança
            return []

    return query.order_by(models.User.name).all()


# ---------------------------------------------------------------------------
# POST /users — cria usuário (admin only)
# ---------------------------------------------------------------------------

@router.post("/", response_model=schemas.UserResponse, status_code=201, summary="Criar usuário")
def create_user(
    payload: schemas.UserCreate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Cadastra novo usuário. Somente o administrador pode executar.

    Regras:
      - Email deve ser único
      - Role deve ser um dos: admin | manager | operator | client
      - operator/client deve ter seller_id ou seller_ids configurados
    """
    # Verifica email duplicado
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    from ..auth import hash_password
    user = models.User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        unit_id=payload.unit_id,
        seller_id=payload.seller_id,
        active=True,
        created_at=datetime.now(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Vincula sellers ao usuário se informados
    if payload.seller_ids:
        sellers = db.query(models.Seller).filter(models.Seller.id.in_(payload.seller_ids)).all()
        user.seller_ids = sellers
        db.commit()
        db.refresh(user)

    return user


# ---------------------------------------------------------------------------
# GET /users/{id} — detalha usuário
# ---------------------------------------------------------------------------

@router.get("/{user_id}", response_model=schemas.UserResponse, summary="Detalhes do usuário")
def get_user(
    user_id: int,
    current_user: models.User = Depends(require_manager_or_above),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Manager só pode ver usuários do seu grupo
    role = _get_role_str(current_user)
    if role != "admin":
        seller_ids = _seller_ids_of(current_user)
        if seller_ids and user.seller_id not in seller_ids:
            raise HTTPException(status_code=403, detail="Acesso negado a este usuário")

    return user


# ---------------------------------------------------------------------------
# PUT /users/{id} — edita usuário (admin only)
# ---------------------------------------------------------------------------

@router.put("/{user_id}", response_model=schemas.UserResponse, summary="Editar usuário")
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Edita dados do usuário. Somente administrador."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if payload.name is not None:
        user.name = payload.name
    if payload.email is not None:
        # Verifica duplicata de email (ignorando o próprio usuário)
        dup = db.query(models.User).filter(
            models.User.email == payload.email,
            models.User.id != user_id,
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="Email já cadastrado por outro usuário")
        user.email = payload.email
    if payload.role is not None:
        user.role = payload.role
    if payload.unit_id is not None:
        user.unit_id = payload.unit_id
    if payload.seller_id is not None:
        user.seller_id = payload.seller_id
    if payload.seller_ids is not None:
        sellers = db.query(models.Seller).filter(models.Seller.id.in_(payload.seller_ids)).all()
        user.seller_ids = sellers

    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# DELETE /users/{id} — inativa usuário (admin only, nunca deleta fisicamente)
# ---------------------------------------------------------------------------

@router.delete("/{user_id}", summary="Inativar usuário")
def deactivate_user(
    user_id: int,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Inativa o usuário (active=False). Nunca deleta fisicamente para preservar auditoria.
    Somente administrador.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode inativar a si mesmo")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.active = False
    db.commit()
    return {"message": f"Usuário {user.name} inativado com sucesso"}


# ---------------------------------------------------------------------------
# POST /users/{id}/reactivate — reativa usuário inativo (admin only)
# ---------------------------------------------------------------------------

@router.post("/{user_id}/reactivate", summary="Reativar usuário inativo")
def reactivate_user(
    user_id: int,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reativa um usuário previamente inativado. Somente administrador."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.active:
        raise HTTPException(status_code=400, detail="Usuário já está ativo")

    user.active = True
    db.commit()
    return {"message": f"Usuário {user.name} reativado com sucesso"}


# ---------------------------------------------------------------------------
# POST /users/{id}/reset-password — admin redefine senha de qualquer usuário
# ---------------------------------------------------------------------------

@router.post("/{user_id}/reset-password", summary="Redefinir senha (admin)")
def reset_password(
    user_id: int,
    new_password: str,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Redefine a senha de qualquer usuário. Somente administrador."""
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 6 caracteres")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    from ..auth import hash_password
    user.password_hash = hash_password(new_password)
    db.commit()
    return {"message": f"Senha de {user.name} redefinida com sucesso"}
