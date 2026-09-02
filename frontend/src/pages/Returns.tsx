/**
 * WMS Kiwkiw — Devoluções
 *
 * Dois caminhos para lançar mercadoria que voltou do cliente:
 *   1. subir a planilha (baixa o modelo, confere na tela, confirma)
 *   2. digitar direto na tabelinha
 *
 * Os dois terminam no MESMO endpoint (`POST /devolucoes/lancar`), que revalida
 * tudo no servidor. A tela só antecipa o erro — não é ela que decide.
 *
 * Regra combinada com o dono do sistema: TUDO-OU-NADA. Uma linha com problema
 * impede o lote inteiro, para não entrar meia devolução no estoque.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from 'react-query';
import {
  Undo2, Download, Upload, Plus, Trash2, AlertTriangle, Check, X, FileSpreadsheet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cadastrosApi, returnsApi, ReturnRow, ReturnAnalyzeResult } from '../api';
import PageHeader from '../components/PageHeader';

const inputCls =
  'w-full px-2.5 py-1.5 border border-line rounded-lg text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500 placeholder-t5';
const inputStyle = { background: 'rgb(var(--surface-2))' };

/** Adia um valor até a digitação parar — a busca de SKU vai ao servidor. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

interface ManualRow {
  key: number;
  seller_id: number | null;
  nf_number: string;
  sku: string;
  product_name: string;
  quantity: string;
  returns_stock: boolean;
  reason: string;
}

let rowSeq = 1;
const emptyRow = (base?: Partial<ManualRow>): ManualRow => ({
  key: rowSeq++,
  seller_id: base?.seller_id ?? null,
  nf_number: base?.nf_number ?? '',
  sku: '',
  product_name: '',
  quantity: '1',
  returns_stock: true,
  reason: '',
});


// ── Busca de SKU (lista, nunca digitação livre) ──────────────────────────────
/**
 * A busca é do SERVIDOR e paginada em 30. Filtrar no navegador exigiria baixar
 * o catálogo inteiro do seller e cortaria os resultados em silêncio quando ele
 * tivesse muitos SKUs — mesma armadilha já documentada em outras telas.
 */
function SkuPicker({
  sellerId, sku, productName, onPick,
}: {
  sellerId: number | null;
  sku: string;
  productName: string;
  onPick: (sku: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const debounced = useDebouncedValue(term, 400);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onClickOut = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (boxRef.current?.contains(alvo)) return;
      if (panelRef.current?.contains(alvo)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

  // A lista fecha ao rolar/redimensionar: como ela é posicionada em relação à
  // janela (ver abaixo), rolar a página a deixaria "solta" longe do campo.
  useEffect(() => {
    if (!open) return;
    const fechar = () => setOpen(false);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [open]);

  const abrir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, left: r.left });
    setTerm('');
    setOpen(o => !o);
  };

  const { data, isFetching } = useQuery(
    ['returns-products', sellerId, debounced],
    () => cadastrosApi.products({
      seller_id: sellerId as number,
      search: debounced || undefined,
      active_only: true,
      page: 1,
      page_size: 30,
    }).then(r => r.data),
    { enabled: open && !!sellerId, keepPreviousData: true },
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (!sellerId) {
    return <span className="text-xs text-t5 italic">escolha o seller</span>;
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={abrir}
        className={`${inputCls} text-left truncate ${sku ? 'text-t2' : 'text-t5'}`}
        style={inputStyle}
        title={productName || undefined}
      >
        {sku ? `${sku}${productName ? ` — ${productName}` : ''}` : 'Selecionar SKU...'}
      </button>

      {/*
        A lista sai do fluxo da página (portal + posição fixa) porque a tabela
        vive dentro de um contêiner com rolagem horizontal, e ele CORTAVA o
        painel: os produtos vinham do servidor e simplesmente não apareciam.
      */}
      {open && anchor && createPortal(
        <div
          ref={panelRef}
          className="z-50 w-[420px] max-w-[80vw] rounded-xl border border-line shadow-xl p-2"
          style={{ background: 'rgb(var(--surface))', position: 'fixed', top: anchor.top, left: anchor.left }}
        >
          <input
            autoFocus
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Buscar por SKU ou nome..."
            className={inputCls}
            style={inputStyle}
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {isFetching && items.length === 0 && (
              <p className="text-xs text-t4 px-2 py-3">Buscando...</p>
            )}
            {!isFetching && items.length === 0 && (
              <p className="text-xs text-t4 px-2 py-3">Nenhum produto encontrado</p>
            )}
            {items.map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onPick(p.sku, p.name); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-2 transition"
              >
                <span className="text-sm text-t2 font-mono">{p.sku}</span>
                <span className="text-xs text-t4 ml-2">{p.name}</span>
              </button>
            ))}
          </div>
          {total > items.length && (
            <p className="text-[11px] text-t5 px-2 pt-1">
              Mostrando {items.length} de {total} — refine a busca
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}


export default function ReturnsPage() {
  const qc = useQueryClient();

  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));
  const sellerName = useMemo(() => {
    const map: Record<number, string> = {};
    (sellers as any[]).forEach(s => { map[s.id] = s.trade_name || s.name; });
    return map;
  }, [sellers]);

  // ── Planilha ───────────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ReturnAnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Tabelinha ──────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [manualErrors, setManualErrors] = useState<string[]>([]);

  const patch = (key: number, data: Partial<ManualRow>) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...data } : r)));

  const addRow = () => {
    // Herda seller e NF da última linha: o caso comum é vários SKUs da mesma
    // devolução. Continua dando para trocar linha a linha (planilha mistura
    // sellers, a tela também).
    const last = rows[rows.length - 1];
    setRows(prev => [...prev, emptyRow(last ? { seller_id: last.seller_id, nf_number: last.nf_number } : undefined)]);
  };

  const removeRow = (key: number) =>
    setRows(prev => (prev.length === 1 ? [emptyRow()] : prev.filter(r => r.key !== key)));

  const handleDownloadTemplate = async () => {
    try {
      await returnsApi.downloadTemplate();
    } catch {
      toast.error('Não consegui baixar o modelo');
    }
  };

  const handleAnalyze = async (f: File) => {
    setFile(f);
    setAnalysis(null);
    setAnalyzing(true);
    try {
      const res = await returnsApi.analyze(f);
      setAnalysis(res.data);
      if (res.data.errors.length > 0) {
        toast.error(`${res.data.errors.length} problema(s) — nada será lançado até corrigir`);
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Não consegui ler a planilha');
      setFile(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setAnalysis(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async (payload: ReturnRow[], onDone: () => void) => {
    setSaving(true);
    try {
      const res = await returnsApi.submit(payload);
      const { returned_to_stock, not_returned } = res.data;
      toast.success(
        `${returned_to_stock} linha(s) voltaram ao estoque` +
        (not_returned ? ` · ${not_returned} registrada(s) sem retorno` : ''),
      );
      // O estoque mudou: invalida o que a tela de Estoque usa.
      qc.invalidateQueries('stock');
      qc.invalidateQueries('inventory');
      onDone();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail?.errors) {
        setManualErrors(detail.errors);
        toast.error('Nada foi lançado — veja os problemas listados');
      } else {
        toast.error(typeof detail === 'string' ? detail : 'Erro ao lançar devoluções');
      }
    } finally {
      setSaving(false);
    }
  };

  const submitFile = () => {
    if (!analysis) return;
    const payload: ReturnRow[] = analysis.rows.map(r => ({
      seller_id: r.seller_id,
      seller_name: r.seller_name,
      nf_number: r.nf_number,
      sku: r.sku,
      quantity: r.quantity,
      returns_stock: r.returns_stock,
      reason: r.reason,
    }));
    submit(payload, clearFile);
  };

  const submitManual = () => {
    setManualErrors([]);
    const preenchidas = rows.filter(r => r.seller_id || r.nf_number.trim() || r.sku.trim());
    if (preenchidas.length === 0) { toast.error('Nenhuma linha preenchida'); return; }
    const payload: ReturnRow[] = preenchidas.map(r => ({
      seller_id: r.seller_id,
      nf_number: r.nf_number.trim(),
      sku: r.sku.trim(),
      quantity: r.quantity.trim() === '' ? null : Number(r.quantity),
      returns_stock: r.returns_stock,
      reason: r.reason.trim(),
    }));
    submit(payload, () => setRows([emptyRow()]));
  };

  const okCount = analysis ? analysis.rows.length : 0;

  // Quais linhas travaram: os erros vêm rotulados ("Linha 4: ..."), então a
  // tabela consegue apontar exatamente onde está o problema. Sem isso a pessoa
  // lê "Linha 4" na lista de cima e tem que contar as linhas na mão.
  const errorLines = useMemo(() => {
    const set = new Set<number>();
    (analysis?.errors ?? []).forEach(e => {
      const m = e.match(/^Linha (\d+):/);
      if (m) set.add(Number(m[1]));
    });
    return set;
  }, [analysis]);

  return (
    <div>
      <PageHeader
        title="Devoluções"
        subtitle="Mercadoria que voltou do cliente — o que retorna entra no estoque na hora do lançamento"
        icon={<Undo2 size={18} />}
      />

      <div className="p-6 space-y-6">

        {/* ── Planilha ───────────────────────────────────────────────────── */}
        <section className="bg-surface rounded-2xl border border-line-soft p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold text-t1">Subir planilha</h2>
              <p className="text-xs text-t4 mt-0.5">
                Baixe o modelo, preencha e suba. Nada é lançado antes de você conferir.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 border border-line rounded-lg hover:bg-surface-2 transition"
              >
                <Download size={14} /> Baixar modelo
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition"
              >
                <Upload size={14} /> Escolher arquivo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAnalyze(f); }}
              />
            </div>
          </div>

          {analyzing && <p className="text-sm text-t4">Conferindo a planilha...</p>}

          {file && analysis && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-t3">
                <FileSpreadsheet size={14} className="text-violet-400" />
                <span className="truncate">{file.name}</span>
                <span className="text-t5">·</span>
                <span>{analysis.total} linha(s)</span>
                <span className="text-t5">·</span>
                <span className="text-ok">{analysis.returning} voltam ao estoque</span>
                <span className="text-t5">·</span>
                <span className="text-t4">{analysis.not_returning} não voltam</span>
                <button onClick={clearFile} className="ml-auto p-1 text-t4 hover:text-t2 rounded">
                  <X size={14} />
                </button>
              </div>

              {analysis.errors.length > 0 && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-bad">
                    <AlertTriangle size={14} />
                    {analysis.errors.length} problema(s) — nada será lançado
                  </p>
                  <ul className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {analysis.errors.map((e, i) => (
                      <li key={i} className="text-xs text-t3">• {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-line-soft">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-t4" style={{ background: 'rgb(var(--surface-2))' }}>
                      <th className="px-3 py-2 w-12">#</th>
                      <th className="px-3 py-2">Seller</th>
                      <th className="px-3 py-2">NF</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2 w-20">Qtd</th>
                      <th className="px-3 py-2 w-28">Estoque</th>
                      <th className="px-3 py-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rows.map(r => {
                      const ruim = errorLines.has(r.line ?? -1);
                      return (
                      <tr key={r.line}
                          className={`border-t border-line-soft ${ruim ? 'bg-red-500/10' : ''}`}>
                        <td className="px-3 py-2 text-t5 text-xs">{r.line}</td>
                        <td className="px-3 py-2 text-t3">{r.seller_name || <span className="text-bad">—</span>}</td>
                        <td className="px-3 py-2 text-t3 font-mono text-xs">{r.nf_number}</td>
                        <td className="px-3 py-2 text-t3 font-mono text-xs">{r.sku}</td>
                        <td className="px-3 py-2 text-t4 text-xs">{r.product_name || '—'}</td>
                        <td className="px-3 py-2 text-t2">{r.quantity ?? '—'}</td>
                        <td className="px-3 py-2">
                          {r.returns_stock === true && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-ok">Volta</span>
                          )}
                          {r.returns_stock === false && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-t4">Não volta</span>
                          )}
                          {r.returns_stock === null && <span className="text-bad text-xs">inválido</span>}
                        </td>
                        <td className="px-3 py-2 text-t4 text-xs">{r.reason || '—'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={submitFile}
                  disabled={!analysis.can_submit || saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={14} /> {saving ? 'Lançando...' : `Lançar ${okCount} linha(s)`}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Tabelinha ──────────────────────────────────────────────────── */}
        <section className="bg-surface rounded-2xl border border-line-soft p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-t1">Lançar direto</h2>
            <p className="text-xs text-t4 mt-0.5">
              Cada linha nova já vem com o seller e a NF da anterior — troque quando precisar.
            </p>
          </div>

          {manualErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-bad">
                <AlertTriangle size={14} /> Nada foi lançado
              </p>
              <ul className="mt-2 space-y-0.5">
                {manualErrors.map((e, i) => <li key={i} className="text-xs text-t3">• {e}</li>)}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-t4">
                  <th className="px-2 py-2 min-w-[180px]">Seller</th>
                  <th className="px-2 py-2 min-w-[120px]">NF</th>
                  <th className="px-2 py-2 min-w-[220px]">SKU</th>
                  <th className="px-2 py-2 w-24">Qtd</th>
                  <th className="px-2 py-2 w-40">Estoque</th>
                  <th className="px-2 py-2 min-w-[180px]">Motivo</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="align-top">
                    <td className="px-2 py-1.5">
                      <select
                        value={r.seller_id ?? ''}
                        onChange={e => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          // Trocar de seller invalida o SKU escolhido — ele é
                          // de outro catálogo e passaria a apontar para nada.
                          patch(r.key, { seller_id: id, sku: '', product_name: '' });
                        }}
                        className={inputCls}
                        style={inputStyle}
                      >
                        <option value="">Selecionar...</option>
                        {(sellers as any[]).map(s => (
                          <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.nf_number}
                        onChange={e => patch(r.key, { nf_number: e.target.value })}
                        placeholder="NF"
                        className={inputCls}
                        style={inputStyle}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <SkuPicker
                        sellerId={r.seller_id}
                        sku={r.sku}
                        productName={r.product_name}
                        onPick={(sku, name) => patch(r.key, { sku, product_name: name })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={1}
                        value={r.quantity}
                        onChange={e => patch(r.key, { quantity: e.target.value })}
                        className={inputCls}
                        style={inputStyle}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex rounded-lg border border-line overflow-hidden">
                        <button
                          type="button"
                          onClick={() => patch(r.key, { returns_stock: true })}
                          className={`flex-1 px-2 py-1.5 text-xs transition ${
                            r.returns_stock ? 'bg-emerald-500/20 text-ok font-semibold' : 'text-t4 hover:bg-surface-2'
                          }`}
                        >
                          Volta
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(r.key, { returns_stock: false })}
                          className={`flex-1 px-2 py-1.5 text-xs transition ${
                            !r.returns_stock ? 'bg-violet-600/25 text-t1 font-semibold' : 'text-t4 hover:bg-surface-2'
                          }`}
                        >
                          Não volta
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.reason}
                        onChange={e => patch(r.key, { reason: e.target.value })}
                        placeholder={r.returns_stock ? '—' : 'opcional'}
                        disabled={r.returns_stock}
                        className={`${inputCls} disabled:opacity-40`}
                        style={inputStyle}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => removeRow(r.key)}
                        className="p-1.5 text-t4 hover:text-bad hover:bg-red-500/10 rounded-lg transition"
                        title="Remover linha"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-t2 border border-line rounded-lg hover:bg-surface-2 transition"
            >
              <Plus size={14} /> Adicionar linha
            </button>
            <button
              onClick={submitManual}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-40"
            >
              <Check size={14} /> {saving ? 'Lançando...' : 'Lançar devoluções'}
            </button>
          </div>
        </section>

        <p className="text-xs text-t5">
          O que retorna vira uma entrada de estoque com a data de hoje e fica visível para o seller no
          portal. O que não retorna não mexe no estoque — fica registrado na Trilha de Auditoria.
        </p>
      </div>
    </div>
  );
}
