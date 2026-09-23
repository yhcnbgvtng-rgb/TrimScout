#!/usr/bin/env bash
# Deals API: adds a possibleDemo=1 filter to GET /api/inventory — "new"
# condition with over 500 miles usually means a demo/loaner, not a car
# fresh off the truck. There's no separate demo/loaner condition value
# anywhere in this schema (confirmed in a 2026-09-22 "new Porsche"
# inventory audit), so this filters on the two fields that already exist
# rather than adding one. Companion to the admin crawl sheet's new
# "Possible demo" checkbox.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-possible-demo-filter.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-possible-demo-filter.sh && sudo cp 2026-09-22-possible-demo-filter.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-possible-demo-filter.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); changed=[]
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    if new in s: return
    s=s.replace(old,new); changed.append(label)
rep('''  if (p("hasSticker") === "1") where.push("i.window_sticker_url IS NOT NULL");
  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }''',
'''  if (p("hasSticker") === "1") where.push("i.window_sticker_url IS NOT NULL");
  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }
  // "New" with real miles on it usually means a demo/loaner, not a car
  // fresh off the truck — there's no separate demo/loaner condition value
  // anywhere in this schema (confirmed in a 2026-09-22 inventory audit),
  // so this filters on the two fields that already exist rather than
  // adding one. 500 is a judgment call, not a manufacturer-defined
  // threshold — a handful of delivery/demo miles is normal for any new
  // car, but a few hundred or more usually means it's been driven as a
  // loaner.
  if (p("possibleDemo") === "1") where.push("i.cond = 'new' AND i.mileage > 500");''', "add possibleDemo filter")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1&possibleDemo=1")
echo "possible-demo-filter-check: $code"
