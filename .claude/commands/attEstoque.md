---
description: Atualiza o banco LOCAL com dump fresco de produção e deixa o app rodando em localhost:5173
---

Faça **tudo sozinho**, sem perguntar nada, nesta ordem. É operação de rotina — não se aplica
a regra de "fazer perguntas antes de alterar código": aqui nada de código do app muda, só se
atualiza o banco local e sobem os servidores de desenvolvimento.

## 1. Atualizar o banco local (dump de produção → `wms_kiwkiw_local`)

```
powershell -ExecutionPolicy Bypass -File "D:\KiwKiw\backups_bd\atualizar_local.ps1"
```

- Faz `pg_dump` de produção (Railway, **somente leitura**) → `.dump` datado em `D:\KiwKiw\backups_bd\`
- `DROP` + `CREATE` do banco `wms_kiwkiw_local` e `pg_restore` do dump nele
- Confere as contagens (`stock_movements`, `orders`, `sellers`, `products`) e o último `imported_at`
- Log em `D:\KiwKiw\backups_bd\atualizar_local_log.txt`; balão do Windows se falhar
- **Não toca** no backup diário automático das 12:00 (`diario\` / `semanal\` / `mensal\`)

Se o script sair com `ERRO:`, **pare** e mostre a linha de erro do log. Não siga para o passo 2.

## 2. Subir o backend apontado pro banco local

Use `preview_start` com a configuração **`backend-local`** do `.claude/launch.json`
(roda `backend/run_local_wms_kiwkiw_local.py`, que fixa
`DATABASE_URL=postgresql://postgres:***@localhost:5432/wms_kiwkiw_local`, porta 8000).

Confirme que subiu: `GET http://localhost:8000/health` → `{"status":"healthy"}`.

## 3. Subir o frontend (só se não estiver de pé)

Cheque a porta 5173. Se ninguém estiver escutando, use `preview_start` com a configuração
**`frontend`** (`npm --prefix frontend run dev`, porta 5173).

## 4. Conferir no navegador

- Abra `http://localhost:5173`
- Faça login como `admin@kiwkiw.com.br` / `kiwkiw2024`
- Abra o **Dashboard** e mais uma tela pesada de dados (**Sellers** ou **Estoque**)
- Confirme que carregam com os dados reais (nº de sellers, contagens de estoque)

## 5. Reportar

Tabela curta com: tamanho do dump + tempo, contagens do banco restaurado e o último `imported_at`,
status do backend (`/health`) e do frontend, e a confirmação visual das telas. Se algo falhou,
diga exatamente o quê.

Lembretes:
- O backend/frontend abertos por `preview_start` ficam presos a esta sessão. Para rodar por conta
  própria depois: `backend\venv\Scripts\python.exe backend\run_local_wms_kiwkiw_local.py` +
  `npm --prefix frontend run dev`.
- `-Dump <caminho>` no script do passo 1 reaproveita um `.dump` já baixado (não acessa produção).
