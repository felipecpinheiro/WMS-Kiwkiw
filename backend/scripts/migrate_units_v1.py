"""
Migração v1 — Units: adiciona colunas code, city, state, phone
Não altera sellers (unit_id já existe desde versão anterior).

Executar da pasta raiz do projeto (WMS Kiwkiw):
    python -m backend.scripts.migrate_units_v1
"""

import sqlite3
import os

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
DB_PATH  = os.path.join(BASE_DIR, "wms_kiwkiw.db")

if not os.path.exists(DB_PATH):
    print(f"✗ Banco não encontrado em: {DB_PATH}")
    raise SystemExit(1)

print(f"Banco: {DB_PATH}")

COLUMNS_TO_ADD = [
    ("code",        "TEXT"),
    ("city",        "TEXT"),
    ("state",       "TEXT"),
    ("phone",       "TEXT"),
]

conn = sqlite3.connect(DB_PATH)
try:
    existing = [row[1] for row in conn.execute("PRAGMA table_info(units)")]
    added = []
    for col, col_type in COLUMNS_TO_ADD:
        if col in existing:
            print(f"  · '{col}' já existe — pulando.")
        else:
            conn.execute(f"ALTER TABLE units ADD COLUMN {col} {col_type}")
            added.append(col)

    if added:
        conn.commit()
        print(f"✓ Colunas adicionadas em 'units': {', '.join(added)}")
    else:
        print("✓ Nenhuma alteração necessária.")
finally:
    conn.close()
