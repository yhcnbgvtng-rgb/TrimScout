#!/usr/bin/env node
/**
 * Sync the nightly dealer-inventory crawl (data/inventory/<STATE>.json per-state shards on the crawl box)
 * into the deals box's dealer_inventory table, so the site's Vehicles sheet shows what the crawler pulled.
 *
 * Runs on each crawl box (ubuntu@98.92.140.11, ubuntu@3.237.204.55) after scripts/run-daily-crawl.mjs:
 *   TRIMSCOUT_API_KEY=… node inventory-sync.mjs /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/inventory
 *
 * Was a single national_inventory_latest.json until the crawler's state-sharding fix (inventory_shards.js,
 * 2026-09) replaced that one nationwide file with one file per state — this reads a *directory* of those
 * shards instead of one file (a bare file path still works, for a one-off manual run against a single shard).
 * Each shard has the exact same top-level-array-of-vehicle-objects shape the old national file had, so
 * everything past file discovery (row building, store matching, upsert, sweep) is unchanged.
 *
 * No dependencies. Reads the JSON, resolves each vehicle's store to a directory row (dealer name + state),
 * upserts by (VIN, store) in chunks, then sweeps every store that had ACTIVE vehicles in the file so VINs the
 * crawler no longer lists are marked removed. Idempotent — re-running just refreshes last_seen.
 *
 * Four boxes now run this (box1/box2 core at 6:15/6:45am ET, box3/box4 expansion at 7:15/7:45am ET) against
 * the SAME deals-box database. The 30-minute stagger alone isn't a guarantee — each run actually starts
 * whenever ITS OWN box's crawl finishes, not exactly at its cron time, so two runs can still land together
 * on an unlucky night (this happened for real 2026-09-23: two concurrent /api/inventory/bulk calls hit a
 * MySQL "Deadlock found when trying to get lock" error). Acquires a lock from the deals-api server itself
 * (POST /api/ops/sync-lock/acquire — see handleSyncLockAcquire in deals_api_server.js) before the write
 * phase, so a second box's run waits for the first to finish instead of colliding. A single, unclustered
 * PM2 process backs that server, so an in-memory lock there is enough — no DB table needed.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || "3.208.49.1";
const DEALS_PORT = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const AUTH_PORT = process.env.TRIMSCOUT_AUTH_PORT || "3003";
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
const inputPath = process.argv[2];
if (!inputPath || !KEY) {
  console.error("usage: TRIMSCOUT_API_KEY=… node inventory-sync.mjs <data/inventory dir, or a single shard .json file>");
  process.exit(2);
}

// A bare file still works (manual/one-off use); the normal nightly case is a directory of per-state shards.
// Sorted for a deterministic, reproducible run order — matters for log-reading, not for correctness.
const isDir = fs.statSync(inputPath).isDirectory();
const files = isDir
  ? fs.readdirSync(inputPath).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(inputPath, f))
  : [inputPath];
if (files.length === 0) {
  console.error(`no .json shard files found in ${inputPath}`);
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

// Identifies this run in the lock-holder message another box's wait loop prints — not used for anything
// else, so it doesn't need to be globally unique, just recognizable in a log.
const LOCK_OWNER = `${os.hostname()}-${path.basename(inputPath)}-${process.pid}`;
async function acquireSyncLock({ pollMs = 30_000, maxWaitMs = 3 * 60 * 60 * 1000 } = {}) {
  const start = Date.now();
  for (;;) {
    const r = await api(DEALS_PORT, "/api/ops/sync-lock/acquire", { owner: LOCK_OWNER });
    if (r.acquired) return;
    if (Date.now() - start > maxWaitMs) throw new Error(`gave up waiting for the sync lock after ${maxWaitMs}ms (held by ${r.heldBy})`);
    console.log(`[sync] another box's sync is running (${r.heldBy}, held ${Math.round(r.heldSinceMs / 1000)}s) — waiting...`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
// Best-effort — a failed release just means the server's own staleness timeout clears it later; must
// never throw and mask whatever real error is already in flight.
const releaseSyncLock = () => api(DEALS_PORT, "/api/ops/sync-lock/release", { owner: LOCK_OWNER }).catch(() => {});

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Stream the JSON array object by object instead of parsing the whole file: each record carries NHTSA,
// options and price-history blobs, so 150k of them parsed at once is hundreds of MB on a small box.
// Only the compact mapped row is kept per vehicle.
function* streamTopLevelObjects(filePath) {
  const fd = fs.openSync(filePath, "r");
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
// dealerListedOptions carries two different shapes depending on the source platform:
// Dealer.com's structured packages/options each have a real, stable code (PKG-{id}/OPT-{id} —
// extractDealerListedOptions() in standalone.js); DealerOn's free-text feature mentions
// (parseFeaturesFromDescription()) have no per-item code at all and share the literal
// placeholder "FEATURE". Previously this always hardcoded code: null here, discarding a real
// Dealer.com code even when one existed — preserve it when present instead, so a downstream
// facet can actually tell "this exact coded package" apart from "any of these free-text mentions".
const options = (v) => {
  const out = [];
  for (const o of Array.isArray(v.factoryOptions) ? v.factoryOptions : []) if (o && (o.name || o.code)) out.push({ code: o.code || null, name: o.name || null, price: num(o.price), kind: "factory" });
  for (const o of Array.isArray(v.dealerListedOptions) ? v.dealerListedOptions : []) {
    const name = typeof o === "string" ? o : o && (o.name || o.title);
    if (!name) continue;
    const code = typeof o === "object" && o && o.code ? String(o.code).slice(0, 64) : null;
    out.push({ code, name, price: num(o && o.price), kind: "dealer" });
  }
  return out.length ? out.slice(0, 200) : null;
};

const rows = [];
let total = 0;
for (const shardFile of files) {
  for (const v of streamTopLevelObjects(shardFile)) {
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
}
const unmatched = rows.filter((r) => !r.dealerId).length;
console.log(`${total} vehicles in file, ${rows.length} active with a valid VIN`);
console.log(`stores matched to the directory: ${rows.length - unmatched}/${rows.length} vehicles (${unmatched} unmatched — kept, keyed to store 0)`);

// Only the write phase below needs the lock — everything above (reading shards, matching stores) is
// local/read-only and safe to run in parallel with another box's sync.
console.log(`[sync] acquiring sync lock as ${LOCK_OWNER}...`);
await acquireSyncLock();
try {
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
} finally {
  await releaseSyncLock();
}
