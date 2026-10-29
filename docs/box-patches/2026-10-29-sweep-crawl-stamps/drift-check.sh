#!/usr/bin/env bash
# READ-ONLY drift check for the crawl-stamps install (STEPS.md step 0). Changes nothing: patches are only dry-run, nothing is written except a temp dir.
#   bash drift-check.sh /tmp/sweep-crawl-stamps-stage        # the staged copy of docs/box-patches/2026-10-29-sweep-crawl-stamps (+ the five whole files)
# Ends "DRIFT CHECK PASS" only if every whole file on the box is still the BASE this change was written against and both patches apply with zero fuzz.
set -uo pipefail
S="${1:?usage: drift-check.sh STAGE_DIR}"
SRV=/opt/trimscout-deals/src
CLI="$HOME/inventory-sync"
bad=0
ok()   { echo "ok   $*"; }
fail() { echo "FAIL $*"; bad=1; }
md5()  { md5sum "$1" | cut -d' ' -f1; }
want() { awk -v role="$1" -v f="$2" '$2==role && $3==f {print $1}' "$S/manifest.txt"; }

command -v patch >/dev/null && ok "patch present" || fail "patch missing"
command -v node  >/dev/null && ok "node present ($(node -v))" || fail "node missing"

# Replaced whole: the box copy must be exactly the BASE (or already the FINAL if this install was started before).
whole() {  # file dir
  local f="$1" dir="$2" m; m="$(md5 "$dir/$f" 2>/dev/null)"
  if [ "$m" = "$(want BASE "$f")" ]; then ok "$f is the expected BASE"; \
  elif [ "$m" = "$(want FINAL "$f")" ]; then ok "$f is already the new version"; \
  else fail "$f differs from BASE ($m); it is replaced whole, so STOP and tell Paul"; fi
}
whole inventorySweep.js "$SRV"
for f in syncRun.js syncSweep.js syncSweepGuard.js syncRetired.js; do whole "$f" "$CLI"; done

# Patched in place: the md5 of the box copy is informational; the zero-fuzz dry run is the real test.
check_patch() {  # file dir
  local f="$1" dir="$2" m; m="$(md5 "$dir/$f" 2>/dev/null)"
  [ -f "$dir/$f" ] || { fail "$dir/$f missing"; return; }
  [ "$m" = "$(want BOXBASE "$f")" ] && echo "     $f md5 equals the box2 text this patch was cut from" || { [ "$m" = "$(want BOXFINAL "$f")" ] && echo "     $f md5 equals BOXFINAL (already patched?)" || echo "     $f md5 $m differs from the text the patch was cut from (box drift: the dry run decides)"; }
  if patch -F0 --dry-run "$dir/$f" < "$S/$f.patch" >/dev/null 2>&1; then ok "$f.patch applies cleanly with zero fuzz"; else fail "$f.patch does NOT apply cleanly (box text differs where the change lands)"; fi
}
check_patch deals_api_server.js "$SRV"
check_patch inventory-sync.mjs "$CLI"

# The sweep guards must already be live: this change builds on them.
grep -q "guardConfigFromEnv" "$CLI/syncSweepGuard.js" 2>/dev/null && ok "sweep guards are installed" || fail "sweep guards are not installed on this box"

# Is anything running that must not be interrupted?
if pgrep -fa "inventory-sync.mjs|run_nightly_chain|run-daily-crawl|run_daily_crawl|standalone" >/dev/null; then fail "a sync or crawl is running right now - install only in an idle window"; else ok "no sync/crawl process running"; fi
grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log 2>/dev/null | tail -2 | sed 's/^/     /'
[ "$bad" = 0 ] && echo "DRIFT CHECK PASS" || { echo "DRIFT CHECK FAILED - install nothing; report this output to Paul"; exit 1; }
