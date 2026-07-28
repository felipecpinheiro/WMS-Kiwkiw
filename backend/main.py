"""
Teste mudança
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
    init_db()
    run_light_migrations()
    create_default_admin()
    yield


def run_light_migrations():
    """
    Migração compatível com SQLite (dev) e PostgreSQL (produção).
    Idempotente — roda toda vez e só aplica o que falta.
    """
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db_url = os.environ.get("DATABASE_URL", "")
        is_postgres = db_url.startswith("postgres")

        if is_postgres:
            # PostgreSQL: usa information_schema em vez de PRAGMA
            def col_exists(table, column):
                r = db.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ), {"t": table, "c": column}).fetchone()
                return r is not None

            migrations = []
            if not col_exists("picking_sessions", "file_type"):
                migrations.append("ALTER TABLE picking_sessions ADD COLUMN file_type VARCHAR(20) DEFAULT 'Saída' NOT NULL")
            if not col_exists("picking_sessions", "for_billing"):
                migrations.append("ALTER TABLE picking_sessions ADD COLUMN for_billing BOOLEAN DEFAULT TRUE NOT NULL")
            if not col_exists("sellers", "contact_email"):
                migrations.append("ALTER TABLE sellers ADD COLUMN contact_email TEXT")
            if not col_exists("sellers", "code"):
                migrations.append("ALTER TABLE sellers ADD COLUMN code TEXT")
            if not col_exists("sellers", "experience_file_path"):
                migrations.append("ALTER TABLE sellers ADD COLUMN experience_file_path TEXT")
            if not col_exists("users", "force_password_change"):
                migrations.append("ALTER TABLE users ADD COLUMN force_password_change BOOLEAN DEFAULT FALSE NOT NULL")
            if not col_exists("stock_movements", "nf_date"):
                migrations.append("ALTER TABLE stock_movements ADD COLUMN nf_date DATE")
            if not col_exists("kit_items", "product_id"):
                migrations.append("ALTER TABLE kit_items ADD COLUMN product_id INTEGER REFERENCES products(id)")
            # Índice checado à parte da coluna: se a coluna existir sem o índice
            # (criação parcial), ele ainda precisa ser criado. A condição olha o
            # índice de verdade para não reexecutar nada em toda inicialização.
            idx = db.execute(text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename='kit_items' AND indexname='ix_kit_items_product_id'"
            )).fetchone()
            if idx is None:
                migrations.append("CREATE INDEX IF NOT EXISTS ix_kit_items_product_id ON kit_items (product_id)")

            db.execute(text("""
                CREATE TABLE IF NOT EXISTS user_sellers (
                    user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
                    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
                    PRIMARY KEY (user_id, seller_id)
                )
            """))

        else:
            # SQLite: comportamento original com PRAGMA
            rows = db.execute(text("PRAGMA table_info(picking_sessions)")).fetchall()
            existing = {r[1] for r in rows}
            migrations = []
            if "file_type" not in existing:
                migrations.append("ALTER TABLE picking_sessions ADD COLUMN file_type VARCHAR(20) DEFAULT 'Saída' NOT NULL")
            if "for_billing" not in existing:
                migrations.append("ALTER TABLE picking_sessions ADD COLUMN for_billing BOOLEAN DEFAULT 1 NOT NULL")

            rows_sel = db.execute(text("PRAGMA table_info(sellers)")).fetchall()
            existing_sel = {r[1] for r in rows_sel}
            if "contact_email" not in existing_sel:
                migrations.append("ALTER TABLE sellers ADD COLUMN contact_email TEXT")
            if "code" not in existing_sel:
                migrations.append("ALTER TABLE sellers ADD COLUMN code TEXT")
            if "experience_file_path" not in existing_sel:
                migrations.append("ALTER TABLE sellers ADD COLUMN experience_file_path TEXT")

            rows_usr = db.execute(text("PRAGMA table_info(users)")).fetchall()
            existing_usr = {r[1] for r in rows_usr}
            if "force_password_change" not in existing_usr:
                migrations.append("ALTER TABLE users ADD COLUMN force_password_change BOOLEAN DEFAULT 0 NOT NULL")

            rows_mov = db.execute(text("PRAGMA table_info(stock_movements)")).fetchall()
            existing_mov = {r[1] for r in rows_mov}
            if "nf_date" not in existing_mov:
                migrations.append("ALTER TABLE stock_movements ADD COLUMN nf_date DATE")

            rows_ki = db.execute(text("PRAGMA table_info(kit_items)")).fetchall()
            existing_ki = {r[1] for r in rows_ki}
            if "product_id" not in existing_ki:
                migrations.append("ALTER TABLE kit_items ADD COLUMN product_id INTEGER REFERENCES products(id)")
            # Ver comentário no ramo PostgreSQL: o índice é checado à parte da coluna.
            idx_ki = {r[1] for r in db.execute(text("PRAGMA index_list(kit_items)")).fetchall()}
            if "ix_kit_items_product_id" not in idx_ki:
                migrations.append("CREATE INDEX IF NOT EXISTS ix_kit_items_product_id ON kit_items (product_id)")

            db.execute(text("""
                CREATE TABLE IF NOT EXISTS user_sellers (
                    user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
                    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
                    PRIMARY KEY (user_id, seller_id)
                )
            """))

        for sql in migrations:
            db.execute(text(sql))
            print(f"✅ Migração aplicada: {sql}")
        db.commit()

        # ── Backfill do vínculo componente de kit → produto ────────────────────
        # Preenche apenas onde ainda está NULL e o SKU casa exatamente com um
        # produto ativo do MESMO seller do kit. Nunca altera component_sku.
        # O que não casar segue NULL e aparece na tela /kits/vincular.
        # "AND p.active" (sem = TRUE / = 1) funciona nos dois bancos.
        res = db.execute(text("""
            UPDATE kit_items
               SET product_id = (
                   SELECT p.id
                     FROM products p
                     JOIN kits k ON k.id = kit_items.kit_id
                    WHERE p.seller_id = k.seller_id
                      AND p.sku = kit_items.component_sku
                      AND p.active
                    LIMIT 1
               )
             WHERE product_id IS NULL
        """))
        db.commit()
        if res.rowcount:
            print(f"✅ Backfill kit_items.product_id: {res.rowcount} linha(s) avaliada(s)")
    except Exception as e:
        print(f"⚠️  Aviso em migrações leves: {e}")
    finally:
        db.close()


def create_default_admin():
    """Cria o usuário admin padrão se o banco estiver vazio."""
    db = SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            unit = models.Unit(
                name="Unidade 1",
                location="São Paulo, SP",
                responsible="Flávio",
            )
            db.add(unit)
            db.flush()

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
    * **admin**    — Acesso total. Único que importa pedidos e cadastra usuários/sellers
    * **manager**  — Gerente: vê e edita somente seu grupo de sellers
    * **operator** — Operador: bipagem dos sellers que atende
    * **client**   — Cliente (seller): portal somente leitura
    """,
    version="1.0.0",
    contact={"name": "Kiwkiw WMS", "email": "admin@kiwkiw.com.br"},
    lifespan=lifespan,
)

# CORS
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",")] if _origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Arquivos estáticos
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
