"""
WMS Kiwkiw - Cálculo de faturamento (módulo ÚNICO)
==================================================
Reescrita de 31/08/2026. Toda a matemática do faturamento novo mora aqui:
a listagem do fechamento, o PDF, o Excel e o consolidado consomem este módulo.

Base das listas (decisão do dono do sistema):
  - NFs de SAÍDA (`file_type` != entrada; NULL conta como saída)
  - qualquer status EXCETO `cancelled`
  - `for_billing` verdadeiro (NULL conta como verdadeiro)
  - `imported_at` dentro do mês de referência, em horário de Brasília

Nada aqui toca em estoque.
"""

from __future__ import annotations

import re
from calendar import monthrange
from datetime import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..models import FileType, OrderStatus


# Unificação de 01/09/2026: TODOS estes parâmetros vivem só em
# `billing_seller_params` (fonte única). Mês aberto e a aba Comercial de Sellers
# leem/gravam o mesmo registro; ao fechar o mês, os valores são copiados para o
# snapshot em `billing_monthly_closings` e congelados. `valor_segurado` e
# `cubagem_m3` entraram aqui na mesma virada (deixaram de ser override por mês).
PARAM_FIELDS = (
    "preco_unitario", "min_pedidos", "manuseio_b2b", "valor_caixa_b2b",
    "adic_produto_b2b", "franquia_produtos_b2b",
    "limite_itens_b2b", "tipos_caixa_inclusos", "cota_caixas_mes",
    "franquia_m3", "preco_m3", "seguro_incluso", "aliquota_seguro",
    "armazenagem_inclusa", "valor_segurado", "cubagem_m3",
)

DEFAULT_PARAMS = {
    "preco_unitario": 0.0, "min_pedidos": 0, "manuseio_b2b": 0.0,
    "valor_caixa_b2b": 0.0, "adic_produto_b2b": 0.0, "franquia_produtos_b2b": 15,
    "limite_itens_b2b": 0,
    "tipos_caixa_inclusos": "", "cota_caixas_mes": 0, "franquia_m3": 0.0,
    "preco_m3": 0.0, "seguro_incluso": False, "aliquota_seguro": 0.30,
    "armazenagem_inclusa": False, "valor_segurado": 0.0, "cubagem_m3": 0.0,
}


def r2(x: float) -> float:
    return round(float(x or 0.0) + 1e-9, 2)


# ── janela do mês ─────────────────────────────────────────────────────────────

def month_range(ref_month: str) -> tuple[datetime, datetime]:
    """('YYYY-MM') -> (primeiro instante, último instante) naive Brasília."""
    year, mon = (int(p) for p in ref_month.split("-"))
    last_day = monthrange(year, mon)[1]
    start = datetime(year, mon, 1, 0, 0, 0)
    end = datetime(year, mon, last_day, 23, 59, 59, 999999)
    return start, end


def prev_ref_month(ref_month: str) -> str:
    year, mon = (int(p) for p in ref_month.split("-"))
    mon -= 1
    if mon == 0:
        mon, year = 12, year - 1
    return f"{year:04d}-{mon:02d}"


# ── caixas ───────────────────────────────────────────────────────────────────

# Lista canônica — repetida em todo o sistema (Scanner, faturamento, cadastro
# do seller). A ordem é a de exibição.
CANONICAL_BOXES = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11",
    "Saco de Embarque", "Própria",
]


def normaliza_box(raw) -> Optional[str]:
    """Converte o texto de `Order.box_used` numa chave canônica de caixa."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    low = s.lower()
    if low.startswith("pró") or low.startswith("pro") or "propr" in low:
        return "Própria"
    if "saco" in low or "sacola" in low or "embarque" in low:
        return "Saco de Embarque"
    m = re.search(r"\d+", s)
    return m.group(0) if m else s


def parse_grupo_a(txt: str) -> set[str]:
    """Lista de caixas inclusas (grupo A). Aceita o formato novo (canônicas
    separadas por vírgula) e o antigo ("1,2" / texto livre com "própria")."""
    if not txt:
        return set()
    out: set[str] = set()
    for part in str(txt).split(","):
        nums = re.findall(r"\d+", part)
        if nums:
            out.update(nums)            # "10" -> {"10"}, legado "1 2" -> {"1","2"}
        else:
            nb = normaliza_box(part)
            if nb:
                out.add(nb)
    return out


# ── parâmetros ───────────────────────────────────────────────────────────────

def params_from_obj(obj) -> dict:
    # getattr com fallback: coluna aditiva pode não existir num registro antigo
    # até a migração leve rodar.
    return {f: getattr(obj, f, DEFAULT_PARAMS[f]) for f in PARAM_FIELDS}


def default_params_for_seller(db: Session, seller_id: int) -> dict:
    row = db.query(models.BillingSellerParams).filter(
        models.BillingSellerParams.seller_id == seller_id
    ).first()
    if row:
        return params_from_obj(row)
    return dict(DEFAULT_PARAMS)


def prefill_params(db: Session, seller_id: int, ref_month: str) -> dict:
    """
    Parâmetros de um mês aberto = SEMPRE o default do seller (fonte única desde
    01/09/2026). Não há mais "puxa do mês anterior": todo mês aberto reflete o
    registro `billing_seller_params` ao vivo. `ref_month` fica na assinatura só
    por compatibilidade com os chamadores.
    """
    return default_params_for_seller(db, seller_id)


# ── NFs do mês ───────────────────────────────────────────────────────────────

def list_month_orders(db: Session, seller_id: int, ref_month: str) -> list[models.Order]:
    start, end = month_range(ref_month)
    return (
        db.query(models.Order)
        .options(joinedload(models.Order.items))
        .filter(
            models.Order.seller_id == seller_id,
            models.Order.imported_at >= start,
            models.Order.imported_at <= end,
            models.Order.status != OrderStatus.CANCELLED,
            or_(models.Order.file_type.is_(None),
                models.Order.file_type != FileType.IMPORT),
            or_(models.Order.for_billing.is_(None),
                models.Order.for_billing == True),  # noqa: E712
        )
        .order_by(models.Order.imported_at.asc(), models.Order.id.asc())
        .all()
    )


def order_qty(order: models.Order) -> int:
    return sum(int(it.quantity or 0) for it in order.items)


def order_items_brief(order: models.Order) -> list[dict]:
    return [
        {"sku": it.sku, "name": it.product_name, "quantity": int(it.quantity or 0)}
        for it in order.items
    ]


def classify(order: models.Order, params: dict, override: Optional[str]) -> str:
    if override in ("b2c", "b2b"):
        return override
    lim = int(params.get("limite_itens_b2b") or 0)
    if lim > 0 and order_qty(order) >= lim:
        return "b2b"
    return "b2c"


# ── cálculo ao vivo ──────────────────────────────────────────────────────────

def compute_live(
    db: Session,
    seller_id: int,
    ref_month: str,
    params: dict,
    cubagem_m3: float,
    valor_segurado: float,
    overrides: dict[int, dict],
    adjustments: list[dict],
    box_prices: dict[str, Optional[float]],
) -> dict:
    orders = list_month_orders(db, seller_id, ref_month)
    grupo_a = parse_grupo_a(params.get("tipos_caixa_inclusos") or "")
    preco_unit = float(params.get("preco_unitario") or 0.0)
    mb2b = float(params.get("manuseio_b2b") or 0.0)
    cb2b = float(params.get("valor_caixa_b2b") or 0.0)
    apb2b = float(params.get("adic_produto_b2b") or 0.0)
    fpb2b = int(params.get("franquia_produtos_b2b") or 0)
    cota = int(params.get("cota_caixas_mes") or 0)

    # canal por NF
    channels: dict[int, str] = {}
    for o in orders:
        ov = overrides.get(o.id) or {}
        channels[o.id] = classify(o, params, ov.get("channel_override"))

    # cota B: só NFs B2C, caixa normalizada não-nula e fora do grupo A,
    # na ordem imported_at, id (a lista já vem ordenada assim).
    cota_free: set[int] = set()
    used = 0
    for o in orders:
        if channels[o.id] != "b2c":
            continue
        nb = normaliza_box(o.box_used)
        if nb is None or nb in grupo_a:
            continue
        if used < cota:
            cota_free.add(o.id)
            used += 1

    b2c_lines, b2b_lines = [], []
    soma_b2c = soma_b2b = 0.0

    for o in orders:
        ov = overrides.get(o.id) or {}
        nb = normaliza_box(o.box_used)
        if channels[o.id] == "b2c":
            sem_caixa = nb is None
            if sem_caixa:
                adic = 0.0
            elif nb in grupo_a or o.id in cota_free:
                adic = 0.0
            else:
                adic = float(box_prices.get(nb) or 0.0)
            manual_adic = float(ov.get("b2b_adicional") or 0.0)   # adicional manual da NF (genérico)
            total = preco_unit + adic + manual_adic
            soma_b2c += total
            b2c_lines.append({
                "order_id": o.id,
                "nf_number": o.nf_number,
                "order_date": o.order_date.isoformat() if o.order_date else None,
                "imported_at": o.imported_at.isoformat() if o.imported_at else None,
                "box": o.box_used,
                "box_norm": nb,
                "itens": order_qty(o),
                "adic_caixa": r2(adic),
                "adic_manual": r2(manual_adic),
                "b2b_adicional": r2(manual_adic),
                "manuseio": r2(preco_unit),
                "total": r2(total),
                "sem_caixa": sem_caixa,
                "note": ov.get("note") or "",
                "auto_channel": classify(o, params, None),
                "items": order_items_brief(o),
            })
        else:
            b2b_adic = float(ov.get("b2b_adicional") or 0.0)
            adic_produto = apb2b * max(0, order_qty(o) - fpb2b)   # só a partir do (franquia+1)º produto
            total = mb2b + cb2b + adic_produto + b2b_adic
            soma_b2b += total
            b2b_lines.append({
                "order_id": o.id,
                "nf_number": o.nf_number,
                "order_date": o.order_date.isoformat() if o.order_date else None,
                "imported_at": o.imported_at.isoformat() if o.imported_at else None,
                "box": o.box_used,
                "itens": order_qty(o),
                "valor_caixa_b2b": r2(cb2b),
                "manuseio_b2b": r2(mb2b),
                "adic_produto": r2(adic_produto),
                "b2b_adicional": r2(b2b_adic),
                "total": r2(total),
                "note": ov.get("note") or "",
                "auto_channel": classify(o, params, None),
                "items": order_items_brief(o),
            })

    fatura = _fatura(
        params, soma_b2c, soma_b2b, cubagem_m3, valor_segurado, adjustments,
    )
    return {
        "status": "open",
        "b2c_lines": b2c_lines,
        "b2b_lines": b2b_lines,
        "soma_b2c": r2(soma_b2c),
        "soma_b2b": r2(soma_b2b),
        "n_b2c": len(b2c_lines),
        "n_b2b": len(b2b_lines),
        "cota_aplicada": len(cota_free),
        "fatura": fatura,
    }


def _fatura(params, soma_b2c, soma_b2b, cubagem, valor_segurado, adjustments) -> dict:
    preco_unit = float(params.get("preco_unitario") or 0.0)
    min_ped = int(params.get("min_pedidos") or 0)
    floor = min_ped * preco_unit
    b2c_min = max(soma_b2c, floor)
    b2b_min = soma_b2b
    # `seguro_incluso` = "cobrar seguro?": ligado cobra, desligado não cobra.
    # (O nome da coluna foi mantido por compatibilidade; o rótulo na tela é "Cobrar seguro?".)
    seguro = (
        float(valor_segurado or 0.0) * float(params.get("aliquota_seguro") or 0.0) / 100.0
        if params.get("seguro_incluso") else 0.0
    )
    exc_m3 = max(0.0, float(cubagem or 0.0) - float(params.get("franquia_m3") or 0.0))
    armazenagem = exc_m3 * float(params.get("preco_m3") or 0.0)
    avulsos = sum(int(a.get("sign") or 1) * float(a.get("valor") or 0.0) for a in adjustments)
    subtotal_b2c = b2c_min + seguro + armazenagem + avulsos
    subtotal_b2b = b2b_min
    return {
        "b2c_min": r2(b2c_min),
        "b2b_min": r2(b2b_min),
        "seguro": r2(seguro),
        "armazenagem": r2(armazenagem),
        "avulsos": r2(avulsos),
        "subtotal_b2c": r2(subtotal_b2c),
        "subtotal_b2b": r2(subtotal_b2b),
        "total_geral": r2(subtotal_b2c + subtotal_b2b),
        "floor_b2c": r2(floor),
        "soma_real_b2c": r2(soma_b2c),
        "min_atingiu_piso": floor > soma_b2c + 0.001,
        "exc_m3": round(exc_m3, 4),
    }


# ── snapshot (fechar / reabrir) ──────────────────────────────────────────────

def freeze(db: Session, closing: models.BillingMonthlyClosing, computed: dict) -> None:
    """Grava BillingClosingLine + cache dos totais. Chamado no `close`."""
    db.query(models.BillingClosingLine).filter(
        models.BillingClosingLine.closing_id == closing.id
    ).delete(synchronize_session=False)

    for ln in computed["b2c_lines"]:
        db.add(models.BillingClosingLine(
            closing_id=closing.id, nf_number=ln["nf_number"],
            order_date=_parse_date(ln["order_date"]),
            imported_at=_parse_dt(ln["imported_at"]),
            channel="b2c", box=ln["box"], adic_caixa=ln["adic_caixa"],
            # adicional manual da NF dobrado no bucket manuseio (igual o B2B faz
            # com valor_caixa_b2b); o total já inclui tudo.
            manuseio=r2(ln["manuseio"] + ln.get("adic_manual", 0.0)),
            total=ln["total"], sem_caixa=ln["sem_caixa"],
        ))
    for ln in computed["b2b_lines"]:
        db.add(models.BillingClosingLine(
            closing_id=closing.id, nf_number=ln["nf_number"],
            order_date=_parse_date(ln["order_date"]),
            imported_at=_parse_dt(ln["imported_at"]),
            channel="b2b", box=ln["box"], adic_caixa=ln["b2b_adicional"],
            manuseio=r2(ln["manuseio_b2b"] + ln["valor_caixa_b2b"] + ln["adic_produto"]),
            total=ln["total"], sem_caixa=False,
        ))

    f = computed["fatura"]
    closing.t_b2c_min = f["b2c_min"]
    closing.t_b2b_min = f["b2b_min"]
    closing.t_seguro = f["seguro"]
    closing.t_armazenagem = f["armazenagem"]
    closing.t_avulsos = f["avulsos"]
    closing.t_subtotal_b2c = f["subtotal_b2c"]
    closing.t_subtotal_b2b = f["subtotal_b2b"]
    closing.t_total_geral = f["total_geral"]


def clear_snapshot(db: Session, closing: models.BillingMonthlyClosing) -> None:
    db.query(models.BillingClosingLine).filter(
        models.BillingClosingLine.closing_id == closing.id
    ).delete(synchronize_session=False)
    for c in ("t_b2c_min", "t_b2b_min", "t_seguro", "t_armazenagem", "t_avulsos",
              "t_subtotal_b2c", "t_subtotal_b2b", "t_total_geral"):
        setattr(closing, c, None)


def read_frozen(db: Session, closing: models.BillingMonthlyClosing) -> dict:
    """Reconstrói a estrutura de `compute_live` a partir do snapshot congelado."""
    lines = db.query(models.BillingClosingLine).filter(
        models.BillingClosingLine.closing_id == closing.id
    ).order_by(models.BillingClosingLine.imported_at.asc(),
               models.BillingClosingLine.id.asc()).all()

    b2c_lines, b2b_lines = [], []
    for ln in lines:
        d = {
            "order_id": None,
            "nf_number": ln.nf_number,
            "order_date": ln.order_date.isoformat() if ln.order_date else None,
            "imported_at": ln.imported_at.isoformat() if ln.imported_at else None,
            "box": ln.box,
            "total": r2(ln.total),
            "note": "",
        }
        if ln.channel == "b2c":
            d.update({"adic_caixa": r2(ln.adic_caixa), "adic_manual": 0.0,
                      "b2b_adicional": 0.0, "manuseio": r2(ln.manuseio),
                      "sem_caixa": ln.sem_caixa, "box_norm": normaliza_box(ln.box),
                      "itens": None, "auto_channel": "b2c"})
            b2c_lines.append(d)
        else:
            d.update({"b2b_adicional": r2(ln.adic_caixa), "manuseio_b2b": r2(ln.manuseio),
                      "valor_caixa_b2b": 0.0, "adic_produto": 0.0,
                      "itens": None, "auto_channel": "b2b"})
            b2b_lines.append(d)

    fatura = {
        "b2c_min": r2(closing.t_b2c_min), "b2b_min": r2(closing.t_b2b_min),
        "seguro": r2(closing.t_seguro), "armazenagem": r2(closing.t_armazenagem),
        "avulsos": r2(closing.t_avulsos), "subtotal_b2c": r2(closing.t_subtotal_b2c),
        "subtotal_b2b": r2(closing.t_subtotal_b2b), "total_geral": r2(closing.t_total_geral),
        "floor_b2c": r2((closing.min_pedidos or 0) * (closing.preco_unitario or 0.0)),
        "soma_real_b2c": r2(sum(l["total"] for l in b2c_lines)),
        "min_atingiu_piso": r2(closing.t_b2c_min) > r2(sum(l["total"] for l in b2c_lines)) + 0.001,
        "exc_m3": round(max(0.0, (closing.cubagem_m3 or 0.0) - (closing.franquia_m3 or 0.0)), 4),
    }
    return {
        "status": "closed",
        "b2c_lines": b2c_lines, "b2b_lines": b2b_lines,
        "soma_b2c": r2(sum(l["total"] for l in b2c_lines)),
        "soma_b2b": r2(sum(l["total"] for l in b2b_lines)),
        "n_b2c": len(b2c_lines), "n_b2b": len(b2b_lines),
        "cota_aplicada": None,
        "fatura": fatura,
    }


def _parse_date(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None
