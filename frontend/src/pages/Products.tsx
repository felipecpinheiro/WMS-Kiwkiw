/**
 * WMS Kiwkiw - Cadastro de Produtos
 * Upload Excel em massa + colagem em tabela + edição individual.
 * Recebe pré-preenchimento via navigate state (ex.: do Dashboard quando há produtos sem cadastro).
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useLocation } from 'react-router-dom';
import {
  Search, Pencil, Trash2, Camera, X, Check, Upload, ClipboardList,
  ChevronLeft, ChevronRight, RotateCcw, EyeOff, Download,
} from 'lucide-react';
import { cadastrosApi, authApi } from '../api';
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
  // Vem do próprio produto: a lista de sellers só traz ativos, então procurar o
  // nome nela deixaria o campo vazio ao editar produto de seller inativo.
  seller_name: string;
}

const EMPTY_FORM: ProductForm = {
  sku: '', name: '', barcode_seller: '',
  box_type: '', unit_value: 0, is_input: false, seller_id: '', seller_name: '',
};

// Colunas da tabela de colagem: SKU · Seller · Nome · Val. Unit. · Caixa · Cód. Barras Seller
const PASTE_HEADERS = ['SKU *', 'Seller *', 'Nome *', 'Val. Unit.', 'Caixa', 'Cód. Barras'];
const MAX_ROWS = 500;
const EMPTY_GRID = (): string[][] => Array(100).fill(null).map(() => Array(6).fill(''));

function normalizeRect(r1: number, c1: number, r2: number, c2: number) {
  return {
    r1: Math.min(r1, r2), c1: Math.min(c1, c2),
    r2: Math.max(r1, r2), c2: Math.max(c1, c2),
  };
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const location = useLocation();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : null;
  const isManager = user?.role === 'manager';

  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);

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
  const [anchor, setAnchor] = useState<[number, number]>([0, 0]);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [gridHistory, setGridHistory] = useState<string[][][]>([]);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = ['products', { page, search, sellerFilter, showInactive }];
  const { data: productsResp, isFetching } = useQuery(
    queryKey,
    () => cadastrosApi.products({
      page,
      page_size: PAGE_SIZE,
      search: search || undefined,
      seller_id: sellerFilter ? Number(sellerFilter) : undefined,
      active_only: !showInactive,
    }).then(r => r.data),
    { keepPreviousData: true },
  );

  const products      = productsResp?.items    ?? [];
  const totalProducts = productsResp?.total    ?? 0;
  const totalPages    = productsResp?.pages    ?? 1;

  const { data: meData } = useQuery(
    ['me'],
    () => authApi.me().then(r => r.data),
    { enabled: isManager, staleTime: 5 * 60 * 1000 }
  );
  const mySellerIds: number[] = (meData as any)?.seller_ids ?? [];

  const { data: allSellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));
  const sellers = isManager && mySellerIds.length > 0
    ? (allSellers as any[]).filter((s: any) => mySellerIds.includes(s.id))
    : allSellers;

  useEffect(() => {
    if (isManager && mySellerIds.length > 0 && !sellerFilter) {
      setSellerFilter(String(mySellerIds[0]));
    }
  }, [mySellerIds, isManager]);

  // Pré-preenchimento vindo do Dashboard
  useEffect(() => {
    const state = location.state as any;
    const prefill = state?.prefill as Array<{ sku: string; seller_name: string; product_name?: string }> | undefined;
    if (prefill && prefill.length > 0) {
      const newGrid = prefill.map(mp => [mp.sku, mp.seller_name, mp.product_name || '', '', '', '']);
      while (newGrid.length < 10) newGrid.push(Array(6).fill(''));
      setGrid(newGrid);
      setShowPasteModal(true);
    }
    if (state?.search) setSearch(state.search);
    if (state?.prefill || state?.search) window.history.replaceState({}, '');
  }, [location.state]);

  // ── Edit / Create ─────────────────────────────────────────
  const openEdit = (p: any) => {
    setForm({
      sku: p.sku,
      name: p.name,
      barcode_seller: p.barcode_seller || '',
      box_type: p.box_type || '',
      unit_value: p.unit_value || 0,
      is_input: p.is_input || false,
      seller_id: p.seller_id,
      seller_name: p.seller_name || '',
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
      if (photoFile && savedId) {
        await cadastrosApi.uploadProductPhoto(savedId, photoFile);
      }
      qc.invalidateQueries(['products']);
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar produto');
    }
  };

  const handleInactivate = async (id: number) => {
    if (!confirm('Inativar este produto?\n\nEle ficará oculto mas poderá ser reativado depois.')) return;
    try {
      await cadastrosApi.deleteProduct(id);
      toast.success('Produto inativado');
      qc.invalidateQueries(['products']);
    } catch {
      toast.error('Erro ao inativar');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este produto?\n\nEle será removido da listagem. O histórico de bipagem e pedidos será preservado no banco de dados, mas o produto não poderá ser reativado pela interface.')) return;
    try {
      await cadastrosApi.deleteProduct(id);
      toast.success('Produto excluído');
      qc.invalidateQueries(['products']);
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const handleReactivate = async (id: number) => {
    try {
      await cadastrosApi.reactivateProduct(id);
      toast.success('Produto reativado!');
      qc.invalidateQueries(['products']);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao reativar');
    }
  };

  // ── Excel upload ──────────────────────────────────────────
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const tid = toast.loading(`Importando ${file.name}… aguarde.`);
    try {
      const res = await cadastrosApi.bulkUploadProducts(file);
      const { created, updated, skipped, errors, sellers_not_found } = res.data;
      toast.dismiss(tid);
      toast.success(`✓ ${created} criados · ${updated} atualizados · ${skipped} ignorados`, { duration: 6000 });
      if (sellers_not_found?.length > 0) {
        toast(`Sellers não encontrados (${sellers_not_found.length}): ${sellers_not_found.slice(0, 5).join(', ')}${sellers_not_found.length > 5 ? '…' : ''}`, { icon: '⚠️', duration: 8000 });
      }
      if (errors?.length > 0) toast(`${errors.length} erro(s) adicionais`, { icon: '⚠️', duration: 6000 });
      qc.invalidateQueries(['products']);
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error(err.response?.data?.detail || err.message || 'Erro no upload', { duration: 8000 });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // ── Paste grid helpers ────────────────────────────────────
  const handleCellMouseDown = (e: React.MouseEvent, ri: number, ci: number) => {
    if (e.shiftKey) setCursor([ri, ci]);
    else { setAnchor([ri, ci]); setCursor([ri, ci]); }
  };

  const isCellSelected = (ri: number, ci: number) => {
    const { r1, c1, r2, c2 } = normalizeRect(anchor[0], anchor[1], cursor[0], cursor[1]);
    return ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  };

  const handleCopySelection = () => {
    const { r1, c1, r2, c2 } = normalizeRect(anchor[0], anchor[1], cursor[0], cursor[1]);
    const lines = [];
    for (let ri = r1; ri <= r2; ri++) lines.push(grid[ri].slice(c1, c2 + 1).join('\t'));
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      toast.success(`${(r2 - r1 + 1) * (c2 - c1 + 1)} célula(s) copiada(s)`);
    }).catch(() => toast.error('Erro ao copiar'));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    const pastedRows = text.trim().split('\n').map(r => r.split('\t'));
    const [ar, ac] = anchor;
    setGridHistory(h => [...h.slice(-20), grid.map(r => [...r])]);
    const newGrid = grid.map(r => [...r]);
    const fittingRows = pastedRows.slice(0, MAX_ROWS - ar);
    fittingRows.forEach((row, ri) => {
      const targetRow = ar + ri;
      if (targetRow >= newGrid.length) newGrid.push(Array(6).fill(''));
      row.slice(0, 6 - ac).forEach((cell, ci) => { newGrid[targetRow][ac + ci] = cell.trim(); });
    });
    if (pastedRows.length > fittingRows.length) {
      const leftOver = pastedRows.length - fittingRows.length;
      toast.error(`${leftOver} linha(s) não couberam (limite de ${MAX_ROWS}) e ficaram de fora — cole o restante em uma nova rodada.`, { duration: 8000 });
    }
    const pasteR2 = Math.min(ar + pastedRows.length - 1, MAX_ROWS - 1);
    const pasteC2 = Math.min(ac + Math.max(...pastedRows.map(r => r.length)) - 1, 5);
    setCursor([pasteR2, pasteC2]);
    setGrid([...newGrid]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); handleCopySelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      setGridHistory(h => {
        if (h.length === 0) return h;
        setGrid(h[h.length - 1]);
        return h.slice(0, -1);
      });
    }
  };

  const handleCellChange = (ri: number, ci: number, val: string) =>
    setGrid(g => g.map((r, ridx) => ridx === ri ? r.map((c, cidx) => cidx === ci ? val : c) : r));

  const handlePasteSave = async () => {
    // Linhas do próprio lote colado que repetem (seller, SKU) — o backend recusa
    // o lote inteiro se isso chegar até ele, então barra aqui e deixa quem colou decidir.
    const seenAt: Record<string, number> = {};
    const dupPairs: string[] = [];
    grid.forEach((row, ri) => {
      const sku = row[0]?.trim();
      const seller = row[1]?.trim();
      if (!sku || !seller) return;
      const key = `${seller.toLowerCase()}||${sku}`;
      if (seenAt[key] !== undefined) {
        dupPairs.push(`SKU "${sku}" (${seller}) nas linhas ${seenAt[key] + 1} e ${ri + 1}`);
      } else {
        seenAt[key] = ri;
      }
    });
    if (dupPairs.length) {
      toast.error(`SKU repetido no lote — corrija antes de salvar:\n${dupPairs.join('\n')}`, { duration: 12000 });
      return;
    }

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

  const handleDownloadTemplate = async () => {
    try {
      await cadastrosApi.downloadBulkUploadTemplate();
    } catch {
      toast.error('Erro ao baixar modelo');
    }
  };

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-t1">Produtos</h1>
          <p className="text-sm text-t3 mt-0.5">
            {totalProducts.toLocaleString('pt-BR')} produto(s){isFetching ? ' · carregando…' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-t2 bg-surface border border-line hover:bg-surface-2 rounded-lg cursor-pointer transition ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <Upload size={14} />
            {uploading ? 'Importando...' : 'Upload Excel'}
            <input ref={uploadRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden"
              onChange={handleExcelUpload} disabled={uploading} />
          </label>
          <button onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 bg-surface border border-line hover:bg-surface-2 rounded-lg transition">
            <Download size={14} />
            Baixar Modelo
          </button>
          <button onClick={() => { setGrid(EMPTY_GRID()); setShowPasteModal(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 bg-surface border border-line hover:bg-surface-2 rounded-lg transition">
            <ClipboardList size={14} /> Colar Produtos
          </button>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            + Novo Produto
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t4" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Buscar SKU ou nome..."
            type="search"
            name="product-search"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore
            className="w-full pl-7 pr-3 py-2 border border-line rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <select value={sellerFilter} onChange={e => { setSellerFilter(e.target.value); setPage(1); }}
          className="border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">Todos os sellers</option>
          {(sellers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => { setShowInactive(e.target.checked); setPage(1); }}
            className="w-4 h-4 accent-violet-500"
          />
          <span className="text-sm text-t3">Mostrar inativos</span>
        </label>
      </div>

      {/* Tabela de produtos */}
      <div className="bg-surface rounded-xl border border-line-soft shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-2 border-b border-line-soft">
                {['Foto', 'SKU', 'Nome', 'Seller', 'Cód. Barras', 'Caixa', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-t3 uppercase tracking-wide py-2.5 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.length > 0 ? products.map((p: any) => (
                <tr key={p.id} className={`border-b border-line-soft hover:bg-surface-2 transition ${!p.active ? 'opacity-40' : ''}`}>
                  <td className="py-2 px-3">
                    {p.photo_url
                      ? <img src={photoSrc(p.photo_url)!} alt={p.name} className="w-10 h-10 object-cover rounded-lg" />
                      : <div className="w-10 h-10 bg-surface-2 rounded-lg flex items-center justify-center"><Camera size={14} className="text-t5" /></div>
                    }
                  </td>
                  <td className="py-2.5 px-3 text-xs font-mono text-t3">{p.sku}</td>
                  <td className="py-2.5 px-3 text-sm text-t1 max-w-[200px] truncate">{p.name}</td>
                  <td className="py-2.5 px-3 text-sm text-t3">{p.seller_name || '—'}</td>
                  <td className="py-2.5 px-3 text-xs font-mono text-t3">{p.barcode_seller || '—'}</td>
                  <td className="py-2.5 px-3 text-sm text-t3">{p.box_type || '—'}</td>
                  <td className="py-2.5 px-3">
                    {p.active
                      ? <span className="text-xs text-ok/80">Ativo</span>
                      : <span className="text-xs text-t4">Inativo</span>
                    }
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      {p.active ? (
                        <>
                          <button onClick={() => openEdit(p)} title="Editar" className="text-t4 hover:text-violet-400 transition"><Pencil size={14} /></button>
                          <button onClick={() => handleInactivate(p.id)} title="Inativar (reversível)" className="text-t4 hover:text-warn transition"><EyeOff size={14} /></button>
                          <button onClick={() => handleDelete(p.id)} title="Excluir da listagem" className="text-t4 hover:text-bad transition"><Trash2 size={14} /></button>
                        </>
                      ) : (
                        <button onClick={() => handleReactivate(p.id)} title="Reativar produto" className="text-t4 hover:text-ok transition flex items-center gap-1 text-xs">
                          <RotateCcw size={13} /> Reativar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="text-center text-sm text-t4 py-10">Nenhum produto encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-line-soft flex items-center justify-between gap-4">
          <span className="text-xs text-t4">
            {totalProducts.toLocaleString('pt-BR')} produto(s) · página {page} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || isFetching}
              className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-surface-2 disabled:opacity-30 transition">
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const pg = start + i;
              return (
                <button key={pg} onClick={() => setPage(pg)} disabled={isFetching}
                  className={`min-w-[28px] h-7 rounded-lg text-xs transition ${pg === page ? 'bg-violet-600 text-t1 font-semibold' : 'text-t3 hover:text-t1 hover:bg-surface-2'}`}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isFetching}
              className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-surface-2 disabled:opacity-30 transition">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal Edição / Criação Individual ───────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-t1">{editId ? 'Editar Produto' : 'Novo Produto'}</h3>
              <button onClick={() => setShowModal(false)} className="text-t4 hover:text-t3"><X size={18} /></button>
            </div>

            {/* Foto */}
            <div className="flex items-center gap-4 mb-5">
              <div onClick={() => fileRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-line flex items-center justify-center cursor-pointer hover:border-ok transition overflow-hidden">
                {photoPreview
                  ? <img src={photoSrc(photoPreview)!} alt="preview" className="w-full h-full object-cover" />
                  : <Camera size={24} className="text-t5" />
                }
              </div>
              <div>
                <p className="text-sm font-medium text-t2">Foto do Produto</p>
                <p className="text-xs text-t4 mt-0.5">Clique para selecionar (exibida na bipagem)</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-t3 mb-1">SKU *</label>
                  <input type="text" value={form.sku} disabled={!!editId}
                    onChange={e => setForm(prev => ({ ...prev, sku: e.target.value }))}
                    className={`w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 ${editId ? 'bg-surface-2 text-t4 cursor-not-allowed' : ''}`} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Seller *</label>
                  {editId ? (
                    <p className="w-full border border-line-soft bg-surface-2 rounded-lg px-3 py-2 text-sm text-t4">
                      {form.seller_name
                        || (sellers as any[]).find((s: any) => s.id === form.seller_id)?.trade_name
                        || '—'}
                    </p>
                  ) : (
                    <select value={form.seller_id} onChange={e => setForm(prev => ({ ...prev, seller_id: Number(e.target.value) }))}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                      <option value="">Selecione...</option>
                      {(sellers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>)}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-t3 mb-1">Nome *</label>
                <input type="text" value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-t3 mb-1">Cód. Barras Seller</label>
                  <input type="text" value={form.barcode_seller}
                    onChange={e => setForm(prev => ({ ...prev, barcode_seller: e.target.value }))}
                    placeholder="Código impresso na embalagem"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Caixa</label>
                  <input type="text" value={form.box_type}
                    onChange={e => setForm(prev => ({ ...prev, box_type: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-t3 mb-1">Valor Unitário (R$)</label>
                <input type="number" step="0.01" value={form.unit_value}
                  onChange={e => setForm(prev => ({ ...prev, unit_value: Number(e.target.value) }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id="is_input" checked={form.is_input}
                  onChange={e => setForm(prev => ({ ...prev, is_input: e.target.checked }))}
                  className="w-4 h-4 accent-green-600" />
                <label htmlFor="is_input" className="text-sm text-t2">É insumo (material de embalagem)</label>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-t3 border border-line rounded-lg hover:bg-surface-2 transition">
                Cancelar
              </button>
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm text-t1 bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5">
                <Check size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Colar Produtos em Massa ─────────────────── */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-4 overflow-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">Colar Produtos em Massa</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Cole direto do Excel (Ctrl+V) · Clique/Shift+clique para selecionar · Ctrl+C copia · Ctrl+Z desfaz
                </p>
              </div>
              <button onClick={() => { setShowPasteModal(false); setGrid(EMPTY_GRID()); setAnchor([0, 0]); setCursor([0, 0]); }}
                className="text-gray-400 hover:text-gray-700 transition"><X size={20} /></button>
            </div>

            <div className="overflow-auto max-h-[60vh] select-none" onPaste={handlePaste} onKeyDown={handleKeyDown} tabIndex={0} style={{ outline: 'none' }}>
              <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  {PASTE_HEADERS.map((_, i) => <col key={i} style={{ width: i === 2 ? 220 : 140 }} />)}
                </colgroup>
                <thead>
                  <tr className="bg-gray-100 sticky top-0 z-10">
                    <th className="py-2 px-1 text-center border border-gray-300 text-gray-400 text-xs font-normal">#</th>
                    {PASTE_HEADERS.map((h, ci) => {
                      const { c1, c2 } = normalizeRect(anchor[0], anchor[1], cursor[0], cursor[1]);
                      const colSelected = ci >= c1 && ci <= c2;
                      return (
                        <th key={ci}
                          onMouseDown={(e) => { e.preventDefault(); if (e.shiftKey) { setCursor([cursor[0], ci]); } else { setAnchor([0, ci]); setCursor([grid.length - 1, ci]); } }}
                          className={`py-2 px-2 text-left border border-gray-300 font-semibold text-xs cursor-pointer select-none transition ${colSelected ? 'bg-blue-100 text-info' : 'text-gray-600 hover:bg-gray-200'}`}>
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, ri) => {
                    const hasData = row[0]?.trim() || row[2]?.trim();
                    return (
                      <tr key={ri} className={hasData ? 'bg-green-50' : 'bg-white hover:bg-gray-50'}>
                        <td className="py-1 px-1 text-center border border-gray-200 text-gray-400 text-[11px] font-mono bg-gray-50 select-none">{ri + 1}</td>
                        {row.map((cell, ci) => {
                          const selected = isCellSelected(ri, ci);
                          const isAnchor = ri === anchor[0] && ci === anchor[1];
                          return (
                            <td key={ci} className={`border p-0 ${selected ? 'border-info' : 'border-gray-200'}`}
                              style={{ background: selected ? '#DBEAFE' : undefined }}
                              onMouseDown={(e) => handleCellMouseDown(e, ri, ci)}>
                              <input type="text" value={cell} onChange={e => handleCellChange(ri, ci, e.target.value)}
                                onFocus={() => { setAnchor([ri, ci]); setCursor([ri, ci]); }}
                                className="w-full px-2 py-1.5 text-xs text-gray-900 bg-transparent outline-none"
                                style={isAnchor ? { boxShadow: 'inset 0 0 0 2px #2563EB' } : undefined}
                                placeholder={!cell ? PASTE_HEADERS[ci].replace(' *', '') : ''} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <button onClick={() => setGrid(prev => [...prev, ...Array(20).fill(null).map(() => Array(6).fill(''))])}
                  className="text-xs text-violet-600 hover:text-violet-800 hover:underline font-medium">+ 20 linhas</button>
                <button onClick={() => { setGrid(EMPTY_GRID()); setAnchor([0, 0]); setCursor([0, 0]); setGridHistory([]); }}
                  className="text-xs text-gray-400 hover:text-gray-700 hover:underline">Limpar tudo</button>
                <span className="text-xs text-gray-500">{validRows} linha(s) válida(s) · {grid.length} linhas totais</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowPasteModal(false); setGrid(EMPTY_GRID()); setAnchor([0, 0]); setCursor([0, 0]); }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition">Cancelar</button>
                <button onClick={handlePasteSave} disabled={saving || validRows === 0}
                  className="px-5 py-2 text-sm font-semibold text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-40 flex items-center gap-1.5">
                  {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {saving ? 'Salvando...' : `Salvar ${validRows} produto(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
