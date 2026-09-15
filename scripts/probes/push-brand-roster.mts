/**
 * Push the Hyundai roster (scrapers/dealer-rosters/${BRAND.toLowerCase()}/upload_rows.json)
 * into the live dealer directory. Upsert by name; an existing row's contact
 * is kept when ours has no email and theirs has a name (never trade a real
 * contact for a locator GM name). Reports before/after counts.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/push-brand-roster.mts Kia
 */
import fs from "node:fs";
const BRAND = process.argv[2];
if (!BRAND) throw new Error("usage: npx tsx scripts/probes/push-brand-roster.mts <Brand> [folder]  (folder defaults to scrapers/dealer-rosters/<brand>/)");
const FOLDER = process.argv[3] || BRAND.toLowerCase();
import { listDealerships, bulkUpsertDealerships } from "../../lib/dealershipsApi";
const rows = JSON.parse(fs.readFileSync(`scrapers/dealer-rosters/${FOLDER}/upload_rows.json`, "utf8")) as Array<Record<string, unknown> & { dealerName: string; contactName: string; contactEmail: string; notes: string }>;
const live = await listDealerships();
const byName = new Map(live.map((d) => [d.dealerName.trim().toLowerCase(), d]));
const payload = rows.map((r) => {
  const l = byName.get(r.dealerName.trim().toLowerCase());
  if (l && !r.contactEmail && (l.contactName || l.contactEmail)) {
    return { ...r, contactName: l.contactName || r.contactName, contactEmail: l.contactEmail || null, notes: `${l.notes || ""} | ${r.notes}`.replace(/^ \| /, "") };
  }
  return { ...r, contactEmail: r.contactEmail || null };
});
const before = live.filter((d) => new RegExp(BRAND, "i").test(d.dealerName) || new RegExp(`Brand: ${BRAND}`, "i").test(d.notes || ""));
console.log("before:", before.length, BRAND + " rows,", before.filter((d) => d.contactEmail).length, "with email");
const result = await bulkUpsertDealerships(payload);
const after = (await listDealerships()).filter((d) => new RegExp(BRAND, "i").test(d.dealerName) || new RegExp(`Brand: ${BRAND}`, "i").test(d.notes || ""));
console.log(JSON.stringify({ result, after: { rows: after.length, named: after.filter((d) => d.contactName).length, emails: after.filter((d) => d.contactEmail).length } }));
