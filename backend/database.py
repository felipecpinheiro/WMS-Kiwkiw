"""
WMS Kiwkiw - Configuração do Banco de Dados
Suporta SQLite (dev local) e PostgreSQL (produção).
Controle via variável de ambiente DATABASE_URL.
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Em produção: defina DATABASE_URL no painel do Railway/Azure/Render
# Ex: postgresql://user:pass@host:5432/wms_kiwkiw
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(DATA_DIR, 'wms_kiwkiw.db')}"
)

# Railway fornece URLs com prefixo "postgres://" — SQLAlchemy 2.x exige "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Argumentos específicos por banco
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,   # Reconecta automaticamente se a conexão cair
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency injection: fornece sessão de banco de dados por request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Inicializa o banco de dados criando todas as tabelas."""
    from . import models  # noqa: F401 - importar para registrar models
    Base.metadata.create_all(bind=engine)
