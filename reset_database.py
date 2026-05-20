#!/usr/bin/env python3
"""
WMS Kiwkiw — Reset completo do banco de dados e arquivos de dados.

O que este script faz:
  1. Apaga o banco SQLite (wms_kiwkiw.db)
  2. Apaga os arquivos gerados em data/audit/, data/exports/, data/media/
     (mantém a pasta data/media/products/ para preservar fotos de produtos
      se você já tiver cadastrado os produtos reais)
  3. Recria o banco do zero via init_db() — o admin padrão é recriado
     automaticamente ao subir o uvicorn

Uso:
  1. Pare o uvicorn  (Ctrl+C no terminal onde está rodando)
  2. python reset_database.py
  3. Suba o uvicorn novamente

Credenciais padrão após o reset:
  E-mail : admin@kiwkiw.com.br
  Senha  : kiwkiw2024
"""

import os
import sys
import shutil

# ── Caminhos ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(SCRIPT_DIR, "data")
DB_PATH    = os.path.join(DATA_DIR, "wms_kiwkiw.db")

DIRS_TO_CLEAR = [
    os.path.join(DATA_DIR, "audit"),
    os.path.join(DATA_DIR, "exports"),
    os.path.join(DATA_DIR, "media", "experience"),
    # Descomente a linha abaixo se quiser apagar fotos dos produtos também:
    # os.path.join(DATA_DIR, "media", "products"),
]

# ── Confirmação ───────────────────────────────────────────────────────────────

print("=" * 60)
print("  WMS Kiwkiw — RESET COMPLETO DA BASE DE DADOS")
print("=" * 60)
print()
print("Este script vai APAGAR permanentemente:")
print(f"  • Banco de dados : {DB_PATH}")
print(f"  • Auditorias     : data/audit/")
print(f"  • Exportações    : data/exports/")
print(f"  • Arquivos exp.  : data/media/experience/")
print()
print("Fotos de produtos (data/media/products/) serão PRESERVADAS.")
print()

confirm = input("Digite  RESET  para confirmar: ").strip()
if confirm != "RESET":
    print("Operação cancelada.")
    sys.exit(0)

print()

# ── Apaga banco ───────────────────────────────────────────────────────────────

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
    print(f"✅ Banco apagado: {DB_PATH}")
else:
    print(f"⚠️  Banco não encontrado (já estava limpo): {DB_PATH}")

# ── Apaga pastas de dados gerados ─────────────────────────────────────────────

for d in DIRS_TO_CLEAR:
    if os.path.exists(d):
        shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)  # recria a pasta vazia
        print(f"✅ Limpo: {d}")
    else:
        print(f"⚠️  Pasta não encontrada (pulada): {d}")

# ── Recria banco do zero ───────────────────────────────────────────────────────

print()
print("Recriando banco de dados...")

try:
    # Adiciona o diretório backend ao path
    sys.path.insert(0, os.path.join(SCRIPT_DIR, "backend"))
    sys.path.insert(0, SCRIPT_DIR)

    from backend.database import init_db
    init_db()
    print("✅ Banco recriado com sucesso (tabelas vazias)")
except Exception as e:
    print(f"⚠️  Não foi possível recriar o banco automaticamente: {e}")
    print("   O banco será recriado automaticamente ao subir o uvicorn.")

# ── Instrução final ───────────────────────────────────────────────────────────

print()
print("=" * 60)
print("  Reset concluído!")
print()
print("  Próximo passo: suba o servidor")
print("  cd backend")
print("  uvicorn main:app --reload --port 8000")
print()
print("  Login inicial:")
print("    E-mail : admin@kiwkiw.com.br")
print("    Senha  : kiwkiw2024")
print("=" * 60)
