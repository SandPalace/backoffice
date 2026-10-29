# cfdi_check.py - cross-check CFDI (issued/received) against the bank statement and flag red flags.
# python3 standard library only. Findings are POSSIBLE risks for the accountant to confirm, not conclusions.
# Input 1: cfdi.csv  columns uuid,date,direction,rfc,name,concept,total,metodo_pago,forma_pago,status,has_payment_complement
#   direction: issued | received ; metodo_pago: PUE | PPD ; forma_pago: SAT code (01 efectivo, 03 transferencia, 04 tarjeta...)
#   status: vigente | cancelado ; has_payment_complement: yes/no (only matters for PPD)
# Input 2: bank.csv  columns date,description,amount   (deposits positive, payments negative)
# Usage: python3 cfdi_check.py cfdi.csv bank.csv [days_window=7]
# Writes cfdi-check.csv and prints a summary.
import csv, sys, datetime
from decimal import Decimal as D

def rd(p): return list(csv.DictReader(open(p, newline="", encoding="utf-8-sig")))
def day(s): return datetime.date.fromisoformat(s.strip()[:10])

def main():
    cfdi, bank = rd(sys.argv[1]), rd(sys.argv[2])
    win = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    for b in bank: b["_amt"], b["_d"], b["_used"] = D(b["amount"]), day(b["date"]), False
    F = []  # source, id, date, counterparty, amount, finding, question
    def add(src, i, d, cp, amt, finding, question): F.append([src, i, d, cp, amt, finding, question])
    for c in cfdi:
        total, d = D(c["total"]), day(c["date"])
        sign = 1 if c["direction"].strip().lower() == "issued" else -1
        if c["status"].strip().lower() == "cancelado":
            add("cfdi", c["uuid"], c["date"], c["name"], c["total"], "CFDI cancelado", "¿Se excluyó de tus ingresos/gastos del mes?"); continue
        match = next((b for b in bank if not b["_used"] and b["_amt"] * sign > 0 and abs(abs(b["_amt"]) - total) <= D("0.01")
                      and abs((b["_d"] - d).days) <= win), None)
        if match: match["_used"] = True
        ppd = c["metodo_pago"].strip().upper() == "PPD"
        if ppd and match and (c.get("has_payment_complement") or "").strip().lower() not in ("yes", "si", "sí"):
            add("cfdi", c["uuid"], c["date"], c["name"], c["total"], "PPD pagado sin complemento de pago", "¿Ya se emitió/recibió el complemento de pago?")
        cash = c.get("forma_pago", "").strip() == "01"
        if not match and not ppd and not cash:
            what = "CFDI emitido PUE sin depósito en el banco" if sign == 1 else "CFDI recibido PUE sin pago en el banco"
            add("cfdi", c["uuid"], c["date"], c["name"], c["total"], what, "¿Se pagó en otra cuenta, en efectivo o en otra fecha?")
        if sign == -1 and cash and total > D("2000"):
            add("cfdi", c["uuid"], c["date"], c["name"], c["total"], "Gasto mayor a $2,000 pagado en efectivo (posible no deducible)", "¿Es deducible así o conviene cambiar la forma de pago?")
        if sign == -1 and cash and any(w in (c.get("concept", "") + c["name"]).lower() for w in ("gasolin", "combustible", "diesel", "diésel")):
            add("cfdi", c["uuid"], c["date"], c["name"], c["total"], "Combustible pagado en efectivo (posible no deducible)", "¿Es deducible?")
    for b in bank:
        if b["_used"]: continue
        if b["_amt"] > 0:
            add("bank", "", b["date"], b["description"], b["amount"], "Depósito sin CFDI emitido", "¿Es venta sin factura, préstamo, traspaso entre cuentas propias u otro?")
        else:
            add("bank", "", b["date"], b["description"], b["amount"], "Pago sin CFDI recibido (posible gasto no deducible)", "¿Hay factura pendiente de pedir al proveedor, o es nómina/impuestos/traspaso?")
    with open("cfdi-check.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["source", "uuid", "date", "counterparty", "amount", "finding", "question_for_accountant"]); w.writerows(F)
    issued = sum(D(c["total"]) for c in cfdi if c["direction"] == "issued" and c["status"] == "vigente")
    received = sum(D(c["total"]) for c in cfdi if c["direction"] == "received" and c["status"] == "vigente")
    dep = sum(b["_amt"] for b in bank if b["_amt"] > 0); pay = -sum(b["_amt"] for b in bank if b["_amt"] < 0)
    print(f"CFDI emitidos vigentes: {issued:,.2f} | depósitos: {dep:,.2f}")
    print(f"CFDI recibidos vigentes: {received:,.2f} | pagos: {pay:,.2f}")
    print(f"Hallazgos: {len(F)} (ver cfdi-check.csv)")
    for r in F: print(" - " + " | ".join(r[2:6]))

if __name__ == "__main__":
    main()
