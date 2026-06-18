/**
 * WMS Kiwkiw - Página de Pedidos
 * Lista sessões de picking e pedidos com filtros, status e acesso à bipagem.
 */

import { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Search, ScanLine, Package, Settings,
  ArrowDownToLine, ArrowUpFromLine, DollarSign, XCircle, Download,
} from 'lucide-react';
import { scanningApi, ordersApi } from '../api';
import type { Order, PickingSession } from '../api';
import toast from 'react-hot-toast';

// ─── Utilitários ─────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pendente',      color: 'bg-white/8 text-white/50 border border-white/10' },
  validated:   { label: 'Validado',      color: 'bg-blue-900/40 text-blue-300 border border-blue-500/20' },
  separating:  { label: 'Separando',     color: 'bg-amber-900/40 text-amber-300 border border-amber-500/20' },
  scanning:    { label: 'Bipando',       color: 'bg-violet-900/40 text-violet-300 border border-violet-500/20' },
  completed:   { label: 'Concluído',     color: 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/20' },
  interrupted: { label: 'Interrompido',  color: 'bg-orange-900/40 text-orange-300 border border-orange-500/20' },
  cancelled:   { label: 'Cancelado',     color: 'bg-red-900/40 text-red-300 border border-red-500/20' },
};

const normalizeFileType = (ft?: string): 'Saída' | 'Entrada' | '' => {
  if (!ft) return '';
  const lower = ft.toLowerCase();
  return (lower === 'entrada' || lower === 'in') ? 'Entrada' : 'Saída';
};

const excelText = (v: string | null | undefined): string => {
  const s = String(v ?? '');
  return /^\d{10,}$/.test(s) ? `="${s}"` : s;
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'bg-white/8 text-white/50' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ─── Card de sessão ───────────────────────────────────────────

function SessionCard({
  session,
  onOpen,
  onConfig,
  onClick,
  sellers = [],
}: {
  session: PickingSession;
  onOpen: (id: number) => void;
  onConfig: (s: PickingSession) => void;
  onClick: (s: PickingSession) => void;
  sellers?: string[];
}) {
  const pct = session.total_orders > 0
    ? Math.round((session.completed_orders / session.total_orders) * 100)
    : 0;

  const isEntrada = normalizeFileType(session.file_type) === 'Entrada';

  return (
    <div
      className="bg-gray-900/60 border border-white/8 rounded-xl p-4 hover:border-violet-500/20 transition cursor-pointer"
      onClick={() => onClick(session)}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-white/35">Sessão #{session.id}</p>
          <p className="text-sm font-semibold text-white/90">
            {format(new Date(session.session_date + 'T00:00:00'), 'dd/MM/yyyy')}
          </p>
          {session.source_file && (
            <p className="text-[10px] text-white/35 mt-0.5 truncate max-w-[180px]" title={session.source_file}>
              {session.source_file}
            </p>
          )}
          {sellers.length > 0 && (
            <p className="text-[10px] font-medium mt-1" style={{ color: '#9B87F0' }}>
              {sellers.join(' · ')}
            </p>
          )}
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* Badges de configuração da sessão (file_type + faturamento) */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isEntrada
              ? 'bg-blue-900/40 text-blue-300 border border-blue-500/20'
              : 'bg-violet-900/40 text-violet-300 border border-violet-500/20'
          }`}
          title="Tipo de movimentação (nível do arquivo)"
        >
          {isEntrada ? <ArrowDownToLine size={10} /> : <ArrowUpFromLine size={10} />}
          {isEntrada ? 'Entrada' : 'Saída'}
        </span>

        <span
          className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
            session.for_billing
              ? 'bg-amber-900/40 text-amber-300 border border-amber-500/20'
              : 'bg-white/8 text-white/40'
          }`}
          title="Entra no faturamento mensal do seller?"
        >
          {session.for_billing ? <DollarSign size={10} /> : <XCircle size={10} />}
          {session.for_billing ? 'Faturar' : 'Não faturar'}
        </span>

        <button
          onClick={(e) => { e.stopPropagation(); onConfig(session); }}
          className="ml-auto text-white/35 hover:text-violet-400 transition"
          title="Configurar sessão"
        >
          <Settings size={13} />
        </button>
      </div>

      {/* Progresso */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>{session.completed_orders} concluídos</span>
          <span>{session.total_orders} total</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-2">
          <div
            className="bg-violet-500 h-2 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-white/35 mt-1">{pct}% completo</p>
      </div>

      {/* Checagens */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {[
          { key: 'check_transport', label: 'Transp.' },
          { key: 'check_separation', label: 'Separa.' },
          { key: 'check_planning', label: 'Planeja.' },
          { key: 'check_stock', label: 'Estoque' },
        ].map(({ key, label }) => {
          const ok = session[key as keyof PickingSession] as boolean;
          return (
            <span
              key={key}
              className={`text-[10px] px-2 py-0.5 rounded-full border ${ok ? 'bg-emerald-900/35 text-emerald-300 border-emerald-500/20' : 'bg-red-900/35 text-red-300 border-red-500/20'}`}
            >
              {label}
            </span>
          );
        })}
      </div>

      {/* Bipagem disponível somente via Manuseios */}
      <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/8 text-white/25 text-xs cursor-default select-none"
           title="Use o app Manuseios para iniciar a bipagem">
        <ScanLine size={13} />
        Bipagem via Manuseios
      </div>
    </div>
  );
}

// ─── Linha de pedido ──────────────────────────────────────────

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  return (
    <tr
      className="border-b border-white/5 hover:bg-white/4 transition cursor-pointer"
      onClick={onClick}
    >
      <td className="py-2.5 px-3 text-sm font-mono text-white/80">{order.nf_number}</td>
      <td className="py-2.5 px-3 text-sm text-white/80 max-w-[180px] truncate">{order.customer_name}</td>
      <td className="py-2.5 px-3 text-sm text-white/50">{order.seller_name}</td>
      <td className="py-2.5 px-3 text-sm text-white/50">{order.carrier || '—'}</td>
      <td className="py-2.5 px-3">
        <StatusBadge status={order.status} />
      </td>
      <td className="py-2.5 px-3 text-sm text-white/35" title="Data de importação (upload)">
        {(order as any).imported_at ? format(new Date((order as any).imported_at), 'dd/MM/yy HH:mm') : '—'}
      </td>
      <td className="py-2.5 px-3 text-xs text-white/35">
        {order.for_billing ? (
          <span className="inline-flex items-center gap-1 text-amber-700" title="Entra no faturamento (herdado da sessão)">
            <DollarSign size={11} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-white/25" title="Não faturar (herdado da sessão)">
            <XCircle size={11} />
          </span>
        )}
      </td>
    </tr>
  );
}

// ─── Modal de detalhe do pedido ──────────────────────────────

function OrderDetailModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { data: order, isLoading } = useQuery(
    ['order-detail', orderId],
    () => ordersApi.get(orderId).then(r => r.data),
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        {isLoading || !order ? (
          <div className="p-8 text-center text-sm text-white/40">Carregando...</div>
        ) : (
          <>
            <div className="p-5 border-b border-white/8 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-white/35 uppercase tracking-wide">{order.seller_name}</p>
                <h3 className="text-base font-semibold text-white mt-0.5">NF {order.nf_number}</h3>
                <p className="text-xs text-white/50 mt-1">
                  {order.customer_name}
                  {order.carrier ? ` · ${order.carrier}` : ''}
                </p>
                {order.danfe_key && (
                  <p className="text-[10px] font-mono text-white/25 mt-1 break-all select-all">{order.danfe_key}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={order.status} />
                <button onClick={onClose} className="text-white/35 hover:text-white transition text-lg leading-none">✕</button>
              </div>
            </div>

            {/* Itens */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/4">
                    <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">SKU</th>
                    <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Produto</th>
                    <th className="text-right text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Qtd</th>
                    <th className="text-right text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Bipado</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(item => {
                    const scanned = item.scanned_qty ?? 0;
                    const done = scanned >= item.quantity;
                    const partial = scanned > 0 && !done;
                    return (
                      <tr key={item.id} className="border-b border-white/5">
                        <td className="py-2.5 px-4 text-xs font-mono text-white/60">{item.sku}</td>
                        <td className="py-2.5 px-4 text-xs text-white/80">
                          {item.product_name}
                          {item.is_kit_component && (
                            <span className="ml-1 text-[10px] text-violet-400">(kit)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-right text-white/50">{item.quantity}</td>
                        <td className="py-2.5 px-4 text-xs text-right font-medium">
                          <span className={done ? 'text-emerald-400' : partial ? 'text-amber-400' : 'text-white/30'}>
                            {scanned} de {item.quantity}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {order.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-sm text-white/35 py-8">Sem itens cadastrados</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/8 flex justify-between items-center">
              <p className="text-xs text-white/35">
                {order.items.length} item(ns) · importado {order.imported_at ? format(new Date(order.imported_at), 'dd/MM/yy HH:mm') : '—'}
              </p>
              <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/60 border border-white/12 rounded-lg hover:bg-white/5 transition">
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Modal de pedidos da sessão ───────────────────────────────

function SessionOrdersModal({
  session,
  onClose,
  onSelectOrder,
}: {
  session: PickingSession;
  onClose: () => void;
  onSelectOrder: (orderId: number) => void;
}) {
  const { data: sessionOrders = [], isLoading } = useQuery(
    ['session-orders-modal', session.id],
    () => scanningApi.sessionOrders(session.id).then(r => (r.data as any).orders ?? r.data),
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>

        <div className="p-5 border-b border-white/8 flex items-start justify-between">
          <div>
            <p className="text-[11px] text-white/35 uppercase tracking-wide">
              Sessão #{session.id} · {format(new Date(session.session_date + 'T00:00:00'), 'dd/MM/yyyy')}
            </p>
            <h3 className="text-base font-semibold text-white mt-0.5">Pedidos da Sessão</h3>
          </div>
          <button onClick={onClose} className="text-white/35 hover:text-white transition text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <p className="text-center text-sm text-white/35 py-8">Carregando...</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/8 bg-white/4">
                  <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">NF</th>
                  <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Cliente</th>
                  <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Seller</th>
                  <th className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Status</th>
                  <th className="text-right text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-4">Bipagem</th>
                </tr>
              </thead>
              <tbody>
                {(sessionOrders as any[]).map(o => {
                  const done = o.scanned_items >= o.total_items && o.total_items > 0;
                  const partial = o.scanned_items > 0 && !done;
                  return (
                    <tr
                      key={o.id}
                      onClick={() => { onClose(); onSelectOrder(o.id); }}
                      className="border-b border-white/5 hover:bg-white/4 cursor-pointer transition"
                    >
                      <td className="py-2.5 px-4 text-sm font-mono text-white/80">{o.nf_number}</td>
                      <td className="py-2.5 px-4 text-sm text-white/70 max-w-[160px] truncate">{o.customer_name}</td>
                      <td className="py-2.5 px-4 text-sm text-white/50">{o.seller}</td>
                      <td className="py-2.5 px-4"><StatusBadge status={o.status} /></td>
                      <td className="py-2.5 px-4 text-sm text-right font-medium">
                        <span className={done ? 'text-emerald-400' : partial ? 'text-amber-400' : 'text-white/30'}>
                          {o.scanned_items} de {o.total_items}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-white/8 flex justify-between items-center">
          <p className="text-xs text-white/35">{(sessionOrders as any[]).length} pedido(s)</p>
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/60 border border-white/12 rounded-lg hover:bg-white/5 transition">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de configuração da SESSÃO ─────────────────────────
// Entrada/Saída e faturamento são propriedades do ARQUIVO importado,
// não do pedido individual. Qualquer alteração é propagada para todos
// os pedidos da sessão pelo backend.

function SessionConfigModal({
  session,
  onClose,
  onSave,
}: {
  session: PickingSession;
  onClose: () => void;
  onSave: (sessionId: number, data: { file_type: 'Entrada' | 'Saída'; for_billing: boolean }) => Promise<void>;
}) {
  const [fileType, setFileType] = useState<'Entrada' | 'Saída'>(
    (session.file_type as 'Entrada' | 'Saída') || 'Saída'
  );
  const [forBilling, setForBilling] = useState<boolean>(!!session.for_billing);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(session.id, { file_type: fileType, for_billing: forBilling });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white mb-1">Configurar Sessão</h3>
        <p className="text-xs text-white/40 mb-4">
          Sessão #{session.id} · {session.total_orders} pedido(s) serão atualizados
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Tipo da movimentação</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFileType('Saída')}
                className={`px-3 py-2 text-xs rounded-lg border transition ${
                  fileType === 'Saída'
                    ? 'bg-violet-900/25 border-violet-500 text-violet-300 font-medium'
                    : 'bg-gray-900 border-white/12 text-white/60'
                }`}
              >
                Saída (Expedição)
              </button>
              <button
                type="button"
                onClick={() => setFileType('Entrada')}
                className={`px-3 py-2 text-xs rounded-lg border transition ${
                  fileType === 'Entrada'
                    ? 'bg-blue-900/30 border-blue-500 text-blue-300 font-medium'
                    : 'bg-gray-900 border-white/12 text-white/60'
                }`}
              >
                Entrada (Recebimento)
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs text-white/70 font-medium">Considerar para faturamento</label>
              <p className="text-[10px] text-white/35 mt-0.5">Propagado para todos os pedidos do arquivo</p>
            </div>
            <button
              type="button"
              onClick={() => setForBilling(!forBilling)}
              className={`w-10 h-5 rounded-full transition ${forBilling ? 'bg-violet-500' : 'bg-white/15'}`}
            >
              <span
                className={`block w-4 h-4 bg-gray-900 rounded-full shadow transition transform mx-0.5 ${forBilling ? 'translate-x-5' : ''}`}
              />
            </button>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2 text-sm text-white/50 border border-white/10 rounded-lg hover:bg-white/5 transition disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-60 transition"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cabeçalho de coluna ordenável ───────────────────────────

function SortableHeader({ label, col, sortCol, sortDir, onSort }: {
  label: string;
  col: string;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
}) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} className="text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide py-2.5 px-3 cursor-pointer hover:text-white/70 select-none">
      <span className="flex items-center gap-1">
        {label}
        {active && <span className="text-violet-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
        {!active && <span className="text-white/20">↕</span>}
      </span>
    </th>
  );
}

// ─── Página ───────────────────────────────────────────────────

const PAGE_SIZE = 1000;

export default function OrdersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [carrierFilter, setCarrierFilter] = useState('');
  const [configSession, setConfigSession] = useState<PickingSession | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<PickingSession | null>(null);
  // Filtros por nível de arquivo (sessão)
  const [fileTypeFilter, setFileTypeFilter] = useState<'' | 'Entrada' | 'Saída'>('');
  const [billingFilter, setBillingFilter] = useState<'' | 'yes' | 'no'>('');
  // Filtros de data
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Exportação
  const [exporting, setExporting] = useState(false);
  // Ordenação
  const [sortCol, setSortCol] = useState<string>('order_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Paginação
  const [page, setPage] = useState(1);

  const { data: sessions = [], refetch: refetchSessions } = useQuery(
    'sessions',
    () => scanningApi.sessions().then(r => r.data),
  );

  const { data: orders = [], refetch: refetchOrders } = useQuery(
    ['orders', search, statusFilter],
    () => ordersApi.list({ search, status: statusFilter || undefined, limit: 1000 }).then(r => r.data),
    { keepPreviousData: true },
  );

  const handleSessionConfigSave = async (
    sessionId: number,
    data: { file_type: 'Entrada' | 'Saída'; for_billing: boolean },
  ) => {
    try {
      await scanningApi.updateSessionConfig(sessionId, data);
      toast.success('Configuração da sessão atualizada!');
      refetchSessions();
      refetchOrders();
    } catch {
      toast.error('Erro ao salvar configuração');
    }
  };

  // Ordenação
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // Exportação para CSV com máximo detalhe (uma linha por item por pedido)
  const handleExport = () => {
    setExporting(true);
    try {
      const headers = [
        'NF', 'Chave_DANFE', 'Data_NF', 'Data_Importacao',
        'Cliente', 'Seller', 'Transportadora', 'Status', 'Faturar',
        'SKU', 'Produto', 'Quantidade', 'Kit_Componente', 'SKU_Kit_Original',
      ];

      const rows: string[][] = [];
      // Usa todos os pedidos filtrados (sem limite de paginação)
      filtered.forEach(o => {
        const items: any[] = (o as any).items ?? [];
        if (items.length === 0) {
          // Pedido sem itens carregados: exporta só o cabeçalho
          rows.push([
            excelText(o.nf_number),
            excelText((o as any).danfe_key),
            o.order_date ? format(new Date(o.order_date), 'dd/MM/yyyy') : '',
            (o as any).imported_at ? format(new Date((o as any).imported_at), 'dd/MM/yyyy HH:mm') : '',
            o.customer_name,
            o.seller_name ?? '',
            o.carrier ?? '',
            STATUS_CONFIG[o.status]?.label || o.status,
            o.for_billing ? 'Sim' : 'Não',
            '', '', '', '', '',
          ]);
        } else {
          items.forEach((item: any) => {
            rows.push([
              excelText(o.nf_number),
              excelText((o as any).danfe_key),
              (o as any).imported_at ? format(new Date((o as any).imported_at), 'dd/MM/yyyy HH:mm') : '',
              (o as any).imported_at ? format(new Date((o as any).imported_at), 'dd/MM/yyyy HH:mm') : '',
              o.customer_name,
              o.seller_name ?? '',
              o.carrier ?? '',
              STATUS_CONFIG[o.status]?.label || o.status,
              o.for_billing ? 'Sim' : 'Não',
              item.sku ?? '',
              item.product_name ?? '',
              String(item.quantity ?? ''),
              item.is_kit_component ? 'Sim' : 'Não',
              item.original_kit_sku ?? '',
            ]);
          });
        }
      });

      const csvContent = [headers, ...rows]
        .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedidos_detalhado_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // Filtra pedidos localmente por texto + filtros de nível de sessão
  const filtered = orders.filter(o => {
    if (search) {
      const q = search.toLowerCase();
      const matches =
        o.nf_number.includes(search) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.seller_name.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (sellerFilter && o.seller_name !== sellerFilter) return false;
    if (carrierFilter && o.carrier !== carrierFilter) return false;
    if (billingFilter === 'yes' && !o.for_billing) return false;
    if (billingFilter === 'no' && o.for_billing) return false;
    // Filtra por file_type usando a sessão do pedido (normaliza "saida"→"Saída")
    if (fileTypeFilter) {
      const sess = sessions.find(s => s.id === (o as any).session_id);
      if (normalizeFileType(sess?.file_type) !== fileTypeFilter) return false;
    }
    // Filtros de data — usa imported_at (data do upload, sempre confiável)
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      const d = (o as any).imported_at ? new Date((o as any).imported_at) : null;
      if (!d || d < fromDate) return false;
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59);
      const d = (o as any).imported_at ? new Date((o as any).imported_at) : null;
      if (!d || d > toDate) return false;
    }
    return true;
  });

  // Ordena pedidos
  const sorted = [...filtered].sort((a: any, b: any) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Paginação
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reseta página quando filtros mudam
  useEffect(() => { setPage(1); }, [search, statusFilter, sellerFilter, carrierFilter, fileTypeFilter, billingFilter, dateFrom, dateTo]);

  // Opções únicas de seller e transportadora para os dropdowns
  const uniqueSellers = Array.from(new Set(orders.map(o => o.seller_name).filter(Boolean))).sort();
  const uniqueCarriers = Array.from(new Set(orders.map(o => o.carrier).filter(Boolean))).sort();

  // Sessões filtradas (quando filtro de sessão está ativo)
  // Sellers por sessão — derivado dos pedidos carregados (sem chamada extra)
  const sellersBySession = (sessions as any[]).reduce((acc: Record<number, string[]>, s: any) => {
    const names = orders
      .filter(o => (o as any).session_id === s.id)
      .map(o => o.seller_name)
      .filter(Boolean);
    acc[s.id] = Array.from(new Set(names));
    return acc;
  }, {});

  const filteredSessions = sessions.filter((s: any) => {
    if (fileTypeFilter && normalizeFileType(s.file_type) !== fileTypeFilter) return false;
    if (billingFilter === 'yes' && !s.for_billing) return false;
    if (billingFilter === 'no' && s.for_billing) return false;
    // 4c: filtro de data também nos cards de sessão (usa session_date = data upload)
    if (dateFrom && new Date(s.session_date + 'T00:00:00') < new Date(dateFrom + 'T00:00:00')) return false;
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59);
      if (new Date(s.session_date + 'T00:00:00') > toDate) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6 min-h-full text-white">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Pedidos & Sessões</h1>
        <p className="text-sm text-white/50 mt-0.5">Gerencie sessões de picking e visualize todos os pedidos</p>
      </div>

      {/* Filtros de nível de arquivo — afetam sessões + pedidos */}
      <div className="bg-gray-900 border border-white/8 rounded-xl p-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-white/50">Filtros do arquivo:</span>

        <select
          value={fileTypeFilter}
          onChange={e => setFileTypeFilter(e.target.value as '' | 'Entrada' | 'Saída')}
          className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
          title="Tipo da movimentação (nível do arquivo)"
        >
          <option value="">Todos os tipos</option>
          <option value="Saída">Saída (Expedição)</option>
          <option value="Entrada">Entrada (Recebimento)</option>
        </select>

        <select
          value={billingFilter}
          onChange={e => setBillingFilter(e.target.value as '' | 'yes' | 'no')}
          className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
          title="Entra no faturamento?"
        >
          <option value="">Todos (faturamento)</option>
          <option value="yes">Apenas faturáveis</option>
          <option value="no">Apenas não faturáveis</option>
        </select>

        <div className="flex items-center gap-1">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
            title="Data inicial" />
          <span className="text-white/25 text-xs">→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
            title="Data final" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-xs text-white/35 hover:text-red-500 px-1">✕</button>
          )}
        </div>

        {(fileTypeFilter || billingFilter) && (
          <button
            onClick={() => { setFileTypeFilter(''); setBillingFilter(''); }}
            className="text-xs text-violet-400 hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Sessões de picking */}
      <div>
        <h2 className="text-sm font-semibold text-white/80 mb-3">
          Sessões de Picking Ativas
          <span className="ml-2 text-xs font-normal text-white/35">
            ({filteredSessions.filter(s => s.status !== 'completed').length} ativa(s))
          </span>
        </h2>

        {filteredSessions.length === 0 ? (
          <div className="bg-gray-900 border border-dashed border-white/12 rounded-xl p-8 text-center">
            <Package size={32} className="text-white/25 mx-auto mb-2" />
            <p className="text-sm text-white/50">
              {sessions.length === 0
                ? 'Nenhuma sessão de picking. Importe um arquivo Excel no Dashboard.'
                : 'Nenhuma sessão atende aos filtros selecionados.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                onOpen={id => navigate(`/scan/${id}`)}
                onConfig={setConfigSession}
                onClick={setSelectedSession}
                sellers={sellersBySession[(session as any).id] ?? []}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lista de pedidos */}
      <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none">
        <div className="p-4 border-b border-white/8 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white/80 flex-1">Todos os Pedidos</h2>

          {/* Filtro de seller */}
          <select
            value={sellerFilter}
            onChange={e => setSellerFilter(e.target.value)}
            className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Todos os sellers</option>
            {uniqueSellers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Filtro de transportadora */}
          <select
            value={carrierFilter}
            onChange={e => setCarrierFilter(e.target.value)}
            className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Todas as transportadoras</option>
            {uniqueCarriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Filtro de status */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-white/12 rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          {/* Limpar filtros da tabela */}
          {(sellerFilter || carrierFilter || statusFilter) && (
            <button
              onClick={() => { setSellerFilter(''); setCarrierFilter(''); setStatusFilter(''); }}
              className="text-xs text-violet-400 hover:underline whitespace-nowrap"
            >
              Limpar
            </button>
          )}

          {/* Busca */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              type="text"
              placeholder="Buscar NF, cliente, seller..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-xs border border-white/12 rounded-lg outline-none focus:ring-2 focus:ring-violet-500 w-56"
            />
          </div>

          {/* Exportar */}
          <button onClick={handleExport} disabled={exporting || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-violet-300 bg-violet-900/25 hover:bg-violet-900/40 border border-violet-500/30 rounded-lg transition disabled:opacity-50">
            <Download size={13} />
            {exporting ? 'Exportando...' : `Exportar (${filtered.length})`}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/8 bg-white/4">
                <SortableHeader label="NF" col="nf_number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Cliente" col="customer_name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Seller" col="seller_name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Transportadora" col="carrier" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Status" col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Data" col="order_date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">Faturar</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(order => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onClick={() => setSelectedOrderId(order.id)}
                />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-sm text-white/35 py-10">
                    Nenhum pedido encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">
          {sorted.length} pedido(s) exibido(s)
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-white/8 flex items-center justify-between">
            <p className="text-xs text-white/35">{sorted.length} total · mostrando {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, sorted.length)}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-white/4">«</button>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-white/4">‹</button>
              {Array.from({length: Math.min(5, totalPages)}, (_, i) => {
                const pg = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                return pg <= totalPages ? (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`px-2.5 py-1 text-xs border rounded ${page === pg ? 'bg-violet-600 text-white border-violet-600' : 'hover:bg-white/4'}`}>
                    {pg}
                  </button>
                ) : null;
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-white/4">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30 hover:bg-white/4">»</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de detalhe do pedido */}
      {selectedOrderId && (
        <OrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}

      {/* Modal de pedidos da sessão */}
      {selectedSession && (
        <SessionOrdersModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onSelectOrder={(id) => { setSelectedSession(null); setSelectedOrderId(id); }}
        />
      )}

      {/* Modal de configuração da SESSÃO */}
      {configSession && (
        <SessionConfigModal
          session={configSession}
          onClose={() => setConfigSession(null)}
          onSave={handleSessionConfigSave}
        />
      )}
    </div>
  )
}
