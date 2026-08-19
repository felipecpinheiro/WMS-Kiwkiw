"""
WMS Kiwkiw — Progresso de Importação (em memória)

Contador de progresso do import de Excel, exposto pro frontend acompanhar em
tempo real (GET /orders/import/progress) sem consultar o banco — leitura é só
um lookup de dict. Mesmo padrão de estado global do folder_watcher.py.

Nunca persiste nada: se o processo reiniciar no meio de um import, o
progresso em andamento some (o import em si continua rodando e commitando
normalmente — só a barra fica muda até o próximo reload).
"""

import threading
import time
from typing import Optional

_lock = threading.Lock()
_progress: dict[str, dict] = {}

_TTL_SECONDS = 30 * 60  # entradas somem sozinhas 30min depois da última atualização


def start_import(upload_id: Optional[str], total: int) -> None:
    if not upload_id:
        return
    with _lock:
        _cleanup_locked()
        _progress[upload_id] = {
            "processed": 0,
            "total": total,
            "done": False,
            "success": None,
            "updated_at": time.monotonic(),
        }


def update_import(upload_id: Optional[str], processed: int) -> None:
    if not upload_id:
        return
    with _lock:
        entry = _progress.get(upload_id)
        if entry is None:
            return
        entry["processed"] = processed
        entry["updated_at"] = time.monotonic()


def finish_import(upload_id: Optional[str], success: bool) -> None:
    if not upload_id:
        return
    with _lock:
        entry = _progress.get(upload_id)
        if entry is None:
            return
        entry["done"] = True
        entry["success"] = success
        entry["updated_at"] = time.monotonic()


def get_progress(upload_id: str) -> Optional[dict]:
    with _lock:
        entry = _progress.get(upload_id)
        return dict(entry) if entry else None


def _cleanup_locked() -> None:
    """Remove entradas expiradas. Só é chamada de dentro do lock (start_import)."""
    now = time.monotonic()
    expired = [k for k, v in _progress.items() if now - v["updated_at"] > _TTL_SECONDS]
    for k in expired:
        del _progress[k]
