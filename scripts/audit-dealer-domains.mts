/**
 * Audit + backfill for desks with no website/domains. Sources, in order:
 *   1. hosts our own inventory crawl saw the rooftop's VDPs on
 *      (data/lightsail_inventory.json url column, matched by name+state)
 *   2. a verified guess: hostnames built from the dealer's name, accepted
 *      only when the live homepage answers 200 and names the store
 * Also flags email hygiene (double TLD, trailing dot, not-an-email) and
 * fixes the confident cases.
 *
 *   npx tsx scripts/audit-dealer-domains.mts            # dry run + report
 *   npx tsx scripts/audit-dealer-domains.mts --write    # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { listDealerships, updateDealership } = await import("../lib/dealershipsApi");
const { crossReferenceStickerDealer, dealerNameTokens } = await import("../lib/dealerSearch");
const { normalizeDealerHost, contactDomains } = await import("../lib/deskResolve");
const { normalizeDealerKey } = await import("../lib/dealerName");

const write = process.argv.includes("--write");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const rows = await listDealerships();
const missing = rows.filter((r) => !r.website && r.domains.length === 0);
const report: Record<string, unknown> = { total: rows.length, missingBefore: missing.length };

// --- 1. inventory VDP hosts ------------------------------------------------
const inventory = JSON.parse(readFileSync(new URL("../data/lightsail_inventory.json", import.meta.url), "utf8")) as Array<{ dealerName: string; city: string; state: string; url?: string }>;
const invHosts = new Map<string, { hosts: Set<string>; city: string; state: string }>();
for (const v of inventory) {
  const h = v.url ? normalizeDealerHost(v.url)?.registrable : null;
  if (!h || !v.dealerName) continue;
  const k = `${normalizeDealerKey(v.dealerName)}|${(v.state || "").toUpperCase()}`;
  const e = invHosts.get(k) || { hosts: new Set<string>(), city: v.city, state: v.state };
  e.hosts.add(h);
  invHosts.set(k, e);
}
const fromInventory: Array<{ row: (typeof rows)[number]; hosts: string[] }> = [];
const missingAfterInventory: typeof missing = [];
for (const r of missing) {
  const hit = invHosts.get(`${normalizeDealerKey(r.dealerName)}|${(r.state || "").toUpperCase()}`);
  if (hit) fromInventory.push({ row: r, hosts: [...hit.hosts] });
  else missingAfterInventory.push(r);
}
// Also: inventory hosts for rooftops that HAVE a website but not this host in domains[] (acceptance 4 class).
const inventoryAliasAdds: Array<{ row: (typeof rows)[number]; hosts: string[] }> = [];
for (const [k, e] of invHosts) {
  const [key, state] = k.split("|");
  const row = rows.find((r) => normalizeDealerKey(r.dealerName) === key && (r.state || "").toUpperCase() === state);
  if (!row || (!row.website && row.domains.length === 0)) continue;
  const have = new Set(contactDomains(row));
  const add = [...e.hosts].filter((h) => !have.has(h));
  if (add.length) inventoryAliasAdds.push({ row, hosts: add });
}

// --- 2. verified name-based guesses ---------------------------------------
function candidates(r: (typeof rows)[number]): string[] {
  const brandWords = ["chevrolet", "chevy", "gmc", "buick", "cadillac", "ford", "lincoln", "toyota", "honda", "acura", "lexus", "bmw", "porsche", "genesis", "jeep", "ram", "dodge", "chrysler", "cdjr"];
  const raw = r.dealerName.toLowerCase().replace(/\(.*?\)/g, "").replace(/[.,'&]/g, " ").replace(/\b(inc|llc|l\.l\.c|co|corp|ltd|company|motors|motor|auto|automotive|group|sales|dealership|the)\b/g, " ");
  const tokens = raw.split(/\s+/).filter(Boolean);
  const core = tokens.filter((t) => t !== "of");
  const noBrand = core.filter((t) => !brandWords.includes(t));
  const brand = core.find((t) => brandWords.includes(t)) || "";
  const city = (r.city || "").toLowerCase().replace(/[^a-z]/g, "");
  const cityWords = new Set((r.city || "").toLowerCase().split(/[^a-z]+/).filter(Boolean));
  // A guess needs a word that is neither the brand nor the city — "Baker
  // City CDJR" has none, and bakercity.com is the city's own site.
  const distinctive = noBrand.filter((t) => !cityWords.has(t) && t.length >= 4);
  if (distinctive.length === 0) return [];
  const out = new Set<string>();
  const join = (parts: string[]) => parts.join("").replace(/[^a-z0-9]/g, "");
  const bases = [join(core), join(noBrand.concat(brand ? [brand] : [])), join(noBrand), join(noBrand.concat(brand ? [brand === "chevrolet" ? "chevy" : brand] : [])), join(noBrand.concat([city])), join(noBrand.concat(brand ? [brand, city] : [city])), join(noBrand.concat(brand ? [brand === "chevrolet" ? "chevy" : brand, city] : [city]))];
  for (const b of bases) if (b.length >= 6) for (const tld of [".com", ".net"]) out.add(b + tld);
  return [...out].slice(0, 12);
}
async function verify(host: string, r: (typeof rows)[number]): Promise<{ ok: boolean; final: string | null; why: string }> {
  try {
    const res = await fetch(`https://${host}/`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    const final = normalizeDealerHost(res.url)?.registrable || host;
    if (res.status === 403 || res.status === 503) return { ok: false, final, why: `shielded ${res.status}` };
    if (!res.ok) return { ok: false, final, why: `http ${res.status}` };
    const html = (await res.text()).slice(0, 200_000).toLowerCase();
    const cityWords = new Set((r.city || "").toLowerCase().split(/[^a-z]+/).filter(Boolean));
    const distinctive = dealerNameTokens(r.dealerName).filter((t) => t.length >= 4 && !cityWords.has(t));
    const nameHit = distinctive.some((t) => html.includes(t));
    const brandHit = /chevrolet|chevy|gmc|buick|cadillac|ford|toyota|honda|acura|lexus|bmw|porsche|genesis|jeep|dodge|chrysler/.test(html);
    if (nameHit && brandHit) return { ok: true, final, why: "homepage names the store and the brand" };
    return { ok: false, final, why: "page did not name the store" };
  } catch (e) {
    return { ok: false, final: null, why: e instanceof Error ? e.name : "error" };
  }
}
const verified: Array<{ row: (typeof rows)[number]; host: string; final: string }> = [];
const shielded: Array<{ row: (typeof rows)[number]; host: string }> = [];
const unresolved: typeof missing = [];
let idx = 0;
async function worker() {
  while (idx < missingAfterInventory.length) {
    const r = missingAfterInventory[idx++];
    let found: { host: string; final: string } | null = null;
    let shield: string | null = null;
    for (const host of candidates(r)) {
      const v = await verify(host, r);
      if (v.ok) { found = { host, final: v.final || host }; break; }
      if (v.why.startsWith("shielded") && !shield) shield = host;
    }
    if (found) verified.push({ row: r, ...found });
    else if (shield) shielded.push({ row: r, host: shield });
    else unresolved.push(r);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

// --- 3. email hygiene ------------------------------------------------------
const emailFixes: Array<{ row: (typeof rows)[number]; from: string; to: string | null; why: string }> = [];
for (const r of rows) {
  const e = (r.contactEmail || "").trim();
  if (!e) continue;
  if (/\.(com|net|org)\.(com|net|org)$/i.test(e)) emailFixes.push({ row: r, from: e, to: e.replace(/\.(com|net|org)\.(com|net|org)$/i, ".$1"), why: "double TLD" });
  else if (/\.$/.test(e) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}\.$/i.test(e)) emailFixes.push({ row: r, from: e, to: e.replace(/\.$/, ""), why: "trailing dot" });
  else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) emailFixes.push({ row: r, from: e, to: null, why: "not an email" });
}

// --- report ----------------------------------------------------------------
const brandOf = (r: (typeof rows)[number]) => ((r.notes || "").match(/Brand:\s*([A-Za-z-]+)/) || [])[1] || (r.dealerName.match(/\b(Ford|Chevrolet|GMC|Buick|Cadillac|BMW|Toyota|Lexus|Honda|Acura|Porsche|Genesis|Mercedes|Jeep|Ram|Dodge|Chrysler)\b/i) || [])[1] || "other";
const tally = (list: typeof missing) => {
  const o: Record<string, number> = {};
  for (const r of list) { const k = `${brandOf(r)} / ${r.state || "?"}`; o[k] = (o[k] || 0) + 1; }
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
};
Object.assign(report, {
  fromInventory: fromInventory.length,
  inventoryAliasAdds: inventoryAliasAdds.length,
  verifiedGuesses: verified.length,
  shieldedCandidates: shielded.length,
  unresolved: unresolved.length,
  remainingByBrandState: tally([...shielded.map((s) => s.row), ...unresolved]).slice(0, 25),
  shieldedList: shielded.map((s) => `${s.row.dealerName} (${s.row.city}, ${s.row.state}) → ${s.host} (bot-shielded, unverified)`),
  unresolvedList: unresolved.map((r) => `${r.dealerName} (${r.city}, ${r.state})`),
  verifiedList: verified.map((v) => `${v.row.dealerName} (${v.row.state}) → ${v.host}${v.final !== v.host ? ` → ${v.final}` : ""}`),
  inventoryList: fromInventory.map((f) => `${f.row.dealerName} (${f.row.state}) → ${f.hosts.join(", ")}`),
  emailFixes: emailFixes.map((f) => `${f.row.dealerName}: ${f.from} → ${f.to ?? "∅"} (${f.why})`),
});
writeFileSync(new URL("../docs/qa/2026-09-13-dealer-domain-audit.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, shieldedList: undefined, unresolvedList: undefined, verifiedList: undefined, inventoryList: undefined }, null, 1));

if (!write) { console.log("dry run — nothing written; full lists in docs/qa/2026-09-13-dealer-domain-audit.json"); process.exit(0); }

// --- apply -----------------------------------------------------------------
async function save(r: (typeof rows)[number], patch: Partial<(typeof rows)[number]>) {
  const { id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...input } = r;
  await updateDealership(id, { ...input, ...patch });
}
// One save per row: merge every patch first, so an email fix can't carry a
// stale empty website over a domain fix made a moment earlier.
const patches = new Map<string, { row: (typeof rows)[number]; patch: Partial<(typeof rows)[number]> }>();
const merge = (r: (typeof rows)[number], patch: Partial<(typeof rows)[number]>) => {
  const cur = patches.get(r.id) || { row: r, patch: {} };
  const domains = [...new Set([...(cur.patch.domains || r.domains), ...(patch.domains || [])])];
  cur.patch = { ...cur.patch, ...patch, domains };
  patches.set(r.id, cur);
};
for (const f of fromInventory) merge(f.row, { website: `https://www.${f.hosts[0]}/`, domains: f.hosts });
for (const a of inventoryAliasAdds) merge(a.row, { domains: a.hosts });
for (const v of verified) merge(v.row, { website: `https://www.${v.host}/`, domains: [v.host, v.final] });
for (const f of emailFixes) merge(f.row, { contactEmail: f.to });
let applied = 0;
for (const { row, patch } of patches.values()) { await save(row, patch); applied++; }
console.log(`applied ${applied} row updates`);
