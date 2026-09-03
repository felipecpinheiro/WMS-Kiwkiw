"""
WMS Kiwkiw - Acesso Protegido ao Financeiro (02/09/2026)
==========================================================
Mesmo sendo admin, usar a tela de Faturamento (/billing) exige confirmar um
código de 6 dígitos enviado por e-mail a uma lista fixa de responsáveis
(WMS_BILLING_APPROVERS). O acesso liberado dura 4h, por usuário. Existe um
código-mestre de emergência (WMS_BILLING_MASTER_CODE).

Tudo aqui é `require_admin` — qualquer admin pode pedir/confirmar o código,
não existe lista de "quem pode pedir".

Rate-limit (1/min, 5/h de PEDIDO_CODIGO) e o contador de 5 erros seguidos são
derivados só de `AuditLog` (entity_type="AcessoFinanceiro") — não há tabela
nem coluna de tentativas: a própria trilha de auditoria pedida na spec já é
o dado necessário. Ver `models.BillingAccessCode` para a tabela que guarda o
hash do código e a janela de acesso concedida.
"""

import hashlib
import json
import os
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import require_admin
from .. import models, schemas
from ..timezone_utils import now_brasilia
from ..services import billing_access_mail as mailer

router = APIRouter(prefix="/billing/access", tags=["Acesso ao Financeiro"])

CODE_TTL_MIN = 10
ACCESS_HOURS = 4
BLOCK_MIN = 15
MAX_CONSECUTIVE_ERRORS = 5
RATE_LIMIT_PER_MIN = 1
RATE_LIMIT_PER_HOUR = 5


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _audit(db: Session, user: models.User, ip: Optional[str], action: str, detail: dict):
    db.add(models.AuditLog(
        entity_type="AcessoFinanceiro", entity_id=user.id, action=action,
        detail=json.dumps(detail, ensure_ascii=False, default=str),
        user_id=user.id, ip_address=ip, timestamp=now_brasilia(),
    ))


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _active_block(db: Session, user_id: int):
    """Devolve o horário até quando o usuário está bloqueado, ou None."""
    row = (
        db.query(models.AuditLog)
        .filter(
            models.AuditLog.entity_type == "AcessoFinanceiro",
            models.AuditLog.user_id == user_id,
            models.AuditLog.action == "BLOQUEIO",
        )
        .order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc())
        .first()
    )
    if not row:
        return None
    try:
        detail = json.loads(row.detail or "{}")
        until = _fromiso(detail.get("until"))
    except Exception:
        return None
    if until and until > now_brasilia():
        return until
    return None


def _fromiso(s: Optional[str]):
    if not s:
        return None
    from datetime import datetime
    return datetime.fromisoformat(s)


def _consecutive_errors(db: Session, user_id: int) -> int:
    """Erros seguidos desde o último acerto/bloqueio (que zeram o contador)."""
    rows = (
        db.query(models.AuditLog)
        .filter(
            models.AuditLog.entity_type == "AcessoFinanceiro",
            models.AuditLog.user_id == user_id,
            models.AuditLog.action.in_(["ERRO", "ACERTO", "BLOQUEIO"]),
        )
        .order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc())
        .limit(MAX_CONSECUTIVE_ERRORS + 1)
        .all()
    )
    count = 0
    for r in rows:
        if r.action == "ERRO":
            count += 1
        else:
            break
    return count


def _check_block(db: Session, user: models.User):
    until = _active_block(db, user.id)
    if until:
        raise HTTPException(
            status_code=403,
            detail=f"Bloqueado por tentativas erradas. Tente de novo às {until.strftime('%H:%M')}.",
        )


def _check_rate_limit(db: Session, user: models.User):
    now = now_brasilia()
    recent = (
        db.query(models.AuditLog)
        .filter(
            models.AuditLog.entity_type == "AcessoFinanceiro",
            models.AuditLog.user_id == user.id,
            models.AuditLog.action == "PEDIDO_CODIGO",
            models.AuditLog.timestamp >= now - timedelta(hours=1),
        )
        .order_by(models.AuditLog.timestamp.desc())
        .all()
    )
    if not recent:
        return
    last = recent[0].timestamp
    if now - last < timedelta(minutes=1):
        wait_s = 60 - int((now - last).total_seconds())
        wait_min = max(1, -(-wait_s // 60))  # arredonda pra cima
        raise HTTPException(429, detail=f"Aguarde {wait_min} min para pedir outro código.")
    if len(recent) >= RATE_LIMIT_PER_HOUR:
        oldest_of_window = recent[RATE_LIMIT_PER_HOUR - 1].timestamp
        free_at = oldest_of_window + timedelta(hours=1)
        wait_min = max(1, -(-int((free_at - now).total_seconds()) // 60))
        raise HTTPException(429, detail=f"Aguarde {wait_min} min para pedir outro código.")


@router.post("/request", response_model=schemas.BillingAccessRequestOut)
def request_code(
    req: Request,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ip = _client_ip(req)
    _check_block(db, current_user)
    _check_rate_limit(db, current_user)

    code = f"{secrets.randbelow(900000) + 100000:06d}"

    try:
        mailer.send_code_email(current_user.name, current_user.email, code)
    except Exception as e:
        # Log do erro real pro Railway (a mensagem pro usuário fica genérica de propósito).
        print(f"[billing_access] Falha ao enviar e-mail: {type(e).__name__}: {e}")
        raise HTTPException(500, detail="Falha ao enviar e-mail. Verifique a configuração SMTP e tente de novo.")

    now = now_brasilia()
    db.add(models.BillingAccessCode(
        user_id=current_user.id, code_hash=_hash_code(code),
        created_at=now, expires_at=now + timedelta(minutes=CODE_TTL_MIN),
    ))
    _audit(db, current_user, ip, "PEDIDO_CODIGO", {"admin": current_user.name})
    db.commit()

    return {"enviado": True, "expira_em_seg": CODE_TTL_MIN * 60}


@router.post("/verify", response_model=schemas.BillingAccessVerifyOut)
def verify_code(
    body: schemas.BillingAccessVerifyIn,
    req: Request,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ip = _client_ip(req)
    _check_block(db, current_user)

    codigo = (body.codigo or "").strip()
    now = now_brasilia()
    master = (os.environ.get("WMS_BILLING_MASTER_CODE") or "").strip()

    via_master = bool(master) and codigo == master
    row = None
    if not via_master:
        row = (
            db.query(models.BillingAccessCode)
            .filter(
                models.BillingAccessCode.user_id == current_user.id,
                models.BillingAccessCode.code_hash == _hash_code(codigo),
                models.BillingAccessCode.consumed_at.is_(None),
                models.BillingAccessCode.expires_at > now,
            )
            .first()
        )

    if via_master or row:
        access_expires_at = now + timedelta(hours=ACCESS_HOURS)
        if via_master:
            db.add(models.BillingAccessCode(
                user_id=current_user.id, code_hash=None,
                created_at=now, expires_at=now, consumed_at=now,
                access_expires_at=access_expires_at, via_master=True,
            ))
        else:
            row.consumed_at = now
            row.access_expires_at = access_expires_at
        _audit(db, current_user, ip, "ACERTO", {"via_master": via_master})
        db.commit()

        if via_master:
            try:
                mailer.send_alert_email("mestre", current_user.name, current_user.email)
            except Exception:
                pass  # acesso já foi concedido; falha no alerta não desfaz a liberação

        return {"liberado_ate": access_expires_at.isoformat()}

    # ── erro ────────────────────────────────────────────────────────────
    _audit(db, current_user, ip, "ERRO", {})
    db.commit()
    consecutive = _consecutive_errors(db, current_user.id)

    if consecutive >= MAX_CONSECUTIVE_ERRORS:
        until = now + timedelta(minutes=BLOCK_MIN)
        _audit(db, current_user, ip, "BLOQUEIO", {"until": until.isoformat()})
        db.commit()
        try:
            mailer.send_alert_email("5_erros", current_user.name, current_user.email)
        except Exception:
            pass
        raise HTTPException(
            403,
            detail=f"5 tentativas erradas. Bloqueado até {until.strftime('%H:%M')}.",
        )

    raise HTTPException(403, detail="Código inválido.")


@router.get("/status", response_model=schemas.BillingAccessStatusOut)
def access_status(
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = now_brasilia()
    active = (
        db.query(models.BillingAccessCode)
        .filter(
            models.BillingAccessCode.user_id == current_user.id,
            models.BillingAccessCode.consumed_at.isnot(None),
            models.BillingAccessCode.access_expires_at > now,
        )
        .order_by(models.BillingAccessCode.access_expires_at.desc())
        .first()
    )
    bloqueado_ate = _active_block(db, current_user.id)
    return {
        "ativo": active is not None,
        "liberado_ate": active.access_expires_at.isoformat() if active else None,
        "bloqueado_ate": bloqueado_ate.isoformat() if bloqueado_ate else None,
    }
