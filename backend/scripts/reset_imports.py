"""
WMS Kiwkiw - Reset de Importações
---------------------------------
Apaga TODOS os dados transacionais (sessões de picking, pedidos, itens,
logs de bipagem e movimentações de estoque), mas PRESERVA:

  - Usuários, unidades, sellers
  - Produtos, kits, algoritmo de caixa
  - Configurações de faturamento
  - Posições de estoque (stock_positions) — zere manualmente se quiser

Uso (a partir da pasta do projeto "WMS Kiwkiw"):

    python -m backend.scripts.reset_imports

Ou, com confirmação automática (sem pergunta):

    python -m backend.scripts.reset_imports --yes
"""

import sys
import os

# Garante que rodamos com o PYTHONPATH da raiz do projeto
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.database import SessionLocal, engine
from backend import models


TABLES_IN_ORDER = [
    # ordem respeita FKs (filhas primeiro)
    ("scanning_logs",   models.ScanningLog),
    ("stock_movements", models.StockMovement),
    ("order_items",     models.OrderItem),
    ("orders",          models.Order),
    ("picking_sessions", models.PickingSession),
]


def count_all(db):
    return {name: db.query(cls).count() for name, cls in TABLES_IN_ORDER}


def main():
    auto_yes = "--yes" in sys.argv or "-y" in sys.argv

    db = SessionLocal()
    try:
        before = count_all(db)
        print("Antes do reset:")
        for name, n in before.items():
            print(f"  {name:<18} {n}")

        if sum(before.values()) == 0:
            print("\nNada para apagar.")
            return

        if not auto_yes:
            resp = input("\nConfirma apagar todos os dados transacionais? (digite 'SIM'): ").strip()
            if resp != "SIM":
                print("Operação cancelada.")
                return

        # Apaga em cascata manual
        for name, cls in TABLES_IN_ORDER:
            n = db.query(cls).delete(synchronize_session=False)
            print(f"  apagados {n:>6} de {name}")

        db.commit()

        after = count_all(db)
        print("\nDepois do reset:")
        for name, n in after.items():
            print(f"  {name:<18} {n}")
        print("\nOK — cadastros de usuários, sellers, produtos e kits foram preservados.")
    except Exception as e:
        db.rollback()
        print(f"ERRO — rollback executado: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
