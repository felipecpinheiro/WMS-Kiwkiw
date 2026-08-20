/**
 * WMS Kiwkiw - Algoritmo de Caixas
 * Matriz de caixas por quantidade de produtos e score do pedido.
 * Reproduz a lógica da aba "Algoritimo caixas" da planilha.
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { Calculator, Check } from 'lucide-react';
import { cadastrosApi } from '../api';
import toast from 'react-hot-toast';

const MAX_ROWS = 15;

export default function BoxAlgorithmPage() {
  const qc = useQueryClient();
  const [sellerId, setSellerId] = useState<number | ''>('');
  const [calcQty, setCalcQty] = useState(1);
  const [calcScore, setCalcScore] = useState(1);
  const [calcResult, setCalcResult] = useState<string | null>(null);

  // Matrix state
  const [quantities] = useState<number[]>(Array.from({ length: MAX_ROWS }, (_, i) => i + 1));
  const [scores, setScores] = useState<number[]>(Array.from({ length: 20 }, (_, i) => i + 1));
  const [matrix, setMatrix] = useState<Record<string, string>>({});
  const [editingScore, setEditingScore] = useState<number | null>(null);
  const [newScoreVal, setNewScoreVal] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: sellers = [] } = useQuery('sellers', () => cadastrosApi.sellers().then(r => r.data));
  const { data: rules = [] } = useQuery(['box-rules', sellerId], () =>
    sellerId ? cadastrosApi.boxRules(sellerId).then(r => r.data) : Promise.resolve([]),
    { enabled: !!sellerId }
  );

  // Build matrix from rules when seller or rules change
  useEffect(() => {
    if (!sellerId) return;
    const m: Record<string, string> = {};
    (rules as any[]).forEach((r: any) => {
      const key = `${r.num_products}_${r.score}`;
      m[key] = r.box_type;
    });
    setMatrix(m);
  }, [rules, sellerId]);

  const handleCalculate = async () => {
    if (!sellerId) { toast.error('Selecione um seller'); return; }
    try {
      const res = await cadastrosApi.calculateBox(sellerId, calcQty, calcScore);
      setCalcResult(res.data.box_type || 'Nenhuma caixa encontrada para esses parâmetros');
    } catch { toast.error('Erro ao calcular'); }
  };

  const handleMatrixPaste = (e: React.ClipboardEvent, startQty: number, startScore: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = text.trim().split('\n').map(r => r.split('\t'));
    const newMatrix = { ...matrix };
    rows.forEach((row, ri) => {
      const qty = startQty + ri;
      if (!quantities.includes(qty)) return;
      row.forEach((cell, ci) => {
        const score = scores[scores.indexOf(startScore) + ci];
        if (score === undefined) return;
        newMatrix[`${qty}_${score}`] = cell.trim();
      });
    });
    setMatrix(newMatrix);
  };

  const handleSaveMatrix = async () => {
    if (!sellerId) return;
    setSaving(true);
    try {
      const promises: Promise<any>[] = [];
      quantities.forEach(qty => {
        scores.forEach(score => {
          const key = `${qty}_${score}`;
          const boxType = matrix[key];
          if (boxType) {
            promises.push(cadastrosApi.createBoxRule({
              seller_id: sellerId,
              num_products: qty,
              score: score,
              box_type: boxType,
            }));
          }
        });
      });
      await Promise.all(promises);
      toast.success('Matriz de caixas salva!');
      qc.invalidateQueries(['box-rules', sellerId]);
    } catch { toast.error('Erro ao salvar'); } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-t1">Algoritmo de Caixas</h1>
        <p className="text-sm text-t3 mt-0.5">Matriz de caixas por quantidade e score do pedido</p>
      </div>

      {/* Seller selection as buttons */}
      <div className="bg-surface rounded-xl border border-line-soft shadow-none p-4">
        <p className="text-xs text-t3 mb-3 font-medium">Selecione o Seller</p>
        <div className="flex flex-wrap gap-2">
          {sellers.map((s: any) => (
            <button key={s.id}
              onClick={() => { setSellerId(s.id); setCalcResult(null); }}
              className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition ${
                sellerId === s.id
                  ? 'bg-violet-600 text-t1 border-violet-600'
                  : 'bg-surface text-t3 border-line hover:border-ok'
              }`}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Matrix table */}
      {sellerId && (
        <div className="bg-surface rounded-xl border border-line-soft shadow-none overflow-hidden">
          <div className="p-4 border-b border-line-soft flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-t2">Matriz de Caixas</h2>
              <p className="text-xs text-t4 mt-0.5">Linhas = Nº produtos · Colunas = Score · Cole direto do Excel</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSaveMatrix} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg disabled:opacity-60 transition">
                {saving ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Check size={12} />}
                Salvar Matriz
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr className="bg-surface-2">
                  <th className="sticky left-0 bg-surface-2 z-10 px-3 py-2 text-xs font-semibold text-t3 border-b border-r border-line min-w-[80px]">
                    Qtd ↓ / Score →
                  </th>
                  {scores.map(score => (
                    <th key={score} className="px-2 py-2 text-center border-b border-r border-line font-semibold text-t3 min-w-[60px]">
                      {editingScore === score ? (
                        <input type="number" value={newScoreVal}
                          onChange={e => setNewScoreVal(e.target.value)}
                          onBlur={() => {
                            const v = parseInt(newScoreVal);
                            if (!isNaN(v) && v > 0) {
                              setScores(prev => prev.map(s => s === score ? v : s));
                              const newM = { ...matrix };
                              quantities.forEach(q => {
                                const oldKey = `${q}_${score}`;
                                const newKey = `${q}_${v}`;
                                if (newM[oldKey]) { newM[newKey] = newM[oldKey]; delete newM[oldKey]; }
                              });
                              setMatrix(newM);
                            }
                            setEditingScore(null);
                          }}
                          className="w-12 text-center border border-info rounded text-xs px-1 py-0.5 outline-none"
                          autoFocus />
                      ) : (
                        <span onClick={() => { setEditingScore(score); setNewScoreVal(String(score)); }}
                          className="cursor-pointer hover:text-violet-400 hover:underline">{score}</span>
                      )}
                    </th>
                  ))}
                  {/* + button to add score */}
                  <th className="px-2 py-2 border-b border-line">
                    <button onClick={() => setScores(prev => [...prev, Math.max(...prev) + 1])}
                      className="w-6 h-6 rounded-full bg-violet-900/40 text-violet-400 hover:bg-green-200 flex items-center justify-center font-bold text-base">+</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {quantities.map((qty) => (
                  <tr key={qty} className="hover:bg-surface-2">
                    <td className="sticky left-0 bg-surface px-3 py-1 font-semibold text-t3 border-r border-b border-line-soft text-center">
                      {qty} produto{qty !== 1 ? 's' : ''}
                    </td>
                    {scores.map(score => {
                      const key = `${qty}_${score}`;
                      const val = matrix[key] || '';
                      return (
                        <td key={score} className="border-r border-b border-line-soft p-0">
                          <input
                            type="text"
                            value={val}
                            onChange={e => setMatrix(prev => ({ ...prev, [`${qty}_${score}`]: e.target.value }))}
                            onPaste={e => handleMatrixPaste(e, qty, score)}
                            placeholder="—"
                            className={`w-full px-2 py-1.5 text-xs text-center outline-none focus:bg-violet-900/30 focus:ring-1 focus:ring-violet-400 transition ${val ? 'font-semibold text-t1' : 'text-t5'}`}
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-line-soft" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-surface-2 border-t border-line-soft flex items-center gap-3">
            <p className="text-xs text-t4">Dica: Selecione um intervalo no Excel e cole (Ctrl+V) diretamente na célula inicial da matriz.</p>
          </div>
        </div>
      )}

      {/* Calculator */}
      <div className="bg-surface rounded-xl border border-line-soft shadow-none p-5">
        <h2 className="text-sm font-semibold text-t2 mb-4 flex items-center gap-2">
          <Calculator size={16} className="text-violet-400" /> Testar Algoritmo
        </h2>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-t3 mb-1">Nº de Produtos</label>
            <input type="number" min="1" value={calcQty} onChange={e => setCalcQty(Number(e.target.value))}
              className="w-28 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div>
            <label className="block text-xs text-t3 mb-1">Score</label>
            <input type="number" min="0" value={calcScore} onChange={e => setCalcScore(Number(e.target.value))}
              className="w-28 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={handleCalculate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-t1 bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            <Calculator size={14} /> Calcular
          </button>
          {calcResult && (
            <div className="bg-violet-900/25 border border-violet-500/30 rounded-lg px-4 py-2">
              <p className="text-xs text-violet-400 font-medium">Caixa sugerida:</p>
              <p className="text-base font-bold text-violet-300">{calcResult}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
