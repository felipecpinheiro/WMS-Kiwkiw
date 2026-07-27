/**
 * WMS Kiwkiw - Cadastro de Sellers
 * CRUD completo com importacao em massa via grade.
 * Aba Comercial linkada ao BillingConfig (fonte de verdade única).
 */

import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import {
  Building2, Plus, Pencil, Trash2, X, Check, Store,
  ClipboardList, Upload, ExternalLink, Search, Wrench,
} from 'lucide-react';
import { cadastrosApi, billingApi } from '../api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface BillingFields {
  taxa_base: string;
  preco_unitario: string;
  franquia: string;
  num_minimo_pedidos: string;
  preco_adicional: string;
  manuseio: string;
  armazenagem: string;
  armazenagem_incluso: boolean;
}

interface SellerForm {
  name: string; code: string; cnpj: string; contact_name: string;
  contact_email: string; contact_phone: string; unit_name: string;
  unit_id: number | ''; is_active: boolean;
  caixa_inclusa: boolean; caixa1: string; caixa2: string; caixa3: string;
  caixa4: string; caixa5: string; caixa6: string; caixa7: string; caixa8: string;
  caixa_prop: boolean; other_aliases: string; experiencia_file_url: string;
  billing: BillingFields;
}

const EMPTY_BILLING: BillingFields = {
  taxa_base: '', preco_unitario: '', franquia: '',
  num_minimo_pedidos: '', preco_adicional: '',
  manuseio: '', armazenagem: '', armazenagem_incluso: false,
};

const EMPTY: SellerForm = {
  name: '', code: '', cnpj: '', contact_name: '', contact_email: '',
  contact_phone: '', unit_name: '', unit_id: '', is_active: true,
  caixa_inclusa: false,
  caixa1: '', caixa2: '', caixa3: '', caixa4: '',
  caixa5: '', caixa6: '', caixa7: '', caixa8: '',
  caixa_prop: false, other_aliases: '', experiencia_file_url: '',
  billing: { ...EMPTY_BILLING },
};

const GRID_ROWS = 10;
const GRID_COLS = 13;

const BILLING_FIELDS: Array<{ label: string; key: keyof BillingFields; type: 'number' | 'check' }> = [
  { label: 'Taxa Base (R$)',               key: 'taxa_base',          type: 'number' },
  { label: 'Preço Unitário (R$)',          key: 'preco_unitario',     type: 'number' },
  { label: 'Franquia (nº pedidos)',        key: 'franquia',           type: 'number' },
  { label: 'Nº mín. pedidos',             key: 'num_minimo_pedidos', type: 'number' },
  { label: 'Preço Adicional (R$)',         key: 'preco_adicional',    type: 'number' },
  { label: 'Manuseio (R$)',               key: 'manuseio',           type: 'number' },
  { label: 'Armazenagem (R$)',            key: 'armazenagem',        type: 'number' },
  { label: 'Armazenagem Inclusa',         key: 'armazenagem_incluso', type: 'check' },
];

// Nomes dos campos no BillingConfig (chaves salvas no banco)
const BILLING_KEY_MAP: Record<keyof BillingFields, string> = {
  taxa_base: 'Taxa Base',
  preco_unitario: 'Preço Unitário',
  franquia: 'Franquia',
  num_minimo_pedidos: 'Número Mínimo de Pedidos',
  preco_adicional: 'Preço Adicional',
  manuseio: 'Manuseio',
  armazenagem: 'Armazenagem',
  armazenagem_incluso: 'Armazenagem Incluso',
};

function billingConfigToFields(configs: any[]): BillingFields {
  const map: Record<string, string> = {};
  (configs || []).forEach((c: any) => { map[c.config_key] = c.config_value; });
  return {
    taxa_base: map['Taxa Base'] ?? '',
    preco_unitario: map['Preço Unitário'] ?? '',
    franquia: map['Franquia'] ?? '',
    num_minimo_pedidos: map['Número Mínimo de Pedidos'] ?? '',
    preco_adicional: map['Preço Adicional'] ?? '',
    manuseio: map['Manuseio'] ?? '',
    armazenagem: map['Armazenagem'] ?? '',
    armazenagem_incluso: (map['Armazenagem Incluso'] ?? '').toLowerCase() === 'sim',
  };
}

export default function SellersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: sellersWithoutUnit = [] } = useQuery(
    'sellers-without-unit',
    () => cadastrosApi.sellersWithoutUnit().then(r => r.data),
    { staleTime: 5 * 60 * 1000 },
  );
  const [showModal, setShowModal]     = useState(false);
  const [editId, setEditId]           = useState<number | null>(null);
  const [form, setForm]               = useState<SellerForm>(EMPTY);
  const [search, setSearch]           = useState('');
  const [formTab, setFormTab]         = useState<'basic'|'comercial'|'caixas'|'experiencia'>('basic');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [sellerGrid, setSellerGrid]   = useState<string[][]>(
    Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(''))
  );
  const [pasting, setPasting]         = useState(false);
  const [anchorCell, setAnchorCell]   = useState<[number,number]>([0,0]);
  const [expFile, setExpFile]         = useState<File | null>(null);
  const [expUploading, setExpUploading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: sellers = [] } = useQuery('sellers', () =>
    cadastrosApi.sellers().then(r => r.data)
  );
  const { data: units = [] } = useQuery('units', () =>
    cadastrosApi.units().then(r => r.data)
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (sellers as any[]).filter((s: any) =>
      !q || (s.name||'').toLowerCase().includes(q) ||
      (s.trade_name||'').toLowerCase().includes(q) ||
      (s.cnpj||'').includes(q)
    );
  }, [sellers, search]);

  const set = (k: keyof SellerForm, v: any) => setForm(prev => ({ ...prev, [k]: v }));
  const setBilling = (k: keyof BillingFields, v: any) =>
    setForm(prev => ({ ...prev, billing: { ...prev.billing, [k]: v } }));

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY);
    setFormTab('basic');
    setExpFile(null);
    setShowModal(true);
  };

  const openEdit = async (s: any) => {
    setEditId(s.id);
    setFormTab('basic');
    setExpFile(null);
    // Carrega dados básicos imediatamente
    setForm({
      name: s.name||'', code: s.code||'', cnpj: s.cnpj||'',
      contact_name: s.contact_name||'', contact_email: s.contact_email||'',
      contact_phone: s.contact_phone||'', unit_name: s.unit_name||'',
      unit_id: s.unit_id ?? '',
      is_active: s.is_active ?? s.active ?? true,
      caixa_inclusa: s.caixa_inclusa ?? false,
      caixa1: s.caixa1||'', caixa2: s.caixa2||'', caixa3: s.caixa3||'',
      caixa4: s.caixa4||'', caixa5: s.caixa5||'', caixa6: s.caixa6||'',
      caixa7: s.caixa7||'', caixa8: s.caixa8||'',
      caixa_prop: s.caixa_prop ?? false, other_aliases: s.other_aliases||'',
      experiencia_file_url: s.experiencia_file_url||'',
      billing: { ...EMPTY_BILLING },
    });
    setShowModal(true);
    // Carrega BillingConfig em paralelo
    try {
      const res = await billingApi.config(s.id);
      const configs: any[] = res.data || [];
      setForm(prev => ({ ...prev, billing: billingConfigToFields(configs) }));
    } catch {
      // se não tem config ainda, campos ficam vazios
    }
  };

  const buildSellerPayload = () => ({
    name: form.name.trim(), trade_name: form.name.trim(),
    code: form.code||undefined, cnpj: form.cnpj||undefined,
    contact_name: form.contact_name||undefined,
    contact_email: form.contact_email||undefined,
    contact_phone: form.contact_phone||undefined,
    unit_name: form.unit_name||undefined,
    unit_id: form.unit_id !== '' ? Number(form.unit_id) : null,
    is_active: form.is_active, active: form.is_active,
    preco_unitario: form.billing.preco_unitario !== '' ? Number(form.billing.preco_unitario) : undefined,
    manuseio: form.billing.manuseio !== '' ? Number(form.billing.manuseio) : undefined,
    caixa_inclusa: form.caixa_inclusa,
    caixa1: form.caixa1||undefined, caixa2: form.caixa2||undefined,
    caixa3: form.caixa3||undefined, caixa4: form.caixa4||undefined,
    caixa5: form.caixa5||undefined, caixa6: form.caixa6||undefined,
    caixa7: form.caixa7||undefined, caixa8: form.caixa8||undefined,
    caixa_prop: form.caixa_prop, other_aliases: form.other_aliases||undefined,
  });

  const buildBillingPayload = (sellerId: number) => {
    const b = form.billing;
    const configs: Array<{ config_key: string; config_value: string }> = [];
    (Object.keys(BILLING_KEY_MAP) as (keyof BillingFields)[]).forEach(k => {
      const v = b[k];
      const val = k === 'armazenagem_incluso' ? (v ? 'sim' : 'nao') : String(v ?? '');
      if (val !== '' && val !== 'nao') {
        configs.push({ config_key: BILLING_KEY_MAP[k], config_value: val });
      }
    });
    return { seller_id: sellerId, configs };
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      let savedId = editId;
      if (editId) {
        await cadastrosApi.updateSeller(editId, buildSellerPayload());
        toast.success('Seller atualizado');
      } else {
        const res = await cadastrosApi.createSeller(buildSellerPayload());
        savedId = (res.data as any).id;
        toast.success('Seller criado');
      }

      // Salva BillingConfig se há campos preenchidos
      if (savedId) {
        const billingPayload = buildBillingPayload(savedId);
        if (billingPayload.configs.length > 0) {
          await billingApi.saveConfig(billingPayload);
        }
      }

      // Upload do arquivo de experiência
      if (expFile && savedId) {
        setExpUploading(true);
        try {
          await cadastrosApi.uploadExperienceFile(savedId, expFile);
          toast.success('Arquivo de experiência enviado!');
          setExpFile(null);
        } catch {
          toast.error('Seller salvo, mas falha ao enviar arquivo de experiência');
        } finally {
          setExpUploading(false);
        }
      }

      qc.invalidateQueries('sellers');
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Deseja inativar o seller "${name}"?\n\nO seller será marcado como inativo mas permanecerá no histórico.`)) return;
    try {
      await cadastrosApi.deleteSeller(id);
      toast.success(`Seller "${name}" inativado com sucesso`);
      qc.invalidateQueries('sellers');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao inativar seller');
    }
  };

  const handleGridPaste = (e: React.ClipboardEvent) => {
    const [ar, ac] = anchorCell;
    const newGrid = sellerGrid.map(r => [...r]);
    const lines = e.clipboardData.getData('text').split('\n').filter(Boolean);
    lines.forEach((line, ri) => {
      const cells = line.split('\t');
      cells.forEach((cell, ci) => {
        const nr = ar + ri; const nc = ac + ci;
        if (nr < GRID_ROWS && nc < GRID_COLS) newGrid[nr][nc] = cell.trim();
      });
    });
    setSellerGrid(newGrid);
    e.preventDefault();
  };

  const handlePasteSave = async () => {
    const items = sellerGrid.filter(row => row[0]?.trim()).map(row => ({
      name: row[0].trim(), trade_name: row[1]?.trim() || row[0].trim(),
      cnpj: row[2]?.trim()||undefined, contact_name: row[3]?.trim()||undefined,
      contact_email: row[4]?.trim()||undefined, contact_phone: row[5]?.trim()||undefined,
      unit_name: row[6]?.trim()||undefined,
      preco_unitario: row[7] ? parseFloat(row[7].replace(',','.')) || undefined : undefined,
      manuseio: row[8] ? parseFloat(row[8].replace(',','.')) || undefined : undefined,
      caixa_inclusa: ['sim','yes','s','x','1','true'].includes((row[9]||'').toLowerCase()),
      caixa1: row[10]?.trim()||undefined, caixa2: row[11]?.trim()||undefined,
      caixa3: row[12]?.trim()||undefined,
    }));
    if (!items.length) { toast.error('Nenhum seller válido'); return; }
    setPasting(true);
    try {
      const results = await Promise.allSettled(items.map((s: any) => cadastrosApi.createSeller(s)));
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const fail = results.filter(r => r.status === 'rejected').length;
      if (ok > 0) toast.success(`${ok} seller(s) criado(s)!`);
      if (fail > 0) toast(`${fail} seller(s) com erro`, { icon: '⚠️' });
      qc.invalidateQueries('sellers');
      setShowPasteModal(false);
      setSellerGrid(Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill('')));
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro'); }
    finally { setPasting(false); }
  };

  const cls = 'w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500';
  const clsStyle = { background: '#14122A', colorScheme: 'dark' as const, color: 'rgba(255,255,255,0.8)' };
  const validRows = sellerGrid.filter(r => r[0]?.trim()).length;

  const expFileUrl = form.experiencia_file_url
    ? (form.experiencia_file_url.startsWith('http') ? form.experiencia_file_url : `${API_BASE}${form.experiencia_file_url}`)
    : null;

  return (
    <div className="p-6 space-y-5 min-h-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 size={20} className="text-violet-400" /> Sellers
          </h1>
          <p className="text-sm text-white/40 mt-0.5">{filtered.length} cadastrado(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {sellersWithoutUnit.length > 0 && (
            <button onClick={() => navigate('/sellers/corrigir')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-300 bg-amber-900/25 border border-amber-500/30 hover:bg-amber-900/35 rounded-lg transition">
              <Wrench size={14} /> Corrigir pendências ({sellersWithoutUnit.length})
            </button>
          )}
          <button onClick={() => setShowPasteModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/70 bg-gray-900 border border-white/12 hover:bg-white/4 rounded-lg transition">
            <ClipboardList size={14} /> Colar em massa
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            <Plus size={14} /> Novo Seller
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar seller..."
          className="w-full pl-8 pr-3 py-2 border border-white/12 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
          style={clsStyle} />
      </div>

      <div className="bg-gray-900 rounded-xl border border-white/8 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-white/4 border-b border-white/8">
              {['Seller','Codigo','CNPJ','Contato','E-mail','SKUs','Estoque','Status',''].map(h => (
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
                      <span className="text-violet-300 text-xs font-bold">{(s.trade_name||s.name||'?').charAt(0)}</span>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-white/90">{s.trade_name||s.name}</span>
                      {s.unit_display_name && <p className="text-[10px] text-white/35">{s.unit_display_name}</p>}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-xs font-mono text-white/50">{s.code||'---'}</td>
                <td className="py-2.5 px-3 text-xs font-mono text-white/50">{s.cnpj||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-white/50">{s.contact_name||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-white/50">{s.contact_email||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-right tabular-nums">
                  <span className="text-white/70 font-mono">{s.total_skus ?? '---'}</span>
                </td>
                <td className="py-2.5 px-3 text-sm text-right tabular-nums">
                  {s.skus_with_stock != null
                    ? <span className={`font-mono font-semibold ${
                        s.skus_with_stock === 0 ? 'text-red-400' :
                        s.skus_with_stock < (s.total_skus ?? 1) * 0.5 ? 'text-amber-400' :
                        'text-teal-400'}`}>{s.skus_with_stock}</span>
                    : <span className="text-white/25">---</span>}
                </td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    (s.is_active ?? s.active) ? 'bg-violet-900/40 text-violet-300' : 'bg-white/8 text-white/40 border border-white/8'}`}>
                    {(s.is_active ?? s.active) ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(s)} className="text-white/35 hover:text-violet-400 transition"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(s.id, s.trade_name || s.name || '')} className="text-white/35 hover:text-red-500 transition"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="text-center py-10">
                <Store size={28} className="text-white/25 mx-auto mb-2" />
                <p className="text-sm text-white/35">Nenhum seller encontrado</p>
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-white/8 text-xs text-white/35">{filtered.length} seller(s)</div>
      </div>

      {/* ── Modal Edição ──────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-lg">{editId ? 'Editar Seller' : 'Novo Seller'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>
            <div className="flex border-b border-white/12 mb-5">
              {(['basic','comercial','caixas','experiencia'] as const).map(tab => (
                <button key={tab} onClick={() => setFormTab(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${formTab === tab
                    ? (tab === 'experiencia' ? 'border-teal-500 text-teal-300' : 'border-violet-600 text-violet-300')
                    : 'border-transparent text-white/50 hover:text-white/80'}`}>
                  {tab === 'basic' ? 'Dados Básicos' : tab === 'comercial' ? 'Comercial' : tab === 'caixas' ? 'Caixas' : 'Experiência'}
                </button>
              ))}
            </div>

            {formTab === 'basic' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Nome *</label>
                  <input value={form.name} onChange={e => set('name', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Código</label>
                  <input value={form.code} onChange={e => set('code', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">CNPJ</label>
                  <input value={form.cnpj} onChange={e => set('cnpj', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Contato</label>
                  <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Telefone</label>
                  <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">E-mail</label>
                  <input value={form.contact_email} onChange={e => set('contact_email', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Unidade</label>
                  <select value={form.unit_id} onChange={e => set('unit_id', e.target.value ? Number(e.target.value) : '')} className={cls} style={clsStyle}>
                    <option value="">Sem unidade</option>
                    {(units as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Status</label>
                  <select value={form.is_active ? 'true' : 'false'} onChange={e => set('is_active', e.target.value === 'true')} className={cls} style={clsStyle}>
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Outros apelidos (separados por ";")</label>
                  <input value={form.other_aliases} onChange={e => set('other_aliases', e.target.value)} className={cls} style={clsStyle} placeholder='Ex: Seller ABC; ABC Ltda' />
                </div>
              </div>
            )}

            {formTab === 'comercial' && (
              <div className="space-y-4">
                <p className="text-xs text-white/40">Estes valores são sincronizados com o módulo de Faturamento.</p>
                <div className="grid grid-cols-2 gap-3">
                  {BILLING_FIELDS.filter(f => f.type === 'number').map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-white/50 mb-1">{f.label}</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={form.billing[f.key] as string}
                        onChange={e => setBilling(f.key, e.target.value)}
                        className={cls} style={clsStyle}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="ci" checked={form.caixa_inclusa} onChange={e => set('caixa_inclusa', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="ci" className="text-sm text-white/70">Caixa inclusa no preço</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="cp" checked={form.caixa_prop} onChange={e => set('caixa_prop', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="cp" className="text-sm text-white/70">Caixa própria</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox" id="ai"
                      checked={form.billing.armazenagem_incluso}
                      onChange={e => setBilling('armazenagem_incluso', e.target.checked)}
                      className="w-4 h-4 accent-violet-500"
                    />
                    <label htmlFor="ai" className="text-sm text-white/70">Armazenagem inclusa</label>
                  </div>
                </div>
              </div>
            )}

            {formTab === 'caixas' && (
              <div className="grid grid-cols-4 gap-3">
                {(['caixa1','caixa2','caixa3','caixa4','caixa5','caixa6','caixa7','caixa8'] as const).map((k, i) => (
                  <div key={k}>
                    <label className="block text-xs text-white/50 mb-1">Caixa {i+1}</label>
                    <input value={form[k]} onChange={e => set(k, e.target.value)} className={cls} style={clsStyle} placeholder={`c${i+1}`} />
                  </div>
                ))}
              </div>
            )}

            {formTab === 'experiencia' && (
              <div className="space-y-4">
                <p className="text-sm text-white/50">Upload do roteiro de experiência do seller (PDF/DOC).</p>
                {expFileUrl && (
                  <a href={expFileUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-violet-300 hover:underline">
                    <ExternalLink size={14} /> Ver arquivo atual
                  </a>
                )}
                <div className="flex items-center gap-3">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 border border-white/12 rounded-lg text-sm text-white/60 hover:bg-white/4 transition">
                    <Upload size={14} /> {expFile ? expFile.name : 'Selecionar arquivo'}
                  </button>
                  {expFile && (
                    <button onClick={() => setExpFile(null)} className="text-xs text-white/30 hover:text-white/60"><X size={14} /></button>
                  )}
                  {expUploading && <span className="text-xs text-white/40">Enviando...</span>}
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx" className="sr-only"
                    onChange={e => setExpFile(e.target.files?.[0] ?? null)} />
                </div>
                {expFile && <p className="text-xs text-amber-400/80">O arquivo será enviado ao salvar.</p>}
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5 disabled:opacity-60">
                {saving ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={14} />}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Colar em Massa ─────────────────────────────── */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-[#14122A] rounded-2xl w-full max-w-4xl my-8 border border-white/10">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div>
                <h3 className="font-semibold text-white text-sm">Colar Sellers em Massa</h3>
                <p className="text-[11px] text-white/40 mt-0.5">Nome | Trade | CNPJ | Contato | Email | Tel | Unidade | Preço | Manuseio | Cx Inclusa | C1 | C2 | C3</p>
              </div>
              <button onClick={() => setShowPasteModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    {['Nome*','Trade','CNPJ','Contato','E-mail','Tel','Unidade','Preço','Manuseio','Cx Inclusa','C1','C2','C3'].map((h, ci) => (
                      <th key={ci} className="border border-white/10 bg-white/5 px-2 py-1 text-white/50 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sellerGrid.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className={`border border-white/10 p-0 ${anchorCell[0]===ri && anchorCell[1]===ci ? 'ring-2 ring-violet-500 ring-inset' : ''}`}>
                          <input
                            value={cell}
                            onChange={e => {
                              const ng = sellerGrid.map((r2, r2i) => r2i===ri ? r2.map((c2, c2i) => c2i===ci ? e.target.value : c2) : r2);
                              setSellerGrid(ng);
                            }}
                            onFocus={() => setAnchorCell([ri, ci])}
                            onPaste={handleGridPaste}
                            className="w-24 px-2 py-1 bg-transparent text-white/80 outline-none"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/8">
              <div className="flex items-center gap-3">
                <button onClick={() => setSellerGrid(Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill('')))}
                  className="text-xs text-white/35 hover:underline">Limpar</button>
                <span className="text-xs text-white/35">{validRows} seller(s) válidos</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowPasteModal(false)}
                  className="px-4 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4">Cancelar</button>
                <button onClick={handlePasteSave} disabled={pasting}
                  className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50">
                  {pasting ? 'Salvando...' : `Importar ${validRows} seller(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
