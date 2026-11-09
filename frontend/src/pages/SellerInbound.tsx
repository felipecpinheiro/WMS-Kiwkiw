/**
 * WMS Kiwkiw - Aba "Agendamento de Inbound" do Portal do Seller (23/10/2026)
 * ===========================================================================
 * O seller agenda a chegada de uma carga (dia útil + Manhã/Tarde), anexa por NF
 * o XML (obrigatório; PDF da DANFE e Excel são opcionais) e informa volumes e paletes.
 *
 * Só o XML é lido pelo servidor (cria a NF de entrada); PDF e Excel são anexo.
 * Editar / reagendar / cancelar só vale enquanto o status é AGENDADO — o
 * servidor recusa (409) depois disso, aqui os botões apenas somem.
 * Os avisos internos da Kiwkiw (SKU sem cadastro etc.) NÃO vão nas listas/detalhe: a API nem os envia.
 * Única exceção: na revisão prévia do novo agendamento o seller vê o status de cada SKU
 * (cadastrado / não cadastrado / descontinuado) — decisão do dono em 04/11/2026.
 *
 * Novo agendamento em 2 passos (04/11/2026): 1) dados e arquivos; 2) revisão dos SKUs e
 * quantidades de cada NF, com vencimentos opcionais (N linhas por SKU: data + quantidade).
 * A revisão vem de POST /inbound/analyze (não grava); tudo é gravado junto no "Confirmar".
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  Truck, Plus, X, FileText, FileCode, FileSpreadsheet, Trash2, Download, AlertTriangle, Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  inboundApi, InboundAppointment, InboundNf, InboundNfFiles, InboundPeriod, InboundStatus,
  InboundAnalyzeNf, InboundExpiryRow,
} from '../api';
import { todayBrasiliaStr } from '../timezone';

const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const MAX_NFS = 20;
const MAX_DAYS = 60;

const inputCls =
  'w-full px-2.5 py-1.5 border border-line rounded-lg text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500 placeholder-t5 disabled:opacity-50';
const inputStyle = { background: 'rgb(var(--surface-2))' };
const btnPrimary =
  'px-4 py-2 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost =
  'px-3 py-1.5 text-xs font-bold rounded-lg border border-line text-t3 hover:text-t1 disabled:opacity-40';

const STATUS: Record<InboundStatus, { label: string; cls: string }> = {
  AGENDADO: { label: 'Agendado', cls: 'bg-warn-soft text-warn' },
  RECEBIDO: { label: 'Recebido', cls: 'bg-violet-600/15 text-violet-500' },
  EM_CONFERENCIA: { label: 'Em conferência', cls: 'bg-violet-600/15 text-violet-500' },
  CONFERIDO: { label: 'Conferido', cls: 'bg-ok-soft text-ok' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-surface-2 text-t4' },
};
const PERIOD_LABEL: Record<InboundPeriod, string> = { MANHA: 'Manhã', TARDE: 'Tarde' };

const brDate = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '—');

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function errMsg(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

/** yyyy-MM-dd é dia útil? (meio-dia local evita virada de fuso) */
function isBusinessDay(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00`);
  const w = d.getDay();
  return !Number.isNaN(w) && w !== 0 && w !== 6;
}

function addDaysStr(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Erro de data no cliente (o servidor valida de qualquer jeito). */
function dateError(iso: string): string | null {
  if (!iso) return 'Escolha o dia.';
  const today = todayBrasiliaStr();
  if (iso < today) return 'A data não pode estar no passado.';
  if (iso > addDaysStr(today, MAX_DAYS)) return `No máximo ${MAX_DAYS} dias à frente.`;
  if (!isBusinessDay(iso)) return 'Escolha um dia útil (segunda a sexta).';
  return null;
}

function StatusBadge({ a }: { a: InboundAppointment }) {
  const s = STATUS[a.status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${s.cls}`}>{s.label}</span>
      {a.overdue && (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-bad-soft text-bad">Atrasado</span>
      )}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 p-0 sm:p-4 overflow-y-auto">
      <div className="w-full sm:max-w-2xl bg-surface border border-line sm:rounded-xl shadow-xl min-h-screen sm:min-h-0 max-h-none sm:max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-t1">{title}</h3>
          <button onClick={onClose} className="text-t4 hover:text-t1" aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function FilePick({
  label, required, accept, file, onChange, disabled,
}: {
  label: string; required?: boolean; accept: string; file: File | null;
  onChange: (f: File | null) => void; disabled?: boolean;
}) {
  const tooBig = !!file && file.size > MAX_FILE;
  return (
    <label className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-lg text-xs cursor-pointer ${tooBig ? 'border-bad' : 'border-line'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      style={inputStyle}>
      <Upload size={12} className="text-t4 shrink-0" />
      <span className="font-bold text-t2 shrink-0">{label}{required ? ' *' : ''}</span>
      <span className={`truncate ${tooBig ? 'text-bad' : 'text-t4'}`}>
        {file ? `${file.name} (${fmtSize(file.size)})${tooBig ? ' — passa de 10 MB' : ''}` : 'escolher arquivo'}
      </span>
      <input type="file" accept={accept} className="hidden" disabled={disabled}
        onChange={e => { onChange(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </label>
  );
}

/** Volumes / paletes: número ou "Não sei". */
function CountField({
  label, value, unknown, onValue, onUnknown, disabled,
}: {
  label: string; value: string; unknown: boolean;
  onValue: (v: string) => void; onUnknown: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-t3 mb-1">{label}</label>
      <div className="flex items-center gap-3">
        <input type="number" min={0} max={99999} inputMode="numeric" className={inputCls} style={inputStyle}
          value={unknown ? '' : value} disabled={unknown || disabled} placeholder="0"
          onChange={e => onValue(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs text-t3 whitespace-nowrap">
          <input type="checkbox" checked={unknown} disabled={disabled} onChange={e => onUnknown(e.target.checked)} />
          Não sei
        </label>
      </div>
    </div>
  );
}

const countText = (n: number | null | undefined, unknown: boolean | undefined) =>
  unknown ? 'Não sei' : n == null ? '—' : String(n);

// ─── Novo agendamento ────────────────────────────────────────────────────────

const emptyNf = (): InboundNfFiles => ({ pdf: null, xml: null, xlsx: null });

interface ExpLine { date: string; qty: string; lot: string }
type ExpLines = Record<string, ExpLine[]>;
const lineKey = (nfIdx: number, sku: string) => `${nfIdx}|${sku}`;

/** dd/mm/aaaa ou mm/aaaa (mesmo critério do servidor, que revalida). */
function validExpiryText(s: string): boolean {
  const t = s.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 12;
}

/** Valida as linhas de um SKU. Linha totalmente vazia é ignorada. */
function checkLines(rows: ExpLine[], nfQty: number): { rowErr: (string | null)[]; sum: number; bad: boolean } {
  let sum = 0;
  let bad = false;
  const rowErr = rows.map(r => {
    const d = r.date.trim();
    const q = r.qty.trim();
    if (!d && !q) return null;
    if (!d || !q) { bad = true; return 'Preencha a data e a quantidade.'; }
    if (!validExpiryText(d)) { bad = true; return 'Data inválida. Use dd/mm/aaaa ou mm/aaaa.'; }
    const n = Number(q);
    if (!Number.isInteger(n) || n <= 0) { bad = true; return 'Quantidade deve ser um inteiro maior que zero.'; }
    if (r.lot.trim().length > 60) { bad = true; return 'Lote acima de 60 caracteres.'; }
    sum += n;
    return null;
  });
  if (sum > nfQty) bad = true;
  return { rowErr, sum, bad };
}

function buildExpiry(analysis: InboundAnalyzeNf[], lines: ExpLines): Record<number, InboundExpiryRow[]> {
  const out: Record<number, InboundExpiryRow[]> = {};
  for (const nf of analysis) {
    for (const it of nf.items) {
      if (it.status !== 'ok') continue;
      for (const r of lines[lineKey(nf.index, it.sku)] ?? []) {
        if (!r.date.trim() || !r.qty.trim()) continue;
        (out[nf.index] ??= []).push({
          sku: it.sku, expiry_date_text: r.date.trim(), quantity: Number(r.qty),
          lot_name: r.lot.trim() || null,
        });
      }
    }
  }
  return out;
}

const ITEM_STATUS_LABEL: Record<string, string> = {
  sem_produto: 'SKU não cadastrado',
  descontinuado: 'SKU descontinuado',
};

function ReviewStep({
  analysis, lines, setLines,
}: { analysis: InboundAnalyzeNf[]; lines: ExpLines; setLines: (fn: (l: ExpLines) => ExpLines) => void }) {
  const patch = (key: string, fn: (rows: ExpLine[]) => ExpLine[]) =>
    setLines(l => ({ ...l, [key]: fn(l[key] ?? []) }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-t3">
        Confira os produtos e as quantidades de cada NF. Se quiser, informe os vencimentos
        (opcional): pode adicionar quantas linhas precisar por SKU, cada uma com data e quantidade.
      </p>
      {analysis.map(nf => (
        <div key={nf.index} className="border border-line rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-2"
            style={{ background: 'rgb(var(--surface-2))' }}>
            <span className="text-xs font-bold text-t1">
              {nf.nf_number ? `NF ${nf.nf_number}` : `NF ${nf.index + 1}`}
            </span>
            <span className="text-[11px] text-t4 truncate">{nf.filename}</span>
          </div>
          {nf.error ? (
            <p className="p-3 text-xs text-bad flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {nf.error}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {nf.items.map(it => {
                const key = lineKey(nf.index, it.sku);
                const rows = lines[key] ?? [];
                const chk = checkLines(rows, it.quantity);
                const blocked = it.status !== 'ok';
                return (
                  <div key={key} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-t1 break-all">{it.sku}</div>
                        <div className="text-[11px] text-t4">{it.name}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {blocked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-bad-soft text-bad">
                            {ITEM_STATUS_LABEL[it.status]}
                          </span>
                        )}
                        <span className="text-xs font-bold text-t2">{it.quantity} un</span>
                      </div>
                    </div>

                    {blocked ? (
                      <p className="text-[11px] text-t4">Vencimento indisponível para este SKU.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {rows.map((r, k) => (
                          <div key={k}>
                            <div className="flex items-center gap-2">
                              <input className={`${inputCls} ${chk.rowErr[k] ? 'border-bad' : ''}`} style={inputStyle}
                                placeholder="dd/mm/aaaa ou mm/aaaa" inputMode="numeric" maxLength={10}
                                value={r.date} aria-label="Vencimento"
                                onChange={e => patch(key, rs => rs.map((x, i) => (i === k ? { ...x, date: e.target.value } : x)))} />
                              <input className={`${inputCls} !w-32 shrink-0 ${chk.rowErr[k] ? 'border-bad' : ''}`} style={inputStyle}
                                placeholder="Lote (opcional)" maxLength={60}
                                value={r.lot} aria-label="Lote"
                                onChange={e => patch(key, rs => rs.map((x, i) => (i === k ? { ...x, lot: e.target.value } : x)))} />
                              <input type="number" min={1} inputMode="numeric" placeholder="Qtd"
                                className={`${inputCls} !w-20 shrink-0 ${chk.rowErr[k] ? 'border-bad' : ''}`} style={inputStyle}
                                value={r.qty} aria-label="Quantidade do vencimento"
                                onChange={e => patch(key, rs => rs.map((x, i) => (i === k ? { ...x, qty: e.target.value } : x)))} />
                              <button type="button" className="text-t4 hover:text-bad shrink-0" aria-label="Remover linha"
                                onClick={() => patch(key, rs => rs.filter((_, i) => i !== k))}><Trash2 size={13} /></button>
                            </div>
                            {chk.rowErr[k] && <p className="text-[11px] text-bad mt-0.5">{chk.rowErr[k]}</p>}
                          </div>
                        ))}
                        <div className="flex items-center justify-between gap-2">
                          <button type="button" className={`${btnGhost} flex items-center gap-1`}
                            onClick={() => patch(key, rs => [...rs, { date: '', qty: '', lot: '' }])}>
                            <Plus size={12} /> Vencimento
                          </button>
                          {chk.sum > 0 && (
                            <span className={`text-[11px] font-bold ${chk.sum > it.quantity ? 'text-bad' : 'text-t3'}`}>
                              {chk.sum} de {it.quantity} un com vencimento
                              {chk.sum > it.quantity ? ' — passa da quantidade da NF' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NewAppointmentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = todayBrasiliaStr();
  const [step, setStep] = useState<1 | 2>(1);
  const [analysis, setAnalysis] = useState<InboundAnalyzeNf[]>([]);
  const [lines, setLines] = useState<ExpLines>({});
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState<InboundPeriod>('MANHA');
  const [nfs, setNfs] = useState<InboundNfFiles[]>([emptyNf()]);
  const [volumes, setVolumes] = useState('');
  const [volUnk, setVolUnk] = useState(false);
  const [pallets, setPallets] = useState('');
  const [palUnk, setPalUnk] = useState(false);
  const [notes, setNotes] = useState('');

  const total = nfs.reduce((s, n) => s + (n.pdf?.size ?? 0) + (n.xml?.size ?? 0) + (n.xlsx?.size ?? 0), 0);
  const parse = (v: string) => (v.trim() === '' ? null : Number(v));
  const volN = parse(volumes);
  const palN = parse(pallets);
  const countOk = (n: number | null, unk: boolean) => unk || (n !== null && Number.isInteger(n) && n >= 0 && n <= 99999);

  const problem: string | null =
    dateError(date)
    ?? (nfs.some(n => !n.xml) ? 'Cada NF precisa do XML.' : null)
    ?? (nfs.some(n => [n.pdf, n.xml, n.xlsx].some(f => f && f.size > MAX_FILE)) ? 'Há arquivo com mais de 10 MB.' : null)
    ?? (total > MAX_TOTAL ? 'Os arquivos passam de 30 MB no total.' : null)
    ?? (!countOk(volN, volUnk) ? 'Informe os volumes ou marque "Não sei".' : null)
    ?? (!countOk(palN, palUnk) ? 'Informe os paletes ou marque "Não sei".' : null);

  const m = useMutation(
    () => inboundApi.create({
      scheduled_date: date, period, volumes: volUnk ? null : volN, volumes_unknown: volUnk,
      pallets: palUnk ? null : palN, pallets_unknown: palUnk, notes, nfs,
      expiry: buildExpiry(analysis, lines),
    }),
    {
      onSuccess: () => { toast.success('Agendamento criado!'); onDone(); },
      onError: (e) => { toast.error(errMsg(e, 'Não foi possível criar o agendamento.')); },
    },
  );

  const mAnalyze = useMutation(() => inboundApi.analyze(nfs), {
    onSuccess: (res) => {
      const list = res.data.nfs;
      setLines(prev => {
        const next: ExpLines = {};
        for (const nf of list) {
          for (const it of nf.items) {
            const key = lineKey(nf.index, it.sku);
            next[key] = prev[key] ?? it.prefill.map(p => ({
              date: p.expiry_date_text, qty: p.quantity == null ? '' : String(p.quantity),
              lot: p.lot_name ?? '',
            }));
          }
        }
        return next;
      });
      setAnalysis(list);
      setStep(2);
    },
    onError: (e) => { toast.error(errMsg(e, 'Não foi possível ler os XMLs.')); },
  });

  const busy = m.isLoading || mAnalyze.isLoading;
  const reviewProblem: string | null =
    analysis.some(nf => nf.error)
      ? 'Há NF com erro. Volte e corrija o arquivo.'
      : analysis.some(nf => nf.items.some(it => it.status === 'ok'
          && checkLines(lines[lineKey(nf.index, it.sku)] ?? [], it.quantity).bad))
        ? 'Corrija os vencimentos destacados.'
        : null;

  const setNf = (i: number, patch: Partial<InboundNfFiles>) =>
    setNfs(list => list.map((n, k) => (k === i ? { ...n, ...patch } : n)));

  return (
    <Modal title={step === 1 ? 'Novo agendamento de inbound' : 'Revisar produtos e vencimentos'}
      onClose={() => !busy && onClose()}>
      {step === 2 ? (
        <div className="space-y-4">
          <ReviewStep analysis={analysis} lines={lines} setLines={setLines} />
          {reviewProblem && <p className="text-xs text-warn flex items-center gap-1"><AlertTriangle size={12} /> {reviewProblem}</p>}
          <div className="flex justify-between gap-2 pt-1">
            <button className={btnGhost} onClick={() => setStep(1)} disabled={busy}>Voltar</button>
            <button className={btnPrimary} disabled={!!reviewProblem || busy} onClick={() => m.mutate()}>
              {m.isLoading ? 'Enviando…' : 'Confirmar e agendar'}
            </button>
          </div>
        </div>
      ) : (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-t3 mb-1">Dia da chegada (dia útil)</label>
            <input type="date" className={inputCls} style={inputStyle} value={date}
              min={today} max={addDaysStr(today, MAX_DAYS)} onChange={e => setDate(e.target.value)} />
            {date && dateError(date) && <p className="text-[11px] text-bad mt-1">{dateError(date)}</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-t3 mb-1">Período</label>
            <div className="flex gap-2">
              {(['MANHA', 'TARDE'] as InboundPeriod[]).map(p => (
                <button key={p} type="button" onClick={() => setPeriod(p)}
                  className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-lg border ${period === p ? 'bg-violet-600 border-violet-600 text-white' : 'border-line text-t4 hover:text-t2'}`}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-t3">Notas fiscais</label>
            <span className="text-[11px] text-t4">XML obrigatório · PDF e Excel opcionais · até 10 MB cada</span>
          </div>
          <div className="space-y-2">
            {nfs.map((n, i) => (
              <div key={i} className="border border-line rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-t2">NF {i + 1}</span>
                  {nfs.length > 1 && (
                    <button type="button" className="text-t4 hover:text-bad" aria-label="Remover NF"
                      onClick={() => setNfs(list => list.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
                  )}
                </div>
                <FilePick label="PDF da DANFE" accept=".pdf,application/pdf" file={n.pdf} onChange={f => setNf(i, { pdf: f })} />
                <FilePick label="XML" required accept=".xml,text/xml,application/xml" file={n.xml} onChange={f => setNf(i, { xml: f })} />
                <FilePick label="Excel" accept=".xlsx" file={n.xlsx} onChange={f => setNf(i, { xlsx: f })} />
              </div>
            ))}
          </div>
          {nfs.length < MAX_NFS && (
            <button type="button" className={`${btnGhost} mt-2 flex items-center gap-1`} onClick={() => setNfs(l => [...l, emptyNf()])}>
              <Plus size={12} /> Adicionar NF
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CountField label="Volumes" value={volumes} unknown={volUnk} onValue={setVolumes} onUnknown={setVolUnk} />
          <CountField label="Paletes" value={pallets} unknown={palUnk} onValue={setPallets} onUnknown={setPalUnk} />
        </div>
        <p className="text-[11px] text-t4 -mt-2">Não tem a quantidade certa? Pode marcar "Não sei" — sem problema.</p>

        <div>
          <label className="block text-xs font-bold text-t3 mb-1">Observação (opcional)</label>
          <textarea rows={2} maxLength={1000} className={inputCls} style={inputStyle} value={notes}
            onChange={e => setNotes(e.target.value)} />
        </div>

        {problem && date !== '' && <p className="text-xs text-warn flex items-center gap-1"><AlertTriangle size={12} /> {problem}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnGhost} onClick={onClose} disabled={busy}>Cancelar</button>
          <button className={btnPrimary} disabled={!!problem || busy} onClick={() => mAnalyze.mutate()}>
            {mAnalyze.isLoading ? 'Lendo os XMLs…' : 'Continuar'}
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
}

// ─── Detalhe / edição ────────────────────────────────────────────────────────

function NfBlock({
  a, nf, editable, canRemove, busy, onReplace, onRemove,
}: {
  a: InboundAppointment; nf: InboundNf; editable: boolean; canRemove: boolean; busy: boolean;
  onReplace: (nfId: number, files: Partial<InboundNfFiles>) => void; onRemove: (nfId: number) => void;
}) {
  const icon = (k: string) => (k === 'PDF' ? <FileText size={13} /> : k === 'XML' ? <FileCode size={13} /> : <FileSpreadsheet size={13} />);
  return (
    <div className="border border-line rounded-lg p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-t1">NF {nf.nf_number}</span>
        {editable && canRemove && (
          <button className="text-t4 hover:text-bad" aria-label="Remover NF" disabled={busy}
            onClick={() => { if (window.confirm(`Remover a NF ${nf.nf_number} deste agendamento?`)) onRemove(nf.id); }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {nf.files.map(f => (
          <button key={f.id} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-line text-t3 hover:text-t1"
            onClick={() => inboundApi.downloadFile(f.id, f.filename).catch(() => toast.error('Não foi possível baixar.'))}
            title={`${f.filename} (${fmtSize(f.size)})`}>
            {icon(f.kind)} {f.kind} <Download size={11} />
          </button>
        ))}
      </div>
      {editable && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <FilePick label="Trocar PDF" accept=".pdf,application/pdf" file={null} disabled={busy}
            onChange={f => f && onReplace(nf.id, { pdf: f })} />
          <FilePick label="Trocar XML" accept=".xml,text/xml,application/xml" file={null} disabled={busy}
            onChange={f => f && onReplace(nf.id, { xml: f })} />
          <FilePick label="Excel" accept=".xlsx" file={null} disabled={busy}
            onChange={f => f && onReplace(nf.id, { xlsx: f })} />
        </div>
      )}
      <span className="sr-only">{a.id}</span>
    </div>
  );
}

function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: a } = useQuery(['inbound-detail', id], () => inboundApi.get(id).then(r => r.data), { keepPreviousData: true });
  if (!a) return <Modal title="Agendamento" onClose={onClose}><p className="text-sm text-t4">Carregando…</p></Modal>;
  return <DetailBody a={a} id={id} onClose={onClose} />;
}

function DetailBody({ a, id, onClose }: { a: InboundAppointment; id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string | null>(null);
  const [period, setPeriod] = useState<InboundPeriod | null>(null);
  const [volumes, setVolumes] = useState<string | null>(null);
  const [volUnk, setVolUnk] = useState<boolean | null>(null);
  const [pallets, setPallets] = useState<string | null>(null);
  const [palUnk, setPalUnk] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [newNf, setNewNf] = useState<InboundNfFiles | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');

  const editable = a.status === 'AGENDADO';
  const refresh = () => { qc.invalidateQueries('inbound'); qc.invalidateQueries(['inbound-detail', id]); };
  const ok = (msg: string) => () => { toast.success(msg); refresh(); };
  const bad = (fb: string) => (e: unknown) => { toast.error(errMsg(e, fb)); };

  const mUpdate = useMutation((data: Parameters<typeof inboundApi.update>[1]) => inboundApi.update(id, data), {
    onSuccess: () => { ok('Agendamento atualizado.')(); setDate(null); setPeriod(null); setVolumes(null); setVolUnk(null); setPallets(null); setPalUnk(null); setNotes(null); },
    onError: bad('Não foi possível salvar.'),
  });
  const mReplace = useMutation(({ nfId, files }: { nfId: number; files: Partial<InboundNfFiles> }) => inboundApi.replaceFiles(id, nfId, files), {
    onSuccess: ok('Arquivo trocado.'), onError: bad('Não foi possível trocar o arquivo.'),
  });
  const mRemove = useMutation((nfId: number) => inboundApi.removeNf(id, nfId), {
    onSuccess: ok('NF removida.'), onError: bad('Não foi possível remover a NF.'),
  });
  const mAdd = useMutation((files: InboundNfFiles) => inboundApi.addNf(id, files), {
    onSuccess: () => { ok('NF adicionada.')(); setNewNf(null); }, onError: bad('Não foi possível adicionar a NF.'),
  });
  const mCancel = useMutation(() => inboundApi.cancel(id, reason.trim()), {
    onSuccess: () => { ok('Agendamento cancelado.')(); setShowCancel(false); }, onError: bad('Não foi possível cancelar.'),
  });
  const busy = mUpdate.isLoading || mReplace.isLoading || mRemove.isLoading || mAdd.isLoading || mCancel.isLoading;

  const curDate = date ?? a.scheduled_date;
  const curPeriod = period ?? a.period;
  const whenChanged = curDate !== a.scheduled_date || curPeriod !== a.period;
  const dErr = whenChanged ? dateError(curDate) : null;

  const curVolUnk = volUnk ?? !!a.volumes_unknown;
  const curPalUnk = palUnk ?? !!a.pallets_unknown;
  const curVol = volumes ?? (a.volumes == null ? '' : String(a.volumes));
  const curPal = pallets ?? (a.pallets == null ? '' : String(a.pallets));
  const curNotes = notes ?? (a.notes ?? '');
  const numOk = (v: string, unk: boolean) => unk || (v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 99999);
  const dataChanged = volumes !== null || volUnk !== null || pallets !== null || palUnk !== null || notes !== null;
  const dataOk = numOk(curVol, curVolUnk) && numOk(curPal, curPalUnk);

  const nfs = a.nfs ?? [];
  const saveAll = () => {
    const body: Parameters<typeof inboundApi.update>[1] = {};
    if (whenChanged) { body.scheduled_date = curDate; body.period = curPeriod; }
    if (volumes !== null || volUnk !== null) { body.volumes_unknown = curVolUnk; body.volumes = curVolUnk ? null : Number(curVol); }
    if (pallets !== null || palUnk !== null) { body.pallets_unknown = curPalUnk; body.pallets = curPalUnk ? null : Number(curPal); }
    if (notes !== null) body.notes = curNotes;
    mUpdate.mutate(body);
  };

  return (
    <Modal title={`Agendamento #${a.id}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge a={a} />
          <span className="text-xs text-t3">{brDate(a.scheduled_date)} · {PERIOD_LABEL[a.period]}</span>
        </div>
        {a.status === 'CANCELADO' && a.cancel_reason && (
          <p className="text-xs text-t3">Motivo do cancelamento: {a.cancel_reason}</p>
        )}

        {editable ? (
          <div className="space-y-3 border border-line rounded-lg p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-t3 mb-1">Dia (reagendar)</label>
                <input type="date" className={inputCls} style={inputStyle} value={curDate}
                  min={todayBrasiliaStr()} max={addDaysStr(todayBrasiliaStr(), MAX_DAYS)} onChange={e => setDate(e.target.value)} />
                {dErr && <p className="text-[11px] text-bad mt-1">{dErr}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-t3 mb-1">Período</label>
                <div className="flex gap-2">
                  {(['MANHA', 'TARDE'] as InboundPeriod[]).map(p => (
                    <button key={p} type="button" onClick={() => setPeriod(p)}
                      className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-lg border ${curPeriod === p ? 'bg-violet-600 border-violet-600 text-white' : 'border-line text-t4 hover:text-t2'}`}>
                      {PERIOD_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CountField label="Volumes" value={curVol} unknown={curVolUnk} onValue={setVolumes} onUnknown={setVolUnk} />
              <CountField label="Paletes" value={curPal} unknown={curPalUnk} onValue={setPallets} onUnknown={setPalUnk} />
            </div>
            <div>
              <label className="block text-xs font-bold text-t3 mb-1">Observação</label>
              <textarea rows={2} maxLength={1000} className={inputCls} style={inputStyle} value={curNotes}
                onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <button className={btnPrimary} disabled={busy || !!dErr || !(whenChanged || dataChanged) || !dataOk} onClick={saveAll}>
                {mUpdate.isLoading ? 'Salvando…' : whenChanged ? 'Salvar / reagendar' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-t4">Volumes</dt><dd className="text-t2">{countText(a.volumes, a.volumes_unknown)}</dd>
            <dt className="text-t4">Paletes</dt><dd className="text-t2">{countText(a.pallets, a.pallets_unknown)}</dd>
            {a.notes && (<><dt className="text-t4">Observação</dt><dd className="text-t2">{a.notes}</dd></>)}
          </dl>
        )}

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-t3">Notas fiscais ({nfs.length})</h4>
          {nfs.map(nf => (
            <NfBlock key={nf.id} a={a} nf={nf} editable={editable} canRemove={nfs.length > 1} busy={busy}
              onReplace={(nfId, files) => mReplace.mutate({ nfId, files })} onRemove={nfId => mRemove.mutate(nfId)} />
          ))}
          {editable && nfs.length < MAX_NFS && (
            newNf ? (
              <div className="border border-dashed border-line rounded-lg p-2.5 space-y-1.5">
                <FilePick label="PDF da DANFE" accept=".pdf,application/pdf" file={newNf.pdf} onChange={f => setNewNf({ ...newNf, pdf: f })} />
                <FilePick label="XML" required accept=".xml,text/xml,application/xml" file={newNf.xml} onChange={f => setNewNf({ ...newNf, xml: f })} />
                <FilePick label="Excel" accept=".xlsx" file={newNf.xlsx} onChange={f => setNewNf({ ...newNf, xlsx: f })} />
                <div className="flex justify-end gap-2">
                  <button className={btnGhost} disabled={busy} onClick={() => setNewNf(null)}>Cancelar</button>
                  <button className={btnPrimary} disabled={busy || !newNf.xml} onClick={() => mAdd.mutate(newNf)}>
                    {mAdd.isLoading ? 'Enviando…' : 'Adicionar NF'}
                  </button>
                </div>
              </div>
            ) : (
              <button className={`${btnGhost} flex items-center gap-1`} onClick={() => setNewNf(emptyNf())}><Plus size={12} /> Adicionar NF</button>
            )
          )}
        </div>

        {a.status === 'CONFERIDO' && a.stock_summary && (
          <div>
            <h4 className="text-xs font-bold text-t3 mb-1.5">O que entrou no estoque</h4>
            <div className="border border-line rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-t4">
                  <tr><th className="text-left px-2 py-1.5">SKU</th><th className="text-right px-2 py-1.5">Na NF</th><th className="text-right px-2 py-1.5">Entrou</th></tr>
                </thead>
                <tbody>
                  {a.stock_summary.map(r => (
                    <tr key={r.sku} className="border-t border-line-soft">
                      <td className="px-2 py-1.5 text-t2 break-all">{r.sku}</td>
                      <td className="px-2 py-1.5 text-right text-t3">{r.expected}</td>
                      <td className={`px-2 py-1.5 text-right font-bold ${r.divergent ? 'text-warn' : 'text-ok'}`}>
                        {r.entered}{r.divergent && <span className="ml-1 font-normal">divergente</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {editable && (
          showCancel ? (
            <div className="border border-bad rounded-lg p-3 space-y-2">
              <p className="text-xs text-t2">Cancelar este agendamento? Isso não pode ser desfeito.</p>
              <input className={inputCls} style={inputStyle} maxLength={200} placeholder="Motivo (opcional)"
                value={reason} onChange={e => setReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button className={btnGhost} onClick={() => setShowCancel(false)} disabled={busy}>Voltar</button>
                <button className="px-4 py-2 text-xs font-bold rounded-lg bg-bad text-white disabled:opacity-40" disabled={busy}
                  onClick={() => mCancel.mutate()}>{mCancel.isLoading ? 'Cancelando…' : 'Cancelar agendamento'}</button>
              </div>
            </div>
          ) : (
            <button className="text-xs font-bold text-bad hover:underline" onClick={() => setShowCancel(true)}>Cancelar agendamento</button>
          )
        )}
      </div>
    </Modal>
  );
}

// ─── Aba ─────────────────────────────────────────────────────────────────────

export default function SellerInboundTab({ sellerId }: { sellerId: number }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<InboundStatus | ''>('');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading } = useQuery(['inbound', sellerId], () => inboundApi.list().then(r => r.data));
  const rows = (data ?? []).filter(a => !statusFilter || a.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {([['', 'Todos'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])] as [string, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k as InboundStatus | '')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-full border ${statusFilter === k ? 'bg-violet-600 border-violet-600 text-white' : 'border-line text-t4 hover:text-t2'}`}>
              {label}
            </button>
          ))}
        </div>
        <button className={`${btnPrimary} flex items-center gap-1.5`} onClick={() => setShowNew(true)}>
          <Plus size={13} /> Novo agendamento
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-t4">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="border border-line rounded-xl p-8 text-center">
          <Truck size={28} className="mx-auto text-t5 mb-2" />
          <p className="text-sm text-t3">{(data ?? []).length === 0 ? 'Nenhum agendamento ainda.' : 'Nenhum agendamento com esse status.'}</p>
        </div>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden md:block border border-line rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-t4 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Período</th>
                  <th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">NFs</th>
                  <th className="text-right px-3 py-2">Volumes</th><th className="text-right px-3 py-2">Paletes</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id} className="border-t border-line-soft hover:bg-surface-2/50 cursor-pointer" onClick={() => setOpenId(a.id)}>
                    <td className="px-3 py-2 text-t1 font-bold">{brDate(a.scheduled_date)}</td>
                    <td className="px-3 py-2 text-t3">{PERIOD_LABEL[a.period]}</td>
                    <td className="px-3 py-2"><StatusBadge a={a} /></td>
                    <td className="px-3 py-2 text-right text-t3">{a.nf_count}</td>
                    <td className="px-3 py-2 text-right text-t3">{countText(a.volumes, a.volumes_unknown)}</td>
                    <td className="px-3 py-2 text-right text-t3">{countText(a.pallets, a.pallets_unknown)}</td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-violet-500">Abrir</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Celular: cartões */}
          <div className="md:hidden space-y-2">
            {rows.map(a => (
              <button key={a.id} onClick={() => setOpenId(a.id)}
                className="w-full text-left border border-line rounded-xl p-3 bg-surface space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-t1">{brDate(a.scheduled_date)} · {PERIOD_LABEL[a.period]}</span>
                  <StatusBadge a={a} />
                </div>
                <div className="text-xs text-t3">
                  {a.nf_count} NF(s) · Volumes: {countText(a.volumes, a.volumes_unknown)} · Paletes: {countText(a.pallets, a.pallets_unknown)}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {showNew && (
        <NewAppointmentModal
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); qc.invalidateQueries('inbound'); }}
        />
      )}
      {openId !== null && <DetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
