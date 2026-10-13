#!/usr/bin/env bash
# Crawl shard queue: install, pilot, cutover and rollback — run from PAUL'S MAC, from a clean checkout of main. Talks to the boxes over ssh.
# Design: docs/CRAWL_QUEUE.md. Nothing here changes a box until Paul types GO at the prompt, himself, in this terminal.
#
#   preflight                 READ-ONLY. Per box: idle (no crawl, sync, sync lock or lock file), anchors still match, box has the code the queue needs.
#   install                   preflight, then GO, then: back up every file touched, install, flag OFF everywhere, restart deals-api once (box2).
#   status                    READ-ONLY. Flag, installed files and tonight's queue per box.
#   pilot <ST> [--box boxN]   GO, then a real one-state crawl through the queue on ONE box (own queue night; the nightly is untouched, flag may stay off).
#   pilot-check <ST> [--box]  READ-ONLY. The pilot's queue status, its manifest, and the sync's own --dry-run of exactly those shards.
#   flag on                   GO. Last gate (idle + API answers + install intact), then enables the queue on every enabled box. Take effect at the next 22:00 cron.
#   flag off | rollback       GO. Disables the queue everywhere: the fixed-state crons are the default again from their next run. One command.
#   rollback --restore        as rollback, then puts every backed-up file back (only files unchanged since the install; others are reported, not touched).
#
# Options:  --workers box3,box4   boxes that crawl from the queue (default: every box that has the code for it — today box3, box4; box1 only after #480 is deployed there)
#           --exclude-states ..   states left on a box's fixed cron (default: box1's states when box1 is not a worker; keep identical on all workers)
#           --slots box3=4,box4=4 concurrent shards per worker (default 4; box1 2)
#
# Every mutating command refuses to run without an interactive terminal and a typed GO. There is no flag, variable or pipe that skips it
# against real ssh (the only test hook requires CQ_SSH to be a stub). Backups: <file>.cq-bak.<stamp> next to each file, plus ~/crawl-queue-install/<stamp>/manifest.json on the box.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CRAWLER_SRC="$REPO/scrapers/lightsail-crawler"
SSH="${CQ_SSH:-ssh}"; SCP="${CQ_SCP:-scp}"
KEY="${CQ_KEY:-$HOME/.ssh/lightsail_key.pem}"
STAMP="$(date +%Y%m%d-%H%M%S)"
CRAWLER_REL="$(node -e "console.log(require('$REPO/config/boxes.json').boxes.box3.remoteDir)")"
SYNC_REL="inventory-sync"
SERVER_SRC="${CQ_SERVER_SRC:-/opt/trimscout-deals/src}"
LOCK_PROBE_CMD="${CQ_SYNC_LOCK_PROBE_CMD:-}"
ALL_BOXES="box1 box2 box3 box4"

die() { echo "ERROR: $*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
host_of() { node -e "const c=require('$REPO/config/boxes.json');const b=c.boxes['$1'];if(!b){process.exit(1)};console.log(b.host)" 2>/dev/null; }
real_ssh() { [ -z "${CQ_SSH:-}" ]; }
ssh_opts() { if real_ssh; then printf '%s\n' -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new; fi; }
rsh() { local box="$1"; shift; local h; h="$(host_of "$box")" || die "unknown box $box"; # shellcheck disable=SC2046
  $SSH $(ssh_opts) "ubuntu@$h" "$@"; }
rcp() { local box="$1" src="$2" dst="$3"; local h; h="$(host_of "$box")" || die "unknown box $box"; # shellcheck disable=SC2046
  $SCP $(ssh_opts) -q "$src" "ubuntu@$h:$dst"; }

# ---------------------------------------------------------------------------------------------------- GO gate
go_gate() {
  local what="$1"
  say ""; say ">>> $what"
  if [ "${CQ_TEST_GO:-0}" = "1" ] && [ -n "${CQ_SSH:-}" ] && case "$(basename "${CQ_SSH}")" in stub-*) true;; *) false;; esac; then say "(test stub: GO assumed)"; return 0; fi
  [ -t 0 ] && [ -e /dev/tty ] || die "needs an interactive terminal: Paul types GO himself. Nothing was changed."
  local ans; read -r -p "Type GO to proceed (anything else aborts): " ans </dev/tty
  [ "$ans" = "GO" ] || die "not confirmed. Nothing was changed."
}

# ---------------------------------------------------------------------------------------------------- argument handling
CMD="${1:-}"; shift || true
WORKERS=""; EXCLUDE=""; SLOTS_SPEC=""; PILOT_BOX=""; RESTORE=0; PILOT_STATE=""
case "$CMD" in pilot|pilot-check) PILOT_STATE="${1:-}"; shift || true;; flag) FLAGVAL="${1:-}"; shift || true;; esac
while [ $# -gt 0 ]; do case "$1" in
  --workers) WORKERS="$2"; shift 2;; --exclude-states) EXCLUDE="$2"; shift 2;; --slots) SLOTS_SPEC="$2"; shift 2;;
  --box) PILOT_BOX="$2"; shift 2;; --restore) RESTORE=1; shift;; *) die "unknown option $1";; esac; done
slots_for() { local b="$1" s; s="$(printf '%s' "$SLOTS_SPEC" | tr ',' '\n' | sed -n "s/^$b=//p")"; if [ -n "$s" ]; then echo "$s"; elif [ "$b" = box1 ]; then echo 2; else echo 4; fi; }

# ---------------------------------------------------------------------------------------------------- remote probes (READ-ONLY)
# Prints lines: IDLE | BUSY <why>. Anchored process patterns: the helper watchers other sessions leave on a box
# ("bash -c until ! pgrep -f ...") mention the same words and must not count.
remote_idle() {
  rsh "$1" "CRAWLER_REL='$CRAWLER_REL' SYNC_REL='$SYNC_REL' bash -s" <<'EOF'
set -u
C="$HOME/$CRAWLER_REL"; busy=""
for pat in '^node (.*/)?scripts/run-daily-crawl\.mjs' '^node (.*/)?src/standalone\.js' '^node (.*/)?scripts/run-crawl-queue\.mjs' '^node (.*/)?inventory-sync\.mjs' '(^| |/)run_nightly_chain\.sh( |$)' '(^| |/)run_sync_when_safe\.sh( |$)' '(^| |/)run_core_crawl_when_safe\.sh( |$)'; do
  p="$(pgrep -af "$pat" 2>/dev/null | head -1)"; [ -n "$p" ] && busy="$busy; process: $(echo "$p" | cut -c1-90)"
done
r="$(node "$C/scripts/check-crawl-gate.mjs" "$C/data/daily_crawl_runs" 2>/dev/null)"; [ -n "$r" ] && busy="$busy; lock: $r"
[ -z "$busy" ] && echo IDLE || echo "BUSY${busy}"
EOF
}

# The sync lock is global (held in the deals API), so it is probed once, from box2: take it with a throwaway owner and hand it back.
remote_lock_free() {
  if [ -n "$LOCK_PROBE_CMD" ]; then $LOCK_PROBE_CMD; return; fi
  rsh box2 "SYNC_REL='$SYNC_REL' bash -s" <<'EOF'
cd "$HOME/$SYNC_REL" && set -a && . ./.env && set +a
node --input-type=module -e '
import { createApi, withRetry } from "./syncHttp.js";
const api = createApi({ host: process.env.TRIMSCOUT_DEALS_HOST || "127.0.0.1", key: process.env.TRIMSCOUT_API_KEY, timeouts: { lock: 10000 } });
const owner = `cq-install-probe-${process.pid}`;
const a = await api(process.env.TRIMSCOUT_DEALS_PORT || "3004", "/api/ops/sync-lock/acquire", { owner, heartbeat: true }).catch((e) => { console.log("UNKNOWN " + e.message); process.exit(2); });
if (!a || !a.acquired) { console.log("HELD by " + (a && a.heldBy)); process.exit(1); }
await withRetry(() => api(process.env.TRIMSCOUT_DEALS_PORT || "3004", "/api/ops/sync-lock/release", { owner }), { retries: 3, delayMs: 1000 });
console.log("FREE");'
EOF
}

# What a crawl box needs for the queue to run its shards at all. Prints OK | MISSING <list>.
remote_capability() {
  rsh "$1" "CRAWLER_REL='$CRAWLER_REL' bash -s" <<'EOF'
C="$HOME/$CRAWLER_REL"; miss=""
need() { grep -q "$2" "$C/$1" 2>/dev/null || miss="$miss $1:'$2'"; }
need src/inventory_shards.js 'export function brandSlug'
need scripts/run-daily-crawl.mjs 'export async function runBrandSharded'
need scripts/run-daily-crawl.mjs 'export function buildBrandCrawlEnv'
need scripts/run-daily-crawl.mjs 'export async function runStep'
need scripts/run-daily-crawl.mjs 'export const WRITE_DEALER_SCRIPTS'
need scripts/run-daily-crawl.mjs 'export const PER_BRAND_TIMEOUT_MS'
need scripts/run-daily-crawl.mjs 'export const MAX_DEALERS_PER_SHARD'
need src/enricher.js 'seedCacheFromLegacy'
[ -f "$C/src/legacyShardSplit.js" ] || miss="$miss src/legacyShardSplit.js"
[ -f "$C/src/expansionDealerFiles.js" ] || miss="$miss src/expansionDealerFiles.js(expansion brands)"
[ "$(ls "$C"/scripts/write-*-dealer-files.mjs 2>/dev/null | wc -l)" -ge 50 ] || miss="$miss write-<state>-dealer-files.mjs(<50)"
[ -d "$C/dealers/oem-dumps" ] || miss="$miss dealers/oem-dumps"
[ -z "$miss" ] && echo OK || echo "MISSING$miss"
EOF
}

# Anchors against the box's real files, read-only: the patcher is streamed over ssh, nothing is copied.
remote_anchors() {
  local box="$1" ab args
  ab="$(base64 < "$HERE/2026-10-14-crawl-queue-anchors.json" | tr -d '\n')"
  args="driver=\$HOME/$CRAWLER_REL/scripts/run-daily-crawl.mjs sync=\$HOME/$SYNC_REL/inventory-sync.mjs"
  [ "$box" = box2 ] && args="$args server=$SERVER_SRC/deals_api_server.js"
  rsh "$box" "ANCHORS_B64=$ab node - check - $args" < "$HERE/2026-10-14-crawl-queue-patch.mjs"
}

# Which boxes may be workers: those that have the code. Prints "box:OK|reason" lines.
eligibility() { for b in box1 box3 box4; do echo "$b:$(remote_capability "$b")"; done; }

resolve_fleet() {
  local elig b
  elig="$(eligibility)"
  if [ -z "$WORKERS" ]; then WORKERS="$(printf '%s\n' "$elig" | sed -n 's/^\(box[0-9]\):OK$/\1/p' | paste -sd, -)"; fi
  [ -n "$WORKERS" ] || die "no box has the code the queue needs"
  for b in $(printf '%s' "$WORKERS" | tr ',' ' '); do
    printf '%s\n' "$elig" | grep -q "^$b:OK$" || die "$b cannot be a worker: $(printf '%s\n' "$elig" | sed -n "s/^$b://p"). Deploy the per-brand shard code there first (docs/BRAND_SHARDS.md), then rerun with --workers."
  done
  if [ -z "$EXCLUDE" ] && ! printf ',%s,' "$WORKERS" | grep -q ',box1,'; then
    EXCLUDE="$(node -e "const s=require('$CRAWLER_SRC/config/crawl_queue_timings.json');console.log([...new Set(Object.values(s.universe).filter(u=>u.lastBox==='box1').map(u=>u.state))].sort().join(','))")"
  fi
  say "workers: $WORKERS   host: box2   states left on a fixed cron (box1): ${EXCLUDE:-none}"
}

flag_json() { # box role slots
  local sets='null'; [ "$1" = box1 ] && sets='["core"]'
  local ex; ex="$(printf '%s' "$EXCLUDE" | awk -F, 'BEGIN{printf "["} {for(i=1;i<=NF;i++){if($i!="")printf "%s\"%s\"",(n++?",":""),$i}} END{printf "]"}')"
  if [ "$2" = host ]; then printf '{"enabled":%s,"box":"%s","role":"host"}' "$3" "$1"
  else printf '{"enabled":%s,"box":"%s","role":"worker","slots":%s,"brandSets":%s,"maxHeavy":%s,"excludeStates":%s}' "$3" "$1" "$(slots_for "$1")" "$sets" "$([ "$1" = box1 ] && echo 1 || echo 2)" "$ex"; fi
}

write_flag() { # box role enabled(true|false)
  local json; json="$(flag_json "$1" "$2" "$3")"
  rsh "$1" "CRAWLER_REL='$CRAWLER_REL' J='$json' bash -s" <<'EOF'
D="$HOME/$CRAWLER_REL/data/crawl_queue"; mkdir -p "$D"
[ -f "$D/flag.json" ] && cp -a "$D/flag.json" "$D/flag.json.cq-bak.$(date +%Y%m%d-%H%M%S)"
printf '%s\n' "$J" > "$D/flag.json.tmp" && mv "$D/flag.json.tmp" "$D/flag.json" && echo "flag: $(cat "$D/flag.json")"
EOF
}

# ---------------------------------------------------------------------------------------------------- commands
do_preflight() {
  local ok=0 b r
  say "== idle check (no crawl, sync, sync lock or lock file anywhere) =="
  for b in $ALL_BOXES; do r="$(remote_idle "$b")"; printf '  %-5s %s\n' "$b" "$r"; case "$r" in IDLE) ;; *) ok=1;; esac; done
  r="$(remote_lock_free 2>&1 | tail -1)"; printf '  %-5s sync lock: %s\n' "lock" "$r"; case "$r" in FREE*|OK*) ;; *) ok=1;; esac
  say "== anchors in the live files (read-only) =="
  for b in $ALL_BOXES; do
    if [ "$b" = box1 ] && ! printf ',%s,' "${WORKERS:-box3,box4}" | grep -q ',box1,'; then say "  box1  (not a worker — not patched, not checked)"; continue; fi
    say "  $b:"; remote_anchors "$b" 2>&1 | sed 's/^/      /'; [ "${PIPESTATUS[0]}" -eq 0 ] || ok=1
  done
  say "== what each box has =="
  eligibility | sed 's/^/  /'
  say "== deals-api (box2) =="
  rsh box2 "pm2 jlist 2>/dev/null | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s).find(p=>p.name===\"deals-api\");console.log(j?\"deals-api \"+j.pm2_env.status+\" DISABLE_FACET_REBUILD=\"+j.pm2_env.DISABLE_FACET_REBUILD:\"deals-api NOT FOUND\")})'" | sed 's/^/  /' | tee /tmp/cq-pf-$$ >/dev/null; cat /tmp/cq-pf-$$; grep -q 'DISABLE_FACET_REBUILD=1' /tmp/cq-pf-$$ || { say "  !! DISABLE_FACET_REBUILD is not 1 on deals-api — the install refuses to proceed"; ok=1; }; rm -f /tmp/cq-pf-$$
  [ "$ok" -eq 0 ] && say "PREFLIGHT OK — safe to install." || say "PREFLIGHT FAILED — nothing was changed."
  return "$ok"
}

check_repo_clean() {
  [ "${CQ_SKIP_CLEAN_CHECK:-0}" = 1 ] && return 0   # for the test suite, which installs from an in-progress checkout into a sandbox
  git -C "$REPO" diff --quiet HEAD -- scrapers/lightsail-crawler scripts/box || die "the repo checkout has local changes under scrapers/lightsail-crawler or scripts/box — install from a clean checkout of main."
  say "installing from $(git -C "$REPO" rev-parse --short HEAD) ($(git -C "$REPO" log -1 --format=%s | cut -c1-70))"
}

CRAWLER_FILES_SRC="crawlQueueCore.js crawlQueueFlag.js crawlQueuePlan.js crawlQueueClient.js crawlQueuePressure.js crawlQueueSeed.js crawlQueueWorker.js vinCacheShared.js"
SYNC_FILES="syncManifest.js crawlQueueCore.js crawlQueueFlag.js crawlQueueClient.js crawlQueuePressure.js"

# One box: back up -> copy -> patch. Everything it touches is listed in the box's manifest with before/after hashes.
install_box() { # box role(worker|host)
  local box="$1" role="$2" tmp f ab
  tmp="/tmp/cq-install-$STAMP"
  say "-- $box ($role)"
  rsh "$box" "mkdir -p $tmp ~/crawl-queue-install/$STAMP" || die "$box: cannot create staging dir"
  for f in $CRAWLER_FILES_SRC; do rcp "$box" "$CRAWLER_SRC/src/$f" "$tmp/$f" || die "$box: copy $f failed"; done
  rcp "$box" "$CRAWLER_SRC/scripts/run-crawl-queue.mjs" "$tmp/run-crawl-queue.mjs" || die "copy failed"
  rcp "$box" "$CRAWLER_SRC/scripts/crawl-queue-plan.mjs" "$tmp/crawl-queue-plan.mjs" || die "copy failed"
  rcp "$box" "$CRAWLER_SRC/config/crawl_queue_timings.json" "$tmp/crawl_queue_timings.json" || die "copy failed"
  rcp "$box" "$CRAWLER_SRC/src/syncManifest.js" "$tmp/syncManifest.js" || die "copy failed"
  rcp "$box" "$HERE/2026-10-14-crawl-queue-patch.mjs" "$tmp/patch.mjs" || die "copy failed"
  rcp "$box" "$HERE/2026-10-14-crawl-queue-anchors.json" "$tmp/anchors.json" || die "copy failed"
  [ "$box" = box2 ] && { rcp box2 "$CRAWLER_SRC/src/crawlQueueServer.js" "$tmp/crawlQueueServer.js" || die "copy failed"; }
  rsh "$box" "CRAWLER_REL='$CRAWLER_REL' SYNC_REL='$SYNC_REL' SERVER_SRC='$SERVER_SRC' STAMP='$STAMP' TMP='$tmp' BOX='$box' CRAWLER_FILES='$CRAWLER_FILES_SRC' SYNC_FILES='$SYNC_FILES' bash -s" <<'EOF' || die "$box: install step failed — see output; files backed up as *.cq-bak.$STAMP"
set -eu
C="$HOME/$CRAWLER_REL"; S="$HOME/$SYNC_REL"; M="$HOME/crawl-queue-install/$STAMP/manifest.json"
for f in $CRAWLER_FILES $SYNC_FILES run-crawl-queue.mjs crawl-queue-plan.mjs crawlQueueServer.js; do
  [ -f "$TMP/$f" ] || continue
  cp "$TMP/$f" "$TMP/check.mjs"; node --check "$TMP/check.mjs" 2>/dev/null || { echo "syntax check failed: $f"; exit 1; }
done
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1]))' "$TMP/crawl_queue_timings.json" || { echo "timings snapshot is not valid JSON"; exit 1; }
echo '[]' > "$M"   # valid JSON from the first moment, so a failure half way is still restorable with rollback --restore
record() { node -e 'const fs=require("fs");const [m,p,b,a]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(m));j.push({path:p,backup:b||null,sha256_after:a});fs.writeFileSync(m,JSON.stringify(j,null,1))' "$M" "$1" "$2" "$(sha256sum "$1" | cut -d' ' -f1)"; }
put() { # src dest
  local dest="$2" bak=""
  if [ -f "$dest" ]; then cmp -s "$1" "$dest" && return 0; bak="$dest.cq-bak.$STAMP"; cp -a "$dest" "$bak"; fi
  install -m 0644 "$1" "$dest"; record "$dest" "$bak"
}
mkdir -p "$C/data/crawl_queue" "$C/config" "$HOME/crawl-queue/vin-cache"
for f in $CRAWLER_FILES; do put "$TMP/$f" "$C/src/$f"; done
put "$TMP/run-crawl-queue.mjs" "$C/scripts/run-crawl-queue.mjs"
put "$TMP/crawl-queue-plan.mjs" "$C/scripts/crawl-queue-plan.mjs"
put "$TMP/crawl_queue_timings.json" "$C/config/crawl_queue_timings.json"
for f in $SYNC_FILES; do put "$TMP/$f" "$S/$f"; done
[ "$BOX" = box2 ] && { put "$TMP/crawlQueueCore.js" "$SERVER_SRC/crawlQueueCore.js"; put "$TMP/crawlQueueServer.js" "$SERVER_SRC/crawlQueueServer.js"; }
# Patch the three live files in place: backup first, anchored, all-or-nothing per file, syntax-checked before it replaces anything.
targets="driver=$C/scripts/run-daily-crawl.mjs sync=$S/inventory-sync.mjs"; [ "$BOX" = box2 ] && targets="$targets server=$SERVER_SRC/deals_api_server.js"
for t in $targets; do file="${t#*=}"; [ -f "$file.cq-bak.$STAMP" ] || cp -a "$file" "$file.cq-bak.$STAMP"; done
before="$(for t in $targets; do sha256sum "${t#*=}"; done)"
node "$TMP/patch.mjs" apply "$TMP/anchors.json" $targets
# The patcher printing nothing and exiting 0 must never read as success: re-check, and require every anchor of every file to report applied.
want=$(node -e 'const a=require(process.argv[1]);const keys=process.argv.slice(2);console.log(a.filter(x=>keys.includes(x.file)).length)' "$TMP/anchors.json" driver sync $([ "$BOX" = box2 ] && echo server))
got=$(node "$TMP/patch.mjs" check "$TMP/anchors.json" $targets | grep -c '^ALREADY-APPLIED')
[ "$got" = "$want" ] || { echo "patch verification failed: $got of $want anchors report applied"; exit 1; }
for t in $targets; do file="${t#*=}"; if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$(echo "$before" | grep " $file\$" | cut -d' ' -f1)" ]; then record "$file" "$file.cq-bak.$STAMP"; else rm -f "$file.cq-bak.$STAMP"; fi; done
echo "manifest: $M ($(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).length)' "$M") files)"
EOF
  rsh "$box" "rm -rf $tmp" || true
}

do_install() {
  check_repo_clean
  resolve_fleet
  do_preflight || die "preflight failed"
  go_gate "INSTALL the crawl queue (flag OFF) on: $WORKERS (workers) and box2 (host). Restarts deals-api once on box2. Files are backed up first. Nothing crawls differently until 'flag on'."
  local b
  for b in $(printf '%s' "$WORKERS" | tr ',' ' '); do install_box "$b" worker; write_flag "$b" worker false; done
  install_box box2 host; write_flag box2 host false
  say "-- restarting deals-api on box2 (the only restart; in-memory sync lock is empty because preflight found it free)"
  rsh box2 'pm2 restart deals-api >/dev/null && sleep 4 && pm2 jlist | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s).find(p=>p.name===\"deals-api\");console.log(\"deals-api \"+j.pm2_env.status+\" DISABLE_FACET_REBUILD=\"+j.pm2_env.DISABLE_FACET_REBUILD);if(j.pm2_env.DISABLE_FACET_REBUILD!==\"1\")process.exit(3)})"' || die "deals-api did not come back with DISABLE_FACET_REBUILD=1 — restore: $0 rollback --restore"
  say "-- queue API answers?"
  api_check || die "queue endpoints not answering after the restart — flag stays OFF; restore with: $0 rollback --restore"
  say ""; say "INSTALLED with the flag OFF. The 22:00 crons still run the fixed states. Next: pilot, then 'flag on' for tonight."
}

api_check() {
  rsh box2 "SYNC_REL='$SYNC_REL' bash -s" <<'EOF'
cd "$HOME/$SYNC_REL" && set -a && . ./.env && set +a
H="http://127.0.0.1:${TRIMSCOUT_DEALS_PORT:-3004}"; K="X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"
p="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$K" "$H/api/ops/sync-pressure")"
q="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$K" "$H/api/ops/crawl-queue/status?night=0000-00-00")"
echo "sync-pressure=$p crawl-queue/status=$q"; [ "$p" = 200 ] && [ "$q" = 200 ]
EOF
}

do_status() {
  local b
  for b in $ALL_BOXES; do
    say "== $b"
    rsh "$b" "CRAWLER_REL='$CRAWLER_REL' SYNC_REL='$SYNC_REL' bash -s" <<'EOF'
C="$HOME/$CRAWLER_REL"
printf 'flag: '; cat "$C/data/crawl_queue/flag.json" 2>/dev/null || echo "(none — queue OFF)"
printf 'queue code: '; [ -f "$C/scripts/run-crawl-queue.mjs" ] && echo installed || echo "not installed"
printf 'driver hook: '; grep -c 'crawl-queue (flag-gated' "$C/scripts/run-daily-crawl.mjs" 2>/dev/null
printf 'sync hook: '; grep -c 'selectShards' "$HOME/$SYNC_REL/inventory-sync.mjs" 2>/dev/null
ls "$C"/data/crawl_queue/manifest-*.json 2>/dev/null | tail -2
EOF
  done
  say "== queue (tonight, as box2 sees it)"
  rsh box2 "SYNC_REL='$SYNC_REL' CRAWLER_REL='$CRAWLER_REL' bash -s" <<'EOF'
cd "$HOME/$SYNC_REL" && set -a && . ./.env && set +a
N="$(cd "$HOME/$CRAWLER_REL" && node -e "import('./src/crawlQueueCore.js').then((m) => console.log(m.queueNight()))" 2>/dev/null)"
curl -s -m 10 -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "http://127.0.0.1:${TRIMSCOUT_DEALS_PORT:-3004}/api/ops/crawl-queue/status?night=$N" | head -c 1500; echo
EOF
}

do_pilot() {
  [ -n "$PILOT_STATE" ] || die "usage: pilot <2-letter state> [--box boxN]   (a small state is plenty: DE, RI, VT)"
  local box="${PILOT_BOX:-box3}"
  say "Pilot: a REAL crawl of every $PILOT_STATE shard through the queue on $box (queue night <today>-pilot, 2 slots). The nightly queue is not touched."
  go_gate "run the one-state pilot for $PILOT_STATE on $box (it crawls dealer sites normally and writes $PILOT_STATE shard files on that box; it does NOT sync)"
  rsh "$box" "CRAWLER_REL='$CRAWLER_REL' SYNC_REL='$SYNC_REL' ST='$PILOT_STATE' BOX='$box' bash -s" <<'EOF'
cd "$HOME/$CRAWLER_REL" && set -a && . "$HOME/$SYNC_REL/.env" && set +a
mkdir -p logs && node scripts/run-crawl-queue.mjs --pilot="$ST" --box="$BOX" --slots=2 2>&1 | tee -a "logs/queue-pilot-$(date +%F).log"
EOF
}

do_pilot_check() {
  [ -n "$PILOT_STATE" ] || die "usage: pilot-check <ST> [--box boxN]"
  local box="${PILOT_BOX:-box3}"
  rsh "$box" "CRAWLER_REL='$CRAWLER_REL' SYNC_REL='$SYNC_REL' BOX='$box' bash -s" <<'EOF'
cd "$HOME/$CRAWLER_REL" && set -a && . "$HOME/$SYNC_REL/.env" && set +a
NIGHT="$(TZ=America/New_York date +%F)-pilot"
echo "-- queue status for $NIGHT"; CRAWL_QUEUE_NIGHT="$NIGHT" node scripts/run-crawl-queue.mjs --status --box="$BOX" | head -40
echo "-- manifest"; cat "data/crawl_queue/manifest-$NIGHT.json" 2>/dev/null | head -40 || echo "(none)"
echo "-- the sync's own dry run over exactly those shards (sends nothing)"
cd "$HOME/$SYNC_REL" && CRAWL_QUEUE=1 CRAWL_QUEUE_NIGHT="$NIGHT" TRIMSCOUT_BOX_LABEL="$BOX" node inventory-sync.mjs "$HOME/$CRAWLER_REL/data/inventory" --dry-run 2>&1 | tail -25
EOF
}

do_flag_on() {
  resolve_fleet
  say "== last gate before the flag goes on =="
  do_preflight || die "preflight failed — flag stays OFF"
  api_check || die "queue endpoints not answering — flag stays OFF"
  go_gate "FLAG ON: $WORKERS crawl from the queue at the next 22:00 cron; box2 stops crawling (hosts the queue, receives syncs). Rollback: $0 rollback"
  local b bad=0
  for b in $(printf '%s' "$WORKERS" | tr ',' ' '); do write_flag "$b" worker true || bad=1; done
  write_flag box2 host true || bad=1
  # All or nothing: a half-enabled fleet (box2 still crawling its old states while the workers also take them) is worse than either.
  for b in $(printf '%s' "$WORKERS" | tr ',' ' ') box2; do
    rsh "$b" "grep -q '\"enabled\":true' \$HOME/$CRAWLER_REL/data/crawl_queue/flag.json" || bad=1
  done
  if [ "$bad" -ne 0 ]; then
    say "!! could not enable the flag on every box — turning it back OFF everywhere"
    for b in $(printf '%s' "$WORKERS" | tr ',' ' '); do write_flag "$b" worker false >/dev/null || true; done
    write_flag box2 host false >/dev/null || true
    die "flag NOT enabled (see above). Tonight is a normal fixed-state night."
  fi
  say "Queue is ON. Watch it with: $0 status"
}

do_flag_off() {
  go_gate "FLAG OFF on every box: the fixed-state crons are the default again from their next run. (A crawl already running is not stopped — see docs/CRAWL_QUEUE.md.)"
  local b
  for b in $ALL_BOXES; do
    rsh "$b" "CRAWLER_REL='$CRAWLER_REL' bash -s" <<'EOF'
F="$HOME/$CRAWLER_REL/data/crawl_queue/flag.json"
if [ -f "$F" ]; then cp -a "$F" "$F.cq-bak.$(date +%Y%m%d-%H%M%S)"; node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f));j.enabled=false;fs.writeFileSync(f+".tmp",JSON.stringify(j));fs.renameSync(f+".tmp",f)' "$F" && echo "$(hostname): flag off"; else echo "$(hostname): no flag file (already off)"; fi
EOF
  done
}

do_restore() {
  say "-- restoring backed-up files (only those unchanged since the install)"
  local b
  for b in $ALL_BOXES; do
    rsh "$b" bash -s <<'EOF'
# Every install's manifest, newest first: each undoes its own changes and only if the file is still exactly what that install left.
ls "$HOME"/crawl-queue-install/*/manifest.json >/dev/null 2>&1 || { echo "$(hostname): no install manifest — nothing to restore"; exit 0; }
for M in $(ls -d "$HOME"/crawl-queue-install/*/manifest.json | sort -r); do
node -e '
const fs=require("fs"),cp=require("child_process");const m=JSON.parse(fs.readFileSync(process.argv[1]));
const sha=(p)=>cp.execSync("sha256sum "+JSON.stringify(p)).toString().split(" ")[0];
for (const e of m.reverse()) {
  if (!fs.existsSync(e.path)) { console.log("skip (gone)  "+e.path); continue; }
  if (sha(e.path)!==e.sha256_after) { console.log("LEFT ALONE (changed since install)  "+e.path); continue; }
  if (e.backup) { fs.copyFileSync(e.backup,e.path); console.log("restored     "+e.path); } else { fs.unlinkSync(e.path); console.log("removed new  "+e.path); }
}' "$M"
done
EOF
  done
  say "-- restarting deals-api so box2 stops serving the queue routes"
  rsh box2 'pm2 restart deals-api >/dev/null && echo restarted'
}

case "$CMD" in
  preflight) check_repo_clean; resolve_fleet; do_preflight ;;
  install) do_install ;;
  status) do_status ;;
  pilot) resolve_fleet >/dev/null; do_pilot ;;
  pilot-check) do_pilot_check ;;
  flag) case "$FLAGVAL" in on) do_flag_on ;; off) do_flag_off ;; *) die "usage: flag on|off";; esac ;;
  rollback) do_flag_off; if [ "$RESTORE" = 1 ]; then do_restore; fi; say "Rolled back. Fixed-state crons are the default again."; [ "$RESTORE" = 1 ] || say "(files left installed but inert; add --restore to put the originals back)" ;;
  *) sed -n '2,24p' "$0"; exit 2 ;;
esac
