/**
 * WMS Kiwkiw - Editor de faixas de pedidos B2C (09/09/2026)
 * Usado na aba Comercial de Sellers e no topo do Faturamento (mês aberto).
 * Guarda/recebe um JSON: [{"de":100,"ate":200,"preco":30.0}, ...] (contíguas).
 */
import { Plus, X } from 'lucide-react';

export type Faixa = { de: number; ate: number; preco: number };

export function parseFaixas(json: string | null | undefined): Faixa[] {
  try {
    const a = JSON.parse(json || '[]');
    if (!Array.isArray(a)) return [];
    return a.map((f: any) => ({
      de: parseInt(f?.de) || 0,
      ate: parseInt(f?.ate) || 0,
      preco: Number(f?.preco) || 0,
    }));
  } catch {
    return [];
  }
}

export default function FaixaPedidosEditor({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
}) {
  const rows = parseFaixas(value);
  const commit = (rs: Faixa[]) => onChange(JSON.stringify(rs));
  const setRow = (i: number, patch: Partial<Faixa>) =>
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const last = rows[rows.length - 1];
    const de = last ? last.ate + 1 : 1;
    commit([...rows, { de, ate: de + 99, preco: 0 }]);
  };
  const rm = (i: number) => commit(rows.filter((_, j) => j !== i));

  const problema =
    rows.some(r => r.ate < r.de) ||
    rows.some((r, i) => i > 0 && r.de !== rows[i - 1].ate + 1);

  const inp =
    'border border-line rounded-md px-2 py-1 text-sm bg-surface text-t1 text-right w-full disabled:opacity-50';

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 text-[10px] uppercase tracking-wide text-t4">
        <span>De (nº pedidos)</span><span>Até</span><span>R$ / pedido</span><span></span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
          <input type="number" min="1" step="1" disabled={disabled} value={r.de}
            onChange={e => setRow(i, { de: parseInt(e.target.value || '0') })} className={inp} />
          <input type="number" min="1" step="1" disabled={disabled} value={r.ate}
            onChange={e => setRow(i, { ate: parseInt(e.target.value || '0') })} className={inp} />
          <input type="number" min="0" step="0.01" disabled={disabled} value={r.preco}
            onChange={e => setRow(i, { preco: Number(e.target.value) })} className={inp} />
          <button type="button" disabled={disabled} onClick={() => rm(i)}
            className="text-t4 hover:text-red-400 disabled:opacity-50"><X size={14} /></button>
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={add}
          className="flex items-center gap-1.5 text-xs text-t3 hover:text-violet-400 pt-0.5">
          <Plus size={13} /> Adicionar faixa
        </button>
      )}
      {rows.length === 0 && (
        <p className="text-[11px] text-amber-400">Adicione ao menos uma faixa.</p>
      )}
      {rows.length > 0 && problema && (
        <p className="text-[11px] text-amber-400">
          As faixas precisam ser contíguas (a "até" de uma = "de" da próxima menos 1) e "de" ≤ "até".
        </p>
      )}
    </div>
  );
}
