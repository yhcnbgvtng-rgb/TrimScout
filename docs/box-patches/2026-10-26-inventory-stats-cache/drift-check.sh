#!/bin/bash
# READ-ONLY check, run ON box2. Changes nothing. Confirms the live deals_api_server.js still has the lines patch.py anchors on.
#   usage: bash drift-check.sh [FILE]     (default /opt/trimscout-deals/deals_api_server.js - confirm the real path in STEPS.md step 0)
F=${1:-/opt/trimscout-deals/deals_api_server.js}
[ -f "$F" ] || { echo "DRIFT CHECK FAIL - $F not found"; exit 1; }
echo "== md5 (record this)"; md5sum "$F"
fail=0
chk() { n=$(grep -cF -- "$2" "$F"); [ "$n" = "$3" ] && echo "ok   $1 ($n)" || { echo "FAIL $1: expected $3, found $n"; fail=1; }; }
chk 'handler line'            'sendJson(res, 200, await invCached("stats", () => computeInventoryStats(pool)));' 1
chk 'computeInventoryStats'   'async function computeInventoryStats(pool) {' 1
chk 'statsCached defined'     'const statsCached = createStatsCache(' 1
chk 'withPoolTimeout defined' 'function withPoolTimeout(' 1
chk 'statementSeconds/waitMs' 'const { statementSeconds, waitMs' 1
n=$(awk '/^async function computeInventoryStats\(pool\) \{/{f=1} f&&/await pool\.query\("/{c++} f&&/^}/{print c; exit}' "$F"); [ "$n" = 5 ] && echo "ok   5 bare pool.query calls in computeInventoryStats" || { echo "FAIL expected 5 bare pool.query calls, found '$n'"; fail=1; }
grep -qF 'const q = (sql) => withPoolTimeout(' "$F" && echo "NOTE already patched (q helper present)"
[ $fail = 0 ] && echo "DRIFT CHECK PASS (nothing was changed)" || { echo "DRIFT CHECK FAIL - do not install; send this output back"; exit 1; }
