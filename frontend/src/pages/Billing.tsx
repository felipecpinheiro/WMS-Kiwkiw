/**
 * WMS Kiwkiw - Faturamento
 * Configuração de cobrança por seller e relatório de faturamento.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { DollarSign, Check, Save, Download } from 'lucide-react';
import { billingApi, cadastrosApi } from '../api';
import toast from 'react-hot-toast';

export default function BillingPage() {
  const qc = useQueryClient();
  const [sellerId, setSellerId] = useState<number | ''>('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [config, setConfig] = useState<any>({
    base_fee: 0, price_per_order: 0, franchise_orders: 0,
    extra_order_price: 0, storage_fee_per_sku: 0,
  });
  const [saving, setSaving] = useState(false);
  // Filtro de data para exportação
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const base = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
      const sellerParam = sellerId ? `&seller_id=${sellerId}` : '';
      const token = localStorage.getItem('wms_token');
      const res = await fetch(
        `${base}/billing/export?date_from=${exportFrom}&date_to=${exportTo}${sellerParam}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) { toast.error('Erro ao exportar'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faturamento_${exportFrom}_${exportTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exportado com sucesso!');
    } catch { toast.error('Erro na exportação'); }
    finally { setExporting(false); }
  };

  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  const { data: billingConfig } = useQuery(
    ['billing-config', sellerId],
    () => sellerId ? billingApi.config(sellerId).then(r => r.data) : null,
    {
      enabled: !!sellerId,
      onSuccess: (data) => { if (data) setConfig(data); }
    }
  );

  const { data: report } = useQuery(
    ['billing-report', sellerId, month],
    () => sellerId ? billingApi.report(sellerId, month).then(r => r.data) : null,
    { enabled: !!sellerId }
  );

  const handleSaveConfig = async () => {
    if (!sellerId) { toast.error('Selecione um seller'); return; }
    setSaving(true);
    try {
      await billingApi.saveConfig({ ...config, seller_id: sellerId });
      toast.success('Configuração salva!');
      qc.invalidateQueries(['billing-config', sellerId]);
    } catch { toast.error('Erro ao salvar configuração'); }
    finally { setSaving(false); }
  };

  const f = (key: string, val: any) => setConfig((prev: any) => ({ ...prev, [key]: Number(val) }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Faturamento</h1>
        <p className="text-sm text-white/50 mt-0.5">Configuração de cobrança e relatório por seller</p>
      </div>

      {/* Seleção de seller */}
      {/* ── Exportar Excel ──────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-white/8 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white/80">Exportar Relatório</h2>
          <span className="text-[11px] text-white/35">Seller · NF · Data · SKU · Qtd · Entrada/Saída · Caixa</span>
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-xs text-white/50 mb-1">Data inicial</label>
            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
              className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: '#14122A', colorScheme: 'dark', color: '#fff' }} />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">Data final</label>
            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
              className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: '#14122A', colorScheme: 'dark', color: '#fff' }} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-white/50 mb-1">Seller (opcional)</label>
            <select value={sellerId} onChange={e => setSellerId(Number(e.target.value) || '')}
              className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: '#14122A', color: '#fff' }}>
              <option value="">Todos os sellers</option>
              {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || !exportFrom || !exportTo}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7B63E8,#5B43C8)' }}
          >
            <Download size={15} />
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-white/50 mb-1">Seller</label>
          <select value={sellerId} onChange={e => setSellerId(Number(e.target.value))}
            className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
            <option value="">Selecione um seller...</option>
            {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Mês de referência</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
      </div>

      {sellerId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Configuração */}
          <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-4">Parâmetros de Cobrança</h2>
            <div className="space-y-3">
              {[
                { label: 'Taxa Base (R$)', key: 'base_fee' },
                { label: 'Preço por Pedido (R$)', key: 'price_per_order' },
                { label: 'Franquia de Pedidos', key: 'franchise_orders' },
                { label: 'Extra por Pedido Acima da Franquia (R$)', key: 'extra_order_price' },
                { label: 'Taxa de Armazenagem por SKU (R$)', key: 'storage_fee_per_sku' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-white/50 mb-1">{field.label}</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={config[field.key] ?? 0}
                    onChange={e => f(field.key, e.target.value)}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              ))}
            </div>
            <button onClick={handleSaveConfig} disabled={saving}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-60 rounded-lg transition">
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar Configuração'}
            </button>
          </div>

          {/* Relatório */}
          <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-4">
              Relatório — {month}
            </h2>
            {report ? (
              <div className="space-y-3">
                {[
                  { label: 'Total de Pedidos', value: report.total_orders, fmt: (v: number) => v.toString() },
                  { label: 'Taxa Base', value: report.base_fee, fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                  { label: 'Cobrança por Pedidos', value: report.orders_fee, fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                  { label: 'Pedidos Extras (acima da franquia)', value: report.extra_orders_fee, fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                  { label: 'Armazenagem', value: report.storage_fee, fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-2 border-b border-white/5 last:border-0">
                    <span className="text-sm text-white/60">{row.label}</span>
                    <span className="text-sm font-medium text-white/90">{row.fmt(row.value)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-3 bg-violet-900/25 rounded-lg px-3 mt-2">
                  <span className="text-sm font-bold text-white/80">Total do Mês</span>
                  <span className="text-lg font-black text-violet-400">R$ {(report.total_fee ?? 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <div className="text-center">
                  <DollarSign size={32} className="text-white/25 mx-auto mb-2" />
                  <p className="text-sm text-white/35">Nenhum dado para o período</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!sellerId && (
        <div className="bg-gray-900 border border-dashed border-white/12 rounded-xl p-12 text-center">
          <DollarSign size={40} className="text-white/25 mx-auto mb-3" />
          <p className="text-white/35">Selecione um seller para ver e configurar o faturamento</p>
        </div>
      )}
    </div>
  );
}
