// DRY RUN ONLY. Plans "one VIN belongs to one rooftop" for the dealer groups whose sites share one inventory feed. Writes nothing to the database.
//
//   node 2026-10-10-dedupe-merged-feeds.mjs [--groups mcgovern-hyundai,fred-beans-hyundai,johnson-lexus] [--tie review|hub] [--run-start 2026-10-10T12:00:00Z]
//                                           [--require-fresh-keeper] [--out dedupe-dry-run]
//
// Reads (SELECT-only, reader login, 20 s cap on every query, stops on the first timeout, no retry) each rooftop's in-stock rows, plans with
// src/dedupeMergedFeeds.js, and writes <out>.json + <out>.csv (one line per shared VIN: holders, keeper, rooftops that WOULD be retired, rule, evidence)
// and prints the counts. There is no --apply here on purpose: the apply (set removed_at on the planned rows, rollback file first, under the sync
// lock) is written only after Paul has seen this report. Put dedupeMergedFeeds.js next to this file to run it on the deals box (box2) from /opt/trimscout-deals.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
if (args.includes("--apply")) { console.error("This script is a dry run only. The apply is written after the dry-run report is reviewed."); process.exit(1); }
const { planDedupe, MERGED_FEED_GROUPS } = await import(new URL("./dedupeMergedFeeds.js", import.meta.url));
const tie = opt("tie", "review");
if (!["review", "hub"].includes(tie)) { console.error("--tie must be review or hub"); process.exit(1); }
const runStart = opt("run-start");
const wanted = (opt("groups") || Object.keys(MERGED_FEED_GROUPS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
for (const g of wanted) if (!MERGED_FEED_GROUPS[g]) { console.error(`unknown group ${g}; known: ${Object.keys(MERGED_FEED_GROUPS).join(", ")}`); process.exit(1); }
const outBase = path.resolve(opt("out", "dedupe-dry-run"));

function readEnvFile(file) {
  const out = {};
  try { for (const line of fs.readFileSync(file, "utf-8").split("\n")) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq === -1) continue; let v = t.slice(eq + 1).trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); out[t.slice(0, eq).trim()] = v; } } catch { /* missing */ }
  return out;
}
const env = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
if (String(env.DB_HOST || "").includes("3.237.204.55")) { console.error("Refusing to run against 3.237.204.55."); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT) || 3306, database: env.DB_NAME, user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, connectionLimit: 1 });
const q = async (sql, params) => { try { const [r] = await pool.query(`SET STATEMENT max_statement_time=20 FOR ${sql}`, params); return r; } catch (e) { console.error("STOP (no retry):", e.message.slice(0, 160)); process.exit(3); } };

const report = { generatedAt: new Date().toISOString(), tie, runStart, groups: {} };
const csv = ["group,vin,holders(dealer_id:last_seen),keep,retire,rule,evidence"];
for (const g of wanted) {
  const def = MERGED_FEED_GROUPS[g];
  const rows = [];
  for (const id of def.rooftopIds) {
    let cursor = "";
    for (;;) {
      const page = await q("SELECT vin, dealer_id, stock_number, last_seen_at FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id = ? AND vin > ? ORDER BY vin LIMIT 5000", [id, cursor]);
      for (const r of page) rows.push({ vin: r.vin, dealerId: r.dealer_id, stockNumber: r.stock_number, lastSeenAt: r.last_seen_at });
      if (page.length < 5000) break;
      cursor = page[page.length - 1].vin;
    }
  }
  const plan = planDedupe(rows, { rooftopIds: def.rooftopIds, tie, runStart, requireFreshKeeper: args.includes("--require-fresh-keeper") });
  report.groups[g] = { label: def.label, rows: rows.length, hub: plan.hub, sizes: plan.sizes, learnedPrefixes: plan.learnedPrefixes, counts: plan.counts };
  for (const d of plan.decisions) csv.push([g, d.vin, `"${d.holders.map((h) => `${h.dealerId}:${h.lastSeenAt ? new Date(h.lastSeenAt).toISOString().slice(0, 10) : ""}`).join(" ")}"`, d.keep ?? "", `"${d.retire.join(" ")}"`, d.rule, `"${String(d.evidence).replace(/"/g, '""')}"`].join(","));
  const c = plan.counts;
  console.log(`\n${def.label}\n  in-stock rows ${rows.length} (${JSON.stringify(plan.sizes)}), distinct VINs ${c.vins}, held by one rooftop ${c.heldOnce}, SHARED ${c.shared}`);
  console.log(`  decided by: fresh ${c.fresh}, stock-prefix ${c.stock}, hub convention ${c.hub}; unresolved ${c.unresolved}${c.blockedStaleKeeper ? ` (of which ${c.blockedStaleKeeper} blocked: keeper row not fresh)` : ""}`);
  console.log(`  rows that WOULD be retired: ${c.rowsToRetire}   (hub rooftop ${plan.hub}; learned stock prefixes: ${Object.keys(plan.learnedPrefixes).length ? JSON.stringify(plan.learnedPrefixes) : "none"})`);
}
fs.writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(`${outBase}.csv`, csv.join("\n") + "\n");
console.log(`\nDRY RUN — nothing was written to the database. Report: ${outBase}.json / ${outBase}.csv`);
await pool.end();
