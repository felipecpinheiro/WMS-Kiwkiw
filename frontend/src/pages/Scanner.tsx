/**
 * WMS Kiwkiw - Interface de Bipagem (Scanner) v2
 * Fluxo: Scan NFe → Abre pedido → Scan produtos
 * Design visual, robusto e à prova de erros.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import {
  CheckCircle, XCircle, AlertTriangle, ScanLine, Package,
  LogOut, Pause, KeyRound, ClipboardList, Plus, ZoomIn, X,
} from 'lucide-react';
import { scanningApi, cadastrosApi } from '../api';
import toast from 'react-hot-toast';

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
  items_total: number;
  items_scanned: number;
  items: SessionOrderItem[];
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

  // Altura da imagem: compacta para concluídos, normal para demais
  const imgH = isSmall ? 'h-16' : 'h-36';
  const iconSize = isSmall ? 16 : 26;

  // Estilo do card
  let cardClass = 'bg-gray-900/80 border-gray-700/50';
  if (isFlashing)      cardClass = 'bg-green-800/60 border-green-400 ring-2 ring-green-400/70 scale-[1.02]';
  else if (done)       cardClass = 'bg-green-900/20 border-green-500/20 opacity-50';
  else if (isFirst)    cardClass = 'bg-violet-900/30 border-violet-400/60 ring-2 ring-violet-400/25 shadow-lg shadow-violet-900/20';
  else if (inProgress) cardClass = 'bg-blue-900/40 border-blue-500/50';

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
            className={`w-full ${imgH} object-contain rounded-lg mb-2 opacity-95`}
            style={{ background: 'rgba(255,255,255,0.04)' }}
          />
          {onImageClick && (
            <button
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-lg"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onImageClick(src); }}
              title="Ampliar imagem"
            >
              <ZoomIn size={20} className="text-white drop-shadow" />
            </button>
          )}
        </div>
      ) : (
        <div className={`w-full ${imgH} bg-white/5 rounded-lg flex items-center justify-center mb-2`}>
          <Package size={iconSize} className="text-white/15" />
        </div>
      )}

      {/* Badge SEM CADASTRO */}
      {!item.barcode_seller && !isSmall && (
        <div className="absolute top-2 left-2 bg-yellow-500/20 border border-yellow-400/30 text-yellow-300 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
          SEM CADASTRO
        </div>
      )}

      {/* Badge EM CURSO — primeiro item pendente */}
      {isFirst && !done && (
        <div className="absolute top-2 right-2 bg-violet-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold tracking-wide">
          EM CURSO
        </div>
      )}

      {/* SKU e barcode — só em cards normais */}
      {!isSmall && (
        <>
          <p className="text-xs font-mono text-white/40 mb-0.5 truncate">{item.sku}</p>
          {item.barcode_seller && (
            <p className="text-sm font-mono font-semibold text-yellow-300/80 mb-1 truncate" title="Cód. barras">
              ⬛ {item.barcode_seller}
            </p>
          )}
        </>
      )}

      <p className={`${isSmall ? 'text-[10px]' : 'text-sm'} font-bold text-white leading-snug mb-2 ${isSmall ? 'line-clamp-1' : 'line-clamp-2'}`}>
        {item.product_name}
      </p>

      <div className="flex items-center justify-between">
        <span className={`${isSmall ? 'text-lg' : 'text-2xl'} font-black ${done ? 'text-green-400' : inProgress ? 'text-blue-300' : 'text-white/40'}`}>
          {item.scanned}
          <span className={`${isSmall ? 'text-sm' : 'text-base'} text-white/30`}>/{item.quantity}</span>
        </span>
        {done && <CheckCircle size={isSmall ? 14 : 18} className="text-green-400" />}
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

  // ── 1b: Restaura NF ativa do sessionStorage ao dar refresh ──
  const storedOrderId = sessionStorage.getItem(`scanner_${sessionId}_activeOrder`);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(
    storedOrderId ? Number(storedOrderId) : null
  );
  const [localOrders, setLocalOrders] = useState<SessionOrder[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle', title: '', message: '' });
  const [lastScannedSku, setLastScannedSku] = useState<string | undefined>();
  const [flashedSku, setFlashedSku] = useState<string | undefined>(); // 1a: flash visual
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);
  const [interruptReason, setInterruptReason] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false); // 1b: confirmar saída
  const [exitReason, setExitReason] = useState('');
  // ── Caixa sugerida ────────────────────────────────────────
  const [boxSuggested, setBoxSuggested]   = useState<string | null>(null);
  const [boxUsed, setBoxUsed]             = useState<string | null>(null);
  const [boxEditing, setBoxEditing]       = useState(false);
  const [boxEditVal, setBoxEditVal]       = useState('');
  const [boxSaving, setBoxSaving]         = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; item: SessionOrderItem;
  } | null>(null);
  const [productModal, setProductModal] = useState<ProductModalState | null>(null);
  const [productForm, setProductForm] = useState({ name: '', barcode_seller: '', box_type: '', unit_value: 0 });
  const [savingProduct, setSavingProduct] = useState(false);
  // C: lightbox de imagem
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Fetch orders
  const { data: ordersRaw = [], isLoading, isError, error } = useQuery(
    ['session-orders', sessionId, sellerId],
    async () => {
      const r = await scanningApi.sessionOrders(Number(sessionId), sellerId);
      const raw = Array.isArray(r.data) ? r.data : (r.data?.orders ?? []);
      return (raw as any[]).map((o): SessionOrder => ({
        id: o.id,
        nf_number: o.nf_number,
        customer_name: o.customer_name,
        seller: o.seller ?? null,
        seller_id: o.seller_id ?? null,
        carrier: o.carrier ?? '',
        status: o.status,
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
    { refetchInterval: 15000, enabled: !!sessionId },
  );

  // Sync remote → local (only when not actively scanning)
  useEffect(() => {
    if (!scanning && ordersRaw.length > 0) {
      setLocalOrders(ordersRaw);
    }
  }, [ordersRaw, scanning]);

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

  // Auto-focus input
  useEffect(() => { inputRef.current?.focus(); }, [activeOrderId]);

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
    if (!activeOrderId) { setBoxSuggested(null); setBoxUsed(null); setBoxEditing(false); return; }
    scanningApi.suggestedBox(activeOrderId).then(r => {
      setBoxSuggested(r.data.suggested);
      setBoxUsed(r.data.box_used);
    }).catch(() => {});
  }, [activeOrderId]);

  const handleBoxSave = async (val: string) => {
    if (!activeOrderId) return;
    setBoxSaving(true);
    try {
      const v = val.trim() || null;
      await scanningApi.saveOrderBox(activeOrderId, v);
      setBoxUsed(v);
      setBoxEditing(false);
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
    { refetchInterval: 5000 },
  );

  const activeOrder = localOrders.find(o => o.id === activeOrderId) ?? null;
  // scanPhase = 'product' só se o pedido existe E não está concluído
  // (activeOrder null → stale ID, trata como 'nfe' para não travar a tela)
  const scanPhase: 'nfe' | 'product' =
    (activeOrderId === null || !activeOrder || activeOrder.status === 'completed') ? 'nfe' : 'product';

  const totalOrders = localOrders.length;
  const doneOrders = localOrders.filter(o => o.status === 'completed').length;
  const sessionPct = totalOrders > 0 ? Math.round((doneOrders / totalOrders) * 100) : 0;

  // ── NFe scan: open order ───────────────────────────────

  const handleNfeScan = useCallback(async (nfeKey: string) => {
    if (!nfeKey.trim() || scanning) return;
    setScanning(true);
    try {
      const res = await (scanningApi as any).openByNfe(Number(sessionId), nfeKey.trim());
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
        setActiveOrderId(data.order_id);
        qc.invalidateQueries(['session-orders', sessionId, sellerId]);
        setFeedback({ state: 'success', title: `✓ Pedido aberto`, message: `NF ${data.nf_number} — ${data.customer_name ?? ''}` });
        // Update local order status to scanning
        setLocalOrders(prev => prev.map(o =>
          o.id === data.order_id && o.status === 'pending'
            ? { ...o, status: 'scanning' } : o
        ));
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
  }, [scanning, sessionId, localOrders]);

  // ── Product scan ────────────────────────────────────────

  const handleProductScan = useCallback(async (barcode: string) => {
    if (!activeOrder || scanning || !barcode.trim()) return;
    if (activeOrder.status === 'completed') {
      setFeedback({ state: 'warning', title: 'Pedido concluído', message: 'Escaneie a próxima NFe para abrir o próximo pedido' });
      return;
    }

    setScanning(true);
    try {
      const res = await scanningApi.scan({
        session_id: Number(sessionId),
        order_id: activeOrder.id,
        barcode,
        operator_id: user.id,
      });
      const data = res.data;

      if (data.success) {
        setLastScannedSku(data.sku ?? undefined);

        // 1a: Flash visual no card do item bipado (anel verde por 800ms)
        if (data.sku) {
          setFlashedSku(data.sku);
          setTimeout(() => setFlashedSku(undefined), 800);
        }

        // Optimistic update: increment scanned for this item
        setLocalOrders(prev => prev.map(o => {
          if (o.id !== activeOrder.id) return o;
          const newItems = o.items.map(it => {
            if (it.sku === data.sku && it.scanned < it.quantity) {
              return { ...it, scanned: it.scanned + 1 };
            }
            return it;
          });
          const newScanned = newItems.reduce((acc, it) => acc + Math.min(it.scanned, it.quantity), 0);
          return {
            ...o,
            items: newItems,
            items_scanned: newScanned,
            status: data.status === 'order_complete' ? 'completed' : (o.status === 'pending' ? 'scanning' : o.status),
          };
        }));

        if (data.status === 'order_complete' || data.status === 'completed') {
          setFeedback({ state: 'success', title: '🎉 Pedido concluído!', message: `NF ${activeOrder.nf_number} finalizada. Escaneie a próxima NFe.` });
          setTimeout(() => setFeedback({ state: 'idle', title: '', message: '' }), 3000);
        } else {
          setFeedback({
            state: 'success',
            title: '✓ Bipagem registrada',
            message: `${data.product_name ?? data.sku} — ${data.items_remaining ?? '?'} restante(s)`,
            photoUrl: data.photo_url ?? undefined,
          });
        }

        // Refresh logs e session orders (garante consistência com servidor)
        qc.invalidateQueries(['scan-logs', sessionId]);
        qc.invalidateQueries(['session-orders', sessionId, sellerId]);
      } else {
        setFeedback({ state: 'error', title: '✗ Código inválido', message: data.message ?? 'Produto não pertence a este pedido' });
      }
    } catch (err: any) {
      setFeedback({ state: 'error', title: 'Erro', message: err.response?.data?.detail || 'Tente novamente' });
    } finally {
      setScanning(false);
      setBarcodeInput('');
      inputRef.current?.focus();
    }
  }, [activeOrder, scanning, sessionId, user.id, qc]);

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

  // ── Interrupt ────────────────────────────────────────────

  const handleInterrupt = async () => {
    if (!activeOrder) return;
    try {
      await scanningApi.interrupt({
        session_id: Number(sessionId),
        order_id: activeOrder.id,
        operator_id: user.id,
        reason: interruptReason || 'Sem motivo informado',
      });
      toast.success('Pedido interrompido');
      setActiveOrderId(null);
      setShowInterruptDialog(false);
      setInterruptReason('');
      setFeedback({ state: 'idle', title: '', message: '' });
      setLastScannedSku(undefined);
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
    } catch { toast.error('Erro ao interromper'); }
  };

  // ── Confirmar saída (com interrupção automática se NF aberta) ──
  const handleConfirmExit = async () => {
    if (activeOrder && scanPhase === 'product') {
      try {
        await scanningApi.interrupt({
          session_id: Number(sessionId),
          order_id: activeOrder.id,
          operator_id: user.id,
          reason: exitReason.trim() || 'Saída da bipagem pelo operador',
        });
        toast('Pedido interrompido. Saindo...', { icon: '⚠️' });
      } catch {
        toast.error('Erro ao interromper o pedido');
      }
    }
    // Limpa sessionStorage e navega para fora
    if (sessionId) sessionStorage.removeItem(`scanner_${sessionId}_activeOrder`);
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
        });
        toast.success('Código de barras atualizado!');
      }
      // Refresh dos pedidos para carregar o novo barcode_seller
      qc.invalidateQueries(['session-orders', sessionId, sellerId]);
      setProductModal(null);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao salvar produto');
    } finally {
      setSavingProduct(false);
    }
  };

  // ── Feedback styles ──────────────────────────────────────

  const feedbackBg: Record<FeedbackState, string> = {
    idle: 'border-white/10 bg-white/5',
    success: 'border-green-500/50 bg-green-900/30',
    error: 'border-red-500/50 bg-red-900/30',
    warning: 'border-yellow-500/50 bg-yellow-900/30',
  };

  const feedbackTextColor: Record<FeedbackState, string> = {
    idle: 'text-white/30',
    success: 'text-green-300',
    error: 'text-red-300',
    warning: 'text-yellow-300',
  };

  const feedbackIcon: Record<FeedbackState, React.ReactNode> = {
    idle: scanPhase === 'nfe'
      ? <KeyRound size={28} className="text-white/20" />
      : <ScanLine size={28} className="text-white/20" />,
    success: <CheckCircle size={28} className="text-green-400" />,
    error: <XCircle size={28} className="text-red-400" />,
    warning: <AlertTriangle size={28} className="text-yellow-400" />,
  };

  // ── Sem sessionId: redireciona para Manuseios ──────────────────────────────
  if (!sessionId) {
    navigate('/manuseios', { replace: true });
    return null;
  }


  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">

      {/* ── LEFT: order list ─────────────────────────── */}
      <aside className="w-60 bg-gray-900 border-r border-white/5 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <img src="/logo.svg" alt="Kiwkiw" className="w-7 h-7 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-white">Sessão #{sessionId}</p>
              <p className="text-[10px] text-white/40">Bipagem</p>
            </div>
          </div>
          {/* Sellers presentes na sessão */}
          {(() => {
            const uniqueSellers = Array.from(new Set(localOrders.map(o => o.seller).filter(Boolean)));
            return uniqueSellers.length > 0 ? (
              <p className="text-[9px] mt-1.5 font-medium truncate" style={{ color: '#9B87F0' }}>
                {uniqueSellers.join(' · ')}
              </p>
            ) : null;
          })()}
          {/* Seller filter banner */}
          {sellerId && localOrders.length > 0 && (() => {
            const sellerName = localOrders.find(o => o.seller_id === sellerId)?.seller;
            return sellerName ? (
              <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-semibold"
                style={{ background: 'rgba(123,99,232,0.15)', color: '#9B87F0', border: '1px solid rgba(123,99,232,0.25)' }}>
                <span>Filtrando:</span>
                <span className="truncate">{sellerName}</span>
              </div>
            ) : null;
          })()}
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-white/40 mb-1">
              <span>{doneOrders}/{totalOrders} pedidos</span>
              <span>{sessionPct}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <div className="bg-violet-500 h-1.5 rounded-full transition-all" style={{ width: `${sessionPct}%` }} />
            </div>
          </div>
        </div>

        {/* Order list — informativo apenas (não clicável para abrir) */}
        <div className="flex-1 overflow-y-auto p-2">
          <p className="text-[9px] text-white/25 uppercase tracking-widest px-2 mb-2">Pedidos da sessão</p>
          {isLoading ? (
            <p className="text-xs text-white/30 text-center py-4">Carregando...</p>
          ) : isError ? (
            <p className="text-xs text-red-400 text-center py-4 px-2">
              {(error as any)?.response?.data?.detail || 'Erro ao carregar'}
            </p>
          ) : localOrders.map(order => {
            const isActive = order.id === activeOrderId;
            const pct = order.items_total > 0 ? Math.round((order.items_scanned / order.items_total) * 100) : 0;
            const dotColor = order.status === 'completed' ? 'bg-green-400'
              : order.status === 'scanning' ? 'bg-blue-400'
              : order.status === 'interrupted' ? 'bg-orange-400'
              : 'bg-gray-600';

            return (
              <div key={order.id}
                className={`p-2.5 rounded-lg mb-1 border transition ${isActive ? 'bg-violet-600/15 border-green-500/30' : 'border-transparent hover:bg-white/3'}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                  <p className="text-[10px] font-mono text-white/50 truncate flex-1">NF {order.nf_number}</p>
                  <span className="text-[9px] text-white/30">{pct}%</span>
                </div>
                {order.seller && (
                  <p className="text-[9px] font-medium pl-4 truncate" style={{ color: '#9B87F0' }}>{order.seller}</p>
                )}
                <p className="text-xs text-white/70 truncate pl-4">{order.customer_name}</p>
                <div className="w-full bg-white/10 rounded-full h-0.5 mt-1.5 ml-4">
                  <div className={`h-0.5 rounded-full ${order.status === 'completed' ? 'bg-green-400' : 'bg-blue-400'}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="p-3 border-t border-white/5">
          <button
            onClick={() => {
              if (activeOrder && scanPhase === 'product') {
                setShowExitDialog(true);
              } else {
                navigate('/manuseios');
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 hover:border-red-500/60 rounded-lg transition">
            <LogOut size={15} /> Sair da Bipagem
          </button>
        </div>
      </aside>

      {/* ── CENTER: scanning area ─────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Fixed header */}
        <div className="flex-shrink-0 p-5 border-b border-white/5 bg-gray-900/60 backdrop-blur">
          {activeOrder && scanPhase === 'product' ? (
            <div>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-white/35">NF {activeOrder.nf_number}</span>
                    {activeOrder.carrier && (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
                        style={{ background: 'rgba(61,217,164,0.15)', color: '#3DD9A4', border: '1px solid rgba(61,217,164,0.30)' }}
                      >
                        🚚 {activeOrder.carrier}
                      </span>
                    )}
                    {/* Caixa sugerida */}
                    {boxEditing ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          autoFocus
                          value={boxEditVal}
                          onChange={e => setBoxEditVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleBoxSave(boxEditVal);
                            if (e.key === 'Escape') setBoxEditing(false);
                          }}
                          placeholder="Ex: c1"
                          className="w-20 bg-white/10 border border-violet-400/50 rounded px-2 py-0.5 text-xs text-white outline-none"
                        />
                        <button onClick={() => handleBoxSave(boxEditVal)} disabled={boxSaving}
                          className="text-[10px] text-violet-300 hover:text-violet-100 px-1">
                          {boxSaving ? '…' : '✓'}
                        </button>
                        <button onClick={() => setBoxEditing(false)} className="text-[10px] text-white/30 hover:text-white/60 px-1">✕</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setBoxEditVal(boxUsed || boxSuggested || ''); setBoxEditing(true); }}
                        title="Caixa sugerida pelo algoritmo — clique para ajustar"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold transition hover:opacity-80"
                        style={
                          (boxUsed || boxSuggested)
                            ? { background: 'rgba(123,99,232,0.18)', color: '#9B87F0', border: '1px solid rgba(123,99,232,0.35)' }
                            : { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }
                        }
                      >
                        📦 {boxUsed ? `${boxUsed} ✏` : boxSuggested ? boxSuggested : 'N.A'}
                      </button>
                    )}
                  </div>
                  {activeOrder.seller && (
                    <p className="text-sm font-semibold mb-0.5" style={{ color: '#9B87F0' }}>{activeOrder.seller}</p>
                  )}
                  <h2 className="text-2xl font-black text-white">{activeOrder.customer_name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {activeOrder.seller_id && (
                    <button
                      onClick={() => window.open(
                        `${(import.meta as any).env?.VITE_API_URL || 'http://localhost:8000'}/cadastros/sellers/${activeOrder.seller_id}/experience-file`,
                        '_blank'
                      )}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition"
                      style={{ color: '#9B87F0', borderColor: 'rgba(123,99,232,0.30)', background: 'rgba(123,99,232,0.10)' }}
                      title="Ver roteiro de experiência deste seller"
                    >
                      ✨ Experiência
                    </button>
                  )}
                  <button onClick={() => setShowInterruptDialog(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-400 border border-orange-400/25 hover:border-orange-400/50 rounded-lg transition">
                    <Pause size={12} /> Interromper
                  </button>
                </div>
              </div>
              {/* Progress */}
              <div className="flex justify-between text-xs text-white/35 mb-1">
                <span>{activeOrder.items_scanned} bipados</span>
                <span>{activeOrder.items_total} total</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${activeOrder.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                  style={{ width: activeOrder.items_total > 0 ? `${Math.round(activeOrder.items_scanned / activeOrder.items_total * 100)}%` : '0%' }} />
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-black text-white/60 mb-1">
                {scanPhase === 'nfe' && activeOrder?.status === 'completed'
                  ? '✅ Pedido concluído!'
                  : 'Aguardando pedido...'}
              </h2>
              <p className="text-sm text-white/30">
                {scanPhase === 'nfe'
                  ? 'Escaneie a etiqueta física da NFe para abrir o próximo pedido'
                  : 'Finalize o pedido atual antes de abrir outro'}
              </p>
            </div>
          )}

          {/* Feedback panel */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border mt-3 transition-all min-h-[56px] ${feedbackBg[feedback.state]}`}>
            {feedbackIcon[feedback.state]}
            <div className="flex-1 min-w-0">
              {feedback.state !== 'idle' ? (
                <>
                  <p className={`font-bold text-sm ${feedbackTextColor[feedback.state]}`}>{feedback.title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{feedback.message}</p>
                </>
              ) : (
                <p className="text-sm text-white/25">
                  {scanPhase === 'nfe' ? 'Aguardando scan da NFe...' : 'Aguardando scan do produto...'}
                </p>
              )}
            </div>
            {feedback.photoUrl && (
              <img src={photoSrc(feedback.photoUrl)!} alt="Produto"
                className="w-14 h-14 object-cover rounded-lg border border-white/10 flex-shrink-0" />
            )}
          </div>

          {/* Barcode input */}
          <div className="flex gap-2 mt-3">
            <div className="flex-1 relative">
              {scanPhase === 'nfe'
                ? <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-400/60" />
                : <ScanLine size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${scanning ? 'text-green-400 animate-pulse' : 'text-white/30'}`} />
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
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-base text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition disabled:opacity-40"
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
        </div>

        {/* Scrollable items area */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeOrder && scanPhase === 'product' ? (
            <>
              {/* B: ordena — pendentes primeiro (in-progress antes de untouched), concluídos no fim */}
              {(() => {
                const sorted = [...activeOrder.items].sort((a, b) => {
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
                    <h3 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">
                      Itens do Pedido ({activeOrder.items.length})
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
                <KeyRound size={48} className="text-white/10 mx-auto mb-3" />
                <p className="text-white/25 text-sm font-medium">Escaneie a etiqueta NFe para começar</p>
                <p className="text-white/15 text-xs mt-1">O código está na etiqueta física do pedido</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT: log ──────────────────────────────────── */}
      <aside className="w-56 bg-gray-900 border-l border-white/5 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5 flex items-center gap-2">
          <ClipboardList size={14} className="text-white/40" />
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Log</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {(scanLogs as ScanLog[]).length === 0 ? (
            <p className="text-[10px] text-white/20 text-center mt-6 px-2">Nenhuma bipagem ainda nesta sessão.</p>
          ) : (
            (scanLogs as ScanLog[]).map(log => (
              <div key={log.id}
                className={`mb-1.5 p-2 rounded-lg border text-[10px] ${log.is_error ? 'bg-red-900/20 border-red-500/20' : 'bg-green-900/15 border-green-500/15'}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`font-mono font-bold ${log.is_error ? 'text-red-400' : 'text-green-400'}`}>
                    {log.is_error ? '✗' : '✓'} {log.sku}
                  </span>
                  <span className="text-white/30">{log.timestamp}</span>
                </div>
                <p className="text-white/40 truncate">NF {log.order_nf}</p>
                {log.is_error && log.error_message && (
                  <p className="text-red-400/60 truncate text-[9px] mt-0.5">{log.error_message}</p>
                )}
                <p className="text-white/25">{log.operator_name}</p>
              </div>
            ))
          )}
        </div>
        {/* Operator info */}
        <div className="p-3 border-t border-white/5 flex-shrink-0">
          <p className="text-[10px] text-white/30 font-medium truncate">{user?.name}</p>
          <p className="text-[10px] text-white/20 capitalize">{user?.role}</p>
        </div>
      </aside>

      {/* ── Interrupt dialog ─────────────────────────────── */}
      {showInterruptDialog && activeOrder && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-orange-500/30 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Pause size={20} className="text-orange-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Interromper Pedido</h3>
                <p className="text-xs text-white/40">NF {activeOrder.nf_number} · {activeOrder.customer_name}</p>
              </div>
            </div>
            <p className="text-sm text-white/60 mb-3">O pedido ficará como "interrompido". Informe o motivo:</p>
            <textarea
              value={interruptReason}
              onChange={e => setInterruptReason(e.target.value)}
              placeholder="Ex: produto danificado, falta de estoque, cliente solicitou..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowInterruptDialog(false); setInterruptReason(''); }}
                className="flex-1 py-2.5 text-sm text-white/60 border border-white/10 rounded-xl hover:bg-white/5 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleInterrupt}
                className="flex-1 py-2.5 text-sm font-semibold text-orange-400 border border-orange-400/40 rounded-xl hover:bg-orange-500/10 transition"
              >
                Interromper
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exit confirmation dialog ─────────────────────── */}
      {showExitDialog && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <LogOut size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Sair da Bipagem</h3>
                {activeOrder && (
                  <p className="text-xs text-white/40">NF {activeOrder.nf_number} está em aberto</p>
                )}
              </div>
            </div>
            <p className="text-sm text-white/60 mb-3">
              Há um pedido em andamento. Ao sair, ele será marcado como <span className="text-orange-300 font-semibold">interrompido</span>. Informe o motivo:
            </p>
            <textarea
              value={exitReason}
              onChange={e => setExitReason(e.target.value)}
              placeholder="Ex: fim de turno, problema operacional, retorno depois..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-red-500 resize-none"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowExitDialog(false); setExitReason(''); inputRef.current?.focus(); }}
                className="flex-1 py-2.5 text-sm text-white/60 border border-white/10 rounded-xl hover:bg-white/5 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmExit}
                className="flex-1 py-2.5 text-sm font-semibold text-red-400 border border-red-400/40 rounded-xl hover:bg-red-500/10 transition"
              >
                Interromper e Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de produto inline (right-click) ─────────── */}
      {productModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-white">
                  {productModal.mode === 'create'
                    ? 'Cadastrar Produto'
                    : productModal.item.barcode_seller
                    ? 'Detalhes do Produto'
                    : 'Atualizar Código de Barras'}
                </h3>
                <p className="text-xs text-white/40 mt-0.5">{productModal.seller_name}</p>
              </div>
              <button onClick={() => setProductModal(null)} className="text-white/30 hover:text-white/70">✕</button>
            </div>

            <div className="space-y-3">
              {/* SKU — read-only */}
              <div>
                <label className="block text-xs text-white/40 mb-1">SKU</label>
                <p className="text-sm font-mono text-white/80 bg-white/5 rounded-lg px-3 py-2">
                  {productModal.item.sku}
                </p>
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs text-white/40 mb-1">Nome</label>
                <input
                  value={productForm.name}
                  onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-violet-500"
                  readOnly={productModal.mode === 'view' && !!productModal.item.barcode_seller && !!productModal.product_id}
                />
              </div>

              {/* Cód. Barras Seller */}
              <div>
                <label className="block text-xs text-white/40 mb-1">
                  Cód. Barras {productModal.mode === 'create' && <span className="text-red-400">*</span>}
                </label>
                <input
                  value={productForm.barcode_seller}
                  onChange={e => setProductForm(f => ({ ...f, barcode_seller: e.target.value }))}
                  placeholder="Ex: 7898996051716"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-white/20 outline-none focus:ring-2 focus:ring-violet-500"
                  autoFocus
                />
              </div>

              {/* Caixa */}
              <div>
                <label className="block text-xs text-white/40 mb-1">Tipo de Caixa</label>
                <input
                  value={productForm.box_type}
                  onChange={e => setProductForm(f => ({ ...f, box_type: e.target.value }))}
                  placeholder="Ex: Caixa1"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setProductModal(null)}
                className="flex-1 py-2.5 text-sm text-white/50 border border-white/10 rounded-xl hover:bg-white/5 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProductInline}
                disabled={savingProduct}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition disabled:opacity-50"
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
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-3 -right-3 w-9 h-9 bg-gray-800 border border-white/15 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-gray-700 transition shadow-xl"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Context menu (right-click no item) ──────────── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-white/10 rounded-xl shadow-2xl py-1 min-w-[220px]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 240), top: Math.min(contextMenu.y, window.innerHeight - 120) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-white/10 mb-1">
            <p className="text-xs font-mono text-white/40 truncate">{contextMenu.item.sku}</p>
            <p className="text-xs text-white/70 font-medium truncate">{contextMenu.item.product_name}</p>
          </div>
          {contextMenu.item.product_id === null ? (
            <button
              className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2.5 transition"
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
              <Plus size={14} className="text-emerald-400 flex-shrink-0" />
              <span>Cadastrar produto</span>
            </button>
          ) : (
            <button
              className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2.5 transition"
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
              <Package size={14} className="text-blue-400 flex-shrink-0" />
              <span>Ver detalhes do produto</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
