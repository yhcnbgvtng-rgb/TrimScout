// READ-ONLY check of the box2 VIN guard: imports stellantisMake.js from DIR (with its vinWmi.js / ingestGuards.js / stellantisVinTable.js beside it) and calls normalizeMakeForWrite,
// the deals-API write choke point (every make written to dealer_inventory goes through it). No network, no DB, no writes.
//   node test-vin-guard.mjs DIR
import path from "node:path";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
if (!dir) { console.error("usage: node test-vin-guard.mjs DIR"); process.exit(2); }
const { normalizeMakeForWrite: fn } = await import(pathToFileURL(path.resolve(dir, "stellantisMake.js")).href);
let fails = 0;
const check = (label, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got} (want ${want})`); };
// Stored as GMC at Gregg Young Buick GMC (dealer 10229), each really another make; model names as the crawler sends them.
for (const [vin, model, want] of [["2B3LJ54T19H594202", "Challenger", "Dodge"], ["4S3GTAV69P3713237", "Impreza", "Subaru"], ["5LMCJ1DH0NUL16894", "Corsair", "Lincoln"], ["JHMGK5H76HS000056", "Fit", "Honda"], ["KL4CJCSB4JB582999", "Encore", "Buick"], ["1GCUYEED5NZ123456", "Silverado 1500", "Chevrolet"], ["1FTFW1E50NFA12345", "F-150", "Ford"]])
  check(`${model} stored as GMC -> ${want}`, fn({ make: "GMC", vin, model }), want);
for (const [vin, model, want] of [["1GKB0RDC6RU100924", "Yukon", "GMC"], ["3GKALTEV5LL187300", "Terrain", "GMC"], ["5GAEVAKW9RJ101917", "Enclave", "Buick"]]) check(`${model} (real ${want}) stays ${want}`, fn({ make: want, vin, model }), want);
check("unknown WMI keeps the stored make", fn({ make: "GMC", vin: "XZZCJ1DH0NUL16894", model: "X" }), "GMC");
// The five prefixes added with this package.
check("3MW (BMW Mexico) stored as Chevrolet -> BMW", fn({ make: "Chevrolet", vin: "3MW5R1J05N8C12345", model: "330i" }), "BMW");
check("ZAS (Alfa Romeo) stored as GMC -> Alfa Romeo", fn({ make: "GMC", vin: "ZASPAKBN3N7D12345", model: "Stelvio" }), "Alfa Romeo");
check("3GP Prologue stored as Chevrolet -> Honda", fn({ make: "Chevrolet", vin: "3GPCCAAB3RS123456", model: "Prologue" }), "Honda");
check("3HD HR-V stored as Ford -> Honda", fn({ make: "Ford", vin: "3HDRX1HB4PM123456", model: "HR-V" }), "Honda");
check("3HD Acura stays Acura", fn({ make: "Acura", vin: "3HDRX1HB4PM123456", model: "ADX" }), "Acura");
check("1HT Silverado 5500HD stored as Ford -> Chevrolet", fn({ make: "Ford", vin: "1HTSMAANXPH123456", model: "Silverado 5500HD" }), "Chevrolet");
check("a lowercase page make is still canonicalised (ingestGuards)", fn({ make: "chevrolet", vin: "1GCUYEED5NZ123456", model: "Silverado 1500" }), "Chevrolet");
console.log(fails ? `FAILED ${fails} check(s)` : "VIN-GUARD TEST PASS");
process.exit(fails ? 1 : 0);
