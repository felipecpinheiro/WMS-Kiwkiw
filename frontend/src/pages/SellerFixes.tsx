/**
 * WMS Kiwkiw - Corrigir Sellers sem Unidade
 * Resolve sellers ativos sem unidade associada: ou é um cadastro novo que só
 * falta associar a uma unidade, ou é um duplicado com pedidos presos que
 * precisam ser migrados para o seller correto.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import { Wrench, ArrowLeft } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

export default function SellerFixesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [unitChoice, setUnitChoice] = useState<Record<number, number>>({});

  const { data: pending = [], isLoading } = useQuery(
    'sellers-without-unit',
    () => cadastrosApi.sellersWithoutUnit().then(r => r.data),
  );
  const { data: units = [] } = useQuery('units', () => cadastrosApi.units().then(r => r.data));
  const { data: allSellers = [] } = useQuery(
    'sellers-active-for-fixes',
    () => cadastrosApi.sellers(true).then(r => r.data),
  );

  const handleApply = async (seller: { id: number; trade_name: string; order_count: number }) => {
    const sel = choice[seller.id];
    if (!sel) return;
    setBusyId(seller.id);
    try {
      if (sel === 'unit') {
        const unitId = unitChoice[seller.id];
        if (!unitId) {
          toast.error('Selecione uma unidade');
          setBusyId(null);
          return;
        }
        await cadastrosApi.assignSellerUnit(seller.id, unitId);
        toast.success(`Unidade associada a "${seller.trade_name}"`);
      } else {
        const toId = Number(sel);
        const res = await cadastrosApi.mergeSellerOrders(seller.id, toId);
        toast.success(`${res.data.migrated_orders} pedido(s) migrado(s) para o seller correto`);
      }
      qc.invalidateQueries('sellers-without-unit');
      qc.invalidateQueries('sellers');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao corrigir');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-5 min-h-full">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/sellers')} className="text-white/40 hover:text-white transition">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wrench size={20} className="text-amber-400" /> Corrigir sellers sem unidade
          </h1>
          <p className="text-sm text-white/40 mt-0.5">
            {pending.length} pendência(s) — geralmente um seller duplicado com pedidos presos, ou um
            cadastro novo que só falta associar a uma unidade.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-white/40 text-sm">Carregando...</p>
      ) : pending.length === 0 ? (
        <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-xl px-4 py-6 text-center text-emerald-300 text-sm">
          Nenhuma pendência — todos os sellers ativos têm unidade associada.
        </div>
      ) : (
        <div className="space-y-3">
          {(pending as any[]).map((s: any) => (
            <div key={s.id} className="bg-gray-900 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{s.trade_name}</p>
                  <p className="text-xs text-white/40">{s.order_count} pedido(s) presos neste cadastro</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={choice[s.id] || ''}
                    onChange={e => setChoice(prev => ({ ...prev, [s.id]: e.target.value }))}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white min-w-[240px]"
                  >
                    <option value="" disabled>Selecione uma ação...</option>
                    <option value="unit">Não é duplicado — só associar uma unidade</option>
                    {(allSellers as any[])
                      .filter((o: any) => o.id !== s.id)
                      .map((o: any) => (
                        <option key={o.id} value={String(o.id)}>Migrar pedidos para: {o.trade_name}</option>
                      ))}
                  </select>
                  {choice[s.id] === 'unit' && (
                    <select
                      value={unitChoice[s.id] || ''}
                      onChange={e => setUnitChoice(prev => ({ ...prev, [s.id]: Number(e.target.value) }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                    >
                      <option value="" disabled>Unidade...</option>
                      {(units as any[]).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => handleApply(s)}
                    disabled={busyId === s.id || !choice[s.id]}
                    className="px-3 py-1.5 text-xs rounded-lg font-medium text-white transition disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
                  >
                    {busyId === s.id ? 'Aplicando...' : 'Aplicar'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
