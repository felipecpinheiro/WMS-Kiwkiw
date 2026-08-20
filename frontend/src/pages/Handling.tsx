import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { scanningApi } from '../api';
import { format } from 'date-fns';
import { todayBrasiliaStr } from '../timezone';
import type { SessionCard } from '../api';
import {
  Package, Clock, CheckCircle2, PlayCircle, Circle,
  ChevronRight, RefreshCw, CalendarDays, Layers,
  CheckCheck, Ban, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CtxMenu {
  x: number;
  y: number;
  card: SessionCard;
}

type AdminAction = 'force_complete' | 'cancel_handling';

// ── Context Menu (admin right-click) ─────────────────────────────────────────

function CardContextMenu({
  menu,
  onAction,
  onClose,
}: {
  menu: CtxMenu;
  onAction: (action: AdminAction, card: SessionCard) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou pressionar Esc
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  // Ajusta posição para não sair da tela
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(menu.y, window.innerHeight - 120),
    left: Math.min(menu.x, window.innerWidth - 230),
    zIndex: 9999,
  };

  return (
    <div
      ref={ref}
      style={style}
      className="w-56 bg-surface-2 border border-line-strong rounded-xl shadow-2xl overflow-hidden py-1"
    >
      <div className="px-3 py-1.5 border-b border-line-soft mb-1">
        <p className="text-[10px] text-t4 uppercase tracking-wider">Admin — {menu.card.seller_name}</p>
      </div>

      <button
        onClick={() => { onAction('force_complete', menu.card); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-ok
          hover:bg-ok-soft transition text-left"
      >
        <CheckCheck size={15} className="flex-shrink-0" />
        <div>
          <p className="font-medium leading-tight">Finalizar sem bipagem</p>
          <p className="text-[10px] text-t4 mt-0.5">Conclui e sensibiliza estoque</p>
        </div>
      </button>

      <button
        onClick={() => { onAction('cancel_handling', menu.card); onClose(); }}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-bad
          hover:bg-bad-soft transition text-left"
      >
        <Ban size={15} className="flex-shrink-0" />
        <div>
          <p className="font-medium leading-tight">Cancelar manuseio</p>
          <p className="text-[10px] text-t4 mt-0.5">Remove da fila, sem mover estoque</p>
        </div>
      </button>
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmAdminModal({
  action,
  card,
  onConfirm,
  onCancel,
  loading,
}: {
  action: AdminAction;
  card: SessionCard;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isForce = action === 'force_complete';

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4
          ${isForce ? 'bg-ok-soft' : 'bg-bad-soft'}`}>
          <AlertTriangle size={22} className={isForce ? 'text-ok' : 'text-bad'} />
        </div>

        <h3 className="text-base font-semibold text-t1 mb-1">
          {isForce ? 'Finalizar sem bipagem?' : 'Cancelar manuseio?'}
        </h3>
        <p className="text-sm text-t3 mb-1">
          Seller: <span className="text-t2 font-medium">{card.seller_name}</span>
        </p>
        <p className="text-sm text-t3 mb-5">
          {card.total_orders - card.completed_orders} pedido(s) pendente(s) serão afetados.
        </p>

        <div className={`rounded-xl border px-4 py-3 mb-5 text-xs
          ${isForce
            ? 'bg-ok-soft border-ok/25 text-ok'
            : 'bg-bad-soft border-bad/25 text-bad'}`}>
          {isForce
            ? '✓ Todos os pedidos serão marcados como concluídos e o estoque será debitado automaticamente.'
            : '⚠ Os pedidos serão cancelados e removidos da fila. O estoque NÃO será movimentado.'}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-line text-sm text-t3
              hover:bg-surface-2 transition disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-40
              ${isForce
                ? 'bg-emerald-600 hover:bg-emerald-500 text-t1'
                : 'bg-red-600 hover:bg-red-500 text-t1'}`}
          >
            {loading ? 'Aguarde...' : isForce ? 'Finalizar' : 'Cancelar manuseio'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(card: SessionCard) {
  if (!card.total_orders) return 0;
  return Math.round((card.completed_orders / card.total_orders) * 100);
}

function uploadTime(card: SessionCard) {
  const ts = card.created_at;
  if (!ts) return '--:--';
  const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function statusInfo(status: string, isEntrada = false) {
  if (isEntrada) {
    switch (status) {
      case 'completed':
        return {
          label: 'Finalizado',
          icon: <CheckCircle2 size={13} />,
          color: 'text-info',
          bg: 'bg-info-soft',
          border: 'border-info/25',
          bar: 'bg-cyan-400',
          headerBg: 'bg-info-soft border-info/25',
        };
      case 'in_progress':
        return {
          label: 'Em Processo',
          icon: <PlayCircle size={13} />,
          color: 'text-info',
          bg: 'bg-info-soft',
          border: 'border-info/25',
          bar: 'bg-sky-400',
          headerBg: 'bg-info-soft border-info/25',
        };
      default:
        return {
          label: 'A Iniciar',
          icon: <Circle size={13} />,
          color: 'text-info/70',
          bg: 'bg-info-soft',
          border: 'border-info/20',
          bar: 'bg-blue-500/40',
          headerBg: 'bg-info-soft border-info/20',
        };
    }
  }

  switch (status) {
    case 'completed':
      return {
        label: 'Finalizado',
        icon: <CheckCircle2 size={13} />,
        color: 'text-ok',
        bg: 'bg-ok-soft',
        border: 'border-ok/25',
        bar: 'bg-teal-400',
        headerBg: 'bg-ok-soft border-ok/25',
      };
    case 'in_progress':
      return {
        label: 'Em Processo',
        icon: <PlayCircle size={13} />,
        color: 'text-violet-300',
        bg: 'bg-violet-900/25',
        border: 'border-violet-500/25',
        bar: 'bg-violet-400',
        headerBg: 'bg-violet-900/30 border-violet-500/25',
      };
    default:
      return {
        label: 'A Iniciar',
        icon: <Circle size={13} />,
        color: 'text-t4',
        bg: 'bg-surface-2/50',
        border: 'border-line-soft',
        bar: 'bg-brand-soft',
        headerBg: 'bg-surface-2/60 border-line-soft',
      };
  }
}

// ── Session Card ──────────────────────────────────────────────────────────────

function HandlingCard({
  card,
  onClick,
  onCtxMenu,
  isEntrada,
}: {
  card: SessionCard;
  onClick: () => void;
  onCtxMenu?: (e: React.MouseEvent) => void;
  isEntrada?: boolean;
}) {
  const info = statusInfo(card.status, isEntrada);
  const progress = pct(card);
  const pending = card.total_orders - card.completed_orders;

  return (
    <div
      onClick={onClick}
      onContextMenu={onCtxMenu}
      className={`group relative rounded-2xl border ${info.border} ${info.bg} p-4 cursor-pointer
        hover:scale-[1.015] hover:shadow-lg transition-all duration-200 select-none`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-t1 truncate">{card.seller_name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <div className="flex items-center gap-1">
              <Clock size={9} className="text-t5" />
              <span className="text-[10px] text-t5 font-mono">{uploadTime(card)}</span>
            </div>
            {card.source_file && (
              <span className="text-[10px] text-t5 truncate max-w-[110px]" title={card.source_file}>
                {card.source_file.split(/[\\/]/).pop()}
              </span>
            )}
          </div>
          {!!card.pending_carrier_orders && (
            <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold
              text-warn bg-warn-soft border border-warn/20">
              🚚 {card.pending_carrier_orders} sem transportadora
            </span>
          )}
          {/* NF com SKU sem produto cadastrado não entra no manuseio: sem
              produto não há código de barras pra bipar. Volta sozinha quando
              o produto for cadastrado (Dashboard). */}
          {!!card.held_orders && (
            <span
              title="Essas NFs não podem ser bipadas porque algum SKU não tem produto cadastrado. Cadastre o produto no Dashboard e elas voltam sozinhas."
              className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold
              text-bad bg-bad-soft border border-bad/20"
            >
              🔒 {card.held_orders} sem produto cadastrado
            </span>
          )}
        </div>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
          border flex-shrink-0 ${info.color} ${info.bg} ${info.border}`}>
          {info.icon}
          {info.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] text-t4">Progresso</span>
          <span className={`text-xs font-bold ${info.color}`}>{progress}%</span>
        </div>
        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={`h-full ${info.bar} rounded-full transition-all duration-500`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div className="bg-black/20 rounded-lg py-1.5">
          <p className="text-sm font-bold text-t1">{card.total_orders}</p>
          <p className="text-[9px] text-t4">Total</p>
        </div>
        <div className="bg-black/20 rounded-lg py-1.5">
          <p className="text-sm font-bold text-ok">{card.completed_orders}</p>
          <p className="text-[9px] text-t4">Feitos</p>
        </div>
        <div className="bg-black/20 rounded-lg py-1.5">
          <p className={`text-sm font-bold ${pending > 0 ? 'text-warn' : 'text-t5'}`}>{pending}</p>
          <p className="text-[9px] text-t4">Pendente</p>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="flex items-center justify-end pt-2 border-t border-line-soft">
        <span className={`flex items-center gap-1 text-[10px] font-medium transition
          ${card.status === 'completed'
            ? 'text-t5'
            : 'text-violet-400 group-hover:text-violet-300'}`}>
          {card.status === 'completed' ? 'Ver detalhes' : 'Abrir bipagem'}
          <ChevronRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  title, status, cards, onCardClick, onCardCtxMenu, isEntrada,
}: {
  title: string;
  status: string;
  cards: SessionCard[];
  onCardClick: (card: SessionCard) => void;
  onCardCtxMenu?: (e: React.MouseEvent, card: SessionCard) => void;
  isEntrada?: boolean;
}) {
  const info = statusInfo(status, isEntrada);
  const totalOrders = cards.reduce((a, c) => a + c.total_orders, 0);
  const doneOrders  = cards.reduce((a, c) => a + c.completed_orders, 0);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Column header */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-xl border ${info.headerBg}`}>
        <div className="flex items-center gap-2">
          <span className={info.color}>{info.icon}</span>
          <span className={`text-sm font-semibold ${info.color}`}>{title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full bg-black/30 font-bold ${info.color}`}>
            {cards.length}
          </span>
        </div>
        {totalOrders > 0 && (
          <span className="text-[10px] text-t5 font-mono">
            {doneOrders}/{totalOrders}
          </span>
        )}
      </div>

      {/* Cards */}
      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-t5 gap-2">
          <Layers size={22} />
          <p className="text-xs">Nenhum card</p>
        </div>
      ) : (
        cards.map(c => (
          <HandlingCard
            key={c.card_id}
            card={c}
            onClick={() => onCardClick(c)}
            onCtxMenu={onCardCtxMenu ? (e) => onCardCtxMenu(e, c) : undefined}
            isEntrada={isEntrada}
          />
        ))
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HandlingPage() {
  const navigate = useNavigate();

  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : null;
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';

  const [dateFrom, setDateFrom] = useState(todayBrasiliaStr);
  const [dateTo, setDateTo]     = useState(todayBrasiliaStr);
  const [sellerFilter, setSellerFilter] = useState('');
  const [fileTypeView, setFileTypeView] = useState<'saida' | 'entrada'>('saida');

  // Preferência de unidade ativa — compartilhada com o Dashboard via localStorage
  const unitPrefKey = `wms_active_unit_${user?.id ?? 'anon'}`;
  const [activeUnitId, setActiveUnitId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem(unitPrefKey);
    return saved ? Number(saved) : (user?.unit_id ?? undefined);
  });

  const handleUnitChange = (uid: number | undefined) => {
    setActiveUnitId(uid);
    if (uid) localStorage.setItem(unitPrefKey, String(uid));
    else localStorage.removeItem(unitPrefKey);
  };

  const { data: units = [] } = useQuery('units', () =>
    import('../api').then(m => m.cadastrosApi.units().then(r => r.data))
  );

  // ── Admin: context menu + confirm modal ────────────────────────────────────
  const [ctxMenu, setCtxMenu]         = useState<CtxMenu | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: AdminAction; card: SessionCard } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // O backend já filtra os cards pelos sellers vinculados ao usuário (operador/gerente).
  // Aqui só precisamos buscar e aplicar o filtro visual de seller (admin only).
  const { data: serverCards = [], isLoading, refetch } = useQuery(
    ['session-cards', dateFrom, dateTo, activeUnitId],
    () => scanningApi.sessionCards({
      date_from: dateFrom,
      date_to: dateTo,
      unit_id: activeUnitId,
    }).then(r => r.data),
    { refetchInterval: 30000 }
  );
  // localCards permite atualizações optimistas (cancelar remove imediatamente, force-complete atualiza status)
  const [localCards, setLocalCards] = useState<SessionCard[]>([]);
  useEffect(() => { setLocalCards(serverCards as SessionCard[]); }, [serverCards]);
  const cards = localCards;

  // Interruptor Entrada/Saída — nunca mostra os dois juntos
  const byFileType = useMemo(() =>
    cards.filter(c => (c.file_type || 'saida') === fileTypeView),
    [cards, fileTypeView]
  );

  // Seller list for filter dropdown (admin only)
  const allSellers = useMemo(() => {
    const s = new Set<string>();
    byFileType.forEach(c => { if (c.seller_name) s.add(c.seller_name); });
    return Array.from(s).sort();
  }, [byFileType]);

  // Admin: filtro visual por seller. Operador/gerente já chegam pré-filtrados do backend.
  const filtered = useMemo(() =>
    sellerFilter ? byFileType.filter(c => c.seller_name === sellerFilter) : byFileType,
    [byFileType, sellerFilter]
  );

  // Group by status
  const groups = useMemo(() => ({
    pending:     filtered.filter(c => c.status === 'pending'),
    in_progress: filtered.filter(c => c.status === 'in_progress'),
    completed:   filtered.filter(c => c.status === 'completed'),
  }), [filtered]);

  // Global summary
  const totalOrders     = filtered.reduce((a, c) => a + c.total_orders, 0);
  const completedOrders = filtered.reduce((a, c) => a + c.completed_orders, 0);
  const globalPct       = totalOrders > 0 ? Math.round(completedOrders / totalOrders * 100) : 0;

  function handleCardClick(card: SessionCard) {
    const url = card.seller_id
      ? `/scan/${card.session_id}?seller_id=${card.seller_id}`
      : `/scan/${card.session_id}`;
    navigate(url);
  }

  function handleCardCtxMenu(e: React.MouseEvent, card: SessionCard) {
    if (!isAdmin) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, card });
  }

  function handleAdminAction(action: AdminAction, card: SessionCard) {
    setConfirmAction({ action, card });
  }

  async function executeAdminAction() {
    if (!confirmAction) return;
    const { action, card } = confirmAction;
    setActionLoading(true);
    try {
      if (action === 'force_complete') {
        const res = await scanningApi.forceComplete(card.session_id, card.seller_id);
        toast.success(res.data.message || 'Finalizado com sucesso');
        // Atualização optimista: move o card para "completed" imediatamente
        setLocalCards(prev => prev.map(c =>
          c.card_id === card.card_id
            ? { ...c, status: 'completed', completed_orders: c.total_orders, pending_orders: 0, in_progress_orders: 0 }
            : c
        ));
      } else {
        // cancel_handling → remove da tela imediatamente
        const res = await scanningApi.cancelHandling(card.session_id, card.seller_id);
        toast.success(res.data.message || 'Manuseio cancelado');
        setLocalCards(prev => prev.filter(c => c.card_id !== card.card_id));
      }
      // Refetch em background para sincronizar com o servidor
      setTimeout(() => refetch(), 1500);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(detail || 'Erro ao executar ação admin');
      refetch(); // reverte estado local em caso de erro
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  const inputCls = "border border-line rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-t2";
  const inputStyle = { background: 'rgb(var(--surface-2))' };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-violet-600/20 rounded-xl flex items-center justify-center">
            <Package size={18} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-t1">Manuseios</h1>
            <p className="text-xs text-t4">Um card por seller por upload — acompanhe a bipagem em tempo real</p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-t3 border border-line rounded-lg hover:bg-surface-2 transition">
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {/* Filters + summary */}
      <div className="flex flex-wrap items-center gap-3 bg-surface rounded-xl border border-line-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-t4" />
          <span className="text-xs text-t4">De</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className={inputCls} style={inputStyle} />
          <span className="text-xs text-t4">ate</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className={inputCls} style={inputStyle} />
        </div>

        {/* Interruptor Saída / Entrada */}
        <div className="flex items-center rounded-lg border border-line overflow-hidden text-xs font-medium">
          <button
            onClick={() => setFileTypeView('saida')}
            className={`px-3 py-1.5 transition ${fileTypeView === 'saida'
              ? 'bg-violet-600 text-t1'
              : 'text-t4 hover:bg-surface-2'}`}
          >
            Saída
          </button>
          <button
            onClick={() => setFileTypeView('entrada')}
            className={`px-3 py-1.5 transition ${fileTypeView === 'entrada'
              ? 'bg-sky-600 text-t1'
              : 'text-t4 hover:bg-surface-2'}`}
          >
            Entrada
          </button>
        </div>

        {/* Seletor de unidade — admin e manager */}
        {(isAdmin || isManager) && (units as any[]).length > 1 && (
          <select
            value={activeUnitId ?? ''}
            onChange={e => handleUnitChange(e.target.value ? Number(e.target.value) : undefined)}
            className={inputCls} style={inputStyle}
          >
            {isAdmin && <option value="">Todas as unidades</option>}
            {(units as any[]).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}

        {isAdmin && allSellers.length > 1 && (
          <select value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}
            className={inputCls} style={inputStyle}>
            <option value="">Todos os sellers</option>
            {allSellers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Global pill */}
        <div className="ml-auto flex items-center gap-3 bg-black/20 rounded-xl px-4 py-2">
          <div className="text-center">
            <p className="text-base font-bold text-t1">{filtered.length}</p>
            <p className="text-[9px] text-t4">cards</p>
          </div>
          <div className="w-px h-7 bg-surface-2" />
          <div className="text-center">
            <p className="text-base font-bold text-t1">{totalOrders}</p>
            <p className="text-[9px] text-t4">pedidos</p>
          </div>
          <div className="w-px h-7 bg-surface-2" />
          <div className="text-center">
            <p className={`text-base font-bold ${globalPct === 100 ? 'text-ok' : globalPct > 0 ? 'text-violet-300' : 'text-t4'}`}>
              {globalPct}%
            </p>
            <p className="text-[9px] text-t4">concluido</p>
          </div>
        </div>
      </div>

      {/* Kanban */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-3">
              <div className="h-10 bg-surface-2/60 rounded-xl animate-pulse" />
              {[0, 1, 2].map(j => <div key={j} className="h-40 bg-surface/60 rounded-2xl animate-pulse" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <KanbanColumn title="A Iniciar"   status="pending"     cards={groups.pending}     onCardClick={handleCardClick} onCardCtxMenu={isAdmin ? handleCardCtxMenu : undefined} isEntrada={fileTypeView === 'entrada'} />
          <KanbanColumn title="Em Processo" status="in_progress" cards={groups.in_progress} onCardClick={handleCardClick} onCardCtxMenu={isAdmin ? handleCardCtxMenu : undefined} isEntrada={fileTypeView === 'entrada'} />
          <KanbanColumn title="Finalizado"  status="completed"   cards={groups.completed}   onCardClick={handleCardClick} onCardCtxMenu={isAdmin ? handleCardCtxMenu : undefined} isEntrada={fileTypeView === 'entrada'} />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-20 text-t5">
          <Package size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-sm font-medium">Nenhum card encontrado</p>
          <p className="text-xs mt-1">Ajuste os filtros ou importe um arquivo no Dashboard</p>
        </div>
      )}

      {/* ── Admin overlays ─────────────────────────────────────────────────── */}

      {/* Context menu (right-click) */}
      {isAdmin && ctxMenu && (
        <CardContextMenu
          menu={ctxMenu}
          onAction={handleAdminAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Confirmation modal */}
      {isAdmin && confirmAction && (
        <ConfirmAdminModal
          action={confirmAction.action}
          card={confirmAction.card}
          onConfirm={executeAdminAction}
          onCancel={() => setConfirmAction(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
