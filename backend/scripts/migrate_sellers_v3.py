"""
Migração v3 — Sellers: adiciona coluna other_aliases (Text, nullable)

Executar da pasta raiz do projeto (WMS Kiwkiw):
    python -m backend.scripts.migrate_sellers_v3
"""

import sqlite3
import os

# Localiza o banco de dados
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
DB_PATH  = os.path.join(BASE_DIR, "wms_kiwkiw.db")

if not os.path.exists(DB_PATH):
    print(f"✗ Banco não encontrado em: {DB_PATH}")
    raise SystemExit(1)

print(f"Banco: {DB_PATH}")

conn = sqlite3.connect(DB_PATH)
try:
    # Verifica se a coluna já existe
    cols = [row[1] for row in conn.execute("PRAGMA table_info(sellers)")]
    if "other_aliases" in cols:
        print("✓ Coluna 'other_aliases' já existe — nada a fazer.")
    else:
        conn.execute("ALTER TABLE sellers ADD COLUMN other_aliases TEXT")
        conn.commit()
        print("✓ Coluna 'other_aliases' adicionada com sucesso!")
        print("  Use o cadastro de Sellers para preencher os apelidos alternativos.")
finally:
    conn.close()
