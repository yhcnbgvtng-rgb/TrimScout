/**
 * Push the HTML-source email-recovery results (scrapers/dealer-rosters/recover_emails.py) onto the live rows.
 * Re-reads live first and skips any row that picked up an email since the candidates were dumped.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/push-recovered-emails.mts scrapers/dealer-rosters/cadillac/recovery_results.json
 */
import fs from "node:fs";
import { listDealerships, updateDealership } from "../../lib/dealershipsApi";
const file = process.argv[2];
if (!file) throw new Error("usage: push-recovered-emails.mts <recovery_results.json>");
const results = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ id: string; email?: string | null; status: string; sourceUrl: string }>;
const live = new Map((await listDealerships()).map((d) => [d.id, d]));
let pushed = 0, alreadyHadEmail = 0, missing = 0;
for (const r of results) {
  if (r.status !== "matched" || !r.email) continue;
  const d = live.get(r.id);
  if (!d) { missing++; continue; }
  if (d.contactEmail) { alreadyHadEmail++; continue; }
  const { id, createdAt, updatedAt, emailOptOut, ...rest } = d as any;
  await updateDealership(d.id, { ...rest, contactEmail: r.email, notes: `${d.notes || ""} | 2026-09-15: email recovered from staff-page HTML source (${r.sourceUrl})` });
  pushed++;
}
console.log(JSON.stringify({ file, pushed, alreadyHadEmail, missing }));
