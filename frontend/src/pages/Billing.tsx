/**
 * WMS Kiwkiw - Faturamento (reescrito em 31/08/2026)
 * Fechamento mensal por (seller x mês). Só admin.
 *
 * A fatura exibida é sempre o último estado salvo no servidor (cálculo no
 * backend, módulo único). Edições ficam locais até "Salvar rascunho", que
 * persiste e recarrega — evita duplicar a matemática no navegador.
 */

import { Fragment, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import toast from 'react-hot-toast';
import {
  DollarSign, Save, Download, Lock, Unlock, ArrowLeftRight, List as ListIcon,
  Plus, X, Settings2,
} from 'lucide-react';
import { billingApi, cadastrosApi, scanningApi, BillingBoxPrice, CANONICAL_BOXES } from '../api';
import { todayBrasiliaStr } from '../timezone';

const brl = (n: number | null | undefined) =>
  'R$ ' + (Number(n ?? 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PARAM_KEYS = [
  'preco_unitario', 'min_pedidos', 'manuseio_b2b', 'valor_caixa_b2b',
  'adic_produto_b2b', 'franquia_produtos_b2b',
  'limite_itens_b2b', 'tipos_caixa_inclusos', 'cota_caixas_mes', 'franquia_m3',
  'preco_m3', 'seguro_incluso', 'aliquota_seguro', 'armazenagem_inclusa',
] as const;

type Draft = {
  params: Record<string, any>;
  cubagem_m3: number;
  valor_segurado: number;
  adjustments: { descricao: string; obs: string; sign: number; valor: number }[];
  overrides: Record<number, { channel_override: string | null; b2b_adicional: number | null; note: string | null }>;
};

function draftFromPayload(p: any): Draft {
  const params: Record<string, any> = {};
  PARAM_KEYS.forEach(k => { params[k] = p.params[k]; });
  const overrides: Draft['overrides'] = {};
  // reconstrói overrides a partir das linhas (canal != auto ou adicional B2B != 0)
  [...(p.b2c_lines || []), ...(p.b2b_lines || [])].forEach((l: any) => {
    if (l.order_id == null) return;
    const channel = p.b2c_lines.includes(l) ? 'b2c' : 'b2b';
    const ov: any = {};
    if (l.auto_channel && l.auto_channel !== channel) ov.channel_override = channel;
    if (l.b2b_adicional) ov.b2b_adicional = l.b2b_adicional;   // adicional manual (B2C e B2B)
    if (l.note) ov.note = l.note;
    if (Object.keys(ov).length) overrides[l.order_id] = {
      channel_override: ov.channel_override ?? null,
      b2b_adicional: ov.b2b_adicional ?? null,
      note: ov.note ?? null,
    };
  });
  return {
    params,
    cubagem_m3: p.cubagem_m3 ?? 0,
    valor_segurado: p.valor_segurado ?? 0,
    adjustments: (p.adjustments || []).map((a: any) => ({ ...a })),
    overrides,
  };
}

export default function BillingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'seller' | 'cons'>('seller');
  const [sellerId, setSellerId] = useState<number | ''>('');
  const [refMonth, setRefMonth] = useState(() => todayBrasiliaStr().slice(0, 7));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const { data: sellers = [] } = useQuery(['sellers', 'billing'], () =>
    cadastrosApi.sellers(false).then(r => r.data));

  const closingQ = useQuery(
    ['billing-closing', sellerId, refMonth],
    () => billingApi.closing(Number(sellerId), refMonth).then(r => r.data),
    { enabled: !!sellerId, keepPreviousData: false },
  );
  const payload = closingQ.data;
  const isClosed = payload?.status === 'closed';

  useEffect(() => {
    if (payload) { setDraft(draftFromPayload(payload)); setDirty(false); setExpanded({}); }
  }, [payload]);

  const setParam = (k: string, v: any) => {
    setDraft(d => d ? { ...d, params: { ...d.params, [k]: v } } : d);
    setDirty(true);
  };
  const setField = (k: 'cubagem_m3' | 'valor_segurado', v: number) => {
    setDraft(d => d ? { ...d, [k]: v } : d); setDirty(true);
  };

  const buildBody = (d: Draft | null) => {
    if (!d) return null;
    const overrides = Object.entries(d.overrides).map(([oid, o]) => ({ order_id: Number(oid), ...o }));
    return { ...d.params, cubagem_m3: d.cubagem_m3, valor_segurado: d.valor_segurado,
      adjustments: d.adjustments, nf_overrides: overrides };
  };

  // Persiste um draft explícito (usado tanto pelo botão "Salvar rascunho" quanto
  // pelas ações que precisam de efeito imediato — troca de canal, adicional B2B).
  const persistDraft = async (d: Draft | null, okMsg: string | null) => {
    const body = buildBody(d);
    if (!body || !sellerId) return;
    setBusy(true);
    try {
      const res = await billingApi.saveClosing(Number(sellerId), refMonth, body);
      qc.setQueryData(['billing-closing', sellerId, refMonth], res.data);
      qc.invalidateQueries(['billing-consolidated']);
      setDirty(false);
      if (okMsg) toast.success(okMsg);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar');
    } finally { setBusy(false); }
  };

  const saveDraft = (silent = false) => persistDraft(draft, silent ? null : 'Rascunho salvo');

  const doAction = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.data?.status) qc.setQueryData(['billing-closing', sellerId, refMonth], res.data);
      else qc.invalidateQueries(['billing-closing', sellerId, refMonth]);
      qc.invalidateQueries(['billing-consolidated']);
      toast.success(ok);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Erro');
    } finally { setBusy(false); }
  };

  const closeMonth = async () => {
    if (dirty) await saveDraft(true);
    if (!confirm('Fechar o mês congela todos os valores. Continuar?')) return;
    await doAction(() => billingApi.closeMonth(Number(sellerId), refMonth), 'Mês fechado');
  };
  const reopen = async () => {
    if (!confirm('Reabrir volta a derivar as NFs dos dados vivos. Continuar?')) return;
    await doAction(() => billingApi.reopenMonth(Number(sellerId), refMonth), 'Mês reaberto');
  };

  // ── troca de canal / avulsos ──────────────────────────────────────────────
  const EMPTY_OV = { channel_override: null, b2b_adicional: null, note: null };

  // Troca de canal tem efeito IMEDIATO: aplica o override e já salva, para a NF
  // pular de lista na hora (não depende do botão "Salvar rascunho").
  const moveChannel = async (orderId: number, to: 'b2c' | 'b2b') => {
    if (!draft || busy) return;
    const prev = draft.overrides[orderId] || EMPTY_OV;
    const next: Draft = {
      ...draft,
      overrides: { ...draft.overrides, [orderId]: { ...prev, channel_override: to } },
    };
    setDraft(next);
    await persistDraft(next, `NF movida para ${to.toUpperCase()}`);
  };
  const setB2bAdic = async (orderId: number, v: number) => {
    if (!draft) return;
    const prev = draft.overrides[orderId] || EMPTY_OV;
    if ((prev.b2b_adicional ?? 0) === v) return;   // sem mudança, não salva à toa
    const next: Draft = {
      ...draft,
      overrides: { ...draft.overrides, [orderId]: { ...prev, b2b_adicional: v } },
    };
    setDraft(next);
    await persistDraft(next, 'Adicional B2B salvo');
  };
  const addAvulso = () => { setDraft(d => d ? { ...d, adjustments: [...d.adjustments, { descricao: '', obs: '', sign: 1, valor: 0 }] } : d); setDirty(true); };
  const setAvulso = (i: number, patch: any) => {
    setDraft(d => d ? { ...d, adjustments: d.adjustments.map((a, j) => j === i ? { ...a, ...patch } : a) } : d);
    setDirty(true);
  };
  const rmAvulso = (i: number) => { setDraft(d => d ? { ...d, adjustments: d.adjustments.filter((_, j) => j !== i) } : d); setDirty(true); };

  // Cadastra a caixa de uma NF direto da lista (mês aberto). Grava em Order.box_used
  // via o mesmo endpoint do Scanner e recarrega o fechamento para o adicional
  // recalcular ao vivo.
  const setOrderBox = async (orderId: number, box: string) => {
    if (busy) return;   // serializa a gravação — sem isso, cliques em rajada
    setBusy(true);      // disparam PATCHs concorrentes e a caixa cai na NF errada
    try {
      await scanningApi.saveOrderBox(orderId, box);
      toast.success(`Caixa ${box} cadastrada na NF`);
      // recarrega em segundo plano; não segura o botão até o refetch terminar
      qc.invalidateQueries(['billing-closing', sellerId, refMonth]);
      qc.invalidateQueries(['billing-consolidated']);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Erro ao cadastrar caixa');
    } finally { setBusy(false); }
  };

  const lock = isClosed ? 'opacity-50 pointer-events-none' : '';

  return (
    <div className="p-6 space-y-5">
      {/* topo */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-t1">Faturamento</h1>
          <p className="text-sm text-t3 mt-0.5">Fechamento mensal por seller</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-t3 mb-1">Seller</label>
            <select value={sellerId} onChange={e => setSellerId(Number(e.target.value) || '')}
              className="border border-line rounded-lg px-3 py-2 text-sm bg-surface-2 text-t1">
              <option value="">Selecione…</option>
              {sellers.map((s: any) => (
                <option key={s.id} value={s.id}>{s.trade_name || s.name}{s.active ? '' : ' (inativo)'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-t3 mb-1">Mês</label>
            <input type="month" value={refMonth} onChange={e => setRefMonth(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm bg-surface-2 text-t1" />
          </div>
          <button onClick={() => setShowCfg(true)} title="Tabela global de caixas"
            className="w-10 h-10 flex items-center justify-center rounded-lg border border-line text-t3 hover:text-violet-400">
            <Settings2 size={17} />
          </button>
        </div>
      </div>

      {/* abas */}
      <div className="flex gap-1 border-b border-line">
        {(['seller', 'cons'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t ? 'text-violet-400 border-violet-400' : 'text-t3 border-transparent'}`}>
            {t === 'seller' ? 'Fechamento do seller' : 'Consolidado do mês'}
          </button>
        ))}
      </div>

      {tab === 'cons' && <Consolidated refMonth={refMonth} onOpen={(sid) => { setSellerId(sid); setTab('seller'); }} />}

      {tab === 'seller' && !sellerId && (
        <div className="bg-surface border border-dashed border-line rounded-xl p-12 text-center">
          <DollarSign size={40} className="text-t5 mx-auto mb-3" />
          <p className="text-t4">Selecione um seller para começar o fechamento</p>
        </div>
      )}

      {tab === 'seller' && sellerId && payload && draft && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${isClosed ? 'bg-teal-900/30 text-teal-400' : 'bg-amber-900/30 text-amber-400'}`}>
              {isClosed ? '● Fechado' : '● Em aberto'}
            </span>
            {dirty && <span className="text-xs text-amber-400">alterações não salvas</span>}
          </div>

          {isClosed && (
            <div className="flex items-center justify-between gap-3 bg-teal-900/20 border border-teal-700 rounded-xl px-4 py-3 text-sm text-teal-300">
              <span className="flex items-center gap-2"><Lock size={15} />
                Mês fechado{payload.closed_at ? ` em ${payload.closed_at.slice(0, 10)}` : ''}. Valores congelados.</span>
              <button onClick={reopen} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-600 text-teal-300 text-sm">
                <Unlock size={14} /> Reabrir mês
              </button>
            </div>
          )}

          {/* PARÂMETROS */}
          <section className={`bg-surface rounded-xl border border-line-soft p-5 ${lock}`}>
            <h2 className="text-sm font-semibold text-t2 mb-1">Parâmetros de cobrança</h2>
            <p className="text-xs text-t3 mb-4">
              {isClosed
                ? `Congelados no fechamento de ${refMonth}.`
                : 'Estes valores são do seller (mesmos da aba Comercial em Sellers). Alterar aqui vale para todos os meses abertos; fechados ficam congelados.'}
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <ParamGroup title="Pedidos B2C">
                <NumRow label="Nº mínimo de pedidos" v={draft.params.min_pedidos} onChange={v => setParam('min_pedidos', v)} int />
                <NumRow label="Preço unitário / manuseio" v={draft.params.preco_unitario} onChange={v => setParam('preco_unitario', v)} />
              </ParamGroup>
              <ParamGroup title="Pedidos B2B">
                <NumRow label="Manuseio B2B" v={draft.params.manuseio_b2b} onChange={v => setParam('manuseio_b2b', v)} />
                <NumRow label="Valor caixa B2B" v={draft.params.valor_caixa_b2b} onChange={v => setParam('valor_caixa_b2b', v)} />
                <NumRow label="Adicional por produto B2B" v={draft.params.adic_produto_b2b} onChange={v => setParam('adic_produto_b2b', v)} />
                <NumRow label="Franquia de produtos (grátis)" v={draft.params.franquia_produtos_b2b} onChange={v => setParam('franquia_produtos_b2b', v)} int />
                <p className="text-[11px] text-t4">Adicional cobrado só a partir do produto seguinte à franquia (ex.: franquia 15 → cobra do 16º).</p>
              </ParamGroup>
              <ParamGroup title="Classificação B2C × B2B">
                <NumRow label="É B2B a partir de (itens)" v={draft.params.limite_itens_b2b} onChange={v => setParam('limite_itens_b2b', v)} int />
                <p className="text-[11px] text-t4 pt-1">0 = nenhuma NF vira B2B sozinha. Fora da regra, use o botão ⇄ na lista.</p>
              </ParamGroup>
              <ParamGroup title="Caixas inclusas">
                <div>
                  <div className="text-[11px] text-t3 mb-1">A · caixas sem adicional (grupo A)</div>
                  <div className="flex flex-wrap gap-1">
                    {CANONICAL_BOXES.map(k => {
                      const set = new Set(String(draft.params.tipos_caixa_inclusos || '').split(',').map((s: string) => s.trim()).filter(Boolean));
                      const on = set.has(k);
                      return (
                        <button key={k} type="button" disabled={isClosed}
                          onClick={() => {
                            on ? set.delete(k) : set.add(k);
                            setParam('tipos_caixa_inclusos', CANONICAL_BOXES.filter(b => set.has(b)).join(','));
                          }}
                          className={'px-1.5 py-0.5 rounded text-[11px] border ' + (on ? 'border-violet-400 text-violet-200 bg-violet-500/20' : 'border-line-soft text-t4')}>
                          {k}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <NumRow label="B · cota de caixas / mês" v={draft.params.cota_caixas_mes} onChange={v => setParam('cota_caixas_mes', v)} int />
                <p className="text-[11px] text-t4">Só caixas fora do grupo A consomem a cota B.</p>
              </ParamGroup>
              <ParamGroup title="Seguro">
                <ToggleRow label="Cobrar seguro?" v={draft.params.seguro_incluso} onChange={v => setParam('seguro_incluso', v)} />
                <NumRow label="Valor segurado" v={draft.valor_segurado} onChange={v => setField('valor_segurado', v)} />
                <NumRow label="Alíquota (%)" v={draft.params.aliquota_seguro} onChange={v => setParam('aliquota_seguro', v)} />
              </ParamGroup>
              <ParamGroup title="Armazenagem">
                <ToggleRow label="Armazenagem inclusa? (informativo)" v={draft.params.armazenagem_inclusa} onChange={v => setParam('armazenagem_inclusa', v)} />
                <NumRow label="Franquia grátis (m³)" v={draft.params.franquia_m3} onChange={v => setParam('franquia_m3', v)} />
                <NumRow label="Preço por m³ adicional" v={draft.params.preco_m3} onChange={v => setParam('preco_m3', v)} />
                <NumRow label="Cubagem medida do mês" v={draft.cubagem_m3} onChange={v => setField('cubagem_m3', v)} />
              </ParamGroup>
            </div>
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button onClick={() => saveDraft()} disabled={busy || !dirty}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
                <Save size={14} /> Salvar parâmetros
              </button>
              <span className="text-xs text-t3">Grava no cadastro do seller. Vale para todos os meses abertos.</span>
            </div>
          </section>

          {/* AVULSOS */}
          <section className={`bg-surface rounded-xl border border-line-soft p-5 ${lock}`}>
            <h2 className="text-sm font-semibold text-t2 mb-3">Linhas avulsas</h2>
            <div className="space-y-2">
              {draft.adjustments.map((a, i) => (
                <div key={i} className="grid grid-cols-[1.4fr_1.2fr_auto_110px_auto] gap-2 items-center">
                  <input value={a.descricao} placeholder="Descrição" onChange={e => setAvulso(i, { descricao: e.target.value })}
                    className="border border-line rounded-lg px-2 py-1.5 text-sm bg-surface-2 text-t1" />
                  <input value={a.obs} placeholder="Motivo / obs." onChange={e => setAvulso(i, { obs: e.target.value })}
                    className="border border-line rounded-lg px-2 py-1.5 text-sm bg-surface-2 text-t1" />
                  <div className="flex gap-1">
                    {[1, -1].map(s => (
                      <button key={s} onClick={() => setAvulso(i, { sign: s })}
                        className={`px-2.5 py-1.5 rounded-lg border text-sm ${a.sign === s ? 'bg-violet-600 text-white border-violet-600' : 'border-line text-t3'}`}>
                        {s > 0 ? '+' : '−'}
                      </button>
                    ))}
                  </div>
                  <input type="number" step="0.01" value={a.valor} onChange={e => setAvulso(i, { valor: Number(e.target.value) })}
                    className="border border-line rounded-lg px-2 py-1.5 text-sm text-right bg-surface-2 text-t1" />
                  <button onClick={() => rmAvulso(i)} className="text-t4 hover:text-red-400"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={addAvulso} className="mt-3 flex items-center gap-1.5 text-sm text-t3 hover:text-violet-400">
              <Plus size={14} /> Adicionar linha
            </button>
          </section>

          {/* FATURA FINAL */}
          <section className="bg-surface rounded-xl border border-line-soft p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-t2">Fatura final — {payload.seller_name} · {refMonth}</h2>
              <div className="flex gap-2">
                <button onClick={() => billingApi.downloadClosingPdf(Number(sellerId), refMonth)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-t1 text-sm"><Download size={14} /> PDF</button>
                <button onClick={() => billingApi.downloadClosingExcel(Number(sellerId), refMonth)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-t1 text-sm"><Download size={14} /> Excel</button>
                {!isClosed && (
                  <button onClick={closeMonth} disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-semibold"><Lock size={14} /> Fechar mês</button>
                )}
              </div>
            </div>
            {dirty && <p className="text-xs text-amber-400 mb-2">Salve o rascunho para atualizar os totais.</p>}
            <FaturaTable f={payload.fatura} />
            <div className="flex justify-between items-center mt-3 px-4 py-3 rounded-xl bg-t1 text-surface">
              <span className="font-semibold text-sm">TOTAL GERAL DA FATURA</span>
              <span className="font-mono font-bold text-lg">{brl(payload.fatura.total_geral)}</span>
            </div>
          </section>

          {/* LISTAS COMPLETAS (último bloco) */}
          <section className="bg-surface rounded-xl border border-line-soft p-5">
            <h2 className="text-sm font-semibold text-t2 mb-1">Notas fiscais de saída — {refMonth}</h2>
            <p className="text-[11px] text-t4 mb-3">Todas as NFs · qualquer status exceto cancelada · por data de importação</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <NfList kind="b2c" lines={payload.b2c_lines} soma={payload.soma_b2c}
                expanded={expanded} setExpanded={setExpanded} locked={isClosed} saving={busy}
                onMove={(oid: number) => moveChannel(oid, 'b2b')} onB2bAdic={setB2bAdic} onSetBox={setOrderBox} />
              <NfList kind="b2b" lines={payload.b2b_lines} soma={payload.soma_b2b}
                expanded={expanded} setExpanded={setExpanded} locked={isClosed} saving={busy}
                onMove={(oid: number) => moveChannel(oid, 'b2c')} onB2bAdic={setB2bAdic} />
            </div>
          </section>
        </div>
      )}

      {showCfg && <BoxPricesModal onClose={() => setShowCfg(false)} />}
    </div>
  );
}

// ── subcomponentes ─────────────────────────────────────────────────────────

function ParamGroup({ title, children }: any) {
  return (
    <div className="bg-surface-2 border border-line-soft rounded-xl p-3.5">
      <h3 className="text-[11px] uppercase tracking-wide text-t3 font-semibold mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function NumRow({ label, v, onChange, int }: { label: string; v: number; onChange: (v: number) => void; int?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-t2">{label}</span>
      <input type="number" step={int ? '1' : '0.01'} value={v ?? 0}
        onChange={e => onChange(int ? parseInt(e.target.value || '0') : Number(e.target.value))}
        className="w-24 text-right border border-line rounded-md px-2 py-1 text-sm bg-surface text-t1" />
    </div>
  );
}
function ToggleRow({ label, v, onChange }: { label: string; v: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-t2">{label}</span>
      <button onClick={() => onChange(!v)}
        className={`w-10 h-5 rounded-full relative transition ${v ? 'bg-violet-600' : 'bg-surface-3'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${v ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function FaturaTable({ f }: any) {
  const Row = ({ lbl, c, b, strong }: any) => (
    <div className={`grid grid-cols-[1.4fr_1fr_1fr] px-4 py-2.5 border-b border-line-soft last:border-0 ${strong ? 'font-semibold bg-surface-2' : ''}`}>
      <span className="text-t2">{lbl}</span>
      <span className="text-right font-mono text-t1">{c == null ? '—' : brl(c)}</span>
      <span className="text-right font-mono text-t1">{b == null ? '—' : brl(b)}</span>
    </div>
  );
  return (
    <div className="border border-line-soft rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] px-4 py-2 bg-surface-2 text-[11px] uppercase tracking-wide text-t4 font-semibold">
        <span>Componente</span><span className="text-right">B2C</span><span className="text-right">B2B</span>
      </div>
      <Row lbl="Mínimo mensal" c={f.b2c_min} b={f.b2b_min} />
      <Row lbl="Seguro" c={f.seguro} b={null} />
      <Row lbl="Armazenagem" c={f.armazenagem} b={null} />
      <Row lbl="Linhas avulsas" c={f.avulsos} b={null} />
      <Row lbl="Subtotal" c={f.subtotal_b2c} b={f.subtotal_b2b} strong />
      {f.min_atingiu_piso && (
        <div className="px-4 py-2 text-[11px] text-amber-400 bg-amber-900/15">
          Mínimo B2C: soma real {brl(f.soma_real_b2c)} &lt; piso {brl(f.floor_b2c)} → cobra-se o maior.
        </div>
      )}
    </div>
  );
}

function NfList({ kind, lines, soma, expanded, setExpanded, locked, saving, onMove, onB2bAdic, onSetBox, overrides }: any) {
  const b2c = kind === 'b2c';
  return (
    <div className="border border-line-soft rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-surface-2">
        <span className="text-sm font-semibold text-t2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${b2c ? 'bg-violet-900/40 text-violet-300' : 'bg-teal-900/40 text-teal-300'}`}>
            {b2c ? 'B2C' : 'B2B'}</span> &nbsp;{lines.length} NFs
        </span>
        <span className="text-[11px] text-t4">{b2c ? 'manuseio + adic. caixa + adic.' : 'manus. + caixa + ad.prod + adic.'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase text-t4">
              <th className="text-left px-2 py-1.5">Data</th>
              <th className="text-left px-2 py-1.5">NF</th>
              <th className="text-right px-2 py-1.5">Itens</th>
              {b2c ? (
                <>
                  <th className="text-right px-2 py-1.5">Cx</th>
                  <th className="text-right px-2 py-1.5">Adic. caixa</th>
                </>
              ) : (
                <>
                  <th className="text-right px-2 py-1.5">Cx B2B</th>
                  <th className="text-right px-2 py-1.5">Ad.prod</th>
                </>
              )}
              <th className="text-right px-2 py-1.5">Adic.</th>
              <th className="text-right px-2 py-1.5">Total</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any, i: number) => {
              const oid = l.order_id;
              const yellow = b2c && l.sem_caixa;
              return (
                <Fragment key={oid ?? `row-${i}`}>
                  <tr className={`border-t border-line-soft ${yellow ? 'bg-amber-900/15' : ''}`}>
                    <td className="px-2 py-1.5">{l.order_date ? l.order_date.slice(8, 10) + '/' + l.order_date.slice(5, 7) : '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{l.nf_number}</td>
                    <td className="px-2 py-1.5 text-right">{l.itens ?? '—'}</td>
                    {b2c ? (
                      <>
                        <td className="px-2 py-1.5 text-right">
                          {!locked && oid != null ? (
                            <select
                              value={l.box || ''}
                              disabled={saving}
                              onChange={e => e.target.value && onSetBox && onSetBox(oid, e.target.value)}
                              className={'border rounded px-1 py-0.5 text-[11px] bg-surface outline-none disabled:opacity-40 '
                                + (l.box ? 'border-line text-t1' : 'border-amber-500/60 text-amber-300')}
                            >
                              <option value="" disabled>—</option>
                              {l.box && !CANONICAL_BOXES.includes(l.box) && <option value={l.box}>{l.box} (antigo)</option>}
                              {CANONICAL_BOXES.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          ) : (l.box || '—')}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{brl(l.adic_caixa)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-right font-mono">{brl(l.valor_caixa_b2b || 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{brl(l.adic_produto || 0)}</td>
                      </>
                    )}
                    <td className="px-2 py-1.5 text-right font-mono">
                      <input key={`adic-${oid}-${l.b2b_adicional ?? 0}`} type="number" step="0.01"
                        disabled={locked} defaultValue={l.b2b_adicional ?? 0}
                        onBlur={e => onB2bAdic && oid != null && onB2bAdic(oid, Number(e.target.value))}
                        className="w-16 text-right border border-line rounded px-1 py-0.5 bg-surface text-t1 disabled:opacity-50" />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{brl(l.total)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => oid != null && setExpanded((x: any) => ({ ...x, [oid]: !x[oid] }))}
                        className="text-t4 hover:text-violet-400 mr-1"><ListIcon size={13} /></button>
                      {!locked && oid != null && (
                        <button onClick={() => onMove(oid)} title={b2c ? 'Mover para B2B' : 'Mover para B2C'}
                          className="text-t4 hover:text-teal-400"><ArrowLeftRight size={13} /></button>
                      )}
                    </td>
                  </tr>
                  {oid != null && expanded[oid] && l.items && (
                    <tr className="bg-surface-2">
                      <td colSpan={8} className="px-3 py-2">
                        <div className="text-[11px] text-t4 mb-1">NF {l.nf_number} · {l.items.length} SKU(s)</div>
                        {l.items.map((it: any, j: number) => (
                          <div key={`${it.sku}-${j}`} className="flex justify-between font-mono text-[11px] text-t3">
                            <span>{it.sku} — {it.name}</span><span>× {it.quantity}</span>
                          </div>
                        ))}
                        {l.note && <div className="text-[11px] text-t4 italic mt-1">{l.note}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td colSpan={6} className="px-2 py-2 text-t2">Soma {b2c ? 'B2C' : 'B2B'}</td>
              <td className="px-2 py-2 text-right font-mono text-t1">{brl(soma)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Consolidated({ refMonth, onOpen }: { refMonth: string; onOpen: (sid: number) => void }) {
  const { data } = useQuery(['billing-consolidated', refMonth], () =>
    billingApi.consolidated(refMonth).then(r => r.data));
  const rows = data?.rows || [];
  return (
    <div className="bg-surface rounded-xl border border-line-soft p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-t2">Consolidado — {refMonth}</h2>
        <div className="flex gap-2">
          <button onClick={() => billingApi.downloadConsolidatedExcel(refMonth)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-t1 text-sm"><Download size={14} /> Excel</button>
          <button onClick={() => billingApi.downloadConsolidatedZip(refMonth)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-t1 text-sm"><Download size={14} /> Todos os PDFs</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase text-t4">
            <th className="text-left px-2 py-1.5">Seller</th>
            <th className="text-right px-2 py-1.5">NFs</th>
            <th className="text-right px-2 py-1.5">B2C</th>
            <th className="text-right px-2 py-1.5">B2B</th>
            <th className="text-right px-2 py-1.5">Seguro</th>
            <th className="text-right px-2 py-1.5">Armazenagem</th>
            <th className="text-right px-2 py-1.5">Avulsos</th>
            <th className="text-right px-2 py-1.5">Total</th>
            <th className="text-left px-2 py-1.5">Situação</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.seller_id} className="border-t border-line-soft hover:bg-surface-2 cursor-pointer"
                onClick={() => onOpen(r.seller_id)}>
                <td className="px-2 py-1.5">{r.seller_name}{r.active ? '' : ' (inativo)'}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.nf_count}</td>
                <td className="px-2 py-1.5 text-right font-mono">{brl(r.b2c)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{brl(r.b2b)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{brl(r.seguro)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{brl(r.armazenagem)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{brl(r.avulsos)}</td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold">{brl(r.total)}</td>
                <td className="px-2 py-1.5">{r.status}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="px-2 py-6 text-center text-t4">Nenhum seller com NF de saída neste mês</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoxPricesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery(['billing-box-prices'], () => billingApi.boxPrices().then(r => r.data));
  const [rows, setRows] = useState<BillingBoxPrice[]>([]);
  useEffect(() => { if (data) setRows(data.prices); }, [data]);
  const save = async () => {
    try {
      await billingApi.saveBoxPrices(rows);
      qc.invalidateQueries(['billing-box-prices']);
      qc.invalidateQueries(['billing-closing']);
      toast.success('Tabela salva');
      onClose();
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Erro'); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-line max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line-soft">
          <h2 className="font-bold text-t1">Tabela global de caixas</h2>
          <button onClick={onClose} className="text-t4"><X size={18} /></button>
        </div>
        <div className="p-5">
          <p className="text-xs text-t3 mb-3">Adicional por caixa. Valor padrão — cada seller pode ter o próprio preço na aba "Caixas" do cadastro. Em branco = sem adicional.</p>
          {rows.map((r, i) => (
            <div key={r.box_key} className="flex items-center justify-between py-1.5 border-b border-line-soft last:border-0">
              <span className="font-semibold text-t2">{r.box_key}</span>
              <input type="number" step="0.01" value={r.price ?? ''} placeholder="—"
                onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, price: e.target.value === '' ? null : Number(e.target.value) } : x))}
                className="w-24 text-right border border-line rounded-md px-2 py-1 text-sm bg-surface-2 text-t1" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-line text-t2 text-sm">Cancelar</button>
          <button onClick={save} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold">Salvar tabela</button>
        </div>
      </div>
    </div>
  );
}
