"""
WMS Kiwkiw - Gerador de PDFs
Gera os relatórios de Separação e Expedição em PDF.
Reproduz as macros 'imprimir_sep()' e 'imprimir_plan()'.
"""

import os
from datetime import date, datetime
from typing import List, Dict, Optional
from collections import defaultdict

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, PageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from sqlalchemy.orm import Session
from .. import models

# Cores da identidade visual Kiwkiw
KIWKIW_PURPLE = colors.Color(0.482, 0.388, 0.910)  # #7B63E8 — Roxo principal
KIWKIW_TEAL   = colors.Color(0.239, 0.851, 0.643)  # #3DD9A4 — Verde-água destaque
KIWKIW_DARK   = colors.Color(0.078, 0.071, 0.165)  # #14122A — Fundo escuro
LIGHT_PURPLE  = colors.Color(0.918, 0.914, 0.973)  # Roxo suave para zebra
LIGHT_GRAY    = colors.Color(0.96, 0.96, 0.96)
# Aliases mantidos para compatibilidade
KIWKIW_GREEN  = KIWKIW_PURPLE
LIGHT_GREEN   = LIGHT_PURPLE


def generate_separation_report(
    session: models.PickingSession,
    db: Session,
    output_dir: str,
) -> str:
    """
    Gera o Relatório de Separação (equivalente ao 'RELATORIO DE SEPARACAO').
    Consolida SKUs por seller, mostrando quantidades totais a separar.
    """
    output_path = os.path.join(
        output_dir,
        f"SEPARACAO_{session.session_date.strftime('%Y%m%d')}_{session.id}.pdf"
    )
    os.makedirs(output_dir, exist_ok=True)

    # Busca pedidos da sessão
    orders = db.query(models.Order).filter(
        models.Order.session_id == session.id
    ).all()

    # Agrupa itens por seller → sku
    seller_skus: Dict[str, Dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"name": "", "qty": 0}))
    seller_order_count: Dict[str, int] = defaultdict(int)

    for order in orders:
        seller_name = order.seller.trade_name if order.seller else "N/A"
        seller_order_count[seller_name] += 1
        for item in order.items:
            seller_skus[seller_name][item.sku]["name"] = item.product_name
            seller_skus[seller_name][item.sku]["qty"] += item.quantity

    # Monta documento PDF
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        topMargin=1.5*cm,
        bottomMargin=1.5*cm,
        leftMargin=1.5*cm,
        rightMargin=1.5*cm,
    )

    styles = getSampleStyleSheet()
    story = []

    # Cabeçalho
    title_style = ParagraphStyle("title", fontSize=18, fontName="Helvetica-Bold",
                                  textColor=KIWKIW_GREEN, alignment=TA_CENTER)
    subtitle_style = ParagraphStyle("subtitle", fontSize=11, fontName="Helvetica",
                                     textColor=KIWKIW_DARK, alignment=TA_CENTER)
    label_style = ParagraphStyle("label", fontSize=9, fontName="Helvetica-Bold",
                                  textColor=KIWKIW_DARK)

    story.append(Paragraph("WMS KIWKIW", title_style))
    story.append(Paragraph("RELATÓRIO DE SEPARAÇÃO", ParagraphStyle("sep_title",
        fontSize=14, fontName="Helvetica-Bold", textColor=KIWKIW_DARK, alignment=TA_CENTER)))
    story.append(Spacer(1, 5))
    story.append(Paragraph(
        f"Data: {session.session_date.strftime('%d/%m/%Y')} | "
        f"Total de Pedidos: {len(orders)} | "
        f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        subtitle_style
    ))
    story.append(HRFlowable(width="100%", thickness=2, color=KIWKIW_TEAL))
    story.append(Spacer(1, 10))

    total_global = 0

    for seller_name in sorted(seller_skus.keys()):
        # Cabeçalho do seller
        story.append(Paragraph(
            f"SELLER: {seller_name.upper()} — {seller_order_count[seller_name]} pedidos",
            ParagraphStyle("seller_header", fontSize=12, fontName="Helvetica-Bold",
                          textColor=colors.white, backColor=KIWKIW_GREEN, spaceAfter=2,
                          leftIndent=5, rightIndent=5)
        ))
        story.append(Spacer(1, 5))

        # Tabela de SKUs do seller
        data = [["SKU", "PRODUTO", "QTDE TOTAL"]]
        seller_total = 0
        for sku, info in sorted(seller_skus[seller_name].items()):
            data.append([sku, info["name"], str(info["qty"])])
            seller_total += info["qty"]
            total_global += info["qty"]

        data.append(["", "TOTAL SELLER", str(seller_total)])

        table = Table(data, colWidths=[4*cm, 10*cm, 3*cm])
        table.setStyle(TableStyle([
            # Cabeçalho
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GREEN),
            ("TEXTCOLOR", (0, 0), (-1, 0), KIWKIW_DARK),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            # Dados
            ("FONTNAME", (0, 1), (-1, -2), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -2), 8),
            ("ALIGN", (2, 1), (2, -1), "CENTER"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT_GRAY]),
            # Total
            ("BACKGROUND", (0, -1), (-1, -1), LIGHT_GREEN),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, -1), (-1, -1), 9),
            # Grid
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("BOX", (0, 0), (-1, -1), 1.5, KIWKIW_PURPLE),
        ]))
        story.append(table)
        story.append(Spacer(1, 15))

    # Rodapé com totais globais
    story.append(HRFlowable(width="100%", thickness=1, color=KIWKIW_TEAL))
    story.append(Paragraph(
        f"TOTAL GERAL DE UNIDADES: {total_global}",
        ParagraphStyle("total", fontSize=12, fontName="Helvetica-Bold",
                       textColor=KIWKIW_TEAL, alignment=TA_RIGHT)
    ))

    doc.build(story)
    return output_path


def generate_expedition_report(
    session: models.PickingSession,
    db: Session,
    output_dir: str,
) -> str:
    """
    Gera o Relatório de Expedição/Planejamento.
    Detalha cada pedido por seller com itens e transportadora.
    Equivalente ao 'Relatório de Expedição' / 'Planejamento dia'.
    """
    output_path = os.path.join(
        output_dir,
        f"EXPEDICAO_{session.session_date.strftime('%Y%m%d')}_{session.id}.pdf"
    )
    os.makedirs(output_dir, exist_ok=True)

    orders = db.query(models.Order).filter(
        models.Order.session_id == session.id
    ).order_by(models.Order.seller_id, models.Order.nf_number).all()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        topMargin=1.5*cm,
        bottomMargin=1.5*cm,
        leftMargin=1.5*cm,
        rightMargin=1.5*cm,
    )

    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle("title", fontSize=16, fontName="Helvetica-Bold",
                                  textColor=KIWKIW_GREEN, alignment=TA_CENTER)

    story.append(Paragraph("WMS KIWKIW — RELATÓRIO DE EXPEDIÇÃO", title_style))
    story.append(Paragraph(
        f"Data: {session.session_date.strftime('%d/%m/%Y')} | "
        f"Total: {len(orders)} pedidos | "
        f"Gerado: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        ParagraphStyle("sub", fontSize=10, fontName="Helvetica", alignment=TA_CENTER)
    ))
    story.append(HRFlowable(width="100%", thickness=2, color=KIWKIW_TEAL))
    story.append(Spacer(1, 10))

    # Agrupa por seller
    sellers_orders: Dict[str, List[models.Order]] = defaultdict(list)
    for order in orders:
        seller_name = order.seller.trade_name if order.seller else "N/A"
        sellers_orders[seller_name].append(order)

    for seller_name, s_orders in sorted(sellers_orders.items()):
        story.append(Paragraph(
            f"SELLER: {seller_name.upper()} — {len(s_orders)} pedidos",
            ParagraphStyle("seller", fontSize=11, fontName="Helvetica-Bold",
                          textColor=colors.white, backColor=KIWKIW_GREEN)
        ))
        story.append(Spacer(1, 5))

        # Tabela de pedidos
        data = [["# NF", "CLIENTE", "PRODUTO", "SKU", "TRANSPORTADORA", "QTDE"]]
        for order in s_orders:
            first = True
            for item in order.items:
                if first:
                    data.append([
                        order.nf_number,
                        order.customer_name[:35],
                        item.product_name[:40],
                        item.sku,
                        (order.carrier or "N/D")[:20],
                        str(item.quantity),
                    ])
                    first = False
                else:
                    data.append([
                        "", "",
                        item.product_name[:40],
                        item.sku,
                        "",
                        str(item.quantity),
                    ])
            # Linha separadora entre pedidos
            data.append(["", "", "", "", "", ""])

        col_widths = [2.5*cm, 5.5*cm, 7*cm, 3.5*cm, 4*cm, 1.5*cm]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GREEN),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 7),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GRAY]),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.lightgrey),
            ("BOX", (0, 0), (-1, -1), 1, KIWKIW_GREEN),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(table)
        story.append(Spacer(1, 15))

        # Área de assinatura por transportadora
        carriers = list(set(o.carrier for o in s_orders if o.carrier))
        if carriers:
            sig_data = [["TRANSPORTADORA", "ASSINATURA", "VOLUMES", "DATA/HORA"]]
            for carrier in carriers:
                carrier_orders = [o for o in s_orders if o.carrier == carrier]
                sig_data.append([carrier, "", str(len(carrier_orders)), ""])

            sig_table = Table(sig_data, colWidths=[5*cm, 7*cm, 3*cm, 4*cm])
            sig_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GREEN),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("ROWHEIGHT", (0, 1), (-1, -1), 20),
            ]))
            story.append(Paragraph("ASSINATURA DE COLETA POR TRANSPORTADORA:", label_style
                if (label_style := ParagraphStyle("label", fontSize=8, fontName="Helvetica-Bold")) else None))
            story.append(Spacer(1, 3))
            story.append(sig_table)

        story.append(PageBreak())

    doc.build(story)
    return output_path


def label_style():
    return ParagraphStyle("label", fontSize=8, fontName="Helvetica-Bold")
