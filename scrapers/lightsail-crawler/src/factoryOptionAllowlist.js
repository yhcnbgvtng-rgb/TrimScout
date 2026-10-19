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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, optionRowsFromOptions, compileJunkRules, setJunkRules } from "./inventoryOptionRows.js";
import { positivePrice } from "./inventoryOptionRows.js";

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

/**
 * What the nightly sync loads: everything loadAllowlistFromEnv loads PLUS every bundled model policy (BUNDLED_MODEL_POLICY_PATHS, the same 16 files the
 * re-clean tool uses), so the sync can never run with fewer makes than the re-clean. A scope listed by OPTION_MODEL_POLICY_PATH wins over the bundled
 * one with the same scope; a bundled file that is missing on this box is skipped and named in `error` (the rest still load). OPTION_BUNDLED_POLICIES=off
 * loads exactly what loadAllowlistFromEnv loads.
 */
export function loadSyncAllowlist(env = process.env) {
  if (String(env.OPTION_BUNDLED_POLICIES || "").toLowerCase() === "off") return loadAllowlistFromEnv(env);
  const makePath = String(env.OPTION_ALLOWLIST_PATH || "").trim();
  const errors = [];
  let rawMakes = null, rawModels = {};
  if (makePath) { try { rawMakes = JSON.parse(fs.readFileSync(makePath, "utf8")); } catch (err) { errors.push(`${makePath}: ${err.message}`); } }
  const bundled = {};
  for (const f of BUNDLED_MODEL_POLICY_PATHS) {
    try { Object.assign(bundled, JSON.parse(fs.readFileSync(f, "utf8"))); } catch (err) { errors.push(`${path.basename(f)}: ${err.code === "ENOENT" ? "not installed on this box" : err.message}`); }
  }
  for (const f of String(env.OPTION_MODEL_POLICY_PATH || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    try { rawModels = { ...rawModels, ...JSON.parse(fs.readFileSync(f, "utf8")) }; } catch (err) { errors.push(`${f}: ${err.message}`); }
  }
  const models = { ...bundled, ...rawModels };
  return { allowlist: Object.keys(models).length || rawMakes ? buildAllowlist(rawMakes, Object.keys(models).length ? models : null) : EMPTY_ALLOWLIST, error: errors.join("; ") || null };
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

// (path.join, not new URL(): the website bundles this module for the Ford must-have list, and webpack rewrites new URL(.., import.meta.url) into an asset URL.)
const optionPolicyPath = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), "optionPolicies", name);
export const BUNDLED_MODEL_POLICY_PATHS = Object.freeze([
  optionPolicyPath("toyota-rav4-2026.json"),
  optionPolicyPath("toyota-2026-2027.json"),
  optionPolicyPath("ford-2026.json"),
  optionPolicyPath("chevrolet-2026-2027.json"),
  optionPolicyPath("gmc-2026-2027.json"),
  optionPolicyPath("buick-2026-2027.json"),
  optionPolicyPath("cadillac-2026-2027.json"),
  optionPolicyPath("honda-2026-2027.json"),
  optionPolicyPath("kia-2026-2027.json"),
  optionPolicyPath("hyundai-2025-2027.json"),
  optionPolicyPath("audi-2026-2027.json"),
  optionPolicyPath("bmw-2026-2027.json"),
  optionPolicyPath("mercedes-2026-2027.json"),
  optionPolicyPath("subaru-2026-2027.json"),
  optionPolicyPath("nissan-2026-2027.json"),
  optionPolicyPath("mazda-2026-2027.json"),
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
        const entry = { key, label: o.label || rawKey, kind: o.kind || "option", price: Number(o.price) || 0, code: o.code || null, priceByDrivetrain: o.priceByDrivetrain && typeof o.priceByDrivetrain === "object" ? o.priceByDrivetrain : null, rules: Array.isArray(o.rules) ? o.rules : [], features: (o.features || []).map((f) => new RegExp(f)) };
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
      // Exact (DB model, DB trim) -> policy trim pairs, for makes whose feed puts trim words in the model ("GLE 350" + "4MATIC" = "GLE 350 4MATIC SUV"). Keys are "model|trim".
      modelTrimAliases: new Map(Object.entries(p.modelTrimAliases || {}).map(([k, to]) => { const [m, t] = k.split("|"); return [`${normalizeOptionKey(m)}|${normalizeOptionKey(t)}`, normalizeOptionKey(to)]; }).filter(([k, to]) => k.length > 1 && to)),
      trimNoise: new Set((p.trimNoise || []).map(normalizeOptionKey)),
      // Ford: a trailing order code on the trim string ("XLT 302A", "Big Bend 222A") is not part of the trim. See stripOrderCode.
      stripOrderCodes: Boolean(p.trimStripOrderCodes),
      // A feed option's own order code that may be a policy key: Ford "301A" (default), GM RPO "Z07" / "WN5" (policy sets orderCodePattern).
      orderCode: new RegExp(p.orderCodePattern || "^[0-9]{3}[A-Za-z]$"),
      // DB model spelling -> a word its trims carry in the CSV ("highlander hybrid" -> "hybrid": the Highlander Hybrid's "XLE" is the CSV's "Hybrid XLE").
      modelImpliedFallback: new Set((p.modelImpliedFallbackTrims || []).map(normalizeOptionKey)),
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

// A feed option's own order code (Ford "301A", "202A"; GM RPO "Z07", "WN5") when it IS a policy entry's key: Ford packages and GM RPO options are keyed
// on their code. Codes a feed invents for itself ("PKG-73", "OPT-66") are not policy keys and never match.
const byOrderCode = (policy, trim, code) => (code && policy.orderCode.test(String(code).trim()) ? trim.index.get(normalizeOptionKey(code)) || null : null);

// A package priced per drivetrain (Kia EV3 Wind Nightfall: FWD $1,500, AWD $1,000) is ONE entry. The vehicle's drivetrain (its own field, else a word in its trim)
// picks the price; FWD/RWD/2WD share the "fwd" price. Unknown drivetrain -> the entry's price (the FWD/default build).
const dtGroup = (text) => { const k = ` ${normalizeOptionKey(text)} `; return /\s(awd|4wd|4x4)\s/.test(k) ? "awd" : /\s(fwd|rwd|2wd|4x2)\s/.test(k) ? "fwd" : null; };
const priceFor = (e, vehicle) => {
  if (!e.priceByDrivetrain) return e.price;
  const g = dtGroup(vehicle.drivetrain || "") || dtGroup(vehicle.trim || "");
  const p = g ? (e.priceByDrivetrain[g] ?? (g === "fwd" ? e.priceByDrivetrain.rwd ?? e.priceByDrivetrain["2wd"] : e.priceByDrivetrain["4wd"])) : null;
  return Number.isFinite(p) ? p : e.price;
};

// "Weather Package $375" / "(CY)" style decoration around a package name.
const decoration = (label) => label.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").replace(/\([^)]*\)/g, " ").replace(/®|™/g, "");

/**
 * The policy trim a vehicle's trim string stands for, or null (untrusted). A string that IS a policy trim (case/spacing-insensitive)
 * is that trim. Otherwise only the policy's own shorthand list applies (trimAliases — for the 2026 RAV4, a bare "XLE" and its
 * shorthand are XLE Premium, since there is no plain XLE), after stripping drivetrain words (AWD, Hybrid...) from the end.
 * Everything else — "Trail", "LE AWD", "XLE Premium Plus" — stays untrusted.
 */
// A Ford order code is three digits and a letter ("302a" after normalization). Stripped only when it is NOT the first word: a trim is never just a code.
const stripOrderCode = (key) => key.split(" ").filter((t, i) => !(i >= 1 && /^[0-9]{3}[a-z]$/.test(t))).join(" ");

export function resolvePolicyTrim(policy, rawTrim, model = null) {
  const key = policy.stripOrderCodes ? stripOrderCode(normalizeOptionKey(rawTrim)) : normalizeOptionKey(rawTrim);
  if (!key) return null;
  const hit = resolveTrimKey(policy, key, model);
  if (hit) return hit;
  // An approved exact pair for this DB model + trim string (after every other rule has failed, so a trim that already resolves is never re-pointed).
  const pair = model && policy.modelTrimAliases.size ? policy.trims.get(policy.modelTrimAliases.get(`${normalizeOptionKey(model)}|${key}`) || "") : null;
  if (pair) return { trim: pair, via: "alias" };
  // A dealer who writes the model into the trim ("Tacoma TRD Off Road", "Tundra Platinum"): drop that leading model name and resolve the rest the
  // same way. Tried only after the whole string failed, so a trim that really starts with the model's name ("GR Corolla Premium Plus") is untouched.
  for (const m of [...policy.models].sort((a, b) => b.length - a.length)) {
    if (key.startsWith(`${m} `)) { const rest = resolveTrimKey(policy, key.slice(m.length + 1), model); if (rest) return rest.via === "model-implied" ? rest : { ...rest, via: "model-prefix-stripped" }; }
  }
  return null;
}

function resolveTrimKey(policy, key, model) {
  // A DB model that carries a trim word ("Highlander Hybrid" + "XLE" = the CSV's "Hybrid XLE"; "Tundra i-FORCE MAX" + "Limited" = "Limited i-FORCE MAX")
  // may only resolve to the CSV trim that has that word (before or after the trim). No such trim -> untrusted; the plain trim is NOT assumed.
  const implied = model ? policy.modelImplied.get(normalizeOptionKey(model)) : null;
  if (implied && !` ${key} `.includes(` ${implied} `)) {
    const withWord = policy.trims.get(`${implied} ${key}`) || policy.trims.get(`${key} ${implied}`);
    if (withWord) return { trim: withWord, via: "model-implied" };
    // TRD Pro / Trailhunter: the CSV has only the plain name for the hybrid trim, so an i-FORCE MAX/Hybrid model falls back to it (listed in the report).
    const plain = policy.modelImpliedFallback.has(key) ? policy.trims.get(key) : null;
    return plain ? { trim: plain, via: "model-implied-fallback" } : null;
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
  const resolved = resolvePolicyTrim(policy, vehicle.trim, vehicle.model);
  const trim = resolved ? resolved.trim : null;
  // The existing junk/sentence/split rules still run first, unchanged. The global junk list (optionJunkRules.json) runs with them, but never
  // on a line this trim's policy vouches for (an exact entry by name or order code): a paid sticker line is never removed by it.
  const vouched = (label, o) => {
    if (!trim) return false;
    const cleaned = normalizeOptionKey(decoration(label));
    const colonHead = label.includes(":") ? normalizeOptionKey(decoration(label.split(":")[0])) : null;
    return Boolean(trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead)) || byOrderCode(policy, trim, o && o.code));
  };
  const base = optionRowsFromOptions(options, { protect: vouched });
  const out = { rows: [], dealerAddons: [], dropped: [...base.dropped], junkDropped: base.junkDropped, repaired: base.repaired, outcomes: base.dropped.map((d) => ({ label: d.label, outcome: "dropped", rule: d.rule })) };
  out.trim = vehicle.trim || null;
  out.scope = policy.scope; // which make|model|year policy decided this vehicle
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
      const exact = trim && (trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead)) || byOrderCode(policy, trim, r.code));
      if (!exact) { if (!addons.has(r.key)) addons.set(r.key, { key: r.key, label }); out.outcomes.push({ label, outcome: "dealer_addon", key: r.key }); continue; }
    }
    if (!trim) { drop(label, "no-trusted-trim"); continue; } // rule 6
    const exact = trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead)) || byOrderCode(policy, trim, r.code);
    if (exact) { // rule 1: a paid package / option / paint this trim offers, under its canonical key
      if (!rows.has(exact.key)) rows.set(exact.key, { key: exact.key, label: exact.label, code: r.code, kind: exact.kind, price: priceFor(exact, vehicle), via: "kept" });
      out.outcomes.push({ label, outcome: "kept", key: exact.key });
      continue;
    }
    const rolled = [...trim.entries.values()].find((e) => e.features.some((re) => re.test(cleaned))); // rule 4
    if (rolled) {
      if (!rows.has(rolled.key)) rows.set(rolled.key, { key: rolled.key, label: rolled.label, code: null, kind: rolled.kind, price: priceFor(rolled, vehicle), via: "rolled_up" });
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

/**
 * The facet rows the nightly sync writes for a vehicle under a model policy, or null when no policy covers it (the caller then uses the
 * generic rules, unchanged). The sync COALESCEs trim, so a payload with a blank trim says nothing about the stored trim: for a policy-covered
 * vehicle that is { skip: true } (leave the stored rows alone) rather than "no trusted trim -> wipe". So is a non-blank trim the policy does not
 * trust (2026-10-13 ruling; the policy's rule 6 "no trusted trim -> no options" still decides what the LIST shows, it just no longer deletes stored rows).
 * -> null | { skip: true } | { rows: [{ key, label, code }], junkDropped }
 */
export function policyFacetRows(allowlist, vehicle, options, { withPrice = false } = {}) {
  if (!modelPoliciesFor(allowlist, vehicle).length) return null;
  if (!String(vehicle.trim ?? "").trim()) return { skip: true };
  const res = optionRowsForVehicle(allowlist, vehicle, Array.isArray(options) ? options : []);
  if (!res) return null;
  // A trim the policy does not trust is "we cannot read this car", not "this car has no options": leave its stored rows alone (same as a blank trim).
  // Ruling 2026-10-13: the nightly sync never empties a car because of a trim string we don't recognise.
  if (!res.trimTrusted) return { skip: true };
  return { rows: res.rows.map((r) => (withPrice ? { key: r.key, label: r.label, code: r.code ?? null, price: positivePrice(r.price) } : { key: r.key, label: r.label, code: r.code ?? null })), junkDropped: res.junkDropped };
}

/**
 * The per-vehicle options list /api/inventory returns, under a model policy: exactly the options the facet table holds for that vehicle
 * (same engine, same input), as { code, name, price, kind } like the feed's own entries. A vehicle no policy covers, or one with no option
 * list, gets its list back untouched (same array), so makes without a policy are byte-for-byte what they were.
 */
export function policyApiOptions(allowlist, vehicle, options) {
  if (!Array.isArray(options) || !options.length) return options;
  const res = optionRowsForVehicle(allowlist, vehicle, options);
  if (!res) return options;
  return res.rows.map((r) => ({ code: r.code ?? null, name: r.label, price: r.price ?? 0, kind: r.kind }));
}

const DEFAULT_JUNK_RULES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "optionJunkRules.json");

/**
 * The global junk list (optionJunkRules.json, or OPTION_JUNK_RULES_PATH), compiled; null when OPTION_JUNK_RULES=off, the file is missing or
 * unreadable (logged, never thrown: a bad file must not stop deals-api booting). Patterns that do not compile are skipped and logged.
 */
export function loadJunkRulesFromEnv(env = process.env, log = console) {
  if (String(env.OPTION_JUNK_RULES || "").toLowerCase() === "off") return null;
  const file = env.OPTION_JUNK_RULES_PATH || DEFAULT_JUNK_RULES_PATH;
  try {
    const compiled = compileJunkRules(JSON.parse(fs.readFileSync(file, "utf8")));
    for (const e of compiled.errors) log.warn?.(`[options] junk pattern skipped: ${e}`);
    return compiled;
  } catch (e) {
    log.warn?.(`[options] junk rules not loaded (${file}): ${e.message}`);
    return null;
  }
}

/** Installs the list for this process (the write path, the policy engine and the backfills all read it). Returns what was installed. */
export function installJunkRulesFromEnv(env = process.env, log = console) {
  const compiled = loadJunkRulesFromEnv(env, log);
  setJunkRules(compiled);
  return compiled;
}

/** Reads the bundled policy files (RAV4 2026, then the other Toyota models); OPTION_MODEL_POLICY_PATH may point at any one JSON of the same shape. */
export function loadBundledModelPoliciesRaw() {
  const raw = {};
  for (const f of BUNDLED_MODEL_POLICY_PATHS) Object.assign(raw, JSON.parse(fs.readFileSync(f, "utf8")));
  return raw;
}
