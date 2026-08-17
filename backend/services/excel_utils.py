"""
WMS Kiwkiw - Conversão de .xls (formato antigo) para .xlsx.

openpyxl nunca leu .xls (só .xlsx/.xlsm) — quem lê o formato antigo é o xlrd.
Em vez de reescrever cada importador para dois motores, converte o .xls pra
.xlsx logo na entrada e deixa o resto do código (que só lê valores crus via
iter_rows/cell, sem fórmula/formatação) inalterado.
"""

import io

import pandas as pd


def _convert_xls_bytes(data: bytes) -> bytes:
    try:
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, engine="xlrd", header=None)
    except Exception as e:
        raise ValueError(f"Não consegui ler o arquivo .xls: {e}")

    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name[:31], header=False, index=False)
    return out.getvalue()


def ensure_xlsx_path(file_path: str) -> str:
    """Se `file_path` for .xls, converte e devolve o caminho do .xlsx novo (ao lado do original). Senão, devolve inalterado."""
    if not file_path.lower().endswith(".xls"):
        return file_path
    with open(file_path, "rb") as f:
        data = f.read()
    converted = _convert_xls_bytes(data)
    new_path = file_path[:-4] + ".xlsx"
    with open(new_path, "wb") as f:
        f.write(converted)
    return new_path


def ensure_xlsx_bytes(data: bytes, filename: str) -> bytes:
    """Se `filename` for .xls, devolve os bytes já convertidos para .xlsx. Senão, devolve `data` inalterado."""
    if not (filename or "").lower().endswith(".xls"):
        return data
    return _convert_xls_bytes(data)
