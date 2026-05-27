/**
 * WMS Kiwkiw - Cadastro de Usuários
 * Perfis: admin, manager, operator, client.
 * Somente administrador acessa esta página.
 *
 * Associação de sellers:
 *  - admin    → sem restrição (não precisa de seller)
 *  - manager  → multi-select de sellers que gerencia
 *  - operator → multi-select de sellers que bipa
 *  - client   → single-select (portal de 1 seller)
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Plus, Pencil, UserX, UserCheck, X, Check, Shield, User, ChevronDown } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Configuração dos perfis
// ---------------------------------------------------------------------------
const ROLE_CONFIG: Record<string, { label: string; desc: string; badgeCls: string }> = {
  admin: {
    label: 'Administrador',
    desc: 'Acesso total. Importa pedidos, cadastra usuários e sellers.',
    badgeCls: 'bg-purple-900/40 text-purple-300',
  },
  manager: {
    label: 'Gerente',
    desc: 'Vê e edita o grupo de sellers que gerencia. Associe os sellers abaixo.',
    badgeCls: 'bg-blue-900/40 text-blue-300',
  },
  operator: {
    label: 'Operador',
    desc: 'Realiza bipagem dos sellers que atende. Associe os sellers abaixo.',
    badgeCls: 'bg-green-900/40 text-green-300',
  },
  client: {
    label: 'Cliente',
    desc: 'Portal somente leitura. Selecione o seller do portal abaixo.',
    badgeCls: 'bg-amber-900/40 text-amber-300',
  },
};

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface UserForm {
  name: string;
  email: string;
  password: string;
  role: string;
  unit_id: number | '';
  seller_id: number | '';   // client: seller único
  seller_ids: number[];     // manager/operator: lista de sellers
}

const EMPTY: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'operator',
  unit_id: '',
  seller_id: '',
  seller_ids: [],
};

// ---------------------------------------------------------------------------
// Componente de multi-select de sellers
// ---------------------------------------------------------------------------
function SellerMultiSelect({
  sellers,
  selected,
  onChange,
}: {
  sellers: any[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  return (
    <div className="border border-white/12 rounded-lg overflow-hidden max-h-44 overflow-y-auto">
      {sellers.length === 0 && (
        <p className="text-xs text-white/35 p-3">Nenhum seller cadastrado</p>
      )}
      {sellers.map((s: any) => {
        const checked = selected.includes(s.id);
        return (
          <label
            key={s.id}
            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition select-none
              ${checked ? 'bg-violet-900/30' : 'hover:bg-white/4'}`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition
              ${checked ? 'bg-violet-500 border-violet-500' : 'border-white/25 bg-transparent'}`}
            >
              {checked && <Check size={10} className="text-white" />}
            </div>
            <span className="text-sm text-white/80">{s.trade_name || s.name}</span>
            <input
              type="checkbox"
              className="hidden"
              checked={checked}
              onChange={() => toggle(s.id)}
            />
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function UsersPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data: users = [], isLoading } = useQuery(
    'users',
    () => cadastrosApi.users({ active_only: false }).then(r => r.data),
  );
  const { data: units = [] } = useQuery('units', () => cadastrosApi.units().then(r => r.data));
  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));

  const openCreate = () => {
    setForm(EMPTY);
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (u: any) => {
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      unit_id: u.unit_id ?? '',
      seller_id: u.seller_id ?? '',
      seller_ids: u.seller_ids ?? [],
    });
    setEditId(u.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nome e e-mail são obrigatórios');
      return;
    }
    if (!editId && !form.password) {
      toast.error('Senha é obrigatória para novo usuário');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name:      form.name.trim(),
        email:     form.email.trim(),
        role:      form.role,
        unit_id:   form.unit_id   !== '' ? Number(form.unit_id)   : null,
        seller_id: form.seller_id !== '' ? Number(form.seller_id) : null,
        seller_ids: ['manager', 'operator'].includes(form.role) ? form.seller_ids : [],
      };
      if (form.password) payload.password = form.password;

      if (editId) {
        await cadastrosApi.updateUser(editId, payload);
        toast.success('Usuário atualizado!');
      } else {
        await cadastrosApi.createUser(payload);
        toast.success('Usuário criado!');
      }
      qc.invalidateQueries('users');
      setShowModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar usuário');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: number, name: string) => {
    if (!confirm(`Inativar "${name}"?\n\nEle não conseguirá mais fazer login, mas o histórico é preservado.`)) return;
    try {
      await cadastrosApi.deleteUser(id);
      toast.success('Usuário inativado');
      qc.invalidateQueries('users');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao inativar');
    }
  };

  const handleReactivate = async (id: number, name: string) => {
    if (!confirm(`Reativar "${name}"? Ele voltará a conseguir fazer login.`)) return;
    try {
      await cadastrosApi.reactivateUser(id);
      toast.success(`${name} reativado com sucesso!`);
      qc.invalidateQueries('users');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao reativar');
    }
  };

  const f = (key: keyof UserForm, val: any) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const showUnit        = ['admin', 'manager', 'operator'].includes(form.role);
  const showSellerMulti = ['manager', 'operator'].includes(form.role);
  const showSellerSingle = form.role === 'client';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Usuários</h1>
          <p className="text-sm text-white/50 mt-0.5">
            {users.length} usuário{users.length !== 1 ? 's' : ''} cadastrado{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition"
        >
          <Plus size={14} /> Novo Usuário
        </button>
      </div>

      {/* Grid de usuários */}
      {isLoading ? (
        <div className="text-center text-white/35 py-12">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((u: any) => {
            const roleConf = ROLE_CONFIG[u.role] ?? {
              label: u.role,
              desc: '',
              badgeCls: 'bg-gray-700 text-white/50',
            };
            return (
              <div
                key={u.id}
                className={`bg-gray-900 rounded-xl border shadow-none p-4 transition
                  ${u.active === false ? 'opacity-40 border-white/5' : 'border-white/8'}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-violet-900/40 rounded-xl flex items-center justify-center shrink-0">
                      <User size={18} className="text-violet-300" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white/90">{u.name}</p>
                      <p className="text-xs text-white/35">{u.email}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleConf.badgeCls}`}>
                    {roleConf.label}
                  </span>
                </div>

                <div className="text-xs text-white/35 space-y-0.5 mb-3">
                  {u.unit_name && (
                    <p>Unidade: <span className="text-white/60">{u.unit_name}</span></p>
                  )}
                  {/* Sellers associados (manager/operator) */}
                  {u.seller_names && u.seller_names.length > 0 && (
                    <p>
                      Sellers:{' '}
                      <span className="text-white/60">
                        {u.seller_names.join(', ')}
                      </span>
                    </p>
                  )}
                  {/* Seller único (client) */}
                  {u.seller_name && (!u.seller_names || u.seller_names.length === 0) && (
                    <p>Seller: <span className="text-white/60">{u.seller_name}</span></p>
                  )}
                  <p>
                    Cadastro:{' '}
                    <span className="text-white/60">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  </p>
                  {u.active === false && (
                    <p className="text-red-400/80 font-medium">Inativo</p>
                  )}
                </div>

                <div className="flex gap-2">
                  {u.active !== false ? (
                    <>
                      <button
                        onClick={() => openEdit(u)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      <button
                        onClick={() => handleDeactivate(u.id, u.name)}
                        className="flex items-center justify-center px-3 py-1.5 text-xs text-red-400 border border-red-900/40 rounded-lg hover:bg-red-900/20 transition"
                        title="Inativar usuário"
                      >
                        <UserX size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleReactivate(u.id, u.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-emerald-400 border border-emerald-900/40 rounded-lg hover:bg-emerald-900/20 transition"
                      title="Reativar usuário"
                    >
                      <UserCheck size={12} /> Reativar
                    </button>
                  )}
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
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Modal                                                               */}
      {/* ------------------------------------------------------------------ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">
                {editId ? 'Editar Usuário' : 'Novo Usuário'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-white/35 hover:text-white/60">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Nome */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => f('name', e.target.value)}
                  placeholder="Nome completo"
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* E-mail */}
              <div>
                <label className="block text-xs text-white/50 mb-1">E-mail *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => f('email', e.target.value)}
                  placeholder="usuario@email.com"
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Senha */}
              <div>
                <label className="block text-xs text-white/50 mb-1">
                  {editId ? 'Nova Senha (em branco = manter)' : 'Senha *'}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => f('password', e.target.value)}
                  placeholder={editId ? 'Deixe em branco para não alterar' : 'Mínimo 6 caracteres'}
                  className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Perfil */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Perfil *</label>
                <div className="relative">
                  <select
                    value={form.role}
                    onChange={e => f('role', e.target.value)}
                    className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                  >
                    <option value="operator">Operador</option>
                    <option value="manager">Gerente</option>
                    <option value="admin">Administrador</option>
                    <option value="client">Cliente (portal)</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
                </div>
                {form.role && ROLE_CONFIG[form.role] && (
                  <p className="text-xs text-white/30 mt-1 ml-1">
                    {ROLE_CONFIG[form.role].desc}
                  </p>
                )}
              </div>

              {/* Unidade — admin / manager / operator */}
              {showUnit && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">Unidade</label>
                  <div className="relative">
                    <select
                      value={form.unit_id}
                      onChange={e => f('unit_id', e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                    >
                      <option value="">Selecione uma unidade...</option>
                      {units.map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Sellers — multi-select para manager e operator */}
              {showSellerMulti && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    Sellers que este usuário atende
                    {form.seller_ids.length > 0 && (
                      <span className="ml-2 text-violet-400">
                        ({form.seller_ids.length} selecionado{form.seller_ids.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </label>
                  <SellerMultiSelect
                    sellers={sellers}
                    selected={form.seller_ids}
                    onChange={ids => f('seller_ids', ids)}
                  />
                  {form.seller_ids.length === 0 && (
                    <p className="text-xs text-amber-400/70 mt-1 ml-1">
                      ⚠ Sem seller associado, o usuário não verá dados de nenhum seller.
                    </p>
                  )}
                </div>
              )}

              {/* Seller único — client */}
              {showSellerSingle && (
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    Seller do portal *
                  </label>
                  <div className="relative">
                    <select
                      value={form.seller_id}
                      onChange={e => f('seller_id', e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-gray-800 border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                    >
                      <option value="">Selecione o seller...</option>
                      {sellers.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
                  </div>
                </div>
              )}
            </div>

            {/* Botões */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-white/60 border border-white/12 rounded-lg hover:bg-white/4 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
              >
                <Check size={14} />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
