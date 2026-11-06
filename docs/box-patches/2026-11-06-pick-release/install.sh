#!/bin/bash
# "Choose this quote" releases the winner on box2 (PR #710 box half). box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api". Run ON box2, from the directory holding this script, files/, smoke.mjs and deals_api_server.js.patch.
#   usage:  bash install.sh check|apply|restart|verify|restore
#   env:    DEALS_DIR (default /opt/trimscout-deals/src)   BACKUP (default ~/backups/box2-pick-release-20261106)   PM2 (default "pm2", run as the ubuntu user, not root)
# Changes two files: dealStages.js (replaced whole: adds the releaseOnPick export, nothing else) and deals_api_server.js (patched: 1 import + the release block in handlePickRfqQuote).
# Both patches are cut from the LIVE box2 files (md5s below). Any other md5 stops everything: do not hand-edit, re-cut.
# check   read-only: md5 drift, patch dry-run (zero fuzz) on a COPY, smoke test on a temp copy. Changes nothing in DEALS_DIR.
# apply   gates (sync lock, sync/crawl processes), backup first, copy, md5 + syntax + smoke on the live files; auto-restores on failure. Does NOT restart.
# restart gates again, then $PM2 restart deals-api, then checks online + fresh uptime + /health + the pick route still answers 401 without the key.
# verify  read-only: with the box's own key (read from the env file, never printed) a pick of a quote that does not exist answers 404 (no write happens before that), and the live dealStages.js passes the smoke test.
# restore puts the backed-up files back (does not restart; prints the command). There is no schema change, so nothing else to undo.
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/box2-pick-release-20261106}; MODE=${1:-check}
PM2=${PM2:-pm2}; LOCK_LOG=${LOCK_LOG:-/home/ubuntu/.pm2/logs/deals-api-out.log}
PROC_RE=${PROC_RE:-inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone\.js|unretire|backfill|facet|make-from-vin}
API=${API:-http://127.0.0.1:3004}; ENVFILE=${ENVFILE:-/opt/trimscout-deals/.env.trimscout-db}
md() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" 2>/dev/null | cut -d' ' -f1; else md5 -q "$1" 2>/dev/null; fi; }
SV_BASE=d63818f09574575a7b593d144687dead; SV_AFTER=af0269fc579aa51ee5b7d9499bc8a265; DS_BASE=ac03cf8c496a89fcbe9ec1bfefc2ab67; DS_AFTER=3ec2b488915b154b4eef0b86f59e75e3; PATCH_MD5=aeb9ef881d2163af4ec603a787691af4
fail() { echo "FAIL: $*"; exit 1; }
[ -d "$D" ] || fail "$D is not a directory"
ds=$(md "$D/dealStages.js"); sv=$(md "$D/deals_api_server.js")
rollback_cmd="bash $HERE/install.sh restore && $PM2 restart deals-api"
state_of() { if [ "$ds" = "$DS_BASE" ] && [ "$sv" = "$SV_BASE" ]; then echo before; elif [ "$ds" = "$DS_AFTER" ] && [ "$sv" = "$SV_AFTER" ]; then echo after; else echo other; fi; }
drift_checks() {
  [ "$(md "$HERE/files/dealStages.js")" = "$DS_AFTER" ] && [ "$(md "$HERE/deals_api_server.js.patch")" = "$PATCH_MD5" ] || fail "package files have the wrong md5 (corrupt copy? compare with manifest.txt)"
  for m in 'async function handlePickRfqQuote' 'pickedQuoteId: quoteId' 'function parseJsonCol(' 'async function logRfqEvent(' 'createRfqStageHandler'; do grep -aq "$m" "$D/deals_api_server.js" || fail "deals_api_server.js has no '$m'; stop and report"; done
  for m in 'export function initialStageState' 'const cleanContact = ' 'const done = ' 'const fail = ' 'export function stageForDealer'; do grep -aq "$m" "$D/dealStages.js" || fail "dealStages.js has no '$m'; stop and report"; done
  [ "$(grep -ac 'releaseOnPick' "$D/dealStages.js")" = 0 ] || [ "$(state_of)" = after ] || fail "dealStages.js already mentions releaseOnPick but is not the packaged file; stop and report"
  [ -e "$D/stateTradeCredit.js" ] || fail "stateTradeCredit.js (an import of dealStages.js) is missing; stop and report"
  case "$(state_of)" in
    before) echo "state: before   (dealStages.js $ds and deals_api_server.js $sv = the pinned live files)";;
    after) echo "state: after    (dealStages.js $ds, deals_api_server.js $sv)";;
    *) if [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ]; then echo "state: other (restore mode, backup present)"; else fail "dealStages.js '${ds:-absent}' / deals_api_server.js '${sv:-absent}' is neither the pinned live pair nor the packaged pair; do not patch, re-cut from the live files"; fi;;
  esac
}
cut_server() {
  local out=$1
  cp "$D/deals_api_server.js" "$out/deals_api_server.js"
  patch -F0 --dry-run -s "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" >/dev/null || fail "patch does not apply cleanly (zero fuzz) to the live deals_api_server.js"
  patch -F0 -s --no-backup-if-mismatch "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" || fail "patch failed"
  ls "$out"/*.rej "$out"/*.orig >/dev/null 2>&1 && fail "patch left .rej/.orig files"
  [ "$(md "$out/deals_api_server.js")" = "$SV_AFTER" ] || fail "patched server md5 $(md "$out/deals_api_server.js") != pinned result $SV_AFTER"
  cp "$out/deals_api_server.js" "$out/chk.mjs"; node --check "$out/chk.mjs" || fail "syntax error in the patched server"; rm -f "$out/chk.mjs"
  [ "$(grep -ac 'import { releaseOnPick } from "./dealStages.js"' "$out/deals_api_server.js")" = 1 ] || fail "import missing (or doubled) after patching"
  [ "$(grep -ac 'releaseOnPick(parseJsonCol(rawBefore)' "$out/deals_api_server.js")" = 1 ] || fail "release call missing (or doubled) after patching"
  [ "$(grep -ac '(stage_json <=> ?)' "$out/deals_api_server.js")" = 1 ] || fail "compare-and-set UPDATE missing after patching"
  echo "patched server: md5 $SV_AFTER, syntax ok, import + release call + compare-and-set present once each"
}
check_copy() {
  T=$(mktemp -d); echo '{"type":"module"}' > "$T/package.json"; cp "$HERE/files/dealStages.js" "$T/"
  for dep in $(grep -oE 'from "\./[A-Za-z0-9_]+\.js"' "$HERE/files/dealStages.js" | sed -E 's/from "\.\/(.*)"/\1/'); do [ -e "$D/$dep" ] && cp "$D/$dep" "$T/"; done
  node "$HERE/smoke.mjs" "$T" > "$T/smoke.out" 2>&1 || { tail -5 "$T/smoke.out"; rm -rf "$T"; fail "smoke test failed on the packaged dealStages.js beside the box's own imports"; }; tail -1 "$T/smoke.out"
  cut_server "$T" || { rm -rf "$T"; exit 1; }
  rm -rf "$T"
}
gates() {
  last=$(grep -h "\[sync-lock\]" "$LOCK_LOG" 2>/dev/null | tail -1)
  if [ -n "$last" ] && ! echo "$last" | grep -q "release"; then fail "the last [sync-lock] line in $LOCK_LOG is not a release: the sync lock is held; wait ($last)"; fi
  p=$(ps -eo pid,args | grep -E "$PROC_RE" | grep -v -e grep -e "install.sh" -e "pm2"); [ -z "$p" ] || { echo "$p"; fail "a sync/crawl/maintenance process is running (above); wait"; }
}
pm2_state() { $PM2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api");console.log(p?p.pm2_env.status+" "+p.pm2_env.pm_uptime+" restarts="+p.pm2_env.restart_time:"missing")})'; }

case "$MODE" in
check)
  echo "== md5 before"; md5sum "$D/dealStages.js" "$D/deals_api_server.js"
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  gates; check_copy
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/deals_api_server.js" "$D/dealStages.js" "$BACKUP/" && (cd "$BACKUP" && md5sum deals_api_server.js dealStages.js | tee md5s.txt) || fail "backup failed"
  W=$(mktemp -d); cut_server "$W" >/dev/null || { rm -rf "$W"; exit 1; }
  { cp "$HERE/files/dealStages.js" "$D/dealStages.js" && cp "$W/deals_api_server.js" "$D/deals_api_server.js"; } || { rm -rf "$W"; echo "copy failed - restoring"; bash "$0" restore; exit 1; }
  rm -rf "$W"
  ds=$(md "$D/dealStages.js"); sv=$(md "$D/deals_api_server.js"); echo "== md5 after"; md5sum "$D/dealStages.js" "$D/deals_api_server.js"
  [ "$(state_of)" = after ] || { echo "md5 mismatch after copy - restoring"; bash "$0" restore; exit 1; }
  cp "$D/deals_api_server.js" "$BACKUP/chk.mjs" && node --check "$BACKUP/chk.mjs" && rm -f "$BACKUP/chk.mjs" || { echo "syntax check of the live server failed - restoring"; bash "$0" restore; exit 1; }
  node "$HERE/smoke.mjs" "$D" > "$BACKUP/smoke.out" 2>&1 && tail -1 "$BACKUP/smoke.out" || { tail -5 "$BACKUP/smoke.out"; echo "smoke test failed on the live files - restoring"; bash "$0" restore; exit 1; }
  echo "FILES APPLIED. The running deals-api still has the OLD code in memory. NEXT (separate step, sync lock clear):  bash $HERE/install.sh restart"
  echo "ROLLBACK:  $rollback_cmd";;
restart)
  [ "$(state_of)" = after ] || fail "the files are not in the patched state (run apply first)"
  gates
  $PM2 describe deals-api >/dev/null 2>&1 || fail "'$PM2 describe deals-api' finds no process for this user"
  before_up=$(pm2_state | cut -d' ' -f2)
  $PM2 restart deals-api || fail "restart failed - roll back with: $rollback_cmd"
  sleep 8
  after=$(pm2_state); echo "deals-api after restart: $after (uptime stamp before: $before_up)"
  case "$after" in online*) [ "$(echo "$after" | cut -d' ' -f2)" != "$before_up" ] || fail "uptime stamp unchanged - did the restart happen?";; *) fail "deals-api is not online - roll back NOW with: $rollback_cmd";; esac
  h=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"); g=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/rfqs/0/pick")
  echo "GET /health -> $h    POST /api/rfqs/0/pick without the key -> $g   (401 = route exists and guarded)"
  [ "$h" = 200 ] && [ "$g" = 401 ] || fail "health is not 200 or the pick route does not answer 401 - roll back NOW with: $rollback_cmd"
  echo "RESTARTED. Next: bash $HERE/install.sh verify     Logs: $PM2 logs deals-api --lines 30 --nostream     ROLLBACK: $rollback_cmd";;
verify)
  [ "$(state_of)" = after ] || fail "the files are not in the patched state"
  set -a; . "$ENVFILE"; set +a
  body=$(curl -s -w '\n%{http_code}' -X POST -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" -H 'Content-Type: application/json' -d '{"quoteId":999999999,"buyerContact":{"email":"install-probe@example.invalid"}}' "$API/api/rfqs/1/pick")
  code=$(echo "$body" | tail -1); echo "with key, pick of a quote that does not exist -> $code $(echo "$body" | head -1 | cut -c1-80)"
  [ "$code" = 404 ] || fail "expected 404 'Quote not found' (this probe writes nothing)"
  T=$(mktemp -d); echo '{"type":"module"}' > "$T/package.json"; cp "$D/dealStages.js" "$D/stateTradeCredit.js" "$T/" 2>/dev/null
  node "$HERE/smoke.mjs" "$T" | tail -1 || fail "smoke test failed on the live dealStages.js"; rm -rf "$T"
  grep -aq 'releaseOnPick(parseJsonCol(rawBefore)' "$D/deals_api_server.js" || fail "live server has no release call"
  echo "VERIFIED (read-only). The real end-to-end check is one non-staged test pick in SAFE MODE - see STEPS.md; it is NOT part of this script because it writes."
  ;;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  { cp -p "$BACKUP/deals_api_server.js" "$D/deals_api_server.js" && cp -p "$BACKUP/dealStages.js" "$D/dealStages.js"; } || fail "restore failed"
  (cd "$D" && md5sum deals_api_server.js dealStages.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: both files match the backup. If the server was already restarted on the new files:  $PM2 restart deals-api");;
*) echo "usage: bash install.sh check|apply|restart|verify|restore"; exit 2;;
esac
