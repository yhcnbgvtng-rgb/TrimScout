// Fill a blank dealer_inventory.model from the VIN (NHTSA vPIC). ~119k in-stock rows (6%) arrive with no model
// at all — 2026-10-03: Nissan 17k, Audi 15k, Ford 14k, Honda 13k, ...; e.g. 121 FL Toyota rows from Toyota of
// Coconut Creek (2T36CRAV...) whose own listing URLs say "2026-toyota-rav4".
//
// Rules: only in-stock rows with a 17-character VIN and a blank model; NEVER overwrite a model a dealer sent
// (the UPDATE itself re-checks "still blank" per row); the decoded make must match the row's make; when vPIC
// returns nothing the row stays blank. VIN patterns (positions 1-8 + the model-year character) are decoded once,
// from up to three sample VINs, and a pattern whose samples disagree is decoded VIN by VIN. A VIN whose check
// digit fails is only filled when its own listing URL names the model. All of that logic, and its tests, live in
// src/vinModelFill.js.
//
// SAFE BY DEFAULT: with no flags this is a DRY RUN — it reads, decodes, prints the report and writes the full
// decisions to ~/fill-blank-model-decisions-<time>.json, and changes nothing.
//   --apply --fleet-idle   performs the updates. --fleet-idle is the operator asserting no crawl or sync is running;
//                          it also takes the deals-API sync lock for the duration (refuses if it is held, exit 4) and
//                          heartbeats it. Updates are by primary key in small batches with a pause between them.
//   --decisions=FILE       with --apply: apply exactly the fills in a reviewed dry-run's file instead of recomputing.
//   --make=Toyota          limit to one make (dry run or apply).
//
// Run on the deals box from /opt/trimscout-deals (needs src/vinModelFill.js deployed next to it):
//   sudo node 2026-10-03-fill-blank-model-from-vin.mjs                                  # dry run
//   sudo node 2026-10-03-fill-blank-model-from-vin.mjs --apply --fleet-idle --decisions=/home/ubuntu/fill-blank-model-decisions-XXXX.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FLEET_IDLE = flag("fleet-idle");
const ONLY_MAKE = opt("make");
const DECISIONS_IN = opt("decisions");
const UPDATE_BATCH = 200; // (vin, dealer_id) pairs per UPDATE
const PAUSE_MS = 150;
const VPIC_BATCH = 50; // vPIC's batch limit
const VPIC_PAUSE_MS = 250;
const MAX_INDIVIDUAL_DECODE = 300; // pattern too big to decode VIN by VIN when its samples disagree

if (APPLY && !FLEET_IDLE) {
  console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first).");
  process.exit(1);
}
const modPath = path.resolve(process.cwd(), "src/vinModelFill.js");
if (!fs.existsSync(modPath)) {
  console.error(`Missing ${modPath} — deploy src/vinModelFill.js to the box first.`);
  process.exit(1);
}
const F = await import(modPath);

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, eq).trim()] = v;
    }
  } catch { /* missing file: nothing from it */ }
  return out;
}
const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = mysql.createPool({
  host: dbEnv.DB_HOST || process.env.DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout",
  user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});

// ---- sync lock (apply only) -------------------------------------------------------------------------------
async function lockCall(action, owner, extra = {}) {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
}

// ---- vPIC -------------------------------------------------------------------------------------------------
let vpicCalls = 0;
async function vpicBatch(vins) {
  for (let attempt = 1; ; attempt++) {
    try {
      vpicCalls++;
      const res = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ format: "json", data: vins.join(";") }), signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const out = new Map();
      for (const r of j.Results || []) { const p = F.parseVpicResult(r); if (p.vin) out.set(p.vin.toUpperCase(), p); }
      return out;
    } catch (err) {
      if (attempt >= 4) { console.error(`  vPIC batch of ${vins.length} failed after 4 attempts: ${err.message}`); return new Map(); }
      await sleep(2000 * attempt);
    }
  }
}
// A few batches in flight at once: one vPIC call of 50 VINs takes ~3-4s, so a strictly sequential pass over ~16k VINs
// would run for over twenty minutes. Three at a time is gentle on a public API.
const VPIC_CONCURRENCY = 3;
async function decodeMany(vins) {
  const all = new Map();
  const batches = [];
  for (let i = 0; i < vins.length; i += VPIC_BATCH) batches.push(vins.slice(i, i + VPIC_BATCH));
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= batches.length) return;
      for (const [k, v] of await vpicBatch(batches[idx])) all.set(k, v);
      done++;
      if (done % 40 === 0) console.log(`  ...decoded ~${Math.min(done * VPIC_BATCH, vins.length)}/${vins.length} VINs`);
      await sleep(VPIC_PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VPIC_CONCURRENCY, batches.length) }, worker));
  return all;
}

const fmt = (n) => Number(n).toLocaleString("en-US");
const pad = (s, n) => String(s).padEnd(n);

async function counts() {
  const [[r]] = await pool.query("SELECT COUNT(*) AS inStock, SUM(model IS NULL OR TRIM(model) = '') AS blank FROM dealer_inventory WHERE removed_at IS NULL");
  return { inStock: Number(r.inStock), blank: Number(r.blank), pct: ((100 * Number(r.blank)) / Number(r.inStock)).toFixed(2) };
}

async function main() {
  console.log(`${APPLY ? "LIVE (--apply)" : "DRY RUN"}  ${new Date().toISOString()}${ONLY_MAKE ? `  make=${ONLY_MAKE}` : ""}`);
  const before = await counts();
  console.log(`In-stock rows: ${fmt(before.inStock)}; blank model: ${fmt(before.blank)} (${before.pct}%)`);

  const makeClause = ONLY_MAKE ? " AND i.make = ?" : "";
  // Only index-covered columns here (idx_inv_stock_make carries removed_at, make, model and the primary key): selecting
  // vdp_url as well made MariaDB scan all ~3M wide rows (EXPLAIN type ALL, minutes of I/O), and an ORDER BY made it walk
  // the table in primary-key order. The listing URL is fetched below, only for rows that need it.
  const [rowsRaw] = await pool.query(
    `SELECT i.vin, i.dealer_id AS dealerId, i.make, d.state FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id
     WHERE i.removed_at IS NULL AND (i.model IS NULL OR i.model = '')${makeClause}`, ONLY_MAKE ? [ONLY_MAKE] : []);
  rowsRaw.sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealerId - b.dealerId));
  const rows = rowsRaw.map((r) => ({ vin: String(r.vin || "").toUpperCase(), dealerId: Number(r.dealerId), make: r.make, vdpUrl: null, state: r.state }));
  // Listing URLs, by primary key (a plain OR of per-row comparisons), for the rows whose VIN fails its check digit
  // (the only ones where the URL decides) — and later for the sample lines in the report.
  const fetchUrls = async (list) => {
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const [found] = await pool.query(`SELECT vin, dealer_id AS dealerId, vdp_url AS vdpUrl FROM dealer_inventory WHERE ${chunk.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ")}`, chunk.flatMap((r) => [r.vin, r.dealerId]));
      const byKey = new Map(found.map((f) => [`${String(f.vin).toUpperCase()}|${Number(f.dealerId)}`, f.vdpUrl]));
      for (const r of chunk) r.vdpUrl = byKey.get(`${r.vin}|${r.dealerId}`) ?? null;
    }
  };
  await fetchUrls(rows.filter((r) => F.VIN_RE.test(r.vin) && !F.checkDigitValid(r.vin)));
  console.log(`Rows to consider: ${fmt(rows.length)} (${fmt(rows.filter((r) => F.VIN_RE.test(r.vin)).length)} with a 17-character VIN)`);

  let decisions;
  let plan = null;
  let spellings = null;
  if (APPLY && DECISIONS_IN) {
    const saved = JSON.parse(fs.readFileSync(DECISIONS_IN, "utf8"));
    const wanted = new Map(saved.fills.map((f) => [`${f.vin}|${f.dealerId}`, f]));
    decisions = rows.map((r) => { const f = wanted.get(`${r.vin}|${r.dealerId}`); return f ? { action: "fill", model: f.model, tier: f.tier, seenInDb: f.seenInDb } : { action: "skip", reason: "not in the reviewed decisions file (or no longer blank)" }; });
    console.log(`Applying the reviewed decisions: ${fmt(saved.fills.length)} fills in ${DECISIONS_IN}`);
  } else {
    const [groups] = await pool.query("SELECT make, model, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND model IS NOT NULL AND TRIM(model) <> '' GROUP BY make, model");
    spellings = F.buildSpellings(groups.map((g) => ({ make: g.make, model: g.model, n: Number(g.n) })));
    plan = F.planDecodeTargets(rows);
    const sampleVins = [...plan.values()].flatMap((g) => g.sampleVins);
    console.log(`VIN patterns: ${fmt(plan.size)} (decoding ${fmt(sampleVins.length)} sample VINs, up to 3 per pattern, ${VPIC_BATCH} per vPIC call)`);
    const decoded = await decodeMany(sampleVins);
    const verdicts = new Map(); // key -> verdict
    const inconsistent = [];
    for (const [key, g] of plan) {
      const v = F.patternConsensus(g.sampleVins.map((vin) => decoded.get(vin)).filter(Boolean));
      if (g.sampleVins.some((vin) => !decoded.has(vin)) && v.status === "no-model") verdicts.set(key, undefined); // lookup failed, not "vPIC has nothing"
      else verdicts.set(key, v);
      if (v.status === "inconsistent") inconsistent.push(key);
    }
    const perVin = new Map();
    let skippedBigInconsistent = 0;
    for (const key of inconsistent) {
      const g = plan.get(key);
      const vins = [...new Set(g.rows.map((r) => r.vin))];
      if (vins.length > MAX_INDIVIDUAL_DECODE) { skippedBigInconsistent += vins.length; continue; }
      const each = await decodeMany(vins);
      for (const vin of vins) perVin.set(vin, each.has(vin) ? F.patternConsensus([each.get(vin)]) : undefined);
    }
    decisions = rows.map((r) => {
      if (!F.VIN_RE.test(r.vin)) return F.decideRow(r, undefined, spellings);
      const key = F.vinPatternKey(r.vin);
      const v = verdicts.get(key);
      if (v && v.status === "inconsistent") return F.decideRow(r, perVin.has(r.vin) ? perVin.get(r.vin) : { status: "inconsistent" }, spellings);
      return F.decideRow(r, v, spellings);
    });
    console.log(`vPIC calls: ${fmt(vpicCalls)}; patterns whose samples disagreed: ${fmt(inconsistent.length)} (${fmt(skippedBigInconsistent)} VINs skipped as too many to decode one by one)`);
  }

  // ---- report ---------------------------------------------------------------------------------------------
  const s = F.summarize(rows, decisions);
  console.log(`\n=== ${APPLY ? "Plan being applied" : "DRY-RUN REPORT"} ===`);
  console.log(`Blank in-stock rows considered: ${fmt(s.totals.blank)}   would fill: ${fmt(s.totals.fills)}   would skip: ${fmt(s.totals.skipped)}`);
  console.log(`  tier A (clean VIN, make matches): ${fmt(decisions.filter((d) => d.tier === "A").length)}   tier B (check digit fails, listing URL names the model): ${fmt(decisions.filter((d) => d.tier === "B").length)}`);
  console.log("\nBy make:");
  console.log(`  ${pad("make", 16)}${pad("blank", 9)}${pad("fill A", 9)}${pad("fill B", 9)}skipped`);
  for (const m of s.byMake) console.log(`  ${pad(m.make, 16)}${pad(fmt(m.blank), 9)}${pad(fmt(m.fillA), 9)}${pad(fmt(m.fillB), 9)}${fmt(m.skipped)}`);
  console.log("\nSkip reasons:");
  for (const r of s.reasons) console.log(`  ${pad(fmt(r.n), 8)}${r.reason}`);

  const fills = [];
  decisions.forEach((d, i) => { if (d.action === "fill") fills.push({ ...rows[i], model: d.model, tier: d.tier, seenInDb: d.seenInDb }); });
  const newSpell = new Map();
  for (const f of fills) if (!f.seenInDb) newSpell.set(`${f.make} → ${f.model}`, (newSpell.get(`${f.make} → ${f.model}`) || 0) + 1);
  console.log(`\nModels filled that the database has NOT used before for that make (new spellings): ${fmt(newSpell.size)}`);
  for (const [k, n] of [...newSpell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${pad(fmt(n), 7)}${k}`);

  const flToyota = fills.filter((f) => f.make === "Toyota" && f.state === "FL" && f.vin.startsWith("2T3"));
  const flToyotaAll = rows.filter((r) => r.make === "Toyota" && r.state === "FL" && r.vin.startsWith("2T3"));
  await fetchUrls(flToyota.slice(0, 10).filter((f) => !f.vdpUrl));
  console.log(`\nFL Toyota 2T3… rows: ${flToyotaAll.length} blank, ${flToyota.length} would be filled (${[...new Set(flToyota.map((f) => f.model))].join(", ") || "-"}); sample:`);
  for (const f of flToyota.slice(0, 10)) console.log(`  ${f.vin}  ${f.make} → ${f.model}  tier ${f.tier}  ${String(f.vdpUrl || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 90)}`);
  console.log("\nSample of fills across makes (every 1/Nth):");
  const step = Math.max(1, Math.floor(fills.length / 25));
  for (let i = 0; i < fills.length; i += step) { const f = fills[i]; console.log(`  ${f.vin}  ${pad(f.make, 13)}→ ${pad(f.model, 22)} tier ${f.tier}  ${f.state || ""}`); }
  console.log("\nExamples per skip reason:");
  const shown = new Map();
  decisions.forEach((d, i) => { if (d.action === "skip") { const k = d.reason.replace(/\(row ".*"\)/, "(row vs vPIC)"); const n = shown.get(k) || 0; if (n < 2) { shown.set(k, n + 1); console.log(`  [${k.slice(0, 48)}] ${rows[i].vin} make=${rows[i].make} ${d.reason.startsWith("make mismatch") ? d.reason : ""}`); } } });

  const outFile = path.join(os.homedir(), `fill-blank-model-decisions-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), before, totals: s.totals, fills: fills.map(({ vin, dealerId, make, model, tier, seenInDb }) => ({ vin, dealerId, make, model, tier, seenInDb })), skips: decisions.map((d, i) => (d.action === "skip" ? { vin: rows[i].vin, dealerId: rows[i].dealerId, make: rows[i].make, reason: d.reason } : null)).filter(Boolean) }));
  console.log(`\nFull decisions written to ${outFile}`);
  if (!APPLY) { console.log("DRY RUN — nothing was changed."); await pool.end(); return; }

  // ---- apply ----------------------------------------------------------------------------------------------
  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found (env, .env): refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `fill-blank-model-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`\nSync lock taken as ${owner}; updating ${fmt(fills.length)} rows...`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  let updated = 0, planned = 0, statements = 0, slowest = 0, retries = 0;
  // A deadlock or lock-wait timeout (another writer touching the same rows) is retried a few times; the statement is
  // idempotent because it re-checks "still blank" per row.
  const runUpdate = async (sql, params) => {
    for (let attempt = 1; ; attempt++) {
      try { return await pool.query(sql, params); } catch (err) {
        if (!(err && (err.errno === 1213 || err.errno === 1205)) || attempt >= 5) throw err;
        retries++; console.error(`  UPDATE hit ${err.code} (attempt ${attempt}); retrying in ${2 * attempt}s`);
        await sleep(2000 * attempt);
      }
    }
  };
  try {
    const groups = new Map();
    for (const f of fills) { const k = `${f.make}\u0000${f.model}`; if (!groups.has(k)) groups.set(k, { make: f.make, model: f.model, pairs: [] }); groups.get(k).pairs.push([f.vin, f.dealerId]); }
    for (const g of groups.values()) {
      for (let i = 0; i < g.pairs.length; i += UPDATE_BATCH) {
        const chunk = g.pairs.slice(i, i + UPDATE_BATCH);
        // A plain OR of per-row (vin = ? AND dealer_id = ?) comparisons — never a row-value IN-list, which MariaDB
        // cannot range-scan on this table. The trailing conditions re-check, per row, that it is still in stock and
        // still blank, so a model a dealer's sync wrote in the meantime is never overwritten. FORCE INDEX (PRIMARY)
        // pins the plan EXPLAIN showed (range on the primary key, ~200 rows): a plan flip to a scan of the in-stock
        // index would lock millions of rows.
        const conds = chunk.map(() => "(vin = ? AND dealer_id = ?)").join(" OR ");
        const t0 = Date.now();
        const [res] = await runUpdate(
          `UPDATE dealer_inventory FORCE INDEX (PRIMARY) SET model = ? WHERE removed_at IS NULL AND make = ? AND (model IS NULL OR TRIM(model) = '') AND (${conds})`,
          [g.model, g.make, ...chunk.flat()]);
        const took = Date.now() - t0;
        slowest = Math.max(slowest, took);
        updated += res.affectedRows; planned += chunk.length; statements++;
        if (statements % 25 === 0) console.log(`  ...${fmt(updated)} updated of ${fmt(planned)} planned so far (slowest statement ${slowest} ms)`);
        await sleep(took > 1500 ? PAUSE_MS + took : PAUSE_MS); // a slow statement means the database is busy: give it room
      }
    }
    console.log(`\nApplied: ${fmt(updated)} rows updated of ${fmt(planned)} planned in ${fmt(statements)} statements (${fmt(planned - updated)} had changed since the dry run and were left alone); slowest statement ${slowest} ms, ${retries} retries.`);
  } finally {
    await release();
  }
  const after = await counts();
  console.log(`In-stock rows: ${fmt(after.inStock)}; blank model: ${fmt(after.blank)} (${after.pct}%)   [before: ${fmt(before.blank)} (${before.pct}%)]`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
