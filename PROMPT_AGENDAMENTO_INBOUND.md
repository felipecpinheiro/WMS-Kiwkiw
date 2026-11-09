# PROMPT — Agendamento de Inbound (Portal do Seller + Recebimentos + Financeiro)

> Cole tudo abaixo da linha em uma sessão nova do Claude Code, na raiz do projeto.
> Este arquivo é só o prompt; não é código. Não commitar.

---

## Contexto e regra de processo

Você vai implementar a feature **Agendamento de Inbound** no WMS Kiwkiw. Antes de qualquer coisa, leia o `CLAUDE.md` inteiro, em especial: a **REGRA ABSOLUTA** do topo, "ENTRADA: estoque entra na FINALIZAÇÃO da bipagem (24/08/2026)", "NF com SKU sem produto cadastrado fica FORA do manuseio", "SKUs Descontinuados", "FONTE ÚNICA de parâmetros de faturamento", "Cobrança por FAIXA", "Insumos do Cliente" (padrão de aba nova no Portal) e a tabela "Erros Comuns".

**O sistema está em produção com operação real. Regras do dono, que valem para o trabalho todo:**

1. **Antes de escrever qualquer código, faça TODAS as perguntas que restarem — de todas as fases, de uma vez só** (seção "Perguntas obrigatórias" no fim). Não comece a Fase 1 sem as respostas.
2. Antes de cada fase, apresente: quais arquivos serão modificados, o que muda em cada um e por quê. **Espere confirmação explícita.**
3. O trabalho é dividido em **4 fases**. Ao terminar uma fase (testada e conferida), **mostre o resumo e siga direto para a próxima** — mas só depois de apresentar o plano da próxima e receber o "pode". Como todas as perguntas já foram feitas no início, a confirmação deve ser rápida.
4. **Sem commit e sem push** sem eu pedir. Quando eu pedir commit: **nunca** incluir linha `Co-Authored-By` nem qualquer menção de autoria por IA (pedido explícito do dono no `CLAUDE.md`).
5. O repositório é **público**: nenhum segredo, URL de banco ou senha em código, teste ou documentação.
6. Título da sessão em português.

## O que é a feature (visão geral)

O **seller (role `client`)** agenda a chegada de uma carga no armazém. O time da Kiwkiw acompanha, marca quando a carga chega, a conferência acontece pela bipagem de entrada que já existe, e ao finalizar a conferência o estoque entra. Cada recebimento também conta para a cobrança mensal do seller.

### Fluxo e status

`Agendado → Recebido → Em conferência → Conferido`, mais `Cancelado`.
Os status são **texto validado em código** (sem enum nativo no Postgres), como o CRM e os Insumos.

| Transição | Quem / o quê dispara |
|---|---|
| (cria) → **Agendado** | O seller, ao salvar o agendamento |
| Agendado → **Recebido** | O time (manager ou admin), manualmente, quando a carga chega. **Esta ação precisa de um lugar na interface — ver Fase 3** |
| Recebido → **Em conferência** | **Automático**: quando começa a bipagem da primeira NF do agendamento |
| Em conferência → **Conferido** | **Automático**: quando o `finalize-entry` com `confirm=true` conclui a(s) NF(s). **É aí que o estoque entra** |
| Agendado → **Cancelado** | O seller (ou o time) |

- O seller pode **editar, reagendar e cancelar** enquanto estiver `Agendado`. Depois de `Recebido`, **não** pode mais (o servidor recusa com 400/409, não só a tela).
- Um agendamento pode ter **várias NFs**. Regra de status com várias NFs: **a confirmar na pergunta Q4**.

## Decisões já tomadas pelo dono (não rediscutir)

1. **O upload do XML cria a NF de entrada automaticamente.** Lê a NF-e (número, chave de acesso, itens: SKU = `cProd`, quantidade = `qCom`, descrição = `xProd`) e cria o `Order` de entrada com `OrderItem`s já no momento do agendamento.
2. **O estoque entra pela contagem física**, exatamente como hoje (bipagem com campo QTD + botão Finalizar → `finalize-entry`). **Não** lançar a quantidade do XML. Reaproveitar tudo o que já existe de entrada; **não duplicar lógica de estoque**.
3. **Arquivos por NF:** XML (obrigatório), PDF da DANFE (opcional), Excel (opcional). PDF e Excel são **só anexo/controle interno** — o sistema não lê. Só o XML é lido.
4. **Armazenamento:** os arquivos ficam **no banco** (coluna binária), porque o disco do Railway é efêmero. Limite de tamanho por arquivo (sugestão: 10 MB — confirmar na Q9). Servir download autenticado (padrão `downloadAuthenticatedFile` do `api.ts`).
5. **Datas:** só **dias úteis** (sáb/dom fora; sem feriados por enquanto — mesma simplificação de `crm_calc.py`). Períodos: **Manhã** ou **Tarde**.
6. **Volumes / paletes:** campos para o seller informar, com a opção explícita **"Não sei"** (e um aviso na tela de que pode escrever que não sabe).
7. **NF duplicada** (mesma chave de acesso já existente em outro agendamento ou como `Order`): **bloqueia** com mensagem clara.
8. **Não validar CNPJ** do XML contra o seller.
9. **SKU do XML sem produto cadastrado ou descontinuado:** o agendamento é **aceito**; o seller **não** vê aviso; gera **aviso interno** para o time, com link direto para resolver (mesma ideia do `/kits/vincular` e do SKU faltante: cadastrar o produto).
10. **Seller sem unidade:** **não bloqueia**; gera aviso interno com link para associar a unidade (reaproveitar `/sellers/corrigir`).
11. **Sem e-mail e sem notificação push** nesta versão: o status só aparece na tela.
12. **Quem muda status manualmente:** manager para cima (`require_manager_or_above`). Operador só vê.
13. **Tela interna:** cards ordenados por data, parecidos com os de Manuseios (`Handling.tsx`) — não é calendário.
14. **`Conferido` só quando o operador aperta o botão Finalizar** (confirmação do `finalize-entry`); nunca automático por bater a quantidade.
15. **Cobrança:** cada recebimento que for marcado como **Recebido** conta +1 no mês daquele seller. O financeiro cobra um valor por recebimento **acima de X** (franquia). Gera uma **aba nova** na área do Financeiro. Detalhes na Fase 4.

## Fases

### Fase 1 — Modelo de dados e backend do agendamento (sem tela)

- Tabelas novas (nascem pelo `create_all`, sem migração manual quando forem tabelas inteiras novas): agendamento (seller, unidade, data, período, status, volumes, paletes, observação, quem criou, `received_at` e quem recebeu, timestamps via `now_brasilia()`), arquivos (agendamento, tipo PDF/XML/XLSX, nome, conteúdo, tamanho, nº da NF, chave) e o vínculo agendamento ↔ `Order` (avaliar coluna nova `Order.inbound_appointment_id` com migração idempotente em `run_light_migrations()` **ou** tabela de ligação — recomende e justifique).
- Parser de NF-e (XML): tolerar namespace, extrair `nNF`, chave (`infNFe/@Id` sem o prefixo `NFe`), emitente/destinatário (só informativo), itens. Proteger contra XML malicioso (limite de tamanho; considerar `defusedxml` se já for dependência, senão desabilitar resolução de entidades). SKU numérico vindo como float vira texto sem `.0`.
- Endpoints sob um prefixo novo (ex.: `/inbound`), escopo **sempre pelo `seller_id` do token** para `client` (nunca por parâmetro) e `get_user_seller_ids` para manager. `admin` lê tudo.
- Criar o `Order` de entrada **sem baixar estoque** (entrada não baixa no import — confirmar que `apply_stock_for_orders` pula) e **sem PDF de separação/expedição**.
- ⚠️ **Ponto crítico a resolver e me mostrar antes de implementar:** a NF criada no agendamento **não pode aparecer no Manuseios/Scanner antes de a carga chegar**. Hoje `get_session_orders`, `open_order_by_nfe` e `session_cards` já seguram NF por motivo (sem produto, descontinuado). Proponha segurar a NF enquanto o agendamento estiver `Agendado` (e `Cancelado`), reaproveitando esse mecanismo, com `blocked_reason` próprio — **sem** confundir com `missing_product`/`discontinued_sku` nos badges (armadilha documentada: `held_orders` é a UNIÃO de motivos, use contagens separadas).
- Entender como o `Order` se liga a `PickingSession` (todo pedido tem `session_id`; Manuseios é por sessão) e propor como o recebimento vira card de manuseio: uma sessão por agendamento? Só criar a sessão quando virar `Recebido`? Apresente as opções com prós e contras.
- Gatilhos automáticos: no **início da bipagem** (`open-by-nfe`/primeiro `process_scan` da NF) mudar o agendamento para `Em conferência`; no **`finalize-entry` com `confirm=true`** mudar para `Conferido`. Fazer dentro da mesma transação do gatilho existente, sem tocar na lógica de estoque.
- Cancelar agendamento: cancela os `Order`s de entrada vinculados (`status=cancelled`, soft). Como a entrada ainda não lançou estoque, não há estorno — **mas valide** isso lendo `reverse_stock_for_order`/`order_has_stock_applied`.
- `AuditLog` em toda criação, edição, reagendamento, cancelamento e mudança de status.
- Validações no servidor (nunca só na tela): data é dia útil e não está no passado; período válido; XML presente por NF (PDF e Excel opcionais); chave duplicada; status só avança pelo caminho permitido; seller não edita depois de `Recebido`.
- **Testes:** bateria E2E via TestClient em **SQLite e PostgreSQL** descartáveis (cada recusa sem alterar nada, escopo entre sellers, 403 de operador, XML inválido/vazio/gigante, NF duplicada, transições de status, gatilhos de bipagem e finalização, cancelamento, estoque **não** mexido até o `finalize-entry`). Rodar também regressão do fluxo de entrada existente (97 verificações descritas no `CLAUDE.md` são a referência do que não pode quebrar).

### Fase 2 — Aba "Agendamento de Inbound" no Portal do Seller

- Nova aba em `SellerPortal.tsx` (padrão da aba Insumos: arquivo próprio em `frontend/src/pages/`, loader próprio, react-query, `api.ts` com o cliente e tipos).
- Lista dos agendamentos do seller com status e histórico; botão "Novo agendamento".
- Tela de criação: escolher **dia** (só dias úteis) e **período** (Manhã/Tarde) → tela de **upload** por NF (XML obrigatório, PDF opcional, Excel opcional; várias NFs) → volumes/paletes (com "Não sei" e o aviso) → observação → salvar → status `Agendado`.
- Editar/reagendar/cancelar só em `Agendado`; botões somem depois, **e o servidor recusa** de qualquer jeito.
- Feedback de erro claro (NF duplicada, XML ilegível, dia inválido). O seller **não** vê avisos internos (SKU sem cadastro etc.).
- Datas com `todayBrasiliaStr()` de `timezone.ts`. Mobile: cartões em vez de tabela larga (lição do Portal de 15/10). Tema claro e escuro; botão sólido roxo com `text-white` (armadilha de contraste conhecida).
- `tsc --noEmit` limpo + conferência visual (desktop e celular, claro e escuro), sem erro novo no console.

### Fase 3 — Tela interna de Recebimentos + ação "Recebido" + avisos

- Tela nova (admin/manager veem e mudam; operador só vê — confirmar visibilidade do operador na Q8) com **cards por data, em ordem de data**, agrupados/rotulados por período e filtráveis por unidade, seller e status, no espírito de `Handling.tsx` (respeitar o seletor de unidade ativa e o comportamento de "Todas" para admin/manager).
- Card mostra: seller, data/período, status, nº de NFs, volumes/paletes, observação, anexos para download, e **avisos internos** (SKU sem cadastro/descontinuado → link para cadastrar produto; seller sem unidade → link para associar unidade).
- Ação **"Marcar como Recebido"** (manager+). **Onde fica esta ação é decisão que preciso confirmar na Q1** — a sugestão é um botão no próprio card da tela de Recebimentos. Ao marcar: grava `received_at`/quem recebeu, libera as NFs para o Manuseios/Scanner, e dispara a contagem da Fase 4.
- Evitar o laço de render do `useQuery` com default `= []` como dependência de `useEffect` (armadilha documentada).
- Item de menu novo para admin/manager (e operador, se Q8 disser que sim) em `Layout.tsx`, rota em `App.tsx` com `allowedRoles`.
- Testes de API para o `Recebido` + conferência visual.

### Fase 4 — Contagem mensal de recebimentos + aba no Financeiro

- Contar **+1 por recebimento** no mês do `received_at` (fuso de Brasília). Regras de borda a fechar na Q5/Q6 (conta por agendamento ou por NF? e o que acontece se cancelar depois?).
- Parâmetros novos **por seller**, na fonte única `billing_seller_params`: franquia de recebimentos ("acima de X") e valor por recebimento adicional. Isso aumenta `PARAM_FIELDS` (hoje 18): atualizar `DEFAULT_PARAMS`, colunas nas **duas** tabelas de parâmetro (migração idempotente em `index_migrations`, print em texto puro), snapshot do fechamento (`close` copia, `read_frozen` lê), `BillingSellerParamsIn`, e **o front tem que mandar todos os campos no PUT** (`fieldsToParams` em `Sellers.tsx`, `buildBody` em `Billing.tsx`) — senão o Pydantic zera o resto.
- Cálculo em `services/billing_calc.py` (fonte única; não recalcular em JS): `adicional_recebimentos = max(0, qtd_recebimentos − franquia) × valor`. Entra na fatura (decidir linha própria no total — Q6). Mês **fechado** congela a contagem e os parâmetros no snapshot; reabrir volta a derivar.
- **Aba nova na área do Financeiro** (`Billing.tsx`, atrás do Acesso Protegido) listando, por seller e mês, os recebimentos contados (data, seller, NFs) e o adicional calculado. Incluir nos PDF/Excel internos e no consolidado do mês, se fizer sentido (Q6). Visibilidade para o seller no Portal Financeiro: Q7.
- Não mexe em estoque. Não recalcula meses já fechados.
- Testes: SQLite e PostgreSQL (franquia, acima da franquia, exatamente na franquia, mês virando às 21h–00h de Brasília, mês fechado imutável, reabrir), regressão do faturamento existente (números da planilha Cereous ainda batendo), `tsc` limpo, conferência visual.

## Armadilhas do `CLAUDE.md` que se aplicam aqui (leia antes de cada fase)

- Datas: sempre `now_brasilia()`/`today_brasilia()`/`end_of_day()` e `todayBrasiliaStr()`. Nunca `datetime.now()`.
- Migração: idempotente em `run_light_migrations()`; índice novo em `PERF_INDEXES` (e conferir as duas listas de checagem de índice). Indicar o impacto de lock no primeiro boot.
- Endpoint com upload/parse síncrono: `def`, **nunca** `async def`.
- Campo Pydantic **não** pode se chamar `date` (nem outro nome de tipo importado) — use `scheduled_date`.
- Sem `order_id` indevido em movimentos de estoque que não são da NF (não é o caso aqui, mas não invente movimento).
- `Order.file_type` é NULLABLE: filtros de entrada/saída com `or_(is_(None), ...)`.
- Nada de `Seller.active` esquecido: sellers inativos não aparecem em listas de seleção.
- Comparar status com o enum/constante, nunca com string escrita à mão que possa não existir.
- Painéis flutuantes dentro de tabela com rolagem: `createPortal` + `position: fixed`.
- Toda trava (editar depois de Recebido etc.) **no servidor**, não só escondendo botão.

## Perguntas obrigatórias (faça TODAS antes da Fase 1, numeradas, com sua recomendação em cada uma)

**Q1.** Onde fica a ação Agendado → Recebido? (botão no card da nova tela de Recebimentos / dentro do Manuseios / outro). Recomende.
**Q2.** Antes de `Recebido`, as NFs de entrada ficam escondidas do Manuseios e do Scanner? (recomendação: sim, seguradas). E o card de manuseio só passa a existir a partir de `Recebido`?
**Q3.** Uma sessão de picking por agendamento, ou por NF? Como isso aparece no kanban?
**Q4.** (Parcialmente respondida: `Conferido` só quando o operador aperta **Finalizar**; `Em conferência` ao começar a bipar.) Falta só: com várias NFs, o agendamento vira `Em conferência` na **primeira** NF bipada e `Conferido` quando **todas** estiverem finalizadas? NF cancelada dentro de um agendamento, como conta?
**Q5.** (Parcialmente respondida: a contagem do mês acontece ao virar **`Recebido`**, não em `Conferido`.) Falta só: conta **1 por agendamento** ou **1 por NF**?
**Q6.** Franquia "acima de X": X é por seller (parâmetro do seller)? Existe valor padrão? O adicional entra como linha própria no total da fatura e aparece no PDF/Excel/consolidado?
**Q7.** O seller vê no Portal (aba Financeiro dele) a contagem de recebimentos e o adicional? (hoje o seller não vê detalhes de faixa; avaliar o mesmo padrão `_SELLER_HIDDEN_*`).
**Q8.** O operador vê a tela de Recebimentos (somente leitura) ou ela fica só para manager+?
**Q9.** Limite de tamanho por arquivo (sugestão 10 MB) e por agendamento; quantas NFs no máximo por agendamento; XML de NF-e modelo 55 apenas?
**Q10.** Limite de agendamentos por dia/período (capacidade) e antecedência mínima/máxima. (O dono disse só "dias úteis" — confirmar se não há limite nem antecedência por enquanto.) Quais horários representam Manhã e Tarde, ou é só rótulo?
**Q11.** Reagendar muda só data/período no mesmo registro, mantendo histórico no `AuditLog`? Cancelar pede motivo?
**Q12.** Em `Conferido` com divergência (contagem ≠ XML): o que a tela de Recebimentos mostra? (a observação de divergência já é gravada no movimento de estoque; basta exibir um indicador?)
**Q13.** Re-upload: o seller pode trocar/adicionar arquivos de uma NF enquanto `Agendado`? Se trocar o XML, recria os itens da NF?
**Q14.** Seller sem unidade: o card aparece em qual unidade no filtro? ("Sem unidade" como grupo próprio?)

Depois das respostas, apresente o plano da **Fase 1** (arquivos, mudanças, motivos) e espere meu "pode".
