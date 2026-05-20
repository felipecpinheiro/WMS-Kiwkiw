"""
WMS Kiwkiw — Folder Watcher (Robô de Pasta)
Monitora uma pasta de inbox em background thread.
Quando encontra arquivos .xlsx/.xls, tenta importá-los via order_import
e os move para a pasta de processados — SEMPRE, independente de sucesso ou erro.
"""

import os
import shutil
import threading
import logging
from datetime import datetime
from typing import Optional, List

logger = logging.getLogger("watcher")

# ── Estado global do watcher ───────────────────────────────────────────────────
_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_lock = threading.Lock()

_last_check: Optional[datetime] = None
_files_processed: int = 0
_last_files: List[dict] = []          # últimos N arquivos processados


# ── API pública ────────────────────────────────────────────────────────────────

def watcher_running() -> bool:
    return _thread is not None and _thread.is_alive()


def last_check_time() -> Optional[str]:
    return _last_check.isoformat() if _last_check else None


def files_processed_count() -> int:
    return _files_processed


def last_processed_files() -> List[dict]:
    return list(_last_files[-20:])        # retorna até 20 entradas


def start(inbox_path: str, processed_path: str, interval_sec: int = 30, db_factory=None):
    """Inicia o watcher em background thread. Seguro chamar múltiplas vezes."""
    global _thread, _stop_event

    if watcher_running():
        logger.info("[watcher] já está rodando — ignorando start()")
        return

    _stop_event.clear()
    _thread = threading.Thread(
        target=_run_loop,
        args=(inbox_path, processed_path, interval_sec),
        daemon=True,
        name="FolderWatcher",
    )
    _thread.start()
    logger.info(f"[watcher] iniciado — inbox={repr(inbox_path)}, interval={interval_sec}s")


def stop():
    """Para o watcher."""
    global _thread
    _stop_event.set()
    if _thread:
        _thread.join(timeout=5)
        _thread = None
    logger.info("[watcher] parado")


# ── Loop interno ───────────────────────────────────────────────────────────────

def _run_loop(inbox_path: str, processed_path: str, interval_sec: int):
    global _last_check, _files_processed, _last_files

    while not _stop_event.wait(timeout=interval_sec):
        _last_check = datetime.now()

        if not os.path.isdir(inbox_path):
            logger.warning(f"[watcher] pasta de inbox não existe: {repr(inbox_path)}")
            continue

        try:
            candidates = [
                f for f in os.listdir(inbox_path)
                if f.lower().endswith((".xlsx", ".xls", ".xlsm"))
                and not f.startswith("~$")
                and not f.startswith("_ERRO_")   # ignora arquivos marcados como erro
            ]
        except PermissionError as e:
            logger.error(f"[watcher] sem permissão para ler inbox: {e}")
            continue

        for fname in candidates:
            fpath = os.path.join(inbox_path, fname)
            result = _process_file(fpath, processed_path, inbox_path)
            with _lock:
                _last_files.append(result)
                if result["success"]:
                    _files_processed += 1
                _last_files = _last_files[-50:]


# WatcherImportError é definido em order_import para evitar circular import.
# Importado aqui para uso no catch de _process_file.
# (A importação real acontece dentro de _process_file para ser lazy.)


# ── Processamento de um arquivo ────────────────────────────────────────────────

def _process_file(fpath: str, processed_path: str, inbox_path: str = "") -> dict:
    """
    Processa um arquivo Excel:
      1. Tenta importar os pedidos via import_orders_from_excel_sync
      2. Move SEMPRE o arquivo para fora do inbox:
           Sucesso → processed_path/{ts}_ok_{fname}
           Erro    → processed_path/_erros/{ts}_erro_{fname}
                       (fallback: inbox/_erros/ se processed_path não estiver configurado)
         Se o move falhar, renomeia in-place com prefixo _ERRO_ para não ser
         reprocessado em loop infinito.

    Campos do resultado:
      success  – bool
      orders   – int (pedidos importados)
      reason   – str legível (título do erro)
      details  – str com contexto específico (seller, NFs, colunas…)
      error    – str com mensagem técnica completa
      dest     – str com caminho de destino do arquivo
    """
    fname = os.path.basename(fpath)
    ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
    result = {
        "file":      fname,
        "timestamp": datetime.now().isoformat(),
        "success":   False,
        "orders":    0,
        "reason":    None,
        "details":   None,
        "error":     None,
        "dest":      None,
    }

    # ── 1. Importar ────────────────────────────────────────────────────────────
    try:
        from ..services.order_import import import_orders_from_excel_sync, WatcherImportError
        from ..database import SessionLocal

        db = SessionLocal()
        try:
            imported = import_orders_from_excel_sync(fpath, db)
            result["success"] = True
            result["orders"]  = imported
            logger.info(f"[watcher] ✓ {fname} — {imported} pedido(s) importado(s)")
        except WatcherImportError as e:
            result["reason"]  = e.reason
            result["details"] = e.details or None
            result["error"]   = e.reason + (f"\n{e.details}" if e.details else "")
            logger.warning(f"[watcher] ✗ {fname} — {e.reason}" + (f" | {e.details}" if e.details else ""))
        finally:
            db.close()

    except Exception as e:
        raw = str(e)
        result["reason"]  = _classify_generic_error(raw)
        result["details"] = None
        result["error"]   = raw
        logger.error(f"[watcher] ✗ {fname} — {raw}")

    # ── 2. Mover SEMPRE o arquivo para fora do inbox ───────────────────────────
    # Determina a pasta de destino base
    if processed_path and os.path.isdir(processed_path):
        base_dest = processed_path
    else:
        # processed_path não configurado → usa pasta ao lado do inbox
        base_dest = ""

    if result["success"]:
        # Sucesso → processed_path diretamente
        if base_dest:
            dest_dir  = base_dest
            new_name  = f"{ts}_ok_{fname}"
        else:
            # Fallback: renomeia in-place com .done
            dest_dir  = ""
            new_name  = fname + ".done"
    else:
        # Erro → subpasta _erros dentro de processed_path (ou do inbox)
        if base_dest:
            dest_dir = os.path.join(base_dest, "_erros")
        else:
            dest_dir = os.path.join(inbox_path if inbox_path else os.path.dirname(fpath), "_erros")
        new_name = f"{ts}_erro_{fname}"

    try:
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, new_name)
            shutil.move(fpath, dest)
        else:
            # Fallback in-place rename (.done)
            dest = fpath + ".done"
            os.rename(fpath, dest)
        result["dest"] = dest
        logger.info(f"[watcher] arquivo movido → {repr(dest)}")

    except Exception as mv_err:
        # Move falhou: renomeia in-place com _ERRO_ para garantir que não
        # seja reprocessado em loop. O arquivo fica no inbox para inspeção.
        logger.warning(f"[watcher] não foi possível mover {fname}: {mv_err}")
        fallback_name = f"_ERRO_{ts}_{fname}"
        fallback_path = os.path.join(inbox_path if inbox_path else os.path.dirname(fpath), fallback_name)
        try:
            os.rename(fpath, fallback_path)
            result["dest"] = fallback_path
            logger.info(f"[watcher] renomeado in-place → {repr(fallback_path)}")
        except Exception as rename_err:
            logger.error(f"[watcher] falha total ao mover/renomear {fname}: {rename_err}")
            # Arquivo ainda está no inbox — será ignorado na próxima varredura
            # somente se já tiver o prefixo _ERRO_, o que não aconteceu aqui.
            # Não há mais o que fazer sem arriscar loop.

    return result


def _classify_generic_error(msg: str) -> str:
    """
    Classifica erros genéricos (não lançados como WatcherImportError)
    em mensagens curtas e legíveis.
    """
    m = msg.lower()
    if "permission" in m or "permissão" in m or "acesso negado" in m:
        return "Sem permissão para ler o arquivo"
    if "password" in m or "senha" in m or "encrypt" in m or "protected" in m:
        return "Arquivo protegido por senha"
    if "corrupt" in m or "zipfile" in m or "bad magic" in m:
        return "Arquivo corrompido ou formato inválido"
    if "cannot import" in m or "no module named" in m:
        return "Erro interno do sistema (contate o suporte)"
    if "no such file" in m or "filenotfounderror" in m:
        return "Arquivo não encontrado (foi movido/deletado antes do processamento)"
    # Fallback: primeiros 120 chars
    return msg[:120] if len(msg) > 120 else msg
