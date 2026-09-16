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

// Stream the JSON array object by object instead of parsing the whole file: each record carries NHTSA,
// options and price-history blobs, so 150k of them parsed at once is hundreds of MB on a small box.
// Only the compact mapped row is kept per vehicle.
function* streamTopLevelObjects(path) {
  const fd = fs.openSync(path, "r");
  const buf = Buffer.alloc(1 << 20);
  let depth = 0, inStr = false, esc = false, started = false, cur = "";
  for (;;) {
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (n <= 0) break;
    const chunk = buf.toString("utf8", 0, n);
    for (const ch of chunk) {
      if (!started) { if (ch === "[") started = true; continue; }
      if (depth === 0) { if (ch === "{") { depth = 1; cur = "{"; } continue; }
      cur += ch;
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { yield JSON.parse(cur); cur = ""; } }
    }
  }
  fs.closeSync(fd);
}

// Directory rows → (name|state) and (name) lookups, so each store gets its directory id (the sheet joins on it).
const dir = (await api(AUTH_PORT, "/api/dealerships")).dealerships || [];
const byNameState = new Map(), byName = new Map(), byDomain = new Map();
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
for (const d of dir) {
  const st = String(d.state || "").toUpperCase();
  byNameState.set(`${norm(d.dealerName)}|${st}`, d.id);
  if (!byName.has(norm(d.dealerName))) byName.set(norm(d.dealerName), d.id);
  // The crawl's dealer names are its own spellings; the listing URL's host is the reliable key.
  for (const dom of [...(d.domains || []), d.website ? hostOf(d.website) : ""]) { const k = String(dom || "").toLowerCase().replace(/^www\./, ""); if (k && !byDomain.has(k)) byDomain.set(k, d.id); }
}
const dealerIdFor = (v) => {
  const st = String(v.state || "").toUpperCase();
  const host = hostOf(v.url || "");
  const byHost = host && (byDomain.get(host) ?? byDomain.get(host.split(".").slice(-2).join(".")));
  if (byHost) return byHost;
  for (const name of [v.dealerName, v.configDealerName]) {
    if (!name) continue;
    const id = byNameState.get(`${norm(name)}|${st}`) ?? byName.get(norm(name));
    if (id) return id;
  }
  return null;
};
const cond = (t) => ({ NEW: "new", USED: "used", CERTIFIED: "cpo", CPO: "cpo", "CERTIFIED PRE-OWNED": "cpo", CERTIFIED_PRE_OWNED: "cpo", WHOLESALE: "wholesale" })[String(t || "").toUpperCase()] || null;
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
// Factory + dealer-listed options, compacted to what the sheet shows (code / name / price).
const options = (v) => {
  const out = [];
  for (const o of Array.isArray(v.factoryOptions) ? v.factoryOptions : []) if (o && (o.name || o.code)) out.push({ code: o.code || null, name: o.name || null, price: num(o.price), kind: "factory" });
  for (const o of Array.isArray(v.dealerListedOptions) ? v.dealerListedOptions : []) { const name = typeof o === "string" ? o : o && (o.name || o.title); if (name) out.push({ code: null, name, price: num(o && o.price), kind: "dealer" }); }
  return out.length ? out.slice(0, 200) : null;
};

const rows = [];
let total = 0;
for (const v of streamTopLevelObjects(file)) {
  total++;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(String(v.vin || "").toUpperCase()) || (v.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue;
  rows.push({
    vin: v.vin.toUpperCase(), dealerId: dealerIdFor(v), dealerName: v.dealerName || v.configDealerName, condition: cond(v.inventoryType), year: v.year, make: v.make, model: v.model, trim: v.trim,
    bodyStyle: v.bodyStyle, exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, mileage: v.mileage, price: v.price, msrp: v.msrp, stockNumber: v.stockNumber, vdpUrl: v.url, imageUrl: v.imageUrl, source: "nightly",
    windowStickerUrl: v.windowStickerUrl || null, engine: v.engine || null, transmission: v.transmission || null, daysOnLot: num(v.daysOnLot), oldPrice: num(v.oldPrice), priceDiff: num(v.priceDiff),
    priceChangeType: v.priceChangeType || null, changeType: v.changeType || null, priceHistory: Array.isArray(v.priceHistory) && v.priceHistory.length ? v.priceHistory.slice(-60) : null,
    options: options(v), optionsTotal: num(v.totalOptionsPrice), baseMsrp: num(v.baseMsrp), crawlFirstSeen: v.firstSeen || null,
  });
}
const unmatched = rows.filter((r) => !r.dealerId).length;
console.log(`${total} vehicles in file, ${rows.length} active with a valid VIN`);
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
for (const id of stores) removed += (await api(DEALS_PORT, "/api/inventory/sweep", { dealerId: id, seenAfter: started, sources: ["nightly"] })).removed;
// The store-0 bucket holds vehicles whose store wasn't in the directory at sync time; once a rooftop is added
// they re-file under it, and the stale bucket rows are retired here.
try { removed += (await api(DEALS_PORT, "/api/inventory/sweep", { dealerId: 0, seenAfter: started, sources: ["nightly"] })).removed; } catch { /* box predates store-0 sweeps */ }
const stats = await api(DEALS_PORT, "/api/inventory/stats");
console.log(JSON.stringify({ upserted, sweptStores: stores.length, removed, live: { rows: stats.total, vins: stats.vins, inStock: stats.inStock, stores: stats.dealers, byState: stats.byState.slice(0, 8) } }));
