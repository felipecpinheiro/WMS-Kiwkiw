"""
WMS Kiwkiw - Cálculos do CRM comercial (23/09/2026)

Fonte única de: listas fechadas, dias úteis, cadência sugerida, alerta da
próxima ação e campos calculados do lead. Tudo aqui é função pura (sem banco),
para o router e o dashboard não divergirem.

Dias úteis = só sábado e domingo ficam de fora (decisão do dono, 23/09/2026 —
feriados não entram).
"""

from datetime import date, timedelta
from typing import Optional

STAGES = [
    "Novo lead", "Contato iniciado", "Em follow-up", "Proposta enviada",
    "Negociação", "Ganho", "Perdido",
]
CLOSED_STAGES = {"Ganho", "Perdido"}

DEFAULT_ORIGINS = [
    "Indicação", "Instagram", "Google", "Anúncio", "Site Kiwkiw", "WhatsApp", "Evento",
    "Outbound / prospecção ativa", "Cliente atual / indicação de cliente",
    "Parceiro", "Outro",
]

ACTION_TYPES = [
    "WhatsApp", "E-mail", "Ligação", "Reunião", "Enviar informações",
    "Enviar proposta", "Follow-up da proposta", "Negociação", "Encerrar lead",
    "Outro",
]

LOSS_REASONS = [
    "Sem retorno", "Preço", "Escolheu concorrente", "Momento inadequado",
    "Operação ainda pequena", "Operação incompatível com a Kiwkiw",
    "Desistiu do projeto", "Solução interna", "Outro",
]
LOSS_MOMENTO = "Momento inadequado"

CONTACT_TYPES = ["WhatsApp", "E-mail", "Ligação", "Reunião", "Proposta", "Outro"]
CHANNELS = ["WhatsApp", "E-mail", "Telefone", "Videochamada", "Presencial", "Outro"]

# Resultado de uma interação COM resposta do cliente.
OUTCOMES = {
    "interesse":   "Cliente demonstrou interesse",
    "reuniao_marcada": "Reunião marcada",
    "reuniao":     "Reunião realizada",
    "proposta":    "Proposta enviada",
    "negociacao":  "Cliente em negociação",
    "documento":   "Cliente pediu documento/informação",
}

# Sem resposta: dias úteis até a próxima ação, por nº do contato efetivo.
# D0 -> +2 -> +3 -> +5 -> +7  (=17 dias úteis até a possível perda por silêncio)
_NO_REPLY_GAPS = {1: 2, 2: 3, 3: 5, 4: 7}
LAST_ATTEMPT = 4  # 4º contato efetivo = "última tentativa"


# ── Dias úteis ───────────────────────────────────────────────────────────────
def is_business_day(d: date) -> bool:
    return d.weekday() < 5


def add_business_days(d: date, n: int) -> date:
    """+n dias úteis. n=0 devolve o próprio dia (ou o próximo útil, se cair no fim de semana)."""
    cur = d
    if n == 0:
        while not is_business_day(cur):
            cur += timedelta(days=1)
        return cur
    step = 1 if n > 0 else -1
    left = abs(n)
    while left:
        cur += timedelta(days=step)
        if is_business_day(cur):
            left -= 1
    return cur


# ── Cadência sugerida ────────────────────────────────────────────────────────
def suggest_next_action(
    base_date: date,
    effective_count: int,
    responded: bool,
    outcome: Optional[str] = None,
    client_date: Optional[date] = None,
) -> dict:
    """
    Sugere (tipo, data, etapa, motivo) da próxima ação após uma interação.

    `effective_count` já INCLUI a interação que está sendo registrada.
    Data indicada pelo cliente sempre prevalece sobre qualquer regra.
    """
    if responded:
        rule = {
            "interesse":  (1, "Enviar informações", "Em follow-up"),
            "reuniao_marcada": (1, "Reunião", "Em follow-up"),  # data da reunião vem em client_date
            "reuniao":    (1, "Follow-up da proposta", "Em follow-up"),
            "proposta":   (2, "Follow-up da proposta", "Proposta enviada"),
            "negociacao": (2, "Negociação", "Negociação"),
            "documento":  (0, "Enviar informações", "Em follow-up"),
        }.get(outcome or "interesse", (1, "WhatsApp", "Em follow-up"))
        gap, action, stage = rule
        reason = OUTCOMES.get(outcome or "interesse", "Cliente respondeu")
        reason += f" → +{gap} dia(s) útil(eis)" if gap else " → mesmo dia (ou próximo útil)"
    else:
        n = max(1, effective_count)
        if n > LAST_ATTEMPT:
            gap, action = 0, "Encerrar lead"
            reason = "Cadência esgotada sem retorno → sugerir encerrar como 'Sem retorno'"
        else:
            gap = _NO_REPLY_GAPS[n]
            action = "Encerrar lead" if n == LAST_ATTEMPT else "WhatsApp"
            reason = (
                f"Última tentativa feita → em +{gap} dias úteis, sem manifestação, encerrar como 'Sem retorno'"
                if n == LAST_ATTEMPT
                else f"{n}º contato sem resposta → próximo em +{gap} dias úteis"
            )
        stage = "Contato iniciado" if n == 1 else "Em follow-up"

    if client_date:
        return {
            "next_action_type": action, "next_action_date": client_date,
            "stage": stage, "reason": "Data indicada pelo cliente",
        }
    return {
        "next_action_type": action,
        "next_action_date": add_business_days(base_date, gap),
        "stage": stage,
        "reason": reason,
    }


# ── Alerta ───────────────────────────────────────────────────────────────────
def alert_status(stage: str, next_action_date: Optional[date], today: date) -> Optional[str]:
    """atrasado | hoje | proximos2 | agendado | sem_acao — None p/ lead encerrado."""
    if stage in CLOSED_STAGES:
        return None
    if next_action_date is None:
        return "sem_acao"
    if next_action_date < today:
        return "atrasado"
    if next_action_date == today:
        return "hoje"
    if next_action_date <= today + timedelta(days=2):
        return "proximos2"
    return "agendado"


ALERT_ORDER = {"atrasado": 0, "hoje": 1, "proximos2": 2, "sem_acao": 3, "agendado": 4}


# ── Campos calculados do lead ────────────────────────────────────────────────
def days_since(d: Optional[date], today: date) -> Optional[int]:
    return (today - d).days if d else None


def days_in_funnel(created: date, closed: Optional[date], today: date) -> int:
    return ((closed or today) - created).days
