/**
 * WMS Kiwkiw - Dashboard Master
 * Cockpit gerencial com visão geral do dia: pedidos, unidades, sellers, checagens e auditoria.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Package, CheckCircle, Clock, ScanLine, AlertTriangle,
  ChevronRight, RefreshCw, Upload, CheckSquare, XSquare, FileText, X,
} from 'lucide-react';
import { dashboardApi, ordersApi, DuplicateOrderInfo } from '../api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';

// ─── Componentes auxiliares ─────────────────────────────────

function StatCard({
  icon: Icon, label, value, color, sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-white/8 shadow-none">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-white/50 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-white/35 mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg bg-white/4`}>
          <Icon size={20} className={color} />
        </div>
      </div>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg border ${ok ? 'bg-emerald-900/30 border-emerald-500/20' : 'bg-red-900/25 border-red-500/20'}`}>
      {ok ? (
        <CheckSquare size={16} className="text-violet-400 flex-shrink-0" />
      ) : (
        <XSquare size={16} className="text-red-500 flex-shrink-0" />
      )}
      <span className={`text-xs font-medium ${ok ? 'text-violet-300' : 'text-red-600'}`}>{label}</span>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────

// ─── CarrierModal ────────────────────────────────────────────

function CarrierModal({ orders, onClose, onSave }: { orders: any[]; onClose: () => void; onSave: (updates: Record<number, string>) => void }) {
  const [carriers, setCarriers] = useState<Record<number, string>>({});
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white text-sm">Informar Transportadoras</h3>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {orders.map((o: any) => (
            <div key={o.order_id} className="flex items-center gap-2">
              <span className="text-xs font-mono text-white/60 w-28 flex-shrink-0">{o.nf_number}</span>
              <span className="text-xs text-white/40 flex-shrink-0 w-20 truncate">{o.seller_name}</span>
              <input
                value={carriers[o.order_id] ?? ''}
                onChange={e => setCarriers(prev => ({ ...prev, [o.order_id]: e.target.value }))}
                placeholder="Ex: JADLOG"
                className="flex-1 border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500 text-white/80"
                style={{ background: '#14122A' }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition">Cancelar</button>
          <button onClick={() => onSave(carriers)} className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition">Salvar Transportadoras</button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Data alvo do cockpit — default hoje, mas usuário pode escolher dias anteriores
  const [targetDate, setTargetDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [uploading, setUploading] = useState(false);
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const isToday = targetDate === todayStr;

  // Modal de upload com opções de nível de arquivo (entrada/saída, faturamento)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileType, setFileType] = useState<'Entrada' | 'Saída'>('Saída');
  const [forBilling, setForBilling] = useState<boolean>(true);
  const [generateSepPdf, setGenerateSepPdf] = useState<boolean>(true);
  const [generateExpPdf, setGenerateExpPdf] = useState<boolean>(true);

  // Modal de confirmação quando há NFs já importadas (duplicatas)
  const [duplicates, setDuplicates] = useState<DuplicateOrderInfo[]>([]);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [carrierModalOrders, setCarrierModalOrders] = useState<any[]>([]);

  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { unit_id: null };

  const { data, isLoading, refetch } = useQuery(
    ['dashboard', targetDate],
    () => dashboardApi.master({ target_date: targetDate, unit_id: user.unit_id || undefined }).then(r => r.data),
    { refetchInterval: 60000 }, // atualiza a cada 1 minuto
  );

  // Passo 1: usuário seleciona arquivo — abrimos modal de confirmação
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (!user.unit_id) {
      toast.error('Usuário sem unidade configurada');
      e.target.value = '';
      return;
    }
    // Para múltiplos arquivos: abre o modal para o primeiro;
    // os demais ficam na fila e são processados automaticamente após cada confirmação.
    setPendingFiles(files);
    setPendingFile(files[0]);
    setUploadModalOpen(true);
    setFileType('Saída');
    setForBilling(true);
    e.target.value = '';
  };

  // Chamada base — dispara o POST e trata a resposta (sucesso, duplicata, erro)
  const runImport = async (forceDuplicates: boolean) => {
    if (!pendingFile || !user.unit_id) return;
    setUploading(true);
    try {
      const res = await ordersApi.import(pendingFile, user.unit_id, {
        file_type: fileType,
        for_billing: forBilling,
        force_duplicates: forceDuplicates,
        generate_sep_pdf: generateSepPdf,
        generate_exp_pdf: generateExpPdf,
      });
      const data = res.data || ({} as any);
      const {
        success,
        message,
        session_id,
        orders_imported = 0,
        orders_with_kits = 0,
        warnings = [],
        errors = [],
        requires_confirmation = false,
        duplicates: dups = [],
      } = data;

      // Backend detectou NFs já importadas → exibe modal de confirmação.
      if (requires_confirmation && !forceDuplicates) {
        setDuplicates(dups);
        setUploadModalOpen(false);
        setDuplicateModalOpen(true);
        return;
      }

      if (!success) {
        const detail = errors?.[0] || message || 'Erro ao importar arquivo';
        toast.error(detail);
        return;
      }

      toast.success(`${orders_imported} pedido(s) importado(s) — Sessão #${session_id}`);
      if (orders_with_kits > 0) {
        toast.success(`${orders_with_kits} pedido(s) com kits expandidos automaticamente`);
      }
      warnings.slice(0, 3).forEach((w: string) => toast(w, { icon: 'ℹ️' }));
      refetch();
      // Fecha tudo e limpa estado
      setUploadModalOpen(false);
      setDuplicateModalOpen(false);
      setDuplicates([]);
      setPendingFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || err.message || 'Erro ao importar arquivo');
    } finally {
      setUploading(false);
    }
  };

  // Passo 2: usuário confirma opções e submete
  const handleConfirmUpload = () => runImport(false);

  // Passo 3 (opcional): após ver duplicatas, usuário confirma reimportação
  const handleForceImport = () => runImport(true);

  const handleCancelUpload = () => {
    if (uploading) return;
    setUploadModalOpen(false);
    setPendingFile(null);
  };

  const handleCancelDuplicates = () => {
    if (uploading) return;
    setDuplicateModalOpen(false);
    setDuplicates([]);
    setPendingFile(null);
  };

  const handleCarrierSave = async (updates: Record<number, string>) => {
    const token = localStorage.getItem('wms_token');
    const base = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
    const entries = Object.entries(updates).filter(([, v]) => v.trim());
    await Promise.all(entries.map(([id, carrier]) =>
      fetch(`${base}/orders/${id}/carrier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ carrier }),
      }).catch(() => {})
    ));
    setCarrierModalOrders([]);
    qc.invalidateQueries('dashboard-stats');
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/35 text-sm">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  const stats = data;
  const completionPct = stats?.completion_rate ?? 0;

  return (
    <div className="p-6 space-y-6 min-h-full text-white">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard Master</h1>
          <p className="text-sm text-white/50 mt-0.5">
            {format(new Date(targetDate + 'T12:00:00'), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            {isToday ? ' · Atualiza a cada 60s' : ' · Visualizando histórico'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor de data */}
          <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-900 border border-white/12 rounded-lg">
            <input
              type="date"
              value={targetDate}
              max={todayStr}
              onChange={(e) => setTargetDate(e.target.value || todayStr)}
              className="text-sm text-white/80 bg-transparent focus:outline-none"
              title="Selecione a data (pelo dia do upload)"
            />
            {!isToday && (
              <button
                onClick={() => setTargetDate(todayStr)}
                className="text-xs px-2 py-0.5 text-violet-400 hover:bg-violet-900/25 rounded"
                title="Voltar para hoje"
              >
                Hoje
              </button>
            )}
          </div>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white/60 hover:text-white bg-gray-900 border border-white/12 rounded-lg transition"
          >
            <RefreshCw size={14} />
            Atualizar
          </button>

          {/* Upload de Excel — só permitido no dia de hoje */}
          <label className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg cursor-pointer transition ${uploading || !isToday ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <Upload size={14} />
            {uploading ? 'Importando...' : 'Importar Excel'}
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              multiple
              className="hidden"
              onChange={handleFilePick}
              disabled={uploading || !isToday}
            />
          </label>
        </div>
      </div>

      {/* ── Conteúdo principal: vazio se não houver dados ── */}
      {(!stats || stats.total_orders_today === 0) ? (
        <div className="bg-gray-900 rounded-xl border border-dashed border-white/12 p-12 text-center">
          <Package size={44} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/50 text-sm font-medium">
            Nenhum pedido importado {isToday ? 'hoje' : 'nessa data'}
          </p>
          {isToday && (
            <p className="text-white/25 text-xs mt-1">
              Use o botão "Importar Excel" para começar
            </p>
          )}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Package}
              label="Total de Pedidos"
              value={stats.total_orders_today}
              color="text-white/80"
            />
            <StatCard
              icon={CheckCircle}
              label="Concluídos"
              value={stats.orders_completed}
              color="text-violet-400"
              sub={`${completionPct}% do total`}
            />
            <StatCard
              icon={Clock}
              label="Pendentes"
              value={stats.orders_pending}
              color="text-amber-500"
            />
            <StatCard
              icon={ScanLine}
              label="Em Bipagem"
              value={stats.orders_scanning}
              color="text-blue-600"
            />
          </div>

          {/* Barra de progresso geral */}
          <div className="bg-gray-900 rounded-xl p-4 border border-white/8 shadow-none">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-white/50">Progresso geral do dia</p>
              <p className="text-sm font-bold text-white/80">{completionPct}%</p>
            </div>
            <div className="w-full bg-white/10 rounded-full h-3">
              <div
                className="bg-violet-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            {stats.active_sessions > 0 && (
              <p className="text-xs text-white/35 mt-1.5">
                {stats.active_sessions} sessão(ões) ativa(s) em andamento
              </p>
            )}
          </div>

          {/* Checagens do dia */}
          {stats.checks && (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3">Checagens do Dia</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                <CheckItem label="Transportadora" ok={!!stats.checks.transport} />
                <CheckItem label="PDF Separação" ok={!!stats.checks.separation} />
                <CheckItem label="PDF Expedição" ok={!!stats.checks.planning} />
                <CheckItem label="Chaves NF únicas" ok={!!stats.checks.stock} />
                <CheckItem label="Produtos cadastrados" ok={!!stats.checks.products_registered} />
              </div>
              {stats.checks.all_ok && (
                <div className="mt-3 p-2.5 bg-emerald-900/30 border border-emerald-500/20 rounded-lg text-center">
                  <p className="text-xs text-emerald-300 font-semibold">
                    ✓ Todas as checagens OK — pronto para bipagem
                  </p>
                </div>
              )}

              {/* Produtos sem cadastro */}
              {!stats.checks.products_registered &&
                Array.isArray(stats.checks.missing_products) &&
                stats.checks.missing_products.length > 0 && (
                  <div className="mt-3 p-3 bg-red-900/25 border border-red-500/20 rounded-lg">
                    <p className="text-xs font-semibold text-red-300 mb-2 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {stats.checks.missing_products.length} produto(s) sem cadastro
                    </p>
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                      {stats.checks.missing_products.map((mp: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-red-300">
                          <span className="font-mono bg-red-900/40 px-1.5 py-0.5 rounded">{mp.sku}</span>
                          <span className="text-red-400">{mp.seller_name}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        navigate('/products', {
                          state: { prefill: stats.checks?.missing_products },
                        })
                      }
                      className="mt-2 text-xs text-red-300 hover:underline flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Cadastrar produtos agora (pré-preenchido)
                    </button>
                  </div>
                )}

              {!stats.checks.transport &&
                Array.isArray(stats.checks.missing_carriers) &&
                (stats.checks.missing_carriers as any[]).length > 0 && (
                  <div className="mt-3 p-3 bg-amber-900/25 border border-amber-500/20 rounded-lg">
                    <p className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {(stats.checks.missing_carriers as any[]).length} pedido(s) sem transportadora
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {(stats.checks.missing_carriers as any[]).map((mc: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-amber-300">
                          <span className="font-mono bg-amber-900/40 px-1.5 py-0.5 rounded">{mc.nf_number}</span>
                          <span className="text-amber-400">{mc.seller_name}</span>
                          <span className="text-amber-200/60 truncate">{mc.customer_name}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setCarrierModalOrders((stats.checks?.missing_carriers ?? []) as any[])}
                      className="mt-2 text-xs text-amber-300 hover:underline flex items-center gap-1"
                    >
                      <ChevronRight size={11} /> Informar transportadoras agora
                    </button>
                  </div>
                )}
            </div>
          )}

          {/* Alertas */}
          {stats.alerts && stats.alerts.length > 0 && (
            <div className="space-y-2">
              {stats.alerts.map((alert: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                    alert.type === 'error'
                      ? 'bg-red-900/25 border-red-500/20 text-red-300'
                      : 'bg-amber-900/25 border-amber-500/20 text-amber-300'
                  }`}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  {alert.message}
                </div>
              ))}
            </div>
          )}

          {/* Unidades + Sellers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Resumo por unidade */}
            {stats.units_summary && stats.units_summary.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-4">Por Unidade</h2>
                <div className="space-y-3">
                  {stats.units_summary.map((unit: any) => (
                    <div key={unit.unit_id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white/60">{unit.unit_name}</span>
                        <span className="text-xs text-white/35">
                          {unit.completed}/{unit.total} ({unit.pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2">
                        <div
                          className="bg-violet-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${unit.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sellers com pedidos no dia */}
            {stats.sellers_with_orders && stats.sellers_with_orders.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-3">Sellers com Pedidos</h2>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.sellers_with_orders.map((s: any) => ({
                        name:
                          s.seller_name.length > 12
                            ? s.seller_name.slice(0, 12) + '…'
                            : s.seller_name,
                        total: s.total,
                        concluído: s.completed,
                      }))}
                      margin={{ top: 4, right: 8, left: -20, bottom: 4 }}
                    >
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: any, name: string) => [
                          value,
                          name === 'concluído' ? 'Concluídos' : 'Total',
                        ]}
                        contentStyle={{ fontSize: '11px' }}
                      />
                      <Bar dataKey="total" fill="#2D2A4A" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="concluído" fill="#7B63E8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {stats.sellers_with_orders.map((s: any) => (
                    <div key={s.seller_id} className="flex items-center justify-between text-xs">
                      <span className="text-white/60 truncate max-w-[60%]">{s.seller_name}</span>
                      <span className="text-white/35">
                        {s.completed}/{s.total} ({s.pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scans recentes */}
          {stats.recent_scans && stats.recent_scans.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3">
                Scans Recentes (últimas 2h)
              </h2>
              <div className="divide-y divide-white/5">
                {stats.recent_scans.map((scan: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-white/35 w-16 flex-shrink-0">
                      {scan.timestamp}
                    </span>
                    <span className="text-white/60 font-medium w-28 truncate flex-shrink-0">
                      {scan.operator}
                    </span>
                    <span className="font-mono text-violet-300 bg-violet-900/20 px-1.5 py-0.5 rounded">
                      {scan.sku}
                    </span>
                    <span className="text-white/35 truncate">NF {scan.order_nf}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Sellers sem pedidos hoje ─────────────────────── */}
          {stats.sellers_no_orders && stats.sellers_no_orders.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/20 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-2">
                <AlertTriangle size={14} />
                {stats.sellers_no_orders.length} seller(s) sem pedidos hoje
              </h2>
              <div className="flex flex-wrap gap-2">
                {stats.sellers_no_orders.map((s: any) => (
                  <span key={s.seller_id}
                    className="px-2.5 py-1 bg-gray-900 border border-amber-200 rounded-full text-xs text-amber-700 font-medium">
                    {s.seller_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Histórico de uploads do dia ──────────────────── */}
          {stats.sessions_today && stats.sessions_today.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-white/8 shadow-none p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                <Upload size={14} className="text-white/35" />
                Uploads do Dia
              </h2>
              <div className="space-y-2">
                {stats.sessions_today.map((sess: any) => (
                  <div key={sess.session_id}
                    className="flex items-start gap-3 p-3 bg-white/4 rounded-lg border border-white/8">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-white/80">
                          Sessão #{sess.session_id}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sess.file_type === 'Entrada' ? 'bg-blue-900/40 text-blue-300' : 'bg-violet-900/40 text-violet-300'}`}>
                          {sess.file_type}
                        </span>
                        <span className="text-[10px] text-white/35">{sess.created_at}</span>
                      </div>
                      {sess.source_file && (
                        <p className="text-[11px] text-white/35 truncate mb-1" title={sess.source_file}>
                          📄 {sess.source_file}
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/50">{sess.total_orders} pedido(s)</span>
                        {sess.seller_names?.length > 0 && (
                          <span className="text-xs text-white/35 truncate">
                            {sess.seller_names.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* PDFs gerados */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {sess.separation_pdf ? (
                        <a
                          href={`${API_BASE}/exports/${sess.separation_pdf}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-emerald-300 bg-emerald-900/25 border border-emerald-500/20 rounded-lg hover:bg-emerald-900/35 transition"
                        >
                          <FileText size={11} /> Separação
                        </a>
                      ) : (
                        <span className="px-2.5 py-1 text-[11px] text-white/25 border border-white/8 rounded-lg">
                          Sem PDF Sep.
                        </span>
                      )}
                      {sess.expedition_pdf ? (
                        <a
                          href={`${API_BASE}/exports/${sess.expedition_pdf}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-blue-300 bg-blue-900/25 border border-blue-500/20 rounded-lg hover:bg-blue-900/40 transition"
                        >
                          <FileText size={11} /> Expedição
                        </a>
                      ) : (
                        <span className="px-2.5 py-1 text-[11px] text-white/25 border border-white/8 rounded-lg">
                          Sem PDF Exp.
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de configuração do upload (nível do arquivo/sessão) */}
      {uploadModalOpen && pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelUpload}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-violet-900/30">
                <Upload size={20} className="text-violet-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Configurar importação</h3>
                <p className="text-xs text-white/50 mt-0.5 break-all">{pendingFile.name}</p>
              </div>
            </div>

            {/* Gerar PDFs */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-white/80 mb-2">Gerar relatórios PDF</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateSepPdf} onChange={e => setGenerateSepPdf(e.target.checked)}
                    className="h-4 w-4 rounded bg-white/10 border-white/20 text-violet-500 focus:ring-violet-500" />
                  <span className="text-sm text-white/80">PDF de Separação</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateExpPdf} onChange={e => setGenerateExpPdf(e.target.checked)}
                    className="h-4 w-4 rounded bg-white/10 border-white/20 text-violet-500 focus:ring-violet-500" />
                  <span className="text-sm text-white/80">PDF de Expedição</span>
                </label>
              </div>
            </div>

            {/* Tipo de arquivo (nível da sessão) */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-white/80 mb-2">
                Tipo da movimentação
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFileType('Saída')}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    fileType === 'Saída'
                      ? 'bg-violet-900/25 border-violet-500 text-violet-300 font-medium'
                      : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                  }`}
                >
                  Saída (Expedição)
                </button>
                <button
                  type="button"
                  onClick={() => setFileType('Entrada')}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    fileType === 'Entrada'
                      ? 'bg-blue-900/30 border-blue-500 text-blue-300 font-medium'
                      : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                  }`}
                >
                  Entrada (Recebimento)
                </button>
              </div>
              <p className="text-[11px] text-white/35 mt-1.5">
                Aplica-se a todos os pedidos deste arquivo.
              </p>
            </div>

            {/* Considerar para faturamento */}
            <div className="mb-5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forBilling}
                  onChange={(e) => setForBilling(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 text-violet-500 focus:ring-violet-500"
                />
                <div>
                  <span className="text-sm font-medium text-white/80">
                    Considerar para faturamento
                  </span>
                  <p className="text-[11px] text-white/35 mt-0.5">
                    Quando marcado, os pedidos deste arquivo entram na contagem mensal de cobrança dos sellers.
                  </p>
                </div>
              </label>
            </div>

            {/* Ações */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/8">
              <button
                type="button"
                onClick={handleCancelUpload}
                disabled={uploading}
                className="px-4 py-2 text-sm text-white/60 hover:bg-white/8 rounded-lg transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={uploading}
                className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-60"
              >
                {uploading ? 'Importando...' : 'Importar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de transportadoras */}
      {carrierModalOrders.length > 0 && (
        <CarrierModal
          orders={carrierModalOrders}
          onClose={() => setCarrierModalOrders([])}
          onSave={handleCarrierSave}
        />
      )}

      {/* Modal de confirmação de duplicatas */}
      {duplicateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelDuplicates}>
          <div
            className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-yellow-900/30">
                <AlertTriangle size={20} className="text-yellow-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  {duplicates.length} NF(s) já importada(s)
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Algumas notas fiscais deste arquivo já existem no banco. Confirme se deseja reimportar mesmo assim.
                </p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto border border-white/8 rounded-lg mb-4">
              <table className="w-full text-xs">
                <thead className="bg-white/5 sticky top-0">
                  <tr className="text-white/50">
                    <th className="text-left px-3 py-2 font-medium">NF</th>
                    <th className="text-left px-3 py-2 font-medium">Seller</th>
                    <th className="text-left px-3 py-2 font-medium">Importada em</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((d, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-mono text-white/90">{d.nf_number}</td>
                      <td className="px-3 py-1.5 text-white/60 truncate max-w-[160px]">{d.seller_name}</td>
                      <td className="px-3 py-1.5 text-white/35">
                        {d.existing_imported_at
                          ? format(new Date(d.existing_imported_at), 'dd/MM HH:mm', { locale: ptBR })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg bg-amber-900/25 border border-amber-500/20 p-3 mb-4">
              <p className="text-xs text-amber-200">
                <strong>Atenção:</strong> reimportar pode duplicar o estoque e a cobrança.
                Use apenas se o arquivo corrigiu dados de pedidos já processados.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/8">
              <button
                type="button"
                onClick={handleCancelDuplicates}
                disabled={uploading}
                           className="px-3 py-1.5 text-xs border border-white/12 rounded-lg text-white/60 hover:bg-white/4 disabled:opacity-40 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleForceImport}
                disabled={uploading}
                className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-400 rounded-lg disabled:opacity-50 transition"
              >
                {uploading ? 'Importando...' : 'Reimportar mesmo assim'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
