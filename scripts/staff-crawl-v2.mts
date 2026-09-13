/**
 * Browser staff crawl (v2): for desk-only rooftops, open the site in a real
 * browser, run the in-page extractor from the Mercedes rebuild
 * (scripts/probes/browser-staff-extract.js — nav-link discovery, common
 * staff paths, card heuristic, Cloudflare email decode, name↔email match),
 * and write ONE named contact at a personal mailbox. Generic mailboxes
 * are never written; a name without a mailbox is recorded in notes only.
 *
 *   npx tsx scripts/staff-crawl-v2.mts --since 2026-09-13 [--write] [--limit N]
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { listDealerships, updateDealership } = await import("../lib/dealershipsApi");
const { contactWebsite } = await import("../lib/deskResolve");
const { isGenericMailbox } = await import("../lib/quotePackage");
const looksLikePersonName = (s: string) => /^[A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){1,3}$/.test((s || "").trim());
const { chromium } = await import("/private/tmp/claude-501/-Users-paul-Claude---GitHub/63074dce-e7ba-4ac7-aa49-43ff06e4d5be/scratchpad/node_modules/playwright-core/index.mjs");

const args = process.argv.slice(2);
const write = args.includes("--write");
const since = args[args.indexOf("--since") + 1] || "2026-09-13";
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const EXTRACT = readFileSync(new URL("./probes/browser-staff-extract.js", import.meta.url), "utf8");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const rows = await listDealerships();
const namesFrom = args.includes("--names-from") ? args[args.indexOf("--names-from") + 1] : null;
const wanted = namesFrom ? new Set((JSON.parse(readFileSync(namesFrom, "utf8")) as string[]).map((n) => n.toLowerCase())) : null;
const targets = rows
  .filter((r) => !r.contactEmail && contactWebsite(r) && (wanted ? wanted.has(r.dealerName.toLowerCase()) : (r.notes || "").includes(since)))
  .slice(0, limit);
console.log(`targets: ${targets.length} desk-only rooftops sited on/after ${since}`);

type Cand = { name: string; title: string; email: string };
type Result = { row: (typeof rows)[number]; ok: boolean; url?: string; cands?: Cand[]; pool?: string[]; title?: string; error?: string };
const results: Result[] = [];
const browser = await chromium.launch({ executablePath: "/Users/paul/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
let i = 0;
async function worker() {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  while (i < targets.length) {
    const row = targets[i++];
    const site = contactWebsite(row)!;
    try {
      const res = await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      if (!res || res.status() >= 400 || /just a moment|attention required|access denied/i.test(title)) {
        results.push({ row, ok: false, error: `blocked ${res ? res.status() : "nav"}: ${title}` });
        continue;
      }
      const raw = (await page.evaluate(EXTRACT)) as string;
      const j = JSON.parse(raw);
      results.push({ row, ok: Boolean(j.ok), url: j.url, cands: j.cands || [], pool: j.pool || [], title: j.title });
    } catch (e) {
      results.push({ row, ok: false, error: e instanceof Error ? e.message.slice(0, 80) : String(e) });
    }
  }
  await ctx.close();
}
await Promise.all(Array.from({ length: 4 }, worker));
await browser.close();

// Decide: best titled candidate with a personal mailbox; else a named GM/GSM with no mailbox goes to notes only.
const picked: Array<{ row: (typeof rows)[number]; name: string; title: string; email: string; url: string }> = [];
const namedNoEmail: string[] = [];
const nothing: string[] = [];
for (const r of results) {
  if (!r.ok || !r.cands?.length) { nothing.push(`${r.row.dealerName} (${r.row.state}) — ${r.error || "no staff page / no titled staff"}`); continue; }
  const good = r.cands.find((c) => c.email && !isGenericMailbox(c.email) && looksLikePersonName(c.name) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email));
  if (good) picked.push({ row: r.row, name: good.name, title: good.title, email: good.email, url: r.url! });
  else {
    const real = r.cands.filter((c) => looksLikePersonName(c.name) && !/\b(online|research|services|vehicles|loaner|rewards|specials|inventory)\b/i.test(c.name + " " + c.title)).slice(0, 2);
    if (real.length) namedNoEmail.push(`${r.row.dealerName} (${r.row.state}) — ${real.map((c) => `${c.name} (${c.title})`).join("; ")} — no personal mailbox on page`);
    else nothing.push(`${r.row.dealerName} (${r.row.state}) — staff page found but no titled person`);
  }
}
const report = { since, targets: targets.length, crawled: results.length, contactReady: picked.length, namedNoEmail: namedNoEmail.length, nothing: nothing.length,
  pickedList: picked.map((p) => `${p.row.dealerName} (${p.row.state}) — ${p.name}, ${p.title} — ${p.email.replace(/^(.).*@/, "$1…@")} — ${p.url}`), namedNoEmailList: namedNoEmail, nothingList: nothing };
writeFileSync(new URL(`../docs/qa/${since}-staff-crawl-v2${namesFrom ? "-b" : ""}.json`, import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, pickedList: undefined, namedNoEmailList: undefined, nothingList: undefined }, null, 1));
console.log(report.pickedList.join("\n"));
if (!write) { console.log("dry run — nothing written"); process.exit(0); }
for (const p of picked) {
  const { id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...rest } = p.row;
  await updateDealership(id, { ...rest, contactName: p.name, contactEmail: p.email, notes: `${rest.notes || ""} | Contact source: ${p.url} (browser staff crawl v2 ${since}) | Title: ${p.title}` });
}
for (const line of namedNoEmail) {
  const name = line.split(" — ")[0];
  const row = targets.find((t) => line.startsWith(`${t.dealerName} (${t.state})`));
  if (!row) continue;
  const { id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...rest } = row;
  await updateDealership(id, { ...rest, notes: `${rest.notes || ""} | Staff page (v2 ${since}): ${line.split(" — ").slice(1).join(" — ")}` });
  void name;
}
console.log(`written: ${picked.length} contacts, ${namedNoEmail.length} notes`);
