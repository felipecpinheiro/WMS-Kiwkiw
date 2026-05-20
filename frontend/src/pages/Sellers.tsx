/**
 * WMS Kiwkiw - Cadastro de Sellers
 * Campos comerciais completos + importação em massa via paste.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Plus, Pencil, Trash2, X, Check, Store, ClipboardList, Upload, FileText, ExternalLink } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

interface SellerForm {
  name: string; code: string; cnpj: string; contact_name: string;
  contact_email: string; contact_phone: string; unit_name: string; is_active: boolean;
  caixa_b2b: string; manuseio_b2b: string; qtd_franquia_b2b: string;
  valor_adicional_b2b: string; num_min_pedidos: string; preco_unitario: string;
  caixa_inclusa: boolean; seguro_incluso: boolean; armazenagem_incluso: boolean;
  valor_segurado: string; franquia: string; preco_adicional: string;
  caixa1: string; caixa2: string; caixa3: string; caixa4: string;
  caixa5: string; caixa6: string; caixa7: string; caixa8: string;
  manuseio: string; caixa_prop: boolean; mes_reajuste: string;
}

const EMPTY: SellerForm = {
  name: '', code: '', cnpj: '', contact_name: '', contact_email: '', contact_phone: '',
  unit_name: '', is_active: true,
  caixa_b2b: '', manuseio_b2b: '', qtd_franquia_b2b: '', valor_adicional_b2b: '',
  num_min_pedidos: '', preco_unitario: '', caixa_inclusa: false, seguro_incluso: false,
  armazenagem_incluso: false, valor_segurado: '', franquia: '', preco_adicional: '',
  caixa1: '', caixa2: '', caixa3: '', caixa4: '', caixa5: '', caixa6: '', caixa7: '', caixa8: '',
  manuseio: '', caixa_prop: false, mes_reajuste: '',
};

const PASTE_HEADERS = ['Nome *','Código','CNPJ','Contato','Email','Telefone','Unidade','Preço Unit.','Manuseio','Cx Inclusa?','Caixa1','Caixa2','Caixa3'];

export default function SellersPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<SellerForm>(EMPTY);
  const [search, setSearch] = useState('');
  const [formTab, setFormTab] = useState<'basic' | 'comercial' | 'caixas' | 'experiencia'>('basic');

  // Paste modal
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [sellerGrid, setSellerGrid] = useState<string[][]>(Array(5).fill(null).map(() => Array(13).fill('')));
  const [pasting, setPasting] = useState(false);
  const [anchorCell, setAnchorCell] = useState<[number, number]>([0, 0]);
  const [gridHistory, setGridHistory] = useState<string[][][]>([]);

  // Experience file upload state
  const [expFile, setExpFile] = useState<File | null>(null);
  const [expUploading, setExpUploading] = useState(false);
  const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

  const handleExpUpload = async (sellerId: number) => {
    if (!expFile) return;
    setExpUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', expFile);
      await fetch(`${API_BASE}/cadastros/sellers/${sellerId}/experience-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('wms_token') ?? ''}` },
        body: fd,
      });
      toast.success('Arquivo de experiência salvo!');
      setExpFile(null);
      qc.invalidateQueries('sellers');
    } catch {
      toast.error('Erro ao salvar arquivo de experiência');
    } finally {
      setExpUploading(false);
    }
  };

  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  const filtered = sellers.filter((s: any) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => { setForm(EMPTY); setEditId(null); setFormTab('basic'); setShowModal(true); };
  const openEdit = (s: any) => {
    setForm({
      name: s.name || '', code: s.code || '', cnpj: s.cnpj || '',
      contact_name: s.contact_name || '', contact_email: s.contact_email || '',
      contact_phone: s.contact_phone || '', unit_name: s.unit_name || '',
      is_active: s.active ?? s.is_active ?? true,
      caixa_b2b: s.caixa_b2b != null ? String(s.caixa_b2b) : '',
      manuseio_b2b: s.manuseio_b2b != null ? String(s.manuseio_b2b) : '',
      qtd_franquia_b2b: s.qtd_franquia_b2b != null ? String(s.qtd_franquia_b2b) : '',
      valor_adicional_b2b: s.valor_adicional_b2b != null ? String(s.valor_adicional_b2b) : '',
      num_min_pedidos: s.num_min_pedidos != null ? String(s.num_min_pedidos) : '',
      preco_unitario: s.preco_unitario != null ? String(s.preco_unitario) : '',
      caixa_inclusa: s.caixa_inclusa ?? false, seguro_incluso: s.seguro_incluso ?? false,
      armazenagem_incluso: s.armazenagem_incluso ?? false,
      valor_segurado: s.valor_segurado != null ? String(s.valor_segurado) : '',
      franquia: s.franquia != null ? String(s.franquia) : '',
      preco_adicional: s.preco_adicional != null ? String(s.preco_adicional) : '',
      caixa1: s.caixa1 || '', caixa2: s.caixa2 || '', caixa3: s.caixa3 || '',
      caixa4: s.caixa4 || '', caixa5: s.caixa5 || '', caixa6: s.caixa6 || '',
      caixa7: s.caixa7 || '', caixa8: s.caixa8 || '',
      manuseio: s.manuseio != null ? String(s.manuseio) : '',
      caixa_prop: s.caixa_prop ?? false,
      mes_reajuste: s.mes_reajuste != null ? String(s.mes_reajuste) : '',
    });
    setEditId(s.id); setFormTab('basic'); setShowModal(true);
  };

  const pf = (v: string) => v ? parseFloat(v.replace(',', '.')) || undefined : undefined;
  const pi = (v: string) => v ? parseInt(v) || undefined : undefined;

  const buildPayload = () => ({
    name: form.name,
    trade_name: form.code || form.name,   // trade_name = apelido/código; obrigatório no banco
    code: form.code || undefined, cnpj: form.cnpj || undefined,
    contact_name: form.contact_name || undefined, contact_email: form.contact_email || undefined,
    contact_phone: form.contact_phone || undefined, unit_name: form.unit_name || undefined,
    active: form.is_active,   // campo canônico no modelo DB
    caixa_b2b: pf(form.caixa_b2b), manuseio_b2b: pf(form.manuseio_b2b),
    qtd_franquia_b2b: pi(form.qtd_franquia_b2b), valor_adicional_b2b: pf(form.valor_adicional_b2b),
    num_min_pedidos: pi(form.num_min_pedidos), preco_unitario: pf(form.preco_unitario),
    caixa_inclusa: form.caixa_inclusa, seguro_incluso: form.seguro_incluso,
    armazenagem_incluso: form.armazenagem_incluso, valor_segurado: pf(form.valor_segurado),
    franquia: pf(form.franquia), preco_adicional: pf(form.preco_adicional),
    caixa1: form.caixa1 || undefined, caixa2: form.caixa2 || undefined,
    caixa3: form.caixa3 || undefined, caixa4: form.caixa4 || undefined,
    caixa5: form.caixa5 || undefined, caixa6: form.caixa6 || undefined,
    caixa7: form.caixa7 || undefined, caixa8: form.caixa8 || undefined,
    manuseio: pf(form.manuseio), caixa_prop: form.caixa_prop,
    mes_reajuste: pi(form.mes_reajuste),
  });

  const handleSave = async () => {
    if (!form.name) { toast.error('Nome é obrigatório'); return; }
    try {
      const payload = buildPayload();
      if (editId) { await cadastrosApi.updateSeller(editId, payload); toast.success('Seller atualizado!'); }
      else { await cadastrosApi.createSeller(payload); toast.success('Seller criado!'); }
      qc.invalidateQueries('sellers'); setShowModal(false);
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro ao salvar'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este seller?')) return;
    try { await cadastrosApi.deleteSeller(id); toast.success('Seller excluído'); qc.invalidateQueries('sellers'); }
    catch { toast.error('Erro ao excluir'); }
  };

  const f = (key: keyof SellerForm, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  // Paste modal
  const handleGridPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    const pastedRows = text.trim().split('\n').map(r => r.split('\t'));
    const [ar, ac] = anchorCell;
    setGridHistory(h => [...h.slice(-20), sellerGrid.map(r => [...r])]);
    const newGrid = sellerGrid.map(r => [...r]);
    pastedRows.slice(0, 100 - ar).forEach((row, ri) => {
      const targetRow = ar + ri;
      if (targetRow >= newGrid.length) newGrid.push(Array(13).fill(''));
      row.slice(0, 13 - ac).forEach((cell, ci) => {
        newGrid[targetRow][ac + ci] = cell.trim();
      });
    });
    while (newGrid.length < 5) newGrid.push(Array(13).fill(''));
    setSellerGrid([...newGrid]);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      setGridHistory(h => {
        if (h.length === 0) return h;
        const prev = h[h.length - 1];
        setSellerGrid(prev);
        return h.slice(0, -1);
      });
    }
  };

  const handlePasteSave = async () => {
    const items = sellerGrid.filter(row => row[0]?.trim()).map(row => ({
      name: row[0].trim(), trade_name: row[1]?.trim() || row[0].trim(),
      cnpj: row[2]?.trim() || undefined, contact_name: row[3]?.trim() || undefined,
      contact_email: row[4]?.trim() || undefined, contact_phone: row[5]?.trim() || undefined,
      unit_name: row[6]?.trim() || undefined,
      preco_unitario: row[7] ? parseFloat(row[7].replace(',', '.')) || undefined : undefined,
      manuseio: row[8] ? parseFloat(row[8].replace(',', '.')) || undefined : undefined,
      caixa_inclusa: ['sim','yes','s','x','1','true'].includes((row[9] || '').toLowerCase()),
      caixa1: row[10]?.trim() || undefined, caixa2: row[11]?.trim() || undefined, caixa3: row[12]?.trim() || undefined,
    }));
    if (!items.length) { toast.error('Nenhum seller válido'); return; }
    setPasting(true);
    try {
      await Promise.all(items.map(s => cadastrosApi.createSeller(s)));
      toast.success(`${items.length} seller(s) criado(s)!`);
      qc.invalidateQueries('sellers');
      setShowPasteModal(false);
      setSellerGrid(Array(5).fill(null).map(() => Array(13).fill('')));
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro ao criar sellers'); }
    finally { setPasting(false); }
  };

  const cls = 'w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500';
  const validPasteRows = sellerGrid.filter(r => r[0]?.trim()).length;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Sellers</h1>
          <p className="text-sm text-white/50 mt-0.5">{sellers.length} seller(s) cadastrado(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPasteModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/80 bg-gray-900 border border-white/12 hover:bg-white/4 rounded-lg transition">
            <ClipboardList size={14} /> Colar Sellers
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            <Plus size={14} /> Novo Seller
          </button>
        </div>
      </div>

      {/* Busca */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por nome ou código..."
        className="w-full max-w-xs border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />

      {/* Tabela */}
      <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-white/4 border-b border-white/8">
              {['Seller','Código','CNPJ','Contato','E-mail','Status',''].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-white/50 uppercase tracking-wide py-2.5 px-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? filtered.map((s: any) => (
              <tr key={s.id} className="border-b border-white/5 hover:bg-white/4">
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-violet-900/40 rounded-lg flex items-center justify-center">
                      <span className="text-violet-300 text-xs font-bold">{s.name.charAt(0)}</span>
                    </div>
                    <span className="text-sm font-medium text-white/90">{s.name}</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-xs font-mono text-white/50">{s.code || '—'}</td>
                <td className="py-2.5 px-3 text-xs font-mono text-white/50">{s.cnpj || '—'}</td>
                <td className="py-2.5 px-3 text-sm text-white/50">{s.contact_name || '—'}</td>
                <td className="py-2.5 px-3 text-sm text-white/50">{s.contact_email || '—'}</td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-violet-900/40 text-violet-300' : 'bg-white/8 text-white/40 border border-white/8'}`}>
                    {s.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(s)} className="text-white/35 hover:text-violet-400 transition"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(s.id)} className="text-white/35 hover:text-red-500 transition"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="text-center py-10">
                <Store size={28} className="text-white/25 mx-auto mb-2" />
                <p className="text-sm text-white/35">Nenhum seller encontrado</p>
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">{filtered.length} seller(s)</div>
      </div>

      {/* ── Modal Edição/Criação ──────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-lg">{editId ? 'Editar Seller' : 'Novo Seller'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/12 mb-5">
              {(['basic','comercial','caixas','experiencia'] as const).map(tab => (
                <button key={tab} onClick={() => setFormTab(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${formTab === tab ? (tab === 'experiencia' ? 'border-teal-500 text-teal-300' : 'border-violet-600 text-violet-300') : 'border-transparent text-white/50 hover:text-white/80'}`}>
                  {tab === 'basic' ? 'Dados Básicos' : tab === 'comercial' ? 'Comercial' : tab === 'caixas' ? 'Caixas' : '✨ Experiência'}
                </button>
              ))}
            </div>

            {/* Tab: Dados Básicos */}
            {formTab === 'basic' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Nome *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} className={cls} />
                </div>
                {[
                  { label: 'Código / Trade Name', key: 'code' as const },
                  { label: 'CNPJ', key: 'cnpj' as const },
                  { label: 'Nome do Contato', key: 'contact_name' as const },
                  { label: 'E-mail', key: 'contact_email' as const },
                  { label: 'Telefone', key: 'contact_phone' as const },
                  { label: 'Unidade', key: 'unit_name' as const },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-xs text-white/50 mb-1">{field.label}</label>
                    <input value={form[field.key] as string} onChange={e => f(field.key, e.target.value)} className={cls} />
                  </div>
                ))}
                <div className="col-span-2 flex items-center gap-2 pt-2">
                  <input type="checkbox" id="is_active" checked={form.is_active}
                    onChange={e => f('is_active', e.target.checked)} className="w-4 h-4 accent-green-600" />
                  <label htmlFor="is_active" className="text-sm text-white/80">Seller ativo</label>
                </div>
              </div>
            )}

            {/* Tab: Comercial */}
            {formTab === 'comercial' && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">B2B</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Caixa B2B', key: 'caixa_b2b' as const },
                    { label: 'Manuseio B2B', key: 'manuseio_b2b' as const },
                    { label: 'Qtd. Franquia B2B', key: 'qtd_franquia_b2b' as const },
                    { label: 'Valor Adicional B2B', key: 'valor_adicional_b2b' as const },
                    { label: 'Nº Mín. Pedidos', key: 'num_min_pedidos' as const },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-white/50 mb-1">{field.label}</label>
                      <input type="number" value={form[field.key] as string} onChange={e => f(field.key, e.target.value)} className={cls} />
                    </div>
                  ))}
                </div>

                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mt-2">Precificação</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Preço Unitário', key: 'preco_unitario' as const },
                    { label: 'Manuseio', key: 'manuseio' as const },
                    { label: 'Franquia', key: 'franquia' as const },
                    { label: 'Preço Adicional', key: 'preco_adicional' as const },
                    { label: 'Valor Segurado', key: 'valor_segurado' as const },
                    { label: 'Mês Reajuste (1-12)', key: 'mes_reajuste' as const },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-white/50 mb-1">{field.label}</label>
                      <input type="number" value={form[field.key] as string} onChange={e => f(field.key, e.target.value)} className={cls} />
                    </div>
                  ))}
                </div>

                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mt-2">Inclusões</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Caixa Inclusa', key: 'caixa_inclusa' as const },
                    { label: 'Seguro Incluso', key: 'seguro_incluso' as const },
                    { label: 'Armazenagem Inclusa', key: 'armazenagem_incluso' as const },
                    { label: 'Caixa Própria', key: 'caixa_prop' as const },
                  ].map(field => (
                    <div key={field.key} className="flex items-center gap-2">
                      <input type="checkbox" id={field.key} checked={form[field.key] as boolean}
                        onChange={e => f(field.key, e.target.checked)} className="w-4 h-4 accent-green-600" />
                      <label htmlFor={field.key} className="text-sm text-white/80">{field.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Caixas */}
            {formTab === 'caixas' && (
              <div>
                <p className="text-xs text-white/50 mb-3">Tipos de caixa disponíveis para este seller (usadas no algoritmo)</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['caixa1','caixa2','caixa3','caixa4','caixa5','caixa6','caixa7','caixa8'] as const).map((key, i) => (
                    <div key={key}>
                      <label className="block text-xs text-white/50 mb-1">Caixa {i+1}</label>
                      <input value={form[key]} onChange={e => f(key, e.target.value)}
                        placeholder={`Ex: Caixa${i+1}`} className={cls} />
                    </div>
                  ))}
                </div>
              </div>
            )}


            {/* Tab: Experiência */}
            {formTab === 'experiencia' && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 border border-white/8" style={{ background: 'rgba(61,217,164,0.06)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: '#3DD9A4', fontSize: 18 }}>✨</span>
                    <p className="text-sm font-semibold text-white">Roteiro de Experiência</p>
                  </div>
                  <p className="text-xs text-white/45 mb-4 leading-relaxed">
                    Faça upload do PPT, PPTX ou PDF com o roteiro de unboxing premium deste seller.
                    O arquivo ficará disponível para os operadores durante a bipagem (botão ✨ Experiência no Scanner).
                  </p>
                  {editId && (
                    <a
                      href={`${API_BASE}/cadastros/sellers/${editId}/experience-file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs mb-3 hover:underline"
                      style={{ color: '#3DD9A4' }}
                    >
                      ↗ Ver arquivo atual (se houver)
                    </a>
                  )}
                  <label
                    className="flex flex-col items-center justify-center gap-2 w-full py-6 rounded-xl border-2 border-dashed cursor-pointer transition"
                    style={{ borderColor: expFile ? 'rgba(61,217,164,0.60)' : 'rgba(61,217,164,0.25)', background: 'rgba(61,217,164,0.04)' }}
                  >
                    <span style={{ fontSize: 28 }}>📎</span>
                    <span className="text-xs text-white/60 text-center px-4">
                      {expFile ? expFile.name : 'Clique para selecionar PPT, PPTX ou PDF'}
                    </span>
                    <span className="text-[10px] text-white/25">Máx. 20 MB</span>
                    <input
                      type="file"
                      accept=".pdf,.ppt,.pptx"
                      className="sr-only"
                      onChange={e => setExpFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {expFile && (
                    <button
                      onClick={() => editId ? handleExpUpload(editId) : toast.error('Salve o seller primeiro')}
                      disabled={expUploading}
                      className="mt-3 w-full py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg,#3DD9A4,#28B885)' }}
                    >
                      {expUploading ? 'Enviando...' : 'Salvar arquivo de experiência'}
                    </button>
                  )}
                  {!editId && (
                    <p className="text-xs text-amber-400 mt-2">
                      ⚠️ Salve o seller primeiro, depois edite-o para fazer o upload do arquivo.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-6 pt-4 border-t border-white/8">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">Cancelar</button>
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5">
                <Check size={14} /> Salvar Seller
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Colar Sellers em Massa ──────────────────── */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-6xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white text-lg">Colar Sellers em Massa</h3>
                <p className="text-xs text-white/50 mt-0.5">Cole direto do Excel (Ctrl+V). Colunas: Nome · Código · CNPJ · Contato · Email · Tel. · Unidade · Preço · Manuseio · CxInclusa? · Caixa1-3</p>
              </div>
              <button onClick={() => setShowPasteModal(false)} className="text-white/35 hover:text-white/60"><X size={20} /></button>
            </div>

            <div className="overflow-auto border border-white/12 rounded-xl max-h-[55vh]" onPaste={handleGridPaste} onKeyDown={handleGridKeyDown}>
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr className="bg-white/4 sticky top-0 z-10">
                    <th className="py-2 px-1 text-center border-b border-white/12 text-white/35 w-8">#</th>
                    {PASTE_HEADERS.map((h, ci) => (
                      <th key={ci} className="py-2 px-2 text-left border-b border-white/12 font-semibold text-white/60 min-w-[100px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sellerGrid.map((row, ri) => (
                    <tr key={ri} className={row[0]?.trim() ? 'bg-violet-900/25' : 'hover:bg-white/4'}>
                      <td className="py-1 px-1 text-center text-white/25 border-b border-white/8 text-[10px]">{ri + 1}</td>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b border-r border-white/8 p-0">
                          <input type="text" value={cell}
                            onChange={e => {
                              const ng = sellerGrid.map((r2, r2i) => r2i === ri ? r2.map((c2, c2i) => c2i === ci ? e.target.value : c2) : r2);
                              setSellerGrid(ng);
                            }}
                            onFocus={() => setAnchorCell([ri, ci])}
                            className="w-full px-2 py-1.5 text-xs outline-none focus:bg-blue-900/25"
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
                <button onClick={() => setSellerGrid(prev => [...prev, ...Array(3).fill(null).map(() => Array(13).fill(''))])}
                  className="text-xs text-violet-400 hover:underline">+ 3 linhas</button>
                <button onClick={() => setSellerGrid(Array(5).fill(null).map(() => Array(13).fill('')))}
                  className="text-xs text-white/35 hover:underline">Limpar</button>
                <span className="text-xs text-white/35">{validPasteRows} seller(s) válido(s)</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowPasteModal(false)}
                  className="px-4 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4">Cancelar</button>
                <button onClick={handlePasteSave} disabled={pasting || validPasteRows === 0}
                  className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5">
                  {pasting && <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />}
                  Criar {validPasteRows} seller(s)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
