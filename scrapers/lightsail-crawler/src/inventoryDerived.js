// Filters of the buyer /search "More filters" panel that are INFERRED from text rather than read from a column, plus the small cleaners shared by the list
// query (inventoryListQuery.js) and the facet counts (facetCounts.js). There is no fuel or drivetrain column in dealer_inventory: the answer is in the words a
// dealer wrote in trim / engine / model / body_style / transmission, so each filter is a CASE over a regular expression.
//
// ONE source of truth: every pattern is a plain string in PATTERNS. The SQL (MariaDB REGEXP, PCRE, case-insensitive under the table's ci collation) is built from it
// with the backslashes doubled for the SQL string literal, and the JS classifier used by the facet counts and the tests is built from the SAME strings, so a car
// is never counted under one class and filtered under another. No pattern uses a backslash (token edges are written as [^A-Za-z0-9]) so SQL and JS read it alike.
// A car whose text says nothing is in NO class (SQL NULL / JS null): it is never guessed.
//
// Mirror of lib/searchFilters.ts on the web side: the same keys, labels live there.

export const FUEL_KEYS = ["gas", "hybrid", "phev", "electric", "diesel"];
export const DRIVETRAIN_KEYS = ["awd", "rwd", "fwd"];
export const TRANSMISSION_KEYS = ["automatic", "manual", "cvt", "dct", "single"];

/** A word-like token: bounded by a non-alphanumeric character or the string's end. `alts` is a pattern alternation. */
const tok = (alts) => `(^|[^A-Za-z0-9])(${alts})([^A-Za-z0-9]|$)`;

export const PATTERNS = {
  // drivetrain: AWD/4WD is looked for in trim + engine + body style (a trim like "XLT 4x4", an engine line like "3.5L V6 AWD"); RWD/FWD only in trim + engine
  awd: `${tok("AWD|4WD|4x4|4MATIC|quattro|4Motion|SH-AWD|e-4ORCE")}|(^|[^A-Za-z0-9])xDrive|All[- ]Wheel|Four[- ]Wheel|Symmetrical`,
  rwd: `${tok("RWD")}|(^|[^A-Za-z0-9])sDrive|Rear[- ]Wheel`,
  fwd: `${tok("FWD")}|Front[- ]Wheel`,
  // fuel: looked for in trim + engine + model, in this order of precedence (a plug-in hybrid also says "hybrid")
  phev: `${tok("PHEV|Plug-in|Plug in|e-Hybrid|Recharge|Prime|TFSI e|xDrive[0-9]+e")}`,
  hybrid: `${tok("Hybrid|HEV|MHEV|e:HEV|[0-9]{2,3}h")}`,
  electric: `${tok("Electric|EV|kWh|bZ|bZ4X|EV6|EV9|Ioniq 5|Ioniq 6|Ioniq 9|ID.4|ID.Buzz|Mach-E|Lightning|Cybertruck|Taycan|Ariya|Solterra|Lyriq|Optiq|Vistiq|Prologue|Hummer EV|Blazer EV|Equinox EV|Silverado EV|Sierra EV|e-tron|e-tron GT|i4|i5|i7|iX|EQE|EQS|EQB|EQA|Bolt|Bolt EUV|Leaf|R1T|R1S|Cooper SE|Kona Electric|Niro EV")}`,
  diesel: "Diesel|TDI|Duramax|Power Stroke|Powerstroke|Cummins|EcoDiesel|Turbodiesel",
  // transmission class, from the transmission text; checked in this order ("8-Speed Automatic with manual shift" is automatic, not manual)
  cvt: "CVT|Continuously Variable|ECVT",
  dct: "Dual[- ]Clutch|DCT|PDK|S tronic|DSG|DDCT",
  single: "Single[- ]Speed|1-Speed|Direct[- ]Drive|Electric Drive",
  automatic: `Auto|Tiptronic|Steptronic|Geartronic|Shiftronic|${tok("AT|A/T")}`,
  manual: `Manual|Stick|${tok("MT|M/T")}`,
};

const sqlLit = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const re = (key) => `REGEXP ${sqlLit(PATTERNS[key])}`;
const jsRe = Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, new RegExp(v, "i")]));

const DRIVE_AWD_TEXT = "CONCAT_WS(' ', i.trim, i.engine, i.body_style)";
const DRIVE_TEXT = "CONCAT_WS(' ', i.trim, i.engine)";
const FUEL_TEXT = "CONCAT_WS(' ', i.trim, i.engine, i.model)";

/** SQL expressions (alias `i`) that yield the class key, or NULL when the text does not say. */
export const DRIVETRAIN_SQL = `(CASE WHEN ${DRIVE_AWD_TEXT} ${re("awd")} THEN 'awd' WHEN ${DRIVE_TEXT} ${re("rwd")} THEN 'rwd' WHEN ${DRIVE_TEXT} ${re("fwd")} THEN 'fwd' END)`;
export const FUEL_SQL = `(CASE WHEN ${FUEL_TEXT} ${re("phev")} THEN 'phev' WHEN ${FUEL_TEXT} ${re("hybrid")} THEN 'hybrid' WHEN ${FUEL_TEXT} ${re("electric")} THEN 'electric' WHEN i.engine ${re("diesel")} THEN 'diesel' WHEN i.engine IS NOT NULL AND i.engine <> '' THEN 'gas' END)`;
export const TRANSMISSION_SQL = `(CASE WHEN i.transmission ${re("cvt")} THEN 'cvt' WHEN i.transmission ${re("dct")} THEN 'dct' WHEN i.transmission ${re("single")} THEN 'single' WHEN i.transmission ${re("automatic")} THEN 'automatic' WHEN i.transmission ${re("manual")} THEN 'manual' END)`;

const join = (...parts) => parts.filter((x) => x != null && x !== "").join(" ");
/** The same classification in JS, from a row's raw text fields. */
export function classifyDrivetrain({ trim, engine, bodyStyle }) {
  if (jsRe.awd.test(join(trim, engine, bodyStyle))) return "awd";
  const t = join(trim, engine);
  if (jsRe.rwd.test(t)) return "rwd";
  if (jsRe.fwd.test(t)) return "fwd";
  return null;
}
export function classifyFuel({ trim, engine, model }) {
  const t = join(trim, engine, model);
  if (jsRe.phev.test(t)) return "phev";
  if (jsRe.hybrid.test(t)) return "hybrid";
  if (jsRe.electric.test(t)) return "electric";
  if (engine && jsRe.diesel.test(String(engine))) return "diesel";
  if (engine != null && String(engine) !== "") return "gas";
  return null;
}
export function classifyTransmission({ transmission }) {
  const t = transmission == null ? "" : String(transmission);
  for (const k of ["cvt", "dct", "single", "automatic", "manual"]) if (jsRe[k].test(t)) return k;
  return null;
}

// ---- value cleaners (the same rules as lib/searchFilters.ts / lib/buyerSearchQuery.ts) ----
export const MAX_BODY_STYLES = 6;
export const MAX_DEALER_IDS = 10;
const keep = (raw, allowed) => [...new Set(raw)].filter((v) => allowed.includes(v));
export const cleanFuel = (raw) => keep(raw, FUEL_KEYS);
export const cleanDrivetrain = (raw) => keep(raw, DRIVETRAIN_KEYS);
export const cleanTransmission = (raw) => keep(raw, TRANSMISSION_KEYS);
export function cleanBodyStyle(raw) {
  return String(raw).replace(/[^A-Za-z0-9 \-/&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}
export function bodyStylesOf(params) {
  const out = [];
  for (const raw of params.getAll("bodyStyle")) { const v = cleanBodyStyle(raw); if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v); if (out.length >= MAX_BODY_STYLES) break; }
  return out;
}
/** dealerId= params as positive whole numbers, de-duplicated, at most ten. A single junk value yields an empty list (the filter is simply not applied). */
export function dealerIdsOf(params) {
  const out = [];
  for (const raw of params.getAll("dealerId")) { const s = String(raw).trim(); if (/^\d{1,9}$/.test(s) && Number(s) > 0 && !out.includes(Number(s))) out.push(Number(s)); if (out.length >= MAX_DEALER_IDS) break; }
  return out;
}
export const cleanVinPattern = (raw) => String(raw).toUpperCase().replace(/[^A-HJ-NPR-Z0-9*?]/g, "").replace(/\*{2,}/g, "*").slice(0, 17);

/**
 * A VIN pattern as the list query will use it, or null when it must be ignored. Needs three real characters; without a make it also needs a literal start or end
 * of three characters (an index range on vin or on the reversed vin_rev), else it would be a scan of every car. Returns { like, col, args } where `like` is the
 * LIKE pattern and `col` the column it goes against; `rev` patterns are matched against vin_rev.
 */
export function vinPatternPlan(raw, hasMake) {
  const p = cleanVinPattern(raw);
  if (p.replace(/[*?]/g, "").length < 3) return null;
  const toLike = (s) => s.replace(/\*/g, "%").replace(/\?/g, "_");
  const lead = /^[A-HJ-NPR-Z0-9]{3}/.test(p), tail = /[A-HJ-NPR-Z0-9]{3}$/.test(p);
  if (!hasMake && !lead && !tail) return null;
  // A literal start uses the primary key's vin prefix; otherwise a literal end uses the reversed column; otherwise (make set) vin as a residual check.
  if (lead || !tail) return { col: "i.vin", like: toLike(p) };
  return { col: "i.vin_rev", like: toLike([...p].reverse().join("")) };
}
