"""
WMS Kiwkiw - Controle de Vencimentos (03/11/2026) — cálculo PURO.

Módulo sem acesso a banco. Fonte única de parse de data, "dias restantes",
situação (vencido / aviso / ok) e FEFO (first-expire, first-out).

É aqui que os testes atacam cada caso de borda: SQLite não pega concorrência
e nem o ramo de "só restam vencidos" é fácil de forjar em teste de integração.

A camada de vencimentos é INFORMATIVA. Ela NUNCA altera stock_movements nem
stock_positions — qualquer movimento gravado por esta feature é bug. Veja o
cabeçalho de services/stock_manager.py: o estoque pertence ao fluxo da
Kiwkiw (import de saída, finalize-entry de entrada, movimento manual).

Datas: tudo em Brasília (today_brasilia()). "Vence hoje" = válido até o fim
do dia (`data >= today`). Vencido só a partir do dia seguinte.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, List, Literal, Optional, Sequence


__all__ = [
    "parse_expiry_date",
    "normalize_lot",
    "LOT_MAX_LEN",
    "days_remaining",
    "situation",
    "LineView",
    "Alloc",
    "fefo_allocate",
    "AllocRow",
    "Reversal",
    "reverse_allocations",
]


# ----------------------------------------------------------------------
# Parse de data
# ----------------------------------------------------------------------

# Aceitos: dd/mm/aaaa, d/m/aaaa, mm/aaaa, m/aaaa.
# Rejeitado: qualquer outra coisa (dd-mm-aaaa, yyyy-mm-dd, texto solto).
# `mm/aaaa` vira o ÚLTIMO DIA do mês (decisão do dono — padrão de "validade
# por mês" vindo da indústria alimentícia/cosmética).
_RE_DD_MM_YYYY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$")
_RE_MM_YYYY    = re.compile(r"^\s*(\d{1,2})/(\d{4})\s*$")


def parse_expiry_date(raw: str) -> date:
    """
    Converte texto do seller em `date`. Formatos aceitos:
      * `dd/mm/aaaa` (ou `d/m/aaaa` com zero omitido)
      * `mm/aaaa`    (ou `m/aaaa`)  — vira o ÚLTIMO DIA do mês

    Lança `ValueError` para qualquer outro formato ou data inválida.
    Independente de locale (não usa `strptime`).
    """
    if not isinstance(raw, str):
        raise ValueError("Data precisa ser texto")

    m = _RE_DD_MM_YYYY.match(raw)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        try:
            return date(y, mo, d)
        except ValueError as exc:
            raise ValueError(f"Data inválida: {raw!r}") from exc

    m = _RE_MM_YYYY.match(raw)
    if m:
        mo, y = (int(x) for x in m.groups())
        if not (1 <= mo <= 12):
            raise ValueError(f"Mês inválido em {raw!r}")
        try:
            last_day = calendar.monthrange(y, mo)[1]
            return date(y, mo, last_day)
        except (ValueError, calendar.IllegalMonthError) as exc:
            raise ValueError(f"Data inválida: {raw!r}") from exc

    raise ValueError(
        f"Data {raw!r} fora dos formatos aceitos — use dd/mm/aaaa ou mm/aaaa"
    )


# ----------------------------------------------------------------------
# Nome do lote (09/11/2026)
# ----------------------------------------------------------------------

LOT_MAX_LEN = 60


def normalize_lot(raw: Optional[str]) -> Optional[str]:
    """
    Nome do lote: opcional. Guarda como digitado, sem espaços nas pontas e com
    espaços internos repetidos colapsados. Vazio/None -> None ("Sem lote").
    Comparação entre lotes deve ser feita ignorando maiúscula/minúscula
    (`lot.lower()`), mas o texto original é preservado para exibição.

    Lança `ValueError` se passar de `LOT_MAX_LEN` caracteres.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("Lote precisa ser texto")
    txt = " ".join(raw.split())
    if not txt:
        return None
    if len(txt) > LOT_MAX_LEN:
        raise ValueError(f"Lote acima de {LOT_MAX_LEN} caracteres")
    return txt


# ----------------------------------------------------------------------
# Dias restantes e situação
# ----------------------------------------------------------------------

def days_remaining(d: date, today: date) -> int:
    """
    Diferença em dias. Hoje = 0, ontem = -1, amanhã = 1.
    """
    return (d - today).days


Situation = Literal["vencido", "aviso", "ok"]


def situation(d: date, today: date, aviso_dias: int) -> Situation:
    """
    * `vencido` quando `d < today` (dia do vencimento ainda é válido).
    * `aviso`   quando `0 <= dias <= aviso_dias`.
    * `ok`      para o resto (dias > aviso_dias no futuro).
    """
    dr = days_remaining(d, today)
    if dr < 0:
        return "vencido"
    if dr <= max(0, int(aviso_dias)):
        return "aviso"
    return "ok"


# ----------------------------------------------------------------------
# FEFO (first-expire, first-out)
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class LineView:
    """
    Projeção mínima de uma linha de vencimento para o FEFO.

    `qty_disponivel` é a quantidade da linha livre para alocar (já
    descontada de reservas de pedido de descarte/retirada no chamador).
    `id` é só o tiebreak estável — nunca é consultado como FK aqui.
    """
    id: int
    expiry_date: date
    qty_disponivel: int


@dataclass(frozen=True)
class Alloc:
    """
    Alocação devolvida pelo FEFO. Nunca cria registro no banco — isso
    é responsabilidade do chamador. `vencido` reflete o estado NO MOMENTO
    da alocação (`data < today`), e deve ser gravado COMO CÓPIA junto da
    alocação para o aviso de gerência sobreviver a edições posteriores
    da linha (Q2 — reativar vencido não afeta estorno).
    """
    line_id: int
    expiry_date: date
    quantity: int
    vencido: bool


def _sorted_lines(lines: Iterable[LineView]) -> List[LineView]:
    """Ordem canônica do FEFO: data ASC, id ASC (desempate estável)."""
    return sorted(lines, key=lambda l: (l.expiry_date, l.id))


def fefo_allocate(
    lines: Sequence[LineView],
    qty_needed: int,
    today: date,
) -> List[Alloc]:
    """
    Aloca `qty_needed` unidades sobre `lines`, priorizando:
      1. Vencimentos VÁLIDOS (expiry_date >= today), do mais próximo pro mais
         distante (data ASC, id ASC no empate).
      2. Se faltar quantidade, consome vencidos (expiry_date < today), na
         mesma ordem. Cada alocação vencida nasce com `vencido=True`.

    Excedente além da soma de `qty_disponivel` é IGNORADO — o chamador
    trata como "sem vencimento" (nenhuma alocação devolvida cobre esse
    excesso). A função não lança; devolve a lista parcial.

    `qty_needed <= 0` devolve `[]`.
    """
    if qty_needed <= 0:
        return []

    allocs: List[Alloc] = []
    remaining = int(qty_needed)

    ordered = _sorted_lines(lines)
    validos  = [l for l in ordered if l.expiry_date >= today and l.qty_disponivel > 0]
    vencidos = [l for l in ordered if l.expiry_date <  today and l.qty_disponivel > 0]

    for pool, is_vencido in ((validos, False), (vencidos, True)):
        for line in pool:
            if remaining <= 0:
                break
            take = min(line.qty_disponivel, remaining)
            if take <= 0:
                continue
            allocs.append(Alloc(
                line_id=line.id,
                expiry_date=line.expiry_date,
                quantity=take,
                vencido=is_vencido,
            ))
            remaining -= take

    return allocs


# ----------------------------------------------------------------------
# Estorno — soma por linha
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class AllocRow:
    """Projeção de uma alocação histórica para o cálculo de estorno."""
    expiry_line_id: Optional[int]      # pode ser None quando a linha foi apagada
    data_copiada: date
    quantity: int


@dataclass(frozen=True)
class Reversal:
    """Delta a ser devolvido a uma linha de vencimento no estorno.

    `expiry_line_id` None sinaliza que a linha original foi apagada —
    o chamador deve recriá-la com `expiry_date = data_copiada` antes de
    aplicar o delta (item 19 do prompt da feature).
    """
    expiry_line_id: Optional[int]
    data_copiada: date
    delta: int


def reverse_allocations(allocs: Iterable[AllocRow]) -> List[Reversal]:
    """
    Soma as quantidades por `(expiry_line_id, data_copiada)`. Devolve uma
    lista determinística ordenada por `data_copiada` (depois por id para
    desempate, Nones por último) — a mesma ordem usada no FEFO, para que
    o chamador aplique o `UPDATE ... SET qty_atual = qty_atual + :d` numa
    ordem estável e evite deadlock contra um import em paralelo.
    """
    buckets: dict[tuple[Optional[int], date], int] = {}
    for row in allocs:
        if row.quantity <= 0:
            continue
        key = (row.expiry_line_id, row.data_copiada)
        buckets[key] = buckets.get(key, 0) + int(row.quantity)

    def _sort_key(item):
        (line_id, data), _ = item
        return (data, line_id if line_id is not None else 10**12)

    return [
        Reversal(expiry_line_id=line_id, data_copiada=data, delta=delta)
        for (line_id, data), delta in sorted(buckets.items(), key=_sort_key)
    ]
