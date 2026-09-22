#!/usr/bin/env bash
# Deals API: adds an exact-match `trim` filter to GET /api/inventory, mirroring the existing
# `model` filter — the admin crawl sheet's Vehicles tab gained a "Trim" input alongside "Model"
# and needs the box to support it.
#
# Run on the box (ubuntu@3.208.49.1):
#   cd ~ && curl -fsSL -o 2026-09-22-add-trim-filter.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-add-trim-filter.sh && sudo cp 2026-09-22-add-trim-filter.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-add-trim-filter.sh
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
rep('''  if (p("model")) { where.push("i.model = ?"); args.push(p("model")); }
  if (p("cond")) { where.push("i.cond = ?"); args.push(p("cond")); }''',
'''  if (p("model")) { where.push("i.model = ?"); args.push(p("model")); }
  if (p("trim")) { where.push("i.trim = ?"); args.push(p("trim")); }
  if (p("cond")) { where.push("i.cond = ?"); args.push(p("cond")); }''', "add trim filter")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1&trim=Taycan")
echo "trim-filter-check: $code"
