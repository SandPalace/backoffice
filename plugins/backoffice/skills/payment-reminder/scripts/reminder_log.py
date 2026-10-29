#!/usr/bin/env python3
"""Who to remind today, at which level, and the log of every reminder (python3 standard library only).

  python3 reminder_log.py due --portfolio portfolio.csv --log reminders-log.csv [--today 2026-10-22] [--cooldown 3]
      Lists open invoices grouped by client with days overdue, the level (PRE, N0-N3) and whether the client
      can be contacted today (cooldown since the last sent message; hours 9:00-19:00 Mon-Sat).
  python3 reminder_log.py log --log reminders-log.csv --client "Cliente" --folios F-1,F-2 --level N1 \
      --channel whatsapp --status sent|approved|drafted|skipped [--to 5218112345678] [--note "..."]
      Appends one line (UTC timestamp). Never edits or deletes lines.
  python3 reminder_log.py selftest

portfolio.csv columns: folio,client,due_date,amount,paid (the revenue-ledger `portfolio` export or the aging input).
Levels: PRE = due in 0-3 days; N0 = 1-7 days overdue; N1 = 8-30; N2 = 31-60; N3 = 61+.
"""
import argparse, csv, datetime as dt, os, sys, tempfile
from decimal import Decimal

LOG_FIELDS = ["at", "client", "folios", "level", "channel", "status", "to", "note"]


def level(days_overdue):
    if days_overdue < -3:
        return None  # not due soon: nothing to send
    if days_overdue <= 0:
        return "PRE"
    if days_overdue <= 7:
        return "N0"
    if days_overdue <= 30:
        return "N1"
    if days_overdue <= 60:
        return "N2"
    return "N3"


def read_portfolio(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    need = {"folio", "client", "due_date", "amount"}
    if rows and not need.issubset(rows[0].keys()):
        sys.exit(f"portfolio.csv needs columns {sorted(need)} (paid optional); got {list(rows[0].keys())}")
    return rows


def last_sent(log_path):
    last = {}
    if not os.path.exists(log_path):
        return last
    with open(log_path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("status") == "sent":
                at = dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00")).date()
                if r["client"] not in last or at > last[r["client"]]:
                    last[r["client"]] = at
    return last


def can_send_now(now):
    return now.weekday() < 6 and 9 <= now.hour < 19  # Mon-Sat, 9:00-19:00 local time


def due(args, out=sys.stdout):
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    rows = read_portfolio(args.portfolio)
    sent = last_sent(args.log)
    clients = {}
    for r in rows:
        balance = Decimal(r["amount"]) - Decimal(r.get("paid") or "0")
        if balance <= 0:
            continue
        days = (today - dt.date.fromisoformat(r["due_date"])).days
        lv = level(days)
        if lv is None:
            continue
        c = clients.setdefault(r["client"], {"folios": [], "balance": Decimal("0"), "max_days": -999})
        c["folios"].append(f'{r["folio"]} ({days:+d} d, ${balance:,.2f})')
        c["balance"] += balance
        c["max_days"] = max(c["max_days"], days)
    print("| Cliente | Nivel | Saldo | Facturas | Último envío | ¿Hoy? |", file=out)
    print("|---|---|---|---|---|---|", file=out)
    order = sorted(clients.items(), key=lambda kv: -kv[1]["max_days"])
    for name, c in order:
        lv = level(c["max_days"])
        prev = sent.get(name)
        wait = prev and (today - prev).days < args.cooldown
        ok = "no: enfriamiento hasta " + str(prev + dt.timedelta(days=args.cooldown)) if wait else "sí"
        print(f'| {name} | {lv} | ${c["balance"]:,.2f} | {"; ".join(c["folios"])} | {prev or "-"} | {ok} |', file=out)
    now = dt.datetime.now()
    if not args.today and not can_send_now(now):
        print("\nFuera de horario (9:00-19:00 lunes a sábado): prepara borradores, no envíes ahora.", file=out)
    print(f"\n{len(order)} clientes con saldo por recordar.", file=out)
    return order


def log(args):
    new = not os.path.exists(args.log)
    with open(args.log, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new:
            w.writeheader()
        w.writerow({"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "client": args.client,
                    "folios": args.folios, "level": args.level, "channel": args.channel, "status": args.status,
                    "to": args.to or "", "note": args.note or ""})
    print(f"Registrado: {args.client} · {args.level} · {args.status}")


def selftest():
    ok = True
    def check(name, cond):
        nonlocal ok
        print(("PASS  " if cond else "FAIL  ") + name)
        ok = ok and cond
    check("levels", [level(d) for d in (-5, -3, 0, 1, 7, 8, 30, 31, 60, 61)] == [None, "PRE", "PRE", "N0", "N0", "N1", "N1", "N2", "N2", "N3"])
    check("hours", can_send_now(dt.datetime(2026, 10, 22, 10)) and not can_send_now(dt.datetime(2026, 10, 25, 10)) and not can_send_now(dt.datetime(2026, 10, 22, 19)))
    d = tempfile.mkdtemp()
    p, l = os.path.join(d, "portfolio.csv"), os.path.join(d, "log.csv")
    with open(p, "w", newline="") as f:
        f.write("folio,client,due_date,amount,paid\nF-1,Ana,2026-10-01,1000,0\nF-2,Ana,2026-10-15,500,500\nF-3,Beto,2026-10-24,300,\nF-4,Caro,2026-12-01,900,0\n")
    class A: pass
    a = A(); a.portfolio, a.log, a.today, a.cooldown = p, l, "2026-10-22", 3
    import io
    buf = io.StringIO(); order = due(a, buf)
    names = [n for n, _ in order]
    check("paid invoice and far-future invoice skipped", names == ["Ana", "Beto"])
    check("Ana is N1 (21 days)", "| Ana | N1 |" in buf.getvalue())
    check("Beto is PRE (due in 2 days)", "| Beto | PRE |" in buf.getvalue())
    b = A(); b.log, b.client, b.folios, b.level, b.channel, b.status, b.to, b.note = l, "Ana", "F-1", "N1", "whatsapp", "sent", "", ""
    log(b)
    with open(l) as f:
        rows = list(csv.DictReader(f))
    rows[0]["at"] = "2026-10-21T16:00:00Z"
    with open(l, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS); w.writeheader(); w.writerows(rows)
    buf = io.StringIO(); due(a, buf)
    check("cooldown blocks Ana for 3 days", "| Ana | N1 |" in buf.getvalue() and "enfriamiento hasta 2026-10-24" in buf.getvalue())
    check("Beto still sendable", "| Beto | PRE |" in buf.getvalue() and buf.getvalue().split("| Beto |")[1].split("\n")[0].endswith("| sí |"))
    print("\nselftest: " + ("ALL PASSED" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser(description="Payment reminders: who is due today and the send log.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("due"); d.add_argument("--portfolio", required=True); d.add_argument("--log", required=True)
    d.add_argument("--today"); d.add_argument("--cooldown", type=int, default=3)
    g = sub.add_parser("log"); g.add_argument("--log", required=True); g.add_argument("--client", required=True)
    g.add_argument("--folios", required=True); g.add_argument("--level", required=True)
    g.add_argument("--channel", required=True, choices=["whatsapp", "email", "other"])
    g.add_argument("--status", required=True, choices=["drafted", "approved", "sent", "skipped"])
    g.add_argument("--to"); g.add_argument("--note")
    sub.add_parser("selftest")
    a = ap.parse_args()
    if a.cmd == "due":
        due(a)
    elif a.cmd == "log":
        log(a)
    else:
        selftest()


if __name__ == "__main__":
    main()
