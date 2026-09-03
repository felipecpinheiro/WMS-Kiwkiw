"""
WMS Kiwkiw - E-mails do Acesso Protegido ao Financeiro (02/09/2026)
====================================================================
Só envio. As regras de quando enviar e para quem estão em
`backend/routers/billing_access.py`.

Envio via Gmail/SMTP com a biblioteca padrão (smtplib + STARTTLS) — zero
dependência nova. Lê as variáveis de ambiente NA HORA DA CHAMADA (não em
constante de módulo): evita depender da ordem exata entre `load_dotenv()`
(main.py) e o import deste módulo, e facilita testar sobrescrevendo o
ambiente por teste.

Modo dev/teste: se WMS_SMTP_USER ou WMS_SMTP_PASS não estiverem setados,
NÃO tenta SMTP — só imprime o código e os destinatários no console. É o
mecanismo de teste local pedido na especificação.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from ..timezone_utils import now_brasilia

# Identidade visual Kiwkiw (ver CLAUDE.md — PDF Generator)
_ROXO = "#7B63E8"
_VERDE = "#3DD9A4"
_FUNDO = "#14122A"


def _smtp_config() -> dict:
    return {
        "host": os.environ.get("WMS_SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.environ.get("WMS_SMTP_PORT", "587") or "587"),
        "user": os.environ.get("WMS_SMTP_USER", ""),
        "password": os.environ.get("WMS_SMTP_PASS", ""),
        "from_addr": os.environ.get("WMS_SMTP_FROM", ""),
    }


def approvers() -> list:
    """Lista fixa de responsáveis (WMS_BILLING_APPROVERS, separados por vírgula)."""
    raw = os.environ.get("WMS_BILLING_APPROVERS", "")
    return [e.strip() for e in raw.split(",") if e.strip()]


def _html_shell(title: str, body_html: str) -> str:
    return f"""\
<html><body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td style="background:{_FUNDO};padding:22px 28px;">
          <span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:{_VERDE};">KIWKIW</span>
          <div style="color:{_ROXO};font-size:13px;margin-top:2px;">WMS · Acesso ao Financeiro</div>
        </td></tr>
        <tr><td style="padding:28px;color:#26243f;font-size:14px;line-height:1.55;">
          <h2 style="margin:0 0 14px 0;color:{_FUNDO};font-size:17px;">{title}</h2>
          {body_html}
        </td></tr>
        <tr><td style="background:#f4f4f7;padding:14px 28px;color:#8a889c;font-size:11px;">
          WMS Kiwkiw — e-mail automático, não responda.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _send(subject: str, html: str, text: str, recipients: list) -> bool:
    """
    Envia (SMTP) ou, em modo dev sem credenciais, imprime no console.
    Retorna True se "enviou" (de verdade ou via console); deixa a exceção
    do smtplib subir para o chamador decidir o que fazer com a falha.
    """
    if not recipients:
        print(f"[billing_access] WMS_BILLING_APPROVERS vazio — nada a enviar. Assunto: {subject}")
        return False

    cfg = _smtp_config()
    if not cfg["user"] or not cfg["password"]:
        # Modo console (dev local, sem SMTP configurado)
        print(f"[billing_access] (modo console — sem SMTP configurado)")
        print(f"[billing_access] Assunto: {subject}")
        print(f"[billing_access] Destinatários: {', '.join(recipients)}")
        print(f"[billing_access] Texto:\n{text}")
        return True

    from_display = f"WMS Kiwkiw <{cfg['from_addr'] or cfg['user']}>"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_display
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as server:
        server.starttls()
        server.login(cfg["user"], cfg["password"])
        server.sendmail(cfg["from_addr"] or cfg["user"], recipients, msg.as_string())
    return True


def send_code_email(admin_name: str, admin_email: str, code: str) -> bool:
    """Envia o código de 6 dígitos aos responsáveis (WMS_BILLING_APPROVERS)."""
    agora = now_brasilia().strftime("%d/%m/%Y %H:%M")
    subject = f"Código de acesso ao Financeiro — pedido por {admin_name}"
    body_html = f"""
      <p><b>{admin_name}</b> ({admin_email}) pediu acesso à tela de Faturamento
      do WMS Kiwkiw em {agora} (horário de Brasília).</p>
      <p style="text-align:center;margin:26px 0;">
        <span style="display:inline-block;background:#f4f4f7;border:1px solid {_ROXO};
          border-radius:8px;padding:14px 26px;font-size:28px;letter-spacing:6px;
          font-weight:bold;color:{_FUNDO};">{code}</span>
      </p>
      <p>Vale por <b>10 minutos</b>. Se não foi você quem pediu, ignore este e-mail.</p>
    """
    text = (
        f"{admin_name} ({admin_email}) pediu acesso ao Financeiro do WMS Kiwkiw em {agora}.\n\n"
        f"Código: {code}\n\n"
        f"Vale por 10 minutos. Se não foi você, ignore este e-mail."
    )
    return _send(subject, _html_shell("Código de acesso ao Financeiro", body_html), text, approvers())


def send_alert_email(kind: str, admin_name: str, admin_email: str) -> bool:
    """
    Alerta de segurança para os responsáveis.
    kind: "5_erros" ou "mestre".
    """
    agora = now_brasilia().strftime("%d/%m/%Y %H:%M")
    if kind == "5_erros":
        subject = f"5 tentativas erradas de acesso ao Financeiro por {admin_name}"
        headline = "5 tentativas erradas seguidas"
        detail = (f"O usuário <b>{admin_name}</b> ({admin_email}) errou o código de acesso ao "
                   f"Financeiro 5 vezes seguidas em {agora} e foi bloqueado por 15 minutos.")
    else:
        subject = f"Acesso de emergência ao Financeiro usado por {admin_name}"
        headline = "Código-mestre utilizado"
        detail = (f"O usuário <b>{admin_name}</b> ({admin_email}) liberou o acesso ao Financeiro "
                   f"usando o código-mestre de emergência em {agora}.")
    body_html = f"<p><b>{headline}.</b></p><p>{detail}</p>"
    text = f"{headline}.\n\n{detail}"
    return _send(subject, _html_shell(headline, body_html), text, approvers())
