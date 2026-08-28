---
description: Sobe o estoque dos sellers a partir das planilhas em D:\KiwKiw\Estoques (substitui o que existe hoje)
---

Suba o estoque dos sellers a partir das planilhas da pasta `D:\KiwKiw\Estoques`.

## ⚠️ LEIA ISTO ANTES DE RODAR QUALQUER COISA

Este comando **apaga o estoque atual do seller e substitui pelo da planilha**, direto no
**banco de PRODUÇÃO**. Não é simulação. Regras que não se negociam:

1. **Sempre rodar o modo conferência primeiro** e mostrar o resultado ao usuário.
2. **Nunca** usar `--sim` sem o usuário ter visto a conferência e concordado.
3. **Nunca** editar o script para pular o backup ou a verificação SKU a SKU.
4. Se o usuário pedir pressa, a resposta é rodar a conferência — ela é rápida e é o que
   evita subir a planilha errada no seller errado.

## O que a ferramenta faz

`D:\KiwKiw\ferramenta_estoques\subir_estoques.py` — fora do repositório de propósito.

Por seller, numa transação só: apaga `stock_movements` e `stock_positions` daquele seller,
cria os produtos que faltam, insere as linhas da planilha, recria as posições, **confere
SKU a SKU lendo de volta do banco** e só então dá COMMIT. Não bateu → ROLLBACK só daquele
seller, os outros seguem.

**Não toca em:** `orders`, `order_items`, `picking_sessions`, `scanning_logs`, `sellers`,
`users`, `user_sellers`, `units`, `kits`, `kit_items`, `billing_configs`, `box_algorithms`,
`app_settings`. Em especial **não toca em `Order.stock_applied_at`** — limpar essa coluna
faria o sistema rebaixar NF antiga sozinho (o bug do `STOCK_ERA_CUTOFF`, ver CLAUDE.md).

## Como rodar

**Passo 1 — conferência (não grava nada):**

```bash
cd "D:\KiwKiw\ferramenta_estoques" && "C:\Users\lipe-\AppData\Local\Programs\Python\Python312\python.exe" subir_estoques.py --conferir
```

Leva ~7 minutos (lê todas as planilhas). Gera log completo e um Excel de prévia.

**Passo 2 — mostrar ao usuário** o que a conferência achou, em especial:
- planilhas que não casaram com nenhum seller
- avisos de conteúdo (SKU longo, tipo estranho, linha descartada)
- sellers cujo saldo muda muito
- quantos produtos serão criados e quantos SKUs ficam negativos

E **esperar ele confirmar**.

**Passo 3 — subida de verdade:**

```bash
cd "D:\KiwKiw\ferramenta_estoques" && "C:\Users\lipe-\AppData\Local\Programs\Python\Python312\python.exe" subir_estoques.py
```

O script faz backup (`pg_dump`) sozinho e **pede para o usuário digitar `SUBIR`** antes de
tocar em qualquer coisa. Se o backup falhar, ele aborta — não force.

Um seller só: `--apenas 30` (id) ou `--apenas Mineraux` (nome).

**Passo 4 — relatar** o resultado: sellers que subiram, os que falharam (e por quê), e os
arquivos gerados em `D:\KiwKiw\ferramenta_estoques\execucoes\<data>\`.

## Decisões já tomadas com o dono do sistema (27/08/2026)

Estão codificadas no script — **não mudar sem falar com ele**:

| Assunto | Decisão |
|---|---|
| `ESTOQUE Dita Cuja.xlsx`, `ESTOQUE UWELL.xlsx`, `ESTOQUE OVACARE.xlsx` | ignorados (sellers não cadastrados; o OvaCare foi removido em 27/08 e não será restaurado) |
| `ESTOQUE Feel BAD.xlsx` | **o script PERGUNTA.** Todos os 61 SKUs também estão no `ESTOQUE Feel.xlsx`, que é mais recente. Subir os dois **dobra** o estoque do Feel |
| Sellers sem planilha (ERRE, B2 Mamy, Kastania, PRIA, Feel MG) | não são tocados |
| SKU maior que 100 caracteres | cortado em 100 (a coluna do banco é `varchar(100)` e estoura a transação inteira) |
| Tipo `Saóda` / `Entrda` (erros de digitação nas planilhas) | lidos por semelhança como Saída / Entrada, e reportados nos avisos |
| Linha com quantidade vazia, zero ou negativa | descartada, com aviso no log |
| Saldo negativo | **mantido como está** — é o indicador de onde falta regularizar entrada. Não "corrigir" |
| Produto que falta cadastrar | criado com o nome da planilha, **sem código de barras** — sai na lista `produtos_criados.csv` para cadastrar o barcode depois |
| Autor dos movimentos e da auditoria | user id 8 (Felipe TI) |

## Consequência conhecida e aceita

NF **anterior à virada** que for cancelada depois **não devolve estoque sozinha** — os
movimentos dela foram substituídos pela planilha. `reverse_stock_for_order()` devolve `-1`
("NF órfã") e as telas de cancelamento avisam pedindo conferência manual. NF nova funciona
normalmente. Se o usuário reclamar disso depois, é esperado, não é bug novo.

## Se algo der errado

- **Um seller falhou:** o script já fez ROLLBACK dele. O estoque daquele seller está
  intacto. Ler o motivo no log, corrigir a planilha e rodar `--apenas <id>`.
- **Precisa desfazer um seller que subiu:** o estado anterior está em
  `execucoes\<data>\snapshot\<id>_<nome>_movimentos_antes.csv` e `_posicoes_antes.csv`.
- **Precisa desfazer tudo:** o dump `wms_kiwkiw_<data>_pre_estoques.dump` em
  `D:\KiwKiw\backups_bd\` é de imediatamente antes da subida.

## Armadilhas técnicas (já tratadas — não reintroduzir)

- `movement_type` é **enum nativo** no Postgres: grava-se `IN`/`OUT`, nunca `Entrada`/`Saída`.
  O script faz o cast explícito. Escrever o rótulo errado aborta a transação inteira.
- `products.score` é `NOT NULL` **sem default no banco** — o INSERT precisa informar `0`.
- A coluna Log da planilha só vem preenchida na primeira linha de cada bloco: o parser faz
  **forward-fill**. Sem isso quase toda linha cai na data de hoje.
- A credencial do banco sai de `D:\KiwKiw\backups_bd\backup_config.ps1`. **Nunca imprimir a
  URL no chat nem no log.**
