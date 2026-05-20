"""
WMS Kiwkiw — Exportação para auditoria
Grava PDFs e CSV de uma sessão na estrutura: <unidade>/<seller>/<data>/
Todos os arquivos são salvos também em CSV para facilitar auditoria externa.
"""

from __future__ import annotations

import csv
import os
import re
import shutil
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from .. import models


def _slugify(value: Optional[str], fallback: str = "N_A") -> str:
    """Converte 'Seller XYZ' em 'Seller_XYZ' seguro para filesystem."""
    if not value:
        return fallback
    s = str(value).strip()
    # Remove acentos simples e caracteres proibidos em paths
    table = str.maketrans({
        "/": "-", "\\": "-", ":": "-", "*": "", "?": "", '"': "",
        "<": "", ">": "", "|": "", "\n": " ", "\r": " ",
    })
    s = s.translate(table)
    # Troca espaços e pontos por underline
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"\.+", "", s)
    return s or fallback


def audit_path_for_session(
    base_dir: str,
    session: models.PickingSession,
    seller_name: Optional[str] = None,
) -> str:
    """
    Retorna o caminho <base_dir>/<unidade>/<seller>/<YYYY-MM-DD>/
    Cria os diretórios se não existirem. Se seller_name for None, usa "ALL_SELLERS".
    """
    unit_slug = _slugify(session.unit.name if session.unit else f"unit_{session.unit_id}", "unit")
    seller_slug = _slugify(seller_name, "ALL_SELLERS")
    date_slug = session.session_date.strftime("%Y-%m-%d")

    path = os.path.join(base_dir, unit_slug, seller_slug, date_slug)
    os.makedirs(path, exist_ok=True)
    return path


def export_session_to_csv(
    session: models.PickingSession,
    db: Session,
    base_dir: str,
) -> list[str]:
    """
    Exporta a sessão em CSVs separados por seller: <unit>/<seller>/<data>/PEDIDOS_<sess>.csv
    Retorna a lista de caminhos gerados.
    """
    orders = db.query(models.Order).filter(
        models.Order.session_id == session.id
    ).all()

    # Agrupa por seller para gerar um CSV por seller
    by_seller: dict[str, list[models.Order]] = {}
    for o in orders:
        name = o.seller.trade_name if o.seller and o.seller.trade_name else (
            o.seller.name if o.seller else "N_A"
        )
        by_seller.setdefault(name, []).append(o)

    generated: list[str] = []
    for seller_name, seller_orders in by_seller.items():
        folder = audit_path_for_session(base_dir, session, seller_name=seller_name)
        csv_path = os.path.join(folder, f"PEDIDOS_{session.id}.csv")

        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL)
            # Header
            w.writerow([
                "sessao_id", "unidade", "seller", "data_sessao",
                "nf_number", "erp_code", "cliente",
                "data_nota", "data_expedicao", "transportadora",
                "natureza", "chave_danfe",
                "sku", "produto", "quantidade",
                "is_kit_component", "kit_original_sku",
                "status", "importado_em",
            ])
            for o in seller_orders:
                for it in o.items:
                    w.writerow([
                        session.id,
                        session.unit.name if session.unit else session.unit_id,
                        seller_name,
                        session.session_date.isoformat(),
                        o.nf_number, o.erp_code or "", o.customer_name or "",
                        o.order_date.isoformat() if o.order_date else "",
                        o.expedition_date.isoformat() if o.expedition_date else "",
                        o.carrier or "",
                        o.nature or "",
                        o.danfe_key or "",
                        it.sku, it.product_name or "", it.quantity,
                        bool(it.is_kit_component),
                        it.original_kit_sku or "",
                        o.status.value if hasattr(o.status, "value") else str(o.status),
                        o.imported_at.isoformat() if o.imported_at else "",
                    ])
        generated.append(csv_path)

    return generated


def organize_pdfs_by_session(
    session: models.PickingSession,
    db: Session,
    base_dir: str,
    separation_pdf: Optional[str],
    expedition_pdf: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """
    Move os PDFs do local temporário (flat) para a estrutura <unit>/<seller>/<data>/.
    Como os PDFs consolidam vários sellers, salvamos em <unit>/ALL_SELLERS/<data>/.
    Retorna (novo_path_separacao, novo_path_expedicao).
    """
    dest_folder = audit_path_for_session(base_dir, session, seller_name=None)

    def _move(src: Optional[str]) -> Optional[str]:
        if not src or not os.path.exists(src):
            return src  # Se já foi movido ou não existe, mantém referência
        dest = os.path.join(dest_folder, os.path.basename(src))
        if os.path.abspath(src) == os.path.abspath(dest):
            return dest
        shutil.move(src, dest)
        return dest

    return _move(separation_pdf), _move(expedition_pdf)
