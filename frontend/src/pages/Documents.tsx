/**
 * WMS Kiwkiw - Documentos (operador)
 *
 * Mesma lista "Uploads do Dia" do Dashboard Master, mas exclusiva do operador:
 * sem seletor de unidade (sempre todas as unidades, de propósito — decisão do
 * dono do sistema), com seletor de data, e sem o botão "Excluir sellers" (essa
 * ação continua só no Dashboard, pra admin/manager). Reaproveita os mesmos
 * endpoints que o operador já podia chamar (GET /dashboard/master e
 * GET /orders/sessions/{id}/pdf/...) — nenhuma mudança de backend.
 */

import { useState } from 'react';
import { useQuery } from 'react-query';
import { FileText, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';

import { dashboardApi, ordersApi } from '../api';
import { todayBrasiliaStr } from '../timezone';
import FulfillmentLoader from '../components/FulfillmentLoader';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

export default function DocumentsPage() {
  const todayStr = todayBrasiliaStr();
  const [targetDate, setTargetDate] = useState(todayStr);
  const isToday = targetDate === todayStr;

  // Sem unit_id de propósito — a página mostra sempre todas as unidades,
  // ignorando qualquer preferência de unidade que o usuário tenha salvo.
  const { data, isLoading } = useQuery(
    ['documents', targetDate],
    () => dashboardApi.master({ target_date: targetDate }).then(r => r.data),
    { refetchInterval: isToday ? 60000 : false }
  );

  const showFulfillmentLoader = useDelayedLoading(isLoading, 150);
  const sessions = (data?.sessions_today ?? []) as any[];

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <FulfillmentLoader show={showFulfillmentLoader} title="Carregando documentos" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-t1">Documentos</h1>
          <p className="text-sm text-t3 mt-0.5">
            {format(new Date(targetDate + 'T12:00:00'), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            {' · Todas as unidades'}
          </p>
        </div>

        <div className="flex items-center gap-1 px-2 py-1.5 bg-surface border border-line rounded-lg">
          <input
            type="date"
            value={targetDate}
            max={todayStr}
            onChange={(e) => setTargetDate(e.target.value || todayStr)}
            className="text-sm text-t2 bg-transparent focus:outline-none"
            title="Selecione a data (pelo dia do upload)"
          />
          {!isToday && (
            <button
              onClick={() => setTargetDate(todayStr)}
              className="text-xs px-2 py-0.5 text-violet-400 hover:bg-violet-900/25 rounded"
              title="Voltar para hoje"
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      {/* Lista de uploads */}
      <div className="bg-surface rounded-xl border border-line-soft shadow-none p-4">
        <h2 className="text-sm font-semibold text-t2 mb-3 flex items-center gap-2">
          <Upload size={14} className="text-t4" />
          Uploads do Dia
        </h2>

        {sessions.length === 0 ? (
          <p className="text-sm text-t4 py-6 text-center">Nenhum upload nessa data.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((sess) => {
              // A API manda o VALOR do enum, minúsculo ('entrada'/'saida').
              const isEntradaSession = String(sess.file_type || '').toLowerCase() === 'entrada';
              return (
                <div key={sess.session_id}
                  className="flex flex-col sm:flex-row items-start gap-3 p-3 bg-surface-2 rounded-lg border border-line-soft">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-t2">
                        Sessão #{sess.session_id}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isEntradaSession ? 'bg-info-soft text-info' : 'bg-violet-900/40 text-violet-300'}`}>
                        {isEntradaSession ? 'Entrada' : 'Saída'}
                      </span>
                      <span className="text-[10px] text-t4">{sess.created_at}</span>
                    </div>
                    {sess.source_file && (
                      <p className="text-[11px] text-t4 truncate mb-1" title={sess.source_file}>
                        📄 {sess.source_file}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-t3">{sess.total_orders} pedido(s)</span>
                      {sess.seller_names?.length > 0 && (
                        <span className="text-xs text-t4 truncate">
                          {sess.seller_names.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* PDFs — geração sob demanda; indicador se já salvo em disco.
                      Sessão de ENTRADA não tem esses documentos (Separação é
                      picking list e Expedição é romaneio — ambos de saída), e
                      o backend recusa a geração. Ver orders.py. */}
                  {!isEntradaSession && (
                    <div className="flex flex-row sm:flex-col flex-wrap gap-1.5 flex-shrink-0 w-full sm:w-auto">
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'separation')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Separação'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_separation ? 'text-ok bg-ok-soft border border-ok/20 hover:bg-ok-soft' : 'text-t4 bg-surface-2 border border-line hover:bg-surface-2'}`}
                      >
                        <FileText size={11} /> Separação{sess.separation_pdf ? ' ✓' : ''}
                      </button>
                      <button
                        onClick={() =>
                          ordersApi.downloadSessionPdf(sess.session_id, 'expedition')
                            .catch((err: any) => toast.error(err?.response?.data?.detail || 'Erro ao baixar PDF de Expedição'))
                        }
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg transition ${sess.check_planning ? 'text-info bg-info-soft border border-info/20 hover:bg-info-soft' : 'text-t4 bg-surface-2 border border-line hover:bg-surface-2'}`}
                      >
                        <FileText size={11} /> Expedição{sess.expedition_pdf ? ' ✓' : ''}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
