# CLAUDE.md — WMS Kiwkiw

## ⚠️ REGRA ABSOLUTA — LEIA ANTES DE QUALQUER COISA

**O título de cada sessão/chat deve ser criado em português.**

**NUNCA altere nenhuma linha de código sem seguir este processo obrigatório:**

1. **Fazer o máximo de perguntas possível** antes de propor qualquer solução — mesmo que a tarefa pareça simples.
2. **Apresentar explicitamente**, antes de qualquer alteração:
   - Quais arquivos serão modificados
   - O que exatamente será alterado em cada um
   - Por que aquela alteração é necessária
3. **Aguardar confirmação explícita do usuário** para cada item listado acima.
4. **Só então realizar as alterações** — nada antes.

Este projeto está em fase de testes ativos com pessoas reais. Qualquer mudança não autorizada pode quebrar fluxos críticos de operação de um fulfillment.

---

## Convenções de Commit Git

- **Nunca incluir a linha `Co-Authored-By: Claude ...`** (ou qualquer menção de autoria por IA) nas mensagens de commit deste projeto. Pedido explícito do usuário em 2026-07-22.

---

## Visão Geral do Sistema

**WMS Kiwkiw** é um sistema de gerenciamento de armazém (Warehouse Management System) para a empresa Kiwkiw, que atua como **fulfillment** — ou seja, recebe, armazena e despacha produtos de seus clientes (chamados "sellers").

O sistema digitaliza e controla todo o fluxo de:
- Importação de pedidos vindos dos ERPs dos sellers (Tiny, Bling, etc.)
- Separação e bipagem (scanning) dos produtos no armazém
- Controle de estoque por seller
- Faturamento dos serviços prestados
- Portal de acompanhamento para os próprios sellers

**Status atual:** **Em produção desde 24/07/2026.** A fase de testes foi encerrada: os dados fictícios foram apagados e o banco recebeu a carga real — 47 sellers, 16.843 produtos e o histórico de estoque das planilhas dos clientes. Qualquer alteração agora afeta operação real.

---

## Mudanças Recentes — 03/09/2026 — Acesso Protegido ao Financeiro + SECRET_KEY/WMS_EDIT_PASSPHRASE por variável de ambiente

> ⚠️ **04/09/2026 — TEMPORARIAMENTE DESATIVADO em produção**, a pedido do dono: o envio de e-mail
> ainda estava sendo configurado e a equipe precisava usar o Faturamento na hora. `/billing` está
> de volta a `require_admin` puro, sem pedir código — igual era antes desta feature. Nada foi
> apagado, só desligado por duas chaves (`Depends(require_admin)` nos 11 endpoints de
> `routers/billing.py` + `ACCESS_GATE_ENABLED = false` em `Billing.tsx`) — ver o comentário no
> topo de `routers/billing.py` pra reativar. Todo o resto desta seção descreve o comportamento
> **quando a feature estiver ligada** de novo.
>
> **04/09/2026 (mesmo dia, à tarde) — o transporte de e-mail mudou de novo, pra API do Gmail
> (OAuth2)** — trocado local, **commit sem push ainda** (o dono revisa antes de subir). Motivo:
> ele queria mandar de uma conta Gmail pessoal (`felipecspinheiro88@gmail.com`) pra qualquer
> destinatário, e o Resend só permite isso com domínio próprio verificado (não dá pra "verificar"
> `gmail.com`). Ver a seção "E-mail: 3ª tentativa" mais abaixo — a versão via Resend (2ª tentativa)
> **fica documentada como histórico**, não é mais o código atual.

Variáveis do Railway configuradas em 03/09 pro Resend (2ª tentativa) — **precisam ser trocadas**
pelas do Gmail (`WMS_GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`) antes de reativar a feature de vez;
ver a tabela de variáveis de ambiente mais abaixo no arquivo.

### Acesso Protegido ao Financeiro

Mesmo sendo **admin**, usar `/billing` agora exige confirmar um **código de 6 dígitos enviado por
e-mail** a uma lista fixa de responsáveis (`WMS_BILLING_APPROVERS`). O acesso liberado dura **4h,
por usuário** (vale em qualquer navegador/dispositivo onde ele logar dentro da janela). Existe um
**código-mestre de emergência** (`WMS_BILLING_MASTER_CODE`, opcional — sem ele o app sobe normal e
só falta o backup).

**Arquivos:** `backend/models.py` (`BillingAccessCode`, tabela nova — nasce pelo `create_all`, sem
migração), `backend/routers/billing_access.py` (novo — `POST /billing/access/request`,
`POST /billing/access/verify`, `GET /billing/access/status`), `backend/services/billing_access_mail.py`
(novo — e-mails via **API do Gmail (OAuth2)**, não SMTP nem Resend — ver "E-mail: 3ª tentativa"
abaixo; sem as 3 variáveis `WMS_GMAIL_*` só imprime no console, é o modo dev local), `backend/auth.py`
(`require_billing_access`), `backend/routers/billing.py` (troca
`require_admin` → `require_billing_access` nos 11 endpoints que mostram R$ — box-prices, closing,
close, reopen, pdf, excel, consolidated + excel + pdfs.zip), `backend/schemas.py`, `backend/main.py`
(registra o router), `frontend/src/api.ts` (`billingApi.accessStatus/requestAccessCode/verifyAccessCode`),
`frontend/src/pages/Billing.tsx` (tela-portão que substitui todo o conteúdo enquanto a janela de 4h
não estiver liberada + mini-contador no topo quando liberada).

**Regras (decididas com o dono numa sessão de planejamento anterior):**
- Código: 6 dígitos, 100000–999999, pode repetir/começar com 0. Vale **10 min pra digitar**. Pedir
  de novo **não invalida** o(s) anterior(es) — cada um vale até o próprio prazo.
- Rate-limit de pedido: **1/min e 5/hora, por usuário**. Guardado o hash SHA-256 do código, nunca o
  número em claro.
- **5 erros seguidos** (código de e-mail ou mestre, mesmo balde) → bloqueia **15 min** tanto a
  digitação quanto o pedido de novo código. Zera ao acertar ou depois dos 15 min.
- Código-mestre: frase longa gerada pelo sistema, um só para a empresa toda, mesma caixa de texto
  do código de 6 dígitos. Dá as mesmas 4h. Todo uso gera `AuditLog` destacado + e-mail de alerta.
- `NÃO TRAVA` (decisão do dono, ficam como estavam): `seller-params`/`seller-box-prices`
  (aba Comercial de Sellers, `require_manager_or_above`) e `/billing/my/...` (Portal do seller).
- **Rate-limit e o contador de 5 erros são derivados só de `AuditLog`** (`entity_type=
  "AcessoFinanceiro"`, ações `PEDIDO_CODIGO`/`ACERTO`/`ERRO`/`BLOQUEIO`) — **sem tabela nem coluna
  de tentativas**, a própria trilha de auditoria pedida na spec já é o dado necessário.

**Armadilhas:**

| Situação | Armadilha | Como evitar |
|---|---|---|
| Reutilizar um objeto ORM depois de fechar a `Session` que o carregou | `DetachedInstanceError` — apareceu 3× nos scripts de teste desta feature | Capturar o `.id` (ou outro escalar) num `int` comum logo após a query, nunca reabrir `SessionLocal()` e reusar o objeto antigo |
| "Zerar" o contador de erros ou o bloqueio manipulando data em SQLite via `datetime('now')` | `datetime('now')` do SQLite é **UTC**; o app compara com `now_brasilia()` (UTC-3) — um "expira 1 min atrás" em UTC pode continuar **3h no futuro** em Brasília e o teste "passa" sem testar nada | Testar via a própria sessão do SQLAlchemy com `now_brasilia() - timedelta(...)`, nunca SQL cru com `datetime('now')` |
| Tentar destravar a rota `/billing` por completo | O objetivo é travar só os 11 endpoints com R$ — `seller-params`/`seller-box-prices`/`/billing/my` continuam abertos, por decisão do dono | Trocar a dependency só nos 11 endpoints listados acima, nunca no router inteiro |

⚠️ **Railway bloqueia SMTP fora do plano Pro (achado em produção, 03/09/2026).** A primeira versão
do `billing_access_mail.py` usava `smtplib` (Gmail + senha de app) — funcionava perfeito em dev
local, mas em produção toda chamada a `/billing/access/request` demorava **exatos 15043ms** (o
timeout que eu tinha configurado) e devolvia 500. Testado direto no **Console** do próprio serviço
no Railway (`python3 -c "import socket; socket.create_connection(('smtp.gmail.com', 587),
timeout=5)"`) → `OSError: [Errno 101] Network is unreachable`, **imediato**. Confirmado na
documentação oficial: Railway bloqueia saída nas portas 465/587/2525 nos planos Free/Trial/Hobby,
de propósito, anti-spam — só libera no plano **Pro** (e exige reimplantar depois do upgrade).

**Correção:** trocado `smtplib`/SMTP por **API HTTP do Resend** (`https://api.resend.com/emails`,
POST com `urllib` puro — zero dependência nova, mesma decisão de design). HTTPS (porta 443) não
esbarra nesse bloqueio, funciona em qualquer plano do Railway. Variáveis mudaram de `WMS_SMTP_*`
para `WMS_RESEND_API_KEY` + `WMS_MAIL_FROM`.

⚠️ **Cloudflare na frente da API do Resend recusa o User-Agent padrão do `urllib`** (
`Python-urllib/3.x`) com **403 "error code: 1010"** — parece erro do Resend, mas é bloqueio de bot
do Cloudflare por causa do cabeçalho. Corrigido mandando um `User-Agent` normal
(`wms-kiwkiw-billing-access/1.0`) na requisição. Vale pra qualquer chamada HTTP nova que este
projeto fizer com `urllib` puro — bibliotecas tipo `requests` já mandam um UA mais "normal" e não
costumam esbarrar nisso.

⚠️ **Modo sandbox do Resend:** sem verificar um domínio próprio (`kiwkiw.com.br`, via DNS), só é
possível **mandar e-mail pro endereço com que a conta do Resend foi criada**, e o remetente fica
preso a `onboarding@resend.dev`. `WMS_BILLING_APPROVERS` em teste tem que ser exatamente esse
e-mail, senão o envio falha. Verificar o domínio é passo separado, pendente, pra quando for pra
valer com os aprovadores reais.

**Testes:** 68 verificações E2E (+ 4 do cenário "sem `WMS_BILLING_MASTER_CODE`"), **100% verdes em
SQLite e PostgreSQL** (banco descartável `wms_test_billing_access`, apagado ao final), mais
conferência visual ponta a ponta (portão, código em modo console, contador, expiração devolve ao
portão, modo claro/escuro, mobile) contra o banco local (cópia de produção via `/attEstoque`), mais
2 envios reais confirmados via API do Resend (código + os 2 tipos de alerta). **(Esta versão via
Resend foi substituída no mesmo dia — ver seção seguinte. Fica registrada como histórico.)**

### E-mail: 3ª tentativa — API do Gmail (OAuth2), 04/09/2026

**Sem push** (commit local, dono revisa antes). A 2ª tentativa (Resend) funcionava, mas o dono
queria mandar **de uma conta Gmail pessoal** (`felipecspinheiro88@gmail.com`) **pra qualquer
destinatário** — e nenhum provedor de e-mail transacional deixa mandar "como se fosse" um
endereço `@gmail.com`, verificado ou não: só dá pra verificar um domínio que você é dono, e
`gmail.com` é do Google. Então a combinação "remetente = Gmail pessoal" + "destinatário = qualquer
um" só existe pela própria **API do Gmail**, com OAuth2.

**O que mudou:** `billing_access_mail.py` reescrito de novo — `_send()` troca o `refresh_token`
por um `access_token` (`POST https://oauth2.googleapis.com/token`) e manda o e-mail por
`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` (corpo = MIME em
base64url). Só `urllib`/`email.mime`/`base64` da biblioteca padrão — zero dependência nova, mesma
decisão de design das duas tentativas anteriores. Variáveis: `WMS_GMAIL_CLIENT_ID`,
`WMS_GMAIL_CLIENT_SECRET`, `WMS_GMAIL_REFRESH_TOKEN` (as 3 têm que estar setadas, senão cai no
modo console) + `WMS_MAIL_FROM` (agora é o cabeçalho `From:` completo, ex:
`"WMS Kiwkiw <felipecspinheiro88@gmail.com>"` — **o endereço tem que ser exatamente o da conta
que autorizou**, o Gmail recusa remetente diferente; só o nome de exibição pode variar).

**Como o `refresh_token` foi gerado (uma vez, manual, fora do repositório):**
1. Projeto novo no Google Cloud Console → API do Gmail ativada → tela de consentimento OAuth
   (Externo, escopo `https://www.googleapis.com/auth/gmail.send`, usuário de teste
   `felipecspinheiro88@gmail.com`) → credencial "App para computador" (Client ID + Secret).
2. Script de uso único (fora do repo) sobe um servidor HTTP local (`http://127.0.0.1:8765`,
   fluxo "loopback" — não precisa registrar a porta no Google, aceita qualquer uma), monta a URL
   de autorização com `access_type=offline&prompt=consent` (força o Google devolver
   `refresh_token`, que só vem na primeira autorização ou com `prompt=consent`), abre no
   navegador, captura o `code` do redirect e troca por tokens.
3. O `refresh_token` gerado **não expira sozinho** (só se revogado manualmente, ou se o app OAuth
   ficar 6 meses sem uso) — diferente do app em modo "Teste" no Console, que expira token em 7
   dias **só se a autorização em si não for renovada**; aqui a troca é feita programaticamente a
   cada envio, então isso não se aplica da mesma forma. Testado: 3 envios reais (código + os 2
   alertas) confirmados na caixa de entrada do destinatário de teste.

⚠️ **Usuário de teste da tela de consentimento tem que ser uma conta Google de verdade.** Tentar
adicionar `lipe-2001@hotmail.com` (Hotmail, não é conta Google) como usuário de teste foi
recusado pelo próprio Google — usuário de teste é sobre **quem autoriza o envio** (o remetente),
não sobre quem recebe. Destinatários (`WMS_BILLING_APPROVERS`) não têm essa restrição nem
precisam estar cadastrados em lugar nenhum do Google Cloud.

⚠️ **Diferente do Resend, a API do Gmail não tem restrição de destinatário nem exige domínio
verificado** — o preço é a autorização manual inicial (passo 2 acima) e ficar preso a uma conta
Gmail específica como remetente. Trocar de remetente no futuro = repetir o processo de autorização
logado na conta nova, só isso, sem mexer em mais nada do código.

**Testes:** os mesmos 3 envios reais confirmados + suíte de 68 verificações E2E rodada de novo
— as partes de e-mail (pedir código, verificar, código-mestre, os 2 alertas, rate-limit, bloqueio)
continuam 100% verdes; as 13 que "falham" são só reflexo do portão estar **desligado agora**
(rollback de 04/09 de manhã, ver o aviso no topo desta seção) — não são regressão da troca de
transporte de e-mail.

### `SECRET_KEY` e `WMS_EDIT_PASSPHRASE` — hardcoded no código, corrigido

Ao mexer em variáveis de ambiente para o item acima, foi encontrado (e corrigido) que
`backend/auth.py` ainda tinha a `SECRET_KEY` do JWT **fixa em texto puro no código**, num
repositório **público** — permitindo forjar um token de admin de produção sem senha. O
`WMS_EDIT_PASSPHRASE` (`inventory.py`) também tinha fallback fixo em vez de exigir a variável.
⚠️ Uma memória anterior registrava que isso já tinha sido corrigido em 31/08/2026 — **não estava**;
o registro estava errado (a correção nunca chegou a ser commitada no `main`). Corrigido agora de
verdade:

- **Em produção (`DATABASE_URL` de Postgres), o app RECUSA subir** sem `SECRET_KEY` e sem
  `WMS_EDIT_PASSPHRASE` — `RuntimeError` no import, igual ao padrão já usado para `DATABASE_URL`
  ausente. Falha de boot é visível; chave fraca em produção era silenciosa.
- **Em dev local (SQLite), cai num valor fixo só de desenvolvimento** — não exige configurar nada
  pra rodar o projeto na máquina.
- `backend/main.py` ganhou `load_dotenv()` **logo no topo**, antes de qualquer `from backend...` —
  `auth.py` e `inventory.py` leem a variável na hora do **import do módulo**, então o `.env`
  precisa estar carregado antes disso, não dentro do `lifespan`.
- `backend/.env` (git-ignorado) para dev local + `backend/.env.example` (versionado, sem valores)
  com todas as variáveis novas.
- Trocar a `SECRET_KEY` em produção **desloga todo mundo** (tokens de 12h) — combinar horário com
  o dono antes de aplicar no Railway.
- Tirar do código não desfaz o vazamento: o valor antigo (`wms-kiwkiw-secret-key-change-in-
  production-2024`) segue no histórico git público. O que conserta é o valor **novo** no Railway.
  Decisão: **não** reescrever histórico (quebra clones e não recupera o que já foi indexado).

---

## Mudanças Recentes — 02/09/2026 — DEVOLUÇÕES (tela nova)

**Sem commit.** Até então, devolução era anotada numa planilha à parte e lançada **na mão**,
SKU a SKU, pela tela de Estoque (~30 por semana). Agora existe a tela **`/devolucoes`**
(grupo Cadastros do menu), com **dois caminhos que compartilham a mesma validação e a mesma
gravação**: subir uma planilha (baixa o modelo, confere na tela, confirma) ou digitar direto
numa tabelinha.

**Arquivos:** `backend/routers/returns.py` (novo), 1 linha em `main.py` (registro do router),
`frontend/src/pages/Returns.tsx` (novo), `api.ts` (`returnsApi`), `App.tsx` (rota),
`Layout.tsx` (item de menu). **Sem tabela, coluna ou migração nova.**

| Endpoint (`require_manager_or_above`) | O quê |
|---|---|
| `GET /devolucoes/modelo` | Excel modelo gerado **em memória** (aba `DEVOLUCOES` + aba `INSTRUCOES`). Colunas: `Seller · NF · SKU · Quantidade · Retorna ao estoque · Motivo` |
| `POST /devolucoes/analyze` | Lê a planilha e devolve linhas normalizadas + erros. **Não grava nada** |
| `POST /devolucoes/lancar` | Grava. Recebe as linhas da planilha conferida **ou** da tabelinha da tela |

**As regras (todas decididas pelo dono do sistema):**
- **Linha que RETORNA** → `StockMovement` de **Entrada**, `movement_date = today_brasilia()`
  (a data do **lançamento**, não a da NF nem a da chegada física — "às vezes demoramos para
  conferir"), `nature="Devolução"`, observação
  `DEVOLUÇÃO — NF 123456, 2 un retornaram ao estoque. Lançado por Fulano em 02/09/2026.`
  Aparece como movimentação normal no Estoque e no Portal do Seller.
- **Linha que NÃO retorna** → **nenhum movimento**; só um `AuditLog`
  (`entity_type="Devolucao"`, `action="CREATE"`) com seller/NF/SKU/qtd/motivo. Motivo é
  **opcional**.
- **TUDO-OU-NADA:** qualquer linha com problema devolve **422** e **nada** é gravado.
- **Bloqueiam o lote:** seller não reconhecido (mesmo casamento do import — `trade_name`,
  `name`, `other_aliases`, só **ativos**), SKU sem produto **ativo** naquele seller, NF vazia,
  quantidade que não seja inteiro > 0, "Retorna ao estoque" vazio/fora do combinado, e
  **linhas idênticas**.
- **"Retorna ao estoque" aceita** `S`/`SIM`/`1`/`X` e `N`/`NAO`/`NÃO`/`0`, sem diferenciar
  maiúscula nem acento.
- **NF é obrigatória e é texto livre.** NF que **não existe** no WMS passa normalmente — a
  devolução pode ser de venda anterior à Kiwkiw ou de outro canal.
- **Quantidade acima da NF é permitida** de propósito (o cliente devolve 11 un na caixa da NF
  que trouxe 3 — para o seller o que importa é o produto de volta).
- O **mesmo SKU pode repetir** na mesma NF (um amassado volta, outro não): a decisão é **por
  linha**, não por NF.

**Na tela:** o seller e o SKU são **listas** (o SKU busca no **servidor**, 30 por vez), nunca
digitação livre — e **não dá para cadastrar produto por aqui**. Cada linha nova herda o seller
e a NF da anterior (o caso comum é vários SKUs da mesma devolução), mas dá para misturar
sellers no mesmo lote, como na planilha.

**Armadilhas:**

| Situação | Armadilha | Como evitar |
|---|---|---|
| Amarrar o movimento de devolução à NF de venda (`order_id`) | `reverse_stock_for_order()` trabalha por **saldo líquido do `order_id`** — cancelar/inativar aquela NF depois **varreria a devolução junto** e o estoque sumiria em silêncio | O movimento nasce **sem `order_id`**, de propósito. A NF fica no `nf_number` e na observação, o que já basta para a tela e para o Portal |
| Achar que existe trava contra reenvio | **Não existe, por decisão do dono.** Subir o mesmo arquivo 2× lança 2× | Se um dia for pedido, o lugar é um aviso amarelo no `analyze` (nunca um bloqueio: NF pode ter devolução em dias diferentes) |
| Procurar uma tela de consulta de devoluções | **Não existe, por decisão do dono.** O que voltou é movimentação comum; o que **não** voltou só está na Trilha de Auditoria, misturado com o resto | Filtrar `audit_logs` por `entity_type='Devolucao'` |
| Painel/dropdown dentro da tabela da tela | A tabela vive num contêiner com **rolagem horizontal**, que **corta** qualquer painel absoluto — os produtos vinham do servidor e simplesmente não apareciam (bug pego só na conferência visual) | A lista de SKU usa `createPortal` + `position: fixed` ancorado no botão, e fecha ao rolar/redimensionar |
| Confiar só na validação da tela | A tela pode ser burlada e um erro aqui vira **estoque errado** | `POST /devolucoes/lancar` **revalida tudo** com `_validate_rows`, a mesma função do `analyze` |

**Testes:** 102 verificações E2E, 100% verdes em **SQLite e PostgreSQL** (o Postgres é
obrigatório: `movement_type` é enum nativo lá), mais regressão nas telas antigas (Estoque
mostra "Entrada" normalizada; Dashboard/Pedidos/Sellers/Produtos/Manuseios/Auditoria em 200) e
conferência visual ponta a ponta contra banco descartável — que pegou os 2 bugs de tela
(painel cortado e a conferência sem apontar a linha do erro).

---

## Mudanças Recentes — 02/09/2026 — quantidade de itens congelada no fechamento

**Sem push.** Ao fechar o mês, a coluna **Itens** de cada NF sumia da tela (e do
PDF/Excel): `billing_closing_lines` não guardava a contagem e `read_frozen()` devolvia
`None`. Os valores em R$ nunca foram afetados — só a contagem.

- Coluna nova **`billing_closing_lines.itens INTEGER` (nullable)**. Migração idempotente
  em `index_migrations` (print texto puro), Postgres + SQLite.
- `freeze()` grava `ln["itens"]` (= `order_qty`, soma das qtds da NF) nas linhas B2C e B2B;
  `read_frozen()` devolve `ln.itens` em vez de `None`.
- **Backfill dos 9 fechamentos de agosto já existentes:** feito por script one-off
  (`scratchpad/backfill_itens.py`) que recalcula cada closing com os **parâmetros já
  congelados na própria linha** (`params_from_obj(closing)`, nunca os do seller atual),
  confere que cada `total` recalculado bate com o congelado e grava só `itens`. A coluna
  foi criada em produção via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` antes do backfill;
  no deploy a migração idempotente vê a coluna e pula.
- Continua "achatado" no fechado: **Cx B2B**, **Ad.prod** e o **Adic. manual** ainda
  entram no `total` e aparecem como R$ 0,00 na lista — só a contagem de itens deixou de
  sumir.

---

## Mudanças Recentes — 01/09/2026 (2ª leva) — FONTE ÚNICA de parâmetros de faturamento

**Sem push.** Unifica os parâmetros de cobrança do seller num só registro:
`billing_seller_params`. A aba **Comercial** de Sellers e o topo do **Faturamento de
mês ABERTO** passam a ler/gravar **o mesmo registro** — mexeu num, o outro reflete, e
vale para **todos os meses abertos** ao mesmo tempo.

**O que continua igual:**
- **Mês FECHADO** congela os 16 campos no snapshot de `billing_monthly_closings` (no
  `close`, copiando de `billing_seller_params`) e vira read-only. Editar o seller depois
  **não** muda fatura fechada. **Reabrir** apaga o snapshot e volta a seguir o seller.
- `billing_monthly_closings` de mês **aberto** guarda só `status`, ajustes avulsos e
  overrides de NF. As colunas de parâmetro dele **não são lidas enquanto aberto** (só
  voltam a valer congeladas no fechamento).
- `billing_seller_box_prices` (preço de caixa por seller) — sem mudança.

**O que mudou:**
- `PARAM_FIELDS` ganhou **`valor_segurado`** e **`cubagem_m3`** — deixaram de ser override
  por mês e viraram parâmetro do seller (entram na aba Comercial). Colunas novas em
  `billing_seller_params` (migração idempotente + **backfill único** do fechamento de
  `ref_month` mais alto de cada seller, pra não perder o valor segurado já digitado).
- `adic_produto_b2b` e `franquia_produtos_b2b` **deixaram de ser "só-do-mês"** — a
  constante `_MONTH_ONLY_PARAMS` e todos os `if f in _MONTH_ONLY_PARAMS: continue` foram
  **removidos**. `put_seller_params` grava os 16 campos.
- `prefill_params()` agora é só `return default_params_for_seller(...)` — **acabou o
  "puxa do mês anterior"**.
- Endpoint **`POST /billing/closing/{s}/{m}/apply-forward` REMOVIDO** (+ botão "Aplicar
  aos meses seguintes" e `billingApi.applyForward`). Não faz mais sentido: todo mês aberto
  já compartilha o mesmo registro.
- `PUT /billing/closing/{s}/{m}` (rascunho) agora grava os parâmetros em
  `billing_seller_params` (via `_get_or_create_params`); a linha do `closing` só recebe
  ajustes/overrides.
- `_build_payload` ramo mês aberto: `params`/`cubagem`/`valor_segurado` sempre de
  `default_params_for_seller`.

**Armadilhas:**

| Situação | Armadilha | Como evitar |
|---|---|---|
| `PUT /billing/seller-params` ou `PUT /billing/closing` do front | O schema tem 16 campos e o Pydantic preenche default 0/15 nos ausentes → um PUT parcial **zera** o resto | O front **tem que mandar os 16**. `Sellers.tsx` (`fieldsToParams`) e `Billing.tsx` (`buildBody`) já mandam. Endpoint novo que edite params: idem |
| Achou que `valor_segurado`/`cubagem` são do mês | Desde 01/09 (2ª leva) são do **seller** — um valor só, sem override por mês | Pra um mês diferente: muda no seller, fecha o mês (congela), volta o valor |
| Query nova de parâmetro de faturamento | Ler as colunas de `billing_monthly_closings` de um mês **aberto** | Mês aberto: `calc.default_params_for_seller(db, seller_id)`. As colunas do `closing` só valem em mês **fechado** (`params_from_obj(closing)` no ramo `closed`) |
| Reintrodução de `apply-forward` / `_MONTH_ONLY_PARAMS` / "puxa do mês anterior" | Eram muletas do modelo antigo (dois registros) | Não recriar. Com fonte única não têm função |

---

## Mudanças Recentes — 01/09/2026

Quatro commits, **sem push** (aguardando o usuário revisar em teste). Tudo em faturamento/caixas.

> ⚠️ **As menções abaixo a "parâmetro SÓ-DO-MÊS", `_MONTH_ONLY_PARAMS`, `apply-forward` e
> "pré-preenchimento puxa do mês anterior" estão OBSOLETAS** — ver a seção "FONTE ÚNICA de
> parâmetros de faturamento" logo acima. `adic_produto_b2b` e `franquia_produtos_b2b` hoje
> são parâmetro normal do seller.

### `a0d40dab` — toggle de seguro agora significa "cobrar seguro"

O parâmetro `seguro_incluso` **zerava** o seguro quando ligado (semântica "já incluso no
plano"). **Invertido:** ligado cobra `valor_segurado × aliquota_seguro / 100`, desligado não
cobra. Rótulo virou **"Cobrar seguro?"** na tela ([Billing.tsx](frontend/src/pages/Billing.tsx))
e **"Cobrar seguro"** no PDF e Excel ([billing_docs.py](backend/services/billing_docs.py)).
⚠️ **Nome da coluna `seguro_incluso` foi mantido** (renomear em produção é risco) — só o
significado, o rótulo e (nada, era teste) mudaram. Sem migração de dados.

### `c07f94c2` — adicional por produto nas NFs B2B (fórmula corrigida em `c18eec6a`)

Parâmetro `adic_produto_b2b`: cobrado por produto **acima da franquia** em cada NF B2B —
`adic_produto_b2b × max(0, Σ quantidade dos itens − franquia_produtos_b2b)`. A regra de
cobrança (confirmada com o time em 01/09): caixa fixa + manuseio + R$ X **a partir do
(franquia+1)º produto** (R$ X varia por cliente). Entra no `total` da NF junto com
`manuseio_b2b`, `valor_caixa_b2b` e o adicional manual por NF (`b2b_adicional`).

⚠️ A versão original do `c07f94c2` cobrava **todo produto** (`× Σ quantidade`) — errado.
O commit seguinte adicionou `franquia_produtos_b2b` (int, default **15**, também só-do-mês)
e a fórmula com corte.

- ⚠️ **Parâmetro SÓ-DO-MÊS.** Vive no snapshot do fechamento (`billing_monthly_closings`),
  o pré-preenchimento puxa do mês anterior, `apply-forward` copia para os meses futuros
  abertos — mas **NÃO desce para o default do seller** (`put_seller_params` e o laço de
  default do `apply-forward` pulam esse campo de propósito) e **não aparece na aba Comercial
  de Sellers**. Um `PUT /billing/seller-params` sem o campo zeraria o valor.
- Coluna aditiva (`Float default 0`) nas **duas** tabelas de parâmetro, migração no laço
  `index_migrations` (print texto puro — regra do emoji). `params_from_obj` ganhou
  `getattr(obj, f, DEFAULT_PARAMS[f])` como fallback.
- Meses fechados não mudam (o `adic_caixa`/`total` da NF já é congelado; no `freeze` o
  adicional por produto é dobrado no bucket `manuseio` gravado, igual `valor_caixa_b2b`).
- Coluna **"Ad.prod"** na lista de NFs B2B (tela + PDF + Excel).

### `ed18d268` + `dfee34c8` — caixas padronizadas (lista canônica de 13)

**`billing_calc.CANONICAL_BOXES`** é a fonte única: `1..11, Saco de Embarque, Própria`.
Repetida no Scanner, no faturamento e no cadastro do seller.

- **Scanner:** o campo de texto livre da caixa **foi removido** — a caixa só é escolhida
  pelos **13 botões** ([Scanner.tsx](frontend/src/pages/Scanner.tsx), estado `boxEditVal`
  eliminado). `handleBoxSave` inalterado.
- **Tabela global de caixas** (`billing_box_prices`) passou de **9 → 13 chaves** (seed
  idempotente em [main.py](backend/main.py) agora itera `CANONICAL_BOXES`). `get_box_prices`
  devolve na ordem canônica.
- `normaliza_box` reconhece `"saco"/"sacola"/"embarque"` → `"Saco de Embarque"`.
  `parse_grupo_a` quebra por vírgula e normaliza cada item (aceita o formato novo e o
  antigo `"1,2"`).
- ⚠️ **Histórico de `box_used` NÃO foi convertido** — a padronização vale só daqui pra
  frente (decisão do dono).
- ⚠️ **Algoritmo de Caixa e `Seller.caixa1..8` intactos.** A "caixa sugerida" do Scanner
  ainda pode mostrar `c1`, `c2`… (vem da matriz `box_algorithms`); os botões que gravam
  são os canônicos. Os campos `caixa1..8` **saíram da tela** (aba "Caixas" do seller) mas
  **continuam no banco e no payload** — sem migração destrutiva.

**Preço de caixa por seller** (`dfee34c8`):
- Tabela nova **`billing_seller_box_prices`** (`seller_id` × `box_key` × `price` nullable,
  único por par). Só grava onde o seller definiu um valor.
- **Preço efetivo = global sobrescrito pelo do seller onde houver.**
  `_effective_box_prices(db, seller_id)` em [billing.py](backend/routers/billing.py),
  aplicado nos **dois** pontos de cálculo (`_build_payload` ao vivo e `close_month`).
- Endpoints `GET/PUT /billing/seller-box-prices/{seller_id}` — **`require_manager_or_above`**
  (igual `seller-params`, editado pela tela de Sellers).
- Mês fechado lê o snapshot congelado — preço novo não mexe em fatura fechada.
- **Aba "Caixas" do cadastro de seller reescrita:** 13 linhas — nome (fixo) + preço opcional
  (em branco = usa o global) + checkbox **"inclusa (grupo A)"**. O grupo A continua guardado
  em `billing_seller_params.tipos_caixa_inclusos`, agora como **lista canônica separada por
  vírgula**, salvo pelo `saveSellerParams` normal (o endpoint de box-prices só cuida de
  preço).
- **No Faturamento por mês**, o grupo A virou **13 checkboxes** (grava
  `tipos_caixa_inclusos` no rascunho). `TextRow` de Billing.tsx removido (sem uso).
- Grupo A e cota continuam por cima de tudo; `Saco de Embarque` se comporta como as
  numeradas.

### `15124cfd` — cadastrar a caixa da NF direto da lista de Faturamento

Na coluna **Cx** das listas B2C e B2B, **mês aberto**, a célula virou um `<select>` com as 13
caixas canônicas. Escolher grava em `Order.box_used` pelo **mesmo endpoint do Scanner**
(`PATCH /scanning/orders/{id}/box`, `setOrderBox` em [Billing.tsx](frontend/src/pages/Billing.tsx))
e invalida `['billing-closing', ...]` — o adicional recalcula ao vivo. Sem caixa = borda âmbar.
Caixa legada fora da lista aparece como opção `"(antigo)"`. Mês fechado é read-only (a linha
congelada nem tem `order_id`). Só frontend. ⚠️ O endpoint do Scanner **conclui o pedido** se
todos os itens já estiverem bipados e a caixa era a última pendência — aceitável aqui porque
as NFs de faturamento de mês passado já estão finalizadas.

### `c18eec6a` — franquia de produtos B2B + colunas B2C/B2B repontadas

- **`adic_produto_b2b` agora tem corte:** `× max(0, itens − franquia_produtos_b2b)`.
  `franquia_produtos_b2b` (int, default 15) é **só-do-mês** — entrou em `_MONTH_ONLY_PARAMS`
  ([billing.py](backend/routers/billing.py)), que substituiu o `if f == "adic_produto_b2b"`
  nos dois laços de default do seller. Regra confirmada com cobrança: caixa fixa + manuseio
  + R$ X **a partir do (franquia+1)º produto** na caixa (R$ X varia por cliente).
- **B2B na lista perdeu o seletor de caixa** (que o `15124cfd` tinha posto). A coluna virou
  **"Cx B2B"** e mostra o `valor_caixa_b2b` fixo, só leitura. O Scanner continua gravando
  `box_used`; só some do faturamento. O seletor **continua no B2C**.
- **B2C ganhou adicional manual por NF.** O `b2b_adicional` do override virou **genérico
  "adicional manual da NF"** — vale nos dois canais, **sem coluna nova**. `draftFromPayload`
  reconstrói o override de `b2b_adicional` para B2C também.
- **Layout:** B2C = `Cx · Adic. caixa · Adic. · Total`; B2B = `Cx B2B · Ad.prod · Adic. ·
  Total`. `NfList` ramifica por canal; `colSpan` fixo (8 no expandido, 6 no rodapé).
- `freeze` do B2C dobra o adicional manual no bucket `manuseio` gravado (o `total` já inclui)
  — mês fechado mostra o B2C achatado, igual o B2B. **(02/09/2026: só a contagem de `itens`
  passou a ser congelada — ver seção do dia. Cx B2B / Ad.prod / Adic. manual seguem
  achatados no `total`.)**
- Coluna `franquia_produtos_b2b INTEGER DEFAULT 15` nas 2 tabelas, migração no laço
  `index_migrations`. Docs: linha "Franquia de produtos B2B" nos parâmetros, coluna "Adic.
  man." na lista B2C.

**Armadilhas novas:**

| Situação | Armadilha | Como evitar |
|---|---|---|
| `seguro_incluso` no cálculo | O nome diz "incluso" mas desde 01/09 **significa "cobrar"** (ligado = cobra) | Ler o comentário em [billing_calc.py](backend/services/billing_calc.py) `_fatura`. Não "consertar" invertendo de novo |
| Parâmetro de faturamento novo | ~~"só do mês"~~ não existe mais (fonte única, 01/09 2ª leva). Todo campo em `PARAM_FIELDS` vive em `billing_seller_params` | Basta entrar em `calc.PARAM_FIELDS` + `DEFAULT_PARAMS` + coluna nas 2 tabelas. O front tem que mandar os 16 campos no PUT (Pydantic zera os ausentes) |
| Caixa nova / opção de caixa em qualquer tela | Escrever a lista à mão divergindo das outras telas | Importar `CANONICAL_BOXES` (`billing_calc.py` no backend, `api.ts` no frontend). Fonte única |
| Query nova de preço de caixa no faturamento | Usar `_box_prices_dict` (só global) e ignorar o override do seller | Usar `_effective_box_prices(db, seller_id)` — já aplicado no cálculo ao vivo e no fechamento |
| `parse_grupo_a` com texto legado multi-dígito num token | O split por vírgula + `normaliza_box` pegaria só o 1º número de `"1 2 3"` | A função faz `re.findall(r"\d+")` por parte antes de cair no `normaliza_box` — cobre `"10"` e o legado `"1 2"` |

---

## Mudanças Recentes — 31/08/2026

### Faturamento reescrito por completo

A tela `/billing` e o backend de faturamento foram **substituídos**. O cálculo antigo
(`GET /billing/report`) e o dump (`GET /billing/export`) — mais o helper N+1 `_get_box` — **foram
removidos**. `billing_configs` e as colunas comerciais de `Seller` **continuam no banco, intactas e
sem nenhum uso** pelo faturamento novo (rollback).

**Modelo novo** (6 tabelas, migração idempotente via `Base.metadata.create_all` + seed em
`run_light_migrations`): `billing_seller_params` (default por seller), `billing_box_prices` (tabela
**global** de adicional por caixa — 9 chaves `1..8`,`Própria`), `billing_monthly_closings` (fechamento
por seller×mês `YYYY-MM`, com **snapshot dos parâmetros** e cache dos 8 totais da fatura),
`billing_closing_nfs` (override por NF: canal, adicional B2B, obs), `billing_closing_adjustments`
(linhas avulsas), `billing_closing_lines` (**snapshot congelado das NFs ao fechar; apagado ao
reabrir**).

**Cálculo num módulo único: `backend/services/billing_calc.py`.** Documentos em
`backend/services/billing_docs.py`. Toda a rota está em `routers/billing.py` — **tudo
`require_admin`**, exceto `GET/PUT /billing/seller-params/{id}` (`require_manager_or_above`, usado pela
aba Comercial de Sellers).

Regras que mordem:
- ⚠️ **Base das listas:** NF de **saída** (`file_type != IMPORT`; **NULL conta como saída**), status
  `!= cancelled`, **`for_billing` verdadeiro** (NULL conta como verdadeiro), `imported_at` dentro do
  mês em horário de Brasília. Entrada **nunca** entra.
- ⚠️ **Classificação B2C/B2B automática** por `Σ quantidade dos itens ≥ limite_itens_b2b`. **`limite = 0`
  ou vazio → nenhuma NF vira B2B sozinha** (só por override manual `⇄`). O override vive só naquele
  fechamento e **não viaja** no pré-preenchimento do mês seguinte.
- ⚠️ **Caixas inclusas = dois mecanismos:** grupo A (`tipos_caixa_inclusos`, texto tipo "1,2", por
  seller) e cota B (`cota_caixas_mes`, por seller). Só NF **B2C** com caixa fora do grupo A consome a
  cota; as primeiras N por `imported_at, id` ficam com adicional 0.
- ⚠️ **NF B2C sem `box_used`** → linha amarela, adicional 0, **não bloqueia** o fechamento.
- ⚠️ **Mês fechado lê o snapshot** (`billing_closing_lines` + cache), read-only — cancelar um `order`
  depois **não muda** a fatura fechada. Reabrir apaga o snapshot e volta a derivar ao vivo.
- ⚠️ ~~`apply-forward`~~ **REMOVIDO em 01/09/2026 (2ª leva)** — ver "FONTE ÚNICA de parâmetros". Com
  um só registro por seller, não há nada para "aplicar aos meses seguintes".
- ⚠️ **A tela mostra sempre o último estado SALVO** — edições ficam locais até "Salvar rascunho"
  (`PUT /billing/closing/...`), que persiste e recarrega. O cálculo **não** é duplicado em JS de
  propósito.
- Permissão: `/billing` virou **admin-only** (rota + menu). Manager/operator: 403 e sem item no menu.
- Índice novo `ix_orders_seller_imported` em `PERF_INDEXES` (a IN-list de checagem de índice ganhou
  `'orders'` nos dois ramos). ⚠️ **Trava gravação em `orders` no 1º boot do deploy** — fora do
  expediente.

**Testes:** 39 verificações E2E via TestClient, 100% verdes em **SQLite e PostgreSQL** — reproduz os
números da planilha Cereous (JULHO: mínimo B2C 1.850,00, armazenagem 345,00; era sem franquia
atingida), classificação + override, cota A/B, NF sem caixa não bloqueia, snapshot imutável,
apply-forward, consolidado, permissões, PDF/Excel/zip.

### Manuseios mostrava só parte do período escolhido

`GET /scanning/session-cards` tinha um **`limit(100)` fixo aplicado DEPOIS do filtro de data**, e
descartava o resto **em silêncio** — sem aviso na tela. Com ~15 sessões por dia útil, qualquer
intervalo acima de ~6 dias perdia as sessões mais antigas.

O relato veio do dono do sistema, que desconfiou dos totais ao filtrar 01/08→31/08:

| | Cards | Pedidos | Concluídos |
|---|---:|---:|---:|
| Tela mostrava | 257 | 3.210 | 3.008 |
| Real | **849** | **14.303** | **14.098** |

Eram 328 sessões no período; as 100 mais recentes começavam em 21/08 20:00, então a tela mostrava
**só de 24/08 em diante** com 01/08 selecionado.

**Agora o teto só vale quando NÃO há `date_from`** — sem período, ele continua protegendo contra
varrer o histórico inteiro; com período, o próprio intervalo já limita o volume. **Filtro de um dia
(o uso do dia a dia) nunca foi afetado** e não mudou, nem no resultado nem no tempo.

⚠️ **Custo aceito:** o mês inteiro carrega ~328 sessões / ~14 mil pedidos em memória para montar 849
cards (440ms → 1.239ms medidos localmente). A resposta HTTP continua pequena — são só os cards.

### NF em bipagem não contava (status inexistente)

No mesmo endpoint, `in_prog` comparava o status com **`"in_progress"`, que não existe no
`OrderStatus`** — o valor certo é **`"scanning"`**. A contagem era sempre 0 e a NF aberta na bancada
caía em `pending`: o card do seller **só saía de "A Iniciar" quando a primeira NF fosse concluída**.

Passou despercebido porque a coluna "Em Processo" do kanban funciona por outro caminho
(`completed > 0`), e porque `in_progress_orders`/`pending_orders` **não são exibidos** — `Handling.tsx`
recalcula o pendente como `total_orders - completed_orders`.

### Laço de render em Handling.tsx

`const { data: serverCards = [] } = useQuery(...)` + `useEffect(..., [serverCards])`: com o default
na desestruturação, **cada render criava um array novo**, o efeito re-disparava e o `setState`
re-renderizava — laço até a resposta chegar ("Maximum update depth exceeded" no console, a cada carga
da tela e a cada troca de filtro). A dependência passou a ser o `data` cru, que o react-query mantém
estável, com guarda `if (serverCards)`.

**Testes:** 9 cenários de status (3 falhavam no código anterior), 6 combinações de data/unidade
contra backup de produção restaurado, entradas inválidas sem 500, `tsc --noEmit` sem erro novo, e
conferência visual com os 800 cards renderizando. Os totais novos batem com a consulta SQL direta, e
as 4 unidades somadas dão exatamente o total sem filtro.

### Auditoria/Bipagens: filtros de Seller e Transportadora, paginação e CSV

A aba **Bipagens** ganhou dois filtros (**Seller** e **Transportadora**) e **todos os filtros passaram
a se combinar de verdade** — data, seller, transportadora, operador e busca ao mesmo tempo.

**A mudança estrutural: o filtro virou de SERVIDOR.** Antes a tela recebia as 200 bipagens mais
recentes e a "Busca" filtrava **dentro dessas 200, no navegador**. Filtrar um mês e escolher uma
transportadora bipada de manhã devolvia **vazio**, dando a entender que ela não teve bipagem nenhuma.
Numa tela de auditoria isso é pior do que não ter o filtro.

| Antes | Depois |
|---|---|
| Lista pura, teto de 200, sem aviso | Objeto `{rows, total, total_ok, total_errors, page, total_pages}` |
| Busca filtrava a amostra carregada | Busca vai ao servidor (com atraso de 500ms), varre o período |
| KPIs contados na tela | Totais do **período**, vindos do banco |
| Produtividade só por data | Respeita seller, transportadora, operador e busca |
| — | **Exportar CSV sem teto** + paginação de 100 |

⚠️ **Os KPIs TÊM que vir do servidor.** Contados na tela, exibiriam sempre o tamanho da página (100)
em vez do total do período — o KPI "Total Registros" mentiria e ninguém perceberia.

⚠️ **A troca de qualquer filtro reseta a página para 1.** Sem isso, quem estivesse na página 7 e
filtrasse um seller com 2 páginas veria tela vazia e concluiria que ele não teve bipagem.

⚠️ **`ORDER BY timestamp DESC, id DESC` — o desempate por `id` não é enfeite.** Bipagens no mesmo
segundo trocariam de ordem entre uma página e outra, fazendo uma linha aparecer duas vezes e outra
sumir.

**Transportadora é texto livre em `Order.carrier`** — não existe cadastro. `GET /audit-log/carriers`
monta o dropdown com as transportadoras do período, **agrupando por minúscula** (`motoboy` +
`MOTOBOY` = uma opção, marcada com `*`) e exibindo como rótulo a **grafia mais frequente**. A lista
respeita data e seller: escolhendo um seller, sobram só as transportadoras dele, o que evita montar
uma combinação vazia. Há uma opção **"(sem transportadora)"** — NF de entrada quase nunca tem o campo
preenchido e sem ela essas bipagens só apareceriam em "Todas".

⚠️ **Grafias diferentes da mesma empresa continuam separadas de propósito** ("Correios" x "EMPRESA
BRASILEIRA DE CORREIOS E TELEGRAFOS", "Loggi" x "LOGGI TECNOLOGIA LTDA" — o banco real tem 67
grafias distintas). Juntá-las exigiria um de-para mantido à mão; ficou **deliberadamente fora**.

⚠️ **A transportadora filtrada é a ATUAL da NF, não a do dia da bipagem.** Não existe histórico de
transportadora; preencher o campo depois move as bipagens antigas para a transportadora nova.

**O CSV sai SEM TETO, e isso é o oposto do CSV da aba "Status das NFs"** — lá tela e arquivo usam o
mesmo teto de propósito (o arquivo vai para o cliente e precisa ser o que a pessoa viu). Aqui a tela
é a amostra e o CSV é o todo, que é justamente como ver um mês sem travar o navegador. Por isso ele é
escrito em blocos (`yield_per`), sem materializar dezenas de milhares de linhas na memória.

**Índice novo `ix_scanning_logs_timestamp`** (`PERF_INDEXES`): a aba filtra e **ordena** por data e a
paginação exige um `COUNT` a mais na mesma condição. Não havia índice nenhum nessa coluna — mesma
armadilha que levou ao `ix_stock_movements_seller_date` em 14/08/2026.
⚠️ **Criar o índice trava gravação em `scanning_logs` por alguns segundos no primeiro boot** —
deployar fora do horário de operação.

**Arquivos:** `scanning.py` (`_audit_base_query` centraliza os filtros — lista, KPIs, produtividade e
CSV **precisam** enxergar o mesmo recorte), `main.py`, `api.ts`, `Audit.tsx` (só o `ScanAuditTab`; as
outras 3 abas não foram tocadas).

**Testes:** 144 verificações E2E (72 × SQLite e PostgreSQL), 100% verdes — filtros isolados e
combinados, grafias/espaços, paginação sem perder nem repetir linha, permissões e regressão das 3
outras abas. Mais **teste de volume com 25.000 bipagens em 30 dias**: o CSV saiu completo (2,21 MB,
9,9s) sem corte no streaming, e a primeira página da tela responde em 0,09s com 250 páginas. Mais
conferência visual, que confirmou o reset de página e a busca disparando **1 requisição para 9
caracteres digitados**.

⚠️ **Achado NÃO corrigido — contraste no modo claro.** Botão com fundo roxo sólido usa
`bg-violet-600 ... text-t1`, e `--t1` no modo claro é quase preto (`33 30 60`): contraste **2,8:1**,
abaixo do mínimo 4,5:1 (no modo escuro fica 5,7:1, correto). São **18 botões** em `pages/*.tsx`,
todos pré-existentes. O botão novo seguiu o padrão para não nascer fora de padrão — corrigir os 18 de
uma vez é uma decisão de design pendente.

---

## Mudanças Recentes — 24/08/2026

### ENTRADA: estoque entra na FINALIZAÇÃO da bipagem, pela contagem física

**A regra de 06/08/2026 (baixa na importação) foi REVOGADA PARA A ENTRADA.** A saída continua
exatamente como estava. Ver a seção própria em "Regras de Negócio Críticas" antes de mexer em
qualquer coisa de estoque de entrada.

**Motivo:** vinha quantidade a menos de um SKU e, como o estoque já tinha entrado pela quantidade da
NF, alguém precisava chamar o gerente para acertar na mão na tela de Estoque. Agora entra o que
chegou, sem etapa manual.

**O que mudou:**
- NF de entrada **não baixa mais no import** nem nos destravamentos
- **Não auto-conclui** na última bipagem — só o botão **Finalizar** conclui
- Finalizar abre uma **conferência** (esperado x contado, SKU a SKU, divergentes destacados); ao
  confirmar, o estoque entra pela **contagem** e cada SKU divergente ganha observação
- **Pausar** substitui Interromper na entrada (contagem de marca grande leva dias)
- O **excedente em tempo real** (17/08/2026) deixou de lançar estoque — a sobra entra junto no
  Finalizar
- **Transportadora não bloqueia mais** entrada (SKU sem produto continua bloqueando)
- Entrada saiu do **Dashboard** e não gera **PDF de Separação/Expedição**

**Arquivos:** `stock_manager.py`, `scanning.py`, `orders.py`, `dashboard.py`, `Scanner.tsx`,
`Dashboard.tsx`, `Handling.tsx`, `api.ts`.

**Testes:** 97 verificações E2E, 100% verde em SQLite **e** PostgreSQL, mais conferência visual da
tela contra banco descartável — que pegou 3 bugs invisíveis para o teste de API (ver a tabela de
erros comuns: resposta do axios, KPI montado em Python, marcador vazando em painel).

---

## Mudanças Recentes — 06/08/2026

**Dois commits implementados e testados:**

### Commit `9159044b` — Estoque baixa na importação, não na bipagem

**Descrição:** A regra de negócio mudou. O estoque **deixou de ser sensibilizado na bipagem** (quando o operador concluía o manuseio) e agora **baixa no fim da importação, NF a NF**. 

**Motivo:** O seller vendia segundo 20h, a Kiwkiw manuseava terça 17h, e o estoque ficava ~24h defasado — inviável em escala. Agora fica atualizado no instante do upload.

**Bloqueios:**
- NF precisa ter **transportadora preenchida**
- Todos os SKUs precisam ter **produto ativo cadastrado**
- Sem isso, fica **pendente e baixa sozinha** quando alguém preenche a transportadora ou cadastra o produto

**Coluna nova:** `Order.stock_applied_at` (TIMESTAMP, nullable) marca quando a NF baixou. Migração idempotente no `run_light_migrations()`.

**O que mudou no código:**
- `backend/services/stock_manager.py`: Reescrito inteiramente. Removidas `update_stock_from_order()` e `update_stock_from_session()` (mortas em bipagem). Adicionadas `apply_stock_for_orders()`, `order_has_stock_applied()`, `order_stock_sign()`, `evaluate_orders_for_stock()`, `release_pending_orders_for_sku()`.
- `backend/routers/orders.py`: Import agora chama `apply_stock_for_orders()` dentro da transação. Endpoint `PATCH /orders/{id}/carrier` destrava e baixa. `GET /orders/pending-stock` lista NFs não baixadas.
- `backend/routers/scanning.py`: Removidas chamadas a `update_stock_from_order` de `process_scan()`, `interrupt_order()`, `force_complete_session()`. `cancel_duplicate_orders()` e `cancel_handling()` agora estornam usando `order_has_stock_applied()`.
- `backend/schemas.py`: Adicionadas `StockApplyReport`, `NegativeStockInfo`, `PendingStockOrderInfo`, `MissingProductInfo`.
- `frontend/src/pages/Dashboard.tsx`: Modal pós-import mostrando negativos, pendentes e cadastro de produto faltante. Aviso fixo de NFs que não subiram.
- `frontend/src/pages/Orders.tsx`: Marca "sem estoque" nas linhas que ainda não baixaram.

**Bugs corrigidos:**
1. `FileType.IN` não existe (era `IMPORT`) — marcar "Entrada" no import dava 500
2. O sinal do movimento vinha da natureza da NF, não do tipo do arquivo — NF de entrada com natureza fora do mapa dava baixa em vez de entrada
3. Bug pré-existente no Postgres: `CAST(movement_type AS TEXT)` necessário em `reverse_stock_for_order()` ou estoura `InvalidTextRepresentation`

**Testes:** 32 verificações de unidade (Postgres + SQLite) + 21 verificações E2E HTTP — **100% PASSOU**

---

### Commit `4e5d2d45` — NF com SKU sem produto cadastrado não entra mais no manuseio

**Descrição:** Uma NF cujo SKU não tem produto ativo cadastrado é **impossível de bipar** (sem produto não há `barcode_seller` pra casar). Antes disso, entrava no kanban normalmente e o operador só descobria errando na bancada item por item.

Agora ela **fica fora do manuseio** e **volta sozinha** quando o produto for cadastrado.

**Implementação:**
- `backend/services/stock_manager.py`: Adicionada `orders_missing_product_skus()` — consulta agrupada que retorna `{order_id: [sku, ...]}` para NFs com SKU faltante. Usa `(seller_id, sku)` no cadastro de produtos, **nunca** o FK `OrderItem.product_id` (que fica nulo quando produto é criado depois do import).
- `backend/routers/scanning.py`: 
  - `get_session_orders()`: Filtra NFs seguidas, expõe `held_orders` com SKUs faltantes
  - `open_order_by_nfe()`: Bloqueia com `blocked_reason="missing_product"` listando SKUs faltantes
  - `session_cards()`: NFs seguradas saem dos totais, card recebe `held_orders` e `held_only`
- `frontend/src/pages/Handling.tsx`: Badge "🔒 sem produto cadastrado" nos cards, com tooltip explicativo

**Pontos críticos:**
- Card do seller **não some** mesmo se todas as NFs dele estiverem seguradas — senão a pendência fica invisível
- Sem válvula de escape: para liberar, cadastra-se o produto
- O critério é sempre `(seller_id, sku)` — versão anterior (pego no teste) usava FK e reportava SKU faltante que já tinha produto

**Testes:** 21 verificações E2E HTTP via testclient — **100% PASSOU**

---

## Resultado de 06/08/2026

| Métrica | Antes | Depois |
|---------|-------|--------|
| Defasagem de estoque | ~24h | ~0h (atualiza no import) |
| NFs impossíveis de bipar | Descobertas na bancada | Sinalizadas de cara |
| Testes automáticos | — | 106 verificações, 100% verde |
| Commits | — | 2 em produção |

> ⚠️ A linha "atualiza no import" acima vale só para a **saída**. Desde 24/08/2026 a entrada atualiza
> na **finalização da conferência**, que é quando a mercadoria de fato foi contada.

**Deploy:** Automático no Railway. Migração idempotente não causa downtime.

---

## Resultado de 24/08/2026 — entrada

| Métrica | Antes | Depois |
|---------|-------|--------|
| Divergência de quantidade na entrada | Gerente acertava na mão pela tela de Estoque | Entra o que foi contado, sem etapa manual |
| Conferência de vários dias | Interromper carimbava a NF como feita | **Pausar** mantém em aberto e retoma de onde parou |
| Documentos gerados à toa | PDF de picking/romaneio em NF de entrada | Não gera nem oferece |
| Testes automáticos | — | 97 verificações, 100% verde (SQLite + PostgreSQL) + conferência visual |

**Sem migração de banco** — a feature reaproveita `Order.stock_applied_at` e grava a pausa como
`ScanningLog`, justamente para não alterar enum no Postgres de produção.

---

## Stack Tecnológica

### Backend
- **Python 3.11+**
- **FastAPI** — framework HTTP
- **SQLAlchemy 2.x** — ORM
- **SQLite** (dev local) / **PostgreSQL** (produção no Railway)
- **JWT HS256** — autenticação (12h de expiração)
- **bcrypt via passlib** — hash de senhas
- **openpyxl + pandas** — leitura de Excel
- **ReportLab** — geração de PDFs
- **Uvicorn** — servidor ASGI

### Frontend
- **React 18 + TypeScript**
- **Vite** — bundler
- **Tailwind CSS** — estilos
- **react-query** — cache e fetch de dados
- **axios** — cliente HTTP
- **react-router-dom v6** — roteamento
- **recharts** — gráficos
- **react-hot-toast** — notificações
- **lucide-react** — ícones

### Deploy
- **Backend:** Railway (`Procfile` + `backend/railway.toml`)
  - Comando: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
  - Restart policy: on_failure, max 3 retries
- **Frontend:** Vercel (`frontend/vercel.json`)
  - SPA rewrites: todas as rotas → `/`
- **CI/CD:** GitHub (conta de trabalho separada da máquina de desenvolvimento)

---

## Estrutura de Pastas

```
WMS Kiwkiw/
├── backend/
│   ├── main.py              ← Entry point da API + inicialização + migrações leves
│   ├── models.py            ← Todos os modelos SQLAlchemy (tabelas)
│   ├── auth.py              ← JWT, bcrypt, roles, dependencies FastAPI
│   ├── database.py          ← Engine SQLAlchemy, SessionLocal, init_db()
│   ├── schemas.py           ← Schemas Pydantic (request/response)
│   ├── permissions.py       ← Matriz de permissões por role
│   ├── timezone_utils.py    ← ⚠️ NOVO: now_brasilia(), today_brasilia(), end_of_day()
│   ├── requirements.txt
│   ├── railway.toml
│   ├── routers/
│   │   ├── auth.py          ← POST /auth/login, GET /auth/me
│   │   ├── orders.py        ← POST /orders/import, GET /orders/, etc.
│   │   ├── scanning.py      ← Sessões, bipagem, kanban, audit log
│   │   ├── inventory.py     ← Estoque, movimentações, importação histórico
│   │   ├── products.py      ← Produtos, kits, algoritmo de caixa, sellers, unidades, usuários
│   │   ├── billing.py       ← Configurações de cobrança, relatório, export Excel
│   │   ├── dashboard.py     ← Cockpit master e portal do seller
│   │   ├── returns.py       ← Devoluções: modelo Excel, conferência e lançamento
│   │   └── settings.py      ← Configurações gerais + controle do folder_watcher
│   └── services/
│       ├── order_import.py  ← Importação de Excel de pedidos (lógica principal)
│       ├── stock_manager.py ← Atualização de estoque, relatórios, histórico SKU
│       ├── pdf_generator.py ← PDFs de separação e expedição (ReportLab)
│       ├── folder_watcher.py← Robô de pasta (background thread, ainda não em produção)
│       ├── kit_handler.py   ← Expansão de kits em SKUs reais
│       ├── kit_import.py    ← Leitura da planilha TRATAMENTO KITS (aba CADASTRO KITS)
│       └── audit_export.py  ← Exportação de CSVs de auditoria por sessão/seller
├── frontend/
│   ├── src/
│   │   ├── App.tsx          ← Rotas da aplicação
│   │   ├── api.ts           ← Cliente Axios centralizado + tipos TypeScript
│   │   ├── timezone.ts      ← ⚠️ NOVO: todayBrasiliaStr(), nowBrasilia()
│   │   ├── components/
│   │   │   ├── Layout.tsx
│   │   │   ├── PageHeader.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── hooks/
│   │   │   └── usePermissions.ts
│   │   └── pages/
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx    ← Cockpit master (admin/manager)
│   │       ├── Orders.tsx       ← Listagem de pedidos
│   │       ├── Scanner.tsx      ← Interface de bipagem (fullscreen)
│   │       ├── Handling.tsx     ← Kanban de manuseios (principal dos operadores)
│   │       ├── Inventory.tsx    ← Estoque por seller
│   │       ├── Products.tsx     ← Cadastro de produtos
│   │       ├── Kits.tsx         ← Cadastro de kits + import por arquivo + log de explosões
│   │       ├── KitFixes.tsx     ← Vincular componentes de kit aos produtos (/kits/vincular)
│   │       ├── BoxAlgorithm.tsx ← Algoritmo de caixa
│   │       ├── Sellers.tsx      ← Cadastro de sellers
│   │       ├── Units.tsx        ← Cadastro de unidades
│   │       ├── Users.tsx        ← Cadastro de usuários
│   │       ├── Billing.tsx      ← Faturamento
│   │       ├── Returns.tsx      ← Devoluções (planilha + lançamento direto)
│   │       ├── Audit.tsx        ← Auditoria
│   │       ├── Settings.tsx     ← Configurações do sistema
│   │       └── SellerPortal.tsx ← Portal somente leitura para o seller (role=client)
│   ├── package.json
│   ├── tsconfig.json
│   └── vercel.json
├── data/                    ← Gerado em runtime (não versionado)
│   ├── wms_kiwkiw.db        ← Banco SQLite (dev local)
│   ├── uploads/             ← Arquivos Excel importados
│   ├── exports/             ← PDFs e CSVs gerados
│   │   └── pdfs/            ← PDFs salvos em disco (só modo local/SQLite)
│   ├── audit/               ← CSVs de auditoria de bipagem (por seller/data)
│   └── media/               ← Fotos de produtos + arquivos de experiência de sellers
├── COMO_RODAR.md
├── Procfile                 ← Para Railway
└── CLAUDE.md                ← Este arquivo
```

---

## Banco de Dados — Modelos e Relacionamentos

### Enums
| Enum | Valores |
|------|---------|
| `UserRole` | `admin`, `manager`, `operator`, `client` |
| `OrderStatus` | `pending`, `validated`, `separating`, `scanning`, `completed`, `interrupted`, `cancelled` |
| `MovementType` | `Entrada`, `Saída` |
| `FileType` | `entrada`, `saida` |

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `units` | Armazéns físicos da Kiwkiw (3 unidades ativas, 4ª em breve) |
| `users` | Usuários do sistema (admin, manager, operator, client) |
| `sellers` | Clientes da Kiwkiw (50–100 sellers) |
| `products` | Produtos por seller (SKU + barcode) |
| `kits` | Kits: um SKU do ERP que na verdade representa N SKUs reais |
| `kit_items` | Componentes de cada kit. `product_id` (FK nullable) liga ao cadastro de produtos; `component_sku` continua sendo a chave que vai para o pedido |
| `kit_items` | Componentes de cada kit |
| `box_algorithms` | Matriz (num_products × score) → tipo de caixa |
| `orders` | Pedidos importados do ERP |
| `order_items` | Itens de cada pedido (com kit expansion) |
| `picking_sessions` | Sessão de separação: agrupa pedidos de um upload |
| `scanning_logs` | Auditoria completa de cada scan/bipagem |
| `stock_movements` | Histórico de entradas e saídas de estoque. `movement_date` = quando a Kiwkiw processou; `nf_date` = data da NF emitida pelo seller (só aparece no Portal do Seller) |
| `stock_positions` | Posição atual de estoque (desnormalizada para performance) |
| `billing_configs` | Configurações de cobrança por seller |
| `audit_logs` | Log de auditoria geral do sistema |
| `app_settings` | Configurações key/value do sistema |
| `user_sellers` | M2M: usuário ↔ sellers que atende |

### Relacionamentos críticos
- `Seller.unit_id` → FK para unidade (use este, não `Order.unit_id` que pode estar desatualizado)
- `User.sellers` (M2M via `user_sellers`) → sellers que o manager/operator atende
- `User.seller_id` (FK simples) → seller único do role `client`
- `Order.session_id` → agrupa pedidos numa mesma importação
- `PickingSession.file_type` e `for_billing` → configurações de NÍVEL DE SESSÃO, propagadas para todos os pedidos

---

## Sistema de Autenticação e Roles

### Hierarquia de roles (crescente de privilégio)
```
client (0) < operator (1) < manager (2) < admin (3)
```

### O que cada role pode fazer

| Ação | admin | manager | operator | client |
|------|-------|---------|----------|--------|
| Importar pedidos (upload Excel) | ✅ | ❌ | ❌ | ❌ |
| Cadastrar usuários/sellers/unidades | ✅ | ❌ | ❌ | ❌ |
| Editar produtos/kits/estoque | ✅ | ✅ (só seus sellers) | ⚠️ parcial | ❌ |
| Bipar pedidos | ✅ | ✅ | ✅ | ❌ |
| Interromper pedido | ✅ | ✅ | ✅ | ❌ |
| Ver dashboard master | ✅ | ✅ (restrito ao grupo) | ❌ | ❌ |
| Ver portal do seller | ✅ | ❌ | ❌ | ✅ |
| Editar configurações | ✅ | ❌ | ❌ | ❌ |
| Force-complete / cancel lote | ✅ | ❌ | ❌ | ❌ |
| Alterar própria senha | ✅ | ✅ | ✅ | ✅ |
| Definir senha temporária para outro usuário | ✅ | ❌ | ❌ | ❌ |

> ⚠️ **Operator — edição parcial de produtos:** operadores podem criar e atualizar produtos via modal inline do Scanner (campos: nome, barcode_seller, box_type). Os endpoints `POST /cadastros/products` e `PUT /cadastros/products/{id}` usam `require_internal`. Kits, estoque e demais cadastros continuam exigindo manager+.

### Token JWT
- Algoritmo: HS256
- Expiração: 12 horas
- Armazenado no frontend: `localStorage` com chave `wms_token`
- Payload: `sub` (user_id), `role`, `unit_id`, `seller_id`, `seller_ids`
- `seller_ids=None` no token = admin (sem filtro de seller)

### Senha Temporária (`force_password_change`)
- Campo `force_password_change: Boolean` na tabela `users` (migração idempotente em `run_light_migrations()`)
- Admin define via botão de chave em **Usuários** → chama `PUT /cadastros/users/{id}` com `{ password: '123456', force_password_change: true }`
- Login retorna `force_password_change` na resposta do `Token`; `Login.tsx` salva o campo em `wms_user` no localStorage
- `App.tsx` renderiza `ForcePasswordChangeModal` (bloqueante, sem fechar) para qualquer usuário autenticado com a flag ativa
- Modal chama `POST /auth/change-password` com `current_password='123456'` (hardcoded) e a nova senha digitada
- Backend limpa `force_password_change = False` após troca bem-sucedida
- **Senha temporária é sempre "123456"** — não expor nem logar
- Trocar a senha voluntariamente: **Settings** (admin/manager/operator) ou botão "Alterar senha" na sidebar do **SellerPortal** (client)

### Credenciais padrão (dev/testes)
- Email: `admin@kiwkiw.com.br`
- Senha: `kiwkiw2024`
- Criadas automaticamente em `create_default_admin()` se banco estiver vazio

---

## Fluxo Principal de Operação

### Fluxo de um dia de trabalho — SAÍDA
1. **Admin importa Excel** → `POST /orders/import` → cria `PickingSession` + `Orders` + `OrderItems`
   - **O estoque é baixado AQUI, NF a NF** (06/08/2026 — ver seção própria abaixo)
   - PDFs de separação e expedição gerados automaticamente após import
   - CSVs de auditoria gerados automaticamente
2. **Operadores veem os cards de manuseio** → `GET /scanning/session-cards` → página `Handling.tsx`
3. **Operador abre um pedido** → escaneia a chave DANFE da etiqueta → `POST /scanning/sessions/{id}/open-by-nfe`
4. **Operador bipa cada produto** → `POST /scanning/scan` → valida `barcode_seller`
5. **Pedido completo** → status vira `completed` → **estoque NÃO é tocado** (já baixou no passo 1)
6. **Admin acompanha** → Dashboard Master → checagens P6/P8/P10/P12

### Fluxo de um dia de trabalho — ENTRADA (é o INVERSO, desde 24/08/2026)
1. **Admin importa Excel** marcando "Entrada" → **NÃO baixa estoque**, **não gera PDF**, **não aparece
   nos números do Dashboard** (só em "Uploads do Dia")
2. **Operador abre a NF** — transportadora não bloqueia; SKU sem produto cadastrado ainda bloqueia
3. **Operador conta** usando o campo QTD, **inclusive além da NF**. Pode **Pausar** e voltar dias
   depois. A NF **nunca conclui sozinha**
4. **Operador aperta Finalizar** → conferência esperado x contado, SKU a SKU
5. **Confirma** → **o estoque entra AQUI, pela contagem física**, com observação nos divergentes, e a
   NF vira `completed`

### Importação de Excel (ordem de operações interna)
1. Detecta o layout do arquivo (importador original 16 cols vs Tiny "Notas Pendentes" 15 cols)
2. Constrói mapa de colunas por aliases (tolerante a variações de nome)
3. Constrói mapa de aliases de sellers em memória (O(1) lookup)
4. Lê todas as linhas → agrupa por NF+seller (deduplicando SKU dentro da mesma NF)
5. Pré-checa duplicatas → pede confirmação se encontrar NFs já existentes
6. Cria `PickingSession` → cria `Orders` com kit expansion → cria `OrderItems`
7. Após importação: gera PDFs (separação + expedição) e CSVs de auditoria

---

## Regras de Negócio Críticas (NÃO ÓBVIAS)

### ⚠️ Baixa de estoque na IMPORTAÇÃO (mudança de 06/08/2026)

> ### 🚨 ESTA SEÇÃO VALE SÓ PARA A **SAÍDA** DESDE 24/08/2026
> A **ENTRADA** funciona ao contrário: não baixa no import, e o estoque entra na **finalização da
> bipagem, pela quantidade contada**. Ver "ENTRADA: estoque entra na finalização" logo abaixo.
> Tudo o que este bloco diz sobre transportadora, `pending-stock` e destravamento **não se aplica a
> NF de entrada**.

**Até 06/08/2026** o estoque era sensibilizado quando o pedido era **concluído na bipagem**. O seller
vendia segunda 20h, a Kiwkiw manuseava terça 17h, e o estoque dele ficava ~24h defasado — inviável de
acompanhar em escala. **Agora a baixa acontece no fim da IMPORTAÇÃO, NF a NF.**

**A bipagem não mexe mais em estoque na SAÍDA.** As chamadas em `process_scan`, `interrupt_order` e
`force_complete_session` foram removidas e **não devem ser reintroduzidas**. (Na entrada é o oposto:
a bipagem é a *única* coisa que mexe em estoque — ver a seção própria.)

**Uma NF só baixa se estiver liberada.** Dois bloqueios, ambos por NF (não pela sessão):
1. **transportadora preenchida**
2. **todos os SKUs com produto ATIVO cadastrado** no seller

Sem isso ela fica pendente (`Order.stock_applied_at` vazio) e **baixa sozinha** quando a pendência for
resolvida — `PATCH /orders/{id}/carrier` e criar/reativar SKU de produto chamam
`release_pending_orders_for_sku()`. **Renomear SKU não destrava nada**: `ProductUpdate` não tem o
campo `sku`, o `PUT /cadastros/products/{id}` não aceita trocar o SKU (Pydantic descarta em
silêncio) — a frase anterior aqui estava errada. Não existe botão de "aplicar estoque": é sempre
automático.

**Onde tudo isso mora:** `backend/services/stock_manager.py`, com um cabeçalho explicando a regra.

| Função | Papel |
|---|---|
| `apply_stock_for_orders(orders, db)` | baixa em lote (usada no import). **Pula NF de entrada.** Devolve `applied` / `pending` / `negatives` / `missing_skus` |
| `apply_stock_for_order(order, db)` | uma NF (destravamento) |
| `apply_stock_for_entry(order, db, counted, expected, ...)` | **só ENTRADA** — lança pela contagem física na finalização |
| `is_entrada_order(order)` | fonte de verdade única do teste "é entrada?" |
| `reverse_stock_for_order(order, db, observation)` | estorno |
| `evaluate_orders_for_stock(orders, db)` | por que a NF não pode baixar |
| `order_has_stock_applied(order, db)` | "esta NF está baixada agora?" |
| `order_stock_sign(order)` | sinal do movimento |
| `release_pending_orders_for_sku(seller_id, sku, db)` | destrava NFs após cadastrar produto |

**⚠️ O SINAL vem do `file_type`, não da natureza da NF.** Arquivo marcado "Entrada" **soma tudo**,
qualquer outro **subtrai tudo**. O `NATURE_TYPE_MAP` **deixou de decidir sinal** (continua gravado em
`Order.nature` para auditoria). Antes o sinal saía do mapa com default "Saída", então NF de entrada
com natureza fora do mapa **dava baixa em vez de entrada**.

**Trocar o `file_type` depois do import re-lança o estoque.** `PATCH /orders/{id}/config` e
`PATCH /scanning/sessions/{id}/config` estornam com o sinal antigo e baixam com o novo. Sem isso o
movimento ficaria com o sinal errado em silêncio.

**`Order.stock_applied_at`** (coluna nova, migração idempotente em `run_light_migrations()`) marca
quando a NF baixou. Vazio = não baixou. **Não dá mais para deduzir estoque pelo status** — um pedido
`PENDING` já pode estar baixado.

**⚠️ Sem backfill, de propósito.** Pedido concluído ANTES de 06/08/2026 tem movimento mas a coluna
vazia. `order_has_stock_applied()` cobre as duas eras: coluna preenchida **ou**
(`COMPLETED`/`INTERRUPTED` **e** existe movimento de verdade). A segunda metade confirma no banco em
vez de confiar no status — senão um pedido concluído à força sem nunca ter baixado seria estornado e
criaria estoque fantasma.

**Estorno é por SALDO LÍQUIDO por SKU**, não movimento a movimento: soma entradas menos saídas
daquele `order_id` e cria um movimento oposto para zerar. Correto independente de quantos ciclos de
baixa/estorno/reativação a NF teve, e **nunca edita ou apaga o movimento original**. Estornar duas
vezes não faz nada (saldo já é zero).

**Quem estorna:** `cancel-duplicate-orders`, `deactivate_order` e — **novo** — `cancel-handling`, que
até 06/08/2026 nunca mexia em estoque de propósito ("pedido não foi processado"). Como agora até NF
`PENDING` pode estar baixada, ele passou a estornar. `reactivate_order` **baixa de novo na hora**, só
daquela NF.

**⚠️ SQL puro em `stock_movements` precisa de `CAST(movement_type AS TEXT)`.** Em produção a coluna é
enum nativo; comparar direto com `'Entrada'` (rótulo inválido) estoura `InvalidTextRepresentation` e
**aborta a transação**. O SQLite aceita — teste local não pega. Já mordeu durante a implementação
desta feature.

**Falha na baixa desfaz o import inteiro.** `apply_stock_for_orders` roda **dentro** de
`import_excel_orders`, antes do commit único; qualquer exceção cai no `rollback` que já existia e nada
é criado — nem sessão, nem pedido, nem movimento.

**⚠️ `db.flush()` + recarga com `joinedload` antes de baixar no import.** Os `OrderItem` são criados
com `order_id` (não pela relationship) e a sessão usa `autoflush=False` — sem isso `order.items` vem
**vazio** e nenhuma NF baixa, em silêncio.

**O que a tela mostra:** modal pós-import com SKUs que ficaram negativos (por seller, marcando quem
**já estava** negativo antes), NFs que não subiram e formulário pra cadastrar o produto faltante na
hora. **Avisa, nunca trava.** Mais o aviso fixo no Dashboard (`GET /orders/pending-stock`) e a marca
"sem estoque" na linha do pedido em Pedidos.

**Cadastro de produto no modal só CRIA produto novo com o SKU da NF.** Não existe "vincular a um
produto existente": o estoque é indexado por `(seller_id, sku)` e apontar a NF pra outro SKU baixaria
o produto errado e criaria posição fantasma no SKU da NF. De-para de SKU (a aba `ACERTO SKU` da
planilha antiga) continua **deliberadamente fora** do WMS.

**Reimportar duplicata agora erra o estoque na hora**, não só se alguém bipar. A trava de duplicata
(que já compara `nf_number + seller_id` em **todo o histórico**, sem filtro de data) continua igual —
o que mudou é o modal, que ficou explícito sobre o impacto imediato no estoque.

### NF com SKU sem produto cadastrado fica FORA do manuseio (06/08/2026)

Uma NF cujo SKU não tem produto ativo cadastrado é **impossível de bipar**: o match é pelo
`barcode_seller` do produto ([scanning.py](backend/routers/scanning.py)) e sem produto não existe
barcode. Antes disso ela entrava no kanban normalmente e o operador só descobria errando item por
item na bancada, até desistir e interromper.

Agora ela **não aparece no manuseio** e volta sozinha quando o produto for cadastrado (o mesmo
cadastro destrava a baixa de estoque). Três pontos aplicam o filtro:

| Onde | O quê |
|---|---|
| `GET /scanning/sessions/{id}/orders` | fora da lista e dos totais; devolve `held_orders` com NF + SKUs faltantes |
| `GET /scanning/session-cards` | fora do total e do progresso; card ganha `held_orders` e `held_only` |
| `POST /scanning/sessions/{id}/open-by-nfe` | bloqueia com `blocked_reason="missing_product"` e diz quais SKUs faltam |

- **O card do seller NÃO some** mesmo se todas as NFs dele estiverem seguradas (`held_only=True`,
  `total_orders=0`) — sumir esconderia a pendência, que é o oposto do objetivo.
- **Não há válvula de escape** (decisão do dono do sistema): segurar é segurar. Para liberar,
  cadastra-se o produto.
- ⚠️ **O critério é `(seller_id, sku)` no cadastro, NUNCA o FK `OrderItem.product_id`.** Esse FK é
  resolvido no import e fica **nulo quando o produto é cadastrado depois** — exatamente o caso que a
  feature trata. Usar o FK reporta como "faltando" um SKU que já tem produto (bug pego em teste
  durante a implementação). Usar sempre `orders_missing_product_skus()` de `stock_manager.py`, que
  resolve tudo numa consulta agrupada.

### Bipagem por QUANTIDADE na entrada + excedente (17/08/2026)

Uma caixa de entrada pode ter 1.000 peças iguais e bipar uma a uma é inviável. O Scanner ganhou um
campo **QTD** ao lado do código de barras: o operador digita a quantidade e bipa uma vez.

**Só na ENTRADA.** Na saída cada bipe é uma conferência real de separação e continua 1 por vez —
lá nada mudou, nem o campo aparece.

| Camada | O quê |
|---|---|
| `ScanRequest.quantity` (default 1) | o default mantém qualquer chamada antiga funcionando |
| `process_scan` | valida 1..`MAX_SCAN_QUANTITY` (9.999) e **recusa com 400 se `quantity > 1` fora da entrada** |
| `GET /sessions/{id}/orders` | devolve `file_type` por NF ("entrada"/"saida") — sem isso a tela não sabe se mostra o campo |
| `Scanner.tsx` | campo só na entrada e só na fase produto; Enter devolve o foco ao leitor; volta para 1 a cada bipe; confirma acima de 100 |

⚠️ **A trava do lado do servidor não é decorativa.** O campo só aparece na entrada, mas uma chamada
forjada lançaria estoque errado na saída — por isso `process_scan` recusa, independente da tela.

**A entrada aceita receber MAIS do que a NF diz.** Acontece de o seller mandar a mais, e o que vale
para o estoque é o que chegou fisicamente. Então, **só na entrada**, o bloqueio de "item já completo"
não se aplica (na saída ele continua exatamente como sempre foi).

> ⚠️ **REVOGADO EM 24/08/2026 — o excedente NÃO lança mais estoque na hora do bipe.**
> `apply_scan_overage()` **deixou de ser chamada** por `process_scan`. A quantidade contada inteira
> (inclusive a sobra) entra de uma vez na **finalização** — lançar nos dois lugares duplicaria a
> sobra. O que **continua valendo** do parágrafo original: o operador recebe o aviso na hora (toast +
> badge `+N` no card) e a ocorrência fica na Trilha de Auditoria via `ScanningLog.error_message` com
> `is_error=False`.
>
> `apply_scan_overage()`, `OVERAGE_TAG`, `order_has_scan_overage()` e `orders_with_scan_overage()`
> **continuam existindo e NÃO devem ser removidas**: os movimentos gravados entre 17/08 e 24/08
> precisam continuar sendo reconhecidos pelo bloqueio de troca de `file_type` descrito abaixo.

**O excedente é incremental:** `max(0, já+qtd−esperado) − max(0, já−esperado)`. Hoje serve só para
avisar o operador; até 24/08/2026 essa era a quantidade lançada no estoque, e usar o total a cada
bipe lançaria estoque repetido.

**O movimento nasce com o `order_id` da NF de propósito** — é isso que faz `reverse_stock_for_order()`
(que trabalha por **saldo líquido por SKU** do `order_id`) recolher o excedente junto, sem código
novo. Vale igual para o movimento que o **Finalizar** cria hoje. Cancelar duplicata,
`cancel-handling` e inativar NF já estornam tudo. **Não escrever tratamento especial nesses fluxos.**

⚠️ **Trocar o `file_type` de NF com excedente é BLOQUEADO (409)** em `PATCH /orders/{id}/config` e
`PATCH /scanning/sessions/{id}/config`. Motivo: eles estornam tudo e re-lançam **só a quantidade da
NF** — o excedente sumiria do estoque em silêncio. No endpoint de sessão o bloqueio é da **sessão
inteira** (troca parcial deixaria pedidos com tipos diferentes sem ninguém perceber), diferente das
NFs órfãs, que são puladas. Detecção por `order_has_scan_overage()` / `orders_with_scan_overage()`,
que reconhecem o movimento pelo prefixo `OVERAGE_TAG` na `observation` — **não mudar esse prefixo**
sem migrar os registros existentes.

⚠️ **Progresso do pedido é contado SKU A SKU, nunca pelo total.** `_count_remaining` e
`_count_remaining_after_scan` somam `max(0, esperado − bipado)` por SKU. Contar pelo total (soma de
tudo esperado menos soma de tudo bipado, como era até 17/08/2026) **fecha o pedido cedo demais**
desde que a entrada aceita excedente: 200 peças a mais de um SKU compensavam 200 que faltavam de
outro e a NF era concluída com item nunca conferido. Bug pego pela bateria de testes durante a
implementação. As funções também **consolidam SKU repetido em dois `OrderItem`** (kit + linha
avulsa) — pelo mesmo motivo o excedente sai de `expected_sku_total`, não de `matched_item.quantity`,
que nesse caso lançaria estoque fantasma.

**Limite conhecido, aceito:** com o pedido já **concluído**, bipar excedente é recusado pela trava
pré-existente de "pedido completed". Peça encontrada depois de fechar a NF se resolve pelo ajuste
manual na tela de Estoque.

**Testes:** 57 verificações em 16 cenários, 100% verde em SQLite **e** PostgreSQL, mais conferência
visual da tela contra banco descartável.

### ⚠️ ENTRADA: estoque entra na FINALIZAÇÃO da bipagem (24/08/2026)

**Esta seção REVOGA, só para a entrada, a regra de baixa na importação.** A saída não mudou em nada.

**Motivo:** vinha quantidade a menos de um SKU e, como o estoque já tinha entrado pela quantidade da
NF, alguém tinha que chamar o gerente para acertar na mão na tela de Estoque. Agora entra o que
chegou fisicamente, sem etapa manual.

**O fluxo:**
1. Import cria a NF e **não toca em estoque** (`apply_stock_for_orders()` pula entrada)
2. Operador bipa, com o campo QTD, quantas vezes precisar — **inclusive além da NF**
3. A NF **nunca conclui sozinha**, mesmo batendo 100%
4. Operador aperta **Finalizar** → conferência esperado x contado, SKU a SKU
5. Confirmando: estoque entra pela **contagem**, com observação nos divergentes, e a NF vira `COMPLETED`

| Endpoint | O quê |
|---|---|
| `POST /scanning/orders/{id}/finalize-entry` | 2 passos: body `{}` devolve a conferência **sem gravar nada**; `{"confirm": true}` lança e conclui |
| `POST /scanning/orders/{id}/pause` | pausa (a NF continua EM ABERTO) |

**Qualquer operador finaliza** — decisão do dono do sistema. **Não dá para reabrir** NF finalizada.

⚠️ **A ENTRADA NÃO AUTO-CONCLUI, e isso não é detalhe.** Bater a quantidade da NF não quer dizer que a
conferência acabou — a caixa seguinte pode trazer mais peças do mesmo SKU. Se ela fechasse no último
bipe, o operador perderia o direito de continuar (pedido `completed` recusa scan) e a sobra ficaria
fora do estoque. Reintroduzir a auto-conclusão na entrada quebra a feature inteira.

⚠️ **A virada NÃO usa corte por data, de propósito.** Quem decide é o `stock_applied_at`:

| Estado | Finalizar faz |
|---|---|
| `stock_applied_at` **vazio** | lança pela contagem |
| `stock_applied_at` **preenchido** (NF importada antes de 24/08, já baixada) | só conclui, **não lança** |

Um corte por data dependeria do horário exato do deploy: errar para trás faria a NF importada na
manhã do deploy entrar **duas vezes**. O `stock_applied_at` acerta sozinho, e ainda cobre a NF antiga
que ficou pendente e nunca baixou (que um corte por data deixaria sem estoque para sempre).

**SKU que não veio nada gera um movimento de quantidade ZERO** só para carregar a observação.
Numericamente é inócuo (não mexe na posição) e é o que faz a falta aparecer no relatório de Estoque,
que é onde o time procura. Sem isso, "não veio nada deste SKU" sumiria.

**Texto da observação** (mesmo formato para falta e sobra, aprovado pelo dono do sistema):
`SKU CAM-PRETA-M — recebemos 130 unidades e não 120 conforme NF 123456. Conferido por Fulano em 24/08/2026.`

**PAUSAR ≠ INTERROMPER.** Interromper é carimbo definitivo (não reabre, conta como feito); pausar
deixa tudo em aberto para continuar depois — marca com muitos SKUs leva **dias** para ser conferida.
- ⚠️ **`interrupt_order` RECUSA (400) NF de entrada.** Não é cosmético: carimbar `INTERRUPTED` numa
  entrada deixaria a mercadoria fora do estoque para sempre, sem ninguém perceber, já que o estoque
  dela só entra no Finalizar.
- Pausa **não é status** — é um `ScanningLog` marcador (`sku='PAUSE'`/`'RESUME'`, `quantity=0`,
  `is_error=False`). Escolhido assim para não alterar o enum `OrderStatus` no Postgres de produção.
  `_paused_order_ids()` resolve em 2 consultas, nunca 1 por pedido.
- ⚠️ **Marcador NUNCA é bipagem.** Passa nos filtros de "bipagem real", então a exclusão é explícita
  (`MARKER_SKUS`) em `_active_scan_filters`, na produtividade e nos scans recentes do Dashboard.
  Esquecer isso infla o número de bipes do operador e polui painel.

**Transportadora deixou de bloquear entrada** (`open_order_by_nfe`, `process_scan`, card do kanban,
badge do Scanner): o que importa é que a mercadoria chegou, não por qual transportadora. **SKU sem
produto cadastrado continua bloqueando** — sem produto não existe barcode para casar.

**Entrada saiu do Dashboard** (KPIs, checagens, sellers com pedidos, produtividade, por unidade) e
**não gera PDF de Separação/Expedição** — são documentos de saída. **Continua em "Uploads do Dia"**,
de propósito: senão o admin subiria um arquivo e ele sumiria da tela sem deixar rastro.

**Testes:** 97 verificações E2E, 100% verde em SQLite **e** PostgreSQL, mais conferência visual.

### Bipagem
- **Só `barcode_seller` é aceito** — o `barcode_kiwkiw` existe no modelo mas não é usado na bipagem
- **Lock por (sessão+seller):** só 1 pedido com atividade real por seller por sessão. Pedido em `SCANNING` sem nenhum `ScanningLog` real = "lock fantasma" → liberado automaticamente
- **INTERRUPTED = COMPLETED** para o kanban: pedido interrompido conta como "feito" no progresso. **Para estoque, nenhum dos dois faz nada** — a baixa acontece na importação desde 06/08/2026, e interromper não devolve estoque (divergência física se acerta na mão pela tela de Estoque)
- **Não volta de INTERRUPTED:** pedido interrompido não pode ser reaberto via bipagem normal
- ⚠️ **Os dois pontos acima valem só para a SAÍDA desde 24/08/2026.** Na entrada, `interrupt` é
  recusado com 400 (usa-se **Pausar**), a NF pausada continua contando como **EM ABERTO**, e a
  conclusão só vem pelo **Finalizar** — que é onde o estoque entra

### Cancelamento de pedidos duplicados (upload repetido)
- Cenário: cliente sobe o mesmo Excel duas vezes → NFs duplicadas na mesma sessão. Correção pelo Dashboard: card da sessão em "Uploads do Dia" → botão **"Excluir sellers"** → escolhe quais sellers daquela sessão cancelar (os demais não são afetados).
- Endpoint: `POST /scanning/sessions/{id}/cancel-duplicate-orders` (admin **e** manager — manager só nos sellers que atende, via `get_user_seller_ids`). Body: `{ seller_ids: [...], confirm: bool }`.
- **Fluxo em 2 passos:** sem `confirm=true`, só devolve um preview (nada muda no banco) quando algum pedido selecionado já tem bipagem registrada. Com `confirm=true`, executa de fato.
- Pedido vira `status=cancelled` (soft — nunca é apagado). Se a NF **já baixou estoque** (desde 06/08/2026 isso é decidido por `order_has_stock_applied()`, **não pelo status** — NF `PENDING` já pode estar baixada), o endpoint cria um **novo movimento revertendo o saldo líquido** por SKU (nunca edita/apaga o movimento original) com `observation` explícita tipo `"ESTORNO — NF X cancelada (duplicata) por Fulano em ..."`. Tudo registrado em `AuditLog` (por pedido + resumo do lote).
- **Diferente do endpoint `/scanning/sessions/{id}/cancel-handling`** (admin-only, "manuseio desnecessário", um seller por vez, sem preview de 2 passos) — são dois endpoints separados de propósito. ⚠️ **Desde 06/08/2026 o `cancel-handling` também estorna estoque**; antes disso ele nunca mexia, porque pedido não concluído não tinha baixado nada.
- **Pedido `cancelled` fica invisível em toda a operação** (Pedidos, Scanner, Manuseios, estatísticas do Dashboard) para qualquer role, inclusive manager — só aparece na Trilha de Auditoria. Filtro aplicado em `list_orders` (orders.py), `get_session_orders` (scanning.py) e no `base_filter` do `/dashboard/master`. Se adicionar uma nova query de pedidos em algum lugar, **lembrar de excluir `status != CANCELLED`** — não há um filtro global automático.

### Datas e Timezone (⚠️ CRÍTICO — Railway roda em UTC)
- **Dashboard usa `imported_at`** (data de upload), NUNCA `order_date` (data da NF)
- **NUNCA use `datetime.now()` ou `date.today()` diretamente** — Railway roda em UTC (GMT+0), causando timestamps 3h adiantados para o Brasil (GMT-3)
- **Use SEMPRE `now_brasilia()` e `today_brasilia()`** de `backend/timezone_utils.py`:
  ```python
  from ..timezone_utils import now_brasilia, today_brasilia, end_of_day
  ```
- **No frontend**, use `todayBrasiliaStr()` de `frontend/src/timezone.ts` em vez de `new Date().toISOString().slice(0, 10)` (que usa UTC e retorna data errada após 21h em Brasília)
- **`end_of_day(d)`** retorna `datetime.combine(d, datetime.max.time())` — use em queries `timestamp <= date_to` para incluir todos os registros do dia (`date_to 00:00:00` excluiria tudo do próprio dia)
- **Estoque sensibilizado com `today_brasilia()`** — desde 06/08/2026 é a data em que a Kiwkiw **importou o arquivo**, não a data do ERP nem a da conclusão da bipagem

### Email de usuário — sempre comparado sem diferenciar maiúscula/minúscula (31/07/2026)
- Login (`auth.py`) e cadastro/edição de usuário (`products.py`, `create_user`/`update_user`) comparam email com `func.lower(...)` dos dois lados — nunca `==` direto.
- **Não pode existir dois usuários com o mesmo email diferindo só em maiúscula/minúscula.** `create_user` já bloqueava duplicata (mesmo para inativos, de propósito — ver tabela de erros comuns), mas era case-sensitive. `update_user` **não tinha nenhuma checagem de duplicata de email** antes de 31/07/2026 — foi adicionada.
- Isso não normaliza nem corrige emails já existentes no banco — só impede novas duplicatas a partir de agora. Se já existir uma duplicata por case anterior a essa data, precisa ser corrigida manualmente.

### Sellers e match automático
- Match por: `trade_name` > `name` > `other_aliases` (campo texto separado por `;`), case-insensitive e sem espaços nas pontas
- `other_aliases` serve para mapear razões sociais longas do ERP → apelido canônico (ex: "MERU SERVICOS EMPRESARIAIS E VAREJO LTDA" → "YUGEN")
- **⚠️ Desde 27/07/2026, NÃO cria mais seller automaticamente e em silêncio.** Se um nome do arquivo não bate com nenhum cadastro (ativo nem inativo), o import **pausa sem criar nada** e devolve `requires_confirmation=True` + `unmatched_sellers` (mesmo padrão de NF duplicada / seller inativo referenciado). O frontend abre um modal (`Dashboard.tsx`) pedindo, por nome: **"Criar novo seller"** (exige escolher a unidade ali mesmo — nunca mais nasce seller sem unidade por essa via) ou **vincular a um seller já cadastrado**. Só depois da decisão o import continua. Ver `seller_link_decisions` em `order_import.py` / `POST /orders/import`.
- Motivo da mudança: essa criação silenciosa gerava sellers **duplicados** com pedidos presos neles (ex.: "MINERAUX" vazio vs "Mineraux" com unidade) — ver seção "Sellers duplicados/sem unidade" abaixo.

### Sellers duplicados/sem unidade
- Aviso no Dashboard ("Sellers sem unidade associada") vem de `GET /cadastros/sellers/without-unit` — query simples e correta: `Seller.active=True AND Seller.unit_id IS NULL`. Se aparecer um seller nessa lista mas a tela de Sellers mostra ele com unidade, **são dois registros diferentes** (`Seller.id` distintos) — não é bug de exibição. `Sellers.tsx` só mostra unidade via `unit_display_name` (property computada do FK real), nunca via texto solto.
- Página de correção: **`/sellers/corrigir`** (`SellerFixes.tsx`, admin **e** manager, sem item no menu lateral — acessível pelo aviso do Dashboard ou por um botão em Sellers.tsx). Por seller sem unidade, duas ações possíveis:
  - "Não é duplicado, só associar unidade" → `POST /cadastros/sellers/{id}/assign-unit` (manager+, só altera `unit_id` — endpoint deliberadamente mais restrito que o `PUT /cadastros/sellers/{id}` geral, que continua admin-only)
  - Migrar para um seller existente → `POST /cadastros/sellers/{from_id}/merge-orders-into/{to_id}` (manager+, só reatribui `Order.seller_id` — não mexe em produto/estoque/kit/cobrança)
- Depois de migrar, o seller duplicado (vazio) **não é desativado automaticamente** — isso é feito manualmente pela tela de Sellers (edição), seguindo a convenção já existente de renomear com sufixo `(DUPLICADO)`.

### Seller inativo — onde pode e onde não pode aparecer (regra de 30/07/2026)

**Regra:** seller inativo (`Seller.active = False`) **não aparece em nenhuma lista de seleção nem em registro operacional**. Some de dropdowns, filtros, Pedidos, Manuseios, Scanner e das estatísticas do Dashboard. São **duas exceções, e só duas**:

| Onde | Comportamento | Por quê |
|---|---|---|
| **`/sellers`** (`Sellers.tsx`) | Lista tudo, com badge "Ativo/Inativo" | É onde se reativa — sem isso o inativo vira inalcançável |
| **Faturamento** (`Billing.tsx` + `billing.py`) | Lista tudo | Permite fechar a última fatura de quem saiu no meio do mês |
| **Trilha de Auditoria** (`scanning.py` audit-log / scan-logs) | Não filtra nada | Mesmo princípio já usado para pedido cancelado: a auditoria é onde se investiga o que sumiu |

**Como está implementado — o padrão é esconder:**
- `GET /cadastros/sellers` tem **`active_only=True` por padrão** (`products.py`). Quem precisa do inativo pede `active_only=false` explicitamente. Tela nova já nasce obedecendo a regra.
- No frontend, `cadastrosApi.sellers()` também tem **`activeOnly = true`** por padrão (`api.ts`).
- ⚠️ **Chave de cache do react-query:** as duas telas que pedem a lista completa usam chave **hierárquica** — `['sellers', 'all']` em `Sellers.tsx` e `['sellers', 'billing']` em `Billing.tsx`. Se usassem a chave `'sellers'` (a das telas que só veem ativos), o react-query serviria uma lista pela outra e o inativo vazaria. O prefixo `sellers` mantém os `invalidateQueries('sellers')` existentes funcionando (v3 casa por prefixo).
- Nas queries de pedido, o recorte `Seller.active == True` fica **junto do filtro de `CANCELLED`**: `list_orders` (`orders.py`), `get_session_orders` e `session_cards` (`scanning.py`), `base_filter` do `/dashboard/master` (`dashboard.py`). **Query nova de pedido tem que repetir os dois filtros** — não existe filtro global automático.
- Em `session_cards` o filtro é por **card**, olhando `order.seller.active`. Pedido **sem seller** (anomalia de dados) continua visível como "Sem seller" de propósito — escondê-lo tornaria a anomalia invisível.
- O parâmetro `include_inactive_sellers` e os toggles "Mostrar sellers inativos" do Dashboard e de Manuseios **foram removidos**. Não recriar.

**Trava ao inativar:** `DELETE /cadastros/sellers/{id}` conta pedidos em aberto (`pending`/`validated`/`separating`/`scanning`). Havendo algum, sem `confirm=true` o endpoint **só devolve `requires_confirmation` + `open_orders` e não altera nada** — mesmo padrão de 2 passos do `cancel-duplicate-orders`. `Sellers.tsx` mostra o aviso e só reenvia com `confirm` se o admin aceitar. Motivo: inativar esconde o seller da operação inteira, e um pedido não concluído ficaria invisível, sem ninguém para bipar.

**Os fluxos de importação continuam mostrando o nome do inativo** — modal de sellers inativos do import de pedidos (`Dashboard.tsx`) e o dropdown de decisão do import de kits (`Kits.tsx`, opção "reativar"). Ali o nome veio do arquivo e a tela é de decisão (reativar/ignorar), não uma lista de escolha de seller. Cortar isso faria o import descartar pedidos em silêncio — exatamente o bug corrigido em 27/07/2026.

**Consequências aceitas** (decisão do dono do sistema, não são bugs):
- Estoque de seller inativo fica inacessível pela tela até reativar (o seletor de `Inventory.tsx` some com ele).
- Inativar um seller remove os pedidos dele das contagens do Dashboard **inclusive de dias passados**. A trava acima existe para avisar no momento da inativação.
- Em `Users.tsx`, vínculo com seller inativo fica invisível no `SellerMultiSelect` — o id permanece no array e **não se perde ao salvar** (mesmo comportamento já existente para seller de outra unidade).

### Kits — expansão, vínculo com produtos e importação (revisão de 28/07/2026)

**O que é:** um kit é um SKU do ERP que não existe fisicamente — representa N SKUs reais. A resolução acontece **uma única vez, na importação do Excel de pedidos**. Depois disso o SKU do kit some do fluxo: pedido, bipagem, PDF, estoque e faturamento só enxergam os componentes.

- **Expansão é de 1 nível só.** Componente que também é kit **não** é explodido — o cadastro apenas avisa (`warnings.nested_kits`). Auto-referência (componente == próprio kit) é bloqueada com 400.
- **Não é retroativo.** Criar/editar kit não reprocessa pedidos já importados. O modal avisa isso.
- **Kit inativo não explode** (`expand_kit_items` filtra `active == True`) — o SKU do kit entra cru no pedido.
- **`KitItem.product_id`** (FK nullable para `products`) liga o componente ao cadastro. `component_sku` continua sendo a chave que vai para o pedido — o vínculo é conveniência/qualidade, não pré-requisito. Migração idempotente em `run_light_migrations()` faz o backfill casando `seller_id` + `sku` exato de produto ativo.
- **Pendências de vínculo:** `GET /cadastros/kits/unlinked-components` alimenta a tela **`/kits/vincular`** (`KitFixes.tsx`, admin+manager, fora do menu — acessada pelo botão em Kits ou pelo aviso no Dashboard). Por componente: vincular a produto existente, criar o produto na hora (nome obrigatório, barcode opcional) ou deixar sem vínculo. `POST /cadastros/kits/items/{id}/link` **recusa produto de outro seller**.
- **Escopo por seller:** todos os endpoints de kit usam `get_user_seller_ids`. Manager/operator só veem e editam kits dos sellers que atendem; admin vê tudo.
- **`kit_sku` e `seller_id` são imutáveis** no `PUT` — antes vinham no payload e eram descartados em silêncio (a tela dizia "Kit atualizado!" sem alterar nada). Hoje devolve 400 e os campos ficam desabilitados no modal de edição.
- **Recriar kit excluído reativa** o registro (mesmo `id`, composição substituída, `AuditLog` com ação `REACTIVATE`). A `UniqueConstraint (seller_id, kit_sku)` ignora o soft-delete, então filtrar por `active` na checagem de duplicata causava IntegrityError 500.
- **Log de explosões:** `GET /cadastros/kits/expansion-log` (aba "Log Explosões") lê `order_items` com `is_kit_component=True`, **excluindo pedidos `CANCELLED`**. A rota estática é declarada **antes** de `/kits/{kit_id}` — um futuro `GET /kits/{kit_id}` capturaria `expansion-log` como id.

**Importação da planilha `TRATAMENTO KITS` (aba `CADASTRO KITS`)** — `backend/services/kit_import.py`, endpoints `POST /cadastros/kits/import-file/analyze` e `/execute`, em 2 passos como o import de histórico de estoque:

- Layout: cabeçalho na linha 3 (`SKU Kit` na coluna B), dados a partir da 4. `A`=cliente, `B`=SKU kit, `C`=nome, depois **trincas `SKU | NOME | QUANTIDADE`** a partir de `D`. **A quantidade de trincas é detectada pela largura da aba, não é fixa** — a planilha de referência tem 11 e um kit real usa todos os 11 (`thefullselfcarekit`, ZAYAZ). O limite de 10 da colagem manual truncava o 11º em silêncio; hoje a colagem aceita 15.
- **`analyze` não grava nada.** Devolve total, agrupamento por cliente com `status` (`matched` / `inactive` / `unmatched`), linhas bloqueadas, SKUs sem produto e avisos.
- **Quantidade em branco BLOQUEIA a linha** (não assume 1): quantidade de kit multiplica no estoque, chutar vira erro de inventário silencioso. Também bloqueiam: quantidade zero/negativa/fracionada/texto, linha sem cliente, sem SKU, sem componente, componente com nome mas sem SKU, e **kit repetido na planilha** (não adivinha qual composição vale). Componente repetido dentro do mesmo kit é somado, com aviso.
- SKU numérico do Excel (`3`, `678.0`) vira texto (`"3"`, `"678"`).
- **Decisão por cliente** (`seller_decisions`, JSON `{nome: valor}`), aplicada a **qualquer** cliente da planilha:
  - `seller_id` → vincula a um seller **ativo** já cadastrado (nunca cria seller por essa via)
  - `"skip"` → não importa as linhas daquele cliente; o relatório devolve `skipped_sellers`
  - `"reactivate"` → só para cliente que casa com um seller **desativado**: religa o cadastro (`active=True`), importa nele e grava `AuditLog` de `Seller`/`REACTIVATE`
- Vincular pelo id a um seller inativo continua **bloqueado** (400) — o caminho é `reactivate` ou `skip`.
- Sem decisão para algum nome, o `execute` **pausa e não grava nada** (`requires_confirmation`). O botão do modal mostra quantos kits realmente entrarão (ex.: "Importar 37 kit(s) de 102").

**Abas da planilha que ficaram de fora (decisão de 28/07/2026):** `ACERTO SKU` (de-para NOME do produto → SKU correto, recurso que o WMS não tem) e `ANTIGOS` (versionamento de composição de kit). `INPUT`/`OUTPUT` são a execução da macro antiga e não precisam ser importadas.

### Produtos — Inativar vs Excluir (distinção APENAS visual)
- Ambas as ações chamam o mesmo endpoint `DELETE /cadastros/products/{id}` → `active = False` no banco
- **Inativar** (ícone olho fechado): mensagem "pode ser reativado depois". Com o toggle "Mostrar inativos" ativo, o produto aparece com opacidade reduzida e botão **Reativar** (`POST /cadastros/products/{id}/reactivate`)
- **Excluir** (ícone lixeira): mensagem mais forte "não poderá ser reativado pela interface". Produto some mesmo com toggle ativo — a UI nunca mostra botão Reativar para eles, mas o registro permanece no banco para preservar histórico de bipagem
- **Não há coluna no banco distinguindo os dois**: a separação é puramente de UX. Não tente criar campo `deleted` — é desnecessário e quebraria a auditoria de bipagem

### Aba Comercial de Sellers e parâmetros de faturamento (31/08 → unificado 01/09/2026)
- A aba **Comercial** em Sellers e o topo do **Faturamento de mês aberto** editam **o mesmo
  registro**: `billing_seller_params`, via `GET/PUT /billing/seller-params/{seller_id}`
  (`require_manager_or_above`) e `PUT /billing/closing/{s}/{m}` (`require_admin`). Fonte única —
  ver "FONTE ÚNICA de parâmetros de faturamento" no topo. Nada grava em `billing_configs`.
- Campos (16): `preco_unitario`, `min_pedidos`, `manuseio_b2b`, `valor_caixa_b2b`,
  `adic_produto_b2b`, `franquia_produtos_b2b`, `limite_itens_b2b`, `tipos_caixa_inclusos` (texto),
  `cota_caixas_mes`, `franquia_m3`, `preco_m3`, `seguro_incluso`, `aliquota_seguro` (%, default
  0.30), `armazenagem_inclusa`, `valor_segurado`, `cubagem_m3`.
- ⚠️ O front **tem que mandar os 16** no PUT — Pydantic preenche 0/15 nos ausentes e zeraria o
  resto. `fieldsToParams` (Sellers.tsx) e `buildBody` (Billing.tsx) mandam.
- **`billing_configs` (tabela `BillingConfig`) está MORTA** — só para rollback. Não reintroduzir.
- Mês **fechado** lê o snapshot congelado de `billing_monthly_closings` (read-only). `reopen`
  volta a seguir o seller.

### Arquivo de Experiência do Seller
- Endpoint: `POST /cadastros/sellers/{seller_id}/experience-file` (requer manager+)
- Aceita `.pdf`, `.ppt`, `.pptx`
- Salvo em `data/media/experience/seller_{id}.{ext}`
- Servido via `/media/experience/` (StaticFiles)
- O frontend chama `cadastrosApi.uploadExperienceFile(sellerId, file)` ao salvar o modal do Seller (se houver arquivo selecionado)

### Estoque
- `StockPosition` é desnormalizado (calculado a partir dos movimentos para performance)
- `current_stock = initial_stock + total_in - total_out`
- Nível: ALTO > 600 | MÉDIO > 300 | BAIXO ≤ 300
- **Anti-duplicata:** `apply_stock_for_orders()` pula NF que já tem `stock_applied_at` preenchido e NF cancelada/inativa → chamar duas vezes não dobra a baixa (`update_stock_from_order()` e `update_stock_from_session()` **foram removidas** em 06/08/2026)
- **Editar movimentação de estoque:** requer `role=admin` + senha especial (configurável via env `WMS_EDIT_PASSPHRASE`) — **não documentar a senha aqui**
- **Estoque negativo é esperado e não deve ser "corrigido":** sellers enviam produtos sem NF, então a entrada não é registrada mas as saídas sim. Na carga inicial (24/07/2026), 456 SKUs ficaram negativos. Decisão do dono do sistema: manter como está — o negativo é o indicador de onde falta regularizar entrada. Uma função para ocultar SKUs descontinuados pode existir no futuro, mas **apenas visual**

### ⚠️ `movement_type`: grave sempre o NOME do enum (`IN`/`OUT`)
Em produção (PostgreSQL) a coluna é um **ENUM nativo** cujos rótulos são os *nomes* do enum Python — confirmado com `SELECT unnest(enum_range(NULL::movementtype))` → `IN`, `OUT`.

| Como grava | O que escrever | Por quê |
|---|---|---|
| ORM (`models.StockMovement(...)`) | nada a fazer | o SQLAlchemy já converte para o nome |
| SQL puro (`text()` + `INSERT`) | **`mt.name`** | `mt.value` grava `"Entrada"` e o Postgres recusa com `InvalidTextRepresentation`, abortando a transação inteira |

**SQLite não pega esse erro** — lá a coluna é texto livre e aceita qualquer string. Um teste que passa em SQLite não prova nada sobre esse ponto; valide contra PostgreSQL ou por inspeção.

Na leitura, `get_movements` usa SQL puro e normaliza `IN`/`OUT` → `Entrada`/`Saída` via `_MT_NORMALIZE`. O banco convive com os dois formatos por razões históricas — **não tente uniformizar sem falar com o usuário**.

### Importação do histórico de estoque (planilha `ESTOQUE <seller>.xlsx`)
Tela: **Estoque** → botão **Importar Histórico (Excel)** → `ImportHistoryModal`.
Endpoints: `POST /inventory/import-history/{seller_id}/analyze` e `/execute`.

- Lê a aba **DETALHADO**: linha 1 mesclada, linha 2 cabeçalho, dados a partir da linha 3.
  Colunas por posição: B=Log, C=Tipo, D=Data, E=SKU, F=Quantidade, H=Nome, I=Observação, AB=#NF
- **Duas datas distintas, ambas gravadas:**
  - **B (Log)** → `movement_date`: quando a Kiwkiw processou. A planilha só preenche o Log na **primeira linha de cada bloco lançado**; as seguintes herdam o valor de cima (**forward-fill**). Sem isso, ~94% das linhas caem no fallback e recebem a data de hoje
  - **D (Data)** → `nf_date`: quando o seller emitiu a NF. Exibida **apenas no Portal do Seller** (`SellerPortal.tsx`), não nas telas internas
- A coluna G (**Ajuste**) é só a quantidade com sinal — o tipo Entrada/Saída já carrega essa informação. Ignorar
- **Trava de SKU não cadastrado:** `execute` devolve 422 com `missing_skus` se sobrar SKU sem produto no seller. O modal lista os faltantes e permite nomeá-los; o botão "Cadastrar mesmo assim" envia `force=true`, que **grava a movimentação mas não cria o produto** (gera estoque órfão — preferir preencher os nomes)
- Os produtos novos são commitados **antes** do bloco de movimentações: se a gravação falhar e der rollback, os produtos permanecem criados
- Gravação otimizada para planilhas grandes (150k linhas em ~13s): pré-carga em memória, `INSERT` em blocos de 5.000 e deltas acumulados por SKU, em transação única

### Algoritmo de Caixa (BoxAlgorithm)
- `box_type` no `Product` é o **peso/score** do produto (número inteiro), não o tipo de caixa em si
- `score total = Σ (quantity × box_type_do_produto)` por item do pedido
- Lookup em `BoxAlgorithm`: encontra a regra para `(seller_id, num_products, score)` → retorna o tipo de caixa
- As caixas `caixa1`–`caixa8` no `Seller` são os tipos de caixa que aquele seller disponibiliza (usados para faturamento)
- Informação de caixa é necessária para cobrar corretamente: se o pedido exigiu caixa maior do que o plano do seller cobre, é cobrado adicional

### Importação de Excel — edge cases
- SKU vindo como float do Excel (`123.0`) → remove `.0` → `"123"`
- Chave DANFE em float com notação científica (Bling) → converte para inteiro; **pode haver perda de precisão nos últimos ~15 dígitos** — comportamento documentado e aceito
- Quantidade inválida/ausente → assume `1` (com warning)
- Mesmo SKU em múltiplas linhas da mesma NF → soma as quantidades (não duplica item)

### Migrações do banco
- **Não usa Alembic**. Migrações são feitas em `run_light_migrations()` no `main.py`
- São idempotentes: executadas a cada startup, só aplicam o que falta
- Suportam SQLite (usa `PRAGMA table_info`) e PostgreSQL (usa `information_schema`)
- Nunca remover ou alterar esse mecanismo sem entender o impacto em produção

### Dashboard Master — só mede SAÍDA (24/08/2026)

O Dashboard é uma ferramenta de **expedição**: KPIs, checagens P6/P8/P10/P12, sellers com pedidos,
produtividade e resumo por unidade descrevem o fluxo de saída. **NF de entrada foi tirada de todos
esses números** (decisão do dono do sistema).

- O recorte central é `_saida_only()`, aplicado no `base_filter`. ⚠️ **`Order.file_type` é NULLABLE**:
  um `!= IMPORT` puro devolveria NULL e sumiria com essas linhas em silêncio — por isso o helper
  trata NULL como saída (o default da coluna).
- ⚠️ **Blocos que montam o próprio filtro precisam repetir o recorte à mão**: `units_summary` e o KPI
  **"Em Bipagem"**, que é somado em Python fora do `base_filter`. O segundo já contou conferência de
  entrada num painel cujo "Total de Pedidos" estava zerado (bug pego na conferência visual).
- As checagens de **PDF Separação/Expedição** escolhem a última sessão do dia **ignorando sessões de
  entrada** — senão ficariam vermelhas para sempre num dia que terminou com upload de entrada.
- **"Uploads do Dia" NÃO filtra entrada**, de propósito. E o estado vazio da tela também olha
  `sessions_today`: num dia só com entrada, `total_orders_today` é 0 e sem isso a página inteira
  cairia no "Nenhum pedido importado hoje", escondendo o upload.
- **"Scans Recentes"** exclui os marcadores `PAUSE`/`RESUME`/`INTERRUPT` — não são bipagem.

### Dashboard Master — card "Por Unidade"
- Endpoint `GET /dashboard/master` (`routers/dashboard.py`), bloco `units_summary`
- Quando o usuário filtra por uma unidade específica no seletor do topo, todos os outros blocos do dashboard (KPIs, checagens, sellers com pedidos, etc.) respeitam esse filtro normalmente
- **Exceção: role `admin`** — o card "Por Unidade" sempre mostra o resumo completo de **todas** as unidades ativas, independente da unidade selecionada no seletor. Implementado com `and user_role != "admin"` na condição que zera as unidades não selecionadas
- Para `manager`, o comportamento não muda: só a unidade filtrada (ou os sellers que ele atende) aparece com números; as demais ficam zeradas

---

## APIs — Prefixos e Responsabilidades

| Prefixo | Arquivo | Responsabilidade |
|---------|---------|-----------------|
| `/auth` | `routers/auth.py` | Login (`POST /auth/login`), perfil (`GET /auth/me`) |
| `/orders` | `routers/orders.py` | Import Excel (**baixa o estoque, só SAÍDA**), listagem, config de pedido, transportadora (**destrava a baixa**), `pending-stock` (NFs de saída que não baixaram — **entrada fica fora**), PDFs (**recusam sessão de entrada**) |
| `/scanning` | `routers/scanning.py` | Sessões, scan, open-by-nfe, interrupt (**recusa entrada**), **finalize-entry** e **pause** (só entrada, 24/08/2026), force-complete, cancel-handling (admin, **estorna desde 06/08/2026**), **cancel-duplicate-orders** (admin/manager, com reversão de estoque), deactivate/reactivate NF, **audit-log** (paginado, filtros combinados de seller/transportadora/operador/busca — 31/08/2026) + **audit-log/carriers** e **audit-log/export/csv** (CSV sem teto), session-cards, suggested-box. **Todo o estoque de ENTRADA entra por aqui, no `finalize-entry`; na saída daqui só se estorna/re-lança** |
| `/inventory` | `routers/inventory.py` | Estoque, movimentações manuais, import de histórico (Excel), bulk import, histórico SKU, export CSV. **Sem botão na tela desde 24/07/2026:** `POST /inventory/movements/bulk` e `POST /inventory/bulk-stock-upload` continuam funcionando, mas foram retirados da interface por confundirem com o import de histórico — não recriar os botões sem combinar com o usuário |
| `/cadastros` | `routers/products.py` | Produtos, kits (incl. `expansion-log`, `unlinked-components`, `items/{id}/link`, `import-file/analyze`, `import-file/execute`), box-algorithm, sellers (incl. `without-unit`, `assign-unit`, `merge-orders-into`), unidades, usuários, experience-file |
| `/billing` | `routers/billing.py` | **Faturamento reescrito (31/08/2026).** `seller-params`/`seller-box-prices` (manager+, sem portão), `/billing/my/...` (Portal do seller, sem portão). Os outros 11 — `box-prices`, `closing/{seller}/{YYYY-MM}` (GET/PUT rascunho, `close`, `reopen`, `pdf`, `excel`), `consolidated/{YYYY-MM}` (+ `excel`, `pdfs.zip`) — exigem **admin + Acesso Protegido ao Financeiro liberado** (02/09/2026, ver `billing_access`). `apply-forward` **removido**. Cálculo em `services/billing_calc.py`, documentos em `services/billing_docs.py`. **Não mexe em estoque.** |
| `/billing/access` | `routers/billing_access.py` | **Acesso Protegido ao Financeiro (02/09/2026), admin.** `request` (pede código de 6 dígitos por e-mail), `verify` (código de e-mail ou o mestre, libera 4h), `status`. E-mails em `services/billing_access_mail.py`. Tabela `billing_access_codes`; rate-limit e contador de erros derivados de `AuditLog` |
| `/devolucoes` | `routers/returns.py` | **Devoluções (02/09/2026), manager+.** `modelo` (Excel modelo em memória), `analyze` (confere a planilha, **não grava**), `lancar` (grava, **tudo-ou-nada**). Linha que retorna vira `StockMovement` de Entrada com a data do lançamento e **sem `order_id`**; linha que não retorna vira só `AuditLog` (`entity_type='Devolucao'`). Sem tabela nova |
| `/dashboard` | `routers/dashboard.py` | Cockpit master, portal seller, available-dates, debug |
| `/settings` | `routers/settings.py` | Configurações key/value, watcher start/stop/status |
| `/media` | StaticFiles | Fotos de produtos e arquivos de experiência (servidos diretamente) |
| `/exports` | StaticFiles | PDFs e CSVs para download |

---

## Frontend — Rotas e Acesso

| Rota | Página | Roles permitidos |
|------|--------|-----------------|
| `/login` | Login.tsx | Público |
| `/portal` | SellerPortal.tsx | client, admin |
| `/scan` | Scanner.tsx | admin, manager, operator |
| `/scan/:sessionId` | Scanner.tsx | admin, manager, operator |
| `/dashboard` | Dashboard.tsx | admin, manager, operator |
| `/orders` | Orders.tsx | admin, manager, operator |
| `/inventory` | Inventory.tsx | admin, manager, operator |
| `/products` | Products.tsx | admin, manager, operator |
| `/kits` | Kits.tsx | admin, manager, operator (operator só lê — botões escondidos) |
| `/kits/vincular` | KitFixes.tsx | admin, manager (sem item no menu — acessada pelo botão em Kits.tsx ou pelo aviso do Dashboard) |
| `/box-algorithm` | BoxAlgorithm.tsx | admin, manager, operator |
| `/users` | Users.tsx | admin, manager, operator |
| `/sellers` | Sellers.tsx | admin, manager, operator |
| `/sellers/corrigir` | SellerFixes.tsx | admin, manager (sem item no menu lateral — acessada pelo aviso do Dashboard ou botão em Sellers.tsx) |
| `/units` | Units.tsx | admin, manager, operator |
| `/devolucoes` | Returns.tsx | **admin, manager** (não aparece no menu reduzido do operador) |
| `/billing` | Billing.tsx | **admin** (reescrita de 31/08/2026 — some do menu para manager/operator). Desde 02/09/2026, mesmo admin cai numa tela-portão até liberar o Acesso Protegido ao Financeiro |
| `/audit` | Audit.tsx | admin, manager, operator |
| `/settings` | Settings.tsx | admin, manager, operator |
| `/manuseios` | Handling.tsx | admin, manager, operator |

**Nota:** A página `Handling.tsx` (kanban de manuseios) é a **interface principal dos operadores** no dia a dia.

### Autenticação no frontend
- Token JWT salvo em `localStorage` com chave `wms_token`
- Dados do usuário em `localStorage` com chave `wms_user`
- Interceptor Axios: injeta `Authorization: Bearer <token>` em todas as requests
- Em caso de 401: limpa localStorage e redireciona para `/login`
- URL da API: env `VITE_API_URL` (default: `http://localhost:8000`)

---

## Configurações do Sistema (AppSetting)

Configurações salvas no banco (tabela `app_settings`), editáveis via `/settings`:

| Chave | Default | Descrição |
|-------|---------|-----------|
| `inbox_folder` | `""` | Pasta monitorada pelo watcher para import automático |
| `processed_folder` | `""` | Pasta destino após processamento pelo watcher |
| `watcher_enabled` | `"false"` | Habilita watcher automático de pasta |
| `watcher_interval_sec` | `"30"` | Intervalo do watcher em segundos |
| `check_transportadora` | `"true"` | Checa se todos os pedidos têm transportadora |
| `check_nf_unicas` | `"true"` | Checa se chaves DANFE são únicas |
| `check_produtos_cadastrados` | `"true"` | Checa se todos os SKUs estão cadastrados |
| `auto_generate_pdfs` | `"true"` | Gera PDFs automaticamente após import |
| `pdf_base_folder` | `""` | Pasta raiz para salvar PDFs em modo local (SQLite). Padrão: `data/exports/pdfs` |
| `pdf_separation_folder` | `""` | Subpasta para PDFs de separação (dentro de `pdf_base_folder`) |
| `pdf_expedition_folder` | `""` | Subpasta para PDFs de expedição (dentro de `pdf_base_folder`) |

---

## Dados Gerados em Runtime

Todos em `data/` (não versionados no git):

| Pasta | Conteúdo | Limpeza |
|-------|----------|---------|
| `data/wms_kiwkiw.db` | Banco SQLite (só em dev local) | — |
| `data/uploads/` | Excels importados, nomeados `YYYYMMDD_nome.xlsx` | Rotina mensal/anual |
| `data/exports/` | PDFs de separação/expedição e CSVs por sessão | Rotina mensal/anual |
| `data/audit/` | CSVs de bipagem: `data/audit/<seller>/<YYYYMMDD>/bipagem.csv` | Rotina mensal/anual |
| `data/media/products/` | Fotos: `product_{id}.{ext}` | Manual |
| `data/media/experience/` | Arquivos PPT/PDF de roteiro de unboxing por seller: `seller_{id}.{ext}` | Manual |

---

## Folder Watcher (Robô de Pasta)

- Implementado em `backend/services/folder_watcher.py`
- Roda em **background thread** (`daemon=True`)
- Monitora `inbox_folder` a cada `watcher_interval_sec` segundos
- Ao encontrar `.xlsx`/`.xls`: importa via `import_orders_from_excel_sync()` → move para `processed_folder`
- **Sempre move o arquivo** independente de sucesso ou erro
- Estado global: `_thread`, `_stop_event`, `_last_check`, `_files_processed`, `_last_files`
- **Status atual: ainda não em produção** — a ser testado futuramente
- Controlado via `/settings/watcher/start` e `/settings/watcher/stop`

---

## PDF Generator

Os PDFs são gerados com **ReportLab** seguindo identidade visual da Kiwkiw:
- **Roxo principal:** `#7B63E8`
- **Verde-água:** `#3DD9A4`
- **Fundo escuro:** `#14122A`

⚠️ **Sessão de ENTRADA não tem esses PDFs (24/08/2026).** Separação é picking list e Expedição é
romaneio por transportadora — nenhum dos dois descreve uma entrada. Os dois endpoints recusam com
400, o import não gera, o modal de upload esconde os checkboxes e o histórico esconde os botões.
Detecção por `_session_is_entrada()` em `orders.py`, que olha o `file_type` da **sessão** (e não do
pedido, como faz `scanning.py`) porque o documento descreve o upload inteiro.

**Geração híbrida (local vs. produção):**

| Ambiente | Detecção | Comportamento |
|----------|----------|---------------|
| Local (SQLite) | `DATABASE_URL` não começa com `postgresql`/`postgres` | PDFs salvos em disco (`data/exports/pdfs/`) via `generate_pdfs_for_session()` |
| Produção (Railway/PostgreSQL) | `DATABASE_URL` começa com `postgresql` ou `postgres` | PDFs gerados em memória, enviados direto como download, **sem disco** |

- Endpoints on-demand: `GET /orders/sessions/{id}/pdf/separation` e `GET /orders/sessions/{id}/pdf/expedition`
- Funções: `generate_separation_bytes()` / `generate_expedition_bytes()` (on-demand, qualquer ambiente) e `generate_pdfs_for_session()` (salva no disco local)
- Ao gerar (qualquer modo), marcam `session.check_separation = True` / `session.check_planning = True` no banco
- Em modo local, também preenche `session.separation_pdf` e `session.expedition_pdf` com o caminho do arquivo
- O dashboard checa `bool(sess.separation_pdf or sess.check_separation)` — compatível com ambos os modos
- Botões de PDF no histórico ficam destacados (verde) quando o PDF foi gerado; acinzentados caso contrário

**Nomes das funções vs. conteúdo dos relatórios (corrigido em 06/08/2026):**

Até 06/08/2026, os nomes das funções internas (`generate_expedition_report` / `generate_separation_report`) estavam **invertidos** em relação ao conteúdo que geravam — herança de uma correção de nomenclatura feita na sessão de 17/06/2026 que só ajustou o nome do arquivo, não o nome da função. Isso também fazia os endpoints on-demand (`generate_separation_bytes`/`generate_expedition_bytes`) devolverem o PDF com o nome de arquivo trocado (conteúdo certo, `filename` do download errado), e os botões do histórico no Dashboard mostravam o rótulo oposto ao papel real do botão. Corrigido de ponta a ponta: nome da função, nome do arquivo dos endpoints on-demand e rótulo dos botões agora batem entre si.

| Função interna | Arquivo gerado | Conteúdo |
|---|---|---|
| `generate_separation_report` | `SEPARACAO_...pdf` | Lista de picking consolidada por seller → SKU (colunas: Seller \| Cód SKU \| Qtd \| Nome Produto) |
| `generate_expedition_report` | `EXPEDICAO_...pdf` | Detalhe por NF/cliente/transportadora + romaneio por transportadora |

**Nome do arquivo gerado:**
```
SEPARACAO_YYYYMMDD_<Unidade>_<SELLER1>_<SELLER2>_<session_id>.pdf  ← picking list por SKU
EXPEDICAO_YYYYMMDD_<Unidade>_<SELLER1>_<SELLER2>_<session_id>.pdf  ← detalhe NF + romaneio
```
A unidade vem de `seller.unit.name` (ou `SEM_UNIDADE` se seller sem unidade associada).

**Fluxo no frontend (Dashboard.tsx):**
1. Admin importa Excel → import conclui → frontend baixa automaticamente Separação, depois Expedição
2. Se desmarcado o checkbox no modal, não baixa automaticamente mas o botão no histórico sempre funciona
3. Botões "Separação" / "Expedição" chamam `ordersApi.downloadSessionPdf(id, type)` (regenera na hora via endpoint on-demand)
4. Se o download falhar, o toast mostra a mensagem real vinda de `err.response.data.detail` (não um texto genérico) — corrigido em 27/07/2026 justamente para diagnosticar o bug abaixo

**⚠️ Bug corrigido (27/07/2026) — PDF quebrava com seller de muitos SKUs:**
Em `generate_separation_report` (a função que gera o `SEPARACAO_...pdf`, picking list — nome trocado em 06/08/2026, era `generate_expedition_report` na época deste fix), a coluna Seller usava `SPAN` vertical mesclando todas as linhas de SKU daquele seller numa única célula. O ReportLab não consegue paginar uma tabela no meio de uma célula mesclada — quando um seller tinha ~60+ SKUs distintos na mesma sessão, a geração quebrava com um erro 500 confuso (`'>' not supported between instances of 'NoneType' and 'int'`, um bug interno do ReportLab ao tentar formatar a mensagem de erro real de "não cabe na página"). Corrigido removendo o `SPAN`: o nome do seller agora repete em cada linha em vez de mesclar. **Não reintroduzir esse `SPAN` na coluna Seller** — reproduz o mesmo travamento em qualquer sessão com seller concentrado.

**CSV de auditoria** continua sendo salvo em `data/exports/` (temporário, para rastreio interno).

---

## Como Rodar Localmente

### Backend
```powershell
cd "WMS Kiwkiw/backend"
python -m venv venv
venv\Scripts\Activate.ps1   # PowerShell
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Swagger disponível em: http://localhost:8000/docs

### Frontend
```powershell
cd "WMS Kiwkiw/frontend"
npm install
# Criar frontend/.env com:
# VITE_API_URL=http://localhost:8000
npm run dev
```

Acesse: http://localhost:5173

---

## Variáveis de Ambiente

### Backend
| Variável | Usado para |
|----------|-----------|
| `DATABASE_URL` | URL do banco (padrão: SQLite local). Prefixo `postgres://` é corrigido para `postgresql://` no código. ⚠️ **Em produção TEM que usar a rede interna do Railway** (`...railway.internal:5432`). Apontar para o proxy público (`*.proxy.rlwy.net`, porta alta) custa ~150ms POR CONSULTA e foi a causa da lentidão crônica até 27/08/2026 — ver a seção "A lentidão crônica NÃO era código". |
| `ALLOWED_ORIGINS` | CORS (separados por vírgula; `*` = todos) |
| `SECRET_KEY` | Assina o JWT (12h). **Em produção (Postgres) o app recusa subir sem ela** (03/09/2026) — sem valor fixo no código, repositório é público. Trocar desloga todo mundo |
| `WMS_EDIT_PASSPHRASE` | Senha para edição de movimentações de estoque (admin only). **Em produção o app recusa subir sem ela** (03/09/2026, mesmo motivo do `SECRET_KEY`) |
| `WMS_BILLING_APPROVERS` | Acesso Protegido ao Financeiro (02/09/2026) — e-mails dos responsáveis que recebem o código de 6 dígitos e os alertas, separados por vírgula |
| `WMS_BILLING_MASTER_CODE` | Código-mestre de emergência do Acesso ao Financeiro (frase longa, 20+ chars). **Opcional** — vazio = sem backup, mas o app sobe normal e o fluxo por e-mail funciona |
| `WMS_GMAIL_CLIENT_ID` / `WMS_GMAIL_CLIENT_SECRET` | Credenciais OAuth2 (Google Cloud Console, credencial "App para computador") usadas pra enviar o código do Acesso ao Financeiro **via API do Gmail, não SMTP nem Resend** (ver "E-mail: 3ª tentativa" em "Mudanças Recentes") |
| `WMS_GMAIL_REFRESH_TOKEN` | Token de longa duração gerado **uma vez, manualmente** (fluxo OAuth2 "installed app", fora do repositório) — não expira sozinho. **Faltando qualquer uma das 3 `WMS_GMAIL_*` = modo console** — não envia, só imprime no log (teste local) |
| `WMS_MAIL_FROM` | Cabeçalho `From:` completo, ex. `"WMS Kiwkiw <felipecspinheiro88@gmail.com>"`. O endereço **tem que ser exatamente o da conta que autorizou** (Gmail recusa remetente diferente); só o nome de exibição pode variar |

### Frontend
| Variável | Usado para |
|----------|-----------|
| `VITE_API_URL` | URL base do backend (default: `http://localhost:8000`) |

---

## Backup do Banco de Produção (Postgres/Railway) — configurado em 10/08/2026

Backup manual do Postgres de produção já existia desde 24/07/2026 (script `backup_wms.ps1`, ver
memória `rotina-backup-postgres-railway`), mas **nunca tinha sido agendado** — só rodava quando
alguém lembrava. Em 10/08/2026 foi criada a tarefa agendada no Windows, mais um segundo PC como
cópia redundante e um aviso de falha.

**Tudo isso fica fora do repositório, de propósito** (`D:\KiwKiw\backups_bd\`), para o commit
continuar limpo e permitir rollback. Nada aqui é código do WMS — é infraestrutura de operação na
máquina do usuário.

### Máquina principal (a do usuário)
- Tarefa do Agendador do Windows: **`WMS Kiwkiw - Backup Postgres`** — diária às 12:00, logon
  interativo (sem senha do Windows guardada), `-WindowStyle Hidden` (roda sem abrir janela),
  `StartWhenAvailable` (se o PC estiver desligado às 12h, roda assim que ligar), permitida na
  bateria, limite de execução de 1h.
- `backup_wms.ps1` decide o que falta (não "que dia é hoje") e mantém rotação avô-pai-filho:
  `diario\` (5), `semanal\` (4), `mensal\` (12).
- `backup_config.ps1` guarda `WMS_DB_URL` (URL pública do Railway, com senha) — **nunca colar essa
  URL no chat nem commitar**.

### Segundo PC (redundância física)
- Kit portátil em `D:\KiwKiw\backups_bd\kit_outro_pc\` (e `kit_outro_pc.zip` para envio), com:
  - `backup_wms.ps1` — mesma lógica, mas **autodetecta o `pg_dump.exe`** (tenta o PATH, senão varre
    `Program Files\PostgreSQL\*\bin` pegando a versão mais recente) em vez do caminho fixo da
    versão 18 usado na máquina principal. Necessário porque a outra máquina pode ter uma versão
    diferente do PostgreSQL instalada.
  - `instalar_tarefa.ps1` — cria a mesma tarefa agendada (12:00) na máquina de destino, sem exigir
    que a pessoa mexa no Agendador manualmente.
  - `LEIA-ME.txt` — passo a passo em português para quem for instalar.
- ⚠️ **Decisão consciente do usuário (10/08/2026):** o kit usa a **mesma credencial de produção**
  (leitura e escrita), não um usuário `wms_backup` só-leitura dedicado — que foi a alternativa
  sugerida e recusada. Revogar o acesso dessa segunda máquina no futuro exige trocar a senha do
  Postgres da aplicação inteira, não só a de um usuário isolado.

### Aviso de falha (as duas máquinas)
- Sucesso continua **silencioso** (só uma linha em `backup_log.txt`) — de propósito, é rotina
  diária.
- Falha agora dispara uma **notificação nativa do Windows** (balão via
  `System.Windows.Forms.NotifyIcon`, sem instalar nada) com o motivo. Dispara em dois casos:
  `pg_dump` retornou erro, ou (só no kit portátil) `pg_dump.exe` não foi encontrado na máquina.
- Antes disso, uma falha só aparecia numa linha `ERRO` no log que ninguém olhava — já tinha
  acontecido uma vez em 24/07/2026 sem ninguém perceber na hora.

---

## Dependências Principais do Backend

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy==2.0.30
python-jose[cryptography]==3.3.0   ← JWT
passlib[bcrypt]==1.7.4             ← hash de senha
openpyxl==3.1.2                    ← leitura/escrita Excel
reportlab==4.2.0                   ← geração de PDF
pandas>=2.2.3
pydantic[email]==2.7.1
psycopg2-binary>=2.9.9             ← PostgreSQL
```

**Nota:** Existe um fix de compatibilidade no `auth.py` para `passlib 1.7.4 + bcrypt 4.x` — não remover o bloco `if not hasattr(_bcrypt, '__about__')`.

---

## Padrões e Convenções do Código

### Backend
- Soft-delete em tudo: `active=False` — **nunca deleta fisicamente** produtos, sellers ou usuários
- `AuditLog` criado para toda ação relevante (CREATE, UPDATE, DELETE, IMPORT, etc.)
- SQL raw com `text()` usado em partes específicas para tolerar valores legados `IN`/`OUT` no campo `movement_type`
- Enum `MovementType` aceita `"Entrada"` e `"Saída"` — valores legados normalizados via `_MT_NORMALIZE`/`_MT_NORM`
- Dependencies FastAPI: `require_admin`, `require_manager_or_above`, `require_internal`, `require_authenticated`
- `require_admin = require_roles("admin")`
- `require_manager_or_above = require_min_role("manager")` — aceita manager e admin
- `require_internal = require_min_role("operator")` — exclui client

### Frontend
- Cliente HTTP centralizado em `src/api.ts` (instância Axios)
- Proteção de rotas via `ProtectedRoute.tsx` com `allowedRoles`
- Permissões granulares via `src/hooks/usePermissions.ts`
- **`downloadAuthenticatedFile(url, fallbackFilename)`** — helper em `api.ts` para downloads que exigem Bearer token. `window.open()` não envia o header Authorization e causa 401. Esta função usa axios (que tem o interceptor), recebe o blob e dispara download via anchor programático
- **Datas "hoje"** — usar sempre `todayBrasiliaStr()` de `src/timezone.ts`. Nunca `new Date().toISOString().slice(0, 10)` (usa UTC) nem `format(new Date(), 'yyyy-MM-dd')` (usa fuso local do sistema — inconsistente em produção)

### Seletor de Unidade Ativa (admin/manager)
- Preferência salva no `localStorage` com chave `wms_active_unit_<user.id>`
- Inicializada com `user.unit_id` do token se não houver preferência salva
- Presente em: **Dashboard** e **Manuseios (Handling)**
- Operador NÃO vê o seletor — está sempre fixo na sua unidade
- Admin tem opção "Todas" (envia `unit_id=undefined` para a API)
- Manager não tem opção "Todas" — vê sempre uma unidade específica
- A mesma chave de localStorage é compartilhada entre Dashboard e Manuseios (mudança em um reflete no outro na próxima carga)

### Sellers por Unidade no Formulário de Usuário
- O `SellerMultiSelect` em `Users.tsx` filtra sellers por `s.unit_id === unitId` da unidade selecionada no form
- Sellers selecionados de outras unidades são **mantidos no array** mas ficam ocultos ao trocar de unidade
- O botão "Selecionar todos desta unidade" marca/desmarca apenas os sellers visíveis (da unidade atual), sem afetar os de outras unidades
- Ao trocar de unidade no form, `seller_ids` **não é limpo** — sellers antigos permanecem selecionados invisíveis

---

## 🌐 A lentidão crônica NÃO era código — era a rota até o banco (27/08/2026)

**Leia esta seção ANTES de abrir qualquer investigação de performance.** Meses de trabalho
(índices, fim de N+1, `/perf`) atacaram o código, que já estava rápido. O gargalo real sempre
esteve na **configuração de rede entre a aplicação e o banco**.

**O que estava errado:** a variável `DATABASE_URL` do serviço `web` no Railway apontava para o
**proxy público** (`<host>.proxy.rlwy.net:<porta>`) em vez da **rede interna**. Cada consulta saía
para a internet e voltava, custando **~150ms por ida-e-volta** — contra ~0,1ms com o banco na
mesma rede.

**A fórmula que explicava tudo:** `tempo da tela ≈ (nº de consultas) × 150ms`

| Tela | consultas | produção (antes) | por consulta |
|---|---:|---:|---:|
| bipagem (`scan-logs`) | 2 | rápido, ninguém reclamava | — |
| `sessions/{id}/orders` | 7 | 3.217 – 29.105ms | — |
| `GET /cadastros/users` | 33 | 4.624 – 5.578ms | **140–169ms** |
| `GET /dashboard/master` | 38 | 5.490 – 7.618ms | **144–200ms** |

Dois endpoints sem nenhuma relação entre si davam a **mesma** latência por consulta. Foi essa
constante que denunciou rede, não código.

**Como foi provado (reprodução, não hipótese):** dump de produção restaurado em Postgres local +
backend real com 1 worker. Isolados, os mesmos endpoints levavam **26ms, 30ms e 266ms**.
Injetando artificialmente 150ms por consulta no ambiente local, os números de produção foram
**reproduzidos exatamente** (users 5.056ms, dashboard 6.029ms).

**A correção:** no serviço `web` -> *Variables* -> `DATABASE_URL`, montada por referências:

```
postgresql://${{Postgres.PGUSER}}:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
```

Nomes reais no Railway: aplicação = **`web`**, banco = **`Postgres`**, projeto
`pretty-rejoicing`, ambiente `production`. **Nenhuma linha de código mudou.**

⚠️ **O `DATABASE_URL` do serviço `Postgres` está VAZIO** (`<empty string>`) — foi por isso que a
configuração original recorreu ao endereço público. Por isso a URL é **montada peça a peça** em vez
de referenciar `${{Postgres.DATABASE_URL}}`. Não preencher a variável do serviço do banco.

⚠️ **Usar `5432` fixo, NUNCA `PGPORT`** — em alguns projetos ele guarda a porta do proxy público
(`18963`), que é exatamente o que se quer evitar.

⚠️ **O backup diário NÃO pode ser alterado** — roda da máquina do usuário, de FORA do Railway, e
precisa continuar usando o endereço público. `D:\KiwKiw\backups_bd\backup_config.ps1` guarda essa
mesma URL pública, o que serve de cópia do valor de rollback.

**Testado localmente ANTES de aplicar:** se o endereço interno não resolver no arranque, o app
**não trava** — falha em 15s com `could not translate host name` + `Application startup failed.
Exiting.` (código 3), e o Railway reinicia (`restartPolicyMaxRetries=3`). O deploy real subiu em
**2 segundos**, com `Backfill kit_items.product_id` e `Application startup complete.` — prova de
conexão, já que a migração do arranque exige banco.

**RESULTADO CONFIRMADO EM PRODUÇÃO** (log de 24h cruzando o deploy das 12:06 BRT de 27/08/2026):

| | antes (18,7h) | depois (5,3h) |
|---|---:|---:|
| `GET /dashboard/master` lentas | **14** de 96 chamadas (todas 5.888–6.803ms) | **0** de 397 chamadas |
| `POST /orders/import` lentas | **6** de 17 (até **37.178ms**) | **0** de 2 |
| `POST /scanning/scan` lentas | 2 de 801 | 1 de 704 (6.942ms, caso isolado) |
| tráfego total | 5.354 req (286/h) | 4.940 req (**932/h**) |

O sistema passou a aguentar **3,3× mais tráfego por hora** e parou de ficar lento. O Dashboard
saltou de 5,1 para 74,9 chamadas/hora — sinal de que as pessoas voltaram a usar a tela.

⚠️ **Ficou 1 caso isolado** de `POST /scanning/scan` em 6.942ms, 7 min após o deploy, sem reinício
de container por perto. 1 em 704 — não é padrão, mas se virar recorrência, investigar.

### Hipótese que estava ERRADA — não repetir

Cheguei a suspeitar de `_saida_only()` em `dashboard.py` (adicionada em 24/08/2026) por causa do
`OR ... IS NULL`. **Medido: o Dashboard leva 266ms local com dado real, sempre 38 consultas, e é
plano de 328 a 1.068 pedidos/dia.** A otimização de 02/08/2026 continua intacta. Não perder tempo
aí de novo.

### Triagem para a próxima vez que alguém disser "está lento"

1. O endpoint é lento **em produção** mas rápido **local**? -> suspeite de infraestrutura, não código
2. Divida o tempo de produção pelo **número de consultas** do endpoint
3. Se der um valor **constante entre endpoints diferentes** -> é latência de rede por consulta
4. Confira se o `DATABASE_URL` usa a rede interna **antes** de abrir o código

⚠️ **`/perf` é cego para esta classe de problema** — ele roda tudo local, onde o banco está na
mesma máquina. Ver a nota em `.claude/commands/perf.md`.

### Ficou sem explicação (não inventar causa)

Dois pontos não foram reproduzidos e **continuam em aberto**: os picos de **11–29s** em
`GET /scanning/sessions/{id}/orders` (o modelo prevê 1,1s) e um **padrão decrescente monotônico**
ao longo de 77 min (29.105ms -> 15.593ms; a sessão 323 fez o mesmo em 39 min).

⚠️ **Não dá para declarar resolvidos.** No log de 24h que validou a correção, esses picos
**não apareceram nem antes nem depois** do deploy — ou seja, o período não exercitou o cenário.
Se voltarem a aparecer, é sinal de que têm causa própria, independente da rede.

---

## ⚡ Performance — implementado em 30/07/2026

**Status: os 5 blocos do plano foram implementados e medidos.** Diagnóstico original, script de
ambiente de teste e passo a passo em **`D:\KiwKiw\plano_performance\PLANO_PERFORMANCE.md`**
(fora do repositório, de propósito — o commit tem que ficar limpo para permitir rollback).

### Sintoma que motivou o trabalho
Cliente relatava **~20 segundos de espera em qualquer ação**. Piorou depois da carga real de 24/07/2026.

### O que foi feito (tudo num commit só, para permitir `git revert`)

| Bloco | Onde | O quê |
|---|---|---|
| 1A | `main.py` → `PERF_INDEXES` + `run_light_migrations` | 4 índices: `stock_movements(order_id)`, `stock_movements(seller_id,sku)`, `scanning_logs(order_id)`, `scanning_logs(session_id)` |
| 2A | `orders.py`, `order_import.py`, `inventory.py`, `products.py` | `async def` → `def` nos 6 endpoints de import/upload; saiu o `aiofiles` do uso e o `asyncio.new_event_loop()` do wrapper do watcher |
| 2B | `order_import.py`, `kit_handler.py` | caches `_kits_of` / `_products_of` por seller: milhares de queries → 2 por seller |
| 3A/3B | `database.py` | `pool_size=10`, `max_overflow=20`, `pool_recycle=1800` (**só quando não for SQLite**) |

### Resultados medidos (banco scratch com dump real: 632.660 movimentos / 112 MB)

| Query | Antes | Depois |
|---|---|---|
| Anti-duplicata da bipagem (`stock_manager.py`) | 66–72 ms, `Parallel Seq Scan` | **0,02 ms**, `Index Only Scan` |
| `get_stock_report` (tela de Estoque) | 68,2 ms | **1,36 ms** |
| `get_sku_history` (popup de SKU) | 64,6 ms | **0,094 ms** |

Import de 960 linhas: **2.410 → 492 queries** (−80%), 1,76 s → 0,79 s, com resultado gravado idêntico.

**Travamento da API durante o import** (Uvicorn real, 1 worker, arquivo de 400 pedidos): antes, uma
chamada a `/health` esperava **5,76 s** na fila; depois, **0,41 s** — praticamente a latência ociosa.

Criação dos 4 índices no startup: **~1,4 s** sobre as 632k linhas. É esse o tempo de lock de gravação
em `stock_movements` no boot do deploy — preferir deployar fora do horário de operação.

### Regras que continuam valendo aqui
- Endpoint que faz I/O de banco/arquivo de forma síncrona tem que ser `def`, **nunca** `async def`
  (ver a armadilha correspondente na tabela de erros comuns).
- Índice novo → `run_light_migrations`, na lista `index_migrations`, que é aplicada num laço
  **com `print` em texto puro**. Emoji em migração derruba o startup em console Windows cp1252.
- Query nova em `stock_movements` que não use `order_id` nem o par `(seller_id, sku)` volta a ser
  Seq Scan de 630k linhas — conferir com `EXPLAIN ANALYZE` antes de subir.
- ⚠️ **A lista `PERF_INDEXES` cresceu desde então** — os "4 índices" acima são o registro do que foi
  feito em 30/07/2026, não o estado atual. Entraram depois `stock_movements(seller_id,movement_date)`
  (14/08), `order_items(order_id)` (01/08) e `scanning_logs(timestamp)` (31/08). **Conferir a lista no
  `main.py`, não esta seção.** Cada índice novo soma tempo de lock no primeiro boot do deploy.

### Ambiente de teste
- PostgreSQL 18 **local** funcionando; senha do `postgres` foi **resetada em 30/07/2026**
  (a original estava perdida) e está em `D:\KiwKiw\backups_bd\local_pg_config.ps1`
- Banco scratch: `wms_teste_indices` — montado por
  `D:\KiwKiw\plano_performance\montar_ambiente_teste.ps1` (dump fresco de produção → restore local → medições)
- Medições em `baseline_queries.sql` — rodar antes e depois e comparar `Seq Scan` → `Index Scan`
- ⚠️ O dump em `backups_bd\diario\wms_kiwkiw_2026-07-24.dump` (259 KB) é **anterior à carga real** — não serve

### Achados da bateria de testes (30/07/2026)

**Corrigido em seguida, no commit `096982c2`:** `GET /scanning/productivity` devolvia 500 desde o
commit inicial (`func.cast` recebendo um `QueryableAttribute` como tipo) — o painel "Produtividade por
Operador" da tela de Auditoria nunca havia aparecido, por falha silenciosa do react-query. Ver a
seção "Produtividade por operador" abaixo.

**Corrigido no commit `520a8e18`:** FK inexistente no payload virava 500 em **9 endpoints** (a
bateria só pegou 4 porque eram os que estavam na matriz de permissões). Ver a seção "Validação de FK"
abaixo.

**Pendente, NÃO corrigido:** `POST /inventory/movements/manual` não tem **nenhuma checagem de
escopo** — qualquer manager pode lançar movimentação de estoque de qualquer seller, não só dos que
atende. Diferente do resto do sistema, que usa `get_user_seller_ids`.

---

## Performance — N+1 na bipagem corrigido e app inteiro testado (01-02/08/2026)

**Sintoma relatado:** operadores reclamando de travamento no sistema, principalmente na bipagem.
Diagnóstico feito lendo o próprio Postgres de **produção** (só leitura, via `pg_stat_user_tables` e
`pg_stat_database`) — banco saudável (0 deadlock, cache 100%, conexões sobrando), então o problema
não era o banco não aguentar: era volume de consultas.

### Causa raiz e correção — commit `0dab80ab` (publicado em produção)

A tela de pedidos da sessão (`GET /scanning/sessions/{id}/orders`, usada pelo Scanner) fazia
**1 consulta por pedido + 1 consulta por item de cada pedido** pra montar a contagem de bipados —
numa sessão grande (~926 itens), até ~1.300 consultas por carregamento. Piorava porque o Scanner
recarregava a lista **inteira** a cada bipe e tinha polling automático a cada 15s, multiplicado por
operador com a tela aberta. Confirmado no Postgres: `scanning_logs` varrida 4,1 milhões de vezes,
lendo 10,8 bilhões de linhas, numa tabela de 8 mil linhas.

Arquivos alterados (4, sem mudar nada que o usuário vê):
- `backend/routers/scanning.py` — `get_session_orders` e `_build_progress` viraram consultas
  agrupadas (`GROUP BY`) em vez de 1-por-item. Também adicionado aviso (não bloqueia) quando a
  mesma NF já está sendo bipada por outro operador — furo que passava em silêncio antes.
- `backend/routers/orders.py` — mesmo fix em `get_order`.
- `backend/main.py` — novo índice `ix_order_items_order_id` em `PERF_INDEXES` (**lembrar de manter
  `order_items` nas duas listas de checagem de índice existente**, Postgres e SQLite — senão o
  `CREATE INDEX` roda a cada boot, mesma armadilha do índice de `stock_movements`).
- `frontend/src/pages/Scanner.tsx` — para de recarregar a lista inteira a cada bipe (usa o
  `order_progress` que `/scan` já devolve); polling do Scanner passou de 15s→60s e **pausa
  totalmente enquanto há NF aberta**; scan-logs de 5s→30s. Banner + toast quando outro operador já
  está bipando a mesma NF.

### Ferramental de teste de carga reaproveitável

Fora do repositório, em `D:\KiwKiw\plano_performance\stress_bipagem\` (não confundir com
`D:\KiwKiw\plano_performance\` da bateria de 30/07 — pastas irmãs, propósitos diferentes):
- `simulador.py` — simula operadores reais via HTTP+JWT (login, abre NF, bipa item a item, ~4% de
  erro proposital), respeitando a trava por seller. Aceita `--versao antes|depois` (usa
  `git worktree` pra rodar o código de um commit anterior sem mexer na pasta de trabalho),
  `--pace realista|max`, `--cap-min` (teto de segurança pra rodada sem pausa).
  ⚠️ **Nas funções `poller_*`, sempre passar `headers=` pro `chamar()`** — já apareceu 2x nesta
  sessão o bug de esquecer o header e receber 403 em silêncio nos pollers.
- `simulador_completo.py` — expande pra TODOS os papéis (10 operadores + N admins + N clientes)
  rodando **simultâneo**, cobrindo as 17 telas do menu. Gera Excel de import sintético com
  `openpyxl` usando seller/SKU reais do banco (evita cair no fluxo de seller não reconhecido).
- `preparar_cenario.sql` / `preparar_cenario_completo.sql` — reseta só os pedidos de sexta-feira
  pra `PENDING` (apaga `scanning_logs`/`stock_movements` dessa data) e cria usuários de teste
  descartáveis (`stress_*@teste.local`, senha `StressTest_2026!`, hash gerado com o mesmo
  `pwd_context` de `auth.py`). ⚠️ Se uma rodada anterior já rodou import/PDF com esses usuários,
  o `DELETE FROM users` falha por FK em `audit_logs`/`picking_sessions.created_by_id` — o script já
  limpa isso primeiro, mas se copiar o padrão pra outro cenário, lembrar da ordem.
- Convenção confirmada nos dois testes: `role` (`userrole`), `status` (`orderstatus`) e `file_type`
  (`filetype`) gravam o **nome maiúsculo** do enum Python no Postgres (`OPERATOR`, `PENDING`,
  `EXPORT`), não o `.value` minúsculo — mesma armadilha já documentada pra `movement_type`.
- Bancos descartáveis (`wms_stress_*`) e o `git worktree` temporário são sempre apagados/removidos
  ao final de cada rodada — não ficam para trás.

### Resultado do teste 1 — só bipagem, sexta-feira, antes/depois

10 operadores simulados, ritmo realista e máximo, comparando o código de antes com o commit
`0dab80ab`. Resultado: `sessions/{id}/orders` caiu de p95=504,7ms (532 chamadas) pra p95=106,5ms
(52 chamadas) — 10× menos chamadas e mais rápido. No estresse máximo, esse endpoint **nunca disparou**
no código corrigido (a pausa de polling com NF aberta elimina a chamada quase toda vez). Confirmado
também no Postgres: `order_items` caiu de +35,2 milhões de linhas lidas em varredura pra +162 mil
(217×) nos 45 minutos da rodada. 0 deadlock/conflito nas 4 rodadas — a lentidão nunca foi de
concorrência travando linha, sempre foi volume de consulta.

### Resultado do teste 2 — app inteiro, todos os papéis simultâneos (achados NOVOS, ainda não corrigidos)

Ampliando pra 10 operadores + 4 admins (Dashboard/Auditoria/Faturamento/Estoque/Cadastros/Config) +
3 clientes (Portal) + import de Excel + PDFs, tudo rodando ao mesmo tempo, achou **o mesmo padrão de
N+1 em dois lugares nunca antes testados** — maiores que o que já foi corrigido:

| Onde | Achado | Causa raiz |
|---|---|---|
| ~~`GET /billing/export`~~ | ~~p50 = 14,5s~~ | **RESOLVIDO por remoção em 31/08/2026** — o endpoint e o `_get_box()` deixaram de existir na reescrita do Faturamento. Não recriar. |
| `GET /dashboard/master` | p95 = **3,77s**, p99 = 4,61s (crítico) | `backend/routers/dashboard.py:379-402`, checagem "Produtos cadastrados" (uma das P6/P8/P10/P12). `orders_today` não usa `joinedload` → `order.items` faz lazy-load por pedido, e o laço interno faz 1 consulta em `products` por item. Só sexta = ~2.100 consultas por carregamento do Dashboard. Menor, mesmo padrão, em `sessions_today_list` (linha ~439, 1 consulta por sessão) e no acesso a `order.seller` sem eager-load (linhas 371 e 394) |

Confirmado com `EXPLAIN ANALYZE`: **não é falta de índice** — o índice `uq_seller_sku` em
`products(seller_id, sku)` já existe e cada consulta individual leva 0,066ms. É puro volume, mesmo
diagnóstico da bipagem. `order_items` chegou a 224.851 varreduras completas (1,8 bilhão de linhas
lidas) nessa rodada — 50× mais que na rodada só de bipagem.

**Efeito colateral medido:** com essas duas telas lentas rodando junto, a bipagem (já corrigida)
ficou de 2× a 7× mais lenta na cauda (p99/máx) só por dividir o mesmo servidor — nenhum endpoint da
bipagem cruzou o limiar de "lento" (1s), mas a degradação é real e mensurável. Prova concreta de que
uma tela ineficiente prejudica as outras, mesmo sem relação direta de código.

**Decisão do dono do sistema (02/08/2026):** `billing/export` é usado poucas vezes por mês — pode
esperar. `dashboard/master` é aberto várias vezes ao dia por admin — **prioridade**. A checagem em si
é intencionalmente "ao vivo" (produto pode ser cadastrado a qualquer momento) — o problema é *como*
pergunta, não *que* pergunta; não faz sentido mover isso pra outra tela.

### Correção do `dashboard/master` — feita e validada sob carga (02/08/2026)

Corrigido **só em `backend/routers/dashboard.py`**, dentro de `master_dashboard`. Nada de frontend,
nenhuma migração, nenhum índice novo, resposta da API idêntica campo a campo.

| O que era | O que virou |
|---|---|
| `orders_today = db.query(Order).filter(*base_filter).all()` servindo de base pra dois laços | **deixou de existir** — era a raiz dos lazy-loads |
| Checagem "Transportadora" varrendo os pedidos em Python (`not o.carrier`) | 1 `COUNT` com a **mesma semântica** (`NULL` **ou** string vazia) + `SELECT` com `joinedload(seller)` e `limit(30)` **só se houver faltante** |
| Checagem "Produtos cadastrados": 1 lazy-load de `order.items` por pedido + 1 `SELECT products` por item (**2.150 consultas**) | **2 consultas agrupadas** — pares `(seller_id, sku)` distintos via `JOIN order_items` + `GROUP BY`, e os produtos ativos desses pares com 2 `IN` de listas literais (usa `uq_seller_sku`, Bitmap Index Scan) |
| `sessions_today_list`: 1 consulta por sessão listada | 1 consulta agrupada pra todas as sessões (**mantido sem filtrar `Seller.active`**, igual era) |
| Operadores: carregava **todos** os `ScanningLog` do dia e contava em Python (45,6ms no pico) | 1 `COUNT(DISTINCT order_id)` agrupado por operador, com o filtro de status no banco |

⚠️ **`seller_name` da lista de SKUs faltando vem de `sellers_rows`** (já consultado logo acima, no
bloco "Sellers com pedidos") — não reintroduzir uma consulta de seller ali. A lista saiu ordenada por
`(seller_id, sku)` e o nome do produto usa `MIN(product_name)`, ambos pra ficar determinístico
(decisão consciente: antes vinha na ordem de varredura dos pedidos).

**Medido por instrumentação (atribuindo cada consulta à linha que a originou), dia de 644 pedidos:**
**2.217 → 36 consultas** por carregamento, **3.031ms → 172ms**, SQL de 1.079ms → 83,9ms. Detalhe:
"Checagens do Dia" 2.156 → 8, "Produtividade" 25 → 3, "Uploads do Dia" 13 → 2.

**Validado no teste de carga do app inteiro** (mesma receita do teste 2, 45 min, 5.851 chamadas,
**0 falhas** contra 2 da rodada anterior):

| | Antes | Depois | |
|---|---|---|---|
| `dashboard/master` p50 | 1.653,4ms | **95,8ms** | 17,3× |
| `dashboard/master` p95 | 3.765,3ms | **173,2ms** | 21,7× |
| `dashboard/master` p99/máx | 4.613,7ms | **211,1ms** | 21,9× |
| `order_items` varreduras completas | 224.846 | **32** | 7.026× |
| `order_items` linhas lidas | 1.825.746.478 | **260.128** | 7.019× |
| peso no tempo total do servidor | 125,7s (13,3%) | **7,1s (1,0%)** | saiu do top 10 |

**Efeitos colaterais medidos (nenhum endpoint regrediu):** `dashboard/seller` p50 494,7 → 219,8ms
(2×, **sem tocar no código dele** — só parou de dividir servidor com o Dashboard pesado);
`open-by-nfe` p95 67,6 → 32,4ms; `scanning/scan` p95 96,9 → 89,9ms.

**Sobre a bipagem — o agregado engana:** a melhora dela parece pequena (−7% no p95) porque a média
inclui os momentos em que `billing/export` roda. Separando as janelas: **fora** delas p95 = **69,9ms**,
que é praticamente o isolado (63,4ms, sem nenhuma outra tela competindo); **dentro** delas p95 = 162ms.
`billing/export` trava o worker por **268s dos 2.725s** da rodada (9,8% do tempo) e responde por
**39,6% de todo o tempo de servidor** com só 19 execuções — é hoje o único gargalo restante do sistema
e o que ainda segura a bipagem acima do isolado.

**Integridade conferida ao final da rodada:** 645/651 pedidos concluídos, **0** movimentos de estoque
duplicados criados pela rodada, **0** pedidos concluídos sem baixa de estoque, 0 deadlocks. (Os 5
"duplicados" que aparecem numa varredura ingênua são do pedido 2102, de 29/07, e **já vêm assim no
dump de produção** — não são da rodada.)

### Como repetir essa medição — `/perf` (02/08/2026)

A bateria virou um procedimento repetível. **O protocolo, o histórico de todas as rodadas e as
armadilhas conhecidas estão em `PERFORMANCE_TESTES.md`, na raiz** — arquivo **não versionado** (está
no `.gitignore`, junto de `performance_historico.json` e `performance_relatorios/`). O comando
`/perf` (`.claude/commands/perf.md`, esse sim versionado) dispara tudo.

**Antes de mexer em qualquer coisa de performance, leia esse arquivo** — ele diz o que já foi
medido, o que já está corrigido e o que continua em aberto, evitando refazer diagnóstico.

Uma rodada leva ~1h e faz sozinha: restaura banco descartável do backup mais recente, escolhe o dia
mais movimentado dos últimos 7 dias, sobe backend local com o código atual (inclusive alterações não
commitadas), smoke test (aborta se falhar), carga de 45 min com 17 usuários simultâneos, coleta
latências + contadores do Postgres + integridade, compara com a rodada anterior e gera PDF. Orquestra
`D:\KiwKiw\plano_performance\stress_bipagem\perf_runner.py`.

⚠️ **O alerta de regressão tem filtro de ruído de propósito** (mín. 20 chamadas, p95 ≥ 50ms, delta
≥ 25ms além dos 20%). Sem ele o relatório acusava "regressão" num endpoint chamado 1× que foi de 84ms
para 107ms. Não afrouxar esses limites sem entender isso.

---

## Validação de FK nos cadastros (30/07/2026)

Quando o payload traz um `seller_id`/`unit_id` que não existe, o endpoint tem que devolver **404 com
mensagem**, nunca deixar o `IntegrityError` virar 500. Helpers em `products.py`, logo abaixo das
constantes do módulo:

| Helper | Uso |
|---|---|
| `_assert_seller_exists(db, seller_id)` | `None` passa (campo opcional) |
| `_assert_unit_exists(db, unit_id)` | `None` passa (campo opcional) |
| `_assert_sellers_exist(db, seller_ids)` | lista M2M do usuário; 404 listando quais ids faltam |

`billing.py` e `inventory.py` têm um caso cada e checam inline.

- **Nenhuma filtra `active`** de propósito: referenciar seller/unidade **desativada continua
  permitido**, como sempre foi. Só se verifica que a entidade existe. Não "corrigir" isso sem
  conversar — há fluxos de reativação de seller e de kit que dependem disso.
- `_sync_sellers` resolve o vínculo por `Seller.id.in_(...)`, que **descarta id inexistente em
  silêncio**. Por isso o `_assert_sellers_exist` roda **antes** — sem ele, o admin salva achando que
  vinculou o seller e não vinculou.
- Endpoint novo que receba FK no corpo: chamar o helper correspondente logo no início, antes de
  qualquer `db.add`.

---

## Produtividade por operador (`GET /scanning/productivity`)

Alimenta o painel "Produtividade por Operador" da tela de **Auditoria** (`Audit.tsx`). A tabela tem
três colunas: Operador, Total Bipagens, Total Itens.

- **Conta apenas bipagem real:** filtra `is_error == False` **e** `is_interrupted == False`, mais os
  marcadores `PAUSE`/`RESUME` (`MARKER_SKUS`). O marcador de interrupção é um `ScanningLog` com
  `sku='INTERRUPT'` e `quantity=0` — não é bipagem. Mesmo par de filtros do `process_scan`.
- **`date_to` usa `end_of_day`** — a tela abre com `date_from = date_to = hoje`; sem isso a tabela
  viria vazia todo dia.
- **Escopo:** `require_manager_or_above`. Manager vê só operadores da **própria unidade**
  (`User.unit_id`); admin vê todas. Todos os usuários ativos em produção têm `unit_id` preenchido.
- **Desde 31/08/2026 respeita os MESMOS filtros da lista de bipagens** (`seller_id`, `carrier`,
  `operator_id`, `search`), via `_audit_base_query`. **Antes ignorava até o filtro de Operador que já
  existia na tela** — selecionar um operador listava todos assim mesmo.
- ⚠️ **Não montar os filtros aqui à mão.** Lista, KPIs, produtividade e CSV têm que enxergar o mesmo
  recorte; duplicar a montagem faz um deles divergir na primeira alteração. Usar `_audit_base_query`.
- ⚠️ O parâmetro `unit_id` da query **é aceito e ignorado** — o frontend não envia. Decisão de
  30/07/2026 foi não mexer nisso ainda.

---

## Erros Comuns e Como Evitá-los

| Situação | Armadilha | Como evitar |
|----------|-----------|-------------|
| Filtrar pedidos por unidade | Usar `Order.unit_id` (pode estar desatualizado) | Usar `Seller.unit_id` → filtrar sellers da unidade |
| Dashboard de datas | Usar `Order.order_date` (data da NF) | Usar `Order.imported_at` (data de upload) |
| Migração do banco | Usar Alembic ou migrations destrutivas | Usar o padrão idempotente em `run_light_migrations()` em `main.py` |
| Criar `datetime` no backend | Usar `datetime.now()`, `date.today()`, ou `func.now()` | Usar `now_brasilia()` / `today_brasilia()` de `timezone_utils.py` — Railway roda em UTC |
| Data "de hoje" no frontend | Usar `new Date().toISOString().slice(0, 10)` | Usar `todayBrasiliaStr()` de `timezone.ts` — ISO usa UTC, retorna data errada após 21h |
| Query de auditoria/estoque por data | `timestamp <= date_to` com `00:00:00` | Usar `end_of_day(date_to)` = `23:59:59.999999` para incluir registros do dia todo |
| Download de CSV com Bearer token | Usar `window.open(url)` (não envia token) | Usar `downloadAuthenticatedFile(url, filename)` em `api.ts` (blob via axios com interceptor) |
| Serializar enums no JSON | Retornar enum object direto | Sempre usar `.value` (ex: `status.value if hasattr(status, 'value') else status`) |
| Movimento de estoque duplicado | Chamar a baixa duas vezes para a mesma NF | `apply_stock_for_orders()` pula quem já tem `stock_applied_at` — não zerar esse campo na mão |
| `INSERT` de `stock_movements` via SQL puro | Gravar `mt.value` (`"Entrada"`) — o Postgres recusa com `InvalidTextRepresentation` e aborta a transação | Gravar `mt.name` (`"IN"`/`"OUT"`). SQLite aceita os dois, então o teste local não detecta |
| `StockPosition` duplicada / `UNIQUE (seller_id, sku)` violada | Chamar `update_stock_position()` em laço: a sessão usa `autoflush=False`, a posição recém-criada não aparece na query seguinte e uma segunda é criada | A função já faz `db.flush()` após criar — não remover |
| Importar produtos com seller inativo homônimo | `bulk_upload_products` carrega **todos** os sellers (inclusive inativos) no cache e o último sobrescreve o anterior — produtos vão para o registro errado ou são pulados em silêncio | Ao desativar um seller duplicado, **renomear** `name` e `trade_name` (sufixo `(DUPLICADO)`); desativar não basta |
| Data da movimentação no import de histórico | Usar a coluna B (Log) direto: ela só vem preenchida na primeira linha de cada bloco | Aplicar forward-fill do Log; a coluna D é a data da NF do seller e vai para `nf_date` |
| Validar comportamento de banco em teste | Testar só com SQLite, que é permissivo com enums e tipos | Para enum, tamanho de coluna e constraint, validar contra PostgreSQL ou por inspeção do schema |
| Reativar usuário | Endpoint retornava dict cru (sem schema) ou não existia | Endpoint `POST /cadastros/users/{user_id}/reactivate` retorna `UserResponse` via `_user_to_response()` |
| Email duplicado ao criar usuário | A query de verificação não filtrava por `active` | A query `filter(email == user.email).first()` já retorna inativos — bloqueia corretamente |
| `SellerResponse.is_active` sempre `True` | Campo era `is_active: bool = True` estático | Deve ser `@computed_field` que lê `self.active` do banco |
| Portal do seller exibe pedidos cancelados | Sem filtro de status `cancelled` | Backend: `status != CANCELLED` na query; frontend: omite `'cancelled'` nas opções de filtro |
| Campo SKU em Kits | `k.sku` / `k.name` podem retornar `undefined` dependendo da versão | Usar `k.kit_sku ?? k.sku` e `k.kit_name ?? k.name` para compatibilidade |
| Scanner perde foco ao clicar na tela | Input desfoca e operator precisa clicar manualmente | `handleScanInputBlur` com 100ms timeout recoloca foco se `activeElement === document.body` |
| Scanner perde foco após scan do leitor USB | `disabled={scanning}` remove o foco do DOM; a chamada `.focus()` no `finally` falha porque o React ainda não re-renderizou | `useEffect(() => { if (!scanning) inputRef.current?.focus(); }, [scanning])` — dispara após o re-render quando o input já está habilitado |
| Scanner perde foco ao fechar modal de produto | Modal tem `autoFocus` que rouba o foco; fechar não devolve automaticamente | `setTimeout(() => inputRef.current?.focus(), 50)` nos handlers de ✕, Cancelar e após salvar com sucesso |
| Operator sem acesso a criar/atualizar produto no scanner | `create_product` e `update_product` exigiam `require_manager_or_above` | Alterados para `require_internal` — operadores podem usar o modal inline do Scanner |
| `box_type` ignorado ao salvar produto no modal (modo view) | `handleSaveProductInline` não enviava `box_type` no modo `view`, apenas no `create` | Adicionado `box_type: productForm.box_type \|\| undefined` ao payload do `updateProduct` |
| Kits retornam lista vazia mesmo após criar | `list_kits` fazia lazy-load de `Kit.items` e `Kit.seller` sem `joinedload`, causando falha silenciosa na serialização | Usar sempre `joinedload(models.Kit.items)` e `joinedload(models.Kit.seller)` na query de kits; retornar dict manual em vez de depender do Pydantic ORM mode |
| Kit retorna erro "já cadastrado" para SKU que nunca existiu | `create_kit` verificava existência sem filtrar `active=True`, bloqueando criação quando havia um kit inativo com o mesmo SKU | Adicionar `models.Kit.active == True` ao filtro de verificação de duplicata |
| Upload de arquivo de experiência silenciosamente ignorado | `handleSave` em Sellers.tsx apenas limpava `expFile` sem chamar a API | Chamar `cadastrosApi.uploadExperienceFile(sellerId, file)` explicitamente após salvar o seller |
| `Promise.all` em paste de sellers cancela tudo num erro | Um seller inválido interrompia os demais | Usar `Promise.allSettled` e contar fulfilled/rejected separadamente |
| Foto quebrada ao editar produto | Segundo modal duplicado usava `src={photoPreview}` direto em vez de `photoSrc(photoPreview)` | Havia dois blocos JSX idênticos em Products.tsx — o segundo foi removido; sempre usar `photoSrc()` para converter URL relativa em absoluta |
| `force_password_change` não persiste no localStorage após login | `Login.tsx` não salvava o campo `force_password_change` da resposta do token em `wms_user` | Adicionar `force_password_change: !!(res as any).force_password_change` ao objeto salvo em `wms_user` |
| Modal de troca de senha não aparece para o role `client` | `client` não tem acesso a `/settings`; troca voluntária de senha não estava disponível | Adicionar botão "Alterar senha" na sidebar do `SellerPortal.tsx`; o modal bloqueante de senha temporária em `App.tsx` funciona para todos os roles |
| PDF de separação (picking list) quebra (500) com seller de muitos SKUs | `SPAN` vertical mesclando a coluna Seller em todas as linhas do seller — ReportLab não pagina no meio de célula mesclada | Não usar `SPAN` vertical na coluna Seller de tabelas que podem crescer muito; repetir o valor por linha (ver `generate_separation_report` em `pdf_generator.py`, renomeada em 06/08/2026) |
| Import cria seller duplicado (nome não bate com nenhum cadastro) | `get_or_create_seller` criava silenciosamente, sem unidade, sem avisar ninguém | Import agora pausa (`requires_confirmation` + `unmatched_sellers`) e exige decisão explícita (criar com unidade, ou vincular a existente) — nunca mais cria sozinho |
| Seller aparece em "sem unidade" mas a tela de Sellers mostra ele com unidade | São dois `Seller.id` diferentes (duplicado homônimo), não um bug de exibição | Conferir por `seller_id`, não só pelo nome; usar `/sellers/corrigir` pra migrar os pedidos presos no duplicado |
| Query nova de pedido (lista, card, KPI) | Seller inativo volta a vazar: **não existe filtro global**, cada query repete o recorte | Aplicar `Seller.active == True` **junto** do `status != CANCELLED`, como em `list_orders`, `get_session_orders`, `session_cards` e no `base_filter` do `/dashboard/master` |
| Tela nova que lista sellers | Chamar `cadastrosApi.sellers()` já traz só ativos (padrão invertido em 30/07/2026) — o erro é passar `false` "pra garantir" | Só `Sellers.tsx` e `Billing.tsx` usam `sellers(false)`, e com chave de cache hierárquica (`['sellers','all']` / `['sellers','billing']`) para não vazar a lista completa pela chave `'sellers'` |
| Editar o SKU de um kit "salvava" sem salvar | `update_kit` só aplicava `kit_name` e itens; `kit_sku`/`seller_id` eram descartados em silêncio | Hoje devolve 400 e a tela desabilita os campos na edição — não reintroduzir a aceitação silenciosa |
| Recriar um kit que foi excluído | Checar duplicata com `active == True` passa na validação e viola a `UniqueConstraint (seller_id, kit_sku)` → 500 | Buscar sem filtrar `active`: ativo → 400; inativo → reativar o registro existente |
| Rota estática depois de rota com parâmetro | `GET /kits/expansion-log` chegou a devolver 405 porque casava com `PUT/DELETE /kits/{kit_id}` | Declarar rotas estáticas **antes** das parametrizadas no mesmo prefixo |
| Migração que roda em toda inicialização | `CREATE INDEX IF NOT EXISTS` fora do `if` fazia o `print("✅ Migração aplicada")` rodar sempre; no console Windows (cp1252) o emoji estoura `UnicodeEncodeError` e **derruba o startup do backend** | Condicionar a instrução à existência real do objeto (`PRAGMA index_list` / `pg_indexes`), não à da coluna |
| ⚠️ **Pré-existente, não corrigido:** `print` com emoji nas migrações | O laço antigo (`migrations`) ainda imprime `✅`, e o `except` imprime `⚠️` — em console Windows cp1252 isso estoura `UnicodeEncodeError` e derruba o startup (no Railway/Linux não afeta) | Migração nova vai na lista `index_migrations`, cujo laço imprime em **texto puro** (`[migracao] ...`). Se precisar usar o laço antigo, rodar com `PYTHONIOENCODING=utf-8` |
| ⚠️ **Pré-existente, não corrigido:** usuário sem seller vinculado | `get_user_seller_ids` devolve `None` (convenção "None = admin"), então um manager sem nenhum seller associado **vê tudo**. Vale para todo endpoint que usa esse dependency, incluindo `scanning.py` | Garantir que manager/operator sempre tenham sellers associados no cadastro |
| ⚠️ **Pré-existente, não corrigido:** SKU repetido vira 2 itens no pedido | A soma de SKUs repetidos ocorre **antes** da expansão, sobre os SKUs crus. Um componente de kit que coincide com uma linha avulsa do mesmo SKU gera dois `order_items` (ex.: 4 do kit + 5 avulso, não 9) | Comportamento antigo e conhecido; o operador vê o mesmo SKU duas vezes na bipagem |
| Endpoint pesado declarado `async def` | O FastAPI roda `async def` **no event loop**, não em threadpool. Com 1 worker Uvicorn, qualquer trabalho síncrono longo (Excel, laço de queries) **trava o sistema inteiro** — bipagem, dashboard e login param | Endpoint que faz I/O de banco/arquivo de forma síncrona deve ser `def` (sem `async`). Só use `async def` se realmente houver `await` de I/O assíncrono |
| Query nova em `stock_movements` ou `scanning_logs` | `stock_movements` tem 630k+ linhas. Desde 30/07/2026 existem índices para `order_id` e `(seller_id, sku)` — **qualquer filtro fora desses volta a ser Seq Scan da tabela toda** | Conferir com `EXPLAIN ANALYZE` antes de subir; se faltar índice, acrescentar em `PERF_INDEXES` (`main.py`), que já é idempotente nos dois bancos |
| Deduzir "esta NF baixou estoque?" pelo status | Desde 06/08/2026 a baixa é na importação: NF `PENDING` já pode estar baixada, e NF `COMPLETED` pode nunca ter baixado. Na entrada (24/08/2026) é ainda mais solto: `SCANNING` com contagem cheia continua sem estoque até o Finalizar | Usar `order_has_stock_applied(order, db)` / `Order.stock_applied_at` — **nunca** `status in (COMPLETED, INTERRUPTED)` |
| Reintroduzir baixa de estoque na bipagem da **saída** | `process_scan`/`interrupt`/`force-complete` já baixaram até 06/08/2026; recolocar a chamada dobra a baixa | Na SAÍDA a baixa é no import e ponto. Na ENTRADA é o contrário: só o `finalize-entry` lança — ver `services/stock_manager.py` |
| Fazer NF de **entrada** auto-concluir no último bipe | Fechar no 100% tira do operador o direito de continuar contando (pedido `completed` recusa scan) e a sobra da caixa seguinte fica fora do estoque | Entrada conclui **só** pelo botão Finalizar. A guarda está em `process_scan` (`if is_entrada: return` antes do bloco de `remaining == 0`) |
| Chamar `apply_scan_overage()` de novo no `process_scan` | Desde 24/08/2026 a contagem inteira (com a sobra) entra no Finalizar — lançar nos dois lugares **duplica a sobra** | A função existe só para os movimentos gravados entre 17/08 e 24/08 continuarem reconhecidos pelo bloqueio de troca de `file_type` |
| Usar corte por DATA para separar a era da entrada | Errar a data para trás faz a NF importada na manhã do deploy entrar **duas vezes** | Quem decide é `stock_applied_at`: vazio = lança; preenchido = só conclui. Não depende do horário do deploy |
| Deixar `interrupt` funcionar em NF de entrada | `INTERRUPTED` não reabre e conta como feito → a mercadoria fica fora do estoque para sempre, em silêncio | `interrupt_order` recusa entrada com 400. Usar **Pausar** (`POST /orders/{id}/pause`) |
| Marcador `PAUSE`/`RESUME` entrando em contagem | Eles passam nos filtros de "bipagem real" (`is_error=False`, `is_interrupted=False`) e inflam produtividade e painéis | Excluir por `MARKER_SKUS` — já feito em `_active_scan_filters`, produtividade e scans recentes do Dashboard |
| Filtrar entrada com `Order.file_type != IMPORT` puro | A coluna é **NULLABLE**: o `!=` devolve NULL nessas linhas e elas somem do resultado em silêncio | `or_(file_type.is_(None), file_type != IMPORT)` — ver `_saida_only()` em `dashboard.py` |
| KPI/bloco que monta o próprio filtro em Python | Não passa pelo `base_filter`, então o recorte de saída **não é aplicado** — foi assim que "Em Bipagem" contou conferência de entrada num painel zerado | Repetir o recorte à mão (`units_summary`, laço do "Em Bipagem") |
| Guardar a resposta do axios direto no estado | O cliente de `api.ts` devolve a **resposta**, não o corpo — `res.lines` fica `undefined` e o `.map` quebra a tela inteira do operador | Usar `res.data`. Bug real, pego só na conferência visual: os 97 testes de API passavam |
| Contar progresso do pedido pelo total (soma esperada − soma bipada) | Desde que a entrada aceita excedente, sobra de um SKU compensa falta de outro e a NF fecha com item nunca conferido | Contar **SKU a SKU** (`_count_remaining`/`_count_remaining_after_scan`), consolidando SKU repetido em dois `OrderItem` |
| Calcular excedente com `matched_item.quantity` | Em NF com o mesmo SKU em dois itens (kit + linha avulsa), o esperado real é a soma — usar o item casado lança estoque fantasma | Usar `expected_sku_total` (soma dos itens daquele SKU) |
| Tratar excedente nos fluxos de estorno | `reverse_stock_for_order()` trabalha por saldo líquido do `order_id` e o movimento de excedente nasce com esse mesmo `order_id` — já é recolhido | Não escrever tratamento especial em cancel-duplicate/cancel-handling/deactivate |
| Mudar o texto de `OVERAGE_TAG` | É por esse prefixo em `observation` que `order_has_scan_overage()` reconhece o excedente e bloqueia a troca de `file_type` | Não alterar sem migrar os registros existentes |
| Decidir sinal do movimento pela natureza da NF | O `NATURE_TYPE_MAP` **não** decide mais sinal — quem decide é o `file_type` do arquivo | `order_stock_sign(order)`. Trocar `file_type` de NF já baixada exige estornar e re-lançar |
| `SELECT` em `stock_movements` comparando `movement_type` com string | Em produção é enum nativo: `movement_type IN ('Entrada')` estoura `InvalidTextRepresentation` e **aborta a transação**. SQLite aceita | `CAST(movement_type AS TEXT) IN ('IN','Entrada')` — funciona nos dois bancos |
| Ler `order.items` logo após criar os itens no import | Itens são criados com `order_id` (não pela relationship) e a sessão é `autoflush=False` → a lista vem **vazia** e nada baixa, em silêncio | `db.flush()` e recarregar com `joinedload(Order.items)` antes de usar |
| Consultar produto/kit dentro de laço no import | Era N+1: 1 query de kit + 1 de produto **por item** do arquivo (2.410 queries num arquivo de 960 linhas) | Já resolvido pelos caches `_kits_of` / `_products_of` em `import_excel_orders`. Ao mexer no laço de persistência, **continuar passando `kits_by_sku`** para `process_order_items` — sem ele a função volta a consultar item a item (fallback mantido de propósito) |
| Tela nova que itera `for order in orders: for item in order.items: db.query(...)` | Mesmo N+1 achado nesta base: `scanning.py`, `dashboard.py` e o antigo `billing.py` **já resolvidos** (o último por remoção em 31/08/2026) — cada consulta individual é rápida, mas centenas/milhares delas por carregamento derrubam a tela e disputam conexão com o resto do sistema | Sempre `joinedload` a relação antes do laço (`order.items`, `order.seller`), e trocar a consulta por item por **1 consulta agrupada** fora do laço. O faturamento novo usa `joinedload(Order.items)` em `billing_calc.list_month_orders` e a tabela global de caixas em memória — **não voltar a consultar produto por item** |
| Query nova em `orders` filtrando por `(seller_id, imported_at)` | Desde 31/08/2026 existe `ix_orders_seller_imported`; a IN-list de checagem de índice em `run_light_migrations` ganhou `'orders'` nos dois ramos. Filtro fora dessa forma volta a ser Seq Scan | Conferir com `EXPLAIN ANALYZE` contra dado real; índice novo entra em `PERF_INDEXES` (`main.py`) |
| Reintroduzir `billing_configs` / `Seller.preco_unitario` no faturamento | A reescrita de 31/08/2026 abandonou os dois — só `billing_seller_params` e `billing_monthly_closings` valem | Aba Comercial e topo do Faturamento gravam em `billing_seller_params` (default) / snapshot do closing (mês). `billing_configs` fica morto para rollback |
| Deduzir a fatura de um mês fechado recalculando ao vivo | Mês `closed` tem snapshot em `billing_closing_lines` + cache dos 8 totais; recalcular ignoraria o congelamento e mudaria a fatura se um `order` fosse cancelado depois | `billing_calc.read_frozen()` para `closed`; `compute_live()` só para `open`. Reabrir apaga o snapshot |
| Limitar uma listagem com `limit(N)` fixo depois de um filtro de data | O `limit` corta as linhas mais antigas **sem avisar ninguém**: a tela mostra um total menor que a realidade e ninguém desconfia. Foi assim que Manuseios mostrou 3.210 de 14.303 pedidos em agosto | Se há filtro de período, o período já limita o volume — o teto só faz sentido **sem** filtro. Se precisar mesmo de teto com filtro, a tela tem que **dizer** que truncou |
| Comparar `Order.status` com string escrita à mão | `"in_progress"` não existe no `OrderStatus` (o certo é `"scanning"`), e a comparação simplesmente nunca casa — contagem sempre 0, sem erro nenhum | Usar `models.OrderStatus.SCANNING.value`, ou conferir a lista de valores do enum antes. Um `==` com literal errado falha em silêncio |
| `const { data: x = [] } = useQuery(...)` usado como dependência de `useEffect` | O default na desestruturação cria um array NOVO a cada render → o efeito re-dispara → `setState` re-renderiza → laço infinito enquanto a resposta não chega | Depender do `data` cru (estável no react-query) e tratar o `undefined` dentro do efeito: `useEffect(() => { if (data) setX(data) }, [data])` |
| Investigar "o sistema está lento" abrindo o código direto | Até 27/08/2026 a lentidão crônica NÃO era código: o `DATABASE_URL` apontava para o proxy público do Railway e cada consulta custava ~150ms. Meses de otimização de código foram gastos num gargalo que estava na configuração de rede | **Primeiro** conferir se o endpoint é lento em produção mas rápido local, e dividir o tempo de produção pelo nº de consultas. Valor constante entre endpoints diferentes = latência de rede, não código |
| Confiar no `/perf` para diagnosticar lentidão de produção | A bateria roda **tudo local**, com o banco na mesma máquina — é estruturalmente cega para latência de rede entre app e banco. Ela diria "está tudo ótimo" com o sistema travando em produção | `/perf` mede **código**. Para lentidão relatada em produção, checar infraestrutura primeiro (ver `.claude/commands/perf.md`) |
| Montar a URL do banco com `PGPORT` | Em alguns projetos Railway o `PGPORT` guarda a porta do **proxy público** (ex: `18963`) — usar isso reintroduz exatamente o problema | Usar **`5432` fixo** com `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` |
| Alterar o `backup_config.ps1` para a rede interna | O backup roda da máquina do usuário, de **fora** do Railway — a rede interna não existe de lá e o backup pararia em silêncio | Backup **continua** com o endereço público. Só a variável do serviço `web` muda |
| Filtrar no navegador uma lista que é paginada/limitada pelo servidor | Só filtra a amostra já carregada: na Auditoria, escolher uma transportadora bipada de manhã devolvia **vazio** com o mês filtrado, dando a entender que ela não teve bipagem nenhuma | Filtro que precisa varrer o período vai para o **servidor**. Na trilha de bipagem, tudo passa por `_audit_base_query` — inclusive a busca |
| KPI contado sobre as linhas da tela em lista paginada | Exibe o tamanho da página (100), não o total do período — e o número mente sem ninguém perceber | Totais vêm do banco na mesma query filtrada (`total`, `total_ok`, `total_errors`) |
| Trocar filtro sem resetar a página | Quem está na página 7 e filtra algo com 2 páginas vê tela vazia e conclui que não há registro | `useEffect` que zera a página quando qualquer filtro muda (`ScanAuditTab`) |
| `ORDER BY` paginado sem desempate estável | Registros com o mesmo `timestamp` trocam de ordem entre páginas: uma linha aparece 2× e outra some | Sempre acrescentar `id` como último critério (`timestamp DESC, id DESC`) |
| Busca que vai ao servidor sem atraso | Uma requisição por tecla digitada | `useDebouncedValue(search, 500)` — 9 caracteres viram 1 requisição |
| Repetir o join de `users` em cima de `_audit_base_query` | A função já faz `outerjoin(User)` para a produtividade poder agrupar — um segundo join estoura "users especificada duas vezes" | Usar `.with_entities(...)` + `group_by`, sem novo join |
| Filtrar transportadora comparando a string crua | `Order.carrier` é texto livre: "motoboy" e "MOTOBOY" são a mesma empresa, e sobra espaço nas pontas | `func.lower(func.trim(...))` dos dois lados. Grafias distintas ("Correios" x o nome completo) continuam separadas de propósito |
| Assumir que a transportadora da bipagem é a do dia | Não existe histórico de `carrier`: preencher o campo depois move as bipagens antigas para a transportadora nova | Comportamento conhecido e aceito — não tentar deduzir a transportadora "da época" |
| Query nova em `scanning_logs` filtrando por data | Desde 31/08/2026 existe `ix_scanning_logs_timestamp`; **filtro fora de `order_id`/`session_id`/`timestamp` volta a ser Seq Scan** | Conferir com `EXPLAIN ANALYZE`; índice novo entra em `PERF_INDEXES` (`main.py`), idempotente nos dois bancos |
| Copiar o CSV da aba "Status das NFs" achando que a regra é a mesma | Lá tela e arquivo usam o **mesmo teto** de propósito (vai para o cliente). Na aba Bipagens é o **oposto**: a tela é a amostra e o CSV é o todo | Decidir pelo destino do arquivo. Sem teto, escrever em blocos (`yield_per`) para não materializar dezenas de milhares de linhas na memória |
| Apertar Deploy no Railway sem olhar o "Details" | As mudanças ficam em espera ("Apply N changes") e o Deploy aplica **tudo** da fila. Em 27/08/2026 havia um serviço `function-bun` (template Bun/Hono, nada a ver com o WMS) prestes a ser criado junto | Abrir *Details*, descartar individualmente o que não é seu, conferir que o rodapé lista só o serviço esperado |
| Movimento de estoque novo que cite uma NF de venda | Preencher o `order_id` "para ligar as pontas" faz `reverse_stock_for_order()` (que soma o **saldo líquido do `order_id`**) varrer esse movimento junto quando a NF for cancelada/inativada — o estoque some em silêncio | Movimento que **não é** da NF (devolução, ajuste) nasce **sem `order_id`**; o número da NF vai no `nf_number` e na observação, que é o que a tela e o Portal mostram |
| Painel flutuante (dropdown/autocomplete) dentro de tabela | Contêiner com `overflow-x-auto` **corta** qualquer painel absoluto, sem erro nenhum: os dados chegam do servidor e a lista simplesmente não aparece (aconteceu no seletor de SKU de Devoluções) | `createPortal` + `position: fixed` ancorado no campo, fechando ao rolar/redimensionar. Ver `SkuPicker` em [Returns.tsx](frontend/src/pages/Returns.tsx) |
| Endpoint novo que grava a partir de uma conferência na tela | Validar só no `analyze` e confiar que o `lancar` recebe o que foi conferido — a chamada pode ser forjada e aqui o erro vira **estoque errado** | As duas rotas passam pela **mesma** função de validação (`_validate_rows` em `returns.py`), e o gravador revalida sempre |
