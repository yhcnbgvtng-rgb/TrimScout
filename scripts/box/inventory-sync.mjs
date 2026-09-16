#!/usr/bin/env node
/**
 * Sync the nightly dealer-inventory crawl (national_inventory_latest.json on the crawl box) into the deals
 * box's dealer_inventory table, so the site's Vehicles sheet shows what the crawler pulled.
 *
 * Runs on the crawl box (ubuntu@98.92.140.11) after scripts/run-daily-crawl.mjs:
 *   TRIMSCOUT_API_KEY=… node inventory-sync.mjs /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/national_inventory_latest.json
 *
 * No dependencies. Reads the JSON, resolves each vehicle's store to a directory row (dealer name + state),
 * upserts by (VIN, store) in chunks, then sweeps every store that had ACTIVE vehicles in the file so VINs the
 * crawler no longer lists are marked removed. Idempotent — re-running just refreshes last_seen.
 */
import fs from "node:fs";

const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || "3.208.49.1";
const DEALS_PORT = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const AUTH_PORT = process.env.TRIMSCOUT_AUTH_PORT || "3003";
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
const file = process.argv[2];
if (!file || !KEY) {
  console.error("usage: TRIMSCOUT_API_KEY=… node inventory-sync.mjs <national_inventory_latest.json>");
  process.exit(2);
}

const api = async (port, path, body) => {
  const res = await fetch(`http://${DEALS_HOST}:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Trimscout-Api-Key": KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json && json.error ? json.error : ""}`);
  return json;
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const vehicles = Array.isArray(raw) ? raw : raw.vehicles || raw.inventory || [];
const active = vehicles.filter((v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v.vin || "").toUpperCase()) && (v.status || "ACTIVE").toUpperCase() === "ACTIVE");
console.log(`${vehicles.length} vehicles in file, ${active.length} active with a valid VIN`);

// Directory rows → (name|state) and (name) lookups, so each store gets its directory id (the sheet joins on it).
const dir = (await api(AUTH_PORT, "/api/dealerships")).dealerships || [];
const byNameState = new Map(), byName = new Map();
for (const d of dir) {
  const st = String(d.state || "").toUpperCase();
  byNameState.set(`${norm(d.dealerName)}|${st}`, d.id);
  if (!byName.has(norm(d.dealerName))) byName.set(norm(d.dealerName), d.id);
}
const dealerIdFor = (v) => {
  const st = String(v.state || "").toUpperCase();
  for (const name of [v.dealerName, v.configDealerName]) {
    if (!name) continue;
    const id = byNameState.get(`${norm(name)}|${st}`) ?? byName.get(norm(name));
    if (id) return id;
  }
  return null;
};
const cond = (t) => ({ NEW: "new", USED: "used", CERTIFIED: "cpo", CPO: "cpo", "CERTIFIED PRE-OWNED": "cpo" })[String(t || "").toUpperCase()] || null;

const rows = active.map((v) => ({
  vin: v.vin.toUpperCase(), dealerId: dealerIdFor(v), dealerName: v.dealerName || v.configDealerName, condition: cond(v.inventoryType), year: v.year, make: v.make, model: v.model, trim: v.trim,
  bodyStyle: v.bodyStyle, exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, mileage: v.mileage, price: v.price, msrp: v.msrp, stockNumber: v.stockNumber, vdpUrl: v.url, imageUrl: v.imageUrl, source: "nightly",
}));
const unmatched = rows.filter((r) => !r.dealerId).length;
console.log(`stores matched to the directory: ${rows.length - unmatched}/${rows.length} vehicles (${unmatched} unmatched — kept, keyed to store 0)`);

// The sweep compares against the deals box's clock; give it a 10-minute margin so a few seconds of clock
// skew between machines can't sweep rows this very run just wrote.
const started = new Date(Date.now() - 10 * 60 * 1000).toISOString();
let upserted = 0;
for (let i = 0; i < rows.length; i += 2000) {
  const r = await api(DEALS_PORT, "/api/inventory/bulk", { vehicles: rows.slice(i, i + 2000) });
  upserted += r.upserted;
  process.stdout.write(`\r  upserted ${upserted}/${rows.length}`);
}
console.log();
const stores = [...new Set(rows.map((r) => r.dealerId).filter(Boolean))];
let removed = 0;
for (const id of stores) removed += (await api(DEALS_PORT, "/api/inventory/sweep", { dealerId: id, seenAfter: started })).removed;
const stats = await api(DEALS_PORT, "/api/inventory/stats");
console.log(JSON.stringify({ upserted, sweptStores: stores.length, removed, live: { rows: stats.total, vins: stats.vins, inStock: stats.inStock, stores: stats.dealers, byState: stats.byState.slice(0, 8) } }));
