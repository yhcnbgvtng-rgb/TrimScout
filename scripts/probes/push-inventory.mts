/**
 * Push a crawl_inventory.py JSONL into the box's dealer_inventory table, then sweep each crawled store so
 * VINs the site no longer lists are marked removed. Re-runnable.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/push-inventory.mts scrapers/inventory/inventory_nj.jsonl
 */
import fs from "node:fs";
import { bulkUpsertInventory, sweepInventory, inventoryStats, type InventoryUpsert } from "../../lib/inventoryApi";
const file = process.argv[2];
if (!file) throw new Error("usage: push-inventory.mts <crawl.jsonl>");
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const rows = lines.map((l) => JSON.parse(l) as InventoryUpsert & { seenAt: string; dealerId: string });
const started = new Date(Math.min(...rows.map((r) => Date.parse(r.seenAt)))).toISOString();
let upserted = 0, skipped = 0;
for (let i = 0; i < rows.length; i += 2000) {
  const r = await bulkUpsertInventory(rows.slice(i, i + 2000));
  upserted += r.upserted; skipped += r.skipped;
  console.log(`  ${Math.min(i + 2000, rows.length)}/${rows.length}`);
}
// Sweep only the stores this crawl actually parsed vehicles from (a blocked store keeps its last good list).
const sitesFile = file + ".sites.jsonl";
let removed = 0, swept = 0;
if (fs.existsSync(sitesFile)) {
  const sites = fs.readFileSync(sitesFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const s of sites.filter((s) => s.vehicles > 0)) { removed += (await sweepInventory(s.dealerId, started)).removed; swept++; }
}
const stats = await inventoryStats();
console.log(JSON.stringify({ upserted, skipped, sweptStores: swept, removed, live: { total: stats.total, inStock: stats.inStock, dealers: stats.dealers } }));
