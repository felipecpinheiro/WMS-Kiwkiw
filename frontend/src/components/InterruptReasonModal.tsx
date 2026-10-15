import { useState } from 'react';
import { Pause, X, Package } from 'lucide-react';

/**
 * Quadro de motivo da interrupção de uma NF de SAÍDA (16/10/2026).
 *
 * O operador marca um ou mais motivos da lista; os que dependem de produto
 * (`needsSkus`) mostram, logo abaixo, TODOS os SKUs da NF para marcar quais são.
 * O servidor monta o texto que o seller lê no Portal e revalida tudo — esta
 * tela só impede o envio incompleto. A lista de códigos tem que bater com
 * INTERRUPT_REASONS em backend/routers/scanning.py.
 */

export interface InterruptReasonItem {
  sku: string;
  product_name: string;
  quantity: number;
  scanned: number;
  photo_url: string | null;
}

export interface InterruptReasonPayload {
  reasons: { code: string; skus: string[] }[];
  other_text?: string;
}

const REASONS: { code: string; label: string; hint: string; needsSkus: boolean }[] = [
  { code: 'CODIGO_BARRAS_SEM_LEITURA', label: 'Código de barras sem leitura', hint: 'Etiqueta ilegível, danificada ou que o leitor não consegue ler', needsSkus: true },
  { code: 'PRODUTO_SEM_CODIGO_BARRAS', label: 'Produto sem código de barras', hint: 'O produto veio sem etiqueta', needsSkus: true },
  { code: 'FALTA_DE_SKU', label: 'Falta de SKU', hint: 'O SKU não está disponível para separar', needsSkus: true },
  { code: 'PEDIDO_B2B', label: 'Pedido B2B', hint: '', needsSkus: false },
  { code: 'OUTRO', label: 'Outro', hint: 'Descreva o motivo', needsSkus: false },
];

export const INTERRUPT_OTHER_MAX = 500;

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const photoSrc = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${API_BASE}${url}`) : null;

interface Props {
  title: string;
  subtitle: string;
  items: InterruptReasonItem[];
  confirmLabel: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: InterruptReasonPayload) => void;
}

export default function InterruptReasonModal({
  title, subtitle, items, confirmLabel, submitting, onCancel, onConfirm,
}: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [skus, setSkus] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState('');

  const toggleReason = (code: string) =>
    setChecked(c => ({ ...c, [code]: !c[code] }));

  const toggleSku = (code: string, sku: string) =>
    setSkus(s => {
      const cur = s[code] ?? [];
      return { ...s, [code]: cur.includes(sku) ? cur.filter(x => x !== sku) : [...cur, sku] };
    });

  const allSkus = items.map(i => i.sku);
  const toggleAll = (code: string) =>
    setSkus(s => {
      const cur = s[code] ?? [];
      return { ...s, [code]: cur.length === allSkus.length ? [] : [...allSkus] };
    });

  const selected = REASONS.filter(r => checked[r.code]);
  const missing: string | null = (() => {
    if (selected.length === 0) return 'Marque pelo menos um motivo';
    for (const r of selected) {
      if (r.needsSkus && (skus[r.code]?.length ?? 0) === 0) return `Selecione os SKUs em "${r.label}"`;
      if (r.code === 'OUTRO' && !other.trim()) return 'Descreva o motivo em "Outro"';
    }
    return null;
  })();

  const submit = () => {
    if (missing || submitting) return;
    const payload: InterruptReasonPayload = {
      reasons: selected.map(r => ({ code: r.code, skus: r.needsSkus ? (skus[r.code] ?? []) : [] })),
    };
    if (checked['OUTRO']) payload.other_text = other.trim();
    onConfirm(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-warn/30 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center gap-3 p-5 pb-3">
          <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <Pause size={20} className="text-warn" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-t1">{title}</h3>
            <p className="text-xs text-t4 truncate">{subtitle}</p>
          </div>
          <button onClick={onCancel} className="text-t4 hover:text-t3" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="px-5 overflow-y-auto flex-1">
          <p className="text-xs text-warn mb-3">
            Este motivo ficará visível para o seller no Portal. Escolha o que aconteceu (pode marcar mais de um).
          </p>

          <div className="space-y-2 pb-2">
            {REASONS.map(r => {
              const on = !!checked[r.code];
              const picked = skus[r.code] ?? [];
              return (
                <div key={r.code} className={`rounded-xl border ${on ? 'border-warn/50 bg-warn-soft/30' : 'border-line bg-surface-2'}`}>
                  <label className="flex items-start gap-3 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleReason(r.code)}
                      className="mt-0.5 w-4 h-4 accent-orange-500"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-t1">{r.label}</span>
                      {r.hint && <span className="block text-xs text-t4">{r.hint}</span>}
                    </span>
                  </label>

                  {on && r.needsSkus && (
                    <div className="px-3 pb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] text-t3">
                          SKUs da NF ({picked.length} de {items.length} selecionado{picked.length === 1 ? '' : 's'})
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleAll(r.code)}
                          className="text-[11px] text-violet-400 hover:underline"
                        >
                          {picked.length === items.length ? 'Limpar seleção' : 'Selecionar todos'}
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-line-soft divide-y divide-line-soft bg-surface">
                        {items.map(it => {
                          const src = photoSrc(it.photo_url);
                          const isOn = picked.includes(it.sku);
                          return (
                            <label key={it.sku} className={`flex items-center gap-2.5 px-2.5 py-2 cursor-pointer ${isOn ? 'bg-warn-soft/30' : 'hover:bg-surface-2'}`}>
                              <input
                                type="checkbox"
                                checked={isOn}
                                onChange={() => toggleSku(r.code, it.sku)}
                                className="w-4 h-4 accent-orange-500 flex-shrink-0"
                              />
                              <span className="w-9 h-9 rounded-md bg-surface-2 border border-line-soft overflow-hidden flex items-center justify-center flex-shrink-0">
                                {src
                                  ? <img src={src} alt="" className="w-full h-full object-cover" />
                                  : <Package size={14} className="text-t5" />}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-xs font-mono text-t2">{it.sku}</span>
                                <span className="block text-[11px] text-t4 truncate">{it.product_name}</span>
                              </span>
                              <span className="text-[11px] text-t3 tabular-nums flex-shrink-0">
                                {it.scanned}/{it.quantity}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {on && r.code === 'OUTRO' && (
                    <div className="px-3 pb-3">
                      <textarea
                        value={other}
                        onChange={e => setOther(e.target.value)}
                        maxLength={INTERRUPT_OTHER_MAX}
                        rows={3}
                        placeholder="Ex: produto danificado, cliente solicitou..."
                        className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder-t5 outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                      />
                      <div className="text-right text-[11px] text-t4">{other.length}/{INTERRUPT_OTHER_MAX}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-5 pt-3 border-t border-line-soft">
          <p className="text-xs text-bad min-h-[1rem] mb-2">{missing ?? ''}</p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-sm text-t3 border border-line rounded-xl hover:bg-surface-2 transition"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!!missing || submitting}
              className="flex-1 py-2.5 text-sm font-semibold text-warn border border-warn/40 rounded-xl hover:bg-orange-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
