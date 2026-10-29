#!/bin/bash
# VIN guard for the box2 deals-API write path (box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api"). Run ON box2, from the directory holding this script, files/ and test-vin-guard.mjs.
#   usage:  bash install.sh check|apply|restart|restore
#   env:    DEALS_DIR (default /opt/trimscout-deals/src)   BACKUP (default ~/backups/box2-vin-guard-20261029)   PM2 (default "sudo -u ubuntu pm2")
# What it installs: vinWmi.js (new), stellantisMake.js (replaced: normalizeMakeForWrite ends with reconcileMake) and ingestGuards.js (the repo's, three added `export` keywords, no behaviour change).
# deals_api_server.js is NOT patched: every make it writes already goes through normalizeMakeForWrite (see STEPS.md), so it is independent of the stats-warm patch (#623/#629).
# check   read-only: md5 drift check on every file involved, then the VIN-guard test on a temp copy. Changes nothing in DEALS_DIR.
# apply   gates (sync lock, sync/crawl processes), backup, copy, md5 + syntax + test on the live files; auto-restores on any failure. Does NOT restart.
# restart gates again, then `$PM2 restart deals-api`, then checks the process is online with a fresh uptime.
# restore puts the backed-up files back and removes vinWmi.js (does not restart; it prints the restart command).
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/box2-vin-guard-20261029}; MODE=${1:-check}
PM2=${PM2:-sudo -u ubuntu pm2}; LOCK_LOG=${LOCK_LOG:-/home/ubuntu/.pm2/logs/deals-api-out.log}; PROC_RE=${PROC_RE:-inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone\.js|unretire|backfill|facet|make-from-vin}
md() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
# before: stellantisMake = the repo's pre-#580 file, ingestGuards = the 2026-10-07 file (#393), vinWmi absent. after: the files/ copies.
SM_BEFORE=4f384997f7107b66b9521bb561b7a10e; IG_BEFORE=0ba41bc0c45b07ad75a2fd32571937da
SM_AFTER=4017f1f9e24dc14d1b2cc530737e1e00; IG_AFTER=88ec75c5d81a19dd484de0dea62add28; VW_AFTER=274e60473eb1d83fe6b01def4e5f68dc
VT=2bb0902516fe1279adec20291096ac7b
fail() { echo "FAIL: $*"; exit 1; }
[ -d "$D" ] || fail "$D is not a directory"
sm=$(md "$D/stellantisMake.js"); vw=$(md "$D/vinWmi.js"); ig=$(md "$D/ingestGuards.js"); vt=$(md "$D/stellantisVinTable.js"); sv=$(md "$D/deals_api_server.js")
rollback_cmd="bash $HERE/install.sh restore && $PM2 restart deals-api"

state_of() {   # echoes before | after | other
  if [ "$sm" = "$SM_BEFORE" ] && [ "$ig" = "$IG_BEFORE" ] && [ -z "$vw" ]; then echo before
  elif [ "$sm" = "$SM_AFTER" ] && [ "$ig" = "$IG_AFTER" ] && [ "$vw" = "$VW_AFTER" ]; then echo after
  else echo other; fi
}
drift_checks() {
  [ "$vt" = "$VT" ] || fail "stellantisVinTable.js md5 is '$vt', expected $VT"
  [ -e "$D/deals_api_server.js" ] || fail "$D/deals_api_server.js is missing"
  grep -q 'import { normalizeMakeForWrite } from "./stellantisMake.js"' "$D/deals_api_server.js" || fail "deals_api_server.js does not import normalizeMakeForWrite from ./stellantisMake.js (the guard's only entry point); stop and report"
  n=$(grep -c "normalizeMakeForWrite({" "$D/deals_api_server.js"); [ "$n" -ge 3 ] || fail "deals_api_server.js has $n normalizeMakeForWrite call sites, expected >= 3 (has the write path changed?); stop and report"
  grep -q "make: v.make, vin: v.vin" "$D/deals_api_server.js" || fail "the write path no longer passes the VIN to normalizeMakeForWrite; stop and report"
  # every other file in DEALS_DIR that imports ingestGuards must only use names the new file still exports (it only gained exports)
  for f in "$D"/*.js; do [ "$f" = "$D/ingestGuards.js" ] && continue; grep -l "ingestGuards.js" "$f" >/dev/null 2>&1 && echo "  imports ingestGuards.js: $(basename "$f")"; done
  [ "$(md "$HERE/files/vinWmi.js")" = "$VW_AFTER" ] && [ "$(md "$HERE/files/stellantisMake.js")" = "$SM_AFTER" ] && [ "$(md "$HERE/files/ingestGuards.js")" = "$IG_AFTER" ] || fail "files/ copies have the wrong md5 (corrupt copy? run: md5sum -c manifest.txt)"
  st=$(state_of)
  case "$st" in
    before|after) echo "state: $st   (stellantisMake $sm, ingestGuards $ig, vinWmi ${vw:-absent}, deals_api_server.js $sv)";;
    *) if [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ]; then echo "state: other (restore mode, backup present)"; else fail "stellantisMake.js '$sm' / ingestGuards.js '$ig' / vinWmi.js '${vw:-absent}' is neither the expected before ($SM_BEFORE / $IG_BEFORE / absent) nor after ($SM_AFTER / $IG_AFTER / $VW_AFTER) state; stop and report, change nothing"; fi;;
  esac
}
check_copy() {   # the new files + the box's own stellantisVinTable, in a temp dir, never in the live dir
  T=$(mktemp -d); echo '{"type":"module"}' > $T/package.json
  cp "$D/stellantisVinTable.js" $T/; cp "$HERE/files/vinWmi.js" "$HERE/files/stellantisMake.js" "$HERE/files/ingestGuards.js" $T/
  for f in vinWmi.js stellantisMake.js ingestGuards.js; do cp $T/$f $T/chk.mjs; node --check $T/chk.mjs || { rm -rf $T; fail "syntax error in $f"; }; done
  node "$HERE/test-vin-guard.mjs" $T | tail -2 || { rm -rf $T; fail "VIN-guard test failed on the new files"; }
  rm -rf $T
}
gates() {
  grep -h "\[sync-lock\]" "$LOCK_LOG" 2>/dev/null | tail -1 | grep -q "release" || { grep -h "\[sync-lock\]" "$LOCK_LOG" 2>/dev/null | tail -1 | grep -q . && fail "the last [sync-lock] line in $LOCK_LOG is not a release: the sync lock is held; wait"; }
  p=$(ps -eo pid,args | grep -E "$PROC_RE" | grep -v -e grep -e "install.sh" -e "pm2"); [ -z "$p" ] || { echo "$p"; fail "a sync/crawl/maintenance process is running (above); wait"; }
}

case "$MODE" in
check)
  echo "== md5 before"; md5sum $D/stellantisMake.js $D/ingestGuards.js $D/stellantisVinTable.js $D/deals_api_server.js; [ -e $D/vinWmi.js ] && md5sum $D/vinWmi.js || echo "vinWmi.js absent (expected)"
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  gates; check_copy
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/stellantisMake.js" "$D/ingestGuards.js" "$BACKUP/" && echo "vinWmi.js" > "$BACKUP/absent.txt" && (cd "$BACKUP" && md5sum stellantisMake.js ingestGuards.js | tee md5s.txt) || fail "backup failed"
  # order: vinWmi (new, imported by stellantisMake) -> ingestGuards (only gained exports) -> stellantisMake last
  cp "$HERE/files/vinWmi.js" "$D/vinWmi.js" && cp "$HERE/files/ingestGuards.js" "$D/ingestGuards.js" && cp "$HERE/files/stellantisMake.js" "$D/stellantisMake.js" || { echo "copy failed - restoring"; bash "$0" restore; exit 1; }
  echo "== md5 after"; md5sum $D/vinWmi.js $D/ingestGuards.js $D/stellantisMake.js
  [ "$(md "$D/vinWmi.js")" = "$VW_AFTER" ] && [ "$(md "$D/ingestGuards.js")" = "$IG_AFTER" ] && [ "$(md "$D/stellantisMake.js")" = "$SM_AFTER" ] || { echo "md5 mismatch - restoring"; bash "$0" restore; exit 1; }
  node "$HERE/test-vin-guard.mjs" "$D" | tail -2 || { echo "VIN-guard test failed on the live files - restoring"; bash "$0" restore; exit 1; }
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
  echo "RESTARTED. Check the log for errors: $PM2 logs deals-api --lines 30 --nostream     ROLLBACK: $rollback_cmd";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  cp -p "$BACKUP/stellantisMake.js" "$D/stellantisMake.js" && cp -p "$BACKUP/ingestGuards.js" "$D/ingestGuards.js" && rm -f "$D/vinWmi.js" || fail "restore failed"
  (cd "$D" && md5sum stellantisMake.js ingestGuards.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: stellantisMake.js and ingestGuards.js match the backup, vinWmi.js removed. If the server was already restarted on the new files:  $PM2 restart deals-api");;
*) echo "usage: bash install.sh check|apply|restart|restore"; exit 2;;
esac
