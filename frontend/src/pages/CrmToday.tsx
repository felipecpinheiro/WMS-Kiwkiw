/**
 * WMS Kiwkiw — CRM: "O que fazer hoje"
 * Tela operacional principal: abre de manhã e mostra, em ordem de prioridade,
 * o que precisa de atenção. Princípio: todo lead ativo tem uma próxima ação.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { CalendarCheck, Plus, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { crmApi, CrmLead } from '../api';
import PageHeader from '../components/PageHeader';
import {
  AlertBadge, StageBadge, ContactLinks, LeadDrawer, InteractionModal,
  inputCls, inputStyle, btnPrimary, btnGhost, fmtDate, errMsg, useCrmMeta,
} from '../components/CrmShared';

type Section = { key: string; title: string; tone: string; rows: CrmLead[]; empty: string };

export default function CrmTodayPage() {
  const qc = useQueryClient();
  const { data: meta } = useCrmMeta();
  const [owner, setOwner] = useState('');
  const [drawer, setDrawer] = useState<number | null | undefined>(undefined); // undefined = fechado, null = novo
  const [inter, setInter] = useState<CrmLead | null>(null);

  const { data, isLoading } = useQuery(['crm-today', owner],
    () => crmApi.today(owner ? { owner_id: Number(owner) } : undefined), { refetchOnWindowFocus: true });

  const refresh = () => { qc.invalidateQueries('crm-today'); qc.invalidateQueries('crm-leads'); qc.invalidateQueries('crm-dashboard'); };

  const reopen = async (l: CrmLead) => {
    try { await crmApi.reopen(l.id); toast.success('Lead reativado'); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const sections: Section[] = data ? [
    { key: 'overdue', title: '🔴 Ações atrasadas', tone: 'text-bad', rows: data.overdue, empty: 'Nenhuma ação atrasada.' },
    { key: 'today', title: '🟠 Para hoje', tone: 'text-warn', rows: data.due_today, empty: 'Nada programado para hoje.' },
    { key: 'next2', title: '🟡 Próximos 2 dias', tone: 'text-warn', rows: data.next2, empty: 'Nada nos próximos 2 dias.' },
    { key: 'none', title: '⚪ Leads ativos SEM próxima ação', tone: 'text-t2', rows: data.no_action, empty: 'Todo lead ativo tem próxima ação. 👏' },
    { key: 'react', title: '🔁 Reativação sugerida (perdidos que chegaram na data)', tone: 'text-info', rows: data.reactivate, empty: '' },
  ] : [];

  const totalPending = data ? data.overdue.length + data.due_today.length + data.no_action.length : 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="O que fazer hoje"
        subtitle={data ? `${totalPending} pendência(s) pedindo atenção agora` : 'Comercial'}
        icon={<CalendarCheck size={18} />}
        actions={<>
          <select className={inputCls + ' !w-auto'} style={inputStyle} value={owner} onChange={e => setOwner(e.target.value)}>
            <option value="">Todos os responsáveis</option>
            {meta?.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className={btnPrimary} onClick={() => setDrawer(null)}><Plus size={14} />Novo lead</button>
        </>}
      />

      <div className="p-6 space-y-6">
        {isLoading && <p className="text-xs text-t5">Carregando…</p>}
        {sections.map(sec => (
          (sec.rows.length > 0 || sec.empty) && (
            <section key={sec.key}>
              <h2 className={`text-sm font-bold mb-2 ${sec.tone}`}>
                {sec.title} <span className="text-t4 font-normal">({sec.rows.length})</span>
              </h2>
              {sec.rows.length === 0 ? (
                <p className="text-xs text-t5 px-1">{sec.empty}</p>
              ) : (
                <div className="bg-surface rounded-2xl border border-line-soft overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] text-t4 border-b border-line-soft">
                        <th className="px-3 py-2">Seller / contato</th>
                        <th className="px-3 py-2">Etapa</th>
                        <th className="px-3 py-2">Último contato</th>
                        <th className="px-3 py-2">Próxima ação</th>
                        <th className="px-3 py-2">Contato</th>
                        <th className="px-3 py-2">Responsável</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map(l => (
                        <tr key={l.id} onClick={() => setDrawer(l.id)}
                            className="border-b border-line-soft last:border-0 hover:bg-surface-2 cursor-pointer">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-t1">{l.company}</div>
                            <div className="text-xs text-t4">{l.contact_name || '—'}</div>
                          </td>
                          <td className="px-3 py-2"><StageBadge stage={l.stage} /></td>
                          <td className="px-3 py-2 text-xs text-t3">
                            {l.last_contact_date ? <>{fmtDate(l.last_contact_date)}<br /><span className="text-t5">há {l.days_since_last_contact} dia(s)</span></> : '—'}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {sec.key === 'react' ? (
                              <span className="text-info">Reativar desde {fmtDate(l.reactivation_date)}</span>
                            ) : (
                              <>
                                <div className="text-t2 font-medium">{l.next_action_type ?? '—'}</div>
                                <div className="flex items-center gap-1.5 text-t4">{fmtDate(l.next_action_date)} <AlertBadge alert={l.alert} /></div>
                                {l.suggest_close && <div className="text-warn mt-0.5">Sugerir encerrar: Sem retorno</div>}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2"><ContactLinks lead={l} /></td>
                          <td className="px-3 py-2 text-xs text-t3">{l.owner_name ?? '—'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {sec.key === 'react' ? (
                              <button className={btnGhost} onClick={e => { e.stopPropagation(); reopen(l); }}><RotateCcw size={13} />Reativar</button>
                            ) : (
                              <button className={btnGhost} onClick={e => { e.stopPropagation(); setInter(l); }}><Plus size={13} />Interação</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        ))}
      </div>

      {drawer !== undefined && (
        <LeadDrawer leadId={drawer} onClose={() => setDrawer(undefined)} onSaved={refresh} />
      )}
      {inter && (
        <InteractionModal lead={inter} onClose={() => setInter(null)} onDone={() => { setInter(null); refresh(); }} />
      )}
    </div>
  );
}
