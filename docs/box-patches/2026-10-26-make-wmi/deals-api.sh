#!/bin/bash
# Make-from-VIN patch, DEALS-API side (box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api"). Run ON box2, from the directory holding this script, files/ and test-five-vins.mjs.
#   usage:  bash deals-api.sh check|apply|restore        env: DEALS_DIR (default /opt/trimscout-deals/src)  BACKUP (default ~/backups/make-wmi-deals-20261026)
# deals_api_server.js is NOT touched: it already imports normalizeMakeForWrite from ./stellantisMake.js (lines ~50, ~2540, ~2601). The change is two files:
#   vinWmi.js (new) and stellantisMake.js (replaced). stellantisVinTable.js and ingestGuards.js already exist there and are left exactly as they are (box2 has the 2026-10-07 ingestGuards, 0ba41bc0; vinWmi only needs its canonicalMake).
# apply/restore copy files and run the test; they do NOT restart. The running server keeps the old code until:   pm2 restart deals-api   (as ubuntu; see STEPS.md for when).
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/make-wmi-deals-20261026}; MODE=${1:-check}
md() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
SM_BEFORE=4f384997f7107b66b9521bb561b7a10e; SM_AFTER=4017f1f9e24dc14d1b2cc530737e1e00; VW_AFTER=422bd7190ee821d33449d28489e22d17
VT=2bb0902516fe1279adec20291096ac7b; IG=0ba41bc0c45b07ad75a2fd32571937da
fail() { echo "FAIL: $*"; exit 1; }
sm=$(md "$D/stellantisMake.js"); vw=$(md "$D/vinWmi.js"); vt=$(md "$D/stellantisVinTable.js"); ig=$(md "$D/ingestGuards.js")
[ "$vt" = "$VT" ] || fail "stellantisVinTable.js md5 is '$vt', expected $VT"
[ "$ig" = "$IG" ] || fail "ingestGuards.js md5 is '$ig', expected $IG (it must export canonicalMake; stop and report)"
grep -q "export function canonicalMake" "$D/ingestGuards.js" || fail "ingestGuards.js has no canonicalMake export"
if [ "$sm" = "$SM_AFTER" ] && [ "$vw" = "$VW_AFTER" ]; then ALREADY=1; elif [ "$sm" = "$SM_BEFORE" ] && [ -z "$vw" ]; then ALREADY=0
else [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ] || fail "stellantisMake.js md5 '$sm' / vinWmi.js '$vw' is not the expected before ($SM_BEFORE / absent) or after ($SM_AFTER / $VW_AFTER) state; stop and report"; ALREADY=0; fi
[ "$MODE" = restore ] || { [ "$ALREADY" = 1 ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }; }
[ "$(md "$HERE/files/stellantisMake.js")" = "$SM_AFTER" ] && [ "$(md "$HERE/files/vinWmi.js")" = "$VW_AFTER" ] || fail "files/ copies have the wrong md5 (corrupt copy?)"
check_copy() {   # test the two files against the box's real ingestGuards/stellantisVinTable in a temp dir, never in the live dir
  T=$(mktemp -d); echo '{"type":"module"}' > $T/package.json
  cp "$D/ingestGuards.js" "$D/stellantisVinTable.js" $T/; cp "$HERE/files/vinWmi.js" "$HERE/files/stellantisMake.js" $T/
  for f in vinWmi.js stellantisMake.js; do cp $T/$f $T/chk.mjs; node --check $T/chk.mjs || fail "syntax error in $f"; done
  node "$HERE/test-five-vins.mjs" deals $T | tail -2 || fail "five-VIN test failed against the box's own ingestGuards.js"
  rm -rf $T
}
case "$MODE" in
check) echo "== md5 before"; md5sum $D/stellantisMake.js $D/stellantisVinTable.js $D/ingestGuards.js; [ -e $D/vinWmi.js ] && md5sum $D/vinWmi.js || echo "vinWmi.js absent (expected)"; check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  grep -h "\[sync-lock\]" /home/ubuntu/.pm2/logs/deals-api-out.log 2>/dev/null | tail -1 | grep -q "acquire" && fail "the sync lock is held (deals-api log); wait for the sync to finish"
  pgrep -fa "${PROC_RE:-inventory-sync|run_sync}" | grep -v pgrep | grep -v deals-api.sh && fail "a sync client is running (above); wait"
  check_copy || exit 1
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/stellantisMake.js" "$BACKUP/" && (cd "$BACKUP" && md5sum stellantisMake.js | tee md5s.txt) || fail "backup failed"
  cp "$HERE/files/vinWmi.js" "$D/vinWmi.js"; cp "$HERE/files/stellantisMake.js" "$D/stellantisMake.js"       # vinWmi first: stellantisMake imports it
  echo "== md5 after"; md5sum $D/vinWmi.js $D/stellantisMake.js
  [ "$(md "$D/vinWmi.js")" = "$VW_AFTER" ] && [ "$(md "$D/stellantisMake.js")" = "$SM_AFTER" ] || { echo "md5 mismatch - restoring"; bash "$0" restore; exit 1; }
  node "$HERE/test-five-vins.mjs" deals "$D" | tail -2 || { echo "five-VIN test failed on the live files - restoring"; bash "$0" restore; exit 1; }
  echo "FILES APPLIED. The running deals-api still has the OLD code in memory. NEXT (separate step, idle window, sync lock clear):  pm2 restart deals-api   - then see STEPS.md for the post-restart checks. Restore: bash deals-api.sh restore (+ pm2 restart deals-api)";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  cp -p "$BACKUP/stellantisMake.js" "$D/stellantisMake.js" && rm -f "$D/vinWmi.js" || fail "restore failed"
  (cd "$D" && md5sum stellantisMake.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: stellantisMake.js md5 matches the backup, vinWmi.js removed. If the server was already restarted on the new files: pm2 restart deals-api");;
*) echo "usage: bash deals-api.sh check|apply|restore"; exit 2;;
esac
