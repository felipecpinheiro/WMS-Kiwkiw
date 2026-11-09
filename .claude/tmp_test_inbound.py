"""E2E do Agendamento de Inbound (Fase 1). Uso: DATABASE_URL=... python test_inbound.py"""
import io, os, sys, datetime as dt, tempfile
os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db").replace("\\", "/"))
sys.path.insert(0, os.getcwd())
from fastapi.testclient import TestClient
from backend.main import app
from backend import models
from backend.database import SessionLocal, init_db
from backend.auth import hash_password, create_access_token
from backend.timezone_utils import today_brasilia

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1; print("FALHOU:", name, extra)

def nfe(key, nnf, items, mod="55"):
    its = "".join(f'<det nItem="{i+1}"><prod><cProd>{s}</cProd><xProd>Prod {s}</xProd><qCom>{q}.0000</qCom></prod></det>' for i,(s,q) in enumerate(items))
    return (f'<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe{key}">'
            f'<ide><mod>{mod}</mod><nNF>{nnf}</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>'
            f'<emit><xNome>Fornecedor X</xNome></emit><dest><xNome>Kiwkiw</xNome></dest>{its}</infNFe></NFe></nfeProc>').encode()
PDF = b"%PDF-1.4 fake"
def key(n): return str(n).zfill(44)

def next_bday(offset=1):
    d = today_brasilia(); n = 0
    while True:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
            if n == offset: return d

with TestClient(app) as c:
    db = SessionLocal()
    unit = models.Unit(name="U1"); db.add(unit); db.flush()
    s1 = models.Seller(name="S1 LTDA", trade_name="S1", unit_id=unit.id, active=True)
    s2 = models.Seller(name="S2 LTDA", trade_name="S2", unit_id=unit.id, active=True)
    s3 = models.Seller(name="S3 LTDA", trade_name="S3", unit_id=None, active=True)
    db.add_all([s1, s2, s3]); db.flush()
    for s, sku in ((s1, "AAA"), (s1, "BBB"), (s2, "AAA")):
        db.add(models.Product(seller_id=s.id, sku=sku, name=sku, barcode_seller="BC" + sku + str(s.id), active=True))
    def mk(email, role, **kw):
        u = models.User(name=email, email=email, password_hash=hash_password("x"), role=role, active=True, **kw)
        db.add(u); db.flush(); return u
    c1 = mk("c1@t", models.UserRole.CLIENT, seller_id=s1.id)
    c2 = mk("c2@t", models.UserRole.CLIENT, seller_id=s2.id)
    c3 = mk("c3@t", models.UserRole.CLIENT, seller_id=s3.id)
    mg = mk("mg@t", models.UserRole.MANAGER, unit_id=unit.id); mg.sellers = [s1]
    op = mk("op@t", models.UserRole.OPERATOR, unit_id=unit.id); op.sellers = [s1]
    ad = mk("ad@t", models.UserRole.ADMIN)
    db.commit()
    H = lambda u: {"Authorization": "Bearer " + create_access_token(u)}
    h1, h2, h3, hm, ho, ha = H(c1), H(c2), H(c3), H(mg), H(op), H(ad)
    ids = dict(s1=s1.id, s3=s3.id)
    db.close()

    D = str(next_bday(2))
    def post(h, fields=None, files=None, url="/inbound"):
        f = {"scheduled_date": D, "period": "MANHA", "volumes": "10", "pallets": "2"}
        f.update(fields or {})
        fl = {}
        for k, v in (files or {}).items():
            fl[k] = (k + (".pdf" if "pdf" in k else ".xml" if "xml" in k else ".xlsx"), v)
        return c.post(url, data=f, files=fl or None, headers=h)
    good = lambda n, items=(("AAA", 5), ("BBB", 3)): {f"nf{n}_pdf": PDF, f"nf{n}_xml": nfe(key(n + 100), 1000 + n, list(items))}
    def counts():
        d = SessionLocal()
        r = (d.query(models.InboundAppointment).count(), d.query(models.Order).count(), d.query(models.InboundFile).count())
        d.close(); return r

    # ── criação ──
    r = post(h1, files=good(0)); check("cria 201", r.status_code == 201, r.text)
    A = r.json(); check("status AGENDADO", A["status"] == "AGENDADO")
    check("nf_count 1", A["nf_count"] == 1)
    check("cliente sem warnings", "warnings" not in A)
    d = SessionLocal()
    o = d.query(models.Order).first()
    check("order entrada sem sessão", o.session_id is None and o.file_type == models.FileType.IMPORT and o.inbound_appointment_id == A["id"])
    check("itens criados", d.query(models.OrderItem).filter_by(order_id=o.id).count() == 2)
    check("estoque intocado", d.query(models.StockMovement).count() == 0 and o.stock_applied_at is None)
    check("auditoria CREATE", d.query(models.AuditLog).filter_by(entity_type="InboundAppointment", action="CREATE").count() == 1)
    d.close()

    before = counts()
    base = lambda **kw: post(h1, fields=kw.pop("fields", None), files=kw.pop("files", None) or good(5))
    cases = {
        "fim de semana": ({"scheduled_date": str(next(x for x in (today_brasilia()+dt.timedelta(days=i) for i in range(1,10)) if x.weekday()==5))}, None),
        "passado": ({"scheduled_date": "2020-01-06"}, None),
        "longe demais": ({"scheduled_date": str(today_brasilia()+dt.timedelta(days=90))}, None),
        "periodo inválido": ({"period": "NOITE"}, None),
        "sem volumes": ({"volumes": ""}, None),
        "volumes negativo": ({"volumes": "-1"}, None),
        "sem xml": ({}, {"nf0_pdf": PDF}),
        "xml vazio": ({}, {"nf0_pdf": PDF, "nf0_xml": b"  "}),
        "xml lixo": ({}, {"nf0_pdf": PDF, "nf0_xml": b"<a>"}),
        "xml doctype": ({}, {"nf0_pdf": PDF, "nf0_xml": b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'}),
        "modelo 65": ({}, {"nf0_pdf": PDF, "nf0_xml": nfe(key(8), 8, [("AAA", 1)], mod="65")}),
        "qtd fracionada": ({}, {"nf0_pdf": PDF, "nf0_xml": nfe(key(9), 9, [("AAA", 1)]).replace(b"1.0000", b"1.5")}),
        "pdf falso": ({}, {"nf0_pdf": b"nao e pdf", "nf0_xml": nfe(key(10), 10, [("AAA", 1)])}),
        "arquivo > 10MB": ({}, {"nf0_pdf": b"%PDF-" + b"0" * (10 * 1024 * 1024 + 1), "nf0_xml": nfe(key(11), 11, [("AAA", 1)])}),
        "nf duplicada": ({}, good(0)),
        "sem nf": ({}, {}),
    }
    for name, (fields, files) in cases.items():
        r = post(h1, fields=fields, files=files if files is not None else good(5)) if name != "sem nf" else post(h1)
        check("recusa: " + name, r.status_code in (400, 413), f"{r.status_code} {r.text[:120]}")
    check("recusas não alteraram nada", counts() == before, f"{before} -> {counts()}")
    r = post(h1, files={**good(1), **good(2)}); check("2 NFs ok", r.status_code == 201 and r.json()["nf_count"] == 2, r.text)
    r = post(h1, files={**good(3), "nf1_pdf": PDF, "nf1_xml": nfe(key(103), 9999, [("AAA", 1)])})
    check("mesma chave 2x no lote recusa", r.status_code == 400, r.text)
    check("lote recusado não deixou nada", counts()[0] == 2)
    r = post(h1, fields={"volumes": "", "volumes_unknown": "true", "pallets": "", "pallets_unknown": "true"}, files=good(4))
    check("'Não sei' aceito", r.status_code == 201 and r.json()["volumes_unknown"] and r.json()["volumes"] is None, r.text)
    r = post(ha, files=good(20)); check("admin não cria", r.status_code == 403)
    r = post(hm, files=good(20)); check("manager não cria", r.status_code == 403)
    r = post(ho, files=good(20)); check("operator não cria", r.status_code == 403)
    r = c.post("/inbound", data={}, headers={}); check("sem token", r.status_code in (401, 403))
    r = post(h2, files={"nf0_pdf": PDF, "nf0_xml": nfe(key(100), 55, [("AAA", 1)])})
    check("chave de outro seller bloqueia", r.status_code == 400, r.text)
    r = post(h2, files={"nf0_pdf": PDF, "nf0_xml": nfe(key(500), 55, [("AAA", 1)])}); check("seller2 cria", r.status_code == 201)
    A2 = r.json()
    r = post(h3, files={"nf0_pdf": PDF, "nf0_xml": nfe(key(600), 66, [("ZZZ", 1)])}); check("seller sem unidade cria", r.status_code == 201)
    A3 = r.json()

    # ── escopo ──
    check("seller1 não vê do seller2", c.get(f"/inbound/{A2['id']}", headers=h1).status_code == 404)
    lst = c.get("/inbound", headers=h1).json(); check("lista só do seller", all(x["seller_id"] == ids["s1"] for x in lst) and len(lst) == 3, len(lst))
    check("manager vê todos os sellers (igual Manuseios)", {x["seller_id"] for x in c.get("/inbound", headers=hm).json()} == {ids["s1"], ids["s3"], A2["seller_id"]})
    check("manager abre de outro seller", c.get(f"/inbound/{A2['id']}", headers=hm).status_code == 200)
    check("operador só vê sellers vinculados", {x["seller_id"] for x in c.get("/inbound", headers=ho).json()} == {ids["s1"]})
    check("operador 404 fora do vínculo", c.get(f"/inbound/{A2['id']}", headers=ho).status_code == 404)
    lo = c.get("/inbound", headers=ho).json()
    check("operador: lista simples sem anexos/avisos/obs", all("warnings" not in x and "notes" not in x and all("files" not in nf and "danfe_key" not in nf for nf in x.get("nfs", [])) for x in lo))
    check("filtro sem unidade", [x["seller_id"] for x in c.get("/inbound?no_unit=true", headers=ha).json()] == [A3["seller_id"]])
    check("filtro por unidade exclui sem unidade", ids["s3"] not in {x["seller_id"] for x in c.get("/inbound?unit_id=1", headers=ha).json()})
    check("filtro por período", all(x["scheduled_date"] >= D for x in c.get(f"/inbound?date_from={D}", headers=ha).json()))
    sm = c.get("/inbound/summary", headers=hm).json()
    check("selo (badge) inclui os da semana e atrasados", sm["badge"] >= sm["week_scheduled"] and sm["badge"] >= sm["overdue"], sm)
    check("operador tem summary", "badge" in c.get("/inbound/summary", headers=ho).json())
    check("seller tem summary só do próprio seller", c.get("/inbound/summary", headers=h2).json()["badge"] <= 1)
    check("admin vê tudo", len(c.get("/inbound", headers=ha).json()) == 5)
    ol = c.get(f"/inbound/{A['id']}", headers=ho).json()
    check("operador: tela simples", "notes" not in ol and ol["status"] == "AGENDADO" and all("files" not in nf for nf in ol.get("nfs", [])))
    fid = c.get(f"/inbound/{A['id']}", headers=h1).json()["nfs"][0]["files"][0]["id"]
    check("seller baixa anexo", c.get(f"/inbound/files/{fid}", headers=h1).status_code == 200)
    check("outro seller não baixa", c.get(f"/inbound/files/{fid}", headers=h2).status_code == 404)
    check("operador não baixa", c.get(f"/inbound/files/{fid}", headers=ho).status_code == 403)
    sm = c.get("/inbound/summary", headers=h1).json(); check("summary", "week_scheduled" in sm and "overdue" in sm)
    w = c.get(f"/inbound/{A3['id']}", headers=ha).json()["warnings"]
    check("aviso sem unidade + sem produto", {x["type"] for x in w} >= {"seller_without_unit", "missing_product"}, w)
    # ── produtos de cada NF (tela interna) ──
    d3 = c.get(f"/inbound/{A3['id']}", headers=ha).json()
    it3 = d3["nfs"][0]["items"]
    check("manager/admin: NF traz produtos com SKU, nome e quantidade", it3 and {"sku", "name", "quantity", "status"} <= set(it3[0]), it3)
    check("SKU sem cadastro sinalizado", it3[0]["sku"] == "ZZZ" and it3[0]["status"] == "sem_cadastro", it3)
    check("resumo de SKUs e unidades", d3["nfs"][0]["items_skus"] == len(it3) and d3["nfs"][0]["items_units"] == sum(i["quantity"] for i in it3))
    lst_items = c.get("/inbound", headers=ha).json()
    check("lista também traz os produtos", all("items" in nf for a_ in lst_items for nf in a_["nfs"]))
    first = c.get(f"/inbound/{A['id']}", headers=hm).json()["nfs"][0]
    check("SKU cadastrado = ok", all(i["status"] == "ok" for i in first["items"]) and first["items"][0]["quantity"] > 0, first["items"])
    op_d = c.get(f"/inbound/{A['id']}", headers=ho).json()
    check("operador vê produtos e quantidades", op_d["nfs"][0]["items"] and op_d["nfs"][0]["items"][0]["quantity"] > 0)
    check("operador continua sem anexos/chave/obs", all("files" not in nf and "danfe_key" not in nf for nf in op_d["nfs"]) and "notes" not in op_d)
    check("seller não recebe o campo items (inalterado)", all("items" not in nf for nf in c.get(f"/inbound/{A['id']}", headers=h1).json()["nfs"]))

    # ── edição / reagendamento ──
    D2 = str(next_bday(3))
    r = c.put(f"/inbound/{A['id']}", json={"scheduled_date": D2, "period": "TARDE", "notes": "oi"}, headers=h1)
    check("reagenda", r.status_code == 200 and r.json()["scheduled_date"] == D2 and r.json()["period"] == "TARDE", r.text)
    r = c.put(f"/inbound/{A['id']}", json={"scheduled_date": "2020-01-06"}, headers=h1); check("reagenda passado recusa", r.status_code == 400)
    check("reagendar não mudou", c.get(f"/inbound/{A['id']}", headers=h1).json()["scheduled_date"] == D2)
    check("outro seller não edita", c.put(f"/inbound/{A['id']}", json={"notes": "x"}, headers=h2).status_code == 404)
    check("operador não edita", c.put(f"/inbound/{A['id']}", json={"notes": "x"}, headers=ho).status_code == 403)
    r = c.put(f"/inbound/{A['id']}", json={"volumes": 7}, headers=h1); check("volumes 7 limpa 'não sei'", r.json()["volumes"] == 7 and not r.json()["volumes_unknown"])
    # troca de XML recria itens
    nf0 = c.get(f"/inbound/{A['id']}", headers=h1).json()["nfs"][0]["id"]
    r = c.put(f"/inbound/{A['id']}/nfs/{nf0}/files", files={"nf0_xml": ("n.xml", nfe(key(100), 1000, [("AAA", 9)]))}, headers=h1)
    check("troca XML ok", r.status_code == 200, r.text)
    d = SessionLocal(); its = d.query(models.OrderItem).join(models.Order).filter(models.Order.inbound_appointment_id == A["id"]).all()
    check("itens recriados", len(its) == 1 and its[0].quantity == 9); d.close()
    r = c.put(f"/inbound/{A['id']}/nfs/{nf0}/files", files={"nf0_xml": ("n.xml", nfe(key(101), 1001, [("AAA", 9)]))}, headers=h1)
    check("troca XML p/ chave já usada recusa", r.status_code == 400, r.text)
    r = c.post(f"/inbound/{A['id']}/nfs", files={"nf0_pdf": ("a.pdf", PDF), "nf0_xml": ("a.xml", nfe(key(700), 700, [("BBB", 2)]))}, headers=h1)
    check("adiciona NF", r.status_code == 201 and r.json()["nf_count"] == 2, r.text)
    nf_new = r.json()["nfs"][1]["id"]
    r = c.delete(f"/inbound/{A['id']}/nfs/{nf_new}", headers=h1); check("remove NF", r.status_code == 200 and r.json()["nf_count"] == 1)
    r = c.delete(f"/inbound/{A['id']}/nfs/{nf0}", headers=h1); check("não remove a última NF", r.status_code == 400)
    r = c.put(f"/inbound/{A['id']}/nfs/{nf0}/files", files={"nf0_pdf": ("a.pdf", b"x")}, headers=h1); check("pdf inválido na troca", r.status_code == 400)

    # ── cancelar ──
    B = c.get("/inbound", headers=h1).json()
    ap_cancel = next(x for x in B if x["nf_count"] == 2)
    r = c.post(f"/inbound/{ap_cancel['id']}/cancel", json={"reason": "mudou"}, headers=h1)
    check("cancela", r.status_code == 200 and r.json()["status"] == "CANCELADO", r.text)
    d = SessionLocal()
    check("orders cancelados", d.query(models.Order).filter(models.Order.inbound_appointment_id == ap_cancel["id"], models.Order.status != models.OrderStatus.CANCELLED).count() == 0)
    d.close()
    check("cancelar de novo = 409", c.post(f"/inbound/{ap_cancel['id']}/cancel", json={}, headers=h1).status_code == 409)
    check("editar cancelado = 409", c.put(f"/inbound/{ap_cancel['id']}", json={"notes": "x"}, headers=h1).status_code == 409)
    r = post(h1, files={"nf0_pdf": PDF, "nf0_xml": nfe(key(101), 5000, [("AAA", 1)])})
    check("chave de cancelado fica livre", r.status_code == 201, r.text)

    # ── receber ──
    check("seller não recebe", c.post(f"/inbound/{A['id']}/receive", headers=h1).status_code == 403)
    check("operador não recebe", c.post(f"/inbound/{A['id']}/receive", headers=ho).status_code == 403)
    r = c.post(f"/inbound/{A3['id']}/receive", headers=ha); check("seller sem unidade não recebe", r.status_code == 409, r.text)
    d = SessionLocal(); o = d.query(models.Order).filter(models.Order.inbound_appointment_id == A["id"], models.Order.status != models.OrderStatus.CANCELLED).first(); oid = o.id
    d.close()
    r = c.post("/scanning/scan", json={"session_id": 1, "order_id": oid, "barcode": "BCAAA1", "operator_id": 1}, headers=ho)
    check("bipar antes de receber é recusado", r.status_code == 200 and r.json()["success"] is False and r.json()["status"] == "inbound_not_received", r.text)
    r = c.post(f"/inbound/{A['id']}/receive", headers=hm); check("manager recebe", r.status_code == 200 and r.json()["status"] == "RECEBIDO", r.text)
    check("receber de novo = 409", c.post(f"/inbound/{A['id']}/receive", headers=hm).status_code == 409)
    check("seller não edita após recebido", c.put(f"/inbound/{A['id']}", json={"notes": "x"}, headers=h1).status_code == 409)
    check("seller não cancela após recebido", c.post(f"/inbound/{A['id']}/cancel", json={}, headers=h1).status_code == 409)
    check("seller não troca arquivo após recebido", c.put(f"/inbound/{A['id']}/nfs/{nf0}/files", files={"nf0_pdf": ("a.pdf", PDF)}, headers=h1).status_code == 409)
    d = SessionLocal(); o = d.get(models.Order, oid); sid = o.session_id
    sess = d.get(models.PickingSession, sid)
    check("sessão de entrada criada", sid is not None and sess.total_orders == 1 and sess.file_type == models.FileType.IMPORT and sess.unit_id)
    check("estoque ainda intocado", d.query(models.StockMovement).count() == 0); d.close()
    sc = c.get("/scanning/session-cards", headers=ho).json()
    check("vira card de manuseio", any(x.get("session_id") == sid or x.get("id") == sid for x in sc) or len(sc) >= 1, sc[:1])

    ro = c.get(f"/scanning/sessions/{sid}/orders?seller_id={ids['s1']}", headers=ho)
    check("lista de pedidos da sessão (tela de bipagem) carrega", ro.status_code == 200, ro.text[:300])
    if ro.status_code == 200:
        check("a NF do agendamento aparece na lista", any(o_["id"] == oid for o_ in ro.json().get("orders", ro.json() if isinstance(ro.json(), list) else [])), str(ro.json())[:200])
    # ── conferência ──
    r = c.post(f"/scanning/sessions/{sid}/open-by-nfe", json={"nfe_key": key(100)}, headers=ho)
    check("abre NF", r.json().get("success") is True, r.text)
    check("-> EM_CONFERENCIA", c.get(f"/inbound/{A['id']}", headers=h1).json()["status"] == "EM_CONFERENCIA")
    r = c.post("/scanning/scan", json={"session_id": sid, "order_id": oid, "barcode": "BCAAA" + str(ids["s1"]), "operator_id": 1, "quantity": 7}, headers=ho)
    check("bipa 7 (esperado 9)", r.status_code == 200 and r.json()["success"], r.text)
    check("ainda não conferido", c.get(f"/inbound/{A['id']}", headers=h1).json()["status"] == "EM_CONFERENCIA")
    r = c.post(f"/scanning/orders/{oid}/finalize-entry", json={}, headers=ho); check("preview não grava", r.status_code == 200 and r.json()["confirmed"] is False)
    d = SessionLocal(); check("preview sem estoque", d.query(models.StockMovement).count() == 0); d.close()
    check("preview não conclui", c.get(f"/inbound/{A['id']}", headers=h1).json()["status"] == "EM_CONFERENCIA")
    r = c.post(f"/scanning/orders/{oid}/finalize-entry", json={"confirm": True}, headers=ho); check("finaliza", r.status_code == 200 and r.json()["stock_applied"], r.text)
    det = c.get(f"/inbound/{A['id']}", headers=h1).json()
    check("-> CONFERIDO", det["status"] == "CONFERIDO", det["status"])
    row = det["stock_summary"][0]
    check("resumo esperado x entrou", row["expected"] == 9 and row["entered"] == 7 and row["divergent"] and det["has_divergence"], det["stock_summary"])
    ol = c.get(f"/inbound/{A['id']}", headers=ho).json()
    check("operador vê resumo após conferido", ol["status"] == "CONFERIDO" and ol["stock_summary"][0]["entered"] == 7)
    d = SessionLocal(); st = d.query(models.StockPosition).filter_by(seller_id=ids["s1"], sku="AAA").first()
    check("estoque entrou pela contagem", st is not None and st.current_stock == 7, getattr(st, "current_stock", None)); d.close()

    # ── várias NFs: só vira Conferido com todas ──
    mA = post(h1, files={**good(30), **good(31)}).json()
    check("multi criado", mA["nf_count"] == 2)
    c.post(f"/inbound/{mA['id']}/receive", headers=hm)
    d = SessionLocal(); os_ = d.query(models.Order).filter_by(inbound_appointment_id=mA["id"]).order_by(models.Order.id).all()
    o1, o2, msid = os_[0].id, os_[1].id, os_[0].session_id; k1 = os_[0].danfe_key; d.close()
    c.post(f"/scanning/sessions/{msid}/open-by-nfe", json={"nfe_key": k1}, headers=ho)
    c.post("/scanning/scan", json={"session_id": msid, "order_id": o1, "barcode": "BCAAA1", "operator_id": 1, "quantity": 5}, headers=ho)
    c.post("/scanning/scan", json={"session_id": msid, "order_id": o1, "barcode": "BCBBB1", "operator_id": 1, "quantity": 3}, headers=ho)
    c.post(f"/scanning/orders/{o1}/finalize-entry", json={"confirm": True}, headers=ho)
    check("1 de 2 finalizada = ainda EM_CONFERENCIA", c.get(f"/inbound/{mA['id']}", headers=h1).json()["status"] == "EM_CONFERENCIA")
    c.post(f"/scanning/sessions/{msid}/open-by-nfe", json={"nfe_key": os_[1].danfe_key}, headers=ho)
    c.post("/scanning/scan", json={"session_id": msid, "order_id": o2, "barcode": "BCAAA1", "operator_id": 1, "quantity": 5}, headers=ho)
    c.post(f"/scanning/orders/{o2}/finalize-entry", json={"confirm": True}, headers=ho)
    check("2 de 2 = CONFERIDO", c.get(f"/inbound/{mA['id']}", headers=h1).json()["status"] == "CONFERIDO")

    # ── regressão: NF de entrada comum (fora de agendamento) intacta ──
    d = SessionLocal()
    sess = models.PickingSession(session_date=today_brasilia(), unit_id=1, status=models.OrderStatus.PENDING, total_orders=1, file_type=models.FileType.IMPORT)
    d.add(sess); d.flush()
    oo = models.Order(nf_number="ORD1", customer_name="x", order_date=today_brasilia(), seller_id=ids["s1"], file_type=models.FileType.IMPORT, session_id=sess.id, status=models.OrderStatus.PENDING)
    d.add(oo); d.flush(); d.add(models.OrderItem(order_id=oo.id, sku="AAA", product_name="A", quantity=2)); d.commit()
    oo_id, sess_id = oo.id, sess.id; d.close()
    c.post(f"/scanning/sessions/{sess_id}/open-by-nfe", json={"nfe_key": "ORD1"}, headers=ho)
    c.post("/scanning/scan", json={"session_id": sess_id, "order_id": oo_id, "barcode": "BCAAA" + str(ids["s1"]), "operator_id": 1, "quantity": 2}, headers=ho)
    r = c.post(f"/scanning/orders/{oo_id}/finalize-entry", json={"confirm": True}, headers=ho)
    check("entrada comum continua finalizando", r.status_code == 200 and r.json()["stock_applied"], r.text)
    d = SessionLocal(); check("auditoria de status gravada", d.query(models.AuditLog).filter_by(entity_type="InboundAppointment", action="STATUS").count() >= 5); d.close()

print(f"\n{PASS} ok, {FAIL} falhas")
sys.exit(1 if FAIL else 0)
