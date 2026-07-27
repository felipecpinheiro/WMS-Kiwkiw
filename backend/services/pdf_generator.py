"""
WMS Kiwkiw - Gerador de PDFs
Gera os relatórios de Separação e Expedição em PDF.
Reproduz as macros 'imprimir_sep()' e 'imprimir_plan()'.
"""

import os
from datetime import date, datetime
from typing import List, Dict, Optional
from collections import defaultdict

from ..timezone_utils import now_brasilia

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

from sqlalchemy.orm import Session, joinedload
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


def _sellers_suffix(orders) -> str:
    """
    Gera sufixo com nomes dos sellers para uso no nome do arquivo PDF.
    Mostra todos os sellers. Cada nome é truncado em 12 caracteres para
    evitar nomes de arquivo excessivamente longos no Windows.
    Ex.: 4 sellers → "YUGEN_LORM_QOLOR_ESPACO"
    Caracteres inválidos em nomes de arquivo são removidos.
    """
    import re
    sellers = sorted({
        (o.seller.trade_name if o.seller else "SELLER")
        for o in orders
    })
    # Sanitiza: apenas letras, números e underscores; trunca em 12 chars
    safe = [re.sub(r'[^\w]', '', s.upper())[:12] for s in sellers]
    # Remove entradas vazias após sanitização
    safe = [s for s in safe if s] or ["SELLER"]
    return "_".join(safe)


def _resolve_pdf_dir(base_folder: str, unit_name: str, session_date) -> str:
    """
    Constrói e cria a pasta de destino dos PDFs seguindo a estrutura:
        base_folder / unit_name_safe / mês-AAAA / dia
    """
    import re
    safe_unit = re.sub(r'[^\w\- ]', '', unit_name).strip().replace(' ', '_') or "SEM_UNIDADE"
    month_folder = session_date.strftime('%m-%Y')
    day_folder   = session_date.strftime('%d')
    path = os.path.join(base_folder, safe_unit, month_folder, day_folder)
    os.makedirs(path, exist_ok=True)
    return path


def generate_pdfs_for_session(
    session: models.PickingSession,
    db: Session,
    base_folder: str,
) -> list[tuple[str, str]]:
    """
    Função de alto nível: gera PDFs de separação e expedição para uma sessão.

    - Se os pedidos da sessão pertencerem a sellers de unidades diferentes,
      gera UM par de PDFs (sep + exp) por unidade.
    - Usa a estrutura: base_folder / Unidade / mês-AAAA / dia / arquivo.pdf

    Retorna lista de tuplas (separation_pdf_path, expedition_pdf_path).
    """
    orders = db.query(models.Order).options(
        joinedload(models.Order.seller).joinedload(models.Seller.unit),
        joinedload(models.Order.items),
    ).filter(models.Order.session_id == session.id).all()

    if not orders:
        return []

    # ── Agrupa pedidos por unidade ────────────────────────────────────────────
    from collections import defaultdict
    unit_orders: dict[str, list] = defaultdict(list)
    for order in orders:
        if order.seller and order.seller.unit:
            unit_name = order.seller.unit.name
        else:
            unit_name = "SEM_UNIDADE"
        unit_orders[unit_name].append(order)

    results: list[tuple[str, str]] = []

    for unit_name, unit_order_list in sorted(unit_orders.items()):
        output_dir = _resolve_pdf_dir(base_folder, unit_name, session.session_date)
        exp_path = generate_separation_report(session, db, output_dir, orders=unit_order_list)
        sep_path = generate_expedition_report(session, db, output_dir, orders=unit_order_list)
        results.append((sep_path, exp_path))

    return results


# ════════════════════════════════════════════════════════════════
# RELATÓRIO DE EXPEDIÇÃO — Lista de picking consolidada por seller
# Para o separador ir ao estoque e retirar os produtos.
# ════════════════════════════════════════════════════════════════
def generate_expedition_report(
    session: models.PickingSession,
    db: Session,
    output_dir: str,
    orders: list | None = None,
) -> str:
    """
    Relatório de Expedição = lista de PICKING consolidada.
    Agrupa por seller → SKU, mostrando quantidade total a separar no estoque.
    Design claro (branco) para impressão econômica.
    """
    if orders is None:
        orders = db.query(models.Order).options(
            joinedload(models.Order.seller),
            joinedload(models.Order.items),
        ).filter(models.Order.session_id == session.id).all()

    sellers_tag = _sellers_suffix(orders)
    output_path = os.path.join(
        output_dir,
        f"SEPARACAO_{session.session_date.strftime('%Y%m%d')}_{sellers_tag}_{session.id}.pdf"
    )
    os.makedirs(output_dir, exist_ok=True)

    # ── Paleta print-friendly ─────────────────────────────────────────────────
    ACCENT      = colors.HexColor("#5B45C2")
    HDR_BG      = colors.HexColor("#5B45C2")
    HDR_FG      = colors.white
    SELLER_BG   = colors.HexColor("#EDE9FC")
    SELLER_FG   = colors.HexColor("#2E1F8A")
    TOTAL_BG    = colors.HexColor("#F0F0F0")
    ROW_ODD     = colors.white
    ROW_EVEN    = colors.HexColor("#FAFAFA")
    BORDER      = colors.HexColor("#D0CCEE")
    TEXT        = colors.HexColor("#111111")

    # ── Estilos ───────────────────────────────────────────────────────────────
    s_cell  = ParagraphStyle("ec",  fontSize=8, fontName="Helvetica",      textColor=TEXT,      leading=10)
    s_bold  = ParagraphStyle("eb",  fontSize=8, fontName="Helvetica-Bold", textColor=TEXT,      leading=10)
    s_sell  = ParagraphStyle("esl", fontSize=8, fontName="Helvetica-Bold", textColor=SELLER_FG, leading=10)
    s_tot   = ParagraphStyle("etl", fontSize=8, fontName="Helvetica-Bold", textColor=TEXT,      leading=10)
    s_hdr   = ParagraphStyle("eh",  fontSize=8, fontName="Helvetica-Bold", textColor=HDR_FG,    leading=10, alignment=TA_CENTER)
    s_title = ParagraphStyle("et",  fontSize=15, fontName="Helvetica-Bold", textColor=ACCENT,   leading=18)
    s_sub   = ParagraphStyle("es",  fontSize=8,  fontName="Helvetica",      textColor=colors.HexColor("#555555"), leading=11)

    doc = SimpleDocTemplate(output_path, pagesize=A4,
        topMargin=1.2*cm, bottomMargin=1.2*cm, leftMargin=1.2*cm, rightMargin=1.2*cm)
    story = []

    # ── Cabeçalho ─────────────────────────────────────────────────────────────
    total_vol = sum(item.quantity for o in orders for item in o.items)
    story.append(Paragraph("Relatório de Separação", s_title))
    story.append(Paragraph(
        f"{session.session_date.strftime('%d/%m/%Y')}  ·  "
        f"Total Pedidos: <b>{len(orders)}</b>  ·  "
        f"Total Volumes: <b>{total_vol}</b>  ·  "
        f"Gerado: {now_brasilia().strftime('%d/%m/%Y %H:%M')}",
        s_sub))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=6))

    # ── Consolida por seller → sku ────────────────────────────────────────────
    from collections import defaultdict as _dd, OrderedDict as _OD
    seller_data: dict = _dd(lambda: {"orders": set(), "skus": _dd(lambda: {"name": "", "qty": 0})})
    for order in orders:
        sname = order.seller.trade_name if order.seller else "—"
        seller_data[sname]["orders"].add(order.id)
        for item in order.items:
            seller_data[sname]["skus"][item.sku]["name"] = item.product_name or "—"
            seller_data[sname]["skus"][item.sku]["qty"] += item.quantity

    # Larguras: seller | cod sku | qtd total | nome produto
    C = [2.8*cm, 3.2*cm, 1.8*cm, 10.0*cm]
    HDR = ["Seller", "Cód SKU", "Qtd", "Nome Produto"]

    grand_qty = 0
    grand_orders = 0

    for sname in sorted(seller_data.keys()):
        sd = seller_data[sname]
        n_orders   = len(sd["orders"])
        seller_qty = sum(v["qty"] for v in sd["skus"].values())
        grand_qty    += seller_qty
        grand_orders += n_orders

        skus_sorted = sorted(sd["skus"].items())  # alfabético por SKU
        rows = []
        for i, (sku, info) in enumerate(skus_sorted):
            rows.append([
                Paragraph(sname, s_sell),
                Paragraph(sku, s_bold),
                Paragraph(str(info["qty"]), s_bold),
                Paragraph(info["name"], s_cell),
            ])

        # Span da coluna seller em todas as linhas do seller
        total_row_idx = len(rows) + 1  # +1 header
        rows.append([
            Paragraph("", s_tot),
            Paragraph("", s_tot),
            Paragraph(f"Total {sname}  ·  {n_orders} pedido(s)", s_tot),
            Paragraph(str(seller_qty), s_tot),
        ])

        header_row = [Paragraph(h, s_hdr) for h in HDR]
        tdata = [header_row] + rows

        ts = TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),             HDR_BG),
            ("ROWBACKGROUNDS", (0, 1), (-1, total_row_idx-1), [ROW_ODD, ROW_EVEN]),
            ("BACKGROUND",     (0, total_row_idx), (-1, total_row_idx), TOTAL_BG),
            ("ALIGN",          (2, 0), (2, -1),             "CENTER"),
            ("VALIGN",         (0, 0), (-1, -1),             "TOP"),
            ("TOPPADDING",     (0, 0), (-1, -1),             3),
            ("BOTTOMPADDING",  (0, 0), (-1, -1),             3),
            ("LEFTPADDING",    (0, 0), (-1, -1),             4),
            ("RIGHTPADDING",   (0, 0), (-1, -1),             4),
            ("GRID",           (0, 0), (-1, -1),             0.4, BORDER),
            ("BOX",            (0, 0), (-1, -1),             1.0, ACCENT),
            ("LINEABOVE",      (0, total_row_idx), (-1, total_row_idx), 0.8, ACCENT),
        ])
        # Nome do seller repete em cada linha (sem SPAN vertical): uma célula
        # mesclada cobrindo dezenas de linhas impede o ReportLab de paginar a
        # tabela no meio do bloco, derrubando a geração com sellers de muitos SKUs.
        t = Table(tdata, colWidths=C, repeatRows=1)
        t.setStyle(ts)
        story.append(t)
        story.append(Spacer(1, 8))

    story.append(HRFlowable(width="100%", thickness=1.0, color=ACCENT, spaceBefore=2))
    story.append(Paragraph(
        f"<b>TOTAL GERAL:</b>  {grand_orders} pedidos  ·  {grand_qty} unidades",
        ParagraphStyle("egt", fontSize=10, fontName="Helvetica-Bold",
                       textColor=ACCENT, alignment=TA_RIGHT, leading=14)))

    doc.build(story)
    return output_path


# ════════════════════════════════════════════════════════════════
# RELATÓRIO DE SEPARAÇÃO — Resumo + detalhe por NF/cliente/transportadora
# ════════════════════════════════════════════════════════════════
def generate_separation_report(
    session: models.PickingSession,
    db: Session,
    output_dir: str,
    orders: list | None = None,
) -> str:
    """
    Relatório de Separação = detalhado por NF/cliente/transportadora.
    Página 1: resumo por seller (pedidos + volumes).
    Páginas seguintes: seller | #NF | cliente | cód sku | nome produto | transportadora | qtd.
    - Quebra de página entre sellers.
    - Células de seller/NF/cliente/transportadora com span vertical por pedido.
    - Qtd > 1 destacado em amarelo.
    """
    if orders is None:
        orders = db.query(models.Order).options(
            joinedload(models.Order.seller),
            joinedload(models.Order.items),
        ).filter(models.Order.session_id == session.id
        ).order_by(models.Order.seller_id, models.Order.nf_number).all()
    else:
        orders = sorted(orders, key=lambda o: (
            o.seller.trade_name if o.seller else "",
            o.nf_number or ""
        ))

    sellers_tag = _sellers_suffix(orders)
    output_path = os.path.join(
        output_dir,
        f"EXPEDICAO_{session.session_date.strftime('%Y%m%d')}_{sellers_tag}_{session.id}.pdf"
    )
    os.makedirs(output_dir, exist_ok=True)

    # ── Paleta ────────────────────────────────────────────────────────────────
    ACCENT    = colors.HexColor("#5B45C2")
    HDR_BG    = colors.HexColor("#5B45C2")
    HDR_FG    = colors.white
    SELLER_FG = colors.HexColor("#2E1F8A")
    TOTAL_BG  = colors.HexColor("#F0F0F0")
    ROW_ODD   = colors.white
    ROW_EVEN  = colors.HexColor("#FAFAFA")
    BORDER    = colors.HexColor("#D0CCEE")
    TEXT      = colors.HexColor("#111111")
    QTY_HI    = colors.HexColor("#FFF3CD")
    QTY_FG    = colors.HexColor("#7A4800")
    SUM_HDR   = colors.HexColor("#3B2D8A")

    # ── Estilos ───────────────────────────────────────────────────────────────
    s_cell  = ParagraphStyle("sc",   fontSize=7.5, fontName="Helvetica",      textColor=TEXT,      leading=10)
    s_bold  = ParagraphStyle("sb",   fontSize=7.5, fontName="Helvetica-Bold", textColor=TEXT,      leading=10)
    s_sell  = ParagraphStyle("ssl",  fontSize=7.5, fontName="Helvetica-Bold", textColor=SELLER_FG, leading=10)
    s_tot   = ParagraphStyle("stl",  fontSize=7.5, fontName="Helvetica-Bold", textColor=TEXT,      leading=10)
    s_hdr   = ParagraphStyle("sh",   fontSize=8,   fontName="Helvetica-Bold", textColor=HDR_FG,    leading=10, alignment=TA_CENTER)
    s_title = ParagraphStyle("stit", fontSize=15,  fontName="Helvetica-Bold", textColor=ACCENT,    leading=18)
    s_sub   = ParagraphStyle("ssu",  fontSize=8,   fontName="Helvetica",      textColor=colors.HexColor("#555555"), leading=11)

    doc = SimpleDocTemplate(output_path, pagesize=A4,
        topMargin=1.2*cm, bottomMargin=1.2*cm, leftMargin=1.2*cm, rightMargin=1.2*cm)
    story = []

    # ── Estatísticas ──────────────────────────────────────────────────────────
    from collections import defaultdict as _dd
    seller_stats: dict = _dd(lambda: {"orders": 0, "volumes": 0})
    for order in orders:
        sname = order.seller.trade_name if order.seller else "—"
        seller_stats[sname]["orders"]  += 1
        seller_stats[sname]["volumes"] += sum(i.quantity for i in order.items)
    total_orders  = len(orders)
    total_volumes = sum(v["volumes"] for v in seller_stats.values())

    # ════════════════════════════════
    # PÁGINA 1 — RESUMO
    # ════════════════════════════════
    story.append(Paragraph("Relatório de Expedição", s_title))
    story.append(Paragraph(
        f"{session.session_date.strftime('%d/%m/%Y')}  ·  "
        f"Total Pedidos: <b>{total_orders}</b>  ·  "
        f"Total Produtos: <b>{total_volumes}</b>  ·  "
        f"Gerado: {now_brasilia().strftime('%d/%m/%Y %H:%M')}",
        s_sub))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=10))
    story.append(Paragraph("Resumo por Seller",
        ParagraphStyle("sum_title", fontSize=11, fontName="Helvetica-Bold",
                       textColor=SUM_HDR, leading=14, spaceBefore=4, spaceAfter=6)))

    sum_hdr_row = [Paragraph(h, ParagraphStyle("sumh", fontSize=9, fontName="Helvetica-Bold",
                    textColor=HDR_FG, alignment=TA_CENTER, leading=11))
                   for h in ["Seller", "Pedidos", "Produtos"]]
    sum_rows = [sum_hdr_row]
    for sn in sorted(seller_stats.keys()):
        st = seller_stats[sn]
        sum_rows.append([
            Paragraph(sn,  ParagraphStyle("snn", fontSize=9, fontName="Helvetica-Bold", textColor=SELLER_FG, leading=11)),
            Paragraph(str(st["orders"]),  ParagraphStyle("sov", fontSize=9, fontName="Helvetica", textColor=TEXT, alignment=TA_CENTER, leading=11)),
            Paragraph(str(st["volumes"]), ParagraphStyle("svv", fontSize=9, fontName="Helvetica", textColor=TEXT, alignment=TA_CENTER, leading=11)),
        ])
    ns = len(sum_rows)
    sum_rows.append([
        Paragraph("TOTAL", ParagraphStyle("tot",  fontSize=9, fontName="Helvetica-Bold", textColor=TEXT, leading=11)),
        Paragraph(str(total_orders),  ParagraphStyle("tot2", fontSize=9, fontName="Helvetica-Bold", textColor=TEXT, alignment=TA_CENTER, leading=11)),
        Paragraph(str(total_volumes), ParagraphStyle("tot3", fontSize=9, fontName="Helvetica-Bold", textColor=TEXT, alignment=TA_CENTER, leading=11)),
    ])
    ns_full = len(sum_rows)
    sum_tbl = Table(sum_rows, colWidths=[9*cm, 3*cm, 3*cm])
    sum_tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0),            HDR_BG),
        ("ROWBACKGROUNDS", (0, 1), (-1, ns_full - 2),  [ROW_ODD, ROW_EVEN]),
        ("BACKGROUND",     (0, ns_full-1), (-1, ns_full-1), TOTAL_BG),
        ("LINEABOVE",      (0, ns_full-1), (-1, ns_full-1), 1.0, ACCENT),
        ("VALIGN",         (0, 0), (-1, -1),            "MIDDLE"),
        ("TOPPADDING",     (0, 0), (-1, -1),            4),
        ("BOTTOMPADDING",  (0, 0), (-1, -1),            4),
        ("LEFTPADDING",    (0, 0), (-1, -1),            6),
        ("RIGHTPADDING",   (0, 0), (-1, -1),            6),
        ("GRID",           (0, 0), (-1, -1),            0.4, BORDER),
        ("BOX",            (0, 0), (-1, -1),            1.0, ACCENT),
    ]))
    story.append(sum_tbl)
    story.append(PageBreak())

    # ════════════════════════════════
    # PÁGINAS SEGUINTES — DETALHE
    # ════════════════════════════════
    story.append(Paragraph("Relatório de Expedição — Detalhe", s_title))
    story.append(Paragraph(
        f"{session.session_date.strftime('%d/%m/%Y')}  ·  "
        f"Total Pedidos: <b>{total_orders}</b>  ·  "
        f"Total Produtos: <b>{total_volumes}</b>",
        s_sub))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=6))

    # Colunas: seller | #NF | cliente | cod sku | nome produto | transportadora | qtd
    C7  = [1.8*cm, 1.6*cm, 3.5*cm, 2.4*cm, 5.0*cm, 2.9*cm, 0.8*cm]
    HDR7 = ["Seller", "# NF", "Cliente", "Cód SKU", "Nome Produto", "Transportadora", "Qtd"]

    seller_orders_map: dict = _dd(list)
    for order in orders:
        sname = order.seller.trade_name if order.seller else "—"
        seller_orders_map[sname].append(order)

    for seller_idx, sname in enumerate(sorted(seller_orders_map.keys())):
        s_orders = seller_orders_map[sname]
        seller_qty = sum(item.quantity for o in s_orders for item in o.items)

        if seller_idx > 0:
            story.append(PageBreak())

        rows  = []
        spans = []
        row_idx = 0
        qty_hi_rows = []

        for order in s_orders:
            nf         = order.nf_number or "—"
            cust       = order.customer_name or "—"
            carrier    = order.carrier or "—"
            items_list = order.items
            if not items_list:
                continue
            n_items = len(items_list)

            for i, item in enumerate(items_list):
                qty   = item.quantity
                is_hi = qty > 1
                q_style = ParagraphStyle(
                    "qhi" if is_hi else "qno",
                    fontSize=7.5, fontName="Helvetica-Bold",
                    textColor=QTY_FG if is_hi else TEXT, leading=10,
                )
                sku_p  = Paragraph(item.sku or "—",          s_bold if i == 0 else s_cell)
                prod_p = Paragraph(item.product_name or "—", s_cell)
                qty_p  = Paragraph(str(qty),                 q_style)
                carr_p = Paragraph(carrier,                  s_cell)

                tr = row_idx + 1  # offset for header row
                if is_hi:
                    qty_hi_rows.append(tr)

                if i == 0:
                    rows.append([
                        Paragraph(sname, s_sell),
                        Paragraph(nf,    s_bold),
                        Paragraph(cust,  s_cell),
                        sku_p, prod_p, carr_p, qty_p,
                    ])
                    if n_items > 1:
                        spans.append(("SPAN",   (0, tr), (0, tr + n_items - 1)))
                        spans.append(("SPAN",   (1, tr), (1, tr + n_items - 1)))
                        spans.append(("SPAN",   (2, tr), (2, tr + n_items - 1)))
                        spans.append(("SPAN",   (5, tr), (5, tr + n_items - 1)))
                        spans.append(("VALIGN", (0, tr), (2, tr + n_items - 1), "MIDDLE"))
                        spans.append(("VALIGN", (5, tr), (5, tr + n_items - 1), "MIDDLE"))
                else:
                    rows.append([
                        Paragraph("", s_cell),
                        Paragraph("", s_cell),
                        Paragraph("", s_cell),
                        sku_p, prod_p,
                        Paragraph("", s_cell),
                        qty_p,
                    ])
                row_idx += 1

        total_row_idx = row_idx + 1
        rows.append([
            Paragraph("", s_tot),
            Paragraph("", s_tot),
            Paragraph("", s_tot),
            Paragraph("", s_tot),
            Paragraph(f"Total {sname}  ·  {len(s_orders)} pedido(s)", s_tot),
            Paragraph("", s_tot),
            Paragraph(str(seller_qty), s_tot),
        ])

        header_row = [Paragraph(h, s_hdr) for h in HDR7]
        tdata = [header_row] + rows

        ts = TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),                    HDR_BG),
            ("ROWBACKGROUNDS", (0, 1), (-1, total_row_idx - 1),    [ROW_ODD, ROW_EVEN]),
            ("BACKGROUND",     (0, total_row_idx), (-1, total_row_idx), TOTAL_BG),
            ("LINEABOVE",      (0, total_row_idx), (-1, total_row_idx), 0.8, ACCENT),
            ("ALIGN",          (6, 0), (6, -1),                    "CENTER"),
            ("ALIGN",          (1, 0), (1, -1),                    "CENTER"),
            ("VALIGN",         (0, 0), (-1, -1),                   "TOP"),
            ("TOPPADDING",     (0, 0), (-1, -1),                   3),
            ("BOTTOMPADDING",  (0, 0), (-1, -1),                   3),
            ("LEFTPADDING",    (0, 0), (-1, -1),                   3),
            ("RIGHTPADDING",   (0, 0), (-1, -1),                   3),
            ("GRID",           (0, 0), (-1, -1),                   0.4, BORDER),
            ("BOX",            (0, 0), (-1, -1),                   1.0, ACCENT),
        ])
        for hi in qty_hi_rows:
            ts.add("BACKGROUND", (6, hi), (6, hi), QTY_HI)
        for sp in spans:
            ts.add(*sp)

        t = Table(tdata, colWidths=C7, repeatRows=1)
        t.setStyle(ts)
        story.append(t)
        story.append(Spacer(1, 10))

        # ── Romaneio por seller ──────────────────────────────────────────────

        # ── Romaneio por seller ──────────────────────────────────────────────
        # Agrupa por transportadora: conta NFs (volumes) e total de produtos
        carrier_map: dict = _dd(lambda: {"nfs": set(), "produtos": 0})
        for order in s_orders:
            carrier_key = order.carrier or "Sem Transportadora"
            carrier_map[carrier_key]["nfs"].add(order.nf_number or "ord{}".format(order.id))
            carrier_map[carrier_key]["produtos"] += sum(i.quantity for i in order.items)

        rom_title_style = ParagraphStyle(
            "romtit", fontSize=9, fontName="Helvetica-Bold",
            textColor=SUM_HDR, leading=12, spaceBefore=2, spaceAfter=4,
        )
        rom_hdr_style = ParagraphStyle(
            "romh", fontSize=8, fontName="Helvetica-Bold",
            textColor=HDR_FG, alignment=TA_CENTER, leading=10,
        )
        rom_cell_style = ParagraphStyle(
            "romc", fontSize=8, fontName="Helvetica", textColor=TEXT, leading=10,
        )
        rom_bold_style = ParagraphStyle(
            "romb", fontSize=8, fontName="Helvetica-Bold", textColor=TEXT,
            alignment=TA_CENTER, leading=10,
        )
        rom_tot_style = ParagraphStyle(
            "romt", fontSize=8, fontName="Helvetica-Bold", textColor=TEXT,
            alignment=TA_CENTER, leading=10,
        )
        sign_style = ParagraphStyle(
            "sign", fontSize=8, fontName="Helvetica",
            textColor=colors.HexColor("#555555"), leading=12,
        )

        story.append(Paragraph("Romaneio de Expedicao — {}".format(sname), rom_title_style))

        # Transportadora | Volumes | Assinatura (sem Total Produtos; assinatura por linha)
        sign_col_style = ParagraphStyle(
            "signcol", fontSize=7, fontName="Helvetica",
            textColor=colors.HexColor("#888888"), leading=10,
        )
        rom_hdr_row = [Paragraph(h, rom_hdr_style)
                       for h in ["Transportadora", "Volumes", "Assinatura"]]
        rom_rows = [rom_hdr_row]
        for carrier_name in sorted(carrier_map.keys()):
            cd = carrier_map[carrier_name]
            rom_rows.append([
                Paragraph(carrier_name, rom_cell_style),
                Paragraph(str(len(cd["nfs"])), rom_bold_style),
                Paragraph("", sign_col_style),  # espaco em branco para assinar
            ])
        # Linha de total (apenas volumes, sem produtos)
        tot_vols = sum(len(cd["nfs"]) for cd in carrier_map.values())
        rom_rows.append([
            Paragraph("TOTAL", ParagraphStyle("romtotl", fontSize=8,
                fontName="Helvetica-Bold", textColor=TEXT, leading=10)),
            Paragraph(str(tot_vols), rom_tot_style),
            Paragraph("", sign_col_style),
        ])

        n_rom = len(rom_rows)
        # Coluna assinatura larga para caber a rubrica
        rom_tbl = Table(rom_rows, colWidths=[6.0*cm, 2.5*cm, 6.0*cm])
        rom_tbl.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),              HDR_BG),
            ("ROWBACKGROUNDS", (0, 1), (-1, n_rom - 2),      [ROW_ODD, ROW_EVEN]),
            ("BACKGROUND",     (0, n_rom-1), (-1, n_rom-1),  TOTAL_BG),
            ("LINEABOVE",      (0, n_rom-1), (-1, n_rom-1),  0.8, ACCENT),
            ("ALIGN",          (1, 0), (1, -1),               "CENTER"),
            ("VALIGN",         (0, 0), (-1, -1),              "MIDDLE"),
            ("TOPPADDING",     (0, 0), (-1, -1),              6),
            ("BOTTOMPADDING",  (0, 0), (-1, -1),              6),
            ("LEFTPADDING",    (0, 0), (-1, -1),              5),
            ("RIGHTPADDING",   (0, 0), (-1, -1),              5),
            ("GRID",           (0, 0), (-1, -1),              0.4, BORDER),
            ("BOX",            (0, 0), (-1, -1),              1.0, ACCENT),
        ]))
        story.append(rom_tbl)
        story.append(Spacer(1, 8))

    story.append(HRFlowable(width="100%", thickness=1.0, color=ACCENT, spaceBefore=2))
    story.append(Paragraph(
        "<b>TOTAL GERAL:</b>  {} pedidos  ·  {} produtos".format(total_orders, total_volumes),
        ParagraphStyle("sgt", fontSize=10, fontName="Helvetica-Bold",
                       textColor=ACCENT, alignment=TA_RIGHT, leading=14)))

    doc.build(story)
    return output_path


# ════════════════════════════════════════════════════════════════
# Geração em memória (sem salvar em disco) — para download direto
# ════════════════════════════════════════════════════════════════

import re as _re
import tempfile as _tempfile


def generate_separation_bytes(
    session: models.PickingSession,
    db: Session,
    orders: list | None = None,
) -> tuple[bytes, str]:
    """
    Gera o PDF de separação em memória.
    Retorna (bytes_do_pdf, nome_do_arquivo).
    Nome inclui unidade antes dos sellers: SEPARACAO_YYYYMMDD_Unidade_SEL1_id.pdf
    """
    if orders is None:
        orders = db.query(models.Order).options(
            joinedload(models.Order.seller).joinedload(models.Seller.unit),
            joinedload(models.Order.items),
        ).filter(models.Order.session_id == session.id).all()

    unit_name = "SEM_UNIDADE"
    for o in orders:
        if o.seller and o.seller.unit:
            unit_name = o.seller.unit.name
            break

    safe_unit = _re.sub(r'[^\w\- ]', '', unit_name).strip().replace(' ', '_') or "SEM_UNIDADE"
    sellers_tag = _sellers_suffix(orders)
    filename = f"EXPEDICAO_{session.session_date.strftime('%Y%m%d')}_{safe_unit}_{sellers_tag}_{session.id}.pdf"

    with _tempfile.TemporaryDirectory() as tmpdir:
        path = generate_separation_report(session, db, tmpdir, orders=orders)
        with open(path, 'rb') as f:
            data = f.read()

    return data, filename


def generate_expedition_bytes(
    session: models.PickingSession,
    db: Session,
    orders: list | None = None,
) -> tuple[bytes, str]:
    """
    Gera o PDF de expedição em memória.
    Retorna (bytes_do_pdf, nome_do_arquivo).
    Nome inclui unidade antes dos sellers: EXPEDICAO_YYYYMMDD_Unidade_SEL1_id.pdf
    """
    if orders is None:
        orders = db.query(models.Order).options(
            joinedload(models.Order.seller).joinedload(models.Seller.unit),
            joinedload(models.Order.items),
        ).filter(models.Order.session_id == session.id).all()

    unit_name = "SEM_UNIDADE"
    for o in orders:
        if o.seller and o.seller.unit:
            unit_name = o.seller.unit.name
            break

    safe_unit = _re.sub(r'[^\w\- ]', '', unit_name).strip().replace(' ', '_') or "SEM_UNIDADE"
    sellers_tag = _sellers_suffix(orders)
    filename = f"SEPARACAO_{session.session_date.strftime('%Y%m%d')}_{safe_unit}_{sellers_tag}_{session.id}.pdf"

    with _tempfile.TemporaryDirectory() as tmpdir:
        path = generate_expedition_report(session, db, tmpdir, orders=orders)
        with open(path, 'rb') as f:
            data = f.read()

    return data, filename
