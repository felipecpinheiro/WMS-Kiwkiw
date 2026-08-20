/**
 * WMS Kiwkiw - Faturamento
 * Configuração de cobrança por seller e relatório de faturamento.
 */

import { useState } from 'react';
import { todayBrasiliaStr } from '../timezone';
import { useQuery, useQueryClient } from 'react-query';
import { DollarSign, Check, Save, Download } from 'lucide-react';
import { billingApi, cadastrosApi } from '../api';
import toast from 'react-hot-toast';

export default function BillingPage() {
  const qc = useQueryClient();
  const [sellerId, setSellerId] = useState<number | ''>('');
  const [month, setMonth] = useState(() => todayBrasiliaStr().slice(0, 7));
  const [config, setConfig] = useState<any>({
    base_fee: 0, price_per_order: 0, franchise: 1,
    franchise_orders: 0, extra_order_price: 0,
    handling: 0, storage_fee_per_sku: 0, storage_included: false,
  });
  const [saving, setSaving] = useState(false);
  // Filtro de data para exportação
  const [exportFrom, setExportFrom] = useState(() => todayBrasiliaStr().slice(0, 7) + '-01');
  const [exportTo, setExportTo] = useState(() => todayBrasiliaStr());
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

  // Exceção à regra de esconder seller inativo (ver CLAUDE.md): o Faturamento
  // precisa listar inativos para permitir fechar a última fatura de quem saiu.
  // Chave própria: a lista completa NÃO pode dividir cache com a chave 'sellers',
  // usada pelas telas que só enxergam ativos. O prefixo mantém os
  // invalidateQueries('sellers') existentes funcionando.
  const { data: sellers = [] } = useQuery(['sellers', 'billing'], () =>
    cadastrosApi.sellers(false).then(r => r.data)
  );

  const { data: billingConfig } = useQuery(
    ['billing-config', sellerId],
    () => sellerId ? billingApi.config(sellerId).then(r => r.data) : null,
    {
      enabled: !!sellerId,
      onSuccess: (data: any[]) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((c: any) => { map[c.config_key] = c.config_value ?? '0'; });
        setConfig({
          base_fee:            parseFloat(map['Taxa Base'] ?? '0'),
          price_per_order:     parseFloat(map['Preço Unitário'] ?? '0'),
          franchise:           parseInt(map['Franquia'] ?? '1'),
          franchise_orders:    parseInt(map['Número Mínimo de Pedidos'] ?? '0'),
          extra_order_price:   parseFloat(map['Preço Adicional'] ?? '0'),
          handling:            parseFloat(map['Manuseio'] ?? '0'),
          storage_fee_per_sku: parseFloat(map['Armazenagem'] ?? '0'),
          storage_included:    (map['Armazenagem Incluso'] ?? '0') !== '0',
        });
      }
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
      const entries = [
        { config_key: 'Taxa Base',               config_value: String(config.base_fee) },
        { config_key: 'Preço Unitário',           config_value: String(config.price_per_order) },
        { config_key: 'Franquia',                 config_value: String(config.franchise) },
        { config_key: 'Número Mínimo de Pedidos', config_value: String(config.franchise_orders) },
        { config_key: 'Preço Adicional',          config_value: String(config.extra_order_price) },
        { config_key: 'Manuseio',                 config_value: String(config.handling) },
        { config_key: 'Armazenagem',              config_value: String(config.storage_fee_per_sku) },
        { config_key: 'Armazenagem Incluso',      config_value: config.storage_included ? '1' : '0' },
      ];
      await Promise.all(entries.map(e => billingApi.saveConfig({ seller_id: Number(sellerId), ...e })));
      toast.success('Configuração salva!');
      qc.invalidateQueries(['billing-config', sellerId]);
    } catch { toast.error('Erro ao salvar configuração'); }
    finally { setSaving(false); }
  };

  const f = (key: string, val: any) => setConfig((prev: any) => ({ ...prev, [key]: Number(val) }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-t1">Faturamento</h1>
        <p className="text-sm text-t3 mt-0.5">Configuração de cobrança e relatório por seller</p>
      </div>

      {/* Seleção de seller */}
      {/* ── Exportar Excel ──────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-line-soft p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-t2">Exportar Relatório</h2>
          <span className="text-[11px] text-t4">Seller · NF · Data · SKU · Qtd · Entrada/Saída · Caixa</span>
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-xs text-t3 mb-1">Data inicial</label>
            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: 'rgb(var(--surface-2))', color: 'rgb(var(--t1))' }} />
          </div>
          <div>
            <label className="block text-xs text-t3 mb-1">Data final</label>
            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: 'rgb(var(--surface-2))', color: 'rgb(var(--t1))' }} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-t3 mb-1">Seller (opcional)</label>
            <select value={sellerId} onChange={e => setSellerId(Number(e.target.value) || '')}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: 'rgb(var(--surface-2))', color: 'rgb(var(--t1))' }}>
              <option value="">Todos os sellers</option>
              {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || !exportFrom || !exportTo}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-t1 transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7B63E8,#5B43C8)' }}
          >
            <Download size={15} />
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-t3 mb-1">Seller</label>
          <select value={sellerId} onChange={e => setSellerId(Number(e.target.value))}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
            <option value="">Selecione um seller...</option>
            {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-t3 mb-1">Mês de referência</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
      </div>

      {sellerId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Configuração */}
          <div className="bg-surface rounded-xl border border-line-soft shadow-none p-5">
            <h2 className="text-sm font-semibold text-t2 mb-4">Parâmetros de Cobrança</h2>
            <div className="space-y-3">
              {[
                { label: 'Taxa Base (R$)', key: 'base_fee' },
                { label: 'Preço por Pedido (R$)', key: 'price_per_order' },
                { label: 'Ativa Franquia (0 = não, 1 = sim)', key: 'franchise' },
                { label: 'Número Mínimo de Pedidos (Franquia)', key: 'franchise_orders' },
                { label: 'Extra por Pedido Acima da Franquia (R$)', key: 'extra_order_price' },
                { label: 'Manuseio (R$)', key: 'handling' },
                { label: 'Armazenagem por SKU (R$)', key: 'storage_fee_per_sku' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-t3 mb-1">{field.label}</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={config[field.key] ?? 0}
                    onChange={e => f(field.key, e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="storage_included"
                  checked={!!config.storage_included}
                  onChange={e => setConfig((prev: any) => ({ ...prev, storage_included: e.target.checked }))}
                  className="w-4 h-4 accent-violet-500"
                />
                <label htmlFor="storage_included" className="text-xs text-t3 cursor-pointer">
                  Armazenagem inclusa no plano
                </label>
              </div>
            </div>
            <button onClick={handleSaveConfig} disabled={saving}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 rounded-lg transition">
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar Configuração'}
            </button>
          </div>

          {/* Relatório */}
          <div className="bg-surface rounded-xl border border-line-soft shadow-none p-5">
            <h2 className="text-sm font-semibold text-t2 mb-4">
              Relatório — {month}
            </h2>
            {report ? (
              <div className="space-y-3">
                {[
                  { label: 'Total de Pedidos',                value: report.total_orders,    fmt: (v: number) => v.toString() },
                  { label: 'Cobrança por Pedidos',            value: report.base_value,      fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                  { label: 'Pedidos Extras (acima franquia)', value: report.franchise_value, fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                  { label: 'Armazenagem',                     value: report.storage,         fmt: (v: number) => `R$ ${v.toFixed(2)}` },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-2 border-b border-line-soft last:border-0">
                    <span className="text-sm text-t3">{row.label}</span>
                    <span className="text-sm font-medium text-t1">{row.fmt(row.value ?? 0)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-3 bg-violet-900/25 rounded-lg px-3 mt-2">
                  <span className="text-sm font-bold text-t2">Total do Mês</span>
                  <span className="text-lg font-black text-violet-400">R$ {(report.total ?? 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <div className="text-center">
                  <DollarSign size={32} className="text-t5 mx-auto mb-2" />
                  <p className="text-sm text-t4">Nenhum dado para o período</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!sellerId && (
        <div className="bg-surface border border-dashed border-line rounded-xl p-12 text-center">
          <DollarSign size={40} className="text-t5 mx-auto mb-3" />
          <p className="text-t4">Selecione um seller para ver e configurar o faturamento</p>
        </div>
      )}
    </div>
  );
}
