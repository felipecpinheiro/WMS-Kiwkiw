"""
WMS Kiwkiw — Script de limpeza: apaga histórico de movimentação do seller PURPOSE.

Execute com:
    python scripts/deletar_historico_purpose.py

O script:
  1. Localiza o seller PURPOSE no banco
  2. Exibe um resumo do que será apagado
  3. Pede confirmação antes de deletar
  4. Apaga stock_movements e stock_positions do seller
  5. Exibe confirmação com contagem
"""

import os
import sys
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH  = os.path.join(BASE_DIR, "data", "wms_kiwkiw.db")

if not os.path.exists(DB_PATH):
    print(f"[ERRO] Banco não encontrado em: {DB_PATH}")
    sys.exit(1)

print(f"Banco: {DB_PATH}")

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# ── 1. Localizar seller ────────────────────────────────────────────────────────
cur.execute("""
    SELECT id, trade_name, name
    FROM sellers
    WHERE UPPER(trade_name) LIKE '%PURPOSE%'
       OR UPPER(name)       LIKE '%PURPOSE%'
""")
sellers = cur.fetchall()

if not sellers:
    print("[AVISO] Nenhum seller com nome contendo 'PURPOSE' encontrado.")
    con.close()
    sys.exit(0)

print("\nSellers encontrados:")
for s in sellers:
    print(f"  ID {s[0]}: trade_name='{s[1]}', name='{s[2]}'")

seller_ids = [s[0] for s in sellers]
placeholders = ",".join("?" * len(seller_ids))

# ── 2. Resumo ──────────────────────────────────────────────────────────────────
cur.execute(
    f"SELECT COUNT(*) FROM stock_movements WHERE seller_id IN ({placeholders})",
    seller_ids,
)
n_mov = cur.fetchone()[0]

cur.execute(
    f"SELECT COUNT(*) FROM stock_positions WHERE seller_id IN ({placeholders})",
    seller_ids,
)
n_pos = cur.fetchone()[0]

print(f"\nSerão apagados:")
print(f"  • {n_mov:,} registros em stock_movements")
print(f"  • {n_pos:,} registros em stock_positions (posição zerada)")

# ── 3. Confirmação ─────────────────────────────────────────────────────────────
resp = input("\nConfirmar deleção? (sim/nao): ").strip().lower()
if resp not in ("sim", "s"):
    print("Cancelado. Nenhuma alteração feita.")
    con.close()
    sys.exit(0)

# ── 4. Deletar ─────────────────────────────────────────────────────────────────
cur.execute(
    f"DELETE FROM stock_movements WHERE seller_id IN ({placeholders})",
    seller_ids,
)
deleted_mov = cur.rowcount

cur.execute(
    f"DELETE FROM stock_positions WHERE seller_id IN ({placeholders})",
    seller_ids,
)
deleted_pos = cur.rowcount

con.commit()

# ── 5. Confirmar ───────────────────────────────────────────────────────────────
print(f"\n[OK] Deleção concluída:")
print(f"  • {deleted_mov:,} movimentações apagadas")
print(f"  • {deleted_pos:,} posições de estoque apagadas")
print("\nReinicie o backend para os dados em cache serem atualizados.")

con.close()
