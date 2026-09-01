/**
 * WMS Kiwkiw - Interface de Bipagem (Scanner) v2
 * Fluxo: Scan NFe → Abre pedido → Scan produtos
 * Design visual, robusto e à prova de erros.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import {
  CheckCircle, XCircle, AlertTriangle, ScanLine, Package,
  LogOut, Pause, KeyRound, ClipboardList, Plus, ZoomIn, X,
  Ban, RotateCcw,
} from 'lucide-react';
import { scanningApi, cadastrosApi, CANONICAL_BOXES } from '../api';
import type { EntryConference } from '../api';
import toast from 'react-hot-toast';
import ThemeToggle from '../components/ThemeToggle';
import Logo from '../components/Logo';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const photoSrc = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${API_BASE}${url}`) : null;

// ─── Types ─────────────────────────────────────────────────

interface SessionOrderItem {
  sku: string;
  product_name: string;
  quantity: number;
  scanned: number;
  barcode_seller: string | null;   // código físico da etiqueta — único aceito na bipagem
  product_id: number | null;
  photo_url: string | null;
}

interface SessionOrder {
  id: number;
  nf_number: string;
  customer_name: string;
  seller: string | null;
  seller_id: number | null;
  carrier: string;
  status: string;
  is_inactive: boolean;
  items_total: number;
  items_scanned: number;
  items: SessionOrderItem[];
  /** 'entrada' | 'saida' — só a entrada aceita bipagem por quantidade */
  file_type: string;
  /** Conferência de entrada pausada — continua EM ABERTO, só sinaliza a parada. */
  is_paused?: boolean;
}

interface ScanLog {
  id: number;
  timestamp: string;
  sku: string;
  is_error: boolean;
  error_message: string | null;
  operator_name: string;
  order_nf: string;
  quantity: number;
}

/** Teto por bipe — espelha MAX_SCAN_QUANTITY do backend (routers/scanning.py). */
const MAX_SCAN_QTY = 9999;
/** Acima disso a tela pede confirmação antes de enviar. */
const QTY_CONFIRM_THRESHOLD = 100;

type FeedbackState = 'idle' | 'success' | 'error' | 'warning';
interface Feedback { state: FeedbackState; title: string; message: string; photoUrl?: string; }
interface ProductModalState {
  mode: 'create' | 'view';
  item: SessionOrderItem;
  seller_id: number | null;
  seller_name: string;
  product_id: number | null;
}

// ─── Helper: item card ───────────────────────────────────

function ItemCard({
  item, isLast, isFlashing, isFirst, isSmall, onRightClick, onImageClick,
}: {
  item: SessionOrderItem;
  isLast: boolean;
  isFlashing?: boolean;
  /** Item em curso (primeiro na fila) — 50% com destaque */
  isFirst?: boolean;
  /** Item concluído — 25% da horizontal, compacto */
  isSmall?: boolean;
  onRightClick?: (e: React.MouseEvent) => void;
  onImageClick?: (url: string) => void;
}) {
  const done = item.scanned >= item.quantity;
  const inProgress = item.scanned > 0 && !done;
  // Só na entrada: chegou mais do que a NF previa. Fica visível no card para o
  // operador não descobrir a diferença só no fim.
  const over = item.scanned > item.quantity;

  // Altura da imagem: compacta para concluídos, normal para demais
  const imgH = isSmall ? 'h-16' : 'h-36';
  const iconSize = isSmall ? 16 : 26;

  // Estilo do card
  let cardClass = 'bg-surface/80 border-line-strong/50';
  if (isFlashing)      cardClass = 'bg-green-800/60 border-ok ring-2 ring-green-400/70 scale-[1.02]';
  else if (done)       cardClass = 'bg-ok-soft border-ok/20 opacity-50';
  else if (isFirst)    cardClass = 'bg-violet-900/30 border-violet-400/60 ring-2 ring-violet-400/25 shadow-lg shadow-violet-900/20';
  else if (inProgress) cardClass = 'bg-info-soft border-info/50';

  const padding = isSmall ? 'p-2' : 'p-3';
  const src = photoSrc(item.photo_url);

  return (
    <div
      className={`relative rounded-xl border ${padding} transition-all cursor-context-menu select-none ${cardClass}`}
      onContextMenu={onRightClick}
    >
      {/* Foto */}
      {src ? (
        <div className="relative group">
          <img
            src={src}
            alt={item.product_name}
            className={`w-full ${imgH} object-contain rounded-lg mb-2 opacity-95 bg-surface-2`}
          />
          {onImageClick && (
            <button
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-lg"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onImageClick(src); }}
              title="Ampliar imagem"
            >
              <ZoomIn size={20} className="text-t1 drop-shadow" />
            </button>
          )}
        </div>
      ) : (
        <div className={`w-full ${imgH} bg-surface-2 rounded-lg flex items-center justify-center mb-2`}>
          <Package size={iconSize} className="text-t5" />
        </div>
      )}

      {/* Badge SEM CADASTRO */}
      {!item.barcode_seller && !isSmall && (
        <div className="absolute top-2 left-2 bg-yellow-500/20 border border-warn/30 text-warn text-[9px] px-1.5 py-0.5 rounded-full font-bold">
          SEM CADASTRO
        </div>
      )}

      {/* Badge EM CURSO — primeiro item pendente */}
      {isFirst && !done && (
        <div className="absolute top-2 right-2 bg-violet-500 text-t1 text-[9px] px-2 py-0.5 rounded-full font-bold tracking-wide">
          EM CURSO
        </div>
      )}

      {/* SKU e barcode — só em cards normais */}
      {!isSmall && (
        <>
          <p className="text-xs font-mono text-t4 mb-0.5 truncate">{item.sku}</p>
          {item.barcode_seller && (
            <p className="text-sm font-mono font-semibold text-warn/80 mb-1 truncate" title="Cód. barras">
              ⬛ {item.barcode_seller}
            </p>
          )}
        </>
      )}

      <p className={`${isSmall ? 'text-[10px]' : 'text-sm'} font-bold text-t1 leading-snug mb-2 ${isSmall ? 'line-clamp-1' : 'line-clamp-2'}`}>
        {item.product_name}
      </p>

      <div className="flex items-center justify-between">
        <span className={`${isSmall ? 'text-lg' : 'text-2xl'} font-black ${over ? 'text-warn' : done ? 'text-ok' : inProgress ? 'text-info' : 'text-t4'}`}>
          {item.scanned}
          <span className={`${isSmall ? 'text-sm' : 'text-base'} text-t4`}>/{item.quantity}</span>
        </span>
        {over
          ? <span className="text-[9px] font-bold text-warn bg-amber-500/15 border border-warn/30 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              +{item.scanned - item.quantity}
            </span>
          : done && <CheckCircle size={isSmall ? 14 : 18} className="text-ok" />}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────

export default function ScannerPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sellerIdParam = searchParams.get('seller_id');
  const sellerId = sellerIdParam ? Number(sellerIdParam) : undefined;
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : { id: 1, name: 'Operador' };
  const isAdmin = user?.role === 'admin';

  // ── 1b: Restaura NF ativa do sessionStorage ao dar refresh ──
  const storedOrderId = sessionStorage.getItem(`scanner_${sessionId}_activeOrder`);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(
    storedOrderId ? Number(storedOrderId) : null
  );
  const [localOrders, setLocalOrders] = useState<SessionOrder[]>([]);
  // ── Filtro local "esconder NFs que contêm um SKU" ────────────
  // Puramente visual e local ao navegador/login. Sobrevive a F5 via
  // sessionStorage, mas é limpo ao sair da bipagem. Não mexe em progresso
  // real, contagem de manuseio, faturamento nem backend.
  const hiddenSkusKey = `scanner_${sessionId}_hiddenSkus`;
  const [hiddenSkus, setHiddenSkus] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(hiddenSkusKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try {
      if (hiddenSkus.length > 0) sessionStorage.setItem(hiddenSkusKey, JSON.stringify(hiddenSkus));
      else sessionStorage.removeItem(hiddenSkusKey);
    } catch { /* ignore */ }
  }, [hiddenSkus, hiddenSkusKey]);
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle', title: '', message: '' });
  const [lastScannedSku, setLastScannedSku] = useState<string | undefined>();
  const [flashedSku, setFlashedSku] = useState<string | undefined>(); // 1a: flash visual
  const [barcodeInput, setBarcodeInput] = useState('');
  // Quantidade do próximo bipe (só entrada). String para o campo aceitar ficar
  // vazio enquanto o operador digita; convertida na hora de enviar.
  const [qtyInput, setQtyInput] = useState('1');
  const qtyRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);
  const [interruptReason, setInterruptReason] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false); // 1b: confirmar saída
  const [exitReason, setExitReason] = useState('');
  // ── Finalizar conferência de ENTRADA (24/08/2026) ─────────
  // `entryConference` guarda o preview vindo do backend; enquanto ele existe, o
  // modal de conferência está aberto. Nada foi gravado ainda nesse ponto.
  const [entryConference, setEntryConference] = useState<EntryConference | null>(null);
  const [finalizingEntry, setFinalizingEntry] = useState(false);
  // Lock por seller: outro operador já bipando NF do mesmo seller — confirmação
  // ── Caixa sugerida ────────────────────────────────────────
  const [boxSuggested, setBoxSuggested]   = useState<string | null>(null);
  const [boxUsed, setBoxUsed]             = useState<string | null>(null);
  const [boxSaving, setBoxSaving]         = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; item: SessionOrderItem;
  } | null>(null);
  const [productModal, setProductModal] = useState<ProductModalState | null>(null);
  const [productForm, setProductForm] = useState({ name: '', barcode_seller: '', box_type: '', unit_value: 0 });
  const [savingProduct, setSavingProduct] = useState(false);
  // C: lightbox de imagem
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // ── Inativar/reativar NF (admin) ────────────────────────────
  const [showInactive, setShowInactive] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<SessionOrder | null>(null);
  const [auditOrder, setAuditOrder] = useState<SessionOrder | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);

  // Fetch orders
  const { data: ordersRaw = [], isLoading, isError, error } = useQuery(
    ['session-orders', sessionId, sellerId, isAdmin && showInactive],
    async () => {
      const r = await scanningApi.sessionOrders(Number(sessionId), sellerId, isAdmin && showInactive);
      const raw = Array.isArray(r.data) ? r.data : (r.data?.orders ?? []);
      return (raw as any[]).map((o): SessionOrder => ({
        id: o.id,
        nf_number: o.nf_number,
        customer_name: o.customer_name,
        seller: o.seller ?? null,
        seller_id: o.seller_id ?? null,
        carrier: o.carrier ?? '',
        status: o.status,
        is_inactive: o.is_inactive ?? (o.status === 'inactive'),
        file_type: o.file_type ?? 'saida',
        items_total: o.total_items ?? o.items_total ?? 0,
        items_scanned: o.scanned_items ?? o.items_scanned ?? 0,
        items: (o.items ?? []).map((it: any) => ({
          sku: it.sku,
          product_name: it.product_name,
          quantity: it.quantity,
          scanned: it.scanned ?? 0,
          barcode_seller: it.barcode_seller ?? null,
          product_id: it.product_id ?? null,
          photo_url: it.photo_url ?? null,
        })),
      }));
    },
    {
      // Com NF aberta o operador foca só nela — não recarrega em segundo plano.
      // Sem NF aberta, atualiza a cada 60s (era 15s) para ver o progresso geral.
      refetchInterval: activeOrderId ? false : 60000,
      enabled: !!sessionId,
    },
  );

  // Sync remote → local: só quando o dado do servidor MUDA de verdade
  // (ordersRaw), nunca por causa do liga/desliga de `scanning` a cada bipe —
  // senão essa sincronização reaplica um ordersRaw ainda velho por cima da
  // atualização otimista que acabamos de fazer em handleProductScan, e a tela
  // parece "não atualizar na hora" mesmo bipando com sucesso.
  useEffect(() => {
    if (ordersRaw.length > 0) {
      setLocalOrders(ordersRaw);
    }
  }, [ordersRaw]);

  // Limpa activeOrderId stale: se a lista carregou mas o pedido não está nela
  // (ex: sessionStorage de visita anterior, ou pedido de outro seller)
  useEffect(() => {
    if (!scanning && localOrders.length > 0 && activeOrderId !== null) {
      const found = localOrders.find(o => o.id === activeOrderId);
      if (!found) {
        sessionStorage.removeItem(`scanner_${sessionId}_activeOrder`);
        setActiveOrderId(null);
      }
    }
  }, [localOrders, activeOrderId, scanning, sessionId]);

  // Restaura foco no input após cada scan completo (scanning true → false).
  // O useEffect dispara após o React re-renderizar com scanning=false,
  // garantindo que o input já está habilitado no DOM quando .focus() é chamado.
  useEffect(() => {
    if (!scanning) {
      inputRef.current?.focus();
    }
  }, [scanning]);

  // Auto-focus input. Troca de NF também zera a quantidade — ela é sempre
  // relativa à caixa que está na bancada agora.
  useEffect(() => {
    inputRef.current?.focus();
    setQtyInput('1');
  }, [activeOrderId]);

  // Re-foca o input quando perde foco (exceto se outro input/button ganhou foco)
  const handleScanInputBlur = () => {
    setTimeout(() => {
      if (document.activeElement === document.body || document.activeElement === null) {
        inputRef.current?.focus();
      }
    }, 100);
  };

  // 1b: Persiste NF ativa no sessionStorage (sobrevive a F5)
  useEffect(() => {
    if (sessionId) {
      if (activeOrderId !== null) {
        sessionStorage.setItem(`scanner_${sessionId}_activeOrder`, String(activeOrderId));
      } else {
        sessionStorage.removeItem(`scanner_${sessionId}_activeOrder`);
      }
    }
  }, [activeOrderId, sessionId]);

  // ── Busca caixa sugerida quando muda o pedido ───────────────
  useEffect(() => {
    if (!activeOrderId) { setBoxSuggested(null); setBoxUsed(null); return; }
    scanningApi.suggestedBox(activeOrderId).then(r => {
      setBoxSuggested(r.data.suggested);
      setBoxUsed(r.data.box_used);
    }).catch(() => {});
  }, [activeOrderId]);

  const handleBoxSave = async (val: string) => {
    if (!activeOrderId) return;
    const orderId = activeOrderId;
    setBoxSaving(true);
    try {
      const v = val.trim() || null;
      const res = await scanningApi.saveOrderBox(orderId, v);
      setBoxUsed(v);
      if (res.data.order_completed) {
        // Caixa era a última pendência (todos os itens já bipados) — conclui
        // igual ao fim de bipagem normal. Mudar o status aqui já recalcula
        // scanPhase para 'nfe' sozinho, liberando a próxima NF.
        setLocalOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status: 'completed' } : o)));
        setFeedback({ state: 'success', title: '🎉 Pedido concluído!', message: 'NF finalizada. Escaneie a próxima NFe.' });
        setTimeout(() => setFeedback({ state: 'idle', title: '', message: '' }), 3000);
        // Devolve o foco pro leitor — sem isso o operador precisa clicar
        // manualmente pra abrir a próxima NF (mesmo padrão do else abaixo).
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        // Ainda falta bipar item — devolve o foco pro código de barras, mesmo
        // padrão já usado no campo de quantidade (handleQtyKeyDown).
        inputRef.current?.focus();
      }
    } catch { /* silent */ }
    finally { setBoxSaving(false); }
  };

  // Fecha context menu ao clicar fora
  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handler);
      document.addEventListener('contextmenu', handler);
    }
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [contextMenu]);

  // Handler de right-click num item
  const handleItemRightClick = useCallback((e: React.MouseEvent, item: SessionOrderItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  // Fetch scan logs
  const { data: scanLogs = [] } = useQuery(
    ['scan-logs', sessionId],
    () => (scanningApi as any).scanLogs
      ? (scanningApi as any).scanLogs(Number(sessionId)).then((r: any) => r.data)
      : Promise.resolve([]),
    { refetchInterval: 30000 },
  );

  const activeOrder = localOrders.find(o => o.id === activeOrderId) ?? null;
  // scanPhase = 'product' só se o pedido existe E não está concluído
  // (activeOrder null → stale ID, trata como 'nfe' para não travar a tela)
  const scanPhase: 'nfe' | 'product' =
    (activeOrderId === null || !activeOrder || activeOrder.status === 'completed') ? 'nfe' : 'product';

  // Consulta somente leitura (admin) de NF interrompida/concluída — reaproveita
  // a mesma tela central de bipagem, só sem os controles editáveis. Independente
  // do fluxo real de bipagem (activeOrderId/scanPhase).
  const isBipandoView = !!activeOrder && scanPhase === 'product';
  const isAuditView = !isBipandoView && !!auditOrder;
  const displayOrder: SessionOrder | null = isBipandoView ? activeOrder : (isAuditView ? auditOrder : null);

  // Campo de quantidade só existe na ENTRADA (17/08/2026): uma caixa de entrada
  // pode ter 1.000 peças iguais. Na saída cada bipe é uma conferência de
  // separação e continua sendo 1 por vez. O backend também recusa quantidade > 1
  // fora da entrada — esta checagem aqui é só de interface.
  const isEntradaOrder = activeOrder?.file_type === 'entrada';
  const showQtyField = isEntradaOrder && scanPhase === 'product';

  // Caixa obrigatória só na SAÍDA (17/08/2026) — na entrada o badge nem
  // aparece, pra não sugerir uma exigência que não existe ali.
  const showBoxBadge = !isEntradaOrder && scanPhase === 'product';
  // Todos os itens já bipados (100%) mas ainda sem caixa salva: é o estado
  // que trava a conclusão do pedido. Calculado dos itens locais (não de um
  // estado à parte) pra sobreviver a F5/reload igual ao resto da tela.
  const awaitingBox =
    showBoxBadge && !boxUsed && !!activeOrder && activeOrder.items.every(it => it.scanned >= it.quantity);

  // Gatilho real de atualização: assim que o pedido é concluído (sai de 'product'
  // pra 'nfe'), busca a lista da sessão uma vez — mostra o progresso de outros
  // operadores no momento em que o operador termina a NF dele, sem voltar a
  // recarregar tudo a cada bipe individual (o polling de 60s sozinho quase nunca
  // dispara pra quem bipa sem pausar — ver CLAUDE.md).
  const prevScanPhaseRef = useRef<'nfe' | 'product'>(scanPhase);
  useEffect(() => {
    if (prevScanPhaseRef.current === 'product' && scanPhase === 'nfe') {
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    }
    prevScanPhaseRef.current = scanPhase;
  }, [scanPhase, sessionId, sellerId, qc]);

  const totalOrders = localOrders.length;
  const doneOrders = localOrders.filter(o => o.status === 'completed').length;
  const sessionPct = totalOrders > 0 ? Math.round((doneOrders / totalOrders) * 100) : 0;

  // Opções do filtro: SKUs distintos presentes nas NFs desta view.
  const skuOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of localOrders) {
      for (const it of o.items) {
        if (it.sku && !map.has(it.sku)) map.set(it.sku, it.product_name || '');
      }
    }
    return Array.from(map, ([sku, name]) => ({ sku, name }))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [localOrders]);

  // IDs das NFs escondidas pelo filtro (contêm ao menos um SKU escondido).
  const hiddenOrderIds = useMemo(() => {
    const set = new Set<number>();
    if (hiddenSkus.length === 0) return set;
    for (const o of localOrders) {
      if (o.items.some(it => hiddenSkus.includes(it.sku))) set.add(o.id);
    }
    return set;
  }, [localOrders, hiddenSkus]);

  const visibleOrders = useMemo(
    () => localOrders.filter(o => !hiddenOrderIds.has(o.id)),
    [localOrders, hiddenOrderIds],
  );

  // ── NFe scan: open order ───────────────────────────────

  const handleNfeScan = useCallback(async (nfeKey: string, force: boolean = false) => {
    if (!nfeKey.trim() || scanning) return;
    setScanning(true);
    try {
      const res = await (scanningApi as any).openByNfe(Number(sessionId), nfeKey.trim(), force);
      const data = res.data;
      if (data.success) {
        // A: se filtro de seller ativo, rejeita NFs de outros sellers
        if (sellerId) {
          const inFilteredList = localOrders.some(o => o.id === data.order_id);
          if (!inFilteredList) {
            setFeedback({
              state: 'error',
              title: '✗ NFe de outro seller',
              message: 'Esta NFe não pertence ao seller desta view. Use a sessão completa para acessá-la.',
            });
            setScanning(false);
            setBarcodeInput('');
            inputRef.current?.focus();
            return;
          }
        }
        // B: bloquear pedido interrompido — não pode ser reaberto
        const matchedOrder = localOrders.find(o => o.id === data.order_id);
        if (matchedOrder?.status === 'interrupted') {
          setFeedback({
            state: 'error',
            title: '✗ Pedido interrompido',
            message: `NF ${matchedOrder.nf_number} foi interrompida e não pode ser reaberta. Contate o supervisor.`,
          });
          setScanning(false);
          setBarcodeInput('');
          inputRef.current?.focus();
          return;
        }
        // Filtro local de SKU: NF escondida não pode ser aberta enquanto o
        // filtro estiver ativo (evita trabalhar por engano a NF que era pra
        // ficar de fora).
        if (hiddenOrderIds.has(data.order_id)) {
          setFeedback({
            state: 'error',
            title: '✗ NF escondida pelo filtro',
            message: `NF ${data.nf_number} está oculta pelo filtro de SKU. Limpe o filtro para bipá-la.`,
          });
          toast('NF escondida pelo filtro de SKU', { icon: '🚫', duration: 6000 });
          setScanning(false);
          setBarcodeInput('');
          inputRef.current?.focus();
          return;
        }
        setActiveOrderId(data.order_id);
        qc.invalidateQueries(['session-orders', sessionId, sellerId]);
        // Aviso explícito (não bloqueia): mesma NF já sendo bipada por outro
        // operador. Ver CLAUDE.md — dois operadores nunca deveriam abrir a
        // mesma NF; se acontecer, o supervisor precisa perceber na hora.
        if (data.warning) {
          setFeedback({ state: 'warning', title: '⚠️ NF já em bipagem', message: data.warning });
          toast(data.warning, { icon: '⚠️', duration: 8000, style: { fontWeight: 600 } });
        } else {
          setFeedback({ state: 'success', title: `✓ Pedido aberto`, message: `NF ${data.nf_number} — ${data.customer_name ?? ''}` });
        }
        // Update local order status to scanning
        setLocalOrders(prev => prev.map(o =>
          o.id === data.order_id && o.status === 'pending'
            ? { ...o, status: 'scanning' } : o
        ));
      } else if (data.blocked_reason === 'inactive') {
        setFeedback({ state: 'error', title: '✗ NF inativada', message: data.message });
        toast.error(data.message, { duration: 6000 });
        setTimeout(() => navigate('/manuseios'), 2500);
      } else if (data.blocked_reason === 'missing_product') {
        // NF (entrada ou saída) com SKU sem produto cadastrado — impossível de
        // bipar. A mensagem do backend já lista os SKUs. Cadastre pelo card em
        // Manuseios ou pelo Dashboard e a NF volta sozinha.
        setFeedback({ state: 'error', title: '✗ SKU sem cadastro', message: data.message });
        toast.error(data.message, { duration: 8000 });
      } else {
        setFeedback({ state: 'error', title: '✗ NFe não encontrada', message: data.message || 'Verifique a etiqueta' });
      }
    } catch (err: any) {
      // Fallback: try to match nf_number directly from local orders
      const matched = localOrders.find(o =>
        o.nf_number === nfeKey.trim() ||
        o.nf_number === nfeKey.trim().slice(-9)
      );
      if (matched) {
        if (matched.status === 'completed') {
          setFeedback({ state: 'warning', title: 'Pedido já concluído', message: `NF ${matched.nf_number} está completa` });
        } else if (matched.status === 'interrupted') {
          // B: pedido interrompido não pode ser reaberto via bipagem
          setFeedback({
            state: 'error',
            title: '✗ Pedido interrompido',
            message: `NF ${matched.nf_number} foi interrompida e não pode ser reaberta. Contate o supervisor.`,
          });
        } else if (hiddenOrderIds.has(matched.id)) {
          setFeedback({
            state: 'error',
            title: '✗ NF escondida pelo filtro',
            message: `NF ${matched.nf_number} está oculta pelo filtro de SKU. Limpe o filtro para bipá-la.`,
          });
          toast('NF escondida pelo filtro de SKU', { icon: '🚫', duration: 6000 });
        } else {
          setActiveOrderId(matched.id);
          setFeedback({ state: 'success', title: `✓ Pedido aberto`, message: `NF ${matched.nf_number} — ${matched.customer_name}` });
        }
      } else {
        setFeedback({ state: 'error', title: '✗ NFe não encontrada', message: 'Escaneie a etiqueta do pedido' });
      }
    } finally {
      setScanning(false);
      setBarcodeInput('');
      inputRef.current?.focus();
    }
  }, [scanning, sessionId, localOrders, hiddenOrderIds]);

  // ── Product scan ────────────────────────────────────────

  const handleProductScan = useCallback(async (barcode: string) => {
    if (!activeOrder || scanning || !barcode.trim()) return;
    if (activeOrder.status === 'completed') {
      setFeedback({ state: 'warning', title: 'Pedido concluído', message: 'Escaneie a próxima NFe para abrir o próximo pedido' });
      return;
    }

    // Quantidade só sai daqui na entrada — na saída vai sempre 1, mesmo que o
    // campo tenha sobrado com outro valor de uma NF anterior.
    const qty = isEntradaOrder ? Math.trunc(Number(qtyInput) || 1) : 1;
    if (isEntradaOrder && (qty < 1 || qty > MAX_SCAN_QTY)) {
      setFeedback({
        state: 'error',
        title: 'Quantidade inválida',
        message: `Digite um número de 1 a ${MAX_SCAN_QTY}.`,
      });
      qtyRef.current?.select();
      return;
    }
    // Confirmação acima de 100: pega o caso do operador bipar o código de barras
    // dentro do campo de quantidade sem perceber.
    if (qty > QTY_CONFIRM_THRESHOLD) {
      const ok = window.confirm(
        `Confirmar a entrada de ${qty} unidades de uma vez?\n\n` +
        `Se você digitou isso sem querer, cancele agora.`
      );
      if (!ok) {
        setBarcodeInput('');
        qtyRef.current?.select();
        return;
      }
    }

    setScanning(true);
    try {
      const res = await scanningApi.scan({
        session_id: Number(sessionId),
        order_id: activeOrder.id,
        barcode,
        operator_id: user.id,
        quantity: qty,
      });
      const data = res.data;

      if (data.success) {
        setLastScannedSku(data.sku ?? undefined);

        // 1a: Flash visual no card do item bipado (anel verde por 800ms)
        if (data.sku) {
          setFlashedSku(data.sku);
          setTimeout(() => setFlashedSku(undefined), 800);
        }

        // Atualiza o pedido ativo com o progresso que o próprio /scan já devolve
        // (order_progress) — não recarrega a lista inteira da sessão a cada
        // bipada. Fallback para incremento local se o servidor não mandar
        // order_progress por algum motivo.
        const progress = data.order_progress as
          | { items: { sku: string; scanned: number }[]; scanned: number }
          | undefined;
        setLocalOrders(prev => prev.map(o => {
          if (o.id !== activeOrder.id) return o;
          const newItems = progress
            ? o.items.map(it => {
                const p = progress.items.find(pi => pi.sku === it.sku);
                return p ? { ...it, scanned: p.scanned } : it;
              })
            : o.items.map(it => (
                // Na entrada o bipado pode passar do previsto (excedente), então
                // o fallback não trava no limite do item como fazia antes.
                it.sku === data.sku && (isEntradaOrder || it.scanned < it.quantity)
                  ? { ...it, scanned: it.scanned + qty }
                  : it
              ));
          const newScanned = progress
            ? progress.scanned
            : newItems.reduce(
                (acc, it) => acc + (isEntradaOrder ? it.scanned : Math.min(it.scanned, it.quantity)),
                0,
              );
          return {
            ...o,
            items: newItems,
            items_scanned: newScanned,
            status: data.status === 'order_complete' ? 'completed' : (o.status === 'pending' ? 'scanning' : o.status),
          };
        }));

        // Chegou mais do que a NF previa: registra o que foi contado, mas o
        // operador precisa avisar a empresa. Toast longo, fora do painel de
        // feedback, para não sumir com a próxima bipada.
        const over = data.over_quantity ?? 0;
        if (over > 0) {
          toast(
            `⚠️ Recebido ${over} a mais do que a NF ${activeOrder.nf_number} previa ` +
            `(${data.product_name ?? data.sku}). Comunique a empresa.`,
            { duration: 10000, icon: '📦' },
          );
        }

        if (data.status === 'order_complete' || data.status === 'completed') {
          setFeedback({ state: 'success', title: '🎉 Pedido concluído!', message: `NF ${activeOrder.nf_number} finalizada. Escaneie a próxima NFe.` });
          setTimeout(() => setFeedback({ state: 'idle', title: '', message: '' }), 3000);
        } else if (data.status === 'awaiting_box') {
          // Todos os itens bipados, mas caixa obrigatória (saída) ainda vazia —
          // o pedido não conclui e a próxima NF continua bloqueada até o
          // operador cadastrar a caixa (ver o badge 📦 vermelho pulsando).
          toast(
            `📦 Bipagem registrada — falta cadastrar a caixa pra concluir a NF ${activeOrder.nf_number}.`,
            { duration: 8000, icon: '📦' },
          );
          setFeedback({
            state: 'warning',
            title: '📦 Falta a caixa',
            message: `Todos os itens bipados — cadastre a caixa pra concluir a NF ${activeOrder.nf_number}.`,
          });
        } else if (isEntradaOrder && (data.items_remaining ?? 1) === 0) {
          // Entrada não conclui sozinha de propósito (pode chegar mais peça na
          // caixa seguinte). Aqui a contagem já cobre a NF inteira, então o
          // operador precisa saber que o Finalizar está pronto pra ser usado.
          setFeedback({
            state: over > 0 ? 'warning' : 'success',
            title: over > 0 ? '⚠️ Contado acima da NF' : '✓ Contagem completa',
            message: `${data.product_name ?? data.sku} — tudo da NF foi contado. Continue se ainda tiver caixa, ou clique em Finalizar.`,
            photoUrl: data.photo_url ?? undefined,
          });
        } else {
          setFeedback({
            state: over > 0 ? 'warning' : 'success',
            title: over > 0 ? '⚠️ Bipado acima da NF' : '✓ Bipagem registrada',
            message: `${data.product_name ?? data.sku} — ${data.items_remaining ?? '?'} restante(s)`,
            photoUrl: data.photo_url ?? undefined,
          });
        }

        // Atualiza só o log de bipagens (consulta leve e indexada). A lista
        // completa de pedidos da sessão NÃO é mais recarregada a cada bipe —
        // o order_progress acima já mantém o pedido ativo consistente.
        qc.invalidateQueries(['scan-logs', sessionId]);
      } else if (data.status === 'inactive') {
        setFeedback({ state: 'error', title: '✗ NF inativada', message: data.message });
        toast.error(data.message, { duration: 6000 });
        setActiveOrderId(null);
        setTimeout(() => navigate('/manuseios'), 2500);
      } else {
        setFeedback({ state: 'error', title: '✗ Código inválido', message: data.message ?? 'Produto não pertence a este pedido' });
      }
    } catch (err: any) {
      setFeedback({ state: 'error', title: 'Erro', message: err.response?.data?.detail || 'Tente novamente' });
    } finally {
      setScanning(false);
      setBarcodeInput('');
      // Volta sempre para 1: se o valor ficasse preso, o próximo produto entraria
      // com a quantidade da caixa anterior sem ninguém perceber.
      setQtyInput('1');
      inputRef.current?.focus();
    }
  }, [activeOrder, scanning, sessionId, user.id, qc, isEntradaOrder, qtyInput]);

  // ── Main scan handler ───────────────────────────────────

  const handleScan = useCallback((barcode: string) => {
    if (!barcode.trim()) return;

    if (scanPhase === 'nfe') {
      handleNfeScan(barcode);
    } else {
      // 3E: If active order not completed, block NFe-length scans that don't match products
      // We just scan as product - backend will reject if wrong
      handleProductScan(barcode);
    }
  }, [scanPhase, handleNfeScan, handleProductScan]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleScan(barcodeInput);
  };

  // Enter/Tab no campo de quantidade devolve o foco ao código de barras — é ele
  // que precisa estar focado quando o leitor USB dispara (o leitor "digita" o
  // código e manda um Enter).
  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  // ── Inativar/reativar NF (admin) ────────────────────────────

  const handleDeactivateOrder = async () => {
    if (!deactivateTarget || !deactivateReason.trim()) return;
    setDeactivating(true);
    try {
      const res = await scanningApi.deactivateOrder(deactivateTarget.id, deactivateReason.trim());
      toast.success(res.data.message || 'NF inativada');
      if (activeOrderId === deactivateTarget.id) {
        setActiveOrderId(null);
        setFeedback({ state: 'idle', title: '', message: '' });
      }
      setDeactivateTarget(null);
      setDeactivateReason('');
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao inativar NF');
    } finally {
      setDeactivating(false);
    }
  };

  const handleReactivateOrder = async (orderId: number) => {
    setReactivatingId(orderId);
    try {
      const res = await scanningApi.reactivateOrder(orderId);
      toast.success(res.data.message || 'NF reativada');
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao reativar NF');
    } finally {
      setReactivatingId(null);
    }
  };

  // ── Interromper (saída) / Pausar (entrada) ───────────────
  //
  // São coisas diferentes de propósito: interromper é carimbo DEFINITIVO (a NF
  // não reabre e conta como feita), enquanto pausar deixa tudo em aberto para
  // continuar depois — uma conferência de entrada pode levar dias. O backend
  // recusa interrupt em NF de entrada, então a escolha aqui não é cosmética.

  const handleInterrupt = async () => {
    if (!activeOrder) return;
    try {
      if (isEntradaOrder) {
        await scanningApi.pauseEntry(activeOrder.id, interruptReason || undefined);
        toast.success('Conferência pausada — a NF continua em aberto');
      } else {
        await scanningApi.interrupt({
          session_id: Number(sessionId),
          order_id: activeOrder.id,
          operator_id: user.id,
          reason: interruptReason || 'Sem motivo informado',
        });
        toast.success('Pedido interrompido');
      }
      setActiveOrderId(null);
      setShowInterruptDialog(false);
      setInterruptReason('');
      setFeedback({ state: 'idle', title: '', message: '' });
      setLastScannedSku(undefined);
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    } catch {
      toast.error(isEntradaOrder ? 'Erro ao pausar' : 'Erro ao interromper');
    }
  };

  // ── Finalizar conferência de ENTRADA ─────────────────────
  //
  // Passo 1: pede o comparativo ao backend (nada é gravado) e abre o modal.
  // Passo 2 (handleConfirmEntryFinalize): confirma, e só então o estoque entra
  // pela quantidade CONTADA. Fechar o modal sem confirmar volta a bipar de onde
  // parou, sem perder nada.
  const handleOpenEntryConference = async () => {
    if (!activeOrder) return;
    setFinalizingEntry(true);
    try {
      // .data: o cliente devolve a resposta do axios, não o corpo (mesmo
      // padrão de res.data.order_completed em handleBoxSave).
      const res = await scanningApi.finalizeEntry(activeOrder.id, false);
      setEntryConference(res.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao montar a conferência');
    } finally {
      setFinalizingEntry(false);
    }
  };

  const handleConfirmEntryFinalize = async () => {
    if (!activeOrder) return;
    setFinalizingEntry(true);
    try {
      const res = await scanningApi.finalizeEntry(activeOrder.id, true);
      toast.success(res.data?.message || 'Conferência finalizada');
      setEntryConference(null);
      setActiveOrderId(null);
      setFeedback({ state: 'idle', title: '', message: '' });
      setLastScannedSku(undefined);
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao finalizar a conferência');
    } finally {
      setFinalizingEntry(false);
    }
  };

  // ── Confirmar saída (pausa/interrompe automaticamente se NF aberta) ──
  const handleConfirmExit = async () => {
    if (activeOrder && scanPhase === 'product') {
      try {
        if (isEntradaOrder) {
          await scanningApi.pauseEntry(
            activeOrder.id,
            exitReason.trim() || 'Saída da bipagem pelo operador',
          );
          toast('Conferência pausada. Saindo...', { icon: '⏸' });
        } else {
          await scanningApi.interrupt({
            session_id: Number(sessionId),
            order_id: activeOrder.id,
            operator_id: user.id,
            reason: exitReason.trim() || 'Saída da bipagem pelo operador',
          });
          toast('Pedido interrompido. Saindo...', { icon: '⚠️' });
        }
      } catch {
        toast.error(isEntradaOrder ? 'Erro ao pausar a conferência' : 'Erro ao interromper o pedido');
      }
    }
    // Limpa sessionStorage e navega para fora
    if (sessionId) {
      sessionStorage.removeItem(`scanner_${sessionId}_activeOrder`);
      sessionStorage.removeItem(hiddenSkusKey);
    }
    setHiddenSkus([]);
    setActiveOrderId(null);
    setShowExitDialog(false);
    setExitReason('');
    navigate('/manuseios');
  };

  // ── Salva produto inline (do modal de right-click) ──────
  const handleSaveProductInline = async () => {
    if (!productModal) return;
    if (!productForm.barcode_seller.trim()) {
      toast.error('Código de barras é obrigatório');
      return;
    }
    setSavingProduct(true);
    try {
      if (productModal.mode === 'create' && productModal.seller_id) {
        await cadastrosApi.createProduct({
          seller_id: productModal.seller_id,
          sku: productModal.item.sku,
          name: productForm.name || productModal.item.product_name,
          barcode_seller: productForm.barcode_seller.trim(),
          box_type: productForm.box_type || undefined,
          unit_value: productForm.unit_value || 0,
        });
        toast.success('Produto cadastrado!');
      } else if (productModal.mode === 'view') {
        // Atualiza produto existente pelo product_id
        if (!productModal.product_id) {
          toast.error('ID do produto não encontrado. Cadastre manualmente em Cadastros → Produtos.');
          return;
        }
        await cadastrosApi.updateProduct(productModal.product_id, {
          barcode_seller: productForm.barcode_seller.trim(),
          name: productForm.name || productModal.item.product_name,
          box_type: productForm.box_type || undefined,
        });
        toast.success('Código de barras atualizado!');
      }
      // Refresh dos pedidos para carregar o novo barcode_seller
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
      setProductModal(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar produto');
    } finally {
      setSavingProduct(false);
    }
  };

  // ── Feedback styles ──────────────────────────────────────

  const feedbackBg: Record<FeedbackState, string> = {
    idle: 'border-line bg-surface-2',
    success: 'border-ok/50 bg-ok-soft',
    error: 'border-bad/50 bg-bad-soft',
    warning: 'border-warn/50 bg-warn-soft',
  };

  const feedbackTextColor: Record<FeedbackState, string> = {
    idle: 'text-t4',
    success: 'text-ok',
    error: 'text-bad',
    warning: 'text-warn',
  };

  const feedbackIcon: Record<FeedbackState, React.ReactNode> = {
    idle: scanPhase === 'nfe'
      ? <KeyRound size={28} className="text-t5" />
      : <ScanLine size={28} className="text-t5" />,
    success: <CheckCircle size={28} className="text-ok" />,
    error: <XCircle size={28} className="text-bad" />,
    warning: <AlertTriangle size={28} className="text-warn" />,
  };

  // ── Sem sessionId: redireciona para Manuseios ──────────────────────────────
  if (!sessionId) {
    navigate('/manuseios', { replace: true });
    return null;
  }


  return (
    <div className="flex h-screen bg-app text-t1 overflow-hidden">

      {/* ── LEFT: order list ─────────────────────────── */}
      <aside className="w-60 bg-surface border-r border-line-soft flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-line-soft">
          <div className="flex items-center gap-2 mb-1">
            <Logo size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-t1">Sessão #{sessionId}</p>
              <p className="text-[10px] text-t4">Bipagem</p>
            </div>
            <ThemeToggle />
          </div>
          {/* Sellers presentes na sessão */}
          {(() => {
            const uniqueSellers = Array.from(new Set(localOrders.map(o => o.seller).filter(Boolean)));
            return uniqueSellers.length > 0 ? (
              <p className="text-[9px] mt-1.5 font-medium truncate" style={{ color: 'rgb(var(--brand))' }}>
                {uniqueSellers.join(' · ')}
              </p>
            ) : null;
          })()}
          {/* Seller filter banner */}
          {sellerId && localOrders.length > 0 && (() => {
            const sellerName = localOrders.find(o => o.seller_id === sellerId)?.seller;
            return sellerName ? (
              <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-semibold"
                style={{ background: 'rgba(123,99,232,0.15)', color: 'rgb(var(--brand))', border: '1px solid rgba(123,99,232,0.25)' }}>
                <span>Filtrando:</span>
                <span className="truncate">{sellerName}</span>
              </div>
            ) : null;
          })()}
          {/* Filtro local: esconder NFs que contêm um SKU (ex.: produto que o
              seller ainda não enviou). Só visual, só neste login, some ao sair. */}
          {skuOptions.length > 0 && (
            <div className="mt-1.5 px-2 py-1.5 rounded-lg text-[9px]"
              style={{ background: 'rgba(123,99,232,0.08)', border: '1px solid rgba(123,99,232,0.20)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-t3">Esconder NFs com o SKU</span>
                {hiddenSkus.length > 0 && (
                  <button onClick={() => setHiddenSkus([])}
                    className="text-t5 hover:text-bad font-semibold">Limpar</button>
                )}
              </div>
              <select
                value=""
                onChange={e => {
                  const v = e.target.value;
                  if (v && !hiddenSkus.includes(v)) setHiddenSkus(prev => [...prev, v]);
                }}
                className="w-full bg-surface-2 border border-line-soft rounded px-1.5 py-1 text-[9px] text-t2"
              >
                <option value="">+ escolher SKU…</option>
                {skuOptions
                  .filter(o => !hiddenSkus.includes(o.sku))
                  .map(o => (
                    <option key={o.sku} value={o.sku}>
                      {o.sku}{o.name ? ` — ${o.name}` : ''}
                    </option>
                  ))}
              </select>
              {hiddenSkus.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {hiddenSkus.map(sku => (
                    <span key={sku}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: 'rgba(123,99,232,0.18)', color: 'rgb(var(--brand))' }}>
                      {sku}
                      <button onClick={() => setHiddenSkus(prev => prev.filter(s => s !== sku))}
                        className="hover:text-bad"><X size={9} /></button>
                    </span>
                  ))}
                </div>
              )}
              {hiddenOrderIds.size > 0 && (
                <p className="mt-1 text-warn font-semibold">
                  {hiddenOrderIds.size} NF(s) escondida(s)
                </p>
              )}
            </div>
          )}
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-t4 mb-1">
              <span>{doneOrders}/{totalOrders} pedidos</span>
              <span>{sessionPct}%</span>
            </div>
            <div className="w-full bg-surface-2 rounded-full h-1.5">
              <div className="bg-violet-500 h-1.5 rounded-full transition-all" style={{ width: `${sessionPct}%` }} />
            </div>
          </div>
        </div>

        {/* Order list — informativo apenas (não clicável para abrir) */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <p className="text-[9px] text-t5 uppercase tracking-widest">Pedidos da sessão</p>
            {isAdmin && (
              <label className="flex items-center gap-1 text-[9px] text-t4 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={e => setShowInactive(e.target.checked)}
                  className="w-3 h-3 accent-violet-500"
                />
                Só NFs inativas
              </label>
            )}
          </div>
          {isLoading ? (
            <p className="text-xs text-t4 text-center py-4">Carregando...</p>
          ) : isError ? (
            <p className="text-xs text-bad text-center py-4 px-2">
              {(error as any)?.response?.data?.detail || 'Erro ao carregar'}
            </p>
          ) : visibleOrders.length === 0 && localOrders.length > 0 ? (
            <p className="text-[10px] text-t4 text-center py-4 px-2">
              Todas as NFs estão escondidas pelo filtro de SKU.
            </p>
          ) : visibleOrders.map(order => {
            const isActive = order.id === activeOrderId;
            const pct = order.items_total > 0 ? Math.round((order.items_scanned / order.items_total) * 100) : 0;
            const dotColor = order.is_inactive ? 'bg-red-500/60'
              : order.status === 'completed' ? 'bg-green-400'
              : order.status === 'scanning' ? 'bg-blue-400'
              : order.status === 'interrupted' ? 'bg-orange-400'
              : 'bg-gray-600';

            if (order.is_inactive) {
              return (
                <div key={order.id}
                  className="p-2.5 rounded-lg mb-1 border border-bad/10 bg-red-500/5 opacity-60">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                    <p className="text-[10px] font-mono text-t3 truncate flex-1">NF {order.nf_number}</p>
                    <span className="text-[9px] font-semibold text-bad/70">inativa</span>
                  </div>
                  {order.seller && (
                    <p className="text-[9px] font-medium pl-4 truncate" style={{ color: 'rgb(var(--brand))' }}>{order.seller}</p>
                  )}
                  <p className="text-xs text-t2 truncate pl-4">{order.customer_name}</p>
                  <button
                    onClick={() => handleReactivateOrder(order.id)}
                    disabled={reactivatingId === order.id}
                    className="mt-1.5 ml-4 flex items-center gap-1 text-[9px] font-semibold text-ok hover:text-ok disabled:opacity-40"
                  >
                    <RotateCcw size={10} /> {reactivatingId === order.id ? 'Reativando...' : 'Reativar'}
                  </button>
                </div>
              );
            }

            const isAuditable = order.status === 'completed' || order.status === 'interrupted';
            const adminClick = !isAdmin ? undefined : isAuditable
              ? () => setAuditOrder(order)
              : () => handleNfeScan(order.nf_number);

            return (
              <div key={order.id}
                onClick={adminClick}
                className={`group p-2.5 rounded-lg mb-1 border transition ${isActive ? 'bg-violet-600/15 border-ok/30' : 'border-transparent hover:bg-surface-2'} ${isAdmin ? 'cursor-pointer hover:border-violet-500/30' : ''}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                  <p className="text-[10px] font-mono text-t3 truncate flex-1">NF {order.nf_number}</p>
                  <span className="text-[9px] text-t4">{pct}%</span>
                  {isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeactivateTarget(order); setDeactivateReason(''); }}
                      title="Inativar NF"
                      className="opacity-0 group-hover:opacity-100 text-t5 hover:text-bad transition"
                    >
                      <Ban size={11} />
                    </button>
                  )}
                </div>
                {order.seller && (
                  <p className="text-[9px] font-medium pl-4 truncate" style={{ color: 'rgb(var(--brand))' }}>{order.seller}</p>
                )}
                <p className="text-xs text-t2 truncate pl-4">{order.customer_name}</p>
                {/* Só na SAÍDA: na entrada a transportadora deixou de bloquear
                    (24/08/2026), então o aviso apontaria um impedimento que não
                    existe — e o operador iria atrás de resolver algo à toa. */}
                {!order.carrier && order.status !== 'completed' && order.file_type !== 'entrada' && (
                  <p className="text-[9px] font-semibold text-warn pl-4 mt-0.5">🚚 sem transportadora</p>
                )}
                {order.is_paused && (
                  <p className="text-[9px] font-semibold text-info pl-4 mt-0.5">⏸ conferência pausada</p>
                )}
                <div className="w-full bg-surface-2 rounded-full h-0.5 mt-1.5 ml-4">
                  <div className={`h-0.5 rounded-full ${order.status === 'completed' ? 'bg-green-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="p-3 border-t border-line-soft">
          <button
            onClick={() => {
              if (isBipandoView) {
                setShowExitDialog(true);
              } else if (isAuditView) {
                setAuditOrder(null);
              } else {
                if (sessionId) sessionStorage.removeItem(hiddenSkusKey);
                setHiddenSkus([]);
                navigate('/manuseios');
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-t1 bg-red-600/20 hover:bg-red-600/40 border border-bad/30 hover:border-bad/60 rounded-lg transition">
            <LogOut size={15} /> {isAuditView ? 'Fechar consulta' : 'Sair da Bipagem'}
          </button>
        </div>
      </aside>

      {/* ── CENTER: scanning area ─────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Fixed header */}
        <div className="flex-shrink-0 p-5 border-b border-line-soft bg-surface/60 backdrop-blur">
          {displayOrder ? (
            <div>
              {isAuditView && (
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-warn">
                  🔒 Consulta somente leitura — {displayOrder.status === 'interrupted' ? 'NF interrompida' : 'NF concluída'}, nada aqui altera o pedido ou o estoque
                </div>
              )}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-t4">NF {displayOrder.nf_number}</span>
                    {displayOrder.carrier && (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
                        style={{ background: 'rgba(61,217,164,0.15)', color: 'rgb(var(--ok))', border: '1px solid rgba(61,217,164,0.30)' }}
                      >
                        🚚 {displayOrder.carrier}
                      </span>
                    )}
                    {/* Caixa usada — só em SAÍDA (ver showBoxBadge). Não existe em modo consulta.
                        Padronizado: só botões da lista canônica, sem escrita manual. */}
                    {!isAuditView && showBoxBadge && (
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <span
                          className={
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold'
                            + (awaitingBox ? ' animate-pulse' : '')
                          }
                          style={
                            awaitingBox
                              ? { background: 'rgba(239,68,68,0.22)', color: 'rgb(var(--bad))', border: '1px solid rgba(239,68,68,0.55)' }
                              : (boxUsed || boxSuggested)
                                ? { background: 'rgba(123,99,232,0.18)', color: 'rgb(var(--brand))', border: '1px solid rgba(123,99,232,0.35)' }
                                : { background: 'rgba(239,68,68,0.15)', color: 'rgb(var(--bad))', border: '1px solid rgba(239,68,68,0.35)' }
                          }
                          title={awaitingBox
                            ? 'Caixa obrigatória — todos os itens já foram bipados, falta escolher a caixa para concluir a NF'
                            : 'Caixa sugerida pelo algoritmo — clique num botão para ajustar'}
                        >
                          📦 {boxUsed || boxSuggested || 'N.A'}
                        </span>
                        {CANONICAL_BOXES.map(n => (
                          <button
                            key={n}
                            onClick={() => handleBoxSave(n)}
                            disabled={boxSaving}
                            title={n === 'Própria' ? 'Seller usa caixa própria' : `Caixa ${n}`}
                            className={
                              'h-6 flex items-center justify-center text-[11px] font-bold rounded border transition '
                              + (n.length > 2 ? 'px-2 ' : 'w-6 ')
                              + (boxUsed === n
                                  ? 'border-violet-400 text-violet-200 bg-violet-500/20'
                                  : 'border-line-soft text-t3 hover:border-violet-400/50 hover:text-violet-300')
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                  {displayOrder.seller && (
                    <p className="text-sm font-semibold mb-0.5" style={{ color: 'rgb(var(--brand))' }}>{displayOrder.seller}</p>
                  )}
                  <h2 className="text-2xl font-black text-t1">{displayOrder.customer_name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {displayOrder.seller_id && (
                    <button
                      onClick={() => window.open(
                        `${(import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'}/cadastros/sellers/${displayOrder.seller_id}/experience-file`,
                        '_blank'
                      )}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition"
                      style={{ color: 'rgb(var(--brand))', borderColor: 'rgba(123,99,232,0.30)', background: 'rgba(123,99,232,0.10)' }}
                      title="Ver roteiro de experiência deste seller"
                    >
                      ✨ Experiência
                    </button>
                  )}
                  {isAuditView ? (
                    <button onClick={() => setAuditOrder(null)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-t3 border border-line hover:border-line-soft rounded-lg transition">
                      <X size={12} /> Fechar consulta
                    </button>
                  ) : (
                    <>
                      {/* Finalizar só existe na ENTRADA: é ele que dispara a
                          conferência e faz o estoque entrar pela contagem.
                          Fica sempre habilitado — a carga pode ter vindo
                          faltando muito e o operador precisa poder encerrar. */}
                      {isEntradaOrder && scanPhase === 'product' && (
                        <button
                          onClick={handleOpenEntryConference}
                          disabled={finalizingEntry}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ok border border-ok/40 hover:border-ok bg-ok-soft rounded-lg transition disabled:opacity-50"
                          title="Conferir o que foi contado e lançar no estoque"
                        >
                          <CheckCircle size={12} /> {finalizingEntry ? 'Conferindo...' : 'Finalizar'}
                        </button>
                      )}
                      <button onClick={() => setShowInterruptDialog(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-warn border border-warn/25 hover:border-warn/50 rounded-lg transition">
                        <Pause size={12} /> {isEntradaOrder ? 'Pausar' : 'Interromper'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {/* Progress */}
              <div className="flex justify-between text-xs text-t4 mb-1">
                <span>{displayOrder.items_scanned} bipados</span>
                <span>{displayOrder.items_total} total</span>
              </div>
              <div className="w-full bg-surface-2 rounded-full h-2">
                {/* Clamp em 100%: na entrada o bipado pode passar do previsto
                    (excedente) e a barra vazaria do container. Os números reais
                    continuam visíveis acima ("1200 bipados / 1000 total"). */}
                <div className={`h-2 rounded-full transition-all ${displayOrder.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                  style={{ width: displayOrder.items_total > 0 ? `${Math.min(100, Math.round(displayOrder.items_scanned / displayOrder.items_total * 100))}%` : '0%' }} />
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-black text-t3 mb-1">
                {scanPhase === 'nfe' && activeOrder?.status === 'completed'
                  ? '✅ Pedido concluído!'
                  : 'Aguardando pedido...'}
              </h2>
              <p className="text-sm text-t4">
                {scanPhase === 'nfe'
                  ? 'Escaneie a etiqueta física da NFe para abrir o próximo pedido'
                  : 'Finalize o pedido atual antes de abrir outro'}
              </p>
            </div>
          )}

          {/* Feedback panel + input de bipagem — não fazem sentido em modo consulta */}
          {!isAuditView && (
            <>
              <div className={`flex items-center gap-3 p-3 rounded-xl border mt-3 transition-all min-h-[56px] ${feedbackBg[feedback.state]}`}>
                {feedbackIcon[feedback.state]}
                <div className="flex-1 min-w-0">
                  {feedback.state !== 'idle' ? (
                    <>
                      <p className={`font-bold text-sm ${feedbackTextColor[feedback.state]}`}>{feedback.title}</p>
                      <p className="text-xs text-t3 mt-0.5">{feedback.message}</p>
                    </>
                  ) : (
                    <p className="text-sm text-t5">
                      {scanPhase === 'nfe' ? 'Aguardando scan da NFe...' : 'Aguardando scan do produto...'}
                    </p>
                  )}
                </div>
                {feedback.photoUrl && (
                  <img src={photoSrc(feedback.photoUrl)!} alt="Produto"
                    className="w-14 h-14 object-cover rounded-lg border border-line flex-shrink-0" />
                )}
              </div>

              {/* Barcode input */}
              <div className="flex gap-2 mt-3">
                {/* Quantidade — só na ENTRADA. Digita a quantidade da caixa e bipa
                    uma vez, em vez de bipar 1.000 peças iguais uma a uma. */}
                {showQtyField && (
                  <div className="relative w-32 flex-shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ok/70 pointer-events-none">
                      QTD
                    </span>
                    <input
                      ref={qtyRef}
                      type="number"
                      min={1}
                      max={MAX_SCAN_QTY}
                      step={1}
                      value={qtyInput}
                      onChange={e => setQtyInput(e.target.value)}
                      onKeyDown={handleQtyKeyDown}
                      onFocus={e => e.target.select()}
                      disabled={scanning}
                      title="Quantidade deste bipe. Enter volta para o código de barras."
                      className="w-full bg-emerald-500/10 border border-ok/30 rounded-xl pl-11 pr-3 py-3 text-base font-bold text-right text-t1 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-ok transition disabled:opacity-40"
                      autoComplete="off"
                    />
                  </div>
                )}
                <div className="flex-1 relative">
                  {scanPhase === 'nfe'
                    ? <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-warn/60" />
                    : <ScanLine size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${scanning ? 'text-ok animate-pulse' : 'text-t4'}`} />
                  }
                  <input
                    ref={inputRef}
                    type="text"
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleScanInputBlur}
                    disabled={scanning}
                    placeholder={
                      scanPhase === 'nfe'
                        ? 'Escaneie a chave da NFe (etiqueta física)...'
                        : activeOrder?.status === 'completed'
                        ? 'Pedido concluído — escaneie a próxima NFe'
                        : 'Escaneie o código de barras do produto...'
                    }
                    className="w-full bg-surface-2 border border-line rounded-xl pl-9 pr-4 py-3 text-base text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition disabled:opacity-40"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => handleScan(barcodeInput)}
                  disabled={scanning || !barcodeInput.trim()}
                  className="px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold rounded-xl transition flex items-center gap-2"
                >
                  {scanning
                    ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <ScanLine size={16} />}
                  {scanPhase === 'nfe' ? 'Abrir' : 'Bipar'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Scrollable items area */}
        <div className="flex-1 overflow-y-auto p-5">
          {displayOrder ? (
            <>
              {/* B: ordena — pendentes primeiro (in-progress antes de untouched), concluídos no fim */}
              {(() => {
                const sorted = [...displayOrder.items].sort((a, b) => {
                  const aDone = a.scanned >= a.quantity;
                  const bDone = b.scanned >= b.quantity;
                  if (aDone !== bDone) return aDone ? 1 : -1;
                  // ambos pendentes: in-progress (scanned > 0) antes de não iniciados
                  if ((a.scanned > 0) !== (b.scanned > 0)) return a.scanned > 0 ? -1 : 1;
                  return 0;
                });
                // índice do primeiro item ainda não concluído
                const firstPendingIdx = sorted.findIndex(it => it.scanned < it.quantity);
                const pendingCount = sorted.filter(it => it.scanned < it.quantity).length;

                return (
                  <>
                    <h3 className="text-[11px] font-semibold text-t4 uppercase tracking-widest mb-3">
                      Itens do Pedido ({displayOrder.items.length})
                      {pendingCount > 0 && (
                        <span className="ml-2 text-violet-400">{pendingCount} restante{pendingCount > 1 ? 's' : ''}</span>
                      )}
                    </h3>
                    {/* Grid 4 colunas:
                        • em curso (isFirst): col-span-2 (50%) — destaque violeta, posição 1
                        • não finalizado:     col-span-2 (50%)
                        • finalizado:         col-span-1 (25%) — compacto, ao final */}
                    <div className="grid grid-cols-4 gap-3">
                      {sorted.map((item, idx) => {
                        const isDone = item.scanned >= item.quantity;
                        const isFirst = idx === firstPendingIdx && !isDone;
                        // done → 25% (col-span-1), demais → 50% (col-span-2)
                        const colSpan = isDone ? 'col-span-1' : 'col-span-2';
                        return (
                          <div key={item.sku} className={colSpan}>
                            <ItemCard
                              item={item}
                              isLast={item.sku === lastScannedSku}
                              isFlashing={item.sku === flashedSku}
                              isFirst={isFirst}
                              isSmall={isDone}
                              onRightClick={(e) => handleItemRightClick(e, item)}
                              onImageClick={(url) => setLightboxUrl(url)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <KeyRound size={48} className="text-t5 mx-auto mb-3" />
                <p className="text-t5 text-sm font-medium">Escaneie a etiqueta NFe para começar</p>
                <p className="text-t5 text-xs mt-1">O código está na etiqueta física do pedido</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT: log ──────────────────────────────────── */}
      <aside className="w-56 bg-surface border-l border-line-soft flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-line-soft flex items-center gap-2">
          <ClipboardList size={14} className="text-t4" />
          <p className="text-xs font-semibold text-t4 uppercase tracking-widest">Log</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {(scanLogs as ScanLog[]).length === 0 ? (
            <p className="text-[10px] text-t5 text-center mt-6 px-2">Nenhuma bipagem ainda nesta sessão.</p>
          ) : (
            (scanLogs as ScanLog[]).map(log => (
              <div key={log.id}
                className={`mb-1.5 p-2 rounded-lg border text-[10px] ${log.is_error ? 'bg-bad-soft border-bad/20' : 'bg-ok-soft border-ok/15'}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`font-mono font-bold ${log.is_error ? 'text-bad' : 'text-ok'}`}>
                    {log.is_error ? '✗' : '✓'} {log.sku}
                  </span>
                  <span className="text-t4">{log.timestamp}</span>
                </div>
                <p className="text-t4 truncate">NF {log.order_nf}</p>
                {log.is_error && log.error_message && (
                  <p className="text-bad/60 truncate text-[9px] mt-0.5">{log.error_message}</p>
                )}
                <p className="text-t5">{log.operator_name}</p>
              </div>
            ))
          )}
        </div>
        {/* Operator info */}
        <div className="p-3 border-t border-line-soft flex-shrink-0">
          <p className="text-[10px] text-t4 font-medium truncate">{user?.name}</p>
          <p className="text-[10px] text-t5 capitalize">{user?.role}</p>
        </div>
      </aside>

      {/* ── Interrupt dialog ─────────────────────────────── */}
      {showInterruptDialog && activeOrder && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-warn/30 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Pause size={20} className="text-warn" />
              </div>
              <div>
                <h3 className="text-base font-bold text-t1">
                  {isEntradaOrder ? 'Pausar Conferência' : 'Interromper Pedido'}
                </h3>
                <p className="text-xs text-t4">NF {activeOrder.nf_number} · {activeOrder.customer_name}</p>
              </div>
            </div>
            <p className="text-sm text-t3 mb-3">
              {isEntradaOrder
                ? 'A contagem fica salva e a NF continua EM ABERTO — é só bipar a chave dela de novo para continuar de onde parou. O estoque só entra quando você Finalizar. Informe o motivo (opcional):'
                : 'O pedido ficará como "interrompido". Informe o motivo:'}
            </p>
            <textarea
              value={interruptReason}
              onChange={e => setInterruptReason(e.target.value)}
              placeholder={isEntradaOrder
                ? 'Ex: continua amanhã, faltou espaço na bancada...'
                : 'Ex: produto danificado, falta de estoque, cliente solicitou...'}
              rows={3}
              className="w-full bg-surface-2 border border-line rounded-xl px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowInterruptDialog(false); setInterruptReason(''); }}
                className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleInterrupt}
                className="flex-1 py-2.5 text-sm font-semibold text-warn border border-warn/40 rounded-xl hover:bg-orange-500/10 transition"
              >
                {isEntradaOrder ? 'Pausar' : 'Interromper'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conferência final da ENTRADA (24/08/2026) ─────────
          Passo 1 de 2: nada foi gravado ainda. Fechar aqui devolve o operador
          à bipagem exatamente de onde parou. Só o botão de confirmar lança o
          estoque — pela quantidade CONTADA, não pela da NF. */}
      {entryConference && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
            <div className="p-6 pb-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-ok-soft rounded-full flex items-center justify-center flex-shrink-0">
                  <ClipboardList size={20} className="text-ok" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-t1">Conferência de Entrada</h3>
                  <p className="text-xs text-t4">
                    NF {entryConference.nf_number} · {entryConference.total_counted} contados de {entryConference.total_expected} previstos
                  </p>
                </div>
              </div>
              {entryConference.divergent_count > 0 ? (
                <p className="mt-3 text-sm text-warn bg-orange-500/10 border border-warn/25 rounded-xl px-3 py-2">
                  ⚠️ {entryConference.divergent_count} SKU com quantidade diferente da NF.
                  Ao confirmar, o estoque entra pelo que foi <strong>contado</strong> e cada
                  divergência fica registrada com observação no relatório de Estoque.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ok bg-ok-soft border border-ok/25 rounded-xl px-3 py-2">
                  ✅ Tudo bateu com a NF. Ao confirmar, o estoque entra e a NF é concluída.
                </p>
              )}
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-3">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-t4 text-xs border-b border-line">
                    <th className="text-left font-medium py-2">SKU / Produto</th>
                    <th className="text-right font-medium py-2 w-24">NF</th>
                    <th className="text-right font-medium py-2 w-24">Contado</th>
                    <th className="text-right font-medium py-2 w-28">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {(entryConference.lines ?? []).map(ln => {
                    const ok = ln.status === 'ok';
                    return (
                      <tr
                        key={ln.sku}
                        className={`border-b border-line/50 ${ok ? '' : 'bg-orange-500/10'}`}
                      >
                        <td className="py-2 pr-2">
                          <div className={`font-mono text-xs ${ok ? 'text-t2' : 'text-warn font-semibold'}`}>{ln.sku}</div>
                          <div className="text-xs text-t4 truncate max-w-md">{ln.product_name}</div>
                        </td>
                        <td className="text-right py-2 text-t3">{ln.expected}</td>
                        <td className={`text-right py-2 font-semibold ${ok ? 'text-t2' : 'text-warn'}`}>{ln.counted}</td>
                        <td className="text-right py-2">
                          {ok ? (
                            <span className="text-ok text-xs">OK</span>
                          ) : (
                            <span className="text-warn font-semibold">
                              {ln.diff > 0 ? `+${ln.diff}` : ln.diff}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-6 pt-4 border-t border-line flex gap-2">
              <button
                onClick={() => { setEntryConference(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                disabled={finalizingEntry}
                className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition disabled:opacity-50"
              >
                Voltar e continuar contando
              </button>
              <button
                onClick={handleConfirmEntryFinalize}
                disabled={finalizingEntry}
                className="flex-1 py-2.5 text-sm font-semibold text-ok border border-ok/40 bg-ok-soft rounded-xl hover:bg-green-500/15 transition disabled:opacity-50"
              >
                {finalizingEntry ? 'Lançando...' : 'Confirmar e lançar no estoque'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inativar NF dialog (admin) ──────────────────────── */}
      {deactivateTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-bad/30 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Ban size={20} className="text-bad" />
              </div>
              <div>
                <h3 className="text-base font-bold text-t1">Inativar NF</h3>
                <p className="text-xs text-t4">NF {deactivateTarget.nf_number} · {deactivateTarget.customer_name}</p>
              </div>
            </div>
            <p className="text-sm text-t3 mb-3">
              A NF some da operação (Pedidos, Manuseios, Dashboard) e só volta se você mesmo reativar. Informe o motivo:
            </p>
            <textarea
              value={deactivateReason}
              onChange={e => setDeactivateReason(e.target.value)}
              placeholder="Ex: NF errada, duplicidade, pedido cancelado pelo cliente..."
              rows={3}
              autoFocus
              className="w-full bg-surface-2 border border-line rounded-xl px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setDeactivateTarget(null); setDeactivateReason(''); }}
                disabled={deactivating}
                className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeactivateOrder}
                disabled={deactivating || !deactivateReason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-bad border border-bad/40 rounded-xl hover:bg-red-500/10 transition disabled:opacity-40"
              >
                {deactivating ? 'Inativando...' : 'Inativar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exit confirmation dialog ─────────────────────── */}
      {showExitDialog && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-bad/30 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <LogOut size={20} className="text-bad" />
              </div>
              <div>
                <h3 className="text-base font-bold text-t1">Sair da Bipagem</h3>
                {activeOrder && (
                  <p className="text-xs text-t4">NF {activeOrder.nf_number} está em aberto</p>
                )}
              </div>
            </div>
            <p className="text-sm text-t3 mb-3">
              {isEntradaOrder ? (
                <>Há uma conferência em andamento. Ao sair, ela será <span className="text-warn font-semibold">pausada</span> — a contagem fica salva e a NF continua em aberto. Informe o motivo:</>
              ) : (
                <>Há um pedido em andamento. Ao sair, ele será marcado como <span className="text-warn font-semibold">interrompido</span>. Informe o motivo:</>
              )}
            </p>
            <textarea
              value={exitReason}
              onChange={e => setExitReason(e.target.value)}
              placeholder="Ex: fim de turno, problema operacional, retorno depois..."
              rows={3}
              className="w-full bg-surface-2 border border-line rounded-xl px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-red-500 resize-none"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowExitDialog(false); setExitReason(''); inputRef.current?.focus(); }}
                className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmExit}
                className="flex-1 py-2.5 text-sm font-semibold text-bad border border-bad/40 rounded-xl hover:bg-red-500/10 transition"
              >
                {isEntradaOrder ? 'Pausar e Sair' : 'Interromper e Sair'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de produto inline (right-click) ─────────── */}
      {productModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-t1">
                  {productModal.mode === 'create'
                    ? 'Cadastrar Produto'
                    : productModal.item.barcode_seller
                    ? 'Detalhes do Produto'
                    : 'Atualizar Código de Barras'}
                </h3>
                <p className="text-xs text-t4 mt-0.5">{productModal.seller_name}</p>
              </div>
              <button onClick={() => { setProductModal(null); setTimeout(() => inputRef.current?.focus(), 50); }} className="text-t4 hover:text-t2">✕</button>
            </div>

            <div className="space-y-3">
              {/* SKU — read-only */}
              <div>
                <label className="block text-xs text-t4 mb-1">SKU</label>
                <p className="text-sm font-mono text-t2 bg-surface-2 rounded-lg px-3 py-2">
                  {productModal.item.sku}
                </p>
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs text-t4 mb-1">Nome</label>
                <input
                  value={productForm.name}
                  onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-violet-500"
                  readOnly={productModal.mode === 'view' && !!productModal.item.barcode_seller && !!productModal.product_id}
                />
              </div>

              {/* Cód. Barras Seller */}
              <div>
                <label className="block text-xs text-t4 mb-1">
                  Cód. Barras {productModal.mode === 'create' && <span className="text-bad">*</span>}
                </label>
                <input
                  value={productForm.barcode_seller}
                  onChange={e => setProductForm(f => ({ ...f, barcode_seller: e.target.value }))}
                  placeholder="Ex: 7898996051716"
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 font-mono placeholder-t5 outline-none focus:ring-2 focus:ring-violet-500"
                  autoFocus
                />
              </div>

              {/* Caixa */}
              <div>
                <label className="block text-xs text-t4 mb-1">Tipo de Caixa</label>
                <input
                  value={productForm.box_type}
                  onChange={e => setProductForm(f => ({ ...f, box_type: e.target.value }))}
                  placeholder="Ex: Caixa1"
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setProductModal(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProductInline}
                disabled={savingProduct}
                className="flex-1 py-2.5 text-sm font-semibold text-t1 bg-violet-600 hover:bg-violet-500 rounded-xl transition disabled:opacity-50"
              >
                {savingProduct ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── C: Lightbox de imagem ────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] flex items-center justify-center"
               onClick={e => e.stopPropagation()}>
            <img
              src={lightboxUrl}
              alt="Produto ampliado"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl bg-surface-2 border border-line-soft"
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-3 -right-3 w-9 h-9 bg-surface-2 border border-line-strong rounded-full flex items-center justify-center text-t2 hover:text-t1 hover:bg-line-strong transition shadow-xl"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Context menu (right-click no item) ──────────── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-2 border border-line rounded-xl shadow-2xl py-1 min-w-[220px]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 120) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-line mb-1">
            <p className="text-xs font-mono text-t4 truncate">{contextMenu.item.sku}</p>
            <p className="text-xs text-t2 font-medium truncate">{contextMenu.item.product_name}</p>
          </div>
          {contextMenu.item.product_id === null ? (
            <button
              className="w-full text-left px-4 py-2.5 text-sm text-t1 hover:bg-surface-2 flex items-center gap-2.5 transition"
              onClick={() => {
                setProductModal({
                  mode: 'create',
                  item: contextMenu.item,
                  seller_id: activeOrder?.seller_id ?? null,
                  seller_name: activeOrder?.seller ?? '',
                  product_id: null,
                });
                setProductForm({
                  name: contextMenu.item.product_name,
                  barcode_seller: '',
                  box_type: '',
                  unit_value: 0,
                });
                setContextMenu(null);
              }}
            >
              <Plus size={14} className="text-ok flex-shrink-0" />
              <span>Cadastrar produto</span>
            </button>
          ) : (
            <button
              className="w-full text-left px-4 py-2.5 text-sm text-t1 hover:bg-surface-2 flex items-center gap-2.5 transition"
              onClick={() => {
                setProductModal({
                  mode: 'view',
                  item: contextMenu.item,
                  seller_id: activeOrder?.seller_id ?? null,
                  seller_name: activeOrder?.seller ?? '',
                  product_id: contextMenu.item.product_id ?? null,
                });
                setProductForm({
                  name: contextMenu.item.product_name,
                  barcode_seller: contextMenu.item.barcode_seller ?? '',
                  box_type: '',
                  unit_value: 0,
                });
                setContextMenu(null);
              }}
            >
              <Package size={14} className="text-info flex-shrink-0" />
              <span>Ver detalhes do produto</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
