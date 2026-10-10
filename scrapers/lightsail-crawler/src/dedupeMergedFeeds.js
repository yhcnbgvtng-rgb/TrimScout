// Merged-feed dedupe: one VIN belongs to one rooftop. PURE planning (no I/O): given the in-stock rows of a dealer group whose sites
// list the same shared inventory, decide for every VIN held by more than one rooftop which rooftop keeps it and which rows would be retired.
//
// Why a plan and not a rule of thumb: for these groups the rows are identical across rooftops (same stock number, same price — measured
// 2026-10-09: McGovern 390 of 390 shared VINs, Fred Beans 287 of 287), so nothing stored says where the car physically is. The plan therefore
// uses only evidence that exists, in this order, and says which rule decided each VIN — and leaves a VIN UNRESOLVED when none applies and
// the tie policy is "review":
//   fresh   after a re-crawl, a VIN that exactly ONE rooftop's site still lists (its row was seen at/after `runStart`, the others were not)
//           belongs to that rooftop. Needs runStart; with none given this rule is skipped.
//   stock   the stock-number prefix: letters at the front of the stock number that, among the group's VINs held by ONE rooftop only, point
//           to a single rooftop (>= minExamples, >= minPurity). Applied only when the learned rooftop is one of the VIN's holders.
//   hub     tie policy "hub": the group's largest rooftop (most in-stock rows) keeps it. A convention, not evidence — reported separately.
//   (none)  tie policy "review": unresolved, nothing would be retired.
// A row is only ever planned for retirement when the keeper's own row is fresh (>= runStart) if `requireFreshKeeper` is set, so a stale
// duplicate is never retired in favor of an equally stale one.

const prefixOf = (stock) => {
  const m = /^[A-Za-z]{2,}/.exec(String(stock ?? "").trim());
  return m ? m[0].toUpperCase().slice(0, 3) : null;
};
const ts = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(String(v)));

/**
 * @param {Array<{ vin: string, dealerId: number, stockNumber?: string|null, lastSeenAt?: Date|string|null }>} rows  in-stock rows of ONE group
 * @param {{ rooftopIds: number[], tie?: "hub"|"review", runStart?: string|Date|null, requireFreshKeeper?: boolean, minExamples?: number, minPurity?: number }} opts
 */
export function planDedupe(rows, opts) {
  const { rooftopIds, tie = "review", requireFreshKeeper = false, minExamples = 5, minPurity = 0.95 } = opts;
  const runStart = ts(opts.runStart);
  const inGroup = rows.filter((r) => rooftopIds.includes(r.dealerId));
  const byVin = new Map();
  for (const r of inGroup) (byVin.get(r.vin) || byVin.set(r.vin, []).get(r.vin)).push(r);
  const sizes = new Map(rooftopIds.map((id) => [id, 0]));
  for (const r of inGroup) sizes.set(r.dealerId, sizes.get(r.dealerId) + 1);
  const hub = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  // stock-number prefix -> rooftop, learned only from VINs held by one rooftop
  const seen = new Map(); // prefix -> Map(dealerId -> n)
  for (const list of byVin.values()) {
    if (list.length !== 1) continue;
    const p = prefixOf(list[0].stockNumber);
    if (!p) continue;
    const m = seen.get(p) || seen.set(p, new Map()).get(p);
    m.set(list[0].dealerId, (m.get(list[0].dealerId) || 0) + 1);
  }
  const learned = new Map(); // prefix -> dealerId
  for (const [p, m] of seen) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (total >= minExamples && n / total >= minPurity) learned.set(p, top);
  }

  const decisions = [];
  const counts = { vins: byVin.size, heldOnce: 0, shared: 0, fresh: 0, stock: 0, hub: 0, unresolved: 0, rowsToRetire: 0, blockedStaleKeeper: 0 };
  for (const [vin, list] of byVin) {
    if (list.length === 1) { counts.heldOnce++; continue; }
    counts.shared++;
    const holders = list.map((r) => ({ dealerId: r.dealerId, lastSeenAt: r.lastSeenAt ?? null, fresh: runStart != null && (ts(r.lastSeenAt) ?? -1) >= runStart }));
    let keep = null, rule = null, evidence = "";
    const fresh = holders.filter((h) => h.fresh);
    if (runStart != null && fresh.length === 1) { keep = fresh[0].dealerId; rule = "fresh"; evidence = `only ${keep} still lists it after ${new Date(runStart).toISOString()}`; }
    if (keep == null) {
      const p = prefixOf(list[0].stockNumber);
      const owner = p ? learned.get(p) : null;
      if (owner != null && holders.some((h) => h.dealerId === owner)) { keep = owner; rule = "stock"; evidence = `stock prefix ${p} -> ${owner} (${seen.get(p).get(owner)} one-rooftop VINs)`; }
    }
    if (keep == null && tie === "hub" && holders.some((h) => h.dealerId === hub)) { keep = hub; rule = "hub"; evidence = `largest rooftop of the group (${sizes.get(hub)} in-stock rows)`; }
    if (keep == null) { counts.unresolved++; decisions.push({ vin, holders, keep: null, retire: [], rule: "unresolved", evidence: "no evidence and tie policy is review" }); continue; }
    const keeper = holders.find((h) => h.dealerId === keep);
    if (requireFreshKeeper && runStart != null && !keeper.fresh) { counts.blockedStaleKeeper++; counts.unresolved++; decisions.push({ vin, holders, keep, retire: [], rule: "blocked-stale-keeper", evidence: `${rule} chose ${keep} but its row is not fresh` }); continue; }
    counts[rule]++;
    const retire = holders.filter((h) => h.dealerId !== keep).map((h) => h.dealerId);
    counts.rowsToRetire += retire.length;
    decisions.push({ vin, holders, keep, retire, rule, evidence });
  }
  return { hub, sizes: Object.fromEntries(sizes), learnedPrefixes: Object.fromEntries(learned), counts, decisions };
}

/** The groups the dry-run covers. Fred Beans Abington (12240) shares the same feed as Mechanicsburg/Flemington in the data, so it is included. */
export const MERGED_FEED_GROUPS = Object.freeze({
  "mcgovern-hyundai": { label: "McGovern Hyundai (Route 93 / Concord / Route 2 / Milford)", rooftopIds: [11953, 12087, 11952, 11951] },
  "fred-beans-hyundai": { label: "Fred Beans Hyundai (Mechanicsburg / Flemington / Abington)", rooftopIds: [12243, 12094, 12240] },
  "johnson-lexus": { label: "Johnson Lexus (Raleigh / Durham)", rooftopIds: [7513, 7515] },
});
