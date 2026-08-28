---
description: Roda a bateria de performance do WMS e gera o PDF comparativo (~1h)
---

Rode a bateria de performance do WMS Kiwkiw.

## ⚠️ ANTES DE GASTAR 1 HORA — TRIAGEM OBRIGATÓRIA

**`/perf` mede CÓDIGO, não INFRAESTRUTURA.** A bateria roda tudo na máquina local, onde o banco
está a 0,1ms de distância. Ela é **estruturalmente cega** para latência de rede entre a aplicação
e o banco — o tipo de problema que causou a lentidão crônica até 27/08/2026 (ver a seção
"A lentidão crônica NÃO era código" no `CLAUDE.md`). Naquele caso `/perf` teria dito
"está tudo ótimo" com o sistema travando em produção.

**Se a queixa for "o sistema está lento" em PRODUÇÃO, faça esta triagem primeiro — leva minutos:**

1. **Peça o log do Railway** (24h ou mais) e conte as linhas `SLOW REQUEST` por endpoint.
2. **Meça o mesmo endpoint localmente**, com dump de produção restaurado. Use cliente HTTP com
   **keep-alive** — sem isso, a abertura de conexão a cada chamada mascara tudo com ~300ms de
   ruído (já custou tempo uma vez).
3. **Se local for rápido e produção lenta**, conte quantas consultas o endpoint faz e divida o
   tempo de produção por esse número.
4. **Se der um valor constante entre endpoints diferentes** (ex.: 150ms tanto num de 33 consultas
   quanto num de 38) → **é latência de rede por consulta, não código. Pare aqui.**
   Confira o `DATABASE_URL` do serviço `web` no Railway: tem que ser a rede interna
   (`...railway.internal:5432`), nunca o proxy público (`*.proxy.rlwy.net` com porta alta).

**Sinais de que NÃO é código** (todos observados no caso de 27/08/2026):
- Endpoint barato (poucas consultas) também aparece lento
- Distribuição **bimodal** com buraco (ex.: nada entre 3s e 5,25s, depois um sino em 6,4s)
- Só uma fração das chamadas é lenta (26%), o resto é rápido
- A carga é baixa (33 req/min) e idêntica dentro e fora das janelas lentas
- O fator de lentidão é **desproporcional entre endpoints** (21× num, 957× noutro) — a mesma
  máquina não pode ser as duas coisas

**Só rode a bateria completa se a triagem apontar para código.**

## A bateria completa

**Leia `PERFORMANCE_TESTES.md` na raiz do projeto** — ele tem o protocolo completo, o histórico
das rodadas anteriores, o gargalo conhecido em aberto e as armadilhas que já custaram tempo.
Siga a seção "REGRA DE OPERAÇÃO" dele.

Resumo do que fazer:

1. Avise que leva **~1 hora** e confirme que ele pode ceder a máquina nesse período
   (o PostgreSQL local fica ocupado). Pergunte se quer dar um **rótulo** à rodada
   (ex: "depois do fix do billing") — vai para o histórico e para o PDF.
2. Execute em background, a partir de `D:\KiwKiw\plano_performance\stress_bipagem\`:

   ```powershell
   . D:\KiwKiw\backups_bd\local_pg_config.ps1
   & "D:\KiwKiw\WMS Kiwkiw\backend\venv\Scripts\python.exe" perf_runner.py --rotulo "<rótulo>"
   ```

3. O script cuida de tudo sozinho: restaura um banco descartável do backup mais recente,
   escolhe o dia mais movimentado da última semana, sobe o backend local com o código
   atual (inclusive alterações não commitadas), roda o smoke test, executa a carga de
   45 min, coleta as métricas, compara com a rodada anterior, grava no histórico,
   atualiza a tabela do `PERFORMANCE_TESTES.md`, gera o PDF e apaga o banco.
4. **Não fique consultando o progresso** — você é notificado quando terminar.
5. Ao final, apresente o resultado comparando com a rodada anterior: o que melhorou, o
   que piorou, o que ficou igual. O script já separa variação real de ruído estatístico —
   respeite essa separação e não trate ruído como regressão.
6. Envie o PDF gerado (em `performance_relatorios/`) com a ferramenta de enviar arquivo.
7. **Ao apresentar o resultado, lembre que os números são LOCAIS.** Não prometa que a melhora
   se traduz na mesma proporção em produção — lá cada consulta ainda paga a latência de rede
   que existir. Um ganho de código real aparece nos dois lugares; um número local ótimo não
   garante produção rápida.

Se o argumento `$ARGUMENTS` vier preenchido, use como rótulo da rodada.

**Se o smoke test falhar, o script aborta antes da carga longa** — é proposital.
Significa que há algo quebrado no código atual: investigue e conserte antes de rodar.

Para só validar o ambiente sem gastar a hora, use `perf_runner.py --so-smoke` (~5 min).

## Ferramental de diagnóstico reaproveitável (fora da bateria)

Para investigar um endpoint específico sem gastar 1 hora, os scripts da sessão de 27/08/2026
ficaram no scratchpad e podem ser refeitos rapidamente:

- **wrapper que conta consultas por requisição** — importa o app real e adiciona um listener do
  SQLAlchemy + middleware, **sem tocar em nenhum arquivo do repositório**. Precisa usar
  `contextvars`, não `threading.local`: os endpoints `def` rodam em threadpool e o thread-local
  não atravessa.
- **wrapper que injeta latência por consulta** — um `time.sleep()` no `before_cursor_execute`.
  É o que permitiu **reproduzir produção localmente** e provar a causa em vez de supor.
