"""
Migração: normaliza valores legados de movement_type no banco.

Problema:
    O campo stock_movements.movement_type pode conter valores antigos
    como 'IN'/'OUT' (nome do enum Python) em vez dos valores canônicos
    'Entrada'/'Saída' (value do enum).  O SQLAlchemy ORM lança ValueError
    ao tentar ler esses registros, fazendo o endpoint /movements retornar 500.

Solução:
    Atualiza todos os 'IN' → 'Entrada' e 'OUT' → 'Saída'.

Uso (com o backend PARADO):
    cd backend
    python scripts/migrate_movement_type_v1.py
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wms_kiwkiw.db')


def migrate():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    cur  = conn.cursor()

    cur.execute("SELECT movement_type, COUNT(*) FROM stock_movements "
                "WHERE movement_type IN ('IN','OUT','E','S') "
                "GROUP BY movement_type")
    before = cur.fetchall()

    if not before:
        print("Nada a migrar — todos os valores já estão no formato correto.")
        conn.close()
        return

    print("Valores a migrar:")
    for row in before:
        print(f"  '{row[0]}' → {row[1]} registros")

    migrations = [
        ("UPDATE stock_movements SET movement_type='Entrada' WHERE movement_type='IN'",  "IN  → Entrada"),
        ("UPDATE stock_movements SET movement_type='Saída'   WHERE movement_type='OUT'", "OUT → Saída"),
        ("UPDATE stock_movements SET movement_type='Entrada' WHERE movement_type='E'",   "E   → Entrada"),
        ("UPDATE stock_movements SET movement_type='Saída'   WHERE movement_type='S'",   "S   → Saída"),
    ]

    total_updated = 0
    for sql, label in migrations:
        cur.execute(sql)
        n = cur.rowcount
        if n:
            print(f"  {label}: {n} registros atualizados")
            total_updated += n

    conn.commit()
    conn.close()
    print(f"\nMigração concluída — {total_updated} registros normalizados.")


if __name__ == '__main__':
    migrate()
