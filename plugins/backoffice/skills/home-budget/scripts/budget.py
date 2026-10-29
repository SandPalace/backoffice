# budget.py - monthly household budget, 50/30/20 reference, emergency fund and goals (python3 stdlib only)
# Input 1: budget.csv with columns concept,type,essential,amount,frequency
#   type: income | fixed | variable | debt | savings   (income = NET, what actually arrives)
#   essential: yes/no (rent, food, utilities, transport to work, medicine, minimum debt payments = yes)
#   frequency: monthly | quincenal | weekly | annual | bimonthly
# Input 2 (optional): goals.csv with columns goal,amount,target_date(YYYY-MM-DD),saved
# Usage: python3 budget.py budget.csv [goals.csv] [today YYYY-MM-DD]
# Writes budget-monthly.csv and prints markdown.
import csv, sys, datetime
from decimal import Decimal as D, ROUND_HALF_UP

FACTOR = {"monthly": D(1), "mensual": D(1), "quincenal": D(2), "weekly": D(52) / 12, "semanal": D(52) / 12,
          "annual": D(1) / 12, "anual": D(1) / 12, "bimonthly": D(1) / 2, "bimestral": D(1) / 2}

def q(x): return x.quantize(D("0.01"), ROUND_HALF_UP)
def m(x): return f"${q(x):,.2f}" if x >= 0 else f"-${q(-x):,.2f}"
def yes(s): return (s or "").strip().lower() in ("yes", "si", "sí", "1", "true")

def main():
    rows, bad = [], []
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            fr = (r["frequency"] or "monthly").strip().lower()
            if fr not in FACTOR: bad.append(r["concept"]); continue
            rows.append({"concept": r["concept"], "type": r["type"].strip().lower(), "essential": yes(r["essential"]), "monthly": D(r["amount"]) * FACTOR[fr]})
    income = sum(r["monthly"] for r in rows if r["type"] == "income")
    out = [r for r in rows if r["type"] != "income"]
    spend = sum(r["monthly"] for r in out)
    needs = sum(r["monthly"] for r in out if r["essential"] and r["type"] != "savings")
    wants = sum(r["monthly"] for r in out if not r["essential"] and r["type"] not in ("savings",))
    saving = sum(r["monthly"] for r in out if r["type"] == "savings")
    left = income - spend
    print(f"Ingreso neto mensual: {m(income)} | Gastos y pagos: {m(spend)} | Diferencia: {m(left)}")
    if left < 0: print("WARNING: expenses exceed income by " + m(-left) + " per month.")
    if income > 0:
        print("\n| Bloque (referencia 50/30/20, no regla) | Actual | % del ingreso | Referencia |\n|---|---:|---:|---:|")
        for name, v, ref in (("Necesidades (esenciales)", needs, 50), ("Gustos (no esenciales)", wants, 30), ("Ahorro", saving + max(left, D(0)), 20)):
            print(f"| {name} | {m(v)} | {v / income * 100:.1f}% | {ref}% |")
    print(f"\nFondo de emergencia (gastos esenciales {m(needs)}/mes): 3 meses = {m(needs * 3)} · 6 meses = {m(needs * 6)}")
    if len(sys.argv) > 2 and sys.argv[2].endswith(".csv"):
        today = datetime.date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else datetime.date.today()
        print("\n| Meta | Monto | Ahorrado | Fecha | Meses | Ahorro mensual necesario |\n|---|---:|---:|---|---:|---:|")
        need_total = D(0)
        with open(sys.argv[2], newline="", encoding="utf-8-sig") as f:
            for g in csv.DictReader(f):
                t = datetime.date.fromisoformat(g["target_date"])
                months = max((t.year - today.year) * 12 + t.month - today.month, 1)
                need = (D(g["amount"]) - D(g.get("saved") or 0)) / months
                need_total += max(need, D(0))
                print(f"| {g['goal']} | {m(D(g['amount']))} | {m(D(g.get('saved') or 0))} | {t.isoformat()} | {months} | {m(need)} |")
        print(f"Total mensual para metas: {m(need_total)} vs disponible {m(max(left, D(0)) + saving)}")
    if bad: print("[NO DATA: frecuencia válida para] " + ", ".join(bad))
    with open("budget-monthly.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["concept", "type", "essential", "monthly_amount"])
        for r in rows: w.writerow([r["concept"], r["type"], "yes" if r["essential"] else "no", str(q(r["monthly"]))])
        w.writerow(["TOTAL income", "income", "", str(q(income))]); w.writerow(["TOTAL expenses", "", "", str(q(spend))]); w.writerow(["DIFFERENCE", "", "", str(q(left))])

if __name__ == "__main__":
    main()
