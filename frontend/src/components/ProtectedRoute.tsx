/**
 * WMS Kiwkiw - Proteção de Rotas por Role
 *
 * Verifica autenticação e permissões antes de renderizar a rota.
 * Cada perfil tem um dashboard padrão diferente ao qual é redirecionado
 * se tentar acessar uma rota não permitida.
 *
 * Uso:
 *   // Rota aberta a qualquer usuário autenticado
 *   <ProtectedRoute><Dashboard /></ProtectedRoute>
 *
 *   // Rota exclusiva do admin
 *   <ProtectedRoute allowedRoles={['admin']}><UserManagement /></ProtectedRoute>
 *
 *   // Admin e gerente
 *   <ProtectedRoute allowedRoles={['admin', 'manager']}><Reports /></ProtectedRoute>
 *
 *   // Usuários internos (exclui client)
 *   <ProtectedRoute internalOnly><ScanInterface /></ProtectedRoute>
 */

import { Navigate } from 'react-router-dom';
import type { UserRole } from '../hooks/usePermissions';

// ---------------------------------------------------------------------------
// Rota padrão por perfil (para onde redirecionar se o role não tem acesso)
// ---------------------------------------------------------------------------
const DEFAULT_ROUTE_BY_ROLE: Record<UserRole, string> = {
  admin:    '/dashboard',
  manager:  '/dashboard',
  operator: '/manuseios',
  client:   '/portal',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ProtectedRouteProps {
  children: React.ReactNode;

  /** Roles que podem acessar esta rota. Vazio/undefined = qualquer autenticado. */
  allowedRoles?: UserRole[];

  /**
   * Atalho: se true, somente admin | manager | operator podem acessar.
   * (exclui o perfil 'client')
   */
  internalOnly?: boolean;

  /**
   * Atalho: se true, somente admin pode acessar.
   */
  adminOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function ProtectedRoute({
  children,
  allowedRoles,
  internalOnly = false,
  adminOnly = false,
}: ProtectedRouteProps) {
  const token   = localStorage.getItem('wms_token');
  const userStr = localStorage.getItem('wms_user');

  // 1. Sem token → login
  if (!token || !userStr) {
    return <Navigate to="/login" replace />;
  }

  let user: { role: UserRole } | null = null;
  try {
    user = JSON.parse(userStr);
  } catch {
    // JSON inválido → limpa e redireciona
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    return <Navigate to="/login" replace />;
  }

  if (!user?.role) {
    return <Navigate to="/login" replace />;
  }

  const role = user.role;

  // 2. Resolve a lista de roles permitidos
  let effectiveAllowed: UserRole[] | undefined = allowedRoles;

  if (adminOnly) {
    effectiveAllowed = ['admin'];
  } else if (internalOnly) {
    effectiveAllowed = ['admin', 'manager', 'operator'];
  }

  // 3. Verifica permissão
  if (effectiveAllowed && effectiveAllowed.length > 0) {
    if (!effectiveAllowed.includes(role)) {
      // Redireciona ao dashboard padrão do role atual
      const fallback = DEFAULT_ROUTE_BY_ROLE[role] ?? '/login';
      return <Navigate to={fallback} replace />;
    }
  }

  // 4. Tudo ok — renderiza a rota
  return <>{children}</>;
}
