#!/usr/bin/env bash
# Deals API: run scripts/box/2026-09-22-build-search-prefix-suffix-index.mjs FIRST — this
# script assumes the vin_rev/dealer_name_rev/model_rev/trim_rev/stock_number_rev columns
# (trigger-populated, not generated — MariaDB rejects REVERSE() in GENERATED ALWAYS AS) and
# their idx_inv_*_fwd/_rev indexes already exist. Switches the free-text q= search
# from a 5-column OR'd LIKE '%...%' (a full table scan — confirmed via EXPLAIN on the live box,
# 2026-09-22: type "ALL", ~16s per search over 555k+ rows, since a leading wildcard can't use
# any index) to a forward+reversed prefix search across all 5 fields: an indexed "starts with"
# match, plus an indexed "ends with" match via the reversed column (a reversed-prefix search is
# a suffix search on the original value). Covers a partial VIN's last N characters, a dealer
# name's trailing words, and the start of any of the 5 fields — the two patterns that actually
# matter in practice. Also idempotently registers the columns/indexes in ensureInventoryTable
# for future/fresh box provisioning (IF NOT EXISTS — a no-op once built).
#
# NOTE: this supersedes an earlier same-day attempt at an ngram FULLTEXT index, which turned
# out not to exist on this MariaDB install at all (no plugin file, no apt package either).
#
# Run on the box (ubuntu@3.208.49.1), AFTER the schema-build step:
#   curl -fsSL -o 2026-09-22-inventory-search-prefix-suffix.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-inventory-search-prefix-suffix.sh && bash 2026-09-22-inventory-search-prefix-suffix.sh
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
    // search. idx_inv_*_fwd/_rev (see ensureInventoryTable) cover the two patterns that
    // matter in practice — starts-with or ends-with — as an indexed prefix search in each
    // direction (a reversed-prefix match is a suffix match on the original value): a VIN's
    // last 6, a dealer name's trailing "…Route 10", the start of a model/trim/stock number.
    // What this can't find: a fragment from the middle that's neither end — a smaller, more
    // honest gap than the ngram approach this replaced, which didn't exist on this box at
    // all (no plugin, not installable via apt either). A term under 2 characters is too
    // short for a useful prefix/suffix match, so it falls back to the old full scan — rare,
    // no regression there.
    const term = p("q").trim();
    if (term.length >= 2) {
      where.push(`(
        i.vin LIKE ? OR i.vin_rev LIKE ? OR
        i.dealer_name LIKE ? OR i.dealer_name_rev LIKE ? OR
        i.model LIKE ? OR i.model_rev LIKE ? OR
        i.trim LIKE ? OR i.trim_rev LIKE ? OR
        i.stock_number LIKE ? OR i.stock_number_rev LIKE ?
      )`);
      const fwd = `${term}%`;
      const back = `${term.split("").reverse().join("")}%`;
      args.push(fwd, back, fwd, back, fwd, back, fwd, back, fwd, back);
    } else if (term) {
      where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)");
      const like = `%${term}%`;
      args.push(like, like, like, like, like);
    }
  }''', "forward+reverse prefix search")
rep('''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);''',
'''    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // The free-text q= search's index. 2026-09-22: an ngram FULLTEXT parser (MariaDB's
  // documented CJK/no-space substring technique) turned out not to exist on this box at all —
  // not installed, not even present as a plugin file, and no apt package ships it either
  // (confirmed live: ER_FUNCTION_NOT_DEFINED, then an empty apt-cache search). Vanilla MariaDB
  // has no built-in arbitrary-substring index, so this covers the two patterns that actually
  // matter in practice — the start OR the end of a value (a partial VIN's last 6, a dealer
  // name's trailing "…Route 10") — via a plain B-tree prefix search in each direction: a
  // forward index on the column, and a reversed copy with its own index (a reversed-prefix
  // search is a suffix search on the original string). The reversed columns are plain (NOT
  // generated) — MariaDB rejects REVERSE() inside GENERATED ALWAYS AS (confirmed live:
  // "Function or expression 'reverse(...)' cannot be used in the GENERATED ALWAYS AS
  // clause", no error code, errno 1901 — a MariaDB-specific restriction MySQL doesn't share),
  // so the two triggers below populate them on every write instead. vin's forward prefix
  // already has an index via the PRIMARY KEY (vin, dealer_id). Built once, IF NOT EXISTS — on
  // an existing 570k+-row table this can take real time, so it's deployed as its own one-off
  // script (scripts/box/2026-09-22-…) rather than left to run implicitly on first request
  // after a restart; this entry only matters for a fresh box provisioned from scratch.
  for (const ddl of [
    "ADD COLUMN IF NOT EXISTS vin_rev CHAR(17) NULL",
    "ADD COLUMN IF NOT EXISTS dealer_name_rev VARCHAR(255) NULL",
    "ADD COLUMN IF NOT EXISTS model_rev VARCHAR(96) NULL",
    "ADD COLUMN IF NOT EXISTS trim_rev VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS stock_number_rev VARCHAR(64) NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_vin_rev (vin_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_fwd (dealer_name)",
    "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_rev (dealer_name_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_model_fwd (model)",
    "ADD INDEX IF NOT EXISTS idx_inv_model_rev (model_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_trim_fwd (trim)",
    "ADD INDEX IF NOT EXISTS idx_inv_trim_rev (trim_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_fwd (stock_number)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_rev (stock_number_rev)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // Triggers, not generated columns (see note above) — plain BEFORE INSERT/UPDATE writes,
  // unrestricted in what functions they may call. Backfilling existing rows is a separate,
  // one-off step (scripts/box/2026-09-22-…), not done here — it only matters on first deploy.
  for (const when of ["INSERT", "UPDATE"]) {
    await pool.query(`
      CREATE TRIGGER IF NOT EXISTS trg_inv_rev_${when.toLowerCase()} BEFORE ${when} ON dealer_inventory
      FOR EACH ROW SET
        NEW.vin_rev = REVERSE(NEW.vin),
        NEW.dealer_name_rev = REVERSE(NEW.dealer_name),
        NEW.model_rev = REVERSE(NEW.model),
        NEW.trim_rev = REVERSE(NEW.trim),
        NEW.stock_number_rev = REVERSE(NEW.stock_number)
    `);
  }''', "idempotent index+trigger registration for fresh provisioning")
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
  // free-text q= search — see the idx_inv_*_fwd/_rev indexes above for why
  // that's no longer a full scan on its own). SQL_CALC_FOUND_ROWS computes the full match
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
