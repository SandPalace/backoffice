# ratios.py - financial ratios with formula, value and traffic light (python3 standard library only)
# Input: statements.json produced by financial-statements/scripts/statements.py
#        (or a hand-made JSON with the same "opening", "closing" and "income" keys).
# Usage: python3 ratios.py statements.json <days_in_period> [thresholds.json]
#   thresholds.json overrides defaults, e.g. {"current_ratio": [1.0, 1.5]} meaning red below 1.0, green at 1.5+.
#   For "lower is better" ratios (debt_to_equity, dso, dio) the pair is [green_up_to, red_above].
# Writes ratios.csv and prints a markdown table. Missing inputs give "[NO DATA: ...]", never a guess.
import csv, json, sys

DEFAULTS = {  # generic SMB references; the person (or their accountant) can override them
    "current_ratio": [1.0, 1.5], "quick_ratio": [0.7, 1.0], "debt_to_equity": [1.0, 2.0],
    "gross_margin": [0.20, 0.35], "operating_margin": [0.05, 0.10], "net_margin": [0.03, 0.08],
    "roe": [0.05, 0.15], "roa": [0.02, 0.06], "dso": [45, 75], "dpo": [None, None], "dio": [60, 120],
}
LOWER_IS_BETTER = {"debt_to_equity", "dso", "dio"}

def f(x): return float(x)

def main():
    s = json.load(open(sys.argv[1], encoding="utf-8")); days = float(sys.argv[2])
    th = dict(DEFAULTS)
    if len(sys.argv) > 3: th.update(json.load(open(sys.argv[3], encoding="utf-8")))
    o, c, inc = {k: f(v) for k, v in s["opening"].items()}, {k: f(v) for k, v in s["closing"].items()}, {k: f(v) for k, v in s["income"].items()}
    cur_a = sum(c[k] for k in ("cash", "receivables", "inventory", "other_current_asset"))
    cur_l = sum(c[k] for k in ("payables", "taxes_payable", "short_term_debt", "other_current_liability"))
    debt = cur_l + c["long_term_debt"] + c.get("other_noncurrent_liability", 0)
    eq_c = c["equity_capital"] + c["retained_earnings"] + inc["net_income"]
    eq_o = o["equity_capital"] + o["retained_earnings"]
    assets_c = cur_a + c["fixed_asset"] - c["accumulated_depreciation"] + c["other_noncurrent_asset"]
    assets_o = sum(o[k] for k in ("cash", "receivables", "inventory", "other_current_asset", "fixed_asset", "other_noncurrent_asset")) - o["accumulated_depreciation"]
    rev, cogs, ni = inc["revenue"], inc["cogs"], inc["net_income"]
    avg = lambda a, b: (a + b) / 2
    div = lambda a, b: None if not b else a / b
    R = [  # key, group, name (Spanish), formula, value, unit
        ("current_ratio", "Liquidez", "Razón circulante", "activo circulante / pasivo circulante", div(cur_a, cur_l), "x"),
        ("quick_ratio", "Liquidez", "Prueba ácida", "(activo circulante − inventario) / pasivo circulante", div(cur_a - c["inventory"], cur_l), "x"),
        ("debt_to_equity", "Apalancamiento", "Deuda / capital", "pasivo total / capital contable", div(debt, eq_c), "x"),
        ("gross_margin", "Rentabilidad", "Margen bruto", "utilidad bruta / ventas", div(inc["gross_profit"], rev), "%"),
        ("operating_margin", "Rentabilidad", "Margen operativo", "utilidad de operación / ventas", div(inc["operating_income"], rev), "%"),
        ("net_margin", "Rentabilidad", "Margen neto", "utilidad neta / ventas", div(ni, rev), "%"),
        ("roe", "Rentabilidad", "ROE (del periodo)", "utilidad neta / capital promedio", div(ni, avg(eq_o, eq_c)), "%"),
        ("roa", "Rentabilidad", "ROA (del periodo)", "utilidad neta / activo promedio", div(ni, avg(assets_o, assets_c)), "%"),
        ("dso", "Eficiencia", "Días de cobro", f"clientes promedio / ventas × {days:g} días", div(avg(o["receivables"], c["receivables"]) * days, rev), "días"),
        ("dpo", "Eficiencia", "Días de pago", f"proveedores promedio / costo de ventas × {days:g} días", div(avg(o["payables"], c["payables"]) * days, cogs), "días"),
        ("dio", "Eficiencia", "Días de inventario", f"inventario promedio / costo de ventas × {days:g} días", div(avg(o["inventory"], c["inventory"]) * days, cogs), "días"),
        ("inventory_turnover", "Eficiencia", "Rotación de inventario", "costo de ventas / inventario promedio", div(cogs, avg(o["inventory"], c["inventory"])), "veces"),
    ]
    rows = []
    for key, group, name, formula, v, unit in R:
        lo, hi = th.get(key, [None, None])
        if v is None:
            shown, light = "[NO DATA: denominador en cero o sin dato]", "sin dato"
        else:
            shown = f"{v:.1%}" if unit == "%" else f"{v:,.2f} {unit}"
            if lo is None or hi is None: light = "sin umbral"
            elif key in LOWER_IS_BETTER: light = "verde" if v <= lo else ("rojo" if v > hi else "amarillo")
            else: light = "rojo" if v < lo else ("verde" if v >= hi else "amarillo")
        limits = "" if lo is None else (f"{lo:.0%} / {hi:.0%}" if unit == "%" else f"{lo:g} / {hi:g}")
        rows.append([group, name, formula, shown, light, limits])
    with open("ratios.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["group", "ratio", "formula", "value", "light", "thresholds"]); w.writerows(rows)
    print("| Grupo | Razón | Fórmula | Valor | Semáforo | Umbrales |\n|---|---|---|---:|---|---|")
    for r in rows: print("| " + " | ".join(r) + " |")
    print("\nNote: ROE/ROA are for the period, not annualized. Thresholds are generic references; compare with your industry.")

if __name__ == "__main__":
    main()
