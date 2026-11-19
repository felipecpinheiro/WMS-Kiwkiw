/**
 * WMS Kiwkiw - Filtro de período do Portal do Seller (19/11/2026)
 * ===============================================================
 * Presets (Hoje, 7d, 30d, 90d) + De/Até. O estado vive no SellerPortal e é o
 * MESMO da aba Meus Pedidos: mudou aqui, vale lá (e na sidebar). No celular
 * vira um botão "Período" que abre uma folha inferior.
 */

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { useIsMobile } from '../hooks/useIsMobile';
import { todayBrasiliaStr } from '../timezone';

const PRESETS: { label: string; days: number }[] = [
  { label: 'Hoje', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

/** Hoje (Brasília) menos N dias, em 'YYYY-MM-DD'. */
function daysBeforeToday(n: number): string {
  const [y, m, d] = todayBrasiliaStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - n));
  return dt.toISOString().slice(0, 10);
}

/** '2026-11-04' -> '04/11' */
const dd = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

function PresetChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition whitespace-nowrap
        ${active
          ? 'bg-violet-600 border-violet-500 text-white'
          : 'bg-surface-2 border-line text-t3 hover:text-t1 hover:border-line-strong'}`}
    >
      {children}
    </button>
  );
}

export default function PeriodFilter({ dateFrom, dateTo, onChange, children }: {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
  /** Controles extras da tela (ex.: busca de NF e status em Meus Pedidos).
   *  Desktop: na mesma barra. Celular: em linhas abaixo do botão "Período". */
  children?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const today = todayBrasiliaStr();

  const activePreset = PRESETS.find(
    p => dateTo === today && dateFrom === daysBeforeToday(p.days),
  );
  const apply = (days: number) => onChange(daysBeforeToday(days), today);

  const inputCls =
    'border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500 text-t2 bg-surface-2';

  const controls = (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map(p => (
          <PresetChip key={p.label} active={activePreset?.label === p.label} onClick={() => apply(p.days)}>
            {p.label}
          </PresetChip>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-t4">De</span>
        <input type="date" value={dateFrom} max={dateTo}
          onChange={e => e.target.value && onChange(e.target.value, dateTo)} className={inputCls} />
        <span className="text-xs text-t4">até</span>
        <input type="date" value={dateTo} min={dateFrom}
          onChange={e => e.target.value && onChange(dateFrom, e.target.value)} className={inputCls} />
      </div>
    </>
  );

  const summary = dateFrom === dateTo ? dd(dateFrom) : `${dd(dateFrom)} → ${dd(dateTo)}`;

  if (isMobile) {
    return (
      <div className="space-y-2.5">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 text-xs text-t2 bg-surface/60 border border-line-soft rounded-xl w-full"
        >
          <CalendarDays size={14} className="text-violet-400" />
          <span className="font-medium">Período</span>
          <span className="text-t4 ml-auto">{summary}</span>
        </button>
        <BottomSheet open={open} onClose={() => setOpen(false)} title="Período">
          <div className="space-y-4">
            {controls}
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-xl hover:bg-violet-500 transition"
            >
              Aplicar
            </button>
          </div>
        </BottomSheet>
        {children}
      </div>
    );
  }

  return (
    <div className="flex gap-3 flex-wrap items-center bg-surface/60 border border-line-soft rounded-xl px-4 py-3">
      <CalendarDays size={14} className="text-violet-400 flex-shrink-0" />
      {controls}
      {children}
    </div>
  );
}
