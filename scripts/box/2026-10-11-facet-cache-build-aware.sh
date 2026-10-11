#!/usr/bin/env bash
# Deals box: make the catalog/facet stable cache build-aware (a cached payload whose countsAsOf is not the current facet build counts as expired).
# Installs stableCache.js (whole file: the box copy is identical to the pre-change repo copy, checked below) and makes two anchored edits to
# deals_api_server.js (the import line and the createStableCache options). It does NOT restart deals-api; the new code runs after the next restart.
#
# DO NOT RUN until Paul says go, in an idle window (no crawl, no sync, sync lock free). The restart wipes the in-memory sync lock and re-runs
# ensureInventoryTable's ALTERs, which queue behind long SELECTs: check the processlist first (docs/FACET_CACHE_BUILD_AWARE.md).
#
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-11-facet-cache-build-aware.sh "$B/scripts/box/2026-10-11-facet-cache-build-aware.sh?cb=$(date +%s)" && bash 2026-10-11-facet-cache-build-aware.sh
# Test mode (no box needed): DIR=<copy of the box src> SRC_LOCAL=<repo scrapers/lightsail-crawler/src> bash 2026-10-11-facet-cache-build-aware.sh
set -euo pipefail
DIR=${DIR:-/opt/trimscout-deals/src}
B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src
TS=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
if [ -n "${SRC_LOCAL:-}" ]; then cp "$SRC_LOCAL/stableCache.js" "$TMP/stableCache.js"; else curl -fsSL -o "$TMP/stableCache.js" "$B/stableCache.js?cb=$(date +%s)"; fi
grep -q "export function builtForOtherBuild" "$TMP/stableCache.js" || { echo "ERROR: fetched stableCache.js lacks builtForOtherBuild (stale copy? merge not live yet?)" >&2; exit 1; }
grep -q "export function createStableCache" "$DIR/stableCache.js" && ! grep -q "isOutdated" "$DIR/stableCache.js" || { echo "ERROR: $DIR/stableCache.js is already patched or not the expected file. Stop and compare." >&2; exit 1; }

cp "$DIR/deals_api_server.js" "$TMP/deals_api_server.js"
python3 - "$TMP/deals_api_server.js" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
edits = [
 ('import { createStableCache } from "./stableCache.js";', 'import { createStableCache, builtForOtherBuild } from "./stableCache.js";'),
 ('const stableCached = createStableCache({\n  runBackground,\n  ttlMs: INV_CACHE_MS,',
  'const stableCached = createStableCache({\n  runBackground,\n  ttlMs: INV_CACHE_MS,\n  // A catalog payload built from an older facet build than the current one counts as expired at once (it used to be served for up to INV_CACHE_MS\n  // after every rebuild, so a cleaned-up option list kept showing its old junk). catalogFacets is declared further down; this runs at request time.\n  isOutdated: (value) => builtForOtherBuild(value, catalogFacets.builtAt),'),
]
for old, new in edits:
    n = s.count(old)
    if n != 1: sys.exit("ERROR: anchor matched %d times (need exactly 1): %s" % (n, old[:80]))
    s = s.replace(old, new, 1)
open(p, "w").write(s); print("deals_api_server.js: 2 anchored edits applied to the copy")
PY
node --check "$TMP/deals_api_server.js"; node --check "$TMP/stableCache.js"
cp -p "$DIR/stableCache.js" "$DIR/stableCache.js.bak.$TS"; cp -p "$DIR/deals_api_server.js" "$DIR/deals_api_server.js.bak.$TS"
cp "$TMP/stableCache.js" "$DIR/stableCache.js"; cp "$TMP/deals_api_server.js" "$DIR/deals_api_server.js"
echo "Installed. NOT restarted; the build-aware cache is active after the next deals-api restart."
echo "Rollback: cp -p $DIR/stableCache.js.bak.$TS $DIR/stableCache.js && cp -p $DIR/deals_api_server.js.bak.$TS $DIR/deals_api_server.js   (then restart only if it was already restarted)"
rm -rf "$TMP"
