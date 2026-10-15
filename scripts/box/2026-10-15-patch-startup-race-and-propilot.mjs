// Box2 patcher: deals-api startup-race fix (#525) + the ProPILOT label rule in inventoryOptionRows.js (#519), as ANCHORED edits to the box's own files.
// Code only until Paul types GO. Never restarts anything.
//
//   node 2026-10-15-patch-startup-race-and-propilot.mjs [--dir=/opt/trimscout-deals/src] [--apply]
//
// Without --apply it is a DRY RUN: it reads the files, checks every anchor and writes nothing. With --apply it
//   1. requires each anchor ("find") to occur EXACTLY once per file (or the edit to be already applied); any other count aborts with nothing written,
//   2. writes the patched text to <file>.new.mjs, syntax-checks it (node --check) and, for inventoryOptionRows.js, runs the ProPILOT assertions on it,
//   3. copies the original to <file>.bak.<timestamp> (cp -p) and moves the new file into place (same mode), file by file.
// The edits are the real diffs of #525 (ensureInventoryTable: one caller runs the DDL, CREATE OR REPLACE TRIGGER) and #519 (ProPILOT), so the box ends up
// with the same text main has in those regions. Rollback: copy the two .bak files back and restart deals-api.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const DIR = path.resolve(args.dir || "/opt/trimscout-deals/src");
const APPLY = Boolean(args.apply);
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

const EDITS =
[
 {
  "file": "deals_api_server.js",
  "id": "525-wrapper",
  "find": "let inventoryReady = false;\nasync function ensureInventoryTable(pool) {\n  if (inventoryReady) return;\n",
  "replace": "let inventoryReady = false;\nlet inventoryReadyPromise = null;\n// The table / index / trigger DDL runs once per process, by ONE caller: concurrent first requests (the first requests after a restart can arrive together) wait for\n// that run instead of each running the whole sequence — two interleaved DROP TRIGGER / CREATE TRIGGER sequences made one request fail with HTTP 500 \"Trigger ...\n// already exists\" (box2, 2026-10-14). A failed run is forgotten, so the next request retries it from scratch.\nasync function ensureInventoryTable(pool) {\n  if (inventoryReady) return;\n  if (!inventoryReadyPromise) {\n    inventoryReadyPromise = ensureInventoryTableOnce(pool).catch((err) => { inventoryReadyPromise = null; throw err; });\n  }\n  return inventoryReadyPromise;\n}\nasync function ensureInventoryTableOnce(pool) {\n"
 },
 {
  "file": "deals_api_server.js",
  "id": "525-trigger",
  "find": "  // DROP+CREATE (not IF NOT EXISTS) so a trigger body change — like vdp_url_norm below,\n  // added 2026-09-23 for the paste-a-link VIN lookup — actually takes effect on an existing\n  // box after a restart, instead of silently keeping whatever body was first created there.\n  for (const when of [\"INSERT\", \"UPDATE\"]) {\n    await pool.query(`DROP TRIGGER IF EXISTS trg_inv_rev_${when.toLowerCase()}`);\n    await pool.query(`\n      CREATE TRIGGER trg_inv_rev_${when.toLowerCase()} BEFORE ${when} ON dealer_inventory\n",
  "replace": "  // CREATE OR REPLACE (not IF NOT EXISTS) so a trigger body change — like vdp_url_norm below,\n  // added 2026-09-23 for the paste-a-link VIN lookup — actually takes effect on an existing\n  // box after a restart, instead of silently keeping whatever body was first created there.\n  // One statement (MariaDB >= 10.1.4), not DROP then CREATE: no moment without the trigger, so a write that lands\n  // during a restart still fills vin_rev / dealer_name_rev / vdp_url_norm / state, and a second session can't collide.\n  for (const when of [\"INSERT\", \"UPDATE\"]) {\n    await pool.query(`\n      CREATE OR REPLACE TRIGGER trg_inv_rev_${when.toLowerCase()} BEFORE ${when} ON dealer_inventory\n"
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "519-const",
  "find": "const LONG_CAPS_RUN_GLUED_ON = /[a-z][A-Z]{4,}/;\n\n// The rules below were added 2026-10-01.",
  "replace": "const LONG_CAPS_RUN_GLUED_ON = /[a-z][A-Z]{4,}/;\n// The one exact brand spelling that trips the rule above on its own: Nissan's \"ProPILOT\" (a lowercase \"o\" then PILOT). It is blanked before the test, so\n// \"ProPILOT Assist 2.1 Package\" is a normal option name, while \"ProPILOT AssistEXTERIOR20\" (a real glued header) still matches.\nconst PROPILOT = /ProPILOT/g;\n\n// The rules below were added 2026-10-01."
 },
 {
  "file": "inventoryOptionRows.js",
  "id": "519-test",
  "find": "    LONG_CAPS_RUN_GLUED_ON.test(label) ||\n",
  "replace": "    LONG_CAPS_RUN_GLUED_ON.test(label.replace(PROPILOT, \"ProPilot\")) ||\n"
 }
];
for (const e of EDITS) if (e.replace.includes(e.find)) throw new Error(`edit ${e.id}: the anchor is a substring of its own replacement (a second run would apply it twice)`);

const files = [...new Set(EDITS.map((e) => e.file))];
const plan = [];
let abort = false;
for (const f of files) {
  const p = path.join(DIR, f);
  const original = fs.readFileSync(p, "utf8");
  let text = original;
  for (const e of EDITS.filter((x) => x.file === f)) {
    const nFind = count(text, e.find), nRepl = count(text, e.replace);
    let status;
    if (nFind === 1) { text = text.replace(e.find, () => e.replace); status = "will apply"; }
    else if (nFind === 0 && nRepl >= 1) status = "already applied";
    else { status = `ANCHOR PROBLEM: find occurs ${nFind}x, replacement ${nRepl}x`; abort = true; }
    console.log(`${f} :: ${e.id} :: ${status}`);
  }
  plan.push({ f, p, original, text });
}
if (abort) { console.error("ABORT: nothing written."); process.exit(2); }
if (!APPLY) { console.log("DRY RUN ok - nothing written. Re-run with --apply."); process.exit(0); }

// ProPILOT behaviour check on the patched inventoryOptionRows.js (same assertions as test/inventory_option_rows.test.js #519).
const check = async (f, newPath) => {
  execFileSync("node", ["--check", newPath], { stdio: "pipe" });
  if (f === "inventoryOptionRows.js") {
    const m = await import(pathToFileURL(newPath).href + "?v=" + STAMP);
    const kept = m.optionRowsFromOptions([{ name: "SL ProPILOT Assist 2.1 Package" }, { name: "Platinum ProPILOT Assist 2.1 Package" }]).rows.map((r) => r.label);
    if (kept.length !== 2) throw new Error(`ProPILOT packages should be kept, got ${JSON.stringify(kept)}`);
    const dropped = m.optionRowsFromOptions([{ name: "ProPILOT AssistEXTERIOR20" }, { name: "Standard EquipmentMECHANICAL3" }]).rows;
    if (dropped.length !== 0) throw new Error(`glued headers should still be dropped, got ${JSON.stringify(dropped)}`);
  }
};
const staged = [];
try {
  for (const x of plan) {
    if (x.text === x.original) { console.log(`${x.f}: nothing to change`); continue; }
    const newPath = path.join(DIR, x.f.replace(/\.js$/, ".new.mjs"));
    staged.push({ ...x, newPath });
    fs.writeFileSync(newPath, x.text);
    await check(x.f, newPath);
    console.log(`${x.f}: patched copy written and checked (${newPath})`);
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
console.log("DONE. deals-api has NOT been restarted; the new code loads at the next restart.");
