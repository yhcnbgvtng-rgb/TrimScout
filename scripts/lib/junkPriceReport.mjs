// Pure part of the junk-price dry run (scripts/box/2026-10-12-junk-price-dry-run.mjs): runs the crawler's parser price guard over
// stored dealer_inventory rows and tallies what it would reject. No I/O, so it is unit-tested.
import { guardParsedPrice } from "../../scrapers/lightsail-crawler/src/priceGuard.js";

/** @param {Array<Record<string, any>>} rows dealer_inventory rows (price, msrp, old_price, make, model, year, dealer_name, state, vin, ...) */
export function classifyRows(rows) {
  const flagged = [];
  const byReason = {}, byMake = {}, byState = {};
  for (const r of rows) {
    const v = guardParsedPrice({ price: r.price, msrp: r.msrp, prevPrice: r.old_price, make: r.make, model: r.model, year: r.year });
    if (!v.reject) continue;
    flagged.push({ ...r, reason: v.reason, limit: v.limit, ref: v.ref });
    byReason[v.reason] = (byReason[v.reason] || 0) + 1;
    byMake[r.make || "(blank)"] = (byMake[r.make || "(blank)"] || 0) + 1;
    byState[r.state || "(blank)"] = (byState[r.state || "(blank)"] || 0) + 1;
  }
  flagged.sort((a, b) => b.price - a.price);
  return { scanned: rows.length, flagged, byReason, byMake, byState };
}

const has = (s, re) => re.test(String(s || ""));
/** The specific rows reported by hand on 2026-10-12, so the dry run can say whether each one is among the flagged. */
export const NAMED_CASES = [
  { label: "Hyundai of Downtown LA - Palisade", match: (r) => has(r.dealer_name, /downtown (la|los angeles)/i) && has(r.make, /hyundai/i) && has(r.model, /palisade/i) },
  { label: "Hyundai of Downtown LA - IONIQ 9", match: (r) => has(r.dealer_name, /downtown (la|los angeles)/i) && has(r.make, /hyundai/i) && has(r.model, /ioniq\s*9/i) },
  { label: "Ford Bronco Sport, PA (~$3.6M)", match: (r) => r.state === "PA" && has(r.make, /ford/i) && has(r.model, /bronco sport/i) && r.price >= 1_000_000 },
  { label: "Ford Explorer, OH", match: (r) => r.state === "OH" && has(r.make, /ford/i) && has(r.model, /explorer/i) },
  { label: "Prevost (~$3.5M)", match: (r) => has(r.make, /prevost/i) || has(r.model, /prevost/i) },
];

export function namedCaseReport(flagged, scannedRows = []) {
  return NAMED_CASES.map((c) => ({
    label: c.label,
    flagged: flagged.filter(c.match).length,
    // in the scanned set but NOT flagged: the guard would let it through
    missed: scannedRows.filter(c.match).filter((r) => !flagged.some((f) => f.vin === r.vin && f.dealer_id === r.dealer_id)).length,
  }));
}

export function renderReport({ scanned, flagged, byReason, byMake, byState }, named, { inStock = null, minPrice = null, truncated = false } = {}) {
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const lines = [
    `Junk-price dry run (READ ONLY - nothing was changed)`,
    `In-stock priced rows: ${inStock ?? "n/a"} | candidate rows scanned (price > ${minPrice ?? "n/a"} and a possible ratio/ceiling hit): ${scanned}${truncated ? " (TRUNCATED at the row limit - rerun with a higher --limit)" : ""}`,
    `Rows the guard would reject: ${flagged.length}`,
    `  by reason: ${top(byReason, 10)}`,
    `  by make:   ${top(byMake, 15)}`,
    `  by state:  ${top(byState, 15)}`,
    ``,
    `Reported cases:`,
    ...named.map((n) => `  ${n.label}: ${n.flagged} flagged${n.missed ? `, ${n.missed} NOT flagged (guard would let these through)` : ""}`),
    ``,
    `Rows (highest price first):`,
    ...flagged.map((r) => `  ${r.vin}  ${r.year || ""} ${r.make || ""} ${r.model || ""}  ${r.dealer_name} (${r.state || "?"})  price ${r.price}  msrp ${r.msrp ?? "-"}  old ${r.old_price ?? "-"}  -> ${r.reason} (limit ${r.limit})`),
  ];
  return lines.join("\n");
}
