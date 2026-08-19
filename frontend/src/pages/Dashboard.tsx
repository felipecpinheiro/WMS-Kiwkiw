/**
 * WMS Kiwkiw - Dashboard Master
 * Cockpit gerencial com visão geral do dia: pedidos, unidades, sellers, checagens e auditoria.
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Package, CheckCircle, Clock, ScanLine, AlertTriangle,
  ChevronRight, ChevronDown, RefreshCw, Upload, CheckSquare, XSquare, FileText, X, ClipboardPaste, Trash2,
} from 'lucide-react';
import { dashboardApi, ordersApi, scanningApi, cadastrosApi, DuplicateOrderInfo, InactiveSellerInfo, UnmatchedSellerInfo, SellerLinkDecision, StockApplyReport, PendingStockOrderInfo, MissingProductInfo, SkuResolutionItem, MissingSkuLineInfo } from '../api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { todayBrasiliaStr } from '../timezone';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── Componentes auxiliares ─────────────────────────────────

function StatCard({
  icon: Icon, label, value, color, sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-white/8 shadow-none">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-white/50 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-white/35 mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-white/4`}>
          <Icon size={20} className={color} />
        </div>
      </div>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg border ${ok ? 'bg-emerald-900/30 border-emerald-500/20' : 'bg-red-900/25 border-red-500/20'}`}>
      {ok ? (
        <CheckSquare size={16} className="text-violet-400 flex-shrink-0" />
      ) : (
        <XSquare size={16} className="text-red-500 flex-shrink-0" />
      )}
      <span className={`text-xs font-medium ${ok ? 'text-violet-300' : 'text-red-600'}`}>{label}</span>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────

// ─── CarrierModal — grid estilo Excel com suporte a Ctrl+V ───
function CarrierModal({ orders, onClose, onSave }: {
  orders: any[];
  onClose: () => void;
  onSave: (updates: Record<number, string>) => void;
}) {
  // Inicializa com transportadoras já preenchidas (se houver)
  const [carriers, setCarriers] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    orders.forEach((o: any) => { if (o.carrier) init[o.order_id] = o.carrier; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Ctrl+V: aceita colar do Excel (tab-separated, uma linha por NF)
  // Formato esperado: NF\tTransportadora  ou só Transportadora por linha
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const newCarriers = { ...carriers };
    lines.forEach(line => {
      const parts = line.split('\t');
      // Se duas colunas: NF | Transportadora → encontra a NF correspondente
      if (parts.length >= 2) {
        const nf       = parts[0].trim();
        const carrier  = parts[1].trim();
        const matched  = orders.find((o: any) => String(o.nf_number).trim() === nf);
        if (matched && carrier) newCarriers[matched.order_id] = carrier;
      } else if (parts.length === 1 && parts[0].trim()) {
        // Uma coluna apenas: aplica na ordem sequencial das linhas sem transportadora
        const carrier = parts[0].trim();
        const missing = orders.find((o: any) => !newCarriers[o.order_id]);
        if (missing) newCarriers[missing.order_id] = carrier;
      }
    });
    setCarriers(newCarriers);
    e.preventDefault();
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(carriers); }
    finally { setSaving(false); }
  };

  const filled   = Object.values(carriers).filter(v => v.trim()).length;
  const total    = orders.length;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">Informar Transportadoras</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              Cole do Excel (NF · Tab · Transportadora) ou edite linha a linha · {filled}/{total} preenchidas
            </p>
          </div>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>

        {/* Instrução de paste */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-900/15 border border-amber-500/20 rounded-lg px-3 py-2">
            <ClipboardPaste size={13} className="flex-shrink-0" />
            <span>Clique em qualquer célula da coluna Transportadora e cole (Ctrl+V) os dados copiados do Excel</span>
          </div>
        </div>

        {/* Grid */}
        <div ref={gridRef} className="flex-1 overflow-y-auto px-5 py-3" onPaste={handlePaste}>
          {/* Header row */}
          <div className="grid text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1 px-1"
               style={{ gridTemplateColumns: '2rem 7rem 1fr 2fr' }}>
            <span>#</span><span>NF</span><span>Seller</span><span>Transportadora</span>
          </div>

          <div className="space-y-0.5">
            {orders.map((o: any, idx: number) => {
              const val = carriers[o.order_id] ?? '';
              const filled_row = val.trim().length > 0;
              return (
                <div
                  key={o.order_id}
                  className="grid items-center rounded"
                  style={{ gridTemplateColumns: '2rem 7rem 1fr 2fr',
                           background: filled_row ? 'rgba(109,89,222,0.08)' : 'transparent' }}
                >
                  <span className="text-[10px] text-white/25 px-1">{idx + 1}</span>
                  <span className="text-xs font-mono text-white/60 truncate px-1">{o.nf_number}</span>
                  <span className="text-xs text-white/40 truncate px-1">{o.seller_name}</span>
                  <input
                    value={val}
                    onChange={e => setCarriers(prev => ({ ...prev, [o.order_id]: e.target.value }))}
                    onPaste={handlePaste}
                    placeholder="—"
                    className="w-full border-0 border-b outline-none text-xs py-1 px-2 text-white/80 placeholder-white/20 transition-colors"
                    style={{
                      background: 'transparent',
                      borderBottomColor: filled_row ? 'rgba(109,89,222,0.5)' : 'rgba(255,255,255,0.08)',
                    }}
                    onFocus={e => (e.currentTarget.style.borderBottomColor = '#7B63E8')}
                    onBlur={e => (e.currentTarget.style.borderBottomColor = filled_row ? 'rgba(109,89,222,0.5)' : 'rgba(255,255,255,0.08)')}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
          <button
            onClick={() => setCarriers({})}
            className="text-xs text-white/30 hover:text-white/60 transition"
          >Limpar tudo</button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || filled === 0}
              className="px-4 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition disabled:opacity-50">
              {saving ? 'Salvando…' : `Salvar ${filled} transportadora(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// RESOLUÇÃO EM LOTE DAS PENDÊNCIAS DE ESTOQUE (10/08/2026)
// ══════════════════════════════════════════════════════════════════
// O aviso vermelho do Dashboard listava a pendência mas não resolvia: a pessoa
// tinha que sair pra tela de Pedidos e completar NF a NF (chegou a 6.703 numa
// sexta). Subir arquivo é o core da operação — não pode parar por isso.
//
// São dois modais separados de propósito, um por tipo de pendência. NF que tem
// as DUAS pendências aparece nos dois e só baixa quando a última for resolvida
// (quem decide isso é o backend, em apply_stock_for_orders).

/** Agrupa por seller preservando uma ordem estável (nome, depois id). */
function groupBySeller<T extends { seller_id: number; seller_name: string | null }>(rows: T[]) {
  const map = new Map<number, { seller_id: number; seller_name: string; rows: T[] }>();
  for (const r of rows) {
    if (!map.has(r.seller_id)) {
      map.set(r.seller_id, { seller_id: r.seller_id, seller_name: r.seller_name || 'Sem seller', rows: [] });
    }
    map.get(r.seller_id)!.rows.push(r);
  }
  return Array.from(map.values()).sort((a, b) => a.seller_name.localeCompare(b.seller_name));
}

// Linha memoizada: sem isso, cada tecla digitada re-renderiza as 6.703 linhas.
// As props mudam só para a linha digitada — `onChange`/`onToggle` mantêm a
// identidade entre renders porque não dependem de `values`.
const CarrierRow = memo(function CarrierRow({
  order, rowIndex, value, checked, onChange, onToggle,
}: {
  order: PendingStockOrderInfo;
  rowIndex: number;
  value: string;
  checked: boolean;
  onChange: (orderId: number, v: string) => void;
  onToggle: (rowIndex: number, shiftKey: boolean) => void;
}) {
  const filled = value.trim().length > 0;
  return (
    <div
      className="grid items-center rounded gap-1 px-1"
      style={{
        gridTemplateColumns: '1.5rem 8rem 1fr 2fr',
        background: checked ? 'rgba(109,89,222,0.14)' : filled ? 'rgba(109,89,222,0.06)' : 'transparent',
        // Deixa o navegador pular layout/paint das linhas fora da tela.
        contentVisibility: 'auto',
        containIntrinsicSize: '28px',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => { /* controlado pelo onClick, que traz o shiftKey */ }}
        onClick={(e) => onToggle(rowIndex, e.shiftKey)}
        className="accent-violet-500 cursor-pointer"
      />
      <span className="text-xs font-mono text-white/60 truncate" title={order.nf_number}>{order.nf_number}</span>
      <span className="text-xs text-white/35 truncate" title={order.customer_name || ''}>{order.customer_name || '—'}</span>
      <input
        value={value}
        onChange={(e) => onChange(order.order_id, e.target.value)}
        placeholder="transportadora…"
        className="w-full border-0 border-b outline-none text-xs py-1 px-2 text-white/80 placeholder-white/20"
        style={{
          background: 'transparent',
          borderBottomColor: filled ? 'rgba(109,89,222,0.5)' : 'rgba(255,255,255,0.08)',
        }}
      />
    </div>
  );
});

/** Modal 1 — transportadora em lote, agrupado por seller. */
function PendingCarrierModal({ orders, onClose, onSave }: {
  orders: PendingStockOrderInfo[];
  onClose: () => void;
  onSave: (updates: { order_id: number; carrier: string }[]) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmPartial, setConfirmPartial] = useState(false);
  const lastIndexRef = useRef<number | null>(null);
  const broadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = useMemo(() => groupBySeller(orders), [orders]);
  // Ordem achatada — é sobre ela que o Shift+clique calcula o intervalo.
  const flat = useMemo(() => groups.flatMap(g => g.rows), [groups]);

  useEffect(() => () => { if (broadcastRef.current) clearTimeout(broadcastRef.current); }, []);

  // Digitar numa linha selecionada propaga para TODAS as selecionadas, sem
  // clique nenhum. A propagação é adiada ~150ms: a linha digitada responde na
  // hora e as outras só re-renderizam quando a pessoa para de digitar — senão
  // cada tecla redesenharia milhares de linhas.
  // useCallback é obrigatório aqui: sem identidade estável o memo das linhas
  // não segura nada e cada tecla redesenha a lista inteira.
  const handleChange = useCallback((orderId: number, v: string) => {
    setValues(prev => ({ ...prev, [orderId]: v }));
    setConfirmPartial(false);
    if (selected.has(orderId) && selected.size > 1) {
      if (broadcastRef.current) clearTimeout(broadcastRef.current);
      broadcastRef.current = setTimeout(() => {
        setValues(prev => {
          const next = { ...prev };
          selected.forEach(id => { next[id] = v; });
          return next;
        });
      }, 150);
    }
  }, [selected]);

  const handleToggle = useCallback((rowIndex: number, shiftKey: boolean) => {
    const id = flat[rowIndex].order_id;
    // ⚠️ A âncora do Shift é lida e regravada AQUI, fora do setState. O updater
    // precisa ser puro: em StrictMode o React o invoca duas vezes, e escrever o
    // ref lá dentro fazia a 2ª passada já enxergar a âncora nova — o intervalo
    // colapsava e só as duas pontas ficavam marcadas. Pego no navegador.
    const anchor = lastIndexRef.current;
    lastIndexRef.current = rowIndex;
    setSelected(prev => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null) {
        const [a, b] = [anchor, rowIndex].sort((x, y) => x - y);
        // O intervalo assume o estado que a linha clicada vai passar a ter.
        const turnOn = !next.has(id);
        for (let i = a; i <= b; i++) {
          if (turnOn) next.add(flat[i].order_id);
          else next.delete(flat[i].order_id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [flat]);

  const allSelected = selected.size === flat.length && flat.length > 0;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(flat.map(o => o.order_id)));
    lastIndexRef.current = null;
  };

  const filledEntries = flat
    .map(o => ({ order_id: o.order_id, carrier: (values[o.order_id] ?? '').trim() }))
    .filter(e => e.carrier.length > 0);
  const emptyRows = flat.filter(o => !(values[o.order_id] ?? '').trim());

  const handleSave = async () => {
    if (!filledEntries.length) { toast.error('Nenhuma transportadora preenchida'); return; }
    // Avisa QUAIS NFs ficaram sem preencher, mas não prende a pessoa: com
    // milhares de NFs, exigir tudo de uma vez impediria salvar o progresso.
    if (emptyRows.length && !confirmPartial) { setConfirmPartial(true); return; }
    setSaving(true);
    try { await onSave(filledEntries); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-4xl flex flex-col" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">🚚 Resolver transportadoras</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              {flat.length} NF(s) sem transportadora · {filledEntries.length} preenchida(s)
              {selected.size > 0 && ` · ${selected.size} selecionada(s)`}
            </p>
          </div>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>

        <div className="px-5 pt-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-violet-300/90 bg-violet-900/20 border border-violet-500/25 rounded-lg px-3 py-2">
            <ClipboardPaste size={13} className="flex-shrink-0" />
            <span>
              Marque várias NFs (clique, ou <b>Shift+clique</b> para pegar o intervalo) e digite a
              transportadora em <b>uma</b> delas — vai para todas as selecionadas sozinho.
            </span>
          </div>
          <label className="flex items-center gap-2 mt-2 text-[11px] text-white/50 cursor-pointer w-fit">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-violet-500" />
            Selecionar todas ({flat.length})
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          <div className="grid text-[10px] font-bold uppercase tracking-wider text-white/25 mb-1 px-1 gap-1 sticky top-0 bg-[#14122A] py-1"
               style={{ gridTemplateColumns: '1.5rem 8rem 1fr 2fr' }}>
            <span /><span>NF</span><span>Cliente</span><span>Transportadora</span>
          </div>
          {groups.map(g => {
            const base = flat.findIndex(o => o.seller_id === g.seller_id);
            return (
              <div key={g.seller_id} className="mb-2">
                <div className="text-[11px] font-semibold text-violet-300/80 px-1 py-1 border-b border-white/8">
                  {g.seller_name} <span className="text-white/25 font-normal">({g.rows.length})</span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {g.rows.map((o, i) => (
                    <CarrierRow
                      key={o.order_id}
                      order={o}
                      rowIndex={base + i}
                      value={values[o.order_id] ?? ''}
                      checked={selected.has(o.order_id)}
                      onChange={handleChange}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {confirmPartial && emptyRows.length > 0 && (
          <div className="mx-5 mb-2 flex-shrink-0 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-500/30 rounded-lg px-3 py-2">
            <b>{emptyRows.length} NF(s) ainda sem transportadora:</b>{' '}
            {emptyRows.slice(0, 12).map(o => o.nf_number).join(', ')}
            {emptyRows.length > 12 && ` … e mais ${emptyRows.length - 12}`}
            <div className="text-amber-400/70 mt-1">
              Elas continuam pendentes. Clique de novo para salvar só as preenchidas.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
          <button onClick={() => { setValues({}); setSelected(new Set()); setConfirmPartial(false); }}
                  className="text-xs text-white/30 hover:text-white/60 transition">Limpar tudo</button>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="px-4 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || filledEntries.length === 0}
                    className="px-4 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition disabled:opacity-50">
              {saving ? 'Salvando…'
                : confirmPartial ? `Salvar mesmo assim (${filledEntries.length})`
                : `Aplicar ${filledEntries.length} transportadora(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Modal 2 — SKUs sem produto cadastrado, agrupado por seller, uma linha por SKU. */
function PendingSkuModal({ missing, onClose, onSave }: {
  missing: MissingProductInfo[];
  onClose: () => void;
  onSave: (resolutions: SkuResolutionItem[]) => Promise<void>;
}) {
  // Chave da linha: (seller, sku) — é como o estoque é indexado.
  const keyOf = (m: MissingProductInfo) => `${m.seller_id}:${m.sku}`;
  const [choice, setChoice] = useState<Record<string, string>>({});   // '' | 'create' | id do produto
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmPartial, setConfirmPartial] = useState(false);

  const groups = useMemo(() => groupBySeller(missing), [missing]);
  const sellerIds = useMemo(
    () => Array.from(new Set(missing.map(m => m.seller_id))).sort((a, b) => a - b),
    [missing],
  );

  // Produtos de cada seller para o dropdown de "vincular". Traz inativos
  // também: vincular a um inativo é permitido e o backend reativa.
  const { data: productsBySeller, isLoading: loadingProducts } = useQuery(
    ['pending-sku-products', sellerIds.join(',')],
    async () => {
      const out: Record<number, any[]> = {};
      for (const sid of sellerIds) {
        const { data } = await cadastrosApi.products({ seller_id: sid, active_only: false, page_size: 0 });
        out[sid] = data.items;
      }
      return out;
    },
    { enabled: sellerIds.length > 0, staleTime: 60000 },
  );

  const rows = useMemo(() => groups.flatMap(g => g.rows), [groups]);
  const decided = rows.filter(m => (choice[keyOf(m)] ?? '') !== '');
  const undecided = rows.filter(m => (choice[keyOf(m)] ?? '') === '');

  const handleSave = async () => {
    if (!decided.length) { toast.error('Nenhum SKU resolvido'); return; }
    const semNome = decided.filter(m =>
      choice[keyOf(m)] === 'create' && !(names[keyOf(m)] ?? m.product_name ?? '').trim()
    );
    if (semNome.length) {
      toast.error(`Informe o nome do produto: ${semNome.slice(0, 5).map(m => m.sku).join(', ')}`);
      return;
    }
    if (undecided.length && !confirmPartial) { setConfirmPartial(true); return; }

    const resolutions: SkuResolutionItem[] = decided.map(m => {
      const c = choice[keyOf(m)];
      if (c === 'create') {
        return {
          seller_id: m.seller_id, sku: m.sku, action: 'create',
          name: (names[keyOf(m)] ?? m.product_name ?? '').trim(),
        };
      }
      return {
        seller_id: m.seller_id, sku: m.sku, action: 'link',
        target_product_id: Number(c),
      };
    });
    setSaving(true);
    try { await onSave(resolutions); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-5xl flex flex-col" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">📦 Resolver SKUs sem produto</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              {rows.length} SKU(s) segurando a baixa · {decided.length} resolvido(s)
            </p>
          </div>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>

        <div className="px-5 pt-3 flex-shrink-0">
          <div className="text-[11px] text-violet-300/90 bg-violet-900/20 border border-violet-500/25 rounded-lg px-3 py-2">
            <b>Cadastrar agora</b> cria o produto com o nome que veio na NF — o cadastro completo
            (barcode, caixa) fica pra depois. <b>Escolher um produto da lista</b> diz que esse SKU
            da NF na verdade é aquele item, e reaponta as NFs pendentes pra ele.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          <div className="grid text-[10px] font-bold uppercase tracking-wider text-white/25 mb-1 px-1 gap-2"
               style={{ gridTemplateColumns: '10rem 1fr 1.2fr 1.4fr' }}>
            <span>SKU da NF</span><span>Nome na NF</span><span>NFs afetadas</span><span>Ação</span>
          </div>
          {groups.map(g => (
            <div key={g.seller_id} className="mb-3">
              <div className="text-[11px] font-semibold text-violet-300/80 px-1 py-1 border-b border-white/8">
                {g.seller_name} <span className="text-white/25 font-normal">({g.rows.length} SKU)</span>
              </div>
              <div className="space-y-1 mt-1">
                {g.rows.map(m => {
                  const k = keyOf(m);
                  const c = choice[k] ?? '';
                  const products = productsBySeller?.[m.seller_id] ?? [];
                  const nfs = m.nf_numbers.join(', ');
                  return (
                    <div key={k} className="grid items-center gap-2 px-1 py-1 rounded"
                         style={{ gridTemplateColumns: '10rem 1fr 1.2fr 1.4fr',
                                  background: c ? 'rgba(109,89,222,0.10)' : 'transparent' }}>
                      <span className="text-xs font-mono text-white/70 truncate" title={m.sku}>{m.sku}</span>
                      <span className="text-xs text-white/40 truncate" title={m.product_name || ''}>
                        {m.product_name || '—'}
                      </span>
                      {/* NFs em texto corrido; o que não couber fica no title (hover) */}
                      <span className="text-[11px] text-white/35 truncate cursor-help" title={nfs}>
                        {nfs}
                      </span>
                      <div className="flex gap-1 items-center min-w-0">
                        <select
                          value={c}
                          onChange={(e) => { setChoice(prev => ({ ...prev, [k]: e.target.value })); setConfirmPartial(false); }}
                          className="flex-1 min-w-0 bg-[#1B1836] border border-white/10 rounded px-2 py-1 text-xs text-white/80 outline-none focus:border-violet-500"
                        >
                          <option value="">— escolher —</option>
                          <option value="create">+ Cadastrar agora com este SKU</option>
                          {loadingProducts && <option disabled>carregando produtos…</option>}
                          {products.map((p: any) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.sku} — {p.name}{p.active ? '' : '  [INATIVO — reativar]'}
                            </option>
                          ))}
                        </select>
                        {c === 'create' && (
                          <input
                            value={names[k] ?? m.product_name ?? ''}
                            onChange={(e) => setNames(prev => ({ ...prev, [k]: e.target.value }))}
                            placeholder="nome do produto"
                            className="flex-1 min-w-0 bg-transparent border-0 border-b border-white/10 outline-none text-xs px-1 py-1 text-white/80 placeholder-white/20 focus:border-violet-500"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {confirmPartial && undecided.length > 0 && (
          <div className="mx-5 mb-2 flex-shrink-0 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-500/30 rounded-lg px-3 py-2">
            <b>{undecided.length} SKU(s) ainda sem decisão:</b>{' '}
            {undecided.slice(0, 12).map(m => m.sku).join(', ')}
            {undecided.length > 12 && ` … e mais ${undecided.length - 12}`}
            <div className="text-amber-400/70 mt-1">
              As NFs deles continuam pendentes. Clique de novo para aplicar só os resolvidos.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
          <button onClick={() => { setChoice({}); setConfirmPartial(false); }}
                  className="text-xs text-white/30 hover:text-white/60 transition">Limpar tudo</button>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="px-4 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || decided.length === 0}
                    className="px-4 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition disabled:opacity-50">
              {saving ? 'Salvando…'
                : confirmPartial ? `Aplicar mesmo assim (${decided.length})`
                : `Aplicar ${decided.length} resolução(ões)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Data alvo do cockpit — default hoje (Brasília), mas usuário pode escolher dias anteriores
  const [targetDate, setTargetDate] = useState(todayBrasiliaStr);
  const [uploading, setUploading] = useState(false);
  const isMobile = useIsMobile();
  const [checksExpanded, setChecksExpanded] = useState(false);
  const todayStr = todayBrasiliaStr();
  const isToday = targetDate === todayStr;

  // Modal de upload com opções de nível de arquivo (entrada/saída, faturamento)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileType, setFileType] = useState<'Entrada' | 'Saída'>('Saída');
  const [forBilling, setForBilling] = useState<boolean>(true);
  const [generateSepPdf, setGenerateSepPdf] = useState<boolean>(true);
  const [generateExpPdf, setGenerateExpPdf] = useState<boolean>(true);

  // Modal de confirmação quando há NFs já importadas (duplicatas)
  const [duplicates, setDuplicates] = useState<DuplicateOrderInfo[]>([]);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [carrierModalOrders, setCarrierModalOrders] = useState<any[]>([]);

  // Modal de confirmação quando o arquivo referencia sellers inativos
  const [inactiveSellers, setInactiveSellers] = useState<InactiveSellerInfo[]>([]);
  const [inactiveModalOpen, setInactiveModalOpen] = useState(false);
  const [inactiveDecisions, setInactiveDecisions] = useState<Record<number, 'reactivate' | 'ignore'>>({});

  // Modal de confirmação quando o arquivo referencia nomes de seller não reconhecidos
  const [unmatchedSellers, setUnmatchedSellers] = useState<UnmatchedSellerInfo[]>([]);
  const [unmatchedModalOpen, setUnmatchedModalOpen] = useState(false);
  const [unmatchedDecisions, setUnmatchedDecisions] = useState<Record<string, SellerLinkDecision>>({});

  // Alerta quando o arquivo tem linha(s) com SKU vazio (19/08/2026): a
  // importação inteira é bloqueada, sem SKU não há barcode pra bipar. Fica
  // na tela até fechar manualmente — não é toast.
  const [missingSkuLines, setMissingSkuLines] = useState<MissingSkuLineInfo[]>([]);
  const [missingSkuModalOpen, setMissingSkuModalOpen] = useState(false);

  // Modal do resultado de estoque da importação (06/08/2026): SKUs que ficaram
  // negativos, NFs que não baixaram e os produtos que precisam ser cadastrados
  // para destravar. Avisa, nunca trava — decisão do dono do sistema.
  const [stockReport, setStockReport] = useState<StockApplyReport | null>(null);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [newProductForm, setNewProductForm] = useState<Record<string, { name: string; barcode: string }>>({});
  const [savingProductKey, setSavingProductKey] = useState<string | null>(null);

  // Modais de resolução em lote das pendências (10/08/2026). Os dois ficam
  // disponíveis ao mesmo tempo; cada botão some quando aquela pendência acaba.
  const [pendingCarrierOpen, setPendingCarrierOpen] = useState(false);
  const [pendingSkuOpen, setPendingSkuOpen] = useState(false);
  // "Tentar novamente" (19/08/2026): NFs sem motivo aparente (can_apply=true)
  // — nada bloqueia, só nunca foram reaplicadas.
  const [retryingPendingStock, setRetryingPendingStock] = useState(false);

  // Modal de cancelamento de pedidos duplicados (por sessão + sellers selecionados)
  const [cancelDupSession, setCancelDupSession] = useState<{ session_id: number; sellers: { seller_id: number; seller_name: string }[] } | null>(null);
  const [cancelDupSelected, setCancelDupSelected] = useState<number[]>([]);
  const [cancelDupPreview, setCancelDupPreview] = useState<any[] | null>(null);
  const [cancelDupLoading, setCancelDupLoading] = useState(false);

  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { unit_id: null };

  // Preferência de unidade ativa — salva por usuário no localStorage
  const unitPrefKey = `wms_active_unit_${user.id ?? 'anon'}`;
  const [activeUnitId, setActiveUnitId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem(unitPrefKey);
    return saved ? Number(saved) : (user.unit_id ?? undefined);
  });

  const handleUnitChange = (uid: number | undefined) => {
    setActiveUnitId(uid);
    if (uid) localStorage.setItem(unitPrefKey, String(uid));
    else localStorage.removeItem(unitPrefKey);
  };

  const { data: units = [] } = useQuery('units', () =>
    import('../api').then(m => m.cadastrosApi.units().then(r => r.data))
  );

  const { data, isLoading, refetch } = useQuery(
    ['dashboard', targetDate, activeUnitId],
    () => dashboardApi.master({
      target_date: targetDate,
      unit_id: activeUnitId,
    }).then(r => r.data),
    { refetchInterval: 60000 }, // atualiza a cada 1 minuto
  );

  // Warning: sellers ativos sem unidade associada — PDFs caem em SEM_UNIDADE
  const { data: sellersWithoutUnit = [] } = useQuery(
    'sellers-without-unit',
    () => import('../api').then(m => m.cadastrosApi.sellersWithoutUnit().then(r => r.data)),
    { staleTime: 5 * 60 * 1000 },
  );

  // Warning: NFs que não baixaram estoque (06/08/2026). Diferente do aviso de
  // transportadora, este cobre também SKU sem produto cadastrado — e não some
  // ao fechar o modal do import, só quando a pendência é resolvida de verdade.
  const { data: pendingStock } = useQuery(
    'orders-pending-stock',
    () => ordersApi.pendingStock().then(r => r.data),
    { staleTime: 60 * 1000, refetchInterval: 120000 },
  );

  // Lista de sellers ativos p/ o dropdown de vínculo do modal de sellers não reconhecidos
  const { data: activeSellersForLink = [] } = useQuery(
    'active-sellers-for-link',
    () => import('../api').then(m => m.cadastrosApi.sellers(true).then(r => r.data)),
    { enabled: unmatchedModalOpen, staleTime: 5 * 60 * 1000 },
  );

  // Passo 1: usuário seleciona arquivo — abrimos modal de confirmação
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (!user.unit_id) {
      toast.error('Usuário sem unidade configurada');
      e.target.value = '';
      return;
    }
    // Para múltiplos arquivos: abre o modal para o primeiro;
    // os demais ficam na fila e são processados automaticamente após cada confirmação.
    setPendingFiles(files);
    setPendingFile(files[0]);
    setUploadModalOpen(true);
    setFileType('Saída');
    setForBilling(true);
    e.target.value = '';
  };

  // Chamada base — dispara o POST e trata a resposta (sucesso, seller inativo, seller não
  // reconhecido, duplicata, erro)
  const runImport = async (
    forceDuplicates: boolean,
    decisionsOverride?: Record<number, 'reactivate' | 'ignore'>,
    sellerLinkOverride?: Record<string, SellerLinkDecision>,
  ) => {
    if (!pendingFile || !user.unit_id) return;
    const decisions = decisionsOverride ?? inactiveDecisions;
    const sellerLinkDecisions = sellerLinkOverride ?? unmatchedDecisions;
    setUploading(true);
    try {
      const res = await ordersApi.import(pendingFile, user.unit_id, {
        file_type: fileType,
        for_billing: forBilling,
        force_duplicates: forceDuplicates,
        generate_sep_pdf: generateSepPdf,
        generate_exp_pdf: generateExpPdf,
        inactive_seller_decisions: decisions,
        seller_link_decisions: sellerLinkDecisions,
      });
      const data = res.data || ({} as any);
      const {
        success,
        message,
        session_id,
        orders_imported = 0,
        orders_with_kits = 0,
        warnings = [],
        errors = [],
        requires_confirmation = false,
        duplicates: dups = [],
        inactive_sellers: inactives = [],
        unmatched_sellers: unmatched = [],
        missing_carrier_orders: missingCarrierOrders = [],
        missing_sku_lines: missingSkuLinesRes = [],
        stock = null,
      } = data;

      // Backend achou linha(s) com SKU vazio → bloqueia o arquivo inteiro,
      // sem opção de "continuar mesmo assim" (não há decisão possível aqui).
      if (!success && missingSkuLinesRes.length > 0) {
        setMissingSkuLines(missingSkuLinesRes);
        setUploadModalOpen(false);
        setMissingSkuModalOpen(true);
        return;
      }

      // Backend achou sellers inativos referenciados no arquivo → exibe modal de decisão.
      if (requires_confirmation && inactives.length > 0) {
        setInactiveSellers(inactives);
        setUploadModalOpen(false);
        setInactiveModalOpen(true);
        return;
      }

      // Backend achou nomes de seller que não batem com nenhum cadastro → exibe modal de decisão.
      if (requires_confirmation && unmatched.length > 0) {
        setUnmatchedSellers(unmatched);
        setUploadModalOpen(false);
        setUnmatchedModalOpen(true);
        return;
      }

      // Backend detectou NFs já importadas → exibe modal de confirmação.
      if (requires_confirmation && !forceDuplicates) {
        setDuplicates(dups);
        setUploadModalOpen(false);
        setDuplicateModalOpen(true);
        return;
      }

      if (!success) {
        const detail = errors?.[0] || message || 'Erro ao importar arquivo';
        toast.error(detail);
        return;
      }

      toast.success(`${orders_imported} pedido(s) importado(s) — Sessão #${session_id}`);
      if (orders_with_kits > 0) {
        toast.success(`${orders_with_kits} pedido(s) com kits expandidos automaticamente`);
      }
      warnings.slice(0, 3).forEach((w: string) => toast(w, { icon: 'ℹ️' }));

      // Resultado da baixa de estoque. Só abre o modal se houver algo a dizer:
      // SKU negativo ou NF que não subiu. Import limpo não incomoda ninguém.
      if (stock) {
        setStockReport(stock);
        setNewProductForm({});
        if ((stock.negatives?.length ?? 0) > 0 || (stock.pending_orders?.length ?? 0) > 0) {
          setStockModalOpen(true);
        } else if (stock.applied_orders > 0) {
          toast.success(`Estoque atualizado em ${stock.applied_orders} NF(s)`);
        }
      }

      // Pedido(s) sem transportadora → bipagem e PDFs ficam bloqueados (ver
      // CLAUDE.md). Abre o modal na hora em vez de tentar baixar o PDF; ao
      // completar, handleCarrierSave dispara o download sozinho.
      if (missingCarrierOrders.length > 0) {
        setCarrierModalOrders(missingCarrierOrders);
      } else if (session_id) {
        // Downloads automáticos em sequência
        if (generateSepPdf) {
          try {
            await ordersApi.downloadSessionPdf(session_id, 'separation');
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(detail ? `PDF de Separação: ${detail}` : 'PDF de Separação não gerado. Use o botão no histórico para tentar novamente.');
          }
        }
        if (generateExpPdf) {
          try {
            await ordersApi.downloadSessionPdf(session_id, 'expedition');
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(detail ? `PDF de Expedição: ${detail}` : 'PDF de Expedição não gerado. Use o botão no histórico para tentar novamente.');
          }
        }
      }

      refetch();
      qc.invalidateQueries('orders-pending-stock');
      // Fecha tudo e limpa estado
      setUploadModalOpen(false);
      setDuplicateModalOpen(false);
      setDuplicates([]);
      setInactiveModalOpen(false);
      setInactiveSellers([]);
      setInactiveDecisions({});
      setUnmatchedModalOpen(false);
      setUnmatchedSellers([]);
      setUnmatchedDecisions({});
      setPendingFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || err.message || 'Erro ao importar arquivo');
    } finally {
      setUploading(false);
    }
  };

  // Passo 2: usuário confirma opções e submete
  const handleConfirmUpload = () => runImport(false);

  // Passo 3 (opcional): após ver duplicatas, usuário confirma reimportação
  const handleForceImport = () => runImport(true);

  const handleCancelUpload = () => {
    if (uploading) return;
    setUploadModalOpen(false);
    setPendingFile(null);
  };

  const handleCancelDuplicates = () => {
    if (uploading) return;
    setDuplicateModalOpen(false);
    setDuplicates([]);
    setPendingFile(null);
  };

  // Passo intermediário (opcional): usuário decide reativar ou ignorar cada seller inativo
  const handleSetInactiveDecision = (sellerId: number, decision: 'reactivate' | 'ignore') => {
    setInactiveDecisions(prev => ({ ...prev, [sellerId]: decision }));
  };

  const allInactiveDecided = inactiveSellers.every(s => !!inactiveDecisions[s.seller_id]);

  const handleConfirmInactiveSellers = () => {
    setInactiveModalOpen(false);
    runImport(false, inactiveDecisions);
  };

  const handleCancelInactiveSellers = () => {
    if (uploading) return;
    setInactiveModalOpen(false);
    setInactiveSellers([]);
    setInactiveDecisions({});
    setPendingFile(null);
  };

  // Passo intermediário (opcional): usuário decide, para cada nome de seller não
  // reconhecido, se vincula a um seller já cadastrado ou cria um novo (com unidade).
  const handleSetUnmatchedDecision = (sellerName: string, decision: SellerLinkDecision) => {
    setUnmatchedDecisions(prev => ({ ...prev, [sellerName]: decision }));
  };

  const allUnmatchedDecided = unmatchedSellers.every((s) => {
    const d = unmatchedDecisions[s.seller_name];
    if (!d) return false;
    return d.action === 'create' ? !!d.unit_id : !!d.seller_id;
  });

  const handleConfirmUnmatchedSellers = () => {
    setUnmatchedModalOpen(false);
    runImport(false, undefined, unmatchedDecisions);
  };

  const handleCancelUnmatchedSellers = () => {
    if (uploading) return;
    setUnmatchedModalOpen(false);
    setUnmatchedSellers([]);
    setUnmatchedDecisions({});
    setPendingFile(null);
  };

  // ── Cancelar pedidos duplicados de uma sessão (corrige upload repetido) ──
  const openCancelDupModal = (session_id: number, sellers: { seller_id: number; seller_name: string }[]) => {
    setCancelDupSession({ session_id, sellers });
    setCancelDupSelected([]);
    setCancelDupPreview(null);
  };

  const closeCancelDupModal = () => {
    if (cancelDupLoading) return;
    setCancelDupSession(null);
    setCancelDupSelected([]);
    setCancelDupPreview(null);
  };

  const toggleCancelDupSeller = (sellerId: number) => {
    setCancelDupSelected(prev =>
      prev.includes(sellerId) ? prev.filter(id => id !== sellerId) : [...prev, sellerId]
    );
  };

  const handleCancelDupContinue = async () => {
    if (!cancelDupSession || cancelDupSelected.length === 0) return;
    setCancelDupLoading(true);
    try {
      const res = await scanningApi.cancelDuplicateOrders(cancelDupSession.session_id, cancelDupSelected, false);
      if (res.data.requires_confirmation) {
        setCancelDupPreview(res.data.preview || []);
      } else {
        toast.success(res.data.message);
        closeCancelDupModal();
        refetch();
        qc.invalidateQueries('sellers-without-unit');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao cancelar pedidos');
    } finally {
      setCancelDupLoading(false);
    }
  };

  const handleCancelDupConfirm = async () => {
    if (!cancelDupSession) return;
    setCancelDupLoading(true);
    try {
      const res = await scanningApi.cancelDuplicateOrders(cancelDupSession.session_id, cancelDupSelected, true);
      toast.success(res.data.message);
      (res.data.summary || []).slice(0, 5).forEach((line: string) => toast(line, { icon: 'ℹ️', duration: 6000 }));
      closeCancelDupModal();
      refetch();
      qc.invalidateQueries('sellers-without-unit');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao cancelar pedidos');
    } finally {
      setCancelDupLoading(false);
    }
  };

  // Cadastra na hora um produto que está segurando a baixa de estoque.
  // Só CRIA produto novo com o SKU que veio na NF — não existe "vincular a um
  // produto existente" de propósito: o estoque é indexado por (seller, SKU), e
  // apontar a NF para outro SKU baixaria o produto errado e criaria posição
  // fantasma no SKU da NF. De-para de SKU é outro projeto (ver CLAUDE.md).
  const handleCreateMissingProduct = async (mp: { seller_id: number; sku: string; product_name: string | null }) => {
    const key = `${mp.seller_id}:${mp.sku}`;
    const form = newProductForm[key];
    const name = (form?.name ?? mp.product_name ?? '').trim();
    if (!name) { toast.error('Informe o nome do produto'); return; }
    setSavingProductKey(key);
    try {
      await cadastrosApi.createProduct({
        seller_id: mp.seller_id,
        sku: mp.sku,
        name,
        barcode_seller: form?.barcode?.trim() || undefined,
      });
      toast.success(`Produto ${mp.sku} cadastrado — NFs liberadas`);
      // O backend baixa o estoque das NFs pendentes sozinho ao criar o produto.
      // Recarrega o que ainda está pendente para o modal refletir a realidade.
      const { data } = await ordersApi.pendingStock();
      setStockReport(prev => ({
        applied_orders: prev?.applied_orders ?? 0,
        negatives: prev?.negatives ?? [],
        pending_orders: data.pending_orders,
        missing_products: data.missing_products,
      }));
      qc.invalidateQueries(['dashboard', targetDate]);
      qc.invalidateQueries('orders-pending-stock');
      refetch();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao cadastrar produto');
    } finally {
      setSavingProductKey(null);
    }
  };

  // ── Resolução em lote das pendências de estoque (10/08/2026) ──────────────
  // Uma chamada só para o lote inteiro: o backend baixa o estoque de todas as
  // NFs de uma vez. Nunca chamar updateCarrier/createProduct em laço aqui.

  const afterPendingResolved = async (negatives: any[], appliedCount: number) => {
    qc.invalidateQueries('orders-pending-stock');
    qc.invalidateQueries(['dashboard', targetDate]);
    await refetch();
    // Baixar estoque pode ter jogado SKU pra negativo — mesmo modal do import.
    if (negatives.length > 0) {
      setStockReport({
        applied_orders: appliedCount,
        pending_orders: [],
        missing_products: [],
        negatives,
      });
      setStockModalOpen(true);
    }
  };

  const handleBatchCarrierSave = async (updates: { order_id: number; carrier: string }[]) => {
    try {
      const { data } = await ordersApi.batchCarrier(updates);
      setPendingCarrierOpen(false);
      toast.success(
        `${data.updated} transportadora(s) salva(s) — ${data.stock_applied} NF(s) baixaram estoque`
        + (data.still_pending ? ` · ${data.still_pending} ainda presa(s) por SKU sem produto` : ''),
        { duration: 6000 },
      );
      await afterPendingResolved(data.negatives ?? [], data.stock_applied);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar transportadoras');
    }
  };

  // "Tentar novamente" (19/08/2026): NFs que já não têm nenhum motivo
  // bloqueando (transportadora ok, SKUs cadastrados) mas nunca baixaram —
  // acontece quando o cadastro em massa de produto destrava sem reaplicar.
  // Só reusa apply_stock_for_orders via o endpoint — nada de lógica nova aqui.
  const handleRetryPendingStock = async (orderIds: number[]) => {
    setRetryingPendingStock(true);
    try {
      const { data } = await ordersApi.retryPendingStock(orderIds);
      const stillStuck = data.pending_orders.filter(p => p.can_apply).length;
      toast.success(
        `${data.applied_orders} NF(s) baixaram estoque agora`
        + (stillStuck ? ` · ${stillStuck} continuam presas — verifique manualmente` : ''),
        { duration: 6000 },
      );
      await afterPendingResolved(data.negatives ?? [], data.applied_orders);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao tentar novamente');
    } finally {
      setRetryingPendingStock(false);
    }
  };

  const handleBatchSkuSave = async (resolutions: SkuResolutionItem[]) => {
    try {
      const { data } = await ordersApi.batchResolveSku(resolutions);
      setPendingSkuOpen(false);
      const partes = [];
      if (data.created) partes.push(`${data.created} produto(s) cadastrado(s)`);
      if (data.linked) partes.push(`${data.linked} SKU(s) vinculado(s) em ${data.orders_relinked} NF(s)`);
      if (data.reactivated) partes.push(`${data.reactivated} reativado(s)`);
      toast.success(
        `${partes.join(' · ')} — ${data.stock_applied} NF(s) baixaram estoque`,
        { duration: 6000 },
      );
      // O relink altera os SKUs dos itens; a lista de produtos em cache fica velha.
      qc.invalidateQueries('pending-sku-products');
      qc.invalidateQueries('products');
      await afterPendingResolved(data.negatives ?? [], data.stock_applied);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao resolver SKUs');
    }
  };

  const handleCarrierSave = async (updates: Record<number, string>) => {
    const { ordersApi } = await import('../api');
    const entries = Object.entries(updates).filter(([, v]) => v.trim());
    if (!entries.length) { setCarrierModalOrders([]); return; }
    try {
      const results = await Promise.all(
        entries.map(([id, carrier]) =>
          ordersApi.updateCarrier(Number(id), carrier)
        )
      );
      toast.success(`${entries.length} transportadora(s) salva(s)`);

      // Preencher a transportadora destrava a baixa de estoque (06/08/2026).
      // Se isso jogou algum SKU pra negativo, mostra no MESMO modal do import.
      const applied = results.filter(r => r.data?.stock_applied).length;
      const negatives = results.flatMap(r => r.data?.negatives ?? []);
      if (applied > 0) toast.success(`Estoque baixado em ${applied} NF(s)`);
      if (negatives.length > 0) {
        setStockReport({
          applied_orders: applied,
          pending_orders: [],
          missing_products: [],
          negatives,
        });
        setStockModalOpen(true);
      }
    } catch {
      toast.error('Erro ao salvar transportadoras');
    }

    // Sessões tocadas por este lote — se alguma ficou 100% completa, a
    // bipagem já libera sozinha (backend checa na hora); aqui só disparamos
    // o download automático dos PDFs, como pedido pela cliente.
    const affectedSessionIds = Array.from(
      new Set(carrierModalOrders.map((o: any) => o.session_id).filter((v: any) => v != null))
    );
    setCarrierModalOrders([]);
    qc.invalidateQueries(['dashboard', targetDate]);
    qc.invalidateQueries('orders-pending-stock');
    const fresh = await refetch();
    const stillPending = new Set(
      ((fresh.data?.checks?.pending_carrier_sessions ?? []) as any[]).map(p => p.session_id)
    );
    for (const sid of affectedSessionIds) {
      if (!stillPending.has(sid)) {
        try {
          await ordersApi.downloadSessionPdf(sid, 'separation');
          await ordersApi.downloadSessionPdf(sid, 'expedition');
          toast.success(`Sessão #${sid}: transportadora completa — PDFs gerados`);
        } catch (err: any) {
          const detail = err?.response?.data?.detail;
          toast.error(detail ? `Sessão #${sid}: ${detail}` : `Sessão #${sid}: erro ao gerar PDF`);
        }
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/35 text-sm">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  const stats = data;
  const completionPct = stats?.completion_rate ?? 0;

  return (
    <div className="p-6 space-y-6 min-h-full text-white">

      {/* ⚠️ Warning: sellers sem unidade associada */}
      {(sellersWithoutUnit as any[]).length > 0 && (
        <div className="flex items-start gap-3 bg-amber-900/25 border border-amber-500/30 rounded-xl px-4 py-3">
          <span className="text-amber-400 mt-0.5 flex-shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">Sellers sem unidade associada</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              PDFs desses sellers serão salvos em <span className="font-mono">SEM_UNIDADE/</span>.
              Pode ser um seller duplicado com pedidos presos, ou só falta associar uma unidade.
            </p>
            <p className="text-xs text-amber-400/60 mt-1">
              {(sellersWithoutUnit as any[]).map((s: any) => `${s.trade_name} (${s.order_count} pedido(s))`).join(', ')}
            </p>
          </div>
          <a href="/sellers/corrigir" className="flex-shrink-0 text-xs text-amber-400 hover:underline mt-0.5">Corrigir →</a>
        </div>
      )}

      {/* ⚠️ Aviso fixo: NFs que não subiram ao estoque (06/08/2026).
          O estoque do seller não reflete essas notas até a pendência ser
          resolvida — e aí ele baixa sozinho. */}
      {(pendingStock?.pending_orders?.length ?? 0) > 0 && (() => {
        // can_apply=true (19/08/2026) = nada bloqueia mais essa NF, mas ela
        // nunca foi reaplicada (ex: o SKU que faltava foi cadastrado em massa,
        // caminho que não destrava sozinho). Sem essa separação, essas NFs
        // ficavam contadas no aviso sem motivo visível e sem botão nenhum.
        const stuck = pendingStock!.pending_orders.filter(p => p.can_apply);
        const blocked = pendingStock!.pending_orders.filter(p => !p.can_apply);
        const semTransp = blocked.filter(p => p.missing_carrier).length;
        const semProduto = blocked.filter(p => p.missing_skus.length > 0).length;
        return (
          <div className="flex items-start gap-3 bg-red-900/25 border border-red-500/30 rounded-xl px-4 py-3">
            <span className="text-red-400 mt-0.5 flex-shrink-0">📦</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-300">
                {pendingStock!.pending_orders.length} NF(s) não subiram ao estoque
              </p>
              <p className="text-xs text-red-400/80 mt-0.5">
                O estoque desses sellers está desatualizado enquanto isso. Resolva a pendência e a
                baixa acontece sozinha — não precisa reimportar nada.
              </p>
              {(semTransp > 0 || semProduto > 0) && (
                <p className="text-xs text-red-400/60 mt-1">
                  {[
                    semTransp ? `${semTransp} sem transportadora` : null,
                    semProduto ? `${semProduto} com SKU sem produto cadastrado` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {stuck.length > 0 && (
                <div className="mt-1.5">
                  <p className="text-xs text-amber-300/90">
                    {stuck.length} sem motivo aparente — já estão liberadas, só falta tentar de novo:
                  </p>
                  <p className="text-xs text-red-400/60 mt-0.5">
                    {stuck.slice(0, 10).map(p => `${p.nf_number} (${p.seller_name ?? 'sem seller'})`).join(', ')}
                    {stuck.length > 10 && ` … e mais ${stuck.length - 10}`}
                  </p>
                </div>
              )}
            </div>
            {/* Um botão por tipo de pendência — só aparece o que existe de fato,
                e some sozinho quando aquele tipo acaba. Resolver aqui evita
                trocar de tela no meio do fluxo de importação. */}
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              {semTransp > 0 && (
                <button
                  onClick={() => setPendingCarrierOpen(true)}
                  className="text-xs font-medium text-white bg-red-600/80 hover:bg-red-600 rounded-lg px-3 py-1.5 transition whitespace-nowrap"
                >
                  🚚 Resolver transportadoras
                </button>
              )}
              {pendingStock!.missing_products.length > 0 && (
                <button
                  onClick={() => setPendingSkuOpen(true)}
                  className="text-xs font-medium text-white bg-red-600/80 hover:bg-red-600 rounded-lg px-3 py-1.5 transition whitespace-nowrap"
                >
                  📦 Resolver SKUs sem produto
                </button>
              )}
              {stuck.length > 0 && (
                <button
                  onClick={() => handleRetryPendingStock(stuck.map(p => p.order_id))}
                  disabled={retryingPendingStock}
                  className="text-xs font-medium text-white bg-amber-600/80 hover:bg-amber-600 rounded-lg px-3 py-1.5 transition whitespace-nowrap disabled:opacity-50"
                >
                  {retryingPendingStock ? 'Tentando…' : `🔁 Tentar novamente (${stuck.length})`}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ⚠️ Aviso fixo: sessão(ões) com pedido sem transportadora — bipagem e PDFs
          ficam bloqueados até preencher. Não some sozinho ao fechar o modal sem
          terminar; some só quando a transportadora é preenchida de verdade. */}
      {Array.isArray(stats?.checks?.pending_carrier_sessions) &&
        (stats.checks.pending_carrier_sessions as any[]).length > 0 && (
          <div className="flex flex-col gap-2 bg-amber-900/25 border border-amber-500/30 rounded-xl px-4 py-3">
            {(stats.checks.pending_carrier_sessions as any[]).map((p: any) => (
              <div key={p.session_id} className="flex items-center gap-3">
                <span className="text-amber-400 flex-shrink-0">🚚</span>
                <p className="flex-1 text-sm text-amber-300">
                  Sessão #{p.session_id} sem transportadora — {p.count} pedido(s) bloqueado(s) pra bipagem e PDF
                </p>
                <button
                  onClick={() => setCarrierModalOrders(
                    ((stats?.checks?.missing_carriers ?? []) as any[]).filter((mc: any) => mc.session_id === p.session_id)
                  )}
                  className="flex-shrink-0 text-xs font-semibold text-amber-300 hover:underline"
                >
                  Preencher aqui →
                </button>
              </div>
            ))}
          </div>
        )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard Master</h1>
          <p className="text-sm text-white/50 mt-0.5">
            {format(new Date(targetDate + 'T12:00:00'), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            {isToday ? ' · Atualiza a cada 60s' : ' · Visualizando histórico'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor de unidade — admin e manager */}
          {(user.role === 'admin' || user.role === 'manager') && (units as any[]).length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-900 border border-white/12 rounded-lg">
              <span className="text-xs text-white/40">Unidade:</span>
              <select
                value={activeUnitId ?? ''}
                onChange={e => handleUnitChange(e.target.value ? Number(e.target.value) : undefined)}
                className="bg-transparent text-sm text-white/80 outline-none"
              >
                {user.role === 'admin' && <option value="">Todas</option>}
                {(units as any[]).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Seletor de data */}
          <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-900 border border-white/12 rounded-lg">
            <input
              type="date"
              value={targetDate}
              max={todayStr}
              onChange={(e) => setTargetDate(e.target.value || todayStr)}
              className="text-sm text-white/80 bg-transparent focus:outline-none"
              title="Selecione a data (pelo dia do upload)"
            />
            {!isToday && (
              <button
                onClick={() => setTargetDate(todayStr)}
                className="text-xs px-2 py-0.5 text-violet-400 hover:bg-violet-900/25 rounded"
                title="Voltar para hoje"
              >
                Hoje
              </button>
            )}
          </div>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/60 hover:text-white bg-gray-900 border border-white/12 rounded-lg transition"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>

          {/* Upload de Excel — só permitido no dia de hoje */}
          <label className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg cursor-pointer transition ${uploading || !isToday ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <Upload size={14} />
            {uploading ? 'Importando...' : 'Importar Excel'}
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              multiple
              className="hidden"
              onChange={handleFilePick}
              disabled={uploading || !isToday}
            />
          </label>
        </div>
      </div>

      {/* ── Conteúdo principal: vazio se não houver dados ── */}
      {(!stats || stats.total_orders_today === 0) ? (
        <div className="bg-gray-900 rounded-xl border border-dashed border-white/12 p-12 text-center">
          <Package size={44} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/50 text-sm font-medium">
            Nenhum pedido importado {isToday ? 'hoje' : 'nessa data'}
          </p>
          {isToday && (
            <p className="text-white/25 text-xs mt-1">
              Use o botão "Importar Excel" para começar
            </p>
          )}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Package}
              label="Total de Pedidos"
              value={stats.total_orders_today}
              color="text-white/80"
            />
            <StatCard
              icon={CheckCircle}
              label="Concluídos"
              value={stats.orders_completed}
              color="text-violet-400"
              sub={`${completionPct}% do total`}
            />
            <StatCard
              icon={Clock}
              label="Pendentes"
              value={stats.orders_pending}
              color="text-amber-500"
            />
            <StatCard
              icon={ScanLine}
              label="Em Bipagem"
              value={stats.orders_scanning}
              color="text-blue-600"
            />
          </div>

          {/* Barra de progresso geral */}
          <div className="bg-gray-900 rounded-xl p-4 border border-white/8 shadow-none">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-white/50">Progresso geral do dia</p>
              <p className="text-sm font-bold text-white/80">{completionPct}%</p>
            </div>
            <div className="w-full bg-white/10 rounded-full h-3">
              <div
                className="bg-violet-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            {stats.active_sessions > 0 && (
              <p className="text-xs text-white/35 mt-1.5">
                {stats.active_sessions} sessão(ões) ativa(s) em andamento
              </p>
            )}
          </div>

          {/* Checagens do dia */}
          {stats.checks && (() => {
            const checkList = [
              { label: 'Transportadora',       ok: !!stats.checks.transport },
              { label: 'PDF Separação',        ok: !!stats.checks.separation },
              { label: 'PDF Expedição',        ok: !!stats.checks.planning },
              { label: 'Chaves NF únicas',     ok: !!stats.checks.stock },
              { label: 'Produtos cadastrados', ok: !!stats.checks.products_registered },
            ];
            const pendingCount = checkList.filter(c => !c.ok).length;
            const showBody = !isMobile || checksExpanded;
            return (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <button
                type="button"
                onClick={() => isMobile && setChecksExpanded(v => !v)}
                className={`w-full flex items-center justify-between ${showBody ? 'mb-3' : ''} ${isMobile ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <h2 className="text-sm font-semibold text-white/80">Checagens do Dia</h2>
                {isMobile && (
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {pendingCount > 0 ? `${pendingCount} pendente(s)` : 'tudo OK'}
                    <ChevronDown size={13} className={`transition-transform ${checksExpanded ? 'rotate-180' : ''}`} />
                  </span>
                )}
              </button>
              {showBody && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {checkList.map(c => <CheckItem key={c.label} label={c.label} ok={c.ok} />)}
              </div>
              )}
              {showBody && stats.checks.all_ok && (
                <div className="mt-3 p-2.5 bg-emerald-900/30 border border-emerald-500/20 rounded-lg text-center">
                  <p className="text-xs text-emerald-300 font-semibold">
                    ✓ Todas as checagens OK — pronto para bipagem
                  </p>
                </div>
              )}

              {/* Produtos sem cadastro */}
              {showBody &&
                !stats.checks.products_registered &&
                Array.isArray(stats.checks.missing_products) &&
                stats.checks.missing_products.length > 0 && (
                  <div className="mt-3 p-3 bg-red-900/25 border border-red-500/20 rounded-lg">
                    <p className="text-xs font-semibold text-red-300 mb-2 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {stats.checks.missing_products.length} produto(s) sem cadastro
                    </p>
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                      {stats.checks.missing_products.map((mp: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-red-300">
                          <span className="font-mono bg-red-900/40 px-1.5 py-0.5 rounded">{mp.sku}</span>
                          <span className="text-red-400">{mp.seller_name}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        navigate('/products', {
                          state: { prefill: stats.checks?.missing_products },
                        })
                      }
                      className="mt-2 text-xs text-red-300 hover:underline flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Cadastrar produtos agora (pré-preenchido)
                    </button>
                  </div>
                )}

              {showBody &&
                !stats.checks.transport &&
                Array.isArray(stats.checks.missing_carriers) &&
                (stats.checks.missing_carriers as any[]).length > 0 && (
                  <div className="mt-3 p-3 bg-amber-900/25 border border-amber-500/20 rounded-lg">
                    <p className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {(stats.checks.missing_carriers as any[]).length} pedido(s) sem transportadora
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {(stats.checks.missing_carriers as any[]).map((mc: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-amber-300">
                          <span className="font-mono bg-amber-900/40 px-1.5 py-0.5 rounded">{mc.nf_number}</span>
                          <span className="text-amber-400">{mc.seller_name}</span>
                          <span className="text-amber-200/60 truncate">{mc.customer_name}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setCarrierModalOrders((stats.checks?.missing_carriers ?? []) as any[])}
                      className="mt-2 text-xs text-amber-300 hover:underline flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Informar transportadoras agora
                    </button>
                  </div>
                )}
            </div>
            );
          })()}

          {/* Alertas */}
          {stats.alerts && stats.alerts.length > 0 && (
            <div className="space-y-2">
              {stats.alerts.map((alert: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                    alert.type === 'error'
                      ? 'bg-red-900/25 border-red-500/20 text-red-300'
                      : 'bg-amber-900/25 border-amber-500/20 text-amber-300'
                  }`}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  {alert.message}
                </div>
              ))}
            </div>
          )}

          {/* Unidades + Sellers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Resumo por unidade */}
            {stats.units_summary && stats.units_summary.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-4">Por Unidade</h2>
                <div className="space-y-3">
                  {stats.units_summary.map((unit: any) => (
                    <div key={unit.unit_id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white/60">{unit.unit_name}</span>
                        <span className="text-xs text-white/35">
                          {unit.completed}/{unit.total} ({unit.pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2">
                        <div
                          className="bg-violet-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${unit.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sellers com pedidos no dia */}
            {stats.sellers_with_orders && stats.sellers_with_orders.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-3">Sellers com Pedidos</h2>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.sellers_with_orders.map((s: any) => ({
                        name:
                          s.seller_name.length > 12
                            ? s.seller_name.slice(0, 12) + '…'
                            : s.seller_name,
                        total: s.total,
                        concluído: s.completed,
                      }))}
                      margin={{ top: 4, right: 8, left: -20, bottom: 4 }}
                    >
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: any, name: string) => [
                          value,
                          name === 'concluído' ? 'Concluídos' : 'Total',
                        ]}
                        contentStyle={{ fontSize: '11px' }}
                      />
                      <Bar dataKey="total" fill="#2D2A4A" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="concluído" fill="#7B63E8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {stats.sellers_with_orders.map((s: any) => (
                    <div key={s.seller_id} className="flex items-center justify-between text-xs">
                      <span className="text-white/60 truncate max-w-[60%]">{s.seller_name}</span>
                      <span className="text-white/35">
                        {s.completed}/{s.total} ({s.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scans recentes */}
          {stats.recent_scans && stats.recent_scans.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3">
                Scans Recentes (últimas 2h)
              </h2>
              <div className="divide-y divide-white/5">
                {stats.recent_scans.map((scan: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-white/35 w-16 flex-shrink-0">
                      {scan.timestamp}
                    </span>
                    <span className="text-white/60 font-medium w-28 truncate flex-shrink-0">
                      {scan.operator}
                    </span>
                    <span className="font-mono text-violet-300 bg-violet-900/20 px-1.5 py-0.5 rounded">
                      {scan.sku}
                    </span>
                    <span className="text-white/35 truncate">NF {scan.order_nf}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Acompanhamento por Operador ─────────────────── */}
          {stats.operators_summary && (stats.operators_summary.length > 0 || (stats.orders_no_operator ?? 0) > 0) && (
            <div className="bg-gray-900 rounded-xl border border-white/8 p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                <ScanLine size={14} className="text-violet-400" />
                Produtividade por Operador
              </h2>
              <div className="space-y-2">
                {stats.operators_summary.map((op: any) => {
                  const pct = op.orders_touched > 0 ? Math.round(op.orders_completed / op.orders_touched * 100) : 0;
                  return (
                    <div key={op.operator_id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/6"
                      style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg,#7B63E8,#3DD9A4)' }}>
                        {op.operator_name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/80 truncate">{op.operator_name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[11px] text-white/40">{op.scans} scan(s)</span>
                          <span className="text-[11px] text-white/40">{op.orders_touched} pedido(s) tocados</span>
                          <span className="text-[11px] text-teal-400 font-medium">{op.orders_completed} concluído(s)</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {op.scans > 0
                          ? <span className={`text-sm font-bold ${pct === 100 ? 'text-teal-400' : pct > 50 ? 'text-violet-300' : 'text-amber-400'}`}>{pct}%</span>
                          : <span className="text-xs text-white/25">Sem scans</span>}
                      </div>
                    </div>
                  );
                })}
                {(stats.orders_no_operator ?? 0) > 0 && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/6 border-dashed"
                    style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white/25 flex-shrink-0 border border-white/12">?</div>
                    <div className="flex-1">
                      <p className="text-sm text-white/40">Sem operador associado</p>
                      <p className="text-[11px] text-white/25 mt-0.5">Pedidos ainda não iniciados ou sem scan registrado</p>
                    </div>
                    <span className="text-sm font-bold text-white/35">{stats.orders_no_operator ?? 0}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Sellers sem pedidos hoje ─────────────────────── */}
          {stats.sellers_no_orders && stats.sellers_no_orders.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/20 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-2">
                <AlertTriangle size={14} />
                {stats.sellers_no_orders.length} seller(s) sem pedidos hoje
              </h2>
              <div className="flex flex-wrap gap-2">
                {stats.sellers_no_orders.map((s: any) => (
                  <span key={s.seller_id}
                    className="px-2.5 py-1 bg-gray-900 border border-amber-200 rounded-full text-xs text-amber-700 font-medium">
                    {s.seller_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Histórico de uploads do dia ──────────────────── */}
          {stats.sessions_today && stats.sessions_today.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                <Upload size={14} className="text-white/35" />
                Uploads do Dia
              </h2>
              <div className="space-y-2">
                {stats.sessions_today.map((sess: any) => (
                  <div key={sess.session_id}
                    className="flex flex-col sm:flex-row items-start gap-3 p-3 bg-white/4 rounded-lg border border-white/8">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-white/80">
                          Sessão #{sess.session_id}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sess.file_type === 'Entrada' ? 'bg-blue-900/40 text-blue-300' : 'bg-violet-900/40 text-violet-300'}`}>
                          {sess.file_type}
                        </span>
                        <span className="text-[10px] text-white/35">{sess.created_at}</span>
                      </div>
                      {sess.source_file && (
                        <p className="text-[11px] text-white/35 truncate mb-1" title={sess.source_file}>
                          📄 {sess.source_file}
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/50">{sess.total_orders} pedido(s)</span>
                        {sess.seller_names?.length > 0 && (
                          <span className="text-xs text-white/35 truncate">
                            {sess.seller_names.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* PDFs — geração sob demanda; indicador se já salvo em disco */}
                    <div className="flex flex-row sm:flex-col flex-wrap gap-1.5 flex-shrink-0 w-full sm:w-auto">
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'separation')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Separação'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_separation ? 'text-emerald-300 bg-emerald-900/25 border border-emerald-500/20 hover:bg-emerald-900/35' : 'text-white/40 bg-white/5 border border-white/10 hover:bg-white/10'}`}
                      >
                        <FileText size={11} /> Separação{sess.separation_pdf ? ' ✓' : ''}
                      </button>
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'expedition')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Expedição'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_planning ? 'text-blue-300 bg-blue-900/25 border border-blue-500/20 hover:bg-blue-900/40' : 'text-white/40 bg-white/5 border border-white/10 hover:bg-white/10'}`}
                      >
                        <FileText size={11} /> Expedição{sess.expedition_pdf ? ' ✓' : ''}
                      </button>
                      {sess.sellers_in_session?.length > 0 && (
                        <button
                          onClick={() => openCancelDupModal(sess.session_id, sess.sellers_in_session)}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition text-red-300 bg-red-900/20 border border-red-500/20 hover:bg-red-900/35"
                        >
                          <Trash2 size={11} /> Excluir sellers
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de configuração do upload (nível do arquivo/sessão) */}
      {uploadModalOpen && pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelUpload}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-violet-900/30">
                <Upload size={20} className="text-violet-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Configurar importação</h3>
                <p className="text-xs text-white/50 mt-0.5 break-all">{pendingFile.name}</p>
              </div>
            </div>

            {/* Gerar PDFs */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-white/80 mb-2">Gerar relatórios PDF</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateSepPdf} onChange={e => setGenerateSepPdf(e.target.checked)}
                    className="h-4 w-4 rounded bg-white/10 border-white/20 text-violet-500 focus:ring-violet-500" />
                  <span className="text-sm text-white/80">PDF de Separação</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateExpPdf} onChange={e => setGenerateExpPdf(e.target.checked)}
                    className="h-4 w-4 rounded bg-white/10 border-white/20 text-violet-500 focus:ring-violet-500" />
                  <span className="text-sm text-white/80">PDF de Expedição</span>
                </label>
              </div>
            </div>

            {/* Tipo de arquivo (nível da sessão) */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-white/80 mb-2">
                Tipo da movimentação
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFileType('Saída')}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    fileType === 'Saída'
                      ? 'bg-violet-900/25 border-violet-500 text-violet-300 font-medium'
                      : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                  }`}
                >
                  Saída (Expedição)
                </button>
                <button
                  type="button"
                  onClick={() => setFileType('Entrada')}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    fileType === 'Entrada'
                      ? 'bg-blue-900/30 border-blue-500 text-blue-300 font-medium'
                      : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                  }`}
                >
                  Entrada (Recebimento)
                </button>
              </div>
              <p className="text-[11px] text-white/35 mt-1.5">
                Aplica-se a todos os pedidos deste arquivo.
              </p>
            </div>

            {/* Considerar para faturamento */}
            <div className="mb-5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forBilling}
                  onChange={(e) => setForBilling(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 text-violet-500 focus:ring-violet-500"
                />
                <div>
                  <span className="text-sm font-medium text-white/80">
                    Considerar para faturamento
                  </span>
                  <p className="text-[11px] text-white/35 mt-0.5">
                    Quando marcado, os pedidos deste arquivo entram na contagem mensal de cobrança dos sellers.
                  </p>
                </div>
              </label>
            </div>

            {/* Botões */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCancelUpload}
                className="flex-1 px-4 py-2 text-sm text-white/60 border border-white/10 rounded-lg hover:bg-white/4 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => runImport(false)}
                disabled={uploading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                {uploading ? 'Importando...' : 'Importar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modais de resolução em lote das pendências de estoque (10/08/2026).
          Cada um filtra o aviso pelo SEU tipo de pendência: NF que está sem
          transportadora E sem SKU aparece nos dois, e só baixa quando a última
          for resolvida (quem decide é apply_stock_for_orders, no backend). */}
      {pendingCarrierOpen && (
        <PendingCarrierModal
          orders={(pendingStock?.pending_orders ?? []).filter(p => p.missing_carrier)}
          onClose={() => setPendingCarrierOpen(false)}
          onSave={handleBatchCarrierSave}
        />
      )}
      {pendingSkuOpen && (
        <PendingSkuModal
          missing={pendingStock?.missing_products ?? []}
          onClose={() => setPendingSkuOpen(false)}
          onSave={handleBatchSkuSave}
        />
      )}

      {/* Modal de transportadoras */}
      {carrierModalOrders.length > 0 && (
        <CarrierModal
          orders={carrierModalOrders}
          onClose={() => setCarrierModalOrders([])}
          onSave={handleCarrierSave}
        />
      )}

      {/* Modal de confirmação de duplicatas */}
      {duplicateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelDuplicates}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-900/30">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  {duplicates.length} NF(s) já importada(s)
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Algumas notas fiscais deste arquivo já existem no banco. Confirme se deseja reimportar mesmo assim.
                </p>
              </div>
            </div>

            {/* Desde 06/08/2026 o estoque baixa na importação: reimportar
                duplicata erra o estoque do seller NA HORA, não só se alguém
                bipar. Por isso o aviso é explícito e em vermelho. */}
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2.5">
              <p className="text-xs text-red-200 font-semibold mb-1">
                Atenção: isso vai baixar o estoque destas NFs DE NOVO.
              </p>
              <p className="text-xs text-red-200/70">
                O estoque é sensibilizado na importação. Reimportar duplica a baixa imediatamente,
                antes de qualquer bipagem. Só confirme se realmente for uma nota nova com o mesmo número.
                Para corrigir depois, use “Excluir sellers” no card da sessão.
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto border border-white/8 rounded-lg mb-4">
              <table className="w-full text-xs">
                <thead className="bg-white/5 sticky top-0">
                  <tr className="text-white/50">
                    <th className="text-left px-3 py-2 font-medium">NF</th>
                    <th className="text-left px-3 py-2 font-medium">Seller</th>
                    <th className="text-left px-3 py-2 font-medium">Importada em</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((d, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-mono text-white/90">{d.nf_number}</td>
                      <td className="px-3 py-1.5 text-white/60 truncate max-w-[160px]">{d.seller_name}</td>
                      <td className="px-3 py-1.5 text-white/35">
                        {d.existing_imported_at
                          ? format(new Date(d.existing_imported_at), 'dd/MM HH:mm', { locale: ptBR })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelDuplicates}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleForceImport}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Reimportar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de sellers inativos */}
      {inactiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelInactiveSellers}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-yellow-900/30">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  {inactiveSellers.length} seller(s) inativo(s) neste arquivo
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Escolha, para cada seller, se deseja reativá-lo e importar os pedidos dele, ou ignorar só os pedidos desse seller neste arquivo.
                </p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
              {inactiveSellers.map((s) => (
                <div key={s.seller_id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white/90 truncate">{s.seller_name}</p>
                    <p className="text-xs text-white/35">{s.nf_numbers.length} NF(s): {s.nf_numbers.slice(0, 5).join(', ')}{s.nf_numbers.length > 5 ? '…' : ''}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleSetInactiveDecision(s.seller_id, 'reactivate')}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                        inactiveDecisions[s.seller_id] === 'reactivate'
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'border-white/12 text-white/50 hover:text-white hover:border-white/25'
                      }`}
                    >
                      Reativar
                    </button>
                    <button
                      onClick={() => handleSetInactiveDecision(s.seller_id, 'ignore')}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                        inactiveDecisions[s.seller_id] === 'ignore'
                          ? 'bg-white/15 border-white/25 text-white'
                          : 'border-white/12 text-white/50 hover:text-white hover:border-white/25'
                      }`}
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelInactiveSellers}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar importação
              </button>
              <button
                onClick={handleConfirmInactiveSellers}
                disabled={!allInactiveDecided}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {unmatchedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelUnmatchedSellers}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-yellow-900/30">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  {unmatchedSellers.length} nome(s) de seller não reconhecido(s)
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Esses nomes não batem com nenhum seller cadastrado. Escolha, para cada um, se deseja
                  vincular a um seller já existente ou criar um novo (com unidade).
                </p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
              {unmatchedSellers.map((s) => {
                const decision = unmatchedDecisions[s.seller_name];
                const isCreate = decision?.action === 'create';
                const selectValue = !decision ? '' : decision.action === 'create' ? 'create' : String(decision.seller_id);
                return (
                  <div key={s.seller_name} className="px-3 py-2.5">
                    <p className="text-sm text-white/90 truncate">{s.seller_name}</p>
                    <p className="text-xs text-white/35 mb-2">
                      {s.nf_numbers.length} NF(s): {s.nf_numbers.slice(0, 5).join(', ')}{s.nf_numbers.length > 5 ? '…' : ''}
                    </p>
                    <div className="flex gap-2">
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') return;
                          if (v === 'create') {
                            handleSetUnmatchedDecision(s.seller_name, { action: 'create', unit_id: 0 });
                          } else {
                            handleSetUnmatchedDecision(s.seller_name, { action: 'link', seller_id: Number(v) });
                          }
                        }}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                      >
                        <option value="" disabled>Selecione...</option>
                        <option value="create">Criar novo seller</option>
                        {activeSellersForLink.map((sel: any) => (
                          <option key={sel.id} value={sel.id}>Vincular a: {sel.trade_name}</option>
                        ))}
                      </select>
                      {isCreate && (
                        <select
                          value={decision?.action === 'create' && decision.unit_id ? decision.unit_id : ''}
                          onChange={(e) => handleSetUnmatchedDecision(s.seller_name, { action: 'create', unit_id: Number(e.target.value) })}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          <option value="" disabled>Unidade...</option>
                          {(units as any[]).map((u: any) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelUnmatchedSellers}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar importação
              </button>
              <button
                onClick={handleConfirmUnmatchedSellers}
                disabled={!allUnmatchedDecided}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Linha(s) com SKU vazio (19/08/2026): bloqueia o arquivo inteiro.
          Não é toast — fica na tela até fechar manualmente, e não há
          decisão possível aqui (a planilha de origem precisa ser corrigida
          e reenviada), só o botão de fechar. */}
      {missingSkuModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setMissingSkuModalOpen(false)}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-900/30">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Não subimos o arquivo porque tem {missingSkuLines.length} linha(s) com SKU vazio
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Nada deste arquivo foi importado. Corrija o SKU dessas linhas na planilha de origem e envie o arquivo novamente.
                </p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
              {missingSkuLines.map((l, idx) => (
                <div key={idx} className="px-3 py-2.5">
                  <p className="text-sm text-white/90">
                    NF {l.nf_number} · {l.seller_name}
                  </p>
                  <p className="text-xs text-white/40">
                    {l.customer_name || 'Cliente não informado'} — {l.product_name || 'produto sem nome'}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setMissingSkuModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado da baixa de estoque da importação (06/08/2026).
          Avisa, NUNCA trava — o import já foi concluído quando isso aparece. */}
      {stockModalOpen && stockReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setStockModalOpen(false)}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-3xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-amber-900/30">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white">Resultado do estoque</h3>
                <p className="text-xs text-white/50 mt-0.5">
                  {stockReport.applied_orders > 0
                    ? `Estoque baixado em ${stockReport.applied_orders} NF(s). `
                    : ''}
                  Confira os pontos abaixo — nada aqui bloqueia a operação.
                </p>
              </div>
              <button onClick={() => setStockModalOpen(false)} className="text-white/40 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* ── SKUs negativos, agrupados por seller ── */}
            {stockReport.negatives.length > 0 && (() => {
              const bySeller = stockReport.negatives.reduce((acc, n) => {
                const k = n.seller_name || `Seller ${n.seller_id}`;
                (acc[k] = acc[k] || []).push(n);
                return acc;
              }, {} as Record<string, typeof stockReport.negatives>);
              return (
                <div className="mb-5">
                  <p className="text-sm font-semibold text-red-300 mb-2">
                    Estoque negativo em {stockReport.negatives.length} SKU(s)
                  </p>
                  {Object.entries(bySeller).map(([sellerName, rows]) => (
                    <div key={sellerName} className="mb-3 border border-white/8 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-white/5 text-sm text-white/90 font-medium">{sellerName}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-white/40">
                            <tr>
                              <th className="text-left px-3 py-1.5 font-medium">SKU</th>
                              <th className="text-left px-3 py-1.5 font-medium">Produto</th>
                              <th className="text-right px-3 py-1.5 font-medium">Estoque agora</th>
                              <th className="text-right px-3 py-1.5 font-medium">Esta importação</th>
                              <th className="text-left px-3 py-1.5 font-medium">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {rows.map((n) => (
                              <tr key={n.sku}>
                                <td className="px-3 py-1.5 text-white/80 font-mono">{n.sku}</td>
                                <td className="px-3 py-1.5 text-white/60 truncate max-w-[220px]">{n.product_name}</td>
                                <td className="px-3 py-1.5 text-right text-red-300 font-semibold">{n.current_stock}</td>
                                <td className="px-3 py-1.5 text-right text-white/60">
                                  {n.applied_qty > 0 ? `+${n.applied_qty}` : n.applied_qty}
                                </td>
                                <td className="px-3 py-1.5">
                                  {n.was_negative_before ? (
                                    <span className="text-amber-300/80">Já estava negativo</span>
                                  ) : (
                                    <span className="text-red-300">Ficou negativo agora</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── NFs que não subiram ao estoque ── */}
            {stockReport.pending_orders.length > 0 && (
              <div className="mb-5">
                <p className="text-sm font-semibold text-amber-300 mb-1">
                  {stockReport.pending_orders.length} NF(s) NÃO subiram ao estoque
                </p>
                <p className="text-xs text-white/45 mb-2">
                  Enquanto não forem resolvidas, o estoque do seller não reflete essas notas — e o
                  negativo acima pode aumentar quando elas subirem.
                </p>
                <div className="max-h-48 overflow-y-auto border border-white/8 rounded-lg divide-y divide-white/5">
                  {stockReport.pending_orders.map((p) => (
                    <div key={p.order_id} className="px-3 py-2">
                      <p className="text-sm text-white/90">NF {p.nf_number} — {p.seller_name}</p>
                      <p className="text-xs text-white/40">
                        {p.missing_carrier && 'Sem transportadora'}
                        {p.missing_carrier && p.missing_skus.length > 0 && ' · '}
                        {p.missing_skus.length > 0 && `SKU sem cadastro: ${p.missing_skus.join(', ')}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Produtos a cadastrar (destrava sozinho ao salvar) ── */}
            {stockReport.missing_products.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-white/90 mb-1">
                  Cadastrar {stockReport.missing_products.length} produto(s) para liberar
                </p>
                <p className="text-xs text-white/45 mb-2">
                  Ao salvar, as NFs que dependem do SKU baixam o estoque automaticamente.
                </p>
                <div className="border border-white/8 rounded-lg divide-y divide-white/5">
                  {stockReport.missing_products.map((mp) => {
                    const key = `${mp.seller_id}:${mp.sku}`;
                    const form = newProductForm[key] ?? { name: mp.product_name ?? '', barcode: '' };
                    return (
                      <div key={key} className="px-3 py-2.5">
                        <p className="text-xs text-white/50 mb-1.5">
                          <span className="font-mono text-white/80">{mp.sku}</span> · {mp.seller_name} ·{' '}
                          {mp.nf_numbers.length} NF(s)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={form.name}
                            onChange={(e) => setNewProductForm(prev => ({ ...prev, [key]: { ...form, name: e.target.value } }))}
                            placeholder="Nome do produto (obrigatório)"
                            className="flex-1 min-w-[180px] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                          />
                          <input
                            value={form.barcode}
                            onChange={(e) => setNewProductForm(prev => ({ ...prev, [key]: { ...form, barcode: e.target.value } }))}
                            placeholder="Código de barras (opcional)"
                            className="w-44 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                          />
                          <button
                            onClick={() => handleCreateMissingProduct(mp)}
                            disabled={savingProductKey === key}
                            className="px-3 py-1.5 rounded-lg bg-[#3DD9A4] text-[#14122A] text-xs font-semibold disabled:opacity-50"
                          >
                            {savingProductKey === key ? 'Salvando…' : 'Cadastrar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setStockModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelDupSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeCancelDupModal}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-900/30">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Excluir sellers da Sessão #{cancelDupSession.session_id}
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  {cancelDupPreview === null
                    ? 'Escolha quais sellers desta sessão devem ter os pedidos cancelados (ex: upload duplicado). Os demais sellers da sessão não são afetados.'
                    : 'Confira antes de confirmar — alguns pedidos já têm bipagem registrada.'}
                </p>
              </div>
            </div>

            {cancelDupPreview === null ? (
              <div className="max-h-72 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
                {cancelDupSession.sellers.map((s) => (
                  <label key={s.seller_id} className="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={cancelDupSelected.includes(s.seller_id)}
                      onChange={() => toggleCancelDupSeller(s.seller_id)}
                      className="accent-red-500"
                    />
                    <span className="text-sm text-white/90">{s.seller_name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
                {cancelDupPreview.map((p) => (
                  <div key={p.order_id} className="px-3 py-2.5">
                    <p className="text-sm text-white/90">NF {p.nf_number} — {p.seller_name}</p>
                    {p.bucket === 'stock_reversal' && (
                      <p className="text-xs text-red-300 mt-0.5">⚠ NF já baixou estoque — será revertido</p>
                    )}
                    {p.bucket === 'partial_scan' && (
                      <p className="text-xs text-amber-300 mt-0.5">⚠ Bipagem parcial em andamento será descartada (sem impacto de estoque)</p>
                    )}
                    {p.bucket === 'pending' && (
                      <p className="text-xs text-white/35 mt-0.5">Pendente — sem impacto</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={closeCancelDupModal}
                disabled={cancelDupLoading}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={cancelDupPreview === null ? handleCancelDupContinue : handleCancelDupConfirm}
                disabled={cancelDupLoading || (cancelDupPreview === null && cancelDupSelected.length === 0)}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all disabled:opacity-40 bg-red-600 hover:bg-red-500"
              >
                {cancelDupLoading ? 'Processando...' : cancelDupPreview === null ? 'Continuar' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
