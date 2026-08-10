---
description: Roda a bateria de performance do WMS e gera o PDF comparativo (~1h)
---

Rode a bateria de performance do WMS Kiwkiw.

**Primeiro, leia `PERFORMANCE_TESTES.md` na raiz do projeto** — ele tem o protocolo
completo, o histórico das rodadas anteriores, o gargalo conhecido em aberto e as
armadilhas que já custaram tempo. Siga a seção "REGRA DE OPERAÇÃO" dele.

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

Se o argumento `$ARGUMENTS` vier preenchido, use como rótulo da rodada.

**Se o smoke test falhar, o script aborta antes da carga longa** — é proposital.
Significa que há algo quebrado no código atual: investigue e conserte antes de rodar.

Para só validar o ambiente sem gastar a hora, use `perf_runner.py --so-smoke` (~5 min).
