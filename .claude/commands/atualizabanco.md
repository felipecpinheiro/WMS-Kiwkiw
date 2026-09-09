---
description: Atualiza o banco LOCAL wms_teste_indices com um dump fresco de produção
---

Operação de rotina — faça **tudo sozinho, sem perguntar nada**. Nada de código do app muda,
só o banco local de teste é recriado. A regra de "fazer perguntas antes de alterar" não se
aplica aqui.

## 1. Baixar dump de produção e restaurar em `wms_teste_indices`

```
powershell -ExecutionPolicy Bypass -File "D:\KiwKiw\backups_bd\atualizar_local.ps1" -Banco wms_teste_indices
```

O script faz sozinho, sem tocar em produção (o `pg_dump` é somente leitura) nem no backup
diário automático das 12:00:

1. `pg_dump` de produção (Railway) → `.dump` datado com sufixo `_manual` em `D:\KiwKiw\backups_bd\`
2. `DROP` + `CREATE` do banco local `wms_teste_indices`
3. `pg_restore` do dump nele (`--no-owner --no-privileges`)
4. Confere as contagens (`stock_movements`, `orders`, `sellers`, `products`) e o último `imported_at`
5. Aborta com `ERRO:` se algo falhar ou se vierem menos de 100k movimentos (dump suspeito)

Log em `D:\KiwKiw\backups_bd\atualizar_local_log.txt`; balão do Windows se falhar.

Para **reaproveitar** um `.dump` já baixado (não acessa produção), acrescente `-Dump "<caminho>"` —
por exemplo o dump diário mais recente em `D:\KiwKiw\backups_bd\diario\`.

Se o script sair com `ERRO:`, **pare** e mostre a linha de erro do log.

## 2. Reportar

Tabela curta com: tamanho do dump + tempo de restore, contagens do banco restaurado
(`sellers`, `products`, `orders`, `stock_movements`) e o último `imported_at`.

Depois lembre o comando de subir o backend apontado pro banco local:

```
cd /d "D:\KiwKiw\WMS Kiwkiw"
set DATABASE_URL=postgresql://postgres:<senha-local>@localhost:5432/wms_teste_indices
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000 --reload --reload-dir backend
```

(a senha do Postgres local está em `D:\KiwKiw\backups_bd\local_pg_config.ps1`)
