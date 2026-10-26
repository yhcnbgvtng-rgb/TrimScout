// Box2 patcher: paid-only /search options list must also drop accessories and subscriptions (PR for paidCatalogFilter.js). CODE ONLY until Paul types GO.
// Never restarts anything, never sets OPTIONS_PAID_ONLY, never touches the database. Needs the OPTIONS_PAID_ONLY patch (2026-10-19-options-paid-only.mjs) installed first.
//
//   node 2026-10-26-paid-catalog-filter.mjs [--dir=/opt/trimscout-deals/src] [--apply]
//
// Changes deals_api_server.js in 2 anchored places (the import, and the facet-row list handed to buyerOptionCatalog, wrapped in PAID_ONLY ? ... : unchanged). The pre-first-rebuild live fallback is not touched and installs the new
// module paidCatalogFilter.js. With the flag off (the default) the endpoint is byte-for-byte what it was. Without --apply it is a DRY RUN: every anchor is checked,
// the patched files are staged in a temp dir and loaded, and nothing is written to --dir. With --apply each original is copied to <file>.bak.<STAMP> first.
// Takes effect at the next deals-api restart (idle window, Paul's call).
// RESTORE: cp -p deals_api_server.js.bak.<STAMP> deals_api_server.js; rm -f paidCatalogFilter.js (restart only if deals-api already restarted onto the new code).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const DIR = path.resolve(args.dir || "/opt/trimscout-deals/src");
const APPLY = Boolean(args.apply);
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

const EDITS =
[
 {
  "file": "deals_api_server.js",
  "id": "paidCatalogFilter-1",
  "find": "import { groupExistingOptionRows, diffOptionSets, pairKey } from \"./inventoryOptionsDiff.js\";\n",
  "replace": "import { groupExistingOptionRows, diffOptionSets, pairKey } from \"./inventoryOptionsDiff.js\";\nimport { paidCatalogRows } from \"./paidCatalogFilter.js\";\n",
  "marker": "import { paidCatalogRows } from \"./paidCatalogFilter.js\";"
 },
 {
  "file": "deals_api_server.js",
  "id": "paidCatalogFilter-2",
  "find": "options: buyerOptionCatalog(optionRows, {",
  "replace": "options: buyerOptionCatalog(PAID_ONLY ? paidCatalogRows(optionRows) : optionRows, {",
  "marker": "buyerOptionCatalog(PAID_ONLY ? paidCatalogRows(optionRows) : optionRows, {"
 }
]
;
for (const e of EDITS) if (e.find.includes(e.marker) || !e.replace.includes(e.marker)) throw new Error(`edit ${e.id}: marker must be in the replacement and not in the anchor`);

const NEW_MODULE = "paidCatalogFilter.js";
const MODULE_TEXT = "// Paid-only /search factory-options list (flag OPTIONS_PAID_ONLY, applied by deals_api_server.js only when the flag is on).\n//\n// A catalog row stays only if it has a paid sticker price (the rebuild's min_price/max_price, counted per row where price > 0) AND its label is not\n// a dealer/port accessory or a subscription. The price test alone is not enough: accessories and SiriusXM can carry a price on the stored row.\n// Runs on the raw facet rows, before buyerOptionCatalog's cap, so dropped rows never use up a slot. Pure: no database, no env.\n\nimport { positivePrice } from \"./inventoryOptionRows.js\";\n\nconst words = (label) => String(label ?? \"\").replace(/&/g, \" and \").replace(/[^a-z0-9]+/gi, \" \").replace(/\\s+/g, \" \").trim().toLowerCase();\n\nconst ACCESSORY_NOUN = [\n  \"cargo (?:tray|net|mat|cover|liner|organizer|package|pkg|blocks?)\",\n  \"reversible cargo tray\",\n  \"(?:(?:front|rear|front and rear) )?mud ?guards?\",\n  \"splash guards?\",\n  \"(?:(?:black|alloy) )*(?:lug nuts?|wheel locks?)(?: and (?:black )?wheel locks?)?\",\n  \"(?:first aid|roadside assistance|emergency) kit\",\n  \"(?:illuminated )?door sills?(?: plates?| protectors?)?\",\n  \"door edge (?:guards?|protectors?)\",\n  \"paint protection film\",\n  \"(?:front |rear )?bumper (?:applique|guard|protector|step plate)\",\n  \"(?:front |rear )?license plate (?:frame|bracket)s?\",\n  \"(?:trailer|tow) hitch(?: receiver)?\",\n  \"ball mount kit\",\n  \"(?:bike|ski|kayak) (?:carrier|rack)\",\n  \"(?:roof (?:rack )?)?(?:cross (?:rails?|bars?)|rails?)\",\n  \"(?:chrome |running board )?(?:side|assist) steps?\",\n  \"tonneau cover\",\n  \"(?:severe weather|winter) (?:kit|package)\",\n  \"body side moldings?\",\n  \"blackout emblem overlays?\",\n  \"(?:front |rear )?(?:black )?bowtie emblems?\",\n  \"fog light accent\",\n  \"spare tire lock\",\n  \"(?:spray on )?(?:pickup )?(?:box )?bed ?liners?\",\n  \"liner protection package\",\n];\nconst ACCESSORY = new RegExp(`^(?:(?:genuine|dealer|port|installed)\\\\s+)*(?:${ACCESSORY_NOUN.join(\"|\")})(?:\\\\s+(?:set|kit|pair|installed))*$`);\n// Mats and liners in any spelling, alone or as a package: every word is one of these and at least one is a mat/liner word.\nconst MAT_WORDS = new Set(\"all weather season carpet carpeted carpeting floor cargo tray and with w rubber rubberized vinyl color keyed premium fitted black front rear set package pkg mat mats floormat floormats liner liners\".split(\" \"));\nconst MAT_CORE = /^(?:mats?|floormats?|liners?)$/;\nconst isMatOrLiner = (w) => { const t = w.split(\" \"); return t.every((x) => MAT_WORDS.has(x)) && t.some((x) => MAT_CORE.test(x)); };\nconst SUBSCRIPTION = /\\b(?:sirius ?xm|subscriptions?|trials?|blue ?link|connected (?:care|services))\\b/;\n// Real factory options: checked before the accessory list, so no accessory pattern can ever drop one of these.\nconst PROTECTED = [\n  /^(?:xle grade )?weather package$/,\n  /\\b(?:convenience|premium|extra value)(?: ii)? package\\b/,\n  /\\btrailering\\b/, /\\bz71\\b/, /\\ball star edition\\b/, /\\bremote start\\b/, /\\bdifferential\\b/,\n  /^engine\\b/, /^(?:wheels|tires)\\b/, /\\bleather\\b/, /^engine block heater$/,\n];\n\n/** True for a label that is never a paid factory sticker option: a dealer/port accessory or a subscription. */\nexport function isAccessoryOrSubscription(label) {\n  const w = words(label);\n  if (SUBSCRIPTION.test(w)) return true;\n  if (PROTECTED.some((re) => re.test(w))) return false;\n  return ACCESSORY.test(w) || isMatOrLiner(w);\n}\n\n/** Raw facet rows ({ canonical_key, label, vehicleCount, min_price, max_price }) -> only the paid factory sticker options. */\nexport function paidCatalogRows(rows) {\n  return rows.filter((r) => positivePrice(r.min_price) != null && positivePrice(r.max_price) != null && !isAccessoryOrSubscription(r.label));\n}\n";

const target = path.join(DIR, "deals_api_server.js");
for (const f of ["deals_api_server.js", "optionsPaidOnlyServer.js", "inventoryOptionRows.js"]) if (!fs.existsSync(path.join(DIR, f))) { console.error(`ABORT: ${path.join(DIR, f)} is missing - is --dir the box's src directory, and is 2026-10-19-options-paid-only.mjs applied? Nothing written.`); process.exit(2); }
const original = fs.readFileSync(target, "utf8");
let text = original, abort = false;
for (const e of EDITS) {
  const nFind = count(text, e.find), nMark = count(text, e.marker);
  let status;
  if (nMark >= 1) status = nMark === 1 ? "already applied" : `MARKER PROBLEM: marker occurs ${nMark}x`;
  else if (nFind === 1) { text = text.replace(e.find, () => e.replace); status = "will apply"; }
  else status = `ANCHOR PROBLEM: find occurs ${nFind}x, marker ${nMark}x`;
  if (/PROBLEM/.test(status)) abort = true;
  console.log(`deals_api_server.js :: ${e.id} :: ${status}`);
}
if (abort) { console.error("ABORT: nothing written. (The box's file differs from the repo's at that anchor: send me the lines around it.)"); process.exit(2); }

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "paidcat-stage-"));
try {
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));
  for (const f of fs.readdirSync(DIR)) if (/\.(js|json)$/.test(f) && f !== "package.json") fs.copyFileSync(path.join(DIR, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, "deals_api_server.js"), text);
  fs.writeFileSync(path.join(stage, NEW_MODULE), MODULE_TEXT);
  execFileSync(process.execPath, ["--check", path.join(stage, "deals_api_server.js")], { stdio: "pipe" });
  const m = await import(pathToFileURL(path.join(stage, NEW_MODULE)).href);
  const r = (label, min, max) => ({ canonical_key: label.toLowerCase(), label, vehicleCount: 50, min_price: min, max_price: max });
  const kept = m.paidCatalogRows([r("Cargo Net", 50, 50), r("SiriusXM", 10, 10), r("Zero Item", 0, 0), r("Power Sunroof", 1200, 1200)]).map((x) => x.label);
  if (kept.join() !== "Power Sunroof") throw new Error(`paid filter kept ${kept.join() || "nothing"}, expected Power Sunroof only`);
  if (!/const PAID_ONLY = paidOnlyEnabled\(\);/.test(text)) throw new Error("deals_api_server.js does not read the flag through paidOnlyEnabled()");
  console.log("staged module loads; accessories, subscriptions and unpriced rows are dropped; every use sits behind PAID_ONLY");
} catch (err) { console.error(`ABORT (nothing written to ${DIR}): ${err.message}`); fs.rmSync(stage, { recursive: true, force: true }); process.exit(3); }
fs.rmSync(stage, { recursive: true, force: true });
if (!APPLY) { console.log("DRY RUN ok - nothing written. Re-run with --apply."); process.exit(0); }

const mp = path.join(DIR, NEW_MODULE);
if (text !== original) {
  const newPath = target.replace(/\.js$/, ".new.mjs");
  fs.writeFileSync(newPath, text);
  try { execFileSync(process.execPath, ["--check", newPath], { stdio: "pipe" }); } catch (err) { fs.rmSync(newPath, { force: true }); console.error(`ABORT (original untouched): ${err.message}`); process.exit(3); }
  const bak = `${target}.bak.${STAMP}`;
  fs.copyFileSync(target, bak); fs.chmodSync(bak, fs.statSync(target).mode);
  fs.chmodSync(newPath, fs.statSync(target).mode); fs.renameSync(newPath, target);
  console.log(`deals_api_server.js: backup ${bak}; patched in place. Rollback: cp -p ${bak} ${target}`);
} else console.log("deals_api_server.js: nothing to change");
if (fs.existsSync(mp) && fs.readFileSync(mp, "utf8") === MODULE_TEXT) console.log(`${NEW_MODULE}: already installed, unchanged.`);
else { fs.writeFileSync(mp + ".new", MODULE_TEXT); fs.chmodSync(mp + ".new", 0o664); fs.renameSync(mp + ".new", mp); console.log(`${NEW_MODULE}: installed. Rollback: rm ${mp}`); }
console.log(`DONE (backup stamp ${STAMP}). deals-api has NOT been restarted and OPTIONS_PAID_ONLY was not set.`);
