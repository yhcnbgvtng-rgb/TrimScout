// Builds the 2026-27 GM option policies (Chevrolet 18 models, GMC 13, Buick 4) from docs/gm-2026-2027/<brand>_lineup_options_by_trim.csv:
//   scrapers/lightsail-crawler/src/optionPolicies/{chevrolet,gmc,buick}-2026-2027.json   the policies (one per model + year)
//   docs/gm-2026-2027/POLICY_REPORT_{chevrolet,gmc,buick}.md                            what was kept, dropped and stored as rules, and why
// Run: node scripts/build-gm-option-policy.mjs [--check]   (--check exits 1 when any file differs from what this would write)
//
// Same engine and approach as the Ford policies (PRs #455/#456), with the rules Paul approved for GM:
//   kept       "Factory package" and "Factory option" rows with price > 0, "Exterior color" rows (incl. roof colors) with price > 0, and "Powertrain" rows
//              (engine, drivetrain, transmission upgrades) with price > 0 - each tied to make + model + year + TRIM and priced per trim, never per package name.
//   key        the GM RPO code when the CSV gives one (key=WN5 -> "wn5"), otherwise the full normalized name.
//   rules      "requires ...", "not available with ...", "only with ...", "deletes ..." notes are combos GM will not allow: stored under the option as rules
//              (with the option keys they name), never as options.
//   not options  Base, price <= 0 / blank, standard / Included, subscriptions, accessories (belt and braces: the CSVs hold none), features inside a package.
//   Corvette   lean cut (Paul): only packages, paints, wheels and performance items; the $1,000 threshold (CORVETTE_MIN_PRICE) applies to performance items only. Everything else is dropped.
//   no trusted trim -> no options (enforced at match time in factoryOptionAllowlist.js). Makes and model years without a policy are untouched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, parseCsv, DISCLAIMER_PATTERNS } from "./lib/optionPolicyCommon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRANDS = ["chevrolet", "gmc", "buick"];
const csvPath = (b) => path.join(root, `docs/gm-2026-2027/${b}_lineup_options_by_trim.csv`);
const outPath = (b) => path.join(root, `scrapers/lightsail-crawler/src/optionPolicies/${b}-2026-2027.json`);
const reportPath = (b) => path.join(root, `docs/gm-2026-2027/POLICY_REPORT_${b}.md`);

// CSV model -> extra DB `model` spellings it covers (normalizeOptionKey form; the CSV spelling itself is always included). None approved yet.
// EXPECTED_MODELS is the contract with Paul's brief: a CSV with a model not listed here fails the build instead of silently growing the policy.
const EXPECTED_MODELS = {
  chevrolet: ["Blazer", "Blazer EV", "Bolt", "Colorado", "Corvette", "Equinox", "Equinox EV", "Express Cargo", "Express Passenger", "Silverado 1500", "Silverado 2500 HD", "Silverado 3500 HD", "Silverado EV", "Suburban", "Tahoe", "Trailblazer", "Traverse", "Trax"],
  gmc: ["Acadia", "Canyon", "Hummer EV Pickup", "Hummer EV SUV", "Savana Cargo", "Savana Passenger", "Sierra 1500", "Sierra 2500 HD", "Sierra 3500 HD", "Sierra EV", "Terrain", "Yukon", "Yukon XL"],
  buick: ["Enclave", "Encore GX", "Envision", "Envista"],
};
const MAKE = { chevrolet: "chevrolet", gmc: "gmc", buick: "buick" };

// Corvette lean cut (Paul): packages, paints, wheels and performance items. Only performance items must be priced over this.
export const CORVETTE_MIN_PRICE = 1000;
const CORVETTE_KEEP_SUB = new Set(["Wheels", "Performance"]);

// Trim words that describe the body / drivetrain, not the trim. Cab, bed and drivetrain are configuration choices; status words say where the car is in
// its life. No trim aliases are approved for GM: a trim the CSV does not list (e.g. an EV trim without its range suffix) is untrusted -> no options.
const TRIM_NOISE = ["awd", "fwd", "rwd", "4wd", "2wd", "4x4", "4x2", "demo", "fleet", "intransit"];
const TRIM_NOISE_PHRASES = [
  "in transit", "regular cab", "double cab", "crew cab", "extended cab", "4 door", "2 door", "4dr", "2dr",
  "four wheel drive", "all wheel drive", "front wheel drive", "rear wheel drive", "two wheel drive",
  "short bed", "long bed", "standard bed", "short box", "long box", "standard box",
];

// Subscriptions and accessories are not in the configurator CSVs, but a CSV row must never be one (belt and braces; the report counts them).
const SUBSCRIPTION_RE = /subscription|\bplans?\b|siriusxm|sirius\b|onstar|connectivity|connected (?:service|plan)|monthly|annual|per year|free trial/i;
const ACCESSORY_RE = /\baccessor|aftermarket|\bdealer[- ](?:installed|added|option)|port[- ]installed|weathertech|husky|line-?x|rhino|tonneau|bed ?cover|bed ?rug|bed ?mat|cargo (?:net|liner|mat|tray|organizer|box|divider)|floor (?:mat|liner)|splash guards?|mud ?flaps?/i;

// Dealer-installed products on GM vehicles' option lists. WHOLE PRODUCT NAMES ONLY (an exact factory name always wins). Classed dealer add-ons - for quotes,
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
const AROUND = "(?:chevrolet|chevy|gmc|buick|gm|genuine|dealer|port|installed|aftermarket)";
const DEALER_ADDON_PATTERNS = GM_PRODUCT_PHRASES.map((p) => `^(?:${AROUND}\\s+)*(?:${p})(?:\\s+(?:set|kit|package|pkg|pair|installed))*$`);
const ADDON_RES = DEALER_ADDON_PATTERNS.map((p) => new RegExp(p, "i"));

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
  if (r.model === "Corvette") { // lean cut: packages, paints, wheels and performance items over the threshold, nothing else
    const group = kind === "package" ? "package" : kind === "paint" ? "paint" : kind === "option" && r.subcategory === "Wheels" ? "wheel" : kind === "option" && r.subcategory === "Performance" ? "performance" : null;
    if (!group) return { kind: null, drop: `Corvette lean cut: ${kind}${r.subcategory ? ` / ${r.subcategory}` : ""} is not a package, paint, wheel or performance item` };
    if (group === "performance" && !(price(r) > CORVETTE_MIN_PRICE)) return { kind: null, drop: `Corvette lean cut: ${group} item at or under $${CORVETTE_MIN_PRICE}` };
  }
  return { kind };
}

/** The GM RPO code a row is keyed on (`key=WN5` in the notes), or null when it is keyed on its name. */
function codeOf(r) {
  const m = /(?:^|;\s*)key=([^;]+)/.exec(r.notes || "");
  if (!m) return null;
  const k = m[1].trim();
  return k.startsWith("name:") ? null : k;
}

/** Notes that are combos GM will not allow or needs -> [{ type, text }] */
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

function buildCatalog(rows) {
  const trims = {}, drops = {}, dropRows = [], conflicts = [], defaultIncluded = [];
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
    if (trims[tk].options[key]) { conflicts.push(`${r.year} ${r.model} ${r.trim}: duplicate "${label}" (kept the first, $${trims[tk].options[key].price}; other $${r.price_usd})`); continue; }
    if (/default-included|auto-included/i.test(r.notes || "")) defaultIncluded.push(`${r.year} ${r.model} ${r.trim}: ${label} ($${r.price_usd})`);
    const rules = rulesOf(r);
    trims[tk].options[key] = { label, kind, price: price(r), ...(code ? { code } : {}), aliases: aliasesFor(r, kind, key, code), contents: r.contents || "", ...(rules.length ? { rules } : {}) };
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
  return { trims, drops, dropRows, conflicts, defaultIncluded };
}

const built = {}; // brand -> { jsonText, mdText, counts }
for (const brand of BRANDS) {
  const all = parseCsv(fs.readFileSync(csvPath(brand), "utf8"));
  const byModel = new Map();
  for (const r of all) { const g = `${r.year}|${r.model}`; if (!byModel.has(g)) byModel.set(g, []); byModel.get(g).push(r); }
  const seenModels = new Set([...byModel.keys()].map((g) => g.split("|")[1]));
  for (const m of seenModels) if (!EXPECTED_MODELS[brand].includes(m)) throw new Error(`${brand} CSV has an unexpected model "${m}" - add it to EXPECTED_MODELS deliberately or remove it from the CSV`);
  for (const m of EXPECTED_MODELS[brand]) if (!seenModels.has(m)) throw new Error(`${brand} CSV is missing the expected model "${m}"`);

  const policies = {};
  const report = { models: [], conflicts: [], defaultIncluded: [], drops: {}, rulesCount: 0, codeKeys: [], corvetteDropped: [] };
  for (const [g, rows] of [...byModel].sort()) {
    const [year, model] = g.split("|");
    const cat = buildCatalog(rows);
    report.conflicts.push(...cat.conflicts); report.defaultIncluded.push(...cat.defaultIncluded);
    for (const [k, v] of Object.entries(cat.drops)) report.drops[k] = (report.drops[k] || 0) + v;
    if (model === "Corvette") report.corvetteDropped.push(...cat.dropRows.filter((d) => d.drop.startsWith("Corvette")));
    policies[`${MAKE[brand]}|${slug(model)}|${year}`] = {
      source: `docs/gm-2026-2027/${brand}_lineup_options_by_trim.csv (${year} ${model})`,
      models: [slug(model)],
      keepBare: [],
      trimAliases: {},
      orderCodePattern: "^[0-9A-Za-z]{3}$", // GM RPO codes: "Z07", "WN5", "5ZU"
      trimNoise: TRIM_NOISE,
      trimNoisePhrases: TRIM_NOISE_PHRASES,
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
  const totals = { policies: Object.keys(policies).length, models: seenModels.size, trims: 0, entries: 0, packages: 0, options: 0, powertrain: 0, paints: 0, rules: report.rulesCount, codeKeys: report.codeKeys.length };
  for (const m of report.models) for (const c of m.counts) { totals.trims++; totals.packages += c.packages; totals.options += c.options; totals.powertrain += c.powertrain; totals.paints += c.paints; }
  totals.entries = totals.packages + totals.options + totals.powertrain + totals.paints;

  const Brand = brand[0].toUpperCase() + brand.slice(1);
  const md = [];
  md.push(`# ${Brand} 2026-27 option policies - generated report`, "", `Generated by \`scripts/build-gm-option-policy.mjs\` from \`${brand}_lineup_options_by_trim.csv\`. Do not edit by hand.`, "");
  md.push(`**${totals.models} models, ${totals.policies} model-year policies, ${totals.trims} trims, ${totals.entries} option entries** (${totals.packages} packages, ${totals.options} options, ${totals.powertrain} powertrain, ${totals.paints} paints), ${totals.rules} stored rules, ${totals.codeKeys} RPO-code keys.`, "");
  md.push("## Model-name mapping (CSV model -> DB `model` spellings the policy matches)", "", "| Year | CSV model | DB spellings matched (normalized) |", "|---|---|---|");
  for (const m of report.models) md.push(`| ${m.year} | ${m.model} | ${slug(m.model)} |`);
  md.push("", `Not covered (untouched): every other ${Brand} model and every other model year. No extra model spellings are mapped (none approved).`, "");
  md.push("## Entries per trim (paid packages / paid options / paid powertrain / paid paints / stored rules)", "", "| Year | Model | Trim | Packages | Options | Powertrain | Paints | Rules |", "|---|---|---|---|---|---|---|---|");
  for (const m of report.models) for (const c of m.counts) md.push(`| ${m.year} | ${m.model} | ${c.trim} | ${c.packages} | ${c.options} | ${c.powertrain} | ${c.paints} | ${c.rules} |`);
  md.push("", `Rules stored (combos GM will not allow or needs: requires / not available with / only with / deletes): ${report.rulesCount}. They are data under each option, never options.`, "");
  md.push("## CSV rows not kept (by rule)", "", ...Object.entries(report.drops).sort().map(([k, v]) => `- ${k}: ${v}`), "");
  md.push("## Trim handling (nothing is aliased)", "", "- no trim aliases are approved for GM: a trim string that is not a CSV trim (after noise words) is untrusted and gets no options", "- drivetrain / body words (`AWD`, `4WD`, `Crew Cab`, `Short Bed`...) and status words (`Demo`, `Fleet`, `In Transit`) are ignored when matching a trim", "- EV trims are listed with their range (`LT - Extended Range`); a vehicle trim of plain `LT` on an EV model is untrusted", "");
  md.push(`## Keys that are GM RPO codes (${report.codeKeys.length})`, "", ...report.codeKeys.map((x) => `- ${x}`), "", "Every other entry is keyed on its full normalized name.", "");
  md.push("## Judgment calls", "", "- `4WD (vs 2WD)` / `AWD (vs FWD)` rows are CSV \"Powertrain\" upgrades with a price, so they are kept as powertrain options (a feed line `4WD` / `AWD` matches). They are drivetrain choices as much as upgrades; if Paul wants them treated as configuration (as Ford's 4x4 is), drop the Drivetrain subcategory in `classify`.");
  md.push("- Default-selected / default-included paid items (the CSV notes `default-selected paid paint`, `default-included`, `auto-included`) are kept at their price: the trim's base price leaves them out. Rows:", "", ...(report.defaultIncluded.length ? report.defaultIncluded.map((x) => `  - ${x}`) : ["  - none"]), "");
  if (brand === "chevrolet") {
    md.push(`## Corvette lean cut (Paul)`, "", `Kept only packages, paints, wheels and performance items; the **$${CORVETTE_MIN_PRICE} threshold applies to performance items only** (every priced package, paint and wheel stays). Dropped ${report.corvetteDropped.length} priced rows:`, "");
    const by = {};
    for (const d of report.corvetteDropped) by[d.drop] = (by[d.drop] || 0) + 1;
    md.push(...Object.entries(by).sort().map(([k, v]) => `- ${k}: ${v}`), "");
  }
  md.push("## Not in the CSVs (flagged)", "", "- No `ZR2 Bison` rows (Silverado 1500, Silverado 2500 HD, Colorado) and no `AT4X AEV` rows (GMC Canyon, Sierra 1500, Sierra 2500 HD) exist in these CSV files, so the policies contain no Bison or AEV edition package. Brief says keep them as factory packages; they need name, trim, price and RPO code from Paul (or a corrected CSV) before they can be added.", "");
  if (report.conflicts.length) md.push("## Duplicate rows inside one trim (first kept)", "", ...report.conflicts.map((c) => `- ${c}`), "");
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
