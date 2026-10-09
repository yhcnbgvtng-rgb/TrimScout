// Per-make allowlist of REAL factory options, and the two places it plugs in: write-time key
// normalization (optionRowsFromOptions) and buyer-catalog gating (buyerOptionCatalog).
//
// Why write time and not just the catalog: /search's optionKeys= filter (inventoryListQuery.js)
// matches dealer_inventory_options.canonical_key exactly. If three dealer spellings of one real
// option ("Sky One-Touch Power Top", "SKY ONE TOUCH POWER TOP", "Sky 1-Touch Pwr Top") were only
// merged in the catalog, a buyer picking the merged entry would match just one spelling's vehicles.
// Mapping every alias to the allowlisted key as rows are written means one key, all the vehicles.
//
// Ships EMPTY. With no allowlist loaded, every function here is a pass-through and behavior is
// exactly what it was before this module existed. Phase B fills it from ground truth: window
// stickers (the sticker pipelines already canonicalize those into lib/factoryOptionCatalog.ts's
// entry shape — see allowlistFromCatalogEntries) and OEM brochures/order guides. Dealer free text
// never adds an entry on its own; it can only be matched TO one.
//
// Shape (JSON-serializable, one object per make, lowercased make name):
//   { "jeep": { "sky one touch power top": { "label": "Sky One-Touch Power Top",
//                                           "aliases": ["sky 1 touch pwr top"] } } }
// Keys and aliases are normalizeOptionKey() output, never raw text.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, optionRowsFromOptions } from "./inventoryOptionRows.js";

export const EMPTY_ALLOWLIST = Object.freeze({ makes: new Map(), models: new Map() });

/** Raw JSON object -> lookup structure (key and alias -> canonical key, per make). */
export function buildAllowlist(raw, modelPolicies = null) {
  const makes = new Map();
  const models = buildModelPolicies(modelPolicies);
  if (!raw || typeof raw !== "object") return { makes, models };
  for (const [makeName, options] of Object.entries(raw)) {
    if (!options || typeof options !== "object") continue;
    const entries = new Map();
    const index = new Map();
    for (const [rawKey, entry] of Object.entries(options)) {
      const key = normalizeOptionKey(rawKey);
      if (!key) continue;
      const label = entry && typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : rawKey;
      entries.set(key, { key, label });
      index.set(key, key);
      for (const alias of (entry && Array.isArray(entry.aliases) ? entry.aliases : [])) {
        const a = normalizeOptionKey(alias);
        // First mapping wins: an alias listed under two options is ambiguous, so it keeps
        // whichever claimed it first rather than flipping between them on reload.
        if (a && !index.has(a)) index.set(a, key);
      }
    }
    if (entries.size) makes.set(String(makeName).trim().toLowerCase(), { entries, index });
  }
  return { makes, models };
}

/**
 * Sticker-pipeline catalog entries (lib/factoryOptionCatalog.ts: { canonicalName, aliases, makes })
 * -> the raw allowlist JSON shape. The bridge from Monroney ground truth to this allowlist.
 */
export function allowlistFromCatalogEntries(entries) {
  const out = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.canonicalName !== "string") continue;
    const key = normalizeOptionKey(e.canonicalName);
    if (!key) continue;
    const aliases = [...new Set((e.aliases || []).map(normalizeOptionKey).filter((a) => a && a !== key))];
    for (const make of e.makes || []) {
      const m = String(make).trim().toLowerCase();
      if (!m) continue;
      out[m] ??= {};
      const prev = out[m][key];
      out[m][key] = { label: prev?.label || e.canonicalName, aliases: [...new Set([...(prev?.aliases || []), ...aliases])] };
    }
  }
  return out;
}

/** Whether this make has any allowlist at all (allowlist mode only gates makes that do). */
export function hasAllowlistFor(allowlist, make) {
  return Boolean(make && allowlist?.makes?.has(String(make).trim().toLowerCase()));
}

/**
 * The allowlisted canonical { key, label } a normalized key resolves to for this make, or null.
 * `null` is honest-empty: not a real factory option we can vouch for, never a guess.
 */
export function resolveAllowlisted(allowlist, make, key) {
  if (!make || !key) return null;
  const m = allowlist?.makes?.get(String(make).trim().toLowerCase());
  if (!m) return null;
  const canonical = m.index.get(key);
  return canonical ? m.entries.get(canonical) : null;
}

/** OPTION_CATALOG_MODE: "heuristic" (default — junk rules + volume floor) or "allowlist". */
export function catalogModeFromEnv(env = process.env) {
  return String(env.OPTION_CATALOG_MODE || "").trim().toLowerCase() === "allowlist" ? "allowlist" : "heuristic";
}

/**
 * Loads OPTION_ALLOWLIST_PATH (a JSON file in the raw shape above) and, separately, OPTION_MODEL_POLICY_PATH (model-scoped
 * policies, below). Unset, missing or unreadable -> nothing loaded plus the reason, so a bad deploy degrades to today's
 * behavior instead of failing the server at boot. The two are independent: the model policy needs no make allowlist.
 */
export function loadAllowlistFromEnv(env = process.env) {
  const makePath = String(env.OPTION_ALLOWLIST_PATH || "").trim();
  const modelPath = String(env.OPTION_MODEL_POLICY_PATH || "").trim();
  if (!makePath && !modelPath) return { allowlist: EMPTY_ALLOWLIST, error: null };
  const errors = [];
  let rawMakes = null, rawModels = null;
  if (makePath) { try { rawMakes = JSON.parse(fs.readFileSync(makePath, "utf8")); } catch (err) { errors.push(`${makePath}: ${err.message}`); } }
  // OPTION_MODEL_POLICY_PATH: one JSON file or several, comma-separated (their policy scopes are merged).
  for (const f of modelPath.split(",").map((x) => x.trim()).filter(Boolean)) {
    try { rawModels = { ...(rawModels || {}), ...JSON.parse(fs.readFileSync(f, "utf8")) }; } catch (err) { errors.push(`${f}: ${err.message}`); }
  }
  return { allowlist: errors.length && !rawMakes && !rawModels ? EMPTY_ALLOWLIST : buildAllowlist(rawMakes, rawModels), error: errors.join("; ") || null };
}

// ---- Model-scoped factory-option policy (first user: 2026 Toyota RAV4) ---------------------------------------------------
// A make-level allowlist can't say "this option is paid on the SE and standard on the Limited", and for a model where we hold the
// manufacturer's per-trim build data that distinction is the whole point. A policy is keyed "make|model|year" and, for a vehicle it
// matches, REPLACES the generic result with exactly:
//   options       paid packages, paid standalone options, paid paints that THIS trim offers (keys/aliases = normalizeOptionKey output)
//   dealerAddons  dealer/port products (the configurator's Accessory list + known dealer products) for quotes, never factory options
// Everything else is dropped: standard or unknown-availability equipment, no-cost paint, interiors, feature lines with no package
// to roll up to. Packages only — a package is never expanded into its features. No trusted trim -> no options (never a guess).
// A vehicle that matches no policy is untouched (policyOptionRows returns null), so other models and other years cost nothing.
// Source of truth: docs/rav4-2026/*.csv -> scripts/build-rav4-option-policy.mjs -> src/optionPolicies/*.json.

export const BUNDLED_MODEL_POLICY_PATHS = Object.freeze([
  fileURLToPath(new URL("./optionPolicies/toyota-rav4-2026.json", import.meta.url)),
  fileURLToPath(new URL("./optionPolicies/toyota-2026-2027.json", import.meta.url)),
]);


/** Raw policies -> lookup. Every entry/alias is re-normalized, so a hand-edited JSON can't break the key contract. */
export function buildModelPolicies(raw) {
  const out = new Map();
  if (!raw || typeof raw !== "object") return out;
  for (const [scope, p] of Object.entries(raw)) {
    const [make, , year] = scope.split("|");
    if (!p || typeof p !== "object" || !year) continue;
    const trims = new Map();
    for (const [tk, t] of Object.entries(p.trims || {})) {
      const entries = new Map(), index = new Map();
      for (const [rawKey, o] of Object.entries(t.options || {})) {
        const key = normalizeOptionKey(rawKey);
        if (!key) continue;
        const entry = { key, label: o.label || rawKey, kind: o.kind || "option", price: Number(o.price) || 0, features: (o.features || []).map((f) => new RegExp(f)) };
        entries.set(key, entry);
        index.set(key, entry);
        for (const a of o.aliases || []) { const ak = normalizeOptionKey(a); if (ak && !index.has(ak)) index.set(ak, entry); }
      }
      trims.set(normalizeOptionKey(tk), { label: t.label || tk, entries, index });
    }
    // Names offered on SOME trim of this model: a hit on a trim that lacks it is "not offered here", not an unknown string.
    const elsewhere = new Set();
    for (const t of trims.values()) for (const k of t.index.keys()) elsewhere.add(k);
    out.set(`${normalizeOptionKey(make)}|${(p.models || []).map(normalizeOptionKey).join(",")}|${year}`, {
      scope, trims, elsewhere,
      models: new Set((p.models || []).map(normalizeOptionKey)), make: normalizeOptionKey(make), year: String(year),
      keepBare: new Set((p.keepBare || []).map(normalizeOptionKey)),
      trimAliases: new Map(Object.entries(p.trimAliases || {}).map(([from, to]) => [normalizeOptionKey(from), normalizeOptionKey(to)]).filter(([from, to]) => from && to)),
      trimNoise: new Set((p.trimNoise || []).map(normalizeOptionKey)),
      // DB model spelling -> a word its trims carry in the CSV ("highlander hybrid" -> "hybrid": the Highlander Hybrid's "XLE" is the CSV's "Hybrid XLE").
      modelImplied: new Map(Object.entries(p.modelImplied || {}).map(([m, w]) => [normalizeOptionKey(m), normalizeOptionKey(w)]).filter(([m, w]) => m && w)),
      trimNoisePhrases: (p.trimNoisePhrases || []).map(normalizeOptionKey).filter(Boolean),
      disclaimerPatterns: (p.disclaimerPatterns || []).map((x) => new RegExp(x, "i")),
      addonKeys: new Set(((p.dealerAddons || {}).keys || []).map(normalizeOptionKey)),
      addonPatterns: ((p.dealerAddons || {}).patterns || []).map((x) => new RegExp(x, "i")),
    });
  }
  return out;
}

/** Every policy whose make/model/year match this vehicle (two CSV models can share one DB model spelling, e.g. "bZ"). */
export function modelPoliciesFor(allowlist, vehicle) {
  if (!vehicle || !allowlist?.models?.size) return [];
  const make = normalizeOptionKey(vehicle.make), model = normalizeOptionKey(vehicle.model), year = String(vehicle.year || "").trim();
  return [...allowlist.models.values()].filter((p) => p.make === make && p.year === year && p.models.has(model));
}

/** The policy for this vehicle, or null (any other make, model or year). */
export function modelPolicyFor(allowlist, vehicle) {
  return modelPoliciesFor(allowlist, vehicle)[0] || null;
}

// "Weather Package $375" / "(CY)" style decoration around a package name.
const decoration = (label) => label.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").replace(/\([^)]*\)/g, " ").replace(/®|™/g, "");

/**
 * The policy trim a vehicle's trim string stands for, or null (untrusted). A string that IS a policy trim (case/spacing-insensitive)
 * is that trim. Otherwise only the policy's own shorthand list applies (trimAliases — for the 2026 RAV4, a bare "XLE" and its
 * shorthand are XLE Premium, since there is no plain XLE), after stripping drivetrain words (AWD, Hybrid...) from the end.
 * Everything else — "Trail", "LE AWD", "XLE Premium Plus" — stays untrusted.
 */
export function resolvePolicyTrim(policy, rawTrim, model = null) {
  let key = normalizeOptionKey(rawTrim);
  if (!key) return null;
  const implied = model ? policy.modelImplied.get(normalizeOptionKey(model)) : null;
  if (implied && !` ${key} `.includes(` ${implied} `)) {
    const withWord = policy.trims.get(`${implied} ${key}`);
    if (withWord) return { trim: withWord, via: "model-implied" };
  }
  const direct = policy.trims.get(key);
  if (direct) return { trim: direct, via: "exact" };
  if (!policy.trimAliases.size && !policy.trimNoise.size) return null;
  // Drivetrain / powertrain words ("AWD", "Hybrid", "Natl", "Front-Wheel Drive"...) are noise. A string is a policy trim T when removing
  // T's own words leaves only noise; the MOST SPECIFIC such T (most words) wins, so "Limited i-FORCE MAX AWD" is "Limited i-FORCE MAX",
  // never the cheaper "Limited" it also contains, and "XLE Hybrid" is "Hybrid XLE" where the CSV lists one. A tie is untrusted.
  const stripNoise = (text) => {
    let rest = ` ${text} `;
    for (const phrase of policy.trimNoisePhrases) rest = rest.split(` ${phrase} `).join("  ");
    return rest.split(" ").filter((t) => t && !policy.trimNoise.has(t));
  };
  let best = null, tie = false;
  const inputTokens = key.split(" ");
  for (const [tk, t] of policy.trims) {
    const left = [...inputTokens];
    let missing = false;
    for (const w of tk.split(" ")) { const at = left.indexOf(w); if (at < 0) { missing = true; break; } left.splice(at, 1); }
    if (missing || stripNoise(left.join(" ")).length) continue;
    const size = tk.split(" ").length;
    if (!best || size > best.size) { best = { trim: t, size }; tie = false; } else if (size === best.size) tie = true;
  }
  if (best && !tie) return { trim: best.trim, via: "exact" };
  if (tie) return null;
  const tokens = stripNoise(key);
  if (!tokens.length) return null;
  const to = policy.trimAliases.get(tokens.join(" "));
  const trim = to ? policy.trims.get(to) : null;
  return trim ? { trim, via: "alias" } : null;
}

/**
 * Classifies one vehicle's raw options under a model policy.
 * -> { rows, dealerAddons, dropped, junkDropped, repaired, trim, trimTrusted, outcomes }
 *    rows          [{ key, label, code, kind, price, via: "kept"|"rolled_up" }] — the factory options, packages only
 *    dealerAddons  [{ key, label }]
 *    dropped       [{ label, rule }] — rule says why (junk rule name, "standard-or-unknown", "not-offered-on-trim", "no-trusted-trim", ...)
 *    outcomes      [{ label, outcome: "kept"|"rolled_up"|"dealer_addon"|"dropped", key?, rule? }] one per raw line, for reporting
 */
export function policyOptionRows(policy, vehicle, options) {
  const base = optionRowsFromOptions(options); // the existing junk/sentence/split rules still run first, unchanged
  const out = { rows: [], dealerAddons: [], dropped: [...base.dropped], junkDropped: base.junkDropped, repaired: base.repaired, outcomes: base.dropped.map((d) => ({ label: d.label, outcome: "dropped", rule: d.rule })) };
  const resolved = resolvePolicyTrim(policy, vehicle.trim, vehicle.model);
  const trim = resolved ? resolved.trim : null;
  out.trim = vehicle.trim || null;
  out.trimTrusted = Boolean(trim);
  out.trimVia = resolved ? resolved.via : null; // "exact" | "alias" (shorthand folded into its policy trim) | null
  const rows = new Map(), addons = new Map();
  const drop = (label, rule) => { out.dropped.push({ label, rule }); out.outcomes.push({ label, outcome: "dropped", rule }); };
  for (const r of base.rows) {
    const label = r.label;
    // Disclaimers about price / what is included ("Does not include optional accessories of $799 Lifetime Oil") are not options or products.
    if (policy.disclaimerPatterns.some((re) => re.test(label.trim()))) { drop(label, "disclaimer"); continue; }
    if (policy.keepBare.has(r.key)) { // rule 7: bare Siri / Google / Unlock / Alexa Built In stay exactly as they are (still needs a trusted trim, rule 6)
      if (!trim) { drop(label, "no-trusted-trim"); continue; }
      if (!rows.has(r.key)) rows.set(r.key, { key: r.key, label, code: r.code, kind: "bare", price: 0, via: "kept" });
      out.outcomes.push({ label, outcome: "kept", key: r.key });
      continue;
    }
    const cleaned = normalizeOptionKey(decoration(label));
    const colonHead = label.includes(":") ? normalizeOptionKey(decoration(label.split(":")[0])) : null;
    if (policy.addonKeys.has(cleaned) || policy.addonPatterns.some((re) => re.test(label) || re.test(cleaned))) { // rule 5
      // "Weather Package" (factory) vs "All-Weather Liner Package" (accessory): an exact factory name wins over a product-word pattern.
      const exact = trim && (trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead)));
      if (!exact) { if (!addons.has(r.key)) addons.set(r.key, { key: r.key, label }); out.outcomes.push({ label, outcome: "dealer_addon", key: r.key }); continue; }
    }
    if (!trim) { drop(label, "no-trusted-trim"); continue; } // rule 6
    const exact = trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead));
    if (exact) { // rule 1: a paid package / option / paint this trim offers, under its canonical key
      if (!rows.has(exact.key)) rows.set(exact.key, { key: exact.key, label: exact.label, code: r.code, kind: exact.kind, price: exact.price, via: "kept" });
      out.outcomes.push({ label, outcome: "kept", key: exact.key });
      continue;
    }
    const rolled = [...trim.entries.values()].find((e) => e.features.some((re) => re.test(cleaned))); // rule 4
    if (rolled) {
      if (!rows.has(rolled.key)) rows.set(rolled.key, { key: rolled.key, label: rolled.label, code: null, kind: rolled.kind, price: rolled.price, via: "rolled_up" });
      out.outcomes.push({ label, outcome: "rolled_up", key: rolled.key });
      continue;
    }
    drop(label, policy.elsewhere.has(cleaned) ? "not-offered-on-trim" : "standard-or-unknown"); // rule 2
  }
  out.rows = [...rows.values()];
  out.dealerAddons = [...addons.values()];
  return out;
}

/** Convenience for the write path and the backfill: null when no policy applies to this vehicle. */
export function optionRowsForVehicle(allowlist, vehicle, options) {
  const policies = modelPoliciesFor(allowlist, vehicle);
  if (!policies.length) return null;
  // Normally one. When two CSV models share a DB model spelling, the policy whose trim list the vehicle's trim resolves in is the one.
  const policy = policies.find((p) => resolvePolicyTrim(p, vehicle.trim, vehicle.model)) || policies[0];
  return policyOptionRows(policy, vehicle, options);
}

/** Reads the bundled policy files (RAV4 2026, then the other Toyota models); OPTION_MODEL_POLICY_PATH may point at any one JSON of the same shape. */
export function loadBundledModelPoliciesRaw() {
  const raw = {};
  for (const f of BUNDLED_MODEL_POLICY_PATHS) Object.assign(raw, JSON.parse(fs.readFileSync(f, "utf8")));
  return raw;
}
