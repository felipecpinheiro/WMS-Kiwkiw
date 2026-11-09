/**
 * WMS Kiwkiw - Recebimentos (Agendamento de Inbound, tela interna) — 23/10/2026
 * ============================================================================
 * Cards por DATA (não é calendário), parecidos com os de Manuseios. O time vê
 * o que vai chegar, marca "Recebido" quando a carga chega (manager+) e, depois
 * da conferência, vê o que entrou no estoque.
 *
 *   admin/manager : card completo (anexos, avisos internos, botão Recebido)
 *   operator      : somente leitura SIMPLES — status e, depois de Conferido, o
 *                   resumo de quantidades. Sem anexos, avisos nem observação.
 *
 * Marcar como Recebido NÃO tem desfazer: libera as NFs para o Manuseios.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import {
  Truck, AlertTriangle, ChevronDown, ChevronUp, FileText, FileCode,
  FileSpreadsheet, Download, X, RefreshCw, Package,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  inboundApi, cadastrosApi, InboundAppointment, InboundStatus, InboundPeriod, InboundNf,
} from '../api';
import { todayBrasiliaStr } from '../timezone';
import FulfillmentLoader from '../components/FulfillmentLoader';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

const STATUS: Record<InboundStatus, { label: string; cls: string }> = {
  AGENDADO: { label: 'Agendado', cls: 'bg-warn-soft text-warn' },
  RECEBIDO: { label: 'Recebido', cls: 'bg-violet-600/15 text-violet-500' },
  EM_CONFERENCIA: { label: 'Em conferência', cls: 'bg-violet-600/15 text-violet-500' },
  CONFERIDO: { label: 'Conferido', cls: 'bg-ok-soft text-ok' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-surface-2 text-t4' },
};
const PERIOD_LABEL: Record<InboundPeriod, string> = { MANHA: 'Manhã', TARDE: 'Tarde' };
const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Preset = 'week' | 'next15' | 'overdue' | 'all';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'week', label: 'Esta semana' },
  { id: 'next15', label: 'Próximos 15 dias' },
  { id: 'overdue', label: 'Atrasados' },
  { id: 'all', label: 'Tudo' },
];

const selectCls =
  'px-2.5 py-1.5 border border-line rounded-lg text-xs text-t2 outline-none focus:ring-2 focus:ring-violet-500';
const selectStyle = { background: 'rgb(var(--surface-2))' };
const btnPrimary =
  'px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'px-3 py-1.5 text-xs font-bold rounded-lg border border-line text-t3 hover:text-t1 disabled:opacity-40';

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const countText = (n: number | null | undefined, unknown: boolean | undefined) =>
  unknown ? 'Não sei' : n == null ? '—' : String(n);

function addDaysStr(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay();

function errMsg(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

function StatusBadge({ a }: { a: InboundAppointment }) {
  const s = STATUS[a.status];
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${s.cls}`}>{s.label}</span>
      {a.overdue && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-bad-soft text-bad">Atrasado</span>}
    </span>
  );
}

// ── Confirmação de "Recebido" ────────────────────────────────────────────────
function ReceiveModal({
  a, loading, onConfirm, onClose,
}: { a: InboundAppointment; loading: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-xl p-5 space-y-3">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-bold text-t1">Marcar como Recebido?</h3>
          <button onClick={onClose} disabled={loading} className="text-t4 hover:text-t1" aria-label="Fechar"><X size={16} /></button>
        </div>
        <p className="text-xs text-t2">
          <strong>{a.seller_name}</strong> · {brDate(a.scheduled_date)} · {PERIOD_LABEL[a.period]} · {a.nf_count} NF(s)
        </p>
        <p className="text-xs text-t3">
          As NFs passam a aparecer no Manuseios para conferência. <strong className="text-bad">Isso não pode ser desfeito.</strong>
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnGhost} onClick={onClose} disabled={loading}>Voltar</button>
          <button className={btnPrimary} onClick={onConfirm} disabled={loading}>
            {loading ? 'Marcando…' : 'Confirmar recebimento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Produtos de uma NF (para o time se organizar antes da carga chegar) ──────
const ITEM_FLAG: Record<string, { label: string; cls: string }> = {
  sem_cadastro: { label: 'sem cadastro', cls: 'bg-warn-soft text-warn' },
  descontinuado: { label: 'descontinuado', cls: 'bg-bad-soft text-bad' },
};

function NfProducts({ nf, files }: { nf: InboundNf; files?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const items = nf.items ?? [];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="flex items-center gap-1 text-[11px] font-bold text-t2 mr-1"
          onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          NF {nf.nf_number}
          <span className="font-normal text-t4">· {nf.items_skus ?? items.length} SKU(s) · {nf.items_units ?? 0} un</span>
        </button>
        {files}
      </div>
      {open && (
        <div className="border border-line rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-t4">
              <tr>
                <th className="text-left px-2 py-1">SKU</th>
                <th className="text-left px-2 py-1">Produto</th>
                <th className="text-right px-2 py-1">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.sku} className="border-t border-line-soft align-top">
                  <td className="px-2 py-1 text-t2 break-all">{i.sku}</td>
                  <td className="px-2 py-1 text-t3">
                    {i.name}
                    {ITEM_FLAG[i.status] && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ITEM_FLAG[i.status].cls}`}>
                        {ITEM_FLAG[i.status].label}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-bold text-t1">{i.quantity}</td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={3} className="px-2 py-2 text-t4">Sem itens nesta NF.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function InboundCard({
  a, canAct, onReceive,
}: { a: InboundAppointment; canAct: boolean; onReceive: (a: InboundAppointment) => void }) {
  const [open, setOpen] = useState(false);
  const canOpenSummary = a.status === 'CONFERIDO';
  const { data: detail } = useQuery(
    ['inbound-detail', a.id],
    () => inboundApi.get(a.id).then(r => r.data),
    { enabled: open && canOpenSummary },
  );
  const noUnit = !!a.warnings?.some(w => w.type === 'seller_without_unit');
  // Resumo dos produtos do agendamento inteiro (SKUs distintos e unidades)
  const allItems = (a.nfs ?? []).flatMap(nf => nf.items ?? []);
  const totalSkus = new Set(allItems.map(i => i.sku)).size;
  const totalUnits = allItems.reduce((s, i) => s + i.quantity, 0);
  const icon = (k: string) => (k === 'PDF' ? <FileText size={12} /> : k === 'XML' ? <FileCode size={12} /> : <FileSpreadsheet size={12} />);

  return (
    <div className={`border rounded-xl p-3.5 bg-surface space-y-2.5 ${a.overdue ? 'border-bad' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-t1 truncate">{a.seller_name ?? '—'}</p>
          <p className="text-[11px] text-t4">#{a.id} · {a.nf_count} NF(s)</p>
        </div>
        <StatusBadge a={a} />
      </div>

      {allItems.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-t3">
          <Package size={12} className="text-t4" />
          <span><strong className="text-t2">{totalSkus}</strong> SKU(s) · <strong className="text-t2">{totalUnits}</strong> un no total</span>
        </p>
      )}

      {/* Operador: só os produtos de cada NF (sem anexos, volumes nem avisos) */}
      {!canAct && (a.nfs ?? []).length > 0 && (
        <div className="space-y-1.5">
          {(a.nfs ?? []).map(nf => <NfProducts key={nf.id} nf={nf} />)}
        </div>
      )}

      {canAct && (
        <>
          <p className="text-xs text-t3">
            Volumes: <span className="text-t2">{countText(a.volumes, a.volumes_unknown)}</span> · Paletes:{' '}
            <span className="text-t2">{countText(a.pallets, a.pallets_unknown)}</span>
          </p>
          {a.notes && <p className="text-xs text-t3 italic">“{a.notes}”</p>}
          {a.status === 'CANCELADO' && a.cancel_reason && <p className="text-xs text-t4">Cancelado: {a.cancel_reason}</p>}
          {(a.nfs ?? []).length > 0 && (
            <div className="space-y-1.5">
              {(a.nfs ?? []).map(nf => (
                <NfProducts key={nf.id} nf={nf} files={(nf.files ?? []).map(f => (
                  <button key={f.id} title={f.filename}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-md border border-line text-t3 hover:text-t1"
                    onClick={() => inboundApi.downloadFile(f.id, f.filename).catch(() => toast.error('Não foi possível baixar.'))}>
                    {icon(f.kind)} {f.kind} <Download size={10} />
                  </button>
                ))} />
              ))}
            </div>
          )}
          {(a.warnings ?? []).length > 0 && (
            <div className="space-y-1">
              {(a.warnings ?? []).map(w => (
                <div key={w.type} className="flex items-start gap-1.5 text-[11px] text-warn">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{w.message} <Link to={w.link} className="font-bold underline">resolver</Link></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {canAct && a.status === 'AGENDADO' && (
        <div className="flex items-center gap-2 pt-0.5">
          <button className={btnPrimary} disabled={noUnit} onClick={() => onReceive(a)}
            title={noUnit ? 'Associe uma unidade ao seller antes de receber' : undefined}>
            Marcar como Recebido
          </button>
          {noUnit && <span className="text-[11px] text-warn">Seller sem unidade</span>}
        </div>
      )}

      {canOpenSummary && (
        <div>
          <button className="flex items-center gap-1 text-[11px] font-bold text-violet-500" onClick={() => setOpen(v => !v)}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} O que entrou no estoque
          </button>
          {open && (
            <div className="mt-1.5 border border-line rounded-lg overflow-hidden">
              {!detail ? (
                <p className="text-xs text-t4 p-2">Carregando…</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-t4">
                    <tr><th className="text-left px-2 py-1">SKU</th><th className="text-right px-2 py-1">Na NF</th><th className="text-right px-2 py-1">Entrou</th></tr>
                  </thead>
                  <tbody>
                    {(detail.stock_summary ?? []).map(r => (
                      <tr key={r.sku} className="border-t border-line-soft">
                        <td className="px-2 py-1 text-t2 break-all">{r.sku}</td>
                        <td className="px-2 py-1 text-right text-t3">{r.expected}</td>
                        <td className={`px-2 py-1 text-right font-bold ${r.divergent ? 'text-warn' : 'text-ok'}`}>
                          {r.entered}{r.divergent && <span className="ml-1 font-normal">divergente</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function InboundPage() {
  const qc = useQueryClient();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : null;
  const role: string = user?.role ?? 'operator';
  const canAct = role === 'admin' || role === 'manager';

  // Unidade ativa — mesma preferência do Dashboard/Manuseios. Operador não escolhe.
  const unitPrefKey = `wms_active_unit_${user?.id ?? 'anon'}`;
  const [unit, setUnit] = useState<string>(() => {
    if (role === 'operator') return String(user?.unit_id ?? '');
    return localStorage.getItem(unitPrefKey) ?? (user?.unit_id ? String(user.unit_id) : '');
  });
  const changeUnit = (v: string) => {
    setUnit(v);
    if (v && v !== 'none') localStorage.setItem(unitPrefKey, v);
    else localStorage.removeItem(unitPrefKey);
  };
  const [preset, setPreset] = useState<Preset>('week');
  const [statusFilter, setStatusFilter] = useState<InboundStatus | ''>('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [toReceive, setToReceive] = useState<InboundAppointment | null>(null);

  const { data: units } = useQuery('units', () => cadastrosApi.units().then(r => r.data), { enabled: role !== 'operator' });

  const today = todayBrasiliaStr();
  const monday = addDaysStr(today, -((weekdayOf(today) + 6) % 7));
  const sunday = addDaysStr(monday, 6);

  // Janela pedida ao servidor. Atrasados (Agendado com data passada) sempre entram
  // nas visões de semana/15 dias, por isso a janela começa 60 dias atrás.
  const range = useMemo(() => {
    if (preset === 'week') return { date_from: addDaysStr(today, -60), date_to: sunday };
    if (preset === 'next15') return { date_from: addDaysStr(today, -60), date_to: addDaysStr(today, 15) };
    if (preset === 'overdue') return { date_from: undefined, date_to: addDaysStr(today, -1) };
    return { date_from: undefined, date_to: undefined };
  }, [preset, today, sunday]);

  const unitParams = unit === 'none' ? { no_unit: true } : unit ? { unit_id: Number(unit) } : {};
  const { data, isLoading, refetch, isFetching } = useQuery(
    ['inbound-list', preset, unit, statusFilter, today],
    () => inboundApi.list({
      ...unitParams, ...range,
      status: preset === 'overdue' ? 'AGENDADO' : (statusFilter || undefined),
      limit: 500,
    }).then(r => r.data),
    { refetchInterval: 30000, keepPreviousData: true },
  );
  const showLoader = useDelayedLoading(isLoading, 150);

  const visible = useMemo(() => {
    const rows = data ?? [];
    return rows.filter(a => {
      if (sellerFilter && a.seller_name !== sellerFilter) return false;
      // Pendências sempre aparecem: atrasado (Agendado com data passada) e carga
      // já recebida que ainda está em conferência, mesmo com data anterior à janela.
      const pending = a.overdue || a.status === 'RECEBIDO' || a.status === 'EM_CONFERENCIA';
      if (preset === 'week' && a.scheduled_date < monday && !pending) return false;
      if (preset === 'next15' && a.scheduled_date < today && !pending) return false;
      return true;
    });
  }, [data, sellerFilter, preset, monday, today]);

  const sellers = useMemo(() => Array.from(new Set((data ?? []).map(a => a.seller_name).filter(Boolean) as string[])).sort(), [data]);

  // Agrupa por data (já vem ordenado por data, período e id)
  const days = useMemo(() => {
    const m = new Map<string, InboundAppointment[]>();
    visible.forEach(a => { const l = m.get(a.scheduled_date) ?? []; l.push(a); m.set(a.scheduled_date, l); });
    return Array.from(m.entries());
  }, [visible]);

  const mReceive = useMutation((id: number) => inboundApi.receive(id), {
    onSuccess: () => {
      toast.success('Recebido! As NFs já estão no Manuseios.');
      setToReceive(null);
      qc.invalidateQueries('inbound-list');
      qc.invalidateQueries('inbound-summary');
      qc.invalidateQueries('session-cards');
    },
    onError: (e) => { toast.error(errMsg(e, 'Não foi possível marcar como recebido.')); },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    visible.forEach(a => { c[a.status] = (c[a.status] ?? 0) + 1; });
    return c;
  }, [visible]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-t1 flex items-center gap-2"><Truck size={20} /> Recebimentos</h1>
          <p className="text-xs text-t4 mt-0.5">Cargas agendadas pelos sellers, por data de chegada</p>
        </div>
        <button className={`${btnGhost} flex items-center gap-1.5`} onClick={() => refetch()}>
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPreset(p.id)}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-full border ${preset === p.id ? 'bg-violet-600 border-violet-600 text-white' : 'border-line text-t4 hover:text-t2'}`}>
            {p.label}
          </button>
        ))}
        <span className="w-px h-5 bg-line mx-1 hidden sm:block" />
        {role !== 'operator' && (
          <select className={selectCls} style={selectStyle} value={unit} onChange={e => changeUnit(e.target.value)} aria-label="Unidade">
            <option value="">Todas as unidades</option>
            {(units ?? []).map((u: { id: number; name: string }) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            <option value="none">Sem unidade</option>
          </select>
        )}
        <select className={selectCls} style={selectStyle} value={sellerFilter} onChange={e => setSellerFilter(e.target.value)} aria-label="Seller">
          <option value="">Todos os sellers</option>
          {sellers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {preset !== 'overdue' && (
          <select className={selectCls} style={selectStyle} value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as InboundStatus | '')} aria-label="Status">
            <option value="">Todos os status</option>
            {(Object.keys(STATUS) as InboundStatus[]).map(k => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </select>
        )}
      </div>

      {visible.length > 0 && (
        <div className="flex flex-wrap gap-3 text-[11px] text-t4">
          {(Object.keys(STATUS) as InboundStatus[]).filter(k => counts[k]).map(k => (
            <span key={k}><strong className="text-t2">{counts[k]}</strong> {STATUS[k].label.toLowerCase()}</span>
          ))}
        </div>
      )}

      <div className="relative min-h-[240px]">
        <FulfillmentLoader show={showLoader} title="Carregando os recebimentos" />
        {!isLoading && days.length === 0 && (
          <div className="text-center py-20 text-t5">
            <Truck size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-sm font-medium">Nenhum recebimento neste filtro</p>
            <p className="text-xs mt-1">Os agendamentos dos sellers aparecem aqui.</p>
          </div>
        )}
        {days.map(([day, list]) => {
          const isToday = day === today;
          const late = day < today;
          return (
            <section key={day} className="mb-6">
              <h2 className="flex items-center gap-2 text-sm font-bold text-t1 mb-2 sticky top-0 bg-app py-1 z-10">
                <span>{WEEKDAY[weekdayOf(day)]} {brDate(day).slice(0, 5)}</span>
                {isToday && <span className="px-2 py-0.5 rounded-full text-[10px] bg-violet-600 text-white">hoje</span>}
                {late && <span className="px-2 py-0.5 rounded-full text-[10px] bg-bad-soft text-bad">data passada</span>}
                <span className="text-[11px] font-normal text-t4">{list.length} agendamento(s)</span>
              </h2>
              {(['MANHA', 'TARDE'] as InboundPeriod[]).map(p => {
                const items = list.filter(a => a.period === p);
                if (!items.length) return null;
                return (
                  <div key={p} className="mb-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-t4 mb-1.5">{PERIOD_LABEL[p]}</p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                      {items.map(a => <InboundCard key={a.id} a={a} canAct={canAct} onReceive={setToReceive} />)}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {toReceive && (
        <ReceiveModal a={toReceive} loading={mReceive.isLoading}
          onConfirm={() => mReceive.mutate(toReceive.id)} onClose={() => setToReceive(null)} />
      )}
    </div>
  );
}
