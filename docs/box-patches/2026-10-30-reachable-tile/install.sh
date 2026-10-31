#!/bin/bash
# "Reachable by quote request" admin tile for the box2 deals API (box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api"). Run ON box2, from the directory holding this script, files/, smoke.mjs and deals_api_server.js.patch.
#   usage:  bash install.sh check|apply|restart|restore
#   env:    DEALS_DIR (default /opt/trimscout-deals/src)   BACKUP (default ~/backups/box2-reachable-tile-20261030)   PM2 (default "sudo -u ubuntu pm2")   SUDO (default empty; set SUDO=sudo if DEALS_DIR is root-owned)
# What it changes (two files): quoteReachable.js (new) and deals_api_server.js (patched: import + the coverage count and per-dealer emailStatus run the shared rule).
# deals_api_server.js has ONE accepted starting file, md5 bd11ff77 (box2 live 2026-10-30 after the buyer-contact-reveal install, PR #643); any other md5 stops everything.
# check   read-only: md5 drift check, the patch dry-run on a COPY of the server, the smoke test on a temp copy. Changes nothing in DEALS_DIR.
# apply   gates (sync lock, sync/crawl processes), backup first, copy, md5 + syntax + smoke on the live files; auto-restores on any failure. Does NOT restart.
# restart gates again, then `$PM2 restart deals-api`, then checks the process is online with a fresh uptime and that /health answers 401.
# restore puts the backed-up server back and removes quoteReachable.js (does not restart; it prints the restart command).
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/box2-reachable-tile-20261030}; MODE=${1:-check}
PM2=${PM2:-sudo -u ubuntu pm2}; SUDO=${SUDO:-}; LOCK_LOG=${LOCK_LOG:-/home/ubuntu/.pm2/logs/deals-api-out.log}
PROC_RE=${PROC_RE:-inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone\.js|unretire|backfill|facet|make-from-vin}
API=${API:-http://127.0.0.1:3004}
md() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" 2>/dev/null | cut -d' ' -f1; else md5 -q "$1" 2>/dev/null; fi; }
QR_AFTER=cff4d09baa921dac3d2cdb23c81d6dea   # files/quoteReachable.js (absent before)
PATCH_MD5=805378b67044e9727b24d37b1b726840
SV_BASE=bd11ff778117cd932c2608e1585634d4; SV_RESULT=5ce745d698cc19bcdf9809e8982304f3
fail() { echo "FAIL: $*"; exit 1; }
[ -d "$D" ] || fail "$D is not a directory"
qr=$(md "$D/quoteReachable.js"); sv=$(md "$D/deals_api_server.js")
rollback_cmd="bash $HERE/install.sh restore && $PM2 restart deals-api"

state_of() {   # before | after | other
  if [ -z "$qr" ] && [ "$sv" = "$SV_BASE" ]; then echo before
  elif [ "$qr" = "$QR_AFTER" ] && [ "$sv" = "$SV_RESULT" ]; then echo after
  else echo other; fi
}
drift_checks() {
  [ -e "$D/deals_api_server.js" ] || fail "$D/deals_api_server.js is missing"
  [ "$(md "$HERE/files/quoteReachable.js")" = "$QR_AFTER" ] && [ "$(md "$HERE/deals_api_server.js.patch")" = "$PATCH_MD5" ] || fail "package files have the wrong md5 (corrupt copy? compare with manifest.txt)"
  for m in 'invCached' 'async function computeInventoryAnalytics' 'createRfqContactRevealHandler'; do grep -q "$m" "$D/deals_api_server.js" || fail "deals_api_server.js has no '$m' (the live file this builds on); stop and report"; done
  case "$(state_of)" in
    before) echo "state: before   (quoteReachable.js absent, deals_api_server.js $sv)";;
    after) echo "state: after    (quoteReachable.js $qr, deals_api_server.js $sv)";;
    *) if [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ]; then echo "state: other (restore mode, backup present)"; else fail "quoteReachable.js '${qr:-absent}' / deals_api_server.js '$sv' is neither the expected before (absent / $SV_BASE) nor after ($QR_AFTER / $SV_RESULT) state; stop and report, change nothing, hand-edit nothing"; fi;;
  esac
}
# cut the patched server into $1 (a temp dir), verify its md5 against the pinned result, syntax, and the wiring markers
cut_server() {
  local out=$1
  cp "$D/deals_api_server.js" "$out/deals_api_server.js"
  patch -F0 --dry-run -s "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" >/dev/null || fail "patch does not apply cleanly (zero fuzz) to the live deals_api_server.js"
  patch -F0 -s --no-backup-if-mismatch "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" || fail "patch failed"
  ls "$out"/*.rej "$out"/*.orig >/dev/null 2>&1 && fail "patch left .rej/.orig files"
  [ "$(md "$out/deals_api_server.js")" = "$SV_RESULT" ] || fail "patched server md5 $(md "$out/deals_api_server.js") != pinned result $SV_RESULT"
  cp "$out/deals_api_server.js" "$out/chk.mjs"; node --check "$out/chk.mjs" || fail "syntax error in the patched server"; rm -f "$out/chk.mjs"
  [ "$(grep -c 'import { reachabilityBucket, stampGroupDomains } from "./quoteReachable.js"' "$out/deals_api_server.js")" = 1 ] || fail "import missing after patching (node --check does not catch that)"
  [ "$(grep -c 'dealersReachable: emails.reachable' "$out/deals_api_server.js")" = 1 ] || fail "coverage fields missing after patching"
  echo "patched server: md5 $SV_RESULT, syntax ok, import + coverage fields present once each"
}
check_copy() {   # the new module in a temp dir, never in the live dir
  T=$(mktemp -d); echo '{"type":"module"}' > "$T/package.json"; cp "$HERE/files/quoteReachable.js" "$T/"
  node "$HERE/smoke.mjs" "$T" | tail -2 || { rm -rf "$T"; fail "smoke test failed on quoteReachable.js"; }
  cut_server "$T" || { rm -rf "$T"; exit 1; }
  rm -rf "$T"
}
gates() {
  last=$(grep -h "\[sync-lock\]" "$LOCK_LOG" 2>/dev/null | tail -1)
  if [ -n "$last" ] && ! echo "$last" | grep -q "release"; then fail "the last [sync-lock] line in $LOCK_LOG is not a release: the sync lock is held; wait ($last)"; fi
  p=$(ps -eo pid,args | grep -E "$PROC_RE" | grep -v -e grep -e "install.sh" -e "pm2"); [ -z "$p" ] || { echo "$p"; fail "a sync/crawl/maintenance process is running (above); wait"; }
}

case "$MODE" in
check)
  echo "== md5 before"; md5sum "$D/deals_api_server.js" 2>/dev/null || md5 "$D/deals_api_server.js"; [ -e "$D/quoteReachable.js" ] && echo "quoteReachable.js present ($qr)" || echo "quoteReachable.js absent (expected)"
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  gates; check_copy
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/deals_api_server.js" "$BACKUP/" && echo "quoteReachable.js" > "$BACKUP/absent.txt" && (cd "$BACKUP" && { md5sum deals_api_server.js 2>/dev/null || md5 -r deals_api_server.js; } | tee md5s.txt) || fail "backup failed"
  W=$(mktemp -d); cut_server "$W" >/dev/null || { rm -rf "$W"; exit 1; }
  # order: quoteReachable.js (new) first, the server last (it is the only file that imports it)
  { $SUDO cp "$HERE/files/quoteReachable.js" "$D/quoteReachable.js" && $SUDO cp "$W/deals_api_server.js" "$D/deals_api_server.js"; } || { rm -rf "$W"; echo "copy failed - restoring"; bash "$0" restore; exit 1; }
  rm -rf "$W"
  echo "== md5 after"; md5sum "$D/quoteReachable.js" "$D/deals_api_server.js" 2>/dev/null || md5 "$D/quoteReachable.js" "$D/deals_api_server.js"
  qr=$(md "$D/quoteReachable.js"); sv=$(md "$D/deals_api_server.js")
  [ "$(state_of)" = after ] || { echo "md5 mismatch after copy - restoring"; bash "$0" restore; exit 1; }
  cp "$D/deals_api_server.js" "$BACKUP/chk.mjs" && node --check "$BACKUP/chk.mjs" && rm -f "$BACKUP/chk.mjs" || { echo "syntax check of the live server failed - restoring"; bash "$0" restore; exit 1; }
  node "$HERE/smoke.mjs" "$D" | tail -2 || { echo "smoke test failed on the live files - restoring"; bash "$0" restore; exit 1; }
  echo "FILES APPLIED. The running deals-api still has the OLD code in memory. NEXT (separate step, sync lock clear):  bash $HERE/install.sh restart"
  echo "ROLLBACK:  $rollback_cmd";;
restart)
  [ "$(state_of)" = after ] || fail "the files are not in the patched state (run apply first)"
  gates
  $PM2 describe deals-api >/dev/null 2>&1 || fail "'$PM2 describe deals-api' finds no process (the root PM2 has no deals-api; the ubuntu one does)"
  before_up=$($PM2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api");console.log(p?p.pm2_env.pm_uptime:0)})')
  $PM2 restart deals-api || fail "restart failed - roll back with: $rollback_cmd"
  sleep 8
  after=$($PM2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api");console.log(p?p.pm2_env.status+" "+p.pm2_env.pm_uptime+" restarts="+p.pm2_env.restart_time:"missing")})')
  echo "deals-api after restart: $after (uptime stamp before: $before_up)"
  case "$after" in online*) [ "${after#online }" != "$before_up" ] || fail "uptime stamp unchanged - did the restart happen?";; *) fail "deals-api is not online - roll back NOW with: $rollback_cmd";; esac
  h=$(curl -s -o /dev/null -w '%{http_code}' "$API/health")
  echo "GET /health -> $h (401 = up and guarding)"
  [ "$h" = 401 ] || fail "/health did not answer 401 - roll back NOW with: $rollback_cmd"
  echo "RESTARTED. Check the log for errors: $PM2 logs deals-api --lines 30 --nostream     Then time one analytics call (STEPS.md step 5).     ROLLBACK: $rollback_cmd";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  { $SUDO cp -p "$BACKUP/deals_api_server.js" "$D/deals_api_server.js" && $SUDO rm -f "$D/quoteReachable.js"; } || fail "restore failed"
  (cd "$D" && { md5sum deals_api_server.js 2>/dev/null || md5 -r deals_api_server.js; } | diff - "$BACKUP/md5s.txt" && echo "RESTORED: deals_api_server.js matches the backup, quoteReachable.js removed. If the server was already restarted on the new files:  $PM2 restart deals-api");;
*) echo "usage: bash install.sh check|apply|restart|restore"; exit 2;;
esac
