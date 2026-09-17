/**
 * Verifies the box's analytics aggregation against a recomputation from raw rows
 * for one dealer: avg / median DOM, the four bands, sticker coverage and the
 * list-vs-MSRP discount. Reads the same tables the page reads.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/verify-dealer-analytics.mts [dealerId]
 */
import { inventoryAnalytics, listInventory } from "../../lib/inventoryApi";
import { bandsOf, discountPct, mean, median, vehicleDom } from "../../lib/dealerAnalytics";

const all = await inventoryAnalytics({});
const target = process.argv[2] ? all.dom.byDealer.find((d) => String(d.dealerId) === process.argv[2]) : all.dom.byDealer.find((d) => d.n >= 20 && d.n <= 300);
if (!target) throw new Error("no dealer to check");
const rows: Awaited<ReturnType<typeof listInventory>>["vehicles"] = [];
for (let offset = 0; ; offset += 2000) {
  const page = await listInventory({ dealerId: String(target.dealerId), inStock: true, limit: 2000, offset } as never);
  rows.push(...page.vehicles);
  if (rows.length >= page.total || page.vehicles.length === 0) break;
}
const doms = rows.map((v) => vehicleDom({ daysOnLot: v.daysOnLot, crawlFirstSeen: v.crawlFirstSeen, firstSeenAt: v.firstSeenAt, removedAt: v.removedAt }));
const discounts = rows.map((v) => discountPct(v.msrp, v.price)).filter((d): d is number => d != null);
const mine = { n: rows.length, avgDom: mean(doms), medianDom: median(doms), bands: bandsOf(doms), withSticker: rows.filter((v) => v.windowStickerUrl).length, avgDiscount: discounts.length ? Math.round((discounts.reduce((t, d) => t + d, 0) / discounts.length) * 10) / 10 : null };
const box = { n: target.n, avgDom: target.avgDom, medianDom: target.medianDom, bands: target.bands, withSticker: target.withSticker, avgDiscount: target.avgDiscount };
const close = (a: number | null, b: number | null, tol: number) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);
const ok = mine.n === box.n && close(mine.avgDom, box.avgDom, 1) && (box.medianDom == null || close(mine.medianDom, box.medianDom, 1)) && JSON.stringify(mine.bands) === JSON.stringify(box.bands) && mine.withSticker === box.withSticker && close(mine.avgDiscount, box.avgDiscount, 0.2);
console.log(JSON.stringify({ dealer: target.dealerName, recomputed: mine, box, match: ok }, null, 1));
if (!ok) process.exit(1);
