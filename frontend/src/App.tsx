/**
 * WMS Kiwkiw - App Principal
 * Define rotas e layout global da aplicação.
 */

import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff } from 'lucide-react';

// Pages
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import OrdersPage from './pages/Orders';
import ScannerPage from './pages/Scanner';
import InventoryPage from './pages/Inventory';
import ProductsPage from './pages/Products';
import KitsPage from './pages/Kits';
import KitFixesPage from './pages/KitFixes';
import BoxAlgorithmPage from './pages/BoxAlgorithm';
import UsersPage from './pages/Users';
import SellersPage from './pages/Sellers';
import SellerFixesPage from './pages/SellerFixes';
import UnitsPage from './pages/Units';
import BillingPage from './pages/Billing';
import AuditPage from './pages/Audit';
import SettingsPage from './pages/Settings';
import HandlingPage from './pages/Handling';
import SellerPortalPage from './pages/SellerPortal';

// Components
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

import { authApi } from './api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

// ── Modal de troca de senha obrigatória ───────────────────────────────────────
function ForcePasswordChangeModal({ onDone }: { onDone: () => void }) {
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus trap: ao montar, foca o container; bloqueia Tab fora do modal e Escape
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6) { toast.error('A nova senha deve ter pelo menos 6 caracteres'); return; }
    if (newPwd !== confirmPwd) { toast.error('As senhas não coincidem'); return; }
    setLoading(true);
    try {
      // Senha temporária é sempre "123456" — hardcoded na chamada de setTempPassword
      await authApi.changePassword('123456', newPwd);
      // Atualiza flag no localStorage
      const raw = localStorage.getItem('wms_user');
      if (raw) {
        const u = JSON.parse(raw);
        u.force_password_change = false;
        localStorage.setItem('wms_user', JSON.stringify(u));
      }
      toast.success('Senha alterada com sucesso!');
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao alterar senha');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 outline-none"
      style={{ pointerEvents: 'all' }}
    >
      <div className="bg-surface border border-warn/30 rounded-2xl shadow-2xl w-full max-w-sm p-7">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-amber-500/15 rounded-full flex items-center justify-center mb-4">
            <KeyRound size={26} className="text-warn" />
          </div>
          <h2 className="text-lg font-bold text-t1 text-center">Defina sua nova senha</h2>
          <p className="text-sm text-t3 text-center mt-1">
            Você está usando uma senha temporária.<br />
            Crie uma senha pessoal para continuar.
          </p>
          <p className="text-xs text-warn/80 text-center mt-2">
            A senha deve ter no mínimo 6 caracteres.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-t3 mb-1">Nova senha *</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                name="new-password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoFocus
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 pr-9 text-sm text-t1 outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-t4 hover:text-t3">
                {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-t3 mb-1">Confirmar nova senha *</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                name="confirm-new-password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore
                value={confirmPwd}
                onChange={e => setConfirmPwd(e.target.value)}
                placeholder="Repita a senha"
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 pr-9 text-sm text-t1 outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-t4 hover:text-t3">
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !newPwd || !confirmPwd}
            className="w-full py-2.5 text-sm font-semibold text-t1 bg-amber-500 hover:bg-amber-400 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Wrapper que detecta force_password_change e exibe o modal ────────────────
function AppWithForceChange({ children }: { children: React.ReactNode }) {
  const [needsChange, setNeedsChange] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        const u = JSON.parse(localStorage.getItem('wms_user') || '{}');
        setNeedsChange(!!u.force_password_change && !!localStorage.getItem('wms_token'));
      } catch {
        setNeedsChange(false);
      }
    };
    check();
    // Re-verifica quando o storage mudar (ex: login em outra aba)
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  return (
    <>
      {children}
      {needsChange && <ForcePasswordChangeModal onDone={() => setNeedsChange(false)} />}
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster
          position="top-right"
          containerStyle={{ zIndex: 10000 }}
          toastOptions={{
            duration: 4000,
            style: {
              background: 'rgb(var(--surface))',
              color: 'rgb(var(--t1))',
              border: '1px solid rgb(var(--line))',
            },
          }}
        />
        <AppWithForceChange>
          <Routes>
            {/* Rota pública */}
            <Route path="/login" element={<LoginPage />} />

            {/* Portal do Cliente/Seller — somente leitura */}
            <Route
              path="/portal"
              element={
                <ProtectedRoute allowedRoles={['client', 'admin']}>
                  <SellerPortalPage />
                </ProtectedRoute>
              }
            />
            {/* Compat: redireciona /seller → /portal */}
            <Route path="/seller" element={<Navigate to="/portal" replace />} />
            <Route path="/seller/*" element={<Navigate to="/portal" replace />} />

            {/* Interface de Bipagem (fullscreen) */}
            <Route
              path="/scan"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'operator']}>
                  <ScannerPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/scan/:sessionId"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'operator']}>
                  <ScannerPage />
                </ProtectedRoute>
              }
            />

            {/* Rotas protegidas com layout padrão */}
            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'operator']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="kits" element={<KitsPage />} />
              <Route
                path="kits/vincular"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'manager']}>
                    <KitFixesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="box-algorithm" element={<BoxAlgorithmPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="sellers" element={<SellersPage />} />
              <Route
                path="sellers/corrigir"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'manager']}>
                    <SellerFixesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="units" element={<UnitsPage />} />
              <Route
                path="billing"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <BillingPage />
                  </ProtectedRoute>
                }
              />
              <Route path="audit" element={<AuditPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="manuseios" element={<HandlingPage />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AppWithForceChange>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
