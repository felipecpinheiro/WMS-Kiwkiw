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
import { cadastrosApi, billingApi, CANONICAL_BOXES } from '../api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Faturamento reescrito (31/08/2026): a aba Comercial edita o DEFAULT do seller
// em `billing_seller_params` (não mais `billing_configs` nem colunas de Seller).
interface BillingFields {
  preco_unitario: string;
  min_pedidos: string;
  manuseio_b2b: string;
  valor_caixa_b2b: string;
  limite_itens_b2b: string;
  tipos_caixa_inclusos: string;
  cota_caixas_mes: string;
  franquia_m3: string;
  preco_m3: string;
  seguro_incluso: boolean;
  aliquota_seguro: string;
  armazenagem_inclusa: boolean;
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
  preco_unitario: '', min_pedidos: '', manuseio_b2b: '', valor_caixa_b2b: '',
  limite_itens_b2b: '', tipos_caixa_inclusos: '', cota_caixas_mes: '',
  franquia_m3: '', preco_m3: '', seguro_incluso: false,
  aliquota_seguro: '0.30', armazenagem_inclusa: false,
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

const BILLING_FIELDS: Array<{ label: string; key: keyof BillingFields }> = [
  { label: 'Preço unitário / manuseio B2C (R$)', key: 'preco_unitario' },
  { label: 'Nº mínimo de pedidos',              key: 'min_pedidos' },
  { label: 'Manuseio B2B (R$)',                 key: 'manuseio_b2b' },
  { label: 'Valor caixa B2B (R$)',              key: 'valor_caixa_b2b' },
  { label: 'É B2B a partir de (itens)',         key: 'limite_itens_b2b' },
  { label: 'Cota de caixas / mês',              key: 'cota_caixas_mes' },
  { label: 'Franquia grátis de cubagem (m³)',   key: 'franquia_m3' },
  { label: 'Preço por m³ adicional (R$)',       key: 'preco_m3' },
  { label: 'Alíquota do seguro (%)',            key: 'aliquota_seguro' },
];

const NUM = (v: string, int = false) =>
  v === '' ? 0 : (int ? parseInt(v) || 0 : Number(v) || 0);

function paramsToFields(p: any): BillingFields {
  const s = (x: any) => (x === null || x === undefined ? '' : String(x));
  return {
    preco_unitario: s(p.preco_unitario), min_pedidos: s(p.min_pedidos),
    manuseio_b2b: s(p.manuseio_b2b), valor_caixa_b2b: s(p.valor_caixa_b2b),
    limite_itens_b2b: s(p.limite_itens_b2b), tipos_caixa_inclusos: p.tipos_caixa_inclusos ?? '',
    cota_caixas_mes: s(p.cota_caixas_mes), franquia_m3: s(p.franquia_m3),
    preco_m3: s(p.preco_m3), seguro_incluso: !!p.seguro_incluso,
    aliquota_seguro: s(p.aliquota_seguro), armazenagem_inclusa: !!p.armazenagem_inclusa,
  };
}

function fieldsToParams(b: BillingFields) {
  return {
    preco_unitario: NUM(b.preco_unitario), min_pedidos: NUM(b.min_pedidos, true),
    manuseio_b2b: NUM(b.manuseio_b2b), valor_caixa_b2b: NUM(b.valor_caixa_b2b),
    limite_itens_b2b: NUM(b.limite_itens_b2b, true),
    tipos_caixa_inclusos: b.tipos_caixa_inclusos || '',
    cota_caixas_mes: NUM(b.cota_caixas_mes, true), franquia_m3: NUM(b.franquia_m3),
    preco_m3: NUM(b.preco_m3), seguro_incluso: b.seguro_incluso,
    aliquota_seguro: NUM(b.aliquota_seguro), armazenagem_inclusa: b.armazenagem_inclusa,
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
  // preço de caixa por seller (aba "Caixas"): { box_key: valor como string }
  const [boxPrices, setBoxPrices]     = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Única tela do sistema que exibe sellers inativos (com o badge "Inativo"),
  // por isso pede activeOnly=false explicitamente. Ver CLAUDE.md.
  // Chave própria pelo mesmo motivo do Faturamento: lista completa não divide
  // cache com a chave 'sellers' (só ativos). O prefixo preserva os invalidates.
  const { data: sellers = [] } = useQuery(['sellers', 'all'], () =>
    cadastrosApi.sellers(false).then(r => r.data)
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

  // Grupo A (caixas inclusas) — guardado como lista canônica separada por vírgula
  // em billing_seller_params.tipos_caixa_inclusos.
  const grupoASet = new Set(
    (form.billing.tipos_caixa_inclusos || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  const toggleGrupoA = (k: string) => {
    const s = new Set(grupoASet);
    s.has(k) ? s.delete(k) : s.add(k);
    setBilling('tipos_caixa_inclusos', CANONICAL_BOXES.filter(b => s.has(b)).join(','));
  };

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY);
    setFormTab('basic');
    setExpFile(null);
    setBoxPrices({});
    setShowModal(true);
  };

  const openEdit = async (s: any) => {
    setEditId(s.id);
    setFormTab('basic');
    setExpFile(null);
    setBoxPrices({});
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
    // Carrega o default de faturamento do seller em paralelo
    try {
      const res = await billingApi.sellerParams(s.id);
      setForm(prev => ({ ...prev, billing: paramsToFields(res.data) }));
    } catch {
      // sem params ainda: campos ficam vazios
    }
    try {
      const res = await billingApi.sellerBoxPrices(s.id);
      const m: Record<string, string> = {};
      res.data.prices.forEach(p => { m[p.box_key] = p.price == null ? '' : String(p.price); });
      setBoxPrices(m);
    } catch {
      setBoxPrices({});
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
    caixa_inclusa: form.caixa_inclusa,
    caixa1: form.caixa1||undefined, caixa2: form.caixa2||undefined,
    caixa3: form.caixa3||undefined, caixa4: form.caixa4||undefined,
    caixa5: form.caixa5||undefined, caixa6: form.caixa6||undefined,
    caixa7: form.caixa7||undefined, caixa8: form.caixa8||undefined,
    caixa_prop: form.caixa_prop, other_aliases: form.other_aliases||undefined,
  });


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

      // Salva o default de faturamento do seller (billing_seller_params)
      if (savedId) {
        await billingApi.saveSellerParams(savedId, fieldsToParams(form.billing) as any);
        await billingApi.saveSellerBoxPrices(savedId, {
          prices: CANONICAL_BOXES.map(k => ({
            box_key: k,
            price: (boxPrices[k] ?? '').trim() === '' ? null : Number(boxPrices[k]),
          })),
        });
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
      // 1ª chamada sem confirm: se houver pedido em aberto, o backend só avisa
      // e não altera nada — seller inativo some de Pedidos, Manuseios e Scanner.
      const res = await cadastrosApi.deleteSeller(id);
      if (res.data?.requires_confirmation) {
        const ok = confirm(
          `${name} tem ${res.data.open_orders} pedido(s) em aberto.\n\n` +
          'Ao inativar, esses pedidos somem de Pedidos, Manuseios e Scanner, e ninguém ' +
          'consegue bipá-los até o seller ser reativado.\n\nInativar mesmo assim?'
        );
        if (!ok) return;
        await cadastrosApi.deleteSeller(id, true);
      }
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
      // colada em massa cria só o cadastro; parâmetros de faturamento ficam no default
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

  const cls = 'w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500';
  const clsStyle = { background: 'rgb(var(--surface-2))', color: 'rgb(var(--t2))' };
  const validRows = sellerGrid.filter(r => r[0]?.trim()).length;

  const expFileUrl = form.experiencia_file_url
    ? (form.experiencia_file_url.startsWith('http') ? form.experiencia_file_url : `${API_BASE}${form.experiencia_file_url}`)
    : null;

  return (
    <div className="p-6 space-y-5 min-h-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-t1 flex items-center gap-2">
            <Building2 size={20} className="text-violet-400" /> Sellers
          </h1>
          <p className="text-sm text-t4 mt-0.5">{filtered.length} cadastrado(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {sellersWithoutUnit.length > 0 && (
            <button onClick={() => navigate('/sellers/corrigir')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-warn bg-warn-soft border border-warn/30 hover:bg-warn-soft rounded-lg transition">
              <Wrench size={14} /> Corrigir pendências ({sellersWithoutUnit.length})
            </button>
          )}
          <button onClick={() => setShowPasteModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 bg-surface border border-line hover:bg-surface-2 rounded-lg transition">
            <ClipboardList size={14} /> Colar em massa
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            <Plus size={14} /> Novo Seller
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-t4" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar seller..."
          type="search"
          name="seller-search"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore
          className="w-full pl-8 pr-3 py-2 border border-line rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
          style={clsStyle} />
      </div>

      <div className="bg-surface rounded-xl border border-line-soft overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-2 border-b border-line-soft">
              {['Seller','Codigo','CNPJ','Contato','E-mail','SKUs','Estoque','Status',''].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-t3 uppercase tracking-wide py-2.5 px-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? filtered.map((s: any) => (
              <tr key={s.id} className="border-b border-line-soft hover:bg-surface-2">
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-violet-900/40 rounded-lg flex items-center justify-center">
                      <span className="text-violet-300 text-xs font-bold">{(s.trade_name||s.name||'?').charAt(0)}</span>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-t1">{s.trade_name||s.name}</span>
                      {s.unit_display_name && <p className="text-[10px] text-t4">{s.unit_display_name}</p>}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-xs font-mono text-t3">{s.code||'---'}</td>
                <td className="py-2.5 px-3 text-xs font-mono text-t3">{s.cnpj||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-t3">{s.contact_name||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-t3">{s.contact_email||'---'}</td>
                <td className="py-2.5 px-3 text-sm text-right tabular-nums">
                  <span className="text-t2 font-mono">{s.total_skus ?? '---'}</span>
                </td>
                <td className="py-2.5 px-3 text-sm text-right tabular-nums">
                  {s.skus_with_stock != null
                    ? <span className={`font-mono font-semibold ${
                        s.skus_with_stock === 0 ? 'text-bad' :
                        s.skus_with_stock < (s.total_skus ?? 1) * 0.5 ? 'text-warn' :
                        'text-ok'}`}>{s.skus_with_stock}</span>
                    : <span className="text-t5">---</span>}
                </td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    (s.is_active ?? s.active) ? 'bg-violet-900/40 text-violet-300' : 'bg-surface-2 text-t4 border border-line-soft'}`}>
                    {(s.is_active ?? s.active) ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(s)} className="text-t4 hover:text-violet-400 transition"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(s.id, s.trade_name || s.name || '')} className="text-t4 hover:text-bad transition"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="text-center py-10">
                <Store size={28} className="text-t5 mx-auto mb-2" />
                <p className="text-sm text-t4">Nenhum seller encontrado</p>
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-line-soft text-xs text-t4">{filtered.length} seller(s)</div>
      </div>

      {/* ── Modal Edição ──────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-t1 text-lg">{editId ? 'Editar Seller' : 'Novo Seller'}</h3>
              <button onClick={() => setShowModal(false)} className="text-t4 hover:text-t3"><X size={18} /></button>
            </div>
            <div className="flex border-b border-line mb-5">
              {(['basic','comercial','caixas','experiencia'] as const).map(tab => (
                <button key={tab} onClick={() => setFormTab(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${formTab === tab
                    ? (tab === 'experiencia' ? 'border-ok text-ok' : 'border-violet-600 text-violet-300')
                    : 'border-transparent text-t3 hover:text-t2'}`}>
                  {tab === 'basic' ? 'Dados Básicos' : tab === 'comercial' ? 'Comercial' : tab === 'caixas' ? 'Caixas' : 'Experiência'}
                </button>
              ))}
            </div>

            {formTab === 'basic' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-t3 mb-1">Nome *</label>
                  <input value={form.name} onChange={e => set('name', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Código</label>
                  <input value={form.code} onChange={e => set('code', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">CNPJ</label>
                  <input value={form.cnpj} onChange={e => set('cnpj', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Contato</label>
                  <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Telefone</label>
                  <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-t3 mb-1">E-mail</label>
                  <input value={form.contact_email} onChange={e => set('contact_email', e.target.value)} className={cls} style={clsStyle} />
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Unidade</label>
                  <select value={form.unit_id} onChange={e => set('unit_id', e.target.value ? Number(e.target.value) : '')} className={cls} style={clsStyle}>
                    <option value="">Sem unidade</option>
                    {(units as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-t3 mb-1">Status</label>
                  <select value={form.is_active ? 'true' : 'false'} onChange={e => set('is_active', e.target.value === 'true')} className={cls} style={clsStyle}>
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-t3 mb-1">Outros apelidos (separados por ";")</label>
                  <input value={form.other_aliases} onChange={e => set('other_aliases', e.target.value)} className={cls} style={clsStyle} placeholder='Ex: Seller ABC; ABC Ltda' />
                </div>
              </div>
            )}

            {formTab === 'comercial' && (
              <div className="space-y-4">
                <p className="text-xs text-t4">
                  Default de faturamento do seller. O fechamento de cada mês nasce com estes
                  valores e pode sobrescrevê-los no topo da tela de Faturamento.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {BILLING_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-t3 mb-1">{f.label}</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={form.billing[f.key] as string}
                        onChange={e => setBilling(f.key, e.target.value)}
                        className={cls} style={clsStyle}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-t4">
                  As caixas inclusas (grupo A) e o preço por caixa deste seller ficam na aba "Caixas".
                </p>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="seg" checked={form.billing.seguro_incluso}
                      onChange={e => setBilling('seguro_incluso', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="seg" className="text-sm text-t2">Cobrar seguro</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="arm" checked={form.billing.armazenagem_inclusa}
                      onChange={e => setBilling('armazenagem_inclusa', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="arm" className="text-sm text-t2">Armazenagem inclusa (informativo)</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="ci" checked={form.caixa_inclusa} onChange={e => set('caixa_inclusa', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="ci" className="text-sm text-t2">Caixa inclusa no preço (cadastro)</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="cp" checked={form.caixa_prop} onChange={e => set('caixa_prop', e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    <label htmlFor="cp" className="text-sm text-t2">Caixa própria (cadastro)</label>
                  </div>
                </div>
              </div>
            )}

            {formTab === 'caixas' && (
              <div className="space-y-3">
                <p className="text-xs text-t4">
                  Preço adicional por caixa deste seller. Em branco = usa o valor da
                  tabela global do Faturamento. "Inclusa" = grupo A (sem adicional).
                </p>
                <div className="border border-line-soft rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_90px] gap-2 px-3 py-2 bg-surface-2 text-[10px] uppercase text-t4">
                    <span>Caixa</span><span className="text-right">Preço (R$)</span><span className="text-center">Inclusa</span>
                  </div>
                  {CANONICAL_BOXES.map(k => (
                    <div key={k} className="grid grid-cols-[1fr_120px_90px] gap-2 px-3 py-1.5 items-center border-t border-line-soft">
                      <span className="text-sm text-t2">{k}</span>
                      <input
                        type="number" step="0.01" min="0" placeholder="global"
                        value={boxPrices[k] ?? ''}
                        onChange={e => setBoxPrices(m => ({ ...m, [k]: e.target.value }))}
                        className="text-right border border-line rounded-md px-2 py-1 text-sm bg-surface-2 text-t1"
                      />
                      <div className="flex justify-center">
                        <input
                          type="checkbox" checked={grupoASet.has(k)}
                          onChange={() => toggleGrupoA(k)}
                          className="w-4 h-4 accent-violet-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {formTab === 'experiencia' && (
              <div className="space-y-4">
                <p className="text-sm text-t3">Upload do roteiro de experiência do seller (PDF/DOC).</p>
                {expFileUrl && (
                  <a href={expFileUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-violet-300 hover:underline">
                    <ExternalLink size={14} /> Ver arquivo atual
                  </a>
                )}
                <div className="flex items-center gap-3">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 border border-line rounded-lg text-sm text-t3 hover:bg-surface-2 transition">
                    <Upload size={14} /> {expFile ? expFile.name : 'Selecionar arquivo'}
                  </button>
                  {expFile && (
                    <button onClick={() => setExpFile(null)} className="text-xs text-t4 hover:text-t3"><X size={14} /></button>
                  )}
                  {expUploading && <span className="text-xs text-t4">Enviando...</span>}
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx" className="sr-only"
                    onChange={e => setExpFile(e.target.files?.[0] ?? null)} />
                </div>
                {expFile && <p className="text-xs text-warn/80">O arquivo será enviado ao salvar.</p>}
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-t3 border border-line rounded-lg hover:bg-surface-2 transition">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm text-t1 bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5 disabled:opacity-60">
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
          <div className="bg-surface rounded-2xl w-full max-w-4xl my-8 border border-line">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line-soft">
              <div>
                <h3 className="font-semibold text-t1 text-sm">Colar Sellers em Massa</h3>
                <p className="text-[11px] text-t4 mt-0.5">Nome | Trade | CNPJ | Contato | Email | Tel | Unidade | Preço | Manuseio | Cx Inclusa | C1 | C2 | C3</p>
              </div>
              <button onClick={() => setShowPasteModal(false)} className="text-t4 hover:text-t3"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    {['Nome*','Trade','CNPJ','Contato','E-mail','Tel','Unidade','Preço','Manuseio','Cx Inclusa','C1','C2','C3'].map((h, ci) => (
                      <th key={ci} className="border border-line bg-surface-2 px-2 py-1 text-t3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sellerGrid.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className={`border border-line p-0 ${anchorCell[0]===ri && anchorCell[1]===ci ? 'ring-2 ring-violet-500 ring-inset' : ''}`}>
                          <input
                            value={cell}
                            onChange={e => {
                              const ng = sellerGrid.map((r2, r2i) => r2i===ri ? r2.map((c2, c2i) => c2i===ci ? e.target.value : c2) : r2);
                              setSellerGrid(ng);
                            }}
                            onFocus={() => setAnchorCell([ri, ci])}
                            onPaste={handleGridPaste}
                            className="w-24 px-2 py-1 bg-transparent text-t2 outline-none"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-line-soft">
              <div className="flex items-center gap-3">
                <button onClick={() => setSellerGrid(Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill('')))}
                  className="text-xs text-t4 hover:underline">Limpar</button>
                <span className="text-xs text-t4">{validRows} seller(s) válidos</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowPasteModal(false)}
                  className="px-4 py-2 text-sm text-t3 border border-line rounded-lg hover:bg-surface-2">Cancelar</button>
                <button onClick={handlePasteSave} disabled={pasting}
                  className="px-4 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50">
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
