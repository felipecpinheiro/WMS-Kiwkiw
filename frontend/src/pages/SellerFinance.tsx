/**
 * WMS Kiwkiw - Aba "Financeiro" do Portal do Seller (02/09/2026)
 * =============================================================
 * Visão SOMENTE LEITURA da fatura mensal do próprio seller. Toda a matemática
 * vem pronta do backend (`GET /billing/my/{ref_month}`), que já é escopado pelo
 * token — não existe `seller_id` na URL — e já vem podado das tarifas do
 * contrato (`params`, `box_prices`, `grupo_a` e os campos de piso da fatura).
 *
 * Diferente de `Billing.tsx` (admin): aqui não se troca canal, não se edita
 * adicional e não se escolhe caixa. É consulta.
 */

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { Download, List as ListIcon, ChevronDown } from 'lucide-react';
import { billingApi } from '../api';
import { todayBrasiliaStr } from '../timezone';

const brl = (n: number | null | undefined) =>
  'R$ ' + (Number(n ?? 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** '2026-08-14' -> '14/08' */
const dd = (s: string | null | undefined) =>
  s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—';

/** '2026-09-04T12:00:00' -> '04/09/2026' */
const ddmmyyyy = (s: string | null | undefined) =>
  s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';

const MONTH_FMT = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });

/** '2026-09' -> 'Setembro/2026' */
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const name = MONTH_FMT.format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${y}`;
}

/** Últimos 12 meses (do mês atual de Brasília para trás), mais recente primeiro. */
function lastTwelveMonths(): string[] {
  const [y, m] = todayBrasiliaStr().slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// ─── Lista de NFs (somente leitura) ───────────────────────────────────────────

function NfList({ kind, lines, soma }: { kind: 'b2c' | 'b2b'; lines: any[]; soma: number }) {
  const b2c = kind === 'b2c';
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // Soma da coluna de caixa deste canal: "Adic. caixa" no B2C, "Cx B2B" no B2B.
  const somaCx = lines.reduce((acc: number, l: any) => acc + Number((b2c ? l.adic_caixa : l.valor_caixa_b2b) || 0), 0);

  return (
    <div className="border border-line-soft rounded-xl overflow-hidden bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-2">
        <span className="text-[12px] font-semibold text-t2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${b2c ? 'bg-brand-soft text-brand' : 'bg-ok-soft text-ok'}`}>
            {b2c ? 'B2C' : 'B2B'}
          </span>
          &nbsp;{lines.length} NFs
        </span>
        <span className="text-[10.5px] text-t4">
          {b2c ? 'manuseio + adic. caixa + adic.' : 'manuseio + caixa + ad. prod + adic.'}
        </span>
      </div>

      {lines.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-t4">
          {b2c ? 'Nenhuma NF neste mês.' : 'Nenhuma NF classificada como B2B neste mês.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-wide text-t4">
                <th className="text-left font-semibold px-2 py-2 border-b border-line-soft">Data</th>
                <th className="text-left font-semibold px-2 py-2 border-b border-line-soft">NF</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">Itens</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">{b2c ? 'Cx' : 'Cx B2B'}</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">{b2c ? 'Adic. caixa' : 'Ad. prod'}</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">Adic.</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l: any, i: number) => {
                const open = !!expanded[i];
                const amber = b2c && l.sem_caixa;
                return (
                  <Fragment key={l.order_id ?? `${kind}-${i}`}>
                    <tr
                      onClick={() => setExpanded(x => ({ ...x, [i]: !x[i] }))}
                      className={`border-t border-line-soft cursor-pointer hover:bg-surface-2 transition
                        ${amber ? 'bg-warn-soft' : ''}`}
                    >
                      <td className="px-2 py-2 whitespace-nowrap">
                        <ListIcon size={11} className={`inline-block mr-1 ${open ? 'text-brand' : 'text-t4'}`} />
                        {dd(l.order_date)}
                      </td>
                      <td className="px-2 py-2 font-mono">{l.nf_number}</td>
                      <td className="px-2 py-2 text-right font-mono">{l.itens ?? '—'}</td>
                      <td className="px-2 py-2 text-right font-mono">
                        {b2c ? (l.box || '—') : brl(l.valor_caixa_b2b || 0)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {b2c ? brl(l.adic_caixa || 0) : brl(l.adic_produto || 0)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{brl(l.b2b_adicional || 0)}</td>
                      <td className="px-2 py-2 text-right font-mono text-t1">{brl(l.total)}</td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-2">
                        <td colSpan={7} className="px-3 py-2.5">
                          <div className="text-[11px] text-t4 mb-1">
                            NF {l.nf_number} · {(l.items || []).length} SKU(s)
                          </div>
                          {(l.items || []).map((it: any, j: number) => (
                            <div key={`${it.sku}-${j}`} className="flex justify-between gap-3 font-mono text-[11px] text-t3">
                              <span>{it.sku} — {it.name}</span>
                              <span className="whitespace-nowrap">× {it.quantity}</span>
                            </div>
                          ))}
                          {l.note && <div className="text-[11px] text-t4 italic mt-1.5">{l.note}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-bold">
                <td colSpan={3} className="px-2 py-2.5 text-t2">Soma {b2c ? 'B2C' : 'B2B'}</td>
                <td className="px-2 py-2.5 text-right font-mono text-t1">{b2c ? '' : brl(somaCx)}</td>
                <td className="px-2 py-2.5 text-right font-mono text-t1">{b2c ? brl(somaCx) : ''}</td>
                <td />
                <td className="px-2 py-2.5 text-right font-mono text-t1">{brl(soma)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Caixas do mês por tipo ───────────────────────────────────────────────────

/** Uma caixa por NF: conta NFs por tipo de caixa, separado por canal. */
function CaixasMes({ b2c, b2b }: { b2c: any[]; b2b: any[] }) {
  const contagem = useMemo(() => {
    const mapa = new Map<string, { b2c: number; b2b: number }>();
    const soma = (lista: any[], canal: 'b2c' | 'b2b') => {
      for (const l of lista) {
        const tipo = (l.box || '').trim() || 'Sem caixa';
        const linha = mapa.get(tipo) ?? { b2c: 0, b2b: 0 };
        linha[canal] += 1;
        mapa.set(tipo, linha);
      }
    };
    soma(b2c, 'b2c');
    soma(b2b, 'b2b');
    // "Sem caixa" sempre por último; os demais em ordem alfabética.
    return [...mapa.entries()].sort(([a], [c]) => {
      if (a === 'Sem caixa') return 1;
      if (c === 'Sem caixa') return -1;
      return a.localeCompare(c, 'pt-BR');
    });
  }, [b2c, b2b]);

  return (
    <div className="border border-line-soft rounded-xl overflow-hidden bg-surface">
      <div className="px-3 py-2.5 bg-surface-2 text-[12px] font-semibold text-t2">Caixas do mês por tipo</div>
      {contagem.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-t4">Nenhuma caixa neste mês.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-wide text-t4">
                <th className="text-left font-semibold px-2 py-2 border-b border-line-soft">Caixa</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">B2C</th>
                <th className="text-right font-semibold px-2 py-2 border-b border-line-soft">B2B</th>
              </tr>
            </thead>
            <tbody>
              {contagem.map(([tipo, q]) => (
                <tr key={tipo} className="border-t border-line-soft">
                  <td className="px-2 py-2 font-mono">{tipo}</td>
                  <td className="px-2 py-2 text-right font-mono">{q.b2c || '—'}</td>
                  <td className="px-2 py-2 text-right font-mono">{q.b2b || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-bold">
                <td className="px-2 py-2.5 text-t2">Total de caixas</td>
                <td className="px-2 py-2.5 text-right font-mono text-t1">{b2c.length}</td>
                <td className="px-2 py-2.5 text-right font-mono text-t1">{b2b.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Linha da tabela de resumo ────────────────────────────────────────────────

function FatRow({ label, b2c, b2b, strong }: {
  label: string; b2c: number | null; b2b: number | null; strong?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[1.5fr_1fr_1fr] px-3.5 py-2.5 border-b border-line-soft last:border-b-0
      ${strong ? 'bg-surface-2 font-bold text-t1' : 'text-t2'}`}>
      <span>{label}</span>
      <span className="text-right font-mono">{b2c == null ? '—' : brl(b2c)}</span>
      <span className="text-right font-mono">{b2b == null ? '—' : brl(b2b)}</span>
    </div>
  );
}

// ─── Parâmetros do mês (somente leitura, recolhível) ──────────────────────────
// 12/11/2026: mesma tabela "Parâmetros do mês" que já ia no PDF/Excel.

const faixasTxt = (pr: any): string => {
  if (!pr?.usar_faixas_pedidos) return '—';
  try {
    const fx = JSON.parse(pr.faixas_pedidos || '[]');
    return fx.map((f: any) => `${f.de}-${f.ate}: ${brl(f.preco)}/ped`).join(' · ') || '—';
  } catch {
    return '—';
  }
};

function ParametrosMes({ payload }: { payload: any }) {
  const [open, setOpen] = useState(false);
  const pr = payload?.params;
  if (!pr) return null;
  const sn = (v: any) => (v ? 'Sim' : 'Não');
  const rows: [string, string][] = [
    ['Preço unitário / manuseio B2C', brl(pr.preco_unitario)],
    ['Nº mínimo de pedidos', String(pr.min_pedidos ?? 0)],
    ['Manuseio B2B', brl(pr.manuseio_b2b)],
    ['Valor caixa B2B', brl(pr.valor_caixa_b2b)],
    ['Adicional por produto B2B', brl(pr.adic_produto_b2b)],
    ['Franquia de produtos B2B', String(pr.franquia_produtos_b2b ?? 0)],
    ['É B2B a partir de (itens)', String(pr.limite_itens_b2b ?? 0)],
    ['Tipos de caixa inclusos', pr.tipos_caixa_inclusos || '—'],
    ['Cota de caixas / mês', String(pr.cota_caixas_mes ?? 0)],
    ['Cubagem medida (m³)', String(payload.cubagem_m3 ?? 0)],
    ['Franquia grátis (m³)', String(pr.franquia_m3 ?? 0)],
    ['Preço por m³ adicional', brl(pr.preco_m3)],
    ['Cobrar seguro', sn(pr.seguro_incluso)],
    ['Alíquota do seguro (%)', String(pr.aliquota_seguro ?? 0)],
    ['Valor segurado', brl(payload.valor_segurado)],
    ['Armazenagem inclusa', sn(pr.armazenagem_inclusa)],
    ['Cobrança por faixa de pedidos B2C', sn(pr.usar_faixas_pedidos)],
    ['Faixas', faixasTxt(pr)],
    ['Valor mínimo B2C (até o nº mínimo de pedidos)', pr.valor_minimo_b2c ? brl(pr.valor_minimo_b2c) : '—'],
  ];
  if ('franquia_recebimentos' in pr) {
    rows.push(['Franquia de recebimentos de carga', String(pr.franquia_recebimentos ?? 0)]);
    rows.push(['Valor por recebimento acima da franquia', brl(pr.valor_recebimento)]);
  }
  return (
    <div className="bg-surface border border-line-soft rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 text-left hover:bg-surface-2 transition"
      >
        <span>
          <span className="block text-[13px] font-semibold text-t2">Parâmetros do mês</span>
          <span className="block text-[11px] text-t4 mt-0.5">Condições usadas no cálculo desta fatura.</span>
        </span>
        <ChevronDown size={16} className={`text-t4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5">
          <div className="border border-line-soft rounded-xl overflow-hidden text-[13px]">
            {rows.map(([k, v]) => (
              <div key={k}
                className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-x-3 px-3.5 py-2 border-b border-line-soft last:border-b-0">
                <span className="text-t3">{k}</span>
                <span className="font-mono text-t1 sm:text-right break-words">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Notas explicativas do mínimo/faixa (mesmo texto do PDF).
function NotasFatura({ f }: { f: any }) {
  const notas: string[] = [];
  if (f?.min_atingiu_piso) {
    notas.push(`Mínimo mensal B2C: soma real ${brl(f.soma_real_b2c)} < piso ${brl(f.floor_b2c)} → cobra-se o maior.`);
  }
  const fa = f?.faixa_aplicada;
  if (fa) {
    notas.push(`Faixa aplicada: ${fa.de}-${fa.ate} pedidos x ${brl(fa.preco)} (${fa.n_b2c} NFs B2C, cobradas ${fa.qtd_cobrada}).`);
  }
  const mn = f?.minimo_aplicado;
  if (mn) {
    notas.push(`Mínimo do plano: ${mn.n_b2c} NFs B2C (até ${mn.pedidos} pedidos) → cobra-se o valor mínimo de ${brl(mn.valor)} mais os adicionais por NF.`);
  }
  if (!notas.length) return null;
  return (
    <div className="mt-3 space-y-1">
      {notas.map((n, i) => <p key={i} className="text-[11.5px] text-t4 leading-snug">{n}</p>)}
    </div>
  );
}

// ─── Aba ──────────────────────────────────────────────────────────────────────

export default function SellerFinanceTab({ sellerId }: { sellerId: number }) {
  const months = useMemo(lastTwelveMonths, []);
  // Padrão = mês ANTERIOR ao atual (o mês corrente ainda está sendo formado).
  const [refMonth, setRefMonth] = useState(() => months[1] ?? months[0]);

  const { data: payload, isLoading, isError } = useQuery(
    ['my-closing', sellerId, refMonth],
    () => billingApi.myClosing(refMonth).then(r => r.data),
    { enabled: !!refMonth, keepPreviousData: false },
  );

  const label = monthLabel(refMonth);
  const closed = payload?.status === 'closed';
  const vazio = !!payload && !payload.persisted && (payload.n_b2c + payload.n_b2b === 0);

  return (
    <div className="space-y-4">

      {/* Controles: mês + downloads */}
      <div className="flex items-end gap-2.5 flex-wrap">
        <div>
          <label className="block text-[11px] text-t3 mb-1">Mês de referência</label>
          <select
            value={refMonth}
            onChange={e => setRefMonth(e.target.value)}
            className="min-w-[170px] border border-line rounded-lg px-3 py-2 text-sm bg-surface-2 text-t1
              outline-none focus:ring-2 focus:ring-violet-500"
          >
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => billingApi.downloadMyClosingPdf(refMonth)}
          className="flex items-center gap-1.5 border border-line rounded-lg px-3 py-2 text-sm
            bg-surface-2 text-t2 hover:text-t1 hover:border-brand-line transition"
        >
          <Download size={14} /> PDF
        </button>
        <button
          onClick={() => billingApi.downloadMyClosingExcel(refMonth)}
          className="flex items-center gap-1.5 border border-line rounded-lg px-3 py-2 text-sm
            bg-surface-2 text-t2 hover:text-t1 hover:border-brand-line transition"
        >
          <Download size={14} /> Excel
        </button>
      </div>

      {isLoading && (
        <div className="bg-surface border border-line-soft rounded-2xl p-10 text-center text-sm text-t4">
          Carregando fatura de {label}...
        </div>
      )}

      {isError && !isLoading && (
        <div className="bg-surface border border-line-soft rounded-2xl p-10 text-center text-sm text-bad">
          Não foi possível carregar a fatura de {label}.
        </div>
      )}

      {payload && !isLoading && vazio && (
        <div className="bg-surface border border-line-soft rounded-2xl px-5 py-14 text-center">
          <p className="text-[15px] text-t3 mb-1">Nenhuma nota fiscal em {label}</p>
          <p className="text-sm text-t4">Não há faturamento registrado para este mês.</p>
        </div>
      )}

      {payload && !isLoading && !vazio && (
        <>
          {/* Tarja de status */}
          {closed ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-ok/30 bg-ok-soft text-ok px-3.5 py-3 text-[13px] leading-snug">
              <span className="text-[10px] leading-5">●</span>
              <span>Fatura fechada · valores congelados em {ddmmyyyy(payload.closed_at)}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-warn/40 bg-warn-soft text-warn px-3.5 py-3 text-[13px] leading-snug">
              <span className="text-[10px] leading-5">●</span>
              <span>
                Fatura em aberto · valores parciais, recalculados a cada acesso e sujeitos a
                alteração até o fechamento do mês
              </span>
            </div>
          )}

          {/* Parâmetros do mês (recolhível, só leitura) */}
          <ParametrosMes payload={payload} />

          {/* Resumo da fatura */}
          <div className="bg-surface border border-line-soft rounded-2xl p-4 sm:p-5">
            <h2 className="text-[13px] font-semibold text-t2">
              Resumo da fatura — {payload.seller_name} · {label}
            </h2>
            <p className="text-[11px] text-t4 mt-0.5 mb-3.5">Composição do valor cobrado no mês.</p>

            <div className="border border-line-soft rounded-xl overflow-hidden text-[13px]">
              <div className="grid grid-cols-[1.5fr_1fr_1fr] px-3.5 py-2 bg-surface-2 text-[10px]
                uppercase tracking-wider font-semibold text-t4 border-b border-line-soft">
                <span>Componente</span>
                <span className="text-right">B2C</span>
                <span className="text-right">B2B</span>
              </div>
              <FatRow label="Mínimo mensal" b2c={payload.fatura.b2c_min} b2b={payload.fatura.b2b_min} />
              <FatRow label="Seguro"         b2c={payload.fatura.seguro}      b2b={null} />
              <FatRow label="Armazenagem"    b2c={payload.fatura.armazenagem} b2b={null} />
              <FatRow label="Linhas avulsas" b2c={payload.fatura.avulsos}     b2b={null} />
              <FatRow label="Subtotal" strong
                b2c={payload.fatura.subtotal_b2c} b2b={payload.fatura.subtotal_b2b} />
              {payload.fatura.recebimentos && payload.fatura.recebimentos.adicional > 0 && (
                <FatRow label={`Recebimentos de carga (${payload.fatura.recebimentos.qtd} no mês)`}
                  b2c={payload.fatura.recebimentos.adicional} b2b={null} />
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-3 px-4 py-3 rounded-xl bg-t1 text-surface">
              <span className="text-[13px] font-semibold">TOTAL GERAL DA FATURA</span>
              <span className="text-[19px] font-bold font-mono">{brl(payload.fatura.total_geral)}</span>
            </div>
            <NotasFatura f={payload.fatura} />
          </div>

          {/* Linhas avulsas — logo abaixo do resumo, pois é onde o cliente vê o total */}
          {(payload.adjustments || []).length > 0 && (
            <div className="bg-surface border border-line-soft rounded-2xl p-4 sm:p-5">
              <h2 className="text-[13px] font-semibold text-t2">Linhas avulsas</h2>
              <p className="text-[11px] text-t4 mt-0.5 mb-2">Ajustes lançados manualmente pela Kiwkiw.</p>
              <div>
                {payload.adjustments.map((a: any, i: number) => (
                  <div key={i}
                    className="flex items-center justify-between gap-4 py-2.5 border-b border-line-soft
                      last:border-b-0 text-[13px]">
                    <div className="min-w-0">
                      <div className="text-t2">{a.descricao || '—'}</div>
                      {a.obs && (
                        <div className="text-[12px] text-t3 mt-0.5">
                          <span className="text-t4">motivo: </span>{a.obs}
                        </div>
                      )}
                    </div>
                    <div className={`font-semibold font-mono whitespace-nowrap ${a.sign < 0 ? 'text-ok' : 'text-t1'}`}>
                      {a.sign < 0 ? '−' : '+'} {brl(a.valor)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notas fiscais */}
          <div className="bg-surface border border-line-soft rounded-2xl p-4 sm:p-5">
            <h2 className="text-[13px] font-semibold text-t2">Notas fiscais de saída — {label}</h2>
            <p className="text-[11px] text-t4 mt-0.5 mb-3.5">
              Todas as NFs do mês, por data de importação. Clique para ver os SKUs.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NfList kind="b2c" lines={payload.b2c_lines || []} soma={payload.soma_b2c} />
              <NfList kind="b2b" lines={payload.b2b_lines || []} soma={payload.soma_b2b} />
            </div>
            <div className="mt-4">
              <CaixasMes b2c={payload.b2c_lines || []} b2b={payload.b2b_lines || []} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
