/**
 * WMS Kiwkiw — CRM: Dashboard comercial
 * Período vale para novos leads, ganhos/perdidos, conversão, tempo médio e
 * origem. Ativos, etapas do funil, atrasados e sem ação são a FOTO de hoje.
 */

import { useState } from 'react';
import { useQuery } from 'react-query';
import { BarChart3 } from 'lucide-react';
import { crmApi } from '../api';
import PageHeader from '../components/PageHeader';
import { useCrmMeta, inputCls, inputStyle } from '../components/CrmShared';
import { todayBrasiliaStr } from '../timezone';

function daysAgo(n: number): string {
  const [y, m, d] = todayBrasiliaStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - n));
  return dt.toISOString().slice(0, 10);
}

function Kpi({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="bg-surface rounded-2xl border border-line-soft p-4">
      <div className="text-[11px] font-semibold text-t4">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone ?? 'text-t1'}`}>{value}</div>
      {hint && <div className="text-[10px] text-t5 mt-0.5">{hint}</div>}
    </div>
  );
}

function Bars({ title, hint, items }: { title: string; hint?: string; items: { name: string; count: number }[] }) {
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div className="bg-surface rounded-2xl border border-line-soft p-4">
      <h3 className="text-sm font-bold text-t1">{title}</h3>
      {hint && <p className="text-[10px] text-t5 mb-2">{hint}</p>}
      <div className="space-y-1.5 mt-2">
        {items.length === 0 && <p className="text-xs text-t5">Sem dados.</p>}
        {items.map(i => (
          <div key={i.name} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate text-t3" title={i.name}>{i.name}</span>
            <div className="flex-1 h-2.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${(i.count / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right font-semibold text-t2">{i.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CrmDashboardPage() {
  const { data: meta } = useCrmMeta();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayBrasiliaStr());
  const [owner, setOwner] = useState('');
  const [origin, setOrigin] = useState('');
  const [stage, setStage] = useState('');
  const [alert, setAlert] = useState('');

  const params = {
    date_from: from, date_to: to, owner_id: owner || undefined, origin: origin || undefined,
    stage: stage || undefined, alert: alert || undefined,
  };
  const { data, isLoading } = useQuery(['crm-dashboard', params], () => crmApi.dashboard(params), { keepPreviousData: true });
  const k = data?.kpis;

  const preset = (n: number) => { setFrom(daysAgo(n)); setTo(todayBrasiliaStr()); };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader title="Dashboard comercial" subtitle="Visão do funil da Kiwkiw" icon={<BarChart3 size={18} />} />

      <div className="px-6 py-3 flex flex-wrap gap-2 items-center border-b border-line-soft">
        {[[7, '7d'], [30, '30d'], [90, '90d']].map(([n, l]) => (
          <button key={l} onClick={() => preset(n as number)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-line text-t3 hover:bg-surface-2">{l}</button>
        ))}
        <input type="date" className={inputCls + ' !w-auto'} style={inputStyle} value={from} onChange={e => setFrom(e.target.value)} />
        <span className="text-t5 text-xs">até</span>
        <input type="date" className={inputCls + ' !w-auto'} style={inputStyle} value={to} onChange={e => setTo(e.target.value)} />
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">Responsável</option>
          {meta?.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={origin} onChange={e => setOrigin(e.target.value)}>
          <option value="">Origem</option>
          {meta?.origins.map(o => <option key={o}>{o}</option>)}
        </select>
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={stage} onChange={e => setStage(e.target.value)}>
          <option value="">Etapa</option>
          {meta?.stages.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={alert} onChange={e => setAlert(e.target.value)}>
          <option value="">Status da ação</option>
          <option value="atrasado">🔴 Atrasado</option><option value="hoje">🟠 Hoje</option>
          <option value="proximos2">🟡 Próximos 2 dias</option><option value="agendado">🟢 Agendado</option>
          <option value="sem_acao">⚪ Sem próxima ação</option>
        </select>
      </div>

      <div className="p-6 space-y-5">
        {isLoading && <p className="text-xs text-t5">Carregando…</p>}
        {k && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
              <Kpi label="Leads ativos" value={k.active} hint="hoje" />
              <Kpi label="Novos no período" value={k.new_in_period} />
              <Kpi label="Em follow-up" value={k.followup} hint="hoje" />
              <Kpi label="Propostas enviadas" value={k.proposals} hint="hoje" />
              <Kpi label="Em negociação" value={k.negotiation} hint="hoje" />
              <Kpi label="Ganhos" value={k.won} tone="text-ok" hint="no período" />
              <Kpi label="Perdidos" value={k.lost} tone="text-bad" hint="no período" />
              <Kpi label="Ação atrasada" value={k.overdue} tone={k.overdue ? 'text-bad' : undefined} hint="hoje" />
              <Kpi label="Sem próxima ação" value={k.no_action} tone={k.no_action ? 'text-bad' : undefined} hint="hoje" />
              <Kpi label="Taxa de conversão" value={k.conversion_pct === null ? '—' : `${k.conversion_pct}%`} hint="ganhos ÷ (ganhos + perdidos)" />
              <Kpi label="Tempo médio até fechar" value={k.avg_days_to_close === null ? '—' : `${k.avg_days_to_close} d`} hint="1º contato → ganho" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Bars title="Leads por etapa do funil" hint="foto de hoje" items={data.by_stage} />
              <Bars title="Leads por origem" hint="criados no período" items={data.by_origin} />
              <Bars title="Motivos de perda" hint="perdidos no período" items={data.by_loss_reason} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
