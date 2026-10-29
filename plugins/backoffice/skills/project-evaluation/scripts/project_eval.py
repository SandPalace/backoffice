# project_eval.py - NPV, IRR, discounted payback, ROI, scenarios and a 2-variable sensitivity (python3 stdlib only)
# Input: project.json, e.g.
# {"name": "Horno nuevo", "rate_pct": 18, "years": 5,
#  "params": {"investment": 180000, "units": 4000, "price": 95, "unit_cost": 55, "fixed_cost": 60000, "salvage": 20000},
#  "optimistic": {"units": 1.15, "price": 1.05}, "pessimistic": {"units": 0.8, "unit_cost": 1.1},
#  "sensitivity": ["units", "price"]}
# All amounts sin IVA. Yearly flow = units*(price-unit_cost) - fixed_cost; last year adds salvage.
# Scenario values are multipliers over params. Usage: python3 project_eval.py project.json
import json, sys

def flows(p, years):
    yearly = p["units"] * (p["price"] - p["unit_cost"]) - p["fixed_cost"]
    cf = [-p["investment"]] + [yearly] * years
    cf[-1] += p.get("salvage", 0)
    return cf

def npv(rate, cf): return sum(c / (1 + rate) ** t for t, c in enumerate(cf))

def irr(cf, lo=-0.99, hi=10.0):
    f_lo, f_hi = npv(lo, cf), npv(hi, cf)
    if f_lo * f_hi > 0: return None  # no sign change: IRR undefined
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid, cf)
        if f_lo * f_mid <= 0: hi = mid
        else: lo, f_lo = mid, f_mid
    return (lo + hi) / 2

def discounted_payback(rate, cf):
    acc = cf[0]
    for t in range(1, len(cf)):
        d = cf[t] / (1 + rate) ** t
        if acc + d >= 0:
            return t - 1 + (-acc / d if d else 0)
        acc += d
    return None  # not recovered within the horizon

def roi(cf): return (sum(cf[1:]) + cf[0]) / -cf[0]

def scenario(base, mult): return {k: v * mult.get(k, 1) for k, v in base.items()}

def fmt(x): return "n/a" if x is None else f"{x:,.2f}"

def main():
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    r, n, base = cfg["rate_pct"] / 100, cfg["years"], cfg["params"]
    print(f"# {cfg['name']} | discount rate {cfg['rate_pct']}% | {n} years | MXN sin IVA")
    print("| Scenario | NPV | IRR % | Discounted payback (years) | ROI % |")
    print("|---|---:|---:|---:|---:|")
    for label, mult in (("pessimistic", cfg.get("pessimistic", {})), ("base", {}), ("optimistic", cfg.get("optimistic", {}))):
        cf = flows(scenario(base, mult), n)
        i, pb = irr(cf), discounted_payback(r, cf)
        print(f"| {label} | {fmt(npv(r, cf))} | {fmt(i * 100 if i is not None else None)} | {fmt(pb) if pb is not None else 'not recovered'} | {fmt(roi(cf) * 100)} |")
    print("\nBase cash flows by year:", [round(c, 2) for c in flows(base, n)])
    a, b = cfg["sensitivity"]
    steps = [-0.2, -0.1, 0, 0.1, 0.2]
    print(f"\n## Sensitivity: NPV by {a} (rows) and {b} (columns)")
    print(f"| {a} \\ {b} | " + " | ".join(f"{s:+.0%}" for s in steps) + " |")
    print("|---|" + "---:|" * len(steps))
    for sa in steps:
        row = [fmt(npv(r, flows(scenario(base, {a: 1 + sa, b: 1 + sb}), n))) for sb in steps]
        print(f"| {sa:+.0%} | " + " | ".join(row) + " |")

if __name__ == "__main__":
    main()
