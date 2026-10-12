#!/usr/bin/env bash
# Deals API: the Cash / Finance deal stages, second half (PR "Trade-in counter loop, payment choice, dealer financing offer,
# final acceptance, buyer-details release"). Installs the updated modules next to the server; NO edits to deals_api_server.js
# (the stage route and handler were wired by 2026-10-11-rfq-deal-stages.sh and need no new anchors):
#   dealStages.js  trade counter loop (accept / counter / revise / hold firm, repeats until agreed); true OTD = OTD - trade + payoff;
#                  payment choice (cash | own financing | dealer financing 36/48/60/72); dealer offer = APR + term + lender with
#                  monthly / amount financed validated against the math; buyer APR counter loop; final acceptance (accept_final)
#                  is the ONLY thing that releases the buyer's name / email / phone / ZIP, onto the winning dealer's stage_json.
#   rfqStages.js   passes the stored trade payoff in, reads the buyer's contact only from accept_final by the buyer, closes the request
#                  on accept_final (no longer on choosing cash / financing), logs a buyer_details_released event (no details in it).
# No schema change. Stage JSON already in rfq_invites.stage_json is read as before (v1 states keep working until they next move).
#
# ORDER ON THE BOX (each script is idempotent; this one refuses to run unless the earlier ones are on the server):
#   1. 2026-10-08-rfq-trade-in.sh      (#414)  trade-in on the request            [needs: trade_in_json]
#   2. 2026-10-11-rfq-deal-stages.sh   (#482)  stage endpoint                     [needs: createRfqStageHandler]
#   3. 2026-10-12-rfq-not-selected.sh  (#490)  not-selected + trade after accept  [needs: createRfqNotSelectedHandler]
#   4. THIS SCRIPT.
# The modules are ES modules loaded once at start-up, so the deals-api restart below is required: do it in an IDLE WINDOW,
# outside the 22:00-23:30 ET crawl/sync window, with no inventory-sync running on any box, ON PAUL'S GO. The guard refuses otherwise.
# Do NOT set FEATURE_DEAL_STAGES=on in Vercel until the verification steps in docs/DEAL_STAGES.md pass.
#
# Run on the deals box (box2) as ubuntu:
#   curl -fsSL -o 2026-10-13-rfq-deal-stages-v2.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-13-rfq-deal-stages-v2.sh && bash 2026-10-13-rfq-deal-stages-v2.sh
# Test against a copy (no sudo, no pm2, modules copied from a local source dir instead of downloaded):
#   TEST_ONLY=1 FILE=/path/to/copy/deals_api_server.js SRC_LOCAL=/path/to/repo/scrapers/lightsail-crawler/src bash 2026-10-13-rfq-deal-stages-v2.sh
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
SRC_BASE="${SRC_BASE:-https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src}"
SRC_LOCAL="${SRC_LOCAL:-}"
STAMP=$(date +%Y%m%d-%H%M%S)
DIR=$(dirname "$FILE")
TEST="${TEST_ONLY:-0}"

# 1. The earlier patches must already be on this server (their anchors are what the new modules rely on).
need() { grep -q "$1" "$FILE" || { echo "MISSING: $2 ($1 not found in $FILE). Apply it first. Nothing changed."; exit 1; }; }
need 'trade_in_json' '2026-10-08-rfq-trade-in.sh'
need 'createRfqStageHandler' '2026-10-11-rfq-deal-stages.sh'
need 'createRfqNotSelectedHandler' '2026-10-12-rfq-not-selected.sh'

# 2. Idle-window guard (skipped by TEST_ONLY).
if [ "$TEST" != "1" ]; then
  if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
    echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
  fi
fi

# 3. Fetch + syntax-check both modules into a temp dir BEFORE touching anything.
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for m in dealStages.js rfqStages.js; do
  if [ -n "$SRC_LOCAL" ]; then cp "$SRC_LOCAL/$m" "$TMP/$m"; else curl -fsSL -o "$TMP/$m" "$SRC_BASE/$m"; fi
  node --check "$TMP/$m"
done
grep -q 'accept_final' "$TMP/dealStages.js" || { echo "downloaded dealStages.js is not the v2 module; aborting. Nothing changed."; exit 1; }
# The pair must load together (rfqStages imports dealStages) before it replaces the live files.
( cd "$TMP" && node --input-type=module -e "import('./rfqStages.js').then((m) => { if (typeof m.createRfqStageHandler !== 'function') process.exit(1); })" ) || { echo "module pair failed to load; aborting. Nothing changed."; exit 1; }

# 4. Back up, install, restart.
SUDO="sudo"; [ "$TEST" = "1" ] && SUDO=""
for m in dealStages.js rfqStages.js; do
  if [ -f "$DIR/$m" ] && cmp -s "$TMP/$m" "$DIR/$m"; then echo "$m: already current"; continue; fi
  [ -f "$DIR/$m" ] && $SUDO cp "$DIR/$m" "$DIR/$m.bak.$STAMP" && echo "backup: $DIR/$m.bak.$STAMP"
  $SUDO install -m 0644 "$TMP/$m" "$DIR/$m"; echo "installed $DIR/$m"
done
node --check "$FILE" && echo "syntax ok"

if [ "$TEST" != "1" ]; then
  sudo pm2 restart trimscout-deals-api
  sleep 3
  echo "--- deals-api up? (401 = up and guarding; needs the key) ---"
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
  echo "--- stage route exists? (401 without the key; 404 would mean 2026-10-11 is missing) ---"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3004/api/rfqs/1/invites/1/stage
  echo "Rollback: for m in dealStages.js rfqStages.js; do sudo cp /opt/trimscout-deals/src/\$m.bak.$STAMP /opt/trimscout-deals/src/\$m; done; sudo pm2 restart trimscout-deals-api"
fi
