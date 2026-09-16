/**
 * Dump live rows for a brand that have a named contact + a known staff-page URL but no email — the pool the
 * HTML-source email-recovery pass works on (see scrapers/dealer-rosters/recover_emails.py).
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/dump-recovery-candidates.mts Cadillac scrapers/dealer-rosters/cadillac/recovery_candidates.json
 */
import fs from "node:fs";
import { listDealerships } from "../../lib/dealershipsApi";
const [brand, out] = process.argv.slice(2);
if (!brand || !out) throw new Error("usage: dump-recovery-candidates.mts <Brand|ALL> <out.json>");
const live = await listDealerships();
const rows = live
  .filter((d) => (brand === "ALL" || new RegExp(`Brand: ${brand}\\b`, "i").test(d.notes || "")) && d.contactName && !d.contactEmail)
  .map((d) => ({ id: d.id, dealerName: d.dealerName, contactName: d.contactName, website: d.website, sourceUrl: ((d.notes || "").match(/Source: (https?:\/\/[^\s|)]+)/) || [])[1] || "" }))
  .filter((d) => d.sourceUrl);
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ brand, candidates: rows.length }));
