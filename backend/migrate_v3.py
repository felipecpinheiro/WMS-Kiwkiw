"""
WMS Kiwkiw - Migração v3
Adiciona colunas `contact_email` e `code` à tabela sellers.

Como rodar:
  1. Pare o backend (Ctrl+C no terminal do uvicorn)
  2. Com o venv ativado, na pasta backend/, rode:
     python migrate_v3.py
  3. Reinicie o backend normalmente
"""

import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "wms_kiwkiw.db")

def migrate():
    print(f"Banco: {DB_PATH}")
    if not os.path.exists(DB_PATH):
        print("❌ Banco não encontrado! Verifique o caminho.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Lê colunas atuais
    cur.execute("PRAGMA table_info(sellers)")
    cols = [r[1] for r in cur.fetchall()]
    print(f"Colunas atuais em sellers: {cols}")

    alteracoes = 0

    if "contact_email" not in cols:
        cur.execute("ALTER TABLE sellers ADD COLUMN contact_email TEXT")
        print("✓ Adicionado: sellers.contact_email")
        alteracoes += 1
    else:
        print("- sellers.contact_email já existe, pulando")

    if "code" not in cols:
        cur.execute("ALTER TABLE sellers ADD COLUMN code TEXT")
        print("✓ Adicionado: sellers.code")
        alteracoes += 1
    else:
        print("- sellers.code já existe, pulando")

    # Mostra todas as tabelas existentes
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tabelas = [r[0] for r in cur.fetchall()]
    print(f"\nTabelas no banco: {tabelas}")

    conn.commit()
    conn.close()

    if alteracoes > 0:
        print(f"\n✅ Migração concluída! {alteracoes} coluna(s) adicionada(s).")
    else:
        print("\n✅ Nada a migrar — banco já estava atualizado.")

    print("\nAgora reinicie o backend: uvicorn main:app --reload --port 8000")

if __name__ == "__main__":
    migrate()
