// Builds the 2026 Ford option policies (F-150, Maverick, Ranger, Bronco Sport, Bronco) from docs/ford-2026/ford_lineup_options_by_trim.csv:
//   scrapers/lightsail-crawler/src/optionPolicies/ford-2026.json   the policies (one per model, 2026)
//   docs/ford-2026/POLICY_REPORT.md                                what was kept, dropped and stored as rules, and why
// Run: node scripts/build-ford-option-policy.mjs [--check]   (--check exits 1 when either file differs from what this would write)
//
// Same approach as the Toyota policies (PRs #432/#433), with the rules Paul approved for Ford:
//   kept            "Factory package" and "Factory option" rows with price > 0, "Exterior color" rows (incl. roof colors) with price > 0, and "Powertrain" rows
//                   (engine, axle, transmission upgrades) with price > 0 - each tied to make + model + year + TRIM and priced per trim, never per package name.
//   key             the Ford package code when the CSV gives one (key=101A -> "101a"), otherwise the full normalized name. Code-only groups without a price are
//                   never kept (a row needs price > 0).
//   rules           "Requires ...", "Not available with ...", "only with ...", "deletes ..." notes are combos Ford will not allow: stored under the option as
//                   rules (with the option keys they name), never as options.
//   not options     Base, price <= 0 / blank, standard / Included, interior colors / seats / trim choices (see INTERIOR_CHOICE_RE; the paid FUNCTIONAL options Ford
//                   tags "Interior" - Power Moonroof, trailer brake controller, Pro Power Onboard... - are kept), subscriptions
//                   (Connectivity, SiriusXM, BlueCruise plans), accessories (incl. dealer bed, cargo and protection items), cab / bed / door count / drivetrain
//                   (configuration choices), and features inside a package. The Tough Bed spray-in bedliner (a factory option) is the one bedliner kept.
//   no trusted trim -> no options (enforced at match time in factoryOptionAllowlist.js).
//   Explorer and every other Ford model / year: no policy, untouched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, parseCsv, DISCLAIMER_PATTERNS } from "./lib/optionPolicyCommon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(root, "docs/ford-2026/ford_lineup_options_by_trim.csv");
const OUT = path.join(root, "scrapers/lightsail-crawler/src/optionPolicies/ford-2026.json");
const REPORT = path.join(root, "docs/ford-2026/POLICY_REPORT.md");

// CSV model -> the DB `model` spellings it covers (normalizeOptionKey form; the CSV spelling itself is always included).
// "F-150 Lightning" and every other Ford model are deliberately NOT here: they keep today's behavior.
const MODEL_NAMES = { "F-150": ["f150"], Maverick: [], Ranger: [], "Bronco Sport": [], Bronco: [] };

// Ford's configurator tags 11 priced options "Interior" (27 rows). Paul's rule: the paid FUNCTIONAL ones (Power Moonroof, Integrated Trailer Brake Controller,
// Pro Power Onboard, Aux Switches and Wiring, Slide-Out Tailgate, Power-Sliding Rear Window) are options and stay; interior colors, seats and trim choices
// do not. In this CSV the latter are exactly "Interior Carbon Fiber Pack" and "Code Orange Accent Seat Belts" - what this pattern drops from the Interior group.
const INTERIOR_CHOICE_RE = /\bseats?\b|seat ?belts?|upholster|leather|\bcloth\b|\btrim\b|carbon fiber|headliner|interior (?:colou?r|pack|trim)/i;

// Approved trim aliases (Paul), and nothing else. Maverick's Lobo is sold as "Lobo High" / "Lobo Standard" (equipment-group names); the CSV prices one "Lobo".
// "Raptor R" is deliberately NOT here: it stays its own (untrusted) trim, not Raptor.
const TRIM_ALIASES = { Maverick: { "lobo high": "lobo", "lobo standard": "lobo" } };

// Trim words that describe the body / drivetrain, not the trim. Cab, bed, door count and drivetrain are configuration choices.
// Status words (Demo, Fleet, In Transit) say where the car is in its life, not which trim it is; approved as noise. A trailing Ford order code ("XLT 302A") is
// stripped by the policy flag trimStripOrderCodes (see factoryOptionAllowlist.js).
const TRIM_NOISE = ["awd", "fwd", "rwd", "4wd", "2wd", "4x4", "4x2", "supercrew", "supercab", "reg", "hybrid", "hev", "demo", "fleet", "intransit"];
const TRIM_NOISE_PHRASES = [
  "in transit", "super crew", "super cab", "regular cab", "crew cab", "extended cab", "4 door", "2 door", "4dr", "2dr",
  "four wheel drive", "all wheel drive", "front wheel drive", "rear wheel drive", "two wheel drive",
  "short bed", "long bed", "standard bed", "145 wb", "157 wb", "122 wb", "126 wb",
  ...["5 5", "6 5", "8", "5", "6"].flatMap((n) => [`${n} box`, `${n} bed`, `${n} ft box`, `${n} ft bed`, `${n} foot box`, `${n} foot bed`]),
];

// Subscriptions and accessories are not in the configurator CSV, but a CSV row must never be one (belt and braces; the report counts them).
const SUBSCRIPTION_RE = /subscription|\bplans?\b|siriusxm|sirius\b|connectivity|connected (?:service|plan)|fordpass|monthly|annual|per year|free trial/i;
const ACCESSORY_RE = /\baccessor|aftermarket|\bdealer[- ](?:installed|added|option)|port[- ]installed|weathertech|husky|line-?x|rhino|tonneau|bed ?cover|bed ?rug|bed ?mat|cargo (?:net|liner|mat|tray|organizer|box|divider)|floor (?:mat|liner)|splash guards?|mud ?flaps?/i;
const CONFIGURATION_RE = /^(?:4x4|4x2|4wd|2wd|awd|rwd|fwd|(?:regular|super|crew|extended) ?cab|supercrew|supercab|[24][- ]door|[24]dr|\d+(?:\.\d)?'? ?(?:ft\.?|foot)? ?(?:bed|box)|\d+\s?wb)\b/i;

// Dealer-installed products on Ford vehicles' option lists. WHOLE PRODUCT NAMES ONLY (an exact factory name always wins, so Ranger's factory "Black Running
// Boards" and the Tough Bed bedliner are kept). These are classed dealer add-ons - for quotes, never factory options, never on the website.
const FORD_PRODUCT_PHRASES = [
  "(?:drop\\s*in|modular\\s+drop\\s*in|spray\\s*in|line\\s*x|rhino|truck)\\s*bed\\s*liners?", "(?:truck\\s+)?bed\\s*liners?", "bed\\s*mats?", "bed\\s*rugs?", "(?:soft|hard|roll\\s*up|tri\\s*fold|folding|retractable)?\\s*tonneau\\s*covers?", "bed\\s*covers?", "bed\\s*extenders?", "bed\\s*rails?", "tailgate\\s+(?:step|assist|lock|protector|cap)",
  "cargo\\s+(?:net|liner|mat|tray|organizer|divider|box|carrier|management)", "(?:all\\s*weather\\s+)?(?:floor|carpet)\\s*(?:mats?|liners?)", "all\\s*weather\\s+(?:floor\\s+)?(?:mats?|liners?)", "(?:front\\s+|rear\\s+)?splash\\s*guards?", "mud\\s*(?:guards?|flaps?)",
  "(?:paint|clear\\s*coat)\\s*protection(?:\\s+film)?", "ceramic\\s*coating", "paint\\s*sealant", "fabric\\s*protection", "interior\\s*protection", "protection\\s+(?:package|pkg)", "clear\\s*bra", "paint\\s*protection\\s*film", "ppf",
  "hood\\s*(?:protector|deflector|shield)", "bug\\s*(?:shield|guard|deflector)", "window\\s*(?:tint|tinting|visors?|deflectors?)", "wind\\s*deflectors?", "door\\s*(?:edge|sill)\\s*(?:guards?|protectors?)", "door\\s*visors?", "vent\\s*visors?",
  "nitrogen(?:\\s+(?:filled|fill|inflated|inflation|tires?))*", "vin\\s*etch(?:ing)?", "wheel\\s*locks?", "lug\\s*nut\\s*locks?", "pin\\s*stripe[sd]?(?:ing)?", "gap\\s*(?:insurance|coverage)", "perma\\s*plate(?:\\s+\\w+)*", "(?:lifetime\\s+)?oil\\s*(?:change\\s+)?(?:package|pkg|plan)",
  "(?:running|side|nerf|step)\\s*(?:boards?|bars?)", "side\\s*steps?", "cab\\s*steps?", "tow(?:ing)?\\s*hitch(?:\\s+receiver)?", "trailer\\s*hitch", "hitch\\s*receiver", "roof\\s*(?:rack|rails?|cross\\s*bars?|basket)", "cross\\s*bars?", "light\\s*bars?", "winch", "snorkel", "lift\\s*kit", "leveling\\s*kit",
  "brush\\s*guard", "grille\\s*guard", "push\\s*bar", "fender\\s*flares?", "spare\\s*tire\\s*cover", "key\\s*(?:fob\\s+)?cover", "license\\s*plate\\s*(?:frame|bracket)", "emblem\\s*overlays?", "hood\\s*graphics",
];
const AROUND = "(?:ford|genuine|dealer|port|installed|aftermarket)";
const DEALER_ADDON_PATTERNS = FORD_PRODUCT_PHRASES.map((p) => `^(?!.*tough bed)(?:${AROUND}\\s+)*(?:${p})(?:\\s+(?:set|kit|package|pkg|pair|installed))*$`);

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
  if (ACCESSORY_RE.test(r.item) && !/tough bed/i.test(r.item)) return { kind: null, drop: "accessory" };
  if (CONFIGURATION_RE.test(r.item)) return { kind: null, drop: "configuration (cab / bed / doors / drivetrain)" };
  if (r.category === "Factory option" && r.subcategory === "Interior" && INTERIOR_CHOICE_RE.test(r.item)) return { kind: null, drop: "interior color / seat / trim choice" };
  if (r.category === "Factory package") return { kind: "package" };
  if (r.category === "Factory option") return { kind: "option" };
  if (r.category === "Exterior color") return { kind: "paint" };
  if (r.category === "Powertrain") return { kind: "powertrain" };
  return { kind: null, drop: `category "${r.category}"` };
}

/** The Ford package code a row is keyed on (`key=101A` in the notes), or null when it is keyed on its name. */
function codeOf(r) {
  const m = /(?:^|;\s*)key=([^;]+)/.exec(r.notes || "");
  if (!m) return null;
  const k = m[1].trim();
  return k.startsWith("name:") ? null : k;
}

/** Notes that are combos Ford will not allow -> [{ type, text }] */
function rulesOf(r) {
  const out = [];
  for (const raw of String(r.notes || "").split(";")) {
    const t = raw.trim();
    if (!t || /^key=/.test(t)) continue;
    let m;
    if ((m = /^(?:requires?|required for)\s+(.+)$/i.exec(t))) out.push({ type: "requires", text: m[0] });
    else if ((m = /^(?:not available with|not with)\s+(.+)$/i.exec(t))) out.push({ type: "notAvailableWith", text: m[0] });
    else if ((m = /^only with\s+(.+)$/i.exec(t))) out.push({ type: "onlyWith", text: m[0] });
    else if ((m = /^deletes?\s+(.+)$/i.exec(t))) out.push({ type: "deletes", text: m[0] });
  }
  return out;
}

function aliasesFor(r, kind, key, code) {
  const out = new Set();
  const label = clean(r.item);
  out.add(normalizeOptionKey(label));
  const noCode = normalizeOptionKey(label.replace(/\(\s*\d{3}[A-Z]\s*\)/g, " "));
  if (noCode) out.add(noCode);
  // A vehicle's option line is matched with any "(...)" removed, so a name whose own parenthetical is part of the key ("... (One-Time Purchase)") needs this too.
  const undecorated = normalizeOptionKey(decoration(label));
  if (undecorated) out.add(undecorated);
  if (code) {
    const c = normalizeOptionKey(code);
    for (const a of [c, `equipment group ${c}`, `${c} equipment group`, `${c} package`, `package ${c}`, `order code ${c}`, `option code ${c}`, `pkg ${c}`]) out.add(a);
  }
  if (kind === "package" && key.endsWith(" package")) out.add(key.replace(/ package$/, " pkg"));
  // The Tough Bed spray-in bedliner is the one bedliner that is a factory option: its common spellings, nothing broader.
  if (/tough bed/i.test(label)) for (const a of ["tough bed spray in bedliner", "tough bed bedliner", "spray in bedliner tough bed", "ford tough bed spray in bedliner", "bedliner tough bed", "tough bed"]) out.add(a);
  out.delete(key);
  return [...out].filter(Boolean);
}

function buildCatalog(rows) {
  const trims = {}, drops = {}, conflicts = [], interiorDropped = [], interiorKept = [], keyMismatch = [];
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
      if (drop === "interior color / seat / trim choice") interiorDropped.push(`${r.model} ${r.trim}: ${clean(r.item)} ($${r.price_usd})`);
      continue;
    }
    const label = clean(r.item);
    if (r.subcategory === "Interior") interiorKept.push(`${r.model} ${r.trim}: ${label} ($${r.price_usd})`);
    const code = codeOf(r);
    const key = code ? normalizeOptionKey(code) : normalizeOptionKey(label);
    if (!key) continue;
    const nameKey = /key=name:([^;]+)/.exec(r.notes || "");
    if (nameKey && normalizeOptionKey(nameKey[1]) !== normalizeOptionKey(label)) keyMismatch.push(`${r.model} ${r.trim}: "${label}" vs CSV key "${nameKey[1]}"`);
    if (trims[tk].options[key]) { conflicts.push(`${r.year} ${r.model} ${r.trim}: duplicate "${label}" (kept the first, $${trims[tk].options[key].price}; other $${r.price_usd})`); continue; }
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
    // Feature lines inside a package are not options. A feature that is a content item of exactly ONE kept package/option on this trim rolls up to
    // it (the vehicle lists the feature, the policy records the package), exactly as in the Toyota policies.
    const owners = new Map();
    for (const [k, o] of Object.entries(t.options)) {
      if (o.kind === "paint" || o.kind === "powertrain") continue;
      const items = new Set();
      for (const part of o.contents.split(";")) {
        const inc = part.split(/\bincludes?\b/i);
        const pieces = inc.length > 1 ? inc.slice(1).join(" ").split(/,| and /) : [part];
        for (const piece of pieces) {
          // A content item is a short equipment name. Long pieces and rule text ("not available with...", "requires...", "deletes...") are not.
          if (piece.trim().length > 70 || /\b(?:not available|not with|requires?|deletes?|only with|discount|summary)\b/i.test(piece)) continue;
          const ck = normalizeOptionKey(decoration(piece));
          if (ck.length >= 8 && ck.split(" ").length >= 2) items.add(ck);
        }
      }
      // An accessory-looking content item ("cargo mat", "floor liners") is never evidence of the factory package: it stays an accessory (dealer add-on).
      for (const ck of items) { if (ADDON_RES.some((re) => re.test(ck))) continue; if (!owners.has(ck)) owners.set(ck, new Set()); owners.get(ck).add(k); }
    }
    for (const [ck, ks] of owners) {
      if (ks.size !== 1 || names.has(ck) || taken.has(ck) || (catalogNames[tkey] || new Set()).has(ck)) continue;
      const o = t.options[[...ks][0]];
      (o.features ||= []).push(`^${ck}$`);
    }
    for (const o of Object.values(t.options)) { delete o.contents; if (o.features) o.features.sort(); }
  }
  return { trims, drops, conflicts, interiorDropped, interiorKept, keyMismatch };
}

const all = parseCsv(fs.readFileSync(CSV, "utf8"));
const byModel = new Map();
for (const r of all) { const g = `${r.year}|${r.model}`; if (!byModel.has(g)) byModel.set(g, []); byModel.get(g).push(r); }

const policies = {}, report = { models: [], conflicts: [], interior: [], interiorKept: [], aliases: [], keyMismatch: [], drops: {}, rulesCount: 0, codeKeys: [] };
for (const [g, rows] of [...byModel].sort()) {
  const [year, model] = g.split("|");
  if (!MODEL_NAMES[model]) throw new Error(`CSV has an unexpected model "${model}" - add it to MODEL_NAMES deliberately or remove it from the CSV`);
  const cat = buildCatalog(rows);
  report.conflicts.push(...cat.conflicts); report.interior.push(...cat.interiorDropped); report.interiorKept.push(...cat.interiorKept); report.keyMismatch.push(...cat.keyMismatch);
  for (const [k, v] of Object.entries(cat.drops)) report.drops[k] = (report.drops[k] || 0) + v;
  for (const [from, to] of Object.entries(TRIM_ALIASES[model] || {})) {
    if (!cat.trims[slug(to)]) throw new Error(`${model}: trim alias "${from}" -> "${to}" points at a trim the CSV does not have`);
    if (cat.trims[slug(from)]) throw new Error(`${model}: "${from}" is already a trim in the CSV, so it cannot be an alias`);
    report.aliases.push(`${model}: "${from}" -> ${cat.trims[slug(to)].label}`);
  }
  const models = [...new Set([slug(model), ...MODEL_NAMES[model].map(slug)])];
  policies[`ford|${slug(model)}|${year}`] = {
    source: `docs/ford-2026/ford_lineup_options_by_trim.csv (${year} ${model})`,
    models,
    keepBare: [],
    trimAliases: TRIM_ALIASES[model] || {},
    trimStripOrderCodes: true,
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
  report.models.push({ year, model, models, counts });
}

const md = [];
md.push("# Ford 2026 option policies - generated report", "", "Generated by `scripts/build-ford-option-policy.mjs` from `ford_lineup_options_by_trim.csv`. Do not edit by hand.", "");
md.push("## Model-name mapping (CSV model -> DB `model` spellings the policy matches)", "", "| Year | CSV model | DB spellings matched (normalized) |", "|---|---|---|");
for (const m of report.models) md.push(`| ${m.year} | ${m.model} | ${m.models.join(", ")} |`);
md.push("", "Not covered (untouched): Explorer, F-150 Lightning, Escape, Mustang and every other Ford model; every other model year.", "");
md.push("## Entries per trim (paid packages / paid options / paid powertrain / paid paints / stored rules)", "", "| Year | Model | Trim | Packages | Options | Powertrain | Paints | Rules |", "|---|---|---|---|---|---|---|---|");
for (const m of report.models) for (const c of m.counts) md.push(`| ${m.year} | ${m.model} | ${c.trim} | ${c.packages} | ${c.options} | ${c.powertrain} | ${c.paints} | ${c.rules} |`);
md.push("", `Rules stored (combos Ford will not allow: requires / not available with / only with / deletes): ${report.rulesCount}. They are data under each option, never options.`, "");
md.push("## CSV rows not kept (by rule)", "", ...Object.entries(report.drops).sort().map(([k, v]) => `- ${k}: ${v}`), "");
md.push(`## Interior-tagged options (Ford's configurator subcategory "Interior")`, "", `Kept (${report.interiorKept.length} rows, paid functional options):`, "", ...report.interiorKept.map((x) => `- ${x}`), "", `Dropped (${report.interior.length} rows, interior color / seat / trim choices):`, "", ...report.interior.map((x) => `- ${x}`), "");
md.push("## Trim aliases and trim noise (approved; nothing else is aliased)", "", ...report.aliases.map((x) => `- ${x}`), "- a trailing Ford order code is stripped (`XLT 302A` -> `XLT`, `Big Bend 222A` -> `Big Bend`); a code on its own, or as the first word, is not", "- status words `Demo`, `Fleet`, `In Transit` / `Intransit` are ignored (`XLT Demo` -> `XLT`)", "- `Raptor R` is its own trim and is NOT aliased to `Raptor`", "");
md.push(`## Keys that are Ford package codes (${report.codeKeys.length})`, "", ...report.codeKeys.map((x) => `- ${x}`), "", "Every other entry is keyed on its full normalized name.", "");
md.push("## Judgment calls", "", "- `BlueCruise Hands-Free Highway Driving Equipped (One-Time Purchase)` ($2,495, F-150 Lariat and Tremor) is kept: it is a priced factory package bought once, not a subscription plan. Subscription plans are dropped by name.", "- The default-selected paid paint on a trim (the CSV note \"default-selected paid paint excluded\") is kept at its price: it is a paid paint that the trim's base price leaves out.", "- Paid functional options Ford tags \"Interior\" are kept; interior colors, seats and trim choices are dropped (above).", "- Window-sticker check 2026-10-18 (F-150 XLT): four paid sticker lines are intentionally NOT options. `BlueCruise equip: 1yr+90d plan` ($495) and `Conn Pkg: 1 time 7yr` ($745) are subscriptions / connectivity plans (dropped by name, like the other plans); `Floor liner - tray style` ($200) is an accessory (dealer add-on). `Bedliner-ToughBed Spray-In` ($625) is already the kept factory option `Bedliner – Tough Bed Spray-In`. Added from the same check: F-150 XLT `XLT Black Appearance Package` ($920, a US sticker) and F-150 Lariat `Twin Panel Moonroof` ($1,495, taken from the King Ranch and Raptor rows; a Lariat sticker confirmed it is paid, the US Lariat price is not yet seen). FX4 on XLT, the trailer brake controller on Lariat and Tremor, Twin Panel Moonroof on Platinum, the block heater on Lariat and the 4K Tow Package on Maverick XLT were NOT changed: no US sticker confirmed them.", "- `Interior Protection Package` ($395, Bronco Sport) and `Matte Film Protection Package - Body` ($4,995, Bronco) are listed in the CSV as factory packages, so they are kept. Dealer protection products (paint protection, fabric protection, floor mats, cargo liners) are add-ons and never reach the website. If Paul counts these two factory packages as protection items, add them to the accessory list in the builder.", "");
if (report.keyMismatch.length) md.push("## Name keys that differ from the CSV's own key", "", ...report.keyMismatch.map((c) => `- ${c}`), "");
if (report.conflicts.length) md.push("## Duplicate rows inside one trim (first kept)", "", ...report.conflicts.map((c) => `- ${c}`), "");

const jsonText = `${JSON.stringify(policies, null, 2)}\n`;
const mdText = `${md.join("\n")}\n`;
if (process.argv.includes("--check")) {
  const bad = [];
  if ((fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "") !== jsonText) bad.push(path.relative(root, OUT));
  if ((fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : "") !== mdText) bad.push(path.relative(root, REPORT));
  if (bad.length) { console.error(`out of date: ${bad.join(", ")} - run node scripts/build-ford-option-policy.mjs`); process.exit(1); }
  console.log("ford policy JSON and report are current");
} else {
  fs.writeFileSync(OUT, jsonText);
  fs.writeFileSync(REPORT, mdText);
  console.log(`wrote ${Object.keys(policies).length} policies; ${report.rulesCount} rules; ${report.codeKeys.length} code keys; ${report.interior.length} interior rows dropped; ${report.keyMismatch.length} key mismatches; ${report.conflicts.length} duplicate rows`);
}
