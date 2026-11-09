/**
 * WMS Kiwkiw - Aba "Vencimentos" do Portal do Seller (03/11/2026) — Fase 4a.
 *
 * O seller cadastra quantas unidades de cada SKU vencem em cada data. Esta
 * tela é INFORMATIVA — nunca mexe em estoque. A baixa de saída usa FEFO em
 * cima destas linhas (Fase 3); a bipagem exibe o aviso de vencido.
 *
 * Duas visões: Por data (lista plana) ou Por SKU (agrupado). Filtros: situação
 * (vencido/aviso/ok), inclui "a chegar", busca por SKU/nome. Exportação em
 * Excel respeita os filtros. Botão em cada linha abre o pedido de descarte/
 * retirada; o acompanhamento (Solicitado/Atendido/Cancelado) fica num bloco
 * à parte.
 *
 * Configuração de aviso (padrão + override por SKU) num painel colapsado.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  AlertTriangle, Plus, Trash2, Pencil, X, Download, Settings as SettingsIcon,
  Clock, PackageX, ListChecks, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

import {
  expiryApi, ExpiryLine, ExpiryDisposal, ExpiryAlertConfig, cadastrosApi,
} from '../api';

const inputCls =
  'w-full px-2.5 py-1.5 border border-line rounded-lg text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500 placeholder-t5';
const inputStyle = { background: 'rgb(var(--surface-2))' };

type Situation = 'vencido' | 'aviso' | 'ok';
type View = 'date' | 'sku';

const SIT_BADGE: Record<Situation, string> = {
  vencido: 'bg-bad text-white',
  aviso:   'bg-amber-500 text-white',
  ok:      'bg-ok text-white',
};

const SIT_LABEL: Record<Situation, string> = {
  vencido: 'Vencido',
  aviso:   'Dentro do aviso',
  ok:      'OK',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function daysLabel(d: number): string {
  if (d === 0) return 'hoje';
  if (d < 0)  return `${-d}d atrás`;
  return `em ${d}d`;
}


// ─────────────────────────────────────────────────────────────────────
// SkuPicker: autocomplete com portal (padrão de Returns/Insumos)
// ─────────────────────────────────────────────────────────────────────

interface SkuOption { sku: string; name: string }

function SkuPicker({
  sellerId, value, onChange,
}: {
  sellerId: number;
  value: string;
  onChange: (sku: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const { data = { items: [] } } = useQuery(
    ['sku-picker', sellerId, query],
    () => cadastrosApi.products({ seller_id: sellerId, search: query, page_size: 20 }),
    { enabled: open && !!sellerId },
  );
  const items: SkuOption[] = (data as any).items?.map((p: any) => ({
    sku: p.sku, name: p.name,
  })) || [];

  function reposition() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ left: r.left, top: r.bottom + 4, width: r.width });
  }

  useEffect(() => {
    if (!open) return;
    reposition();
    const h = () => reposition();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={inputCls}
        style={inputStyle}
        value={query}
        placeholder="SKU"
        onFocus={() => { setOpen(true); reposition(); }}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && coords && createPortal(
        <div
          className="z-[2000] rounded-lg border border-line shadow-lg max-h-64 overflow-auto"
          style={{
            position: 'fixed',
            left: coords.left, top: coords.top, width: coords.width,
            background: 'rgb(var(--surface))',
          }}
        >
          {items.length === 0 && (
            <div className="px-3 py-2 text-sm text-t4">Nenhum produto</div>
          )}
          {items.map((it) => (
            <button
              key={it.sku}
              type="button"
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2"
              onMouseDown={(e) => { e.preventDefault(); onChange(it.sku); setQuery(it.sku); setOpen(false); }}
            >
              <span className="font-mono text-t1">{it.sku}</span>
              <span className="text-t4"> — {it.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Diálogo de descarte / retirada
// ─────────────────────────────────────────────────────────────────────

function DisposalDialog({
  line, onClose, onCreated,
}: {
  line: ExpiryLine;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<'descarte' | 'retirada'>('descarte');
  const [qty, setQty] = useState<number>(line.qty_disponivel);
  const [obs, setObs] = useState<string>('');

  const create = useMutation(
    () => expiryApi.createDisposal({ expiry_line_id: line.id, type, qty, obs: obs || undefined }),
    {
      onSuccess: () => {
        toast.success('Pedido registrado — a Kiwkiw vai atender.');
        onCreated();
        onClose();
      },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao registrar.'); },
    },
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl p-5"
        style={{ background: 'rgb(var(--surface))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-t1">
            Pedido de descarte / retirada
          </h3>
          <button onClick={onClose} className="text-t4 hover:text-t2"><X size={18} /></button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="text-t3">
            <span className="font-mono text-t1">{line.sku}</span>
            {line.product_name && <span className="text-t4"> — {line.product_name}</span>}
            <br/>
            <span className="text-t4">
              {line.lot_name ? `Lote ${line.lot_name} · ` : ''}Vencimento {fmtDate(line.expiry_date)} · disponível {line.qty_disponivel}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${
                type === 'descarte' ? 'bg-violet-600 text-white' : 'border border-line text-t2'
              }`}
              onClick={() => setType('descarte')}
            >
              Descarte
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${
                type === 'retirada' ? 'bg-violet-600 text-white' : 'border border-line text-t2'
              }`}
              onClick={() => setType('retirada')}
            >
              Retirada
            </button>
          </div>

          <label className="block">
            <span className="text-t3">Quantidade</span>
            <input
              type="number"
              min={1}
              max={line.qty_disponivel}
              value={qty}
              className={inputCls}
              style={inputStyle}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 0))}
            />
          </label>

          <label className="block">
            <span className="text-t3">Observação (opcional)</span>
            <textarea
              className={inputCls}
              style={{ ...inputStyle, minHeight: 60 }}
              maxLength={500}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              className="flex-1 py-2 rounded-lg border border-line text-t2 text-sm"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={qty < 1 || qty > line.qty_disponivel || create.isLoading}
              className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-50"
              onClick={() => create.mutate()}
            >
              {create.isLoading ? 'Enviando...' : 'Pedir'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ─────────────────────────────────────────────────────────────────────
// Painel de configuração de aviso (collapsable)
// ─────────────────────────────────────────────────────────────────────

function AlertConfigPanel({ config, onChanged }: { config: ExpiryAlertConfig; onChanged: () => void }) {
  const [defaultDays, setDefaultDays] = useState<number>(config.default_days);
  const [newSku, setNewSku] = useState('');
  const [newDays, setNewDays] = useState<number>(30);

  useEffect(() => { setDefaultDays(config.default_days); }, [config.default_days]);

  const putDefault = useMutation(() => expiryApi.putAlertConfig(defaultDays), {
    onSuccess: () => { toast.success('Padrão salvo'); onChanged(); },
    onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao salvar.'); },
  });
  const putOverride = useMutation(
    (data: { sku: string; days: number | null }) => expiryApi.putAlertOverride(data.sku, data.days),
    {
      onSuccess: () => { toast.success('Override salvo'); onChanged(); setNewSku(''); setNewDays(30); },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao salvar.'); },
    },
  );

  return (
    <div className="rounded-lg border border-line p-4" style={{ background: 'rgb(var(--surface))' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-t3 flex items-center gap-2">
          Dias de aviso padrão:
          <input
            type="number"
            min={0}
            max={3650}
            value={defaultDays}
            className="w-20 px-2 py-1 border border-line rounded text-sm text-t2"
            style={inputStyle}
            onChange={(e) => setDefaultDays(parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <button
          type="button"
          className="px-3 py-1 bg-violet-600 text-white rounded-lg text-sm"
          onClick={() => putDefault.mutate()}
          disabled={putDefault.isLoading || defaultDays === config.default_days}
        >
          Salvar padrão
        </button>
      </div>

      <div className="mt-4">
        <div className="text-xs text-t4 mb-1 uppercase tracking-wide">Override por SKU</div>
        {config.overrides.length === 0 ? (
          <div className="text-xs text-t5 italic">Nenhum override — todos os SKUs usam o padrão acima.</div>
        ) : (
          <div className="space-y-1">
            {config.overrides.map((o) => (
              <div key={o.sku} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-t1 flex-1">{o.sku}</span>
                <span className="text-t3">{o.days} dias</span>
                <button
                  type="button"
                  className="text-bad hover:underline text-xs"
                  onClick={() => putOverride.mutate({ sku: o.sku, days: null })}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            placeholder="SKU"
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
            className={`${inputCls} flex-1`}
            style={inputStyle}
          />
          <input
            type="number"
            min={0}
            max={3650}
            value={newDays}
            onChange={(e) => setNewDays(parseInt(e.target.value, 10) || 0)}
            className="w-20 px-2 py-1 border border-line rounded text-sm text-t2"
            style={inputStyle}
          />
          <button
            type="button"
            disabled={!newSku.trim() || putOverride.isLoading}
            className="px-3 py-1 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
            onClick={() => putOverride.mutate({ sku: newSku.trim(), days: newDays })}
          >
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Tela principal
// ─────────────────────────────────────────────────────────────────────

export default function SellerExpiryTab({ sellerId, readOnly = false, initialSearch = '' }: {
  sellerId: number;
  readOnly?: boolean;
  initialSearch?: string;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('date');
  const [sitFilter, setSitFilter] = useState<Situation | ''>('');
  const [includeAChegar, setIncludeAChegar] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [disposalFor, setDisposalFor] = useState<ExpiryLine | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editLot, setEditLot] = useState<string>('');

  // Form novo
  const [newSku, setNewSku] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newLot, setNewLot] = useState('');
  const [newQty, setNewQty] = useState<number>(1);

  const linesQ = useQuery(
    ['expiry-lines', sellerId, sitFilter, includeAChegar, search],
    () => expiryApi.listLines({
      seller_id: readOnly ? sellerId : undefined,
      situation_filter: sitFilter || undefined,
      include_a_chegar: includeAChegar,
      search: search || undefined,
    }).then(r => r.data),
    { enabled: !!sellerId },
  );
  const lines: ExpiryLine[] = linesQ.data || [];

  const configQ = useQuery(
    ['expiry-alert-config', sellerId],
    () => expiryApi.alertConfig(readOnly ? sellerId : undefined).then(r => r.data),
    { enabled: !!sellerId },
  );
  const config: ExpiryAlertConfig = configQ.data || { default_days: 30, overrides: [] };

  const disposalsQ = useQuery(
    ['expiry-disposals', sellerId],
    () => expiryApi.listDisposals({ seller_id: readOnly ? sellerId : undefined }).then(r => r.data),
    { enabled: !!sellerId },
  );
  const disposals: ExpiryDisposal[] = disposalsQ.data || [];

  const invalidateAll = () => {
    qc.invalidateQueries(['expiry-lines', sellerId]);
    qc.invalidateQueries(['expiry-disposals', sellerId]);
  };

  const createLine = useMutation(
    () => expiryApi.createLine({
      sku: newSku.trim(), expiry_date_text: newDate.trim(), quantity: newQty,
      lot_name: newLot.trim() || undefined,
    }),
    {
      onSuccess: () => {
        toast.success('Vencimento adicionado');
        setShowAdd(false); setNewSku(''); setNewDate(''); setNewLot(''); setNewQty(1);
        invalidateAll();
      },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao adicionar.'); },
    },
  );

  const updateLine = useMutation(
    (data: { id: number; expiry_date_text?: string; quantity?: number; lot_name?: string }) =>
      expiryApi.updateLine(data.id, {
        expiry_date_text: data.expiry_date_text, quantity: data.quantity, lot_name: data.lot_name,
      }),
    {
      onSuccess: () => {
        toast.success('Linha atualizada');
        setEditingId(null);
        invalidateAll();
      },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao atualizar.'); },
    },
  );

  const deleteLine = useMutation(
    (id: number) => expiryApi.deleteLine(id),
    {
      onSuccess: () => { toast.success('Linha removida'); invalidateAll(); },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao remover.'); },
    },
  );

  const cancelDisposal = useMutation(
    (id: number) => expiryApi.cancelDisposal(id),
    {
      onSuccess: () => { toast.success('Pedido cancelado'); invalidateAll(); },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Falha ao cancelar.'); },
    },
  );

  // Agrupamento por SKU
  const grouped = useMemo(() => {
    const m: Record<string, ExpiryLine[]> = {};
    for (const l of lines) (m[l.sku] = m[l.sku] || []).push(l);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [lines]);

  const openDisposals = disposals.filter((d) => d.status === 'solicitado');

  return (
    <div className="space-y-4">
      {/* Aviso fixo (padrão de Insumos — nunca remover) */}
      <div
        className="flex items-start gap-2 p-3 rounded-lg border text-sm"
        style={{
          borderColor: 'rgb(var(--warn) / 0.4)',
          background: 'rgb(var(--warn-soft))',
          color: 'rgb(var(--warn))',
        }}
      >
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <div>
          Esta aba é <strong>informativa</strong>. Os vencimentos cadastrados aqui orientam
          a Kiwkiw a escolher o lote mais próximo primeiro (FEFO) na expedição, mas não
          substituem o estoque — a quantidade total continua vindo do estoque.
        </div>
      </div>

      {/* Barra de controle */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-lg overflow-hidden border border-line">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm ${view === 'date' ? 'bg-violet-600 text-white' : 'text-t2'}`}
            onClick={() => setView('date')}
          >
            Por data
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm ${view === 'sku' ? 'bg-violet-600 text-white' : 'text-t2'}`}
            onClick={() => setView('sku')}
          >
            Por SKU
          </button>
        </div>

        <div className="flex gap-1 flex-wrap">
          {(['', 'vencido', 'aviso', 'ok'] as const).map((s) => (
            <button
              key={s || 'todos'}
              type="button"
              className={`px-2.5 py-1 text-xs rounded-full border ${
                sitFilter === s
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'text-t3 border-line'
              }`}
              onClick={() => setSitFilter(s)}
            >
              {s === '' ? 'Todas' : SIT_LABEL[s]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-t3 ml-2">
          <input
            type="checkbox"
            checked={includeAChegar}
            onChange={(e) => setIncludeAChegar(e.target.checked)}
          />
          Incluir "a chegar"
        </label>

        <input
          type="text"
          placeholder="Buscar SKU, produto ou lote"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputCls} max-w-xs ml-auto`}
          style={inputStyle}
        />

        <button
          type="button"
          className="px-3 py-1.5 text-sm rounded-lg border border-line text-t2 flex items-center gap-1.5"
          onClick={() =>
            expiryApi.exportXlsx({
              seller_id: readOnly ? sellerId : undefined,
              situation_filter: sitFilter || undefined,
              include_a_chegar: includeAChegar,
              search: search || undefined,
            }).catch(() => toast.error('Falha ao baixar Excel.'))
          }
        >
          <Download size={14} /> Excel
        </button>

        {!readOnly && (
          <>
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded-lg border border-line text-t2 flex items-center gap-1.5"
              onClick={() => setShowConfig((v) => !v)}
            >
              <SettingsIcon size={14} /> Avisos
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white flex items-center gap-1.5"
              onClick={() => setShowAdd((v) => !v)}
            >
              <Plus size={14} /> Novo
            </button>
          </>
        )}
      </div>

      {!readOnly && showConfig && (
        <AlertConfigPanel
          config={config}
          onChanged={() => qc.invalidateQueries(['expiry-alert-config', sellerId])}
        />
      )}

      {!readOnly && showAdd && (
        <div className="p-3 rounded-lg border border-line space-y-2" style={{ background: 'rgb(var(--surface))' }}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_140px_120px_auto] gap-2 items-end">
            <div>
              <div className="text-xs text-t4 mb-0.5">SKU</div>
              <SkuPicker sellerId={sellerId} value={newSku} onChange={setNewSku} />
            </div>
            <div>
              <div className="text-xs text-t4 mb-0.5">Lote (opcional)</div>
              <input
                type="text"
                value={newLot}
                maxLength={60}
                onChange={(e) => setNewLot(e.target.value)}
                placeholder="L2501"
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div>
              <div className="text-xs text-t4 mb-0.5">Vencimento (dd/mm/aaaa ou mm/aaaa)</div>
              <input
                type="text"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                placeholder="15/03/2027"
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div>
              <div className="text-xs text-t4 mb-0.5">Quantidade</div>
              <input
                type="number"
                min={1}
                value={newQty}
                onChange={(e) => setNewQty(Math.max(1, parseInt(e.target.value, 10) || 0))}
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <button
              type="button"
              disabled={!newSku.trim() || !newDate.trim() || newQty < 1 || createLine.isLoading}
              className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
              onClick={() => createLine.mutate()}
            >
              Adicionar
            </button>
          </div>
        </div>
      )}

      {linesQ.isLoading ? (
        <div className="text-t4 text-sm">Carregando…</div>
      ) : lines.length === 0 ? (
        <EmptyState readOnly={readOnly} />
      ) : view === 'date' ? (
        <LinesList
          lines={lines}
          readOnly={readOnly}
          editingId={editingId}
          editQty={editQty}
          editDate={editDate}
          editLot={editLot}
          onEditStart={(l) => { setEditingId(l.id); setEditQty(l.qty_atual); setEditDate(fmtDate(l.expiry_date)); setEditLot(l.lot_name || ''); }}
          onEditQty={setEditQty}
          onEditDate={setEditDate}
          onEditLot={setEditLot}
          onEditCancel={() => setEditingId(null)}
          onEditSave={(l) => {
            const payload: { expiry_date_text?: string; quantity?: number; lot_name?: string } = {};
            const originalDate = fmtDate(l.expiry_date);
            if (editDate && editDate !== originalDate) payload.expiry_date_text = editDate;
            if (editQty !== l.qty_atual) payload.quantity = editQty;
            if (editLot.trim() !== (l.lot_name || '')) payload.lot_name = editLot.trim();
            if (!payload.expiry_date_text && payload.quantity === undefined && payload.lot_name === undefined) {
              setEditingId(null); return;
            }
            updateLine.mutate({ id: l.id, ...payload });
          }}
          onDelete={(l) => {
            if (confirm(`Remover a linha de ${l.sku} (${fmtDate(l.expiry_date)}, ${l.qty_atual} un)?`)) {
              deleteLine.mutate(l.id);
            }
          }}
          onDispose={setDisposalFor}
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([sku, items]) => (
            <div key={sku} className="rounded-lg border border-line overflow-hidden">
              <div className="px-3 py-2 bg-surface-2 border-b border-line text-sm">
                <span className="font-mono text-t1 font-semibold">{sku}</span>
                <span className="text-t4"> · {items[0].product_name || '—'} · total {items.reduce((s, i) => s + i.qty_atual, 0)} un</span>
              </div>
              <LinesList
                lines={items}
                readOnly={readOnly}
                compact
                editingId={editingId}
                editQty={editQty}
                editDate={editDate}
                editLot={editLot}
                onEditStart={(l) => { setEditingId(l.id); setEditQty(l.qty_atual); setEditDate(fmtDate(l.expiry_date)); setEditLot(l.lot_name || ''); }}
                onEditQty={setEditQty}
                onEditDate={setEditDate}
                onEditLot={setEditLot}
                onEditCancel={() => setEditingId(null)}
                onEditSave={(l) => {
                  const payload: { expiry_date_text?: string; quantity?: number; lot_name?: string } = {};
                  const originalDate = fmtDate(l.expiry_date);
                  if (editDate && editDate !== originalDate) payload.expiry_date_text = editDate;
                  if (editQty !== l.qty_atual) payload.quantity = editQty;
                  if (editLot.trim() !== (l.lot_name || '')) payload.lot_name = editLot.trim();
                  if (!payload.expiry_date_text && payload.quantity === undefined && payload.lot_name === undefined) {
                    setEditingId(null); return;
                  }
                  updateLine.mutate({ id: l.id, ...payload });
                }}
                onDelete={(l) => {
                  if (confirm(`Remover a linha de ${l.sku} (${fmtDate(l.expiry_date)}, ${l.qty_atual} un)?`)) {
                    deleteLine.mutate(l.id);
                  }
                }}
                onDispose={setDisposalFor}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pedidos de descarte/retirada */}
      <DisposalsPanel
        disposals={disposals}
        readOnly={readOnly}
        onCancel={(id) => cancelDisposal.mutate(id)}
      />

      {disposalFor && (
        <DisposalDialog
          line={disposalFor}
          onClose={() => setDisposalFor(null)}
          onCreated={invalidateAll}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Lista de linhas (tabela desktop + cards mobile)
// ─────────────────────────────────────────────────────────────────────

function LinesList({
  lines, readOnly, compact,
  editingId, editQty, editDate, editLot,
  onEditStart, onEditQty, onEditDate, onEditLot, onEditCancel, onEditSave,
  onDelete, onDispose,
}: {
  lines: ExpiryLine[];
  readOnly: boolean;
  compact?: boolean;
  editingId: number | null;
  editQty: number;
  editDate: string;
  editLot: string;
  onEditStart: (l: ExpiryLine) => void;
  onEditQty: (q: number) => void;
  onEditDate: (s: string) => void;
  onEditLot: (s: string) => void;
  onEditCancel: () => void;
  onEditSave: (l: ExpiryLine) => void;
  onDelete: (l: ExpiryLine) => void;
  onDispose: (l: ExpiryLine) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {!compact && (
          <thead>
            <tr className="text-left text-t4 border-b border-line">
              <th className="py-2 px-3">SKU</th>
              <th className="py-2 px-3">Produto</th>
              <th className="py-2 px-3">Lote</th>
              <th className="py-2 px-3">Vencimento</th>
              <th className="py-2 px-3 text-right">Qtd</th>
              <th className="py-2 px-3 text-right">Dias</th>
              <th className="py-2 px-3">Situação</th>
              <th className="py-2 px-3">Origem</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
        )}
        <tbody>
          {lines.map((l) => {
            const isEditing = editingId === l.id && !readOnly;
            return (
              <tr key={l.id} className="border-b border-line/60 hover:bg-surface-2/40">
                {!compact && <td className="py-1.5 px-3 font-mono text-t1">{l.sku}</td>}
                {!compact && <td className="py-1.5 px-3 text-t2">{l.product_name || '—'}</td>}
                {compact && (
                  <td className="py-1.5 px-3 text-t4 italic">
                    {l.state === 'a_chegar' && <span className="mr-1">⏳</span>}
                  </td>
                )}
                <td className="py-1.5 px-3 text-t2">
                  {isEditing ? (
                    <input
                      type="text"
                      className={inputCls}
                      style={inputStyle}
                      maxLength={60}
                      placeholder="Sem lote"
                      value={editLot}
                      onChange={(e) => onEditLot(e.target.value)}
                    />
                  ) : (l.lot_name || <span className="text-t5">Sem lote</span>)}
                </td>
                <td className="py-1.5 px-3 text-t2">
                  {isEditing ? (
                    <input
                      type="text"
                      className={inputCls}
                      style={inputStyle}
                      value={editDate}
                      onChange={(e) => onEditDate(e.target.value)}
                    />
                  ) : fmtDate(l.expiry_date)}
                </td>
                <td className="py-1.5 px-3 text-right text-t2">
                  {isEditing ? (
                    <input
                      type="number"
                      min={1}
                      className={`${inputCls} w-20 inline-block`}
                      style={inputStyle}
                      value={editQty}
                      onChange={(e) => onEditQty(parseInt(e.target.value, 10) || 0)}
                    />
                  ) : (
                    <>
                      {l.qty_atual}
                      {l.qty_reservada > 0 && (
                        <span className="text-t5 text-xs"> ({l.qty_reservada} reserv.)</span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right text-t3 text-xs">{daysLabel(l.days_remaining)}</td>
                <td className="py-1.5 px-3">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${SIT_BADGE[l.situation]}`}>
                    {SIT_LABEL[l.situation]}
                  </span>
                  {l.state === 'a_chegar' && !compact && (
                    <span className="ml-1 inline-block px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-200">
                      A chegar
                    </span>
                  )}
                </td>
                {!compact && (
                  <td className="py-1.5 px-3 text-t4 text-xs">
                    {l.origin_type === 'inbound' && l.origin_nf_number
                      ? `NF ${l.origin_nf_number}` : l.origin_type}
                  </td>
                )}
                <td className="py-1.5 px-3 text-right whitespace-nowrap">
                  {isEditing ? (
                    <>
                      <button
                        className="text-xs text-ok hover:underline mr-2"
                        onClick={() => onEditSave(l)}
                      >Salvar</button>
                      <button
                        className="text-xs text-t4 hover:underline"
                        onClick={onEditCancel}
                      >Cancelar</button>
                    </>
                  ) : readOnly ? null : (
                    <>
                      <button
                        className="text-t4 hover:text-t2 mr-2"
                        title="Editar"
                        onClick={() => onEditStart(l)}
                      ><Pencil size={14} /></button>
                      <button
                        className="text-t4 hover:text-bad mr-2"
                        title="Remover"
                        onClick={() => onDelete(l)}
                      ><Trash2 size={14} /></button>
                      <button
                        className="text-xs px-2 py-0.5 border border-line rounded hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        disabled={l.situation !== 'vencido'}
                        title={l.situation !== 'vencido'
                          ? 'Disponível somente após o vencimento'
                          : 'Pedir descarte ou retirada'}
                        onClick={() => onDispose(l)}
                      ><PackageX size={12} className="inline mr-1"/>Descarte / retirada</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function EmptyState({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="p-6 rounded-lg border border-dashed border-line text-center">
      <Clock size={28} className="mx-auto text-t5 mb-2" />
      <div className="text-t2 font-medium">Nenhum vencimento cadastrado</div>
      {!readOnly && (
        <div className="text-t4 text-sm mt-1">
          Clique em <strong>Novo</strong> para adicionar, ou cadastre direto no agendamento de inbound.
        </div>
      )}
    </div>
  );
}


function DisposalsPanel({
  disposals, readOnly, onCancel,
}: {
  disposals: ExpiryDisposal[];
  readOnly: boolean;
  onCancel: (id: number) => void;
}) {
  if (disposals.length === 0) return null;
  return (
    <div className="rounded-lg border border-line overflow-hidden mt-6">
      <div className="px-3 py-2 bg-surface-2 border-b border-line text-sm flex items-center gap-1.5">
        <ListChecks size={14} /> Pedidos de descarte / retirada
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-t4 border-b border-line">
            <th className="py-1.5 px-3">SKU</th>
            <th className="py-1.5 px-3">Tipo</th>
            <th className="py-1.5 px-3 text-right">Qtd</th>
            <th className="py-1.5 px-3">Lote</th>
            <th className="py-1.5 px-3">Vencimento</th>
            <th className="py-1.5 px-3">Status</th>
            <th className="py-1.5 px-3">Pedido em</th>
            <th className="py-1.5 px-3" />
          </tr>
        </thead>
        <tbody>
          {disposals.map((d) => (
            <tr key={d.id} className="border-b border-line/60">
              <td className="py-1.5 px-3 font-mono text-t1">{d.sku}</td>
              <td className="py-1.5 px-3 text-t2 capitalize">{d.type}</td>
              <td className="py-1.5 px-3 text-right text-t2">{d.qty}</td>
              <td className="py-1.5 px-3 text-t2">{d.lot_name || <span className="text-t5">—</span>}</td>
              <td className="py-1.5 px-3 text-t3">{fmtDate(d.expiry_date)}</td>
              <td className="py-1.5 px-3">
                <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                  d.status === 'atendido' ? 'bg-ok text-white'
                  : d.status === 'cancelado' ? 'bg-t5 text-white'
                  : 'bg-amber-500 text-white'
                }`}>
                  {d.status === 'solicitado' ? 'Aguardando'
                    : d.status === 'atendido' ? 'Atendido' : 'Cancelado'}
                </span>
              </td>
              <td className="py-1.5 px-3 text-t4 text-xs">
                {new Date(d.requested_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className="py-1.5 px-3 text-right">
                {!readOnly && d.status === 'solicitado' && (
                  <button
                    className="text-xs text-bad hover:underline"
                    onClick={() => { if (confirm('Cancelar este pedido?')) onCancel(d.id); }}
                  >Cancelar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
