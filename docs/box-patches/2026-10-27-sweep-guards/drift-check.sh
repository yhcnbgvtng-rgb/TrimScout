#!/usr/bin/env bash
# READ-ONLY drift check for the sweep-guards install (STEPS.md step 0). Changes nothing: every patch is only dry-run, nothing is written except a temp dir.
#   bash drift-check.sh /tmp/sweep-guards-stage        # the staged copy of docs/box-patches/2026-10-27-sweep-guards
# Ends "DRIFT CHECK PASS" only if every patch applies with zero fuzz to the files exactly as they are on the box now.
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

# The deals-API sweep module is replaced whole, so the box must still have exactly the version this change was written against.
if [ "$(md5 $SRV/inventorySweep.js)" = "$(want BASE inventorySweep.js)" ]; then ok "inventorySweep.js on the box is the expected BASE"; \
elif [ "$(md5 $SRV/inventorySweep.js)" = "$(want FINAL inventorySweep.js)" ]; then ok "inventorySweep.js is already the new version"; \
else fail "inventorySweep.js differs from BASE ($(md5 $SRV/inventorySweep.js)); it is replaced whole, so STOP and tell Paul"; fi

# The other four files are patched in place; the md5 of the box copy is informational (box files drift) - the zero-fuzz dry run is the real test.
check_patch() {  # file dir
  local f="$1" dir="$2" patchfile="$S/$1.patch"
  [ -f "$dir/$f" ] || { fail "$dir/$f missing"; return; }
  local m; m="$(md5 "$dir/$f")"
  [ "$m" = "$(want BASE "$f")" ] && echo "     $f md5 equals BASE (no drift)" || { [ "$m" = "$(want FINAL "$f")" ] && echo "     $f md5 equals FINAL (already patched?)" || echo "     $f md5 $m differs from BASE (box drift: expected, the dry run decides)"; }
  if patch -F0 --dry-run "$dir/$f" < "$patchfile" >/dev/null 2>&1; then ok "$f: patch applies cleanly with zero fuzz"; else fail "$f: patch does NOT apply cleanly (box text differs where the change lands)"; fi
}
check_patch deals_api_server.js "$SRV"
for f in inventory-sync.mjs syncRun.js syncSweep.js; do check_patch "$f" "$CLI"; done
[ -f "$CLI/syncSweepGuard.js" ] && echo "     note: $CLI/syncSweepGuard.js already exists" || ok "syncSweepGuard.js not installed yet (new file)"

# Is anything running that must not be interrupted?
if pgrep -fa "inventory-sync.mjs|run_nightly_chain|run-daily-crawl|run_sync_when_safe" >/dev/null; then fail "a sync or crawl is running right now - install only in an idle window"; else ok "no sync/crawl process running"; fi
grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log 2>/dev/null | tail -2 | sed 's/^/     /'
[ "$bad" = 0 ] && echo "DRIFT CHECK PASS" || { echo "DRIFT CHECK FAILED - install nothing; report this output to Paul"; exit 1; }
