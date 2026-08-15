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
import time
from fastapi import FastAPI, Request
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


# Índices de performance (30/07/2026). Até então stock_movements (630k+ linhas)
# e scanning_logs só tinham a PK, e o caminho quente da bipagem fazia varredura
# completa da tabela a cada pedido concluído. O DDL é igual nos dois bancos —
# só a forma de checar a existência do índice muda.
PERF_INDEXES = [
    # estorno/anti-duplicata de estoque (stock_manager.py) + scanning.py
    ("ix_stock_movements_order_id",
     "CREATE INDEX IF NOT EXISTS ix_stock_movements_order_id ON stock_movements (order_id)"),
    # get_stock_report, get_sku_history, export — e o prefixo seller_id sozinho
    ("ix_stock_movements_seller_sku",
     "CREATE INDEX IF NOT EXISTS ix_stock_movements_seller_sku ON stock_movements (seller_id, sku)"),
    # get_movements / export CSV (inventory.py) — filtro por seller_id + intervalo
    # de movement_date; sem isso, telas de estoque com período largo (ex: 1 ano)
    # varrem a tabela toda e ordenam em memória (14/08/2026, pego via log de
    # SLOW REQUEST — GET /inventory/movements/{seller_id} levando 5-6s)
    ("ix_stock_movements_seller_date",
     "CREATE INDEX IF NOT EXISTS ix_stock_movements_seller_date ON stock_movements (seller_id, movement_date)"),
    # progresso da bipagem — 7 pontos distintos consultam por pedido
    ("ix_scanning_logs_order_id",
     "CREATE INDEX IF NOT EXISTS ix_scanning_logs_order_id ON scanning_logs (order_id)"),
    # scan-logs da sessão e trilha de auditoria
    ("ix_scanning_logs_session_id",
     "CREATE INDEX IF NOT EXISTS ix_scanning_logs_session_id ON scanning_logs (session_id)"),
    # get_session_orders / get_order / process_scan (01/08/2026) — sem isso,
    # buscar os itens de um pedido varre order_items inteira (8k+ linhas)
    ("ix_order_items_order_id",
     "CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items (order_id)"),
]


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

        # Índices de performance ficam numa lista à parte: são aplicados depois,
        # num laço com print em texto puro (ver comentário no laço).
        index_migrations = []

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
            # Coluna nova vai em index_migrations (print em texto puro), não em
            # migrations (print com emoji) — ver comentário mais abaixo sobre o
            # UnicodeEncodeError em console Windows.
            if not col_exists("orders", "reactivated_at"):
                index_migrations.append("ALTER TABLE orders ADD COLUMN reactivated_at TIMESTAMP")
            # Coluna aditiva pura: nullable, sem default → no Postgres é mudança
            # só de metadado (não reescreve linha, não trava a tabela).
            # NÃO há backfill de propósito: pedido concluído ANTES desta mudança
            # fica com a coluna vazia, e quem decide estorno trata
            # "COMPLETED/INTERRUPTED sem a coluna" como já baixado — ver
            # order_has_stock_applied() em services/stock_manager.py.
            if not col_exists("orders", "stock_applied_at"):
                index_migrations.append("ALTER TABLE orders ADD COLUMN stock_applied_at TIMESTAMP")

            # Enum nativo orderstatus: adiciona o valor 'INACTIVE' se ainda não
            # existir. Isolado com commit próprio — ALTER TYPE ... ADD VALUE não
            # pode dividir transação com nada que use o valor novo (ver CLAUDE.md,
            # mesma armadilha já documentada para movement_type).
            # ⚠️ O SQLAlchemy grava o NOME do membro do enum Python no Postgres
            # (ex.: 'CANCELLED', 'PENDING'), não o `.value` minúsculo — por isso
            # aqui é 'INACTIVE' maiúsculo, não 'inactive'.
            enum_type_row = db.execute(text(
                "SELECT udt_name FROM information_schema.columns "
                "WHERE table_name='orders' AND column_name='status'"
            )).fetchone()
            if enum_type_row:
                enum_type_name = enum_type_row[0]
                enum_has_inactive = db.execute(text(
                    "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = :tn AND e.enumlabel = 'INACTIVE'"
                ), {"tn": enum_type_name}).fetchone()
                if enum_has_inactive is None:
                    db.execute(text(f"ALTER TYPE {enum_type_name} ADD VALUE 'INACTIVE'"))
                    db.commit()
                    print(f"[migracao] enum {enum_type_name}: valor 'INACTIVE' adicionado")

            # Índice checado à parte da coluna: se a coluna existir sem o índice
            # (criação parcial), ele ainda precisa ser criado. A condição olha o
            # índice de verdade para não reexecutar nada em toda inicialização.
            idx = db.execute(text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename='kit_items' AND indexname='ix_kit_items_product_id'"
            )).fetchone()
            if idx is None:
                migrations.append("CREATE INDEX IF NOT EXISTS ix_kit_items_product_id ON kit_items (product_id)")

            # Índices de performance: checa o índice de verdade, não a coluna.
            existing_perf_idx = {
                r[0] for r in db.execute(text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename IN ('stock_movements', 'scanning_logs', 'order_items')"
                )).fetchall()
            }
            for idx_name, idx_sql in PERF_INDEXES:
                if idx_name not in existing_perf_idx:
                    index_migrations.append(idx_sql)

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

            rows_ord = db.execute(text("PRAGMA table_info(orders)")).fetchall()
            existing_ord = {r[1] for r in rows_ord}
            if "reactivated_at" not in existing_ord:
                # Coluna nova vai em index_migrations (print em texto puro) — ver
                # comentário no ramo PostgreSQL acima.
                index_migrations.append("ALTER TABLE orders ADD COLUMN reactivated_at DATETIME")
            if "stock_applied_at" not in existing_ord:
                index_migrations.append("ALTER TABLE orders ADD COLUMN stock_applied_at DATETIME")
            # Ver comentário no ramo PostgreSQL: o índice é checado à parte da coluna.
            idx_ki = {r[1] for r in db.execute(text("PRAGMA index_list(kit_items)")).fetchall()}
            if "ix_kit_items_product_id" not in idx_ki:
                migrations.append("CREATE INDEX IF NOT EXISTS ix_kit_items_product_id ON kit_items (product_id)")

            # Índices de performance: mesma checagem do ramo PostgreSQL, via PRAGMA.
            existing_perf_idx = set()
            for _tbl in ("stock_movements", "scanning_logs", "order_items"):
                existing_perf_idx |= {
                    r[1] for r in db.execute(text(f"PRAGMA index_list({_tbl})")).fetchall()
                }
            for idx_name, idx_sql in PERF_INDEXES:
                if idx_name not in existing_perf_idx:
                    index_migrations.append(idx_sql)

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

        # Índices de performance em laço à parte, com print em TEXTO PURO:
        # emoji em migração estoura UnicodeEncodeError em console Windows (cp1252)
        # e derruba o startup do backend — ver CLAUDE.md.
        for sql in index_migrations:
            db.execute(text(sql))
            print(f"[migracao] indice criado: {sql}")
        if index_migrations:
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

SLOW_REQUEST_THRESHOLD_SECONDS = 3.0


@app.middleware("http")
async def log_slow_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    if duration >= SLOW_REQUEST_THRESHOLD_SECONDS:
        print(f"SLOW REQUEST: {request.method} {request.url.path} -> {int(duration * 1000)}ms")
    return response


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
