/**
 * WMS Kiwkiw — CRM: Leads (tabela e funil/Kanban)
 * Busca por seller/contato, filtros, ordenação por próxima ação, troca de
 * etapa em 1 clique (select ou arrastar no Kanban) e interação rápida.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Users, Plus, LayoutList, Columns3, Search } from 'lucide-react';
import { crmApi, CrmLead } from '../api';
import PageHeader from '../components/PageHeader';
import {
  AlertBadge, StageSelect, ContactLinks, LeadDrawer, InteractionModal,
  useStageChange, useCrmMeta, inputCls, inputStyle, btnPrimary, btnGhost, fmtDate,
} from '../components/CrmShared';

const ALERTS = [
  ['atrasado', '🔴 Atrasado'], ['hoje', '🟠 Hoje'], ['proximos2', '🟡 Próximos 2 dias'],
  ['agendado', '🟢 Agendado'], ['sem_acao', '⚪ Sem próxima ação'],
];

type SortKey = 'next_asc' | 'next_desc' | 'company' | 'recent';

export default function CrmLeadsPage() {
  const qc = useQueryClient();
  const { data: meta } = useCrmMeta();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [origin, setOrigin] = useState('');
  const [stage, setStage] = useState('');
  const [alert, setAlert] = useState('');
  const [status, setStatus] = useState<'active' | 'closed' | 'all'>('active');
  const [sort, setSort] = useState<SortKey>('next_asc');
  const [drawer, setDrawer] = useState<number | null | undefined>(undefined);
  const [inter, setInter] = useState<CrmLead | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  // Kanban mostra todas as etapas: o filtro de status "ativos" esconderia Ganho/Perdido.
  const effStatus = view === 'kanban' ? 'all' : status;
  const params = {
    search: search || undefined, owner_id: owner || undefined, origin: origin || undefined,
    stage: stage || undefined, alert: alert || undefined, status: effStatus,
  };
  const { data, isLoading } = useQuery(['crm-leads', params], () => crmApi.leads(params), { keepPreviousData: true });

  const refresh = () => { qc.invalidateQueries('crm-leads'); qc.invalidateQueries('crm-today'); qc.invalidateQueries('crm-dashboard'); qc.invalidateQueries('crm-lead'); };
  const { request: moveStage, modal: lossModal } = useStageChange(refresh);

  const rows = useMemo(() => {
    const r = [...(data ?? [])];
    const far = '9999-12-31';
    if (sort === 'next_asc') r.sort((a, b) => (a.next_action_date ?? far).localeCompare(b.next_action_date ?? far));
    if (sort === 'next_desc') r.sort((a, b) => (b.next_action_date ?? '').localeCompare(a.next_action_date ?? ''));
    if (sort === 'company') r.sort((a, b) => a.company.localeCompare(b.company));
    if (sort === 'recent') r.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return r;
  }, [data, sort]);

  const shown = rows;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Leads"
        subtitle={`${rows.length} lead(s)`}
        icon={<Users size={18} />}
        actions={<>
          <div className="flex rounded-lg border border-line overflow-hidden">
            <button className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${view === 'table' ? 'bg-violet-600 text-white' : 'text-t3'}`}
                    onClick={() => setView('table')}><LayoutList size={14} />Tabela</button>
            <button className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${view === 'kanban' ? 'bg-violet-600 text-white' : 'text-t3'}`}
                    onClick={() => setView('kanban')}><Columns3 size={14} />Funil</button>
          </div>
          <button className={btnPrimary} onClick={() => setDrawer(null)}><Plus size={14} />Novo lead</button>
        </>}
      />

      <div className="px-6 py-3 flex flex-wrap gap-2 items-center border-b border-line-soft">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-t5" />
          <input className={inputCls + ' !pl-8 !w-56'} style={inputStyle} placeholder="Buscar seller ou contato…"
                 value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">Responsável</option>
          {meta?.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={origin} onChange={e => setOrigin(e.target.value)}>
          <option value="">Origem</option>
          {meta?.origins.map(o => <option key={o}>{o}</option>)}
        </select>
        {view === 'table' && (
          <select className={inputCls + ' !w-auto'} style={inputStyle} value={stage} onChange={e => setStage(e.target.value)}>
            <option value="">Etapa</option>
            {meta?.stages.map(s => <option key={s}>{s}</option>)}
          </select>
        )}
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={alert} onChange={e => setAlert(e.target.value)}>
          <option value="">Status da ação</option>
          {ALERTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {view === 'table' && (
          <select className={inputCls + ' !w-auto'} style={inputStyle} value={status} onChange={e => setStatus(e.target.value as any)}>
            <option value="active">Ativos</option>
            <option value="closed">Encerrados</option>
            <option value="all">Todos</option>
          </select>
        )}
        <select className={inputCls + ' !w-auto'} style={inputStyle} value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          <option value="next_asc">Próxima ação ↑ (mais cedo)</option>
          <option value="next_desc">Próxima ação ↓</option>
          <option value="company">Seller A–Z</option>
          <option value="recent">Mais recentes</option>
        </select>
        {(search || owner || origin || stage || alert) && (
          <button className={btnGhost} onClick={() => { setSearch(''); setOwner(''); setOrigin(''); setStage(''); setAlert(''); }}>Limpar</button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && <p className="text-xs text-t5">Carregando…</p>}

        {view === 'table' && (
          <div className="bg-surface rounded-2xl border border-line-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-t4 border-b border-line-soft">
                  <th className="px-3 py-2">Seller / contato</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Próxima ação</th>
                  <th className="px-3 py-2">Alerta</th>
                  <th className="px-3 py-2">Último contato</th>
                  <th className="px-3 py-2">No funil</th>
                  <th className="px-3 py-2">Contato</th>
                  <th className="px-3 py-2">Responsável</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.id} onClick={() => setDrawer(l.id)}
                      className="border-b border-line-soft last:border-0 hover:bg-surface-2 cursor-pointer">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-t1">{l.company}</div>
                      <div className="text-xs text-t4">{l.contact_name || '—'}{l.origin ? ` · ${l.origin}` : ''}</div>
                    </td>
                    <td className="px-3 py-2"><StageSelect lead={l} onPick={moveStage} /></td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-t2 font-medium">{l.next_action_type ?? '—'}</div>
                      <div className="text-t4">{fmtDate(l.next_action_date)}</div>
                    </td>
                    <td className="px-3 py-2"><AlertBadge alert={l.alert} />{l.stage === 'Perdido' && <span className="text-xs text-t4">{l.loss_reason}</span>}</td>
                    <td className="px-3 py-2 text-xs text-t3">
                      {l.last_contact_date ? <>{fmtDate(l.last_contact_date)}<br /><span className="text-t5">há {l.days_since_last_contact} dia(s)</span></> : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-t3">{l.days_in_funnel} d</td>
                    <td className="px-3 py-2"><ContactLinks lead={l} /></td>
                    <td className="px-3 py-2 text-xs text-t3">{l.owner_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {l.alert && <button className={btnGhost} onClick={e => { e.stopPropagation(); setInter(l); }}><Plus size={13} />Interação</button>}
                    </td>
                  </tr>
                ))}
                {!isLoading && shown.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-t5">Nenhum lead encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {view === 'kanban' && meta && (
          <div className="flex gap-3 min-w-max pb-2">
            {meta.stages.map(s => {
              const col = shown.filter(l => l.stage === s);
              return (
                <div key={s} className="w-64 flex-shrink-0 bg-surface-2 rounded-2xl p-2.5"
                     onDragOver={e => e.preventDefault()}
                     onDrop={() => { const l = shown.find(x => x.id === dragId); if (l) moveStage(l, s); setDragId(null); }}>
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-bold text-t2">{s}</span>
                    <span className="text-[11px] text-t4">{col.length}</span>
                  </div>
                  <div className="space-y-2">
                    {col.map(l => (
                      <div key={l.id} draggable onDragStart={() => setDragId(l.id)} onClick={() => setDrawer(l.id)}
                           className="bg-surface border border-line-soft rounded-xl p-2.5 cursor-pointer hover:border-brand-line">
                        <div className="font-semibold text-sm text-t1 leading-tight">{l.company}</div>
                        <div className="text-[11px] text-t4">{l.contact_name || '—'}</div>
                        <div className="mt-1.5"><AlertBadge alert={l.alert} /></div>
                        {l.next_action_type && (
                          <div className="text-[11px] text-t3 mt-1">{l.next_action_type} · {fmtDate(l.next_action_date)}</div>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <StageSelect lead={l} onPick={moveStage} className="!text-[11px] !py-0.5" />
                          {l.alert && (
                            <button className="text-[11px] text-brand hover:underline"
                                    onClick={e => { e.stopPropagation(); setInter(l); }}>+ interação</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lossModal}
      {drawer !== undefined && <LeadDrawer leadId={drawer} onClose={() => setDrawer(undefined)} onSaved={refresh} />}
      {inter && <InteractionModal lead={inter} onClose={() => setInter(null)} onDone={() => { setInter(null); refresh(); }} />}
    </div>
  );
}
