/**
 * WMS Kiwkiw - Proteção de Rotas
 * Verifica autenticação e permissões de role antes de renderizar a rota.
 */

import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const token = localStorage.getItem('wms_token');
  const userStr = localStorage.getItem('wms_user');

  // Sem token: redireciona para login
  if (!token || !userStr) {
    return <Navigate to="/login" replace />;
  }

  // Verifica role se especificada
  if (allowedRoles && allowedRoles.length > 0) {
    try {
      const user = JSON.parse(userStr);
      if (!allowedRoles.includes(user.role)) {
        // Role sem permissão: redireciona para dashboard ou login
        return <Navigate to="/dashboard" replace />;
      }
    } catch {
      return <Navigate to="/login" replace />;
    }
  }

  return <>{children}</>;
}
