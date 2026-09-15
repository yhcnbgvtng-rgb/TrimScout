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
// Combo stores are already live under another brand's spelling ("Carlisle Buick GMC" vs the Buick feed's
// "CARLISLE CADILLAC BUICK GMC"); the directory keys by name, so match those on website domain + state and
// adopt the live name — an update instead of a duplicate rooftop.
const byDomainState = new Map<string, (typeof live)[number]>();
for (const d of live) for (const dom of d.domains || []) byDomainState.set(`${dom.toLowerCase()}|${d.state}`, d);
const findLive = (r: { dealerName: string; state?: unknown; domains?: unknown }) =>
  byName.get(r.dealerName.trim().toLowerCase()) ??
  ((r.domains as string[] | undefined) || []).map((dom) => byDomainState.get(`${dom.toLowerCase()}|${r.state}`)).find(Boolean);
let renamed = 0;
// The bulk endpoint replaces the whole row, so an already-live rooftop (a combined Chevy/GMC/Cadillac store,
// or one another brand's crawl already filed) keeps its notes — both brands' provenance stays on the row.
const mergeNotes = (live: string | null | undefined, ours: string) => (live && !live.includes(ours) ? `${live} | ${ours}` : ours);
const payload = rows.map((r0) => {
  const l = findLive(r0);
  if (l && l.dealerName.trim().toLowerCase() !== r0.dealerName.trim().toLowerCase()) renamed++;
  const r = l ? { ...r0, dealerName: l.dealerName } : r0;
  if (l && !r.contactEmail && (l.contactName || l.contactEmail)) {
    return { ...r, contactName: l.contactName || r.contactName, contactEmail: l.contactEmail || null, notes: mergeNotes(l.notes, r.notes) };
  }
  return { ...r, contactEmail: r.contactEmail || null, notes: l ? mergeNotes(l.notes, r.notes) : r.notes };
});
console.log("matched to a live row by domain+state (kept live name):", renamed);
const before = live.filter((d) => new RegExp(BRAND, "i").test(d.dealerName) || new RegExp(`Brand: ${BRAND}`, "i").test(d.notes || ""));
console.log("before:", before.length, BRAND + " rows,", before.filter((d) => d.contactEmail).length, "with email");
const result = await bulkUpsertDealerships(payload);
const after = (await listDealerships()).filter((d) => new RegExp(BRAND, "i").test(d.dealerName) || new RegExp(`Brand: ${BRAND}`, "i").test(d.notes || ""));
console.log(JSON.stringify({ result, after: { rows: after.length, named: after.filter((d) => d.contactName).length, emails: after.filter((d) => d.contactEmail).length } }));
