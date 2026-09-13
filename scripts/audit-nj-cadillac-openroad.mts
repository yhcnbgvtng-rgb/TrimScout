/**
 * Adds rooftops the directory is missing, from two sources captured this
 * session (scratchpad JSON): Cadillac's own locator within 100 mi of
 * Chester NJ, and the Open Road group's locations page. For each missing
 * store: row with NAP + website + domains (redirect aliases resolved), and a
 * staff-page pass for a NAMED contact at a personal mailbox — generic
 * mailboxes are never written. Report to docs/qa.
 *
 *   npx tsx scripts/audit-nj-cadillac-openroad.mts [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { listDealerships, createDealership, updateDealership } = await import("../lib/dealershipsApi");
const { contactDomains, normalizeDealerHost } = await import("../lib/deskResolve");
const { resolveHostRedirect } = await import("../lib/hostRedirect");
const { crossReferenceStickerDealer } = await import("../lib/dealerSearch");
const { isGenericMailbox } = await import("../lib/quotePackage");
// playwright-core lives in the scratchpad install (not a project dependency); resolve it from there.
const { chromium } = await import("/private/tmp/claude-501/-Users-paul-Claude---GitHub/63074dce-e7ba-4ac7-aa49-43ff06e4d5be/scratchpad/node_modules/playwright-core/index.mjs");

const S = "/private/tmp/claude-501/-Users-paul-Claude---GitHub/63074dce-e7ba-4ac7-aa49-43ff06e4d5be/scratchpad";
const write = process.argv.includes("--write");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const today = "2026-09-13";

type Target = { source: "cadillac_locator" | "open_road"; name: string; address: string; city: string; state: string; zip: string; phone: string; website: string | null; brand: string };
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc");

const cad = JSON.parse(readFileSync(`${S}/cadillac-nj-100mi.json`, "utf8")) as Array<Record<string, string>>;
const targets: Target[] = cad.map((d) => ({ source: "cadillac_locator", name: titleCase(d.name), address: titleCase(d.address || ""), city: titleCase(d.city || ""), state: d.state, zip: (d.zip || "").slice(0, 5), phone: d.phone || "", website: d.website || null, brand: "Cadillac" }));

const or = JSON.parse(readFileSync(`${S}/openroad-stores.json`, "utf8")) as Array<{ name: string; addr?: string; phone?: string; newHosts?: string[] }>;
// Sites confirmed live by hand this session (the locations page only exposes a few links in the DOM).
const orKnownSites: Record<string, string> = {
  "Open Road Cadillac": "morristowncadillac.com", "Open Road Chevrolet": "openroadchevrolet.com", "Open Road Subaru": "openroadsubaru.com",
  "Open Road Volvo Cars Edison": "openroadvolvocarsedison.com", "Audi Manhattan": "audimanhattan.com",
  "BMW of Roxbury": "bmwofroxbury.com", "MINI of Edison": "miniofedison.com", "MINI of Morristown": "miniofmorristown.com",
  "Open Road Volkswagen of Bridgewater": "openroadvwbridgewater.com", "Open Road Mazda of East Brunswick": "openroadmazdaofeastbrunswick.com",
  "Open Road Mazda of Morristown": "openroadmazdaofmorristown.com", "Open Road Volkswagen Manhattan": "vwmanhattan.com", "BMW of Morristown": "morristownbmw.com",
};
for (const s of or) {
  if (!s.addr) continue;
  const m = s.addr.match(/^(.*?)[, ]+([A-Za-z .]+?),? (NJ|NY|PA) (\d{5})$/);
  if (!m) continue;
  const brand = (s.name.match(/Mercedes-Benz|BMW|MINI|Volkswagen|Honda|Acura|Mazda|Audi|Cadillac|Chevrolet|Subaru|Volvo/) || ["?"])[0];
  // "2685 Route 22 W Union" / "…at 55th Street New York": the street's last word bleeds into the city.
  const city = m[2].trim().replace(/^(W|E|N|S|Street|St|Ave|Rd)\s+/i, "").trim();
  targets.push({ source: "open_road", name: s.name === "Open Road Cadillac" ? "Open Road Cadillac of Morristown" : s.name, address: m[1].replace(/,\s*$/, "").trim() + (city !== m[2].trim() ? " " + m[2].trim().split(/\s+/)[0] : ""), city, state: m[3], zip: m[4], phone: s.phone || "", website: orKnownSites[s.name] ? `https://www.${orKnownSites[s.name]}/` : null, brand });
}

// --- websites for stores whose site wasn't captured: verified guess -------
async function verifyHost(host: string, t: Target): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const html = (await res.text()).slice(0, 200_000).toLowerCase();
    const words = t.name.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !["open", "road", "cars", "auto"].includes(w));
    return words.some((w) => html.includes(w)) && html.includes(t.brand.toLowerCase().split("-")[0]);
  } catch { return false; }
}
for (const t of targets) {
  if (t.website) continue;
  const base = t.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\bopen road\b/, "openroad");
  const cands = new Set<string>();
  const words = base.split(/\s+/).filter(Boolean);
  const noOf = words.filter((w) => w !== "of");
  cands.add(noOf.join("") + ".com"); cands.add(words.join("") + ".com"); cands.add(noOf.filter((w) => !["openroad"].includes(w)).join("") + ".com");
  cands.add(noOf.join("") + "nj.com"); cands.add(noOf.filter((w) => w !== "openroad").join("") + "nj.com");
  for (const c of cands) { if (await verifyHost(c, t)) { t.website = `https://www.${c}/`; break; } }
}


const rows = await listDealerships();
const domainIndex = new Map<string, (typeof rows)[number]>();
for (const r of rows) for (const d of contactDomains(r)) domainIndex.set(d, r);

// --- match each target to a directory row: by domain, then by name+state ---
const matched: Array<{ t: Target; row: (typeof rows)[number]; via: string }> = [];
const missing: Target[] = [];
for (const t of targets) {
  const host = t.website ? normalizeDealerHost(t.website)?.registrable : null;
  const byDomain = host ? domainIndex.get(host) : undefined;
  if (byDomain) { matched.push({ t, row: byDomain, via: "domain" }); continue; }
  const byName = crossReferenceStickerDealer(rows, { name: t.name, city: t.city, state: t.state });
  // A Cadillac store is often the same rooftop as a Buick GMC / Chevrolet
  // row — but never a Porsche or Ford one that merely shares a word.
  const gmRow = byName && /cadillac|buick|gmc|chevrolet|chevy/i.test(byName.dealerName);
  const brandWord = t.brand.toLowerCase().split("-")[0];
  const groupRow = byName && t.source === "open_road" && /open road/i.test(byName.dealerName) && byName.dealerName.toLowerCase().includes(brandWord);
  if (byName && (t.source !== "cadillac_locator" ? groupRow || gmRow : gmRow)) { matched.push({ t, row: byName, via: "name" }); continue; }
  missing.push(t);
}
// de-dupe missing across the two sources (Open Road Cadillac appears in both)
const seenKey = new Set<string>();
const toAdd = missing.filter((t) => { const k = `${t.name.toLowerCase()}|${t.zip}`; if (seenKey.has(k)) return false; seenKey.add(k); return true; });

// --- staff-page pass (rendered) for a named contact -----------------------
const STAFF_PATHS = ["/staff", "/dealership/staff.htm", "/about-us/staff/", "/meet-our-staff", "/our-team", "/staff.aspx", "/about/staff", "/dealership/staff"];
const TITLE_RE = /^(General Manager|General Sales Manager|Sales Manager|Internet (Sales )?(Manager|Director)|Director of Sales|Sales Director|New Car (Sales )?Manager|Executive Manager|Managing Partner|Dealer Principal)$/i;
async function findContact(site: string): Promise<{ name: string; title: string; email: string; source: string } | null> {
  const browser = await chromium.launch({ executablePath: "/Users/paul/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
  try {
    const page = await browser.newPage({ userAgent: UA });
    for (const p of STAFF_PATHS) {
      const url = site.replace(/\/$/, "") + p;
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
      if (!res || res.status() >= 400) continue;
      await page.waitForTimeout(2500);
      const { lines, mails } = await page.evaluate(() => ({
        lines: document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean),
        mails: Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => ({ email: (a.getAttribute("href") || "").replace("mailto:", "").split("?")[0].toLowerCase(), ctx: (a.closest("li, article, div")?.textContent || "").replace(/\s+/g, " ").slice(0, 300) })),
      }));
      // titled entries: name line directly above a title line; email from a mailto whose context names them
      for (let i = 1; i < lines.length; i++) {
        if (!TITLE_RE.test(lines[i])) continue;
        const name = lines[i - 1];
        if (!looksLikePersonName(name)) continue;
        const email = mails.find((m) => m.ctx.includes(name.split(" ")[0]) && m.ctx.includes(name.split(" ").slice(-1)[0]))?.email || (lines[i + 1] && /@/.test(lines[i + 1]) ? lines[i + 1].toLowerCase() : "");
        if (email && !isGenericMailbox(email) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { name, title: lines[i], email, source: url };
      }
    }
    return null;
  } finally { await browser.close(); }
}

const created: Array<Record<string, unknown>> = [];
const noSite: Target[] = [];
for (const t of toAdd) {
  if (!t.website) { noSite.push(t); continue; }
  const host = normalizeDealerHost(t.website)!.registrable;
  const hop = await resolveHostRedirect(new URL(t.website).hostname).catch(() => ({ chain: [host] }));
  const domains = [...new Set([host, ...hop.chain])];
  const contact = await findContact(t.website).catch(() => null);
  const notes = `Website: ${t.website} | Source: ${t.source === "cadillac_locator" ? "Cadillac dealer locator (100 mi of Chester NJ)" : "openroad.com/locations"} ${today}${contact ? ` | Contact source: ${contact.source} | Title: ${contact.title}` : " | No named contact found on staff page"} | Brand: ${t.brand}${t.source === "open_road" ? " | Group: Open Road" : ""}`;
  const input = { dealerName: t.name, address: t.address || null, city: t.city || null, state: t.state, zipCode: t.zip || null, phone: t.phone || null, contactName: contact?.name || null, contactEmail: contact?.email || null, website: t.website, domains, notes };
  created.push({ ...input, contactReady: Boolean(contact) });
  if (write) await createDealership(input);
}

// --- matched rows that lack the locator's website: fill it ----------------
const filled: string[] = [];
for (const { t, row } of matched) {
  if (!t.website) continue;
  const host = normalizeDealerHost(t.website)?.registrable;
  if (!host || contactDomains(row).includes(host)) continue;
  filled.push(`${row.dealerName}: +${host}`);
  if (write) { const { id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...rest } = row; await updateDealership(id, { ...rest, website: rest.website || t.website, domains: [...new Set([...row.domains, host])] }); }
}

const report = {
  date: today,
  cadillacLocator: { total: cad.length, byState: cad.reduce<Record<string, number>>((o, d) => ((o[d.state] = (o[d.state] || 0) + 1), o), {}), onFileBefore: matched.filter((m) => m.t.source === "cadillac_locator").length, missingBefore: missing.filter((t) => t.source === "cadillac_locator").length },
  openRoad: { total: targets.filter((t) => t.source === "open_road").length, nj: targets.filter((t) => t.source === "open_road" && t.state === "NJ").length, onFileBefore: matched.filter((m) => m.t.source === "open_road").length, missingBefore: missing.filter((t) => t.source === "open_road").length },
  added: created.length,
  addedContactReady: created.filter((c) => c.contactReady).length,
  addedDeskOnly: created.filter((c) => !c.contactReady).length,
  stillMissingNoSite: noSite.map((t) => `${t.name} (${t.city}, ${t.state})`),
  existingRowsGivenLocatorDomain: filled,
  addedList: created.map((c) => `${c.dealerName} (${c.city}, ${c.state} ${c.zipCode}) — ${(c.domains as string[]).join(", ")}${c.contactName ? ` — ${c.contactName} <${String(c.contactEmail).replace(/^(.).*@/, "$1…@")}>` : " — desk only"}`),
  matchedList: matched.map((m) => `${m.t.name} → ${m.row.dealerName} (${m.via})`),
};
writeFileSync(new URL("../docs/qa/2026-09-13-nj-cadillac-openroad-audit.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, addedList: undefined, matchedList: undefined }, null, 1));
console.log(report.addedList.join("\n"));
console.log(write ? "WRITTEN" : "dry run — nothing written");
