/**
 * Push an enriched dealer-contacts export (the admin CSV columns) into the live directory: parse, diff each
 * row against listDealerships() by name (falling back to website domain + state), keep every live value the
 * CSV leaves blank, and bulk-upsert only the rows that actually change. Dry run unless --push.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/probes/push-enriched-csv.mts ~/Desktop/dealerships_enriched_final.csv [--push]
 */
import fs from "node:fs";
import { parseDealershipCsv } from "../../lib/dealershipCsv";
import { listDealerships, bulkUpsertDealerships, type Dealership } from "../../lib/dealershipsApi";
const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("usage: push-enriched-csv.mts <export.csv> [--push]");
const push = flag === "--push";
const parsed = parseDealershipCsv(fs.readFileSync(file, "utf8"));
console.log(`parsed ${parsed.rows.length} rows (skipped ${parsed.skippedRows}; unrecognized columns: ${parsed.unrecognizedColumns.join(", ") || "none"})`);
const live = await listDealerships();
const byName = new Map(live.map((d) => [d.dealerName.trim().toLowerCase(), d]));
const byDomainState = new Map<string, Dealership>();
for (const d of live) for (const dom of d.domains || []) byDomainState.set(`${dom.toLowerCase()}|${(d.state || "").toUpperCase()}`, d);
const norm = (s: string | null | undefined) => (s || "").trim();
const normDomains = (ds: string[] | undefined) => Array.from(new Set((ds || []).map((x) => x.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean))).sort();
// A hand-edited cell sometimes holds "a@x.com;b@x.com" or a name — keep the first well-formed address, else nothing.
const EMAIL_OK = /^[\w.+'-]+@[\w-]+(\.[\w-]+)+$/;
const cleanEmail = (v: string | undefined) => (v || "").split(/[;,\s]+/).map((x) => x.trim()).find((x) => EMAIL_OK.test(x) && !/\.\./.test(x)) || "";
const changes: Array<Record<string, unknown>> = [];
const stats = { matchedByName: 0, matchedByDomain: 0, unmatched: 0, unchanged: 0, emailAdded: 0, emailChanged: 0, nameAdded: 0, blankKept: 0 };
const emailBefore = new Map<string, number>(), emailAfter = new Map<string, number>();
for (const d of live) { const s = (d.state || "??").toUpperCase(); emailBefore.set(s, (emailBefore.get(s) || 0) + (d.contactEmail ? 1 : 0)); emailAfter.set(s, (emailAfter.get(s) || 0) + (d.contactEmail ? 1 : 0)); }
const unmatched: string[] = [];
for (const r of parsed.rows) {
  let l = byName.get(r.dealerName.trim().toLowerCase());
  if (l) stats.matchedByName++;
  else {
    l = (r.domains || []).map((dom) => byDomainState.get(`${dom.toLowerCase().replace(/^www\./, "")}|${(r.state || "").toUpperCase()}`)).find(Boolean);
    if (l) stats.matchedByDomain++;
    else { stats.unmatched++; unmatched.push(`${r.dealerName} (${r.city}, ${r.state})`); continue; }
  }
  // CSV wins where it has a value; a blank in the CSV never erases a live value.
  const pick = (csv: string | undefined, liveVal: string | null | undefined) => { const c = norm(csv); if (c) return c; if (norm(liveVal)) stats.blankKept++; return norm(liveVal); };
  const next = {
    dealerName: l.dealerName, address: pick(r.address, l.address), city: pick(r.city, l.city), state: pick(r.state, l.state).toUpperCase(), zipCode: pick(r.zipCode, l.zipCode), phone: pick(r.phone, l.phone),
    contactName: pick(r.contactName, l.contactName), contactEmail: pick(cleanEmail(r.contactEmail), l.contactEmail) || null, website: pick(r.website, l.website), notes: pick(r.notes, l.notes),
    domains: normDomains([...(l.domains || []), ...(r.domains || [])]),
  };
  const cur = { dealerName: l.dealerName, address: norm(l.address), city: norm(l.city), state: norm(l.state).toUpperCase(), zipCode: norm(l.zipCode), phone: norm(l.phone), contactName: norm(l.contactName), contactEmail: norm(l.contactEmail) || null, website: norm(l.website), notes: norm(l.notes), domains: normDomains(l.domains) };
  if (JSON.stringify(next) === JSON.stringify(cur)) { stats.unchanged++; continue; }
  if (next.contactEmail && !cur.contactEmail) { stats.emailAdded++; const s = next.state || "??"; emailAfter.set(s, (emailAfter.get(s) || 0) + 1); }
  else if (next.contactEmail && cur.contactEmail && next.contactEmail.toLowerCase() !== cur.contactEmail.toLowerCase()) stats.emailChanged++;
  if (next.contactName && !cur.contactName) stats.nameAdded++;
  changes.push(next);
}
console.log(JSON.stringify(stats));
console.log("unmatched sample:", unmatched.slice(0, 10));
const states = Array.from(emailBefore.keys()).filter((s) => (emailAfter.get(s) || 0) !== (emailBefore.get(s) || 0)).sort((a, b) => (emailAfter.get(b)! - emailBefore.get(b)!) - (emailAfter.get(a)! - emailBefore.get(a)!));
console.log("email deltas by state:", states.map((s) => `${s} ${emailBefore.get(s)}→${emailAfter.get(s)}`).join(", "));
console.log(`${changes.length} rows to upsert${push ? "" : " (dry run — add --push)"}`);
if (push && changes.length) {
  let done = 0;
  for (let i = 0; i < changes.length; i += 250) { const res = await bulkUpsertDealerships(changes.slice(i, i + 250)); done += res.total; console.log(`  ${done}/${changes.length}`, JSON.stringify(res)); }
  const after = await listDealerships();
  console.log("LIVE after:", after.length, "rows,", after.filter((d) => d.contactName).length, "named,", after.filter((d) => d.contactEmail).length, "emails");
}
