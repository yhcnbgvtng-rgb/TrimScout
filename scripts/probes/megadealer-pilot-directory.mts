/**
 * Add the daytime-pilot stores to the live dealer directory so their cars file under a real store id
 * instead of store 0. Dry run by default; nothing is written without --apply.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/probes/megadealer-pilot-directory.mts            # backup + report what would be added
 *   npx tsx scripts/probes/megadealer-pilot-directory.mts --apply    # backup, add the unmatched rows, report new ids
 *
 * Always writes a full JSON backup of the live directory first (BACKUP_DIR, default ../TrimScout-backups).
 * A pilot row that already matches a live row by name or by domain+state is NOT written (no duplicate rooftop).
 * Rows: scrapers/dealer-rosters/megadealer-pilot-rows.json
 */
import fs from "node:fs";
import path from "node:path";
import { listDealerships, bulkUpsertDealerships } from "../../lib/dealershipsApi";

const APPLY = process.argv.includes("--apply");
const rows = JSON.parse(fs.readFileSync("scrapers/dealer-rosters/megadealer-pilot-rows.json", "utf8")) as Array<Record<string, any>>;
const live = await listDealerships();

const dir = process.env.BACKUP_DIR || path.resolve("..", "TrimScout-backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(dir, `dealerships-before-megadealer-pilot-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(live));
console.log(`backup: ${live.length} rows -> ${backup}`);

const byName = new Map(live.map((d) => [d.dealerName.trim().toLowerCase(), d]));
const byDomState = new Map<string, (typeof live)[number]>();
for (const d of live) for (const dom of d.domains || []) byDomState.set(`${dom.toLowerCase()}|${d.state}`, d);
const match = (r: Record<string, any>) =>
  byName.get(String(r.dealerName).trim().toLowerCase()) ?? (r.domains as string[]).map((x) => byDomState.get(`${x.toLowerCase()}|${r.state}`)).find(Boolean);

const toAdd: Record<string, any>[] = [];
for (const r of rows) {
  const m = match(r);
  console.log(`${m ? "ALREADY LIVE (id " + m.id + ")" : "ADD"}: ${r.dealerName} | ${r.city}, ${r.state} | ${r.domains[0]}`);
  if (!m) toAdd.push(r);
}
console.log(`would add ${toAdd.length} of ${rows.length}`);
if (!APPLY) process.exit(0);

const result = await bulkUpsertDealerships(toAdd);
console.log("bulk result:", JSON.stringify(result));
const after = await listDealerships();
const ids = rows.map((r) => {
  const d = after.find((x) => x.dealerName.trim().toLowerCase() === String(r.dealerName).trim().toLowerCase()) ?? after.find((x) => (x.domains || []).includes(r.domains[0]) && x.state === r.state);
  return { id: d?.id ?? null, dealerName: r.dealerName, state: r.state, domain: r.domains[0] };
});
console.log(`live rows: ${live.length} -> ${after.length}`);
console.log("STORE IDS:", JSON.stringify(ids, null, 1));
