"""E2E: recebimentos de carga no faturamento (Fase 4). Uso: DATABASE_URL=... python tmp_test_billing_receipts.py"""
import os, sys, tempfile, datetime as dt
os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db").replace("\\", "/"))
sys.path.insert(0, os.getcwd())
from fastapi.testclient import TestClient
from backend.main import app
from backend import models
from backend.database import SessionLocal
from backend.auth import hash_password, create_access_token

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1; print("FALHOU:", name, extra)

def R(n): return round(float(n), 2)

with TestClient(app) as c:
    db = SessionLocal()
    unit = models.Unit(name="U1"); db.add(unit); db.flush()
    s1 = models.Seller(name="S1 LTDA", trade_name="S1", unit_id=unit.id, active=True)
    s2 = models.Seller(name="S2 LTDA", trade_name="S2", unit_id=unit.id, active=True)
    db.add_all([s1, s2]); db.flush()
    def mk(email, role, **kw):
        u = models.User(name=email, email=email, password_hash=hash_password("x"), role=role, active=True, **kw)
        db.add(u); db.flush(); return u
    cl = mk("c1@t", models.UserRole.CLIENT, seller_id=s1.id)
    mg = mk("mg@t", models.UserRole.MANAGER, unit_id=unit.id)
    op = mk("op@t", models.UserRole.OPERATOR, unit_id=unit.id)
    ad = db.query(models.User).filter_by(role=models.UserRole.ADMIN).first()
    # pedidos de saída B2C no mês 2026-10 do seller 1 (para regressão do cálculo existente)
    for i in range(2):
        db.add(models.Order(nf_number=f"N{i}", customer_name="x", order_date=dt.date(2026, 10, 10), seller_id=s1.id,
                            file_type=models.FileType.EXPORT, status=models.OrderStatus.COMPLETED,
                            imported_at=dt.datetime(2026, 10, 10, 10, 0), for_billing=True, box_used="1"))
    db.commit()
    H = lambda u: {"Authorization": "Bearer " + create_access_token(u)}
    hc, hm, ho, ha = H(cl), H(mg), H(op), H(ad)
    S1, S2 = s1.id, s2.id
    db.close()

    def receipt(seller_id, when, n=1):
        d = SessionLocal()
        a = models.InboundAppointment(seller_id=seller_id, scheduled_date=when.date(), period="MANHA",
                                      status="RECEBIDO", received_at=when, volumes_unknown=True, pallets_unknown=True)
        d.add(a); d.flush()
        o = models.Order(nf_number=f"R{a.id}", customer_name="x", order_date=when.date(), seller_id=seller_id,
                         file_type=models.FileType.IMPORT, status=models.OrderStatus.PENDING, inbound_appointment_id=a.id,
                         imported_at=when)
        d.add(o); d.flush()
        d.add(models.InboundNf(appointment_id=a.id, order_id=o.id, nf_number=f"R{a.id}", danfe_key=str(a.id).zfill(44), active=True))
        d.commit(); i = a.id; d.close(); return i

    def params(seller_id, **kw):
        body = dict(preco_unitario=10.0, min_pedidos=0)
        body.update(kw)
        return c.put(f"/billing/seller-params/{seller_id}", json=body, headers=ha)
    def closing(seller_id, month, h=None): return c.get(f"/billing/closing/{seller_id}/{month}", headers=h or ha)
    OCT = "2026-10"

    # ── padrão 0 e 0: sem cobrança ──
    for d in (5, 6, 7):
        receipt(S1, dt.datetime(2026, 10, d, 9, 0))
    check("params aceitos", params(S1).status_code == 200)
    p = closing(S1, OCT).json()
    f = p["fatura"]
    check("3 recebimentos contados, adicional 0", f["recebimentos"]["qtd"] == 3 and f["recebimentos"]["adicional"] == 0, f["recebimentos"])
    check("regressão: b2c_min = 2 NFs x 10", R(f["b2c_min"]) == 20.0, f)
    check("total = subtotais + adicional", R(f["total_geral"]) == R(f["subtotal_b2c"] + f["subtotal_b2b"] + f["recebimentos"]["adicional"]))
    check("lista de recebimentos no payload", len(p["recebimentos_list"]) == 3 and p["recebimentos_list"][0]["nfs"])

    # ── franquia 2, R$ 50 ──
    check("params com franquia", params(S1, franquia_recebimentos=2, valor_recebimento=50.0).status_code == 200)
    g = c.get(f"/billing/seller-params/{S1}", headers=ha).json()
    check("GET devolve os campos novos", g["franquia_recebimentos"] == 2 and g["valor_recebimento"] == 50.0, g)
    f = closing(S1, OCT).json()["fatura"]
    check("3 acima de 2 = 1 x 50", f["recebimentos"]["adicional"] == 50.0 and R(f["total_geral"]) == R(20 + 50), f)
    receipt(S1, dt.datetime(2026, 10, 8, 9, 0)); receipt(S1, dt.datetime(2026, 10, 9, 9, 0))
    f = closing(S1, OCT).json()["fatura"]
    check("5 acima de 2 = 3 x 50", f["recebimentos"]["qtd"] == 5 and f["recebimentos"]["adicional"] == 150.0, f)
    params(S1, franquia_recebimentos=5, valor_recebimento=50.0)
    check("exatamente na franquia = 0", closing(S1, OCT).json()["fatura"]["recebimentos"]["adicional"] == 0.0)
    params(S1, franquia_recebimentos=9, valor_recebimento=50.0)
    check("abaixo da franquia = 0", closing(S1, OCT).json()["fatura"]["recebimentos"]["adicional"] == 0.0)
    check("negativo recusado (franquia)", params(S1, franquia_recebimentos=-1).status_code == 422)
    check("negativo recusado (valor)", params(S1, valor_recebimento=-5).status_code == 422)
    check("recusa não alterou", c.get(f"/billing/seller-params/{S1}", headers=ha).json()["franquia_recebimentos"] == 9)

    # ── virada de mês (Brasília) ──
    params(S2, franquia_recebimentos=0, valor_recebimento=10.0)
    receipt(S2, dt.datetime(2026, 10, 31, 23, 59, 59))
    receipt(S2, dt.datetime(2026, 11, 1, 0, 0, 0))
    check("31/10 23:59:59 conta em outubro", closing(S2, OCT).json()["fatura"]["recebimentos"]["qtd"] == 1)
    check("01/11 00:00:00 conta em novembro", closing(S2, "2026-11").json()["fatura"]["recebimentos"]["qtd"] == 1)
    check("seller só com recebimento tem fatura (adicional 10)", closing(S2, OCT).json()["fatura"]["total_geral"] == 10.0)

    # ── fechar congela; reabrir volta a derivar ──
    params(S1, franquia_recebimentos=2, valor_recebimento=50.0)
    pre = closing(S1, OCT).json()["fatura"]
    r = c.post(f"/billing/closing/{S1}/{OCT}/close", headers=ha); check("fecha o mês", r.status_code == 200, r.text)
    cl_f = closing(S1, OCT).json()
    check("fechado: adicional congelado igual ao vivo", cl_f["fatura"]["recebimentos"]["adicional"] == pre["recebimentos"]["adicional"] == 150.0 and R(cl_f["fatura"]["total_geral"]) == R(pre["total_geral"]))
    check("fechado: franquia e valor congelados", cl_f["fatura"]["recebimentos"]["franquia"] == 2 and cl_f["fatura"]["recebimentos"]["valor_unit"] == 50.0)
    receipt(S1, dt.datetime(2026, 10, 20, 9, 0))
    params(S1, franquia_recebimentos=0, valor_recebimento=999.0)
    after = closing(S1, OCT).json()
    check("fechado imutável (novo recebimento + params mudados)", after["fatura"]["recebimentos"]["qtd"] == 5 and after["fatura"]["total_geral"] == cl_f["fatura"]["total_geral"] and len(after["recebimentos_list"]) == 5, after["fatura"]["recebimentos"])
    rc = c.get(f"/billing/receipts/{OCT}", headers=ha).json()
    row1 = next(x for x in rc["rows"] if x["seller_id"] == S1)
    check("aba: mês fechado lê o snapshot", row1["qtd"] == 5 and row1["adicional"] == 150.0 and row1["status"] == "closed" and len(row1["items"]) == 5, row1)
    check("aba: lista os 2 sellers do mês", {x["seller_id"] for x in rc["rows"]} == {S1, S2} and rc["total_qtd"] == 6, rc["total_qtd"])
    check("aba: total do adicional", R(rc["total_adicional"]) == R(150 + 10))
    r = c.post(f"/billing/closing/{S1}/{OCT}/reopen", headers=ha); check("reabre", r.status_code == 200, r.text)
    live = closing(S1, OCT).json()["fatura"]["recebimentos"]
    check("reaberto volta a derivar (6 recebimentos, params novos)", live["qtd"] == 6 and live["franquia"] == 0 and live["adicional"] == 6 * 999.0, live)
    params(S1, franquia_recebimentos=2, valor_recebimento=50.0)

    # ── mês fechado ANTES da feature (colunas nulas) ──
    c.post(f"/billing/closing/{S1}/{OCT}/close", headers=ha)
    d = SessionLocal()
    cl_row = d.query(models.BillingMonthlyClosing).filter_by(seller_id=S1, ref_month=OCT).first()
    tg_before = cl_row.t_total_geral
    cl_row.n_recebimentos = None; cl_row.t_recebimentos = None; cl_row.recebimentos_json = None
    cl_row.t_total_geral = tg_before - (cl_row.t_recebimentos or 0)  # antigo: sem adicional embutido
    d.commit(); d.close()
    old = closing(S1, OCT).json()
    check("fechamento antigo (nulo) = sem recebimentos", old["fatura"]["recebimentos"]["adicional"] == 0 and old["fatura"]["recebimentos"]["qtd"] == 0 and old["recebimentos_list"] == [])

    # ── visão do seller ──
    c.post(f"/billing/closing/{S1}/{OCT}/reopen", headers=ha)
    params(S1, franquia_recebimentos=2, valor_recebimento=50.0)
    open_me = c.get(f"/billing/my/{OCT}", headers=hc).json()
    admin_open = closing(S1, OCT).json()["fatura"]
    check("seller em mês aberto: sem linha de recebimentos", "recebimentos" not in open_me["fatura"] and "recebimentos_list" not in open_me)
    check("seller em mês aberto: total SEM o adicional", R(open_me["fatura"]["total_geral"]) == R(admin_open["total_geral"] - admin_open["recebimentos"]["adicional"]), (open_me["fatura"]["total_geral"], admin_open))
    check("seller não vê params", "params" not in open_me)
    c.post(f"/billing/closing/{S1}/{OCT}/close", headers=ha)
    closed_me = c.get(f"/billing/my/{OCT}", headers=hc).json()
    rec = closed_me["fatura"].get("recebimentos")
    check("seller em mês fechado: vê quantidade e valor", rec == {"qtd": 6, "adicional": 200.0}, rec)
    check("seller nunca vê franquia/valor unitário", "franquia" not in (rec or {}) and "valor_unit" not in (rec or {}) and "params" not in closed_me)
    check("seller mês fechado: total inclui o adicional", R(closed_me["fatura"]["total_geral"]) == R(closing(S1, OCT).json()["fatura"]["total_geral"]))
    pdf_me = c.get(f"/billing/my/{OCT}/pdf", headers=hc); xl_me = c.get(f"/billing/my/{OCT}/excel", headers=hc)
    check("PDF e Excel do seller 200", pdf_me.status_code == 200 and xl_me.status_code == 200)
    check("PDF do seller não traz a franquia", b"Franquia de recebimentos" not in pdf_me.content)
    check("seller sem recebimento: linha some", "recebimentos" not in c.get("/billing/my/2026-09", headers=hc).json()["fatura"])

    # ── documentos internos e consolidado ──
    check("PDF interno 200", c.get(f"/billing/closing/{S1}/{OCT}/pdf", headers=ha).status_code == 200)
    check("Excel interno 200", c.get(f"/billing/closing/{S1}/{OCT}/excel", headers=ha).status_code == 200)
    cons = c.get(f"/billing/consolidated/{OCT}", headers=ha).json()
    rows = cons["rows"] if isinstance(cons, dict) else cons
    r1 = next(x for x in rows if x["seller_id"] == S1)
    check("consolidado traz a coluna recebimentos", r1["recebimentos"] == 200.0 and r1["total"] >= 200.0, r1)
    check("consolidado: seller só com recebimento aparece com total", next(x for x in rows if x["seller_id"] == S2)["total"] == 10.0)
    check("consolidado Excel 200", c.get(f"/billing/consolidated/{OCT}/excel", headers=ha).status_code == 200)

    # ── permissões da aba ──
    check("manager sem acesso à aba (403)", c.get(f"/billing/receipts/{OCT}", headers=hm).status_code == 403)
    check("operador 403", c.get(f"/billing/receipts/{OCT}", headers=ho).status_code == 403)
    check("seller 403", c.get(f"/billing/receipts/{OCT}", headers=hc).status_code == 403)
    check("mês inválido recusado", c.get("/billing/receipts/2026-13", headers=ha).status_code in (400, 422))

    # ── aba em mês aberto (novembro) ──
    rcn = c.get("/billing/receipts/2026-11", headers=ha).json()
    check("aba em mês aberto é ao vivo", [x["seller_id"] for x in rcn["rows"]] == [S2] and rcn["rows"][0]["status"] == "open" and rcn["rows"][0]["adicional"] == 10.0, rcn)

print(f"\n{PASS} ok, {FAIL} falhas")
sys.exit(1 if FAIL else 0)
