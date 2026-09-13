/**
 * WMS Kiwkiw - Aba "Insumos" do Portal do Seller (13/09/2026)
 * ============================================================
 * Material sem código de barras (adesivo, cartão, caixa própria...) que o
 * seller manda pra Kiwkiw usar no próprio pedido. Não dá pra bipar, então o
 * saldo aqui é uma ESTIMATIVA calculada pelas regras que o próprio seller
 * define — NUNCA uma contagem física. O aviso abaixo é fixo de propósito.
 *
 * As 4 caixas próprias (Própria P/M/G, Próprio Saco de Embarque) nascem
 * TRAVADAS: nome e regra fixos (o servidor recusa mudar), só a quantidade/data
 * das entradas fica editável — precisa bater com o que quem bipa vê no botão.
 *
 * Duas sub-abas, mesmo espírito de Estoque/Movimentações (14/09/2026):
 *   - Resumo:     UMA TABELA (mesmo formato da tela de Estoque, a pedido do
 *                 dono do sistema em 14/09/2026), com botão "Lançar" em toda
 *                 linha — resolve o problema de "achar onde lançar" sem
 *                 precisar abrir nada. Nome expande regras + histórico.
 *   - Movimentos: extrato único com TODAS as entradas e todo o consumo
 *                 estimado por pedido, de todos os insumos juntos.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  AlertTriangle, Plus, Trash2, Pencil, Lock, X, ChevronDown, ChevronUp,
  PackagePlus, List as ListIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  clientSuppliesApi, cadastrosApi, ClientSupply, ClientSupplyRule, SupplyRuleType,
} from '../api';
import { todayBrasiliaStr } from '../timezone';

const inputCls =
  'w-full px-2.5 py-1.5 border border-line rounded-lg text-sm text-t2 outline-none focus:ring-2 focus:ring-violet-500 placeholder-t5';
const inputStyle = { background: 'rgb(var(--surface-2))' };

const RULE_LABEL: Record<SupplyRuleType, string> = {
  PER_ORDER: 'Todo pedido consome',
  SKU_OCCURRENCE: 'Se o SKU sair no pedido, consome',
  SKU_QUANTITY: 'Por unidade do SKU enviada, consome',
  BOX_OCCURRENCE: 'Toda vez que essa caixa é usada, consome',
};

const brDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Seletor de SKU (busca no servidor, 30 por vez) — mesmo padrão de Devoluções. */
function SkuPicker({ sellerId, value, onPick }: { sellerId: number; value: string; onPick: (sku: string) => void }) {
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
      if (boxRef.current?.contains(alvo) || panelRef.current?.contains(alvo)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

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

  const { data } = useQuery(
    ['supply-products', sellerId, debounced],
    () => cadastrosApi.products({ seller_id: sellerId, search: debounced || undefined, active_only: true, page: 1, page_size: 30 }).then(r => r.data),
    { enabled: open, keepPreviousData: true },
  );
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setAnchor({ top: r.bottom + 4, left: r.left });
          setTerm('');
          setOpen(o => !o);
        }}
        className={`${inputCls} text-left truncate ${value ? 'text-t2' : 'text-t5'}`}
        style={inputStyle}
      >
        {value || 'Selecionar SKU...'}
      </button>
      {open && anchor && createPortal(
        <div
          ref={panelRef}
          className="z-50 w-[360px] max-w-[80vw] rounded-xl border border-line shadow-xl p-2"
          style={{ background: 'rgb(var(--surface))', position: 'fixed', top: anchor.top, left: anchor.left }}
        >
          <input
            autoFocus
            className={inputCls}
            style={inputStyle}
            placeholder="Buscar SKU ou nome..."
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto mt-2 space-y-0.5">
            {items.length === 0 && <p className="text-xs text-t5 px-2 py-3 text-center">Nenhum produto encontrado</p>}
            {items.map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onPick(p.sku); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-t2 hover:bg-surface-2 truncate"
              >
                <span className="font-semibold">{p.sku}</span> — {p.name}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Bloco de regra (tipo + SKU condicional + quantidade) — reaproveitado na criação e no card. */
function RuleBuilder({
  sellerId, ruleType, setRuleType, ruleSku, setRuleSku, ruleQty, setRuleQty, compact,
}: {
  sellerId: number;
  ruleType: SupplyRuleType;
  setRuleType: (v: SupplyRuleType) => void;
  ruleSku: string;
  setRuleSku: (v: string) => void;
  ruleQty: string;
  setRuleQty: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div className={compact ? 'w-56' : 'flex-1 min-w-[220px]'}>
        {!compact && <label className="text-[10px] text-t5 uppercase tracking-wide">Regra de consumo</label>}
        <select value={ruleType} onChange={e => setRuleType(e.target.value as SupplyRuleType)} className={inputCls} style={inputStyle}>
          <option value="PER_ORDER">Todo pedido consome</option>
          <option value="SKU_OCCURRENCE">Se o SKU sair no pedido, consome</option>
          <option value="SKU_QUANTITY">Por unidade do SKU enviada, consome</option>
        </select>
      </div>
      {ruleType !== 'PER_ORDER' && (
        <div className="w-52">
          {!compact && <label className="text-[10px] text-t5 uppercase tracking-wide">SKU</label>}
          <SkuPicker sellerId={sellerId} value={ruleSku} onPick={setRuleSku} />
        </div>
      )}
      <div className="w-20">
        {!compact && <label className="text-[10px] text-t5 uppercase tracking-wide">Qtd</label>}
        <input type="number" min={1} placeholder="Qtd" value={ruleQty} onChange={e => setRuleQty(e.target.value)} className={inputCls} style={inputStyle} />
      </div>
    </div>
  );
}

function RuleRow({ rule, locked, onDelete }: { rule: ClientSupplyRule; locked: boolean; onDelete: () => void }) {
  const alvo = rule.rule_type === 'BOX_OCCURRENCE' ? `caixa "${rule.box_key}"` : rule.sku ? `SKU "${rule.sku}"` : '';
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-t3 bg-surface-2 rounded-lg px-2.5 py-1.5">
      <span>{RULE_LABEL[rule.rule_type]} <b className="text-t2">{rule.quantity}</b>{alvo && <> — {alvo}</>}</span>
      {!locked && (
        <button onClick={onDelete} className="text-t5 hover:text-bad shrink-0"><Trash2 size={13} /></button>
      )}
    </div>
  );
}

/**
 * Status derivado — mesmo espírito do "Alto/Médio/Baixo/Sem Produto" da tela
 * de Estoque, adaptado a insumo (não existe "previsão de dias" real aqui,
 * é só uma leitura rápida do saldo — puramente visual, não é gravado em lugar
 * nenhum).
 */
function deriveStatus(s: ClientSupply): { label: string; cls: string } {
  if (s.total_entradas === 0 && s.consumo_estimado === 0) {
    return { label: 'Sem lançamento', cls: 'bg-surface-2 text-t5' };
  }
  if (s.saldo_estimado < 0) return { label: 'Negativo', cls: 'bg-bad-soft text-bad' };
  if (s.saldo_estimado === 0) return { label: 'Zerado', cls: 'bg-surface-2 text-t5' };
  const ratio = s.total_entradas > 0 ? s.saldo_estimado / s.total_entradas : 1;
  return ratio <= 0.2
    ? { label: 'Baixo', cls: 'bg-warn-soft text-warn' }
    : { label: 'Alto', cls: 'bg-ok-soft text-ok' };
}

function SupplyRow({ supply, sellerId }: { supply: ClientSupply; sellerId: number }) {
  const qc = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(supply.name);
  const [dateVal, setDateVal] = useState(supply.count_from_date);
  // Lançamento de entrada: um botão em toda linha, sempre visível — era o
  // ponto confuso (ficava escondido atrás de "Ver detalhes").
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryQty, setEntryQty] = useState('');
  const [entryDate, setEntryDate] = useState(todayBrasiliaStr());
  const [entryNote, setEntryNote] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleType, setRuleType] = useState<SupplyRuleType>('PER_ORDER');
  const [ruleSku, setRuleSku] = useState('');
  const [ruleQty, setRuleQty] = useState('1');

  const invalidate = () => qc.invalidateQueries(['client-supplies']);

  const mUpdate = useMutation(
    () => clientSuppliesApi.update(supply.id, { name: nameVal, count_from_date: dateVal }),
    { onSuccess: () => { invalidate(); setEditingName(false); }, onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao salvar'); } },
  );
  const mDelete = useMutation(() => clientSuppliesApi.remove(supply.id), {
    onSuccess: invalidate, onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao excluir'); },
  });
  const mAddEntry = useMutation(
    () => clientSuppliesApi.addEntry(supply.id, { quantity: Number(entryQty), entry_date: entryDate, note: entryNote }),
    {
      onSuccess: () => { invalidate(); setShowEntryForm(false); setEntryQty(''); setEntryNote(''); toast.success('Entrada lançada'); },
      onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao lançar entrada'); },
    },
  );
  const mDeleteEntry = useMutation((id: number) => clientSuppliesApi.removeEntry(id), { onSuccess: invalidate });
  const mAddRule = useMutation(
    () => clientSuppliesApi.addRule(supply.id, { rule_type: ruleType, sku: ruleSku || undefined, quantity: Number(ruleQty) }),
    {
      onSuccess: () => { invalidate(); setShowRuleForm(false); setRuleSku(''); setRuleQty('1'); },
      onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao criar regra'); },
    },
  );
  const mDeleteRule = useMutation((id: number) => clientSuppliesApi.removeRule(id), { onSuccess: invalidate });

  const status = deriveStatus(supply);
  const extraOpen = showEntryForm || showDetails;

  return (
    <>
      <tr className={`border-b border-line-soft ${supply.saldo_estimado < 0 ? 'bg-bad-soft/40' : ''}`}>
        <td className="px-3 py-2.5 min-w-[180px]">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input className={`${inputCls} py-1`} style={inputStyle} value={nameVal} onChange={e => setNameVal(e.target.value)} autoFocus />
              <button onClick={() => mUpdate.mutate()} className="text-xs font-semibold text-ok shrink-0">Salvar</button>
              <button onClick={() => { setEditingName(false); setNameVal(supply.name); }} className="text-t5 shrink-0"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setShowDetails(v => !v)} className="flex items-center gap-1.5 text-left group">
              <span className="font-bold text-t1 group-hover:text-brand transition truncate">{supply.name}</span>
              {supply.locked && <Lock size={11} className="text-t5 shrink-0" />}
              {showDetails ? <ChevronUp size={13} className="text-t5 shrink-0" /> : <ChevronDown size={13} className="text-t5 shrink-0" />}
            </button>
          )}
        </td>
        <td className="px-3 py-2.5 text-t4 whitespace-nowrap">{brDate(supply.count_from_date)}</td>
        <td className="px-3 py-2.5 text-right font-bold text-ok whitespace-nowrap">+{supply.total_entradas}</td>
        <td className="px-3 py-2.5 text-right font-bold text-bad whitespace-nowrap">-{supply.consumo_estimado}</td>
        <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${supply.saldo_estimado < 0 ? 'text-bad' : supply.saldo_estimado === 0 ? 'text-t4' : 'text-ok'}`}>
          {supply.saldo_estimado}
        </td>
        <td className="px-3 py-2.5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${status.cls}`}>{status.label}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            onClick={() => { setShowEntryForm(v => !v); setTimeout(() => qtyRef.current?.focus(), 0); }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-t1 whitespace-nowrap ml-auto"
          >
            <PackagePlus size={12} /> Lançar
          </button>
        </td>
      </tr>

      {extraOpen && (
        <tr className="border-b border-line-soft bg-surface-2/40">
          <td colSpan={7} className="px-3 py-3">
            {showEntryForm && (
              <div className="flex items-end gap-2 flex-wrap mb-3">
                <div>
                  <label className="text-[10px] text-t5 uppercase tracking-wide">Quantidade</label>
                  <input ref={qtyRef} type="number" min={1} placeholder="Qtd" value={entryQty} onChange={e => setEntryQty(e.target.value)} className={`${inputCls} w-24`} style={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-t5 uppercase tracking-wide">Data</label>
                  <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className={`${inputCls} w-36`} style={inputStyle} />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="text-[10px] text-t5 uppercase tracking-wide">Observação (opcional)</label>
                  <input placeholder="Ex: 1ª remessa" value={entryNote} onChange={e => setEntryNote(e.target.value)} className={inputCls} style={inputStyle} />
                </div>
                <button
                  disabled={!entryQty || Number(entryQty) <= 0}
                  onClick={() => mAddEntry.mutate()}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-t1 disabled:opacity-40"
                >
                  Confirmar
                </button>
                <button onClick={() => setShowEntryForm(false)} className="text-t5 hover:text-t2 px-2 py-1.5"><X size={16} /></button>
              </div>
            )}

            {showDetails && (
              <div className="space-y-4">
                {!supply.locked && (
                  <div className="flex items-center gap-1.5 text-[11px] text-t4">
                    <span>contando desde</span>
                    <input
                      type="date"
                      value={dateVal}
                      onChange={e => setDateVal(e.target.value)}
                      onBlur={() => { if (dateVal !== supply.count_from_date) mUpdate.mutate(); }}
                      className="bg-transparent border-b border-dashed border-line text-t3 outline-none"
                    />
                    <button onClick={() => setEditingName(true)} className="text-t5 hover:text-t2 ml-2"><Pencil size={12} /></button>
                    <button onClick={() => { if (confirm(`Excluir "${supply.name}"?`)) mDelete.mutate(); }} className="text-t5 hover:text-bad"><Trash2 size={12} /></button>
                  </div>
                )}

                {/* Histórico de entradas */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-t5 mb-1.5">Entradas recebidas</p>
                  <div className="space-y-1">
                    {supply.entries.length === 0 && <p className="text-xs text-t5 italic">Nenhuma entrada lançada ainda</p>}
                    {supply.entries.map(en => (
                      <div key={en.id} className="flex items-center justify-between text-xs text-t3 bg-surface rounded-lg px-2.5 py-1.5">
                        <span>
                          <b className="text-t2">{en.quantity}</b> un. em {brDate(en.entry_date)}
                          {en.note && <span className="text-t5"> — {en.note}</span>}
                        </span>
                        <button onClick={() => mDeleteEntry.mutate(en.id)} className="text-t5 hover:text-bad shrink-0"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Regras */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-t5">Regras de consumo</p>
                    {!supply.locked && (
                      <button onClick={() => setShowRuleForm(v => !v)} className="text-brand hover:text-brand/80"><Plus size={14} /></button>
                    )}
                  </div>
                  {showRuleForm && !supply.locked && (
                    <div className="mb-2">
                      <RuleBuilder sellerId={sellerId} ruleType={ruleType} setRuleType={setRuleType} ruleSku={ruleSku} setRuleSku={setRuleSku} ruleQty={ruleQty} setRuleQty={setRuleQty} compact />
                      <button
                        disabled={ruleType !== 'PER_ORDER' && !ruleSku}
                        onClick={() => mAddRule.mutate()}
                        className="mt-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-t1 disabled:opacity-40"
                      >
                        Adicionar regra
                      </button>
                    </div>
                  )}
                  <div className="space-y-1">
                    {supply.rules.map(r => (
                      <RuleRow key={r.id} rule={r} locked={supply.locked} onDelete={() => mDeleteRule.mutate(r.id)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Sub-aba Movimentos ───────────────────────────────────────────────────────

function MovementsPanel({ sellerId }: { sellerId: number }) {
  const { data, isLoading } = useQuery(
    ['client-supplies-movements', sellerId],
    () => clientSuppliesApi.movements().then(r => r.data),
  );
  const movs = data ?? [];

  if (isLoading) return <div className="text-sm text-t4 py-8 text-center">Carregando...</div>;
  if (movs.length === 0) return <p className="text-sm text-t5 italic text-center py-8">Nenhum movimento ainda.</p>;

  return (
    <div className="bg-surface border border-line-soft rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-t5 uppercase tracking-wide border-b border-line-soft">
              <th className="px-3 py-2 font-bold">Data</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Insumo</th>
              <th className="px-3 py-2 font-bold text-right">Qtd</th>
              <th className="px-3 py-2 font-bold">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {movs.map((m, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <td className="px-3 py-2 text-t3 whitespace-nowrap">{brDate(m.movement_date)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.type === 'entrada' ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-t4'}`}>
                    {m.type === 'entrada' ? 'Entrada' : 'Consumo'}
                  </span>
                </td>
                <td className="px-3 py-2 text-t2 font-semibold">{m.supply_name}</td>
                <td className={`px-3 py-2 text-right font-bold ${m.type === 'entrada' ? 'text-ok' : 'text-bad'}`}>
                  {m.type === 'entrada' ? '+' : '-'}{m.quantity}
                </td>
                <td className="px-3 py-2 text-t4">
                  {m.type === 'entrada'
                    ? (m.note || '—')
                    : `NF ${m.nf_number ?? '—'}${m.rule_desc ? ` — ${m.rule_desc}` : ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Aba principal ────────────────────────────────────────────────────────────

export default function SellerSuppliesTab({ sellerId }: { sellerId: number }) {
  const [subTab, setSubTab] = useState<'resumo' | 'movimentos'>('resumo');
  const { data, isLoading } = useQuery(['client-supplies', sellerId], () => clientSuppliesApi.list().then(r => r.data));
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState(todayBrasiliaStr());
  const [newRuleType, setNewRuleType] = useState<SupplyRuleType>('PER_ORDER');
  const [newRuleSku, setNewRuleSku] = useState('');
  const [newRuleQty, setNewRuleQty] = useState('1');

  const mCreate = useMutation(
    async () => {
      const { data: created } = await clientSuppliesApi.create({ name: newName, count_from_date: newDate });
      // Regra já entra junto na criação — chamada em sequência (o insumo
      // continua criado mesmo se a regra falhar; dá pra adicionar depois).
      await clientSuppliesApi.addRule(created.id, {
        rule_type: newRuleType, sku: newRuleSku || undefined, quantity: Number(newRuleQty),
      });
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['client-supplies']);
        setShowNew(false); setNewName(''); setNewRuleType('PER_ORDER'); setNewRuleSku(''); setNewRuleQty('1');
      },
      onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao criar insumo'); qc.invalidateQueries(['client-supplies']); },
    },
  );

  const supplies = useMemo(() => data ?? [], [data]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start gap-2.5 bg-warn-soft border border-warn/30 rounded-2xl p-3.5">
        <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
        <p className="text-xs text-t2 leading-relaxed">
          <b>Este saldo é uma ESTIMATIVA</b>, calculada pelas regras que você mesmo define abaixo —
          a Kiwkiw <b>não bipa nem conta fisicamente</b> este material, porque ele não tem código de
          barras. Use como referência de quanto tempo o estoque enviado deve durar, não como
          contagem exata.
        </p>
      </div>

      <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1 w-fit">
        <button
          onClick={() => setSubTab('resumo')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${subTab === 'resumo' ? 'bg-violet-600 text-t1' : 'text-t4 hover:text-t2'}`}
        >
          <PackagePlus size={14} /> Resumo
        </button>
        <button
          onClick={() => setSubTab('movimentos')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${subTab === 'movimentos' ? 'bg-violet-600 text-t1' : 'text-t4 hover:text-t2'}`}
        >
          <ListIcon size={14} /> Movimentos
        </button>
      </div>

      {subTab === 'movimentos' ? (
        <MovementsPanel sellerId={sellerId} />
      ) : isLoading ? (
        <div className="text-sm text-t4 py-8 text-center">Carregando...</div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-t1">Meus insumos</h2>
            <button
              onClick={() => setShowNew(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-t1"
            >
              <Plus size={14} /> Novo insumo
            </button>
          </div>

          {showNew && (
            <div className="bg-surface border border-line-soft rounded-2xl p-4 space-y-3">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-[10px] text-t5 uppercase tracking-wide">Nome</label>
                  <input className={inputCls} style={inputStyle} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Adesivo Verão" />
                </div>
                <div>
                  <label className="text-[10px] text-t5 uppercase tracking-wide">Contar desde</label>
                  <input type="date" className={inputCls} style={inputStyle} value={newDate} onChange={e => setNewDate(e.target.value)} />
                </div>
              </div>
              <RuleBuilder
                sellerId={sellerId}
                ruleType={newRuleType} setRuleType={setNewRuleType}
                ruleSku={newRuleSku} setRuleSku={setNewRuleSku}
                ruleQty={newRuleQty} setRuleQty={setNewRuleQty}
              />
              <button
                disabled={!newName.trim() || (newRuleType !== 'PER_ORDER' && !newRuleSku)}
                onClick={() => mCreate.mutate()}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-t1 disabled:opacity-40"
              >
                Criar insumo
              </button>
            </div>
          )}

          {supplies.length === 0 && !showNew ? (
            <p className="text-sm text-t5 italic text-center py-8">Nenhum insumo cadastrado ainda.</p>
          ) : (
            <div className="bg-surface border border-line-soft rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-t5 uppercase tracking-wide border-b border-line-soft">
                      <th className="px-3 py-2 font-bold">Insumo</th>
                      <th className="px-3 py-2 font-bold">Contando desde</th>
                      <th className="px-3 py-2 font-bold text-right">Entradas</th>
                      <th className="px-3 py-2 font-bold text-right">Consumo</th>
                      <th className="px-3 py-2 font-bold text-right">Saldo</th>
                      <th className="px-3 py-2 font-bold">Status</th>
                      <th className="px-3 py-2 font-bold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplies.map(s => <SupplyRow key={s.id} supply={s} sellerId={sellerId} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
