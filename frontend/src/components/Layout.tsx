/**
 * WMS Kiwkiw - Layout Principal com Sidebar
 * Identidade visual: roxo #7B63E8 · teal #3DD9A4 · fundo dark #0C0B18
 */

import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, ScanLine, Warehouse, Tag,
  PackagePlus, Box, Users, Building2, DollarSign,
  ClipboardList, LogOut, Settings, Layers,
} from 'lucide-react';

const navItems = [
  { group: 'Principal', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/orders',    icon: ClipboardList,   label: 'Pedidos'   },
  ]},
  { group: 'Operação', items: [
    { to: '/manuseios', icon: Layers,      label: 'Manuseios'        },
    { to: '/inventory', icon: Warehouse,   label: 'Estoque'          },
    { to: '/billing',   icon: DollarSign,  label: 'Faturamento'      },
    { to: '/audit',     icon: ScanLine,    label: 'Trilha Auditoria' },
  ]},
  { group: 'Cadastros', items: [
    { to: '/products',      icon: Tag,        label: 'Produtos'        },
    { to: '/kits',          icon: PackagePlus,label: 'Kits'            },
    { to: '/box-algorithm', icon: Box,        label: 'Algoritmo Caixa' },
    { to: '/sellers',       icon: Building2,  label: 'Sellers'         },
    { to: '/units',         icon: Warehouse,  label: 'Unidades'        },
    { to: '/users',         icon: Users,      label: 'Usuários'        },
  ]},
  { group: 'Sistema', items: [
    { to: '/settings', icon: Settings, label: 'Configurações' },
  ]},
];

// Nav reduzido para operadores: Manuseios + Estoque (somente visualização)
const navOperator = [
  { group: 'Operação', items: [
    { to: '/manuseios', icon: Layers,    label: 'Manuseios' },
    { to: '/inventory', icon: Warehouse, label: 'Estoque'   },
  ]},
];

export default function Layout() {
  const navigate = useNavigate();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { name: 'Usuário', role: 'operator' };

  const isOperator = user?.role === 'operator';
  const activeNav  = isOperator ? navOperator : navItems;

  const handleLogout = () => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    navigate('/login');
  };

  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0C0B18' }}>

      {/* ── SIDEBAR ─────────────────────────────────────────── */}
      <aside
        className="w-56 flex flex-col flex-shrink-0 border-r"
        style={{ background: '#100E22', borderColor: 'rgba(123,99,232,0.12)' }}
      >
        {/* Logo */}
        <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2.5">
            {/* Logo da marca */}
            <img
              src="/logo.svg"
              alt="Kiwkiw"
              className="w-10 h-10 flex-shrink-0 drop-shadow-lg"
            />
            <div>
              <div className="text-sm font-bold text-white leading-tight">Kiwkiw</div>
              <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                WMS · Fulfillment
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {activeNav.map((group) => (
            <div key={group.group} className="mb-5">
              {/* Group label */}
              <p className="px-2 mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                style={{ color: 'rgba(255,255,255,0.22)' }}>
                {group.group}
              </p>

              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all mb-0.5 ${
                      isActive
                        ? 'text-white font-medium'
                        : 'hover:bg-white/5'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'rgba(123,99,232,0.18)',
                    border: '1px solid rgba(123,99,232,0.28)',
                    color: '#9B87F0',
                  } : {
                    border: '1px solid transparent',
                    color: 'rgba(255,255,255,0.45)',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User Footer */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {/* Avatar + info */}
          <div className="flex items-center gap-2.5 px-1 mb-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #3DD9A4 100%)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-white/80">{user.name}</p>
              <p className="text-[10px] capitalize" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {user.role}
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-all"
            style={{ color: 'rgba(255,255,255,0.30)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = '#f87171';
              (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.08)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.30)';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <LogOut size={12} />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto" style={{ background: '#0C0B18' }}>
        <Outlet />
      </main>
    </div>
  );
}
