// Modal "Valores por Excel" (07/10/2026) — Meu Estoque do Portal do Seller.
// Modelo → arquivo → conferência → confirmar. Tudo-ou-nada: qualquer erro trava
// o lote; avisos só avisam. Regras em backend/routers/stock_values.py.
import { Fragment, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryApi, ValuesAnalyzeResult } from '../api';

type Phase = 'upload' | 'analyzing' | 'review' | 'submitting' | 'done';

export const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ValuesSheetModal({
  onClose, onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ValuesAnalyzeResult | null>(null);
  const [result, setResult] = useState<{ total: number; changed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = phase === 'analyzing' || phase === 'submitting';

  const errorMessage = (err: any) => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
    return `Erro de conexão: ${err?.message || 'desconhecido'}`;
  };

  const handleTemplate = async () => {
    try {
      await inventoryApi.downloadValuesTemplate();
    } catch (err: any) {
      toast.error(errorMessage(err));
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setPhase('analyzing');
    setError(null);
    setSubmitErrors([]);
    try {
      const res = await inventoryApi.analyzeValues(file);
      setAnalysis(res.data);
      setPhase('review');
    } catch (err: any) {
      setError(errorMessage(err));
      setPhase('upload');
    }
  };

  const handleSubmit = async () => {
    if (!analysis?.can_submit) return;
    setPhase('submitting');
    setSubmitErrors([]);
    try {
      const res = await inventoryApi.submitValues(analysis.rows);
      setResult(res.data);
      setPhase('done');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setSubmitErrors(Array.isArray(detail?.errors) ? detail.errors : [errorMessage(err)]);
      setPhase('review');
    }
  };

  const resetFile = () => {
    setPhase('upload');
    setAnalysis(null);
    setFile(null);
    setError(null);
    setSubmitErrors([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const errorRows = analysis ? analysis.rows.filter(r => r.errors.length > 0).length : 0;
  const changesBySku = new Map((analysis?.changes ?? []).map(c => [c.sku, c]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-4xl rounded-2xl border border-line shadow-2xl flex flex-col max-h-[92vh]"
        style={{ background: 'linear-gradient(135deg, rgb(var(--surface)) 0%, rgb(var(--surface-2)) 100%)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet size={18} style={{ color: 'rgb(var(--brand))' }} />
            <span className="text-t1 font-semibold text-base">Valores por Excel</span>
          </div>
          <button onClick={onClose} disabled={busy} className="text-t4 hover:text-t2 transition disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          {(phase === 'upload' || phase === 'analyzing') && (
            <div className="flex flex-col gap-4">
              <p className="text-t3 text-sm leading-relaxed">
                Cadastre o valor unitário (R$) de vários SKUs de uma vez. Nada é gravado antes da sua
                confirmação, e se qualquer linha tiver problema <span className="text-t1 font-medium">nada é gravado</span>.
              </p>

              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-line px-4 py-3"
                style={{ background: 'rgb(var(--surface-2))' }}>
                <div className="text-sm">
                  <p className="text-t1 font-medium">1. Baixe o modelo e preencha</p>
                  <p className="text-t4 text-xs mt-0.5">SKU · Nome do produto · Valor Un — vem com os seus SKUs e os valores atuais. Valor em branco mantém o atual.</p>
                </div>
                <button
                  onClick={handleTemplate}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-line text-t2 hover:bg-surface-2 transition"
                >
                  <Download size={13} /> Baixar modelo
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-t1 text-sm font-medium">2. Suba o arquivo preenchido</p>
                <label
                  onClick={() => !busy && fileRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-line-strong rounded-xl py-8 cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition"
                >
                  <FileUp size={32} className="text-t4" />
                  <div className="text-center">
                    <p className="text-t2 text-sm font-medium">
                      {file ? file.name : 'Clique para selecionar o arquivo .xlsx'}
                    </p>
                    {file && <p className="text-t4 text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</p>}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx"
                    className="sr-only"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setError(null); } }}
                  />
                </label>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-bad/30 rounded-lg p-3">
                  <span className="text-bad text-xs leading-relaxed">{error}</span>
                </div>
              )}

              {phase === 'analyzing' && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-t3 text-sm">Conferindo arquivo...</span>
                </div>
              )}
            </div>
          )}

          {(phase === 'review' || phase === 'submitting') && analysis && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgb(var(--surface-2))' }}>
                  <p className="text-2xl font-bold text-t1">{analysis.total}</p>
                  <p className="text-t3 text-xs mt-0.5">Linhas</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgb(var(--surface-2))' }}>
                  <p className="text-2xl font-bold text-ok">{analysis.changes.length}</p>
                  <p className="text-t3 text-xs mt-0.5">Valores a alterar</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgb(var(--surface-2))' }}>
                  <p className={`text-2xl font-bold ${errorRows ? 'text-bad' : 'text-t1'}`}>{errorRows}</p>
                  <p className="text-t3 text-xs mt-0.5">Linhas com erro</p>
                </div>
              </div>

              {!analysis.can_submit ? (
                <div className="bg-red-500/10 border border-bad/40 rounded-lg p-3">
                  <p className="text-bad text-sm font-semibold">Gravação bloqueada — {errorRows} linha(s) com problema</p>
                  <p className="text-t3 text-xs mt-1 leading-relaxed">
                    As linhas em vermelho dizem o que corrigir. Nada foi gravado: corrija a planilha e suba de novo.
                  </p>
                </div>
              ) : analysis.warnings.length > 0 ? (
                <div className="bg-amber-500/10 border border-warn/40 rounded-lg p-3">
                  <p className="text-warn text-sm font-semibold">{analysis.warnings.length} aviso(s) — não impedem a gravação</p>
                  <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                    {analysis.warnings.slice(0, 20).map((w, i) => (
                      <li key={i} className="text-t3 text-xs leading-relaxed">• {w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-ok/30 rounded-lg p-3">
                  <span className="text-ok text-sm">✓ Tudo certo. Confira e confirme.</span>
                </div>
              )}

              {submitErrors.length > 0 && (
                <div className="bg-red-500/10 border border-bad/40 rounded-lg p-3">
                  <p className="text-bad text-sm font-semibold">Nada foi gravado — o servidor encontrou problemas:</p>
                  <ul className="mt-1 space-y-0.5">
                    {submitErrors.map((e, i) => <li key={i} className="text-t3 text-xs leading-relaxed">• {e}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-t2 text-sm font-medium mb-2">Linhas do arquivo</p>
                <div className="rounded-xl border border-line overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: 'rgb(var(--surface-2))' }}>
                      <tr className="text-t4 text-left">
                        <th className="px-3 py-2 font-medium">Linha</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium text-right">Valor atual</th>
                        <th className="px-3 py-2 font-medium text-right">Valor novo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.rows.map(r => {
                        const hasErr = r.errors.length > 0;
                        const hasWarn = !hasErr && r.warnings.length > 0;
                        const changed = !hasErr && changesBySku.has(r.sku);
                        const rowCls = hasErr ? 'bg-red-500/10' : hasWarn ? 'bg-amber-500/10' : '';
                        return (
                          <Fragment key={r.line}>
                            <tr className={`border-t border-line ${rowCls}`}>
                              <td className="px-3 py-2 text-t4 font-mono">{r.line}</td>
                              <td className="px-3 py-2">
                                <span className="text-t1 font-mono">{r.sku || '—'}</span>
                                {r.product_name && <span className="block text-t4 truncate max-w-[280px]" title={r.product_name}>{r.product_name}</span>}
                              </td>
                              <td className="px-3 py-2 text-t3 text-right tabular-nums">
                                {r.current_value != null ? fmtBRL(r.current_value) : '—'}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums ${changed ? 'text-ok font-semibold' : 'text-t2'}`}>
                                {r.value != null ? fmtBRL(r.value) : '(mantém)'}
                              </td>
                            </tr>
                            {(hasErr || hasWarn) && (
                              <tr className={rowCls}>
                                <td />
                                <td colSpan={3} className={`px-3 pb-2 text-xs ${hasErr ? 'text-bad' : 'text-warn'}`}>
                                  {(hasErr ? r.errors : r.warnings).join(' · ')}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-ok text-lg font-semibold">✓ {result.changed} valor(es) atualizado(s)</p>
              <p className="text-t3 text-sm">{result.total} linha(s) conferida(s); só o que mudou foi gravado.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-2">
          {phase === 'done' ? (
            <button onClick={() => { onSuccess(); onClose(); }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 transition">
              Fechar
            </button>
          ) : (
            <>
              {phase === 'review' && (
                <button onClick={resetFile} disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm border border-line text-t3 hover:text-t1 hover:bg-surface-2 transition">
                  Trocar arquivo
                </button>
              )}
              <button onClick={onClose} disabled={busy}
                className="px-4 py-2 rounded-lg text-sm border border-line text-t3 hover:text-t1 hover:bg-surface-2 transition disabled:opacity-40">
                Cancelar
              </button>
              {(phase === 'upload' || phase === 'analyzing') && (
                <button onClick={handleAnalyze} disabled={!file || busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 transition disabled:opacity-40">
                  Conferir
                </button>
              )}
              {(phase === 'review' || phase === 'submitting') && (
                <button onClick={handleSubmit} disabled={!analysis?.can_submit || busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 transition disabled:opacity-40">
                  {phase === 'submitting' ? 'Gravando...' : 'Confirmar'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
