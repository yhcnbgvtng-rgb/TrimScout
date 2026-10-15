// One in-stock row per VIN: request parsing, the keeper decision and the statements for POST /api/inventory/duplicate-vins — extracted from
// deals_api_server.js (which starts a real server when imported) so it can be unit-tested.
//
// Why (measured on the live table 2026-10-11): 176,027 VINs are in stock under two or more stores (391,783 rows; 215,756 surplus). The crawl
// keeps ONE record per VIN per state shard, so a car listed by several sites (a dealer group pooling its inventory, a used car shown on a
// sister store's site, a neighbouring state's store) is uploaded under whichever store claimed it last that night — and under a second
// store when the same VIN sits in a second state shard or in another box's shard. Nothing ever retires the other store's row:
//   * supersededRetire.js (#449) deliberately keeps every row a run just refreshed ("a VIN uploaded under two stores keeps both"), and
//     protects rows another box refreshed within 48h, so a VIN two shards/boxes keep uploading stays double forever;
//   * the sweep only visits stores that uploaded something, so a store whose cars all moved to a sister site is never swept;
//   * the next night's upload sets removed_at = NULL again on whatever it uploads, so a row retired by hand comes back.
//
// The rule: among a VIN's live nightly rows keep exactly one, chosen only from stored facts so every box and every night picks the same one
// (no ping-pong between boxes):
//   1. a row refreshed within the freshness window (last_seen_at >= foreignBefore) beats one that is not — a car listed only by a store that
//      stopped listing it never outranks a store that still does;
//   2. a row filed under a real store (dealer_id > 0) beats the "no store matched" bucket (0);
//   3. a store whose NAME carries the car's brand beats one that does not ("Freedom Chevrolet Buick GMC" over "ED MORSE NISSAN" for a Silverado; see storeMatchesMake) —
//      only when the row carries both the store name and the make, otherwise this rule ties and the next one decides, exactly as before;
//   4. the incumbent: the earliest first_seen_at (the store that has had the car longest keeps it);
//   5. the lowest dealer_id, so the choice is total.
// Only source = 'nightly' rows take part; rows from any other source are neither keepers nor retired.
// Dates: an unparseable first_seen_at / last_seen_at (MariaDB's 0000-00-00 comes back as an Invalid Date) is treated exactly like NULL, so the order is total and
// never depends on the order the rows arrive in.
// Make: ONE normalized make per VIN (the most common non-blank spelling across its rows, aliases folded: Chevy -> Chevrolet, VW -> Volkswagen, ...) is used for
// every row's brand test, so a row with a blank or odd spelling of the make is not treated differently from its sister rows.
// Optional, OFF by default (blockedRank): a row filed under a store whose site blocked the crawl tonight (crawl_blocked_stores) ranks below a crawlable store's
// row. 'before-brand' puts that between rules 2 and 3, 'after-brand' between rules 3 and 4. The order above is unchanged when the option is off.
// For merged-feed groups with real evidence (stock-number prefix, a one-rooftop re-crawl) use dedupeMergedFeeds.js first; this rule is a stable
// convention, not evidence of where the car physically is.

export const MAX_DUPLICATE_VINS = 500;
/** blockedRank modes (see the header): off is the default and leaves the rule order untouched. */
export const BLOCKED_RANK_MODES = ["off", "before-brand", "after-brand"];

// Dealer-name words that say a store sells a make. A name is matched on whole words (so "Ram" is not "Ramsey", "Ford" is not "Stafford"). A make not listed here
// never matches, so the rule falls through to the incumbent for it. Several makes can match one store ("Chevrolet Buick GMC").
const MAKE_WORDS = {
  acura: ["acura"], "alfa romeo": ["alfa"], audi: ["audi"], bmw: ["bmw"], buick: ["buick"], cadillac: ["cadillac"], chevrolet: ["chevrolet", "chevy"],
  chrysler: ["chrysler", "dodge", "jeep", "ram", "cdjr", "fiat"], dodge: ["chrysler", "dodge", "jeep", "ram", "cdjr", "fiat"], jeep: ["chrysler", "dodge", "jeep", "ram", "cdjr", "fiat"],
  ram: ["chrysler", "dodge", "jeep", "ram", "cdjr", "fiat"], fiat: ["chrysler", "dodge", "jeep", "ram", "cdjr", "fiat"], ford: ["ford"], genesis: ["genesis"], gmc: ["gmc"],
  honda: ["honda"], hyundai: ["hyundai"], infiniti: ["infiniti"], jaguar: ["jaguar"], kia: ["kia"], "land rover": ["land rover", "range rover"], lexus: ["lexus"], lincoln: ["lincoln"],
  mazda: ["mazda"], "mercedes-benz": ["mercedes", "benz"], mini: ["mini"], mitsubishi: ["mitsubishi"], nissan: ["nissan"], polestar: ["polestar"], porsche: ["porsche"],
  subaru: ["subaru"], tesla: ["tesla"], toyota: ["toyota", "scion"], volkswagen: ["volkswagen", "vw"], volvo: ["volvo"],
};
const normName = (v) => String(v || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
// Spellings of a make that feeds really use, folded to the key MAKE_WORDS uses (keys are normName() output).
const MAKE_ALIASES = {
  chevy: "chevrolet", "chevrolet trucks": "chevrolet", "gmc trucks": "gmc", "ram trucks": "ram", "ram truck": "ram",
  mercedes: "mercedes-benz", "mercedes benz": "mercedes-benz", benz: "mercedes-benz", "mercedes benz usa": "mercedes-benz",
  vw: "volkswagen", volks: "volkswagen", landrover: "land rover", "range rover": "land rover", "alfa": "alfa romeo",
  "mini cooper": "mini", infinity: "infiniti", scion: "toyota",
};
/** The normalized make: lower-case, punctuation folded, aliases mapped (Chevy -> chevrolet, Mercedes -> mercedes-benz). '' for a blank make. */
export function canonicalMake(make) {
  const m = normName(make);
  if (!m) return "";
  return MAKE_ALIASES[m] || m;
}
/** True when the dealer's name carries a word for the car's make. False for a missing name or make, an unlisted make, or no match. */
export function storeMatchesMake(dealerName, make) {
  const name = normName(dealerName), m = canonicalMake(make);
  if (!name || !m) return false;
  const words = MAKE_WORDS[m];
  if (!words) return false;
  const padded = ` ${name} `;
  return words.some((w) => padded.includes(` ${w} `));
}
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** A timestamp in ms, or null when missing OR unparseable (an Invalid Date, '0000-00-00 00:00:00'): null sorts like NULL, never as NaN. */
const ts = (v) => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v).replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
};

/**
 * @param {any} body
 * @param {{ toStr: (v: any, n: number) => string | null }} h
 * @returns {{ ok: true, vins: string[], foreignBefore: Date, dryRun: boolean, blockedRank: string|null } | { ok: false, error: string }}
 */
export function parseDuplicateVinRequest(body, { toStr: _toStr } = {}) {
  const foreignBefore = typeof body?.foreignBefore === "string" ? new Date(body.foreignBefore) : null;
  if (!foreignBefore || Number.isNaN(foreignBefore.getTime())) return { ok: false, error: "foreignBefore (ISO) is required" };
  if (!Array.isArray(body.vins) || body.vins.length === 0) return { ok: false, error: "vins must be a non-empty array of VINs" };
  if (body.vins.length > MAX_DUPLICATE_VINS) return { ok: false, error: `vins is limited to ${MAX_DUPLICATE_VINS} per call` };
  const vins = [];
  const seen = new Set();
  for (const raw of body.vins) {
    const vin = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!VIN_RE.test(vin)) return { ok: false, error: "every entry must be a 17-character VIN" };
    if (!seen.has(vin)) { seen.add(vin); vins.push(vin); }
  }
  // blockedRank: null = not asked (the server then falls back to DEDUPE_BLOCKED_RANK, default off).
  let blockedRank = null;
  if (body.blockedRank != null) {
    if (!BLOCKED_RANK_MODES.includes(body.blockedRank)) return { ok: false, error: `blockedRank must be one of ${BLOCKED_RANK_MODES.join(", ")}` };
    blockedRank = body.blockedRank;
  }
  return { ok: true, vins, foreignBefore, dryRun: body.dryRun === true, blockedRank };
}

/**
 * Decide, per VIN, which live nightly row stays. Pure.
 * @param {Array<{ vin: string, dealerId: number, firstSeenAt?: Date|string|null, lastSeenAt?: Date|string|null, source?: string|null, removedAt?: any }>} rows
 * @param {{ foreignBefore: Date|string, blockedRank?: 'off'|'before-brand'|'after-brand', blockedDealerIds?: Iterable<number> }} opts
 * @returns {{ keep: Array<[string, number]>, retire: Array<[string, number]>, vinsWithDuplicates: number }}
 */
export function planVinKeepers(rows, { foreignBefore, blockedRank = "off", blockedDealerIds = [] }) {
  const cutoff = ts(foreignBefore);
  if (cutoff == null) throw new Error("planVinKeepers needs foreignBefore");
  if (!BLOCKED_RANK_MODES.includes(blockedRank)) throw new Error(`blockedRank must be one of ${BLOCKED_RANK_MODES.join(", ")}`);
  const blockedIds = new Set([...blockedDealerIds].map(Number));
  const useBlocked = blockedRank !== "off" && blockedIds.size > 0;
  const byVin = new Map();
  for (const r of rows) {
    if (r.removedAt != null || (r.source != null && r.source !== "nightly")) continue;
    const vin = String(r.vin || "").toUpperCase();
    if (!vin) continue;
    if (!byVin.has(vin)) byVin.set(vin, []);
    byVin.get(vin).push({ vin, dealerId: Number(r.dealerId), first: ts(r.firstSeenAt), last: ts(r.lastSeenAt), name: r.dealerName ?? r.name, make: canonicalMake(r.make) });
  }
  // One make per VIN: the most common non-blank normalized make across its rows (ties: alphabetical, so it never depends on row order).
  const vinMake = (list) => {
    const n = new Map();
    for (const r of list) if (r.make) n.set(r.make, (n.get(r.make) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || "";
  };
  const rank = (a, b) => {
    const fa = a.last != null && a.last >= cutoff ? 1 : 0, fb = b.last != null && b.last >= cutoff ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const sa = a.dealerId > 0 ? 1 : 0, sb = b.dealerId > 0 ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if (useBlocked && blockedRank === "before-brand" && a.blocked !== b.blocked) return a.blocked - b.blocked;
    if (a.brand !== b.brand) return b.brand - a.brand;
    if (useBlocked && blockedRank === "after-brand" && a.blocked !== b.blocked) return a.blocked - b.blocked;
    const ia = a.first ?? Infinity, ib = b.first ?? Infinity;
    if (ia !== ib) return ia - ib;
    return a.dealerId - b.dealerId;
  };
  const keep = [], retire = [];
  let vinsWithDuplicates = 0;
  for (const [vin, list] of [...byVin].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const make = vinMake(list);
    for (const r of list) { r.brand = storeMatchesMake(r.name, make) ? 1 : 0; r.blocked = blockedIds.has(r.dealerId) ? 1 : 0; }
    list.sort(rank);
    keep.push([vin, list[0].dealerId]);
    if (list.length > 1) vinsWithDuplicates++;
    for (const r of list.slice(1)) retire.push([vin, r.dealerId]);
  }
  return { keep, retire, vinsWithDuplicates };
}

/** Live nightly rows of the given VINs (primary-key prefix lookups; the table's PK is (vin, dealer_id)). */
export function buildRowsSelect(vins) {
  return {
    sql: `SELECT vin, dealer_id AS dealerId, dealer_name AS dealerName, make, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, source FROM dealer_inventory WHERE removed_at IS NULL AND source = 'nightly' AND vin IN (${vins.map(() => "?").join(", ")})`,
    args: [...vins],
  };
}

/** The stores flagged as blocking tonight's crawl (blockedStores.js): dealer ids only. Used only when blockedRank is not 'off'. */
export function buildBlockedIdsSelect() {
  return { sql: "SELECT dealer_id AS dealerId FROM crawl_blocked_stores", args: [] };
}

/** Retires the planned (vin, dealer_id) pairs by primary key; re-checks removed_at so a concurrent change is never double-counted. */
export function buildRetireStatement(pairs) {
  const conds = pairs.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
  return { sql: `UPDATE dealer_inventory FORCE INDEX (PRIMARY) SET removed_at = CURRENT_TIMESTAMP WHERE removed_at IS NULL AND source = 'nightly' AND (${conds})`, args: pairs.flat() };
}
