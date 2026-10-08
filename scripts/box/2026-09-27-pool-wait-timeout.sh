#!/usr/bin/env bash
# Bounds how long a buyer search may wait for a free DB connection, not just how long its query
# may run once it starts — PR #322.
#
# Confirmed live 2026-09-27, after both #320 (JOIN rewrite + 20s SET STATEMENT) and #321
# (explicit Vercel maxDuration) were already deployed: the exact same previously-failing query
# (make=Ford, model=F-150, trim=Lariat, zip+radius, no color/options) still ran the FULL 60s and
# only stopped because the CALLER's own AbortController (lib/inventoryApi.ts) gave up — zero
# errors anywhere, meaning the query never even reached execution. Checked mysql2's pool source
# directly (node_modules/mysql2/lib/base/pool.js): it has no time-based acquire timeout at all —
# when every connection is busy, getConnection() just pushes onto an unbounded _connectionQueue
# and waits, however long that takes. INV_LIST_STATEMENT_TIMEOUT_SECONDS (20s, from #320) only
# bounds a query once it's actually running — it has no visibility into "still waiting for a
# connection," so a saturated pool (5 connections, shared with the crawler's own long-running
# backfill/export jobs — confirmed live earlier the same day, a backfill was actively cycling
# through this exact pool) bypasses it entirely.
#
# Fix: queueLimit (caps how many requests may ever wait at once, failing fast past that instead
# of growing the queue forever) + withPoolTimeout, a Promise.race against a 45s timer — same idea
# as lib/inventoryApi.ts's own 60s client-side abort, enforced here on the server, comfortably
# under that 60s (so this box always answers first) and above the 20s statement cap (so a query
# that DOES reach execution still hits that more specific error first). A pool timeout now maps
# to a clear 503 with its own message via a new PoolTimeoutError, instead of the generic 500
# "Internal server error" every other uncaught exception here gets. connectionLimit is unchanged.
#
# Run on the deals box (ubuntu@52.202.234.65 — box2):
#   cd ~ && curl -fsSL -o 2026-09-27-pool-wait-timeout.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-27-pool-wait-timeout.sh?cb=$(date +%s)" && sudo cp 2026-09-27-pool-wait-timeout.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-27-pool-wait-timeout.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    if new in s:
        return
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

rep('''      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: false,
    });
  }
  return pool;
}

function sendJson(res, status, obj) {''', '''      waitForConnections: true,
      connectionLimit: 5,
      // No bound on this before 2026-09-27: mysql2's pool has no time-based acquire timeout
      // (checked its source — getConnection() just pushes onto an unbounded _connectionQueue
      // when every connection is busy and waitForConnections is true), so a saturated pool let
      // a request queue silently forever, well past even the 60s caller-side AbortController
      // (lib/inventoryApi.ts) that was supposed to be this server's outer bound. queueLimit
      // caps how many requests may ever wait at once — past this, getConnection() rejects
      // immediately with "Queue limit reached" instead of adding to an ever-growing queue.
      // 20 is generous for this box's normal traffic (5 connections, occasional backfill/export
      // jobs sharing the pool) while still failing fast under real saturation instead of piling
      // requests up behind it.
      queueLimit: 20,
      dateStrings: false,
    });
  }
  return pool;
}

// Thrown by withPoolTimeout below — distinguished from a generic Error so the server's top-level
// `run()` handler (see the request router) can map it to a clear 503, not the generic 500
// "Internal server error" every other uncaught exception gets.
class PoolTimeoutError extends Error {}

// mysql2 has no acquire-timeout option (see queueLimit comment above) — this bounds the
// COMBINED "wait for a free connection + run the query" time for a single call, the same idea
// as lib/inventoryApi.ts's 60s client-side AbortController but enforced here on the server, so a
// saturated pool fails fast and visibly instead of silently consuming the caller's entire budget
// with nothing to show for it on either side. Confirmed live 2026-09-27: a buyer search that
// should have failed at 20s via INV_LIST_STATEMENT_TIMEOUT_SECONDS instead ran the full 60s with
// zero errors anywhere — the query never even started executing, so that statement-level cap
// never got a chance to apply. 45s stays comfortably under the caller's 60s abort (so this box
// always answers first, with a real reason, instead of the caller just giving up) while staying
// above INV_LIST_STATEMENT_TIMEOUT_SECONDS so a query that DOES reach execution hits that more
// specific, better-logged cap first — this only catches "still waiting for a connection."
const POOL_WAIT_TIMEOUT_MS = 45_000;
function withPoolTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PoolTimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sendJson(res, status, obj) {''', "pool queueLimit + withPoolTimeout helper")

rep('''  const [rows] = await pool.query(
    `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });''', '''  // Each wrapped in withPoolTimeout (see its own comment) — INV_LIST_STATEMENT_TIMEOUT_SECONDS
  // only bounds a query once it's actually executing; this bounds "waiting for a free pool
  // connection" too, which that statement-level cap can't see at all.
  const [rows] = await withPoolTimeout(
    pool.query(
      `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    ),
    POOL_WAIT_TIMEOUT_MS,
    "Timed out waiting for an available database connection or a slow query"
  );
  const [[{ total }]] = await withPoolTimeout(
    pool.query(`SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT COUNT(*) AS total ${sql}`, args),
    POOL_WAIT_TIMEOUT_MS,
    "Timed out waiting for an available database connection or a slow query"
  );
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });''', "handleListInventory query wrapping")

rep('''  const run = (fn, ...args) => {
    fn(req, res, ...args).catch((err) => {
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });
    });
  };''', '''  const run = (fn, ...args) => {
    fn(req, res, ...args).catch((err) => {
      // A saturated connection pool (see withPoolTimeout) is a known, expected failure mode
      // under real load — worth its own status/message rather than folding into the generic
      // 500 every other uncaught exception here gets, so the caller (lib/inventoryApi.ts) can
      // tell "this box is overloaded, try again" apart from an actual bug.
      if (err instanceof PoolTimeoutError) {
        console.error(`${new Date().toISOString()} ${pathname} -> 503 (pool timeout):`, err.message);
        return sendJson(res, 503, { error: err.message });
      }
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });
    });
  };''', "run() PoolTimeoutError -> 503 mapping")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g. a query that stresses the pool should now fail around 45s with a clear"
echo "503 pool-timeout message instead of a silent 60s wait or nothing at all."
