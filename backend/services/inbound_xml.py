"""
Leitura do XML da NF-e para o Agendamento de Inbound (23/10/2026).

Só o XML é lido pelo sistema (PDF e Excel são anexo). Extrai número, chave de
acesso, emitente/destinatário (informativo) e os itens (cProd, xProd, qCom).

Segurança: o XML vem do seller. Em vez de depender de uma biblioteca nova,
RECUSA qualquer documento com DOCTYPE/ENTITY (a NF-e legítima nunca tem) — é o
que bloqueia "billion laughs" e resolução de entidade externa — e limita o
tamanho antes de parsear.
"""

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional

MAX_XML_BYTES = 5 * 1024 * 1024


class InboundXmlError(ValueError):
    """XML inválido/ilegível/não aceito. A mensagem é mostrada ao seller."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _find(node, path: str):
    """Busca por caminho de nomes locais (ignora namespace). 'a/b' = filho de filho."""
    cur = [node]
    for name in path.split("/"):
        nxt = []
        for n in cur:
            nxt.extend(c for c in n if _local(c.tag) == name)
        cur = nxt
        if not cur:
            return None
    return cur[0]


def _text(node, path: str) -> str:
    n = _find(node, path)
    return (n.text or "").strip() if n is not None and n.text else ""


def _norm_sku(raw: str) -> str:
    s = (raw or "").strip()
    # SKU numérico que passou por float ("123.0") vira texto sem o ".0"
    if re.fullmatch(r"\d+\.0+", s):
        s = s.split(".")[0]
    return s


def _qty(raw: str, sku: str) -> int:
    try:
        d = Decimal((raw or "").strip().replace(",", "."))
    except InvalidOperation:
        raise InboundXmlError(f"Quantidade inválida no item {sku}.")
    if d <= 0 or d != d.to_integral_value():
        raise InboundXmlError(
            f"Quantidade do item {sku} precisa ser um número inteiro maior que zero (veio {raw})."
        )
    return int(d)


def parse_nfe_xml(content: bytes) -> Dict:
    """
    Devolve {nf_number, danfe_key, issue_date, issuer, recipient, items:[{sku,name,quantity}]}.
    Soma SKUs repetidos na mesma NF. Levanta InboundXmlError com mensagem clara.
    """
    if not content or not content.strip():
        raise InboundXmlError("O arquivo XML está vazio.")
    if len(content) > MAX_XML_BYTES:
        raise InboundXmlError("O XML é grande demais (máximo 5 MB).")
    head = content.lower()
    if b"<!doctype" in head or b"<!entity" in head:
        raise InboundXmlError("XML não aceito: não pode conter DOCTYPE/ENTITY.")

    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        raise InboundXmlError("Não foi possível ler o XML. Confira se é o XML da NF-e.")

    inf = root if _local(root.tag) == "infNFe" else None
    if inf is None:
        for el in root.iter():
            if _local(el.tag) == "infNFe":
                inf = el
                break
    if inf is None:
        raise InboundXmlError("Este XML não é de uma NF-e (não encontrei infNFe).")

    key = (inf.get("Id") or "").strip()
    if key.upper().startswith("NFE"):
        key = key[3:]
    if not re.fullmatch(r"\d{44}", key):
        raise InboundXmlError("Chave de acesso da NF-e ausente ou inválida no XML.")

    modelo = _text(inf, "ide/mod")
    if modelo and modelo != "55":
        raise InboundXmlError(f"Só NF-e modelo 55 é aceita (este XML é modelo {modelo}).")

    nf_number = _text(inf, "ide/nNF")
    if not nf_number:
        raise InboundXmlError("Número da NF (nNF) não encontrado no XML.")
    nf_number = nf_number.lstrip("0") or "0"
    if len(nf_number) > 20:
        raise InboundXmlError("Número da NF grande demais.")

    issue: Optional[date] = None
    raw_dt = _text(inf, "ide/dhEmi") or _text(inf, "ide/dEmi")
    if raw_dt:
        try:
            issue = datetime.fromisoformat(raw_dt[:10]).date()
        except ValueError:
            issue = None

    items: List[Dict] = []
    index: Dict[str, Dict] = {}
    for det in (c for c in inf if _local(c.tag) == "det"):
        prod = _find(det, "prod")
        if prod is None:
            continue
        sku = _norm_sku(_text(prod, "cProd"))
        if not sku:
            raise InboundXmlError("Item da NF sem código de produto (cProd).")
        if len(sku) > 100:
            raise InboundXmlError(f"SKU {sku[:20]}... grande demais.")
        qty = _qty(_text(prod, "qCom"), sku)
        name = (_text(prod, "xProd") or sku)[:300]

        # <rastro> (03/11/2026, Controle de Vencimentos): lote/validade da NF-e.
        # Zero ou mais blocos por item; `dVal`/`dFab` em ISO. Nunca derruba o
        # parser existente — qualquer problema vira lista vazia.
        tracks: List[Dict] = []
        for tr in prod.findall("*") if prod is not None else []:
            if _local(tr.tag) != "rastro":
                continue
            dval = None
            dfab = None
            raw_dval = _text(tr, "dVal")
            raw_dfab = _text(tr, "dFab")
            if raw_dval:
                try:
                    dval = datetime.fromisoformat(raw_dval[:10]).date()
                except ValueError:
                    dval = None
            if raw_dfab:
                try:
                    dfab = datetime.fromisoformat(raw_dfab[:10]).date()
                except ValueError:
                    dfab = None
            qlote_raw = _text(tr, "qLote")
            qlote = None
            try:
                qlote = int(float(qlote_raw)) if qlote_raw else None
            except ValueError:
                qlote = None
            tracks.append({
                "lote":  (_text(tr, "nLote") or None),
                "d_val": dval,
                "d_fab": dfab,
                "q_lote": qlote,
            })

        if sku in index:
            index[sku]["quantity"] += qty
            index[sku]["tracks"].extend(tracks)
        else:
            it = {"sku": sku, "name": name, "quantity": qty, "tracks": tracks}
            index[sku] = it
            items.append(it)
    if not items:
        raise InboundXmlError("A NF não tem nenhum item.")

    return {
        "nf_number": nf_number,
        "danfe_key": key,
        "issue_date": issue,
        "issuer": _text(inf, "emit/xNome"),
        "recipient": _text(inf, "dest/xNome"),
        "items": items,
    }
