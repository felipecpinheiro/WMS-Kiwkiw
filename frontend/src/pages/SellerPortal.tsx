/**
 * WMS Kiwkiw - Portal do Seller
 * Sidebar lateral, tabela de estoque com sort + modal de detalhe por SKU,
 * aba de Movimentações e aba de Pedidos.
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  Package, TrendingDown, CheckCircle, Clock, LogOut,
  Search, Download, ClipboardList, Warehouse,
  ChevronUp, ChevronDown, ChevronsUpDown, X,
  BarChart2, List, CalendarDays, KeyRound, SlidersHorizontal,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { dashboardApi, inventoryApi, authApi } from '../api';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { todayBrasiliaStr } from '../timezone';
import { useIsMobile } from '../hooks/useIsMobile';
import BottomSheet from '../components/BottomSheet';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'stock' | 'movements';
type StockSubTab = 'position' | 'chart';
type SortDir = 'asc' | 'desc' | null;
interface SortState { col: string; dir: SortDir }

// ─── Configurações ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:     { label: 'Separação do Produto', cls: 'bg-blue-900/40 text-blue-300' },
  validated:   { label: 'Separação do Produto', cls: 'bg-blue-900/40 text-blue-300' },
  separating:  { label: 'Separação do Produto', cls: 'bg-blue-900/40 text-blue-300' },
  scanning:    { label: 'Em Preparação',        cls: 'bg-violet-900/40 text-violet-300' },
  completed:   { label: 'Concluído',            cls: 'bg-green-900/40 text-green-300' },
  interrupted: { label: 'Interrompido',         cls: 'bg-orange-900/40 text-orange-300' },
  cancelled:   { label: 'Cancelado',            cls: 'bg-red-900/40 text-red-400' },
};

// ─── Header de coluna com sort ────────────────────────────────────────────────

function SortTh({
  label, col, sort, onSort, align = 'left', width,
}: {
  label: string; col: string; sort: SortState;
  onSort: (col: string) => void;
  align?: 'left' | 'right' | 'center';
  width?: string;
}) {
  const active = sort.col === col;
  const justifyMap = { left: 'justify-start', right: 'justify-end', center: 'justify-center' };
  const textMap    = { left: 'text-left',      right: 'text-right',  center: 'text-center' };
  return (
    <th
      className={`text-[11px] font-semibold uppercase tracking-wide py-2.5 px-3 cursor-pointer select-none
        hover:text-white/80 transition whitespace-nowrap ${textMap[align]}
        ${active ? 'text-violet-300' : 'text-white/45'}`}
      style={width ? { width } : undefined}
      onClick={() => onSort(col)}
    >
      <span className={`flex items-center gap-1 ${justifyMap[align]}`}>
        {label}
        {active
          ? sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
          : <ChevronsUpDown size={11} className="opacity-35" />}
      </span>
    </th>
  );
}

// ─── Modal de detalhe do SKU (mesmo do Inventory) ────────────────────────────

function SkuDetailModal({
  sellerId, sku, onClose,
}: {
  sellerId: number; sku: string; onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [days, setDays] = useState(90);
  const { data, isLoading } = useQuery(
    ['sku-history-portal', sellerId, sku, days],
    () => inventoryApi.skuHistory(sellerId, sku, days).then(r => r.data),
    { keepPreviousData: true },
  );

  const periodSelect = (
    <select
      value={days}
      onChange={e => setDays(Number(e.target.value))}
      className="border border-white/12 rounded-lg px-2 py-1.5 text-xs bg-gray-800 text-white outline-none focus:ring-2 focus:ring-violet-500"
    >
      <option value={30}>30 dias</option>
      <option value={60}>60 dias</option>
      <option value={90}>90 dias</option>
      <option value={180}>180 dias</option>
    </select>
  );

  const body = isLoading ? (
    <div className="flex items-center justify-center h-48 text-white/35 text-sm">Carregando...</div>
  ) : data ? (
          <div className={isMobile ? 'space-y-5' : 'p-5 space-y-5'}>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Saldo Atual',         value: data.current_stock,       color: 'text-white',      unit: '' },
                { label: 'Média Diária (60d)',   value: data.avg_daily_sales_60d, color: 'text-blue-400',   unit: '/dia' },
                { label: 'Total Saídas Período', value: data.total_sales_period,  color: 'text-red-400',    unit: '' },
                {
                  label: 'Projeção Duração',
                  value: data.days_remaining != null ? data.days_remaining : '∞',
                  color: data.days_remaining != null && data.days_remaining < 30
                    ? 'text-red-400' : 'text-violet-400',
                  unit: data.days_remaining != null ? ' dias' : '',
                },
              ].map(k => (
                <div key={k.label} className="bg-white/4 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}{k.unit}</p>
                </div>
              ))}
            </div>

            {/* Gráfico barras */}
            {data.chart_data && data.chart_data.length > 0 ? (
              <div>
                <p className="text-xs text-white/50 font-medium mb-3">Saídas e Entradas por Dia</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.chart_data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
                    <Bar dataKey="saidas"   name="Saídas"   fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="entradas" name="Entradas" fill="#7B63E8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-sm text-white/35 py-8">Sem movimentações no período</p>
            )}

            {/* Alerta ruptura */}
            {data.days_remaining != null && data.days_remaining < 15 && (
              <div className="bg-red-900/25 border border-red-500/20 rounded-xl p-3 text-sm text-red-300">
                ⚠️ Atenção: com a média atual, o estoque se esgota em <strong>{data.days_remaining} dias</strong>. Considere reabastecer.
              </div>
            )}
          </div>
  ) : (
    <p className="text-center text-sm text-white/35 py-10">Nenhum dado encontrado para este SKU.</p>
  );

  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title={sku}>
        <div className="flex items-center justify-between -mt-1 mb-4">
          <p className="text-xs text-white/35">{data?.product_name}</p>
          {periodSelect}
        </div>
        {body}
      </BottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/8 sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-base font-semibold text-white font-mono">{sku}</h2>
            <p className="text-xs text-white/35 mt-0.5">{data?.product_name}</p>
          </div>
          <div className="flex items-center gap-3">
            {periodSelect}
            <button onClick={onClose} className="text-white/35 hover:text-white/60">
              <X size={18} />
            </button>
          </div>
        </div>
        {body}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SellerPortalPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : {};
  const sellerId = user.seller_id;

  const today = todayBrasiliaStr();

  const [tab, setTab] = useState<Tab>('orders');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo]     = useState(today);
  const [sort, setSort] = useState<SortState>({ col: '', dir: null });
  // Filtro de datas para movimentações
  const oneYearAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0,10); })();
  const [movDateFrom, setMovDateFrom] = useState(oneYearAgo);
  const [movDateTo,   setMovDateTo]   = useState(today);
  const [movTypeFilter, setMovTypeFilter] = useState<'' | 'Entrada' | 'Saída'>('');
  const [movSort, setMovSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'movement_date', dir: 'desc' });
  const [movFiltersOpen, setMovFiltersOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  // ── Dados ──────────────────────────────────────────────────────────────────

  const { data: dashboard } = useQuery(
    ['seller-dashboard', sellerId, dateFrom, dateTo],
    () => sellerId ? dashboardApi.seller({ seller_id: sellerId, date_from: dateFrom, date_to: dateTo }).then(r => r.data) : null,
    { enabled: !!sellerId, refetchInterval: 60000 },
  );

  const { data: stock = [] } = useQuery(
    ['seller-stock', sellerId],
    () => sellerId ? inventoryApi.stock(sellerId).then(r => r.data) : [],
    { enabled: !!sellerId },
  );

  const { data: movements = [] } = useQuery(
    ['seller-movements', sellerId, movDateFrom, movDateTo],
    () => sellerId ? inventoryApi.movements(sellerId, movDateFrom, movDateTo).then(r => r.data) : [],
    { enabled: !!sellerId && tab === 'movements' },
  );

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdSaving, setPwdSaving] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    navigate('/login');
  };

  const handlePwdSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.next.length < 6) { toast.error('A nova senha deve ter pelo menos 6 caracteres'); return; }
    if (pwdForm.next !== pwdForm.confirm) { toast.error('As senhas não coincidem'); return; }
    setPwdSaving(true);
    try {
      await authApi.changePassword(pwdForm.current, pwdForm.next);
      toast.success('Senha alterada com sucesso!');
      setPwdForm({ current: '', next: '', confirm: '' });
      setShowPwdModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao alterar senha');
    } finally {
      setPwdSaving(false);
    }
  };

  // ── Pedidos ────────────────────────────────────────────────────────────────

  const orders = dashboard?.recent_orders ?? [];
  const filteredOrders = orders.filter((o: any) =>
    (!search || o.nf_number?.includes(search) || o.customer_name?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || (STATUS_CONFIG[o.status]?.label ?? o.status) === statusFilter),
  );

  // ── Estoque com sort ───────────────────────────────────────────────────────

  const handleSort = (col: string) => {
    setSort(prev =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : prev.dir === 'desc' ? null : 'asc' }
        : { col, dir: 'asc' },
    );
  };

  const filteredStock: any[] = useMemo(() => {
    const f = (stock as any[]).filter(s =>
      !search ||
      s.sku.toLowerCase().includes(search.toLowerCase()) ||
      (s.product_name ?? '').toLowerCase().includes(search.toLowerCase()),
    );
    if (!sort.col || !sort.dir) return f;
    return [...f].sort((a, b) => {
      const av = a[sort.col] ?? '';
      const bv = b[sort.col] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [stock, search, sort]);

  // ── Movimentações filtradas ────────────────────────────────────────────────

  const filteredMovements: any[] = useMemo(() => {
    let list = movements as any[];
    // filtro texto
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.sku?.toLowerCase().includes(q) ||
        (m.product_name ?? '').toLowerCase().includes(q) ||
        (m.nf_number ?? '').includes(q),
      );
    }
    // filtro tipo
    if (movTypeFilter) list = list.filter(m => m.movement_type === movTypeFilter);
    // sort
    list = [...list].sort((a, b) => {
      const dir = movSort.dir === 'asc' ? 1 : -1;
      const va = a[movSort.col] ?? '';
      const vb = b[movSort.col] ?? '';
      if (movSort.col === 'quantity') return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return list;
  }, [movements, search, movTypeFilter, movSort]);

  const completionPct  = dashboard?.completion_rate ?? 0;
  const sellerName     = dashboard?.seller_name ?? user.seller_name ?? 'Seller';
  const lowStockCount  = (stock as any[]).filter((s: any) => s.level === 'BAIXO').length;
  const ordersCompleted = dashboard?.orders_completed ?? 0;
  const ordersPending   = dashboard?.orders_pending ?? 0;
  const ordersInterrupted = orders.filter((o: any) => o.status === 'interrupted').length;
  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'S';

  // ── Nav da sidebar ─────────────────────────────────────────────────────────

  const navItems: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'orders',    label: 'Meus Pedidos',   icon: ClipboardList },
    { id: 'stock',     label: 'Meu Estoque',    icon: Warehouse },
    { id: 'movements', label: 'Movimentações',  icon: List },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0C0B18' }}>

      {/* ══ SIDEBAR (desktop) ════════════════════════════════════════════════ */}
      {!isMobile && (
      <aside
        className="w-56 flex flex-col flex-shrink-0 border-r"
        style={{ background: '#100E22', borderColor: 'rgba(123,99,232,0.12)' }}
      >
        {/* Logo + seller */}
        <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 flex-shrink-0 bg-violet-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-xs">K</span>
            </div>
            <div>
              <div className="text-xs font-bold text-white leading-tight">Kiwkiw WMS</div>
              <div className="text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.30)' }}>
                Portal do Seller
              </div>
            </div>
          </div>
          {/* Seller em destaque */}
          <div className="rounded-xl px-3 py-2.5" style={{
            background: 'linear-gradient(135deg, rgba(123,99,232,0.25) 0%, rgba(61,217,164,0.12) 100%)',
            border: '1px solid rgba(123,99,232,0.30)',
          }}>
            <p className="text-[9px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>Seller</p>
            <p className="text-sm font-bold text-white leading-tight truncate">{sellerName}</p>
          </div>
        </div>

        {/* KPIs compactos */}
        <div className="px-3 py-3 border-b space-y-1.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2"
            style={{ color: 'rgba(255,255,255,0.22)' }}>Hoje</p>
          {[
            { label: 'Pedidos',       value: dashboard?.total_orders ?? 0,  color: 'text-white/80' },
            { label: 'Concluídos',    value: ordersCompleted,                color: 'text-green-400' },
            { label: 'Interrompidos', value: ordersInterrupted,              color: 'text-orange-400' },
            { label: 'Pendentes',     value: ordersPending,                  color: 'text-violet-400' },
            { label: 'Estoque Baixo', value: (stock as any[]).filter((s: any) => s.level === 'BAIXO').length, color: 'text-red-400' },
          ].map(k => (
            <div key={k.label} className="flex items-center justify-between">
              <span className="text-[11px] text-white/40">{k.label}</span>
              <span className={`text-sm font-bold ${k.color}`}>{k.value}</span>
            </div>
          ))}
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-white/30 mb-1">
              <span>Progresso</span>
              <span>{completionPct.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <div className="bg-violet-500 h-1.5 rounded-full transition-all"
                style={{ width: `${completionPct}%` }} />
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          <p className="px-2 mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em]"
            style={{ color: 'rgba(255,255,255,0.22)' }}>Consultas</p>
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); setSearch(''); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all mb-0.5 text-left
                  ${isActive ? 'text-white font-medium' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
                style={isActive ? {
                  background: 'rgba(123,99,232,0.18)',
                  border: '1px solid rgba(123,99,232,0.28)',
                  color: 'rgba(255,255,255,0.92)',
                } : {}}
              >
                <Icon size={14} style={isActive ? { color: '#9B87F0' } : {}} />
                {label}
              </button>
            );
          })}

        </nav>

        {/* User / Logout */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-violet-300">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-white/80 truncate">{user.name}</p>
              <p className="text-[10px] text-white/30 truncate">
                {format(new Date(), 'dd/MM/yyyy', { locale: ptBR })}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowPwdModal(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/40
              hover:text-violet-400 hover:bg-violet-900/15 transition mb-1"
          >
            <KeyRound size={12} /> Alterar senha
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/40
              hover:text-red-400 hover:bg-red-900/15 transition"
          >
            <LogOut size={12} /> Sair
          </button>
        </div>
      </aside>
      )}

      {/* Modal alterar senha */}
      {showPwdModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xs p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2"><KeyRound size={15} className="text-violet-400" /> Alterar Senha</h3>
              <button onClick={() => setShowPwdModal(false)} className="text-white/35 hover:text-white/60"><X size={16} /></button>
            </div>
            <form onSubmit={handlePwdSave} className="space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Senha atual *</label>
                <input type="password" value={pwdForm.current} onChange={e => setPwdForm(p => ({ ...p, current: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Nova senha *</label>
                <input type="password" value={pwdForm.next} onChange={e => setPwdForm(p => ({ ...p, next: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Confirmar *</label>
                <input type="password" value={pwdForm.confirm} onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowPwdModal(false)}
                  className="flex-1 py-2 text-xs text-white/60 border border-white/12 rounded-lg hover:bg-white/4">Cancelar</button>
                <button type="submit" disabled={pwdSaving}
                  className="flex-1 py-2 text-xs text-white bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50">
                  {pwdSaving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ CONTEÚDO PRINCIPAL ════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topo (mobile) — nome do seller + acesso rápido a senha/logout */}
        {isMobile && (
          <div className="flex items-center gap-1.5 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>Seller</p>
              <p className="text-sm font-bold text-white truncate">{sellerName}</p>
            </div>
            <button
              onClick={() => setShowPwdModal(true)}
              aria-label="Alterar senha"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white/40 hover:text-violet-400 hover:bg-violet-900/15 transition"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={handleLogout}
              aria-label="Sair"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white/40 hover:text-red-400 hover:bg-red-900/15 transition"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}

      <main className="flex-1 overflow-y-auto">
        <div className={isMobile ? 'p-4 space-y-4' : 'p-6 space-y-5'}>

          {/* Aviso de estoque baixo (mobile) — substitui os KPIs fixos da sidebar */}
          {isMobile && lowStockCount > 0 && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 px-3.5 py-2.5" style={{ background: 'rgba(226,75,74,0.08)' }}>
              <span className="text-base font-bold text-red-400">{lowStockCount}</span>
              <span className="text-xs text-red-300/85 flex-1">SKU{lowStockCount > 1 ? 's' : ''} em nível baixo de estoque</span>
            </div>
          )}

          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-white">
              {navItems.find(n => n.id === tab)?.label}
            </h1>
            <p className="text-sm text-white/35 mt-0.5">
              {tab === 'orders'    ? 'Acompanhe o status dos seus pedidos do dia' : ''}
              {tab === 'stock'     ? 'Posição atual — clique em uma linha para ver o gráfico do SKU' : ''}
              {tab === 'movements' ? 'Histórico de entradas e saídas de estoque' : ''}
            </p>
          </div>

          {/* ── PEDIDOS ──────────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <>
              {/* Filtros: período + busca + status */}
              <div className="flex gap-3 flex-wrap items-center bg-gray-900/60 border border-white/8 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className="text-violet-400 flex-shrink-0" />
                  <span className="text-xs text-white/40">De</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="border border-white/12 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-white/80"
                    style={{ background: '#14122A', colorScheme: 'dark' }}
                  />
                  <span className="text-xs text-white/40">até</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="border border-white/12 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-white/80"
                    style={{ background: '#14122A', colorScheme: 'dark' }}
                  />
                </div>

                <div className="relative flex-1 min-w-[160px]">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar NF ou cliente..."
                    className="w-full pl-7 pr-3 py-1.5 border border-white/12 rounded-lg text-sm bg-gray-900 text-white outline-none focus:ring-2 focus:ring-violet-500" />
                </div>

                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="border border-white/12 rounded-lg px-3 py-1.5 text-sm bg-gray-900 text-white outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="">Todos os status</option>
                  {Array.from(new Set(Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'cancelled').map(([, v]) => v.label)))
                    .map(label => <option key={label} value={label}>{label}</option>)}
                </select>
              </div>

              <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/4 border-b border-white/8">
                      {['NF', 'Cliente Final', 'Transportadora', 'Data Upload', 'Status'].map(h => (
                        <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length > 0 ? filteredOrders.map((o: any) => {
                      const st = STATUS_CONFIG[o.status] ?? { label: o.status, cls: 'bg-gray-700 text-white/50' };
                      return (
                        <tr key={o.id} className="border-b border-white/5 hover:bg-white/4">
                          <td className="py-2.5 px-3 text-sm font-mono text-white/80">{o.nf_number}</td>
                          <td className="py-2.5 px-3 text-sm text-white/90">{o.customer_name}</td>
                          <td className="py-2.5 px-3 text-sm text-white/50">{o.carrier || '—'}</td>
                          <td className="py-2.5 px-3 text-sm text-white/50">
                            {o.imported_at ? format(new Date(o.imported_at), 'dd/MM/yy') : o.order_date ? format(new Date(o.order_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={5} className="text-center text-sm text-white/35 py-10">Nenhum pedido encontrado</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">
                  {filteredOrders.length} pedido(s)
                  {dateFrom === dateTo
                    ? ` · ${format(new Date(dateFrom + 'T00:00:00'), "dd/MM/yyyy")}`
                    : ` · ${format(new Date(dateFrom + 'T00:00:00'), 'dd/MM')} → ${format(new Date(dateTo + 'T00:00:00'), 'dd/MM/yyyy')}`
                  }
                </div>
              </div>
            </>
          )}

          {/* ── ESTOQUE (tabela com sort + click p/ gráfico) ──────────────── */}
          {tab === 'stock' && (
            <>
              <div className="relative max-w-sm">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar SKU ou produto..."
                  className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm bg-gray-900 text-white outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              {isMobile ? (
                <div className="space-y-2">
                  {filteredStock.length > 0 ? filteredStock.map((s: any) => {
                    const stockVal = s.current_stock ?? s.final_stock ?? 0;
                    const fs       = s.forecast_status ?? '';
                    const noStock  = stockVal <= 0;
                    const stripe =
                      s.level === 'ALTO'  ? '#7B63E8' :
                      s.level === 'MÉDIO' ? '#F0C87E' : '#E24B4A';
                    const forecastCls =
                      fs === 'Sem Produto'            ? 'bg-red-900/60 text-red-300 font-bold' :
                      fs === 'Sem Dados Suficientes'  ? 'bg-gray-700/50 text-white/35' :
                      fs === 'Baixo'                  ? 'bg-red-900/50 text-red-300 font-semibold' :
                      fs === 'Médio'                  ? 'bg-yellow-900/40 text-yellow-300' :
                      fs === 'Alto'                   ? 'bg-green-900/40 text-green-300' : 'bg-gray-700/40 text-white/40';
                    return (
                      <div
                        key={s.sku}
                        onClick={() => setSelectedSku(s.sku)}
                        className="flex gap-2.5 p-3 rounded-xl border border-white/8 bg-gray-900 active:bg-white/5 cursor-pointer"
                      >
                        <div className="w-[3px] rounded-full flex-shrink-0" style={{ background: stripe }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-white/90 truncate">{s.product_name}</span>
                            <span className={`text-base font-bold tabular-nums flex-shrink-0 ${noStock ? 'text-red-400' : 'text-white'}`}>{stockVal}</span>
                          </div>
                          <p className="text-[11px] font-mono text-white/30 mt-0.5">{s.sku}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className="text-[11px] text-white/40">entradas <b className="text-teal-400 font-medium">+{s.total_in ?? s.entries ?? 0}</b></span>
                            <span className="text-[11px] text-white/40">saídas <b className="text-red-400 font-medium">-{s.total_out ?? s.exits ?? 0}</b></span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${forecastCls}`}>{fs || s.level || '—'}</span>
                          </div>
                          {s.days_remaining != null && (
                            <p className="text-[11px] text-white/50 mt-1">previsão: {s.days_remaining} dia{s.days_remaining === 1 ? '' : 's'}</p>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-sm text-white/35 py-10">Nenhum produto no estoque</p>
                  )}
                  {filteredStock.length > 0 && (
                    <p className="text-xs text-white/30 text-center pt-1">{filteredStock.length} SKU(s) — toque para ver o gráfico</p>
                  )}
                </div>
              ) : (
              <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="bg-white/4 border-b border-white/8">
                      <SortTh label="SKU"       col="sku"              sort={sort} onSort={handleSort} align="left"   width="120px" />
                      <SortTh label="Produto"   col="product_name"    sort={sort} onSort={handleSort} align="left"   width="auto" />
                      <SortTh label="Entradas"  col="total_in"        sort={sort} onSort={handleSort} align="right"  width="90px" />
                      <SortTh label="Saídas"    col="total_out"       sort={sort} onSort={handleSort} align="right"  width="90px" />
                      <SortTh label="Saldo"     col="current_stock"   sort={sort} onSort={handleSort} align="right"  width="80px" />
                      <SortTh label="Previsão"  col="days_remaining"  sort={sort} onSort={handleSort} align="right"  width="90px" />
                      <SortTh label="Status"    col="forecast_status" sort={sort} onSort={handleSort} align="center" width="140px" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.length > 0 ? filteredStock.map((s: any) => {
                      const stockVal = s.current_stock ?? s.final_stock ?? 0;
                      const fs       = s.forecast_status ?? '';
                      const noStock  = stockVal <= 0;
                      const isLow    = fs === 'Baixo';
                      const rowBg    = noStock ? 'bg-red-950/30' : isLow ? 'bg-orange-950/20' : '';
                      const levelCls =
                        s.level === 'ALTO'  ? 'bg-violet-900/40 text-violet-300' :
                        s.level === 'MÉDIO' ? 'bg-yellow-900/40 text-yellow-300' :
                                              'bg-red-900/40 text-red-400';
                      const forecastCls =
                        fs === 'Sem Produto'            ? 'bg-red-900/60 text-red-300 font-bold' :
                        fs === 'Sem Dados Suficientes'  ? 'bg-gray-700/50 text-white/35' :
                        fs === 'Baixo'                  ? 'bg-red-900/50 text-red-300 font-semibold' :
                        fs === 'Médio'                  ? 'bg-yellow-900/40 text-yellow-300' :
                        fs === 'Alto'                   ? 'bg-green-900/40 text-green-300' : 'bg-gray-700/40 text-white/40';
                      return (
                        <tr
                          key={s.sku}
                          onClick={() => setSelectedSku(s.sku)}
                          className={`border-b border-white/5 cursor-pointer transition hover:bg-violet-900/15 ${rowBg}`}
                          title="Clique para ver gráfico deste SKU"
                        >
                          <td className="py-2.5 px-3 text-xs font-mono text-violet-300/80 align-middle">{s.sku}</td>
                          <td className="py-2.5 px-3 text-sm text-white/90 truncate align-middle" style={{maxWidth:'220px'}}>{s.product_name}</td>
                          <td className="py-2.5 px-3 text-sm text-teal-400 font-medium text-right tabular-nums align-middle">
                            +{s.total_in ?? s.entries ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-red-400 font-medium text-right tabular-nums align-middle">
                            -{s.total_out ?? s.exits ?? 0}
                          </td>
                          <td className={`py-2.5 px-3 text-sm font-bold text-right tabular-nums align-middle ${noStock ? 'text-red-400' : 'text-white'}`}>
                            {stockVal}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums align-middle">
                            {s.days_remaining != null
                              ? <span className="text-sm text-white/70">{s.days_remaining}d</span>
                              : <span className="text-xs text-white/25">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${forecastCls}`}>
                              {fs || s.level || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={7} className="text-center text-sm text-white/35 py-10">Nenhum produto no estoque</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35 flex items-center gap-2">
                  <BarChart2 size={11} className="text-violet-400" />
                  {filteredStock.length} SKU(s) — clique numa linha para ver o gráfico · Cabeçalhos para ordenar · Previsão baseada na média dos últimos 60 dias
                </div>
              </div>
              )}
            </>
          )}

          {/* ── MOVIMENTAÇÕES ─────────────────────────────────────────────── */}
          {tab === 'movements' && (
            <>
              {/* Barra de busca + tipo + exportar */}
              <div className="flex gap-3 items-center flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar SKU, produto ou NF..."
                    className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm bg-gray-900 text-white outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                {isMobile ? (
                  <button
                    onClick={() => setMovFiltersOpen(true)}
                    className="relative flex items-center gap-1.5 px-3 py-2 text-xs text-white/60 bg-white/5 border border-white/12 rounded-lg flex-shrink-0"
                  >
                    <SlidersHorizontal size={13} />
                    Filtros
                    {(movTypeFilter || movDateFrom !== oneYearAgo || movDateTo !== today) && (
                      <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-violet-500" />
                    )}
                  </button>
                ) : (
                  <>
                    {/* Filtro tipo */}
                    <select
                      value={movTypeFilter}
                      onChange={e => setMovTypeFilter(e.target.value as '' | 'Entrada' | 'Saída')}
                      className="px-3 py-2 rounded-lg text-sm border border-white/12 bg-gray-900 text-white/80 outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="">Todos os tipos</option>
                      <option value="Entrada">Entrada</option>
                      <option value="Saída">Saída</option>
                    </select>
                    {sellerId && (
                      <button
                        onClick={() => { inventoryApi.exportMovementsCsv(sellerId, movDateFrom || undefined, movDateTo || undefined); toast.success('Export iniciado'); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border border-white/12 text-white/60 hover:text-white hover:bg-white/5 hover:border-white/20"
                      >
                        <Download size={14} />
                        Exportar CSV
                      </button>
                    )}
                  </>
                )}
                <span className="text-xs text-white/30 ml-auto">{filteredMovements.length} registros</span>
              </div>

              {/* Filtro de datas das movimentações (desktop; no mobile fica na folha "Filtros") */}
              {!isMobile && (
              <div className="flex gap-3 flex-wrap items-center bg-gray-900/60 border border-white/8 rounded-xl px-4 py-3">
                <CalendarDays size={14} className="text-violet-400 flex-shrink-0" />
                <span className="text-xs text-white/40">De</span>
                <input type="date" value={movDateFrom} onChange={e => setMovDateFrom(e.target.value)}
                  className="border border-white/12 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-white/80"
                  style={{ background: '#14122A', colorScheme: 'dark' }} />
                <span className="text-xs text-white/40">até</span>
                <input type="date" value={movDateTo} onChange={e => setMovDateTo(e.target.value)}
                  className="border border-white/12 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-white/80"
                  style={{ background: '#14122A', colorScheme: 'dark' }} />
              </div>
              )}

              {isMobile ? (
                <div className="space-y-2">
                  {filteredMovements.length > 0 ? filteredMovements.map((m: any, i: number) => {
                    const isIn = m.movement_type === 'Entrada';
                    return (
                      <div key={m.id ?? i} className="p-3 rounded-xl border border-white/8 bg-gray-900">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white/90 truncate">{m.product_name}</span>
                          <span className={`text-base font-bold tabular-nums flex-shrink-0 ${isIn ? 'text-teal-400' : 'text-red-400'}`}>
                            {isIn ? '+' : '-'}{m.quantity}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-white/30 mt-0.5">{m.sku}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isIn ? 'bg-teal-900/30 text-teal-300' : 'bg-red-900/30 text-red-300'}`}>
                            {m.movement_type}
                          </span>
                          <span className="text-[11px] text-white/35">
                            {m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                          </span>
                          {m.nf_number && (
                            <span className="text-[11px] font-mono text-white/25">NF {m.nf_number}</span>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-sm text-white/35 py-10">Nenhuma movimentação encontrada</p>
                  )}
                </div>
              ) : (
              <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/4 border-b border-white/8">
                      {([
                        { label: 'Data',    col: 'movement_date' },
                        { label: 'Data NF', col: 'nf_date' },
                        { label: 'SKU',     col: 'sku' },
                        { label: 'Produto', col: 'product_name' },
                        { label: 'Tipo',    col: 'movement_type' },
                        { label: 'Qtd',     col: 'quantity' },
                        { label: 'NF',      col: null },
                      ] as { label: string; col: string | null }[]).map(({ label, col }) => (
                        <th
                          key={label}
                          className={`text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3 ${col ? 'cursor-pointer hover:text-white/80 select-none' : ''}`}
                          onClick={() => {
                            if (!col) return;
                            setMovSort(s => s.col === col
                              ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                              : { col, dir: col === 'movement_date' ? 'desc' : 'asc' });
                          }}
                        >
                          <span className="flex items-center gap-1">
                            {label}
                            {col && movSort.col === col && (
                              <span className="text-violet-400">{movSort.dir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.length > 0 ? filteredMovements.map((m: any, i: number) => (
                      <tr key={m.id ?? i} className="border-b border-white/5 hover:bg-white/4">
                        <td className="py-2.5 px-3 text-xs text-white/50">
                          {m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-white/50">
                          {m.nf_date ? format(new Date(m.nf_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono text-violet-300/80">{m.sku}</td>
                        <td className="py-2.5 px-3 text-sm text-white/80 max-w-xs truncate">{m.product_name}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-xs font-semibold ${m.movement_type === 'Entrada' ? 'text-teal-400' : 'text-red-400'}`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-sm font-bold text-white">
                          {m.movement_type === 'Entrada' ? '+' : '-'}{m.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono text-white/40">{m.nf_number || '—'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="text-center text-sm text-white/35 py-10">Nenhuma movimentação encontrada</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">
                  {filteredMovements.length} movimentação(ões)
                </div>
              </div>
              )}
            </>
          )}

        </div>
      </main>

      {/* Abas inferiores (mobile) */}
      {isMobile && (
        <nav
          className="flex flex-shrink-0 border-t"
          style={{ background: '#100E22', borderColor: 'rgba(123,99,232,0.12)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); setSearch(''); }}
                className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px]"
                style={{ color: isActive ? '#9B87F0' : 'rgba(255,255,255,0.40)' }}
              >
                <Icon size={18} />
                {label}
              </button>
            );
          })}
        </nav>
      )}
      </div>

      {/* ── Modal de detalhe do SKU ─────────────────────────────────────────── */}
      {selectedSku && sellerId && (
        <SkuDetailModal
          sellerId={sellerId}
          sku={selectedSku}
          onClose={() => setSelectedSku(null)}
        />
      )}

      {/* Folha de filtros de movimentações (mobile) */}
      {isMobile && (
        <BottomSheet open={movFiltersOpen} onClose={() => setMovFiltersOpen(false)} title="Filtros">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Tipo</label>
              <select
                value={movTypeFilter}
                onChange={e => setMovTypeFilter(e.target.value as '' | 'Entrada' | 'Saída')}
                className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm bg-gray-900 text-white/80 outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Todos os tipos</option>
                <option value="Entrada">Entrada</option>
                <option value="Saída">Saída</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Período</label>
              <div className="flex items-center gap-2">
                <input type="date" value={movDateFrom} onChange={e => setMovDateFrom(e.target.value)}
                  className="flex-1 border border-white/12 rounded-lg px-3 py-2 text-sm bg-gray-900 text-white/80 outline-none focus:ring-2 focus:ring-violet-500" />
                <span className="text-white/25 text-xs">→</span>
                <input type="date" value={movDateTo} onChange={e => setMovDateTo(e.target.value)}
                  className="flex-1 border border-white/12 rounded-lg px-3 py-2 text-sm bg-gray-900 text-white/80 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {(movTypeFilter || movDateFrom !== oneYearAgo || movDateTo !== today) && (
                <button
                  onClick={() => { setMovTypeFilter(''); setMovDateFrom(oneYearAgo); setMovDateTo(today); }}
                  className="flex-1 py-2.5 text-sm text-white/60 border border-white/10 rounded-xl hover:bg-white/5 transition"
                >
                  Limpar
                </button>
              )}
              <button
                onClick={() => setMovFiltersOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-xl hover:bg-violet-500 transition"
              >
                Ver {filteredMovements.length} registro(s)
              </button>
            </div>
            {sellerId && (
              <button
                onClick={() => { inventoryApi.exportMovementsCsv(sellerId, movDateFrom || undefined, movDateTo || undefined); toast.success('Export iniciado'); setMovFiltersOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm rounded-xl border border-white/12 text-white/70 hover:text-white hover:bg-white/5 transition"
              >
                <Download size={14} />
                Exportar CSV
              </button>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
