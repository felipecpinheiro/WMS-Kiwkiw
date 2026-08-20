/**
 * WMS Kiwkiw - Vincular Componentes de Kit aos Produtos
 * Componentes cujo SKU não bate com nenhum produto cadastrado do seller ficam
 * sem vínculo (product_id NULL). Aqui é possível apontar o produto correto ou
 * cadastrar o produto que falta, sem precisar sair da tela.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import { Link2, ArrowLeft, Plus } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

export default function KitFixesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sellerFilter, setSellerFilter] = useState<number | ''>('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  // cadastro rápido de produto: item_id -> { name, barcode }
  const [creating, setCreating] = useState<Record<number, { name: string; barcode: string }>>({});

  const { data: pending = [], isLoading } = useQuery(
    ['kit-unlinked', sellerFilter],
    () => cadastrosApi.kitUnlinkedComponents(sellerFilter || undefined).then(r => r.data),
  );
  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  // Produtos do seller da linha que está sendo resolvida
  const sellersComPendencia: number[] = Array.from(
    new Set((pending as any[]).map(p => p.seller_id))
  );
  const { data: produtosPorSeller = {} } = useQuery(
    ['kit-fix-products', sellersComPendencia.join(',')],
    async () => {
      const mapa: Record<number, any[]> = {};
      for (const sid of sellersComPendencia) {
        const r = await cadastrosApi.products({ seller_id: sid, page_size: 0 });
        mapa[sid] = (r.data as any)?.items ?? [];
      }
      return mapa;
    },
    { enabled: sellersComPendencia.length > 0 },
  );

  const recarregar = () => {
    qc.invalidateQueries('kit-unlinked');
    qc.invalidateQueries('kits');
  };

  const handleVincular = async (row: any) => {
    const productId = Number(choice[row.item_id]);
    if (!productId) { toast.error('Escolha o produto correspondente'); return; }
    setBusyId(row.item_id);
    try {
      await cadastrosApi.linkKitComponent(row.item_id, productId);
      toast.success(`"${row.component_sku}" vinculado ao produto`);
      recarregar();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao vincular');
    } finally {
      setBusyId(null);
    }
  };

  const handleCriarProduto = async (row: any) => {
    const form = creating[row.item_id];
    if (!form?.name?.trim()) { toast.error('O nome do produto é obrigatório'); return; }
    setBusyId(row.item_id);
    try {
      const res = await cadastrosApi.createProduct({
        seller_id: row.seller_id,
        sku: row.component_sku,
        name: form.name.trim(),
        barcode_seller: form.barcode?.trim() || undefined,
      });
      await cadastrosApi.linkKitComponent(row.item_id, (res.data as any).id);
      if (!form.barcode?.trim()) {
        toast('Produto criado sem código de barras — ele não poderá ser bipado no Scanner até você cadastrar o barcode.',
          { icon: '⚠️', duration: 7000 });
      }
      toast.success(`Produto "${row.component_sku}" criado e vinculado`);
      setCreating(prev => { const p = { ...prev }; delete p[row.item_id]; return p; });
      qc.invalidateQueries('products');
      recarregar();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao criar produto');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-5 min-h-full">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/kits')} className="text-t4 hover:text-t1 transition">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-t1 flex items-center gap-2">
            <Link2 size={20} className="text-warn" /> Vincular componentes de kit
          </h1>
          <p className="text-sm text-t4 mt-0.5">
            {pending.length} componente(s) sem produto cadastrado. Sem o vínculo o kit continua
            explodindo pelo SKU, mas o item entra no pedido como produto não cadastrado.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={sellerFilter}
          onChange={e => setSellerFilter(e.target.value ? Number(e.target.value) : '')}
          className="border border-line rounded-lg px-3 py-1.5 text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500"
          style={{ background: 'rgb(var(--surface-2))' }}
        >
          <option value="">Todos os sellers</option>
          {(sellers as any[]).map((s: any) => (
            <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-t4 text-sm">Carregando...</p>
      ) : pending.length === 0 ? (
        <div className="bg-ok-soft border border-ok/20 rounded-xl px-4 py-6 text-center text-ok text-sm">
          Nenhuma pendência — todos os componentes de kit estão ligados a um produto cadastrado.
        </div>
      ) : (
        <div className="space-y-3">
          {(pending as any[]).map((row: any) => {
            const produtos = (produtosPorSeller as any)[row.seller_id] ?? [];
            const emCriacao = creating[row.item_id];
            return (
              <div key={row.item_id} className="bg-surface border border-line rounded-xl p-4">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-t1 font-mono">{row.component_sku}</p>
                    <p className="text-xs text-t4 mt-0.5">
                      {row.component_name && row.component_name !== row.component_sku
                        ? `${row.component_name} · ` : ''}
                      {row.quantity}x no kit <span className="font-mono text-violet-300">{row.kit_sku}</span>
                      {' · '}{row.seller_name}
                    </p>
                  </div>
                </div>

                {!emCriacao ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={choice[row.item_id] ?? ''}
                      onChange={e => setChoice(prev => ({ ...prev, [row.item_id]: e.target.value }))}
                      className="flex-1 min-w-[240px] border border-line rounded-lg px-3 py-2 text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500"
                      style={{ background: 'rgb(var(--surface-2))' }}
                    >
                      <option value="">Vincular a um produto existente...</option>
                      {produtos.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleVincular(row)}
                      disabled={busyId === row.item_id}
                      className="px-3 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-50"
                    >
                      Vincular
                    </button>
                    <button
                      onClick={() => setCreating(prev => ({ ...prev, [row.item_id]: { name: '', barcode: '' } }))}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 border border-line hover:bg-surface-2 rounded-lg transition"
                    >
                      <Plus size={14} /> Criar produto
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 border-t border-line-soft pt-3">
                    <p className="text-xs text-t3">
                      Cadastrar produto novo com o SKU <span className="font-mono text-t2">{row.component_sku}</span> em {row.seller_name}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        autoFocus
                        placeholder="Nome do produto *"
                        value={emCriacao.name}
                        onChange={e => setCreating(prev => ({
                          ...prev, [row.item_id]: { ...prev[row.item_id], name: e.target.value },
                        }))}
                        className="flex-1 min-w-[220px] border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <input
                        placeholder="Código de barras (opcional)"
                        value={emCriacao.barcode}
                        onChange={e => setCreating(prev => ({
                          ...prev, [row.item_id]: { ...prev[row.item_id], barcode: e.target.value },
                        }))}
                        className="w-52 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <button
                        onClick={() => handleCriarProduto(row)}
                        disabled={busyId === row.item_id}
                        className="px-3 py-2 text-sm text-t1 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition disabled:opacity-50"
                      >
                        Criar e vincular
                      </button>
                      <button
                        onClick={() => setCreating(prev => { const p = { ...prev }; delete p[row.item_id]; return p; })}
                        className="px-3 py-2 text-sm text-t3 hover:text-t2 transition"
                      >
                        Cancelar
                      </button>
                    </div>
                    <p className="text-[11px] text-warn/70">
                      Sem código de barras o produto não pode ser bipado no Scanner.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
