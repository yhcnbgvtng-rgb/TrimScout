// READ-ONLY dry run of the BMW 2026-2027 option policy (src/optionPolicies/bmw-2026-2027.json) against the live inventory, on the deals box.
// Writes nothing to any database, takes no sync lock, rebuilds no facets, restarts nothing. Output goes to --out (a local JSON + markdown report).
//
//   node 2026-10-12-bmw-option-policy-dry-run.mjs --env /opt/trimscout-deals/.env.trimscout-db [--out ./out] [--batch 20]
//
// Limits (approved): every query has a 20 s server-side cap (SET STATEMENT max_statement_time=20). Dealer-ID first: one covered index scan lists the
// dealer ids that hold BMW stock, then the cars are read 20 dealers at a time (never a whole-table scan). A query that times out is retried ONCE in a
// different shape (the same dealers in two smaller batches); a second timeout anywhere stops the run. The same query shape is never retried.
// Uses the READER account only. "Before" is what is stored today (dealer_inventory_options); "after" is what the policy keeps from options_json.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { buildAllowlist, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import { newTally, addVehicle, finalize } from "../lib/optionPolicyDryRun.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const envFile = opt("env", "/opt/trimscout-deals/.env.trimscout-db");
const outDir = path.resolve(opt("out", "./out"));
const BATCH = Math.min(25, Math.max(10, Number(opt("batch", 20)) || 20));
const CAP_SECONDS = 20;

const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, database: env.DB_NAME, connectionLimit: 2 });

let timeouts = 0, queries = 0, slowest = 0;
class StopRun extends Error {}
async function q(shape, sql, params) {
  queries++;
  const t0 = Date.now();
  try {
    const [rows] = await pool.query(`SET STATEMENT max_statement_time=${CAP_SECONDS} FOR ${sql}`, params);
    slowest = Math.max(slowest, Date.now() - t0);
    return rows;
  } catch (err) {
    if (err && (err.errno === 1969 || /max_statement_time/.test(err.message))) {
      timeouts++;
      console.log(`  TIMEOUT (${CAP_SECONDS}s) in "${shape}" (timeout #${timeouts})`);
      if (timeouts >= 2) throw new StopRun(`a second query timed out ("${shape}") - stopping, nothing retried`);
      return null; // caller falls back to a DIFFERENT shape, once
    }
    throw err;
  }
}

// --policy <file>: use this policy JSON instead of the bundled ones (for what-if runs, e.g. the policy built with --keep-interior).
const policyArg = opt("policy");
const allow = buildAllowlist(null, policyArg ? JSON.parse(fs.readFileSync(path.resolve(policyArg), "utf8")) : loadBundledModelPoliciesRaw());
const tally = newTally();
// Up to 3 sample VINs where the policy changes what the car holds: stored rows today vs the keys the policy keeps. Reported with the run so they can be spot-checked on the site.
const samples = [];

const CAR_SQL = "SELECT vin, dealer_id, make, year, model, trim, options_json FROM dealer_inventory FORCE INDEX (idx_inv_by_dealer_covering) WHERE removed_at IS NULL AND dealer_id IN (?) AND make = 'BMW' AND year IN (2026, 2027)";
// A single-column IN-list on the options table's primary-key prefix (vin) is a set of index ranges; (vin, dealer_id) tuple IN-lists are NOT (full scan).
const ROW_SQL = "SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE vin IN (?)";

/** Runs `sql` over `items` in chunks. A chunk that times out is retried ONCE as two half-size chunks (a different shape); a second timeout stops the run. */
async function chunked(shape, sql, items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size);
    let rows = await q(shape, sql, [part]);
    if (rows === null) {
      rows = [];
      const mid = Math.ceil(part.length / 2);
      for (const half of [part.slice(0, mid), part.slice(mid)]) rows.push(...((await q(`${shape} (half)`, sql, [half])) || []));
    }
    out.push(...rows);
  }
  return out;
}

async function readBatch(ids, label) {
  const cars = await chunked(`cars ${label}`, CAR_SQL, ids, ids.length);
  const wanted = new Set(cars.map((c) => `${c.vin}|${c.dealer_id}`));
  const vins = [...new Set(cars.map((c) => c.vin))];
  const rows = (await chunked(`options ${label}`, ROW_SQL, vins, 1000)).filter((r) => wanted.has(`${r.vin}|${r.dealer_id}`));
  return { cars, rows };
}

const started = Date.now();
try {
  console.log("dealer ids with BMW stock...");
  const idRows = await q("dealer ids", "SELECT DISTINCT dealer_id FROM dealer_inventory FORCE INDEX (idx_inv_stock_make_dealer) WHERE removed_at IS NULL AND make = 'BMW'", []);
  if (idRows === null) throw new StopRun("the dealer-id query timed out");
  const ids = idRows.map((r) => Number(r.dealer_id)).sort((a, b) => a - b);
  console.log(`${ids.length} dealers; batches of ${BATCH}`);
  let carsInScope = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const { cars, rows } = await readBatch(ids.slice(i, i + BATCH), `#${i / BATCH + 1}`);
    const byVin = new Map();
    for (const r of rows) { const k = `${r.vin}|${r.dealer_id}`; if (!byVin.has(k)) byVin.set(k, []); byVin.get(k).push({ key: r.canonical_key, label: r.label, code: r.code }); }
    for (const c of cars) {
      carsInScope++;
      let options = null;
      try { options = c.options_json ? (typeof c.options_json === "string" ? JSON.parse(c.options_json) : c.options_json) : null; } catch { options = null; }
      const stored = byVin.get(`${c.vin}|${c.dealer_id}`) || [];
      const res = samples.length < 3 && modelPoliciesFor(allow, c).length ? optionRowsForVehicle(allow, c, Array.isArray(options) ? options : []) : null;
      if (res && stored.length && res.rows.length && res.rows.length !== stored.length) samples.push({ vin: c.vin, dealerId: c.dealer_id, year: c.year, model: c.model, trim: c.trim, trimTrusted: res.trimTrusted, before: stored.map((r) => r.label), after: res.rows.map((r) => `${r.label} $${r.price} (${r.kind})`) });
      addVehicle(tally, allow, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, options, byVin.get(`${c.vin}|${c.dealer_id}`) || []);
    }
    if ((i / BATCH + 1) % 10 === 0) console.log(`  ${Math.min(i + BATCH, ids.length)}/${ids.length} dealers, ${carsInScope} 2026-27 BMWs, ${queries} queries, slowest ${slowest} ms`);
  }
  const result = { generatedAt: new Date().toISOString(), dealers: ids.length, batch: BATCH, queries, timeouts, slowestQueryMs: slowest, elapsedS: Math.round((Date.now() - started) / 1000), carsInScope, samples, ...finalize(tally) };
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, opt("name", "bmw_option_policy_dry_run.json"));
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  console.log(`DONE: ${carsInScope} 2026-27 BMWs in ${result.elapsedS}s, ${queries} queries, ${timeouts} timeouts, slowest ${slowest} ms. Wrote ${outFile}`);
} catch (err) {
  console.error(err instanceof StopRun ? `STOPPED: ${err.message}` : `FAILED: ${err.stack || err.message}`);
  process.exitCode = err instanceof StopRun ? 3 : 1;
} finally {
  await pool.end();
}
