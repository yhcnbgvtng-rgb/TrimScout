// Builds the 2026-27 Cadillac (10 models), Honda (14) and Kia (19) option policies from docs/cadillac-honda-kia-2026-2027/<brand>_lineup_options_by_trim.csv:
//   scrapers/lightsail-crawler/src/optionPolicies/{cadillac,honda,kia}-2026-2027.json   the policies (one per model + year)
//   docs/cadillac-honda-kia-2026-2027/POLICY_REPORT_{cadillac,honda,kia}.md             what was kept, dropped and stored as rules, and why
// Run: node scripts/build-cadillac-honda-kia-option-policy.mjs [--check]   (--check exits 1 when any file differs from what this would write)
//
// Same engine as the Toyota / Ford / GM policies, with Paul's rule for these three makes: EVERY paid factory line on the window sticker stays, including paid
// interior colors and materials (the CSV's "Factory option / Interior" rows).
//   kept       "Factory package" and "Factory option" rows (any subcategory) with price > 0, "Exterior color" rows (incl. roof colors) with price > 0, and "Powertrain"
//              rows (drivetrain / engine / transmission upgrades) with price > 0 - each tied to make + model + year + TRIM and priced per trim.
//   Kia        a FWD/AWD package pair is ONE row in the CSV ("price by drivetrain: FWD $1,500; AWD $1,000"): kept as one entry with priceByDrivetrain; price is the FWD price.
//   key        the CSV's explicit code when it has one (key=XYZ), otherwise the full normalized name ("key=name:..." means name).
//   rules      "requires ...", "not available with ...", "only with ...", "deletes ..." notes are stored under the option (with the option keys they name), never as options.
//   not options  Base, price <= 0 / blank, standard / Included, subscriptions, accessories, $0 items, features inside a package.
//   no trusted trim -> no options (enforced at match time in factoryOptionAllowlist.js). Makes and model years without a policy are untouched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, parseCsv, DISCLAIMER_PATTERNS } from "./lib/optionPolicyCommon.mjs";
import { ALIASES, BRAND_NOISE } from "./lib/optionPolicyAliases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRANDS = ["cadillac", "honda", "kia", "hyundai", "audi", "bmw", "mercedes"];
// Hyundai (2025-27: Kona Electric and Ioniq 6 are 2025 rows in the CSV) lives in its own docs dir and policy file; the other three share the original ones.
const DOCS_DIR = { hyundai: "hyundai-2025-2027", audi: "option-catalogs-2026-10-12", bmw: "option-catalogs-2026-10-12", mercedes: "option-catalogs-2026-10-12" };
const YEARS = { hyundai: "2025-2027" };
const docsDir = (b) => DOCS_DIR[b] || "cadillac-honda-kia-2026-2027";
const csvPath = (b) => path.join(root, `docs/${docsDir(b)}/${b}_lineup_options_by_trim.csv`);
const outPath = (b) => path.join(root, `scrapers/lightsail-crawler/src/optionPolicies/${b}-${YEARS[b] || "2026-2027"}.json`);
const reportPath = (b) => path.join(root, `docs/${docsDir(b)}/POLICY_REPORT_${b}.md`);

// CSV model -> extra DB `model` spellings it covers (normalizeOptionKey form; the CSV spelling itself is always included). None approved yet.
// EXPECTED_MODELS is the contract with Paul's brief: a CSV with a model not listed here fails the build instead of silently growing the policy.
const EXPECTED_MODELS = {
  cadillac: ["CT5", "CT5-V", "Escalade", "Escalade ESV", "Escalade IQ", "Escalade IQL", "Lyriq", "Optiq", "Vistiq", "XT5"],
  honda: ["Accord", "CR-V", "CR-V e:FCEV", "Civic Hatchback", "Civic Sedan", "Civic Si Sedan", "Civic Type R", "HR-V", "Odyssey", "Passport", "Pilot", "Prologue", "Prelude", "Ridgeline"],
  kia: ["Carnival MPV", "Carnival MPV Hybrid", "EV3", "EV6", "EV9", "K4", "K4 Hatchback", "K5", "Niro", "Niro EV", "Seltos", "Sorento", "Sorento Hybrid", "Sorento Plug-in Hybrid", "Sportage", "Sportage Hybrid", "Sportage Plug-in Hybrid", "Telluride", "Telluride Hybrid"],
  audi: ["A3", "A5 Sedan", "A6 Sedan", "A6 Sportback e-tron", "A8 Sedan", "Q3", "Q4 Sportback e-tron", "Q4 e-tron", "Q5", "Q5 Sportback", "Q6 Sportback e-tron", "Q6 e-tron", "Q7", "Q8", "Q9", "RS 3 Sedan", "RS 6 Avant", "RS 7", "RS Q8", "RS e-tron GT", "S e-tron GT", "S3", "S5 Sedan", "S6 Sportback e-tron", "S8 Sedan", "SQ5", "SQ5 Sportback", "SQ6 Sportback e-tron", "SQ6 e-tron", "SQ7", "SQ8", "SQ9"],
  bmw: ["2 Series Coupe", "2 Series Gran Coupe", "3 Series Sedan", "4 Series Convertible", "4 Series Coupe", "4 Series Gran Coupe", "5 Series Sedan", "7 Series Sedan", "M2 Coupe", "M3 Sedan", "M4 Convertible", "M4 Coupe", "M5 Sedan", "M5 Touring", "X1", "X2", "X3", "X5", "X6", "X7", "XM", "i3 Sedan", "i5 Sedan", "i7 Sedan", "iX3"],
  mercedes: ["C-Class Sedan", "CLA Sedan", "CLE Cabriolet", "CLE Coupe", "E-Class Sedan", "E-Class Wagon", "EQE SUV", "EQS SUV", "EQS Sedan", "G-Class SUV", "GLA SUV", "GLB SUV", "GLC Coupe", "GLC Electric SUV", "GLC SUV", "GLE Coupe", "GLE SUV", "GLS SUV", "Mercedes-AMG GT 2-door Coupe", "Mercedes-AMG GT 4-door Coupe", "Mercedes-Maybach GLS SUV", "Mercedes-Maybach S-Class Sedan", "Mercedes-Maybach SL Roadster", "S-Class Sedan", "SL Roadster"],
  hyundai: ["Elantra", "Elantra Hybrid", "Elantra N", "Ioniq 5", "Ioniq 5 N", "Ioniq 6", "Ioniq 9", "Kona", "Kona Electric", "Palisade", "Palisade Hybrid", "Santa Cruz", "Santa Fe", "Santa Fe Hybrid", "Sonata", "Tucson", "Tucson Hybrid", "Tucson Plug-in Hybrid", "Venue"],
};
const MAKE = { cadillac: "cadillac", honda: "honda", kia: "kia", hyundai: "hyundai", audi: "audi", bmw: "bmw", mercedes: "mercedes-benz" };

// Trim words that describe the body / drivetrain, not the trim. Cab, bed and drivetrain are configuration choices; status words say where the car is in
// its life. No trim aliases are approved for these makes: a trim the CSV does not list (e.g. an EV trim without its range suffix) is untrusted -> no options.
const TRIM_NOISE = ["awd", "fwd", "rwd", "4wd", "2wd", "4x4", "4x2", "demo", "fleet", "intransit"];
const TRIM_NOISE_PHRASES = [
  "in transit", "regular cab", "double cab", "crew cab", "extended cab", "4 door", "2 door", "4dr", "2dr",
  "four wheel drive", "all wheel drive", "front wheel drive", "rear wheel drive", "two wheel drive",
  "short bed", "long bed", "standard bed", "short box", "long box", "standard box",
];

// Subscriptions and accessories are not in the configurator CSVs, but a CSV row must never be one (belt and braces; the report counts them).
const SUBSCRIPTION_RE = /subscription|\bplans?\b|siriusxm|sirius\b|onstar|connectivity|connected (?:service|plan)|monthly|annual|per year|free trial/i;
const ACCESSORY_RE = /\baccessor|aftermarket|\bdealer[- ](?:installed|added|option)|port[- ]installed|weathertech|husky|line-?x|rhino|tonneau|bed ?cover|bed ?rug|bed ?mat|cargo (?:net|liner|mat|tray|organizer|box|divider)|floor (?:mat|liner)|splash guards?|mud ?flaps?/i;

// Dealer-installed products on these makes' option lists. WHOLE PRODUCT NAMES ONLY (an exact factory name always wins). Classed dealer add-ons - for quotes,
// never factory options, never on the website.
const GM_PRODUCT_PHRASES = [
  "(?:drop\\s*in|modular\\s+drop\\s*in|line\\s*x|rhino|truck)\\s*bed\\s*liners?", "(?:truck\\s+)?bed\\s*liners?", "bed\\s*mats?", "bed\\s*rugs?", "(?:soft|hard|roll\\s*up|tri\\s*fold|folding|retractable)?\\s*tonneau\\s*covers?", "bed\\s*covers?", "bed\\s*extenders?", "bed\\s*rails?", "tailgate\\s+(?:step|assist|lock|protector|cap)",
  "cargo\\s+(?:net|liner|mat|tray|organizer|divider|box|carrier|management)", "(?:all\\s*weather\\s+)?(?:floor|carpet)\\s*(?:mats?|liners?)", "all\\s*weather\\s+(?:floor\\s+)?(?:mats?|liners?)", "(?:front\\s+|rear\\s+)?splash\\s*guards?", "mud\\s*(?:guards?|flaps?)",
  "(?:paint|clear\\s*coat)\\s*protection(?:\\s+film)?", "ceramic\\s*coating", "paint\\s*sealant", "fabric\\s*protection", "interior\\s*protection", "protection\\s+(?:package|pkg)", "clear\\s*bra", "paint\\s*protection\\s*film", "ppf",
  "hood\\s*(?:protector|deflector|shield)", "bug\\s*(?:shield|guard|deflector)", "window\\s*(?:tint|tinting|visors?|deflectors?)", "wind\\s*deflectors?", "door\\s*(?:edge|sill)\\s*(?:guards?|protectors?)", "door\\s*visors?", "vent\\s*visors?",
  "nitrogen(?:\\s+(?:filled|fill|inflated|inflation|tires?))*", "vin\\s*etch(?:ing)?", "wheel\\s*locks?", "lug\\s*nut\\s*locks?", "pin\\s*stripe[sd]?(?:ing)?", "gap\\s*(?:insurance|coverage)", "perma\\s*plate(?:\\s+\\w+)*", "(?:lifetime\\s+)?oil\\s*(?:change\\s+)?(?:package|pkg|plan)",
  "(?:running|side|nerf|step)\\s*(?:boards?|bars?)", "side\\s*steps?", "cab\\s*steps?", "tow(?:ing)?\\s*hitch(?:\\s+receiver)?", "trailer\\s*hitch", "hitch\\s*receiver", "roof\\s*(?:rack|rails?|cross\\s*bars?|basket)", "cross\\s*bars?", "light\\s*bars?", "winch", "snorkel", "lift\\s*kit", "leveling\\s*kit",
  "brush\\s*guard", "grille\\s*guard", "push\\s*bar", "fender\\s*flares?", "spare\\s*tire\\s*cover", "key\\s*(?:fob\\s+)?cover", "license\\s*plate\\s*(?:frame|bracket)", "emblem\\s*overlays?", "hood\\s*graphics",
];
const addonPatterns = (brand) => {
  const around = brand === "hyundai" ? "(?:hyundai|genesis|genuine|dealer|port|installed|aftermarket)" : brand === "audi" ? "(?:audi|vw|volkswagen|genuine|dealer|port|installed|aftermarket)" : brand === "bmw" ? "(?:bmw|mini|genuine|dealer|port|installed|aftermarket)" : brand === "mercedes" ? "(?:mercedes|mercedes-benz|benz|amg|genuine|dealer|port|installed|aftermarket)" : "(?:cadillac|honda|acura|kia|genuine|dealer|port|installed|aftermarket)";
  return GM_PRODUCT_PHRASES.map((p) => `^(?:${around}\\s+)*(?:${p})(?:\\s+(?:set|kit|package|pkg|pair|installed))*$`);
};

const decoration = (t) => t.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").replace(/\([^)]*\)/g, " ").replace(/®|™/g, "");
const clean = (t) => t.replace(/®|™/g, "").replace(/\s+/g, " ").trim();
const slug = (s) => normalizeOptionKey(s);
const price = (r) => Number(r.price_usd) || 0;

/** { kind, drop } for one CSV row: kind is null when the row is not an option, drop says which rule removed it (for the report). */
function classify(r) {
  if (r.category === "Base") return { kind: null, drop: "base" };
  if (!(price(r) > 0)) return { kind: null, drop: "no price (standard / included)" };
  if (SUBSCRIPTION_RE.test(r.item)) return { kind: null, drop: "subscription" };
  if (ACCESSORY_RE.test(r.item)) return { kind: null, drop: "accessory" };
  let kind = null;
  if (r.category === "Factory package") kind = "package";
  else if (r.category === "Factory option") kind = "option";
  else if (r.category === "Exterior color") kind = "paint";
  else if (r.category === "Powertrain") kind = "powertrain";
  else return { kind: null, drop: `category "${r.category}"` };
  return { kind };
}

/** An explicit code a row is keyed on (`key=ABC` in the notes), or null when it is keyed on its name (`key=name:...`; BMW also has three `key=code:XYZ` rows, keyed on the code). */
function codeOf(r) {
  const m = /(?:^|;\s*)key=([^;]+)/.exec(r.notes || "");
  if (!m) return null;
  const k = m[1].trim();
  return k.startsWith("name:") ? null : k.replace(/^code:\s*/i, "");
}

/** Kia FWD/AWD package pair merged into one CSV row: "price by drivetrain: FWD $1,500; AWD $1,000" -> { fwd: 1500, awd: 1000 } (null when the note is absent). */
function priceByDrivetrain(r) {
  const m = /price by drivetrain:\s*([^;]*;[^;]*|[^;]*)/i.exec(r.notes || "");
  if (!m) return null;
  const out = {};
  for (const x of m[1].matchAll(/\b(FWD|AWD|RWD|2WD|4WD)\s*\$([\d,]+)/gi)) out[x[1].toLowerCase()] = Number(x[2].replace(/,/g, ""));
  return Object.keys(out).length ? out : null;
}

/** Notes that are combos the maker will not allow or needs -> [{ type, text }] */
function rulesOf(r) {
  const out = [];
  for (const raw of String(r.notes || "").split(";")) {
    const t = raw.trim();
    if (!t || /^key=/.test(t)) continue;
    const m = /\b(requires?|required for|not available with|only with|deletes?)\b/i.exec(t);
    if (!m) continue;
    const w = m[1].toLowerCase();
    out.push({ type: w.startsWith("requir") ? "requires" : w.startsWith("not available") ? "notAvailableWith" : w.startsWith("only") ? "onlyWith" : "deletes", text: t });
  }
  return out;
}

function aliasesFor(r, kind, key, code) {
  const out = new Set();
  const label = clean(r.item);
  out.add(normalizeOptionKey(label));
  // A vehicle's option line is matched with any "(...)" removed ("4WD (vs 2WD)" -> "4wd"), so the undecorated name is an alias too.
  const undecorated = normalizeOptionKey(decoration(label));
  if (undecorated) out.add(undecorated);
  if (code) {
    const c = normalizeOptionKey(code);
    for (const a of [c, `rpo ${c}`, `option code ${c}`, `package ${c}`, `${c} package`, `pkg ${c}`]) out.add(a);
  }
  if (kind === "package" && key.endsWith(" package")) out.add(key.replace(/ package$/, " pkg"));
  out.delete(key);
  return [...out].filter(Boolean);
}

function buildCatalog(rows, ADDON_RES, defaultRe = /default-included|auto-included/i) {
  const trims = {}, drops = {}, dropRows = [], conflicts = [], defaultIncluded = [], partial = [], nonAdditiveRows = [];
  for (const t of [...new Set(rows.map((r) => r.trim))]) if (t) trims[slug(t)] = { label: t, options: {} };
  // Every item name the CSV lists for a trim, kept or dropped. A vehicle line equal to one of these is that standalone item (priced or not), never evidence of a
  // package that merely lists it among its contents.
  const catalogNames = {};
  for (const r of rows) if (r.category !== "Base" && trims[slug(r.trim)]) (catalogNames[slug(r.trim)] ||= new Set()).add(normalizeOptionKey(decoration(clean(r.item))));
  for (const r of rows) {
    const tk = slug(r.trim);
    const { kind, drop } = classify(r);
    if (!kind || !trims[tk]) {
      drops[drop] = (drops[drop] || 0) + 1;
      if (drop !== "base") dropRows.push({ drop, line: `${r.year} ${r.model} ${r.trim}: ${clean(r.item)} ($${r.price_usd})` });
      continue;
    }
    const label = clean(r.item);
    const code = codeOf(r);
    const key = code ? normalizeOptionKey(code) : normalizeOptionKey(label);
    if (!key) continue;
    let useKey = key;
    if (trims[tk].options[key]) {
      // Same name, same price = the same sticker line twice. Same name, different price = two distinct paid sticker lines (CT5-V "Jet Black ... Leather Seating Surfaces" $1,500 and $2,890): both stay, the second keyed "<name> <price>".
      if ((trims[tk].options[key].packagePrice ?? trims[tk].options[key].price) === price(r)) { conflicts.push(`${r.year} ${r.model} ${r.trim}: duplicate "${label}" $${r.price_usd} (kept one)`); continue; }
      useKey = `${key} ${price(r)}`;
      if (trims[tk].options[useKey]) { conflicts.push(`${r.year} ${r.model} ${r.trim}: duplicate "${label}" $${r.price_usd} (kept one)`); continue; }
      conflicts.push(`${r.year} ${r.model} ${r.trim}: "${label}" appears at $${trims[tk].options[key].price} and $${r.price_usd}: both kept (second keyed "${useKey}"; a feed line by that name resolves to the first)`);
    }
    if (defaultRe.test(r.notes || "")) defaultIncluded.push(`${r.year} ${r.model} ${r.trim}: ${label} ($${r.price_usd})`);
    const rules = rulesOf(r);
    if (/PARTIAL/.test(r.notes || "")) partial.push(`${r.year} ${r.model} ${r.trim}: ${label} ($${r.price_usd})`);
    // Package-only wheels / interiors: the CSV price is the PACKAGE price ("not additive to the package row"). The entry stays (the line is on the sticker) but
    // adds nothing: price 0, additive false, the package price kept as packagePrice for reference. Keyed by its full name (it names the package it sits in).
    // Mercedes has 15 unmarked rows of the same shape ("Panorama roof (inside package Pinnacle Trim", priced at exactly the package's own price, package row present): treated the same way.
    const nonAdditive = /not additive/i.test(r.notes || "") || /\(inside package /i.test(r.item || "");
    if (nonAdditive) nonAdditiveRows.push(`${r.year} ${r.model} ${r.trim}: ${label} (package price $${r.price_usd})`);
    const byDt = priceByDrivetrain(r);
    trims[tk].options[useKey] = { label, kind, price: nonAdditive ? 0 : price(r), ...(nonAdditive ? { additive: false, packagePrice: price(r) } : {}), ...(byDt ? { priceByDrivetrain: byDt } : {}), ...(code ? { code } : {}), aliases: useKey === key ? aliasesFor(r, kind, key, code) : [], contents: r.contents || "", ...(rules.length ? { rules } : {}) };
  }
  for (const [tkey, t] of Object.entries(trims)) {
    const names = new Set(Object.keys(t.options));
    const taken = new Map();
    for (const [k, o] of Object.entries(t.options)) o.aliases = o.aliases.filter((a) => { if (names.has(a) || taken.has(a)) return false; taken.set(a, k); return true; });
    // Rules name other options on the same trim: record which (by key) so a rule is checkable, not just prose.
    for (const [k, o] of Object.entries(t.options)) for (const rule of o.rules || []) {
      const text = ` ${normalizeOptionKey(rule.text)} `;
      rule.refs = Object.entries(t.options).filter(([k2, o2]) => k2 !== k && text.includes(` ${normalizeOptionKey(decoration(o2.label))} `)).map(([k2]) => k2).sort();
    }
    // Feature lines inside a package are not options. A feature that is a content item of exactly ONE kept package/option on this trim rolls up to it.
    const owners = new Map();
    for (const [k, o] of Object.entries(t.options)) {
      if (o.kind === "paint" || o.kind === "powertrain") continue;
      const items = new Set();
      for (const part of o.contents.split(";")) {
        const inc = part.split(/\bincludes?\b/i);
        const pieces = inc.length > 1 ? inc.slice(1).join(" ").split(/,| and /) : [part];
        for (const piece of pieces) {
          if (piece.trim().length > 70 || /\b(?:not available|not with|requires?|deletes?|only with|discount|summary)\b/i.test(piece)) continue;
          const ck = normalizeOptionKey(decoration(piece));
          if (ck.length >= 8 && ck.split(" ").length >= 2) items.add(ck);
        }
      }
      for (const ck of items) { if (ADDON_RES.some((re) => re.test(ck))) continue; if (!owners.has(ck)) owners.set(ck, new Set()); owners.get(ck).add(k); }
    }
    for (const [ck, ks] of owners) {
      if (ks.size !== 1 || names.has(ck) || taken.has(ck) || (catalogNames[tkey] || new Set()).has(ck)) continue;
      const o = t.options[[...ks][0]];
      (o.features ||= []).push(`^${ck}$`);
    }
    for (const o of Object.values(t.options)) { delete o.contents; if (o.features) o.features.sort(); }
  }
  return { trims, drops, dropRows, conflicts, defaultIncluded, partial, nonAdditiveRows };
}

const built = {}; // brand -> { jsonText, mdText, counts }
for (const brand of BRANDS) {
  const all = parseCsv(fs.readFileSync(csvPath(brand), "utf8"));
  const byModel = new Map();
  for (const r of all) { const g = `${r.year}|${r.model}`; if (!byModel.has(g)) byModel.set(g, []); byModel.get(g).push(r); }
  const seenModels = new Set([...byModel.keys()].map((g) => g.split("|")[1]));
  for (const m of seenModels) if (!EXPECTED_MODELS[brand].includes(m)) throw new Error(`${brand} CSV has an unexpected model "${m}" - add it to EXPECTED_MODELS deliberately or remove it from the CSV`);
  for (const m of EXPECTED_MODELS[brand]) if (!seenModels.has(m)) throw new Error(`${brand} CSV is missing the expected model "${m}"`);

  const unusedAliasScopes = new Set(Object.keys((ALIASES[brand] || {})));
  const policies = {};
  const report = { unnamedDefaultPaint: [], presumedDefault: [], models: [], conflicts: [], defaultIncluded: [], partial: [], nonAdditiveRows: [], drops: {}, rulesCount: 0, codeKeys: [] };
  for (const [g, rows] of [...byModel].sort()) {
    const [year, model] = g.split("|");
    const DEALER_ADDON_PATTERNS = addonPatterns(brand);
    const cat = buildCatalog(rows, DEALER_ADDON_PATTERNS.map((p) => new RegExp(p, "i")), brand === "hyundai" ? /default-included|auto-included|default paint/i : undefined);
    if (brand === "hyundai") for (const r of rows) if (r.category === "Base" && /unnamed \+\$[\d,]+ paint/.test(r.notes || "")) report.unnamedDefaultPaint.push(`${r.year} ${r.model} ${r.trim}: ${/unnamed (\+\$[\d,]+) paint/.exec(r.notes)[1]} paint, not identified (default paint not verified)`); else if (brand === "hyundai" && r.category !== "Base" && /presumed, not verified/.test(r.notes || "")) report.presumedDefault.push(`${r.year} ${r.model} ${r.trim}: ${clean(r.item)} ($${r.price_usd})`);
    report.conflicts.push(...cat.conflicts); report.defaultIncluded.push(...cat.defaultIncluded); report.partial.push(...cat.partial); report.nonAdditiveRows.push(...cat.nonAdditiveRows);
    for (const [k, v] of Object.entries(cat.drops)) report.drops[k] = (report.drops[k] || 0) + v;
    // Approved exact aliases (scripts/lib/optionPolicyAliases.mjs). Every target must be a trim this scope really has: a typo fails the build.
    unusedAliasScopes.delete(`${year}|${model}`);
    const al = (ALIASES[brand] || {})[`${year}|${model}`] || {};
    const brandNoise = BRAND_NOISE[brand] || { noise: [], noisePhrases: [] };
    const target = (to) => { const k = slug(to); if (!cat.trims[k]) throw new Error(`${brand} ${year} ${model}: alias target "${to}" is not a trim of this policy (${Object.keys(cat.trims).join(", ")})`); return k; };
    const pairs = (o, keyFn) => Object.fromEntries(Object.entries(o || {}).map(([from, to]) => [keyFn(from), target(to)]));
    policies[`${MAKE[brand]}|${slug(model)}|${year}`] = {
      source: `docs/${docsDir(brand)}/${brand}_lineup_options_by_trim.csv (${year} ${model})`,
      models: [slug(model), ...(al.models || []).map(slug)],
      ...(al.modelImplied ? { modelImplied: Object.fromEntries(Object.entries(al.modelImplied).map(([m, w]) => [slug(m), slug(w)])) } : {}),
      keepBare: [],
      trimAliases: pairs(al.trimAliases, slug),
      ...(al.modelTrim ? { modelTrimAliases: pairs(al.modelTrim, (from) => from.split("|").map(slug).join("|")) } : {}),
      orderCodePattern: "(?!)", // no option here is keyed on an order code: a feed code never matches a policy key
      trimNoise: [...TRIM_NOISE, ...brandNoise.noise, ...(al.noise || [])],
      trimNoisePhrases: [...TRIM_NOISE_PHRASES, ...brandNoise.noisePhrases, ...(al.noisePhrases || [])].map((x) => slug(x)),
      disclaimerPatterns: DISCLAIMER_PATTERNS,
      trims: cat.trims,
      dealerAddons: { keys: [], patterns: DEALER_ADDON_PATTERNS },
    };
    const counts = Object.values(cat.trims).map((t) => {
      const os = Object.values(t.options);
      report.rulesCount += os.reduce((n, o) => n + (o.rules || []).length, 0);
      for (const o of os) if (o.code) report.codeKeys.push(`${year} ${model} ${t.label}: ${o.code} = ${o.label} ($${o.price})`);
      return { trim: t.label, packages: os.filter((o) => o.kind === "package").length, options: os.filter((o) => o.kind === "option").length, powertrain: os.filter((o) => o.kind === "powertrain").length, paints: os.filter((o) => o.kind === "paint").length, rules: os.reduce((n, o) => n + (o.rules || []).length, 0) };
    });
    report.models.push({ year, model, counts });
  }
  if (unusedAliasScopes.size) throw new Error(`${brand}: alias scope(s) with no policy (typo?): ${[...unusedAliasScopes].join(", ")}`);
  const totals = { policies: Object.keys(policies).length, models: seenModels.size, trims: 0, entries: 0, packages: 0, options: 0, powertrain: 0, paints: 0, rules: report.rulesCount, codeKeys: report.codeKeys.length };
  for (const m of report.models) for (const c of m.counts) { totals.trims++; totals.packages += c.packages; totals.options += c.options; totals.powertrain += c.powertrain; totals.paints += c.paints; }
  totals.entries = totals.packages + totals.options + totals.powertrain + totals.paints;

  const Brand = brand[0].toUpperCase() + brand.slice(1);
  const md = [];
  md.push(`# ${Brand} ${(YEARS[brand] || "2026-2027").replace("-20", "-")} option policies - generated report`, "", `Generated by \`scripts/build-gm-option-policy.mjs\` from \`${brand}_lineup_options_by_trim.csv\`. Do not edit by hand.`, "");
  md.push(`**${totals.models} models, ${totals.policies} model-year policies, ${totals.trims} trims, ${totals.entries} option entries** (${totals.packages} packages, ${totals.options} options, ${totals.powertrain} powertrain, ${totals.paints} paints), ${totals.rules} stored rules, ${totals.codeKeys} RPO-code keys.`, "");
  md.push("## Model-name mapping (CSV model -> DB `model` spellings the policy matches)", "", "| Year | CSV model | DB spellings matched (normalized) |", "|---|---|---|");
  const aliasOf = (m) => (ALIASES[brand] || {})[`${m.year}|${m.model}`] || {};
  for (const m of report.models) md.push(`| ${m.year} | ${m.model} | ${[slug(m.model), ...(aliasOf(m).models || []).map(slug)].join(", ")} |`);
  const aliased = report.models.filter((m) => Object.keys(aliasOf(m)).length);
  md.push("", `Not covered (untouched): every other ${Brand} model and every other model year. ${aliased.length ? "Extra spellings and trim aliases are the exact ones in `scripts/lib/optionPolicyAliases.mjs` (no fuzzy matching, no year-to-year mapping)." : "No extra model spellings are mapped (none approved)."}`, "");
  if (aliased.length) {
    md.push("## Approved exact aliases", "", "| Year | CSV model | Trim aliases | Model + trim pairs | Extra noise phrases |", "|---|---|---|---|---|");
    for (const m of aliased) { const a = aliasOf(m); md.push(`| ${m.year} | ${m.model} | ${Object.keys(a.trimAliases || {}).length} | ${Object.keys(a.modelTrim || {}).length} | ${(a.noisePhrases || []).length} |`); }
    md.push("");
  }
  md.push("## Entries per trim (paid packages / paid options / paid powertrain / paid paints / stored rules)", "", "| Year | Model | Trim | Packages | Options | Powertrain | Paints | Rules |", "|---|---|---|---|---|---|---|---|");
  for (const m of report.models) for (const c of m.counts) md.push(`| ${m.year} | ${m.model} | ${c.trim} | ${c.packages} | ${c.options} | ${c.powertrain} | ${c.paints} | ${c.rules} |`);
  md.push("", `Rules stored (combos the maker will not allow or needs: requires / not available with / only with / deletes): ${report.rulesCount}. They are data under each option, never options.`, "");
  md.push("## CSV rows not kept (by rule)", "", ...Object.entries(report.drops).sort().map(([k, v]) => `- ${k}: ${v}`), "");
  md.push("## Trim handling (nothing is aliased)", "", "- no trim aliases are approved: a trim string that is not a CSV trim (after noise words) is untrusted and gets no options", "- drivetrain / body words (`AWD`, `4WD`, `Crew Cab`, `Short Bed`...) and status words (`Demo`, `Fleet`, `In Transit`) are ignored when matching a trim", "- Cadillac trims carry the drivetrain in the CSV name (`Sport AWD`, `Luxury 4WD`): a vehicle trim must carry it too (a bare `Sport` on CT5 is untrusted, it could be RWD or AWD); XT5 trims are plain. Kia `price by drivetrain` pairs are one entry, priced by the drivetrain word in the vehicle trim (default: the FWD price)", "");
  md.push(`## Keys that are explicit codes (${report.codeKeys.length})`, "", ...report.codeKeys.map((x) => `- ${x}`), "", "Every other entry is keyed on its full normalized name.", "");
  md.push("## Judgment calls", "", ...(brand === "hyundai" ? ["- `AWD` / `N 8-speed Wet Dual Clutch Transmission` rows are CSV \"Powertrain\" upgrades with a price, so they are kept as powertrain options (a feed line `AWD` matches). The CSV carries one per-trim delta price (it differs by trim, e.g. Ioniq 5 Limited $3,900 vs SE $3,500).", "- The CSV has NO \"Factory package\" / \"Factory option\" rows at all and no paid interior colors or materials: only paints, drivetrain and one transmission. The policy cannot keep a line the CSV does not list; see the PR for the question this raises."] : ["- `4WD (vs 2WD)` / `AWD (vs FWD)` rows are CSV \"Powertrain\" upgrades with a price, so they are kept as powertrain options (a feed line `4WD` / `AWD` matches). Honda, Kia and Cadillac AWD/4WD upgrades are paid sticker lines."]));
  md.push("- Default-selected / default-included paid items (the CSV notes `default-selected paid paint`, `default-included`, `auto-included`) are kept at their price: the trim's base price leaves them out. Rows:", "", ...(report.defaultIncluded.length ? report.defaultIncluded.map((x) => `  - ${x}`) : ["  - none"]), "");
  if (brand === "hyundai") {
    md.push(`## Default paint the CSV could not name (${report.unnamedDefaultPaint.length} trims)`, "", "The base price leaves out a paid default paint on these trims, but the CSV does not say which paint it is, so no policy entry can match that sticker line. A car in that paint keeps no paint row until the CSV names it.", "", ...report.unnamedDefaultPaint.map((x) => `- ${x}`), "");
    md.push(`## Paint rows kept that the CSV marks presumed / not verified (${report.presumedDefault.length})`, "", ...report.presumedDefault.map((x) => `- ${x}`), "");
  }
  if (brand === "audi" || brand === "mercedes") {
    md.push(`## Package-only lines, not additive (${report.nonAdditiveRows.length})`, "", "Audi: the CSV marks these \"available only inside a package; price shown is the package price (not additive to the package row)\". Mercedes: 15 unmarked `(inside package ...)` rows priced at exactly their package's price. Each stays as an entry keyed by its full name, with price 0, `additive: false` and the CSV price kept as `packagePrice`: it never adds to a price.", "", ...report.nonAdditiveRows.map((x) => `- ${x}`), "");
    if (brand === "audi") md.push(`## Packages with missing contents (PARTIAL) (${report.partial.length})`, "", "Kept as packages at their price; the CSV did not capture what is inside them, so no content features roll up to them.", "", ...report.partial.map((x) => `- ${x}`), "");
  }
  if (report.conflicts.length) md.push("## Duplicate rows inside one trim (kept once, or both when the price differs)", "", ...report.conflicts.map((c) => `- ${c}`), "");
  built[brand] = { jsonText: `${JSON.stringify(policies, null, 2)}\n`, mdText: `${md.join("\n")}\n`, totals };
}

if (process.argv.includes("--check")) {
  const bad = [];
  for (const b of BRANDS) {
    if ((fs.existsSync(outPath(b)) ? fs.readFileSync(outPath(b), "utf8") : "") !== built[b].jsonText) bad.push(path.relative(root, outPath(b)));
    if ((fs.existsSync(reportPath(b)) ? fs.readFileSync(reportPath(b), "utf8") : "") !== built[b].mdText) bad.push(path.relative(root, reportPath(b)));
  }
  if (bad.length) { console.error(`out of date: ${bad.join(", ")} - run node scripts/build-gm-option-policy.mjs`); process.exit(1); }
  console.log("gm policy JSON and reports are current");
} else {
  for (const b of BRANDS) {
    fs.writeFileSync(outPath(b), built[b].jsonText);
    fs.writeFileSync(reportPath(b), built[b].mdText);
    console.log(b, JSON.stringify(built[b].totals));
  }
}
