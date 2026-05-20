import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { settingsApi } from '../api';
import toast from 'react-hot-toast';
import {
  Settings, FolderOpen, Bot, Play, Square, RefreshCw,
  CheckCircle2, XCircle, Clock, FileSpreadsheet, AlertTriangle,
  ToggleLeft, ToggleRight, Save, ShieldCheck,
} from 'lucide-react';

const inputCls = "w-full border border-white/12 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 text-white/80 placeholder-white/25";
const inputStyle = { background: '#14122A', colorScheme: 'dark' as const };

function fmtTs(ts: string | null) {
  if (!ts) return '---';
  return new Date(ts).toLocaleString('pt-BR');
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-2xl border border-white/8 p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-violet-400">{icon}</span>
        <h2 className="font-semibold text-white/90 text-sm tracking-wide uppercase">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, description, children }: { label: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-6 items-start py-3 border-b border-white/5 last:border-0">
      <div>
        <p className="text-sm font-medium text-white/80">{label}</p>
        {description && <p className="text-xs text-white/35 mt-0.5 leading-snug">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function WatcherPanel() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery(
    'watcher-status',
    () => settingsApi.watcherStatus().then(r => r.data),
    { refetchInterval: 10000 }
  );

  const startMut = useMutation(() => settingsApi.startWatcher().then(r => r.data), {
    onSuccess: () => { toast.success('Watcher iniciado'); qc.invalidateQueries('watcher-status'); },
    onError: (e: any) => { toast.error(e?.response?.data?.detail || 'Erro ao iniciar'); },
  });
  const stopMut = useMutation(() => settingsApi.stopWatcher().then(r => r.data), {
    onSuccess: () => { toast.success('Watcher parado'); qc.invalidateQueries('watcher-status'); },
  });

  if (isLoading) return <p className="text-xs text-white/35 animate-pulse">Carregando status...</p>;
  if (!status)   return null;

  const running = status.running;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
          running ? 'bg-teal-900/40 text-teal-300 border border-teal-500/30'
                  : 'bg-gray-800 text-white/40 border border-white/8'
        }`}>
          {running ? <CheckCircle2 size={12} /> : <Square size={12} />}
          {running ? 'Rodando' : 'Parado'}
        </span>

        {!running ? (
          <button
            onClick={() => startMut.mutate()}
            disabled={startMut.isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg disabled:opacity-60 transition">
            <Play size={11} /> Iniciar Watcher
          </button>
        ) : (
          <button
            onClick={() => stopMut.mutate()}
            disabled={stopMut.isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600/80 hover:bg-red-500 text-white rounded-lg disabled:opacity-60 transition">
            <Square size={11} /> Parar
          </button>
        )}

        <button onClick={() => qc.invalidateQueries('watcher-status')}
          className="text-white/30 hover:text-white/60 transition ml-auto">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Ultima varredura', value: fmtTs(status.last_check) },
          { label: 'Intervalo', value: `${status.interval_sec}s` },
          { label: 'Arqs processados', value: String(status.files_processed) },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 rounded-xl p-3 border border-white/6">
            <p className="text-lg font-bold text-white/90">{s.value}</p>
            <p className="text-[10px] text-white/35 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {status.last_files.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Ultimos arquivos</p>
          <div className="bg-gray-950/60 rounded-xl border border-white/6 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-white/30 uppercase tracking-wide">
                  <th className="text-left py-2 px-3 font-semibold">Arquivo</th>
                  <th className="text-left py-2 px-3 font-semibold">Data/Hora</th>
                  <th className="text-center py-2 px-3 font-semibold">Status</th>
                  <th className="text-center py-2 px-3 font-semibold">Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {[...status.last_files].reverse().map((f, i) => (
                  <>
                    <tr key={`row-${i}`} className={`border-b transition ${
                      f.success ? 'border-white/5 hover:bg-white/2' : 'border-red-900/30 bg-red-950/10'
                    }`}>
                      <td className="py-2 px-3 font-mono truncate max-w-[200px]">
                        <FileSpreadsheet size={11} className={`inline mr-1.5 ${f.success ? 'text-teal-400' : 'text-red-400/70'}`} />
                        <span className={f.success ? 'text-white/60' : 'text-red-300/80'}>{f.file}</span>
                      </td>
                      <td className="py-2 px-3 text-white/35">{fmtTs(f.timestamp)}</td>
                      <td className="py-2 px-3 text-center">
                        {f.success
                          ? <CheckCircle2 size={13} className="inline text-teal-400" />
                          : <XCircle size={13} className="inline text-red-400" />
                        }
                      </td>
                      <td className="py-2 px-3 text-center text-white/60 font-bold" title={f.dest || ''}>
                        {f.success ? (f.orders || '0') : '---'}
                      </td>
                    </tr>
                    {/* Linha de erro expandida — visível apenas quando falhou */}
                    {!f.success && (
                      <tr key={`err-${i}`} className="border-b border-red-900/20 bg-red-950/20">
                        <td colSpan={4} className="px-4 py-2.5">
                          <div className="flex items-start gap-2 text-xs">
                            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-red-400" />
                            <div className="space-y-1 min-w-0">
                              {/* Motivo principal */}
                              <p className="font-semibold text-red-300">
                                {f.reason || 'Erro ao processar arquivo'}
                              </p>
                              {/* Detalhes contextuais (sellers, NFs, colunas…) */}
                              {f.details && (
                                <div className="bg-red-900/20 rounded-lg px-3 py-2 border border-red-500/15">
                                  {f.details.split('\n').map((line: string, li: number) => (
                                    <p key={li} className="text-red-300/80 leading-snug">
                                      {line}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {/* Destino do arquivo */}
                              {f.dest && (
                                <p className="text-white/25 font-mono text-[10px] truncate" title={f.dest}>
                                  → {f.dest}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {status.last_files.length === 0 && (
        <p className="text-xs text-white/25 text-center py-4">
          <Clock size={14} className="inline mr-1.5" />
          Nenhum arquivo processado ainda nesta sessao
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery(
    'app-settings',
    () => settingsApi.getAll().then(r => r.data)
  );

  const [form, setForm] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);

  if (settings && !initialized) {
    const initial: Record<string, string> = {};
    Object.entries(settings).forEach(([k, v]) => { initial[k] = v.value ?? ''; });
    setForm(initial);
    setInitialized(true);
  }

  const saveMut = useMutation(
    (data: Record<string, string>) => settingsApi.update(data).then(r => r.data),
    {
      onSuccess: () => {
        toast.success('Configuracoes salvas');
        setDirty(false);
        qc.invalidateQueries('app-settings');
        qc.invalidateQueries('watcher-status');
      },
      onError: () => { toast.error('Erro ao salvar'); },
    }
  );

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function toggle(key: string) {
    const cur = form[key] === 'true';
    set(key, cur ? 'false' : 'true');
  }

  function handleSave() {
    saveMut.mutate(form);
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center text-white/30 animate-pulse">
        <Settings size={32} className="mx-auto mb-3" />
        <p>Carregando configuracoes...</p>
      </div>
    );
  }

  const desc = (key: string) => settings?.[key]?.description || '';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-violet-600/20 rounded-xl flex items-center justify-center">
            <Settings size={18} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white/90">Configuracoes Gerais</h1>
            <p className="text-xs text-white/35">Parametros globais do sistema WMS Kiwkiw</p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={saveMut.isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-xl font-medium disabled:opacity-60 transition shadow-lg shadow-violet-900/40">
            <Save size={14} />
            {saveMut.isLoading ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        )}
      </div>

      <SectionCard title="Monitoramento Automatico de Pasta" icon={<FolderOpen size={16} />}>
        <FieldRow label="Pasta de Entrada (Inbox)" description={desc('inbox_folder')}>
          <input
            value={form['inbox_folder'] ?? ''}
            onChange={e => set('inbox_folder', e.target.value)}
            placeholder="Ex: C:\\WMS\\inbox"
            className={inputCls}
            style={inputStyle}
          />
          <p className="text-[10px] text-white/25 mt-1">Caminho completo da pasta monitorada. Coloque aqui os Excel exportados do ERP.</p>
        </FieldRow>

        <FieldRow label="Pasta de Processados" description={desc('processed_folder')}>
          <input
            value={form['processed_folder'] ?? ''}
            onChange={e => set('processed_folder', e.target.value)}
            placeholder="Ex: C:\\WMS\\processados"
            className={inputCls}
            style={inputStyle}
          />
          <p className="text-[10px] text-white/25 mt-1">Apos a importacao, o arquivo e movido aqui com prefixo de data e status (ok/erro).</p>
        </FieldRow>

        <FieldRow label="Intervalo de Varredura" description={desc('watcher_interval_sec')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="10"
              max="3600"
              value={form['watcher_interval_sec'] ?? '30'}
              onChange={e => set('watcher_interval_sec', e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
            <span className="text-xs text-white/35 whitespace-nowrap">segundos</span>
          </div>
        </FieldRow>

        <FieldRow label="Iniciar automaticamente" description="Reativa o watcher ao reiniciar o servidor">
          <button
            onClick={() => toggle('watcher_enabled')}
            className={`flex items-center gap-2 text-sm transition ${
              form['watcher_enabled'] === 'true' ? 'text-teal-300' : 'text-white/40'
            }`}>
            {form['watcher_enabled'] === 'true'
              ? <ToggleRight size={22} className="text-teal-400" />
              : <ToggleLeft size={22} className="text-white/25" />}
            {form['watcher_enabled'] === 'true' ? 'Habilitado' : 'Desabilitado'}
          </button>
        </FieldRow>

        {dirty && (
          <div className="flex items-center gap-2 mt-3 p-2.5 bg-amber-900/20 border border-amber-500/20 rounded-lg">
            <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">Salve antes de iniciar/parar o watcher para aplicar as novas configuracoes de pasta.</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Status do Robo (Watcher)" icon={<Bot size={16} />}>
        <WatcherPanel />
      </SectionCard>

      <SectionCard title="Comportamento de Importacao" icon={<Settings size={16} />}>
        <FieldRow label="Gerar PDFs automaticamente" description={desc('auto_generate_pdfs')}>
          <button
            onClick={() => toggle('auto_generate_pdfs')}
            className={`flex items-center gap-2 text-sm transition ${
              form['auto_generate_pdfs'] === 'true' ? 'text-teal-300' : 'text-white/40'
            }`}>
            {form['auto_generate_pdfs'] === 'true'
              ? <ToggleRight size={22} className="text-teal-400" />
              : <ToggleLeft size={22} className="text-white/25" />}
            {form['auto_generate_pdfs'] === 'true' ? 'Habilitado' : 'Desabilitado'}
          </button>
        </FieldRow>

        <FieldRow label="Exigir todas as checagens" description={desc('require_all_checks')}>
          <button
            onClick={() => toggle('require_all_checks')}
            className={`flex items-center gap-2 text-sm transition ${
              form['require_all_checks'] === 'true' ? 'text-teal-300' : 'text-white/40'
            }`}>
            {form['require_all_checks'] === 'true'
              ? <ToggleRight size={22} className="text-teal-400" />
              : <ToggleLeft size={22} className="text-white/25" />}
            {form['require_all_checks'] === 'true' ? 'Obrigatorio' : 'Opcional'}
          </button>
        </FieldRow>

        <FieldRow label="Tipo de movimentacao padrao" description={desc('default_movement_type')}>
          <select
            value={form['default_movement_type'] ?? 'Saida'}
            onChange={e => set('default_movement_type', e.target.value)}
            className={inputCls}
            style={inputStyle}>
            <option value="Saida">Saida</option>
            <option value="Entrada">Entrada</option>
          </select>
        </FieldRow>
      </SectionCard>

      {/* ── Checagens de Validação ───────────────────────────────────── */}
      <SectionCard title="Checagens de Validacao" icon={<ShieldCheck size={16} />}>
        <p className="text-xs text-white/35 mb-4 leading-relaxed">
          Defina quais validacoes sao executadas automaticamente ao importar um arquivo.
          Desabilitar uma checagem remove-a do calculo do semaforo e do painel do dia.
        </p>

        {(
          [
            {
              key:   'check_transportadora',
              label: 'Transportadora obrigatoria',
              desc:  'Alerta quando pedidos nao possuem transportadora definida. Util para operacoes com multiplas transportadoras.',
              badge: 'P6',
            },
            {
              key:   'check_nf_unicas',
              label: 'NFs unicas (sem duplicatas DANFE)',
              desc:  'Verifica se as chaves de acesso DANFE sao unicas dentro da sessao. Detecta notas importadas em duplicidade.',
              badge: 'P8',
            },
            {
              key:   'check_produtos_cadastrados',
              label: 'Produtos cadastrados',
              desc:  'Verifica se todos os SKUs dos pedidos do dia estao cadastrados na base de produtos do seller. Fundamental para bipagem.',
              badge: 'P12',
            },
          ] as { key: string; label: string; desc: string; badge: string }[]
        ).map(({ key, label, desc, badge }) => (
          <FieldRow
            key={key}
            label={
              <span className="flex items-center gap-2">
                {label}
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-violet-900/40 text-violet-400 rounded border border-violet-500/20">
                  {badge}
                </span>
              </span>
            }
            description={desc}
          >
            <button
              onClick={() => toggle(key)}
              className={`flex items-center gap-2 text-sm transition ${
                form[key] === 'true' ? 'text-teal-300' : 'text-white/40'
              }`}>
              {form[key] === 'true'
                ? <ToggleRight size={22} className="text-teal-400" />
                : <ToggleLeft size={22} className="text-white/25" />}
              {form[key] === 'true' ? 'Habilitada' : 'Desabilitada'}
            </button>
          </FieldRow>
        ))}
      </SectionCard>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saveMut.isLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-xl font-medium disabled:opacity-60 transition shadow-xl shadow-violet-900/50">
            <Save size={14} />
            {saveMut.isLoading ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </div>
      )}
    </div>
  );
}
