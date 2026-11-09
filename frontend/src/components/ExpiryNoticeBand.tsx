/**
 * WMS Kiwkiw — Faixa de avisos de Controle de Vencimentos (Fase 4b, 03/11/2026).
 *
 * Só aparece para admin/manager. Esconde quando não há aviso aberto.
 * Dropdown lista avisos recentes; "Dispensar" remove só para o usuário atual.
 * Clique no aviso leva para /inventory?seller=<id>#expiry (filtro por SKU fica
 * em iteração futura — por enquanto vai só para a aba do seller).
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, X, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { expiryApi, ExpiryNotice } from '../api';

const TYPE_LABEL: Record<string, string> = {
  vencido_enviado: 'Vencido enviado',
  disposal: 'Descarte/retirada solicitado',
  descarte_solicitado: 'Descarte solicitado',
  retirada_solicitada: 'Retirada solicitada',
};

export default function ExpiryNoticeBand() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: count } = useQuery(
    ['expiry-notice-count'],
    () => expiryApi.noticeCount().then(r => r.data),
    { refetchInterval: 60_000, refetchOnWindowFocus: false },
  );

  const { data: notices = [] } = useQuery(
    ['expiry-notices'],
    () => expiryApi.listNotices().then(r => r.data),
    { enabled: open, refetchInterval: open ? 60_000 : false },
  );

  const dismiss = useMutation(
    (id: number) => expiryApi.dismissNotice(id),
    {
      onSuccess: () => {
        qc.invalidateQueries(['expiry-notice-count']);
        qc.invalidateQueries(['expiry-notices']);
      },
      onError: (err: any) => { toast.error(err?.response?.data?.detail || 'Erro ao dispensar'); },
    },
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const total = count?.total ?? 0;
  if (total === 0) return null;

  const goTo = (n: ExpiryNotice) => {
    setOpen(false);
    const qs = new URLSearchParams({ seller: String(n.seller_id), notice: String(n.id) });
    if (n.disposal_id) qs.set('disposal', String(n.disposal_id));
    else if (n.sku) qs.set('sku', n.sku);
    navigate(`/inventory?${qs.toString()}#expiry`);
  };

  return (
    <div
      ref={ref}
      className="relative flex-shrink-0 border-b"
      style={{ borderColor: 'rgb(var(--brand-line))', background: 'rgb(var(--warn-soft))' }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-left"
        style={{ color: 'rgb(var(--warn))' }}
      >
        <CalendarClock size={14} />
        <span>
          {total} aviso{total === 1 ? '' : 's'} de vencimento
          {total === 1 ? ' aguardando' : ' aguardando'}
        </span>
        <ChevronDown
          size={14}
          className="ml-auto transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-40 max-h-96 overflow-y-auto border-b shadow-lg"
          style={{ background: 'rgb(var(--surface))', borderColor: 'rgb(var(--brand-line))' }}
        >
          {notices.length === 0 ? (
            <div className="px-4 py-3 text-xs text-t4">Nenhum aviso aberto.</div>
          ) : (
            <ul>
              {notices.map(n => (
                <li
                  key={n.id}
                  className="flex items-start gap-2 px-4 py-2.5 border-b"
                  style={{ borderColor: 'rgb(var(--line-soft))' }}
                >
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => goTo(n)}
                  >
                    <div className="text-xs font-medium text-t1">
                      {n.type === 'disposal' && n.disposal_type
                        ? (n.disposal_type === 'retirada' ? 'Retirada solicitada' : 'Descarte solicitado')
                        : (TYPE_LABEL[n.type] || n.type)}
                      {n.disposal_qty ? ` — ${n.disposal_qty} un` : ''}
                    </div>
                    <div className="text-[11px] text-t3 truncate">
                      {n.seller_name || `Seller ${n.seller_id}`}
                      {n.sku ? ` · ${n.sku}` : ''}
                      {n.product_name ? ` · ${n.product_name}` : ''}
                    </div>
                    {n.expiry_date && (
                      <div className="text-[11px] text-t4">
                        {n.lot_name ? `Lote ${n.lot_name} · ` : ''}Vencimento: {n.expiry_date.split('-').reverse().join('/')}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss.mutate(n.id); }}
                    disabled={dismiss.isLoading}
                    title="Dispensar (só para você)"
                    className="p-1 rounded hover:bg-surface-2 text-t4"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
