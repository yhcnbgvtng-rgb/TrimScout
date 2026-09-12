/**
 * Fills domains[] on every dealership with the registrable host its website
 * redirects to (freedomfordnj.com → freedomfordusa.com), so a pasted link on
 * the new host is an exact match. Asks each site's ORIGIN for its Location
 * header only — HEAD, no page bodies. Run after scripts/box/2026-09-12-
 * dealer-domains.sh has added the columns.
 *
 *   npx tsx scripts/backfill-dealer-domains.mts            # dry run
 *   npx tsx scripts/backfill-dealer-domains.mts --write    # persist
 *   npx tsx scripts/backfill-dealer-domains.mts --write --only-missing
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { listDealerships, updateDealership } = await import("../lib/dealershipsApi");
const { contactDomains, contactWebsite } = await import("../lib/deskResolve");
const { resolveHostRedirect } = await import("../lib/hostRedirect");

const write = process.argv.includes("--write");
const onlyMissing = process.argv.includes("--only-missing");
const CONCURRENCY = 24;

const rows = await listDealerships();
const supportsDomains = rows.some((r) => Array.isArray(r.domains));
if (!supportsDomains && write) {
  console.error("The box does not return domains[] yet — run scripts/box/2026-09-12-dealer-domains.sh first.");
  process.exit(1);
}
const todo = rows.filter((r) => contactWebsite(r) && (!onlyMissing || (r.domains || []).length <= 1));
console.log(`directory ${rows.length} rows · ${todo.length} with a website to check · write=${write}`);

let i = 0, changed = 0, redirected = 0, failed = 0;
const stats: Record<string, number> = {};
async function worker() {
  while (i < todo.length) {
    const row = todo[i++];
    const site = contactWebsite(row)!;
    const before = contactDomains(row);
    let chain: string[] = [];
    try {
      chain = (await resolveHostRedirect(new URL(site).hostname)).chain;
    } catch {
      failed++;
      continue;
    }
    const after = Array.from(new Set([...before, ...chain]));
    if (chain.length > 1) redirected++;
    if (after.length === before.length && (row.domains || []).length === before.length) continue;
    changed++;
    if (chain.length > 1) console.log(`${row.dealerName} (${row.state}): ${chain.join(" → ")}`);
    if (write) {
      const { id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...input } = row;
      try {
        await updateDealership(id, { ...input, website: (row.website || site).trim(), domains: after });
      } catch (err) {
        failed++;
        console.error(`  ! ${row.dealerName}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if ((changed + failed) % 200 === 0) console.log(`… ${i}/${todo.length} checked, ${changed} to update, ${redirected} redirected, ${failed} failed`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done: ${i} checked · ${redirected} sites redirect off their domain · ${changed} rows ${write ? "updated" : "would update"} · ${failed} failed`);
void stats;
