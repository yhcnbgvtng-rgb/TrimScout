// One-off cleanup of dealership_contacts.contact_email after the 2026-10-30 "Sales email on file" audit: clear addresses the shared
// reachability rule calls invalid, and copy usable addresses out of `notes` into the empty email column. Same rule as the tile, the
// wizard badge and quote routing (src/quoteReachable.js), so what this changes is exactly what the product already refuses to send to.
//
//   cd /opt/trimscout-deals && node 2026-10-30-contact-email-cleanup.mjs                          # DRY RUN (default): counts only, changes nothing
//   cd /opt/trimscout-deals && node 2026-10-30-contact-email-cleanup.mjs --write-plan=/home/ubuntu/contact-email-plan.json   # dry run + save the plan for review
//   cd /opt/trimscout-deals && node 2026-10-30-contact-email-cleanup.mjs --apply --fleet-idle --go --plan=/home/ubuntu/contact-email-plan.json
//
// Needs src/quoteReachable.js and src/contactEmailCleanup.js next to it (copy both to /opt/trimscout-deals/src/).
// Dry run: reader login, read-only session, 20 s cap per query; prints counts only (never an address). --write-plan also writes the plan
// (ids with old and new values) for a human to review; that file is the only thing --apply will act on.
// --apply (writer login) refuses unless ALL of: --fleet-idle (operator asserts no crawl or sync is running on any box), --go (Paul's go-ahead,
// given in chat for THIS run), and --plan. It then takes the deals-API sync lock (exit 4 if held) and heartbeats it, writes a full backup
// of every affected row and a rollback file BEFORE the first update (and refuses to continue if either cannot be written), updates by primary
// key in small batches guarded on the old value (a row edited since the plan is skipped, not overwritten), and releases the lock.
// Rollback: node 2026-10-30-contact-email-cleanup.mjs --rollback --fleet-idle --go --file=<the rollback file it wrote>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const mysql = createRequire(path.resolve(process.cwd(), "package.json"))("mysql2/promise");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const ROLLBACK = flag("rollback");
const WRITES = APPLY || ROLLBACK;
const PLAN_IN = opt("plan");
const ROLLBACK_IN = opt("file");
const BATCH = 100;
const PAUSE_MS = 150;
if (APPLY && ROLLBACK) { console.error("Pick one of --apply or --rollback."); process.exit(1); }
if (WRITES && !flag("fleet-idle")) { console.error("Refusing to write without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
if (WRITES && !flag("go")) { console.error("Refusing to write without --go (Paul's explicit go-ahead for this run)."); process.exit(1); }
if (APPLY && !PLAN_IN) { console.error("--apply needs --plan=<file written by a reviewed dry run with --write-plan>."); process.exit(1); }
if (ROLLBACK && !ROLLBACK_IN) { console.error("--rollback needs --file=<rollback file written by --apply>."); process.exit(1); }
const { planContactEmailCleanup, rollbackStatements } = await import(path.resolve(process.cwd(), "src/contactEmailCleanup.js"));

const env = {};
for (const l of fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));
const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 3306, database: env.DB_NAME,
  user: WRITES ? env.DB_WRITER_USER : env.DB_READER_USER, password: WRITES ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD,
});
if (!WRITES) { await conn.query("SET SESSION max_statement_time=20"); await conn.query("SET SESSION TRANSACTION READ ONLY"); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || env.DEALS_API_PORT || 3004}`;
const lockCall = async (action, owner, extra = {}) => {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": env.TRIMSCOUT_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
};

async function withLock(label, fn) {
  const owner = `${label}-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await conn.end(); process.exit(4); }
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  console.log(`Sync lock taken as ${owner}`);
  try { return await fn(); } finally { await release(); await conn.end(); }
}

/** Guarded per-row write: only touches a row whose contact_email is still what the plan saw. Returns rows changed. */
async function writeGuarded(items) {
  let changed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    for (const it of items.slice(i, i + BATCH)) {
      const [res] = await conn.query("UPDATE dealership_contacts SET contact_email = ? WHERE id = ? AND contact_email <=> ?", [it.to, it.id, it.from]);
      changed += res.affectedRows;
    }
    if ((i / BATCH) % 20 === 0) console.log(`  ${fmt(Math.min(i + BATCH, items.length))}/${fmt(items.length)} processed, ${fmt(changed)} changed`);
    await sleep(PAUSE_MS);
  }
  return changed;
}

if (!WRITES) {
  const [rows] = await conn.query("SELECT id, dealer_name AS dealerName, contact_email AS contactEmail, notes, website, domains_json AS domainsJson, email_opt_out AS emailOptOut FROM dealership_contacts WHERE is_test = 0");
  // Index-covered (idx_inv_stock_dealer_id): which directory rows have cars on the lot right now.
  const [live] = await conn.query("SELECT DISTINCT dealer_id AS id FROM dealer_inventory WHERE removed_at IS NULL");
  const plan = planContactEmailCleanup(rows, { activeIds: new Set(live.map((r) => Number(r.id))) });
  const c = plan.counts;
  console.log(`DRY RUN  directory rows ${fmt(c.rows)}, with cars on the lot ${fmt(live.length)}`);
  console.log(`Would CLEAR ${fmt(c.clear)} stored addresses (${fmt(c.clearActive)} on rooftops with cars on the lot): ${Object.entries(c.clearByKind).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") || "none"}`);
  console.log(`Would MOVE  ${fmt(c.move)} addresses from notes into contact_email (${fmt(c.moveActive)} on rooftops with cars on the lot)`);
  console.log(`Notes addresses NOT moved: ${Object.entries(c.moveRejected).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")}`);
  const out = opt("write-plan");
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), counts: c, clear: plan.clear, move: plan.move }), { mode: 0o600 });
    console.log(`Plan written to ${out} (contains full addresses — keep it on the box).`);
  }
  console.log("DRY RUN — nothing was changed.");
  await conn.end();
  process.exit(0);
}

if (APPLY) {
  const saved = JSON.parse(fs.readFileSync(PLAN_IN, "utf8"));
  const plan = { clear: saved.clear || [], move: saved.move || [] };
  const ids = [...plan.clear, ...plan.move].map((x) => x.id);
  await withLock("contact-email-cleanup", async () => {
    // Backup + rollback first. If either cannot be written, nothing is touched.
    const [before] = await conn.query("SELECT id, dealer_name, contact_email, notes FROM dealership_contacts WHERE id IN (?)", [ids.length ? ids : [0]]);
    const backup = path.join(os.homedir(), `contact-email-backup-${stamp}.json`);
    const rollback = path.join(os.homedir(), `contact-email-rollback-${stamp}.json`);
    fs.writeFileSync(backup, JSON.stringify({ takenAt: new Date().toISOString(), rows: before }), { mode: 0o600 });
    fs.writeFileSync(rollback, JSON.stringify({ createdAt: new Date().toISOString(), restore: rollbackStatements(plan) }), { mode: 0o600 });
    if (!fs.existsSync(backup) || !fs.existsSync(rollback) || fs.statSync(backup).size === 0 || fs.statSync(rollback).size === 0) throw new Error("backup/rollback file missing or empty — aborting before any change");
    console.log(`Backup ${backup}\nRollback ${rollback}`);
    const cleared = await writeGuarded(plan.clear.map((c) => ({ id: c.id, from: c.old, to: null })));
    const moved = await writeGuarded(plan.move.map((m) => ({ id: m.id, from: m.old, to: m.next })));
    console.log(`Done: ${fmt(cleared)} of ${fmt(plan.clear.length)} cleared, ${fmt(moved)} of ${fmt(plan.move.length)} moved (the rest were edited since the plan and were left alone).`);
  });
} else {
  const saved = JSON.parse(fs.readFileSync(ROLLBACK_IN, "utf8"));
  await withLock("contact-email-rollback", async () => {
    const restored = await writeGuarded((saved.restore || []).map((r) => ({ id: r.id, from: r.writtenValue, to: r.restore })));
    console.log(`Rollback done: ${fmt(restored)} of ${fmt((saved.restore || []).length)} rows restored.`);
  });
}
