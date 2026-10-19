// Server side of the paid-only factory-options filter (flag OPTIONS_PAID_ONLY, default OFF; the web app reads the same name in lib/optionsPaidOnly.ts).
//
// ON:  dealer_inventory_options carries each car's own stored price per option row (`price`, INT NULL). The facet rebuild counts a row only
//      where THAT row's price is above 0 — decided per row, never per label, because ~300 labels are paid on some cars and $0 on others — and
//      records the min/max of those paid prices so the filter can show "+$1,225" or "+$800–$1,400" next to the option.
//      A row with a NULL price (not backfilled yet) is not paid, so it is not counted.
// OFF: nothing here is used. No column is added, no price is written, and every query is byte-for-byte what it was.
//
// Pure: no database, no env reads except through the argument, so it is unit-testable (deals_api_server.js starts a server at import time).

const ON = /^(1|true|yes|on)$/i;

export function paidOnlyEnabled(env = process.env) {
  const raw = env.OPTIONS_PAID_ONLY;
  return raw != null && ON.test(String(raw).trim());
}

/** A line's price as a positive whole-dollar integer, or null when it is 0, missing or not a number ("$1,225" strings are read). */
export function positivePrice(v) {
  let n = v;
  if (typeof n === "string") {
    const s = n.replace(/[$,\s]/g, "");
    n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n);
  return r > 0 && r <= 2_000_000_000 ? r : null;
}

/** Larger of two prices where either may be null. Two lines of one key on one car collapse to one row; the paid one wins. */
export const maxPrice = (a, b) => (a == null ? b ?? null : b == null ? a : Math.max(a, b));

/** SQL fragments for the facet rebuild / live catalog query. All empty when the flag is off. */
export function paidSql(enabled, alias = "o") {
  return enabled
    ? { where: ` AND ${alias}.price > 0`, select: `, MIN(${alias}.price) AS min_price, MAX(${alias}.price) AS max_price` }
    : { where: "", select: "" };
}

/** Per-row test the SQL `price > 0` applies, for the unit tests and the backfill's dry-run counts. */
export const isPaidRow = (row) => positivePrice(row && row.price) != null;

/** Counts rows per canonical key under the paid-only rule: [{ key, label, n, minPrice, maxPrice }]. Mirrors the rebuild's GROUP BY. */
export function paidFacetCounts(cars) {
  const byKey = new Map();
  for (const rows of cars) {
    for (const r of rows) {
      const p = positivePrice(r.price);
      if (p == null) continue;
      const cur = byKey.get(r.key) || { key: r.key, label: r.label, n: 0, minPrice: p, maxPrice: p };
      cur.n++;
      cur.minPrice = Math.min(cur.minPrice, p);
      cur.maxPrice = Math.max(cur.maxPrice, p);
      byKey.set(r.key, cur);
    }
  }
  return [...byKey.values()];
}
