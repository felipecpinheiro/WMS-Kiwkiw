/**
 * WMS Kiwkiw - Aba "Dashboard" do Portal do Seller (09/09/2026)
 * ============================================================
 * Visão consolidada e SOMENTE LEITURA do próprio seller. Cada bloco tem o
 * período que faz sentido para ele:
 *   - Hoje ........... status dos pedidos do dia
 *   - 30 dias ........ pedidos por dia (janela fixa)
 *   - 12 meses ....... NFs por mês (janela fixa)
 *   - agora .......... resumo de estoque + SKUs prestes a romper
 *   - editável ....... top SKUs mais vendidos (de/até + quantidade)
 *
 * Dados prontos do backend, escopados pelo token:
 *   GET /dashboard/seller/analytics   e   GET /dashboard/seller/top-skus
 * NÃO é faturamento — contagem total, sem classificação B2C/B2B.
 */

import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { dashboardApi } from '../api';
import { todayBrasiliaStr } from '../timezone';
import { useChartColors } from '../hooks/useChartColors';
import { useIsMobile } from '../hooks/useIsMobile';
import FulfillmentLoader from '../components/FulfillmentLoader';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** '2026-08-14' -> '14/08' */
const dd = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** '2026-08' -> 'ago/26' */
const mmm = (s: string) => `${MONTHS_PT[Number(s.slice(5, 7)) - 1]}/${s.slice(2, 4)}`;

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── tiles ────────────────────────────────────────────────────────────────────

function Tile({ label, value, tone = 't1' }: { label: string; value: number | string; tone?: string }) {
  const toneCls: Record<string, string> = {
    t1: 'text-t1', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', brand: 'text-brand',
  };
  return (
    <div className="bg-surface-2 rounded-xl p-3 text-center">
      <p className="text-[10px] text-t4 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${toneCls[tone] ?? 'text-t1'}`}>{value}</p>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line-soft rounded-2xl p-4 sm:p-5">
      <h2 className="text-[13px] font-semibold text-t2">{title}</h2>
      {subtitle && <p className="text-[11px] text-t4 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

// ─── aba ──────────────────────────────────────────────────────────────────────

export default function SellerDashboardTab({
  sellerId, onSelectSku,
}: {
  sellerId: number;
  onSelectSku: (sku: string) => void;
}) {
  const isMobile = useIsMobile();
  const cc = useChartColors();

  const { data, isLoading, isError } = useQuery(
    ['seller-analytics', sellerId],
    () => dashboardApi.sellerAnalytics().then(r => r.data),
    { enabled: !!sellerId, refetchInterval: 120000 },
  );

  // Bloco 6 — período e quantidade editáveis
  const [topFrom, setTopFrom] = useState(() => daysAgoStr(30));
  const [topTo, setTopTo]     = useState(() => todayBrasiliaStr());
  const [topLimit, setTopLimit] = useState(10);

  const { data: top, isFetching: topFetching } = useQuery(
    ['seller-top-skus', sellerId, topFrom, topTo, topLimit],
    () => dashboardApi.sellerTopSkus({
      date_from: topFrom || undefined,
      date_to: topTo || undefined,
      limit: topLimit,
    }).then(r => r.data),
    { enabled: !!sellerId, keepPreviousData: true },
  );

  const showLoader = useDelayedLoading(isLoading, 150);

  const t = data?.today;
  const statusSegments = useMemo(() => {
    if (!t || t.total === 0) return [];
    return [
      { key: 'completed',      label: 'Concluídos',     value: t.completed,      color: cc.brand },
      { key: 'in_preparation', label: 'Em preparação',  value: t.in_preparation, color: '#8b7bf0' },
      { key: 'pending',        label: 'Pendentes',      value: t.pending,        color: cc.axisText },
      { key: 'interrupted',    label: 'Interrompidos',  value: t.interrupted,    color: cc.bad },
    ].filter(s => s.value > 0);
  }, [t, cc]);

  const topMax = Math.max(1, ...(top?.rows ?? []).map(r => r.total_out));

  return (
    <div className="relative space-y-4">
      <FulfillmentLoader show={showLoader} title="Preparando seus dados" />

      {isError && !isLoading && (
        <div className="bg-surface border border-line-soft rounded-2xl p-10 text-center text-sm text-bad">
          Não foi possível carregar o painel.
        </div>
      )}

      {data && (
        <>
          {/* ── Bloco 1 — Hoje ───────────────────────────────────────────── */}
          <Card title="Hoje" subtitle={`Status dos pedidos importados em ${dd(t!.date)}`}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <Tile label="Pedidos"       value={t!.total} />
              <Tile label="Concluídos"    value={t!.completed}      tone="ok" />
              <Tile label="Em preparação" value={t!.in_preparation} tone="brand" />
              <Tile label="Pendentes"     value={t!.pending} />
              <Tile label="Interrompidos" value={t!.interrupted}    tone="warn" />
            </div>
            {statusSegments.length > 0 ? (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-surface-2">
                  {statusSegments.map(s => (
                    <div key={s.key} title={`${s.label}: ${s.value}`}
                      style={{ width: `${(s.value / t!.total) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {statusSegments.map(s => (
                    <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-t3">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                      {s.label} · {s.value}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-t4 py-3 text-center">Nenhum pedido importado hoje.</p>
            )}
          </Card>

          {/* ── Bloco 2 — Pedidos por dia (30d) ──────────────────────────── */}
          <Card title="Pedidos por Dia" subtitle="Últimos 30 dias, por data de importação">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.orders_per_day} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                <XAxis dataKey="date" tickFormatter={dd} tick={{ fontSize: 10, fill: cc.axisText }}
                  interval={isMobile ? 5 : 3} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: cc.axisText }} />
                <Tooltip
                  cursor={{ fill: cc.grid, fillOpacity: 0.35 }}
                  labelFormatter={(v) => dd(String(v))}
                  formatter={(v) => [v, 'Pedidos']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, background: cc.tooltipBg, border: `1px solid ${cc.tooltipBorder}`, color: cc.tooltipText }} />
                <Bar dataKey="count" name="Pedidos" fill={cc.brand} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* ── Bloco 3 — NFs por mês (12m) ──────────────────────────────── */}
          <Card title="Pedidos por Mês" subtitle="Comparativo dos últimos 12 meses">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.nfs_per_month} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                <XAxis dataKey="month" tickFormatter={mmm} tick={{ fontSize: 10, fill: cc.axisText }}
                  interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: cc.axisText }} />
                <Tooltip
                  cursor={{ fill: cc.grid, fillOpacity: 0.35 }}
                  labelFormatter={(v) => mmm(String(v))}
                  formatter={(v) => [v, 'Pedidos']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, background: cc.tooltipBg, border: `1px solid ${cc.tooltipBorder}`, color: cc.tooltipText }} />
                <Bar dataKey="count" name="Pedidos" fill="#8b7bf0" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* ── Bloco 5 — Estoque agora ──────────────────────────────────── */}
          <Card title="Estoque agora" subtitle={`${data.stock_summary.total_skus} SKU(s) com posição`}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Tile label="Nível alto"       value={data.stock_summary.alto} />
              <Tile label="Nível médio"      value={data.stock_summary.medio} tone="warn" />
              <Tile label="Nível baixo"      value={data.stock_summary.baixo} tone="bad" />
              <Tile label="Sem saídas (60d)" value={data.stock_summary.sem_saida} tone="t1" />
              <Tile label="Em ruptura"       value={data.stock_summary.ruptura} tone="bad" />
            </div>
          </Card>

          {/* ── Bloco 5b — Vai romper em ≤15 dias ────────────────────────── */}
          <Card
            title="Prestes a romper"
            subtitle="Previsão de até 15 dias pela média de saídas dos últimos 60 dias"
          >
            {data.rupture_soon.length === 0 ? (
              <p className="text-sm text-t4 py-3 text-center">Nenhum SKU com ruptura prevista para os próximos 15 dias.</p>
            ) : (
              <div className="divide-y divide-line-soft">
                {data.rupture_soon.map(r => (
                  <button
                    key={r.sku}
                    onClick={() => onSelectSku(r.sku)}
                    className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-surface-2 transition rounded-lg px-2 -mx-2"
                  >
                    <AlertTriangle size={14} className="text-bad flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-t1 truncate">{r.product_name}</p>
                      <p className="text-[11px] font-mono text-t4">{r.sku}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-t1 tabular-nums">{r.current_stock}</p>
                      <p className="text-[11px] text-bad">~{r.days_remaining} dia{r.days_remaining === 1 ? '' : 's'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* ── Bloco 6 — Top SKUs mais vendidos ─────────────────────────── */}
          <Card title="Mais vendidos" subtitle="SKUs com maior saída de estoque no período escolhido">
            <div className="flex flex-wrap items-end gap-2.5 mb-4">
              <div>
                <label className="block text-[11px] text-t3 mb-1">De</label>
                <input type="date" value={topFrom} max={topTo} onChange={e => setTopFrom(e.target.value)}
                  className="border border-line rounded-lg px-2.5 py-1.5 text-xs bg-surface-2 text-t2 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-[11px] text-t3 mb-1">Até</label>
                <input type="date" value={topTo} min={topFrom} onChange={e => setTopTo(e.target.value)}
                  className="border border-line rounded-lg px-2.5 py-1.5 text-xs bg-surface-2 text-t2 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-[11px] text-t3 mb-1">Qtd. de SKUs</label>
                <select value={topLimit} onChange={e => setTopLimit(Number(e.target.value))}
                  className="border border-line rounded-lg px-2.5 py-1.5 text-xs bg-surface-2 text-t1 outline-none focus:ring-2 focus:ring-violet-500">
                  {[5, 10, 15, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {topFetching && !top ? (
              <p className="text-sm text-t4 py-6 text-center">Carregando...</p>
            ) : !top || top.rows.length === 0 ? (
              <p className="text-sm text-t4 py-6 text-center">Nenhuma saída de estoque no período.</p>
            ) : (
              <div className="space-y-2">
                {top.rows.map((r, i) => (
                  <button
                    key={r.sku}
                    onClick={() => onSelectSku(r.sku)}
                    className="w-full flex items-center gap-3 text-left group"
                  >
                    <span className="text-[11px] font-mono text-t5 w-5 flex-shrink-0 text-right">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] text-t1 truncate group-hover:text-brand transition">{r.product_name}</span>
                        <span className="text-[13px] font-bold text-t1 tabular-nums flex-shrink-0">{r.total_out}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(r.total_out / topMax) * 100}%`, background: cc.brand }} />
                      </div>
                      <p className="text-[10px] font-mono text-t4 mt-0.5">{r.sku}</p>
                    </div>
                  </button>
                ))}
                <p className="text-[11px] text-t4 flex items-center gap-1.5 pt-1">
                  <TrendingDown size={11} /> saídas de {dd(top.date_from)} a {dd(top.date_to)}
                </p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
