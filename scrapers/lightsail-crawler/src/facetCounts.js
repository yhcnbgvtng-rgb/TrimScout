// Live counts behind the buyer /search "More filters" chips: year, mileage, body style, fuel, drivetrain, transmission, days on market and dealer.
//
// How a count is made (and why it is cheap): the request's filters are split in two. Everything the list query already selects with an index (state, make,
// model, trim, condition, price, colours, options, ...) runs ONCE as a bounded SELECT of a few small columns over that range, capped at FACET_ROW_CAP rows
// (a set larger than the cap is answered "too broad", never scanned further). The eight faceted filters are then applied here, in memory, to those rows.
// Each list counts the cars that pass EVERY OTHER filter but not its own, so a chip's number is what picking it would give (the usual faceted-search rule);
// a car that fails two filters counts nowhere. The SQL expressions that classify fuel / drivetrain / transmission are the ones the list query filters with
// (inventoryDerived.js), so a chip's number and the list it opens agree.
//
// Pure: no database, no server. deals_api_server.js owns the route, the concurrency gate and the cache.
import { FUEL_SQL, DRIVETRAIN_SQL, TRANSMISSION_SQL, bodyStylesOf, cleanDrivetrain, cleanFuel, cleanTransmission, dealerIdsOf } from "./inventoryDerived.js";

export const DEFAULT_ROW_CAP = 40000;
export const MAX_ROW_CAP = 100000;
export const MILEAGE_WIDTH = 10000;
export const MILEAGE_TOP = 150000;
export const MILEAGE_BUCKETS = MILEAGE_TOP / MILEAGE_WIDTH + 1;
export const MAX_BODY_CHIPS = 12;
export const MAX_DEALER_CHIPS = 20;
/** Days-on-market bands, keyed like lib/searchFilters.ts DAYS_BANDS; each is [min, max] with null = open. */
export const DAYS_BANDS = [["0-7", 0, 7], ["8-30", 8, 30], ["31-60", 31, 60], ["61-90", 61, 90], ["91+", 91, null]];

/** The faceted filters' request params. The list query must NOT see these (they are applied here), so the handler strips them before building its WHERE. */
export const FACETED_PARAMS = ["yearMin", "yearMax", "odometerMin", "odometerMax", "minDays", "maxDays", "bodyStyle", "fuel", "drivetrain", "transmission", "dealerId"];

export function rowCapOf(env = process.env) {
  const n = Math.floor(Number(env.FACET_COUNTS_ROW_CAP));
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, MAX_ROW_CAP) : DEFAULT_ROW_CAP;
}

/** The request's params without the faceted ones, for the list query's WHERE. */
export function paramsWithoutFaceted(params) {
  const next = new URLSearchParams(params);
  for (const k of FACETED_PARAMS) next.delete(k);
  next.delete("limit"); next.delete("offset"); next.delete("sort"); next.delete("countCap");
  return next;
}

/** The one SELECT: small columns, the derived classes computed in SQL, over the list query's own FROM/WHERE (its `countSql`, no dealership join), one row past the cap. */
export function facetRowsSql(countSql, cap) {
  return `SELECT i.year AS year, i.mileage AS mileage, i.body_style AS body, i.days_on_lot AS days, i.dealer_id AS dealer_id, i.dealer_name AS dealer_name, ${FUEL_SQL} AS fuel, ${DRIVETRAIN_SQL} AS drive, ${TRANSMISSION_SQL} AS trans ${countSql} LIMIT ${Math.floor(cap) + 1}`;
}

const num = (raw) => { const s = String(raw ?? "").trim(); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

/** The faceted filters of a request, cleaned. */
export function facetedFiltersOf(params) {
  return {
    yearMin: num(params.get("yearMin")), yearMax: num(params.get("yearMax")),
    odoMin: num(params.get("odometerMin")), odoMax: num(params.get("odometerMax")),
    daysMin: num(params.get("minDays")), daysMax: num(params.get("maxDays")),
    body: bodyStylesOf(params).map((b) => b.toLowerCase()),
    fuel: cleanFuel(params.getAll("fuel")), drive: cleanDrivetrain(params.getAll("drivetrain")), trans: cleanTransmission(params.getAll("transmission")),
    dealers: dealerIdsOf(params).map(String),
  };
}

// One predicate per faceted dimension. NULL never passes a set bound, like the SQL it mirrors (`i.year >= ?` is false for NULL).
const range = (v, lo, hi) => (lo == null && hi == null) || (v != null && (lo == null || v >= lo) && (hi == null || v <= hi));
const inList = (v, list) => !list.length || (v != null && list.includes(v));
const PRED = {
  year: (r, f) => range(r.year == null ? null : Number(r.year), f.yearMin, f.yearMax),
  mileage: (r, f) => range(r.mileage == null ? null : Number(r.mileage), f.odoMin, f.odoMax),
  days: (r, f) => range(r.days == null ? null : Number(r.days), f.daysMin, f.daysMax),
  body: (r, f) => inList(r.body == null || r.body === "" ? null : String(r.body).toLowerCase(), f.body),
  fuel: (r, f) => inList(r.fuel, f.fuel),
  drive: (r, f) => inList(r.drive, f.drive),
  trans: (r, f) => inList(r.trans, f.trans),
  dealer: (r, f) => inList(r.dealer_id == null ? null : String(r.dealer_id), f.dealers),
};
const DIMS = Object.keys(PRED);

export const bandOfDays = (d) => { for (const [key, lo, hi] of DAYS_BANDS) if (d >= lo && (hi == null || d <= hi)) return key; return null; };

/**
 * rows (from facetRowsSql) + the request's faceted filters -> the `dims` object of GET /api/inventory/facet-counts.
 * Every count excludes its own dimension's filter; lists are ordered by count (then name), zero-count values are omitted.
 */
export function foldFacetCounts(rows, filters) {
  const year = new Map(), fuel = new Map(), drive = new Map(), trans = new Map(), days = new Map(), body = new Map(), dealer = new Map();
  const hist = Array.from({ length: MILEAGE_BUCKETS }, () => 0);
  let noMileage = 0;
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  for (const r of rows) {
    let failed = null, failures = 0;
    for (const d of DIMS) if (!PRED[d](r, filters)) { failures++; failed = d; if (failures > 1) break; }
    if (failures > 1) continue;
    const counts = (d) => failures === 0 || failed === d; // this row counts toward dimension d
    if (counts("year") && r.year != null) bump(year, Number(r.year));
    if (counts("mileage")) { if (r.mileage == null) noMileage++; else hist[Math.min(MILEAGE_BUCKETS - 1, Math.max(0, Math.floor(Number(r.mileage) / MILEAGE_WIDTH)))]++; }
    if (counts("days") && r.days != null) { const b = bandOfDays(Number(r.days)); if (b) bump(days, b); }
    if (counts("body") && r.body) { const k = String(r.body).toLowerCase(); const cur = body.get(k); if (cur) cur.n++; else body.set(k, { v: String(r.body), n: 1 }); }
    if (counts("fuel") && r.fuel) bump(fuel, r.fuel);
    if (counts("drive") && r.drive) bump(drive, r.drive);
    if (counts("trans") && r.trans) bump(trans, r.trans);
    if (counts("dealer") && r.dealer_id != null) { const k = String(r.dealer_id); const cur = dealer.get(k); if (cur) cur.n++; else dealer.set(k, { id: k, name: String(r.dealer_name || `Dealer ${k}`), n: 1 }); }
  }
  const list = (m, keyOrder) => [...m.entries()].map(([v, n]) => ({ v, n })).filter((x) => x.n > 0).sort((a, b) => keyOrder ? keyOrder.indexOf(a.v) - keyOrder.indexOf(b.v) : b.n - a.n || String(a.v).localeCompare(String(b.v)));
  return {
    year: [...year.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => a.v - b.v),
    mileage: { width: MILEAGE_WIDTH, top: MILEAGE_TOP, hist, noMileage },
    bodyStyle: [...body.values()].sort((a, b) => b.n - a.n || a.v.localeCompare(b.v)).slice(0, MAX_BODY_CHIPS),
    fuel: list(fuel), drivetrain: list(drive), transmission: list(trans),
    days: list(days, DAYS_BANDS.map((b) => b[0])),
    dealer: [...dealer.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, MAX_DEALER_CHIPS),
  };
}

/** The whole answer for a set of rows already fetched with one row past the cap. */
export function buildFacetCountsResponse(rows, cap, filters) {
  if (rows.length > cap) return { supported: true, tooBroad: true, cap };
  return { supported: true, rows: rows.length, dims: foldFacetCounts(rows, filters) };
}

/** A small TTL cache (answers are cheap to keep and the same query repeats while a shopper toggles back and forth). */
export function createTtlCache({ ttlMs = 60000, max = 300, now = () => Date.now() } = {}) {
  const m = new Map();
  return {
    get(key) { const e = m.get(key); if (!e) return undefined; if (e.at + ttlMs < now()) { m.delete(key); return undefined; } return e.value; },
    set(key, value) { if (m.size >= max) m.delete(m.keys().next().value); m.set(key, { at: now(), value }); },
    get size() { return m.size; },
  };
}
