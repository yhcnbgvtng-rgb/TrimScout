#!/usr/bin/env bash
# One cron job per night for a box that runs TWO crawls and then a sync (box3, box4):
#
#   expansion crawl  ->  core crawl  ->  inventory sync
#
# strictly in that order, each stage starting the moment the one before it exits.
#
# Before this, each stage had its own cron line and its own clock guess: expansion at 22:00, a
# separate core crawl at 04:00, a separate sync at 07:15/07:45. The guesses were wrong in both
# directions. A core crawl sat idle for hours when expansion finished early (and when expansion ran
# long, run_core_crawl_when_safe.sh had to be bolted on to stop the two overlapping). And the sync
# fired on the clock whether or not the crawls it was meant to follow had finished — on
# 2026-09-30 box4's sync ran against a half-finished core crawl. Here nothing waits on a clock:
# core starts when expansion exits, sync starts when core exits, so expansion alone can never sync.
#
# Failures don't cascade: the stages are sequential but independent, so a crashed expansion crawl
# still gets its core crawl, and a failed core crawl still gets the sync of whatever was crawled.
# Each stage keeps the safety it already had on its own: core goes through
# run_core_crawl_when_safe.sh (it waits if an older expansion crawl is somehow still alive), and
# sync goes through run_sync_when_safe.sh (it refuses while any crawl lock or crawl process is
# alive, then queues on the shared sync lock like every other box).
#
# The chain marker: this script holds <runs dir>/driver-nightly-chain.lock ({"pid": <this shell>})
# from the start until just before the sync stage. run_sync_when_safe.sh's gate already treats every
# driver*.lock file with a live pid as "a crawl is running", so this keeps the gate closed in the
# instant between expansion exiting and the core crawl's own driver-core.lock appearing — and
# against a sync launched by hand in that gap. It is removed before the sync stage, otherwise the
# gate would block this chain's own sync. A marker left behind by a killed chain has a dead pid,
# which the gate ignores like any other stale lock; the cleanup only ever removes a marker that
# still names this shell, so a finishing chain can't delete a newer chain's.
#
# The same marker stops a second chain from stacking on a first: if a chain is still crawling when
# the next cron (or a person) starts one, the newcomer logs that and exits instead of running a
# second pair of crawls on the same box.
#
# Per-box configuration stays in the crontab line, as the KEY=VAL lists each old cron line carried:
#   CHAIN_EXPANSION_ENV="CRAWLER_BRAND_SET=expansion CRAWL_STATES=... CRAWLER_MAX_CONCURRENT_STATES=4 ..."
#   CHAIN_CORE_ENV="CRAWLER_RUN_LABEL=core CRAWL_STATES=... CRAWLER_MAX_CONCURRENT_STATES=6"
# (word-split on purpose: no value may contain a space). Both lists are checked before anything
# starts — a word that isn't KEY=VAL would make `env` run it as the command — and the core list must
# carry its own CRAWLER_RUN_LABEL, or its lock file and box-report would collide with expansion's.
#
# Logs, same names the separate cron lines produced: expansion -> logs/run-all-<night>.log,
# core -> logs/run-all-core-<date core started>.log, sync -> ~/inventory-sync/logs/sync-<night>.log
# where <night> is the date the chain started. This script's own stage lines go to stdout (cron
# appends them to logs/chain-<night>.log).
#
# CHAIN_DRY_RUN=1 prints the plan, checks every piece exists, and starts nothing.
set -u
set -f  # the unquoted KEY=VAL lists and commands below are word-split on purpose; never let a value glob

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRAWLER_DIR="${CHAIN_CRAWLER_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUNS_DIR="${CHAIN_RUNS_DIR:-$CRAWLER_DIR/data/daily_crawl_runs}"
SYNC_LOG_DIR="${CHAIN_SYNC_LOG_DIR:-$HOME/inventory-sync/logs}"
# The three commands are overridable so the chain's ordering and failure handling can be tested with stubs.
CRAWL_CMD="${CHAIN_CRAWL_CMD:-node scripts/run-daily-crawl.mjs}"
CORE_WAIT_CMD="${CHAIN_CORE_WAIT_CMD:-$SCRIPT_DIR/run_core_crawl_when_safe.sh}"
SYNC_CMD="${CHAIN_SYNC_CMD:-$HOME/inventory-sync/run_sync_when_safe.sh}"
NIGHT="${CHAIN_NIGHT:-$(date +%F)}"
MARKER="$RUNS_DIR/driver-nightly-chain.lock"

log() { echo "[nightly-chain] $(date '+%F %T %Z') $*"; }

# Every word must be KEY=VAL, or `env` would try to run it as the command and the stage would die
# with nothing crawled.
valid_env_list() {
  local w
  for w in $1; do
    case "$w" in [A-Za-z_]*=*) ;; *) return 1 ;; esac
  done
  return 0
}

if [ -z "${CHAIN_EXPANSION_ENV:-}" ] || [ -z "${CHAIN_CORE_ENV:-}" ]; then
  echo "[nightly-chain] CHAIN_EXPANSION_ENV and CHAIN_CORE_ENV are both required (the KEY=VAL lists from the old cron lines) — refusing to run" >&2
  exit 2
fi
if ! valid_env_list "$CHAIN_EXPANSION_ENV" || ! valid_env_list "$CHAIN_CORE_ENV"; then
  echo "[nightly-chain] CHAIN_EXPANSION_ENV / CHAIN_CORE_ENV must be space-separated KEY=VAL words (no spaces inside a value) — refusing to run" >&2
  exit 2
fi
case " $CHAIN_CORE_ENV " in
  *" CRAWLER_RUN_LABEL="?*) ;;
  *) echo "[nightly-chain] CHAIN_CORE_ENV must set CRAWLER_RUN_LABEL (core's own lock file and box-report) — refusing to run" >&2; exit 2 ;;
esac
case " $CHAIN_EXPANSION_ENV " in
  *" CRAWLER_RUN_LABEL="*) echo "[nightly-chain] CHAIN_EXPANSION_ENV must not set CRAWLER_RUN_LABEL (only the core stage is labelled) — refusing to run" >&2; exit 2 ;;
esac

if [ "${CHAIN_DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN — nothing is started and no files are written"
  echo "directory: $CRAWLER_DIR"
  echo "stage 1/3: env $CHAIN_EXPANSION_ENV $CRAWL_CMD  >> logs/run-all-$NIGHT.log"
  echo "stage 2/3: $CORE_WAIT_CMD env $CHAIN_CORE_ENV $CRAWL_CMD  >> logs/run-all-core-<date core starts>.log"
  echo "stage 3/3: $SYNC_CMD  >> $SYNC_LOG_DIR/sync-$NIGHT.log"
  echo "marker:    $MARKER (held through stages 1-2, removed before stage 3)"
  problems=0
  check_cmd() { if command -v "$2" >/dev/null 2>&1; then echo "  ok       $1: $2"; else echo "  MISSING  $1: $2"; problems=$((problems + 1)); fi; }
  # shellcheck disable=SC2086
  set -- $CRAWL_CMD
  check_cmd "crawl command" "$1"
  last=""; for a in "$@"; do last="$a"; done
  case "$last" in
    *.mjs|*.js) if [ -f "$CRAWLER_DIR/$last" ] || [ -f "$last" ]; then echo "  ok       crawl entrypoint: $last"; else echo "  MISSING  crawl entrypoint: $last"; problems=$((problems + 1)); fi ;;
  esac
  # shellcheck disable=SC2086
  set -- $CORE_WAIT_CMD
  check_cmd "core wait wrapper" "$1"
  # shellcheck disable=SC2086
  set -- $SYNC_CMD
  check_cmd "sync wrapper" "$1"
  [ "$problems" -eq 0 ] && exit 0
  exit 3
fi

cd "$CRAWLER_DIR" || { echo "[nightly-chain] cannot cd to $CRAWLER_DIR" >&2; exit 2; }
mkdir -p logs "$RUNS_DIR" "$SYNC_LOG_DIR"

# Another chain still crawling (marker names a live chain process — the args check keeps a pid that
# was recycled by something unrelated after a reboot from blocking tonight forever).
if [ -f "$MARKER" ]; then
  other="$(sed -n 's/.*"pid":\([0-9][0-9]*\),.*/\1/p' "$MARKER" 2>/dev/null | head -n 1)"
  if [ -n "$other" ] && [ "$other" != "$$" ] && kill -0 "$other" 2>/dev/null \
     && ps -p "$other" -o args= 2>/dev/null | grep -q 'run_nightly_chain\.sh'; then
    log "another nightly chain (pid $other) is still crawling — not starting a second one"
    exit 1
  fi
fi

cleanup_marker() { grep -q "\"pid\":$$," "$MARKER" 2>/dev/null && rm -f "$MARKER"; return 0; }
printf '{"pid":%s,"startedAt":"%s","kind":"nightly-chain"}\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER" \
  || log "WARNING: could not write $MARKER; the sync gate will rely on the crawl locks alone"
trap cleanup_marker EXIT

log "chain start (night $NIGHT, pid $$)"

log "stage 1/3 expansion crawl: starting (log: logs/run-all-$NIGHT.log)"
# shellcheck disable=SC2086  # splitting the KEY=VAL list and the command is the point
env $CHAIN_EXPANSION_ENV $CRAWL_CMD >> "logs/run-all-$NIGHT.log" 2>&1
rc1=$?
log "stage 1/3 expansion crawl: exited rc=$rc1"

CORE_LOG="logs/run-all-core-$(date +%F).log"
log "stage 2/3 core crawl: starting (log: $CORE_LOG)"
# shellcheck disable=SC2086
$CORE_WAIT_CMD env $CHAIN_CORE_ENV $CRAWL_CMD >> "$CORE_LOG" 2>&1
rc2=$?
log "stage 2/3 core crawl: exited rc=$rc2"

cleanup_marker
trap - EXIT
log "stage 3/3 sync: starting (log: $SYNC_LOG_DIR/sync-$NIGHT.log)"
# shellcheck disable=SC2086
$SYNC_CMD >> "$SYNC_LOG_DIR/sync-$NIGHT.log" 2>&1
rc3=$?
log "stage 3/3 sync: exited rc=$rc3 (expansion rc=$rc1, core rc=$rc2)"
exit "$rc3"
