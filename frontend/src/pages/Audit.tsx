/**
 * WMS Kiwkiw - Trilha de Auditoria
 *
 * Duas abas:
 *  1. "Bipagens" — ScanningLog: cada scan com horário, operador, resultado
 *  2. "Ações do Sistema" — AuditLog: TODAS as ações (cadastros, uploads,
 *     mudanças de estoque, interrupções, configurações, etc.)
 */

import { useState } from 'react';
import { useQuery } from 'react-query';
import {
  Shield, Search, CheckCircle, XCircle, Activity,
  Package, Users, Box, Upload, AlertTriangle,
} from 'lucide-react';
import { scanningApi, cadastrosApi } from '../api';
import { format } from 'date-fns';
import { todayBrasiliaStr } from '../timezone';

// ── Mapa de ícone/cor por tipo de entidade (aba Sistema) ─────────────────────
const ENTITY_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  Product:       { icon: <Package size={12} />,      color: 'text-violet-400',  label: 'Produto' },
  Kit:           { icon: <Box size={12} />,           color: 'text-amber-400',   label: 'Kit' },
  Seller:        { icon: <Users size={12} />,         color: 'text-blue-400',    label: 'Seller' },
  User:          { icon: <Users size={12} />,         color: 'text-teal-400',    label: 'Usuário' },
  StockMovement: { icon: <Activity size={12} />,      color: 'text-emerald-400', label: 'Estoque' },
  Order:         { icon: <AlertTriangle size={12} />, color: 'text-red-400',     label: 'Pedido' },
  PickingSession:{ icon: <Upload size={12} />,        color: 'text-orange-400',  label: 'Sessão' },
};

const ACTION_COLOR: Record<string, string> = {
  CREATE:          'bg-emerald-900/40 text-emerald-300 border-emerald-500/20',
  UPDATE:          'bg-blue-900/40 text-blue-300 border-blue-500/20',
  DELETE:          'bg-red-900/40 text-red-300 border-red-500/20',
  MANUAL_MOVEMENT: 'bg-violet-900/40 text-violet-300 border-violet-500/20',
  EDIT_MOVEMENT:   'bg-amber-900/40 text-amber-300 border-amber-500/20',
  BULK_UPLOAD:     'bg-teal-900/40 text-teal-300 border-teal-500/20',
  INTERRUPT:       'bg-red-900/40 text-red-300 border-red-500/20',
  CONFIG_UPDATE:   'bg-orange-900/40 text-orange-300 border-orange-500/20',
};

// ── Subcomponente: aba Bipagens ───────────────────────────────────────────────
function ScanAuditTab() {
  const [dateFrom, setDateFrom] = useState(todayBrasiliaStr());
  const [dateTo, setDateTo]     = useState(todayBrasiliaStr());
  const [operatorId, setOperatorId] = useState('');
  const [search, setSearch] = useState('');

  const isAdmin = (() => { try { return JSON.parse(localStorage.getItem('wms_user') || '{}').role === 'admin'; } catch { return false; } })();

  const { data: logs = [], isLoading } = useQuery(
    ['audit', dateFrom, dateTo, operatorId],
    () => scanningApi.auditLog({ date_from: dateFrom, date_to: dateTo, operator_id: operatorId || undefined }).then(r => r.data),
    { keepPreviousData: true }
  );

  const { data: users = [] } = useQuery('users', () => cadastrosApi.users().then(r => r.data), { enabled: isAdmin });

  const { data: productivity = [] } = useQuery(
    ['productivity', dateFrom, dateTo],
    () => scanningApi.productivity({ date_from: dateFrom, date_to: dateTo }).then(r => r.data)
  );

  const filtered = (logs as any[]).filter((l: any) =>
    !search ||
    l.sku?.toLowerCase().includes(search.toLowerCase()) ||
    l.barcode?.includes(search) ||
    l.order_nf?.includes(search) ||
    l.operator?.toLowerCase().includes(search.toLowerCase()) ||
    l.operator_name?.toLowerCase().includes(search.toLowerCase())
  );

  const successCount = filtered.filter((l: any) => !l.is_error && !l.is_interrupted).length;
  const errorCount   = filtered.filter((l: any) => l.is_error).length;

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-white/50 mb-1">De</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Até</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Operador</label>
          <select value={operatorId} onChange={e => setOperatorId(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todos</option>
            {(users as any[]).filter((u: any) => u.role === 'operator').map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-white/50 mb-1">Buscar</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="SKU, NF, operador..."
              className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
              style={{ background: '#14122A' }} />
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex items-center gap-3">
          <Shield size={20} className="text-white/50" />
          <div><p className="text-xs text-white/50">Total Registros</p><p className="text-2xl font-bold text-white/90">{filtered.length}</p></div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex items-center gap-3">
          <CheckCircle size={20} className="text-violet-400" />
          <div><p className="text-xs text-white/50">Bipagens OK</p><p className="text-2xl font-bold text-violet-400">{successCount}</p></div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex items-center gap-3">
          <XCircle size={20} className="text-red-400" />
          <div><p className="text-xs text-white/50">Erros</p><p className="text-2xl font-bold text-red-500">{errorCount}</p></div>
        </div>
      </div>

      {/* Produtividade por operador */}
      {(productivity as any[]).length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-white/8 p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-4">Produtividade por Operador</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-white/4 border-b border-white/8">
                  {['Operador', 'Total Bipagens', 'Total Itens'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2 px-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(productivity as any[]).map((p: any, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/4">
                    <td className="py-2.5 px-3 text-sm font-medium text-white/90">{p.operator}</td>
                    <td className="py-2.5 px-3 text-sm text-white/60 text-right">{p.total_scans}</td>
                    <td className="py-2.5 px-3 text-sm text-violet-400 font-medium text-right">{p.total_items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log detalhado */}
      <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
        <div className="p-4 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Log Detalhado de Bipagens</h2>
          <span className="text-xs text-white/35">{filtered.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-white/4 border-b border-white/8">
                {['Horário', 'Operador', 'Cliente', 'NF', 'SKU', 'Código Bipado', 'Qtd', 'Status', 'Mensagem'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-10 text-sm text-white/35">Carregando...</td></tr>
              ) : filtered.length > 0 ? filtered.map((l: any, i: number) => (
                <tr key={i} className={`border-b border-white/5 hover:bg-white/4 ${l.is_error ? 'bg-red-900/20' : l.is_interrupted ? 'bg-amber-900/15' : ''}`}>
                  <td className="py-2 px-3 text-xs font-mono text-white/50 whitespace-nowrap">{l.timestamp}</td>
                  <td className="py-2 px-3 text-sm text-white/80">{l.operator || l.operator_name}</td>
                  <td className="py-2 px-3 text-xs text-white/60">{l.seller_name || '—'}</td>
                  <td className="py-2 px-3 text-xs font-mono text-white/50">{l.order_nf}</td>
                  <td className="py-2 px-3 text-xs font-mono text-white/60">{l.sku || '—'}</td>
                  <td className="py-2 px-3 text-xs font-mono text-white/50">{l.barcode || l.barcode_scanned}</td>
                  <td className="py-2 px-3 text-sm text-white/60 text-right">{l.quantity ?? 1}</td>
                  <td className="py-2 px-3">
                    {l.is_error ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500"><XCircle size={11} /> Erro</span>
                    ) : l.is_interrupted ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400">⚠ Interrompido</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-violet-400"><CheckCircle size={11} /> OK</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-white/35 max-w-[200px] truncate">{l.error_message || l.message || '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="text-center py-10">
                  <Shield size={28} className="text-white/25 mx-auto mb-2" />
                  <p className="text-sm text-white/35">Nenhum registro encontrado para os filtros selecionados</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Subcomponente: aba Pedidos Interrompidos (admin only) ────────────────────
function InterruptedOrdersTab() {
  const [dateFrom, setDateFrom] = useState(todayBrasiliaStr());
  const [dateTo, setDateTo]     = useState(todayBrasiliaStr());
  const [unitId, setUnitId]     = useState('');
  const [sellerId, setSellerId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [search, setSearch] = useState('');

  const { data: logs = [], isLoading } = useQuery(
    ['interrupted-orders', dateFrom, dateTo, unitId, sellerId, operatorId],
    () => scanningApi.interruptedOrders({
      date_from: dateFrom,
      date_to: dateTo,
      unit_id: unitId || undefined,
      seller_id: sellerId || undefined,
      operator_id: operatorId || undefined,
    }).then(r => r.data),
    { keepPreviousData: true }
  );

  const { data: units = [] } = useQuery('units-audit', () => cadastrosApi.units().then(r => r.data));
  const { data: sellers = [] } = useQuery(['sellers', 'all'], () => cadastrosApi.sellers(false).then(r => r.data));
  const { data: users = [] } = useQuery('users-audit', () => cadastrosApi.users().then(r => r.data));

  const filtered = (logs as any[]).filter((l: any) =>
    !search ||
    l.order_nf?.includes(search) ||
    l.order_customer?.toLowerCase().includes(search.toLowerCase()) ||
    l.seller_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.operator?.toLowerCase().includes(search.toLowerCase()) ||
    l.reason?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-white/50 mb-1">De</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Até</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Unidade</label>
          <select value={unitId} onChange={e => setUnitId(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todas</option>
            {(units as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Seller</label>
          <select value={sellerId} onChange={e => setSellerId(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todos</option>
            {(sellers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Operador</label>
          <select value={operatorId} onChange={e => setOperatorId(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todos</option>
            {(users as any[]).filter((u: any) => u.role === 'operator').map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-white/50 mb-1">Buscar</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="NF, cliente, seller, operador, motivo..."
              className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
              style={{ background: '#14122A' }} />
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex items-center gap-3 w-fit">
        <AlertTriangle size={20} className="text-amber-400" />
        <div><p className="text-xs text-white/50">Total Interrompidos</p><p className="text-2xl font-bold text-amber-400">{filtered.length}</p></div>
      </div>

      {/* Log */}
      <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
        <div className="p-4 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Pedidos Interrompidos</h2>
          <span className="text-xs text-white/35">{filtered.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-white/4 border-b border-white/8">
                {['Horário', 'NF', 'Cliente', 'Seller', 'Unidade', 'Operador', 'Motivo'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-10 text-sm text-white/35">Carregando...</td></tr>
              ) : filtered.length > 0 ? filtered.map((l: any, i: number) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/4 bg-amber-900/10">
                  <td className="py-2 px-3 text-xs font-mono text-white/50 whitespace-nowrap">{l.timestamp}</td>
                  <td className="py-2 px-3 text-xs font-mono text-white/50">{l.order_nf}</td>
                  <td className="py-2 px-3 text-sm text-white/80">{l.order_customer || '—'}</td>
                  <td className="py-2 px-3 text-xs text-white/60">{l.seller_name || '—'}</td>
                  <td className="py-2 px-3 text-xs text-white/60">{l.unit_name || '—'}</td>
                  <td className="py-2 px-3 text-sm text-white/80">{l.operator || '—'}</td>
                  <td className="py-2 px-3 text-xs text-white/50 max-w-xs truncate" title={l.reason}>{l.reason || '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="text-center py-10">
                  <AlertTriangle size={28} className="text-white/25 mx-auto mb-2" />
                  <p className="text-sm text-white/35">Nenhum pedido interrompido para os filtros selecionados</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Subcomponente: aba Ações do Sistema ──────────────────────────────────────
function SystemAuditTab() {
  const [dateFrom, setDateFrom] = useState(todayBrasiliaStr());
  const [dateTo, setDateTo]     = useState(todayBrasiliaStr());
  const [entityType, setEntityType] = useState('');
  const [action, setAction]     = useState('');
  const [userId, setUserId]     = useState('');
  const [search, setSearch]     = useState('');

  const { data: logs = [], isLoading } = useQuery(
    ['system-audit', dateFrom, dateTo, entityType, action, userId],
    () => scanningApi.systemAuditLog({
      date_from: dateFrom,
      date_to: dateTo,
      entity_type: entityType || undefined,
      action: action || undefined,
      user_id: userId || undefined,
    }).then(r => r.data),
    { keepPreviousData: true }
  );

  const { data: users = [] } = useQuery('users-audit', () => cadastrosApi.users().then(r => r.data));

  const filtered = (logs as any[]).filter((l: any) =>
    !search ||
    l.detail?.toLowerCase().includes(search.toLowerCase()) ||
    l.entity_type?.toLowerCase().includes(search.toLowerCase()) ||
    l.action?.toLowerCase().includes(search.toLowerCase()) ||
    l.user?.toLowerCase().includes(search.toLowerCase())
  );

  const ENTITY_TYPES = ['Product', 'Kit', 'Seller', 'User', 'StockMovement', 'Order', 'PickingSession'];
  const ACTIONS      = ['CREATE', 'UPDATE', 'DELETE', 'MANUAL_MOVEMENT', 'EDIT_MOVEMENT', 'BULK_UPLOAD', 'INTERRUPT', 'CONFIG_UPDATE'];

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-gray-900 rounded-xl border border-white/8 p-4 flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-white/50 mb-1">De</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Até</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A', colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Entidade</label>
          <select value={entityType} onChange={e => setEntityType(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todas</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{ENTITY_CONFIG[t]?.label ?? t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Ação</label>
          <select value={action} onChange={e => setAction(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todas</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Usuário</label>
          <select value={userId} onChange={e => setUserId(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
            style={{ background: '#14122A' }}>
            <option value="">Todos</option>
            {(users as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-white/50 mb-1">Buscar</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Detalhe, entidade, usuário..."
              className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white"
              style={{ background: '#14122A' }} />
          </div>
        </div>
      </div>

      {/* Sumário */}
      <div className="grid grid-cols-4 gap-4">
        {ENTITY_TYPES.slice(0, 4).map(et => {
          const count = filtered.filter((l: any) => l.entity_type === et).length;
          const cfg = ENTITY_CONFIG[et];
          return (
            <div key={et} className="bg-gray-900 rounded-xl border border-white/8 p-3 flex items-center gap-3">
              <span className={cfg?.color ?? 'text-white/40'}>{cfg?.icon}</span>
              <div>
                <p className="text-[10px] text-white/40 uppercase">{cfg?.label ?? et}</p>
                <p className={`text-xl font-bold ${cfg?.color ?? 'text-white'}`}>{count}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Log */}
      <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
        <div className="p-4 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Log de Ações do Sistema</h2>
          <span className="text-xs text-white/35">{filtered.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-white/4 border-b border-white/8">
                {['Horário', 'Usuário', 'Entidade', 'Ação', 'Detalhe'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-10 text-sm text-white/35">Carregando...</td></tr>
              ) : filtered.length > 0 ? filtered.map((l: any, i: number) => {
                const cfg = ENTITY_CONFIG[l.entity_type] ?? {};
                const actionCls = ACTION_COLOR[l.action] ?? 'bg-white/10 text-white/50 border-white/10';
                return (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/4">
                    <td className="py-2 px-3 text-xs font-mono text-white/50 whitespace-nowrap">{l.timestamp}</td>
                    <td className="py-2 px-3 text-sm text-white/80">{l.user ?? '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${(cfg as any).color ?? 'text-white/50'}`}>
                        {(cfg as any).icon}
                        {(cfg as any).label ?? l.entity_type}
                        {l.entity_id && <span className="text-white/25 font-mono"> #{l.entity_id}</span>}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${actionCls}`}>
                        {l.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-white/50 max-w-xs truncate" title={l.detail}>{l.detail || '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5} className="text-center py-10">
                  <Activity size={28} className="text-white/25 mx-auto mb-2" />
                  <p className="text-sm text-white/35">Nenhuma ação registrada para os filtros selecionados</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Página principal ──────────────────────────────────────────────────────────
export default function AuditPage() {
  const [activeTab, setActiveTab] = useState<'scans' | 'interrupted' | 'system'>('scans');

  const isAdmin = (() => { try { return JSON.parse(localStorage.getItem('wms_user') || '{}').role === 'admin'; } catch { return false; } })();

  const tabs = [
    { key: 'scans' as const,  label: '📋 Bipagens',              desc: 'Cada scan com operador e horário' },
    ...(isAdmin ? [{ key: 'interrupted' as const, label: '⚠️ Pedidos Interrompidos', desc: 'Histórico de interrupções com motivo' }] : []),
    { key: 'system' as const, label: '🗂 Ações do Sistema',       desc: 'Cadastros, uploads, estoque e configurações' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-xl font-bold text-white">Trilha de Auditoria</h1>
        <p className="text-sm text-white/50 mt-0.5">
          Registro completo de todas as ações do sistema — bipagens, cadastros, uploads, estoque e mais
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/8">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-white border-violet-500'
                : 'text-white/40 border-transparent hover:text-white/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {activeTab === 'scans'       && <ScanAuditTab />}
      {activeTab === 'interrupted' && isAdmin && <InterruptedOrdersTab />}
      {activeTab === 'system'      && <SystemAuditTab />}
    </div>
  );
}
