/**
 * WMS Kiwkiw - Hook de Permissões
 *
 * Centraliza toda a lógica de controle de acesso no frontend.
 * Consome os dados do usuário logado (localStorage) e expõe
 * booleanos prontos para uso em componentes React.
 *
 * Uso:
 *   const { canUpload, canEditProducts, isAdmin } = usePermissions();
 *   if (!canUpload) return null;
 *
 * Nota de segurança:
 *   Estas verificações são para UX (ocultar botões). A segurança
 *   real é garantida pelo backend (roles + permissões no JWT).
 */

import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'manager' | 'operator' | 'client';

export interface WmsUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  unit_id?: number | null;
  seller_id?: number | null;
  seller_ids?: number[] | null;   // grupo de sellers (manager/operator)
  permissions?: string[];          // lista vinda do backend via /users/me/permissions
}

export interface PermissionSet {
  // Identidade
  user: WmsUser | null;
  role: UserRole | null;
  isAdmin: boolean;
  isManager: boolean;
  isOperator: boolean;
  isClient: boolean;
  isInternal: boolean;   // admin | manager | operator (não é client)

  // Importação / Upload
  canUpload: boolean;    // SOMENTE admin importa pedidos

  // Exportação
  canExport: boolean;    // todos os perfis

  // Gestão de usuários e sellers (somente admin)
  canManageUsers: boolean;
  canManageSellers: boolean;
  canEditSettings: boolean;

  // Produtos
  canViewProducts: boolean;
  canCreateProduct: boolean;
  canEditProduct: boolean;
  canDeleteProduct: boolean;

  // Estoque
  canViewStock: boolean;
  canEditStock: boolean;
  canExportStock: boolean;

  // Kits e algoritmo de caixas
  canManageKits: boolean;
  canManageBoxAlgo: boolean;

  // Pedidos
  canViewOrders: boolean;
  canInterruptOrder: boolean;    // operador+, com justificativa

  // Bipagem
  canScan: boolean;
  canViewScanHistory: boolean;

  // Dashboard e relatórios
  canViewDashboard: boolean;
  canViewReports: boolean;
  canViewAuditLog: boolean;     // admin e manager
  canViewBilling: boolean;

  // Helpers de escopo
  sellerIds: number[] | null;   // null = admin (sem filtro), array = escopo restrito
  hasSellerScope: boolean;      // true se o usuário tem escopo limitado de sellers
}

// ---------------------------------------------------------------------------
// Hook principal
// ---------------------------------------------------------------------------

export function usePermissions(): PermissionSet {
  const user = useMemo<WmsUser | null>(() => {
    try {
      const raw = localStorage.getItem('wms_user');
      return raw ? (JSON.parse(raw) as WmsUser) : null;
    } catch {
      return null;
    }
  }, []);

  return useMemo<PermissionSet>(() => {
    if (!user) {
      return emptyPermissions();
    }

    const role = user.role;
    const isAdmin    = role === 'admin';
    const isManager  = role === 'manager';
    const isOperator = role === 'operator';
    const isClient   = role === 'client';
    const isInternal = isAdmin || isManager || isOperator;

    // Escopo de sellers
    const sellerIds: number[] | null = isAdmin ? null : (user.seller_ids ?? (user.seller_id ? [user.seller_id] : []));
    const hasSellerScope = !isAdmin;

    return {
      user,
      role,
      isAdmin,
      isManager,
      isOperator,
      isClient,
      isInternal,

      // Upload — SOMENTE ADMIN
      canUpload: isAdmin,

      // Exportação — todos
      canExport: true,

      // Gestão de usuários e sellers — SOMENTE ADMIN
      canManageUsers: isAdmin,
      canManageSellers: isAdmin,
      canEditSettings: isAdmin,

      // Produtos
      canViewProducts:  isInternal,
      canCreateProduct: isAdmin || isManager,
      canEditProduct:   isAdmin || isManager,
      canDeleteProduct: isAdmin,

      // Estoque
      canViewStock:    true,                      // todos veem (filtrado por seller)
      canEditStock:    isAdmin || isManager,
      canExportStock:  true,

      // Kits e caixas
      canManageKits:    isAdmin || isManager,
      canManageBoxAlgo: isAdmin || isManager,

      // Pedidos
      canViewOrders:    true,                      // filtrado por seller no backend
      canInterruptOrder: isInternal,               // com justificativa obrigatória

      // Bipagem
      canScan:           isInternal,
      canViewScanHistory: isInternal,

      // Dashboard e relatórios
      canViewDashboard: true,                      // todos têm algum dashboard
      canViewReports:   isAdmin || isManager,
      canViewAuditLog:  isAdmin || isManager,
      canViewBilling:   isAdmin || isManager,

      // Escopo
      sellerIds,
      hasSellerScope,
    };
  }, [user]);
}

// ---------------------------------------------------------------------------
// Helpers de componente (para uso fora de hooks)
// ---------------------------------------------------------------------------

/**
 * Verifica se um seller_id está dentro do escopo do usuário.
 * Retorna true se o usuário é admin (sem filtro) ou se o seller está no grupo.
 */
export function isSellerInScope(user: WmsUser | null, sellerId: number): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.seller_ids?.includes(sellerId)) return true;
  if (user.seller_id === sellerId) return true;
  return false;
}

/**
 * Retorna o label amigável do role para exibição na UI.
 */
export function getRoleLabel(role: UserRole | string | null): string {
  const labels: Record<string, string> = {
    admin:    'Administrador',
    manager:  'Gerente',
    operator: 'Operador',
    client:   'Cliente',
  };
  return role ? (labels[role] ?? role) : '—';
}

/**
 * Retorna a cor do badge do role.
 */
export function getRoleBadgeColor(role: UserRole | string | null): string {
  const colors: Record<string, string> = {
    admin:    '#7c3aed',  // roxo
    manager:  '#2563eb',  // azul
    operator: '#16a34a',  // verde
    client:   '#d97706',  // âmbar
  };
  return role ? (colors[role] ?? '#6b7280') : '#6b7280';
}

// ---------------------------------------------------------------------------
// Estado vazio (usuário não logado)
// ---------------------------------------------------------------------------

function emptyPermissions(): PermissionSet {
  return {
    user: null,
    role: null,
    isAdmin: false,
    isManager: false,
    isOperator: false,
    isClient: false,
    isInternal: false,
    canUpload: false,
    canExport: false,
    canManageUsers: false,
    canManageSellers: false,
    canEditSettings: false,
    canViewProducts: false,
    canCreateProduct: false,
    canEditProduct: false,
    canDeleteProduct: false,
    canViewStock: false,
    canEditStock: false,
    canExportStock: false,
    canManageKits: false,
    canManageBoxAlgo: false,
    canViewOrders: false,
    canInterruptOrder: false,
    canScan: false,
    canViewScanHistory: false,
    canViewDashboard: false,
    canViewReports: false,
    canViewAuditLog: false,
    canViewBilling: false,
    sellerIds: [],
    hasSellerScope: false,
  };
}
