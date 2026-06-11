/**
 * WMS Kiwkiw — Cadastro de Unidades
 * CRUD completo de unidades físicas da Kiwkiw com associação de sellers.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Building2, Pencil, Trash2, X, Plus, Users, MapPin, Phone, User } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

const inputCls =
  'w-full px-3 py-2 border border-white/12 rounded-lg text-sm text-white/80 outline-none focus:ring-2 focus:ring-violet-500 placeholder-white/25';
const inputStyle = { background: '#14122A', colorScheme: 'dark' as const };

interface UnitForm {
  name: string;
  code: string;
  city: string;
  state: string;
  responsible: string;
  phone: string;
  location: string;
}

const EMPTY: UnitForm = {
  name: '', code: '', city: '', state: '', responsible: '', phone: '', location: '',
};

export default function UnitsPage() {
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<UnitForm>(EMPTY);

  // Modal de associação de sellers
  const [showSellerModal, setShowSellerModal] = useState(false);
  const [sellerUnitId, setSellerUnitId] = useState<number | null>(null);
  const [sellerUnitName, setSellerUnitName] = useState('');
  const [selectedSellerIds, setSelectedSellerIds] = useState<number[]>([]);

  const { data: units = [] } = useQuery('units', () => cadastrosApi.units().then(r => r.data));
  const { data: allSellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  const openNew = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (u: any) => {
    setForm({
      name: u.name || '',
      code: u.code || '',
      city: u.city || '',
      state: u.state || '',
      responsible: u.responsible || '',
      phone: u.phone || '',
      location: u.location || '',
    });
    setEditId(u.id);
    setShowModal(true);
  };

  const openSellerAssoc = (u: any) => {
    setSellerUnitId(u.id);
    setSellerUnitName(u.name);
    // Sellers que já estão nesta unidade
    const current = (allSellers as any[])
      .filter((s: any) => s.unit_id === u.id)
      .map((s: any) => s.id);
    setSelectedSellerIds(current);
    setShowSellerModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    try {
      if (editId) {
        await cadastrosApi.updateUnit(editId, form);
        toast.success('Unidade atualizada!');
      } else {
        await cadastrosApi.createUnit(form);
        toast.success('Unidade criada!');
      }
      qc.invalidateQueries('units');
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Desativar a unidade "${name}"? Os sellers associados ficarão sem unidade.`)) return;
    try {
      await cadastrosApi.deleteUnit(id);
      toast.success('Unidade desativada');
      qc.invalidateQueries('units');
      qc.invalidateQueries('sellers');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao desativar');
    }
  };

  const handleSaveSellers = async () => {
    if (!sellerUnitId) return;
    try {
      await cadastrosApi.assignSellersToUnit(sellerUnitId, selectedSellerIds);
      toast.success('Sellers associados!');
      qc.invalidateQueries('units');
      qc.invalidateQueries('sellers');
      setShowSellerModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao associar');
    }
  };

  const toggleSeller = (id: number) => {
    setSelectedSellerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const f = (key: keyof UnitForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Unidades</h1>
          <p className="text-sm text-white/50 mt-0.5">
            Unidades físicas da Kiwkiw — associe sellers para organizar os PDFs automaticamente
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
          <Plus size={14} /> Nova Unidade
        </button>
      </div>

      {/* Cards de unidades */}
      {(units as any[]).length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-white/12 rounded-xl p-12 text-center">
          <Building2 size={36} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Nenhuma unidade cadastrada</p>
          <p className="text-white/25 text-xs mt-1">Crie a primeira unidade para organizar os PDFs por local</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(units as any[]).map((u: any) => {
            const unitSellers = (allSellers as any[]).filter((s: any) => s.unit_id === u.id);
            return (
              <div key={u.id} className="bg-gray-900 rounded-2xl border border-white/8 p-5 flex flex-col gap-4">
                {/* Cabeçalho do card */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-violet-600/15 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Building2 size={18} className="text-violet-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-white/90">{u.name}</p>
                      {u.code && <p className="text-xs text-white/40 font-mono">{u.code}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(u)}
                      className="p-1.5 text-white/30 hover:text-white/70 hover:bg-white/5 rounded-lg transition">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(u.id, u.name)}
                      className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Infos */}
                <div className="space-y-1.5 text-xs text-white/50">
                  {(u.city || u.state) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} className="text-violet-400/60 flex-shrink-0" />
                      <span>{[u.city, u.state].filter(Boolean).join(' — ')}</span>
                    </div>
                  )}
                  {u.responsible && (
                    <div className="flex items-center gap-1.5">
                      <User size={11} className="text-violet-400/60 flex-shrink-0" />
                      <span>{u.responsible}</span>
                    </div>
                  )}
                  {u.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone size={11} className="text-violet-400/60 flex-shrink-0" />
                      <span>{u.phone}</span>
                    </div>
                  )}
                </div>

                {/* Sellers associados */}
                <div className="border-t border-white/6 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                      Sellers ({unitSellers.length})
                    </p>
                    <button onClick={() => openSellerAssoc(u)}
                      className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 hover:underline">
                      <Users size={10} /> Gerenciar
                    </button>
                  </div>
                  {unitSellers.length === 0 ? (
                    <p className="text-xs text-amber-400/60 italic">Nenhum seller associado — PDFs salvos em SEM_UNIDADE</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {unitSellers.map((s: any) => (
                        <span key={s.id}
                          className="px-2 py-0.5 bg-violet-600/15 text-violet-300 text-[11px] rounded-full border border-violet-500/20">
                          {s.trade_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal criar/editar unidade */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-md my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">{editId ? 'Editar Unidade' : 'Nova Unidade'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Nome *</label>
                  <input value={form.name} onChange={f('name')} placeholder="Ex: Unidade 1 — São Paulo"
                    className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Código</label>
                  <input value={form.code} onChange={f('code')} placeholder="Ex: UN1"
                    className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">UF</label>
                  <input value={form.state} onChange={f('state')} placeholder="SP" maxLength={2}
                    className={inputCls} style={inputStyle} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Cidade</label>
                  <input value={form.city} onChange={f('city')} placeholder="São Paulo"
                    className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Responsável</label>
                  <input value={form.responsible} onChange={f('responsible')} placeholder="Nome do responsável"
                    className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Telefone</label>
                  <input value={form.phone} onChange={f('phone')} placeholder="(11) 9xxxx-xxxx"
                    className={inputCls} style={inputStyle} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-white/50 mb-1">Endereço</label>
                  <input value={form.location} onChange={f('location')} placeholder="Rua, número, bairro"
                    className={inputCls} style={inputStyle} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-white/60 hover:text-white/90">
                Cancelar
              </button>
              <button onClick={handleSave}
                className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
                {editId ? 'Salvar alterações' : 'Criar unidade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal associação de sellers */}
      {showSellerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-md my-8 p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white">Sellers — {sellerUnitName}</h3>
              <button onClick={() => setShowSellerModal(false)} className="text-white/35 hover:text-white/60">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-white/40 mb-4">
              Selecione os sellers desta unidade. Um seller só pode pertencer a uma unidade — selecionar aqui remove de outra unidade.
            </p>

            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {(allSellers as any[]).filter((s: any) => s.active !== false).map((s: any) => {
                const checked = selectedSellerIds.includes(s.id);
                const otherUnit = !checked && s.unit_id && s.unit_id !== sellerUnitId;
                return (
                  <label key={s.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition
                      ${checked ? 'bg-violet-600/15 border border-violet-500/25' : 'hover:bg-white/4 border border-transparent'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSeller(s.id)}
                      className="rounded accent-violet-500" />
                    <span className="flex-1 text-sm text-white/80">{s.trade_name}</span>
                    {otherUnit && (
                      <span className="text-[10px] text-amber-400/70 italic">outra unidade</span>
                    )}
                    {checked && (
                      <span className="text-[10px] text-violet-400">✓</span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="flex justify-between items-center mt-5">
              <span className="text-xs text-white/30">{selectedSellerIds.length} selecionados</span>
              <div className="flex gap-3">
                <button onClick={() => setShowSellerModal(false)} className="px-4 py-2 text-sm text-white/60 hover:text-white/90">
                  Cancelar
                </button>
                <button onClick={handleSaveSellers}
                  className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
                  Salvar associação
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
