// Re-clean of STORED option rows (dealer_inventory_options) for the policy makes: one car in, one verdict out. Pure (no DB, no fs), so the plan,
// dry-run, apply and verify phases of scripts/box/2026-10-16-option-reclean.mjs all decide with the same function the unit tests pin.
//
// Policy-covered car (make + model + year in a model policy):
//   - blank trim            -> SKIP (stored rows stay)
//   - trim the policy does not trust -> SKIP (stored rows stay; never a wipe from a trim we cannot read)
//   - otherwise             -> the policy engine's rows for the car's options_json (junk list + policy, exactly what the nightly sync writes)
//   - a stored row that is a PAID entry of the car's own trim (price, package price or per-drivetrain price > 0) is never removed: it is kept in `after`
// Car no policy covers (another model-year of a policy make):
//   - blank trim            -> SKIP
//   - otherwise only the global junk list acts on the stored labels: a row whose label trips a `junk:*` rule goes, a row a rewrite renames
//     (SiriusXM trial -> SiriusXM) is replaced. Nothing is ever added and no label is touched otherwise. Legacy-rule-only drops are counted, not applied.
import { optionRowsForVehicle, modelPoliciesFor, resolvePolicyTrim, resolveAllowlisted } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import { optionRowsFromOptions, normalizeOptionKey } from "../../scrapers/lightsail-crawler/src/inventoryOptionRows.js";

/** DB make spellings of the 15 policy files (BUNDLED_MODEL_POLICY_PATHS). */
export const RECLEAN_MAKES = Object.freeze(["Toyota", "Ford", "Chevrolet", "GMC", "Buick", "Cadillac", "Honda", "Kia", "Hyundai", "Audi", "BMW", "Mercedes-Benz", "Subaru", "Nissan", "Mazda"]);

const parseOptions = (j) => { try { const o = typeof j === "string" ? JSON.parse(j) : j; return Array.isArray(o) ? o : []; } catch { return []; } };
const isPaid = (e) => Boolean(e) && (e.price > 0 || e.packagePrice > 0 || (e.priceByDrivetrain && Object.values(e.priceByDrivetrain).some((v) => v > 0)));

/**
 * @param {{ allow: object }} ctx   allow = buildAllowlist(null, policies); the junk list must already be installed (setJunkRules)
 * @param {{ vin, dealer_id, make, year, model, trim, options_json }} car
 * @param {Array<[string, string, (string|null)]>} stored   [canonical_key, label, code] rows the car holds now
 * @returns {{ status: "skip-blank-trim"|"skip-untrusted-trim"|"unchanged"|"change", covered: boolean, scope?: string, after?: Array, removed?: Array<{key,label,rule}>,
 *            relabeled?: number, added?: number, rewritten?: number, paid?: string[], paidKept?: number, legacyOnly?: number }}
 */
export function recleanCar(ctx, car, stored) {
  const { allow } = ctx;
  const vehicle = { vin: car.vin, make: car.make, model: car.model, year: car.year, trim: car.trim };
  const covered = modelPoliciesFor(allow, vehicle).length > 0;
  if (!String(car.trim ?? "").trim()) return { status: "skip-blank-trim", covered };
  return covered ? recleanCovered(allow, vehicle, car, stored) : recleanUncovered(allow, car, stored);
}

function recleanCovered(allow, vehicle, car, stored) {
  const res = optionRowsForVehicle(allow, vehicle, parseOptions(car.options_json));
  if (!res) return { status: "unchanged", covered: true };
  if (!res.trimTrusted) return { status: "skip-untrusted-trim", covered: true, scope: res.scope };
  const policy = modelPoliciesFor(allow, vehicle).find((p) => resolvePolicyTrim(p, car.trim, car.model)) || modelPoliciesFor(allow, vehicle)[0];
  const ownTrim = resolvePolicyTrim(policy, car.trim, car.model)?.trim || null;
  const after = res.rows.map((r) => [r.key, r.label, r.code ?? null]);
  const afterKeys = new Set(after.map((r) => r[0]));
  const why = new Map(res.dropped.map((d) => [normalizeOptionKey(d.label), d.rule]));
  const paid = [];
  let paidKept = 0;
  const removed = [];
  for (const [key, label, code] of stored) {
    const paidLine = isPaid(ownTrim?.entries?.get(key));
    if (paidLine) paid.push(key);
    if (afterKeys.has(key)) continue;
    if (paidLine) { after.push([key, label, code ?? null]); afterKeys.add(key); paidKept++; continue; } // a paid sticker line stays, whatever the feed says today
    removed.push({ key, label, rule: why.get(key) || "not-in-policy-result" });
  }
  const bm = new Map(stored.map((r) => [r[0], r[1]])), am = new Map(after.map((r) => [r[0], r[1]]));
  let relabeled = 0, added = 0;
  for (const [k, l] of bm) if (am.has(k) && am.get(k) !== l) relabeled++;
  for (const k of am.keys()) if (!bm.has(k)) added++;
  const changed = removed.length || relabeled || added;
  return { status: changed ? "change" : "unchanged", covered: true, scope: res.scope, ownTrimLabel: ownTrim?.label || null, after, removed, relabeled, added, rewritten: 0, paid, paidKept, legacyOnly: 0 };
}

function recleanUncovered(allow, car, stored) {
  const make = car.make;
  const resolveKey = (key) => resolveAllowlisted(allow, make, key);
  const kept = new Map();
  const removed = [], rewrites = [];
  let legacyOnly = 0;
  for (const [key, label, code] of stored) {
    const r = optionRowsFromOptions([{ name: label, code }], { resolveKey });
    const d = r.dropped[0];
    if (!r.rows.length) {
      if (d && String(d.rule).startsWith("junk:")) { removed.push({ key, label, rule: d.rule }); continue; }
      if (d) legacyOnly++; // dropped by a legacy rule only: not this re-clean's business
      kept.set(key, [key, label, code ?? null]);
      continue;
    }
    if (r.rows.length === 1 && r.rows[0].key !== key && r.repaired.length) { rewrites.push({ from: [key, label, code ?? null], to: [r.rows[0].key, r.rows[0].label, code ?? null] }); continue; }
    kept.set(key, [key, label, code ?? null]);
  }
  let rewritten = 0;
  for (const w of rewrites) { // a rewrite replaces the old row; if the new key is already held it just disappears
    removed.push({ key: w.from[0], label: w.from[1], rule: "rewrite" });
    if (!kept.has(w.to[0])) { kept.set(w.to[0], w.to); rewritten++; }
  }
  if (!removed.length) return { status: "unchanged", covered: false, legacyOnly, removed: [], relabeled: 0, added: 0, rewritten: 0, paid: [], paidKept: 0 };
  const after = [...kept.values()];
  const bk = new Set(stored.map((r) => r[0]));
  return { status: "change", covered: false, after, removed, relabeled: 0, added: after.filter((r) => !bk.has(r[0])).length, rewritten, paid: [], paidKept: 0, legacyOnly };
}

/**
 * Where a removed row's key sits in the policies of its make: Map(normalized make -> Map(key -> [{ scope, trim, label, paid }])). Every trim of every policy,
 * aliases included, so a removal can be checked against ALL policy entries (not just the car's own trim).
 */
export function buildPolicyMatchIndex(allow) {
  const out = new Map();
  for (const p of allow.models.values()) {
    const byKey = out.get(p.make) || out.set(p.make, new Map()).get(p.make);
    for (const t of p.trims.values()) for (const [key, e] of t.index) (byKey.get(key) || byKey.set(key, []).get(key)).push({ scope: p.scope, trim: t.label, label: e.label, paid: isPaid(e) });
  }
  return out;
}
