# break_even.py - contribution margin, break-even, margin of safety and target-margin prices (python3 stdlib only)
# Input: products.csv with columns product,price_sin_iva,variable_cost_sin_iva,units_per_month
#   (units_per_month = current or expected sales; it sets the mix for a multi-product break-even)
# Usage: python3 break_even.py products.csv <fixed_costs_per_month_sin_iva> <target_margin_pct> [iva_pct=16]
# All amounts sin IVA; prices con IVA are shown apart. Writes break-even.csv and prints markdown.
import csv, sys
from decimal import Decimal as D, ROUND_HALF_UP

def q(x): return x.quantize(D("0.01"), ROUND_HALF_UP)
def m(x): return f"${q(x):,.2f}" if x >= 0 else f"-${q(-x):,.2f}"

def main():
    fixed, target = D(sys.argv[2]), D(sys.argv[3]) / 100
    iva = D(sys.argv[4]) / 100 if len(sys.argv) > 4 else D("0.16")
    ps = []
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            ps.append({"name": r["product"], "p": D(r["price_sin_iva"]), "v": D(r["variable_cost_sin_iva"]), "u": D(r.get("units_per_month") or 0)})
    total_u = sum(p["u"] for p in ps)
    sales = sum(p["p"] * p["u"] for p in ps)
    cm_total = sum((p["p"] - p["v"]) * p["u"] for p in ps)
    print("| Producto | Precio sin IVA | Precio con IVA | Costo variable | Margen de contribución | MC % |")
    print("|---|---:|---:|---:|---:|---:|")
    for p in ps:
        cm = p["p"] - p["v"]
        print(f"| {p['name']} | {m(p['p'])} | {m(p['p'] * (1 + iva))} | {m(p['v'])} | {m(cm)} | {(cm / p['p'] * 100 if p['p'] else 0):.1f}% |")
        if cm <= 0: print(f"WARNING: {p['name']} loses money on every unit sold (price <= variable cost).")
    rows = []
    if total_u == 0 or cm_total <= 0:
        print("\n[NO DATA: units_per_month for the mix] or the mix has no positive contribution; break-even cannot be computed.")
    else:
        cm_ratio = cm_total / sales
        be_sales = fixed / cm_ratio
        be_units = be_sales / (sales / total_u)
        safety = (sales - be_sales) / sales
        print(f"\nVentas actuales/esperadas: {m(sales)} sin IVA al mes | MC ponderado: {cm_ratio * 100:.1f}%")
        print(f"Punto de equilibrio: {m(be_sales)} sin IVA al mes ({m(be_sales * (1 + iva))} con IVA) ≈ {be_units:,.0f} unidades con la mezcla actual")
        print(f"Margen de seguridad: {safety * 100:.1f}% (cuánto pueden caer las ventas antes de perder)")
        print(f"Utilidad de operación estimada: {m(cm_total - fixed)} al mes")
        if safety <= 0: print("WARNING: current/expected sales are at or below break-even.")
        print("\n| Producto | Unidades de equilibrio (mezcla) | Precio mínimo sin IVA para el MC objetivo | Precio sin IVA para margen neto objetivo (con costo fijo asignado) | Con IVA |")
        print("|---|---:|---:|---:|---:|")
        for p in ps:
            share = p["u"] / total_u
            fixed_unit = (fixed * (p["p"] * p["u"] / sales) / p["u"]) if p["u"] else None  # fixed cost allocated by sales share
            price_cm = p["v"] / (1 - target)
            price_net = (p["v"] + fixed_unit) / (1 - target) if fixed_unit is not None else None
            rows.append([p["name"], str(q(p["p"])), str(q(p["v"])), str(q(be_units * share)), str(q(price_cm)), "" if price_net is None else str(q(price_net)), "" if price_net is None else str(q(price_net * (1 + iva)))])
            print(f"| {p['name']} | {be_units * share:,.0f} | {m(price_cm)} | {'[NO DATA: unidades]' if price_net is None else m(price_net)} | {'' if price_net is None else m(price_net * (1 + iva))} |")
    with open("break-even.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["product", "price_sin_iva", "variable_cost_sin_iva", "break_even_units", "price_for_target_cm_sin_iva", "price_for_target_net_sin_iva", "price_for_target_net_con_iva"])
        w.writerows(rows)

if __name__ == "__main__":
    main()
