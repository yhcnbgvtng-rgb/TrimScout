#!/usr/bin/env node
// Turn docs/megadealer_pilot_stores.csv into per-(state, brand) dealer files for standalone.js
// (CRAWLER_DEALERS_FILE / CRAWLER_STATE / CRAWLER_BRAND). Plain file writes, no network.
//   node scripts/megadealer/build-dealers.mjs <pilot.csv> <outDir>
import fs from "node:fs";
import path from "node:path";
const [csvPath, outDir] = process.argv.slice(2);
if (!csvPath || !outDir) throw new Error("usage: build-dealers.mjs <pilot.csv> <outDir>");
const parse = (t) => { const rows = []; let f = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { f.push(c); c = ""; }
    else if (ch === "\n") { f.push(c); rows.push(f); f = []; c = ""; } else if (ch !== "\r") c += ch; }
  if (c || f.length) { f.push(c); rows.push(f); } return rows; };
const [head, ...body] = parse(fs.readFileSync(csvPath, "utf8")).filter((r) => r.length > 1);
const rec = body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const groups = new Map();
for (const r of rec) {
  const u = new URL(r.website); const host = u.hostname;
  const brand = ["Toyota", "Genesis"].includes(r.brands) ? r.brands : "Used";
  const d = { id: `mega-${slug(r.name)}`, name: r.name, city: r.city, state: r.state, make: brand, domain: host.replace(/^www\./, ""),
    sitemapUrl: `https://${host}/sitemap.xml`, inventorySitemapUrl: `https://${host}/sitemap-inventory.xml`, fallbackUrl: `https://${host}/`, domainSource: "megadealer-pilot" };
  const k = `${r.state}|${brand}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d);
}
fs.mkdirSync(outDir, { recursive: true });
const jobs = [];
for (const [k, list] of groups) { const [state, brand] = k.split("|"); const file = path.join(outDir, `${state.toLowerCase()}-${slug(brand)}.json`);
  fs.writeFileSync(file, JSON.stringify(list, null, 1)); jobs.push({ state, brand, file, stores: list.length }); }
fs.writeFileSync(path.join(outDir, "jobs.json"), JSON.stringify(jobs, null, 1));
console.log(`${rec.length} stores -> ${jobs.length} jobs`); for (const j of jobs) console.log(`  ${j.state} ${j.brand}: ${j.stores}`);
