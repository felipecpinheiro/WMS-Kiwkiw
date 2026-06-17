/**
 * WMS Kiwkiw - Cliente da API
 * Centraliza todas as chamadas HTTP para o backend FastAPI.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// URL base da API (configurável via variável de ambiente)
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Instância do Axios com configurações padrão
const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor de request: injeta token JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wms_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor de response: trata erros globais
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('wms_token');
      localStorage.removeItem('wms_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);


// ============================================================
// HELPERS
// ============================================================

/** Download autenticado via Axios (envia Bearer token). Fallback para window.open caso falhe. */
async function downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob', timeout: 60000 });
  const disposition: string = response.headers['content-disposition'] ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(blobUrl);
}

// ============================================================
// TYPES
// ============================================================

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'operator' | 'client';
  unit_id: number | null;
  seller_id: number | null;
  seller_ids?: number[] | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  user_id: number;
  name: string;
  unit_id: number | null;
  seller_id: number | null;
}

export interface DashboardChecks {
  transport: boolean;
  separation: boolean;
  planning: boolean;
  stock: boolean;
  products_registered: boolean;
  all_ok: boolean;
  missing_products: string[];
  missing_carriers?: any[];
}

export interface DashboardStats {
  today: string;
  total_orders_today: number;
  orders_completed: number;
  orders_pending: number;
  orders_scanning: number;
  completion_rate: number;
  active_sessions: number;
  units_summary: UnitSummary[];
  sellers_with_orders: SellerSummary[];
  recent_scans: RecentScan[];
  alerts: Alert[];
  // Extended fields used in cockpit
  checks?: DashboardChecks;
  sellers_no_orders?: SellerSummary[];
  sessions_today?: PickingSession[];
  operators_summary?: Array<{
    operator_id: number;
    operator_name: string;
    scans: number;
    orders_touched: number;
    orders_completed: number;
  }>;
  orders_no_operator?: number;
}

export interface UnitSummary {
  unit_id: number;
  unit_name: string;
  total: number;
  completed: number;
  pct: number;
}

export interface SellerSummary {
  seller_id: number;
  seller_name: string;
  total: number;
  completed: number;
  pct: number;
}

export interface RecentScan {
  timestamp: string;
  operator: string;
  sku: string;
  order_nf: string;
}

export interface Alert {
  type: 'info' | 'warning' | 'error';
  message: string;
}

export interface Order {
  id: number;
  nf_number: string;
  customer_name: string;
  order_date: string;
  seller_id: number;
  seller_name: string;
  unit_id: number;
  carrier: string;
  status: string;
  expedition_date: string | null;
  nature: string;
  danfe_key: string;
  for_billing: boolean;
  imported_at: string;
  items: OrderItem[];
}

export interface OrderItem {
  id: number;
  sku: string;
  product_name: string;
  quantity: number;
  is_kit_component: boolean;
  original_kit_sku: string | null;
}

export interface PickingSession {
  id: number;
  session_date: string;
  unit_id: number;
  seller_id: number | null;
  status: string;
  total_orders: number;
  completed_orders: number;
  check_transport: boolean;
  check_separation: boolean;
  check_planning: boolean;
  check_stock: boolean;
  all_checks_ok: boolean;
  file_type?: 'Entrada' | 'Saída' | string;
  for_billing?: boolean;
  source_file?: string | null;
  created_at?: string;
  sellers?: string[];
  unit_name?: string;
}

export interface SessionCard {
  card_id: string;
  session_id: number;
  seller_id: number | null;
  seller_name: string;
  session_date: string;
  created_at: string | null;
  unit_id: number;
  source_file: string | null;
  total_orders: number;
  completed_orders: number;
  status: string;
  all_checks_ok: boolean;
}

export interface DuplicateOrderInfo {
  nf_number: string;
  seller_name: string;
  existing_order_id: number | null;
  existing_session_id: number | null;
  existing_imported_at: string | null;
}

export interface ImportResult {
  success: boolean;
  message: string;
  session_id: number | null;
  total_rows: number;
  orders_imported: number;
  orders_with_kits: number;
  errors: string[];
  warnings: string[];
  requires_confirmation: boolean;
  duplicates: DuplicateOrderInfo[];
}

export interface ScanRequest {
  session_id: number;
  order_id: number;
  barcode: string;
  operator_id: number;
}

export interface ScanResponse {
  success: boolean;
  message: string;
  status: string;
  sku: string | null;
  product_name: string | null;
  photo_url: string | null;
  items_remaining: number;
  order_progress: any | null;
}

export interface Product {
  id: number;
  seller_id: number;
  seller_name: string | null;
  sku: string;
  name: string;
  barcode_seller: string | null;
  unit_value: number;
  box_type: string | null;
  is_input: boolean;
  photo_url: string | null;
  active: boolean;
}

export interface StockPosition {
  sku: string;
  product_name: string;
  initial_stock: number;
  total_in: number;
  total_out: number;
  current_stock: number;
  unit_value: number;
  level: string;
  updated_at: string;
}


// ============================================================
// AUTH
// ============================================================

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }),
  me: () => api.get<User>('/auth/me'),
};


// ============================================================
// DASHBOARD
// ============================================================

export const dashboardApi = {
  master: (params?: { target_date?: string; unit_id?: number }) =>
    api.get<DashboardStats>('/dashboard/master', { params }),
  seller: (params?: { date_from?: string; date_to?: string; seller_id?: number }) =>
    api.get('/dashboard/seller', { params }),
  availableDates: (limit = 30) =>
    api.get<string[]>('/dashboard/available-dates', { params: { limit } }),
};


// ============================================================
// PEDIDOS
// ============================================================

export const ordersApi = {
  list: (params?: Record<string, any>) =>
    api.get<Order[]>('/orders/', { params }),
  get: (id: number) =>
    api.get<Order>(`/orders/${id}`),
  import: (
    file: File,
    unit_id: number,
    opts: {
      file_type?: 'Entrada' | 'Saída';
      for_billing?: boolean;
      force_duplicates?: boolean;
      generate_sep_pdf?: boolean;
      generate_exp_pdf?: boolean;
    } = {},
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('unit_id', unit_id.toString());
    form.append('file_type', opts.file_type || 'Saída');
    form.append('for_billing', String(opts.for_billing ?? true));
    form.append('force_duplicates', String(opts.force_duplicates ?? false));
    return api.post<ImportResult>('/orders/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  configure: (id: number, data: { file_type?: string; for_billing?: boolean }) =>
    api.patch(`/orders/${id}/config`, null, { params: data }),
  updateCarrier: (orderId: number, carrier: string) =>
    api.patch(`/orders/${orderId}/carrier`, { carrier }),
  downloadSessionPdf: async (sessionId: number, type: 'separation' | 'expedition'): Promise<void> => {
    const response = await api.get(`/orders/sessions/${sessionId}/pdf/${type}`, {
      responseType: 'blob',
      timeout: 60000,
    });
    const disposition: string = response.headers['content-disposition'] ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `${type}_${sessionId}.pdf`;
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};


// ============================================================
// SCANNING (BIPAGEM)
// ============================================================

export const scanningApi = {
  sessions: (params?: Record<string, any>) =>
    api.get<PickingSession[]>('/scanning/sessions', { params }),
  sessionOrders: (sessionId: number, sellerId?: number) =>
    api.get(`/scanning/sessions/${sessionId}/orders`, { params: sellerId ? { seller_id: sellerId } : {} }),
  scan: (data: ScanRequest) =>
    api.post<ScanResponse>('/scanning/scan', data),
  interrupt: (data: {
    session_id: number;
    order_id: number;
    operator_id: number;
    reason?: string;
  }) => api.post('/scanning/interrupt', data),
  auditLog: (params?: Record<string, any>) =>
    api.get('/scanning/audit-log', { params }),
  /** Log de auditoria do sistema: todas as ações (cadastros, uploads, estoque, etc.). */
  systemAuditLog: (params?: Record<string, any>) =>
    api.get('/scanning/system-audit-log', { params }),
  productivity: (params?: Record<string, any>) =>
    api.get('/scanning/productivity', { params }),
  updateSessionConfig: (
    sessionId: number,
    data: { file_type?: 'Entrada' | 'Saída'; for_billing?: boolean },
  ) => api.patch(`/scanning/sessions/${sessionId}/config`, data),
  openByNfe: (sessionId: number, nfeKey: string) =>
    api.post(`/scanning/sessions/${sessionId}/open-by-nfe`, { nfe_key: nfeKey }),
  scanLogs: (sessionId: number) =>
    api.get(`/scanning/sessions/${sessionId}/scan-logs`),
  sessionCards: (params?: Record<string, any>) =>
    api.get<SessionCard[]>('/scanning/session-cards', { params }),
  /** [Admin] Finaliza sem bipagem todos os pedidos do seller na sessão */
  forceComplete: (sessionId: number, sellerId: number | null) =>
    api.post<{ success: boolean; forced: number; message: string }>(
      `/scanning/sessions/${sessionId}/force-complete`,
      { seller_id: sellerId },
    ),
  /** [Admin] Cancela o manuseio de todos os pedidos do seller na sessão */
  cancelHandling: (sessionId: number, sellerId: number | null) =>
    api.post<{ success: boolean; cancelled: number; message: string }>(
      `/scanning/sessions/${sessionId}/cancel-handling`,
      { seller_id: sellerId },
    ),
  suggestedBox: (orderId: number) =>
    api.get<{ order_id: number; suggested: string | null; box_used: string | null; effective: string | null }>(
      `/scanning/orders/${orderId}/suggested-box`
    ),
  saveOrderBox: (orderId: number, boxUsed: string | null) =>
    api.patch<{ order_id: number; box_used: string | null }>(
      `/scanning/orders/${orderId}/box`,
      { box_used: boxUsed }
    ),
};


// ============================================================
// ESTOQUE
// ============================================================

export const inventoryApi = {
  stock: (sellerId: number) =>
    api.get<StockPosition[]>(`/inventory/stock/${sellerId}`),
  movements: (sellerId: number, dateFrom?: string, dateTo?: string) =>
    api.get(`/inventory/movements/${sellerId}`, { params: { date_from: dateFrom, date_to: dateTo } }),
  manualMovement: (data: Record<string, any>) =>
    api.post('/inventory/movements/manual', data),
  /** Importação em lote — muito mais rápido que manualMovement() em loop */
  bulkMovements: (data: { seller_id: number; rows: Record<string, any>[] }) =>
    api.post<{ imported: number; errors: string[] }>('/inventory/movements/bulk', data),
  skuHistory: (sellerId: number, sku: string, days = 90) =>
    api.get(`/inventory/sku-history/${sellerId}/${encodeURIComponent(sku)}`, { params: { days } }),
  exportStockCsv: (sellerId: number) =>
    downloadAuthenticatedFile(
      `/inventory/stock/${sellerId}/export/csv`,
      `estoque_${sellerId}.csv`,
    ),
  exportMovementsCsv: (sellerId: number, dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const qs = params.toString();
    return downloadAuthenticatedFile(
      `/inventory/movements/${sellerId}/export/csv${qs ? `?${qs}` : ''}`,
      `movimentacoes_${sellerId}.csv`,
    );
  },
  skuLookup: (sellerId: number, sku: string) =>
    api.get<{ found: boolean; sku: string; name?: string; barcode_seller?: string }>('/inventory/sku-lookup', { params: { seller_id: sellerId, sku } }),
  updateMovement: (movementId: number, data: Record<string, any>) =>
    api.put(`/inventory/movements/${movementId}`, data),
  /** Verifica a senha de edição imediatamente no backend (sem abrir o formulário). */
  verifyPassphrase: (passphrase: string) =>
    api.post<{ valid: boolean }>('/inventory/verify-passphrase', { passphrase }),
  analyzeHistory: (sellerId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{
      total_rows: number;
      total_skus: number;
      already_registered: number;
      unknown_skus: { sku: string; suggested_name: string; count: number }[];
    }>(`/inventory/import-history/${sellerId}/analyze`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 2 min — arquivo grande
    });
  },
  executeHistory: (sellerId: number, file: File, productNames: Record<string, string>) => {
    const form = new FormData();
    form.append('file', file);
    form.append('product_names', JSON.stringify(productNames));
    return api.post<{
      imported: number;
      products_created: number;
      skipped: number;
      errors: string[];
    }>(`/inventory/import-history/${sellerId}/execute`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000, // 3 min — pode ter muitas movimentações
    });
  },
  /** Bulk upload de posição de estoque multi-seller (admin) — otimizado para 1M+ linhas */
  bulkStockUpload: (
    formData: FormData,
    onUploadProgress?: (e: { loaded: number; total: number }) => void,
  ) =>
    api.post<{
      ok: boolean;
      total_rows: number;
      valid_rows: number;
      created: number;
      errors: string[];
      duration_sec: number;
    }>('/inventory/bulk-stock-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000, // 5 min para 1M+ linhas
      onUploadProgress,
    }),
};


// ============================================================
// CADASTROS
// ============================================================

export const cadastrosApi = {
  sellers: () => api.get('/cadastros/sellers'),
  createSeller: (data: Record<string, any>) => api.post('/cadastros/sellers', data),
  updateSeller: (id: number, data: Record<string, any>) => api.put(`/cadastros/sellers/${id}`, data),
  deleteSeller: (id: number) => api.delete(`/cadastros/sellers/${id}`),
  units: (includeInactive = false) => api.get('/cadastros/units', { params: { include_inactive: includeInactive } }),
  createUnit: (data: Record<string, any>) => api.post('/cadastros/units', data),
  updateUnit: (id: number, data: Record<string, any>) => api.put(`/cadastros/units/${id}`, data),
  deleteUnit: (id: number) => api.delete(`/cadastros/units/${id}`),
  assignSellersToUnit: (unitId: number, sellerIds: number[]) =>
    api.patch(`/cadastros/units/${unitId}/sellers`, { seller_ids: sellerIds }),
  sellersWithoutUnit: () => api.get('/cadastros/sellers/without-unit'),
  sellerStats: (sellerId: number) =>
    api.get<{ seller_id: number; total_skus: number; skus_with_stock: number; skus_zero_stock: number; total_stock_value: number }>(
      `/cadastros/sellers/${sellerId}/stats`
    ),
  products: (params?: {
    seller_id?: number;
    search?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }) => api.get<{
    items: Product[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
  }>('/cadastros/products', { params }),
  createProduct: (data: {
    seller_id: number; sku: string; name: string;
    barcode_seller?: string; box_type?: string; unit_value?: number; is_input?: boolean;
  }) => api.post('/cadastros/products', data),
  updateProduct: (id: number, data: {
    name?: string; barcode_seller?: string; box_type?: string;
    unit_value?: number; is_input?: boolean; active?: boolean;
  }) => api.put(`/cadastros/products/${id}`, data),
  uploadProductPhoto: (id: number, photo: File) => {
    const fd = new FormData();
    fd.append('file', photo);
    return api.post(`/cadastros/products/${id}/photo`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteProduct: (id: number) => api.delete(`/cadastros/products/${id}`),
  bulkPasteProducts: (items: any[]) => api.post('/cadastros/products/bulk-paste', items),
  bulkUploadProducts: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/cadastros/products/bulk-upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000, // 5 min — planilhas grandes (20k+ linhas)
    });
  },
  kits: (sellerId?: number) => api.get('/cadastros/kits', { params: { seller_id: sellerId } }),
  kitExpansionLog: (sellerId?: number, kitSku?: string) =>
    api.get('/cadastros/kits/expansion-log', { params: { seller_id: sellerId, kit_sku: kitSku } }),
  createKit: (data: Record<string, any>) => api.post('/cadastros/kits', data),
  updateKit: (id: number, data: any) => api.put(`/cadastros/kits/${id}`, data),
  deleteKit: (id: number) => api.delete(`/cadastros/kits/${id}`),
  bulkImportKits: (payload: { items: any[] }) => api.post('/cadastros/kits/bulk-import', payload),
  boxRules: (sellerId: number) => api.get(`/cadastros/box-algorithm/${sellerId}`),
  createBoxRule: (data: Record<string, any>) => api.post('/cadastros/box-algorithm', data),
  deleteBoxRule: (id: number) => api.delete(`/cadastros/box-algorithm/${id}`),
  calculateBox: (sellerId: number, numProducts: number, score: number) =>
    api.get(`/cadastros/box-algorithm/${sellerId}/calculate`, {
      params: { num_products: numProducts, score },
    }),
  users: (params?: Record<string, any>) => api.get('/cadastros/users', { params }),
  createUser: (data: Record<string, any>) => api.post('/cadastros/users', data),
  updateUser: (id: number, data: Record<string, any>) => api.put(`/cadastros/users/${id}`, data),
  deleteUser:     (id: number) => api.delete(`/cadastros/users/${id}`),
  reactivateUser: (id: number) => api.post(`/cadastros/users/${id}/reactivate`),
};

// ============================================================
// FATURAMENTO
// ============================================================

export const billingApi = {
  config: (sellerId: number) =>
    api.get(`/billing/config/${sellerId}`),
  saveConfig: (data: Record<string, any>) =>
    api.post('/billing/config', data),
  report: (sellerId: number, month: string) =>
    api.get(`/billing/report/${sellerId}`, { params: { month } }),
  exportReport: (sellerId: number, month: string) =>
    window.open(
      `${API_BASE}/billing/report/${sellerId}/export?month=${month}`,
      '_blank'
    ),
};


// ============================================================
// CONFIGURAÇÕES GERAIS
// ============================================================

export const settingsApi = {
  getAll: () =>
    api.get<Record<string, { value: string; description: string; updated_at: string | null }>>('/settings'),
  update: (data: Record<string, string>) =>
    api.put('/settings', data),
  watcherStatus: () =>
    api.get<{
      running: boolean;
      last_run: string | null;
      next_run: string | null;
      last_check: string | null;
      interval_sec: number;
      files_processed: number;
      error: string | null;
      last_files: Array<{ name: string; dest: string; reason: string; details: string }>;
    }>('/settings/watcher/status'),
  startWatcher: () =>
    api.post('/settings/watcher/start'),
  stopWatcher: () =>
    api.post('/settings/watcher/stop'),
};


// ============================================================
// IMPORTAÇÃO / SESSIONS
// ============================================================

export const importApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ session_id: number; message: string }>('/orders/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  sessions: (params?: { skip?: number; limit?: number; seller_id?: number }) =>
    api.get<{ items: any[]; total: number }>('/orders/sessions', { params }),
  sessionDetail: (sessionId: number) =>
    api.get<any>(`/orders/sessions/${sessionId}`),
  deleteSession: (sessionId: number) =>
    api.delete(`/orders/sessions/${sessionId}`),
};


// ============================================================
// RELATÓRIO DE ESTOQUE
// ============================================================

export const stockApi = {
  report: (params?: { seller_id?: number; search?: string; low_stock?: boolean }) =>
    api.get<any[]>('/stock/report', { params }),
  exportReport: (sellerId?: number) => {
    const params = sellerId ? `?seller_id=${sellerId}` : '';
    window.open(`${API_BASE}/stock/report/export${params}`, '_blank');
  },
  history: (skuId: number) =>
    api.get<any[]>(`/stock/history/${skuId}`),
};


// ============================================================
// PORTAL DO SELLER
// ============================================================

export const portalApi = {
  orders: (params?: { date?: string; status?: string; search?: string }) =>
    api.get<any[]>('/portal/orders', { params }),
  stockReport: (params?: { search?: string }) =>
    api.get<any[]>('/portal/stock', { params }),
  movements: (params?: { date_from?: string; date_to?: string; search?: string }) =>
    api.get<any[]>('/portal/movements', { params }),
};
