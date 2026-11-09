/**
 * WMS Kiwkiw — Modal de login de Controle de Vencimentos (Fase 4b, 03/11/2026).
 *
 * Aparece 1x por dia por usuário (o servidor decide via show=false quando o
 * usuário já dispensou no dia). Lista até 5 SKUs com pior situação.
 * Botões: "Ver tudo" leva para a aba Vencimentos; "Dispensar por hoje" chama
 * POST /vencimentos/login-modal/dismiss.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { expiryApi, ExpiryLoginModal as ExpiryLoginData } from '../api';

interface Props {
  onOpenTab?: () => void;
}

export default function ExpiryLoginModal({ onOpenTab }: Props) {
  const [data, setData] = useState<ExpiryLoginData | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    expiryApi.loginModal()
      .then(r => {
        setData(r.data);
        if (r.data.show) setVisible(true);
      })
      .catch(() => { /* informativo, nunca derruba o login */ });
  }, []);

  if (!visible || !data) return null;

  const close = () => setVisible(false);

  const dismissToday = async () => {
    try {
      await expiryApi.dismissLoginModal();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao dispensar');
    } finally {
      close();
    }
  };

  const openTab = () => {
    close();
    onOpenTab?.();
  };

  const { counts, top } = data;
  const nVen = counts?.vencidos ?? 0;
  const nAvi = counts?.aviso ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-xl border overflow-hidden"
        style={{ background: 'rgb(var(--surface))', borderColor: 'rgb(var(--brand-line))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b"
          style={{ borderColor: 'rgb(var(--line-soft))' }}
        >
          <AlertTriangle size={18} style={{ color: 'rgb(var(--warn))' }} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-t1">Controle de vencimentos</div>
            <div className="text-[11px] text-t4">
              Camada informativa — não altera o estoque.
            </div>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-surface-2 text-t4" title="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex gap-3 mb-3">
            {nVen > 0 && (
              <div
                className="flex-1 rounded-lg px-3 py-2"
                style={{ background: 'rgb(var(--bad-soft))', color: 'rgb(var(--bad))' }}
              >
                <div className="text-[11px] font-medium opacity-80">Vencidos</div>
                <div className="text-lg font-bold">{nVen}</div>
              </div>
            )}
            {nAvi > 0 && (
              <div
                className="flex-1 rounded-lg px-3 py-2"
                style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn))' }}
              >
                <div className="text-[11px] font-medium opacity-80">Em aviso</div>
                <div className="text-lg font-bold">{nAvi}</div>
              </div>
            )}
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-t5 mb-1.5">
            Principais itens
          </div>
          <ul className="space-y-1.5 max-h-60 overflow-y-auto">
            {top.map(line => (
              <li
                key={line.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded border"
                style={{
                  borderColor: 'rgb(var(--line-soft))',
                  background: line.situation === 'vencido'
                    ? 'rgb(var(--bad-soft))'
                    : 'rgb(var(--warn-soft))',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-t1 truncate">
                    {line.sku}
                    {line.product_name ? ` · ${line.product_name}` : ''}
                  </div>
                  <div className="text-[11px] text-t3">
                    {line.lot_name ? `Lote ${line.lot_name} · ` : ''}Qtd {line.qty_atual} · Vence em{' '}
                    {line.expiry_date.split('-').reverse().join('/')}
                    {line.situation === 'vencido'
                      ? ` (vencido ${Math.abs(line.days_remaining)}d)`
                      : ` (${line.days_remaining}d)`}
                  </div>
                </div>
              </li>
            ))}
            {top.length === 0 && (
              <li className="text-[11px] text-t4 px-2">Sem itens em vencido/aviso no momento.</li>
            )}
          </ul>
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'rgb(var(--line-soft))' }}
        >
          <button
            onClick={dismissToday}
            className="text-xs px-3 py-1.5 rounded text-t4 hover:bg-surface-2"
          >
            Dispensar por hoje
          </button>
          <button
            onClick={openTab}
            className="text-xs px-3 py-1.5 rounded font-medium"
            style={{ background: 'rgb(var(--brand))', color: '#fff' }}
          >
            Ver tudo
          </button>
        </div>
      </div>
    </div>
  );
}
