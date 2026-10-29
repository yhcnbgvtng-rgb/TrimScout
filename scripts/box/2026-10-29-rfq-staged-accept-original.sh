#!/usr/bin/env bash
# Deals API: let the buyer accept the dealer's ORIGINAL out-the-door price on a staged cash deal after the dealer declined the buyer's counter.
# Installs ONE module next to the server, rfqStages.js; NO edits to deals_api_server.js, no schema change:
#   - a declined invite that still carries the buyer's counter (rfq_invites.buyer_counter_json) and has a superseded quote is not "out of the running"
#     for ONE action, the buyer's accept_otd; that locks the original quote's out-the-door price,
#   - in the same transaction as the stage write the desk goes back to status 'quoted' and the original quote's superseded_at is cleared, so every
#     later stage step (trade-in, payment, final) works as on any other desk,
#   - everything else on a declined desk is still refused (409 "no longer in the running"), and so is an expired original.
# Steps, md5s and rollback: docs/STAGED_ACCEPT_ORIGINAL.md. Needs 2026-10-13-rfq-deal-stages-v2.sh already installed (refuses otherwise).
# The module is loaded once at start-up, so the deals-api restart below is required: do it in an IDLE WINDOW, outside the 22:00-23:30 ET
# crawl/sync window, with no inventory-sync running on any box, ON PAUL'S GO. The guard refuses otherwise.
#
# Run on the deals box (box2) as ubuntu:
#   curl -fsSL -o 2026-10-29-rfq-staged-accept-original.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-29-rfq-staged-accept-original.sh && EXPECT_MD5=<md5 from the doc> bash 2026-10-29-rfq-staged-accept-original.sh
# Test against a copy (no sudo, no pm2, module copied from a local source dir instead of downloaded):
#   TEST_ONLY=1 FILE=/path/to/copy/deals_api_server.js SRC_LOCAL=/path/to/repo/scrapers/lightsail-crawler/src bash 2026-10-29-rfq-staged-accept-original.sh
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
SRC_BASE="${SRC_BASE:-https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src}"
SRC_LOCAL="${SRC_LOCAL:-}"
EXPECT_MD5="${EXPECT_MD5:-}"
STAMP=$(date +%Y%m%d-%H%M%S)
DIR=$(dirname "$FILE")
TEST="${TEST_ONLY:-0}"
md5of() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }

# 1. The stage endpoint (v2) must already be on this server.
grep -q 'createRfqStageHandler' "$FILE" || { echo "MISSING: 2026-10-11-rfq-deal-stages.sh (createRfqStageHandler not found in $FILE). Nothing changed."; exit 1; }
grep -q 'buyer_counter_json' "$FILE" || { echo "MISSING: 2026-09-13-buyer-counter.sh (buyer_counter_json not found in $FILE). Nothing changed."; exit 1; }
[ -f "$DIR/rfqStages.js" ] && grep -q 'accept_final' "$DIR/dealStages.js" 2>/dev/null || { echo "MISSING: 2026-10-13-rfq-deal-stages-v2.sh (v2 dealStages.js not beside the server). Nothing changed."; exit 1; }

# 2. Idle-window guard (skipped by TEST_ONLY).
if [ "$TEST" != "1" ]; then
  if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
    echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
  fi
fi

# 3. Fetch + check the module in a temp dir BEFORE touching anything.
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
m=rfqStages.js
if [ -n "$SRC_LOCAL" ]; then cp "$SRC_LOCAL/$m" "$TMP/$m"; else curl -fsSL -o "$TMP/$m" "$SRC_BASE/$m"; fi
cp "$DIR/dealStages.js" "$TMP/dealStages.js"
node --check "$TMP/$m"
NEW_MD5=$(md5of "$TMP/$m")
echo "new rfqStages.js md5: $NEW_MD5"
[ -z "$EXPECT_MD5" ] || [ "$EXPECT_MD5" = "$NEW_MD5" ] || { echo "md5 mismatch: expected $EXPECT_MD5, got $NEW_MD5; aborting. Nothing changed."; exit 1; }
grep -q 'counterDeclinedOriginal' "$TMP/$m" || { echo "downloaded rfqStages.js is not the accept-original module; aborting. Nothing changed."; exit 1; }
# It must load beside the live dealStages.js before it replaces the live file.
( cd "$TMP" && node --input-type=module -e "import('./rfqStages.js').then((x) => { if (typeof x.createRfqStageHandler !== 'function') process.exit(1); })" ) || { echo "module failed to load; aborting. Nothing changed."; exit 1; }

# 4. Back up, install, restart.
SUDO="sudo"; [ "$TEST" = "1" ] && SUDO=""
echo "live rfqStages.js md5 before: $(md5of "$DIR/$m")"
if cmp -s "$TMP/$m" "$DIR/$m"; then echo "$m: already current"; else
  $SUDO cp "$DIR/$m" "$DIR/$m.bak.$STAMP" && echo "backup: $DIR/$m.bak.$STAMP (md5 $(md5of "$DIR/$m.bak.$STAMP"))"
  $SUDO install -m 0644 "$TMP/$m" "$DIR/$m"; echo "installed $DIR/$m (md5 $(md5of "$DIR/$m"))"
fi
node --check "$FILE" && echo "syntax ok"

if [ "$TEST" != "1" ]; then
  sudo pm2 restart trimscout-deals-api
  sleep 3
  echo "--- deals-api up? (401 = up and guarding; needs the key) ---"
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
  echo "--- stage route exists? (401 without the key) ---"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3004/api/rfqs/1/invites/1/stage
  echo "Rollback: sudo cp /opt/trimscout-deals/src/$m.bak.$STAMP /opt/trimscout-deals/src/$m && sudo pm2 restart trimscout-deals-api"
fi
