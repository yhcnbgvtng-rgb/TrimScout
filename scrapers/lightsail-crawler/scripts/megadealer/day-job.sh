#!/usr/bin/env bash
# Isolated daytime job (docs/MEGADEALER_PLAN.md). Runs entirely under $MEGA (default ~/megadealer):
# its own cwd/data dir, its own lock file, logs and failure log. It never reads or writes the nightly
# crawl's data dir, runs dir, checkpoint or sweep-retired dir, and never uses a driver*.lock name.
#
#   day-job.sh precheck   skip rules only (no side effects beyond a brief throwaway sync-lock probe, x2)
#   day-job.sh setup      create dirs, copy code, build dealer files
#   day-job.sh gate       production-probe gate check on every pilot store
#   day-job.sh crawl      crawl the gate-passing stores into $MEGA/run/data/inventory
#   day-job.sh dry        sync --dry-run against ONLY $MEGA/run/data/inventory, then count truly new VINs
#   (the REAL sync is a separate script, sync-real.sh, run only after an explicit GO)
set -uo pipefail
MEGA="${MEGA:-$HOME/megadealer}"; APP="$MEGA/app"; RUN="$MEGA/run"; LOGS="$MEGA/logs"
DAY="$(TZ=America/New_York date +%F)"; FAIL="$LOGS/megadealer-failures-$DAY.log"; LOG="$LOGS/megadealer-$DAY.log"
CRAWLER_SRC="${CRAWLER_SRC:-$HOME/nj-scraper/scrapers/lightsail-crawler}"
LOCK="$MEGA/megadealer-crawl.lock"
mkdir -p "$LOGS"
say() { echo "$(TZ=America/New_York date '+%F %T') [megadealer] $*" | tee -a "$LOG"; }
skip() { echo "$(TZ=America/New_York date '+%F %T') SKIP: $*" | tee -a "$FAIL" "$LOG"; exit 0; }

precheck() {
  local hm; hm=$(TZ=America/New_York date +%H%M)
  [ "$hm" -ge 1830 ] && skip "after 18:30 ET ($hm): nothing starts"
  [ "$hm" -ge 2130 ] || [ "$hm" -lt 0900 ] && skip "outside the daytime window ($hm)"
  # nightly sync finished: newest sync log has its final summary line and has been quiet 10+ min
  local f; f=$(ls -t "$HOME"/inventory-sync/logs/sync-*.log 2>/dev/null | head -1)
  [ -n "$f" ] || skip "no nightly sync log found"
  grep -q '"upserted":' "$f" || skip "nightly sync not finished ($f has no summary line)"
  [ $(( $(date +%s) - $(stat -c %Y "$f") )) -gt 600 ] || skip "nightly sync log still changing"
  # no nightly crawl/chain active (the same gate the nightly sync uses, read-only)
  node "$CRAWLER_SRC/scripts/check-crawl-gate.mjs" "$CRAWLER_SRC/data/daily_crawl_runs" >/dev/null || skip "nightly crawl gate says busy"
  [ ! -e "$LOCK" ] || { kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null && skip "megadealer-crawl.lock held"; rm -f "$LOCK"; }
  local free_gb; free_gb=$(awk '/MemAvailable/{printf "%d",$2/1048576}' /proc/meminfo)
  [ "$free_gb" -ge "${MIN_FREE_GB:-3}" ] || skip "only ${free_gb} GB available (need ${MIN_FREE_GB:-3})"
  # shared sync lock free on two checks in a row, 2 min apart (sync-lock-probe takes and releases it with a throwaway owner)
  set -a; . "$HOME/inventory-sync/.env"; set +a
  node "$HOME/inventory-sync/sync-lock-probe.mjs" >>"$LOG" 2>&1 || skip "sync lock held or unknown (check 1)"
  sleep 120
  node "$HOME/inventory-sync/sync-lock-probe.mjs" >>"$LOG" 2>&1 || skip "sync lock held or unknown (check 2)"
  say "precheck passed"
}

setup() {
  mkdir -p "$APP" "$RUN/data" "$MEGA/dealers" "$MEGA/sync/sweep-retired" "$LOGS"
  # private copy of the crawler code (src + scripts) so brand additions never touch the nightly tree
  rm -rf "$APP/src" "$APP/scripts"; cp -R "$CRAWLER_SRC/src" "$APP/src"; cp -R "$CRAWLER_SRC/scripts" "$APP/scripts"
  cp "$CRAWLER_SRC/package.json" "$APP/"; ln -sfn "$CRAWLER_SRC/node_modules" "$APP/node_modules"
  [ -n "${BRANDS_OVERLAY:-}" ] && cp "$BRANDS_OVERLAY" "$APP/src/brands.js"
  [ -n "${MEGA_SCRIPTS:-}" ] && cp -R "$MEGA_SCRIPTS"/. "$APP/scripts/megadealer/"
  [ -n "${PILOT_CSV:-}" ] && node "$APP/scripts/megadealer/build-dealers.mjs" "$PILOT_CSV" "$MEGA/dealers"
  say "setup done"
}

gate() { node "$APP/scripts/megadealer/gate-check.mjs" "$MEGA/dealers" 2>&1 | tee -a "$LOG"; }

crawl() {
  echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
  local deadline=$(( $(TZ=America/New_York date -d '19:45' +%s) ))
  node -e '
    const g=JSON.parse(require("fs").readFileSync(process.argv[1]+"/gate.json")); const ok=new Set(g.filter(x=>x.ready).map(x=>x.id));
    const jobs=JSON.parse(require("fs").readFileSync(process.argv[1]+"/jobs.json"));
    for(const j of jobs){const d=JSON.parse(require("fs").readFileSync(j.file)).filter(x=>ok.has(x.id)); if(!d.length)continue;
      const f=j.file.replace(/\.json$/,".ready.json"); require("fs").writeFileSync(f,JSON.stringify(d)); console.log([j.state,j.brand,f].join("|"));}' "$MEGA/dealers" > "$MEGA/dealers/ready-jobs.txt"
  while IFS='|' read -r st br file; do
    [ "$(date +%s)" -lt "$deadline" ] || { echo "$(date) crawl deadline 19:45 reached, stopping" | tee -a "$FAIL" "$LOG"; break; }
    say "crawl $st $br"
    ( cd "$RUN" && CRAWLER_DEALERS_FILE="$file" CRAWLER_STATE="$st" CRAWLER_BRAND="$br" CRAWLER_CONCURRENCY=2 \
      CRAWLER_MAX_VEHICLES_PER_DEALER=1000 NODE_OPTIONS="--max-old-space-size=${HEAP_MB:-2048}" \
      node "$APP/src/standalone.js" ) >> "$LOGS/crawl-$st-$br-$DAY.log" 2>&1 || echo "$(date) crawl $st $br exited non-zero (see crawl log)" | tee -a "$FAIL" "$LOG"
  done < "$MEGA/dealers/ready-jobs.txt"
}

dry() {
  set -a; . "$HOME/inventory-sync/.env"; set +a
  export TRIMSCOUT_BOX_LABEL="${TRIMSCOUT_BOX_LABEL:-box1-day}" SYNC_CHECKPOINT_PATH="$MEGA/sync/.checkpoint.json" SWEEP_RETIRED_DIR="$MEGA/sync/sweep-retired"
  ( cd "$HOME/inventory-sync" && node inventory-sync.mjs "$RUN/data/inventory" --dry-run ) 2>&1 | tee -a "$LOG"
  [ -f "$MEGA/dealer-ids.json" ] && node "$APP/scripts/megadealer/new-vins.mjs" "$RUN/data/inventory" "$MEGA/dealer-ids.json" 2>&1 | tee -a "$LOG"
}

for st in "$@"; do case "$st" in precheck) precheck;; setup) setup;; gate) gate;; crawl) crawl;; dry) dry;; *) echo "unknown stage $st"; exit 2;; esac; done
