"""
Agendamento de Inbound (23/10/2026) — regras e transições.

Status (texto validado aqui, sem enum nativo no Postgres):
    AGENDADO -> RECEBIDO -> EM_CONFERENCIA -> CONFERIDO      (AGENDADO -> CANCELADO)

Decisões (dono do sistema):
  * O XML cria o Order de entrada NA HORA do agendamento, mas SEM sessão
    (`session_id` nulo) e SEM tocar em estoque. Enquanto não há sessão, a NF não
    aparece em Manuseios/Scanner (tudo isso é por sessão).
  * Ao virar RECEBIDO cria-se UMA PickingSession de entrada por agendamento e as
    NFs entram nela — só então viram card de manuseio.
  * O estoque entra exclusivamente no `finalize-entry` (contagem física). Este
    módulo nunca lança movimento de estoque.
  * Sem desfazer RECEBIDO.
"""

from datetime import date, timedelta
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..timezone_utils import now_brasilia, today_brasilia
from .inbound_xml import parse_nfe_xml, InboundXmlError
from .stock_manager import orders_missing_product_skus, orders_with_discontinued_skus

AGENDADO = "AGENDADO"
RECEBIDO = "RECEBIDO"
EM_CONFERENCIA = "EM_CONFERENCIA"
CONFERIDO = "CONFERIDO"
CANCELADO = "CANCELADO"
STATUSES = (AGENDADO, RECEBIDO, EM_CONFERENCIA, CONFERIDO, CANCELADO)
PERIODS = ("MANHA", "TARDE")

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 30 * 1024 * 1024
MAX_NFS = 20
MAX_DAYS_AHEAD = 60
MAX_COUNT = 99999
MAX_NOTES = 1000
MAX_CANCEL_REASON = 200

FILE_KINDS = {"pdf": "PDF", "xml": "XML", "xlsx": "XLSX"}
_CONTENT_TYPES = {
    "PDF": "application/pdf",
    "XML": "application/xml",
    "XLSX": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class InboundError(Exception):
    """Erro de regra. `status` é o HTTP a devolver (400/403/404/409)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ── Auditoria ────────────────────────────────────────────────────────────────
def audit(db: Session, user_id: Optional[int], appt_id: Optional[int], action: str, detail: str) -> None:
    db.add(models.AuditLog(
        entity_type="InboundAppointment",
        entity_id=appt_id,
        action=action,
        detail=detail,
        user_id=user_id,
    ))


# ── Validações ───────────────────────────────────────────────────────────────
def validate_schedule(scheduled_date, period) -> None:
    if not isinstance(scheduled_date, date):
        raise InboundError("Informe a data do agendamento.")
    if period not in PERIODS:
        raise InboundError("Período inválido: use Manhã ou Tarde.")
    if scheduled_date.weekday() >= 5:
        raise InboundError("A data precisa ser um dia útil (segunda a sexta).")
    today = today_brasilia()
    if scheduled_date < today:
        raise InboundError("A data não pode estar no passado.")
    if scheduled_date > today + timedelta(days=MAX_DAYS_AHEAD):
        raise InboundError(f"A data pode ser no máximo {MAX_DAYS_AHEAD} dias à frente.")


def validate_count(label: str, value, unknown) -> tuple:
    """Volumes/paletes: um inteiro 0..MAX ou 'Não sei'. Devolve (valor, unknown)."""
    if unknown:
        return None, True
    if value is None or isinstance(value, bool) or not isinstance(value, int):
        raise InboundError(f"Informe {label} ou marque 'Não sei'.")
    if value < 0 or value > MAX_COUNT:
        raise InboundError(f"{label.capitalize()} inválido: use de 0 a {MAX_COUNT}.")
    return value, False


def clean_notes(notes) -> Optional[str]:
    if notes is None:
        return None
    notes = str(notes).strip()
    if len(notes) > MAX_NOTES:
        raise InboundError(f"A observação pode ter no máximo {MAX_NOTES} caracteres.")
    return notes or None


def _check_file(kind: str, filename: str, content: bytes) -> None:
    if not content:
        raise InboundError(f"O arquivo {kind} '{filename}' está vazio.")
    if len(content) > MAX_FILE_BYTES:
        raise InboundError(f"O arquivo {kind} '{filename}' passa de 10 MB.")
    if kind == "PDF" and not content.lstrip()[:5] == b"%PDF-":
        raise InboundError(f"O arquivo '{filename}' não parece ser um PDF.")
    if kind == "XLSX" and not content[:2] == b"PK":
        raise InboundError(f"O arquivo '{filename}' não parece ser um Excel (.xlsx).")


def _check_duplicate(db: Session, seller: models.Seller, key: str, nf_number: str,
                     exclude_nf_id: Optional[int] = None) -> None:
    q = (
        db.query(models.InboundNf.appointment_id)
        .join(models.InboundAppointment, models.InboundAppointment.id == models.InboundNf.appointment_id)
        .filter(
            models.InboundNf.danfe_key == key,
            models.InboundNf.active == True,
            models.InboundAppointment.status != CANCELADO,
        )
    )
    if exclude_nf_id:
        q = q.filter(models.InboundNf.id != exclude_nf_id)
    hit = q.first()
    if hit:
        raise InboundError(f"A NF {nf_number} já está no agendamento #{hit[0]} (mesma chave de acesso).")

    excl_order = None
    if exclude_nf_id:
        row = db.query(models.InboundNf.order_id).filter(models.InboundNf.id == exclude_nf_id).first()
        excl_order = row[0] if row else None

    oq = db.query(models.Order.id).filter(
        models.Order.danfe_key == key,
        models.Order.status != models.OrderStatus.CANCELLED,
    )
    if excl_order:
        oq = oq.filter(models.Order.id != excl_order)
    if oq.first():
        raise InboundError(f"A NF {nf_number} já existe no sistema (mesma chave de acesso).")

    oq2 = db.query(models.Order.id).filter(
        models.Order.nf_number == nf_number,
        models.Order.seller_id == seller.id,
        models.Order.file_type == models.FileType.IMPORT,
        models.Order.status != models.OrderStatus.CANCELLED,
    )
    if excl_order:
        oq2 = oq2.filter(models.Order.id != excl_order)
    if oq2.first():
        raise InboundError(f"Já existe uma NF de entrada número {nf_number} deste seller no sistema.")


# ── NF / Order ───────────────────────────────────────────────────────────────
def _product_map(db: Session, seller_id: int) -> Dict[str, tuple]:
    rows = db.query(models.Product.id, models.Product.sku).filter(
        models.Product.seller_id == seller_id, models.Product.active == True
    ).all()
    return {sku.lower(): (pid, sku) for pid, sku in rows}


def _fill_items(db: Session, order: models.Order, parsed: Dict) -> None:
    pmap = _product_map(db, order.seller_id)
    for it in parsed["items"]:
        found = pmap.get(it["sku"].lower())
        db.add(models.OrderItem(
            order_id=order.id,
            product_id=found[0] if found else None,
            sku=found[1] if found else it["sku"],   # SKU gravado = grafia do cadastro
            product_name=it["name"],
            quantity=it["quantity"],
        ))


def read_files(files: Dict[str, tuple]) -> Dict[str, tuple]:
    """Valida os anexos de uma NF. files: {'pdf': (nome, bytes), ...} -> {'PDF': (...)}."""
    out: Dict[str, tuple] = {}
    for k, v in files.items():
        if v is None:
            continue
        kind = FILE_KINDS[k]
        _check_file(kind, v[0], v[1])
        out[kind] = v
    return out


def add_nf(db: Session, appt: models.InboundAppointment, seller: models.Seller,
           files: Dict[str, tuple], user_id: Optional[int]) -> models.InboundNf:
    """Cria a NF (Order de entrada sem sessão + itens + anexos). Só o XML é obrigatório; PDF e Excel são opcionais."""
    files = read_files(files)
    if "XML" not in files:
        raise InboundError("Envie o XML de cada NF.")
    try:
        parsed = parse_nfe_xml(files["XML"][1])
    except InboundXmlError as e:
        raise InboundError(f"XML '{files['XML'][0]}': {e}")

    _check_duplicate(db, seller, parsed["danfe_key"], parsed["nf_number"])

    order = models.Order(
        nf_number=parsed["nf_number"],
        customer_name=(parsed["issuer"] or seller.trade_name or seller.name or "Inbound")[:300],
        order_date=parsed["issue_date"] or today_brasilia(),
        seller_id=seller.id,
        unit_id=seller.unit_id,
        nature="Agendamento de Inbound",
        danfe_key=parsed["danfe_key"],
        nf_key=f"{parsed['nf_number']}_{seller.trade_name or seller.name}"[:150],
        file_type=models.FileType.IMPORT,
        status=models.OrderStatus.PENDING,
        session_id=None,
        inbound_appointment_id=appt.id,
        imported_at=now_brasilia(),
    )
    db.add(order)
    db.flush()
    _fill_items(db, order, parsed)

    nf = models.InboundNf(
        appointment_id=appt.id,
        order_id=order.id,
        nf_number=parsed["nf_number"],
        danfe_key=parsed["danfe_key"],
        active=True,
    )
    db.add(nf)
    db.flush()
    for kind, (name, content) in files.items():
        db.add(models.InboundFile(
            nf_id=nf.id, kind=kind, filename=(name or kind)[:255],
            content_type=_CONTENT_TYPES[kind], size=len(content), content=content,
        ))
    audit(db, user_id, appt.id, "NF_ADDED", f"NF {nf.nf_number} (chave {nf.danfe_key}) adicionada.")
    return nf


def replace_files(db: Session, appt: models.InboundAppointment, seller: models.Seller,
                  nf: models.InboundNf, files: Dict[str, tuple], user_id: Optional[int]) -> None:
    """Troca/adiciona anexos. Trocar o XML recria os itens e revalida a chave."""
    files = read_files(files)
    if not files:
        raise InboundError("Nenhum arquivo enviado.")
    order = db.query(models.Order).filter(models.Order.id == nf.order_id).first()
    if "XML" in files:
        try:
            parsed = parse_nfe_xml(files["XML"][1])
        except InboundXmlError as e:
            raise InboundError(f"XML '{files['XML'][0]}': {e}")
        _check_duplicate(db, seller, parsed["danfe_key"], parsed["nf_number"], exclude_nf_id=nf.id)
        db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).delete()
        order.nf_number = parsed["nf_number"]
        order.danfe_key = parsed["danfe_key"]
        order.nf_key = f"{parsed['nf_number']}_{seller.trade_name or seller.name}"[:150]
        order.customer_name = (parsed["issuer"] or order.customer_name)[:300]
        if parsed["issue_date"]:
            order.order_date = parsed["issue_date"]
        db.flush()
        _fill_items(db, order, parsed)
        nf.nf_number = parsed["nf_number"]
        nf.danfe_key = parsed["danfe_key"]
    for kind, (name, content) in files.items():
        db.query(models.InboundFile).filter(
            models.InboundFile.nf_id == nf.id, models.InboundFile.kind == kind
        ).delete()
        db.add(models.InboundFile(
            nf_id=nf.id, kind=kind, filename=(name or kind)[:255],
            content_type=_CONTENT_TYPES[kind], size=len(content), content=content,
        ))
    # Limite do conjunto
    db.flush()
    total = db.query(func.coalesce(func.sum(models.InboundFile.size), 0)).join(
        models.InboundNf, models.InboundNf.id == models.InboundFile.nf_id
    ).filter(models.InboundNf.appointment_id == appt.id, models.InboundNf.active == True).scalar() or 0
    if total > MAX_TOTAL_BYTES:
        raise InboundError("Os arquivos do agendamento passam de 30 MB no total.")
    audit(db, user_id, appt.id, "NF_FILES_REPLACED",
          f"NF {nf.nf_number}: arquivos trocados ({', '.join(sorted(files))}).")


def remove_nf(db: Session, appt: models.InboundAppointment, nf: models.InboundNf,
              user_id: Optional[int]) -> None:
    active = [n for n in appt.nfs if n.active]
    if not nf.active:
        raise InboundError("Esta NF já foi removida.", 409)
    if len(active) <= 1:
        raise InboundError("O agendamento precisa ter pelo menos uma NF. Cancele o agendamento se for o caso.")
    nf.active = False
    _cancel_order(db, nf.order_id)
    # Controle de Vencimentos (03/11/2026): descarta linhas "a chegar" dessa NF.
    # Import local pra evitar ciclo (expiry_hooks importa models/calc, não flow).
    from . import expiry_hooks
    expiry_hooks.discard_a_chegar_from_nf(db, nf_id=nf.id, user_id=user_id)
    audit(db, user_id, appt.id, "NF_REMOVED", f"NF {nf.nf_number} removida do agendamento.")


def _cancel_order(db: Session, order_id: Optional[int]) -> None:
    if not order_id:
        return
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        return
    # Entrada só lança estoque no finalize-entry, que exige a NF numa sessão
    # (RECEBIDO+). Em AGENDADO nunca houve movimento -> não há o que estornar.
    # Defesa: se por qualquer motivo houver baixa, não cancela em silêncio.
    if order.stock_applied_at is not None:
        raise InboundError("Esta NF já lançou estoque e não pode ser cancelada por aqui.", 409)
    order.status = models.OrderStatus.CANCELLED


# ── Transições do agendamento ────────────────────────────────────────────────
def require_status(appt: models.InboundAppointment, *allowed: str) -> None:
    if appt.status not in allowed:
        raise InboundError(
            f"Esta ação só vale para agendamento {' / '.join(a.title() for a in allowed)}; "
            f"este está {appt.status.replace('_', ' ').title()}.",
            409,
        )


def cancel(db: Session, appt: models.InboundAppointment, user_id: Optional[int], reason: Optional[str]) -> None:
    require_status(appt, AGENDADO)
    reason = (reason or "").strip() or None
    if reason and len(reason) > MAX_CANCEL_REASON:
        raise InboundError(f"O motivo pode ter no máximo {MAX_CANCEL_REASON} caracteres.")
    from . import expiry_hooks
    for nf in appt.nfs:
        if nf.active:
            _cancel_order(db, nf.order_id)
            expiry_hooks.discard_a_chegar_from_nf(db, nf_id=nf.id, user_id=user_id)
    appt.status = CANCELADO
    appt.cancelled_at = now_brasilia()
    appt.cancel_reason = reason
    audit(db, user_id, appt.id, "CANCEL",
          f"Agendamento cancelado.{' Motivo: ' + reason if reason else ''}")


def receive(db: Session, appt: models.InboundAppointment, user_id: int) -> models.PickingSession:
    """AGENDADO -> RECEBIDO. Cria a sessão de entrada e solta as NFs para o manuseio."""
    require_status(appt, AGENDADO)
    seller = db.query(models.Seller).filter(models.Seller.id == appt.seller_id).first()
    if not seller or not seller.active:
        raise InboundError("Seller inativo ou inexistente.", 409)
    if not seller.unit_id:
        raise InboundError(
            "O seller está sem unidade. Associe uma unidade em Sellers > Corrigir antes de marcar como recebido.",
            409,
        )
    nfs = [n for n in appt.nfs if n.active]
    if not nfs:
        raise InboundError("O agendamento não tem NFs.", 409)

    now = now_brasilia()
    session = models.PickingSession(
        session_date=today_brasilia(),
        unit_id=seller.unit_id,
        seller_id=seller.id,
        status=models.OrderStatus.PENDING,
        total_orders=len(nfs),
        completed_orders=0,
        created_by_id=user_id,
        file_type=models.FileType.IMPORT,
        for_billing=True,
        source_file=f"Agendamento de Inbound #{appt.id}",
    )
    db.add(session)
    db.flush()
    for nf in nfs:
        order = db.query(models.Order).filter(models.Order.id == nf.order_id).first()
        order.session_id = session.id
        order.unit_id = seller.unit_id
    appt.session_id = session.id
    appt.unit_id = seller.unit_id
    appt.status = RECEBIDO
    appt.received_at = now
    appt.received_by_id = user_id
    audit(db, user_id, appt.id, "STATUS", f"Agendado -> Recebido. Sessão de entrada #{session.id} criada.")
    return session


def _appt_of(db: Session, order: models.Order) -> Optional[models.InboundAppointment]:
    if not getattr(order, "inbound_appointment_id", None):
        return None
    return db.query(models.InboundAppointment).filter(
        models.InboundAppointment.id == order.inbound_appointment_id
    ).first()


def on_scan_started(db: Session, order: models.Order, user_id: Optional[int]) -> bool:
    """Gatilho: a bipagem de uma NF do agendamento começou. Não faz commit."""
    appt = _appt_of(db, order)
    if appt is None or appt.status != RECEBIDO:
        return False
    appt.status = EM_CONFERENCIA
    audit(db, user_id, appt.id, "STATUS",
          f"Recebido -> Em conferência (início da bipagem da NF {order.nf_number}).")
    return True


def on_order_finalized(db: Session, order: models.Order, user_id: Optional[int]) -> bool:
    """
    Gatilho: finalize-entry confirmado. Conferido quando TODAS as NFs ativas do
    agendamento estiverem concluídas. Não faz commit. `order.status` já está
    COMPLETED em memória (a sessão é autoflush=False), por isso a conta é em Python.
    """
    appt = _appt_of(db, order)
    if appt is None or appt.status not in (RECEBIDO, EM_CONFERENCIA):
        return False
    ids = [n.order_id for n in appt.nfs if n.active and n.order_id]
    orders = db.query(models.Order).filter(models.Order.id.in_(ids)).all()
    live = [o for o in orders if o.status != models.OrderStatus.CANCELLED]
    if live and all(o.status == models.OrderStatus.COMPLETED for o in live):
        appt.status = CONFERIDO
        appt.conferred_at = now_brasilia()
        audit(db, user_id, appt.id, "STATUS", "Conferência concluída: todas as NFs finalizadas -> Conferido.")
        return True
    if appt.status == RECEBIDO:
        appt.status = EM_CONFERENCIA
        audit(db, user_id, appt.id, "STATUS", "Recebido -> Em conferência.")
    return False


# ── Leitura ──────────────────────────────────────────────────────────────────
def is_overdue(appt) -> bool:
    return appt.status == AGENDADO and appt.scheduled_date < today_brasilia()


def stock_summary(db: Session, appt: models.InboundAppointment) -> List[Dict]:
    """Esperado (XML) x entrou no estoque (contagem), por SKU. Só faz sentido em CONFERIDO."""
    ids = [n.order_id for n in appt.nfs if n.active and n.order_id]
    if not ids:
        return []
    expected: Dict[str, Dict] = {}
    for sku, name, qty in db.query(
        models.OrderItem.sku, models.OrderItem.product_name, models.OrderItem.quantity
    ).filter(models.OrderItem.order_id.in_(ids)).all():
        e = expected.setdefault(sku, {"sku": sku, "name": name, "expected": 0, "entered": 0})
        e["expected"] += qty or 0
    for sku, qty in db.query(models.StockMovement.sku, models.StockMovement.quantity).filter(
        models.StockMovement.order_id.in_(ids)
    ).all():
        e = expected.setdefault(sku, {"sku": sku, "name": sku, "expected": 0, "entered": 0})
        e["entered"] += qty or 0
    rows = sorted(expected.values(), key=lambda r: r["sku"])
    for r in rows:
        r["divergent"] = r["expected"] != r["entered"]
    return rows


def internal_warnings(db: Session, appt: models.InboundAppointment) -> List[Dict]:
    """Avisos só para o time (o seller nunca vê). Cada um traz o link para resolver."""
    out: List[Dict] = []
    ids = [n.order_id for n in appt.nfs if n.active and n.order_id]
    if appt.status == CANCELADO:
        return out
    seller = appt.seller
    if seller is not None and not seller.unit_id:
        out.append({"type": "seller_without_unit", "message": "Seller sem unidade.",
                    "link": "/sellers/corrigir"})
    if ids:
        missing = orders_missing_product_skus(db, ids)
        skus = sorted({s for v in missing.values() for s in v})
        if skus:
            out.append({"type": "missing_product", "skus": skus,
                        "message": "SKU sem produto cadastrado: " + ", ".join(skus[:10]),
                        "link": "/products"})
        disc = orders_with_discontinued_skus(db, ids)
        dskus = sorted({s for v in disc.values() for s in v})
        if dskus:
            out.append({"type": "discontinued_sku", "skus": dskus,
                        "message": "SKU descontinuado: " + ", ".join(dskus[:10]),
                        "link": "/sellers"})
    return out
