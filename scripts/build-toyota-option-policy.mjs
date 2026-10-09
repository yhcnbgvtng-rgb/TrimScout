// Builds the model-year option policies for the rest of Toyota (2026-2027) from docs/toyota-2026-2027/toyota_2026_2027_options_by_trim.csv:
//   scrapers/lightsail-crawler/src/optionPolicies/toyota-2026-2027.json   the policies (one per model + year)
//   docs/toyota-2026-2027/POLICY_REPORT.md                                model-name map, trim aliases, package counts, RAV4 differences
// Run: node scripts/build-toyota-option-policy.mjs [--check]   (--check exits 1 when either file differs from what this would write)
//
// Same rules as the 2026 RAV4 policy (PR #432), applied per CSV model + year + trim:
//   kept            "Factory package" and "Factory option" rows with price > 0, exterior colors with price > 0, and Drivetrain / Powertrain rows
//                   with price > 0 (AWD as an extra, i-FORCE MAX where it is an extra-cost choice within a trim)
//   not options     price <= 0 or blank (standard / no-cost), no-cost colors, Interior, Base, Cab/Bed (the vehicle's configuration, not an option)
//   dealer add-ons  "Accessory package" rows (whole names) + the known dealer products in optionPolicyCommon.mjs
//   roll-up         a feature line that is a content item of exactly ONE kept package/option on that trim (never expanded the other way)
//   2026 RAV4       NOT generated here: PR #432's policy stays as is; the report lists where this CSV disagrees with it.
//   Mirai           not generated: its single CSV row is "Not buildable", no trims or options.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOptionKey, parseCsv, DEALER_ADDON_PATTERNS, DISCLAIMER_PATTERNS } from "./lib/optionPolicyCommon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(root, "docs/toyota-2026-2027/toyota_2026_2027_options_by_trim.csv");
const OUT = path.join(root, "scrapers/lightsail-crawler/src/optionPolicies/toyota-2026-2027.json");
const REPORT = path.join(root, "docs/toyota-2026-2027/POLICY_REPORT.md");
const RAV4_JSON = path.join(root, "scrapers/lightsail-crawler/src/optionPolicies/toyota-rav4-2026.json");

// CSV model -> the DB `model` spellings it covers (normalizeOptionKey form; the CSV spelling itself is always included).
// implied: a DB spelling that carries a word the CSV puts in the TRIM ("Highlander Hybrid" + trim "XLE" is the CSV's "Hybrid XLE").
// Every line is reported; add a spelling only when the live DB has it.
const MODEL_NAMES = {
  "bZ (bZ4X)": { db: ["bz", "bz4x"] },
  "bZ Woodland": { db: ["bz", "bz4x", "bz4x woodland"] },
  "RAV4 Plug-in Hybrid": { db: ["rav4 prime", "rav4 phev"] },
  "Prius Plug-in Hybrid": { db: ["prius prime", "prius plug in"] },
  "GR Supra": { db: ["supra"] },
  GR86: { db: ["gr 86", "86"] },
  "C-HR": { db: ["chr"] },
  Camry: { db: ["camry hybrid"] }, // the Camry is hybrid-only in 2026; the CSV trims carry no Hybrid word
  Sienna: { db: ["sienna hybrid", "sienna hv"] },
  Sequoia: { db: ["sequoia hybrid", "sequoia hv"] },
  "Crown Signia": { db: ["toyota crown signia"] },
  Crown: { db: ["toyota crown"] },
  Highlander: { db: ["highlander hybrid"], implied: { "highlander hybrid": "hybrid" } },
  "Grand Highlander": { db: ["grand highlander hybrid"], implied: { "grand highlander hybrid": "hybrid" } },
  Corolla: { db: ["corolla hybrid"], implied: { "corolla hybrid": "hybrid" } },
  "Corolla Cross": { db: ["corolla cross hybrid"], implied: { "corolla cross hybrid": "hybrid" } },
  // The i-FORCE MAX hybrid is its own CSV trim ("Limited i-FORCE MAX"); a DB model that says so carries that word.
  Tundra: { db: ["tundra 4wd", "tundra 2wd", "tundra 4wd truck", "tundra 2wd truck", "tundra 4x4", "tundra 4x2", "tundra truck"], implied: { "tundra i force max": "i force max", "tundra hybrid": "i force max", "tundra hybrid max": "i force max" } },
  Tacoma: { db: ["tacoma 4wd", "tacoma 2wd", "tacoma 4x4"], implied: { "tacoma i force max": "i force max", "tacoma hybrid": "i force max" } },
  "4Runner": { db: ["4 runner"], implied: { "4runner i force max": "i force max", "4runner i force max hybrid": "i force max", "4runner hybrid": "i force max" } },
};
// A trim that opens with the model's own name ("bZ Limited", "GR Corolla Premium Plus") is also what a dealer writes without it.
// Only generated when the shortened name is not already a trim that year, and every one is listed in the report.
const TRIM_PREFIXES = ["bz woodland", "bz", "gr corolla", "gr supra", "gr86", "land cruiser"];
const TRIM_NOISE = ["awd", "fwd", "4wd", "2wd", "4x4", "hybrid", "hev", "cvt", "ecvt", "natl", "i force max"];
const TRIM_NOISE_PHRASES = ["front wheel drive", "all wheel drive", "four wheel drive", "two wheel drive", "i force max"];

const decoration = (t) => t.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").replace(/\([^)]*\)/g, " ").replace(/®|™/g, "");
const clean = (t) => t.replace(/®|™/g, "").replace(/\s+/g, " ").trim();
const paid = (r) => Number(r.price_usd) > 0;
const slug = (s) => normalizeOptionKey(s);

function kindOf(r) {
  if (!paid(r)) return null; // standard / no-cost / unknown
  if (r.category === "Factory package") return "package";
  if (r.category === "Factory option") return "option";
  if (r.category === "Exterior color") return "paint";
  if (r.category === "Drivetrain") return "option";
  if (r.category === "Powertrain") return "powertrain";
  return null; // Interior, Base, Cab/Bed, Accessory package
}

function aliasesFor(r, kind, key) {
  const out = new Set();
  const dt = normalizeOptionKey(r.item);
  if (r.category === "Drivetrain") {
    if (/all.?wheel/i.test(r.item)) out.add("awd");
    if (/4.?wheel|four.?wheel/i.test(r.item)) for (const a of ["4wd", "4x4", "4 wheel drive", "four wheel drive"]) out.add(a);
  }
  if (kind === "package" || kind === "option") {
    if (key.endsWith(" package")) out.add(key.replace(/ package$/, " pkg"));
    else if (kind === "package") out.add(`${key} package`);
  }
  if (kind === "paint") { const m = key.match(/^(.*) with (.*) roof$/); if (m) { out.add(`${m[1]} w ${m[2]} roof`); out.add(`${m[1]} two tone ${m[2]} roof`); } }
  out.delete(key); out.delete(dt === key ? "" : "");
  return [...out].map(normalizeOptionKey).filter(Boolean);
}

/** One model-year's catalog: { trims: { key: { label, options } }, accessoryKeys, conflicts } from its CSV rows. */
function buildCatalog(rows) {
  const trims = {}, accessoryKeys = new Set(), conflicts = [];
  for (const t of [...new Set(rows.map((r) => r.trim))]) if (t) trims[slug(t)] = { label: t, options: {} };
  for (const r of rows) {
    if (r.category === "Accessory package") { const k = slug(r.item); if (k) accessoryKeys.add(k); continue; }
    const tk = slug(r.trim);
    const kind = kindOf(r);
    if (!kind || !trims[tk]) continue;
    const label = clean(r.item);
    const key = normalizeOptionKey(label);
    if (!key) continue;
    if (trims[tk].options[key]) { conflicts.push(`${r.year} ${r.model} ${r.trim}: duplicate "${label}" (kept the first, $${trims[tk].options[key].price}; other $${r.price_usd})`); continue; }
    trims[tk].options[key] = { label, kind, price: Number(r.price_usd), aliases: aliasesFor(r, kind, key), contents: r.contents || "" };
  }
  for (const t of Object.values(trims)) {
    const names = new Set(Object.keys(t.options));
    const taken = new Map();
    for (const [k, o] of Object.entries(t.options)) o.aliases = o.aliases.filter((a) => { if (names.has(a) || accessoryKeys.has(a)) return false; if (taken.has(a)) return false; taken.set(a, k); return true; });
    // Feature lines that roll up: a content item of exactly ONE kept entry on this trim, not itself a name/alias/accessory.
    const owners = new Map();
    for (const [k, o] of Object.entries(t.options)) {
      if (o.kind === "paint" || o.kind === "powertrain") continue;
      const items = new Set();
      for (const part of o.contents.split(";")) {
        const inc = part.split(/\bincludes?\b/i);
        const pieces = inc.length > 1 ? inc.slice(1).join(" ").split(/,| and /) : [part];
        for (const piece of pieces) { const ck = normalizeOptionKey(decoration(piece)); if (ck.length >= 8 && ck.split(" ").length >= 2) items.add(ck); }
      }
      for (const ck of items) { if (!owners.has(ck)) owners.set(ck, new Set()); owners.get(ck).add(k); }
    }
    for (const [ck, ks] of owners) {
      if (ks.size !== 1 || names.has(ck) || taken.has(ck) || accessoryKeys.has(ck)) continue;
      const o = t.options[[...ks][0]];
      (o.features ||= []).push(`^${ck}$`);
    }
    for (const o of Object.values(t.options)) { delete o.contents; if (o.features) o.features.sort(); }
  }
  return { trims, accessoryKeys, conflicts };
}

const all = parseCsv(fs.readFileSync(CSV, "utf8"));
const groups = new Map();
for (const r of all) { const g = `${r.year}|${r.model}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }

const policies = {}, report = { models: [], aliases: [], conflicts: [], skipped: [] };
for (const [g, rows] of [...groups].sort()) {
  const [year, model] = g.split("|");
  if (!rows.some((r) => r.trim)) { report.skipped.push(`${year} ${model}: no trims in the CSV (${rows.length} row${rows.length > 1 ? "s" : ""}: "${rows[0].item}") - no policy, untouched`); continue; }
  if (year === "2026" && model === "RAV4") { report.skipped.push("2026 RAV4: not generated - PR #432's policy is kept (see differences below)"); continue; }
  const cat = buildCatalog(rows);
  report.conflicts.push(...cat.conflicts);
  const names = MODEL_NAMES[model] || { db: [] };
  const models = [...new Set([slug(model), ...names.db.map(slug), ...Object.keys(names.implied || {}).map(slug)])];
  const trimAliases = {};
  for (const [tk, t] of Object.entries(cat.trims)) {
    for (const pre of TRIM_PREFIXES) {
      if (!tk.startsWith(`${pre} `)) continue;
      const short = tk.slice(pre.length + 1);
      if (short && !cat.trims[short] && !trimAliases[short]) { trimAliases[short] = tk; report.aliases.push([year, model, short, t.label]); }
    }
  }
  policies[`toyota|${slug(model)}|${year}`] = {
    source: `docs/toyota-2026-2027/toyota_2026_2027_options_by_trim.csv (${year} ${model})`,
    models,
    ...(names.implied ? { modelImplied: names.implied } : {}),
    keepBare: ["siri", "google", "alexa built in"], // bare "unlock" is dropped (a fragment of the standard keyless-entry line)
    trimAliases,
    trimNoise: TRIM_NOISE,
    trimNoisePhrases: TRIM_NOISE_PHRASES,
    disclaimerPatterns: DISCLAIMER_PATTERNS,
    trims: cat.trims,
    dealerAddons: { keys: [...cat.accessoryKeys].sort(), patterns: DEALER_ADDON_PATTERNS },
  };
  const counts = Object.values(cat.trims).map((t) => ({ trim: t.label, packages: Object.values(t.options).filter((o) => o.kind === "package").length, options: Object.values(t.options).filter((o) => o.kind === "option").length, powertrain: Object.values(t.options).filter((o) => o.kind === "powertrain").length, paints: Object.values(t.options).filter((o) => o.kind === "paint").length }));
  report.models.push({ year, model, models, implied: names.implied || null, counts, addons: cat.accessoryKeys.size });
}

// ---- Differences between this CSV and PR #432's 2026 RAV4 policy (the RAV4 policy wins; nothing is overwritten) ----
const rav4Diff = [];
{
  const cat = buildCatalog(all.filter((r) => r.year === "2026" && r.model === "RAV4"));
  const cur = JSON.parse(fs.readFileSync(RAV4_JSON, "utf8"))["toyota|rav4|2026"];
  const trimKeys = new Set([...Object.keys(cat.trims), ...Object.keys(cur.trims)]);
  for (const tk of [...trimKeys].sort()) {
    const a = cat.trims[tk], b = cur.trims[tk];
    if (!a || !b) { rav4Diff.push(`trim "${(a || b).label}" only in ${a ? "the Toyota CSV" : "#432"}`); continue; }
    for (const k of new Set([...Object.keys(a.options), ...Object.keys(b.options)])) {
      const x = a.options[k], y = b.options[k];
      if (!x) rav4Diff.push(`${b.label}: "${y.label}" ($${y.price} ${y.kind}) is in #432 but not in the Toyota CSV`);
      else if (!y) rav4Diff.push(`${a.label}: "${x.label}" ($${x.price} ${x.kind}) is in the Toyota CSV but not in #432`);
      else if (x.price !== y.price || x.kind !== y.kind) rav4Diff.push(`${a.label}: "${x.label}" CSV $${x.price} ${x.kind} vs #432 $${y.price} ${y.kind}`);
    }
    const ak = new Set(Object.keys(cat.trims[tk].options));
    void ak;
  }
  const curAddons = new Set(cur.dealerAddons.keys);
  const csvAddons = cat.accessoryKeys;
  const onlyCsv = [...csvAddons].filter((k) => !curAddons.has(k)), onlyCur = [...curAddons].filter((k) => !csvAddons.has(k));
  if (onlyCsv.length || onlyCur.length) rav4Diff.push(`dealer add-on names: ${onlyCsv.length} only in the Toyota CSV, ${onlyCur.length} only in #432 (accessory lists differ; #432's list is kept)`);
}

const md = [];
md.push("# Toyota 2026-2027 option policies - generated report", "", "Generated by `scripts/build-toyota-option-policy.mjs` from `toyota_2026_2027_options_by_trim.csv`. Do not edit by hand.", "");
md.push("## Model-name mapping (CSV model -> DB `model` spellings the policy matches)", "", "| Year | CSV model | DB spellings matched (normalized) | Implied trim word |", "|---|---|---|---|");
for (const m of report.models) md.push(`| ${m.year} | ${m.model} | ${m.models.join(", ")} | ${m.implied ? Object.entries(m.implied).map(([k, v]) => `${k} -> ${v}`).join("; ") : ""} |`);
md.push("", "## Trim aliases (only where the shortened name is not already a trim that year)", "", "| Year | Model | Alias | Resolves to |", "|---|---|---|---|");
for (const a of report.aliases) md.push(`| ${a.join(" | ")} |`);
md.push("", "Trusted trims are otherwise exactly the CSV's names, plus the same name followed only by AWD/FWD/4WD/2WD/4x4/Hybrid/HEV/CVT/ECVT/Natl/i-FORCE MAX/drivetrain words. The most specific CSV trim always wins (\"Limited i-FORCE MAX AWD\" is \"Limited i-FORCE MAX\", \"XLE Hybrid\" is \"Hybrid XLE\" where the CSV has one).", "");
md.push("## Entries per trim (paid packages / paid options / paid powertrain+drivetrain / paid paints)", "", "| Year | Model | Trim | Packages | Options | Powertrain | Paints |", "|---|---|---|---|---|---|---|");
for (const m of report.models) for (const c of m.counts) md.push(`| ${m.year} | ${m.model} | ${c.trim} | ${c.packages} | ${c.options} | ${c.powertrain} | ${c.paints} |`);
md.push("", "## Not generated", "", ...report.skipped.map((s) => `- ${s}`), "");
md.push("## 2026 RAV4: this CSV vs PR #432 (#432 is kept; listed, not overwritten)", "", ...(rav4Diff.length ? rav4Diff.map((d) => `- ${d}`) : ["- no differences in trims, entries, prices or kinds"]), "");
if (report.conflicts.length) md.push("## Duplicate rows inside one trim (first kept)", "", ...report.conflicts.map((c) => `- ${c}`), "");

const jsonText = `${JSON.stringify(policies, null, 2)}\n`;
const mdText = `${md.join("\n")}\n`;
if (process.argv.includes("--check")) {
  const bad = [];
  if ((fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "") !== jsonText) bad.push(path.relative(root, OUT));
  if ((fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : "") !== mdText) bad.push(path.relative(root, REPORT));
  if (bad.length) { console.error(`out of date: ${bad.join(", ")} - run node scripts/build-toyota-option-policy.mjs`); process.exit(1); }
  console.log("toyota policy JSON and report are current");
} else {
  fs.writeFileSync(OUT, jsonText);
  fs.writeFileSync(REPORT, mdText);
  console.log(`wrote ${Object.keys(policies).length} policies; ${report.aliases.length} trim aliases; ${rav4Diff.length} RAV4 differences; ${report.conflicts.length} duplicate rows`);
}
