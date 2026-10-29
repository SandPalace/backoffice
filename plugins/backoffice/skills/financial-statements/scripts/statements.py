# statements.py - income statement, balance sheet and indirect cash flow from a classified trial balance.
# python3 standard library only. Indicative (NIF B-3, B-6, B-2 as references); validate with the accountant.
#
# Input: trial_balance.csv with columns  account,name,class,opening,closing
#   Amounts are positive on their natural side (assets: debit; liabilities, equity, revenue: credit;
#   expenses: debit). For income-statement classes only `closing` is used (the period amount).
#   accumulated_depreciation is entered as a positive number and is subtracted from assets.
# Usage: python3 statements.py trial_balance.csv "<period label>"
# Writes statements.md and statements.json in the current folder; exit code 1 if a check fails.
import csv, json, sys
from decimal import Decimal as D, ROUND_HALF_UP

ASSET_CUR = ["cash", "receivables", "inventory", "other_current_asset"]
ASSET_NON = ["fixed_asset", "accumulated_depreciation", "other_noncurrent_asset"]
LIAB_CUR = ["payables", "taxes_payable", "short_term_debt", "other_current_liability"]
LIAB_NON = ["long_term_debt", "other_noncurrent_liability"]
EQUITY = ["equity_capital", "retained_earnings"]
PNL = ["revenue", "cogs", "opex", "depreciation_expense", "interest_expense", "other_income", "other_expense", "income_tax"]
ALL = ASSET_CUR + ASSET_NON + LIAB_CUR + LIAB_NON + EQUITY + PNL

def q(x): return x.quantize(D("0.01"), ROUND_HALF_UP)
def m(x): return f"${q(x):,.2f}" if x >= 0 else f"-${q(-x):,.2f}"

def load(path):
    o, c, unknown = {k: D(0) for k in ALL}, {k: D(0) for k in ALL}, []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            k = r["class"].strip()
            if k not in ALL:
                unknown.append(f"{r['account']} {r['name']} ({k})"); continue
            o[k] += D(r.get("opening") or 0); c[k] += D(r["closing"] or 0)
    return o, c, unknown

def assets(b): return sum(b[k] for k in ASSET_CUR + ["fixed_asset", "other_noncurrent_asset"]) - b["accumulated_depreciation"]
def liabilities(b): return sum(b[k] for k in LIAB_CUR + LIAB_NON)
def equity(b): return sum(b[k] for k in EQUITY)

def main():
    o, c, unknown = load(sys.argv[1]); period = sys.argv[2] if len(sys.argv) > 2 else "periodo"
    rev, cogs = c["revenue"], c["cogs"]
    gross = rev - cogs
    ebitda = gross - c["opex"]
    ebit = ebitda - c["depreciation_expense"]
    ebt = ebit - c["interest_expense"] + c["other_income"] - c["other_expense"]
    ni = ebt - c["income_tax"]
    d = {k: c[k] - o[k] for k in ALL}
    cfo = (ni + c["depreciation_expense"] - d["receivables"] - d["inventory"] - d["other_current_asset"]
           + d["payables"] + d["taxes_payable"] + d["other_current_liability"])
    cfi = -(d["fixed_asset"] + d["other_noncurrent_asset"])
    cff = d["short_term_debt"] + d["long_term_debt"] + d["other_noncurrent_liability"] + d["equity_capital"] + d["retained_earnings"]
    checks = {
        "inicial: activo = pasivo + capital": assets(o) - liabilities(o) - equity(o),
        "final: activo = pasivo + capital + utilidad del periodo": assets(c) - liabilities(c) - equity(c) - ni,
        "flujo de efectivo = cambio en efectivo": (cfo + cfi + cff) - d["cash"],
    }
    L = [f"# Estados financieros — {period} (MXN)", "", "> Indicativo; valídalo con tu contador. Referencias: NIF B-3, B-6, B-2.", "",
         "## Estado de resultados (NIF B-3)", "| Concepto | Importe |", "|---|---:|",
         f"| Ventas netas | {m(rev)} |", f"| Costo de ventas | {m(-cogs)} |", f"| **Utilidad bruta** | **{m(gross)}** |",
         f"| Gastos de operación | {m(-c['opex'])} |", f"| EBITDA | {m(ebitda)} |", f"| Depreciación | {m(-c['depreciation_expense'])} |",
         f"| **Utilidad de operación** | **{m(ebit)}** |", f"| Gastos financieros | {m(-c['interest_expense'])} |",
         f"| Otros ingresos / (gastos) | {m(c['other_income'] - c['other_expense'])} |", f"| Utilidad antes de impuestos | {m(ebt)} |",
         f"| Impuestos a la utilidad | {m(-c['income_tax'])} |", f"| **Utilidad neta** | **{m(ni)}** |", "",
         "## Estado de situación financiera (NIF B-6)", "| Concepto | Inicial | Final |", "|---|---:|---:|"]
    cur = lambda b, keys: sum(b[k] for k in keys)
    L += [f"| Activo circulante | {m(cur(o, ASSET_CUR))} | {m(cur(c, ASSET_CUR))} |",
          f"| Activo no circulante (neto) | {m(assets(o) - cur(o, ASSET_CUR))} | {m(assets(c) - cur(c, ASSET_CUR))} |",
          f"| Pasivo a corto plazo | {m(cur(o, LIAB_CUR))} | {m(cur(c, LIAB_CUR))} |",
          f"| Pasivo a largo plazo | {m(cur(o, LIAB_NON))} | {m(cur(c, LIAB_NON))} |",
          f"| Capital contable | {m(cur(o, EQUITY))} | {m(cur(c, EQUITY))} |"]
    L += [f"| Utilidad del periodo | — | {m(ni)} |", f"| **Total activo** | **{m(assets(o))}** | **{m(assets(c))}** |",
          f"| **Total pasivo + capital** | **{m(liabilities(o) + equity(o))}** | **{m(liabilities(c) + equity(c) + ni)}** |", "",
          "## Estado de flujos de efectivo, método indirecto (NIF B-2)", "| Concepto | Importe |", "|---|---:|",
          f"| Utilidad neta | {m(ni)} |", f"| + Depreciación | {m(c['depreciation_expense'])} |",
          f"| − Aumento en clientes / + disminución | {m(-d['receivables'])} |", f"| − Aumento en inventarios / + disminución | {m(-d['inventory'])} |",
          f"| Otros activos circulantes | {m(-d['other_current_asset'])} |", f"| + Aumento en proveedores e impuestos por pagar | {m(d['payables'] + d['taxes_payable'] + d['other_current_liability'])} |",
          f"| **Flujo de operación** | **{m(cfo)}** |", f"| **Flujo de inversión** | **{m(cfi)}** |", f"| **Flujo de financiamiento** | **{m(cff)}** |",
          f"| Cambio neto en efectivo | {m(cfo + cfi + cff)} |", f"| Efectivo inicial → final | {m(o['cash'])} → {m(c['cash'])} |", "",
          "## Verificaciones", "| Verificación | Diferencia | Estado |", "|---|---:|---|"]
    ok = True
    for k, v in checks.items():
        good = q(v) == 0; ok &= good
        L.append(f"| {k} | {m(v)} | {'OK' if good else 'NO CUADRA'} |")
    if unknown:
        L += ["", "## Cuentas sin clasificar (no incluidas)"] + [f"- [NO DATA: clase de la cuenta {u}]" for u in unknown]
    open("statements.md", "w", encoding="utf-8").write("\n".join(L) + "\n")
    data = {"period": period, "opening": {k: str(v) for k, v in o.items()}, "closing": {k: str(v) for k, v in c.items()},
            "income": {"revenue": str(rev), "gross_profit": str(gross), "operating_income": str(ebit), "net_income": str(ni),
                       "interest_expense": str(c["interest_expense"]), "cogs": str(cogs)},
            "cash_flow": {"operating": str(cfo), "investing": str(cfi), "financing": str(cff)},
            "checks": {k: str(q(v)) for k, v in checks.items()}, "unclassified": unknown}
    json.dump(data, open("statements.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("\n".join(L))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
