# debt_payoff.py - avalanche vs snowball, month by month (python3 stdlib only)
# Input: debts.csv with columns name,balance,annual_rate_pct,min_payment,cat_pct,iva_on_interest
#   iva_on_interest = yes if the statement charges IVA on interest (common on Mexican credit cards)
# Usage: python3 debt_payoff.py debts.csv <monthly_budget_for_debts> [start YYYY-MM]
import csv, sys, datetime
from decimal import Decimal as D, ROUND_HALF_UP

def money(x): return x.quantize(D("0.01"), ROUND_HALF_UP)

def load(path):
    debts = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            debts.append({
                "name": r["name"].strip(),
                "balance": D(r["balance"]),
                "rate": D(r["annual_rate_pct"]) / 100,
                "min": D(r["min_payment"]),
                "iva": (r.get("iva_on_interest") or "").strip().lower() in ("yes", "si", "sí", "1", "true"),
            })
    return debts

def monthly_interest(d):
    i = d["balance"] * d["rate"] / 12
    return money(i * D("1.16") if d["iva"] else i)

def simulate(debts, budget, method, max_months=600):
    ds = [dict(d) for d in debts]
    rows, total_interest, month = [], D("0"), 0
    paid_off = {}
    while any(d["balance"] > 0 for d in ds) and month < max_months:
        month += 1
        for d in ds:
            if d["balance"] > 0:
                i = monthly_interest(d)
                d["balance"] += i
                total_interest += i
        active = [d for d in ds if d["balance"] > 0]
        available = budget
        pay = {d["name"]: D("0") for d in ds}
        for d in active:  # minimums first
            p = min(d["min"], d["balance"], available)
            pay[d["name"]] += p; d["balance"] -= p; available -= p
        key = (lambda d: (-d["rate"], d["balance"])) if method == "avalanche" else (lambda d: (d["balance"], -d["rate"]))
        for d in sorted([d for d in ds if d["balance"] > 0], key=key):  # extra to the target
            if available <= 0: break
            p = min(available, d["balance"])
            pay[d["name"]] += p; d["balance"] -= p; available -= p
        for d in ds:
            if d["balance"] <= 0 and d["name"] not in paid_off:
                paid_off[d["name"]] = month
        rows.append((month, {d["name"]: (money(pay[d["name"]]), money(d["balance"])) for d in ds}))
    return rows, money(total_interest), month, paid_off

def add_months(start, n):
    y, m = divmod(start.month - 1 + n, 12)
    return datetime.date(start.year + y, m + 1, 1)

def main():
    path, budget = sys.argv[1], D(sys.argv[2])
    start = datetime.date.today().replace(day=1) if len(sys.argv) < 4 else datetime.date.fromisoformat(sys.argv[3] + "-01")
    debts = load(path)
    mins = sum(d["min"] for d in debts)
    print(f"Total minimum payments: {money(mins)} | budget for debts: {money(budget)}")
    if budget < mins:
        print("STOP: the budget does not cover the minimum payments. Review the budget first (home-budget).")
    for d in debts:
        i = monthly_interest(d)
        if d["min"] <= i:
            print(f"WARNING: {d['name']}: minimum payment {money(d['min'])} does not cover this month's interest {i}; paying only the minimum, the debt never ends.")
    if budget < mins:
        sys.exit(2)
    for method in ("avalanche", "snowball"):
        rows, interest, months, paid = simulate(debts, budget, method)
        end = add_months(start, months - 1)
        done = all(m for m in paid.values()) and len(paid) == len(debts)
        print(f"\n== {method} == months: {months} | payoff: {end:%Y-%m} | total interest: {interest}" + ("" if done else " | NOT PAID OFF within 600 months"))
        order = sorted(paid.items(), key=lambda kv: kv[1])
        print("Order paid off: " + ", ".join(f"{n} (month {m}, {add_months(start, m-1):%Y-%m})" for n, m in order))
        with open(f"debt-plan-{method}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["month", "date"] + [x for d in debts for x in (f"{d['name']} payment", f"{d['name']} balance")])
            for m, data in rows:
                w.writerow([m, f"{add_months(start, m-1):%Y-%m}"] + [str(v) for d in debts for v in data[d["name"]]])

if __name__ == "__main__":
    main()
