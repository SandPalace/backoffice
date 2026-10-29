# sat_calendar.py - GENERAL dated checklist of likely obligations for the next 3 months (python3 stdlib only)
# Indicative only: every item must be confirmed with the accountant.
# Usage: python3 sat_calendar.py <regime> <employees yes|no> <withholds yes|no> [start YYYY-MM-DD]
#   regime: pm (persona moral general) | pm-resico | pf-empresarial | pf-resico
import csv, sys, datetime, calendar

def next_business_day(d):
    while d.weekday() >= 5:  # Sat/Sun -> Monday. Official holidays are NOT known here: flag them.
        d += datetime.timedelta(days=1)
    return d

def month_add(y, m, k):
    y2, m2 = divmod(m - 1 + k, 12)
    return y + y2, m2 + 1

DIA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
       "septiembre", "octubre", "noviembre", "diciembre"]

def items(regime, employees, withholds, start, months=3):
    out = []
    end = datetime.date(*month_add(start.year, start.month, months), 1)
    y, m = start.year, start.month
    for k in range(months + 1):
        yy, mm = month_add(y, m, k)
        py, pm_ = month_add(yy, mm, -1)  # period being declared = previous month
        period = f"{MES[pm_]} {py}"
        d17 = next_business_day(datetime.date(yy, mm, 17))
        last = next_business_day(datetime.date(yy, mm, calendar.monthrange(yy, mm)[1]))
        isr = "ISR provisional (RESICO)" if "resico" in regime else "ISR provisional"
        out.append((d17, f"Pago mensual: {isr} e IVA de {period}", "SAT"))
        if withholds:
            out.append((d17, f"Entero de retenciones de ISR/IVA de {period} (honorarios, arrendamiento, etc.)", "SAT"))
        if employees:
            out.append((d17, f"ISR retenido por salarios de {period}", "SAT"))
            out.append((d17, f"Cuotas IMSS de {period}", "IMSS (no es SAT)"))
            if mm in (1, 3, 5, 7, 9, 11):
                out.append((d17, "Aportaciones INFONAVIT del bimestre anterior", "INFONAVIT (no es SAT)"))
            if start <= d17 < end:  # state payroll tax: the date depends on the state
                out.append((None, f"Impuesto estatal sobre nómina de {period}: fecha según tu estado", "Estado"))
        out.append((last, f"DIOT (operaciones con proveedores) de {period}", "SAT"))
        if mm == 3 and regime.startswith("pm"):
            out.append((next_business_day(datetime.date(yy, 3, 31)), f"Declaración anual {yy - 1} (persona moral)", "SAT"))
        if mm == 4 and regime.startswith("pf"):
            out.append((next_business_day(datetime.date(yy, 4, 30)), f"Declaración anual {yy - 1} (persona física)", "SAT"))
    return [i for i in out if i[0] is None or start <= i[0] < end]

def main():
    regime, emp, wh = sys.argv[1], sys.argv[2] == "yes", sys.argv[3] == "yes"
    start = datetime.date.fromisoformat(sys.argv[4]) if len(sys.argv) > 4 else datetime.date.today()
    rows = items(regime, emp, wh, start)
    seen, uniq = set(), []
    for r in rows:
        if (r[1]) not in seen: seen.add(r[1]); uniq.append(r)
    uniq.sort(key=lambda r: (r[0] or datetime.date.max, r[1]))
    with open("sat-calendar.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["due_date", "weekday", "obligation", "authority", "status", "note"])
        for d, what, who in uniq:
            w.writerow([d.isoformat() if d else "[NO DATA: fecha estatal]", DIA[d.weekday()] if d else "", what, who,
                        "pendiente", "Indicativo; confírmalo con tu contador. Si es día festivo oficial, se recorre."])
    for d, what, who in uniq:
        print(d or "[NO DATA]", "|", what, "|", who)

if __name__ == "__main__":
    main()
