"""
Migração: adiciona colunas comerciais à tabela sellers e is_input à tabela products.
Execute uma vez: python scripts/migrate_sellers_v2.py
"""

import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "wms_kiwkiw.db")

if not os.path.exists(DB_PATH):
    print(f"Banco não encontrado em: {DB_PATH}")
    print("Rode o backend uma vez para criar o banco e tente novamente.")
    exit(1)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# Colunas a adicionar na tabela sellers
SELLER_COLUMNS = [
    ("caixa_b2b",             "REAL"),
    ("manuseio_b2b",          "REAL"),
    ("qtd_franquia_b2b",      "INTEGER"),
    ("valor_adicional_b2b",   "REAL"),
    ("num_min_pedidos",       "INTEGER"),
    ("preco_unitario",        "REAL"),
    ("caixa_inclusa",         "BOOLEAN DEFAULT 0"),
    ("seguro_incluso",        "BOOLEAN DEFAULT 0"),
    ("armazenagem_incluso",   "BOOLEAN DEFAULT 0"),
    ("valor_segurado",        "REAL"),
    ("franquia",              "REAL"),
    ("preco_adicional",       "REAL"),
    ("caixa1",                "VARCHAR(50)"),
    ("caixa2",                "VARCHAR(50)"),
    ("caixa3",                "VARCHAR(50)"),
    ("caixa4",                "VARCHAR(50)"),
    ("caixa5",                "VARCHAR(50)"),
    ("caixa6",                "VARCHAR(50)"),
    ("caixa7",                "VARCHAR(50)"),
    ("caixa8",                "VARCHAR(50)"),
    ("manuseio",              "REAL"),
    ("caixa_prop",            "BOOLEAN DEFAULT 0"),
    ("mes_reajuste",          "INTEGER"),
    ("unit_name",             "VARCHAR(100)"),
    ("contact_name",          "VARCHAR(150)"),
    ("contact_phone",         "VARCHAR(50)"),
    ("code",                  "VARCHAR(50)"),
    ("is_active",             "BOOLEAN DEFAULT 1"),
    ("contact_email",         "VARCHAR(150)"),
]

# Colunas a adicionar na tabela products
PRODUCT_COLUMNS = [
    ("is_input", "BOOLEAN DEFAULT 0"),
]

def get_existing_columns(table: str):
    cur.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}

def add_columns(table: str, columns: list):
    existing = get_existing_columns(table)
    added = []
    skipped = []
    for col_name, col_type in columns:
        if col_name in existing:
            skipped.append(col_name)
        else:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
            added.append(col_name)
    return added, skipped

print(f"Conectado ao banco: {DB_PATH}\n")

print(">> Tabela: sellers")
added, skipped = add_columns("sellers", SELLER_COLUMNS)
if added:
    print(f"   Adicionadas: {', '.join(added)}")
if skipped:
    print(f"   Já existiam: {', '.join(skipped)}")

print("\n>> Tabela: products")
added, skipped = add_columns("products", PRODUCT_COLUMNS)
if added:
    print(f"   Adicionadas: {', '.join(added)}")
if skipped:
    print(f"   Já existiam: {', '.join(skipped)}")

conn.commit()
conn.close()
print("\n✓ Migração concluída. Reinicie o backend.")
