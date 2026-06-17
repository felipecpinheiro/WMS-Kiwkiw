/**
 * WMS Kiwkiw - Utilitário de fuso horário (Brasília, GMT-3)
 *
 * Espelha o backend (ver backend/timezone_utils.py): TODA referência a
 * "hoje" usada como valor padrão de filtro de data (ex.: Trilha de Auditoria)
 * deve ser ancorada no horário de Brasília, e NUNCA no fuso horário do
 * navegador do usuário. Sem isso, um usuário acessando o sistema de outro
 * fuso (ou com o relógio do computador mal configurado) veria, por padrão,
 * uma data diferente da data "de hoje" no Brasil — gerando filtros que
 * parecem não trazer nenhum resultado por volta da virada do dia.
 *
 * Usa Intl.DateTimeFormat com timeZone fixo 'America/Sao_Paulo', que já
 * resolve corretamente o horário de verão (atualmente não observado no
 * Brasil, mas a API trata isso automaticamente caso volte a vigorar).
 */

const BRASILIA_TZ = 'America/Sao_Paulo';

/** Retorna a data de "hoje" em Brasília no formato 'yyyy-MM-dd'. */
export function todayBrasiliaStr(): string {
  // en-CA produz diretamente o formato yyyy-MM-dd
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Retorna a data de "hoje" em Brasília no formato visual 'dd/MM/yyyy'. */
export function todayBrasiliaDisplayStr(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRASILIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Retorna o Date "agora" deslocado para representar o horário de Brasília. */
export function nowBrasilia(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRASILIA_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  );
}
