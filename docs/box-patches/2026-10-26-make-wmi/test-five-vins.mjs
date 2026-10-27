// Quick node test for the make-from-VIN patch. READ-ONLY: imports the files in DIR and calls pure functions, no network, no DB, no writes.
//   node test-five-vins.mjs crawler <dir with brand_match.js>      (crawler boxes: resolveKeptMake on a GMC-roster crawl, the bug path)
//   node test-five-vins.mjs deals   <dir with stellantisMake.js>   (box2 deals-api: normalizeMakeForWrite, the write choke point)
// The five VINs were found stored as make "GMC" on 2026-10-24 at Gregg Young Buick GMC (dealer 10229); each is really another make.
import path from "node:path";
import { pathToFileURL } from "node:url";
const [mode, dir] = process.argv.slice(2);
if (!["crawler", "deals"].includes(mode) || !dir) { console.error("usage: node test-five-vins.mjs crawler|deals DIR"); process.exit(2); }
const load = (f) => import(pathToFileURL(path.resolve(dir, f)).href);
const FIVE = [["2B3LJ54T19H594202", "Challenger", "Dodge"], ["4S3GTAV69P3713237", "Impreza", "Subaru"], ["5LMCJ1DH0NUL16894", "Corsair", "Lincoln"], ["JHMGK5H76HS000056", "Fit", "Honda"], ["KL4CJCSB4JB582999", "Encore", "Buick"]];
const REAL_GMC = [["1GKB0RDC6RU100924", "Yukon", "GMC"], ["3GKALTEV5LL187300", "Terrain", "GMC"]];
const GMC_ROSTER = { name: "GMC", vinPrefixes: ["1GT", "1GK", "3GT", "3GK"] }; // the GMC crawl brand (brands.js)
let fails = 0;
const check = (label, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got} (want ${want})`); };
let fn;
if (mode === "crawler") { const m = await load("brand_match.js"); fn = ({ make, vin, model }) => m.resolveKeptMake(GMC_ROSTER, { make, vin, model }); }
else { const m = await load("stellantisMake.js"); fn = ({ make, vin, model }) => m.normalizeMakeForWrite({ make, vin, model }); }
for (const [vin, model, want] of FIVE) {
  check(`${model} stored as GMC -> ${want}`, fn({ make: "GMC", vin, model }), want);
  if (mode === "crawler") check(`${model} with no page make -> ${want}`, fn({ make: null, vin, model }), want);
}
for (const [vin, model, want] of REAL_GMC) check(`${model} (real GMC) stays GMC`, fn({ make: "GMC", vin, model }), want);
check("unknown WMI keeps the stored make", fn({ make: "GMC", vin: "XZZCJ1DH0NUL16894", model: "X" }), "GMC");
if (mode === "crawler") check("unknown WMI, no page make: kept under the roster brand (make_source=fallback), not dropped", fn({ make: null, vin: "XZZCJ1DH0NUL16894", model: "X" }), "GMC");
console.log(fails ? `FAILED ${fails} check(s)` : "FIVE-VIN TEST PASS");
process.exit(fails ? 1 : 0);
