/**
 * WMS Kiwkiw - Cadastro de Produtos
 * Upload Excel em massa + colagem em tabela + edição individual.
 * Recebe pré-preenchimento via navigate state (ex.: do Dashboard quando há produtos sem cadastro).
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useLocation } from 'react-router-dom';
import { Search, Pencil, Trash2, Camera, X, Check, Upload, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
/** Converte photo_url relativo (/media/...) para URL absoluta do backend. */
const photoSrc = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${API_BASE}${url}`) : null;

interface ProductForm {
  sku: string;
  name: string;
  barcode_seller: string;
  box_type: string;
  unit_value: number;
  is_input: boolean;
  seller_id: number | '';
}

const EMPTY_FORM: ProductForm = {
  sku: '', name: '', barcode_seller: '',
  box_type: '', unit_value: 0, is_input: false, seller_id: '',
};

// Colunas da tabela de colagem: SKU · Seller · Nome · Val. Unit. · Caixa · Cód. Barras Seller
const PASTE_HEADERS = ['SKU *', 'Seller *', 'Nome *', 'Val. Unit.', 'Caixa', 'Cód. Barras'];
const MAX_ROWS = 200;
const EMPTY_GRID = (): string[][] => Array(10).fill(null).map(() => Array(6).fill(''));

export default function ProductsPage() {
  const qc = useQueryClient();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');

  // Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Excel upload
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Paste modal
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [grid, setGrid] = useState<string[][]>(EMPTY_GRID());
  const [saving, setSaving] = useState(false);
  // Paste grid: célula âncora (onde começa a colagem) + histórico de undo
  const [anchorCell, setAnchorCell] = useState<[number, number]>([0, 0]);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [gridHistory, setGridHistory] = useState<string[][][]>([]);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  // Debounce da busca para não disparar request a cada tecla
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = ['products', { page, search, sellerFilter }];
  const { data: productsResp, isFetching } = useQuery(
    queryKey,
    () => cadastrosApi.products({
      page,
      page_size: PAGE_SIZE,
      search: search || undefined,
      seller_id: sellerFilter ? Number(sellerFilter) : undefined,
    }).then(r => r.data),
    { keepPreviousData: true },
  );

  const products      = productsResp?.items    ?? [];
  const totalProducts = productsResp?.total    ?? 0;
  const totalPages    = productsResp?.pages    ?? 1;

  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  // Se o Dashboard navegou para cá com uma lista de produtos faltantes, pré-preenche a grid
  useEffect(() => {
    const state = location.state as any;

    // Prefill da grid de cadastro em massa (vindo do Dashboard)
    const prefill = state?.prefill as Array<{ sku: string; seller_name: string; product_name?: string }> | undefined;
    if (prefill && prefill.length > 0) {
      // Colunas: SKU · Seller · Nome · Val. Unit. · Caixa · Cód. Barras
      const newGrid = prefill.map(mp => [mp.sku, mp.seller_name, mp.product_name || '', '', '', '']);
      while (newGrid.length < 10) newGrid.push(Array(6).fill(''));
      setGrid(newGrid);
      setShowPasteModal(true);
    }

    // Busca direta (vindo do Scanner — "ver detalhes do produto")
    if (state?.search) {
      setSearch(state.search);
    }

    // Limpa o state para não re-disparar se o usuário voltar
    if (state?.prefill || state?.search) {
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Filtragem feita no servidor

  // ── Edit ─────────────────────────────────────────────────
  const openEdit = (p: any) => {
    setForm({
      sku: p.sku,
      name: p.name,
      barcode_seller: p.barcode_seller || '',
      box_type: p.box_type || '',
      unit_value: p.unit_value || 0,
      is_input: p.is_input || false,
      seller_id: p.seller_id,
    });
    setEditId(p.id);
    setPhotoFile(null);
    setPhotoPreview(p.photo_url || null);
    setShowModal(true);
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setPhotoFile(null);
    setPhotoPreview(null);
    setShowModal(true);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const handleSave = async () => {
    if (!form.sku || !form.name || !form.seller_id) {
      toast.error('SKU, nome e seller são obrigatórios');
      return;
    }
    try {
      let savedId: number;

      if (editId) {
        // Atualiza via JSON
        const res = await cadastrosApi.updateProduct(editId, {
          name: form.name,
          barcode_seller: form.barcode_seller || undefined,
          box_type: form.box_type || undefined,
          unit_value: form.unit_value,
          is_input: form.is_input,
        });
        savedId = (res.data as any).id ?? editId;
        toast.success('Produto atualizado!');
      } else {
        // Cria via JSON
        const res = await cadastrosApi.createProduct({
          seller_id: Number(form.seller_id),
          sku: form.sku,
          name: form.name,
          barcode_seller: form.barcode_seller || undefined,
          box_type: form.box_type || undefined,
          unit_value: form.unit_value,
          is_input: form.is_input,
        });
        savedId = (res.data as any).id;
        toast.success('Produto criado!');
      }

      // Upload de foto separado, se o usuário selecionou uma
      if (photoFile && savedId) {
        await cadastrosApi.uploadProductPhoto(savedId, photoFile);
      }

      qc.invalidateQueries(['products']);
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar produto');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este produto?')) return;
    try {
      await cadastrosApi.deleteProduct(id);
      toast.success('Produto excluído');
      qc.invalidateQueries(['products']);
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  // ── Excel upload ──────────────────────────────────────────
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const tid = toast.loading(`Importando ${file.name}… aguarde, pode demorar alguns minutos para planilhas grandes.`);
    try {
      const res = await cadastrosApi.bulkUploadProducts(file);
      const { created, updated, skipped, errors, sellers_not_found } = res.data;
      toast.dismiss(tid);
      toast.success(`✓ ${created} criados · ${updated} atualizados · ${skipped} ignorados`, { duration: 6000 });
      if (sellers_not_found?.length > 0) {
        toast(`Sellers não encontrados (${sellers_not_found.length}): ${sellers_not_found.slice(0,5).join(', ')}${sellers_not_found.length > 5 ? '…' : ''}`, { icon: '⚠️', duration: 8000 });
      }
      if (errors?.length > 0) {
        toast(`${errors.length} erro(s) adicionais`, { icon: '⚠️', duration: 6000 });
      }
      qc.invalidateQueries(['products']);
    } catch (err: any) {
      toast.dismiss(tid);
      const msg = err.response?.data?.detail || err.message || 'Erro no upload';
      toast.error(`Falha no upload: ${msg}`, { duration: 8000 });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };


  // Ctrl+C quando uma coluna está selecionada: copia os valores para o clipboard
  const handleCopyColumn = (ci: number) => {
    const values = grid.map(r => r[ci] ?? '').join('\n');
    navigator.clipboard.writeText(values).then(() => {
      toast.success(`Coluna "${PASTE_HEADERS[ci].replace(' *','')}" copiada (${grid.filter(r => r[ci]).length} valores)`);
    }).catch(() => toast.error('Erro ao copiar'));
  };

  // ── Paste grid (Excel-like: cola a partir da célula âncora, Ctrl+Z desfaz) ──
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    const pastedRows = text.trim().split('\n').map(r => r.split('\t'));
    const [ar, ac] = anchorCell;
    // Salva estado atual no histórico de undo
    setGridHistory(h => [...h.slice(-20), grid.map(r => [...r])]);
    const newGrid = grid.map(r => [...r]);
    pastedRows.slice(0, MAX_ROWS - ar).forEach((row, ri) => {
      const targetRow = ar + ri;
      if (targetRow >= newGrid.length) newGrid.push(Array(6).fill(''));
      row.slice(0, 6 - ac).forEach((cell, ci) => {
        newGrid[targetRow][ac + ci] = cell.trim();
      });
    });
    while (newGrid.length < 10) newGrid.push(Array(6).fill(''));
    setGrid([...newGrid]);
  };

  // Ctrl+Z: desfaz último paste
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedCol !== null) {
      e.preventDefault();
      handleCopyColumn(selectedCol);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      setGridHistory(h => {
        if (h.length === 0) return h;
        const prev = h[h.length - 1];
        setGrid(prev);
        return h.slice(0, -1);
      });
    }
  };

  const handleCellChange = (ri: number, ci: number, val: string) =>
    setGrid(g => g.map((r, ridx) => ridx === ri ? r.map((c, cidx) => cidx === ci ? val : c) : r));

  const handlePasteSave = async () => {
    const items = grid.filter(row => row[0]?.trim() && row[2]?.trim()).map(row => ({
      sku: row[0].trim(),
      seller_name: row[1].trim(),
      name: row[2].trim(),
      unit_value: row[3] ? parseFloat(row[3].replace(',', '.')) || undefined : undefined,
      box_type: row[4].trim() || undefined,
      barcode_seller: row[5].trim() || undefined,
    }));
    if (!items.length) { toast.error('Nenhum dado válido (SKU e Nome são obrigatórios)'); return; }
    setSaving(true);
    try {
      const res = await cadastrosApi.bulkPasteProducts(items);
      const { created, updated, errors } = res.data;
      toast.success(`✓ ${created} criados, ${updated} atualizados`);
      if (errors?.length) toast(`${errors.length} erro(s)`, { icon: '⚠️' });
      qc.invalidateQueries(['products']);
      setShowPasteModal(false);
      setGrid(EMPTY_GRID());
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const validRows = grid.filter(r => r[0]?.trim() && r[2]?.trim()).length;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Produtos</h1>
          <p className="text-sm text-white/50 mt-0.5">{totalProducts.toLocaleString('pt-BR')} produto(s) cadastrado(s){isFetching ? ' · carregando…' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white/80 bg-gray-900 border border-white/12 hover:bg-white/4 rounded-lg cursor-pointer transition ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <Upload size={14} />
            {uploading ? 'Importando...' : 'Upload Excel'}
            <input ref={uploadRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden"
              onChange={handleExcelUpload} disabled={uploading} />
          </label>
          <button onClick={() => { setGrid(EMPTY_GRID()); setShowPasteModal(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/80 bg-gray-900 border border-white/12 hover:bg-white/4 rounded-lg transition">
            <ClipboardList size={14} /> Colar Produtos
          </button>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            + Novo Produto
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Buscar SKU ou nome..."
            className="w-full pl-7 pr-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <select value={sellerFilter} onChange={e => { setSellerFilter(e.target.value); setPage(1); }}
          className="border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">Todos os sellers</option>
          {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Tabela de produtos */}
      <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-white/4 border-b border-white/8">
                {['Foto', 'SKU', 'Nome', 'Seller', 'Cód. Barras', 'Caixa', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.length > 0 ? products.map((p: any) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/4">
                  <td className="py-2 px-3">
                    {p.photo_url
                      ? <img src={photoSrc(p.photo_url)!} alt={p.name} className="w-10 h-10 object-cover rounded-lg" />
                      : <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center"><Camera size={14} className="text-white/25" /></div>
                    }
                  </td>
                  <td className="py-2.5 px-3 text-xs font-mono text-white/60">{p.sku}</td>
                  <td className="py-2.5 px-3 text-sm text-white/90 max-w-[200px] truncate">{p.name}</td>
                  <td className="py-2.5 px-3 text-sm text-white/50">{p.seller_name || '—'}</td>
                  <td className="py-2.5 px-3 text-xs font-mono text-white/50">{p.barcode_seller || '—'}</td>
                  <td className="py-2.5 px-3 text-sm text-white/50">{p.box_type || '—'}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(p)} className="text-white/35 hover:text-violet-400 transition"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(p.id)} className="text-white/35 hover:text-red-500 transition"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="text-center text-sm text-white/35 py-10">Nenhum produto encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-white/8 flex items-center justify-between gap-4">
          <span className="text-xs text-white/35">
            {totalProducts.toLocaleString('pt-BR')} produto(s) · página {page} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-30 transition"
            >
              <ChevronLeft size={14} />
            </button>
            {/* Páginas próximas */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  disabled={isFetching}
                  className={`min-w-[28px] h-7 rounded-lg text-xs transition ${p === page ? 'bg-violet-600 text-white font-semibold' : 'text-white/50 hover:text-white hover:bg-white/8'}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-30 transition"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal Edição / Criação Individual ───────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">{editId ? 'Editar Produto' : 'Novo Produto'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>

            {/* Foto */}
            <div className="flex items-center gap-4 mb-5">
              <div onClick={() => fileRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-white/12 flex items-center justify-center cursor-pointer hover:border-emerald-400 transition overflow-hidden">
                {photoPreview
                  ? <img src={photoSrc(photoPreview)!} alt="preview" className="w-full h-full object-cover" />
                  : <Camera size={24} className="text-white/25" />
                }
              </div>
              <div>
                <p className="text-sm font-medium text-white/80">Foto do Produto</p>
                <p className="text-xs text-white/35 mt-0.5">Clique para selecionar (exibida na bipagem)</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* SKU — somente leitura ao editar */}
              <div>
                <label className="block text-xs text-white/50 mb-1">SKU *</label>
                <input
                  type="text"
                  value={form.sku}
                  disabled={!!editId}
                  onChange={e => setForm(prev => ({ ...prev, sku: e.target.value }))}
                  className={`w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 ${editId ? 'bg-white/5 text-white/30 cursor-not-allowed' : ''}`}
                />
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Caixa</label>
                <input type="text" value={form.box_type}
                  onChange={e => setForm(prev => ({ ...prev, box_type: e.target.value }))}
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-white/50 mb-1">Nome *</label>
                <input type="text" value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-white/50 mb-1">Cód. Barras Seller</label>
                <input type="text" value={form.barcode_seller}
                  onChange={e => setForm(prev => ({ ...prev, barcode_seller: e.target.value }))}
                  placeholder="Código impresso na embalagem"
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 font-mono" />
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Valor Unitário</label>
                <input type="number" step="0.01" value={form.unit_value}
                  onChange={e => setForm(prev => ({ ...prev, unit_value: Number(e.target.value) }))}
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              {/* Seller — somente leitura ao editar */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Seller *</label>
                {editId ? (
                  <p className="w-full border border-white/8 bg-white/4 rounded-lg px-3 py-2 text-sm text-white/35">
                    {sellers.find((s: any) => s.id === form.seller_id)?.name || '—'}
                  </p>
                ) : (
                  <select value={form.seller_id} onChange={e => setForm(prev => ({ ...prev, seller_id: Number(e.target.value) }))}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">Selecione...</option>
                    {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>

              <div className="col-span-2 flex items-center gap-2 pt-1">
                <input type="checkbox" id="is_input" checked={form.is_input}
                  onChange={e => setForm(prev => ({ ...prev, is_input: e.target.checked }))}
                  className="w-4 h-4 accent-green-600" />
                <label htmlFor="is_input" className="text-sm text-white/80">É insumo (material de embalagem)</label>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">
                Cancelar
              </button>
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5">
                <Check size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Colar Produtos em Massa ─────────────────── */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-5xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white text-lg">Colar Produtos em Massa</h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Cole direto do Excel (Ctrl+V). Colunas: SKU · Seller · Nome · Val.Unit · Caixa · Cód.Barras
                </p>
              </div>
              <button onClick={() => { setShowPasteModal(false); setGrid(EMPTY_GRID()); }}
                className="text-white/35 hover:text-white/60"><X size={20} /></button>
            </div>

            <div className="overflow-auto border border-white/12 rounded-xl max-h-[55vh]" onPaste={handlePaste} onKeyDown={handleKeyDown}>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-white/4 sticky top-0 z-10">
                    <th className="py-2 px-1 text-center border-b border-white/12 text-white/35 w-8">#</th>
                    {PASTE_HEADERS.map((h, ci) => (
                      <th key={ci}
                        onClick={() => { setSelectedCol(ci === selectedCol ? null : ci); }}
                        title={ci === selectedCol ? 'Ctrl+C para copiar coluna' : 'Clique para selecionar coluna'}
                        className={`py-2 px-2 text-left border-b border-white/12 font-semibold min-w-[130px] cursor-pointer select-none transition ${ci === selectedCol ? 'text-violet-300 bg-violet-900/30' : 'text-white/60 hover:text-white/80'}`}>
                        {h}{ci === selectedCol ? ' ✓' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, ri) => (
                    <tr key={ri} className={row[0]?.trim() ? 'bg-violet-900/30' : 'hover:bg-white/4'}>
                      <td className="py-1 px-1 text-center text-white/25 border-b border-white/8 text-[10px]">{ri + 1}</td>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b border-r border-white/8 p-0">
                          <input type="text" value={cell}
                            onChange={e => handleCellChange(ri, ci, e.target.value)}
                            onFocus={() => setAnchorCell([ri, ci])}
                            className={`w-full px-2 py-1.5 text-xs border-0 outline-none focus:bg-violet-900/30 rounded ${ci === selectedCol ? 'bg-violet-900/20' : ''}`}
                            placeholder={PASTE_HEADERS[ci].replace(' *', '')} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <button onClick={() => setGrid(prev => [...prev, ...Array(5).fill(null).map(() => Array(6).fill(''))])}
                  className="text-xs text-violet-400 hover:underline">+ 5 linhas</button>
                <button onClick={() => setGrid(EMPTY_GRID())} className="text-xs text-white/35 hover:underline">Limpar tudo</button>
                <span className="text-xs text-white/35">{validRows} linha(s) válida(s)</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowPasteModal(false); setGrid(EMPTY_GRID()); }}
                  className="px-4 py-2 text-sm text-white/60 hover:text-white/90 transition">
                  Cancelar
                </button>
                <button
                  onClick={handlePasteSave}
                  disabled={saving || validRows === 0}
                  className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-40"
                >
                  {saving ? 'Salvando...' : `Salvar ${validRows} produto(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edicao / Criacao Individual */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">{editId ? 'Editar Produto' : 'Novo Produto'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">SKU *</label>
                  <input value={form.sku} onChange={e => setForm(f => ({...f, sku: e.target.value}))}
                    disabled={!!editId}
                    className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Seller *</label>
                  <select value={form.seller_id} onChange={e => setForm(f => ({...f, seller_id: Number(e.target.value)}))}
                    disabled={!!editId}
                    className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50">
                    <option value="">Selecione...</option>
                    {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.trade_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Nome *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">Cod. Barras Seller</label>
                  <input value={form.barcode_seller} onChange={e => setForm(f => ({...f, barcode_seller: e.target.value}))}
                    className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Tipo de Caixa</label>
                  <input value={form.box_type} onChange={e => setForm(f => ({...f, box_type: e.target.value}))}
                    className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">Valor Unitario (R$)</label>
                  <input type="number" step="0.01" value={form.unit_value} onChange={e => setForm(f => ({...f, unit_value: Number(e.target.value)}))}
                    className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input type="checkbox" id="is_input" checked={form.is_input} onChange={e => setForm(f => ({...f, is_input: e.target.checked}))}
                    className="rounded" />
                  <label htmlFor="is_input" className="text-sm text-white/70">E produto de entrada</label>
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Foto do Produto</label>
                <div className="flex items-center gap-3">
                  {photoPreview
                    ? <img src={photoPreview} alt="preview" className="w-16 h-16 object-cover rounded-lg" />
                    : <div className="w-16 h-16 bg-white/5 rounded-lg flex items-center justify-center"><Camera size={20} className="text-white/25" /></div>
                  }
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 text-xs text-white/70 border border-white/12 rounded-lg hover:bg-white/5 transition">
                    {photoPreview ? 'Trocar foto' : 'Adicionar foto'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-white/60 hover:text-white/90">Cancelar</button>
              <button onClick={handleSave}
                className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
                {editId ? 'Salvar alteracoes' : 'Criar produto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
