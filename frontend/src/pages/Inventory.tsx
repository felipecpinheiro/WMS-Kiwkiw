/**
 * WMS Kiwkiw - Estoque
 * Posição atual, movimentações, projeção de duração e análise por SKU.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import {
  Package, TrendingDown, TrendingUp, Download, Search, Upload, FileUp,
  X, BarChart2, Calendar, ClipboardPaste, FileSpreadsheet, Pencil,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { inventoryApi, cadastrosApi, authApi } from '../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const LEVEL_CONFIG: Record<string, { label: string; color: string }> = {
  ALTO:  { label: 'Alto',  color: 'bg-violet-900/40 text-violet-300' },
  MÉDIO: { label: 'Médio', color: 'bg-amber-900/40 text-amber-300 border border-amber-500/20' },
  BAIXO: { label: 'Baixo', color: 'bg-red-900/40 text-red-300 border border-red-500/20' },
};


// ── Modal de Importação de Histórico de Estoque ───────────────────────────────
type HistoryPhase = 'upload' | 'analyzing' | 'naming' | 'importing' | 'done';

interface UnknownSku {
  sku: string;
  suggested_name: string;
  count: number;
}

function ImportHistoryModal({
  sellerId,
  onClose,
  onSuccess,
}: {
  sellerId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<HistoryPhase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<{
    total_rows: number;
    total_skus: number;
    already_registered: number;
    unknown_skus: UnknownSku[];
  } | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ imported: number; products_created: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setPhase('analyzing');
    setError(null);
    try {
      const res = await inventoryApi.analyzeHistory(sellerId, file);
      setAnalyzeResult(res.data);
      const initial: Record<string, string> = {};
      res.data.unknown_skus.forEach((u) => { initial[u.sku] = u.suggested_name || ''; });
      setNameMap(initial);
      setPhase('naming');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      setError(detail ? `[${status}] ${detail}` : `Erro de conexão: ${err?.message || 'desconhecido'}`);
      setPhase('upload');
    }
  };

  const handleImport = async () => {
    if (!file || !analyzeResult) return;
    // Validate all unknown SKUs have names
    const missing = analyzeResult.unknown_skus.filter((u) => !nameMap[u.sku]?.trim());
    if (missing.length > 0) {
      setError(`Preencha o nome de todos os SKUs não cadastrados (${missing.length} pendentes).`);
      return;
    }
    setPhase('importing');
    setError(null);
    try {
      const res = await inventoryApi.executeHistory(sellerId, file, nameMap);
      setResult(res.data);
      setPhase('done');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      setError(detail ? `[${status}] ${detail}` : `Erro de conexão: ${err?.message || 'desconhecido'}`);
      setPhase('naming');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl flex flex-col"
        style={{ background: 'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-emerald-400" />
            <span className="text-white font-semibold text-base">Upload Histórico de Estoque</span>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">✕</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto" style={{ maxHeight: '70vh' }}>

          {/* PHASE: upload */}
          {(phase === 'upload' || phase === 'analyzing') && (
            <div className="flex flex-col gap-4">
              <p className="text-white/60 text-sm leading-relaxed">
                Selecione um arquivo Excel no formato <span className="text-white font-medium">ESTOQUE SELLER</span>.
                O sistema irá ler a aba <span className="text-white font-medium">DETALHADO</span> e importar todas as
                movimentações (entradas e saídas) para o estoque do cliente selecionado.
              </p>

              <label
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/20 rounded-xl py-8 cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition"
              >
                <FileUp size={32} className="text-white/30" />
                <div className="text-center">
                  <p className="text-white/70 text-sm font-medium">
                    {file ? file.name : 'Clique para selecionar o arquivo .xlsx'}
                  </p>
                  {file && (
                    <p className="text-white/40 text-xs mt-1">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFileChange} />
              </label>

              {error && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <span className="text-red-400 text-xs leading-relaxed">{error}</span>
                </div>
              )}
            </div>
          )}

          {/* PHASE: naming unknown SKUs */}
          {(phase === 'naming' || phase === 'importing') && analyzeResult && (
            <div className="flex flex-col gap-4">
              {/* Summary banner */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-2xl font-bold text-white">{analyzeResult.total_rows.toLocaleString()}</p>
                  <p className="text-white/50 text-xs mt-0.5">Linhas no arquivo</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-2xl font-bold text-emerald-400">{analyzeResult.already_registered}</p>
                  <p className="text-white/50 text-xs mt-0.5">SKUs já cadastrados</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-2xl font-bold text-amber-400">{analyzeResult.unknown_skus.length}</p>
                  <p className="text-white/50 text-xs mt-0.5">SKUs novos</p>
                </div>
              </div>

              {analyzeResult.unknown_skus.length === 0 ? (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                  <span className="text-emerald-400 text-sm">✓ Todos os SKUs já estão cadastrados. Pode importar!</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-white/70 text-sm font-medium">
                    Defina o nome dos <span className="text-amber-400">{analyzeResult.unknown_skus.length} SKUs novos</span>:
                  </p>
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                    {analyzeResult.unknown_skus.map((u) => (
                      <div key={u.sku} className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
                        <div className="flex flex-col min-w-0 w-24">
                          <span className="text-white text-xs font-mono font-semibold truncate">{u.sku}</span>
                          <span className="text-white/30 text-xs">{u.count} mov.</span>
                        </div>
                        <input
                          className="flex-1 bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/60"
                          placeholder={u.suggested_name || 'Nome do produto...'}
                          value={nameMap[u.sku] ?? ''}
                          onChange={(e) => setNameMap((m) => ({ ...m, [u.sku]: e.target.value }))}
                          disabled={phase === 'importing'}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <span className="text-red-400 text-xs leading-relaxed">{error}</span>
                </div>
              )}
            </div>
          )}

          {/* PHASE: done */}
          {phase === 'done' && result && (
            <div className="flex flex-col gap-4 items-center py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(46,158,107,0.15)' }}>
                <span className="text-4xl">✓</span>
              </div>
              <p className="text-white font-semibold text-lg">Importação concluída!</p>
              <div className="grid grid-cols-2 gap-3 w-full">
                <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-3xl font-bold text-emerald-400">{result.imported}</p>
                  <p className="text-white/50 text-xs mt-1">Movimentações importadas</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-3xl font-bold text-blue-400">{result.products_created}</p>
                  <p className="text-white/50 text-xs mt-1">Produtos criados</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="text-red-400 text-xs font-semibold mb-1">Avisos ({result.errors.length}):</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-white/50 text-xs">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Analyzing spinner */}
          {phase === 'analyzing' && (
            <div className="flex items-center justify-center gap-3 py-4">
              <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-white/60 text-sm">Analisando arquivo...</span>
            </div>
          )}

          {/* Importing spinner */}
          {phase === 'importing' && (
            <div className="flex items-center justify-center gap-3 py-4">
              <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-white/60 text-sm">Importando movimentações...</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          {phase === 'done' ? (
            <button
              onClick={onSuccess}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#2E9E6B,#1B7A50)' }}
            >
              Concluir
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={phase === 'analyzing' || phase === 'importing'}
                className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 transition disabled:opacity-40"
              >
                Cancelar
              </button>

              {phase === 'upload' && (
                <button
                  onClick={handleAnalyze}
                  disabled={!file}
                  className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#2E9E6B,#1B7A50)' }}
                >
                  Analisar Arquivo
                </button>
              )}

              {phase === 'naming' && (
                <button
                  onClick={handleImport}
                  className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#2E9E6B,#1B7A50)' }}
                >
                  Importar Histórico
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal de Lançamento Manual ────────────────────────────────
interface MovementForm {
  movement_date: string;
  sku: string;
  movement_type: string;
  quantity: number;
  nf_number: string;
  observation: string;
}

// Estilo reutilizável para inputs do tema escuro
const inputCls = "w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white/80 placeholder-white/25";
const inputStyle: React.CSSProperties = { background: '#14122A', colorScheme: 'dark' };

function ManualMovementModal({
  sellerId,
  onClose,
  onSuccess,
}: {
  sellerId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<MovementForm>({
    defaultValues: {
      movement_date: format(new Date(), 'yyyy-MM-dd'),
      movement_type: 'Entrada',
      quantity: 1,
      nf_number: '',
      observation: '',
      sku: '',
    },
  });


  // ── SKU auto-lookup ─────────────────────────────────────────────────
  const skuVal = watch('sku');
  const [skuInfo, setSkuInfo] = useState<{ found: boolean; name?: string } | null>(null);
  const [skuLoading, setSkuLoading] = useState(false);

  useEffect(() => {
    const sku = skuVal?.trim();
    if (!sku) { setSkuInfo(null); return; }
    const timer = setTimeout(async () => {
      setSkuLoading(true);
      try {
        const res = await inventoryApi.skuLookup(sellerId, sku);
        setSkuInfo(res.data);
      } catch { setSkuInfo({ found: false }); }
      finally { setSkuLoading(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [skuVal, sellerId]);

  const skuNotFound = skuInfo !== null && !skuInfo.found;
  const onSubmit = async (data: MovementForm) => {
    if (skuNotFound) { toast.error('SKU não cadastrado. Cadastre o produto primeiro.'); return; }
    try {
      await inventoryApi.manualMovement({
        seller_id: sellerId,
        sku: data.sku.trim(),
        product_name: skuInfo?.name || data.sku.trim(),
        movement_date: data.movement_date,
        movement_type: data.movement_type,
        quantity: Number(data.quantity),
        nf_number: data.nf_number || null,
        observation: data.observation || null,
      });
      toast.success('Movimentação registrada!');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao registrar movimentação');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-base font-semibold text-white">Lançamento Manual de Estoque</h2>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/50 mb-1">Data *</label>
              <input type="date" {...register('movement_date', { required: true })}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Tipo *</label>
              <select {...register('movement_type', { required: true })}
                className={inputCls} style={inputStyle}>
                <option value="Entrada">Entrada</option>
                <option value="Saída">Saída</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">SKU *</label>
            <div className="relative">
              <input {...register('sku', { required: true })} placeholder="Ex: SKU-001"
                className={`${inputCls} ${skuNotFound ? 'border-red-500/60' : skuInfo?.found ? 'border-teal-500/40' : ''}`}
                style={inputStyle} />
              {skuLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/35 animate-pulse">buscando...</span>}
            </div>
            {skuInfo?.found && <p className="text-xs mt-1 font-medium" style={{ color: '#3DD9A4' }}>✓ {skuInfo.name}</p>}
            {skuNotFound && <p className="text-xs mt-1 text-red-400">⚠ SKU não cadastrado — cadastre em Produtos antes de lançar.</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/50 mb-1">Quantidade *</label>
              <input type="number" min="1" {...register('quantity', { required: true, min: 1 })}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">NF</label>
              <input {...register('nf_number')} placeholder="Número da NF"
                className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">Observação</label>
            <input {...register('observation')} placeholder="Opcional"
              className={inputCls} style={inputStyle} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-sm border border-white/12 rounded-lg text-white/60 hover:bg-white/4 transition">
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting || skuNotFound || skuLoading}
              className="flex-1 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-60 transition">
              {isSubmitting ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ── Modal de Edição de Movimentação (admin + senha) ─────────────────────────

function EditMovementModal({
  movement,
  onClose,
  onSuccess,
}: {
  movement: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [phase, setPhase] = useState<'password' | 'edit'>('password');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);  // aguardando resposta do backend
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    movement_date: movement.movement_date?.slice(0, 10) ?? '',
    movement_type: movement.movement_type ?? 'Saída',
    quantity: String(movement.quantity ?? 1),
    nf_number: movement.nf_number ?? '',
    observation: movement.observation ?? '',
  });

  /**
   * Verifica a senha IMEDIATAMENTE no backend antes de abrir o formulário.
   * O acesso é barrado aqui mesmo, sem abrir a janela de edição.
   */
  const checkPassword = async () => {
    if (!password.trim()) { toast.error('Informe a senha de supervisão'); return; }
    setVerifying(true);
    try {
      await inventoryApi.verifyPassphrase(password);
      // Senha correta → libera o formulário de edição
      setPhase('edit');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        toast.error('❌ Senha incorreta. Acesso negado.');
      } else {
        toast.error('Erro ao verificar senha. Tente novamente.');
      }
      setPassword('');
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await inventoryApi.updateMovement(movement.id, {
        ...form,
        quantity: Number(form.quantity),
        passphrase: password,
      });
      toast.success('Movimentação atualizada!');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao atualizar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-base font-semibold text-white">
            {phase === 'password' ? 'Autenticação de Supervisão' : 'Editar Movimentação'}
          </h2>
          <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
        </div>

        {phase === 'password' ? (
          <div className="p-5 space-y-4">
            <p className="text-xs text-white/50">
              Informe a senha de supervisão para editar esta movimentação.
              A senha é verificada imediatamente — acesso negado se incorreta.
            </p>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !verifying && checkPassword()}
              placeholder="Senha de supervisão"
              className={inputCls} style={inputStyle}
              autoFocus
              disabled={verifying}
            />
            <div className="flex gap-3">
              <button onClick={onClose} disabled={verifying}
                className="flex-1 py-2 text-sm border border-white/12 rounded-lg text-white/60 hover:bg-white/4 transition disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={checkPassword} disabled={verifying || !password.trim()}
                className="flex-1 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-500 transition disabled:opacity-60 flex items-center justify-center gap-2">
                {verifying
                  ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verificando...</>
                  : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Data</label>
                <input type="date" value={form.movement_date}
                  onChange={e => setForm(f => ({ ...f, movement_date: e.target.value }))}
                  className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Tipo</label>
                <select value={form.movement_type}
                  onChange={e => setForm(f => ({ ...f, movement_type: e.target.value }))}
                  className={inputCls} style={inputStyle}>
                  <option>Entrada</option>
                  <option>Saída</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Quantidade</label>
              <input type="number" min="1" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">NF</label>
              <input value={form.nf_number}
                onChange={e => setForm(f => ({ ...f, nf_number: e.target.value }))}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Observação</label>
              <input value={form.observation}
                onChange={e => setForm(f => ({ ...f, observation: e.target.value }))}
                className={inputCls} style={inputStyle} />
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2 text-sm border border-white/12 rounded-lg text-white/60 hover:bg-white/4 transition">Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 disabled:opacity-60 transition">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modal de Análise do SKU ───────────────────────────────────
function SkuDetailModal({
  sellerId,
  sku,
  onClose,
}: {
  sellerId: number;
  sku: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState(90);

  const { data, isLoading } = useQuery(
    ['sku-history', sellerId, sku, days],
    () => inventoryApi.skuHistory(sellerId, sku, days).then(r => r.data),
    { keepPreviousData: true }
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/8 sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-base font-semibold text-white font-mono">{sku}</h2>
            <p className="text-xs text-white/35 mt-0.5">{data?.product_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              className="border border-white/12 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500">
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>180 dias</option>
            </select>
            <button onClick={onClose} className="text-white/35 hover:text-white/60"><X size={18} /></button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-white/35 text-sm">Carregando...</div>
        ) : data ? (
          <div className="p-5 space-y-5">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Saldo Atual', value: data.current_stock, color: 'text-white', unit: '' },
                { label: 'Média Diária (60d)', value: data.avg_daily_sales_60d, color: 'text-blue-600', unit: '/dia' },
                { label: 'Total Saídas Período', value: data.total_sales_period, color: 'text-red-500', unit: '' },
                {
                  label: 'Projeção Duração',
                  value: data.days_remaining != null ? data.days_remaining : '∞',
                  color: data.days_remaining != null && data.days_remaining < 30 ? 'text-red-500' : 'text-violet-400',
                  unit: data.days_remaining != null ? ' dias' : '',
                },
              ].map(k => (
                <div key={k.label} className="bg-white/4 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}{k.unit}</p>
                </div>
              ))}
            </div>

            {/* Gráfico de barras: saídas por dia */}
            {data.chart_data && data.chart_data.length > 0 ? (
              <div>
                <p className="text-xs text-white/50 font-medium mb-3">Saídas e Entradas por Dia</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.chart_data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="entradas" name="Entradas" fill="#7B63E8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-sm text-white/35 py-8">Sem movimentações no período</p>
            )}

            {/* Alerta de ruptura */}
            {data.days_remaining != null && data.days_remaining < 15 && (
              <div className="bg-red-900/25 border border-red-500/20 rounded-xl p-3 text-sm text-red-300">
                ⚠️ Atenção: com a média atual, o estoque se esgota em <strong>{data.days_remaining} dias</strong>.
                Considere reabastecer.
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-sm text-white/35 py-10">Nenhum dado encontrado para este SKU.</p>
        )}
      </div>
    </div>
  );
}



// ── Modal de Colar Movimentações em Lote ────────────────────────────────────
// Colunas: Data | Tipo | SKU | Quantidade | NF | Observação
// - Sem combobox (Tipo é texto livre)
// - Sem calendário (Data é texto livre AAAA-MM-DD)
// - Coluna Produto removida: preenchida automaticamente pelo backend via cadastro de produtos
// - Valida SKUs não cadastrados antes de salvar

const MOV_HEADERS = ['Data (DD/MM/AAAA)', 'Tipo (Entrada ou Saida)', 'SKU', 'Quantidade', 'NF', 'Observação'];
const MOV_ROWS = 20;
const MOV_COLS = MOV_HEADERS.length;

/**
 * Normaliza o tipo de movimentação removendo acentos.
 * "Saída" / "saída" → "Saida" | "Entrada" / "entrada" → "Entrada"
 * Qualquer outro valor é retornado sem modificação.
 */
function normalizeType(tipo: string): string {
  const t = tipo.trim();
  if (/^sa[ií]da$/i.test(t)) return 'Saida';
  if (/^entrada$/i.test(t))   return 'Entrada';
  return t;
}
// Índices das colunas
const COL_DATE = 0;
const COL_TYPE = 1;
const COL_SKU  = 2;
const COL_QTY  = 3;
const COL_NF   = 4;
const COL_OBS  = 5;

function PasteMovementsModal({
  sellerId,
  onClose,
  onSuccess,
}: { sellerId: number; onClose: () => void; onSuccess: () => void }) {
  const today = format(new Date(), 'dd/MM/yyyy');        // Formato visual DD/MM/AAAA
  const todayIso = format(new Date(), 'yyyy-MM-dd');     // ISO para envio ao backend

  /**
   * Converte DD/MM/AAAA → AAAA-MM-DD para envio ao backend.
   * Se a entrada já estiver em ISO ou for inválida, retorna como está.
   */
  const toIso = (ddmmyyyy: string): string => {
    const parts = ddmmyyyy.split('/');
    if (parts.length === 3 && parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return ddmmyyyy; // fallback: repassa como está (ex.: já ISO)
  };

  const emptyGrid = () => Array(MOV_ROWS).fill(null).map(() => Array(MOV_COLS).fill(''));
  const [grid, setGrid] = useState<string[][]>(emptyGrid);
  const [saving, setSaving] = useState(false);
  // Estado de validação: null = não validado, Map sku→found
  const [skuStatus, setSkuStatus] = useState<Map<string, boolean> | null>(null);
  const [validating, setValidating] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const setCell = (r: number, c: number, val: string) => {
    setSkuStatus(null); // reset validação ao editar
    setGrid(prev => {
      const next = prev.map(row => [...row]);
      next[r][c] = val;
      return next;
    });
  };

  // Paste handler: splits Excel/Sheets tab-separated paste into the grid
  const handlePaste = (e: React.ClipboardEvent, startR: number, startC: number) => {
    e.preventDefault();
    setSkuStatus(null);
    const text = e.clipboardData.getData('text/plain');
    const rows = text.split('\n').map(row => row.split('\t'));
    setGrid(prev => {
      const next = prev.map(row => [...row]);
      rows.forEach((row, dr) => {
        row.forEach((val, dc) => {
          const r = startR + dr;
          const c = startC + dc;
          if (r < MOV_ROWS && c < MOV_COLS) {
            next[r][c] = val.trim();
          }
        });
      });
      return next;
    });
  };

  // Linhas válidas: SKU + Quantidade preenchidos
  const validRows = grid.filter(r => r[COL_SKU].trim() && r[COL_QTY].trim());

  /**
   * Valida todos os SKUs únicos das linhas válidas consultando o backend.
   * Retorna um Map sku→boolean (true = cadastrado).
   */
  const validateSkus = async (): Promise<Map<string, boolean>> => {
    const uniqueSkus = [...new Set(validRows.map(r => r[COL_SKU].trim()).filter(Boolean))];
    const result = new Map<string, boolean>();
    await Promise.all(
      uniqueSkus.map(async (sku) => {
        try {
          const res = await inventoryApi.skuLookup(sellerId, sku);
          result.set(sku, res.data.found);
        } catch {
          result.set(sku, false);
        }
      })
    );
    return result;
  };

  const handleSave = async () => {
    if (validRows.length === 0) { toast.error('Nenhuma linha válida (SKU + Quantidade obrigatórios)'); return; }

    // ── 1. Valida SKUs ────────────────────────────────────────────────────────
    setValidating(true);
    let statusMap: Map<string, boolean>;
    try {
      statusMap = await validateSkus();
      setSkuStatus(statusMap);
    } finally {
      setValidating(false);
    }

    const notFound = [...statusMap.entries()].filter(([, found]) => !found).map(([sku]) => sku);
    if (notFound.length > 0) {
      toast.error(
        `${notFound.length} SKU(s) não cadastrado(s): ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '...' : ''}. Cadastre em Produtos antes de lançar.`,
        { duration: 6000 }
      );
      return; // Bloqueia o save
    }

    // ── 2. Salva as movimentações ─────────────────────────────────────────────
    setSaving(true);
    let ok = 0, err = 0;
    for (const row of validRows) {
      try {
        await inventoryApi.manualMovement({
          seller_id: sellerId,
          movement_date: toIso(row[COL_DATE].trim() || today),
          movement_type: normalizeType(row[COL_TYPE].trim() || 'Saida'),
          sku: row[COL_SKU].trim(),
          // product_name NÃO é enviado: o backend resolve pelo cadastro de produtos
          quantity: Number(row[COL_QTY]) || 1,
          nf_number: row[COL_NF].trim() || null,
          observation: row[COL_OBS].trim() || null,
        });
        ok++;
      } catch { err++; }
    }
    setSaving(false);
    if (ok > 0) toast.success(`${ok} movimentação(ões) salva(s)${err > 0 ? ` · ${err} erro(s)` : ''}`);
    else toast.error('Nenhuma movimentação salva');
    if (ok > 0) onSuccess();
  };

  const downloadTemplate = () => {
    const header = MOV_HEADERS.join(',');
    const example = [today, 'Saida', 'SKU-001', '1', 'NF-12345', 'Observação opcional'].join(','); // today já em DD/MM/AAAA
    const csv = '\uFEFF' + header + '\n' + example + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'modelo_movimentacoes.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSkuStatus(null);
    const text = await file.text();
    const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
    const isHeader = lines[0]?.toLowerCase().includes('data') || lines[0]?.toLowerCase().includes('tipo');
    const dataLines = isHeader ? lines.slice(1) : lines;
    setGrid(() => {
      const next = emptyGrid();
      dataLines.slice(0, MOV_ROWS).forEach((line, i) => {
        const cols = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        cols.forEach((v, j) => { if (j < MOV_COLS) next[i][j] = v; });
      });
      return next;
    });
    toast.success('CSV carregado na grade — revise antes de salvar');
    e.target.value = '';
  };

  const isBusy = saving || validating;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/8 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Colar Movimentações em Lote</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Cole do Excel/Sheets (Ctrl+V na célula) ou importe um CSV.
              Produto é preenchido automaticamente pelo cadastro. SKUs não cadastrados bloqueiam o envio.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 rounded-lg text-white/60 hover:bg-white/5 transition">
              <FileSpreadsheet size={13} /> Modelo CSV
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 rounded-lg text-white/60 hover:bg-white/5 transition cursor-pointer">
              <Upload size={13} /> Importar CSV
              <input type="file" accept=".csv" className="sr-only" onChange={handleFileUpload} />
            </label>
            <button onClick={onClose} className="text-white/35 hover:text-white/60 ml-2"><X size={18} /></button>
          </div>
        </div>

        {/* Scrollable grid */}
        <div className="flex-1 overflow-auto p-4">
          <table ref={tableRef} className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="w-8 px-2 py-1.5 text-white/25 text-right">#</th>
                {MOV_HEADERS.map((h, c) => (
                  <th key={c} className="px-2 py-1.5 text-left text-white/50 font-semibold border-b border-white/8 whitespace-nowrap">
                    {h}
                  </th>
                ))}
                {/* Coluna de status do SKU (quando validado) */}
                {skuStatus && <th className="px-2 py-1.5 text-left text-white/50 font-semibold border-b border-white/8 whitespace-nowrap">SKU OK?</th>}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => {
                const sku = row[COL_SKU].trim();
                const skuOk = skuStatus ? skuStatus.get(sku) : undefined;
                const hasData = sku !== '';
                return (
                  <tr key={r} className={`${hasData ? 'bg-white/3' : ''} ${skuStatus && sku && skuOk === false ? 'bg-red-900/20' : ''}`}>
                    <td className="px-2 py-1 text-white/20 text-right text-[10px]">{r + 1}</td>
                    {row.map((val, c) => (
                      <td key={c} className="p-0">
                        {/* Todos os campos são inputs de texto simples — sem combobox, sem calendário */}
                        <input
                          value={val}
                          onChange={e => setCell(r, c, e.target.value)}
                          onPaste={e => handlePaste(e, r, c)}
                          type="text"
                          className={`w-full px-2 py-1 border-0 border-b focus:border-violet-500 outline-none text-xs text-white/80 transition
                            ${c === COL_SKU && skuStatus && val.trim() && skuStatus.get(val.trim()) === false
                              ? 'border-red-500/60'
                              : 'border-white/5'}`}
                          style={{ background: 'transparent', minWidth: c === COL_DATE ? 120 : c === COL_SKU ? 90 : c === COL_QTY ? 60 : 80 }}
                          placeholder={
                            c === COL_DATE ? today
                            : c === COL_TYPE ? 'Entrada / Saída'
                            : c === COL_QTY ? '0'
                            : ''
                          }
                          disabled={isBusy}
                        />
                      </td>
                    ))}
                    {/* Status do SKU após validação */}
                    {skuStatus && (
                      <td className="px-2 py-1 text-center">
                        {sku ? (
                          skuOk === true
                            ? <span className="text-emerald-400 text-[10px]">✓</span>
                            : skuOk === false
                            ? <span className="text-red-400 text-[10px] font-semibold">✗ Não cadastrado</span>
                            : null
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/8 flex-shrink-0">
          <div className="text-xs text-white/35 space-y-0.5">
            <p>{validRows.length} linha(s) válida(s) de {MOV_ROWS}</p>
            {skuStatus && (() => {
              const notFound = [...skuStatus.entries()].filter(([,f]) => !f).length;
              return notFound > 0
                ? <p className="text-red-400 font-semibold">⚠ {notFound} SKU(s) não cadastrado(s) — corrija antes de salvar</p>
                : <p className="text-emerald-400">✓ Todos os SKUs válidos</p>;
            })()}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={isBusy}
              className="px-4 py-2 text-sm border border-white/12 rounded-lg text-white/60 hover:bg-white/4 transition disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={isBusy || validRows.length === 0}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition disabled:opacity-50 flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg,#7B63E8,#5B47C8)' }}>
              {validating
                ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Validando SKUs...</>
                : saving
                ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvando...</>
                : `Salvar ${validRows.length} linha(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Modal de Importação CSV em Lote (sem limite de linhas) ────────────────────
// Replica o fluxo do "Importar CSV" do PasteMovementsModal mas:
//   - Sem limite de linhas (trata arquivos grandes)
//   - Exibe progresso row-a-row durante o save
//   - Normaliza tipo automaticamente (Saída → Saida)

function BulkCsvImportModal({
  sellerId,
  onClose,
  onSuccess,
}: { sellerId: number; onClose: () => void; onSuccess: () => void }) {
  const today = format(new Date(), 'dd/MM/yyyy');

  /** Converte DD/MM/AAAA → AAAA-MM-DD */
  const toIso = (s: string): string => {
    const p = s.split('/');
    if (p.length === 3 && p[2].length === 4)
      return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    return s;
  };

  type Phase = 'upload' | 'preview' | 'validating' | 'saving' | 'done';
  const [phase, setPhase]             = useState<Phase>('upload');
  const [rows, setRows]               = useState<string[][]>([]);
  const [skuStatus, setSkuStatus]     = useState<Map<string, boolean> | null>(null);
  const [progress, setProgress]       = useState({ ok: 0, err: 0, done: 0, total: 0 });
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);

  // Linhas que têm ao menos SKU + Quantidade preenchidos
  const validRows = rows.filter(r => r[COL_SKU]?.trim() && r[COL_QTY]?.trim());

  /** Lê o CSV selecionado e preenche a grade (sem limite de linhas). */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const text = await file.text();
      const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
      // Detecta se a primeira linha é cabeçalho
      const isHeader =
        /data|tipo|sku/i.test(lines[0] ?? '');
      const dataLines = isHeader ? lines.slice(1) : lines;

      const parsed: string[][] = dataLines.map(line => {
        const cols = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        return [
          cols[COL_DATE] ?? '',
          normalizeType(cols[COL_TYPE] ?? ''),   // normaliza Saída → Saida
          cols[COL_SKU]  ?? '',
          cols[COL_QTY]  ?? '',
          cols[COL_NF]   ?? '',
          cols[COL_OBS]  ?? '',
        ];
      });

      setRows(parsed);
      setSkuStatus(null);
      setPhase('preview');
    } catch {
      setErrorMsg('Erro ao ler o arquivo. Verifique se é um CSV válido.');
    }
    e.target.value = '';
  };

  /** Valida SKUs únicos consultando o backend. */
  const validateSkus = async () => {
    setPhase('validating');
    const uniqueSkus = [...new Set(validRows.map(r => r[COL_SKU].trim()).filter(Boolean))];
    const result = new Map<string, boolean>();
    await Promise.all(
      uniqueSkus.map(async sku => {
        try {
          const res = await inventoryApi.skuLookup(sellerId, sku);
          result.set(sku, res.data.found);
        } catch {
          result.set(sku, false);
        }
      })
    );
    setSkuStatus(result);
    const notFound = [...result.entries()].filter(([, ok]) => !ok).map(([s]) => s);
    if (notFound.length > 0) {
      setErrorMsg(
        `${notFound.length} SKU(s) não cadastrado(s): ${notFound.slice(0, 8).join(', ')}${notFound.length > 8 ? '…' : ''}. Cadastre em Produtos antes de importar.`
      );
      setPhase('preview');
    } else {
      setErrorMsg(null);
      await saveRows(result);
    }
  };

  /**
   * Salva em chunks de 2 000 linhas via endpoint bulk.
   * 21k linhas = ~11 requests ao invés de 21 000 — muito mais rápido.
   */
  const CHUNK_SIZE = 2000;
  const saveRows = async (statusMap: Map<string, boolean>) => {
    const toSave = validRows.filter(r => statusMap.get(r[COL_SKU].trim()) !== false);
    setProgress({ ok: 0, err: 0, done: 0, total: toSave.length });
    setPhase('saving');

    // Converte todas as linhas para o formato do backend
    const allRows = toSave.map(row => ({
      movement_date: toIso(row[COL_DATE].trim() || today),
      movement_type: normalizeType(row[COL_TYPE].trim() || 'Saida'),
      sku:           row[COL_SKU].trim(),
      quantity:      Number(row[COL_QTY]) || 1,
      nf_number:     row[COL_NF]?.trim()  || null,
      observation:   row[COL_OBS]?.trim() || null,
    }));

    let totalOk = 0, totalErr = 0;

    for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
      const chunk = allRows.slice(i, i + CHUNK_SIZE);
      try {
        const res = await inventoryApi.bulkMovements({ seller_id: sellerId, rows: chunk });
        totalOk  += res.data.imported;
        totalErr += res.data.errors?.length ?? 0;
      } catch {
        totalErr += chunk.length;
      }
      setProgress({ ok: totalOk, err: totalErr, done: i + chunk.length, total: allRows.length });
    }

    setPhase('done');
    if (totalOk > 0) {
      toast.success(`${totalOk} movimentação(ões) importada(s)${totalErr ? ` · ${totalErr} erro(s)` : ''}`);
      onSuccess();
    } else {
      toast.error('Nenhuma movimentação importada');
    }
  };

  const isBusy = phase === 'validating' || phase === 'saving';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-5 border-b border-white/8 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Importar Movimentações via CSV</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Sem limite de linhas · Colunas: Data (DD/MM/AAAA), Tipo, SKU, Quantidade, NF, Observação
            </p>
          </div>
          <button onClick={onClose} disabled={isBusy} className="text-white/35 hover:text-white/60 disabled:opacity-30 ml-4">
            <X size={18} />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">

          {/* FASE: upload */}
          {phase === 'upload' && (
            <label
              className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/15 rounded-xl py-16 cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={32} className="text-white/30" />
              <p className="text-white/60 text-sm font-medium">Clique para selecionar o arquivo CSV</p>
              <p className="text-white/30 text-xs">Mesmo formato do Modelo CSV do "Colar em Lote"</p>
              <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={handleFile} />
            </label>
          )}

          {/* FASE: preview */}
          {phase === 'preview' && (
            <>
              <div className="flex items-center justify-between flex-shrink-0">
                <p className="text-xs text-white/50">
                  <span className="text-white font-semibold">{rows.length}</span> linhas carregadas ·{' '}
                  <span className="text-emerald-400 font-semibold">{validRows.length}</span> válidas (SKU + Qtd)
                </p>
                <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/10 rounded-lg text-white/60 hover:bg-white/5 transition cursor-pointer">
                  <Upload size={12} /> Trocar arquivo
                  <input type="file" accept=".csv" className="sr-only" onChange={handleFile} />
                </label>
              </div>

              {/* Tabela de preview (leitura — sem edição inline para suportar n linhas) */}
              <div className="overflow-auto rounded-xl border border-white/8 flex-1">
                <table className="w-full text-xs border-collapse min-w-[700px]">
                  <thead className="sticky top-0 bg-[#14122A] z-10">
                    <tr>
                      <th className="w-8 px-2 py-2 text-white/25 text-right border-b border-white/8">#</th>
                      {MOV_HEADERS.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left text-white/50 font-semibold border-b border-white/8 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                      {skuStatus && (
                        <th className="px-3 py-2 text-left text-white/50 font-semibold border-b border-white/8">SKU OK?</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, r) => {
                      const sku    = row[COL_SKU]?.trim();
                      const isValid = sku && row[COL_QTY]?.trim();
                      const skuOk  = skuStatus ? skuStatus.get(sku) : undefined;
                      return (
                        <tr
                          key={r}
                          className={`border-b border-white/4 ${!isValid ? 'opacity-30' : ''} ${skuStatus && sku && skuOk === false ? 'bg-red-900/20' : ''}`}
                        >
                          <td className="px-2 py-1.5 text-white/20 text-right text-[10px]">{r + 1}</td>
                          {row.map((val, c) => (
                            <td key={c} className="px-3 py-1.5 text-white/75 whitespace-nowrap max-w-[180px] truncate" title={val}>
                              {val || <span className="text-white/20">—</span>}
                            </td>
                          ))}
                          {skuStatus && sku && (
                            <td className="px-3 py-1.5 text-center">
                              {skuOk === true  && <span className="text-emerald-400 text-[10px]">✓</span>}
                              {skuOk === false && <span className="text-red-400 text-[10px] font-semibold">✗</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* FASE: salvando */}
          {phase === 'saving' && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="w-12 h-12 rounded-full border-4 border-violet-500/30 border-t-violet-500 animate-spin" />
              <p className="text-white/70 text-sm font-medium">
                Salvando {progress.done} / {progress.total}…
              </p>
              <div className="w-64 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              {progress.err > 0 && (
                <p className="text-red-400 text-xs">{progress.err} erro(s) até agora</p>
              )}
            </div>
          )}

          {/* FASE: concluído */}
          {phase === 'done' && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 text-2xl">✓</span>
              </div>
              <p className="text-white font-semibold">{progress.ok} movimentações importadas</p>
              {progress.err > 0 && <p className="text-red-400 text-xs">{progress.err} linha(s) com erro</p>}
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 text-sm rounded-lg text-white"
                style={{ background: 'linear-gradient(135deg,#7B63E8,#5B47C8)' }}
              >
                Fechar
              </button>
            </div>
          )}

          {/* Mensagem de erro */}
          {errorMsg && phase !== 'saving' && phase !== 'done' && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-300 text-xs leading-relaxed">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        {(phase === 'preview' || phase === 'validating') && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
            <p className="text-xs text-white/35">
              {validRows.length} linha(s) serão importadas
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isBusy}
                className="px-4 py-2 text-xs border border-white/10 rounded-lg text-white/60 hover:bg-white/5 disabled:opacity-40 transition"
              >
                Cancelar
              </button>
              <button
                onClick={validateSkus}
                disabled={isBusy || validRows.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-40 transition"
                style={{ background: 'linear-gradient(135deg,#2E9E6B,#1B7A50)' }}
              >
                {phase === 'validating' ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Validando SKUs…
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    Validar e Importar ({validRows.length})
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Página principal ──────────────────────────────────────────

// ── Modal Bulk Upload Posição de Estoque (Admin) ─────────────────────────────
function BulkStockUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  type Phase = 'idle' | 'uploading' | 'processing' | 'errors' | 'success';

  const [file, setFile]           = useState<File | null>(null);
  const [phase, setPhase]         = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);          // % do arquivo enviado ao servidor
  const [result, setResult]       = useState<any | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const base = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
    window.open(`${base}/inventory/bulk-stock-upload/template`, '_blank');
  };

  const handleUpload = async () => {
    if (!file) return;
    setPhase('uploading');
    setUploadPct(0);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { inventoryApi } = await import('../api');
      const res = await inventoryApi.bulkStockUpload(form, (e) => {
        // Progresso real do envio do arquivo (upload HTTP)
        if (e.total > 0) setUploadPct(Math.round((e.loaded / e.total) * 100));
        // Quando chega em 100% o servidor ainda está processando
        if (e.loaded >= e.total) setPhase('processing');
      });
      setResult(res.data);
      setPhase(res.data.ok ? 'success' : 'errors');
      if (res.data.ok) {
        toast.success(`${res.data.created.toLocaleString()} movimentos importados em ${res.data.duration_sec}s`);
        onSuccess();
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Erro no upload. Verifique o arquivo e tente novamente.';
      setResult({ ok: false, errors: [detail], total_rows: 0, created: 0, duration_sec: 0 });
      setPhase('errors');
    }
  };

  const isBusy = phase === 'uploading' || phase === 'processing';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#14122A] border border-white/10 rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/8 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-white text-sm">Upload Estoque — Multi-Seller</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              Importação em massa via CSV · All-or-nothing: qualquer erro bloqueia o import
            </p>
          </div>
          <button onClick={onClose} disabled={isBusy} className="text-white/35 hover:text-white/60 disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* Formato do CSV */}
          <div className="p-3 rounded-xl border border-white/8" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white/70">Formato do CSV</p>
                <p className="text-[11px] text-white/35 mt-0.5 font-mono">
                  seller · data (dd/mm/aaaa) · tipo (Entrada/Saída) · sku · quantity · nf · observ
                </p>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-teal-300 border border-teal-500/30 hover:bg-teal-500/10 transition flex-shrink-0 ml-3">
                <Download size={12} /> Baixar template
              </button>
            </div>
          </div>

          {/* Seleção de arquivo */}
          {(phase === 'idle' || phase === 'errors') && (
            <div
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition"
              style={{ borderColor: file ? 'rgba(123,99,232,0.5)' : 'rgba(255,255,255,0.10)' }}
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div>
                  <p className="text-sm text-violet-300 font-medium">{file.name}</p>
                  <p className="text-[11px] text-white/40 mt-1">
                    {(file.size / 1024).toFixed(1)} KB · clique para trocar
                  </p>
                </div>
              ) : (
                <div>
                  <FileUp size={28} className="text-white/20 mx-auto mb-2" />
                  <p className="text-xs text-white/40">Clique para selecionar o arquivo CSV</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".csv" className="sr-only"
                onChange={e => { setFile(e.target.files?.[0] ?? null); setPhase('idle'); setResult(null); }} />
            </div>
          )}

          {/* Progresso de envio */}
          {(phase === 'uploading' || phase === 'processing') && (
            <div className="rounded-xl border border-white/8 p-5" style={{ background: 'rgba(123,99,232,0.06)' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {phase === 'uploading' ? 'Enviando arquivo…' : 'Processando no servidor…'}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    {phase === 'uploading'
                      ? 'Aguarde o envio completo antes de fechar'
                      : 'Validando linhas e atualizando posições de estoque'}
                  </p>
                </div>
              </div>

              {/* Barra de progresso do upload */}
              <div className="w-full bg-white/8 rounded-full h-2 overflow-hidden">
                {phase === 'uploading' ? (
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${uploadPct}%`,
                      background: 'linear-gradient(90deg, #7B63E8, #3DD9A4)',
                    }}
                  />
                ) : (
                  /* Indeterminate quando servidor processa */
                  <div
                    className="h-2 rounded-full animate-pulse"
                    style={{ width: '100%', background: 'linear-gradient(90deg, #7B63E8, #3DD9A4)' }}
                  />
                )}
              </div>
              {phase === 'uploading' && (
                <p className="text-[10px] text-white/30 mt-1.5 text-right font-mono">{uploadPct}%</p>
              )}
            </div>
          )}

          {/* ── ERROS ── */}
          {phase === 'errors' && result && (
            <div className="rounded-xl border border-red-500/30 overflow-hidden" style={{ background: 'rgba(239,68,68,0.06)' }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-red-500/20">
                <span className="text-red-400 font-bold text-lg">✕</span>
                <div>
                  <p className="text-sm font-semibold text-red-300">Importação bloqueada — nenhum dado foi salvo</p>
                  <p className="text-[11px] text-red-400/70 mt-0.5">
                    {result.errors?.length ?? 0} erro(s) encontrado(s) em {result.total_rows?.toLocaleString()} linhas
                    · Corrija o CSV e faça upload novamente
                  </p>
                </div>
              </div>
              {/* Lista de erros — scroll */}
              <div className="overflow-y-auto p-3 space-y-0.5" style={{ maxHeight: '220px' }}>
                {(result.errors ?? []).map((e: string, i: number) => (
                  <p key={i} className="text-[11px] text-red-300/80 font-mono py-0.5 border-b border-red-500/10 last:border-0">
                    {e}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* ── SUCESSO ── */}
          {phase === 'success' && result && (
            <div className="rounded-xl border border-teal-500/30 p-4" style={{ background: 'rgba(61,217,164,0.07)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-teal-400 font-bold text-xl">✓</span>
                <p className="text-sm font-semibold text-teal-300">Importação concluída com sucesso</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <span className="text-white/50">Linhas no arquivo:</span>
                <span className="text-white/80 font-mono">{result.total_rows?.toLocaleString()}</span>
                <span className="text-white/50">Movimentos criados:</span>
                <span className="text-teal-300 font-mono font-bold">{result.created?.toLocaleString()}</span>
                <span className="text-white/50">Duração:</span>
                <span className="text-white/80 font-mono">{result.duration_sec}s</span>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-white/8 flex-shrink-0">
          <button
            onClick={phase === 'success' ? () => { onSuccess(); onClose(); } : onClose}
            disabled={isBusy}
            className="px-4 py-1.5 text-xs text-white/50 border border-white/10 rounded-lg hover:bg-white/4 transition disabled:opacity-40">
            {phase === 'success' ? 'Fechar' : 'Cancelar'}
          </button>
          {phase !== 'success' && (
            <button
              onClick={handleUpload}
              disabled={!file || isBusy}
              className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition disabled:opacity-50 flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg,#7B63E8,#5B47C8)' }}>
              {isBusy
                ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Aguarde...</>
                : phase === 'errors'
                ? 'Tentar novamente'
                : 'Iniciar Upload'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}


export default function InventoryPage() {
  const qc = useQueryClient();
  const userStr = localStorage.getItem('wms_user');
  const user = userStr ? JSON.parse(userStr) : null;
  const isManager = user?.role === 'manager';
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [search, setSearch] = useState('');
  const [movSearch, setMovSearch] = useState('');
  const [movTypeFilter, setMovTypeFilter] = useState<'' | 'Entrada' | 'Saída'>('');
  const [movSort, setMovSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'movement_date', dir: 'desc' });
  const [stockSort, setStockSort] = useState<{col: string; dir: 'asc'|'desc'}>({col: 'sku', dir: 'asc'});
  const [showManual, setShowManual] = useState(false);
  const [detailSku, setDetailSku] = useState<string | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkStockUpload, setShowBulkStockUpload] = useState(false);
  const isAdmin = user?.role === 'admin';
  const [editMovement, setEditMovement] = useState<any | null>(null);

  // Datas para filtro de movimentações (últimos 30 dias por padrão)
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  // Sellers do gerente (só busca se for manager)
  const { data: meData } = useQuery(
    ['me'],
    () => authApi.me().then(r => r.data),
    { enabled: isManager, staleTime: 5 * 60 * 1000 }
  );
  const mySellerIds: number[] = meData?.seller_ids ?? [];

  // Sellers disponíveis — gerente vê só os seus
  const { data: allSellers = [] } = useQuery(
    'sellers-list',
    () => cadastrosApi.sellers().then(r => r.data as { id: number; name: string }[]),
  );
  const sellers = isManager && mySellerIds.length > 0
    ? (allSellers as any[]).filter(s => mySellerIds.includes(s.id))
    : allSellers;

  // Quando a lista de sellers estiver disponível, seleciona o primeiro
  useEffect(() => {
    if (sellers.length > 0 && !sellerId) {
      setSellerId((sellers as any[])[0].id);
    }
  }, [sellers, sellerId]);

  // Posição de estoque
  const { data: stock = [], isLoading: loadingStock } = useQuery(
    ['stock', sellerId],
    () => inventoryApi.stock(sellerId!).then(r => r.data),
    { enabled: !!sellerId }
  );

  // Movimentações
  const { data: movements = [], isLoading: loadingMov } = useQuery(
    ['movements', sellerId, dateFrom, dateTo],
    () => inventoryApi.movements(sellerId!, dateFrom, dateTo).then(r => r.data),
    { enabled: !!sellerId }
  );

  const invalidate = () => {
    qc.invalidateQueries(['stock', sellerId]);
    qc.invalidateQueries(['movements', sellerId, dateFrom, dateTo]);
  };

  // Filtro de busca aplicado à tabela de estoque
  const filteredStock = (stock as any[]).filter((s: any) =>
    !search || s.sku.toLowerCase().includes(search.toLowerCase()) || s.product_name.toLowerCase().includes(search.toLowerCase())
  );

  // Cor da projeção de duração
  function projectionColor(days: number | null) {
    if (days == null) return 'text-white/35';
    if (days < 15) return 'text-red-400 font-semibold';
    if (days < 30) return 'text-amber-400';
    return 'text-emerald-400';
  }

  // Estima dias restantes com base na média de saídas
  function estimateDays(item: any): number | null {
    if (item.total_out <= 0 || item.current_stock <= 0) return null;
    const dailyAvg = item.total_out / 30;
    if (dailyAvg <= 0) return null;
    return Math.round(item.current_stock / dailyAvg);
  }

  // Filtro + sort das movimentações
  const filteredMovements = (() => {
    let list = movements as any[];
    if (movSearch) {
      const q = movSearch.toLowerCase();
      list = list.filter(m =>
        m.sku?.toLowerCase().includes(q) ||
        (m.product_name || '').toLowerCase().includes(q) ||
        (m.nf_number || '').toLowerCase().includes(q)
      );
    }
    if (movTypeFilter) {
      list = list.filter(m => m.movement_type === movTypeFilter);
    }
    // Sort
    list = [...list].sort((a, b) => {
      const dir = movSort.dir === 'asc' ? 1 : -1;
      const col = movSort.col;
      const va = a[col] ?? '';
      const vb = b[col] ?? '';
      if (col === 'quantity') return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return list;
  })();

  // Ordenação da tabela de estoque (inclui Projeção)
  const sortedStock = [...filteredStock].sort((a, b) => {
    const dir = stockSort.dir === 'asc' ? 1 : -1;
    const colToField: Record<string, string> = {
      'SKU': 'sku',
      'Produto': 'product_name',
      'Atual': 'current_stock',
      'Projeção': 'days_remaining',
    };
    const field = colToField[stockSort.col];
    if (!field) return 0;

    let va = a[field];
    let vb = b[field];

    // Projeção nula (estoque sem saída) = "∞" → vai para o fim quando asc, início quando desc
    if (field === 'days_remaining') {
      const nullVal = dir === 1 ? Infinity : -Infinity;
      va = va ?? nullVal;
      vb = vb ?? nullVal;
      return (va - vb) * dir;
    }

    va = va ?? '';
    vb = vb ?? '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  return (
    <div className="min-h-full text-white">
      {/* Cabeçalho */}
      <div
        className="flex items-center justify-between flex-wrap gap-3 px-6 pt-6 pb-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(123,99,232,0.15)', border: '1px solid rgba(123,99,232,0.20)' }}
          >
            <Package size={18} style={{ color: '#9B87F0' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Estoque</h1>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Posição e movimentações por seller
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor de seller */}
          <select
            value={sellerId ?? ''}
            onChange={e => setSellerId(Number(e.target.value))}
            className="border border-white/12 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500"
            style={{ background: '#14122A' }}
          >
            {(sellers as any[]).map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Download CSV Estoque */}
          <button
            onClick={() => sellerId && inventoryApi.exportStockCsv(sellerId)}
            disabled={!sellerId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-white/10 text-white/70 hover:bg-white/5 transition disabled:opacity-40"
          >
            <Download size={13} />
            Exportar Estoque
          </button>

          {/* Lançamento manual */}
          <button
            onClick={() => setShowManual(true)}
            disabled={!sellerId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white transition disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#7B63E8,#5B47C8)' }}
          >
            <Upload size={13} />
            Lançamento Manual
          </button>

          {/* Importar CSV em lote (sem limite de linhas) */}
          <button
            onClick={() => setShowBulkImport(true)}
            disabled={!sellerId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white transition disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#2E9E6B,#1B7A50)' }}
          >
            <FileUp size={13} />
            Importar CSV
          </button>

          {/* Bulk upload de posição de estoque (multi-seller) — admin only */}
          {isAdmin && (
            <button
              onClick={() => setShowBulkStockUpload(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white transition"
              style={{ background: 'linear-gradient(135deg,#C2410C,#9A3412)' }}
              title="Upload CSV com posição de estoque de múltiplos sellers"
            >
              <FileUp size={13} />
              Upload Estoque (Admin)
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {(['stock', 'movements'] as const).map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === key ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
            style={tab === key ? { background: 'rgba(123,99,232,0.20)', border: '1px solid rgba(123,99,232,0.30)' } : {}}
          >
            {key === 'stock' ? 'Posição de Estoque' : 'Movimentações'}
          </button>
        ))}
      </div>

      <div className="px-6 py-4">
        {/* ── TAB: Posição de Estoque ── */}
        {tab === 'stock' && (
          <>
            {/* Barra de busca */}
            <div className="relative mb-4 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar SKU ou produto..."
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-white/10 text-white placeholder-white/25 outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{ background: '#14122A' }}
              />
            </div>

            {/* Banner de alerta: SKUs sem cadastro em Produtos */}
            {(() => {
              const unregistered = (stock as any[]).filter((s: any) => s.product_registered === false);
              if (unregistered.length === 0) return null;
              return (
                <div className="mb-4 flex items-start gap-3 p-3 rounded-xl border border-red-500/30 text-xs"
                  style={{ background: 'rgba(239,68,68,0.07)' }}>
                  <span className="text-red-400 font-bold text-base leading-none mt-0.5">⚠</span>
                  <div>
                    <p className="font-semibold text-red-300">
                      {unregistered.length} SKU{unregistered.length > 1 ? 's' : ''} sem cadastro em Produtos
                    </p>
                    <p className="text-red-400/70 mt-0.5">
                      Estes SKUs têm movimentações mas não estão registrados no catálogo.
                      Cadastre-os em <strong>Produtos</strong> para exibir o nome correto e habilitar todos os recursos.
                    </p>
                    <p className="text-red-400/50 mt-1 font-mono">
                      {unregistered.slice(0, 10).map((s: any) => s.sku).join(', ')}
                      {unregistered.length > 10 ? ` +${unregistered.length - 10} mais` : ''}
                    </p>
                  </div>
                </div>
              );
            })()}

            {loadingStock ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      {['SKU', 'Produto', 'Nível', 'Atual', 'Entrada 30d', 'Saída 30d', 'Projeção'].map(h => {
                        const sortable = ['SKU', 'Produto', 'Atual', 'Projeção'].includes(h);
                        return (
                          <th
                            key={h}
                            className={`px-4 py-3 text-left text-xs text-white/50 font-semibold select-none ${sortable ? 'cursor-pointer hover:text-white/80 transition' : ''}`}
                            onClick={() => {
                              if (!sortable) return;
                              setStockSort(prev => ({
                                col: h,
                                dir: prev.col === h && prev.dir === 'asc' ? 'desc' : 'asc',
                              }));
                            }}
                          >
                            {h}
                            {stockSort.col === h && (
                              <span className="ml-1 text-violet-400">{stockSort.dir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </th>
                        );
                      })}
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStock.map((item: any) => {
                      const level    = item.level || 'ALTO';
                      const levelCfg = LEVEL_CONFIG[level] || LEVEL_CONFIG['ALTO'];
                      const days     = item.days_remaining;
                      return (
                        <tr
                          key={item.sku}
                          className="border-t border-white/5 hover:bg-violet-900/10 cursor-pointer transition group"
                          onClick={() => setDetailSku(item.sku)}
                          title="Clique para ver histórico do SKU"
                        >
                          <td className="px-4 py-3 text-xs font-mono text-violet-300 group-hover:text-violet-200 transition">{item.sku}</td>
                          <td className="px-4 py-3 text-xs max-w-[180px]">
                            {item.product_registered === false ? (
                              <span className="flex items-center gap-1.5" title="SKU não encontrado no cadastro de Produtos">
                                <span className="text-red-400 font-semibold truncate">{item.product_name || item.sku}</span>
                                <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap">
                                  SEM CADASTRO
                                </span>
                              </span>
                            ) : (
                              <span className="text-white/70 truncate block" title={item.product_name}>{item.product_name}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${levelCfg.color}`}>
                              {levelCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold text-white">{item.current_stock}</td>
                          <td className="px-4 py-3 text-xs text-emerald-400">{item.total_in ?? 0}</td>
                          <td className="px-4 py-3 text-xs text-red-400">{item.total_out ?? 0}</td>
                          <td className={`px-4 py-3 text-xs ${projectionColor(days)}`}>
                            {days != null ? `${days}d` : '∞'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <BarChart2 size={13} className="inline text-white/25 group-hover:text-violet-400 transition" />
                          </td>
                        </tr>
                      );
                    })}
                    {sortedStock.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-white/30 text-sm">
                          {search ? 'Nenhum produto encontrado para a busca' : 'Nenhum produto no estoque'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── TAB: Movimentações ── */}
        {tab === 'movements' && (
          <>
            {/* Barra de filtros */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {/* Date range */}
              <div className="flex items-center gap-1.5">
                <Calendar size={13} className="text-white/40" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                  style={{ background: '#14122A' }}
                />
                <span className="text-white/30 text-xs">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                  style={{ background: '#14122A' }}
                />
              </div>

              {/* Tipo filter */}
              <select
                value={movTypeFilter}
                onChange={e => setMovTypeFilter(e.target.value as '' | 'Entrada' | 'Saída')}
                className="border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                style={{ background: '#14122A' }}
              >
                <option value="">Todos os tipos</option>
                <option value="Entrada">Entrada</option>
                <option value="Saída">Saída</option>
              </select>

              {/* Text search */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={movSearch}
                  onChange={e => setMovSearch(e.target.value)}
                  placeholder="Buscar SKU, produto ou NF..."
                  className="pl-7 pr-3 py-1.5 text-xs rounded-lg border border-white/10 text-white placeholder-white/25 outline-none focus:ring-2 focus:ring-violet-500/40"
                  style={{ background: '#14122A', minWidth: 200 }}
                />
              </div>

              {/* Contagem */}
              <span className="text-xs text-white/30 ml-auto">
                {filteredMovements.length} registros
              </span>

              <button
                onClick={() => setShowPasteModal(true)}
                disabled={!sellerId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-white/70 hover:bg-white/5 transition disabled:opacity-40"
              >
                <ClipboardPaste size={13} />
                Colar em Lote
              </button>
            </div>

            {loadingMov ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      {([
                        { label: 'Data',       col: 'movement_date' },
                        { label: 'Tipo',       col: 'movement_type' },
                        { label: 'SKU',        col: 'sku' },
                        { label: 'Produto',    col: 'product_name' },
                        { label: 'Qtd',        col: 'quantity' },
                        { label: 'NF',         col: 'nf_number' },
                        { label: 'Observação', col: null },
                      ] as { label: string; col: string | null }[]).map(({ label, col }) => (
                        <th
                          key={label}
                          className={`px-4 py-3 text-left text-xs text-white/50 font-semibold select-none ${col ? 'cursor-pointer hover:text-white/80 transition' : ''}`}
                          onClick={() => {
                            if (!col) return;
                            setMovSort(s => s.col === col
                              ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                              : { col, dir: col === 'movement_date' ? 'desc' : 'asc' }
                            );
                          }}
                        >
                          <span className="flex items-center gap-1">
                            {label}
                            {col && movSort.col === col && (
                              <span className="text-violet-400">{movSort.dir === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.map((mov: any) => (
                      <tr key={mov.id} className="border-t border-white/5 hover:bg-white/2 transition">
                        <td className="px-4 py-3 text-xs text-white/60">{mov.movement_date}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            mov.movement_type === 'Entrada'
                              ? 'bg-emerald-900/40 text-emerald-300'
                              : 'bg-red-900/40 text-red-300'
                          }`}>
                            {mov.movement_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-white/80">{mov.sku}</td>
                        <td className="px-4 py-3 text-xs text-white/70 max-w-[140px] truncate" title={mov.product_name}>{mov.product_name}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-white">{mov.quantity}</td>
                        <td className="px-4 py-3 text-xs text-white/50">{mov.nf_number || '—'}</td>
                        <td className="px-4 py-3 text-xs text-white/40 max-w-[160px] truncate" title={mov.observation}>{mov.observation || '—'}</td>
                        <td className="px-4 py-3">
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => setEditMovement(mov)}
                              className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-violet-300 transition"
                              title="Editar movimentação"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredMovements.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-white/30 text-sm">
                          Nenhuma movimentação no período selecionado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de edição de movimentação (admin) */}
      {editMovement && (
        <EditMovementModal
          movement={editMovement}
          onClose={() => setEditMovement(null)}
          onSuccess={() => { setEditMovement(null); invalidate(); }}
        />
      )}

      {/* Modal de colar movimentações em lote */}
      {showPasteModal && sellerId && (
        <PasteMovementsModal
          sellerId={sellerId}
          onClose={() => setShowPasteModal(false)}
          onSuccess={() => { setShowPasteModal(false); invalidate(); }}
        />
      )}

      {/* Modal de importação CSV em lote */}
      {showBulkImport && sellerId && (
        <BulkCsvImportModal
          sellerId={sellerId}
          onClose={() => setShowBulkImport(false)}
          onSuccess={() => { setShowBulkImport(false); invalidate(); }}
        />
      )}

      {/* Modal de lançamento manual */}
      {showManual && sellerId && (
        <ManualMovementModal
          sellerId={sellerId}
          onClose={() => setShowManual(false)}
          onSuccess={() => { setShowManual(false); invalidate(); }}
        />
      )}

      {/* Modal de detalhe/histórico do SKU */}
      {detailSku && sellerId && (
        <SkuDetailModal
          sellerId={sellerId}
          sku={detailSku}
          onClose={() => setDetailSku(null)}
        />
      )}

      {/* Bulk upload de estoque (admin) */}
      {showBulkStockUpload && (
        <BulkStockUploadModal
          onClose={() => setShowBulkStockUpload(false)}
          onSuccess={() => { setShowBulkStockUpload(false); invalidate(); }}
        />
      )}
    </div>
  );
}
