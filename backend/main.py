"""
WMS Kiwkiw - API Principal (FastAPI)
Entry point da aplicação backend.

Para rodar:
  pip install -r requirements.txt
  uvicorn backend.main:app --reload --port 8000

Documentação interativa (Swagger):
  http://localhost:8000/docs
"""

import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

# Adiciona o diretório pai ao path para permitir imports relativos
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import init_db, get_db, SessionLocal
from backend.routers import auth, orders, scanning, inventory, products, billing, dashboard, settings as settings_router
from backend import models
from backend.auth import hash_password


# ============================================================
# INICIALIZAÇÃO
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Executa na inicialização e encerramento da API."""
    # Inicializa banco de dados
    init_db()
    # Migração leve: adiciona colunas novas em bancos pré-existentes.
    run_light_migrations()
    # Cria usuário admin padrão se não existir
    create_default_admin()
    yield
    # Cleanup ao encerrar (se necessário)


def run_light_migrations():
    """
    Migração simples para SQLite: adiciona colunas que não existem
    ainda (equivalente manual do Alembic). Idempotente — roda toda vez
    e só aplica o que falta.
    """
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # Pega colunas existentes de picking_sessions
        rows = db.execute(text("PRAGMA table_info(picking_sessions)")).fetchall()
        existing = {r[1] for r in rows}
        migrations = []
        if "file_type" not in existing:
            migrations.append("ALTER TABLE picking_sessions ADD COLUMN file_type VARCHAR(20) DEFAULT 'Saída' NOT NULL")
        if "for_billing" not in existing:
            migrations.append("ALTER TABLE picking_sessions ADD COLUMN for_billing BOOLEAN DEFAULT 1 NOT NULL")

        # Sellers: colunas adicionadas na v3
        rows_sel = db.execute(text("PRAGMA table_info(sellers)")).fetchall()
        existing_sel = {r[1] for r in rows_sel}
        if "contact_email" not in existing_sel:
            migrations.append("ALTER TABLE sellers ADD COLUMN contact_email TEXT")
        if "code" not in existing_sel:
            migrations.append("ALTER TABLE sellers ADD COLUMN code TEXT")
        if "experience_file_path" not in existing_sel:
            migrations.append("ALTER TABLE sellers ADD COLUMN experience_file_path TEXT")

        for sql in migrations:
            db.execute(text(sql))
            print(f"✅ Migração aplicada: {sql}")
        if migrations:
            db.commit()
    except Exception as e:
        print(f"⚠️  Aviso em migrações leves: {e}")
    finally:
        db.close()


def create_default_admin():
    """Cria o usuário admin padrão se o banco estiver vazio."""
    db = SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            # Cria unidade padrão
            unit = models.Unit(
                name="Unidade 1",
                location="São Paulo, SP",
                responsible="Flávio",
            )
            db.add(unit)
            db.flush()

            # Cria usuário admin
            admin = models.User(
                name="Administrador",
                email="admin@kiwkiw.com.br",
                password_hash=hash_password("kiwkiw2024"),
                role=models.UserRole.ADMIN,
                unit_id=unit.id,
            )
            db.add(admin)
            db.commit()
            print("✅ Usuário admin criado: admin@kiwkiw.com.br / kiwkiw2024")
    except Exception as e:
        print(f"⚠️  Aviso na criação do admin: {e}")
    finally:
        db.close()


# ============================================================
# APLICAÇÃO
# ============================================================

app = FastAPI(
    title="WMS Kiwkiw API",
    description="""
    Sistema de Gerenciamento de Armazém da Kiwkiw.

    ## Módulos
    * **Auth** — Login e autenticação JWT
    * **Pedidos** — Importação e gestão de pedidos dos ERPs
    * **Bipagem** — Interface de scanning para operadores
    * **Estoque** — Posições e movimentações de estoque
    * **Cadastros** — Produtos, kits, sellers, usuários
    * **Faturamento** — Configurações e relatórios de cobrança
    * **Dashboard** — Cockpit gerencial e portal do seller

    ## Roles de Acesso
    * **admin** — Acesso total ao sistema
    * **master** — Gerencia operações diárias, gera relatórios
    * **operator** — Interface de bipagem da unidade
    * **seller** — Portal do seller (estoque + status de pedidos)
    """,
    version="1.0.0",
    contact={"name": "Kiwkiw WMS", "email": "admin@kiwkiw.com.br"},
    lifespan=lifespan,
)

# CORS — lê origens permitidas da variável de ambiente ALLOWED_ORIGINS
# Ex: ALLOWED_ORIGINS=https://wms.kiwkiw.com.br,https://wms-kiwkiw.vercel.app
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",")] if _origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Arquivos estáticos (fotos de produtos, PDFs gerados)
MEDIA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "media")
os.makedirs(MEDIA_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)
app.mount("/exports", StaticFiles(directory=EXPORT_DIR), name="exports")


# ============================================================
# ROUTERS
# ============================================================

app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(scanning.router)
app.include_router(inventory.router)
app.include_router(products.router)
app.include_router(billing.router)
app.include_router(dashboard.router)
app.include_router(settings_router.router)


# ============================================================
# HEALTH CHECK
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Auto-inicia o watcher de pasta se estava habilitado."""
    try:
        db = SessionLocal()
        try:
            enabled = db.query(models.AppSetting).filter(
                models.AppSetting.key == "watcher_enabled"
            ).first()
            if enabled and enabled.value == "true":
                inbox = db.query(models.AppSetting).filter(
                    models.AppSetting.key == "inbox_folder"
                ).first()
                proc = db.query(models.AppSetting).filter(
                    models.AppSetting.key == "processed_folder"
                ).first()
                interval = db.query(models.AppSetting).filter(
                    models.AppSetting.key == "watcher_interval_sec"
                ).first()
                if inbox and inbox.value:
                    from backend.services import folder_watcher
                    folder_watcher.start(
                        inbox_path=inbox.value,
                        processed_path=proc.value if proc else "",
                        interval_sec=int(interval.value or 30) if interval else 30,
                    )
        finally:
            db.close()
    except Exception as e:
        print(f"[startup] watcher não iniciado: {e}")


@app.get("/", tags=["Health"])
def root():
    return {
        "status": "ok",
        "app": "WMS Kiwkiw",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy"}


# ============================================================
# INICIALIZAÇÃO DIRETA
# =======================================