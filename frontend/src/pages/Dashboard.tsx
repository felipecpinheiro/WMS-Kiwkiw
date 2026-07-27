/**
 * WMS Kiwkiw - Dashboard Master
 * Cockpit gerencial com visão geral do dia: pedidos, unidades, sellers, checagens e auditoria.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Package, CheckCircle, Clock, ScanLine, AlertTriangle,
  ChevronRight, RefreshCw, Upload, CheckSquare, XSquare, FileText, X, ClipboardPaste,
} from 'lucide-react';
import { dashboardApi, ordersApi, DuplicateOrderInfo, InactiveSellerInfo, UnmatchedSellerInfo, SellerLinkDecision } from '../api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { todayBrasiliaStr } from '../timezone';

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

// ─── CarrierModal — grid estilo Excel com suporte a Ctrl+V ───
function CarrierModal({ orders, onClose, onSave }: {
  orders: any[];
  onClose: () => void;
  onSave: (updates: Record<number, string>) => void;
}) {
  // Inicializa com transportadoras já preenchidas (se houver)
  const [carriers, setCarriers] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    orders.forEach((o: any) => { if (o.carrier) init[o.order_id] = o.carrier; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Ctrl+V: aceita colar do Excel (tab-separated, uma linha por NF)
  // Formato esperado: NF\tTransportadora  ou só Transportadora por linha
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const newCarriers = { ...carriers };
    lines.forEach(line => {
      const parts = line.split('\t');
      // Se duas colunas: NF | Transportadora → encontra a NF correspondente
      if (parts.length >= 2) {
        const nf       = parts[0].trim();
        const carrier  = parts[1].trim();
        const matched  = orders.find((o: any) => String(o.nf_number).trim() === nf);
        if (matched && carrier) newCarriers[matched.order_id] = carrier;
      } else if (parts.length === 1 && parts[0].trim()) {
        // Uma coluna apenas: aplica na ordem sequencial das linhas sem transportadora
        const carrier = parts[0].trim();
        const missing = orders.find((o: any) => !newCarriers[o.order_id]);
        if (missing) newCarriers[missing.order_id] = carrier;
      }
    });
    setCarriers(newCarriers);
    e.preventDefault();
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(carriers); }
    finally { setSaving(false); }
  };

  const filled   = Object.values(carriers).filter(v => v.trim()).length;
  const total    = orders.length;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">Informar Transportadoras</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              Cole do Excel (NF · Tab · Transportadora) ou edite linha a linha · {filled}/{total} preenchidas
            </p>
          </div>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>

        {/* Instrução de paste */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-900/15 border border-amber-500/20 rounded-lg px-3 py-2">
            <ClipboardPaste size={13} className="flex-shrink-0" />
            <span>Clique em qualquer célula da coluna Transportadora e cole (Ctrl+V) os dados copiados do Excel</span>
          </div>
        </div>

        {/* Grid */}
        <div ref={gridRef} className="flex-1 overflow-y-auto px-5 py-3" onPaste={handlePaste}>
          {/* Header row */}
          <div className="grid text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1 px-1"
               style={{ gridTemplateColumns: '2rem 7rem 1fr 2fr' }}>
            <span>#</span><span>NF</span><span>Seller</span><span>Transportadora</span>
          </div>

          <div className="space-y-0.5">
            {orders.map((o: any, idx: number) => {
              const val = carriers[o.order_id] ?? '';
              const filled_row = val.trim().length > 0;
              return (
                <div
                  key={o.order_id}
                  className="grid items-center rounded"
                  style={{ gridTemplateColumns: '2rem 7rem 1fr 2fr',
                           background: filled_row ? 'rgba(109,89,222,0.08)' : 'transparent' }}
                >
                  <span className="text-[10px] text-white/25 px-1">{idx + 1}</span>
                  <span className="text-xs font-mono text-white/60 truncate px-1">{o.nf_number}</span>
                  <span className="text-xs text-white/40 truncate px-1">{o.seller_name}</span>
                  <input
                    value={val}
                    onChange={e => setCarriers(prev => ({ ...prev, [o.order_id]: e.target.value }))}
                    onPaste={handlePaste}
                    placeholder="—"
                    className="w-full border-0 border-b outline-none text-xs py-1 px-2 text-white/80 placeholder-white/20 transition-colors"
                    style={{
                      background: 'transparent',
                      borderBottomColor: filled_row ? 'rgba(109,89,222,0.5)' : 'rgba(255,255,255,0.08)',
                    }}
                    onFocus={e => (e.currentTarget.style.borderBottomColor = '#7B63E8')}
                    onBlur={e => (e.currentTarget.style.borderBottomColor = filled_row ? 'rgba(109,89,222,0.5)' : 'rgba(255,255,255,0.08)')}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
          <button
            onClick={() => setCarriers({})}
            className="text-xs text-white/30 hover:text-white/60 transition"
          >Limpar tudo</button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || filled === 0}
              className="px-4 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition disabled:opacity-50">
              {saving ? 'Salvando…' : `Salvar ${filled} transportadora(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Data alvo do cockpit — default hoje (Brasília), mas usuário pode escolher dias anteriores
  const [targetDate, setTargetDate] = useState(todayBrasiliaStr);
  const [uploading, setUploading] = useState(false);
  const todayStr = todayBrasiliaStr();
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

  // Modal de confirmação quando o arquivo referencia sellers inativos
  const [inactiveSellers, setInactiveSellers] = useState<InactiveSellerInfo[]>([]);
  const [inactiveModalOpen, setInactiveModalOpen] = useState(false);
  const [inactiveDecisions, setInactiveDecisions] = useState<Record<number, 'reactivate' | 'ignore'>>({});

  // Modal de confirmação quando o arquivo referencia nomes de seller não reconhecidos
  const [unmatchedSellers, setUnmatchedSellers] = useState<UnmatchedSellerInfo[]>([]);
  const [unmatchedModalOpen, setUnmatchedModalOpen] = useState(false);
  const [unmatchedDecisions, setUnmatchedDecisions] = useState<Record<string, SellerLinkDecision>>({});

  // Toggle "mostrar sellers inativos" no filtro por unidade do cockpit
  const [includeInactiveSellers, setIncludeInactiveSellers] = useState(false);

  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { unit_id: null };

  // Preferência de unidade ativa — salva por usuário no localStorage
  const unitPrefKey = `wms_active_unit_${user.id ?? 'anon'}`;
  const [activeUnitId, setActiveUnitId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem(unitPrefKey);
    return saved ? Number(saved) : (user.unit_id ?? undefined);
  });

  const handleUnitChange = (uid: number | undefined) => {
    setActiveUnitId(uid);
    if (uid) localStorage.setItem(unitPrefKey, String(uid));
    else localStorage.removeItem(unitPrefKey);
  };

  const { data: units = [] } = useQuery('units', () =>
    import('../api').then(m => m.cadastrosApi.units().then(r => r.data))
  );

  const { data, isLoading, refetch } = useQuery(
    ['dashboard', targetDate, activeUnitId, includeInactiveSellers],
    () => dashboardApi.master({
      target_date: targetDate,
      unit_id: activeUnitId,
      include_inactive_sellers: includeInactiveSellers,
    }).then(r => r.data),
    { refetchInterval: 60000 }, // atualiza a cada 1 minuto
  );

  // Warning: sellers ativos sem unidade associada — PDFs caem em SEM_UNIDADE
  const { data: sellersWithoutUnit = [] } = useQuery(
    'sellers-without-unit',
    () => import('../api').then(m => m.cadastrosApi.sellersWithoutUnit().then(r => r.data)),
    { staleTime: 5 * 60 * 1000 },
  );

  // Lista de sellers ativos p/ o dropdown de vínculo do modal de sellers não reconhecidos
  const { data: activeSellersForLink = [] } = useQuery(
    'active-sellers-for-link',
    () => import('../api').then(m => m.cadastrosApi.sellers(true).then(r => r.data)),
    { enabled: unmatchedModalOpen, staleTime: 5 * 60 * 1000 },
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

  // Chamada base — dispara o POST e trata a resposta (sucesso, seller inativo, seller não
  // reconhecido, duplicata, erro)
  const runImport = async (
    forceDuplicates: boolean,
    decisionsOverride?: Record<number, 'reactivate' | 'ignore'>,
    sellerLinkOverride?: Record<string, SellerLinkDecision>,
  ) => {
    if (!pendingFile || !user.unit_id) return;
    const decisions = decisionsOverride ?? inactiveDecisions;
    const sellerLinkDecisions = sellerLinkOverride ?? unmatchedDecisions;
    setUploading(true);
    try {
      const res = await ordersApi.import(pendingFile, user.unit_id, {
        file_type: fileType,
        for_billing: forBilling,
        force_duplicates: forceDuplicates,
        generate_sep_pdf: generateSepPdf,
        generate_exp_pdf: generateExpPdf,
        inactive_seller_decisions: decisions,
        seller_link_decisions: sellerLinkDecisions,
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
        inactive_sellers: inactives = [],
        unmatched_sellers: unmatched = [],
      } = data;

      // Backend achou sellers inativos referenciados no arquivo → exibe modal de decisão.
      if (requires_confirmation && inactives.length > 0) {
        setInactiveSellers(inactives);
        setUploadModalOpen(false);
        setInactiveModalOpen(true);
        return;
      }

      // Backend achou nomes de seller que não batem com nenhum cadastro → exibe modal de decisão.
      if (requires_confirmation && unmatched.length > 0) {
        setUnmatchedSellers(unmatched);
        setUploadModalOpen(false);
        setUnmatchedModalOpen(true);
        return;
      }

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

      // Downloads automáticos em sequência
      if (session_id) {
        if (generateSepPdf) {
          try {
            await ordersApi.downloadSessionPdf(session_id, 'separation');
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(detail ? `PDF de Separação: ${detail}` : 'PDF de Separação não gerado. Use o botão no histórico para tentar novamente.');
          }
        }
        if (generateExpPdf) {
          try {
            await ordersApi.downloadSessionPdf(session_id, 'expedition');
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(detail ? `PDF de Expedição: ${detail}` : 'PDF de Expedição não gerado. Use o botão no histórico para tentar novamente.');
          }
        }
      }

      refetch();
      // Fecha tudo e limpa estado
      setUploadModalOpen(false);
      setDuplicateModalOpen(false);
      setDuplicates([]);
      setInactiveModalOpen(false);
      setInactiveSellers([]);
      setInactiveDecisions({});
      setUnmatchedModalOpen(false);
      setUnmatchedSellers([]);
      setUnmatchedDecisions({});
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

  // Passo intermediário (opcional): usuário decide reativar ou ignorar cada seller inativo
  const handleSetInactiveDecision = (sellerId: number, decision: 'reactivate' | 'ignore') => {
    setInactiveDecisions(prev => ({ ...prev, [sellerId]: decision }));
  };

  const allInactiveDecided = inactiveSellers.every(s => !!inactiveDecisions[s.seller_id]);

  const handleConfirmInactiveSellers = () => {
    setInactiveModalOpen(false);
    runImport(false, inactiveDecisions);
  };

  const handleCancelInactiveSellers = () => {
    if (uploading) return;
    setInactiveModalOpen(false);
    setInactiveSellers([]);
    setInactiveDecisions({});
    setPendingFile(null);
  };

  // Passo intermediário (opcional): usuário decide, para cada nome de seller não
  // reconhecido, se vincula a um seller já cadastrado ou cria um novo (com unidade).
  const handleSetUnmatchedDecision = (sellerName: string, decision: SellerLinkDecision) => {
    setUnmatchedDecisions(prev => ({ ...prev, [sellerName]: decision }));
  };

  const allUnmatchedDecided = unmatchedSellers.every((s) => {
    const d = unmatchedDecisions[s.seller_name];
    if (!d) return false;
    return d.action === 'create' ? !!d.unit_id : !!d.seller_id;
  });

  const handleConfirmUnmatchedSellers = () => {
    setUnmatchedModalOpen(false);
    runImport(false, undefined, unmatchedDecisions);
  };

  const handleCancelUnmatchedSellers = () => {
    if (uploading) return;
    setUnmatchedModalOpen(false);
    setUnmatchedSellers([]);
    setUnmatchedDecisions({});
    setPendingFile(null);
  };

  const handleCarrierSave = async (updates: Record<number, string>) => {
    const { ordersApi } = await import('../api');
    const entries = Object.entries(updates).filter(([, v]) => v.trim());
    if (!entries.length) { setCarrierModalOrders([]); return; }
    try {
      await Promise.all(
        entries.map(([id, carrier]) =>
          ordersApi.updateCarrier(Number(id), carrier)
        )
      );
      toast.success(`${entries.length} transportadora(s) salva(s)`);
    } catch {
      toast.error('Erro ao salvar transportadoras');
    }
    setCarrierModalOrders([]);
    qc.invalidateQueries(['dashboard', targetDate]);
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

      {/* ⚠️ Warning: sellers sem unidade associada */}
      {(sellersWithoutUnit as any[]).length > 0 && (
        <div className="flex items-start gap-3 bg-amber-900/25 border border-amber-500/30 rounded-xl px-4 py-3">
          <span className="text-amber-400 mt-0.5 flex-shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">Sellers sem unidade associada</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              PDFs desses sellers serão salvos em <span className="font-mono">SEM_UNIDADE/</span>.
              Pode ser um seller duplicado com pedidos presos, ou só falta associar uma unidade.
            </p>
            <p className="text-xs text-amber-400/60 mt-1">
              {(sellersWithoutUnit as any[]).map((s: any) => `${s.trade_name} (${s.order_count} pedido(s))`).join(', ')}
            </p>
          </div>
          <a href="/sellers/corrigir" className="flex-shrink-0 text-xs text-amber-400 hover:underline mt-0.5">Corrigir →</a>
        </div>
      )}

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
          {/* Seletor de unidade — admin e manager */}
          {(user.role === 'admin' || user.role === 'manager') && (units as any[]).length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-900 border border-white/12 rounded-lg">
              <span className="text-xs text-white/40">Unidade:</span>
              <select
                value={activeUnitId ?? ''}
                onChange={e => handleUnitChange(e.target.value ? Number(e.target.value) : undefined)}
                className="bg-transparent text-sm text-white/80 outline-none"
              >
                {user.role === 'admin' && <option value="">Todas</option>}
                {(units as any[]).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Toggle: incluir sellers inativos no filtro por unidade */}
          {(user.role === 'admin' || user.role === 'manager') && activeUnitId && (
            <label className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-900 border border-white/12 rounded-lg text-xs text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInactiveSellers}
                onChange={e => setIncludeInactiveSellers(e.target.checked)}
                className="accent-violet-500"
              />
              Mostrar sellers inativos
            </label>
          )}

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

          {/* ── Acompanhamento por Operador ─────────────────── */}
          {stats.operators_summary && (stats.operators_summary.length > 0 || (stats.orders_no_operator ?? 0) > 0) && (
            <div className="bg-gray-900 rounded-xl border border-white/8 p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                <ScanLine size={14} className="text-violet-400" />
                Produtividade por Operador
              </h2>
              <div className="space-y-2">
                {stats.operators_summary.map((op: any) => {
                  const pct = op.orders_touched > 0 ? Math.round(op.orders_completed / op.orders_touched * 100) : 0;
                  return (
                    <div key={op.operator_id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/6"
                      style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg,#7B63E8,#3DD9A4)' }}>
                        {op.operator_name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/80 truncate">{op.operator_name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[11px] text-white/40">{op.scans} scan(s)</span>
                          <span className="text-[11px] text-white/40">{op.orders_touched} pedido(s) tocados</span>
                          <span className="text-[11px] text-teal-400 font-medium">{op.orders_completed} concluído(s)</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {op.scans > 0
                          ? <span className={`text-sm font-bold ${pct === 100 ? 'text-teal-400' : pct > 50 ? 'text-violet-300' : 'text-amber-400'}`}>{pct}%</span>
                          : <span className="text-xs text-white/25">Sem scans</span>}
                      </div>
                    </div>
                  );
                })}
                {(stats.orders_no_operator ?? 0) > 0 && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/6 border-dashed"
                    style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white/25 flex-shrink-0 border border-white/12">?</div>
                    <div className="flex-1">
                      <p className="text-sm text-white/40">Sem operador associado</p>
                      <p className="text-[11px] text-white/25 mt-0.5">Pedidos ainda não iniciados ou sem scan registrado</p>
                    </div>
                    <span className="text-sm font-bold text-white/35">{stats.orders_no_operator ?? 0}</span>
                  </div>
                )}
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
                    {/* PDFs — geração sob demanda; indicador se já salvo em disco */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'separation')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Separação'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_separation ? 'text-emerald-300 bg-emerald-900/25 border border-emerald-500/20 hover:bg-emerald-900/35' : 'text-white/40 bg-white/5 border border-white/10 hover:bg-white/10'}`}
                      >
                        <FileText size={11} /> Expedição{sess.separation_pdf ? ' ✓' : ''}
                      </button>
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'expedition')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Expedição'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_planning ? 'text-blue-300 bg-blue-900/25 border border-blue-500/20 hover:bg-blue-900/40' : 'text-white/40 bg-white/5 border border-white/10 hover:bg-white/10'}`}
                      >
                        <FileText size={11} /> Separação{sess.expedition_pdf ? ' ✓' : ''}
                      </button>
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

            {/* Botões */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCancelUpload}
                className="flex-1 px-4 py-2 text-sm text-white/60 border border-white/10 rounded-lg hover:bg-white/4 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => runImport(false)}
                disabled={uploading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
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
            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelDuplicates}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleForceImport}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Reimportar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de sellers inativos */}
      {inactiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelInactiveSellers}>
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
                  {inactiveSellers.length} seller(s) inativo(s) neste arquivo
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Escolha, para cada seller, se deseja reativá-lo e importar os pedidos dele, ou ignorar só os pedidos desse seller neste arquivo.
                </p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
              {inactiveSellers.map((s) => (
                <div key={s.seller_id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white/90 truncate">{s.seller_name}</p>
                    <p className="text-xs text-white/35">{s.nf_numbers.length} NF(s): {s.nf_numbers.slice(0, 5).join(', ')}{s.nf_numbers.length > 5 ? '…' : ''}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleSetInactiveDecision(s.seller_id, 'reactivate')}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                        inactiveDecisions[s.seller_id] === 'reactivate'
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'border-white/12 text-white/50 hover:text-white hover:border-white/25'
                      }`}
                    >
                      Reativar
                    </button>
                    <button
                      onClick={() => handleSetInactiveDecision(s.seller_id, 'ignore')}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                        inactiveDecisions[s.seller_id] === 'ignore'
                          ? 'bg-white/15 border-white/25 text-white'
                          : 'border-white/12 text-white/50 hover:text-white hover:border-white/25'
                      }`}
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelInactiveSellers}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar importação
              </button>
              <button
                onClick={handleConfirmInactiveSellers}
                disabled={!allInactiveDecided}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {unmatchedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCancelUnmatchedSellers}>
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
                  {unmatchedSellers.length} nome(s) de seller não reconhecido(s)
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Esses nomes não batem com nenhum seller cadastrado. Escolha, para cada um, se deseja
                  vincular a um seller já existente ou criar um novo (com unidade).
                </p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border border-white/8 rounded-lg mb-4 divide-y divide-white/5">
              {unmatchedSellers.map((s) => {
                const decision = unmatchedDecisions[s.seller_name];
                const isCreate = decision?.action === 'create';
                const selectValue = !decision ? '' : decision.action === 'create' ? 'create' : String(decision.seller_id);
                return (
                  <div key={s.seller_name} className="px-3 py-2.5">
                    <p className="text-sm text-white/90 truncate">{s.seller_name}</p>
                    <p className="text-xs text-white/35 mb-2">
                      {s.nf_numbers.length} NF(s): {s.nf_numbers.slice(0, 5).join(', ')}{s.nf_numbers.length > 5 ? '…' : ''}
                    </p>
                    <div className="flex gap-2">
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') return;
                          if (v === 'create') {
                            handleSetUnmatchedDecision(s.seller_name, { action: 'create', unit_id: 0 });
                          } else {
                            handleSetUnmatchedDecision(s.seller_name, { action: 'link', seller_id: Number(v) });
                          }
                        }}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                      >
                        <option value="" disabled>Selecione...</option>
                        <option value="create">Criar novo seller</option>
                        {activeSellersForLink.map((sel: any) => (
                          <option key={sel.id} value={sel.id}>Vincular a: {sel.trade_name}</option>
                        ))}
                      </select>
                      {isCreate && (
                        <select
                          value={decision?.action === 'create' && decision.unit_id ? decision.unit_id : ''}
                          onChange={(e) => handleSetUnmatchedDecision(s.seller_name, { action: 'create', unit_id: Number(e.target.value) })}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          <option value="" disabled>Unidade...</option>
                          {(units as any[]).map((u: any) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button
                onClick={handleCancelUnmatchedSellers}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all"
              >
                Cancelar importação
              </button>
              <button
                onClick={handleConfirmUnmatchedSellers}
                disabled={!allUnmatchedDecided}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7B63E8 0%, #5B43C8 100%)' }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
