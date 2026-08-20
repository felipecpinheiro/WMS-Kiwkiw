/**
 * WMS Kiwkiw - Folha inferior (mobile)
 * Substitui modais centralizados em telas estreitas: filtros, ações e detalhe de item.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-x"
        style={{
          background: 'rgb(var(--surface))',
          borderColor: 'rgb(var(--brand-line))',
          paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-brand-soft" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b border-line-soft">
            <h2 className="text-sm font-semibold text-t1">{title}</h2>
            <button onClick={onClose} className="text-t4 hover:text-t3">
              <X size={18} />
            </button>
          </div>
        )}

        <div className="px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
