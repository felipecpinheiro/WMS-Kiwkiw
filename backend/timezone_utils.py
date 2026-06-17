"""
WMS Kiwkiw - Utilitário central de fuso horário
==================================================
TODO horário gravado ou exibido pelo sistema deve usar o horário de
Brasília (GMT-3), independentemente de onde o servidor esteja hospedado.

Por que isso existe
--------------------
Antes desta correção, todo o backend usava `datetime.now()` diretamente.
Isso funciona OK quando o servidor roda na mesma máquina/fuso do usuário,
mas quebra silenciosamente em produção: serviços de hospedagem (Railway,
Render, Azure, etc.) normalmente rodam os containers em UTC. Resultado:
toda bipagem, todo log de auditoria e todo "criado em" ficava registrado
3h adiantado em relação ao horário real de Brasília — e como o frontend
exibe o valor cru vindo da API (sem nenhuma conversão), o usuário via um
horário visivelmente errado na Trilha de Auditoria.

A correção: gravar SEMPRE o horário de Brasília (naive, sem tzinfo, já
deslocado) em todas as colunas de timestamp. Como o SQLite (e o restante
do código) trabalha com datetimes "naive", não tentamos guardar tz-aware —
apenas garantimos que o valor numérico do datetime já está correto para
GMT-3, não importa em qual fuso o processo Python está rodando.

Uso
---
    from ..timezone_utils import now_brasilia

    log = models.AuditLog(..., timestamp=now_brasilia())

Em `models.py`, os `Column(DateTime, default=...)` devem usar
`default=now_brasilia` (sem parênteses — é a callable, não o valor).
"""

from datetime import datetime, timezone, timedelta, date as date_cls

# GMT-3, sem horário de verão (o Brasil não usa horário de verão desde 2019)
BRASILIA_TZ = timezone(timedelta(hours=-3))


def now_brasilia() -> datetime:
    """
    Retorna o horário atual de Brasília como datetime NAIVE (sem tzinfo).

    Naive de propósito: o restante do projeto (SQLite, comparações com
    `date_from`/`date_to` vindos do frontend, etc.) trabalha com datetimes
    naive. Se devolvêssemos um datetime tz-aware, comparações com colunas
    naive do banco lançariam erro ou seriam silenciosamente incorretas.
    """
    return datetime.now(BRASILIA_TZ).replace(tzinfo=None)


def today_brasilia() -> date_cls:
    """Data de hoje considerando o fuso de Brasília (não o fuso do servidor)."""
    return now_brasilia().date()


def end_of_day(d: date_cls) -> datetime:
    """
    Converte uma `date` (sem hora) no último instante daquele dia
    (23:59:59.999999), para uso em filtros `timestamp <= date_to`.

    Sem isso, filtrar por `timestamp <= date_to` equivale a comparar com
    `date_to 00:00:00` — ou seja, exclui TODOS os registros do próprio
    dia (qualquer bipagem feita depois da meia-noite seria descartada).
    Esse era exatamente o bug que fazia o filtro "Hoje" da Trilha de
    Auditoria > Bipagens parecer vazio ou incompleto.
    """
    return datetime.combine(d, datetime.max.time())
