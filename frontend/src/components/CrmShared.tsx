/**
 * WMS Kiwkiw — peças compartilhadas do CRM comercial (23/09/2026)
 *
 * Alerta, troca de etapa (com modal de perda), registro de interação com data
 * sugerida pela cadência e o painel lateral do lead. Todas as regras
 * (cadência, "lead ativo precisa de próxima ação", motivo de perda) vivem no
 * servidor — aqui a tela só antecipa e mostra a mensagem do 422.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { X, Plus, Mail, MessageCircle, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { crmApi, CrmLead, CrmMeta, CrmAlert, CrmSuggestion } from '../api';
import { todayBrasiliaStr, nowBrasilia } from '../timezone';

export const inputCls =
  'w-full px-2.5 py-1.5 border border-line rounded-lg text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500 placeholder-t5';
export const inputStyle = { background: 'rgb(var(--surface-2))' };
export const btnPrimary =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500 transition disabled:opacity-50';
export const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-t2 border border-line hover:bg-surface-2 transition';

export const errMsg = (err: any, fallback = 'Não foi possível salvar') => {
  const d = err?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export function useCrmMeta() {
  return useQuery<CrmMeta>(['crm-meta'], crmApi.meta, { staleTime: 5 * 60 * 1000 });
}

// ── Alerta ───────────────────────────────────────────────────────────────────
const ALERT_UI: Record<string, { label: string; cls: string }> = {
  atrasado:  { label: '🔴 ATRASADO',          cls: 'bg-bad-soft text-bad' },
  hoje:      { label: '🟠 HOJE',              cls: 'bg-warn-soft text-warn' },
  proximos2: { label: '🟡 PRÓXIMOS 2 DIAS',   cls: 'bg-warn-soft text-warn' },
  agendado:  { label: '🟢 AGENDADO',          cls: 'bg-ok-soft text-ok' },
  sem_acao:  { label: '⚪ SEM PRÓXIMA AÇÃO',  cls: 'bg-surface-2 text-t3 ring-1 ring-bad' },
};

export function AlertBadge({ alert }: { alert: CrmAlert }) {
  if (!alert) return null;
  const u = ALERT_UI[alert];
  return (
    <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold ${u.cls}`}>
      {u.label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const cls =
    stage === 'Ganho' ? 'bg-ok-soft text-ok'
    : stage === 'Perdido' ? 'bg-bad-soft text-bad'
    : 'bg-brand-soft text-brand';
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{stage}</span>;
}

// ── Contato ──────────────────────────────────────────────────────────────────
export function ContactLinks({ lead }: { lead: CrmLead }) {
  const digits = (lead.phone || '').replace(/\D/g, '');
  const wa = digits ? (digits.length <= 11 ? `55${digits}` : digits) : '';
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {lead.phone ? (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
           className="inline-flex items-center gap-1 text-ok hover:underline" title="Abrir no WhatsApp">
          <MessageCircle size={13} />{lead.phone}
        </a>
      ) : <span className="text-t5">sem telefone</span>}
      {lead.email && (
        <a href={`mailto:${lead.email}`} onClick={e => e.stopPropagation()}
           className="inline-flex items-center gap-1 text-info hover:underline" title={lead.email}>
          <Mail size={13} />e-mail
        </a>
      )}
    </span>
  );
}

// ── Modal base ───────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
         onMouseDown={e => { e.stopPropagation(); onClose(); }}>
      <div className={`bg-surface rounded-2xl border border-line w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
           onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line-soft">
          <h3 className="font-bold text-t1 text-sm">{title}</h3>
          <button onClick={onClose} className="text-t4 hover:text-t1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-[11px] font-semibold text-t4 mb-1">{label}</span>
    {children}
  </label>
);

// ── Troca de etapa (Perdido pede motivo) ─────────────────────────────────────
function LossModal({ lead, meta, onClose, onDone }: {
  lead: CrmLead; meta: CrmMeta; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reactivate, setReactivate] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await crmApi.changeStage(lead.id, {
        stage: 'Perdido', loss_reason: reason,
        reactivation_date: reason === meta.loss_momento && reactivate ? reactivate : null,
      });
      toast.success('Lead marcado como perdido');
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Encerrar “${lead.company}” como Perdido`} onClose={onClose}>
      <Field label="Motivo da perda *">
        <select className={inputCls} style={inputStyle} value={reason} onChange={e => setReason(e.target.value)}>
          <option value="">Selecione…</option>
          {meta.loss_reasons.map(r => <option key={r}>{r}</option>)}
        </select>
      </Field>
      {reason === meta.loss_momento && (
        <Field label="Reativar em (opcional)">
          <input type="date" className={inputCls} style={inputStyle} value={reactivate} min={todayBrasiliaStr()}
                 onChange={e => setReactivate(e.target.value)} />
        </Field>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button className={btnGhost} onClick={onClose}>Cancelar</button>
        <button className={btnPrimary} disabled={!reason || busy} onClick={save}>Confirmar</button>
      </div>
    </Modal>
  );
}

/** Hook: `request(lead, stage)` decide entre trocar direto ou abrir o modal de perda. */
export function useStageChange(onDone: () => void) {
  const { data: meta } = useCrmMeta();
  const [loss, setLoss] = useState<CrmLead | null>(null);
  const request = async (lead: CrmLead, stage: string) => {
    if (stage === lead.stage) return;
    if (stage === 'Perdido') { setLoss(lead); return; }
    try {
      await crmApi.changeStage(lead.id, { stage });
      onDone();
    } catch (e) {
      toast.error(errMsg(e, 'Não foi possível mudar a etapa'));
    }
  };
  const modal = loss && meta ? (
    <LossModal lead={loss} meta={meta} onClose={() => setLoss(null)}
               onDone={() => { setLoss(null); onDone(); }} />
  ) : null;
  return { request, modal };
}

export function StageSelect({ lead, onPick, className = '' }: {
  lead: CrmLead; onPick: (lead: CrmLead, stage: string) => void; className?: string;
}) {
  const { data: meta } = useCrmMeta();
  return (
    <select
      value={lead.stage}
      onClick={e => e.stopPropagation()}
      onChange={e => onPick(lead, e.target.value)}
      className={`px-2 py-1 border border-line rounded-lg text-xs text-t2 outline-none focus:ring-2 focus:ring-violet-500 ${className}`}
      style={inputStyle}
    >
      {(meta?.stages ?? [lead.stage]).map(s => <option key={s}>{s}</option>)}
    </select>
  );
}

// ── Nova interação ───────────────────────────────────────────────────────────
// Opção do dropdown de etapa que encerra o lead como Perdido (motivo "Não evoluiu").
const NAO_EVOLUIU = '__nao_evoluiu';
export function InteractionModal({ lead, onClose, onDone }: {
  lead: CrmLead; onClose: () => void; onDone: () => void;
}) {
  const { data: meta } = useCrmMeta();
  const now = nowBrasilia();
  const [date, setDate] = useState(todayBrasiliaStr());
  const [time, setTime] = useState(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  const [type, setType] = useState('WhatsApp');
  const [channel, setChannel] = useState('WhatsApp');
  const [owner, setOwner] = useState<number | ''>(lead.owner_id ?? '');
  const [summary, setSummary] = useState('');
  const [effective, setEffective] = useState(true);
  const [responded, setResponded] = useState(false);
  const [outcome, setOutcome] = useState('interesse');
  const [clientDate, setClientDate] = useState('');
  const [stage, setStage] = useState(lead.stage);
  const [naType, setNaType] = useState(lead.next_action_type ?? 'WhatsApp');
  const [naDate, setNaDate] = useState(lead.next_action_date ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Se o usuário editar à mão, a sugestão deixa de sobrescrever (a data é dele).
  const touched = useRef({ stage: false, type: false, date: false });

  useEffect(() => {
    let alive = true;
    crmApi.suggest({
      lead_id: lead.id, effective, responded, outcome: responded ? outcome : null,
      client_date: clientDate || null, base_date: date,
    }).then((s: CrmSuggestion) => {
      if (!alive) return;
      setReason(s.reason);
      if (!touched.current.stage) setStage(s.stage);
      if (!touched.current.type) setNaType(s.next_action_type);
      if (!touched.current.date) setNaDate(s.next_action_date);
    }).catch(() => {});
    return () => { alive = false; };
  }, [lead.id, effective, responded, outcome, clientDate, date]);

  const save = async () => {
    setBusy(true);
    try {
      await crmApi.addInteraction(lead.id, {
        occurred_date: date, occurred_time: time, contact_type: type, channel,
        owner_id: owner || null, summary, effective, responded,
        stage: stage === NAO_EVOLUIU ? 'Perdido' : stage,
        loss_reason: stage === NAO_EVOLUIU ? 'Não evoluiu' : null,
        next_action_type: stage === NAO_EVOLUIU ? null : naType,
        next_action_date: stage === NAO_EVOLUIU ? null : naDate || null,
      });
      toast.success('Interação registrada');
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (!meta) return null;
  const stages = meta.stages.filter(s => s !== 'Perdido');
  const naoEvoluiu = stage === NAO_EVOLUIU;
  return (
    <Modal title={`Nova interação — ${lead.company}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data"><input type="date" className={inputCls} style={inputStyle} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Hora"><input type="time" className={inputCls} style={inputStyle} value={time} onChange={e => setTime(e.target.value)} /></Field>
        <Field label="Tipo de contato">
          <select className={inputCls} style={inputStyle} value={type} onChange={e => setType(e.target.value)}>
            {meta.contact_types.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Canal">
          <select className={inputCls} style={inputStyle} value={channel} onChange={e => setChannel(e.target.value)}>
            {meta.channels.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Responsável">
          <select className={inputCls} style={inputStyle} value={owner} onChange={e => setOwner(e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>
            {meta.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Resumo da interação">
        <textarea rows={3} className={inputCls} style={inputStyle} value={summary} onChange={e => setSummary(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-t2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={effective || responded} disabled={responded}
                 onChange={e => setEffective(e.target.checked)} />
          Contato efetivo (conta no 1º/2º/3º contato)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={responded} onChange={e => setResponded(e.target.checked)} />
          Cliente respondeu
        </label>
      </div>
      {responded && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="O que aconteceu">
            <select className={inputCls} style={inputStyle} value={outcome} onChange={e => setOutcome(e.target.value)}>
              {meta.outcomes.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Cliente pediu retorno em (prevalece)">
            <input type="date" className={inputCls} style={inputStyle} value={clientDate}
                   onChange={e => { setClientDate(e.target.value); touched.current.date = false; }} />
          </Field>
        </div>
      )}

      <div className="rounded-xl border border-brand-line bg-brand-soft p-3 space-y-2">
        <div className="text-[11px] font-semibold text-brand">Próxima ação (sugerida — pode editar)</div>
        <div className="grid grid-cols-3 gap-2">
          <select className={inputCls} style={inputStyle} value={stage}
                  onChange={e => { touched.current.stage = true; setStage(e.target.value); }}>
            {stages.map(s => <option key={s}>{s}</option>)}
            <option value={NAO_EVOLUIU}>Perdido — Não evoluiu</option>
          </select>
          <select className={inputCls} style={inputStyle} value={naType} disabled={naoEvoluiu}
                  onChange={e => { touched.current.type = true; setNaType(e.target.value); }}>
            {meta.action_types.map(s => <option key={s}>{s}</option>)}
          </select>
          <input type="date" className={inputCls} style={inputStyle} value={naDate} disabled={naoEvoluiu}
                 onChange={e => { touched.current.date = true; setNaDate(e.target.value); }} />
        </div>
        {naoEvoluiu
          ? <div className="text-[11px] text-bad">O lead será encerrado como Perdido — motivo “Não evoluiu”.</div>
          : reason && <div className="text-[11px] text-t3">{reason}</div>}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button className={btnGhost} onClick={onClose}>Cancelar</button>
        <button className={btnPrimary} disabled={busy || (stage !== 'Ganho' && !naoEvoluiu && !naDate)} onClick={save}>
          <Save size={14} />Registrar
        </button>
      </div>
    </Modal>
  );
}

// ── Painel do lead (criar / editar / histórico) ──────────────────────────────
const EMPTY = {
  company: '', contact_name: '', role_title: '', email: '', phone: '', origin: '',
  owner_id: '' as number | '', first_contact_date: '', second_contact_date: '',
  third_contact_date: '', proposal_date: '', stage: 'Novo lead', next_action_type: 'WhatsApp',
  next_action_date: todayBrasiliaStr(), loss_reason: '', reactivation_date: '', notes: '',
};

export function LeadDrawer({ leadId, onClose, onSaved }: {
  leadId: number | null; onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data: meta } = useCrmMeta();
  const [f, setF] = useState<typeof EMPTY>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [interact, setInteract] = useState(false);
  const [newOrigin, setNewOrigin] = useState('');
  const { data: lead, refetch } = useQuery(['crm-lead', leadId], () => crmApi.lead(leadId as number),
    { enabled: leadId !== null });

  useEffect(() => {
    if (leadId === null) { setF({ ...EMPTY, next_action_date: todayBrasiliaStr(), owner_id: meta?.me ?? '' }); return; }
    if (!lead) return;
    setF({
      company: lead.company, contact_name: lead.contact_name, role_title: lead.role_title,
      email: lead.email, phone: lead.phone, origin: lead.origin, owner_id: lead.owner_id ?? '',
      first_contact_date: lead.first_contact_date ?? '', second_contact_date: lead.second_contact_date ?? '',
      third_contact_date: lead.third_contact_date ?? '', proposal_date: lead.proposal_date ?? '',
      stage: lead.stage, next_action_type: lead.next_action_type ?? 'WhatsApp',
      next_action_date: lead.next_action_date ?? '', loss_reason: lead.loss_reason ?? '',
      reactivation_date: lead.reactivation_date ?? '', notes: lead.notes,
    });
  }, [leadId, lead, meta?.me]);

  const set = (k: keyof typeof EMPTY) => (e: any) => setF(p => ({ ...p, [k]: e.target.value }));
  const closed = f.stage === 'Ganho' || f.stage === 'Perdido';

  const save = async () => {
    setBusy(true);
    const nul = (v: string) => v || null;
    const body = {
      company: f.company, contact_name: f.contact_name, role_title: f.role_title, email: f.email,
      phone: f.phone, origin: f.origin, owner_id: f.owner_id || null,
      first_contact_date: nul(f.first_contact_date), second_contact_date: nul(f.second_contact_date),
      third_contact_date: nul(f.third_contact_date), proposal_date: nul(f.proposal_date),
      stage: f.stage, next_action_type: closed ? null : f.next_action_type,
      next_action_date: closed ? null : nul(f.next_action_date),
      loss_reason: nul(f.loss_reason), reactivation_date: nul(f.reactivation_date), notes: f.notes,
    };
    try {
      if (leadId === null) await crmApi.createLead(body); else await crmApi.updateLead(leadId, body);
      toast.success('Lead salvo');
      qc.invalidateQueries('crm-lead');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const addOrigin = async () => {
    if (!newOrigin.trim()) return;
    try {
      await crmApi.addOrigin(newOrigin.trim());
      await qc.invalidateQueries('crm-meta');
      setF(p => ({ ...p, origin: newOrigin.trim() }));
      setNewOrigin('');
    } catch (e) { toast.error(errMsg(e)); }
  };

  const reopen = async () => {
    try { await crmApi.reopen(leadId as number); refetch(); onSaved(); toast.success('Lead reativado'); }
    catch (e) { toast.error(errMsg(e)); }
  };

  if (!meta) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div className="w-full max-w-lg h-full bg-surface border-l border-line overflow-y-auto"
           onMouseDown={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-surface flex items-center justify-between px-5 py-3 border-b border-line-soft">
          <div>
            <h2 className="font-bold text-t1 text-sm">{leadId === null ? 'Novo lead' : f.company || 'Lead'}</h2>
            {lead && (
              <div className="text-[11px] text-t4 mt-0.5">
                {lead.days_in_funnel} dia(s) no funil
                {lead.days_since_last_contact !== null && ` · último contato há ${lead.days_since_last_contact} dia(s)`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-t4 hover:text-t1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {lead?.suggest_close && (
            <div className="rounded-lg bg-warn-soft text-warn text-xs px-3 py-2">
              Cadência esgotada sem retorno — sugerido encerrar como “Sem retorno”.
            </div>
          )}
          {lead && closed && (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs text-t3">
              <span>Lead encerrado{lead.loss_reason ? ` — ${lead.loss_reason}` : ''}.</span>
              <button className={btnGhost} onClick={reopen}><RotateCcw size={13} />Reativar</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="Seller / Empresa *"><input className={inputCls} style={inputStyle} value={f.company} onChange={set('company')} /></Field></div>
            <Field label="Contato"><input className={inputCls} style={inputStyle} value={f.contact_name} onChange={set('contact_name')} /></Field>
            <Field label="Cargo"><input className={inputCls} style={inputStyle} value={f.role_title} onChange={set('role_title')} /></Field>
            <Field label="WhatsApp / telefone"><input className={inputCls} style={inputStyle} value={f.phone} onChange={set('phone')} /></Field>
            <Field label="E-mail"><input className={inputCls} style={inputStyle} value={f.email} onChange={set('email')} /></Field>
            <Field label="Origem">
              <select className={inputCls} style={inputStyle} value={f.origin} onChange={set('origin')}>
                <option value="">—</option>
                {meta.origins.map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Responsável">
              <select className={inputCls} style={inputStyle} value={f.owner_id}
                      onChange={e => setF(p => ({ ...p, owner_id: e.target.value ? Number(e.target.value) : '' }))}>
                <option value="">—</option>
                {meta.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <div className="col-span-2 flex gap-2">
              <input className={inputCls} style={inputStyle} placeholder="Nova origem…" value={newOrigin}
                     onChange={e => setNewOrigin(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOrigin()} />
              <button className={btnGhost} onClick={addOrigin}><Plus size={14} />Origem</button>
            </div>
          </div>

          <div className="rounded-xl border border-line-soft p-3 space-y-3">
            <Field label="Etapa atual">
              <select className={inputCls} style={inputStyle} value={f.stage} onChange={set('stage')}>
                {meta.stages.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            {f.stage === 'Perdido' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Motivo da perda *">
                  <select className={inputCls} style={inputStyle} value={f.loss_reason} onChange={set('loss_reason')}>
                    <option value="">Selecione…</option>
                    {meta.loss_reasons.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                {f.loss_reason === meta.loss_momento && (
                  <Field label="Reativar em"><input type="date" className={inputCls} style={inputStyle} value={f.reactivation_date} onChange={set('reactivation_date')} /></Field>
                )}
              </div>
            )}
            {!closed && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Próxima ação *">
                  <select className={inputCls} style={inputStyle} value={f.next_action_type} onChange={set('next_action_type')}>
                    {meta.action_types.map(a => <option key={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Data da próxima ação *">
                  <input type="date" className={inputCls} style={inputStyle} value={f.next_action_date} onChange={set('next_action_date')} />
                </Field>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="1º contato"><input type="date" className={inputCls} style={inputStyle} value={f.first_contact_date} onChange={set('first_contact_date')} /></Field>
            <Field label="2º contato"><input type="date" className={inputCls} style={inputStyle} value={f.second_contact_date} onChange={set('second_contact_date')} /></Field>
            <Field label="3º contato"><input type="date" className={inputCls} style={inputStyle} value={f.third_contact_date} onChange={set('third_contact_date')} /></Field>
            <Field label="Envio da proposta"><input type="date" className={inputCls} style={inputStyle} value={f.proposal_date} onChange={set('proposal_date')} /></Field>
          </div>
          <Field label="Observações"><textarea rows={3} className={inputCls} style={inputStyle} value={f.notes} onChange={set('notes')} /></Field>

          <div className="flex justify-between gap-2">
            {leadId !== null && !closed ? (
              <button className={btnGhost} onClick={() => setInteract(true)}><Plus size={14} />Interação</button>
            ) : <span />}
            <button className={btnPrimary} disabled={busy || !f.company.trim()} onClick={save}><Save size={14} />Salvar</button>
          </div>

          {leadId !== null && (
            <div>
              <h3 className="text-xs font-bold text-t3 mb-2">Histórico de interações</h3>
              {lead?.interactions?.length ? (
                <ul className="space-y-2">
                  {lead.interactions.map(i => (
                    <li key={i.id} className="rounded-lg border border-line-soft p-2.5 text-xs">
                      <div className="flex items-center justify-between text-t4">
                        <span className="font-semibold text-t2">
                          {fmtDate(i.occurred_at)} {i.occurred_at.slice(11, 16)} · {i.contact_type}
                          {i.channel && i.channel !== i.contact_type ? ` (${i.channel})` : ''}
                        </span>
                        <span>{i.owner_name}</span>
                      </div>
                      {i.summary && <p className="text-t2 mt-1 whitespace-pre-wrap">{i.summary}</p>}
                      <div className="mt-1 text-t4">
                        {i.responded ? 'Cliente respondeu · ' : ''}
                        {i.stage_after && <>Etapa: {i.stage_after} · </>}
                        {i.next_action_type && <>Próxima: {i.next_action_type} em {fmtDate(i.next_action_date)}</>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-t5">Nenhuma interação registrada.</p>}
            </div>
          )}
        </div>
      </div>

      {interact && lead && (
        <InteractionModal lead={lead} onClose={() => setInteract(false)}
                          onDone={() => { setInteract(false); refetch(); onSaved(); }} />
      )}
    </div>
  );
}
