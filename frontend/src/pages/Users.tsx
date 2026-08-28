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
import { Plus, Pencil, UserX, UserCheck, X, Check, Shield, User, ChevronDown, KeyRound } from 'lucide-react';
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
    badgeCls: 'bg-info-soft text-info',
  },
  operator: {
    label: 'Operador',
    desc: 'Realiza bipagem dos sellers que atende. Associe os sellers abaixo.',
    badgeCls: 'bg-ok-soft text-ok',
  },
  client: {
    label: 'Cliente',
    desc: 'Portal somente leitura. Selecione o seller do portal abaixo.',
    badgeCls: 'bg-warn-soft text-warn',
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
  unitId,
}: {
  sellers: any[];
  selected: number[];
  onChange: (ids: number[]) => void;
  unitId: number | '';
}) {
  // Mostra apenas os sellers da unidade selecionada (ou todos se sem unidade)
  const visible = unitId
    ? sellers.filter((s: any) => s.unit_id === unitId)
    : sellers;

  const visibleIds = visible.map((s: any) => s.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));

  const toggleAll = () => {
    if (allVisibleSelected) {
      // Desmarca os visíveis, mantém selecionados de outras unidades
      onChange(selected.filter(id => !visibleIds.includes(id)));
    } else {
      const toAdd = visibleIds.filter(id => !selected.includes(id));
      onChange([...selected, ...toAdd]);
    }
  };

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  return (
    <div className="border border-line rounded-lg overflow-hidden">
      {/* Botão selecionar/desmarcar todos da unidade */}
      {visible.length > 0 && (
        <button
          type="button"
          onClick={toggleAll}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-violet-400 hover:bg-surface-2 border-b border-line-soft transition"
        >
          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition
            ${allVisibleSelected ? 'bg-violet-500 border-violet-500' : 'border-line-strong bg-transparent'}`}
          >
            {allVisibleSelected && <Check size={10} className="text-t1" />}
          </div>
          {allVisibleSelected ? 'Desmarcar todos desta unidade' : 'Selecionar todos desta unidade'}
        </button>
      )}

      <div className="max-h-44 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-xs text-t4 p-3">
            {unitId ? 'Nenhum seller nesta unidade' : 'Nenhum seller cadastrado'}
          </p>
        )}
        {visible.map((s: any) => {
          const checked = selected.includes(s.id);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition select-none
                ${checked ? 'bg-violet-900/30' : 'hover:bg-surface-2'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition
                ${checked ? 'bg-violet-500 border-violet-500' : 'border-line-strong bg-transparent'}`}
              >
                {checked && <Check size={10} className="text-t1" />}
              </div>
              <span className="text-sm text-t2">{s.trade_name || s.name}</span>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function UsersPage() {
  const qc = useQueryClient();
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('wms_user') || '{}'); } catch { return {}; } })();
  const isAdmin = currentUser.role === 'admin';
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data: users = [], isLoading } = useQuery(
    'users',
    () => cadastrosApi.users({ active_only: false }).then(r => r.data),
    { enabled: isAdmin },
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

  const handleTempPassword = async (id: number, name: string) => {
    if (!confirm(`Definir senha temporária "123456" para ${name}?\n\nO usuário será obrigado a trocar a senha no próximo login.`)) return;
    try {
      await cadastrosApi.setTempPassword(id);
      toast.success(`Senha temporária definida para ${name}`);
      qc.invalidateQueries('users');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao definir senha temporária');
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

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-t4 py-20">
        <Shield size={32} className="mx-auto mb-3 text-t5" />
        <p className="text-sm">Acesso restrito ao administrador.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-t1">Usuários</h1>
          <p className="text-sm text-t3 mt-0.5">
            {users.length} usuário{users.length !== 1 ? 's' : ''} cadastrado{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition"
        >
          <Plus size={14} /> Novo Usuário
        </button>
      </div>

      {/* Grid de usuários */}
      {isLoading ? (
        <div className="text-center text-t4 py-12">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((u: any) => {
            const roleConf = ROLE_CONFIG[u.role] ?? {
              label: u.role,
              desc: '',
              badgeCls: 'bg-line-strong text-t3',
            };
            return (
              <div
                key={u.id}
                className={`bg-surface rounded-xl border shadow-none p-4 transition
                  ${u.active === false ? 'opacity-40 border-line-soft' : 'border-line-soft'}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-violet-900/40 rounded-xl flex items-center justify-center shrink-0">
                      <User size={18} className="text-violet-300" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-t1">{u.name}</p>
                      <p className="text-xs text-t4">{u.email}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleConf.badgeCls}`}>
                    {roleConf.label}
                  </span>
                </div>

                <div className="text-xs text-t4 space-y-0.5 mb-3">
                  {u.role === 'admin' ? (
                    <p>Unidades: <span className="text-t3">Todas</span></p>
                  ) : u.unit_name && (
                    <p>Unidade: <span className="text-t3">{u.unit_name}</span></p>
                  )}
                  {u.seller_names && u.seller_names.length > 0 && (
                    <p>
                      Sellers:{' '}
                      <span className="text-t3">
                        {u.seller_names.join(', ')}
                      </span>
                    </p>
                  )}
                  {u.seller_name && (!u.seller_names || u.seller_names.length === 0) && (
                    <p>Seller: <span className="text-t3">{u.seller_name}</span></p>
                  )}
                  <p>
                    Cadastro:{' '}
                    <span className="text-t3">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  </p>
                  {u.active === false && (
                    <p className="text-bad/80 font-medium">Inativo</p>
                  )}
                  {u.force_password_change && (
                    <p className="text-warn/90 font-medium flex items-center gap-1">
                      <KeyRound size={11} /> Senha temporária ativa
                    </p>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {u.active !== false ? (
                    <>
                      <button
                        onClick={() => openEdit(u)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-t3 border border-line rounded-lg hover:bg-surface-2 transition"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleTempPassword(u.id, u.name)}
                          className="flex items-center justify-center px-3 py-1.5 text-xs text-warn border border-warn/40 rounded-lg hover:bg-warn-soft transition"
                          title="Definir senha temporária (123456)"
                        >
                          <KeyRound size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeactivate(u.id, u.name)}
                        className="flex items-center justify-center px-3 py-1.5 text-xs text-bad border border-bad/40 rounded-lg hover:bg-bad-soft transition"
                        title="Inativar usuário"
                      >
                        <UserX size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleReactivate(u.id, u.name)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-ok border border-ok/40 rounded-lg hover:bg-ok-soft transition"
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
            <div className="col-span-3 bg-surface border border-dashed border-line rounded-xl p-10 text-center">
              <Shield size={32} className="text-t5 mx-auto mb-2" />
              <p className="text-sm text-t4">Nenhum usuário cadastrado</p>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Modal                                                               */}
      {/* ------------------------------------------------------------------ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-t1">
                {editId ? 'Editar Usuário' : 'Novo Usuário'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-t4 hover:text-t3">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Nome */}
              <div>
                <label className="block text-xs text-t3 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => f('name', e.target.value)}
                  placeholder="Nome completo"
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* E-mail */}
              <div>
                <label className="block text-xs text-t3 mb-1">E-mail *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => f('email', e.target.value)}
                  placeholder="usuario@email.com"
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Senha */}
              <div>
                <label className="block text-xs text-t3 mb-1">
                  {editId ? 'Nova Senha (em branco = manter)' : 'Senha *'}
                </label>
                <input
                  type="password"
                  name="user-new-password"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore
                  value={form.password}
                  onChange={e => f('password', e.target.value)}
                  placeholder={editId ? 'Deixe em branco para não alterar' : 'Mínimo 6 caracteres'}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Perfil */}
              <div>
                <label className="block text-xs text-t3 mb-1">Perfil *</label>
                <div className="relative">
                  <select
                    value={form.role}
                    onChange={e => f('role', e.target.value)}
                    className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                  >
                    <option value="operator">Operador</option>
                    <option value="manager">Gerente</option>
                    <option value="admin">Administrador</option>
                    <option value="client">Cliente (portal)</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
                </div>
                {form.role && ROLE_CONFIG[form.role] && (
                  <p className="text-xs text-t4 mt-1 ml-1">
                    {ROLE_CONFIG[form.role].desc}
                  </p>
                )}
              </div>

              {/* Unidade — admin / manager / operator */}
              {showUnit && (
                <div>
                  <label className="block text-xs text-t3 mb-1">Unidade</label>
                  {form.role === 'admin' ? (
                    <div className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t3">
                      Todas as unidades
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={form.unit_id}
                        onChange={e => f('unit_id', e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                      >
                        <option value="">Selecione uma unidade...</option>
                        {units.map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
                    </div>
                  )}
                </div>
              )}

              {/* Sellers — multi-select para manager e operator */}
              {showSellerMulti && (
                <div>
                  <label className="block text-xs text-t3 mb-1">
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
                    unitId={form.unit_id}
                  />
                  {form.seller_ids.length === 0 && (
                    <p className="text-xs text-warn/70 mt-1 ml-1">
                      ⚠ Sem seller associado, o usuário não verá dados de nenhum seller.
                    </p>
                  )}
                </div>
              )}

              {/* Seller único — client */}
              {showSellerSingle && (
                <div>
                  <label className="block text-xs text-t3 mb-1">
                    Seller do portal *
                  </label>
                  <div className="relative">
                    <select
                      value={form.seller_id}
                      onChange={e => f('seller_id', e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
                    >
                      <option value="">Selecione o seller...</option>
                      {sellers.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
                  </div>
                </div>
              )}
            </div>

            {/* Botões */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-t3 border border-line rounded-lg hover:bg-surface-2 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 text-sm text-t1 bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
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
