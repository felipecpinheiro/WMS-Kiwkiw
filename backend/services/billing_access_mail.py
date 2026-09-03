"""
WMS Kiwkiw - E-mails do Acesso Protegido ao Financeiro (02/09/2026)
====================================================================
Só envio. As regras de quando enviar e para quem estão em
`backend/routers/billing_access.py`.

Envio via **API do Gmail** (OAuth2), não SMTP nem Resend. Histórico
(04/09/2026): a primeira versão usava `smtplib`/Gmail — funcionava local,
mas o Railway bloqueia porta de SMTP fora do plano Pro (ver CLAUDE.md,
"Railway bloqueia SMTP"). A segunda versão trocou pra API HTTP do Resend
— funcionava, mas o dono queria mandar de uma conta Gmail pessoal
(`felipecspinheiro88@gmail.com`) pra qualquer destinatário, e o Resend só
permite isso com um domínio próprio verificado (não dá pra "verificar"
`gmail.com`, é do Google). A API do Gmail resolve as duas coisas: é HTTPS
(não esbarra no bloqueio do Railway) e manda de uma conta Gmail de
verdade pra qualquer destinatário, sem precisar de domínio.

Autorização: fluxo OAuth2 "installed app" feito **uma vez, manualmente**
(script de uso único, fora do repositório) — gera um `refresh_token` que
não expira sozinho (só se revogado manualmente ou se o app OAuth ficar
mais de 6 meses sem uso). As 3 variáveis (`WMS_GMAIL_CLIENT_ID`,
`WMS_GMAIL_CLIENT_SECRET`, `WMS_GMAIL_REFRESH_TOKEN`) vêm desse processo.

Lê as variáveis de ambiente NA HORA DA CHAMADA (não em constante de
módulo): evita depender da ordem exata entre `load_dotenv()` (main.py) e
o import deste módulo, e facilita testar sobrescrevendo o ambiente.

Modo dev/teste: se qualquer uma das 3 variáveis do Gmail não estiver
setada, NÃO tenta enviar — só imprime o código e os destinatários no
console. É o mecanismo de teste local pedido na especificação.
"""

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..timezone_utils import now_brasilia

# Identidade visual Kiwkiw (ver CLAUDE.md — PDF Generator)
_ROXO = "#7B63E8"
_VERDE = "#3DD9A4"
_FUNDO = "#14122A"

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


def _gmail_config() -> dict:
    return {
        "client_id": os.environ.get("WMS_GMAIL_CLIENT_ID", ""),
        "client_secret": os.environ.get("WMS_GMAIL_CLIENT_SECRET", ""),
        "refresh_token": os.environ.get("WMS_GMAIL_REFRESH_TOKEN", ""),
        # Formato completo do cabeçalho From, ex: "WMS Kiwkiw <felipecspinheiro88@gmail.com>".
        # O endereço TEM que ser o mesmo da conta que autorizou (Gmail recusa
        # remetente diferente) — só o nome de exibição pode variar.
        "from_header": os.environ.get("WMS_MAIL_FROM", ""),
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


def _gmail_access_token(cfg: dict) -> str:
    """Troca o refresh_token por um access_token de curta duração (não é cacheado
    de propósito — cada envio é raro o bastante pra não valer a complexidade)."""
    payload = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "refresh_token": cfg["refresh_token"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request(
        GOOGLE_TOKEN_URL, data=payload, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        tokens = json.loads(resp.read().decode("utf-8"))
    return tokens["access_token"]


def _send(subject: str, html: str, text: str, recipients: list) -> bool:
    """
    Envia via API do Gmail ou, em modo dev sem as 3 variáveis configuradas,
    imprime no console. Deixa a exceção subir pro chamador decidir o que
    fazer com a falha (ele é quem loga e devolve o 500 genérico pro usuário).
    """
    if not recipients:
        print(f"[billing_access] WMS_BILLING_APPROVERS vazio — nada a enviar. Assunto: {subject}")
        return False

    cfg = _gmail_config()
    if not (cfg["client_id"] and cfg["client_secret"] and cfg["refresh_token"]):
        # Modo console (dev local, sem Gmail configurado)
        print(f"[billing_access] (modo console — sem credenciais do Gmail configuradas)")
        print(f"[billing_access] Assunto: {subject}")
        print(f"[billing_access] Destinatários: {', '.join(recipients)}")
        print(f"[billing_access] Texto:\n{text}")
        return True

    access_token = _gmail_access_token(cfg)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["To"] = ", ".join(recipients)
    if cfg["from_header"]:
        msg["From"] = cfg["from_header"]
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    req = urllib.request.Request(
        GMAIL_SEND_URL,
        data=json.dumps({"raw": raw}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gmail API respondeu HTTP {e.code}: {body}") from e
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
