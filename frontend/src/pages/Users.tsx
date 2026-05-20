/**
 * WMS Kiwkiw - Cadastro de Usuários
 * Gerencia operadores, masters e admins com controle de acesso por role.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Plus, Pencil, Trash2, X, Check, Shield, User } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  admin:    { label: 'Admin',    color: 'bg-red-100 text-red-300' },
  master:   { label: 'Master',  color: 'bg-blue-100 text-blue-700' },
  operator: { label: 'Operador',color: 'bg-violet-900/40 text-violet-300' },
  seller:   { label: 'Seller',  color: 'bg-purple-100 text-purple-700' },
};

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: string;
  unit_id: number | '';
  seller_id: number | '';
}

const EMPTY: UserForm = { name: '', email: '', password: '', role: 'operator', unit_id: '', seller_id: '' };

export default function UsersPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY);

  const { data: users = [] } = useQuery('users', () => cadastrosApi.users().then(r => r.data));
  const { data: units = [] } = useQuery('units', () => cadastrosApi.units().then(r => r.data));
  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  const openCreate = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (u: any) => {
    setForm({ name: u.name, email: u.email, password: '', role: u.role, unit_id: u.unit_id || '', seller_id: u.seller_id || '' });
    setEditId(u.id); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.email || (!editId && !form.password)) { toast.error('Nome, e-mail e senha são obrigatórios'); return; }
    try {
      if (editId) { await cadastrosApi.updateUser(editId, form); toast.success('Usuário atualizado!'); }
      else { await cadastrosApi.createUser(form); toast.success('Usuário criado!'); }
      qc.invalidateQueries('users');
      setShowModal(false);
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Erro ao salvar'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este usuário?')) return;
    try { await cadastrosApi.deleteUser(id); toast.success('Usuário excluído'); qc.invalidateQueries('users'); }
    catch { toast.error('Erro ao excluir'); }
  };

  const f = (key: keyof UserForm, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Usuários</h1>
          <p className="text-sm text-white/50 mt-0.5">Operadores, masters e admins do sistema</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition">
          <Plus size={14} /> Novo Usuário
        </button>
      </div>

      {/* Cards de usuários */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((u: any) => {
          const role = ROLE_CONFIG[u.role] ?? { label: u.role, color: 'bg-gray-100 text-white/60' };
          return (
            <div key={u.id} className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-900/40 rounded-xl flex items-center justify-center">
                    <User size={18} className="text-violet-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white/90">{u.name}</p>
                    <p className="text-xs text-white/35">{u.email}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${role.color}`}>{role.label}</span>
              </div>

              <div className="text-xs text-white/35 space-y-0.5 mb-3">
                {u.unit_name && <p>Unidade: <span className="text-white/60">{u.unit_name}</span></p>}
                {u.seller_name && <p>Seller: <span className="text-white/60">{u.seller_name}</span></p>}
                <p>Criado em: <span className="text-white/60">{u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}</span></p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => openEdit(u)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">
                  <Pencil size={12} /> Editar
                </button>
                <button onClick={() => handleDelete(u.id)}
                  className="flex items-center justify-center px-3 py-1.5 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-900/25 transition">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
        {users.length === 0 && (
          <div className="col-span-3 bg-gray-900 border border-dashed border-white/12 rounded-xl p-10 text-center">
            <Shield size={32} className="text-white/25 mx-auto mb-2" />
            <p className="text-sm text-white/35">Nenhum usuário cadastrado</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">{editId ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              {[
                { label: 'Nome *', key: 'name' as const, type: 'text' },
                { label: 'E-mail *', key: 'email' as const, type: 'email' },
                { label: editId ? 'Nova Senha (deixe em branco para manter)' : 'Senha *', key: 'password' as const, type: 'password' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-white/50 mb-1">{field.label}</label>
                  <input type={field.type} value={form[field.key] as string}
                    onChange={e => f(field.key, e.target.value)}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              ))}

              <div>
                <label className="block text-xs text-white/50 mb-1">Perfil *</label>
                <select value={form.role} onChange={e => f('role', e.target.value)}
                  className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="operator">Operador</option>
                  <option value="master">Master</option>
                  <option value="admin">Admin</option>
                  <option value="seller">Seller</option>
                </select>
              </div>

              {['operator', 'master'].includes(form.role) && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">Unidade</label>
                  <select value={form.unit_id} onChange={e => f('unit_id', Number(e.target.value))}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">Selecione...</option>
                    {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              )}

              {form.role === 'seller' && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">Seller</label>
                  <select value={form.seller_id} onChange={e => f('seller_id', Number(e.target.value))}
                    className="w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">Selecione...</option>
                    {sellers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition flex items-center justify-center gap-1.5">
                <Check size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
