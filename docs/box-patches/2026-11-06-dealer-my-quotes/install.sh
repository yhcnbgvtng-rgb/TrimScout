#!/bin/bash
# Dealer "My Quotes" for the box2 deals API (box2 ONLY: /opt/trimscout-deals/src, pm2 process "deals-api"). Run ON box2, from the directory holding this script, files/, smoke.mjs and deals_api_server.js.patch.
#   usage:  bash install.sh check|apply|restart|verify|restore
#   env:    DEALS_DIR (default /opt/trimscout-deals/src)   BACKUP (default ~/backups/box2-dealer-my-quotes-20261106)   PM2 (default "pm2", run as the ubuntu user, not root)
# Changes two things: rfqDealerInvites.js (new) and deals_api_server.js (patched: import, handler, GET /api/dealer-invites, POST /api/dealer-invites/claim, rfq_invites.dealer_user_id column + index).
# The patch is cut from the LIVE file (md5 below). Any other md5 stops everything: do not hand-edit, re-cut.
# check   read-only: md5 drift check, patch dry-run (zero fuzz) on a COPY, smoke test on a temp copy. Changes nothing in DEALS_DIR.
# apply   gates (sync lock, sync/crawl processes), backup first, copy, md5 + syntax + smoke on the live files; auto-restores on failure. Does NOT restart.
# restart gates again, then $PM2 restart deals-api, then checks online + fresh uptime + the new route answers 401 without the key (404 = not wired).
# verify  with the box's own key (read from the env file, never printed): the list is empty for an unknown account, then the column exists. Creates the column on first call.
# restore puts the backed-up server back and removes rfqDealerInvites.js (does not restart; prints the command). The dealer_user_id column is additive and is left in place.
D=${DEALS_DIR:-/opt/trimscout-deals/src}; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/box2-dealer-my-quotes-20261106}; MODE=${1:-check}
PM2=${PM2:-pm2}; LOCK_LOG=${LOCK_LOG:-/home/ubuntu/.pm2/logs/deals-api-out.log}
PROC_RE=${PROC_RE:-inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone\.js|unretire|backfill|facet|make-from-vin}
API=${API:-http://127.0.0.1:3004}; ENVFILE=${ENVFILE:-/opt/trimscout-deals/.env.trimscout-db}
md() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" 2>/dev/null | cut -d' ' -f1; else md5 -q "$1" 2>/dev/null; fi; }
SV_BASE=846d8cabac356b37798fb047f334c387; SV_AFTER=d63818f09574575a7b593d144687dead; RC_AFTER=d29f70aa2eecc186bd9232e1d3b60895; PATCH_MD5=cbfa562e25f60fd79300e4c067c92ecd
fail() { echo "FAIL: $*"; exit 1; }
[ -d "$D" ] || fail "$D is not a directory"
rc=$(md "$D/rfqDealerInvites.js"); sv=$(md "$D/deals_api_server.js")
rollback_cmd="bash $HERE/install.sh restore && $PM2 restart deals-api"
state_of() { if [ -z "$rc" ] && [ "$sv" = "$SV_BASE" ]; then echo before; elif [ "$rc" = "$RC_AFTER" ] && [ "$sv" = "$SV_AFTER" ]; then echo after; else echo other; fi; }
drift_checks() {
  [ "$(md "$HERE/files/rfqDealerInvites.js")" = "$RC_AFTER" ] && [ "$(md "$HERE/deals_api_server.js.patch")" = "$PATCH_MD5" ] || fail "package files have the wrong md5 (corrupt copy? compare with manifest.txt)"
  for m in 'createRfqNotSelectedHandler' 'ensureQuotePackageColumns' 'rfqInviteNotSelectedMatch'; do grep -aq "$m" "$D/deals_api_server.js" || fail "deals_api_server.js has no '$m'; stop and report"; done
  grep -q 'export function stageForDealer' "$D/dealStages.js" || fail "dealStages.js has no stageForDealer; stop and report"
  case "$(state_of)" in
    before) echo "state: before   (rfqDealerInvites absent, deals_api_server.js $sv = the pinned live file)";;
    after) echo "state: after    (rfqDealerInvites $rc, deals_api_server.js $sv)";;
    *) if [ "$MODE" = restore ] && [ -e "$BACKUP/md5s.txt" ]; then echo "state: other (restore mode, backup present)"; else fail "rfqDealerInvites.js '${rc:-absent}' / deals_api_server.js '$sv' is neither before (absent / $SV_BASE) nor after ($RC_AFTER / $SV_AFTER); stop and report, change nothing, hand-edit nothing"; fi;;
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
  [ "$(grep -ac 'import { createDealerInvitesHandlers } from "./rfqDealerInvites.js"' "$out/deals_api_server.js")" = 1 ] || fail "import missing after patching"
  [ "$(grep -ac 'const dealerInvites = createDealerInvitesHandlers(' "$out/deals_api_server.js")" = 1 ] || fail "handler const missing after patching"
  [ "$(grep -ac 'run(dealerInvites\.' "$out/deals_api_server.js")" = 2 ] || fail "the two routes are not both present after patching"
  [ "$(grep -ac 'ADD COLUMN IF NOT EXISTS dealer_user_id VARCHAR(128) NULL' "$out/deals_api_server.js")" = 1 ] || fail "column line missing after patching"
  echo "patched server: md5 $SV_AFTER, syntax ok, import + handler + 2 routes + column present once each"
}
check_copy() {
  T=$(mktemp -d); echo '{"type":"module"}' > "$T/package.json"; cp "$D/dealStages.js" "$T/"; cp "$HERE/files/rfqDealerInvites.js" "$T/"
  for dep in $(grep -oE 'from "\./[A-Za-z0-9_]+\.js"' "$D/dealStages.js" | sed -E 's/from "\.\/(.*)"/\1/'); do [ -e "$D/$dep" ] && cp "$D/$dep" "$T/"; done
  node "$HERE/smoke.mjs" "$T" > "$T/smoke.out" 2>&1 || { tail -5 "$T/smoke.out"; rm -rf "$T"; fail "smoke test failed beside the box's dealStages.js"; }; tail -1 "$T/smoke.out"
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
  echo "== md5 before"; md5sum "$D/deals_api_server.js"; [ -e "$D/rfqDealerInvites.js" ] && echo "rfqDealerInvites.js present ($rc)" || echo "rfqDealerInvites.js absent (expected)"
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  check_copy && echo "DRIFT CHECK PASS (nothing in $D was changed)";;
apply)
  drift_checks; [ "$(state_of)" = after ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
  gates; check_copy
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$D/deals_api_server.js" "$BACKUP/" && echo "rfqDealerInvites.js" > "$BACKUP/absent.txt" && (cd "$BACKUP" && md5sum deals_api_server.js | tee md5s.txt) || fail "backup failed"
  W=$(mktemp -d); cut_server "$W" >/dev/null || { rm -rf "$W"; exit 1; }
  { cp "$HERE/files/rfqDealerInvites.js" "$D/rfqDealerInvites.js" && cp "$W/deals_api_server.js" "$D/deals_api_server.js"; } || { rm -rf "$W"; echo "copy failed - restoring"; bash "$0" restore; exit 1; }
  rm -rf "$W"
  rc=$(md "$D/rfqDealerInvites.js"); sv=$(md "$D/deals_api_server.js"); echo "== md5 after"; md5sum "$D/rfqDealerInvites.js" "$D/deals_api_server.js"
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
  h=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"); g=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/dealer-invites?dealerUserId=probe"); c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/dealer-invites/claim")
  echo "GET /health -> $h    GET /api/dealer-invites without the key -> $g    POST /api/dealer-invites/claim without the key -> $c   (401 = route exists and guarded; 404 = NOT wired)"
  [ "$g" = 401 ] && [ "$c" = 401 ] || fail "the new routes do not both answer 401 - roll back NOW with: $rollback_cmd"
  echo "RESTARTED. Next: bash $HERE/install.sh verify     Logs: $PM2 logs deals-api --lines 30 --nostream     ROLLBACK: $rollback_cmd";;
verify)
  [ "$(state_of)" = after ] || fail "the files are not in the patched state"
  set -a; . "$ENVFILE"; set +a
  body=$(curl -s -w '\n%{http_code}' -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "$API/api/dealer-invites?dealerUserId=install-probe-nobody"); echo "with key, unknown account -> $(echo "$body" | tail -1) $(echo "$body" | head -1 | cut -c1-80)"
  [ "$(echo "$body" | tail -1)" = 200 ] && echo "$body" | head -1 | grep -q '"invites":\[\]' || fail "expected 200 with an empty invites list"
  n=$(MYSQL_PWD="$DB_READER_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_READER_USER" "$DB_NAME" -N -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='rfq_invites' AND column_name='dealer_user_id'")
  i=$(MYSQL_PWD="$DB_READER_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_READER_USER" "$DB_NAME" -N -e "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='rfq_invites' AND index_name='idx_rfq_invites_dealer_user'")
  echo "rfq_invites.dealer_user_id column present: $n   index present: $i"; [ "$n" = 1 ] && [ "$i" -ge 1 ] || fail "column or index missing"
  echo "VERIFIED";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  { cp -p "$BACKUP/deals_api_server.js" "$D/deals_api_server.js" && rm -f "$D/rfqDealerInvites.js"; } || fail "restore failed"
  (cd "$D" && md5sum deals_api_server.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: deals_api_server.js matches the backup, rfqDealerInvites.js removed. If the server was already restarted on the new files:  $PM2 restart deals-api");;
*) echo "usage: bash install.sh check|apply|restart|verify|restore"; exit 2;;
esac
