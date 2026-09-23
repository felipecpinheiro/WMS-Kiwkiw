"""
WMS Kiwkiw - Router do CRM comercial (23/09/2026)

Jornada do lead do primeiro contato ao fechamento. Acesso: admin e manager.
Princípio: TODO lead ativo precisa ter uma próxima ação — o servidor recusa
(422) qualquer gravação que deixe um lead ativo sem ela, independente da tela.

Nada aqui mexe em estoque, pedidos ou faturamento. Cálculos (cadência, alerta,
dias úteis) ficam em services/crm_calc.py.
"""

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..auth import require_manager_or_above
from ..timezone_utils import today_brasilia, now_brasilia
from .. import models, schemas
from ..services import crm_calc as calc

router = APIRouter(prefix="/crm", tags=["CRM Comercial"])


# ── helpers ──────────────────────────────────────────────────────────────────
def _audit(db: Session, user: models.User, lead_id: int, action: str, detail: dict):
    db.add(models.AuditLog(
        entity_type="CrmLead", entity_id=lead_id, action=action,
        detail=json.dumps(detail, ensure_ascii=False, default=str),
        user_id=user.id,
    ))


def _origins(db: Session) -> list:
    extra = [o.name for o in db.query(models.CrmOrigin).order_by(models.CrmOrigin.name).all()]
    return calc.DEFAULT_ORIGINS + [o for o in extra if o not in calc.DEFAULT_ORIGINS]


def _check_owner(db: Session, owner_id: Optional[int]):
    if owner_id is not None and not db.query(models.User.id).filter(models.User.id == owner_id).first():
        raise HTTPException(404, f"Responsável {owner_id} não existe")


def _check_lists(db: Session, origin: str = "", next_type: Optional[str] = None):
    if origin and origin not in _origins(db):
        raise HTTPException(422, f"Origem inválida: {origin}")
    if next_type and next_type not in calc.ACTION_TYPES:
        raise HTTPException(422, f"Tipo de próxima ação inválido: {next_type}")


def _apply_stage(
    lead: models.CrmLead, stage: str, loss_reason, reactivation_date,
    na_type, na_date, today: date,
):
    """Aplica etapa + regras de encerramento e de 'todo lead ativo tem próxima ação'."""
    if stage not in calc.STAGES:
        raise HTTPException(422, f"Etapa inválida: {stage}")
    if stage == "Perdido":
        if loss_reason not in calc.LOSS_REASONS:
            raise HTTPException(422, "Informe o motivo da perda")
        lead.loss_reason = loss_reason
        lead.reactivation_date = reactivation_date if loss_reason == calc.LOSS_MOMENTO else None
        lead.next_action_type = None
        lead.next_action_date = None
        if lead.stage != "Perdido" or not lead.closed_at:
            lead.closed_at = today
    elif stage == "Ganho":
        lead.loss_reason = None
        lead.reactivation_date = None
        lead.next_action_type = None
        lead.next_action_date = None
        if lead.stage != "Ganho" or not lead.closed_at:
            lead.closed_at = today
    else:
        lead.next_action_type = na_type or None
        lead.next_action_date = na_date
        if not lead.next_action_type or not lead.next_action_date:
            raise HTTPException(
                422, "Todo lead ativo precisa ter uma próxima ação (tipo e data)"
            )
        lead.loss_reason = None
        lead.reactivation_date = None
        lead.closed_at = None
    lead.stage = stage


def _stats(db: Session, lead_ids=None) -> dict:
    """Por lead: nº de contatos efetivos, se já respondeu, data do último contato efetivo."""
    q = db.query(
        models.CrmInteraction.lead_id,
        func.sum(case((models.CrmInteraction.effective == True, 1), else_=0)),  # noqa: E712
        func.sum(case((models.CrmInteraction.responded == True, 1), else_=0)),  # noqa: E712
        func.max(case((models.CrmInteraction.effective == True, models.CrmInteraction.occurred_at), else_=None)),  # noqa: E712
    ).group_by(models.CrmInteraction.lead_id)
    if lead_ids is not None:
        q = q.filter(models.CrmInteraction.lead_id.in_(lead_ids))
    out = {}
    for lid, eff, resp, last in q.all():
        last_d = last.date() if isinstance(last, datetime) else last
        if isinstance(last, str):  # SQLite pode devolver texto em agregações
            last_d = datetime.fromisoformat(last).date()
        out[lid] = {"eff": int(eff or 0), "resp": int(resp or 0) > 0, "last": last_d}
    return out


def _lead_dict(lead: models.CrmLead, st: Optional[dict], today: date) -> dict:
    st = st or {"eff": 0, "resp": False, "last": None}
    contact_dates = [d for d in (
        lead.first_contact_date, lead.second_contact_date, lead.third_contact_date, st["last"],
    ) if d]
    last_contact = max(contact_dates) if contact_dates else None
    created = lead.created_at.date() if lead.created_at else today
    active = lead.stage not in calc.CLOSED_STAGES
    suggest_close = bool(
        active and not st["resp"] and st["eff"] >= calc.LAST_ATTEMPT and last_contact
        and today >= calc.add_business_days(last_contact, 7)
    )
    return {
        "id": lead.id,
        "company": lead.company,
        "contact_name": lead.contact_name,
        "role_title": lead.role_title,
        "email": lead.email,
        "phone": lead.phone,
        "origin": lead.origin,
        "owner_id": lead.owner_id,
        "owner_name": lead.owner.name if lead.owner else None,
        "first_contact_date": lead.first_contact_date,
        "second_contact_date": lead.second_contact_date,
        "third_contact_date": lead.third_contact_date,
        "proposal_date": lead.proposal_date,
        "stage": lead.stage,
        "next_action_type": lead.next_action_type,
        "next_action_date": lead.next_action_date,
        "alert": calc.alert_status(lead.stage, lead.next_action_date, today),
        "closed_at": lead.closed_at,
        "loss_reason": lead.loss_reason,
        "reactivation_date": lead.reactivation_date,
        "notes": lead.notes,
        "created_at": created,
        "last_contact_date": last_contact,
        "days_since_last_contact": calc.days_since(last_contact, today),
        "days_in_funnel": calc.days_in_funnel(created, lead.closed_at, today),
        "effective_count": st["eff"],
        "has_responded": st["resp"],
        "suggest_close": suggest_close,
    }


def _load_leads(db: Session) -> list:
    return db.query(models.CrmLead).options(joinedload(models.CrmLead.owner)).all()


def _all_dicts(db: Session) -> list:
    today = today_brasilia()
    leads = _load_leads(db)
    stats = _stats(db)
    return [_lead_dict(l, stats.get(l.id), today) for l in leads]


def _get_lead(db: Session, lead_id: int) -> models.CrmLead:
    lead = (
        db.query(models.CrmLead).options(joinedload(models.CrmLead.owner))
        .filter(models.CrmLead.id == lead_id).first()
    )
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    return lead


def _one_dict(db: Session, lead: models.CrmLead) -> dict:
    return _lead_dict(lead, _stats(db, [lead.id]).get(lead.id), today_brasilia())


def _interaction_dict(i: models.CrmInteraction) -> dict:
    return {
        "id": i.id,
        "occurred_at": i.occurred_at,
        "contact_type": i.contact_type,
        "channel": i.channel,
        "owner_id": i.owner_id,
        "owner_name": i.owner.name if i.owner else None,
        "summary": i.summary,
        "effective": i.effective,
        "responded": i.responded,
        "stage_after": i.stage_after,
        "next_action_type": i.next_action_type,
        "next_action_date": i.next_action_date,
    }


# ── meta / origens ───────────────────────────────────────────────────────────
@router.get("/meta")
def meta(db: Session = Depends(get_db), user=Depends(require_manager_or_above)):
    owners = (
        db.query(models.User)
        .filter(models.User.active == True)  # noqa: E712
        .filter(models.User.role.in_([models.UserRole.ADMIN, models.UserRole.MANAGER]))
        .order_by(models.User.name).all()
    )
    return {
        "stages": calc.STAGES,
        "origins": _origins(db),
        "action_types": calc.ACTION_TYPES,
        "loss_reasons": calc.LOSS_REASONS,
        "loss_momento": calc.LOSS_MOMENTO,
        "contact_types": calc.CONTACT_TYPES,
        "channels": calc.CHANNELS,
        "outcomes": [{"key": k, "label": v} for k, v in calc.OUTCOMES.items()],
        "owners": [{"id": u.id, "name": u.name} for u in owners],
        "me": user.id,
    }


@router.post("/origins")
def add_origin(body: schemas.CrmOriginIn, db: Session = Depends(get_db),
               user=Depends(require_manager_or_above)):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Informe o nome da origem")
    if any(o.lower() == name.lower() for o in _origins(db)):
        raise HTTPException(400, "Essa origem já existe")
    db.add(models.CrmOrigin(name=name))
    db.commit()
    return {"origins": _origins(db)}


# ── leads ────────────────────────────────────────────────────────────────────
@router.get("/leads")
def list_leads(
    search: Optional[str] = None,
    owner_id: Optional[int] = None,
    origin: Optional[str] = None,
    stage: Optional[str] = None,
    alert: Optional[str] = None,
    status: str = Query("active", pattern="^(active|closed|all)$"),
    db: Session = Depends(get_db), user=Depends(require_manager_or_above),
):
    rows = _all_dicts(db)
    if status == "active":
        rows = [r for r in rows if r["stage"] not in calc.CLOSED_STAGES]
    elif status == "closed":
        rows = [r for r in rows if r["stage"] in calc.CLOSED_STAGES]
    if owner_id:
        rows = [r for r in rows if r["owner_id"] == owner_id]
    if origin:
        rows = [r for r in rows if r["origin"] == origin]
    if stage:
        rows = [r for r in rows if r["stage"] == stage]
    if alert:
        rows = [r for r in rows if r["alert"] == alert]
    if search and search.strip():
        t = search.strip().lower()
        rows = [r for r in rows if t in (r["company"] or "").lower() or t in (r["contact_name"] or "").lower()]
    # Padrão: mais urgente primeiro (próxima ação mais antiga; sem ação logo depois dos vencidos).
    rows.sort(key=lambda r: (
        calc.ALERT_ORDER.get(r["alert"], 9), r["next_action_date"] or date.max, r["company"].lower(),
    ))
    return rows


@router.post("/leads")
def create_lead(body: schemas.CrmLeadIn, db: Session = Depends(get_db),
                user=Depends(require_manager_or_above)):
    if not body.company.strip():
        raise HTTPException(422, "Informe o seller / empresa")
    _check_owner(db, body.owner_id)
    _check_lists(db, body.origin, body.next_action_type)
    today = today_brasilia()
    lead = models.CrmLead(
        company=body.company.strip(), contact_name=body.contact_name.strip(),
        role_title=body.role_title.strip(), email=body.email.strip(), phone=body.phone.strip(),
        origin=body.origin, owner_id=body.owner_id or user.id,
        first_contact_date=body.first_contact_date, second_contact_date=body.second_contact_date,
        third_contact_date=body.third_contact_date, proposal_date=body.proposal_date,
        notes=body.notes, created_by_id=user.id,
    )
    _apply_stage(lead, body.stage, body.loss_reason, body.reactivation_date,
                 body.next_action_type, body.next_action_date, today)
    db.add(lead)
    db.flush()
    _audit(db, user, lead.id, "CREATE", {"company": lead.company, "stage": lead.stage})
    db.commit()
    db.refresh(lead)
    return _one_dict(db, lead)


@router.get("/leads/{lead_id}")
def get_lead(lead_id: int, db: Session = Depends(get_db), user=Depends(require_manager_or_above)):
    lead = _get_lead(db, lead_id)
    inters = (
        db.query(models.CrmInteraction).options(joinedload(models.CrmInteraction.owner))
        .filter(models.CrmInteraction.lead_id == lead_id)
        .order_by(models.CrmInteraction.occurred_at.desc(), models.CrmInteraction.id.desc()).all()
    )
    d = _one_dict(db, lead)
    d["interactions"] = [_interaction_dict(i) for i in inters]
    return d


@router.put("/leads/{lead_id}")
def update_lead(lead_id: int, body: schemas.CrmLeadIn, db: Session = Depends(get_db),
                user=Depends(require_manager_or_above)):
    lead = _get_lead(db, lead_id)
    if not body.company.strip():
        raise HTTPException(422, "Informe o seller / empresa")
    _check_owner(db, body.owner_id)
    _check_lists(db, body.origin, body.next_action_type)
    before = lead.stage
    lead.company = body.company.strip()
    lead.contact_name = body.contact_name.strip()
    lead.role_title = body.role_title.strip()
    lead.email = body.email.strip()
    lead.phone = body.phone.strip()
    lead.origin = body.origin
    lead.owner_id = body.owner_id
    lead.first_contact_date = body.first_contact_date
    lead.second_contact_date = body.second_contact_date
    lead.third_contact_date = body.third_contact_date
    lead.proposal_date = body.proposal_date
    lead.notes = body.notes
    _apply_stage(lead, body.stage, body.loss_reason, body.reactivation_date,
                 body.next_action_type, body.next_action_date, today_brasilia())
    _audit(db, user, lead.id, "UPDATE", {"stage_antes": before, "stage_depois": lead.stage})
    db.commit()
    db.refresh(lead)
    return _one_dict(db, lead)


@router.post("/leads/{lead_id}/stage")
def change_stage(lead_id: int, body: schemas.CrmStageIn, db: Session = Depends(get_db),
                 user=Depends(require_manager_or_above)):
    """Troca de etapa com poucos cliques. Mantém a próxima ação atual se a etapa segue ativa."""
    lead = _get_lead(db, lead_id)
    _check_lists(db, "", body.next_action_type)
    before = lead.stage
    na_type = body.next_action_type or lead.next_action_type
    na_date = body.next_action_date or lead.next_action_date
    _apply_stage(lead, body.stage, body.loss_reason, body.reactivation_date,
                 na_type, na_date, today_brasilia())
    _audit(db, user, lead.id, "STAGE", {
        "de": before, "para": lead.stage, "motivo": lead.loss_reason,
    })
    db.commit()
    db.refresh(lead)
    return _one_dict(db, lead)


@router.post("/leads/{lead_id}/reopen")
def reopen_lead(lead_id: int, db: Session = Depends(get_db), user=Depends(require_manager_or_above)):
    """Reativa lead perdido (ex.: 'Momento inadequado' que chegou na data). Volta como Novo lead, ação hoje."""
    lead = _get_lead(db, lead_id)
    if lead.stage not in calc.CLOSED_STAGES:
        raise HTTPException(400, "O lead já está ativo")
    before = lead.stage
    _apply_stage(lead, "Novo lead", None, None, "WhatsApp",
                 calc.add_business_days(today_brasilia(), 0), today_brasilia())
    _audit(db, user, lead.id, "REOPEN", {"de": before})
    db.commit()
    db.refresh(lead)
    return _one_dict(db, lead)


# ── interações ───────────────────────────────────────────────────────────────
@router.post("/suggest")
def suggest(body: schemas.CrmSuggestIn, db: Session = Depends(get_db),
            user=Depends(require_manager_or_above)):
    """Sugere próxima ação/data/etapa pela cadência. Não grava nada."""
    _get_lead(db, body.lead_id)
    st = _stats(db, [body.lead_id]).get(body.lead_id, {"eff": 0})
    effective = body.effective or body.responded
    count = st["eff"] + (1 if effective else 0)
    if body.outcome and body.outcome not in calc.OUTCOMES:
        raise HTTPException(422, "Resultado inválido")
    s = calc.suggest_next_action(
        body.base_date or today_brasilia(), count, body.responded, body.outcome, body.client_date,
    )
    s["effective_count"] = count
    return s


@router.post("/leads/{lead_id}/interactions")
def add_interaction(lead_id: int, body: schemas.CrmInteractionIn, db: Session = Depends(get_db),
                    user=Depends(require_manager_or_above)):
    lead = _get_lead(db, lead_id)
    if lead.stage in calc.CLOSED_STAGES:
        raise HTTPException(400, "Lead encerrado — reative-o antes de registrar nova interação")
    if body.contact_type not in calc.CONTACT_TYPES:
        raise HTTPException(422, f"Tipo de contato inválido: {body.contact_type}")
    if body.channel and body.channel not in calc.CHANNELS:
        raise HTTPException(422, f"Canal inválido: {body.channel}")
    _check_owner(db, body.owner_id)
    _check_lists(db, "", body.next_action_type)
    stage = body.stage or lead.stage
    try:
        hh, mm = (body.occurred_time or "00:00").split(":")[:2]
        occurred = datetime.combine(body.occurred_date, datetime.min.time()).replace(
            hour=int(hh), minute=int(mm))
    except (ValueError, TypeError):
        raise HTTPException(422, "Hora inválida (use HH:MM)")

    effective = body.effective or body.responded
    # Perdido exige motivo (validado dentro de _apply_stage); a interação fica no histórico.
    _apply_stage(lead, stage, body.loss_reason, None,
                 body.next_action_type, body.next_action_date, today_brasilia())

    # Datas resumidas: 1º/2º/3º contato efetivo e envio da proposta (só preenche o que está vazio)
    d = body.occurred_date
    if effective:
        if not lead.first_contact_date:
            lead.first_contact_date = d
        elif not lead.second_contact_date:
            lead.second_contact_date = d
        elif not lead.third_contact_date:
            lead.third_contact_date = d
    if (body.contact_type == "Proposta" or stage == "Proposta enviada") and not lead.proposal_date:
        lead.proposal_date = d

    inter = models.CrmInteraction(
        lead_id=lead.id, occurred_at=occurred, contact_type=body.contact_type,
        channel=body.channel, owner_id=body.owner_id or user.id, summary=body.summary.strip(),
        effective=effective, responded=body.responded, stage_after=stage,
        next_action_type=lead.next_action_type, next_action_date=lead.next_action_date,
        created_by_id=user.id,
    )
    db.add(inter)
    db.flush()
    _audit(db, user, lead.id, "INTERACTION", {"tipo": body.contact_type, "etapa": stage})
    db.commit()
    db.refresh(lead)
    return _one_dict(db, lead)


# ── O que fazer hoje ─────────────────────────────────────────────────────────
@router.get("/today")
def today_view(owner_id: Optional[int] = None, db: Session = Depends(get_db),
               user=Depends(require_manager_or_above)):
    today = today_brasilia()
    rows = _all_dicts(db)
    if owner_id:
        rows = [r for r in rows if r["owner_id"] == owner_id]
    active = [r for r in rows if r["alert"]]

    def bucket(name):
        return sorted(
            (r for r in active if r["alert"] == name),
            key=lambda r: (r["next_action_date"] or date.max, r["company"].lower()),
        )

    reactivate = sorted(
        (r for r in rows
         if r["stage"] == "Perdido" and r["reactivation_date"] and r["reactivation_date"] <= today),
        key=lambda r: r["reactivation_date"],
    )
    return {
        "today": today,
        "overdue": bucket("atrasado"),
        "due_today": bucket("hoje"),
        "next2": bucket("proximos2"),
        "no_action": sorted((r for r in active if r["alert"] == "sem_acao"),
                            key=lambda r: r["company"].lower()),
        "reactivate": reactivate,
    }


# ── Dashboard ────────────────────────────────────────────────────────────────
@router.get("/dashboard")
def dashboard(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    owner_id: Optional[int] = None,
    origin: Optional[str] = None,
    stage: Optional[str] = None,
    alert: Optional[str] = None,
    db: Session = Depends(get_db), user=Depends(require_manager_or_above),
):
    """
    Período vale para: novos leads, ganhos/perdidos (pela data de encerramento),
    conversão, tempo médio e leads por origem. Já 'ativos', etapas do funil,
    atrasados e sem ação são a FOTO de hoje.
    """
    today = today_brasilia()
    d_to = date_to or today
    d_from = date_from or (d_to - timedelta(days=29))
    if d_from > d_to:
        d_from, d_to = d_to, d_from

    rows = _all_dicts(db)
    if owner_id:
        rows = [r for r in rows if r["owner_id"] == owner_id]
    if origin:
        rows = [r for r in rows if r["origin"] == origin]
    if stage:
        rows = [r for r in rows if r["stage"] == stage]
    if alert:
        rows = [r for r in rows if r["alert"] == alert]

    active = [r for r in rows if r["stage"] not in calc.CLOSED_STAGES]
    novos = [r for r in rows if d_from <= r["created_at"] <= d_to]
    ganhos = [r for r in rows if r["stage"] == "Ganho" and r["closed_at"] and d_from <= r["closed_at"] <= d_to]
    perdidos = [r for r in rows if r["stage"] == "Perdido" and r["closed_at"] and d_from <= r["closed_at"] <= d_to]
    decididos = len(ganhos) + len(perdidos)
    ciclos = [(r["closed_at"] - r["first_contact_date"]).days for r in ganhos if r["first_contact_date"]]

    by_stage = Counter(r["stage"] for r in rows)
    by_origin = Counter((r["origin"] or "Sem origem") for r in novos)
    by_loss = Counter((r["loss_reason"] or "—") for r in perdidos)
    return {
        "period": {"from": d_from, "to": d_to},
        "kpis": {
            "active": len(active),
            "new_in_period": len(novos),
            "followup": by_stage.get("Em follow-up", 0),
            "proposals": by_stage.get("Proposta enviada", 0),
            "negotiation": by_stage.get("Negociação", 0),
            "won": len(ganhos),
            "lost": len(perdidos),
            "overdue": sum(1 for r in active if r["alert"] == "atrasado"),
            "no_action": sum(1 for r in active if r["alert"] == "sem_acao"),
            "conversion_pct": round(100 * len(ganhos) / decididos, 1) if decididos else None,
            "avg_days_to_close": round(sum(ciclos) / len(ciclos), 1) if ciclos else None,
        },
        "by_origin": [{"name": k, "count": v} for k, v in by_origin.most_common()],
        "by_stage": [{"name": s, "count": by_stage.get(s, 0)} for s in calc.STAGES],
        "by_loss_reason": [{"name": k, "count": v} for k, v in by_loss.most_common()],
    }
