/**
 * WMS Kiwkiw - Portal do Seller
 * Interface externa para sellers consultarem pedidos, estoque e status.
 */

import { useState } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { Package, TrendingDown, CheckCircle, Clock, LogOut, Search, Download } from 'lucide-react';
import { dashboardApi, inventoryApi } from '../api';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pendente',    color: 'bg-gray-100 text-white/60' },
  scanning:    { label: 'Em Bipagem', color: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'Concluído',  color: 'bg-violet-900/40 text-violet-300' },
  interrupted: { label: 'Interrompido', color: 'bg-orange-100 text-orange-700' },
};

export default function SellerPortalPage() {
  const navigate = useNavigate();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : {};
  const sellerId = user.seller_id;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tab, setTab] = useState<'orders' | 'stock'>('orders');

  const { data: dashboard } = useQuery(
    ['seller-dashboard', sellerId],
    () => sellerId ? dashboardApi.seller({ seller_id: sellerId }).then(r => r.data) : null,
    { enabled: !!sellerId, refetchInterval: 60000 }
  );

  const { data: stock = [] } = useQuery(
    ['seller-stock', sellerId],
    () => sellerId ? inventoryApi.stock(sellerId).then(r => r.data) : [],
    { enabled: !!sellerId && tab === 'stock' }
  );

  const handleLogout = () => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    navigate('/login');
  };

  const orders = dashboard?.orders ?? [];
  const filteredOrders = orders.filter((o: any) =>
    (!search || o.nf_number.includes(search) || o.customer_name.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || o.status === statusFilter)
  );

  const filteredStock = stock.filter((s: any) =>
    !search || s.sku.toLowerCase().includes(search.toLowerCase()) || s.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const completionPct = dashboard?.completion_rate ?? 0;

  return (
    <div className="min-h-screen bg-white/4">
      {/* Header */}
      <header className="bg-gray-900 border-b border-white/12 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">K</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white">WMS Kiwkiw</p>
              <p className="text-xs text-white/35">Portal do Seller</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-white/90">{user.name}</p>
              <p className="text-xs text-white/35">{format(new Date(), "dd/MM/yyyy", { locale: ptBR })}</p>
            </div>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/50 hover:text-red-600 border border-white/12 rounded-lg transition">
              <LogOut size={14} /> Sair
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pedidos Hoje', value: dashboard?.total_orders ?? 0, icon: Package, color: 'text-white/90' },
            { label: 'Concluídos', value: dashboard?.completed_orders ?? 0, icon: CheckCircle, color: 'text-violet-400' },
            { label: 'Em Andamento', value: dashboard?.in_progress_orders ?? 0, icon: Clock, color: 'text-blue-600' },
            { label: 'SKUs c/ Estoque Baixo', value: stock.filter((s: any) => s.level === 'BAIXO').length, icon: TrendingDown, color: 'text-red-500' },
          ].map(card => (
            <div key={card.label} className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-white/35 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
                <card.icon size={18} className={card.color} />
              </div>
            </div>
          ))}
        </div>

        {/* Barra de progresso do dia */}
        <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-white/80">Progresso do Dia</p>
            <p className="text-sm font-bold text-violet-400">{completionPct.toFixed(0)}%</p>
          </div>
          <div className="w-full bg-white/10 rounded-full h-3">
            <div className="bg-violet-500 h-3 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <p className="text-xs text-white/35 mt-1.5">
            {dashboard?.completed_orders ?? 0} de {dashboard?.total_orders ?? 0} pedidos finalizados
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {(['orders', 'stock'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-gray-900 shadow text-white' : 'text-white/50 hover:text-white/80'}`}>
              {t === 'orders' ? 'Meus Pedidos' : 'Meu Estoque'}
            </button>
          ))}
        </div>

        {/* Filtro de busca */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'orders' ? 'Buscar NF ou cliente...' : 'Buscar SKU ou produto...'}
              className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm bg-gray-900 outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          {tab === 'orders' && (
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="border border-white/12 rounded-lg px-3 py-2 text-sm bg-gray-900 outline-none focus:ring-2 focus:ring-violet-500">
              <option value="">Todos os status</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
        </div>

        {/* Tabela de pedidos */}
        {tab === 'orders' && (
          <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-white/4 border-b border-white/8">
                  {['NF', 'Cliente Final', 'Transportadora', 'Data', 'Status'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? filteredOrders.map((o: any) => {
                  const st = STATUS_CONFIG[o.status] ?? { label: o.status, color: 'bg-gray-100 text-white/60' };
                  return (
                    <tr key={o.id} className="border-b border-white/5 hover:bg-white/4">
                      <td className="py-2.5 px-3 text-sm font-mono text-white/80">{o.nf_number}</td>
                      <td className="py-2.5 px-3 text-sm text-white/90">{o.customer_name}</td>
                      <td className="py-2.5 px-3 text-sm text-white/50">{o.carrier || '—'}</td>
                      <td className="py-2.5 px-3 text-sm text-white/50">{o.order_date ? format(new Date(o.order_date), 'dd/MM/yy') : '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={5} className="text-center text-sm text-white/35 py-10">Nenhum pedido encontrado</td></tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">{filteredOrders.length} pedido(s)</div>
          </div>
        )}

        {/* Tabela de estoque */}
        {tab === 'stock' && (
          <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-white/4 border-b border-white/8">
                  {['SKU', 'Produto', 'Entradas', 'Saídas', 'Saldo', 'Nível'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStock.length > 0 ? filteredStock.map((s: any) => (
                  <tr key={s.sku} className={`border-b border-white/5 hover:bg-white/4 ${s.level === 'BAIXO' ? 'bg-red-50/20' : ''}`}>
                    <td className="py-2.5 px-3 text-xs font-mono text-white/60">{s.sku}</td>
                    <td className="py-2.5 px-3 text-sm text-white/90">{s.product_name}</td>
                    <td className="py-2.5 px-3 text-sm text-violet-400 font-medium text-right">+{s.entries}</td>
                    <td className="py-2.5 px-3 text-sm text-red-500 font-medium text-right">-{s.exits}</td>
                    <td className="py-2.5 px-3 text-sm font-bold text-white text-right">{s.final_stock}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.level === 'ALTO' ? 'bg-violet-900/40 text-violet-300' :
                        s.level === 'MÉDIO' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-600'
                      }`}>{s.level}</span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="text-center text-sm text-white/35 py-10">Nenhum produto no estoque</td></tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">{filteredStock.length} SKU(s)</div>
          </div>
        )}
      </div>
    </div>
  );
}
