// One listing per VIN for the buyer search. A VIN live under several stores (a dealer group pooling stock, a sister-store site, a
// neighbouring state shard — docs/SHADOW_DUPLICATES.md) shows once: the store that saw it MOST RECENTLY keeps it. Display-only: no row is
// retired or changed, and the admin / dealer views never send onePerVin, so they still list every store.
//
// The rule, on stored facts only (so the page, the count and the facet counts cannot disagree):
//   1. the greatest last_seen_at wins;
//   2. mode "1": ties go to the lowest price (a missing price ranks last), then the lowest dealer_id.
//      mode "latest": ties are KEPT. The distance to the buyer's zip is not in this database (no dealer lat/lng), so the web app
//      breaks those ties itself (lib/onePerVin.ts). Sent whenever the buyer's location is known.
// A row only competes against rows a buyer could also see: in stock, not stale, retail, and (when asked) seen within the window.
// Pure: no I/O.

export const ONE_PER_VIN_MODES = new Set(["1", "latest"]);
/** `onePerVin` from a request: "1" | "latest", else null (absent or junk -> no change to any query). */
export function onePerVinModeOf(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return ONE_PER_VIN_MODES.has(s) ? s : null;
}

const EPOCH = "'1970-01-01 00:00:00'";
const NO_PRICE = "999999999";

/**
 * The predicate added to the list query's WHERE (alias `i`): no OTHER store holds a visible row of this VIN that outranks this one.
 * Index-friendly: the inner lookup is a primary-key prefix seek on (vin), so each candidate costs one dive; the list page and the
 * capped count only ever test the rows they walk (a page is 24 rows, a capped count stops at the cap).
 * @param {{ mode: "1"|"latest", retailOnly?: boolean, seenDays?: number|null }} o
 * @returns {{ sql: string, args: any[] }}
 */
export function onePerVinPredicate({ mode, retailOnly = false, seenDays = null }) {
  const visible = ["j.removed_at IS NULL", "j.stale_at IS NULL"];
  const args = [];
  if (retailOnly) visible.push("(j.cond IS NULL OR j.cond <> 'wholesale')");
  if (seenDays) { visible.push("j.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"); args.push(seenDays); }
  const jl = `COALESCE(j.last_seen_at, ${EPOCH})`, il = `COALESCE(i.last_seen_at, ${EPOCH})`;
  const jp = `COALESCE(j.price, ${NO_PRICE})`, ip = `COALESCE(i.price, ${NO_PRICE})`;
  const outranks = mode === "latest"
    ? `${jl} > ${il}`
    : `(${jl} > ${il} OR (${jl} = ${il} AND (${jp} < ${ip} OR (${jp} = ${ip} AND j.dealer_id < i.dealer_id))))`;
  return { sql: `NOT EXISTS (SELECT 1 FROM dealer_inventory j WHERE j.vin = i.vin AND j.dealer_id <> i.dealer_id AND ${visible.join(" AND ")} AND ${outranks})`, args };
}

const ts = (v) => (v == null ? 0 : v instanceof Date ? v.getTime() : Date.parse(String(v).replace(" ", "T")) || 0);
const priceKey = (p) => (p == null || p === "" ? Number.POSITIVE_INFINITY : Number(p));

/**
 * Which rows lose, given every visible live row of some VINs. Same rule as the predicate (mode "1"; mode "latest" keeps ties, so a tie
 * produces no loser). Pure.
 * @param {Array<{ vin: string, dealerId: number, lastSeenAt?: any, price?: any, make?: any, state?: any, model?: any, trim?: any }>} rows
 * @param {{ mode?: "1"|"latest" }} [o]
 * @returns {Array<{ vin: string, dealerId: number, make: any, state: any, model: any, trim: any }>}
 */
export function planVinLosers(rows, { mode = "1" } = {}) {
  const byVin = new Map();
  for (const r of rows) {
    const vin = String(r.vin || "").toUpperCase();
    if (!vin) continue;
    if (!byVin.has(vin)) byVin.set(vin, []);
    byVin.get(vin).push(r);
  }
  const losers = [];
  for (const [vin, list] of byVin) {
    if (list.length < 2) continue;
    const top = Math.max(...list.map((r) => ts(r.lastSeenAt)));
    const latest = list.filter((r) => ts(r.lastSeenAt) === top);
    let keep = latest;
    if (mode !== "latest") {
      keep = [[...latest].sort((a, b) => priceKey(a.price) - priceKey(b.price) || Number(a.dealerId) - Number(b.dealerId))[0]];
    }
    for (const r of list) if (!keep.includes(r)) losers.push({ vin, dealerId: Number(r.dealerId), make: r.make ?? null, state: r.state ?? null, model: r.model ?? null, trim: r.trim ?? null });
  }
  return losers;
}

/** Losers -> the (make, state, model, trim) buckets the facet subtraction reads. `dealerIds` (a Set) limits it to those stores' losers (the contact filter). */
export function loserBuckets(losers, dealerIds = null) {
  const m = new Map();
  for (const l of losers) {
    if (dealerIds && !dealerIds.has(l.dealerId)) continue;
    const k = JSON.stringify([l.make, l.state, l.model, l.trim]);
    const b = m.get(k);
    if (b) b.n++; else m.set(k, { make: l.make, state: l.state, model: l.model, trim: l.trim, n: 1 });
  }
  return [...m.values()];
}
