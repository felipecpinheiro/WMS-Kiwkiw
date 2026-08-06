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

### Fluxo de um dia de trabalho (visão geral)
1. **Admin importa Excel** → `POST /orders/import` → cria `PickingSession` + `Orders` + `OrderItems`
   - **O estoque é baixado AQUI, NF a NF** (06/08/2026 — ver seção própria abaixo)
   - PDFs de separação e expedição gerados automaticamente após import
   - CSVs de auditoria gerados automaticamente
2. **Operadores veem os cards de manuseio** → `GET /scanning/session-cards` → página `Handling.tsx`
3. **Operador abre um pedido** → escaneia a chave DANFE da etiqueta → `POST /scanning/sessions/{id}/open-by-nfe`
4. **Operador bipa cada produto** → `POST /scanning/scan` → valida `barcode_seller`
5. **Pedido completo** → status vira `completed` → **estoque NÃO é tocado** (já baixou no passo 1)
6. **Admin acompanha** → Dashboard Master → checagens P6/P8/P10/P12

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

**Até 06/08/2026** o estoque era sensibilizado quando o pedido era **concluído na bipagem**. O seller
vendia segunda 20h, a Kiwkiw manuseava terça 17h, e o estoque dele ficava ~24h defasado — inviável de
acompanhar em escala. **Agora a baixa acontece no fim da IMPORTAÇÃO, NF a NF.**

**A bipagem não mexe mais em estoque.** Virou conferência e auditoria. Removidas as chamadas em
`process_scan`, `interrupt_order` e `force_complete_session` — **não reintroduzir**.

**Uma NF só baixa se estiver liberada.** Dois bloqueios, ambos por NF (não pela sessão):
1. **transportadora preenchida**
2. **todos os SKUs com produto ATIVO cadastrado** no seller

Sem isso ela fica pendente (`Order.stock_applied_at` vazio) e **baixa sozinha** quando a pendência for
resolvida — `PATCH /orders/{id}/carrier` e criar/reativar/renomear SKU de produto chamam
`release_pending_orders_for_sku()`. Não existe botão de "aplicar estoque": é sempre automático.

**Onde tudo isso mora:** `backend/services/stock_manager.py`, com um cabeçalho explicando a regra.

| Função | Papel |
|---|---|
| `apply_stock_for_orders(orders, db)` | baixa em lote (usada no import). Devolve `applied` / `pending` / `negatives` / `missing_skus` |
| `apply_stock_for_order(order, db)` | uma NF (destravamento) |
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

### Bipagem
- **Só `barcode_seller` é aceito** — o `barcode_kiwkiw` existe no modelo mas não é usado na bipagem
- **Lock por (sessão+seller):** só 1 pedido com atividade real por seller por sessão. Pedido em `SCANNING` sem nenhum `ScanningLog` real = "lock fantasma" → liberado automaticamente
- **INTERRUPTED = COMPLETED** para o kanban: pedido interrompido conta como "feito" no progresso. **Para estoque, nenhum dos dois faz nada** — a baixa acontece na importação desde 06/08/2026, e interromper não devolve estoque (divergência física se acerta na mão pela tela de Estoque)
- **Não volta de INTERRUPTED:** pedido interrompido não pode ser reaberto via bipagem normal

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

### BillingConfig e Sellers — fonte de verdade única
- A aba **Comercial** em Sellers está linkada ao `BillingConfig` (tabela `billing_configs`)
- Ao abrir edição de um seller, o frontend carrega `GET /billing/config/{seller_id}` e preenche os campos
- Ao salvar, o frontend chama `PUT /cadastros/sellers/{id}` (para `preco_unitario` e `manuseio` como colunas do Seller) E `POST /billing/config` (para todos os campos do BillingConfig)
- Chaves do BillingConfig usadas: `'Taxa Base'`, `'Preço Unitário'`, `'Franquia'`, `'Número Mínimo de Pedidos'`, `'Preço Adicional'`, `'Manuseio'`, `'Armazenagem'`, `'Armazenagem Incluso'`
- **Não duplicar** esses campos em outro formulário sem sincronizar com o BillingConfig

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
| `/orders` | `routers/orders.py` | Import Excel (**baixa o estoque**), listagem, config de pedido, transportadora (**destrava a baixa**), `pending-stock` (NFs que não baixaram) |
| `/scanning` | `routers/scanning.py` | Sessões, scan, open-by-nfe, interrupt, force-complete, cancel-handling (admin, **estorna desde 06/08/2026**), **cancel-duplicate-orders** (admin/manager, com reversão de estoque), deactivate/reactivate NF, audit log (inclui `seller_name`), session-cards, suggested-box. **Nenhum endpoint daqui baixa estoque — só estorna/re-lança** |
| `/inventory` | `routers/inventory.py` | Estoque, movimentações manuais, import de histórico (Excel), bulk import, histórico SKU, export CSV. **Sem botão na tela desde 24/07/2026:** `POST /inventory/movements/bulk` e `POST /inventory/bulk-stock-upload` continuam funcionando, mas foram retirados da interface por confundirem com o import de histórico — não recriar os botões sem combinar com o usuário |
| `/cadastros` | `routers/products.py` | Produtos, kits (incl. `expansion-log`, `unlinked-components`, `items/{id}/link`, `import-file/analyze`, `import-file/execute`), box-algorithm, sellers (incl. `without-unit`, `assign-unit`, `merge-orders-into`), unidades, usuários, experience-file |
| `/billing` | `routers/billing.py` | Config de cobrança, relatório, export Excel |
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
| `/billing` | Billing.tsx | admin, manager, operator |
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
| `DATABASE_URL` | URL do banco (padrão: SQLite local). Railway injeta PostgreSQL automaticamente. Prefixo `postgres://` é corrigido para `postgresql://` no código. |
| `ALLOWED_ORIGINS` | CORS (separados por vírgula; `*` = todos) |
| `WMS_EDIT_PASSPHRASE` | Senha para edição de movimentações de estoque (admin only) |

### Frontend
| Variável | Usado para |
|----------|-----------|
| `VITE_API_URL` | URL base do backend (default: `http://localhost:8000`) |

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
| `GET /billing/export` | p50 = **14,5s**, máx 16,1s (crítico) | `backend/routers/billing.py:193-213`, função `_get_box()` — 1 consulta em `products` por item + 1 em `box_algorithm` por pedido, sem filtro de seller/período curto no teste (semana inteira = 3.754 pedidos/8.120 itens = ~12 mil consultas numa chamada) |
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

- **Conta apenas bipagem real:** filtra `is_error == False` **e** `is_interrupted == False`. O
  marcador de interrupção é um `ScanningLog` com `sku='INTERRUPT'` e `quantity=0` — não é bipagem.
  Mesmo par de filtros usado pelo `process_scan` para contar progresso.
- **`date_to` usa `end_of_day`** — a tela abre com `date_from = date_to = hoje`; sem isso a tabela
  viria vazia todo dia.
- **Escopo:** `require_manager_or_above`. Manager vê só operadores da **própria unidade**
  (`User.unit_id`); admin vê todas. Todos os usuários ativos em produção têm `unit_id` preenchido.
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
| Deduzir "esta NF baixou estoque?" pelo status | Desde 06/08/2026 a baixa é na importação: NF `PENDING` já pode estar baixada, e NF `COMPLETED` pode nunca ter baixado | Usar `order_has_stock_applied(order, db)` / `Order.stock_applied_at` — **nunca** `status in (COMPLETED, INTERRUPTED)` |
| Reintroduzir baixa de estoque na bipagem | `process_scan`/`interrupt`/`force-complete` já baixaram até 06/08/2026; recolocar a chamada dobra a baixa | A bipagem é só conferência agora. A baixa é no import, ver `services/stock_manager.py` |
| Decidir sinal do movimento pela natureza da NF | O `NATURE_TYPE_MAP` **não** decide mais sinal — quem decide é o `file_type` do arquivo | `order_stock_sign(order)`. Trocar `file_type` de NF já baixada exige estornar e re-lançar |
| `SELECT` em `stock_movements` comparando `movement_type` com string | Em produção é enum nativo: `movement_type IN ('Entrada')` estoura `InvalidTextRepresentation` e **aborta a transação**. SQLite aceita | `CAST(movement_type AS TEXT) IN ('IN','Entrada')` — funciona nos dois bancos |
| Ler `order.items` logo após criar os itens no import | Itens são criados com `order_id` (não pela relationship) e a sessão é `autoflush=False` → a lista vem **vazia** e nada baixa, em silêncio | `db.flush()` e recarregar com `joinedload(Order.items)` antes de usar |
| Consultar produto/kit dentro de laço no import | Era N+1: 1 query de kit + 1 de produto **por item** do arquivo (2.410 queries num arquivo de 960 linhas) | Já resolvido pelos caches `_kits_of` / `_products_of` em `import_excel_orders`. Ao mexer no laço de persistência, **continuar passando `kits_by_sku`** para `process_order_items` — sem ele a função volta a consultar item a item (fallback mantido de propósito) |
| Tela nova que itera `for order in orders: for item in order.items: db.query(...)` | Mesmo N+1 achado 3× nesta base: `scanning.py` e `dashboard.py` **já corrigidos**, `billing.py:193-213` (`_get_box`) **ainda em aberto** — cada consulta individual é rápida, mas centenas/milhares delas por carregamento derrubam a tela e disputam conexão com o resto do sistema (01-02/08/2026, ver seção "Performance — N+1 na bipagem") | Sempre `joinedload` a relação antes do laço (`order.items`, `order.seller`), e trocar a consulta por item por **1 consulta agrupada** (`WHERE (seller_id, sku) IN (...)` ou `GROUP BY`) fora do laço — mesmo padrão já usado em `get_session_orders`/`_build_progress` e agora em `master_dashboard` |
