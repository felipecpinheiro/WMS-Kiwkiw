/**
 * WMS Kiwkiw - Cadastro de Kits
 * Kits são SKUs compostos que são explodidos em SKUs individuais na bipagem.
 * Suporta importação em massa via paste de Excel.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, X, Check, Package, ChevronDown, ChevronUp, ClipboardList, History } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

const KIT_MAX_COMPONENTS = 10;
const KIT_COLS = 2 + KIT_MAX_COMPONENTS * 2; // seller + sku_kit + 10*(sku+qty)

export default function KitsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [kitSku, setKitSku] = useState('');
  const [kitName, setKitName] = useState('');
  const [sellerId, setSellerId] = useState<number | ''>('');
  const [items, setItems] = useState<{ sku: string; quantity: number }[]>([{ sku: '', quantity: 1 }]);

  const [activeTab, setActiveTab] = useState<'kits' | 'log'>('kits');
  const [logSeller, setLogSeller] = useState<number | ''>('');

  // Paste modal state
  const [showKitPasteModal, setShowKitPasteModal] = useState(false);
  const [kitGrid, setKitGrid] = useState<string[][]>(Array(5).fill(null).map(() => Array(KIT_COLS).fill('')));

  const { data: kits = [] } = useQuery('kits', () => cadastrosApi.kits().then(r => r.data));
  const { data: expansionLog = [] } = useQuery(
    ['kit-expansion-log', logSeller],
    () => cadastrosApi.kitExpansionLog(logSeller || undefined).then(r => r.data),
    { enabled: activeTab === 'log' }
  );
  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));
  // Busca produtos do seller selecionado (page_size=0 = todos, sem paginação)
  const { data: productsResp } = useQuery(
    ['products-for-kit', sellerId],
    () => sellerId
      ? cadastrosApi.products({ seller_id: Number(sellerId), page_size: 0 }).then(r => r.data)
      : Promise.resolve({ items: [], total: 0, page: 1, page_size: 0, pages: 0 }),
    { enabled: true, keepPreviousData: true }
  );
  const products: any[] = (productsResp as any)?.items ?? (Array.isArray(productsResp) ? productsResp : []);

  const openCreate = () => {
    setEditId(null); setKitSku(''); setKitName(''); setSellerId('');
    setItems([{ sku: '', quantity: 1 }]); setShowModal(true);
  };
  const openEdit = (k: any) => {
    setEditId(k.id); setKitSku(k.sku); setKitName(k.name); setSellerId(k.seller_id);
    setItems(k.items?.map((i: any) => ({ sku: i.component_sku, quantity: i.quantity })) ?? [{ sku: '', quantity: 1 }]);
    setShowModal(true);
  };

  const addItem = () => setItems(prev => [...prev, { sku: '', quantity: 1 }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: 'sku' | 'quantity', value: string | number) =>
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const handleSave = async () => {
    if (!kitSku || !kitName || !sellerId) { toast.error('SKU, nome e seller são obrigatórios'); return; }
    if (items.some(i => !i.sku)) { toast.error('Preencha todos os SKUs dos componentes'); return; }
    try {
      const mappedItems = items.filter(i => i.sku.trim()).map(i => ({ component_sku: i.sku.trim(), quantity: i.quantity }));
      const payload = { kit_sku: kitSku, kit_name: kitName, seller_id: Number(sellerId), items: mappedItems };
      if (editId) { await cadastrosApi.updateKit(editId, payload); toast.success('Kit atualizado!'); }
      else { await cadastrosApi.createKit(payload); toast.success('Kit criado!'); }
      qc.invalidateQueries('kits');
      setShowModal(false);
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro ao salvar kit'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este kit?')) return;
    try { await cadastrosApi.deleteKit(id); toast.success('Kit excluído'); qc.invalidateQueries('kits'); }
    catch { toast.error('Erro ao excluir'); }
  };

  // Kit paste handlers
  const handleKitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = text.trim().split('\n').map(r => r.split('\t'));
    const newGrid = [...kitGrid];
    rows.slice(0, 100).forEach((row, ri) => {
      if (ri >= newGrid.length) newGrid.push(Array(KIT_COLS).fill(''));
      row.slice(0, KIT_COLS).forEach((cell, ci) => {
        newGrid[ri][ci] = cell.trim();
      });
    });
    while (newGrid.length < 5) newGrid.push(Array(KIT_COLS).fill(''));
    setKitGrid([...newGrid]);
  };

  const handleKitPasteSave = async () => {
    const items2: any[] = [];
    kitGrid.filter(row => row[0]?.trim() && row[1]?.trim()).forEach(row => {
      const components: { sku: string; quantity: number }[] = [];
      for (let ci = 0; ci < KIT_MAX_COMPONENTS; ci++) {
        const sku = row[2 + ci * 2]?.trim();
        const qty = parseInt(row[3 + ci * 2]) || 0;
        if (sku && qty > 0) components.push({ sku, quantity: qty });
      }
      if (components.length > 0) {
        items2.push({ seller_name: row[0].trim(), kit_sku: row[1].trim(), components });
      }
    });
    if (!items2.length) { toast.error('Nenhum kit válido'); return; }
    try {
      const res = await cadastrosApi.bulkImportKits({ items: items2 });
      const { created, updated } = res.data;
      toast.success(`✓ ${created} criados, ${updated} atualizados`);
      qc.invalidateQueries('kits');
      setShowKitPasteModal(false);
      setKitGrid(Array(5).fill(null).map(() => Array(KIT_COLS).fill('')));
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro ao importar'); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Kits</h1>
          <p className="text-sm text-white/50 mt-0.5">Kits são SKUs compostos que são explodidos automaticamente na bipagem</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex rounded-lg overflow-hidden border border-white/12">
            <button onClick={() => setActiveTab('kits')}
              className={`px-3 py-1.5 text-xs font-medium transition ${activeTab === 'kits' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white/80'}`}>
              Cadastro
            </button>
            <button onClick={() => setActiveTab('log')}
              className={`px-3 py-1.5 text-xs font-medium transition flex items-center gap-1.5 ${activeTab === 'log' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white/80'}`}>
              <History size={11} /> Log Explosões
            </button>
          </div>
          {activeTab === 'kits' && <>
          <button onClick={() => setShowKitPasteModal(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/80 bg-gray-900 border border-white/12 hover:bg-white/4 rounded-lg transition">
            <ClipboardList size={14} /> Colar Kits
          </button>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            <Plus size={14} /> Novo Kit
          </button>
          </> }
        </div>
      </div>

      {activeTab === 'kits' && (<>
      <div className="space-y-3">
        {kits.length === 0 && (
          <div className="bg-gray-900 border border-dashed border-white/12 rounded-xl p-10 text-center">
            <Package size={32} className="text-white/25 mx-auto mb-2" />
            <p className="text-sm text-white/35">Nenhum kit cadastrado</p>
          </div>
        )}
        {kits.map((k: any) => (
          <div key={k.id} className="bg-gray-900 rounded-xl border border-white/8 shadow-none">
            <div className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Package size={16} className="text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/90">{k.name}</p>
                <p className="text-xs text-white/35">
                  <span className="font-mono">{k.sku}</span>
                  {' · '}
                  {k.seller_name}
                  {' · '}
                  {k.items?.length ?? 0} componente(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === k.id ? null : k.id)}
                  className="text-white/35 hover:text-white/60 transition"
                >
                  {expandedId === k.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                <button onClick={() => openEdit(k)} className="text-white/35 hover:text-violet-400 transition"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(k.id)} className="text-white/35 hover:text-red-500 transition"><Trash2 size={14} /></button>
              </div>
            </div>

            {expandedId === k.id && (
              <div className="border-t border-white/8 px-4 py-3">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">Composição</p>
                <div className="space-y-1">
                  {k.items?.map((item: any, i: number) => {
                    const prod = products.find((p: any) => p.sku === item.component_sku && (!k.seller_id || p.seller_id === k.seller_id));
                    const displayName = prod?.name || item.component_name || item.component_sku;
                    return (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="w-6 h-6 bg-gray-100 rounded text-center text-xs font-bold text-white/50 flex items-center justify-center">{item.quantity}x</span>
                        <span className="font-mono text-xs text-white/50">{item.component_sku}</span>
                        <span className="text-white/60 text-xs truncate">{displayName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Edit/Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">{editId ? 'Editar Kit' : 'Novo Kit'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">SKU do Kit *</label>
                  <input value={kitSku} onChange={e => setKitSku(e.target.value)}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Seller *</label>
                  <select value={sellerId} onChange={e => setSellerId(Number(e.target.value))}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">Selecione...</option>
                    {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Nome do Kit *</label>
                <input value={kitName} onChange={e => setKitName(e.target.value)}
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white/80 uppercase tracking-widest">Componentes</p>
                <button onClick={addItem} className="text-xs text-violet-400 hover:underline flex items-center gap-1">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={item.sku}
                      onChange={e => updateItem(i, 'sku', e.target.value)}
                      className="flex-1 border border-white/12 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="">SKU do componente...</option>
                      {products
                        .filter((p: any) => !sellerId || p.seller_id === sellerId)
                        .map((p: any) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
                    </select>
                    <input
                      type="number" min="1" value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                      className="w-16 border border-white/12 rounded-lg px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-violet-500"
                    />
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="text-white/35 hover:text-red-500 transition"><X size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5">
                <Check size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      </>)}

      {/* ── Log de Explosões de Kits ── */}
      {activeTab === 'log' && (
        <div className="space-y-4">
          {/* Filtro por seller */}
          <div className="flex items-center gap-3">
            <select value={logSeller} onChange={e => setLogSeller(e.target.value ? Number(e.target.value) : '')}
              className="border border-white/12 rounded-lg px-3 py-1.5 text-sm text-white/80 outline-none focus:ring-2 focus:ring-violet-500"
              style={{ background: '#14122A', colorScheme: 'dark' }}>
              <option value="">Todos os sellers</option>
              {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.trade_name}</option>)}
            </select>
            <span className="text-xs text-white/35">{expansionLog.length} explosão(ões)</span>
          </div>
          {expansionLog.length === 0 ? (
            <div className="text-center py-16 text-white/30">
              <History size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhuma explosão de kit registrada</p>
              <p className="text-xs mt-1">As explosões aparecem aqui quando pedidos com kits são importados</p>
            </div>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-white/8 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8 text-white/40 uppercase tracking-wide">
                    <th className="text-left py-2.5 px-3 font-semibold">Data</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Seller</th>
                    <th className="text-left py-2.5 px-3 font-semibold">NF</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Kit SKU</th>
                    <th className="text-left py-2.5 px-3 font-semibold">→ Componente</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Qtd</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {(expansionLog as any[]).map((row, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition">
                      <td className="py-2 px-3 text-white/40 font-mono text-[10px]">
                        {row.created_at ? format(new Date(row.created_at), 'dd/MM/yy HH:mm') : row.order_date ?? '—'}
                      </td>
                      <td className="py-2 px-3 text-violet-300 font-medium">{row.seller_name}</td>
                      <td className="py-2 px-3 text-white/50 font-mono">{row.nf_number}</td>
                      <td className="py-2 px-3">
                        <span className="bg-amber-900/30 text-amber-300 px-1.5 py-0.5 rounded font-mono text-[10px]">{row.kit_sku}</span>
                      </td>
                      <td className="py-2 px-3 text-white/70">
                        <span className="font-mono text-[10px] text-teal-300 mr-1.5">{row.component_sku}</span>
                        <span className="text-white/40">{row.component_name}</span>
                      </td>
                      <td className="py-2 px-3 text-white/60 font-bold">{row.quantity}</td>
                      <td className="py-2 px-3 text-white/40 truncate max-w-[120px]">{row.customer_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Kit Paste Modal */}
      {showKitPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-6xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white text-lg">Importar Kits em Massa</h3>
                <p className="text-xs text-white/50 mt-0.5">Cole direto do Excel. Colunas: SELLER | SKU KIT | SKU1 | QTD1 | SKU2 | QTD2 | ...</p>
              </div>
              <button onClick={() => { setShowKitPasteModal(false); setKitGrid(Array(5).fill(null).map(() => Array(KIT_COLS).fill(''))); }} className="text-white/35 hover:text-white/60"><X size={20} /></button>
            </div>

            <div className="overflow-auto border border-white/12 rounded-xl max-h-[60vh]" onPaste={handleKitPaste}>
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-white/4 sticky top-0">
                    <th className="py-2 px-2 border-b border-white/12 font-semibold text-white/60 min-w-[100px]">Seller *</th>
                    <th className="py-2 px-2 border-b border-white/12 font-semibold text-white/60 min-w-[100px]">SKU Kit *</th>
                    {Array.from({ length: KIT_MAX_COMPONENTS }, (_, i) => [
                      <th key={`sku${i}`} className="py-2 px-2 border-b border-l border-white/12 font-semibold text-blue-600 min-w-[90px]">SKU {i + 1}</th>,
                      <th key={`qty${i}`} className="py-2 px-2 border-b border-white/12 font-medium text-white/50 min-w-[50px]">Qtd {i + 1}</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {kitGrid.map((row, ri) => (
                    <tr key={ri} className="hover:bg-white/4">
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b border-r border-white/8 p-0">
                          <input type="text" value={cell}
                            onChange={e => {
                              const ng = kitGrid.map((r2, r2i) => r2i === ri ? r2.map((c2, c2i) => c2i === ci ? e.target.value : c2) : r2);
                              setKitGrid(ng);
                            }}
                            className="w-full px-2 py-1.5 text-xs outline-none focus:bg-blue-900/25" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setKitGrid(prev => [...prev, ...Array(5).fill(null).map(() => Array(KIT_COLS).fill(''))])}
                  className="text-xs text-violet-400 hover:underline">+ 5 linhas</button>
                <button onClick={() => setKitGrid(Array(5).fill(null).map(() => Array(KIT_COLS).fill('')))}
                  className="text-xs text-white/35 hover:underline">Limpar</button>
                <span className="text-xs text-white/35">{kitGrid.filter(r => r[0]?.trim() && r[1]?.trim()).length} kits válidos</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowKitPasteModal(false)}
                  className="px-4 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4">Cancelar</button>
                <button onClick={handleKitPasteSave}
                  className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg font-medium">
                  Importar {kitGrid.filter(r => r[0]?.trim() && r[1]?.trim()).length} kit(s)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
