#!/usr/bin/env node
// How many of the VINs the daytime crawl found are NOT already live? Read-only (GET /api/inventory).
// For each store: live rows under the same dealer id (any status), plus a check of up to 40 VINs by q= for
// copies filed under a different store. Needs ~/inventory-sync/.env sourced (TRIMSCOUT_API_KEY, host, port).
//   node scripts/megadealer/new-vins.mjs <shardDir> <dealerIds.json>   dealerIds.json: { "<domain>": "<dealerId>", ... }
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const [shardDir, idsFile] = process.argv.slice(2);
if (!shardDir || !idsFile) throw new Error("usage: new-vins.mjs <shardDir> <dealerIds.json>");
const host = process.env.TRIMSCOUT_DEALS_HOST || "52.202.234.65", port = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const key = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
if (!key) throw new Error("TRIMSCOUT_API_KEY not set (source ~/inventory-sync/.env)");
const get = (p) => new Promise((res, rej) => { http.get({ host, port, path: p, headers: { "X-Trimscout-Api-Key": key }, timeout: 30000 }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(`bad json from ${p}: ${b.slice(0, 120)}`)); } }); }).on("error", rej); });
const ids = JSON.parse(fs.readFileSync(idsFile, "utf8"));
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const byDomain = new Map();
for (const f of fs.readdirSync(shardDir).filter((x) => x.endsWith(".json"))) {
  for (const v of JSON.parse(fs.readFileSync(path.join(shardDir, f), "utf8"))) {
    if (!v.vin || v.status !== "ACTIVE") continue;
    const d = hostOf(v.url); if (!byDomain.has(d)) byDomain.set(d, new Set()); byDomain.get(d).add(v.vin.toUpperCase());
  }
}
const rows = []; let crawled = 0, trulyNew = 0;
for (const [domain, vins] of byDomain) {
  const id = ids[domain]; let liveSame = new Set();
  if (id) { const r = await get(`/api/inventory?dealerId=${encodeURIComponent(id)}&limit=2000`); for (const x of r.vehicles || r.rows || r.items || []) liveSame.add(String(x.vin).toUpperCase()); }
  const fresh = [...vins].filter((v) => !liveSame.has(v));
  let elsewhere = 0; for (const v of fresh.slice(0, 40)) { const r = await get(`/api/inventory?q=${v}&limit=5`); if ((r.vehicles || r.rows || r.items || []).some((x) => String(x.vin).toUpperCase() === v)) elsewhere++; }
  const sample = Math.min(40, fresh.length); const est = sample ? Math.round(fresh.length * (1 - elsewhere / sample)) : 0;
  rows.push({ domain, dealerId: id || null, crawled: vins.size, alreadyLiveSameStore: vins.size - fresh.length, newVins: est, sampleElsewhere: `${elsewhere}/${sample}` });
  crawled += vins.size; trulyNew += est;
}
console.table(rows); console.log(JSON.stringify({ stores: rows.length, crawledActiveVins: crawled, trulyNewVins: trulyNew }));
