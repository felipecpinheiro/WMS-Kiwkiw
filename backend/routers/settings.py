"""
WMS Kiwkiw — Configurações Gerais
Endpoint para leitura e escrita de configurações do sistema (admin only).
Também fornece status e controle do Watcher de pasta de inbox.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from ..database import get_db
from .. import models
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/settings", tags=["settings"])

# Chaves conhecidas (defaults incluídos)
DEFAULT_SETTINGS = {
    "inbox_folder":           {"value": "", "description": "Pasta monitorada para importação automática de Excel"},
    "processed_folder":       {"value": "", "description": "Pasta onde os arquivos são movidos após importação"},
    "watcher_enabled":        {"value": "false", "description": "Habilita o monitoramento automático de pasta"},
    "watcher_interval_sec":   {"value": "30",    "description": "Intervalo de varredura da pasta (segundos)"},
    "default_movement_type":  {"value": "Saída", "description": "Tipo de movimentação padrão no estoque"},
    "auto_generate_pdfs":     {"value": "true",  "description": "Gera PDFs automaticamente após importação"},
    "require_all_checks":     {"value": "true",  "description": "Bloqueia importação se alguma checagem falhar"},
    # ── Destino dos PDFs gerados ────────────────────────────────────────────
    "pdf_base_folder": {"value": "", "description": "Pasta raiz para salvar PDFs. Estrutura automática: Base/Unidade/mês-AAAA/dia/arquivo. Vazio = usa data/exports."},
    # Legado — mantidos para retrocompatibilidade; ignorados quando pdf_base_folder definido
    "pdf_separation_folder":  {"value": "", "description": "[Legado] Substituído por pdf_base_folder."},
    "pdf_expedition_folder":  {"value": "", "description": "[Legado] Substituído por pdf_base_folder."},
    # ── Checagens granulares ─────────────────────────────────────────────────
    "check_transportadora":        {"value": "true",  "description": "Verifica se todos os pedidos têm transportadora definida"},
    "check_nf_unicas":             {"value": "true",  "description": "Verifica se as chaves DANFE são únicas (sem NFs duplicadas)"},
    "check_produtos_cadastrados":  {"value": "true",  "description": "Verifica se todos os SKUs dos pedidos estão cadastrados como produtos"},
}


def _get_or_create(db: Session, key: str) -> models.AppSetting:
    obj = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if not obj:
        default = DEFAULT_SETTINGS.get(key, {})
        obj = models.AppSetting(
            key=key,
            value=default.get("value", ""),
            description=default.get("description", ""),
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


@router.get("")
def get_all_settings(
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Retorna todas as configurações. Cria defaults se não existirem."""
    result = {}
    # Garante que os defaults existem no BD
    for key, meta in DEFAULT_SETTINGS.items():
        obj = _get_or_create(db, key)
        result[key] = {
            "value": obj.value,
            "description": obj.description or meta.get("description", ""),
            "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
        }
    # Inclui qualquer chave adicional salva no BD
    for obj in db.query(models.AppSetting).all():
        if obj.key not in result:
            result[obj.key] = {
                "value": obj.value,
                "description": obj.description or "",
                "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
            }
    return result


@router.put("")
def update_settings(
    data: dict,
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Atualiza uma ou mais configurações. Aceita {key: value, ...}."""
    updated = []
    for key, value in data.items():
        obj = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
        if obj:
            obj.value = str(value)
            obj.updated_at = datetime.now()
            obj.updated_by = current_user.id
        else:
            meta = DEFAULT_SETTINGS.get(key, {})
            obj = models.AppSetting(
                key=key,
                value=str(value),
                description=meta.get("description", ""),
                updated_by=current_user.id,
            )
            db.add(obj)
        updated.append(key)

    db.commit()
    return {"updated": updated, "count": len(updated)}


@router.get("/watcher/status")
def watcher_status(
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Retorna o status atual do watcher de pasta."""
    from ..services import folder_watcher
    enabled_obj  = _get_or_create(db, "watcher_enabled")
    inbox_obj    = _get_or_create(db, "inbox_folder")
    proc_obj     = _get_or_create(db, "processed_folder")
    interval_obj = _get_or_create(db, "watcher_interval_sec")

    is_running = folder_watcher.watcher_running()
    return {
        "running":           is_running,
        "enabled":           enabled_obj.value == "true",
        "inbox_folder":      inbox_obj.value,
        "processed_folder":  proc_obj.value,
        "interval_sec":      int(interval_obj.value or 30),
        "last_check":        folder_watcher.last_check_time(),
        "files_processed":   folder_watcher.files_processed_count(),
        "last_files":        folder_watcher.last_processed_files(),
    }


@router.post("/watcher/start")
def start_watcher(
    current_user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Ativa o watcher de pasta manualmente."""
    from ..services import folder_watcher
    inbox    = _get_or_create(db, "inbox_folder").value
    proc     = _get_or_create(db, "processed_folder").value
    interval = int(_get_or_create(db, "watcher_interval_sec").value or 30)

    if not inbox:
        raise HTTPException(status_code=400, detail="Pasta de entrada não configurada")

    folder_watcher.start(
        inbox_folder=inbox,
        processed_folder=proc or inbox,
        interval_sec=interval,
    )
    return {"message": "Watcher iniciado", "inbox": inbox, "interval_sec": interval}


@router.post("/watcher/stop")
def stop_watcher(
    current_user: models.User = Depends(require_admin),
):
    """Para o watcher de pasta."""
    from ..services import folder_watcher
    folder_watcher.stop()
    return {"message": "Watcher parado"}
