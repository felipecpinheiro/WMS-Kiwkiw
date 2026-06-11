"""
Backfill: corrige unit_id dos pedidos existentes para usar a unidade do seller.
Para cada pedido, atualiza unit_id = seller.unit_id (se o seller tiver unidade).
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wms_kiwkiw.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    # Busca sellers com unidade associada
    cur.execute("SELECT id, unit_id FROM sellers WHERE unit_id IS NOT NULL AND active = 1")
    sellers_with_unit = cur.fetchall()

    total_updated = 0
    for seller_id, unit_id in sellers_with_unit:
        cur.execute(
            "UPDATE orders SET unit_id = ? WHERE seller_id = ? AND (unit_id != ? OR unit_id IS NULL)",
            (unit_id, seller_id, unit_id)
        )
        total_updated += cur.rowcount

    conn.commit()
    conn.close()
    print("Pedidos atualizados: " + str(total_updated))

if __name__ == '__main__':
    migrate()
