# ledger.py - lightweight revenue ledger for a Mexican SMB: clients, items, quotes, sales, payments (abonos),
# cancellations and reports, all in ONE JSON file. python3 standard library only. Indicative (IVA / CFDI fields
# are guidance); validate with the accountant. It is a support tool: it does not issue or stamp any CFDI.
#
# Money is stored as INTEGER CENTS. Every amount that gets stored goes through one function, to_cents(), whose
# mode (half-up | truncate) is chosen at `init` and saved in the file. Nothing is ever edited or deleted:
# cancellations keep the record with a reason, and every mutation appends to a hash-chained `log` (no personal data).
#
# Usage: python3 ledger.py <command> [--ledger ledger.json] ...      (python3 ledger.py -h  lists commands)
#   init  client add  item add  rate add  quote  sale  payment  cancel  list  verify
#   summary  collection-days  iva  global-invoice  export-cfdi  portfolio  selftest
# Dates are YYYY-MM-DD. Exit code 2 on a refused operation (message on stderr), 1 if selftest fails.
import argparse, contextlib, csv, hashlib, io, json, os, re, sys, tempfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D, ROUND_FLOOR, ROUND_HALF_UP, InvalidOperation

MODE = "half-up"  # set from the ledger file on load; the only rounding switch in this script
SYSTEM_RFC = "XAXX010101000"  # RFC generico nacional; confirm name/regime/uso against the SAT catalogs (F7)
TREATMENTS = ("GENERAL", "TASA_0", "EXENTO")
# Common c_FormaPago codes (confirm against the current SAT catalog, F9)
FORMAS_PAGO = {"01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia electronica", "04": "Tarjeta de credito",
               "05": "Monedero electronico", "06": "Dinero electronico", "08": "Vales de despensa", "12": "Dacion en pago",
               "13": "Pago por subrogacion", "14": "Pago por consignacion", "15": "Condonacion", "17": "Compensacion",
               "23": "Novacion", "24": "Confusion", "25": "Remision de deuda", "26": "Prescripcion o caducidad",
               "27": "A satisfaccion del acreedor", "28": "Tarjeta de debito", "29": "Tarjeta de servicios",
               "30": "Aplicacion de anticipos", "31": "Intermediario pagos", "99": "Por definir"}
OPEN_QUESTION_F1 = ("Open question F1 for the accountant: whether IVA is caused at the sale date or at the collection "
                    "date. This report uses the sale date; do not file from it.")


class LedgerError(Exception):
    pass


# ---------------------------------------------------------------- money (integer cents, ONE rounding function)
def to_cents(x):
    """Exact value in cents (Decimal, may have a fraction) -> integer cents, using the ledger's rounding mode."""
    x = D(x)
    if x < 0:
        raise LedgerError("Negative amounts are not allowed")
    return int(x.to_integral_value(ROUND_FLOOR if MODE == "truncate" else ROUND_HALF_UP))


def parse_money(text):
    s = str(text).strip().replace("$", "").replace(",", "")
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        raise LedgerError(f"Invalid amount '{text}': use at most 2 decimals, e.g. 1250.50")
    p, _, c = s.partition(".")
    return int(p) * 100 + int(c.ljust(2, "0"))


def fmt(c):
    sign = "-" if c < 0 else ""
    c = abs(c)
    return f"{sign}${c // 100:,}.{c % 100:02d}"


def plain(c):
    return f"{c // 100}.{c % 100:02d}"


def parse_qty(text):
    try:
        q = D(str(text))
    except InvalidOperation:
        raise LedgerError(f"Invalid quantity '{text}'")
    if not q.is_finite() or q <= 0:
        raise LedgerError("Quantity must be greater than 0")
    return q


def parse_discount(spec, base):
    """'10%' or '5.00' (or empty) -> cents, never above `base`."""
    if not spec:
        return 0
    s = str(spec).strip()
    if s.endswith("%"):
        try:
            pct = D(s[:-1])
        except InvalidOperation:
            raise LedgerError(f"Invalid discount '{spec}'")
        if pct < 0 or pct > 100:
            raise LedgerError("Discount must be between 0% and 100%")
        d = to_cents(D(base) * pct / 100)
    else:
        d = parse_money(s)
    if d > base:
        raise LedgerError("Discount cannot be greater than the amount")
    return d


def split_largest_remainder(total, weights):
    """Split `total` cents in proportion to `weights`; parts sum exactly to total (ties: lowest position first)."""
    if not weights:
        raise LedgerError("Nothing to split over")
    w = list(weights)
    s = sum(w)
    if s == 0:
        w, s = [1] * len(w), len(w)
    parts = [total * x // s for x in w]
    rest = total - sum(parts)
    order = sorted(range(len(w)), key=lambda i: (-(total * w[i] % s), i))
    for i in order[:rest]:
        parts[i] += 1
    return parts


# ---------------------------------------------------------------- dates, rates
def pdate(text, name="date"):
    try:
        return date.fromisoformat(str(text)).isoformat()
    except ValueError:
        raise LedgerError(f"Invalid {name} '{text}': use YYYY-MM-DD")


def today():
    return date.today().isoformat()


def days_between(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def rate_for(L, code, on):
    if code == "EXENTO":
        return D(0)
    rows = [r for r in L["rates"] if r["code"] == code and r["from"] <= on and (r["to"] is None or r["to"] >= on)]
    if not rows:
        raise LedgerError(f"No IVA rate for {code} on {on}: add one with `rate add`")
    return D(max(rows, key=lambda r: r["from"])["rate"])


# ---------------------------------------------------------------- document calculation
def compute_document(L, inputs, global_spec, on):
    """inputs: list of line dicts (qty, unit_cents, disc, treatment, ...). Returns (lines, totals).
    1) each line: importe and its own discount; 2) global discount split over the discounted bases by largest
    remainder; 3) IVA on each final base. Document total = sum of stored line totals (never re-rounded)."""
    if not inputs:
        raise LedgerError("Add at least one line")
    pre = []
    for li in inputs:
        importe = to_cents(parse_qty(li["qty"]) * li["unit_cents"])
        desc = parse_discount(li.get("disc"), importe)
        pre.append((importe, desc, importe - desc))
    bases = [p[2] for p in pre]
    gdisc = parse_discount(global_spec, sum(bases)) if global_spec else 0
    shares = split_largest_remainder(gdisc, bases) if gdisc else [0] * len(bases)
    lines = []
    for li, (importe, desc, base0), share in zip(inputs, pre, shares):
        base = base0 - share
        rate = rate_for(L, li["treatment"], on)
        iva = to_cents(D(base) * rate)
        lines.append({**li, "rate": str(rate) if li["treatment"] != "EXENTO" else "", "importe": importe,
                      "descuento": desc, "descuento_global": share, "base": base, "iva": iva, "total": base + iva})
    keys = ("importe", "descuento", "descuento_global", "base", "iva", "total")
    totals = {k: sum(l[k] for l in lines) for k in keys}
    if totals["total"] <= 0:
        raise LedgerError("The document total must be greater than $0.00")
    return lines, totals


def parse_line(L, text):
    kv = {}
    for part in text.split(","):
        k, sep, v = part.partition("=")
        if not sep:
            raise LedgerError(f"Invalid --line '{text}': use item=I001,qty=2[,price=10.00][,disc=10%]")
        kv[k.strip()] = v.strip()
    it = find(L["items"], kv.get("item", ""), "Item")
    unit = parse_money(kv["price"]) if "price" in kv else it["price_cents"]
    return {"item": it["id"], "name": it["name"], "clave_prod_serv": it["clave_prod_serv"], "clave_unidad": it["clave_unidad"],
            "qty": str(parse_qty(kv.get("qty", "1"))), "unit_cents": unit, "disc": kv.get("disc", ""), "treatment": it["treatment"]}


def find(rows, key, what):
    for r in rows:
        if r.get("id") == key or r.get("rfc") == key or r.get("folio") == key:
            return r
    raise LedgerError(f"{what} '{key}' not found")


# ---------------------------------------------------------------- storage, log, idempotency
def new_ledger():
    return {"version": 1, "config": {}, "rates": [], "counters": {}, "clients": [], "items": [], "quotes": [], "sales": [],
            "payments": [], "keys": {}, "log": []}


def load(path):
    global MODE
    if not os.path.exists(path):
        raise LedgerError(f"No ledger at {path}: run `init` first")
    with open(path, encoding="utf-8") as f:
        L = json.load(f)
    MODE = L["config"]["rounding"]
    return L


def save(L, path):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(L, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def log(L, action, ref, **extra):
    """Append-only, hash-chained. Only ids, folios and amounts: never names, RFCs or free text."""
    prev = L["log"][-1]["hash"] if L["log"] else ""
    e = {"n": len(L["log"]) + 1, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "action": action, "ref": ref, **extra, "prev": prev}
    e["hash"] = hashlib.sha256(json.dumps(e, sort_keys=True).encode()).hexdigest()
    L["log"].append(e)


def seen(L, args):
    k = getattr(args, "key", None)
    if k and k in L["keys"]:
        print(f"Already applied (key {k}): {L['keys'][k]}. Nothing changed.")
        return True
    return False


def done(L, args, ref):
    if getattr(args, "key", None):
        L["keys"][args.key] = ref


def next_folio(L, kind, prefix):
    L["counters"][kind] = L["counters"].get(kind, 0) + 1
    return f"{prefix}-{L['counters'][kind]:04d}"


def balance(L, sale, as_of=None):
    paid = sum(p["amount"] for p in L["payments"] if p["sale"] == sale["folio"] and p["status"] == "valid" and (as_of is None or p["date"] <= as_of))
    return sale["totals"]["total"] - paid, paid


# ---------------------------------------------------------------- commands: setup and masters
def cmd_init(args):
    global MODE
    if os.path.exists(args.ledger):
        raise LedgerError("Ledger already exists: init never overwrites")
    rfc = args.business_rfc.upper()
    if not re.fullmatch(r"[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}", rfc):
        raise LedgerError("Invalid business RFC")
    if not re.fullmatch(r"\d{5}", args.cp):
        raise LedgerError("CP must be 5 digits")
    if not re.fullmatch(r"\d{3}", args.regime):
        raise LedgerError("Regime must be the 3-digit SAT code, e.g. 601")
    MODE = args.rounding
    L = new_ledger()
    L["config"] = {"rounding": args.rounding, "business_rfc": rfc, "business_name": args.business_name or "", "cp": args.cp,
                   "regime": args.regime, "currency": "MXN", "created": today()}
    L["rates"] = [{"code": "GENERAL", "rate": "0.16", "from": "2010-01-01", "to": None},
                  {"code": "TASA_0", "rate": "0", "from": "2010-01-01", "to": None}]
    L["clients"].append({"id": "PG", "system": True, "rfc": SYSTEM_RFC, "name": "PUBLICO EN GENERAL", "regime": "616", "cp": args.cp,
                         "uso_cfdi": "S01", "credit_days": 0})
    log(L, "init", "ledger", rounding=args.rounding)
    save(L, args.ledger)
    print(f"Ledger created at {args.ledger}. Rounding: {args.rounding}. Rates seeded: GENERAL 16%, TASA_0 0% (confirm with the accountant, F4).")


def cmd_client_add(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    rfc = args.rfc.upper()
    if rfc == SYSTEM_RFC:
        raise LedgerError("PUBLICO EN GENERAL is a built-in system client and cannot be added or edited")
    if not re.fullmatch(r"[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}", rfc):
        raise LedgerError("Invalid RFC (12 or 13 characters)")
    if any(c["rfc"] == rfc for c in L["clients"]):
        raise LedgerError("A client with that RFC already exists")
    if not re.fullmatch(r"\d{5}", args.cp) or not re.fullmatch(r"\d{3}", args.regime) or not re.fullmatch(r"[A-Z]\d{2}", args.uso_cfdi.upper()):
        raise LedgerError("Check CP (5 digits), regime (3 digits, e.g. 601) and uso CFDI (e.g. G03)")
    if args.credit_days < 0:
        raise LedgerError("Credit days cannot be negative")
    cid = f"C{len(L['clients']):03d}"
    L["clients"].append({"id": cid, "system": False, "rfc": rfc, "name": args.name, "regime": args.regime, "cp": args.cp,
                         "uso_cfdi": args.uso_cfdi.upper(), "credit_days": args.credit_days})
    log(L, "client_add", cid)
    done(L, args, cid)
    save(L, args.ledger)
    print(f"Client {cid} added.")


def cmd_item_add(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    t = args.treatment.upper()
    if args.retenciones or args.ieps or t not in TREATMENTS:
        raise LedgerError("Out of scope: items with retenciones, IEPS or other taxes are not supported (only IVA GENERAL, TASA_0, "
                          "EXENTO). Flag it for the accountant (F10); do not compute it here.")
    if not re.fullmatch(r"\d{8}", args.clave_prod_serv) or not re.fullmatch(r"[A-Z0-9]{2,3}", args.clave_unidad.upper()):
        raise LedgerError("ClaveProdServ is 8 digits and ClaveUnidad 2-3 characters (e.g. E48); confirm in the SAT catalogs (F9)")
    iid = f"I{len(L['items']) + 1:03d}"
    L["items"].append({"id": iid, "name": args.name, "clave_prod_serv": args.clave_prod_serv, "clave_unidad": args.clave_unidad.upper(),
                       "price_cents": parse_money(args.price), "treatment": t})
    log(L, "item_add", iid)
    done(L, args, iid)
    save(L, args.ledger)
    print(f"Item {iid} added ({t}).")


def cmd_rate_add(args):
    L = load(args.ledger)
    if args.code not in ("GENERAL", "TASA_0"):
        raise LedgerError("Rates exist for GENERAL and TASA_0 only")
    start = pdate(args.valid_from, "--from")
    rate = D(args.rate)
    if rate < 0 or rate > 1:
        raise LedgerError("Rate is a fraction, e.g. 0.16")
    for r in L["rates"]:
        if r["code"] == args.code and r["to"] is None:
            if start <= r["from"]:
                raise LedgerError("New rate must start after the current one")
            r["to"] = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    L["rates"].append({"code": args.code, "rate": str(rate), "from": start, "to": None})
    log(L, "rate_add", args.code, rate=str(rate), valid_from=start)
    save(L, args.ledger)
    print(f"Rate {args.code} {rate} valid from {start}.")


# ---------------------------------------------------------------- commands: quote, sale, payment, cancel
def build_doc(L, args, on):
    inputs = [parse_line(L, t) for t in args.line]
    return inputs, compute_document(L, inputs, args.global_discount, on)


def cmd_quote(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    on = pdate(args.date or today())
    client = find(L["clients"], args.client, "Client")
    inputs, (lines, totals) = build_doc(L, args, on)
    folio = next_folio(L, "quote", "COT")
    L["quotes"].append({"folio": folio, "date": on, "client": client["id"], "inputs": inputs, "global_discount": args.global_discount or "",
                        "lines": lines, "totals": totals, "status": "open", "sale": None})
    log(L, "quote", folio, total=totals["total"])
    done(L, args, folio)
    save(L, args.ledger)
    print(f"Quote {folio} total {fmt(totals['total'])} (IVA {fmt(totals['iva'])}).")


def cmd_sale(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    on = pdate(args.date or today())
    q = None
    if args.quote:
        q = find(L["quotes"], args.quote, "Quote")
        if q["status"] != "open":
            raise LedgerError(f"Quote {q['folio']} is already {q['status']}")
        client, inputs, gd = find(L["clients"], q["client"], "Client"), q["inputs"], q["global_discount"]
        lines, totals = compute_document(L, inputs, gd, on)
    else:
        if not args.client or not args.line:
            raise LedgerError("A new sale needs --client and at least one --line (or use --quote)")
        client, gd = find(L["clients"], args.client, "Client"), args.global_discount or ""
        inputs, (lines, totals) = build_doc(L, args, on)
    if args.method and args.method not in ("PUE", "PPD"):
        raise LedgerError("Method must be PUE or PPD")
    folio = next_folio(L, "sale", "V")
    L["sales"].append({"folio": folio, "date": on, "client": client["id"], "inputs": inputs, "global_discount": gd, "lines": lines,
                       "totals": totals, "method": args.method or "", "quote": q["folio"] if q else "", "status": "active"})
    if q:
        q["status"], q["sale"] = "converted", folio
    log(L, "sale", folio, total=totals["total"], quote=q["folio"] if q else "")
    done(L, args, folio)
    save(L, args.ledger)
    print(f"Sale {folio} total {fmt(totals['total'])} (IVA {fmt(totals['iva'])}).")


def cmd_payment(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    sale = find(L["sales"], args.sale, "Sale")
    if sale["status"] != "active":
        raise LedgerError(f"Sale {sale['folio']} is cancelled: no payments allowed")
    on = pdate(args.date or today())
    if on < sale["date"]:
        raise LedgerError("Payment date cannot be before the sale date")
    if args.method not in FORMAS_PAGO:
        raise LedgerError(f"Unknown forma de pago '{args.method}'. Known SAT codes: {', '.join(sorted(FORMAS_PAGO))}")
    amount = parse_money(args.amount)
    bal, _ = balance(L, sale)
    if amount <= 0:
        raise LedgerError("Payment must be greater than $0.00")
    if amount > bal:
        raise LedgerError(f"Payment cannot be greater than the balance ({fmt(bal)})")
    pid = next_folio(L, "payment", "P")
    L["payments"].append({"folio": pid, "sale": sale["folio"], "date": on, "amount": amount, "forma_pago": args.method,
                          "reference": args.reference or "", "status": "valid"})
    log(L, "payment", pid, sale=sale["folio"], amount=amount)
    done(L, args, pid)
    save(L, args.ledger)
    print(f"Payment {pid} of {fmt(amount)} on {sale['folio']}; balance {fmt(bal - amount)}.")


def cmd_cancel(args):
    L = load(args.ledger)
    if seen(L, args):
        return
    if not args.reason or not args.reason.strip():
        raise LedgerError("A reason is mandatory to cancel")
    if args.kind == "sale":
        rec = find(L["sales"], args.id, "Sale")
        live = [p["folio"] for p in L["payments"] if p["sale"] == rec["folio"] and p["status"] == "valid"]
        if live:
            raise LedgerError(f"Sale {rec['folio']} has valid payments ({', '.join(live)}): cancel them first")
        status = "cancelled"
    else:
        rec = find(L["payments"], args.id, "Payment")
        status = "cancelled"
    if rec["status"] == "cancelled":
        raise LedgerError(f"{rec['folio']} is already cancelled")
    rec["status"], rec["cancel_reason"], rec["cancel_date"] = status, args.reason.strip(), pdate(args.date or today())
    log(L, f"cancel_{args.kind}", rec["folio"])
    done(L, args, rec["folio"])
    save(L, args.ledger)
    print(f"{rec['folio']} cancelled (record kept).")


# ---------------------------------------------------------------- reports
def out_csv(path, header, rows):
    if path:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)
        print(f"\nCSV written: {path}")


def table(header, rows):
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join("---" for _ in header) + "|")
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")


def in_range(d, a, b):
    return (not a or d >= a) and (not b or d <= b)


def active_sales(L, a, b, only_client=None):
    return [s for s in L["sales"] if s["status"] == "active" and in_range(s["date"], a, b) and (only_client is None or s["client"] == only_client)]


def status_of(total, paid):
    return "por_cobrar" if paid == 0 else "cobrada" if paid >= total else "parcial"


def cmd_summary(args):
    L = load(args.ledger)
    a, b = pdate(args.date_from, "--from"), pdate(args.date_to, "--to")
    sales = active_sales(L, a, b)
    sold = sum(s["totals"]["total"] for s in sales)
    paid = sum(p["amount"] for p in L["payments"] if p["status"] == "valid" and a <= p["date"] <= b)
    open_sales = [s for s in L["sales"] if s["status"] == "active" and s["date"] <= b]
    bals = [(s, *balance(L, s, as_of=b)) for s in open_sales]
    receivable = sum(x[1] for x in bals)
    counts = {k: sum(1 for s, bal, pd in bals if status_of(s["totals"]["total"], pd) == k) for k in ("por_cobrar", "parcial", "cobrada")}
    print(f"# Summary {a} to {b} (MXN)\n")
    rows = [("Vendido (by sale date, con IVA)", fmt(sold)), ("  of which base sin IVA", fmt(sum(s["totals"]["base"] for s in sales))),
            ("  of which IVA", fmt(sum(s["totals"]["iva"] for s in sales))), ("Cobrado (by payment date)", fmt(paid)),
            (f"Por cobrar (balances as of {b})", fmt(receivable))]
    table(["Metric", "Amount"], rows)
    print(f"\nSales in period: {len(sales)} (cancelled excluded: {sum(1 for s in L['sales'] if s['status'] == 'cancelled' and in_range(s['date'], a, b))}).")
    print(f"Collection status as of {b}: por_cobrar {counts['por_cobrar']}, parcial {counts['parcial']}, cobrada {counts['cobrada']}.")
    out_csv(args.csv, ["metric", "amount"], [(r[0].strip(), r[1].replace("$", "").replace(",", "")) for r in rows])


def wavg(pairs):
    tot = sum(m for _, m in pairs)
    return None if tot == 0 else D(sum(d * m for d, m in pairs) * 100 // tot) / 100


def cmd_collection_days(args):
    L = load(args.ledger)
    a, b = args.date_from and pdate(args.date_from, "--from"), args.date_to and pdate(args.date_to, "--to")
    sales = {s["folio"]: s for s in L["sales"]}
    cl = {c["id"]: c for c in L["clients"]}
    pays = [p for p in L["payments"] if p["status"] == "valid" and in_range(p["date"], a, b) and sales[p["sale"]]["status"] == "active"]
    for p in pays:
        p["_days"] = days_between(sales[p["sale"]]["date"], p["date"])
    print("# Collection days (estimate: calendar days from sale date to each payment date)\n")
    table(["Payment", "Sale", "Days", "Amount"], [(p["folio"], p["sale"], p["_days"], fmt(p["amount"])) for p in pays])
    per_sale = {}
    for p in pays:
        per_sale.setdefault(p["sale"], []).append((p["_days"], p["amount"]))
    print("\n## Per sale (weighted by amount)\n")
    table(["Sale", "Days"], [(k, wavg(v)) for k, v in per_sale.items()])
    per_client = {}
    for p in pays:
        per_client.setdefault(cl[sales[p["sale"]]["client"]]["name"], []).append((p["_days"], p["amount"]))
    print("\n## Per client (weighted by amount)\n")
    table(["Client", "Days"], [(k, wavg(v)) for k, v in per_client.items()])
    edges = [("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, 10**6)]
    print("\n## Buckets by collected amount (estimate)\n")
    table(["Bucket (days)", "Payments", "Amount"], [(n, sum(1 for p in pays if lo <= p["_days"] <= hi),
          fmt(sum(p["amount"] for p in pays if lo <= p["_days"] <= hi))) for n, lo, hi in edges])
    allw = wavg([(p["_days"], p["amount"]) for p in pays])
    print(f"\nOverall weighted average: {allw if allw is not None else '[NO DATA: no payments in the period]'} days.")
    out_csv(args.csv, ["sale", "avg_days_weighted"], [(k, wavg(v)) for k, v in per_sale.items()])


def desglose(lines):
    g = {}
    for l in lines:
        key = "Sin IVA (EXENTO)" if l["treatment"] == "EXENTO" else f"IVA {D(l['rate']) * 100:.2f}% ({l['treatment']})"
        row = g.setdefault(key, [0, 0])
        row[0] += l["base"]
        row[1] += l["iva"]
    return g


def cmd_iva(args):
    L = load(args.ledger)
    a, b = pdate(args.date_from, "--from"), pdate(args.date_to, "--to")
    sales = active_sales(L, a, b)
    g = desglose([l for s in sales for l in s["lines"]])
    print(f"# IVA trasladado {a} to {b} (by sale date, MXN)\n")
    rows = [(k, fmt(v[0]), fmt(v[1])) for k, v in sorted(g.items())]
    table(["Treatment", "Base", "IVA"], rows)
    print(f"\nTotal IVA: {fmt(sum(v[1] for v in g.values()))} from {len(sales)} sales (cancelled excluded).")
    print(f"\n> {OPEN_QUESTION_F1}\n> Indicativo; valídalo con tu contador. 0% is not exempt: both show IVA $0.00 but are different treatments.")
    out_csv(args.csv, ["treatment", "base", "iva"], [(k, plain(v[0]), plain(v[1])) for k, v in sorted(g.items())])


def cmd_global_invoice(args):
    L = load(args.ledger)
    a, b = pdate(args.date_from, "--from"), pdate(args.date_to, "--to")
    sales = active_sales(L, a, b, only_client="PG")
    g = desglose([l for s in sales for l in s["lines"]])
    forms = {}
    for s in sales:
        bal, paid = balance(L, s)
        for p in L["payments"]:
            if p["sale"] == s["folio"] and p["status"] == "valid":
                forms[p["forma_pago"]] = forms.get(p["forma_pago"], 0) + p["amount"]
        if bal:
            forms["99"] = forms.get("99", 0) + bal
    print(f"# Global invoice support: PUBLICO EN GENERAL sales {a} to {b} (MXN)\n")
    table(["Treatment", "Base", "IVA"], [(k, fmt(v[0]), fmt(v[1])) for k, v in sorted(g.items())])
    print()
    table(["Forma de pago", "Amount"], [(f"{k} {FORMAS_PAGO.get(k, '')}", fmt(v)) for k, v in sorted(forms.items())])
    tot = sum(s["totals"]["total"] for s in sales)
    print(f"\n{len(sales)} sales, total {fmt(tot)}. Unpaid part is shown as 99 (por definir). Whether sales already invoiced elsewhere "
          "must be excluded is up to you: this ledger does not track the CFDI the business issues (F8).\n> Indicativo; valídalo con tu contador.")
    out_csv(args.csv, ["treatment", "base", "iva"], [(k, plain(v[0]), plain(v[1])) for k, v in sorted(g.items())])


def cmd_export_cfdi(args):
    L = load(args.ledger)
    a, b = pdate(args.date_from, "--from"), pdate(args.date_to, "--to")
    cfg, cl = L["config"], {c["id"]: c for c in L["clients"]}
    sales = active_sales(L, a, b, only_client=args.client and find(L["clients"], args.client, "Client")["id"])
    missing = [f"{s['folio']}: missing method PUE/PPD" for s in sales if not s["method"]]
    if not sales or missing:
        raise LedgerError("; ".join(missing) or "No sales to export in that period")
    os.makedirs(args.out_dir, exist_ok=True)
    conc, head, pays = [], [], []
    for s in sales:
        c = cl[s["client"]]
        valid = sorted([p for p in L["payments"] if p["sale"] == s["folio"] and p["status"] == "valid"], key=lambda p: (p["date"], p["folio"]))
        forma = valid[0]["forma_pago"] if s["method"] == "PUE" and len(valid) == 1 else "99"
        t = s["totals"]
        head.append({"Version": "4.0", "Folio": s["folio"], "Fecha": s["date"], "FormaPago": forma, "MetodoPago": s["method"], "Moneda": "MXN",
                     "SubTotal": plain(t["importe"]), "Descuento": plain(t["descuento"] + t["descuento_global"]), "Total": plain(t["total"]),
                     "Exportacion": "01", "LugarExpedicion": cfg["cp"], "Emisor.Rfc": cfg["business_rfc"], "Emisor.Nombre": cfg["business_name"],
                     "Emisor.RegimenFiscal": cfg["regime"], "Receptor.Rfc": c["rfc"], "Receptor.Nombre": c["name"],
                     "Receptor.DomicilioFiscalReceptor": c["cp"], "Receptor.RegimenFiscalReceptor": c["regime"], "Receptor.UsoCFDI": c["uso_cfdi"],
                     "IVA.Trasladado": plain(t["iva"])})
        for l in s["lines"]:
            ex = l["treatment"] == "EXENTO"
            conc.append({"Folio": s["folio"], "ClaveProdServ": l["clave_prod_serv"], "ClaveUnidad": l["clave_unidad"], "Descripcion": l["name"],
                         "Cantidad": l["qty"], "ValorUnitario": plain(l["unit_cents"]), "Importe": plain(l["importe"]),
                         "Descuento": plain(l["descuento"] + l["descuento_global"]), "ObjetoImp": "02", "Traslado.Base": plain(l["base"]),
                         "Traslado.Impuesto": "002", "Traslado.TipoFactor": "Exento" if ex else "Tasa",
                         "Traslado.TasaOCuota": "" if ex else f"{D(l['rate']):.6f}", "Traslado.Importe": "" if ex else plain(l["iva"])})
        prev = s["totals"]["total"]
        for p in valid:
            pays.append({"Folio": s["folio"], "MetodoPago": s["method"], "FechaPago": p["date"], "FormaDePagoP": p["forma_pago"], "MonedaP": "MXN",
                         "Monto": plain(p["amount"]), "NumOperacion": p["reference"], "ImpSaldoAnt": plain(prev),
                         "ImpPagado": plain(p["amount"]), "ImpSaldoInsoluto": plain(prev - p["amount"])})
            prev -= p["amount"]
    for name, rows in (("concepts.csv", conc), ("header.csv", head), ("payments.csv", pays)):
        with open(os.path.join(args.out_dir, name), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list((rows or [{"Folio": ""}])[0].keys()))
            w.writeheader()
            w.writerows(rows)
    print(f"Exported {len(head)} sales, {len(conc)} concepts, {len(pays)} payments to {args.out_dir} (concepts.csv, header.csv, payments.csv).")
    print("Support data only: the business issues the CFDI in its own system. Payments feed the complemento de pago for PPD sales. "
          "Check field values and ObjetoImp against the SAT catalogs and your PAC (F9, F14).")


def cmd_portfolio(args):
    L = load(args.ledger)
    as_of = pdate(args.as_of or today(), "--as-of")
    cl = {c["id"]: c for c in L["clients"]}
    rows = []
    for s in L["sales"]:
        if s["status"] != "active" or s["date"] > as_of:
            continue
        bal, paid = balance(L, s, as_of)
        if bal > 0:
            due = (date.fromisoformat(s["date"]) + timedelta(days=cl[s["client"]]["credit_days"])).isoformat()
            rows.append((s["folio"], cl[s["client"]]["name"], due, plain(s["totals"]["total"]), plain(paid)))
    out_csv(args.out, ["folio", "client", "due_date", "amount", "paid"], rows)
    print(f"{len(rows)} open invoices as of {as_of}. due_date = sale date + client credit days. Feed this to the collections aging-report.")


def cmd_list(args):
    L = load(args.ledger)
    print(json.dumps(L[args.kind], indent=1, ensure_ascii=False))


def cmd_verify(args):
    L = load(args.ledger)
    problems = []
    prev = ""
    for e in L["log"]:
        h = e["hash"]
        body = {k: v for k, v in e.items() if k != "hash"}
        if e["prev"] != prev or hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest() != h:
            problems.append(f"log entry {e['n']} broken")
        prev = h
    for s in L["sales"]:
        if s["totals"]["total"] != sum(l["total"] for l in s["lines"]):
            problems.append(f"{s['folio']}: total differs from the sum of lines")
        if balance(L, s)[0] < 0:
            problems.append(f"{s['folio']}: negative balance")
    for k in ("sale", "quote", "payment"):
        n = L["counters"].get(k, 0)
        have = len({"sale": L["sales"], "quote": L["quotes"], "payment": L["payments"]}[k])
        if n != have:
            problems.append(f"{k} folios: counter {n} but {have} records (gap)")
    print("OK: log chain, totals, balances and folios consistent." if not problems else "PROBLEMS:\n" + "\n".join(problems))
    if problems:
        raise LedgerError("verify failed")


# ---------------------------------------------------------------- selftest
def selftest(args):
    global MODE
    fails = []

    def check(name, got, want):
        ok = got == want
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"  got={got!r} want={want!r}"))
        if not ok:
            fails.append(name)

    def run(*argv, expect_error=None):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                main(list(argv))
            err = None
        except LedgerError as e:
            err = str(e)
        if expect_error is not None:
            return err is not None and expect_error.lower() in err.lower()
        if err:
            raise AssertionError(f"{argv}: {err}")
        return buf.getvalue()

    def scenario(mode):
        d = tempfile.mkdtemp()
        f = os.path.join(d, "l.json")
        run("init", "--ledger", f, "--business-rfc", "AAA010101AAA", "--cp", "64000", "--regime", "601", "--rounding", mode)
        run("client", "add", "--ledger", f, "--rfc", "BBB020202BB2", "--name", "Cliente Ejemplo", "--regime", "601", "--cp", "64000", "--uso-cfdi", "G03", "--credit-days", "30")
        for nm, pr, tr in (("Servicio", "10.01", "GENERAL"), ("Cinco", "0.05", "GENERAL"), ("Diez", "10.10", "GENERAL"), ("Libro", "99.99", "TASA_0"), ("Renta", "100.00", "EXENTO"), ("Caro", "99.99", "GENERAL")):
            run("item", "add", "--ledger", f, "--name", nm, "--clave-prod-serv", "80141600", "--clave-unidad", "E48", "--price", pr, "--treatment", tr)
        return f

    def doc(f, *lines, gd=None):
        L = load(f)
        inputs = [parse_line(L, t) for t in lines]
        return compute_document(L, inputs, gd, "2026-10-01")

    # rounding function, both modes
    for mode, want in (("half-up", [1, 2, 160]), ("truncate", [0, 1, 160])):
        MODE = mode
        check(f"{mode}: 0.8 / 1.6 / 160.16 cents", [to_cents(D("0.8")), to_cents(D("1.6")), to_cents(D("160.16"))], want)
    for mode, iva_a, iva_b, tot_a, disc, tot_d in (("half-up", [1, 1, 1], 162, 18, 1000, 10439), ("truncate", [0, 0, 0], 161, 15, 999, 10440)):
        f = scenario(mode)
        lines, t = doc(f, *["item=I002,qty=1"] * 3)
        check(f"{mode}: 3 lines of $0.05 IVA per line", [l["iva"] for l in lines], iva_a)
        check(f"{mode}: 3 lines of $0.05 document total", t["total"], tot_a)
        lines, t = doc(f, "item=I003,qty=1")
        check(f"{mode}: $10.10 at 16% IVA cents", lines[0]["iva"], iva_b)
        lines, t = doc(f, "item=I001,qty=2")
        check(f"{mode}: 2 lines of $10.01 IVA/total", (t["iva"], t["total"]), (320, 2322))
        lines, t = doc(f, "item=I006,qty=1,disc=10%")
        check(f"{mode}: $99.99 with 10% discount (descuento, total)", (lines[0]["descuento"], t["total"]), (disc, tot_d))
        check(f"{mode}: total equals sum of stored line totals", t["total"], sum(l["total"] for l in lines))
    # treatments
    f = scenario("half-up")
    lines, t = doc(f, "item=I004,qty=1", "item=I005,qty=1")
    check("TASA_0 and EXENTO give IVA 0 but stay distinct", ([l["iva"] for l in lines], [l["rate"] for l in lines]), ([0, 0], ["0", ""]))
    # largest remainder
    check("split 10 over 3 equal weights", split_largest_remainder(10, [1, 1, 1]), [4, 3, 3])
    p = split_largest_remainder(100, [3333, 3333, 3334, 1])
    check("split sums exactly", sum(p), 100)
    lines, t = doc(f, "item=I001,qty=1", "item=I001,qty=1", "item=I001,qty=1", gd="0.10")
    check("global discount split sums exactly", sum(l["descuento_global"] for l in lines), 10)
    # sale flow, folios, idempotency, payments, cancellations
    run("quote", "--ledger", f, "--client", "C001", "--date", "2026-10-01", "--line", "item=I006,qty=1", "--key", "q1")
    run("quote", "--ledger", f, "--client", "C001", "--date", "2026-10-01", "--line", "item=I006,qty=1", "--key", "q1")
    check("idempotency: same key creates one quote", len(load(f)["quotes"]), 1)
    run("sale", "--ledger", f, "--quote", "COT-0001", "--date", "2026-10-05", "--method", "PPD", "--key", "s1")
    run("sale", "--ledger", f, "--quote", "COT-0001", "--date", "2026-10-05", "--method", "PPD", "--key", "s1")
    run("sale", "--ledger", f, "--client", "PG", "--date", "2026-10-06", "--line", "item=I004,qty=2", "--line", "item=I001,qty=1")
    L = load(f)
    check("sales consecutive, one per key", [s["folio"] for s in L["sales"]], ["V-0001", "V-0002"])
    check("second quote conversion refused", run("sale", "--ledger", f, "--quote", "COT-0001", expect_error="already"), True)
    total = L["sales"][0]["totals"]["total"]
    check("sale total 99.99 at 16%", total, 11599)
    check("overpayment refused", run("payment", "--ledger", f, "--sale", "V-0001", "--date", "2026-10-10", "--amount", plain(total + 1), "--method", "03", expect_error="balance"), True)
    run("payment", "--ledger", f, "--sale", "V-0001", "--date", "2026-10-10", "--amount", "50.00", "--method", "03", "--reference", "REF1")
    run("payment", "--ledger", f, "--sale", "V-0001", "--date", "2026-11-20", "--amount", plain(total - 5000), "--method", "03")
    check("balance zero after full payment", balance(load(f), load(f)["sales"][0])[0], 0)
    check("no payment on a settled sale", run("payment", "--ledger", f, "--sale", "V-0001", "--amount", "0.01", "--method", "03", expect_error="balance"), True)
    check("unknown forma de pago refused", run("payment", "--ledger", f, "--sale", "V-0002", "--amount", "1", "--method", "77", expect_error="forma de pago"), True)
    check("cancel needs a reason", run("cancel", "payment", "P-0002", "--ledger", f, "--reason", " ", expect_error="reason"), True)
    check("sale with valid payments cannot be cancelled", run("cancel", "sale", "V-0001", "--ledger", f, "--reason", "error", expect_error="cancel them first"), True)
    run("cancel", "payment", "P-0002", "--ledger", f, "--reason", "bounced")
    check("cancelled payment restores balance, record kept", (balance(load(f), load(f)["sales"][0])[0], len(load(f)["payments"])), (total - 5000, 2))
    run("cancel", "payment", "P-0001", "--ledger", f, "--reason", "bounced")
    run("cancel", "sale", "V-0001", "--ledger", f, "--reason", "duplicated sale")
    check("no payment on a cancelled sale", run("payment", "--ledger", f, "--sale", "V-0001", "--amount", "1", "--method", "03", expect_error="cancelled"), True)
    check("folio of cancelled sale is kept, next folio has no gap", run("sale", "--ledger", f, "--client", "C001", "--line", "item=I001,qty=1") and load(f)["sales"][-1]["folio"], "V-0003")
    # rate by sale date
    run("rate", "add", "--ledger", f, "--code", "GENERAL", "--rate", "0.08", "--from", "2027-01-01")
    run("sale", "--ledger", f, "--client", "C001", "--date", "2026-12-31", "--line", "item=I001,qty=1")
    run("sale", "--ledger", f, "--client", "C001", "--date", "2027-01-01", "--line", "item=I001,qty=1")
    L = load(f)
    check("IVA rate follows the sale date", [s["lines"][0]["rate"] for s in L["sales"][-2:]], ["0.16", "0.08"])
    # scope and system client
    check("item with retenciones refused", run("item", "add", "--ledger", f, "--name", "X", "--clave-prod-serv", "80141600", "--clave-unidad", "E48", "--price", "1", "--treatment", "GENERAL", "--retenciones", expect_error="out of scope"), True)
    check("item with IEPS refused", run("item", "add", "--ledger", f, "--name", "X", "--clave-prod-serv", "80141600", "--clave-unidad", "E48", "--price", "1", "--treatment", "GENERAL", "--ieps", expect_error="out of scope"), True)
    check("system client cannot be re-added", run("client", "add", "--ledger", f, "--rfc", SYSTEM_RFC, "--name", "X", "--regime", "616", "--cp", "64000", "--uso-cfdi", "S01", expect_error="system client"), True)
    check("system client defaults", {k: L["clients"][0][k] for k in ("rfc", "regime", "uso_cfdi", "cp")}, {"rfc": SYSTEM_RFC, "regime": "616", "uso_cfdi": "S01", "cp": "64000"})
    # log and integrity
    check("log has no personal data", any("Cliente Ejemplo" in json.dumps(e) or "BBB020202BB2" in json.dumps(e) for e in L["log"]), False)
    run("verify", "--ledger", f)
    L["log"][2]["ref"] = "tampered"
    save(L, f)
    check("verify detects a tampered log", run("verify", "--ledger", f, expect_error="verify failed"), True)
    print("\nselftest: " + ("ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
    return 0 if not fails else 1


# ---------------------------------------------------------------- CLI
def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--ledger", default="ledger.json", help="path to the ledger JSON file")
    common.add_argument("--key", help="idempotency key: a retry with the same key changes nothing")
    p = argparse.ArgumentParser(description="Revenue ledger (integer cents, JSON file). Indicative; validate with your accountant.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, *parents, **kw):
        s = sub.add_parser(name, parents=list(parents) or [common], **kw)
        s.set_defaults(fn=fn)
        return s

    s = add("init", cmd_init)
    s.add_argument("--business-rfc", required=True); s.add_argument("--cp", required=True); s.add_argument("--regime", required=True)
    s.add_argument("--business-name", default=""); s.add_argument("--rounding", choices=["truncate", "half-up"], default="half-up")
    c = add("client", None); cs = c.add_subparsers(dest="sub", required=True)
    s = cs.add_parser("add", parents=[common]); s.set_defaults(fn=cmd_client_add)
    s.add_argument("--rfc", required=True); s.add_argument("--name", required=True); s.add_argument("--regime", required=True)
    s.add_argument("--cp", required=True); s.add_argument("--uso-cfdi", required=True); s.add_argument("--credit-days", type=int, default=0)
    i = add("item", None); its = i.add_subparsers(dest="sub", required=True)
    s = its.add_parser("add", parents=[common]); s.set_defaults(fn=cmd_item_add)
    s.add_argument("--name", required=True); s.add_argument("--clave-prod-serv", required=True); s.add_argument("--clave-unidad", required=True)
    s.add_argument("--price", required=True, help="unit price WITHOUT IVA"); s.add_argument("--treatment", default="GENERAL", help="GENERAL | TASA_0 | EXENTO")
    s.add_argument("--retenciones", action="store_true"); s.add_argument("--ieps", action="store_true")
    r = add("rate", None); rs = r.add_subparsers(dest="sub", required=True)
    s = rs.add_parser("add", parents=[common]); s.set_defaults(fn=cmd_rate_add)
    s.add_argument("--code", required=True); s.add_argument("--rate", required=True); s.add_argument("--from", dest="valid_from", required=True)
    for name, fn in (("quote", cmd_quote), ("sale", cmd_sale)):
        s = add(name, fn)
        s.add_argument("--client"); s.add_argument("--date"); s.add_argument("--global-discount", help="'10%%' or '50.00'")
        s.add_argument("--line", action="append", default=[], help="item=I001,qty=2[,price=10.00][,disc=10%%]")
        if name == "sale":
            s.add_argument("--quote"); s.add_argument("--method", help="PUE | PPD")
        else:
            s.set_defaults(quote=None)
    s = add("payment", cmd_payment)
    s.add_argument("--sale", required=True); s.add_argument("--date"); s.add_argument("--amount", required=True)
    s.add_argument("--method", required=True, help="SAT forma de pago code, e.g. 03"); s.add_argument("--reference")
    s = add("cancel", cmd_cancel)
    s.add_argument("kind", choices=["sale", "payment"]); s.add_argument("id"); s.add_argument("--reason", required=True); s.add_argument("--date")
    s = add("list", cmd_list); s.add_argument("kind", choices=["clients", "items", "quotes", "sales", "payments", "rates", "log"])
    add("verify", cmd_verify)
    rng = argparse.ArgumentParser(add_help=False)
    rng.add_argument("--ledger", default="ledger.json"); rng.add_argument("--from", dest="date_from", required=True)
    rng.add_argument("--to", dest="date_to", required=True); rng.add_argument("--csv", help="also write the main table as CSV")
    for name, fn in (("summary", cmd_summary), ("iva", cmd_iva), ("global-invoice", cmd_global_invoice)):
        add(name, fn, rng)
    s = add("collection-days", cmd_collection_days, argparse.ArgumentParser(add_help=False, parents=[]))
    s.add_argument("--ledger", default="ledger.json"); s.add_argument("--from", dest="date_from"); s.add_argument("--to", dest="date_to"); s.add_argument("--csv")
    s = add("export-cfdi", cmd_export_cfdi, rng); s.add_argument("--out-dir", required=True); s.add_argument("--client")
    s = add("portfolio", cmd_portfolio, argparse.ArgumentParser(add_help=False))
    s.add_argument("--ledger", default="ledger.json"); s.add_argument("--as-of"); s.add_argument("--out", help="portfolio.csv path")
    s = add("selftest", None, argparse.ArgumentParser(add_help=False))
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.cmd == "selftest":
        return selftest(args)
    if getattr(args, "fn", None) is None:
        raise LedgerError("Incomplete command: see -h")
    args.fn(args)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LedgerError as e:
        print(f"Refused: {e}", file=sys.stderr)
        sys.exit(2)
