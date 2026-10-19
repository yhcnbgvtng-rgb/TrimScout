// What the nightly sync (POST /api/inventory/bulk) writes for a car's options, decided in one pure place so the re-clean tool and the sync agree.
// Pure (no DB, no fs). deals_api_server.js's handleInventoryBulk calls cleanOptionsForWrite once per car; the same decision feeds options_json and
// (through the existing policy/junk paths) the stored rows in dealer_inventory_options.
//
// Per car:
//   policy-covered, trusted trim  -> the model policy's result (junk list + policy, exactly what the re-clean tool computes) for BOTH the rows and options_json.
//   policy-covered, blank or untrusted trim -> the policy cannot read the car: its stored rows are left alone (2026-10-13 ruling) EXCEPT lines that are exact
//                                    junk labels (OPTION PACKAGES, Creators, Artists, Exp, Title, bare dates ...), which are dropped from options_json here and
//                                    purged from the stored rows by the caller (staleExactJunkKeys). Nothing else is touched.
//   no policy covers the car      -> rows as before (optionRowsFromOptions: legacy rules + junk list); options_json loses the lines the junk list drops.
// A paid sticker line is never dropped: a line carrying a price is not "junk" for the exact-junk filter, a policy entry is vouched for against the junk
// list (policyOptionRows' `protect`), and keepPaidStoredRows keeps a stored paid line of the car's own trim that tonight's payload no longer lists.
import { getJunkRules, optionRowsFromOptions } from "./inventoryOptionRows.js";
import { modelPoliciesFor, optionRowsForVehicle, resolvePolicyTrim, resolveAllowlisted } from "./factoryOptionAllowlist.js";

/** The junk list's rule name for these labels (optionJunkRules.json). */
export const EXACT_JUNK_RULE = "exact-junk-labels";

// Same patterns as the rule in optionJunkRules.json, kept here so the sync still drops them when the list is off, missing or an older file (a test pins the two).
const EXACT_JUNK_BUILTIN = [
  /^\W*(?:exp|see\s+onstar|com\s+or\s+dealer\s+for\s+details|title|creators|artists|option\s+packages)\W*$/i,
  /^\W*\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\W*$/i,
];

const priced = (n) => typeof n === "number" ? n > 0 : (typeof n === "string" && /^\$?0*[1-9]/.test(n.trim()));
/** A line that carries a price (price, packagePrice or a per-drivetrain price > 0) is a paid sticker line, never junk. */
export const isPaidOption = (o) => Boolean(o) && (priced(o.price) || priced(o.packagePrice) || (o.priceByDrivetrain && typeof o.priceByDrivetrain === "object" && Object.values(o.priceByDrivetrain).some(priced)));

/** True when the whole label is one of the exact junk labels (leading/trailing punctuation ignored, case-insensitive). */
export function isExactJunkLabel(label, rules = getJunkRules()) {
  const text = String(label ?? "").trim();
  if (!text) return false;
  if (EXACT_JUNK_BUILTIN.some((re) => re.test(text))) return true;
  const stripped = text.replace(/^[^a-z0-9]+/i, "");
  const rule = rules?.rules?.find((r) => r.name === EXACT_JUNK_RULE);
  return Boolean(rule && rule.res.some((re) => re.test(stripped)));
}

/** options without the exact-junk lines (a priced line stays). Same array back when nothing was dropped. */
export function stripExactJunk(options) {
  if (!Array.isArray(options)) return { options, dropped: 0 };
  const kept = options.filter((o) => !(o && typeof o.name === "string" && isExactJunkLabel(o.name) && !isPaidOption(o)));
  return kept.length === options.length ? { options, dropped: 0 } : { options: kept, dropped: options.length - kept.length };
}

/** For an uncovered car: options_json without the lines the junk list drops (the same decision the stored rows get; legacy-rule drops stay, as in the re-clean). */
function stripJunkLines(options, resolveKey) {
  const kept = [];
  for (const o of options) {
    if (!o || typeof o.name !== "string") { kept.push(o); continue; }
    if (isExactJunkLabel(o.name) && !isPaidOption(o)) continue;
    const r = optionRowsFromOptions([o], { resolveKey });
    if (!r.rows.length && r.dropped.some((d) => String(d.rule).startsWith("junk:"))) continue;
    kept.push(o);
  }
  return kept.length === options.length ? options : kept;
}

/**
 * @param {object} allow     the allowlist the server loaded (buildAllowlist)
 * @param {{make, model, year, trim}} vehicle  make as normalizeMakeForWrite gives it
 * @param {unknown} options  the payload's option list
 * @param {{ jsonMode?: "full"|"junk"|"off" }} [opts]  full (default): options_json carries the policy result for a trusted covered car; junk: only junk lines are removed;
 *                           off: options_json is the payload as sent (rows are cleaned either way).
 * @returns {{ covered: boolean, trusted: boolean, optionsJson: unknown, exactJunkDropped: number }}
 *   optionsJson is what goes into dealer_inventory_options.options_json (the payload's own value when it is not an array).
 */
export function cleanOptionsForWrite(allow, vehicle, options, opts = {}) {
  const mode = opts.jsonMode === "junk" || opts.jsonMode === "off" ? opts.jsonMode : "full";
  if (!Array.isArray(options)) return { covered: false, trusted: false, optionsJson: options, exactJunkDropped: 0 };
  const covered = modelPoliciesFor(allow, vehicle).length > 0;
  const blankTrim = !String(vehicle.trim ?? "").trim();
  if (covered && !blankTrim) {
    const res = optionRowsForVehicle(allow, vehicle, options);
    if (res && res.trimTrusted) {
      if (mode === "off") return { covered: true, trusted: true, optionsJson: options, exactJunkDropped: 0 };
      if (mode === "full") return { covered: true, trusted: true, optionsJson: res.rows.map((r) => ({ code: r.code ?? null, name: r.label, price: r.price ?? 0, kind: r.kind })), exactJunkDropped: 0 };
      return { covered: true, trusted: true, optionsJson: stripJunkLines(options, null), exactJunkDropped: 0 };
    }
  }
  if (covered) { // blank or untrusted trim: the policy cannot decide, so only the exact-junk lines go
    const s = stripExactJunk(options);
    return { covered: true, trusted: false, optionsJson: mode === "off" ? options : s.options, exactJunkDropped: s.dropped };
  }
  if (mode === "off") return { covered: false, trusted: false, optionsJson: options, exactJunkDropped: 0 };
  const resolveKey = (key) => resolveAllowlisted(allow, vehicle.make, key);
  const out = stripJunkLines(options, resolveKey);
  return { covered: false, trusted: false, optionsJson: out, exactJunkDropped: options.length - out.length };
}

/**
 * Stored rows of a car the policy cannot read (blank or untrusted trim) that are exact junk: the keys the caller deletes. [{key,label}] from the
 * rows the car holds now. Rows of other labels are never listed.
 */
export function staleExactJunkKeys(storedRows) {
  return (storedRows || []).filter((r) => isExactJunkLabel(r.label)).map((r) => ({ key: r.key, label: r.label }));
}

/**
 * A covered car with a trusted trim: the stored paid line of its own trim that tonight's rows no longer hold stays (the re-clean's rule: a paid sticker
 * line stays whatever the feed says today). Returns desiredRows plus those lines; the same array back when there is nothing to add.
 * @param {{key,label,code}[]} desiredRows  @param {{key,label,code}[]} storedRows
 */
export function keepPaidStoredRows(allow, vehicle, desiredRows, storedRows) {
  if (!storedRows?.length) return desiredRows;
  const policies = modelPoliciesFor(allow, vehicle);
  if (!policies.length) return desiredRows;
  const policy = policies.find((p) => resolvePolicyTrim(p, vehicle.trim, vehicle.model)) || policies[0];
  const own = resolvePolicyTrim(policy, vehicle.trim, vehicle.model)?.trim;
  if (!own) return desiredRows;
  const have = new Set(desiredRows.map((r) => r.key));
  const extra = [];
  for (const s of storedRows) {
    const entry = own.index.get(s.key);
    if (!entry || !(priced(entry.price) || priced(entry.packagePrice) || (entry.priceByDrivetrain && Object.values(entry.priceByDrivetrain).some(priced)))) continue;
    if (have.has(s.key) || (entry.key !== s.key && have.has(entry.key))) continue; // already there, or the engine re-keyed it
    have.add(s.key);
    extra.push({ key: s.key, label: s.label, code: s.code ?? null });
  }
  return extra.length ? [...desiredRows, ...extra] : desiredRows;
}
