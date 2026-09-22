#!/usr/bin/env bash
# Deals API: run scripts/box/2026-09-22-… (build-search-index.mjs) FIRST — this script assumes
# idx_inv_search (an ngram FULLTEXT index on dealer_inventory) already exists. It switches the
# free-text q= search from a 5-column OR'd LIKE '%...%' (a full table scan — confirmed via EXPLAIN
# on the live box, 2026-09-22: type "ALL", ~16s per search over 555k+ rows, since a leading
# wildcard can't use any index) to a MATCH()...AGAINST(... IN BOOLEAN MODE) query, which the
# ngram index resolves as an indexed lookup. Also idempotently registers the index's own creation
# in ensureInventoryTable for future/fresh box provisioning (IF NOT EXISTS — a no-op once built).
#
# Run on the box (ubuntu@3.208.49.1), AFTER the index-build step:
#   curl -fsSL -o 2026-09-22-inventory-search-fulltext.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-inventory-search-fulltext.sh && bash 2026-09-22-inventory-search-fulltext.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); changed=[]
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    if new in s: return
    s=s.replace(old,new); changed.append(label)
rep('''  if (p("q")) { where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)"); const like = `%${p("q")}%`; args.push(like, like, like, like, like); }''',
'''  if (p("q")) {
    // A leading-wildcard LIKE across 5 columns can't use any index — confirmed via EXPLAIN
    // against the live box (2026-09-22): type "ALL", a full scan of 555k+ rows, ~16s per
    // search. idx_inv_search (an ngram FULLTEXT index — see scripts/box/2026-09-22-…) turns
    // the same "contains anywhere" search into an indexed lookup: a double-quoted boolean-mode
    // phrase match is MariaDB's documented technique for true substring search via ngram
    // (built for CJK/no-space text, equally valid for VINs and stock numbers). A term under 2
    // characters has no ngram to match, so it falls back to the old scan — rare, no regression.
    const term = p("q").replace(/"/g, "").trim();
    if (term.length >= 2) {
      where.push("MATCH(i.vin, i.dealer_name, i.model, i.trim, i.stock_number) AGAINST (? IN BOOLEAN MODE)");
      args.push(`"${term}"`);
    } else if (term) {
      where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)");
      const like = `%${term}%`;
      args.push(like, like, like, like, like);
    }
  }''', "ngram FULLTEXT search")
rep('''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''',
'''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // The free-text q= search's index: an ngram-parsed FULLTEXT index turns a "contains
  // anywhere" match into an indexed lookup instead of a 5-column OR'd LIKE full scan (see
  // handleListInventory). Built once, IF NOT EXISTS — on an existing 570k+-row table this can
  // take real time, so it's deployed as its own one-off script (scripts/box/2026-09-22-…)
  // rather than left to run implicitly on first request after a restart; this entry only
  // matters for a fresh box provisioned from scratch.
  await pool.query("ALTER TABLE dealer_inventory ADD FULLTEXT INDEX IF NOT EXISTS idx_inv_search (vin, dealer_name, model, trim, stock_number) WITH PARSER ngram");''', "idempotent index registration for fresh provisioning")
rep('''  // One scan instead of two. A free-text q= search is a 5-column OR'd LIKE
  // '%...%' — no index can help a leading wildcard, so it walks every
  // candidate row; running that same WHERE clause a second time just for
  // COUNT(*) doubled the cost of every search for nothing. SQL_CALC_FOUND_ROWS
  // computes the full match count as a side effect of the LIMITed query
  // itself (MariaDB has never deprecated it, unlike MySQL 8+), so FOUND_ROWS()
  // is a cheap follow-up, not a second scan — but it's per-connection state,
  // so both queries MUST run on the same pooled connection, never pool.query()
  // twice (the second call can land on a different connection and read back
  // an unrelated request's count). Same `total` value in the response either way.''',
'''  // One scan instead of two: running the WHERE clause a second time just for
  // COUNT(*) doubled the cost of every request for nothing (worst case a
  // free-text q= search — see idx_inv_search above for why that's no longer
  // a full scan on its own). SQL_CALC_FOUND_ROWS computes the full match
  // count as a side effect of the LIMITed query itself (MariaDB has never
  // deprecated it, unlike MySQL 8+), so FOUND_ROWS() is a cheap follow-up,
  // not a second scan — but it's per-connection state, so both queries MUST
  // run on the same pooled connection, never pool.query() twice (the second
  // call can land on a different connection and read back an unrelated
  // request's count). Same `total` value in the response either way.''', "comment refresh")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1&q=to")
echo "inventory-search-check: $code"
