"""
Migracao: adiciona campos score (products) e box_used (orders).
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wms_kiwkiw.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()
    existing_products = {r[1] for r in cur.execute("PRAGMA table_info(products)")}
    existing_orders   = {r[1] for r in cur.execute("PRAGMA table_info(orders)")}

    added = []
    if 'score' not in existing_products:
        cur.execute("ALTER TABLE products ADD COLUMN score INTEGER NOT NULL DEFAULT 0")
        added.append("products.score")
    if 'box_used' not in existing_orders:
        cur.execute("ALTER TABLE orders ADD COLUMN box_used VARCHAR(50)")
        added.append("orders.box_used")

    conn.commit()
    conn.close()
    if added:
        print("Adicionados: " + ", ".join(added))
    else:
        print("Nada a migrar - campos ja existem")

if __name__ == '__main__':
    migrate()
