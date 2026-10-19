// Box2 patcher: the nightly sync cleans what it writes (PR: sync-option-clean), as ANCHORED edits to the box's own files.
// Code only until Paul types GO. Never restarts anything. Makes no other change.
//
//   node 2026-10-19-sync-option-clean.mjs [--dir=/opt/trimscout-deals/src] [--src=<dir or URL base holding syncOptionClean.js>] [--apply]
//
// What it changes, and nothing else:
//   syncOptionClean.js         NEW module next to the others: the one decision (policy + junk list + exact-junk labels + paid lines) for options_json and the stored rows
//   factoryOptionAllowlist.js  + loadSyncAllowlist (env-listed policies PLUS every bundled optionPolicies/*.json; OPTION_BUNDLED_POLICIES=off for the env list only)
//   deals_api_server.js        handleInventoryBulk: options_json carries the cleaned list; exact-junk rows are purged on cars the policy cannot read (blank / untrusted
//                              trim); a stored paid line of the car's own trim survives a night that no longer lists it; the response gains optionExactJunkPurged;
//                              OPTIONS_JSON_CLEAN=full|off changes options_json (default junk: the payload minus junk lines; rows stay cleaned in every mode).
// Prerequisite: the junk-list patch (2026-10-16-option-junk-write-path.mjs) and the Ford policy file are already installed; this refuses to run otherwise.
//
// Without --apply it is a DRY RUN: it reads the files, checks every anchor (each "find" must occur EXACTLY once, or the edit's marker must already be there),
// stages the patched modules in a temp dir, loads them and runs the behaviour checks, and writes nothing to --dir. With --apply it
//   1. writes patched copies to <file>.new.mjs and node --check's them,
//   2. copies each original to <file>.bak.<timestamp> (cp -p), moves the new file into place (same mode), and installs syncOptionClean.js (existing one backed up).
// Takes effect at the next deals-api restart: `pm2 restart deals-api` (no --update-env; the new code needs no new environment). The start is Paul's call, idle window only.
//
// ROLLBACK: cp -p each .bak.<timestamp> back over its file, rm syncOptionClean.js (or restore its .bak), `pm2 restart deals-api`. Rows already written stay as written.
//   No file change: `OPTIONS_JSON_CLEAN=off OPTION_BUNDLED_POLICIES=off pm2 restart deals-api --update-env` runs the old behaviour for options_json and policies
//   (the exact-junk purge and paid-line keeping still run; both only ever remove exact-junk rows / keep a paid line).
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
  "file": "deals_api_server.js",
  "id": "srv-1",
  "find": "import { loadAllowlistFromEnv, resolveAllowlisted, hasAllowlistFor, catalogModeFromEnv, policyFacetRows, policyApiOptions } from \"./factoryOptionAllowlist.js\";",
  "replace": "import { loadSyncAllowlist, resolveAllowlisted, hasAllowlistFor, catalogModeFromEnv, policyFacetRows, policyApiOptions } from \"./factoryOptionAllowlist.js\";\nimport { cleanOptionsForWrite, staleExactJunkKeys, keepPaidStoredRows } from \"./syncOptionClean.js\";",
  "marker": "import { cleanOptionsForWrite, staleExactJunkKeys, keepPaidStoredRows }"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-2",
  "find": "= loadAllowlistFromEnv();",
  "replace": "= loadSyncAllowlist(); // env-listed policies plus every bundled one (OPTION_BUNDLED_POLICIES=off for the env list only)",
  "marker": "= loadSyncAllowlist();"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-3",
  "find": "const OPTIONS_DIFF_WRITE = process.env.INVENTORY_OPTIONS_DIFF_WRITE !== \"0\";",
  "replace": "const OPTIONS_DIFF_WRITE = process.env.INVENTORY_OPTIONS_DIFF_WRITE !== \"0\";\n// options_json (what /api/inventory returns and the re-clean re-reads): \"junk\" (default) = the payload minus junk-list / exact-junk lines, so a later policy change can still be\n// re-derived from it; \"full\" = a trusted policy-covered car stores the policy result instead; \"off\" = the payload as sent. The stored option rows are cleaned the same way in every mode.\nconst OPTIONS_JSON_CLEAN = [\"full\", \"off\"].includes(String(process.env.OPTIONS_JSON_CLEAN || \"\").toLowerCase()) ? String(process.env.OPTIONS_JSON_CLEAN).toLowerCase() : \"junk\";",
  "marker": "const OPTIONS_JSON_CLEAN = ["
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-4",
  "find": "let upserted = 0, skipped = 0, optionSetsReplaced = 0,",
  "replace": "let optionExactJunkPurged = 0;\n  let upserted = 0, skipped = 0, optionSetsReplaced = 0,",
  "marker": "let optionExactJunkPurged = 0;"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-5",
  "find": "    const values = chunk.map((v) => [v.vin.trim().toUpperCase(),",
  "replace": "    // The same decision the re-clean tool makes, once per car: options_json is the policy / junk-cleaned list (OPTIONS_JSON_CLEAN=full|off to change it).\n    const cleaned = new Map(chunk.map((v) => [v, cleanOptionsForWrite(OPTION_ALLOWLIST, { make: normalizeMakeForWrite({ make: v.make, vin: v.vin, model: v.model }), model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) }, v.options, { jsonMode: OPTIONS_JSON_CLEAN })]));\n    const values = chunk.map((v) => [v.vin.trim().toUpperCase(),",
  "marker": "const cleaned = new Map(chunk.map"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-6",
  "find": "INV_JSON_STR(v.options, 200000)",
  "replace": "INV_JSON_STR(cleaned.get(v).optionsJson, 200000)",
  "marker": "cleaned.get(v).optionsJson"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-7",
  "find": "      const desired = [];\n",
  "replace": "      const desired = [];\n      const unreadable = []; // policy-covered cars with a blank / untrusted trim: stored rows stay, except exact-junk lines (below)\n",
  "marker": "const unreadable = [];"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-8",
  "find": "        if (pol && pol.skip) { optionSetsKept++; continue; }",
  "replace": "        if (pol && pol.skip) { optionSetsKept++; unreadable.push({ vin, dealerId, pair: pairKey(vin, dealerId) }); continue; }",
  "marker": "unreadable.push({ vin, dealerId"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-9",
  "find": "        desired.push({ vin, dealerId, pair: pairKey(vin, dealerId), rows: facetRows });",
  "replace": "        desired.push({ vin, dealerId, pair: pairKey(vin, dealerId), rows: facetRows, paidVehicle: pol && pol.rows ? { make, model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) } : null });",
  "marker": "paidVehicle: pol && pol.rows"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-10",
  "find": "        const { changed, unchanged } = diffOptionSets(desired, existing);",
  "replace": "        // A paid sticker line of the car's own trim that tonight's payload no longer lists stays (same rule as the re-clean).\n        for (const d of desired) if (d.paidVehicle) d.rows = keepPaidStoredRows(OPTION_ALLOWLIST, d.paidVehicle, d.rows, existing.get(d.pair));\n        const { changed, unchanged } = diffOptionSets(desired, existing);",
  "marker": "keepPaidStoredRows(OPTION_ALLOWLIST, d.paidVehicle"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-11",
  "find": "      timings.optionsMs += performance.now() - tOptions;\n    }",
  "replace": "      // Exact-junk lines (OPTION PACKAGES, Creators, Exp, Title, dates ...) are removed even from cars the policy cannot read; their other rows are not touched.\n      if (unreadable.length) optionExactJunkPurged += await purgeExactJunkRows(pool, unreadable);\n      timings.optionsMs += performance.now() - tOptions;\n    }",
  "marker": "optionExactJunkPurged += await purgeExactJunkRows"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-12",
  "find": "optionRowsWritten, optionJunkDropped, priceGuarded, timings });",
  "replace": "optionRowsWritten, optionJunkDropped, optionExactJunkPurged, priceGuarded, timings });",
  "marker": "optionJunkDropped, optionExactJunkPurged, priceGuarded"
 },
 {
  "file": "deals_api_server.js",
  "id": "srv-13",
  "find": "// GET /api/inventory/vin/:vin \u2014 every store that has listed the VIN",
  "replace": "// Deletes the exact-junk rows (syncOptionClean.staleExactJunkKeys) of cars whose policy could not read their trim. One PK-range read per car, then one\n// DELETE by full primary key per batch, sorted like every other writer here. Returns the rows deleted.\nasync function purgeExactJunkRows(pool, cars) {\n  const existing = await selectExistingOptionRows(pool, cars);\n  const doomed = [];\n  for (const c of cars) for (const r of staleExactJunkKeys(existing.get(c.pair))) doomed.push([c.vin, c.dealerId, r.key]);\n  doomed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] !== b[1] ? a[1] - b[1] : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));\n  for (let i = 0; i < doomed.length; i += 200) {\n    const part = doomed.slice(i, i + 200);\n    await pool.query(`DELETE FROM dealer_inventory_options WHERE ${part.map(() => \"(vin = ? AND dealer_id = ? AND canonical_key = ?)\").join(\" OR \")}`, part.flat());\n  }\n  return doomed.length;\n}\n\n// GET /api/inventory/vin/:vin \u2014 every store that has listed the VIN",
  "marker": "async function purgeExactJunkRows("
 },
 {
  "file": "factoryOptionAllowlist.js",
  "id": "sync-allowlist",
  "find": "// ---- Model-scoped factory-option policy",
  "replace": "/**\n * What the nightly sync loads: everything loadAllowlistFromEnv loads PLUS every bundled model policy (BUNDLED_MODEL_POLICY_PATHS, the same 16 files the\n * re-clean tool uses), so the sync can never run with fewer makes than the re-clean. A scope listed by OPTION_MODEL_POLICY_PATH wins over the bundled\n * one with the same scope; a bundled file that is missing on this box is skipped and named in `error` (the rest still load). OPTION_BUNDLED_POLICIES=off\n * loads exactly what loadAllowlistFromEnv loads.\n */\nexport function loadSyncAllowlist(env = process.env) {\n  if (String(env.OPTION_BUNDLED_POLICIES || \"\").toLowerCase() === \"off\") return loadAllowlistFromEnv(env);\n  const makePath = String(env.OPTION_ALLOWLIST_PATH || \"\").trim();\n  const errors = [];\n  let rawMakes = null, rawModels = {};\n  if (makePath) { try { rawMakes = JSON.parse(fs.readFileSync(makePath, \"utf8\")); } catch (err) { errors.push(`${makePath}: ${err.message}`); } }\n  const bundled = {};\n  for (const f of BUNDLED_MODEL_POLICY_PATHS) {\n    try { Object.assign(bundled, JSON.parse(fs.readFileSync(f, \"utf8\"))); } catch (err) { errors.push(`${path.basename(f)}: ${err.code === \"ENOENT\" ? \"not installed on this box\" : err.message}`); }\n  }\n  for (const f of String(env.OPTION_MODEL_POLICY_PATH || \"\").split(\",\").map((x) => x.trim()).filter(Boolean)) {\n    try { rawModels = { ...rawModels, ...JSON.parse(fs.readFileSync(f, \"utf8\")) }; } catch (err) { errors.push(`${f}: ${err.message}`); }\n  }\n  const models = { ...bundled, ...rawModels };\n  return { allowlist: Object.keys(models).length || rawMakes ? buildAllowlist(rawMakes, Object.keys(models).length ? models : null) : EMPTY_ALLOWLIST, error: errors.join(\"; \") || null };\n}\n\n// ---- Model-scoped factory-option policy",
  "marker": "export function loadSyncAllowlist"
 }
]
;
for (const e of EDITS) if (e.find.includes(e.marker) || !e.replace.includes(e.marker)) throw new Error(`edit ${e.id}: marker must be in the replacement and not in the anchor`);

const NEW_MODULE = "syncOptionClean.js";
const readSrc = async (rel) => (/^https?:/.test(SRC) ? (await fetch(`${SRC}/${rel}`).then((r) => { if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`); return r.text(); })) : fs.readFileSync(path.join(SRC, rel), "utf8"));
const moduleText = await readSrc(NEW_MODULE);

// ---- prerequisites on the box ----
const need = [["optionJunkRules.json", "the junk list"], ["inventoryOptionRows.js", "the option rows module"], ["factoryOptionAllowlist.js", "the allowlist module"], ["optionPolicies/ford-2026.json", "the Ford policy"], ["optionSentenceFilter.js", "the sentence filter"]];
for (const [f, what] of need) if (!fs.existsSync(path.join(DIR, f))) { console.error(`ABORT: ${what} (${path.join(DIR, f)}) is missing - is --dir the box's src directory? Nothing written.`); process.exit(2); }
const rowsSrc = fs.readFileSync(path.join(DIR, "inventoryOptionRows.js"), "utf8");
if (!/export function getJunkRules/.test(rowsSrc)) { console.error("ABORT: inventoryOptionRows.js has no getJunkRules - apply 2026-10-16-option-junk-write-path.mjs first. Nothing written."); process.exit(2); }
const alSrc = fs.readFileSync(path.join(DIR, "factoryOptionAllowlist.js"), "utf8");
if (!/export const BUNDLED_MODEL_POLICY_PATHS/.test(alSrc)) { console.error("ABORT: factoryOptionAllowlist.js has no BUNDLED_MODEL_POLICY_PATHS. Nothing written."); process.exit(2); }
console.log(`policy files on the box: ${fs.readdirSync(path.join(DIR, "optionPolicies")).filter((f) => f.endsWith(".json")).length} (.json) in ${path.join(DIR, "optionPolicies")}`);

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
if (abort) { console.error("ABORT: nothing written. (The box's file differs from the repo's at that anchor: send me the lines around it.)"); process.exit(2); }

// Stage the patched modules in a temp dir and exercise them.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "syncclean-stage-"));
const verify = async () => {
  for (const x of plan) fs.writeFileSync(path.join(stage, x.f.replace(/\.js$/, ".mjs")), x.text);
  execFileSync(process.execPath, ["--check", path.join(stage, "deals_api_server.mjs")], { stdio: "pipe" });
  for (const f of ["inventoryOptionRows.js", "optionSentenceFilter.js", "optionJunkRules.json"]) fs.copyFileSync(path.join(DIR, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, "factoryOptionAllowlist.js"), plan.find((x) => x.f === "factoryOptionAllowlist.js").text);
  fs.writeFileSync(path.join(stage, NEW_MODULE), moduleText);
  fs.symlinkSync(path.join(DIR, "optionPolicies"), path.join(stage, "optionPolicies"));
  const al = await import(pathToFileURL(path.join(stage, "factoryOptionAllowlist.js")).href);
  const sc = await import(pathToFileURL(path.join(stage, NEW_MODULE)).href);
  const log = { warn(m) { throw new Error("junk rules did not load cleanly: " + m); } };
  const compiled = al.installJunkRulesFromEnv({ OPTION_JUNK_RULES_PATH: path.join(stage, "optionJunkRules.json") }, log);
  if (!compiled || compiled.errors.length) throw new Error("junk rules did not compile");
  const { allowlist, error } = al.loadSyncAllowlist({});
  console.log(`loadSyncAllowlist: ${allowlist.models.size} policy scopes${error ? `; not loaded: ${error}` : ""}`);
  if (!allowlist.models.size) throw new Error("no policies loaded");
  const ford = { make: "Ford", model: "F-150", year: 2026, trim: "XLT" };
  const lines = [{ name: "XLT Black Appearance Package", code: "X1", price: 920 }, { name: "OPTION PACKAGES" }, { name: "Exp" }, { name: "Title" }, { name: "Creators" }, { name: "Cruise Control" }];
  const names = (r) => r.optionsJson.map((o) => o.name).join("|");
  const trusted = sc.cleanOptionsForWrite(allowlist, ford, lines);
  if (names(trusted) !== "XLT Black Appearance Package|Cruise Control") throw new Error(`trusted Ford car: options_json would be [${names(trusted)}]`);
  const full = sc.cleanOptionsForWrite(allowlist, ford, lines, { jsonMode: "full" });
  if (names(full) !== "XLT Black Appearance Package") throw new Error(`trusted Ford car, full mode: options_json would be [${names(full)}]`);
  const blank = sc.cleanOptionsForWrite(allowlist, { ...ford, trim: "" }, lines);
  if (names(blank) !== "XLT Black Appearance Package|Cruise Control") throw new Error(`blank-trim Ford car: options_json would be [${names(blank)}]`);
  const paid = sc.keepPaidStoredRows(allowlist, ford, [], [{ key: "xlt black appearance package", label: "XLT Black Appearance Package", code: null }, { key: "cruise control", label: "Cruise Control", code: null }]);
  if (paid.length !== 1) throw new Error("the stored paid line was not kept");
  console.log("staged modules load; trusted Ford car -> raw minus junk lines (full mode: policy result), blank-trim car -> only exact junk dropped, a stored paid line is kept");
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
    execFileSync(process.execPath, ["--check", newPath], { stdio: "pipe" });
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
const mp = path.join(DIR, NEW_MODULE);
if (fs.existsSync(mp) && fs.readFileSync(mp, "utf8") === moduleText) console.log(`${NEW_MODULE}: already installed, unchanged.`);
else {
  if (fs.existsSync(mp)) { fs.copyFileSync(mp, `${mp}.bak.${STAMP}`); console.log(`${NEW_MODULE}: existing file backed up to ${mp}.bak.${STAMP}`); }
  fs.writeFileSync(mp + ".new", moduleText); fs.chmodSync(mp + ".new", 0o664); fs.renameSync(mp + ".new", mp);
  console.log(`${NEW_MODULE}: installed (${mp}). Rollback: rm it, or restore the .bak.`);
}
console.log("DONE. deals-api has NOT been restarted; the new code loads at the next restart (pm2 restart deals-api, no --update-env).");
