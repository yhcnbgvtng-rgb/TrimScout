// One live row per VIN — the one-off cleanup of the duplicates that built up before the nightly step (vinKeeper.js) exists.
//
//   cd /opt/trimscout-deals && node 2026-10-11-dedupe-active-vins.mjs                       # DRY RUN (default): reads, plans, writes the plan, changes nothing
//   cd /opt/trimscout-deals && sudo node 2026-10-11-dedupe-active-vins.mjs --apply --fleet-idle --plan=/home/ubuntu/dedupe-vins-plan-XXXX.json
//
// Needs src/vinKeeper.js next to it (copy it to /opt/trimscout-deals/src/). Dry run: reader login, read-only session, 20 s cap per query, the
// in-stock rows are read in dealer-id ranges (idx_inv_stock_dealer_id), stops on the first failed range. It writes ~/dedupe-vins-plan-<time>.json
// (every row it would retire, with the keeper beside it = the rollback list) and prints the counts.
// --apply (writer login) refuses without --fleet-idle (the operator asserting no crawl or sync is running on any box), takes the deals-API sync
// lock and heartbeats it (exit 4 if held), retires exactly the rows in the reviewed --plan file by primary key in small batches with a pause,
// re-checking per row that it is still live, and releases the lock. Rollback: set removed_at = NULL for the plan's retired pairs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const mysql = createRequire(path.resolve(process.cwd(), "package.json"))("mysql2/promise");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const PLAN_IN = opt("plan");
const BATCH = 200;
const PAUSE_MS = 150;
const RANGE = 200;
if (APPLY && !flag("fleet-idle")) { console.error("Refusing to --apply without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
if (APPLY && !PLAN_IN) { console.error("--apply needs --plan=<file written by a reviewed dry run>."); process.exit(1); }
const { planVinKeepers, buildRetireStatement } = await import(path.resolve(process.cwd(), "src/vinKeeper.js"));

const env = {};
for (const l of fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString("en-US");
const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 3306, database: env.DB_NAME,
  user: APPLY ? env.DB_WRITER_USER : env.DB_READER_USER, password: APPLY ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD,
});
if (!APPLY) { await conn.query("SET SESSION max_statement_time=20"); await conn.query("SET SESSION TRANSACTION READ ONLY"); }

const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || env.DEALS_API_PORT || 3004}`;
const lockCall = async (action, owner, extra = {}) => {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
};

if (!APPLY) {
  const foreignBefore = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [[mx]] = await conn.query("SELECT MAX(dealer_id) AS m FROM dealer_inventory");
  const holders = new Map();
  let live = 0;
  for (let a = 0; a <= mx.m; a += RANGE) {
    const [r] = await conn.query("SELECT vin, dealer_id AS d FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id BETWEEN ? AND ?", [a, a + RANGE - 1]);
    live += r.length;
    for (const x of r) { const e = holders.get(x.vin); if (e) e.push(x.d); else holders.set(x.vin, [x.d]); }
  }
  const dupVins = [...holders].filter(([, d]) => d.length > 1).map(([v]) => v);
  console.log(`DRY RUN  live rows ${fmt(live)}, distinct VINs ${fmt(holders.size)}, VINs held by 2+ stores ${fmt(dupVins.length)}`);
  const rows = [];
  for (let i = 0; i < dupVins.length; i += 300) {
    const [r] = await conn.query("SELECT vin, dealer_id AS dealerId, dealer_name AS name, state, source_box AS box, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, source FROM dealer_inventory WHERE removed_at IS NULL AND vin IN (?)", [dupVins.slice(i, i + 300)]);
    rows.push(...r);
  }
  const plan = planVinKeepers(rows, { foreignBefore });
  const keeperOf = new Map(plan.keep);
  const byKey = new Map(rows.map((r) => [`${r.vin}|${r.dealerId}`, r]));
  const retire = plan.retire.map(([vin, dealerId]) => { const r = byKey.get(`${vin}|${dealerId}`); return { vin, dealerId, name: r.name, state: r.state, box: r.box, lastSeenAt: r.lastSeenAt, keeperDealerId: keeperOf.get(vin) }; });
  const out = path.join(os.homedir(), `dedupe-vins-plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), foreignBefore, vinsWithDuplicates: plan.vinsWithDuplicates, retire }));
  console.log(`Would retire ${fmt(retire.length)} rows (${fmt(retire.filter((r) => r.dealerId === 0).length)} of them in the "no store matched" bucket); keeps one row for each of ${fmt(plan.keep.length)} VINs.`);
  console.log(`Plan written to ${out}\nDRY RUN — nothing was changed.`);
  await conn.end();
  process.exit(0);
}

const saved = JSON.parse(fs.readFileSync(PLAN_IN, "utf8"));
const pairs = saved.retire.map((r) => [r.vin, r.dealerId]);
const owner = `dedupe-active-vins-${process.pid}`;
const lock = await lockCall("acquire", owner, { heartbeat: true });
if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await conn.end(); process.exit(4); }
const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
process.on("SIGTERM", async () => { await release(); process.exit(143); });
let retired = 0;
try {
  console.log(`Sync lock taken as ${owner}; retiring ${fmt(pairs.length)} rows from ${PLAN_IN}`);
  for (let i = 0; i < pairs.length; i += BATCH) {
    const st = buildRetireStatement(pairs.slice(i, i + BATCH));
    const [res] = await conn.query(st.sql, st.args);
    retired += res.affectedRows;
    if ((i / BATCH) % 50 === 0) console.log(`  ${fmt(i + BATCH)}/${fmt(pairs.length)} planned, ${fmt(retired)} retired`);
    await sleep(PAUSE_MS);
  }
  console.log(`Done: ${fmt(retired)} rows retired (${fmt(pairs.length - retired)} were already not live).`);
} finally {
  await release();
  await conn.end();
}
