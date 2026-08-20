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
import { useChartColors } from '../hooks/useChartColors';
import BottomSheet from '../components/BottomSheet';
import ThemeToggle from '../components/ThemeToggle';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'stock' | 'movements';
type StockSubTab = 'position' | 'chart';
type SortDir = 'asc' | 'desc' | null;
interface SortState { col: string; dir: SortDir }

// ─── Configurações ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:     { label: 'Separação do Produto', cls: 'bg-info-soft text-info' },
  validated:   { label: 'Separação do Produto', cls: 'bg-info-soft text-info' },
  separating:  { label: 'Separação do Produto', cls: 'bg-info-soft text-info' },
  scanning:    { label: 'Em Preparação',        cls: 'bg-violet-900/40 text-violet-300' },
  completed:   { label: 'Concluído',            cls: 'bg-ok-soft text-ok' },
  interrupted: { label: 'Interrompido',         cls: 'bg-warn-soft text-warn' },
  cancelled:   { label: 'Cancelado',            cls: 'bg-bad-soft text-bad' },
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
        hover:text-t2 transition whitespace-nowrap ${textMap[align]}
        ${active ? 'text-violet-300' : 'text-t3'}`}
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
  const chartColors = useChartColors();
  const { data, isLoading } = useQuery(
    ['sku-history-portal', sellerId, sku, days],
    () => inventoryApi.skuHistory(sellerId, sku, days).then(r => r.data),
    { keepPreviousData: true },
  );

  const periodSelect = (
    <select
      value={days}
      onChange={e => setDays(Number(e.target.value))}
      className="border border-line rounded-lg px-2 py-1.5 text-xs bg-surface-2 text-t1 outline-none focus:ring-2 focus:ring-violet-500"
    >
      <option value={30}>30 dias</option>
      <option value={60}>60 dias</option>
      <option value={90}>90 dias</option>
      <option value={180}>180 dias</option>
    </select>
  );

  const body = isLoading ? (
    <div className="flex items-center justify-center h-48 text-t4 text-sm">Carregando...</div>
  ) : data ? (
          <div className={isMobile ? 'space-y-5' : 'p-5 space-y-5'}>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Saldo Atual',         value: data.current_stock,       color: 'text-t1',      unit: '' },
                { label: 'Média Diária (60d)',   value: data.avg_daily_sales_60d, color: 'text-info',   unit: '/dia' },
                { label: 'Total Saídas Período', value: data.total_sales_period,  color: 'text-bad',    unit: '' },
                {
                  label: 'Projeção Duração',
                  value: data.days_remaining != null ? data.days_remaining : '∞',
                  color: data.days_remaining != null && data.days_remaining < 30
                    ? 'text-bad' : 'text-violet-400',
                  unit: data.days_remaining != null ? ' dias' : '',
                },
              ].map(k => (
                <div key={k.label} className="bg-surface-2 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-t4 uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}{k.unit}</p>
                </div>
              ))}
            </div>

            {/* Gráfico barras */}
            {data.chart_data && data.chart_data.length > 0 ? (
              <div>
                <p className="text-xs text-t3 font-medium mb-3">Saídas e Entradas por Dia</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.chart_data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: chartColors.axisText }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: chartColors.axisText }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, color: chartColors.tooltipText }} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: chartColors.legendText }} />
                    <Bar dataKey="saidas"   name="Saídas"   fill={chartColors.bad} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="entradas" name="Entradas" fill={chartColors.brand} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-sm text-t4 py-8">Sem movimentações no período</p>
            )}

            {/* Alerta ruptura */}
            {data.days_remaining != null && data.days_remaining < 15 && (
              <div className="bg-bad-soft border border-bad/20 rounded-xl p-3 text-sm text-bad">
                ⚠️ Atenção: com a média atual, o estoque se esgota em <strong>{data.days_remaining} dias</strong>. Considere reabastecer.
              </div>
            )}
          </div>
  ) : (
    <p className="text-center text-sm text-t4 py-10">Nenhum dado encontrado para este SKU.</p>
  );

  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title={sku}>
        <div className="flex items-center justify-between -mt-1 mb-4">
          <p className="text-xs text-t4">{data?.product_name}</p>
          {periodSelect}
        </div>
        {body}
      </BottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-line-soft sticky top-0 bg-surface z-10">
          <div>
            <h2 className="text-base font-semibold text-t1 font-mono">{sku}</h2>
            <p className="text-xs text-t4 mt-0.5">{data?.product_name}</p>
          </div>
          <div className="flex items-center gap-3">
            {periodSelect}
            <button onClick={onClose} className="text-t4 hover:text-t3">
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
    <div className="flex h-screen overflow-hidden bg-app">

      {/* ══ SIDEBAR (desktop) ════════════════════════════════════════════════ */}
      {!isMobile && (
      <aside
        className="w-56 flex flex-col flex-shrink-0 border-r bg-sidebar border-brand-line"
      >
        {/* Logo + seller */}
        <div className="p-4 border-b border-line-soft">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 flex-shrink-0 bg-violet-600 rounded-lg flex items-center justify-center">
              <span className="text-t1 font-black text-xs">K</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-t1 leading-tight">Kiwkiw WMS</div>
              <div className="text-[9px] font-medium text-t4">
                Portal do Seller
              </div>
            </div>
            <ThemeToggle />
          </div>
          {/* Seller em destaque */}
          <div className="rounded-xl px-3 py-2.5" style={{
            background: 'linear-gradient(135deg, rgba(123,99,232,0.25) 0%, rgba(61,217,164,0.12) 100%)',
            border: '1px solid rgba(123,99,232,0.30)',
          }}>
            <p className="text-[9px] uppercase tracking-widest font-bold mb-0.5 text-t4">Seller</p>
            <p className="text-sm font-bold text-t1 leading-tight truncate">{sellerName}</p>
          </div>
        </div>

        {/* KPIs compactos */}
        <div className="px-3 py-3 border-b border-line-soft space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2 text-t5">Hoje</p>
          {[
            { label: 'Pedidos',       value: dashboard?.total_orders ?? 0,  color: 'text-t2' },
            { label: 'Concluídos',    value: ordersCompleted,                color: 'text-ok' },
            { label: 'Interrompidos', value: ordersInterrupted,              color: 'text-warn' },
            { label: 'Pendentes',     value: ordersPending,                  color: 'text-violet-400' },
            { label: 'Estoque Baixo', value: (stock as any[]).filter((s: any) => s.level === 'BAIXO').length, color: 'text-bad' },
          ].map(k => (
            <div key={k.label} className="flex items-center justify-between">
              <span className="text-[11px] text-t4">{k.label}</span>
              <span className={`text-sm font-bold ${k.color}`}>{k.value}</span>
            </div>
          ))}
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-t4 mb-1">
              <span>Progresso</span>
              <span>{completionPct.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-surface-2 rounded-full h-1.5">
              <div className="bg-violet-500 h-1.5 rounded-full transition-all"
                style={{ width: `${completionPct}%` }} />
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          <p className="px-2 mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-t5">Consultas</p>
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); setSearch(''); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all mb-0.5 text-left
                  ${isActive ? 'text-t1 font-medium' : 'text-t3 hover:text-t2 hover:bg-surface-2'}`}
                style={isActive ? {
                  background: 'rgb(var(--brand-soft))',
                  border: '1px solid rgb(var(--brand-line))',
                  color: 'rgb(var(--t1))',
                } : {}}
              >
                <Icon size={14} style={isActive ? { color: 'rgb(var(--brand))' } : {}} />
                {label}
              </button>
            );
          })}

        </nav>

        {/* User / Logout */}
        <div className="p-3 border-t border-line-soft">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-violet-300">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-t2 truncate">{user.name}</p>
              <p className="text-[10px] text-t4 truncate">
                {format(new Date(), 'dd/MM/yyyy', { locale: ptBR })}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowPwdModal(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-t4
              hover:text-violet-400 hover:bg-violet-900/15 transition mb-1"
          >
            <KeyRound size={12} /> Alterar senha
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-t4
              hover:text-bad hover:bg-bad-soft transition"
          >
            <LogOut size={12} /> Sair
          </button>
        </div>
      </aside>
      )}

      {/* Modal alterar senha */}
      {showPwdModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-xs p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-t1 text-sm flex items-center gap-2"><KeyRound size={15} className="text-violet-400" /> Alterar Senha</h3>
              <button onClick={() => setShowPwdModal(false)} className="text-t4 hover:text-t3"><X size={16} /></button>
            </div>
            <form onSubmit={handlePwdSave} className="space-y-3">
              <div>
                <label className="block text-xs text-t3 mb-1">Senha atual *</label>
                <input type="password" value={pwdForm.current} onChange={e => setPwdForm(p => ({ ...p, current: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-t3 mb-1">Nova senha *</label>
                <input type="password" value={pwdForm.next} onChange={e => setPwdForm(p => ({ ...p, next: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-t3 mb-1">Confirmar *</label>
                <input type="password" value={pwdForm.confirm} onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowPwdModal(false)}
                  className="flex-1 py-2 text-xs text-t3 border border-line rounded-lg hover:bg-surface-2">Cancelar</button>
                <button type="submit" disabled={pwdSaving}
                  className="flex-1 py-2 text-xs text-t1 bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50">
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
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-line-soft flex-shrink-0">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] uppercase tracking-widest font-bold text-t4">Seller</p>
              <p className="text-sm font-bold text-t1 truncate">{sellerName}</p>
            </div>
            <ThemeToggle />
            <button
              onClick={() => setShowPwdModal(true)}
              aria-label="Alterar senha"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-t4 hover:text-violet-400 hover:bg-violet-900/15 transition"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={handleLogout}
              aria-label="Sair"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-t4 hover:text-bad hover:bg-bad-soft transition"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}

      <main className="flex-1 overflow-y-auto">
        <div className={isMobile ? 'p-4 space-y-4' : 'p-6 space-y-5'}>

          {/* Aviso de estoque baixo (mobile) — substitui os KPIs fixos da sidebar */}
          {isMobile && lowStockCount > 0 && (
            <div className="flex items-center gap-2.5 rounded-xl border border-bad/25 px-3.5 py-2.5" style={{ background: 'rgba(226,75,74,0.08)' }}>
              <span className="text-base font-bold text-bad">{lowStockCount}</span>
              <span className="text-xs text-bad/85 flex-1">SKU{lowStockCount > 1 ? 's' : ''} em nível baixo de estoque</span>
            </div>
          )}

          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-t1">
              {navItems.find(n => n.id === tab)?.label}
            </h1>
            <p className="text-sm text-t4 mt-0.5">
              {tab === 'orders'    ? 'Acompanhe o status dos seus pedidos do dia' : ''}
              {tab === 'stock'     ? 'Posição atual — clique em uma linha para ver o gráfico do SKU' : ''}
              {tab === 'movements' ? 'Histórico de entradas e saídas de estoque' : ''}
            </p>
          </div>

          {/* ── PEDIDOS ──────────────────────────────────────────────────── */}
          {tab === 'orders' && (
            <>
              {/* Filtros: período + busca + status */}
              <div className="flex gap-3 flex-wrap items-center bg-surface/60 border border-line-soft rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className="text-violet-400 flex-shrink-0" />
                  <span className="text-xs text-t4">De</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-t2 bg-surface-2"
                  />
                  <span className="text-xs text-t4">até</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-t2 bg-surface-2"
                  />
                </div>

                <div className="relative flex-1 min-w-[160px]">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t4" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar NF ou cliente..."
                    className="w-full pl-7 pr-3 py-1.5 border border-line rounded-lg text-sm bg-surface text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
                </div>

                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="border border-line rounded-lg px-3 py-1.5 text-sm bg-surface text-t1 outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="">Todos os status</option>
                  {Array.from(new Set(Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'cancelled').map(([, v]) => v.label)))
                    .map(label => <option key={label} value={label}>{label}</option>)}
                </select>
              </div>

              <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-2 border-b border-line-soft">
                      {['NF', 'Cliente Final', 'Transportadora', 'Data Upload', 'Status'].map(h => (
                        <th key={h} className="text-left text-[11px] font-semibold text-t3 uppercase tracking-wide py-2.5 px-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length > 0 ? filteredOrders.map((o: any) => {
                      const st = STATUS_CONFIG[o.status] ?? { label: o.status, cls: 'bg-line-strong text-t3' };
                      return (
                        <tr key={o.id} className="border-b border-line-soft hover:bg-surface-2">
                          <td className="py-2.5 px-3 text-sm font-mono text-t2">{o.nf_number}</td>
                          <td className="py-2.5 px-3 text-sm text-t1">{o.customer_name}</td>
                          <td className="py-2.5 px-3 text-sm text-t3">{o.carrier || '—'}</td>
                          <td className="py-2.5 px-3 text-sm text-t3">
                            {o.imported_at ? format(new Date(o.imported_at), 'dd/MM/yy') : o.order_date ? format(new Date(o.order_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={5} className="text-center text-sm text-t4 py-10">Nenhum pedido encontrado</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-line-soft text-xs text-t4">
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
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t4" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar SKU ou produto..."
                  className="w-full pl-7 pr-3 py-2 border border-line rounded-lg text-sm bg-surface text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
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
                      fs === 'Sem Produto'            ? 'bg-bad-soft text-bad font-bold' :
                      fs === 'Sem Dados Suficientes'  ? 'bg-line-strong/50 text-t4' :
                      fs === 'Baixo'                  ? 'bg-bad-soft text-bad font-semibold' :
                      fs === 'Médio'                  ? 'bg-warn-soft text-warn' :
                      fs === 'Alto'                   ? 'bg-ok-soft text-ok' : 'bg-line-strong/40 text-t4';
                    return (
                      <div
                        key={s.sku}
                        onClick={() => setSelectedSku(s.sku)}
                        className="flex gap-2.5 p-3 rounded-xl border border-line-soft bg-surface active:bg-surface-2 cursor-pointer"
                      >
                        <div className="w-[3px] rounded-full flex-shrink-0" style={{ background: stripe }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-t1 truncate">{s.product_name}</span>
                            <span className={`text-base font-bold tabular-nums flex-shrink-0 ${noStock ? 'text-bad' : 'text-t1'}`}>{stockVal}</span>
                          </div>
                          <p className="text-[11px] font-mono text-t4 mt-0.5">{s.sku}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className="text-[11px] text-t4">entradas <b className="text-ok font-medium">+{s.total_in ?? s.entries ?? 0}</b></span>
                            <span className="text-[11px] text-t4">saídas <b className="text-bad font-medium">-{s.total_out ?? s.exits ?? 0}</b></span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${forecastCls}`}>{fs || s.level || '—'}</span>
                          </div>
                          {s.days_remaining != null && (
                            <p className="text-[11px] text-t3 mt-1">previsão: {s.days_remaining} dia{s.days_remaining === 1 ? '' : 's'}</p>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-sm text-t4 py-10">Nenhum produto no estoque</p>
                  )}
                  {filteredStock.length > 0 && (
                    <p className="text-xs text-t4 text-center pt-1">{filteredStock.length} SKU(s) — toque para ver o gráfico</p>
                  )}
                </div>
              ) : (
              <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="bg-surface-2 border-b border-line-soft">
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
                      const rowBg    = noStock ? 'bg-bad-soft' : isLow ? 'bg-warn-soft' : '';
                      const levelCls =
                        s.level === 'ALTO'  ? 'bg-violet-900/40 text-violet-300' :
                        s.level === 'MÉDIO' ? 'bg-warn-soft text-warn' :
                                              'bg-bad-soft text-bad';
                      const forecastCls =
                        fs === 'Sem Produto'            ? 'bg-bad-soft text-bad font-bold' :
                        fs === 'Sem Dados Suficientes'  ? 'bg-line-strong/50 text-t4' :
                        fs === 'Baixo'                  ? 'bg-bad-soft text-bad font-semibold' :
                        fs === 'Médio'                  ? 'bg-warn-soft text-warn' :
                        fs === 'Alto'                   ? 'bg-ok-soft text-ok' : 'bg-line-strong/40 text-t4';
                      return (
                        <tr
                          key={s.sku}
                          onClick={() => setSelectedSku(s.sku)}
                          className={`border-b border-line-soft cursor-pointer transition hover:bg-violet-900/15 ${rowBg}`}
                          title="Clique para ver gráfico deste SKU"
                        >
                          <td className="py-2.5 px-3 text-xs font-mono text-violet-300/80 align-middle">{s.sku}</td>
                          <td className="py-2.5 px-3 text-sm text-t1 truncate align-middle" style={{maxWidth:'220px'}}>{s.product_name}</td>
                          <td className="py-2.5 px-3 text-sm text-ok font-medium text-right tabular-nums align-middle">
                            +{s.total_in ?? s.entries ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-bad font-medium text-right tabular-nums align-middle">
                            -{s.total_out ?? s.exits ?? 0}
                          </td>
                          <td className={`py-2.5 px-3 text-sm font-bold text-right tabular-nums align-middle ${noStock ? 'text-bad' : 'text-t1'}`}>
                            {stockVal}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums align-middle">
                            {s.days_remaining != null
                              ? <span className="text-sm text-t2">{s.days_remaining}d</span>
                              : <span className="text-xs text-t5">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${forecastCls}`}>
                              {fs || s.level || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={7} className="text-center text-sm text-t4 py-10">Nenhum produto no estoque</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-line-soft text-xs text-t4 flex items-center gap-2">
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
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t4" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar SKU, produto ou NF..."
                    className="w-full pl-7 pr-3 py-2 border border-line rounded-lg text-sm bg-surface text-t1 outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                {isMobile ? (
                  <button
                    onClick={() => setMovFiltersOpen(true)}
                    className="relative flex items-center gap-1.5 px-3 py-2 text-xs text-t3 bg-surface-2 border border-line rounded-lg flex-shrink-0"
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
                      className="px-3 py-2 rounded-lg text-sm border border-line bg-surface text-t2 outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="">Todos os tipos</option>
                      <option value="Entrada">Entrada</option>
                      <option value="Saída">Saída</option>
                    </select>
                    {sellerId && (
                      <button
                        onClick={() => { inventoryApi.exportMovementsCsv(sellerId, movDateFrom || undefined, movDateTo || undefined); toast.success('Export iniciado'); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border border-line text-t3 hover:text-t1 hover:bg-surface-2 hover:border-line-strong"
                      >
                        <Download size={14} />
                        Exportar CSV
                      </button>
                    )}
                  </>
                )}
                <span className="text-xs text-t4 ml-auto">{filteredMovements.length} registros</span>
              </div>

              {/* Filtro de datas das movimentações (desktop; no mobile fica na folha "Filtros") */}
              {!isMobile && (
              <div className="flex gap-3 flex-wrap items-center bg-surface/60 border border-line-soft rounded-xl px-4 py-3">
                <CalendarDays size={14} className="text-violet-400 flex-shrink-0" />
                <span className="text-xs text-t4">De</span>
                <input type="date" value={movDateFrom} onChange={e => setMovDateFrom(e.target.value)}
                  className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-t2 bg-surface-2" />
                <span className="text-xs text-t4">até</span>
                <input type="date" value={movDateTo} onChange={e => setMovDateTo(e.target.value)}
                  className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-t2 bg-surface-2" />
              </div>
              )}

              {isMobile ? (
                <div className="space-y-2">
                  {filteredMovements.length > 0 ? filteredMovements.map((m: any, i: number) => {
                    const isIn = m.movement_type === 'Entrada';
                    return (
                      <div key={m.id ?? i} className="p-3 rounded-xl border border-line-soft bg-surface">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-t1 truncate">{m.product_name}</span>
                          <span className={`text-base font-bold tabular-nums flex-shrink-0 ${isIn ? 'text-ok' : 'text-bad'}`}>
                            {isIn ? '+' : '-'}{m.quantity}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-t4 mt-0.5">{m.sku}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isIn ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                            {m.movement_type}
                          </span>
                          <span className="text-[11px] text-t4">
                            {m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                          </span>
                          {m.nf_number && (
                            <span className="text-[11px] font-mono text-t5">NF {m.nf_number}</span>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="text-center text-sm text-t4 py-10">Nenhuma movimentação encontrada</p>
                  )}
                </div>
              ) : (
              <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-2 border-b border-line-soft">
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
                          className={`text-left text-[11px] font-semibold text-t3 uppercase tracking-wide py-2.5 px-3 ${col ? 'cursor-pointer hover:text-t2 select-none' : ''}`}
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
                      <tr key={m.id ?? i} className="border-b border-line-soft hover:bg-surface-2">
                        <td className="py-2.5 px-3 text-xs text-t3">
                          {m.movement_date ? format(new Date(m.movement_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-t3">
                          {m.nf_date ? format(new Date(m.nf_date + 'T00:00:00'), 'dd/MM/yy') : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono text-violet-300/80">{m.sku}</td>
                        <td className="py-2.5 px-3 text-sm text-t2 max-w-xs truncate">{m.product_name}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-xs font-semibold ${m.movement_type === 'Entrada' ? 'text-ok' : 'text-bad'}`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-sm font-bold text-t1">
                          {m.movement_type === 'Entrada' ? '+' : '-'}{m.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono text-t4">{m.nf_number || '—'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="text-center text-sm text-t4 py-10">Nenhuma movimentação encontrada</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-line-soft text-xs text-t4">
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
          className="flex flex-shrink-0 border-t bg-sidebar border-brand-line"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); setSearch(''); }}
                className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px]"
                style={{ color: isActive ? 'rgb(var(--brand))' : 'rgb(var(--t4))' }}
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
              <label className="block text-xs text-t4 mb-1.5">Tipo</label>
              <select
                value={movTypeFilter}
                onChange={e => setMovTypeFilter(e.target.value as '' | 'Entrada' | 'Saída')}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-t2 outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Todos os tipos</option>
                <option value="Entrada">Entrada</option>
                <option value="Saída">Saída</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-t4 mb-1.5">Período</label>
              <div className="flex items-center gap-2">
                <input type="date" value={movDateFrom} onChange={e => setMovDateFrom(e.target.value)}
                  className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-surface text-t2 outline-none focus:ring-2 focus:ring-violet-500" />
                <span className="text-t5 text-xs">→</span>
                <input type="date" value={movDateTo} onChange={e => setMovDateTo(e.target.value)}
                  className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-surface text-t2 outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {(movTypeFilter || movDateFrom !== oneYearAgo || movDateTo !== today) && (
                <button
                  onClick={() => { setMovTypeFilter(''); setMovDateFrom(oneYearAgo); setMovDateTo(today); }}
                  className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition"
                >
                  Limpar
                </button>
              )}
              <button
                onClick={() => setMovFiltersOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-t1 bg-violet-600 rounded-xl hover:bg-violet-500 transition"
              >
                Ver {filteredMovements.length} registro(s)
              </button>
            </div>
            {sellerId && (
              <button
                onClick={() => { inventoryApi.exportMovementsCsv(sellerId, movDateFrom || undefined, movDateTo || undefined); toast.success('Export iniciado'); setMovFiltersOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm rounded-xl border border-line text-t2 hover:text-t1 hover:bg-surface-2 transition"
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
