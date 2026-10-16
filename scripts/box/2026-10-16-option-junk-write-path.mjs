// Box2 patcher: the global option junk list at write time (PR: option-junk-write-path), as ANCHORED edits to the box's own files.
// Code only until Paul types GO. Never restarts anything. Make no other change.
//
//   node 2026-10-16-option-junk-write-path.mjs [--dir=/opt/trimscout-deals/src] [--src=<dir or URL base holding optionJunkRules.json>] [--apply]
//
// What it changes, and nothing else:
//   inventoryOptionRows.js     + the global junk list engine (compileJunkRules / setJunkRules / globalJunkRuleFor) and the call inside optionRowsFromOptions
//   factoryOptionAllowlist.js  + loadJunkRulesFromEnv / installJunkRulesFromEnv; policyOptionRows passes a "vouched" test so a policy-listed (paid sticker) line is never dropped by the list
//   deals_api_server.js        + one import and one boot line that install the list
//   optionJunkRules.json       NEW data file next to them: the pattern list. Edit it (and restart deals-api) to change what is dropped; no code change.
//
// Without --apply it is a DRY RUN: it reads the files, checks every anchor, stages the patched modules in a temp dir, runs the behaviour checks and writes
// nothing to --dir. With --apply it
//   1. requires each anchor ("find") to occur EXACTLY once per file (or the edit's marker to be present already); any other count aborts with nothing written,
//   2. writes patched copies to <file>.new.mjs, node --check's them, and loads the staged modules together with the JSON in a temp dir: the RAV4 junk lines
//      (Roadside Assistance, Roadside Assistance for 7 Year / 100, Multipoint Point Inspection) must be dropped, the controls kept, a vouched $0 line kept,
//   3. copies each original to <file>.bak.<timestamp> (cp -p), moves the new file into place (same mode), and installs optionJunkRules.json (existing one backed up).
// Takes effect at the next deals-api restart (the start is Paul's call, in an idle window). Turn the list off with OPTION_JUNK_RULES=off at a restart, no file change.
//
// ROLLBACK: cp -p each .bak.<timestamp> back over its file, remove optionJunkRules.json (or restore its .bak), restart deals-api.
//   Quicker and no file change: restart deals-api with OPTION_JUNK_RULES=off (the list is then not installed; everything runs as before).
//   Rows already written stay as written (this patch has no data step); a car re-synced afterwards gets the rules of the then-current code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const DIR = path.resolve(args.dir || "/opt/trimscout-deals/src");
const APPLY = Boolean(args.apply);
const SRC = String(args.src || "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src");
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

const EDITS =
[
 {
  "file": "inventoryOptionRows.js",
  "id": "junk-engine",
  "find": "/**\n * @param {unknown} options\n * @param {{ resolveKey?: (key: string) => ({ key: string, label: string } | null) }} [opts]",
  "replace": "// ---- Global junk list (data-driven; src/optionJunkRules.json) ----------------------------------------\n// Applied at write time to EVERY car's option lines, policy or not: roadside assistance, inspections, warranties, maintenance/service\n// plans, subscriptions and trials, fees, and $0 / standard lines. Off until a compiled list is installed (setJunkRules), so importing this\n// module alone changes nothing. The list is pure data (patterns + one zero-price switch), loaded by factoryOptionAllowlist.js's\n// loadJunkRulesFromEnv; this file stays free of fs so the website bundle is unaffected.\nlet activeJunkRules = null;\n\n/** Raw JSON -> { version, rules: [{ name, res }], zeroPrice: { enabled, exemptCodes }, errors }. A pattern that does not compile is skipped and listed in errors. */\nexport function compileJunkRules(raw) {\n  const errors = [];\n  const rules = [];\n  for (const r of Array.isArray(raw?.rules) ? raw.rules : []) {\n    const res = [];\n    for (const p of Array.isArray(r?.patterns) ? r.patterns : []) {\n      try { res.push(new RegExp(String(p), \"i\")); } catch (e) { errors.push(`${r?.name || \"?\"}: ${p}: ${e.message}`); }\n    }\n    if (r?.name && res.length) rules.push({ name: String(r.name), res });\n  }\n  const z = raw?.zeroPrice || {};\n  const exemptCodes = new Set((Array.isArray(z.exemptCodes) ? z.exemptCodes : []).map((c) => String(c).trim().toUpperCase()));\n  return { version: String(raw?.version || \"\"), rules, zeroPrice: { enabled: z.enabled === true, exemptCodes }, errors };\n}\n\nexport function setJunkRules(compiled) { activeJunkRules = compiled && (compiled.rules?.length || compiled.zeroPrice?.enabled) ? compiled : null; }\nexport function getJunkRules() { return activeJunkRules; }\n\nconst isExplicitZero = (price) => price === 0 || (typeof price === \"string\" && /^\\$?0+(?:\\.0+)?$/.test(price.trim()));\n\n/** The global junk rule one option line trips (\"roadside\", ..., \"zero-price\"), or null. `label` is the (already split) text; `option` carries price and code. */\nexport function globalJunkRuleFor(label, option, rules = activeJunkRules) {\n  if (!rules) return null;\n  const text = String(label || \"\").replace(/^[^a-z0-9]+/i, \"\");\n  for (const r of rules.rules) if (r.res.some((re) => re.test(text))) return r.name;\n  const z = rules.zeroPrice;\n  if (z?.enabled && option && isExplicitZero(option.price) && !z.exemptCodes.has(String(option.code ?? \"\").trim().toUpperCase())) return \"zero-price\";\n  return null;\n}\n\n/**\n * @param {unknown} options\n * @param {{ resolveKey?: (key: string) => ({ key: string, label: string } | null), protect?: (label: string, option: object) => boolean, junkRules?: object | null }} [opts]\n *   protect: a line it vouches for (a model-policy entry) is never dropped by the global junk list. junkRules: overrides the installed list (null = none).",
  "marker": "let activeJunkRules = null;"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "junk-opts",
  "find": "  const resolveKey = typeof opts.resolveKey === \"function\" ? opts.resolveKey : null;\n",
  "replace": "  const resolveKey = typeof opts.resolveKey === \"function\" ? opts.resolveKey : null;\n  const protect = typeof opts.protect === \"function\" ? opts.protect : null;\n  const junkRules = \"junkRules\" in opts ? opts.junkRules : activeJunkRules;\n",
  "marker": "const junkRules = \"junkRules\" in opts"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "junk-apply",
  "find": "      const canonical = resolveKey ? resolveKey(key) : null;\n",
  "replace": "      const canonical = resolveKey ? resolveKey(key) : null;\n      // Global junk list. A vouched factory option (make allowlist hit, or the caller's protect: a model-policy entry) is never dropped by it.\n      const junkRule = junkRules ? globalJunkRuleFor(part, parts.length === 1 ? o : { ...o, price: null }, junkRules) : null;\n      if (junkRule && !canonical && !(protect && protect(part, o))) {\n        junkDropped++;\n        dropped.push({ label: part, rule: `junk:${junkRule}` });\n        continue;\n      }\n",
  "marker": "// Global junk list. A vouched"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "import",
  "find": "import { normalizeOptionKey, optionRowsFromOptions } from \"./inventoryOptionRows.js\";",
  "replace": "import { normalizeOptionKey, optionRowsFromOptions, compileJunkRules, setJunkRules } from \"./inventoryOptionRows.js\";",
  "marker": "compileJunkRules, setJunkRules }"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "policy-vouch",
  "find": "  const base = optionRowsFromOptions(options); // the existing junk/sentence/split rules still run first, unchanged\n  const out = { rows: [], dealerAddons: [], dropped: [...base.dropped], junkDropped: base.junkDropped, repaired: base.repaired, outcomes: base.dropped.map((d) => ({ label: d.label, outcome: \"dropped\", rule: d.rule })) };\n  const resolved = resolvePolicyTrim(policy, vehicle.trim, vehicle.model);\n  const trim = resolved ? resolved.trim : null;\n",
  "replace": "  const resolved = resolvePolicyTrim(policy, vehicle.trim, vehicle.model);\n  const trim = resolved ? resolved.trim : null;\n  // The existing junk/sentence/split rules still run first, unchanged. The global junk list (optionJunkRules.json) runs with them, but never\n  // on a line this trim's policy vouches for (an exact entry by name or order code): a paid sticker line is never removed by it.\n  const vouched = (label, o) => {\n    if (!trim) return false;\n    const cleaned = normalizeOptionKey(decoration(label));\n    const colonHead = label.includes(\":\") ? normalizeOptionKey(decoration(label.split(\":\")[0])) : null;\n    return Boolean(trim.index.get(cleaned) || (colonHead && trim.index.get(colonHead)) || byOrderCode(policy, trim, o && o.code));\n  };\n  const base = optionRowsFromOptions(options, { protect: vouched });\n  const out = { rows: [], dealerAddons: [], dropped: [...base.dropped], junkDropped: base.junkDropped, repaired: base.repaired, outcomes: base.dropped.map((d) => ({ label: d.label, outcome: \"dropped\", rule: d.rule })) };\n",
  "marker": "const vouched = (label, o)"
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "junk-loader",
  "find": "/** Reads the bundled policy files",
  "replace": "const DEFAULT_JUNK_RULES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), \"optionJunkRules.json\");\n\n/**\n * The global junk list (optionJunkRules.json, or OPTION_JUNK_RULES_PATH), compiled; null when OPTION_JUNK_RULES=off, the file is missing or\n * unreadable (logged, never thrown: a bad file must not stop deals-api booting). Patterns that do not compile are skipped and logged.\n */\nexport function loadJunkRulesFromEnv(env = process.env, log = console) {\n  if (String(env.OPTION_JUNK_RULES || \"\").toLowerCase() === \"off\") return null;\n  const file = env.OPTION_JUNK_RULES_PATH || DEFAULT_JUNK_RULES_PATH;\n  try {\n    const compiled = compileJunkRules(JSON.parse(fs.readFileSync(file, \"utf8\")));\n    for (const e of compiled.errors) log.warn?.(`[options] junk pattern skipped: ${e}`);\n    return compiled;\n  } catch (e) {\n    log.warn?.(`[options] junk rules not loaded (${file}): ${e.message}`);\n    return null;\n  }\n}\n\n/** Installs the list for this process (the write path, the policy engine and the backfills all read it). Returns what was installed. */\nexport function installJunkRulesFromEnv(env = process.env, log = console) {\n  const compiled = loadJunkRulesFromEnv(env, log);\n  setJunkRules(compiled);\n  return compiled;\n}\n\n/** Reads the bundled policy files",
  "marker": "export function loadJunkRulesFromEnv"
 },
 {
  "file": "deals_api_server.js",
  "id": "boot-install",
  "find": "const OPTION_CATALOG_MODE = catalogModeFromEnv();\n",
  "replace": "import { installJunkRulesFromEnv } from \"./factoryOptionAllowlist.js\"; // hoisted; kept next to its use so the box patch needs no knowledge of the import line above\nconst OPTION_CATALOG_MODE = catalogModeFromEnv();\n// Global write-time junk list (src/optionJunkRules.json; OPTION_JUNK_RULES=off or OPTION_JUNK_RULES_PATH=<file> to change it). Applies to every car, policy or not.\nconst OPTION_JUNK_RULES = installJunkRulesFromEnv();\nconsole.log(OPTION_JUNK_RULES ? `[options] junk rules ${OPTION_JUNK_RULES.version}: ${OPTION_JUNK_RULES.rules.length} rules, zero-price ${OPTION_JUNK_RULES.zeroPrice.enabled ? \"on\" : \"off\"}` : \"[options] junk rules off\");\n",
  "marker": "installJunkRulesFromEnv()"
 }
];
// The find of an edit may be a prefix of its replacement, so "already applied" is decided by the marker, not by the anchor.
for (const e of EDITS) if (e.find.includes(e.marker) || !e.replace.includes(e.marker)) throw new Error(`edit ${e.id}: marker must be in the replacement and not in the anchor`);

const JSON_NAME = "optionJunkRules.json";
const readJson = async () => (/^https?:/.test(SRC) ? (await fetch(`${SRC}/${JSON_NAME}`).then((r) => { if (!r.ok) throw new Error(`${JSON_NAME}: HTTP ${r.status}`); return r.text(); })) : fs.readFileSync(path.join(SRC, JSON_NAME), "utf8"));
const jsonText = await readJson();
JSON.parse(jsonText);

const files = [...new Set(EDITS.map((e) => e.file))];
const plan = [];
let abort = false;
for (const f of files) {
  const p = path.join(DIR, f);
  const original = fs.readFileSync(p, "utf8");
  let text = original;
  for (const e of EDITS.filter((x) => x.file === f)) {
    const nFind = count(text, e.find), nMark = count(text, e.marker);
    let status;
    if (nMark >= 1) status = nMark === 1 ? "already applied" : `MARKER PROBLEM: marker occurs ${nMark}x`;
    else if (nFind === 1) { text = text.replace(e.find, () => e.replace); status = "will apply"; }
    else status = `ANCHOR PROBLEM: find occurs ${nFind}x, marker ${nMark}x`;
    if (/PROBLEM/.test(status)) abort = true;
    console.log(`${f} :: ${e.id} :: ${status}`);
  }
  plan.push({ f, p, original, text });
}
if (abort) { console.error("ABORT: nothing written."); process.exit(2); }

// Stage the patched modules together with the JSON in a temp dir and exercise them.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "junk-stage-"));
const verify = async () => {
  for (const x of plan) fs.writeFileSync(path.join(stage, x.f.replace(/\.js$/, ".mjs")), x.text);
  fs.writeFileSync(path.join(stage, JSON_NAME), jsonText);
  for (const x of plan) execFileSync("node", ["--check", path.join(stage, x.f.replace(/\.js$/, ".mjs"))], { stdio: "pipe" });
  // The two option modules import each other and optionSentenceFilter by their .js names: stage them under those names.
  for (const f of ["inventoryOptionRows.js", "factoryOptionAllowlist.js"]) fs.writeFileSync(path.join(stage, f), plan.find((x) => x.f === f).text);
  fs.copyFileSync(path.join(DIR, "optionSentenceFilter.js"), path.join(stage, "optionSentenceFilter.js"));
  const rows = await import(pathToFileURL(path.join(stage, "inventoryOptionRows.js")).href);
  const allow = await import(pathToFileURL(path.join(stage, "factoryOptionAllowlist.js")).href);
  const log = { warn(m) { throw new Error("junk rules did not load cleanly: " + m); } };
  const compiled = allow.installJunkRulesFromEnv({ OPTION_JUNK_RULES_PATH: path.join(stage, JSON_NAME) }, log);
  if (!compiled || compiled.errors.length) throw new Error("junk rules did not compile");
  const names = (o, opt) => rows.optionRowsFromOptions(o, opt).rows.map((r) => r.label);
  const junk = ["Roadside Assistance", "Roadside Assistance for 7 Year / 100", "Multipoint Point Inspection"];
  const keep = ["Weather Package", "Blind Spot Monitor"];
  const got = names([...junk, ...keep].map((name) => ({ name })));
  if (JSON.stringify(got) !== JSON.stringify(keep)) throw new Error(`junk list check failed: kept ${JSON.stringify(got)}`);
  if (names([{ name: "Rear Spoiler", price: 0 }, { name: "Roof Rails" }]).join() !== "Roof Rails") throw new Error("zero-price check failed");
  if (names([{ name: "Rear Spoiler", price: 0 }], { resolveKey: (k) => (k === "rear spoiler" ? { key: k, label: "Rear Spoiler" } : null) }).join() !== "Rear Spoiler") throw new Error("vouched line was dropped");
  rows.setJunkRules(null);
  if (names(junk.map((name) => ({ name }))).length !== 3) throw new Error("with no list installed the module must behave as before");
  console.log("staged modules load; junk examples dropped, controls and a vouched $0 line kept, off-switch behaves");
};
try { await verify(); } catch (err) { console.error(`ABORT (nothing written to ${DIR}): ${err.message}`); fs.rmSync(stage, { recursive: true, force: true }); process.exit(3); }
fs.rmSync(stage, { recursive: true, force: true });
if (!APPLY) { console.log("DRY RUN ok - nothing written. Re-run with --apply."); process.exit(0); }

const staged = [];
try {
  for (const x of plan) {
    if (x.text === x.original) { console.log(`${x.f}: nothing to change`); continue; }
    const newPath = path.join(DIR, x.f.replace(/\.js$/, ".new.mjs"));
    staged.push({ ...x, newPath });
    fs.writeFileSync(newPath, x.text);
    execFileSync("node", ["--check", newPath], { stdio: "pipe" });
  }
} catch (err) {
  for (const x of staged) fs.rmSync(x.newPath, { force: true });
  console.error(`ABORT (originals untouched, temp files removed): ${err.message}`);
  process.exit(3);
}
for (const x of staged) {
  const bak = `${x.p}.bak.${STAMP}`;
  fs.copyFileSync(x.p, bak); fs.chmodSync(bak, fs.statSync(x.p).mode);
  fs.chmodSync(x.newPath, fs.statSync(x.p).mode);
  fs.renameSync(x.newPath, x.p);
  console.log(`${x.f}: backup ${bak}; patched file in place. Rollback: cp -p ${bak} ${x.p}`);
}
const jp = path.join(DIR, JSON_NAME);
if (fs.existsSync(jp)) { fs.copyFileSync(jp, `${jp}.bak.${STAMP}`); console.log(`${JSON_NAME}: existing file backed up to ${jp}.bak.${STAMP}`); }
fs.writeFileSync(jp + ".new", jsonText); fs.renameSync(jp + ".new", jp);
console.log(`${JSON_NAME}: installed (${jp}). Rollback: rm it, or restore the .bak.`);
console.log("DONE. deals-api has NOT been restarted; the new code loads at the next restart (OPTION_JUNK_RULES=off at that restart keeps the list off).");
