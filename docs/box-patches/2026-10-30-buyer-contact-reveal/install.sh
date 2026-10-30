#!/bin/bash
# Buyer-contact reveal for the box2 deals API (box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api"). Run ON box2, from the directory holding this script, files/, smoke.mjs and deals_api_server.js.patch.
#   usage:  bash install.sh check|apply|restart|restore
#   env:    DEALS_DIR (default /opt/trimscout-deals/src)   BACKUP (default ~/backups/box2-buyer-contact-reveal-20261030)   PM2 (default "sudo -u ubuntu pm2")   SUDO (default empty; set SUDO=sudo if DEALS_DIR is root-owned)
# What it changes (three files): rfqContactReveal.js (new), dealStages.js (replaced whole: adds revealContact, stageForDealer drops the contact) and deals_api_server.js (patched: import + handler + the POST .../reveal-contact route).
# deals_api_server.js has FOUR accepted starting files (with and without the sweep-crawl-stamps and stats-warm installs); the patch is picked by the live md5, never by guess, and any other md5 stops everything.
# check   read-only: md5 drift check on every file involved, the patch dry-run on a COPY of the server, the smoke test on a temp copy. Changes nothing in DEALS_DIR.
# apply   gates (sync lock, sync/crawl processes), backup first, copy, md5 + syntax + smoke on the live files; auto-restores on any failure. Does NOT restart.
# restart gates again, then `$PM2 restart deals-api`, then checks the process is online with a fresh uptime and that the new route answers (401 without the key, not 404).
# restore puts the backed-up files back and removes rfqContactReveal.js (does not restart; it prints the restart command).
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/box2-buyer-contact-reveal-20261030}; MODE=${1:-check}
PM2=${PM2:-sudo -u ubuntu pm2}; SUDO=${SUDO:-}; LOCK_LOG=${LOCK_LOG:-/home/ubuntu/.pm2/logs/deals-api-out.log}
PROC_RE=${PROC_RE:-inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone\.js|unretire|backfill|facet|make-from-vin}
API=${API:-http://127.0.0.1:3004}
md() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" 2>/dev/null | cut -d' ' -f1; else md5 -q "$1" 2>/dev/null; fi; }
# dealStages.js: before = the repo's main file at 7663585 (the 2026-10-13 v2 install; NOT read from the box, the check below proves it), after = files/dealStages.js. rfqContactReveal.js: absent before.
DS_BEFORE=0e557bfdf59b07894212a47ab47205a9; DS_AFTER=6a3a19443aa0e1d4ecb9a0a8a42169f0; RC_AFTER=2a9d11ebeb4322f43df8569c9f9ef119
PATCH_MD5=fb7aaac9d7d9ea15b2151872f8532fca
# server: starting md5 -> result md5 (31d527ba = live 2026-10-29; 400e943b = + sweep-crawl-stamps #628; 92716d25 / 60211bdd = each + stats-warm #623/#629)
SV_BASES="31d527ba8e277ff58e39f73ad1d00295 400e943b58e972a00fcce92738ead685 92716d2599883f1011535349217dc154 60211bdd0317514a09bc938ab1644889"
SV_RESULTS="9ddd12a80e9e3c9bffcb23fdc4797e01 a9ca71357ab8abfbedbe13f787cfefac ce21b599d4834045102159a0bcf66f4d bd11ff778117cd932c2608e1585634d4"
fail() { echo "FAIL: $*"; exit 1; }
[ -d "$D" ] || fail "$D is not a directory"
word_index() { local i=0 w; for w in $2; do [ "$w" = "$1" ] && { echo $i; return; }; i=$((i+1)); done; echo -1; }
word_at() { local n=$2; set -- $1; shift "$n"; echo "$1"; }
ds=$(md "$D/dealStages.js"); rc=$(md "$D/rfqContactReveal.js"); sv=$(md "$D/deals_api_server.js")
rollback_cmd="bash $HERE/install.sh restore && $PM2 restart deals-api"

state_of() {   # before | after | other
  if [ "$ds" = "$DS_BEFORE" ] && [ -z "$rc" ] && [ "$(word_index "$sv" "$SV_BASES")" -ge 0 ]; then echo before
  elif [ "$ds" = "$DS_AFTER" ] && [ "$rc" = "$RC_AFTER" ] && [ "$(word_index "$sv" "$SV_RESULTS")" -ge 0 ]; then echo after
  else echo other; fi
}
drift_checks() {
  [ -e "$D/deals_api_server.js" ] || fail "$D/deals_api_server.js is missing"
  [ "$(md "$HERE/files/dealStages.js")" = "$DS_AFTER" ] && [ "$(md "$HERE/files/rfqContactReveal.js")" = "$RC_AFTER" ] && [ "$(md "$HERE/deals_api_server.js.patch")" = "$PATCH_MD5" ] || fail "package files have the wrong md5 (corrupt copy? compare with manifest.txt)"
  for m in 'createRfqStageHandler' 'ensureQuotePackageColumns' 'rfqInviteStageMatch' 'async function logRfqEvent'; do grep -q "$m" "$D/deals_api_server.js" || fail "deals_api_server.js has no '$m' (the staged-deal wiring this builds on); stop and report"; done
  grep -q 'accept_final' "$D/dealStages.js" 2>/dev/null || [ "$MODE" = restore ] || fail "dealStages.js has no accept_final (the v2 deal stages, 2026-10-13-rfq-deal-stages-v2.sh, are not installed); stop and report"
  st=$(state_of)
  case "$st" in
    before) echo "state: before   (dealStages $ds, rfqContactReveal absent, deals_api_server.js $sv = starting file #$(( $(word_index "$sv" "$SV_BASES") + 1 )) of 4)";;
    after) echo "state: after    (dealStages $ds, rfqContactReveal $rc, deals_api_server.js $sv)";;
    *) if [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ]; then echo "state: other (restore mode, backup present)"; else fail "dealStages.js '$ds' / rfqContactReveal.js '${rc:-absent}' / deals_api_server.js '$sv' is neither the expected before ($DS_BEFORE / absent / one of: $SV_BASES) nor after ($DS_AFTER / $RC_AFTER / one of: $SV_RESULTS) state; stop and report, change nothing, hand-edit nothing"; fi;;
  esac
}
# cut the patched server into $1 (a temp dir), verify its md5 against the pinned result for the starting file, syntax, and the three wiring markers
cut_server() {
  local out=$1 i exp; i=$(word_index "$sv" "$SV_BASES"); [ "$i" -ge 0 ] || fail "deals_api_server.js $sv is not a known starting file"
  exp=$(word_at "$SV_RESULTS" "$i")
  cp "$D/deals_api_server.js" "$out/deals_api_server.js"
  patch -F0 --dry-run -s "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" >/dev/null || fail "patch does not apply cleanly (zero fuzz) to the live deals_api_server.js"
  patch -F0 -s --no-backup-if-mismatch "$out/deals_api_server.js" < "$HERE/deals_api_server.js.patch" || fail "patch failed"
  ls "$out"/*.rej "$out"/*.orig >/dev/null 2>&1 && fail "patch left .rej/.orig files"
  [ "$(md "$out/deals_api_server.js")" = "$exp" ] || fail "patched server md5 $(md "$out/deals_api_server.js") != pinned result $exp"
  cp "$out/deals_api_server.js" "$out/chk.mjs"; node --check "$out/chk.mjs" || fail "syntax error in the patched server"; rm -f "$out/chk.mjs"
  [ "$(grep -c 'import { createRfqContactRevealHandler } from "./rfqContactReveal.js"' "$out/deals_api_server.js")" = 1 ] || fail "import missing after patching (node --check does not catch that)"
  [ "$(grep -c 'const handleRfqContactReveal = createRfqContactRevealHandler(' "$out/deals_api_server.js")" = 1 ] || fail "handler const missing after patching"
  [ "$(grep -c 'run(handleRfqContactReveal,' "$out/deals_api_server.js")" = 1 ] || fail "route missing after patching"
  echo "patched server: md5 $exp, syntax ok, import + handler + route present once each"
}
check_copy() {   # the new files beside the box's own modules that import dealStages.js, in a temp dir, never in the live dir
  T=$(mktemp -d); echo '{"type":"module"}' > "$T/package.json"
  for f in "$D"/*.js; do b=$(basename "$f"); [ "$b" = deals_api_server.js ] && continue; grep -q "dealStages.js" "$f" && cp "$f" "$T/"; done
  cp "$HERE/files/dealStages.js" "$HERE/files/rfqContactReveal.js" "$T/"
  node "$HERE/smoke.mjs" "$T" | tail -2 || { rm -rf "$T"; fail "smoke test failed on the new files beside the box's modules"; }
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
  echo "== md5 before"; md5sum "$D/dealStages.js" "$D/deals_api_server.js" 2>/dev/null || md5 "$D/dealStages.js" "$D/deals_api_server.js"; [ -e "$D/rfqContactReveal.js" ] && echo "rfqContactReveal.js present ($rc)" || echo "rfqContactReveal.js absent (expected)"
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  gates; check_copy
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/dealStages.js" "$D/deals_api_server.js" "$BACKUP/" && echo "rfqContactReveal.js" > "$BACKUP/absent.txt" && (cd "$BACKUP" && { md5sum dealStages.js deals_api_server.js 2>/dev/null || md5 -r dealStages.js deals_api_server.js; } | tee md5s.txt) || fail "backup failed"
  W=$(mktemp -d); cut_server "$W" >/dev/null || { rm -rf "$W"; exit 1; }
  # order: rfqContactReveal (new, imports dealStages) -> dealStages -> server last (it is the only file that references the new module)
  { $SUDO cp "$HERE/files/rfqContactReveal.js" "$D/rfqContactReveal.js" && $SUDO cp "$HERE/files/dealStages.js" "$D/dealStages.js" && $SUDO cp "$W/deals_api_server.js" "$D/deals_api_server.js"; } || { rm -rf "$W"; echo "copy failed - restoring"; bash "$0" restore; exit 1; }
  rm -rf "$W"
  echo "== md5 after"; md5sum "$D/rfqContactReveal.js" "$D/dealStages.js" "$D/deals_api_server.js" 2>/dev/null || md5 "$D/rfqContactReveal.js" "$D/dealStages.js" "$D/deals_api_server.js"
  ds=$(md "$D/dealStages.js"); rc=$(md "$D/rfqContactReveal.js"); sv=$(md "$D/deals_api_server.js")
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
  h=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"); r=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/rfqs/1/invites/1/reveal-contact")
  echo "GET /health -> $h (401 = up and guarding)    POST /api/rfqs/1/invites/1/reveal-contact without the key -> $r (401 = route exists and guarded; 404 = NOT wired)"
  [ "$r" != 404 ] || fail "the reveal route answers 404 - roll back NOW with: $rollback_cmd"
  echo "RESTARTED. Check the log for errors: $PM2 logs deals-api --lines 30 --nostream     ROLLBACK: $rollback_cmd";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  { $SUDO cp -p "$BACKUP/dealStages.js" "$D/dealStages.js" && $SUDO cp -p "$BACKUP/deals_api_server.js" "$D/deals_api_server.js" && $SUDO rm -f "$D/rfqContactReveal.js"; } || fail "restore failed"
  (cd "$D" && { md5sum dealStages.js deals_api_server.js 2>/dev/null || md5 -r dealStages.js deals_api_server.js; } | diff - "$BACKUP/md5s.txt" && echo "RESTORED: dealStages.js and deals_api_server.js match the backup, rfqContactReveal.js removed. If the server was already restarted on the new files:  $PM2 restart deals-api");;
*) echo "usage: bash install.sh check|apply|restart|restore"; exit 2;;
esac
