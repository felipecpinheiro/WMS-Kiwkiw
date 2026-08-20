/**
 * WMS Kiwkiw - Layout Principal com Sidebar
 * Identidade visual: roxo #7B63E8 · teal #3DD9A4 · tokens de tema em src/index.css
 */

import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, ScanLine, Warehouse, Tag,
  PackagePlus, Box, Users, Building2, DollarSign,
  ClipboardList, LogOut, Settings, Layers, MoreHorizontal,
} from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import BottomSheet from './BottomSheet';
import ThemeToggle from './ThemeToggle';

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

// Atalhos da barra inferior (mobile) — as telas mais usadas no dia a dia
const mobileTabsAdmin = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/orders',    icon: ClipboardList,   label: 'Pedidos'   },
  { to: '/manuseios', icon: Layers,          label: 'Manuseios' },
  { to: '/inventory', icon: Warehouse,       label: 'Estoque'   },
];
const mobileTabsOperator = [
  { to: '/manuseios', icon: Layers,    label: 'Manuseios' },
  { to: '/inventory', icon: Warehouse, label: 'Estoque'   },
];

export default function Layout() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { name: 'Usuário', role: 'operator' };

  const isOperator = user?.role === 'operator';
  const activeNav  = isOperator ? navOperator : navItems;
  const mobileTabs = isOperator ? mobileTabsOperator : mobileTabsAdmin;

  const handleLogout = () => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    navigate('/login');
  };

  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  return (
    <div className="flex h-screen overflow-hidden bg-app">

      {/* ── SIDEBAR (desktop) ────────────────────────────────── */}
      {!isMobile && (
      <aside
        className="w-56 flex flex-col flex-shrink-0 border-r bg-sidebar border-brand-line"
      >
        {/* Logo */}
        <div className="p-4 border-b border-line-soft">
          <div className="flex items-center gap-2.5">
            {/* Logo da marca */}
            <img
              src="/logo.svg"
              alt="Kiwkiw"
              className="w-10 h-10 flex-shrink-0 drop-shadow-lg"
            />
            <div>
              <div className="text-sm font-bold text-t1 leading-tight">Kiwkiw</div>
              <div className="text-[10px] font-medium text-t4">
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
              <p className="px-2 mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-t5">
                {group.group}
              </p>

              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all mb-0.5 ${
                      isActive
                        ? 'text-t1 font-medium'
                        : 'hover:bg-surface-2'
                    }`
                  }
                  style={({ isActive }) => isActive ? {
                    background: 'rgb(var(--brand-soft))',
                    border: '1px solid rgb(var(--brand-line))',
                    color: 'rgb(var(--brand))',
                  } : {
                    border: '1px solid transparent',
                    color: 'rgb(var(--t4))',
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
        <div className="p-3 border-t border-line-soft">
          {/* Avatar + info */}
          <div className="flex items-center gap-2.5 px-1 mb-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 text-t1 bg-brand-gradient">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-t2">{user.name}</p>
              <p className="text-[10px] capitalize text-t4">
                {user.role}
              </p>
            </div>
            <ThemeToggle />
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-all"
            style={{ color: 'rgb(var(--t4))' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = 'rgb(var(--bad))';
              (e.currentTarget as HTMLElement).style.background = 'rgb(var(--bad-soft))';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = 'rgb(var(--t4))';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <LogOut size={12} />
            Sair da conta
          </button>
        </div>
      </aside>
      )}

      {/* ── MAIN CONTENT + BARRA INFERIOR (mobile) ────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-app">
          <Outlet />
        </main>

        {isMobile && (
          <nav
            className="flex flex-shrink-0 border-t bg-sidebar border-brand-line"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {mobileTabs.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px]"
                style={({ isActive }) => ({ color: isActive ? 'rgb(var(--brand))' : 'rgb(var(--t4))' })}
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px] text-t4"
            >
              <MoreHorizontal size={18} />
              Mais
            </button>
          </nav>
        )}
      </div>

      {/* ── GAVETA (mobile) ─────────────────────────────────── */}
      {isMobile && (
        <BottomSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 text-t1 bg-brand-gradient">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-t1 truncate">{user.name}</p>
              <p className="text-xs capitalize text-t4">{user.role}</p>
            </div>
            <ThemeToggle />
          </div>

          {activeNav.map((group) => (
            <div key={group.group} className="mb-4">
              <p className="px-1 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-t5">
                {group.group}
              </p>
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-0.5"
                  style={({ isActive }) => isActive ? {
                    background: 'rgb(var(--brand-soft))',
                    border: '1px solid rgb(var(--brand-line))',
                    color: 'rgb(var(--brand))',
                    fontWeight: 500,
                  } : {
                    border: '1px solid transparent',
                    color: 'rgb(var(--t3))',
                  }}
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 mt-2 text-sm rounded-lg text-bad/75"
          >
            <LogOut size={15} />
            Sair da conta
          </button>
        </BottomSheet>
      )}
    </div>
  );
}
