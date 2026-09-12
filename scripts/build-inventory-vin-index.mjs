// Derives data/inventory-vin-dealers.json — VIN → the rooftop the crawl saw
// it at — from the full Lightsail inventory snapshot. The full file is 84 MB
// and not something a request should load; this index is ~1 MB and is
// imported statically by lib/inventoryVinLookup.ts. Re-run after refreshing
// data/lightsail_inventory.json.
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(new URL("../data/lightsail_inventory.json", import.meta.url), "utf8"));
const index = {};
let kept = 0;
for (const r of rows) {
  const vin = String(r.vin || "").trim().toUpperCase();
  const dealer = String(r.dealerName || "").trim();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) || !dealer) continue;
  // Later rows win: the snapshot is appended chronologically, so the last
  // sighting is the most current rooftop.
  index[vin] = [dealer, String(r.city || "").trim(), String(r.state || "").trim().toUpperCase(), String(r.lastSeen || r.firstSeen || "").slice(0, 10)];
  kept++;
}
const out = { generatedAt: new Date().toISOString(), source: "data/lightsail_inventory.json", vins: index };
writeFileSync(new URL("../data/inventory-vin-dealers.json", import.meta.url), JSON.stringify(out));
console.log(`indexed ${Object.keys(index).length} VINs from ${rows.length} rows (${kept} usable)`);
