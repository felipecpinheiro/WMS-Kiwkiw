"""
WMS Kiwkiw - E-mails do Acesso Protegido ao Financeiro (02/09/2026)
====================================================================
Só envio. As regras de quando enviar e para quem estão em
`backend/routers/billing_access.py`.

Envio via API HTTP do Resend (https://resend.com), NÃO via SMTP.
Motivo (03/09/2026): Railway bloqueia saída em portas de SMTP
(465/587/2525) fora do plano Pro — confirmado em produção com
"OSError: Network is unreachable" testado direto no console do Railway.
A API do Resend é HTTPS (porta 443, sempre liberada), então não esbarra
nesse bloqueio. Usa só `urllib` (biblioteca padrão) — zero dependência
nova, mesma decisão de design do smtplib original.

Lê as variáveis de ambiente NA HORA DA CHAMADA (não em constante de
módulo): evita depender da ordem exata entre `load_dotenv()` (main.py) e
o import deste módulo, e facilita testar sobrescrevendo o ambiente.

Modo dev/teste: se WMS_RESEND_API_KEY não estiver setada, NÃO tenta
enviar — só imprime o código e os destinatários no console. É o
mecanismo de teste local pedido na especificação.

⚠️ Enquanto o domínio não for verificado no Resend, só é possível mandar
para o e-mail com que a conta do Resend foi criada (modo sandbox) — o
remetente também fica preso a `onboarding@resend.dev`. Depois de
verificar um domínio próprio (ex: kiwkiw.com.br), troque WMS_MAIL_FROM
para um endereço desse domínio; os destinatários deixam de ter restrição.
"""

import json
import os
import urllib.error
import urllib.request

from ..timezone_utils import now_brasilia

# Identidade visual Kiwkiw (ver CLAUDE.md — PDF Generator)
_ROXO = "#7B63E8"
_VERDE = "#3DD9A4"
_FUNDO = "#14122A"

RESEND_API_URL = "https://api.resend.com/emails"


def _resend_config() -> dict:
    return {
        "api_key": os.environ.get("WMS_RESEND_API_KEY", ""),
        "from_addr": os.environ.get("WMS_MAIL_FROM", "onboarding@resend.dev"),
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
    Envia via API do Resend ou, em modo dev sem chave configurada, imprime
    no console. Deixa a exceção subir pro chamador decidir o que fazer com
    a falha (ele é quem loga e devolve o 500 genérico pro usuário).
    """
    if not recipients:
        print(f"[billing_access] WMS_BILLING_APPROVERS vazio — nada a enviar. Assunto: {subject}")
        return False

    cfg = _resend_config()
    if not cfg["api_key"]:
        # Modo console (dev local, sem Resend configurado)
        print(f"[billing_access] (modo console — sem WMS_RESEND_API_KEY configurada)")
        print(f"[billing_access] Assunto: {subject}")
        print(f"[billing_access] Destinatários: {', '.join(recipients)}")
        print(f"[billing_access] Texto:\n{text}")
        return True

    payload = json.dumps({
        "from": f"WMS Kiwkiw <{cfg['from_addr']}>",
        "to": recipients,
        "subject": subject,
        "html": html,
        "text": text,
    }).encode("utf-8")

    req = urllib.request.Request(
        RESEND_API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
            # O Cloudflare na frente da API do Resend recusa (403, "error
            # code: 1010") o User-Agent padrão do urllib ("Python-urllib/x.y")
            # por parecer bot. Um valor comum resolve.
            "User-Agent": "wms-kiwkiw-billing-access/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resend respondeu HTTP {e.code}: {body}") from e
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
