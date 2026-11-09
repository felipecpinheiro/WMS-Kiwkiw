"""
Agendamento de Inbound (23/10/2026) — endpoints.

  client   : cria / edita / reagenda / cancela os PRÓPRIOS agendamentos (só em
             AGENDADO) — o seller_id vem sempre do token, nunca de parâmetro.
  manager+ : lista (no escopo de sellers), marca RECEBIDO, cancela, baixa anexos.
  operator : só leitura simplificada (status + resumo ao conferir).
  admin    : tudo.

As regras estão em services/inbound_flow.py. O estoque NÃO é tocado aqui: entra
só no finalize-entry (scanning.py).

⚠️ A criação/anexos recebem multipart com N NFs (campos nf0_pdf, nf0_xml,
nf0_xlsx, nf1_pdf...). Ler o formulário exige await, então esses endpoints são
`async def` SÓ para ler os arquivos; todo o trabalho de banco roda no threadpool
(`run_in_threadpool`) — não trava o event loop.
"""

import json
import re
from datetime import date as date_type, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload, selectinload
from starlette.datastructures import UploadFile

from .. import models
from ..auth import get_current_user, get_user_seller_ids
from ..database import get_db
from ..services import inbound_flow as flow
from ..services.inbound_flow import InboundError
from ..services.inbound_xml import InboundXmlError, parse_nfe_xml
from ..services.stock_manager import orders_missing_product_skus, orders_with_discontinued_skus
from ..timezone_utils import today_brasilia

router = APIRouter(prefix="/inbound", tags=["Agendamento de Inbound"])


# ── Schemas (corpo JSON) ─────────────────────────────────────────────────────
class InboundUpdateIn(BaseModel):
    scheduled_date: Optional[date_type] = None
    period: Optional[str] = None
    volumes: Optional[int] = None
    volumes_unknown: Optional[bool] = None
    pallets: Optional[int] = None
    pallets_unknown: Optional[bool] = None
    notes: Optional[str] = None


class InboundCancelIn(BaseModel):
    reason: Optional[str] = None


# ── Utilidades ───────────────────────────────────────────────────────────────
def _role(u: models.User) -> str:
    return u.role.value if hasattr(u.role, "value") else u.role


def _scope(u: models.User, seller_ids: Optional[List[int]]) -> Optional[List[int]]:
    """None = sem restrição de seller (admin)."""
    role = _role(u)
    if role == "client":
        if not u.seller_id:
            raise HTTPException(400, "Usuário sem seller vinculado.")
        return [u.seller_id]
    # Gerente enxerga tudo, igual ao Manuseios/Dashboard (decisao de 09/09/2026,
    # estendida aos Recebimentos em 23/10/2026). So o operador fica preso aos
    # sellers dele.
    if role in ("manager", "admin"):
        return None
    return seller_ids


def _unit_pin(q, u: models.User):
    """Operador fica sempre preso a propria unidade (como em session_cards)."""
    if _role(u) == "operator" and u.unit_id:
        q = q.filter(models.Seller.unit_id == u.unit_id)
    return q


def _guard(db: Session, fn):
    try:
        out = fn()
        db.commit()
        return out
    except InboundError as e:
        db.rollback()
        raise HTTPException(e.status, e.message)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def _load(db: Session, appt_id: int, user: models.User, seller_ids) -> models.InboundAppointment:
    appt = (
        db.query(models.InboundAppointment)
        .options(
            selectinload(models.InboundAppointment.nfs).selectinload(models.InboundNf.files),
            joinedload(models.InboundAppointment.seller),
        )
        .filter(models.InboundAppointment.id == appt_id)
        .first()
    )
    scope = _scope(user, seller_ids)
    if appt is None or (scope is not None and appt.seller_id not in scope):
        raise HTTPException(404, "Agendamento não encontrado.")
    return appt


def _require_edit_role(user: models.User) -> None:
    if _role(user) not in ("client", "manager", "admin"):
        raise HTTPException(403, "Acesso negado.")


def _truthy(v) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "on", "sim", "yes")


def _int_or_none(v, label: str):
    if v is None or str(v).strip() == "":
        return None
    try:
        return int(str(v).strip())
    except ValueError:
        raise InboundError(f"{label.capitalize()} inválido.")


async def _read_form(request: Request):
    """Lê o multipart: devolve (campos, {indice: {pdf|xml|xlsx: (nome, bytes)}})."""
    form = await request.form()
    fields: Dict[str, str] = {}
    nfs: Dict[int, Dict[str, tuple]] = {}
    total = 0
    for key, val in form.multi_items():
        if isinstance(val, UploadFile):
            m = re.fullmatch(r"nf(\d+)_(pdf|xml|xlsx)", key)
            if not m:
                continue
            content = await val.read(flow.MAX_FILE_BYTES + 1)
            if len(content) > flow.MAX_FILE_BYTES:
                raise HTTPException(400, f"O arquivo '{val.filename}' passa de 10 MB.")
            total += len(content)
            if total > flow.MAX_TOTAL_BYTES:
                raise HTTPException(400, "Os arquivos passam de 30 MB no total.")
            nfs.setdefault(int(m.group(1)), {})[m.group(2)] = (val.filename or m.group(2), content)
        else:
            fields[key] = str(val)
    return fields, nfs


# ── Serialização ─────────────────────────────────────────────────────────────
def _warnings_bulk(db: Session, appts: List[models.InboundAppointment]) -> Dict[int, List[Dict]]:
    owner: Dict[int, int] = {}
    for a in appts:
        if a.status == flow.CANCELADO:
            continue
        for n in a.nfs:
            if n.active and n.order_id:
                owner[n.order_id] = a.id
    miss = orders_missing_product_skus(db, list(owner)) if owner else {}
    disc = orders_with_discontinued_skus(db, list(owner)) if owner else {}
    out: Dict[int, List[Dict]] = {}
    for a in appts:
        w: List[Dict] = []
        if a.status != flow.CANCELADO:
            if a.seller is not None and not a.seller.unit_id:
                w.append({"type": "seller_without_unit", "message": "Seller sem unidade.",
                          "link": "/sellers/corrigir"})
            ms = sorted({s for oid, v in miss.items() if owner.get(oid) == a.id for s in v})
            if ms:
                w.append({"type": "missing_product", "skus": ms,
                          "message": "SKU sem produto cadastrado: " + ", ".join(ms[:10]),
                          "link": "/products"})
            ds = sorted({s for oid, v in disc.items() if owner.get(oid) == a.id for s in v})
            if ds:
                w.append({"type": "discontinued_sku", "skus": ds,
                          "message": "SKU descontinuado: " + ", ".join(ds[:10]),
                          "link": "/sellers"})
        out[a.id] = w
    return out


def _items_bulk(db: Session, appts: List[models.InboundAppointment]) -> Dict[int, List[Dict]]:
    """
    Produtos de cada NF dos agendamentos (23/10/2026), para a tela interna de
    Recebimentos: o time se organiza antes da carga chegar. {order_id: [item]}.
    UMA consulta de itens + as duas consultas agrupadas de status (sem cadastro /
    descontinuado) para a lista inteira — nunca uma por card.
    """
    order_ids = [n.order_id for a in appts for n in a.nfs if n.active and n.order_id]
    if not order_ids:
        return {}
    rows = (
        db.query(models.OrderItem.order_id, models.OrderItem.sku,
                 models.OrderItem.product_name, models.OrderItem.quantity)
        .filter(models.OrderItem.order_id.in_(order_ids))
        .order_by(models.OrderItem.order_id, models.OrderItem.sku)
        .all()
    )
    miss = orders_missing_product_skus(db, order_ids)
    disc = orders_with_discontinued_skus(db, order_ids)
    out: Dict[int, List[Dict]] = {}
    for oid, sku, name, qty in rows:
        status = "sem_cadastro" if sku in miss.get(oid, ()) else (
            "descontinuado" if sku in disc.get(oid, ()) else "ok")
        out.setdefault(oid, []).append(
            {"sku": sku, "name": name, "quantity": int(qty or 0), "status": status})
    return out


def _nf_items(items_map, order_id) -> Dict:
    items = (items_map or {}).get(order_id, [])
    return {"items": items, "items_skus": len(items),
            "items_units": sum(i["quantity"] for i in items)}


def _to_dict(db: Session, a: models.InboundAppointment, role: str, warnings=None, detail=False,
             items_map=None) -> Dict:
    active_nfs = [n for n in a.nfs if n.active]
    base = {
        "id": a.id,
        "seller_id": a.seller_id,
        "seller_name": (a.seller.trade_name or a.seller.name) if a.seller else None,
        "unit_id": a.seller.unit_id if a.seller else a.unit_id,
        "scheduled_date": a.scheduled_date.isoformat(),
        "period": a.period,
        "status": a.status,
        "overdue": flow.is_overdue(a),
        "nf_count": len(active_nfs),
    }
    if detail and a.status == flow.CONFERIDO:
        base["stock_summary"] = flow.stock_summary(db, a)
        base["has_divergence"] = any(r["divergent"] for r in base["stock_summary"])
    if role == "operator":
        # Tela simples, mas com os produtos de cada NF para se organizar antes da
        # carga chegar (sem anexos, chave nem observação).
        if items_map is not None:
            base["nfs"] = [{"id": n.id, "nf_number": n.nf_number, **_nf_items(items_map, n.order_id)}
                           for n in active_nfs]
        return base
    base.update({
        "volumes": a.volumes,
        "volumes_unknown": bool(a.volumes_unknown),
        "pallets": a.pallets,
        "pallets_unknown": bool(a.pallets_unknown),
        "notes": a.notes,
        "cancel_reason": a.cancel_reason,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "received_at": a.received_at.isoformat() if a.received_at else None,
        "conferred_at": a.conferred_at.isoformat() if a.conferred_at else None,
        "can_edit": a.status == flow.AGENDADO,
        "nfs": [
            {
                "id": n.id,
                "nf_number": n.nf_number,
                "danfe_key": n.danfe_key,
                "files": [{"id": f.id, "kind": f.kind, "filename": f.filename, "size": f.size}
                          for f in n.files],
                **(_nf_items(items_map, n.order_id) if items_map is not None else {}),
            }
            for n in active_nfs
        ],
    })
    if role != "client":
        base["warnings"] = warnings if warnings is not None else []
    return base


# ── Listagem / resumo ────────────────────────────────────────────────────────
@router.get("/summary")
def summary(
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """Números para o selo do menu: agendamentos da semana atual e atrasados."""
    scope = _scope(current_user, seller_ids)
    today = today_brasilia()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    q = db.query(models.InboundAppointment).join(
        models.Seller, models.Seller.id == models.InboundAppointment.seller_id
    ).filter(models.InboundAppointment.status == flow.AGENDADO)
    if _role(current_user) != "client":
        q = q.filter(models.Seller.active == True)
        q = _unit_pin(q, current_user)
    if scope is not None:
        q = q.filter(models.InboundAppointment.seller_id.in_(scope or [-1]))
    week = q.filter(
        models.InboundAppointment.scheduled_date >= monday,
        models.InboundAppointment.scheduled_date <= sunday,
    ).count()
    overdue = q.filter(models.InboundAppointment.scheduled_date < today).count()
    # Selo do menu: Agendados ate o fim da semana atual (inclui os atrasados, sem contar 2x).
    badge = q.filter(models.InboundAppointment.scheduled_date <= sunday).count()
    return {"week_scheduled": week, "overdue": overdue, "badge": badge}


@router.get("")
def list_appointments(
    status: Optional[str] = None,
    seller_id: Optional[int] = None,
    unit_id: Optional[int] = None,
    no_unit: bool = False,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    limit: int = 200,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    role = _role(current_user)
    scope = _scope(current_user, seller_ids)
    if status and status not in flow.STATUSES:
        raise HTTPException(400, "Status inválido.")
    q = (
        db.query(models.InboundAppointment)
        .join(models.Seller, models.Seller.id == models.InboundAppointment.seller_id)
        .options(
            selectinload(models.InboundAppointment.nfs).selectinload(models.InboundNf.files),
            joinedload(models.InboundAppointment.seller),
        )
    )
    if role != "client":
        q = q.filter(models.Seller.active == True)
        q = _unit_pin(q, current_user)
    if scope is not None:
        q = q.filter(models.InboundAppointment.seller_id.in_(scope or [-1]))
    if status:
        q = q.filter(models.InboundAppointment.status == status)
    if seller_id:
        q = q.filter(models.InboundAppointment.seller_id == seller_id)
    if no_unit:
        q = q.filter(models.Seller.unit_id.is_(None))
    elif unit_id:
        q = q.filter(models.Seller.unit_id == unit_id)
    if date_from:
        q = q.filter(models.InboundAppointment.scheduled_date >= date_from)
    if date_to:
        q = q.filter(models.InboundAppointment.scheduled_date <= date_to)
    q = q.order_by(
        models.InboundAppointment.scheduled_date, models.InboundAppointment.period,
        models.InboundAppointment.id,
    ).limit(max(1, min(limit, 500)))
    appts = q.all()
    warns = _warnings_bulk(db, appts) if role in ("manager", "admin") else {}
    items = _items_bulk(db, appts) if role != "client" else None
    return [_to_dict(db, a, role, warns.get(a.id), items_map=items) for a in appts]


@router.get("/files/{file_id}")
def download_file(
    file_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    if _role(current_user) == "operator":
        raise HTTPException(403, "Acesso negado.")
    f = db.query(models.InboundFile).filter(models.InboundFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "Arquivo não encontrado.")
    nf = db.query(models.InboundNf).filter(models.InboundNf.id == f.nf_id).first()
    appt = _load(db, nf.appointment_id, current_user, seller_ids)  # 404 fora do escopo
    if not nf.active:
        raise HTTPException(404, "Arquivo não encontrado.")
    safe = re.sub(r'[^\w.\- ]', "_", f.filename)
    return Response(
        content=bytes(f.content),
        media_type=f.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


@router.get("/{appt_id}")
def get_appointment(
    appt_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    appt = _load(db, appt_id, current_user, seller_ids)
    role = _role(current_user)
    warns = _warnings_bulk(db, [appt]) if role in ("manager", "admin") else {}
    items = _items_bulk(db, [appt]) if role != "client" else None
    return _to_dict(db, appt, role, warns.get(appt.id), detail=True, items_map=items)


# ── Criação / edição (seller) ────────────────────────────────────────────────
def _create_sync(db, user, fields, nfs):
    if _role(user) != "client":
        raise InboundError("Só o seller cria agendamentos.", 403)
    if not user.seller_id:
        raise InboundError("Usuário sem seller vinculado.")
    seller = db.query(models.Seller).filter(
        models.Seller.id == user.seller_id, models.Seller.active == True).first()
    if not seller:
        raise InboundError("Seller inativo ou inexistente.", 404)

    try:
        sdate = date_type.fromisoformat((fields.get("scheduled_date") or "").strip())
    except ValueError:
        raise InboundError("Informe a data do agendamento.")
    period = (fields.get("period") or "").strip().upper()
    flow.validate_schedule(sdate, period)
    volumes, v_unk = flow.validate_count(
        "os volumes", _int_or_none(fields.get("volumes"), "volumes"), _truthy(fields.get("volumes_unknown")))
    pallets, p_unk = flow.validate_count(
        "os paletes", _int_or_none(fields.get("pallets"), "paletes"), _truthy(fields.get("pallets_unknown")))
    notes = flow.clean_notes(fields.get("notes"))

    if not nfs:
        raise InboundError("Adicione pelo menos uma NF.")
    if len(nfs) > flow.MAX_NFS:
        raise InboundError(f"No máximo {flow.MAX_NFS} NFs por agendamento.")

    expiry = _parse_expiry_json(fields.get("expiry_json"), set(nfs))

    appt = models.InboundAppointment(
        seller_id=seller.id, unit_id=seller.unit_id, scheduled_date=sdate, period=period,
        status=flow.AGENDADO, volumes=volumes, volumes_unknown=v_unk, pallets=pallets,
        pallets_unknown=p_unk, notes=notes, created_by_id=user.id,
    )
    db.add(appt)
    db.flush()
    n_exp = 0
    for idx in sorted(nfs):
        nf = flow.add_nf(db, appt, seller, nfs[idx], user.id)
        rows = expiry.get(idx)
        if rows:
            _attach_expiry(db, user, seller, nf, rows)
            n_exp += len(rows)
    flow.audit(db, user.id, appt.id, "CREATE",
               f"Agendamento criado para {sdate.isoformat()} ({period}) com {len(nfs)} NF(s)"
               + (f" e {n_exp} linha(s) de vencimento." if n_exp else "."))
    db.flush()
    return appt.id


def _parse_expiry_json(raw, valid_idx) -> Dict[int, List[Dict]]:
    """expiry_json = {"<índice da NF>": [{sku, expiry_date_text, quantity}, ...]}. Opcional."""
    if raw is None or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        raise InboundError("Vencimentos em formato inválido. Atualize a tela (F5) e tente de novo.")
    if not isinstance(data, dict):
        raise InboundError("Vencimentos em formato inválido. Atualize a tela (F5) e tente de novo.")
    out: Dict[int, List[Dict]] = {}
    for k, rows in data.items():
        try:
            idx = int(k)
        except (ValueError, TypeError):
            raise InboundError("Vencimentos em formato inválido. Atualize a tela (F5) e tente de novo.")
        if idx not in valid_idx:
            raise InboundError("Vencimento apontando para uma NF que não foi enviada.")
        if not isinstance(rows, list):
            raise InboundError("Vencimentos em formato inválido. Atualize a tela (F5) e tente de novo.")
        clean = []
        for r in rows:
            if not isinstance(r, dict):
                raise InboundError("Vencimentos em formato inválido. Atualize a tela (F5) e tente de novo.")
            clean.append({
                "sku": str(r.get("sku") or ""),
                "expiry_date_text": str(r.get("expiry_date_text") or ""),
                "quantity": r.get("quantity"),
                "lot_name": (None if r.get("lot_name") is None else str(r.get("lot_name"))),
            })
        if clean:
            out[idx] = clean
    return out


def _attach_expiry(db, user, seller, nf, rows) -> None:
    """Grava os vencimentos 'a chegar' da NF recém-criada, na MESMA transação do agendamento.
    Qualquer erro desfaz o agendamento inteiro (o _guard faz o rollback)."""
    from ..services import expiry_hooks
    xml_items = [
        {"sku": it.sku, "quantity": int(it.quantity or 0)}
        for it in db.query(models.OrderItem).filter(models.OrderItem.order_id == nf.order_id).all()
    ]
    try:
        expiry_hooks.attach_from_schedule(
            db, seller_id=seller.id, nf=nf, xml_items=xml_items,
            items_payload=rows, user_id=user.id,
        )
    except expiry_hooks.ExpiryAttachError as exc:
        raise InboundError(f"NF {nf.nf_number}: {exc}", 422)


# ── Revisão prévia (não grava nada) ──────────────────────────────────────────
def _analyze_sync(db, user, nfs):
    if _role(user) != "client":
        raise InboundError("Só o seller cria agendamentos.", 403)
    if not user.seller_id:
        raise InboundError("Usuário sem seller vinculado.")
    seller = db.query(models.Seller).filter(
        models.Seller.id == user.seller_id, models.Seller.active == True).first()
    if not seller:
        raise InboundError("Seller inativo ou inexistente.", 404)
    if not nfs:
        raise InboundError("Adicione pelo menos uma NF.")
    if len(nfs) > flow.MAX_NFS:
        raise InboundError(f"No máximo {flow.MAX_NFS} NFs por agendamento.")

    pmap = flow._product_map(db, seller.id)
    disc = {r[0] for r in db.query(models.DiscontinuedSku.sku).filter(
        models.DiscontinuedSku.seller_id == seller.id).all()}

    out = []
    seen_keys: Dict[str, str] = {}
    for idx in sorted(nfs):
        entry = {"index": idx, "filename": None, "nf_number": None, "danfe_key": None,
                 "issuer": None, "error": None, "items": []}
        out.append(entry)
        xml = nfs[idx].get("xml")
        if xml is None:
            entry["error"] = "Envie o XML desta NF."
            continue
        entry["filename"] = xml[0]
        try:
            files = flow.read_files({"xml": xml})
            parsed = parse_nfe_xml(files["XML"][1])
            flow._check_duplicate(db, seller, parsed["danfe_key"], parsed["nf_number"])
        except InboundXmlError as e:
            entry["error"] = f"XML '{xml[0]}': {e}"
            continue
        except InboundError as e:
            entry["error"] = e.message
            continue
        entry["nf_number"] = parsed["nf_number"]
        entry["danfe_key"] = parsed["danfe_key"]
        entry["issuer"] = parsed["issuer"]
        if parsed["danfe_key"] in seen_keys:
            entry["error"] = (f"Esta NF repete a chave de acesso do arquivo "
                              f"'{seen_keys[parsed['danfe_key']]}'.")
            continue
        seen_keys[parsed["danfe_key"]] = xml[0]

        for it in parsed["items"]:
            found = pmap.get(it["sku"].lower())
            sku = found[1] if found else it["sku"]
            if not found:
                status = "sem_produto"
            elif sku in disc:
                status = "descontinuado"
            else:
                status = "ok"
            tracks = [t for t in (it.get("tracks") or []) if t.get("d_val")]
            pre = []
            for t in tracks:
                q = t.get("q_lote") or (it["quantity"] if len(tracks) == 1 else None)
                lote_xml = " ".join(str(t.get("lote") or "").split())[:60] or None
                pre.append({"expiry_date_text": t["d_val"].strftime("%d/%m/%Y"), "quantity": q,
                            "lot_name": lote_xml})
            entry["items"].append({
                "sku": sku, "name": it["name"], "quantity": it["quantity"],
                "status": status, "prefill": pre,
            })
    return {"nfs": out}


@router.post("/analyze")
async def analyze_nfs(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lê os XMLs e devolve SKUs/quantidades para o seller conferir ANTES de agendar. Não grava."""
    if _role(current_user) != "client":
        raise HTTPException(403, "Só o seller cria agendamentos.")
    _, nfs = await _read_form(request)

    def run():
        try:
            return _analyze_sync(db, current_user, nfs)
        except InboundError as e:
            raise HTTPException(e.status, e.message)
        finally:
            db.rollback()

    return await run_in_threadpool(run)


@router.post("", status_code=201)
async def create_appointment(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _role(current_user) != "client":
        raise HTTPException(403, "Só o seller cria agendamentos.")
    fields, nfs = await _read_form(request)
    new_id = await run_in_threadpool(lambda: _guard(db, lambda: _create_sync(db, current_user, fields, nfs)))
    appt = _load(db, new_id, current_user, None)
    return _to_dict(db, appt, "client", detail=True)


def _update_sync(db, user, appt, body: InboundUpdateIn):
    flow.require_status(appt, flow.AGENDADO)
    sent = body.model_fields_set
    before = f"{appt.scheduled_date.isoformat()} {appt.period}"
    new_date = body.scheduled_date if "scheduled_date" in sent and body.scheduled_date else appt.scheduled_date
    new_period = (body.period or "").strip().upper() if "period" in sent else appt.period
    changed_when = (new_date != appt.scheduled_date) or (new_period != appt.period)
    if changed_when:
        flow.validate_schedule(new_date, new_period)
        appt.scheduled_date, appt.period = new_date, new_period
    if "volumes" in sent or "volumes_unknown" in sent:
        appt.volumes, appt.volumes_unknown = flow.validate_count(
            "os volumes", body.volumes if "volumes" in sent else appt.volumes,
            body.volumes_unknown if "volumes_unknown" in sent else False)
    if "pallets" in sent or "pallets_unknown" in sent:
        appt.pallets, appt.pallets_unknown = flow.validate_count(
            "os paletes", body.pallets if "pallets" in sent else appt.pallets,
            body.pallets_unknown if "pallets_unknown" in sent else False)
    if "notes" in sent:
        appt.notes = flow.clean_notes(body.notes)
    if changed_when:
        flow.audit(db, user.id, appt.id, "RESCHEDULE",
                   f"Reagendado de {before} para {appt.scheduled_date.isoformat()} {appt.period}.")
    else:
        flow.audit(db, user.id, appt.id, "UPDATE", "Dados do agendamento editados.")


@router.put("/{appt_id}")
def update_appointment(
    appt_id: int,
    body: InboundUpdateIn,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    _require_edit_role(current_user)
    appt = _load(db, appt_id, current_user, seller_ids)
    _guard(db, lambda: _update_sync(db, current_user, appt, body))
    appt = _load(db, appt_id, current_user, seller_ids)
    return _to_dict(db, appt, _role(current_user))


def _add_nf_sync(db, user, appt, nfs):
    flow.require_status(appt, flow.AGENDADO)
    if len(nfs) != 1:
        raise InboundError("Envie uma NF por vez (campos nf0_pdf, nf0_xml, nf0_xlsx).")
    if len([n for n in appt.nfs if n.active]) >= flow.MAX_NFS:
        raise InboundError(f"No máximo {flow.MAX_NFS} NFs por agendamento.")
    seller = db.query(models.Seller).filter(models.Seller.id == appt.seller_id).first()
    flow.add_nf(db, appt, seller, next(iter(nfs.values())), user.id)
    db.flush()
    _check_total(db, appt)


def _check_total(db, appt):
    from sqlalchemy import func
    total = db.query(func.coalesce(func.sum(models.InboundFile.size), 0)).join(
        models.InboundNf, models.InboundNf.id == models.InboundFile.nf_id
    ).filter(models.InboundNf.appointment_id == appt.id, models.InboundNf.active == True).scalar() or 0
    if total > flow.MAX_TOTAL_BYTES:
        raise InboundError("Os arquivos do agendamento passam de 30 MB no total.")


@router.post("/{appt_id}/nfs", status_code=201)
async def add_nf(
    appt_id: int,
    request: Request,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    _require_edit_role(current_user)
    appt = await run_in_threadpool(lambda: _load(db, appt_id, current_user, seller_ids))
    _, nfs = await _read_form(request)
    await run_in_threadpool(lambda: _guard(db, lambda: _add_nf_sync(db, current_user, appt, nfs)))
    appt = await run_in_threadpool(lambda: _load(db, appt_id, current_user, seller_ids))
    return _to_dict(db, appt, _role(current_user))


def _replace_sync(db, user, appt, nf_id, files):
    flow.require_status(appt, flow.AGENDADO)
    nf = next((n for n in appt.nfs if n.id == nf_id and n.active), None)
    if nf is None:
        raise InboundError("NF não encontrada neste agendamento.", 404)
    seller = db.query(models.Seller).filter(models.Seller.id == appt.seller_id).first()
    flow.replace_files(db, appt, seller, nf, files, user.id)


@router.put("/{appt_id}/nfs/{nf_id}/files")
async def replace_nf_files(
    appt_id: int,
    nf_id: int,
    request: Request,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    _require_edit_role(current_user)
    appt = await run_in_threadpool(lambda: _load(db, appt_id, current_user, seller_ids))
    _, nfs = await _read_form(request)
    files = nfs.get(0) or {}
    await run_in_threadpool(lambda: _guard(db, lambda: _replace_sync(db, current_user, appt, nf_id, files)))
    appt = await run_in_threadpool(lambda: _load(db, appt_id, current_user, seller_ids))
    return _to_dict(db, appt, _role(current_user))


@router.delete("/{appt_id}/nfs/{nf_id}")
def remove_nf(
    appt_id: int,
    nf_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    _require_edit_role(current_user)
    appt = _load(db, appt_id, current_user, seller_ids)

    def run():
        flow.require_status(appt, flow.AGENDADO)
        nf = next((n for n in appt.nfs if n.id == nf_id), None)
        if nf is None:
            raise InboundError("NF não encontrada neste agendamento.", 404)
        flow.remove_nf(db, appt, nf, current_user.id)

    _guard(db, run)
    appt = _load(db, appt_id, current_user, seller_ids)
    return _to_dict(db, appt, _role(current_user))


# ── Ações de status ──────────────────────────────────────────────────────────
@router.post("/{appt_id}/cancel")
def cancel_appointment(
    appt_id: int,
    body: InboundCancelIn,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    _require_edit_role(current_user)
    appt = _load(db, appt_id, current_user, seller_ids)
    _guard(db, lambda: flow.cancel(db, appt, current_user.id, body.reason))
    appt = _load(db, appt_id, current_user, seller_ids)
    return _to_dict(db, appt, _role(current_user))


@router.post("/{appt_id}/receive")
def receive_appointment(
    appt_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    if _role(current_user) not in ("manager", "admin"):
        raise HTTPException(403, "Acesso negado. Nível mínimo necessário: manager")
    appt = _load(db, appt_id, current_user, seller_ids)
    _guard(db, lambda: flow.receive(db, appt, current_user.id))
    appt = _load(db, appt_id, current_user, seller_ids)
    return _to_dict(db, appt, _role(current_user), _warnings_bulk(db, [appt]).get(appt.id),
                    items_map=_items_bulk(db, [appt]))


# ─── Controle de Vencimentos (03/11/2026) ───────────────────────────────────
# O cadastro de vencimento vive AO LADO do agendamento (não dentro do multipart
# do upload da NF — simplifica tela e teste). Vale enquanto o agendamento ainda
# é editável pelo seller (AGENDADO). Depois disso, só leitura.

class _ExpiryItemIn(BaseModel):
    sku: str
    expiry_date_text: str
    quantity: int
    lot_name: Optional[str] = None


class _ExpiryItemsPayload(BaseModel):
    items: List[_ExpiryItemIn] = []


def _get_nf_or_404(db: Session, appt_id: int, nf_id: int) -> models.InboundNf:
    nf = db.query(models.InboundNf).filter(
        models.InboundNf.id == nf_id,
        models.InboundNf.appointment_id == appt_id,
        models.InboundNf.active == True,  # noqa: E712
    ).first()
    if nf is None:
        raise HTTPException(404, "NF não encontrada neste agendamento.")
    return nf


@router.get("/{appt_id}/nfs/{nf_id}/xml-rastro")
def get_xml_rastro(
    appt_id: int,
    nf_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """Pré-preenche o form de vencimentos lendo <rastro>/dVal do próprio XML.

    Devolve `[{sku, d_val, lote, q_lote}]`. Mesmo payload que o parser já
    extrai; na tela, 1 trincou por SKU vira a 1ª linha pré-preenchida.
    """
    _load(db, appt_id, current_user, seller_ids)   # escopo
    nf = _get_nf_or_404(db, appt_id, nf_id)
    xml = db.query(models.InboundFile).filter(
        models.InboundFile.nf_id == nf.id, models.InboundFile.kind == "XML",
    ).first()
    if not xml:
        return []
    from ..services.inbound_xml import parse_nfe_xml, InboundXmlError
    try:
        parsed = parse_nfe_xml(bytes(xml.content))
    except InboundXmlError:
        return []
    out: list[dict] = []
    for it in parsed.get("items", []):
        for tr in (it.get("tracks") or []):
            if tr.get("d_val"):
                out.append({
                    "sku": it["sku"],
                    "d_val": tr["d_val"],
                    "lote": tr.get("lote"),
                    "q_lote": tr.get("q_lote"),
                })
    return out


@router.get("/{appt_id}/nfs/{nf_id}/expiry-items")
def list_expiry_items(
    appt_id: int,
    nf_id: int,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """Linhas de vencimento (`a_chegar` + `ativo`) já cadastradas para esta NF."""
    _load(db, appt_id, current_user, seller_ids)
    nf = _get_nf_or_404(db, appt_id, nf_id)
    rows = db.query(models.ExpiryLine).filter(
        models.ExpiryLine.origin_inbound_nf_id == nf.id,
        models.ExpiryLine.active == True,  # noqa: E712
    ).order_by(
        models.ExpiryLine.sku.asc(),
        models.ExpiryLine.expiry_date.asc(),
        models.ExpiryLine.id.asc(),
    ).all()
    return [
        {
            "id": r.id,
            "sku": r.sku,
            "expiry_date": r.expiry_date,
            "quantity": int(r.qty_atual),
            "lot_name": r.lot_name,
            "state": r.state,
        }
        for r in rows
    ]


@router.put("/{appt_id}/nfs/{nf_id}/expiry-items")
def put_expiry_items(
    appt_id: int,
    nf_id: int,
    body: _ExpiryItemsPayload,
    current_user: models.User = Depends(get_current_user),
    seller_ids: Optional[List[int]] = Depends(get_user_seller_ids),
    db: Session = Depends(get_db),
):
    """Substitui em bloco o cadastro de vencimentos "a chegar" dessa NF.

    Reaproveita a validação de `expiry_hooks.attach_from_schedule`
    (parse, soma ≤ XML, produto ativo, não descontinuado). Permitido apenas
    com appointment em AGENDADO — depois disso a NF já pode estar em
    conferência, e trocar vencimento aqui iria contra o que o operador vê.
    Só o CLIENT dono do agendamento grava.
    """
    if _role(current_user) != "client":
        raise HTTPException(403, "Só o seller cadastra vencimentos do agendamento.")
    appt = _load(db, appt_id, current_user, seller_ids)
    if appt.status != flow.AGENDADO:
        raise HTTPException(409, "O agendamento não está mais em edição.")
    nf = _get_nf_or_404(db, appt_id, nf_id)

    # Lê os itens do XML já parseado
    order = db.query(models.Order).filter(models.Order.id == nf.order_id).first()
    if not order:
        raise HTTPException(409, "NF sem Order associado — recarregue o agendamento.")
    xml_items = [
        {"sku": it.sku, "quantity": int(it.quantity or 0)}
        for it in db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).all()
    ]

    from ..services import expiry_hooks
    try:
        _guard(db, lambda: expiry_hooks.attach_from_schedule(
            db,
            seller_id=order.seller_id,
            nf=nf,
            xml_items=xml_items,
            items_payload=[i.model_dump() for i in body.items],
            user_id=current_user.id,
        ))
    except expiry_hooks.ExpiryAttachError as exc:
        raise HTTPException(422, str(exc))
    return list_expiry_items(appt_id, nf_id, current_user, seller_ids, db)
