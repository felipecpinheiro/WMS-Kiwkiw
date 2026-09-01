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
  pending_carrier_sessions?: { session_id: number; count: number }[];
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
  session_id?: number | null;
  // null = a NF ainda não baixou estoque (falta transportadora ou produto
  // cadastrado). O estoque baixa na importação desde 06/08/2026.
  stock_applied_at?: string | null;
  items: OrderItem[];
}

export interface OrderItem {
  id: number;
  sku: string;
  product_name: string;
  quantity: number;
  is_kit_component: boolean;
  original_kit_sku: string | null;
  scanned_qty: number;
}

/** Uma linha da conferência final de entrada: o que a NF diz x o que foi contado. */
export interface EntryConferenceLine {
  sku: string;
  product_name: string;
  expected: number;
  counted: number;
  /** contado - esperado. Negativo = faltou, positivo = veio a mais. */
  diff: number;
  status: 'ok' | 'over' | 'short' | 'missing';
}

/** Resposta de POST /scanning/orders/{id}/finalize-entry (preview e confirmação). */
export interface EntryConference {
  success: boolean;
  confirmed: boolean;
  order_id: number;
  nf_number: string;
  lines: EntryConferenceLine[];
  divergent_count: number;
  total_expected: number;
  total_counted: number;
  /** Só na confirmação: */
  message?: string;
  stock_applied?: boolean;
  stock_skipped_reason?: string | null;
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
  file_type?: string;
  pending_carrier_orders?: number;
  // NFs fora do manuseio por falta de produto cadastrado — impossíveis de
  // bipar (sem produto não há barcode). Não entram em total_orders.
  held_orders?: number;
  held_only?: boolean;
  /**
   * Conferências de ENTRADA pausadas neste card. Já contadas em
   * pending_orders — a NF pausada continua EM ABERTO; isto é só o badge.
   */
  paused_orders?: number;
}

export interface DuplicateOrderInfo {
  nf_number: string;
  seller_name: string;
  existing_order_id: number | null;
  existing_session_id: number | null;
  existing_imported_at: string | null;
}

export interface InactiveSellerInfo {
  seller_id: number;
  seller_name: string;
  nf_numbers: string[];
}

export interface UnmatchedSellerInfo {
  seller_name: string;
  nf_numbers: string[];
}

export interface MissingSkuLineInfo {
  nf_number: string;
  seller_name: string;
  customer_name: string | null;
  product_name: string | null;
}

export interface MissingCarrierOrderInfo {
  order_id: number;
  session_id: number;
  nf_number: string;
  seller_name: string;
  customer_name: string | null;
}

export type SellerLinkDecision =
  | { action: 'create'; unit_id: number }
  | { action: 'link'; seller_id: number };

// ── Baixa de estoque na importação (06/08/2026) ───────────────────────────
// O estoque deixou de ser sensibilizado na bipagem: baixa no fim do import,
// NF a NF. NF sem transportadora ou com SKU sem produto cadastrado fica
// pendente e baixa sozinha quando a pendência é resolvida.

export interface NegativeStockInfo {
  seller_id: number;
  seller_name: string | null;
  sku: string;
  product_name: string | null;
  current_stock: number;        // posição DEPOIS da baixa
  applied_qty: number;          // delta assinado desta importação
  was_negative_before: boolean;
}

export interface PendingStockOrderInfo {
  order_id: number;
  nf_number: string;
  seller_id: number;
  seller_name: string | null;
  customer_name: string | null;
  missing_carrier: boolean;
  missing_skus: string[];
  // true = nada bloqueia mais essa NF, mas ela nunca foi reaplicada — ver
  // POST /orders/pending-stock/retry (19/08/2026).
  can_apply: boolean;
}

export interface MissingProductInfo {
  seller_id: number;
  seller_name: string | null;
  sku: string;
  product_name: string | null;
  nf_numbers: string[];
}

export interface StockApplyReport {
  applied_orders: number;
  pending_orders: PendingStockOrderInfo[];
  missing_products: MissingProductInfo[];
  negatives: NegativeStockInfo[];
}

// Resolução em lote das pendências que seguram a baixa (10/08/2026).
// Subir arquivo é o core da operação — resolver NF a NF trava o dia inteiro.

export interface BatchCarrierResult {
  updated: number;
  stock_applied: number;
  still_pending: number;
  negatives: NegativeStockInfo[];
}

export interface SkuResolutionItem {
  seller_id: number;
  sku: string;
  action: 'create' | 'link';
  name?: string;
  barcode_seller?: string;
  target_product_id?: number;
}

export interface BatchSkuResult {
  created: number;
  linked: number;
  reactivated: number;
  orders_relinked: number;
  stock_applied: number;
  negatives: NegativeStockInfo[];
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
  inactive_sellers: InactiveSellerInfo[];
  unmatched_sellers: UnmatchedSellerInfo[];
  missing_carrier_orders: MissingCarrierOrderInfo[];
  missing_sku_lines: MissingSkuLineInfo[];
  stock: StockApplyReport | null;
}

export interface ImportProgressInfo {
  found: boolean;
  processed: number;
  total: number;
  done: boolean;
  success: boolean | null;
}

export interface ScanRequest {
  session_id: number;
  order_id: number;
  barcode: string;
  operator_id: number;
  /** Unidades bipadas de uma vez. O backend só aceita > 1 em NF de entrada. */
  quantity?: number;
}

export interface ScanResponse {
  success: boolean;
  message: string;
  /** "ok" | "error" | "order_complete" | "session_complete" | "awaiting_box" (saída 100% bipada, falta caixa) | ... */
  status: string;
  sku: string | null;
  product_name: string | null;
  photo_url: string | null;
  items_remaining: number;
  order_progress: any | null;
  /** Quanto ESTE bipe passou do previsto na NF (só ocorre em entrada). 0 = normal. */
  over_quantity?: number;
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
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
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
      inactive_seller_decisions?: Record<number, 'reactivate' | 'ignore'>;
      seller_link_decisions?: Record<string, SellerLinkDecision>;
      upload_id?: string;
    } = {},
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('unit_id', unit_id.toString());
    form.append('file_type', opts.file_type || 'Saída');
    form.append('for_billing', String(opts.for_billing ?? true));
    form.append('force_duplicates', String(opts.force_duplicates ?? false));
    if (opts.inactive_seller_decisions && Object.keys(opts.inactive_seller_decisions).length > 0) {
      form.append('inactive_seller_decisions', JSON.stringify(opts.inactive_seller_decisions));
    }
    if (opts.seller_link_decisions && Object.keys(opts.seller_link_decisions).length > 0) {
      form.append('seller_link_decisions', JSON.stringify(opts.seller_link_decisions));
    }
    if (opts.upload_id) {
      form.append('upload_id', opts.upload_id);
    }
    // Timeout maior que o default (30s): arquivo grande pode levar minutos.
    // Sem isso o navegador desiste antes do backend terminar de processar
    // (que continua rodando e comita normalmente, só a tela mostra erro à toa).
    return api.post<ImportResult>('/orders/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    });
  },
  // Progresso do import em andamento — polling leve, sem tocar no banco
  // (ver backend/services/import_progress.py). Timeout curto de propósito:
  // se essa chamada falhar/atrasar, o frontend ignora e tenta de novo no
  // próximo tick, nunca deixa isso virar um erro pro usuário.
  importProgress: (uploadId: string) =>
    api.get<ImportProgressInfo>('/orders/import/progress', {
      params: { upload_id: uploadId },
      timeout: 8000,
    }),
  configure: (id: number, data: { file_type?: string; for_billing?: boolean }) =>
    api.patch(`/orders/${id}/config`, null, { params: data }),
  // Preencher a transportadora destrava a baixa de estoque da NF (06/08/2026)
  // — a resposta traz stock_applied e os SKUs que ficaram negativos.
  updateCarrier: (orderId: number, carrier: string) =>
    api.patch<{
      message: string;
      carrier: string | null;
      stock_applied: boolean;
      negatives: NegativeStockInfo[];
      pending: PendingStockOrderInfo | null;
    }>(`/orders/${orderId}/carrier`, { carrier }),
  // Preenche transportadora de várias NFs numa chamada só. O backend baixa o
  // estoque do lote inteiro de uma vez — não chamar updateCarrier em laço.
  batchCarrier: (updates: { order_id: number; carrier: string }[]) =>
    api.patch<BatchCarrierResult>('/orders/batch-carrier', { updates }, { timeout: 120000 }),
  // Resolve em lote os SKUs sem produto: cria o produto ou aponta o SKU da NF
  // para um produto que já existe (só nas NFs que ainda não baixaram).
  batchResolveSku: (resolutions: SkuResolutionItem[]) =>
    api.post<BatchSkuResult>('/orders/batch-resolve-sku', { resolutions }, { timeout: 120000 }),
  // NFs que ainda não baixaram estoque e o motivo — aviso fixo do Dashboard.
  pendingStock: (sessionId?: number) =>
    api.get<StockApplyReport>('/orders/pending-stock', {
      params: sessionId ? { session_id: sessionId } : undefined,
    }),
  // Reaplica NFs que já não têm mais nenhum motivo bloqueando (can_apply=true)
  // mas nunca foram reaplicadas — botão "Tentar novamente" do Dashboard
  // (19/08/2026). orderIds omitido reavalia todo o recorte pendente atual.
  retryPendingStock: (orderIds?: number[]) =>
    api.post<StockApplyReport>('/orders/pending-stock/retry', {
      order_ids: orderIds && orderIds.length ? orderIds : undefined,
    }, { timeout: 120000 }),
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
  sessionOrders: (sessionId: number, sellerId?: number, includeInactive?: boolean) =>
    api.get(`/scanning/sessions/${sessionId}/orders`, {
      params: {
        ...(sellerId ? { seller_id: sellerId } : {}),
        ...(includeInactive ? { include_inactive: true } : {}),
      },
    }),
  scan: (data: ScanRequest) =>
    api.post<ScanResponse>('/scanning/scan', data),
  interrupt: (data: {
    session_id: number;
    order_id: number;
    operator_id: number;
    reason?: string;
  }) => api.post('/scanning/interrupt', data),
  /**
   * Conferência final de uma NF de ENTRADA (24/08/2026).
   * Sem `confirm` devolve o comparativo esperado x contado sem gravar nada;
   * com `confirm: true` lança o estoque pela contagem e conclui a NF.
   */
  finalizeEntry: (orderId: number, confirm = false) =>
    api.post<EntryConference>(`/scanning/orders/${orderId}/finalize-entry`, { confirm }),
  /** Pausa a conferência de entrada — a NF continua EM ABERTO para retomar depois. */
  pauseEntry: (orderId: number, reason?: string) =>
    api.post(`/scanning/orders/${orderId}/pause`, { reason }),
  /**
   * Trilha de bipagem, paginada. Todos os filtros são aplicados no SERVIDOR e se
   * combinam (AND) — inclusive a busca: com paginação, filtrar no navegador
   * acharia só dentro da página aberta e diria "nenhum resultado" para uma NF
   * que está na página seguinte.
   *
   * ⚠️ Devolve um OBJETO, não uma lista (mudou em 31/08/2026). Os totais vêm do
   * servidor porque, paginado, contar na tela devolveria o tamanho da página.
   */
  auditLog: (params?: Record<string, any>) =>
    api.get<{
      rows: Record<string, any>[];
      total: number;
      total_ok: number;
      total_errors: number;
      page: number;
      page_size: number;
      total_pages: number;
    }>('/scanning/audit-log', { params }),
  /** Transportadoras presentes nas bipagens do período (agrupadas por maiúscula/minúscula). */
  auditLogCarriers: (params?: Record<string, any>) =>
    api.get<{ value: string; label: string; total: number; variants: string[] }[]>(
      '/scanning/audit-log/carriers', { params },
    ),
  /** Mesmas linhas da trilha de bipagem, em CSV e SEM teto — é o caminho para ver
   *  um mês inteiro sem travar o navegador. Download autenticado (window.open daria 401). */
  exportAuditLogCsv: (params: Record<string, any>) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return downloadAuthenticatedFile(
      `/scanning/audit-log/export/csv?${qs}`,
      `bipagens_${params.date_from ?? ''}_a_${params.date_to ?? ''}.csv`,
    );
  },
  /** Log de auditoria do sistema: todas as ações (cadastros, uploads, estoque, etc.). */
  systemAuditLog: (params?: Record<string, any>) =>
    api.get('/scanning/system-audit-log', { params }),
  productivity: (params?: Record<string, any>) =>
    api.get('/scanning/productivity', { params }),
  interruptedOrders: (params?: Record<string, any>) =>
    api.get('/scanning/interrupted-orders', { params }),
  /** Status NF a NF de um seller (por data de upload). Seller e datas obrigatórios. */
  nfStatus: (params: { seller_id: number | string; date_from: string; date_to: string }) =>
    api.get<{
      rows: Record<string, any>[];
      total: number;
      limit: number;
      truncated: boolean;
    }>('/scanning/nf-status', { params }),
  /** Mesmas linhas de nfStatus(), em CSV. Usa download autenticado (window.open daria 401). */
  exportNfStatusCsv: (params: { seller_id: number | string; date_from: string; date_to: string }) => {
    const qs = new URLSearchParams({
      seller_id: String(params.seller_id),
      date_from: params.date_from,
      date_to: params.date_to,
    }).toString();
    return downloadAuthenticatedFile(
      `/scanning/nf-status/export/csv?${qs}`,
      `status_nfs_${params.date_from}_a_${params.date_to}.csv`,
    );
  },
  updateSessionConfig: (
    sessionId: number,
    data: { file_type?: 'Entrada' | 'Saída'; for_billing?: boolean },
  ) => api.patch(`/scanning/sessions/${sessionId}/config`, data),
  openByNfe: (sessionId: number, nfeKey: string, forceSellerLock?: boolean) =>
    api.post(`/scanning/sessions/${sessionId}/open-by-nfe`, { nfe_key: nfeKey, force_seller_lock: !!forceSellerLock }),
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
  /** [Admin/Manager] Cancela pedidos duplicados de um ou mais sellers numa sessão.
   *  confirm=false devolve um preview sem alterar nada; confirm=true executa. */
  cancelDuplicateOrders: (sessionId: number, sellerIds: number[], confirm: boolean) =>
    api.post<{
      requires_confirmation: boolean;
      preview?: { order_id: number; nf_number: string; seller_id: number; seller_name: string | null; status: string; bucket: 'pending' | 'partial_scan' | 'stock_reversal' }[];
      cancelled?: number;
      stock_reversed?: number;
      summary?: string[];
      message: string;
    }>(
      `/scanning/sessions/${sessionId}/cancel-duplicate-orders`,
      { seller_ids: sellerIds, confirm },
    ),
  /** [Admin] Inativa uma NF individual. Motivo obrigatório — vai para o log de auditoria. */
  deactivateOrder: (orderId: number, reason: string) =>
    api.post<{ success: boolean; message: string; stock_reversed: boolean }>(
      `/scanning/orders/${orderId}/deactivate`,
      { reason },
    ),
  /** [Admin] Reativa uma NF inativada — sempre volta como pendente. */
  reactivateOrder: (orderId: number) =>
    api.post<{ success: boolean; message: string }>(
      `/scanning/orders/${orderId}/reactivate`,
      {},
    ),
  suggestedBox: (orderId: number) =>
    api.get<{ order_id: number; suggested: string | null; box_used: string | null; effective: string | null }>(
      `/scanning/orders/${orderId}/suggested-box`
    ),
  saveOrderBox: (orderId: number, boxUsed: string | null) =>
    api.patch<{ order_id: number; box_used: string | null; order_completed: boolean }>(
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
  exportStockXlsx: (sellerId: number) =>
    downloadAuthenticatedFile(
      `/inventory/stock/${sellerId}/export/xlsx`,
      `estoque_${sellerId}.xlsx`,
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
  /** force=true ignora a trava de SKU não cadastrado ("Cadastrar mesmo assim"). */
  executeHistory: (sellerId: number, file: File, productNames: Record<string, string>, force = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('product_names', JSON.stringify(productNames));
    form.append('force', String(force));
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
  // Padrão = só ativos. Seller inativo só aparece na tela de cadastro (/sellers)
  // e no Faturamento, que passam activeOnly=false explicitamente. Ver CLAUDE.md.
  sellers: (activeOnly = true) => api.get('/cadastros/sellers', { params: { active_only: activeOnly } }),
  createSeller: (data: Record<string, any>) => api.post('/cadastros/sellers', data),
  updateSeller: (id: number, data: Record<string, any>) => api.put(`/cadastros/sellers/${id}`, data),
  /**
   * Inativa um seller. Sem `confirm`, o backend só devolve um aviso
   * (`requires_confirmation` + `open_orders`) quando o seller ainda tem pedido
   * em aberto — nada é alterado. Reenviar com `confirm=true` para inativar.
   */
  deleteSeller: (id: number, confirm = false) =>
    api.delete<{
      message?: string;
      requires_confirmation?: boolean;
      seller_name?: string;
      open_orders?: number;
    }>(`/cadastros/sellers/${id}`, { params: { confirm } }),
  units: (includeInactive = false) => api.get('/cadastros/units', { params: { include_inactive: includeInactive } }),
  createUnit: (data: Record<string, any>) => api.post('/cadastros/units', data),
  updateUnit: (id: number, data: Record<string, any>) => api.put(`/cadastros/units/${id}`, data),
  deleteUnit: (id: number) => api.delete(`/cadastros/units/${id}`),
  assignSellersToUnit: (unitId: number, sellerIds: number[]) =>
    api.patch(`/cadastros/units/${unitId}/sellers`, { seller_ids: sellerIds }),
  sellersWithoutUnit: () =>
    api.get<{ id: number; trade_name: string; order_count: number }[]>('/cadastros/sellers/without-unit'),
  mergeSellerOrders: (fromSellerId: number, toSellerId: number) =>
    api.post<{ migrated_orders: number; from_seller_id: number; to_seller_id: number }>(
      `/cadastros/sellers/${fromSellerId}/merge-orders-into/${toSellerId}`,
    ),
  assignSellerUnit: (sellerId: number, unitId: number) =>
    api.post<{ seller_id: number; unit_id: number }>(
      `/cadastros/sellers/${sellerId}/assign-unit`,
      { unit_id: unitId },
    ),
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
  reactivateProduct: (id: number) => api.post(`/cadastros/products/${id}/reactivate`),
  bulkPasteProducts: (items: any[]) => api.post('/cadastros/products/bulk-paste', items),
  bulkUploadProducts: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/cadastros/products/bulk-upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000, // 5 min — planilhas grandes (20k+ linhas)
    });
  },
  downloadBulkUploadTemplate: () =>
    downloadAuthenticatedFile('/cadastros/products/bulk-upload/template', 'modelo_upload_produtos.xlsx'),
  kits: (sellerId?: number) => api.get('/cadastros/kits', { params: { seller_id: sellerId } }),
  kitExpansionLog: (sellerId?: number, kitSku?: string) =>
    api.get('/cadastros/kits/expansion-log', { params: { seller_id: sellerId, kit_sku: kitSku } }),
  createKit: (data: Record<string, any>) => api.post('/cadastros/kits', data),
  updateKit: (id: number, data: any) => api.put(`/cadastros/kits/${id}`, data),
  deleteKit: (id: number) => api.delete(`/cadastros/kits/${id}`),
  bulkImportKits: (payload: { items: any[] }) => api.post('/cadastros/kits/bulk-import', payload),
  // Componentes de kit sem vínculo com o cadastro de produtos (tela /kits/vincular)
  kitUnlinkedComponents: (sellerId?: number) =>
    api.get('/cadastros/kits/unlinked-components', { params: { seller_id: sellerId } }),
  linkKitComponent: (itemId: number, productId: number) =>
    api.post(`/cadastros/kits/items/${itemId}/link`, { product_id: productId }),
  // Import da planilha de kits (aba CADASTRO KITS) — 2 passos, igual ao histórico de estoque
  analyzeKitFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/cadastros/kits/import-file/analyze', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000,
    });
  },
  // sellerDecisions: seller_id para vincular, 'skip' para não importar o cliente,
  // ou 'reactivate' para religar um seller desativado e importar nele
  executeKitFile: (
    file: File,
    sellerDecisions?: Record<string, number | 'skip' | 'reactivate'>,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (sellerDecisions) fd.append('seller_decisions', JSON.stringify(sellerDecisions));
    return api.post('/cadastros/kits/import-file/execute', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000,
    });
  },
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
  setTempPassword: (id: number) =>
    api.put(`/cadastros/users/${id}`, { password: '123456', force_password_change: true }),
  uploadExperienceFile: (sellerId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/cadastros/sellers/${sellerId}/experience-file`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ============================================================
// FATURAMENTO
// ============================================================

export interface BillingSellerParams {
  seller_id?: number;
  preco_unitario: number;
  min_pedidos: number;
  manuseio_b2b: number;
  valor_caixa_b2b: number;
  adic_produto_b2b: number;
  limite_itens_b2b: number;
  tipos_caixa_inclusos: string;
  cota_caixas_mes: number;
  franquia_m3: number;
  preco_m3: number;
  seguro_incluso: boolean;
  aliquota_seguro: number;
  armazenagem_inclusa: boolean;
}

export const EMPTY_BILLING_PARAMS: BillingSellerParams = {
  preco_unitario: 0, min_pedidos: 0, manuseio_b2b: 0, valor_caixa_b2b: 0,
  adic_produto_b2b: 0,
  limite_itens_b2b: 0, tipos_caixa_inclusos: '', cota_caixas_mes: 0,
  franquia_m3: 0, preco_m3: 0, seguro_incluso: false, aliquota_seguro: 0.30,
  armazenagem_inclusa: false,
};

export interface BillingBoxPrice { box_key: string; price: number | null }

// Lista canônica de caixas — repetida no Scanner, faturamento e cadastro do seller.
export const CANONICAL_BOXES = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
  'Saco de Embarque', 'Própria',
] as const;

export interface BillingSellerBoxPrices {
  prices: BillingBoxPrice[];      // uma entrada por caixa canônica; price null = usa o global
  grupo_a: string[];              // caixas inclusas (grupo A)
}

export const billingApi = {
  // parâmetros default do seller (aba Comercial + topo do Faturamento)
  sellerParams: (sellerId: number) =>
    api.get<BillingSellerParams>(`/billing/seller-params/${sellerId}`),
  saveSellerParams: (sellerId: number, body: BillingSellerParams) =>
    api.put(`/billing/seller-params/${sellerId}`, body),

  // tabela global de adicional por caixa
  boxPrices: () => api.get<{ prices: BillingBoxPrice[] }>('/billing/box-prices'),
  saveBoxPrices: (prices: BillingBoxPrice[]) =>
    api.put('/billing/box-prices', { prices }),

  // preço de caixa + grupo A por seller (aba "Caixas" do cadastro de seller)
  sellerBoxPrices: (sellerId: number) =>
    api.get<BillingSellerBoxPrices>(`/billing/seller-box-prices/${sellerId}`),
  saveSellerBoxPrices: (sellerId: number, body: BillingSellerBoxPrices) =>
    api.put(`/billing/seller-box-prices/${sellerId}`, body),

  // fechamento mensal
  closing: (sellerId: number, refMonth: string) =>
    api.get(`/billing/closing/${sellerId}/${refMonth}`),
  saveClosing: (sellerId: number, refMonth: string, body: any) =>
    api.put(`/billing/closing/${sellerId}/${refMonth}`, body),
  applyForward: (sellerId: number, refMonth: string) =>
    api.post(`/billing/closing/${sellerId}/${refMonth}/apply-forward`),
  closeMonth: (sellerId: number, refMonth: string) =>
    api.post(`/billing/closing/${sellerId}/${refMonth}/close`),
  reopenMonth: (sellerId: number, refMonth: string) =>
    api.post(`/billing/closing/${sellerId}/${refMonth}/reopen`),
  downloadClosingPdf: (sellerId: number, refMonth: string) =>
    downloadAuthenticatedFile(`/billing/closing/${sellerId}/${refMonth}/pdf`,
      `fatura_${refMonth}.pdf`),
  downloadClosingExcel: (sellerId: number, refMonth: string) =>
    downloadAuthenticatedFile(`/billing/closing/${sellerId}/${refMonth}/excel`,
      `fatura_${refMonth}.xlsx`),

  // consolidado do mês
  consolidated: (refMonth: string) =>
    api.get(`/billing/consolidated/${refMonth}`),
  downloadConsolidatedExcel: (refMonth: string) =>
    downloadAuthenticatedFile(`/billing/consolidated/${refMonth}/excel`,
      `consolidado_${refMonth}.xlsx`),
  downloadConsolidatedZip: (refMonth: string) =>
    downloadAuthenticatedFile(`/billing/consolidated/${refMonth}/pdfs.zip`,
      `faturas_${refMonth}.zip`),
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
