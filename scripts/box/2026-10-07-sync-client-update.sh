#!/usr/bin/env bash
# Crawl box (run on EACH of box1-box4): install the nightly sync client with the freshness + safe-sweep rules.
#
# WHY ALL TEN FILES: as of 2026-10-07 box1, box3 and box4 still run the OLD single-file client (292 lines, per-store sweep
# loop, installed 2026-10-01 — it imports only syncLockWait/syncLockHeartbeat/syncCheckpoint). Only box2 runs the modular client
# from main. The fix lives in the modular client, so those three boxes get the whole closure of inventory-sync.mjs's imports;
# box2 already has everything but syncFreshness.js and the changed inventory-sync.mjs/syncRun.js/syncSweep.js (copying all ten is
# harmless there — identical files are simply rewritten).
#
# No restart, no cron change: run_sync_when_safe.sh starts `node inventory-sync.mjs <dir>` fresh every night, so the next run
# uses the new files. Deploy ORDER: the deals box's inventorySweep.js FIRST (2026-10-07-safe-sweep-server.sh). A new client
# talking to a server that predates it just gets the old, unprotected sweep (nothing breaks, nothing is protected yet).
#
# DO NOT RUN until Paul says go. Run it only while THIS box has no sync running (no inventory-sync.mjs process, wrapper not
# mid-run) so a run never mixes old and new files. Then prove it with a dry run (reads shards + the directory, takes no lock,
# writes nothing) and read the "skipped N ACTIVE record(s)" / "SKIPPING" / "over the ...MB limit" lines:
#   cd ~/inventory-sync && TRIMSCOUT_API_KEY=... TRIMSCOUT_BOX_LABEL=boxN node inventory-sync.mjs ~/nj-scraper/scrapers/lightsail-crawler/data/inventory --dry-run
#
# Run on a crawl box, after merge:
#   cd /tmp && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box && for f in inventory-sync.mjs shardMileage.js syncBatching.js syncCheckpoint.js syncFreshness.js syncHttp.js syncLockHeartbeat.js syncLockWait.js syncRun.js syncSweep.js 2026-10-07-sync-client-update.sh; do curl -fsSL -o /tmp/$f "$B/$f?cb=$(date +%s)"; done && bash /tmp/2026-10-07-sync-client-update.sh
set -euo pipefail
FILES="inventory-sync.mjs shardMileage.js syncBatching.js syncCheckpoint.js syncFreshness.js syncHttp.js syncLockHeartbeat.js syncLockWait.js syncRun.js syncSweep.js"
DEST="${SYNC_CLIENT_DIR:-$HOME/inventory-sync}"
[ -d "$DEST" ] || { echo "ERROR: $DEST not found" >&2; exit 1; }
if pgrep -f "inventory-sync.mjs" >/dev/null; then echo "ERROR: an inventory-sync.mjs is running on this box — wait for it to finish." >&2; exit 1; fi
for f in $FILES; do
  [ -f "/tmp/$f" ] || { echo "ERROR: /tmp/$f missing — fetch it first (see usage line)." >&2; exit 1; }
  node --check "/tmp/$f" && echo "syntax ok: $f"
done
grep -q "isFreshRecord" /tmp/inventory-sync.mjs || { echo "ERROR: /tmp/inventory-sync.mjs is not the new client" >&2; exit 1; }
grep -q "runWritePhase" /tmp/inventory-sync.mjs || { echo "ERROR: /tmp/inventory-sync.mjs is not the modular client" >&2; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST/.backup-$STAMP"
for f in $FILES; do
  [ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/.backup-$STAMP/$f"
  cp "/tmp/$f" "$DEST/$f"
done
echo "installed into $DEST (previous files saved in $DEST/.backup-$STAMP)"
echo "Rollback: cd $DEST && cp .backup-$STAMP/* . && for f in $FILES; do [ -f .backup-$STAMP/\$f ] || rm -f \$f; done"
