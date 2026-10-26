#!/usr/bin/env python3
"""Anchored edit of deals_api_server.js on box2. usage: patch.py FILE [--dry-run]
Every anchor must match exactly once or nothing is written. Writes FILE.new then renames (atomic)."""
import re, sys, os
p = sys.argv[1]; dry = "--dry-run" in sys.argv
s = open(p).read()
old_h = 'sendJson(res, 200, await invCached("stats", () => computeInventoryStats(pool)));'
new_h = ('// statsCached, not invCached: every bulk upsert/sweep clears invCached, so after the nightly sync this full-table scan re-ran cold and timed out.\n'
         '  sendJson(res, 200, await statsCached("stats", () => computeInventoryStats(pool)));')
sig = 'async function computeInventoryStats(pool) {'
helper = sig + '''
  // Same guard as handleInventoryMakes: SET STATEMENT max_statement_time plus withPoolTimeout.
  const q = (sql) => withPoolTimeout(
    pool.query(`SET STATEMENT max_statement_time=${statementSeconds()} FOR ${sql}`),
    waitMs(),
    "Timed out waiting for an available database connection or a slow query"
  );'''
for a in (old_h, sig, 'const statsCached = createStatsCache(', 'function withPoolTimeout(', 'const { statementSeconds, waitMs'):
    if s.count(a) != 1: sys.exit(f"ABORT: anchor count {s.count(a)} != 1: {a[:60]}")
if 'const q = (sql) => withPoolTimeout(' in s: sys.exit("ABORT: already patched")
s = s.replace(old_h, new_h)
i = s.index(sig); j = s.index("\n}\n", i)
body = s[i:j].replace(sig, helper)
body, n = re.subn(r'await pool\.query\(("(?:[^"\\]|\\.)*")\)', r'await q(\1)', body)
if n != 5: sys.exit(f"ABORT: rewrote {n} queries, expected 5")
s = s[:i] + body + s[j:]
if dry: print("dry run OK: 1 handler + 5 queries would change"); sys.exit(0)
open(p + ".new", "w").write(s); os.replace(p + ".new", p); print("patched", p)
