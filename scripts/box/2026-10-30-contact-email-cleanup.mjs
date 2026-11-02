// One-off cleanup of dealership_contacts.contact_email after the 2026-10-30 "Sales email on file" audit: clear addresses the shared
// reachability rule calls invalid, and copy usable addresses out of `notes` into the empty email column. Same rule as the tile, the
// wizard badge and quote routing (src/quoteReachable.js), so what this changes is exactly what the product already refuses to send to.
//
// Runs from a temp folder; nothing is installed into /opt/trimscout-deals/src. Bundle the three files, copy the folder to the box, and run
// it with the box's app folder as the working directory (that is where it finds node_modules/mysql2 and the existing .env.trimscout-db):
//   scripts/box/contact-email-cleanup-bundle.sh /tmp/cec        # on a dev machine: copies this script + the two modules into /tmp/cec
//   cd /opt/trimscout-deals && node /tmp/cec/2026-10-30-contact-email-cleanup.mjs                       # DRY RUN (default): counts only, changes nothing
//   cd /opt/trimscout-deals && node /tmp/cec/2026-10-30-contact-email-cleanup.mjs --write-plan=/tmp/cec/plan.json   # dry run + save an address-free plan
//   cd /opt/trimscout-deals && node /tmp/cec/2026-10-30-contact-email-cleanup.mjs --apply --fleet-idle --go --plan=/tmp/cec/plan.json
//
// Dry run: reader login, read-only session, 10 s cap per statement. dealership_contacts is read in primary-key batches
// (WHERE id > ? ORDER BY id LIMIT 500); dealer_inventory is only touched for the few dealers the plan changes, one index-bounded
// lookup each. Output is counts only — never an address, a contact name or a phone number. --write-plan writes ids, kinds and
// fingerprints only (no addresses), and refuses a path inside the working directory.
// --apply (writer login) refuses unless ALL of: --fleet-idle (operator asserts no crawl or sync is running on any box), --go (Paul's go-ahead,
// given in chat for THIS run), and --plan. It re-reads the directory and re-plans, acts only on items whose id and fingerprint match the
// saved plan (anything that changed since is skipped), then takes the deals-API sync lock (exit 4 if held) and heartbeats it, writes a full
// backup of every affected row and a rollback file BEFORE the first update (and refuses to continue if either cannot be written), updates by
// primary key in small batches guarded on the old value, and releases the lock. The backup and rollback files in the home folder DO hold the
// old addresses (that is what a rollback is); they are mode 0600 and stay on the box.
// Rollback: node 2026-10-30-contact-email-cleanup.mjs --rollback --fleet-idle --go --file=<the rollback file it wrote>.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const READ_BATCH = 500;
const READ_PAUSE_MS = 50;
const STATEMENT_CAP_S = 10;
if (APPLY && ROLLBACK) { console.error("Pick one of --apply or --rollback."); process.exit(1); }
if (WRITES && !flag("fleet-idle")) { console.error("Refusing to write without --fleet-idle (confirm no crawl or sync is running on any box first)."); process.exit(1); }
if (WRITES && !flag("go")) { console.error("Refusing to write without --go (Paul's explicit go-ahead for this run)."); process.exit(1); }
if (APPLY && !PLAN_IN) { console.error("--apply needs --plan=<file written by a reviewed dry run with --write-plan>."); process.exit(1); }
if (ROLLBACK && !ROLLBACK_IN) { console.error("--rollback needs --file=<rollback file written by --apply>."); process.exit(1); }
const planOut = opt("write-plan");
const realDir = (d) => { try { return fs.realpathSync(d); } catch { return path.resolve(d); } };
if (planOut && (path.join(realDir(path.dirname(path.resolve(planOut))), path.basename(planOut)) + path.sep).startsWith(realDir(process.cwd()) + path.sep)) { console.error("Refusing to write the plan inside the working directory (the app folder). Pick a path under /tmp or your home folder."); process.exit(1); }

// The two modules ship next to this script (bundle folder); inside the repo they live in the crawler's src/.
const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = fs.existsSync(path.join(here, "contactEmailCleanup.js")) ? here : path.resolve(here, "../../scrapers/lightsail-crawler/src");
const { planContactEmailCleanup, rollbackStatements } = await import(pathToFileURL(path.join(modDir, "contactEmailCleanup.js")).href);

const env = {};
for (const l of fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));
/** Whatever an error says, it never leaves this process with an address in it. */
const scrub = (e) => String((e && (e.code || e.message)) || e).replace(/[A-Za-z0-9._%+'\-]+@[A-Za-z0-9.\-]+/g, "<redacted>").slice(0, 200);
/** Id + old + new, hashed: lets --apply tell the plan it reviewed from a changed row without the plan file holding an address. */
const fingerprint = (id, from, to) => crypto.createHash("sha256").update(`${id}|${from ?? ""}|${to ?? ""}`).digest("hex").slice(0, 16);
const conn = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 3306, database: env.DB_NAME,
  user: WRITES ? env.DB_WRITER_USER : env.DB_READER_USER, password: WRITES ? env.DB_WRITER_PASSWORD : env.DB_READER_PASSWORD,
});
await conn.query(`SET SESSION max_statement_time=${STATEMENT_CAP_S}`);
if (!WRITES) await conn.query("SET SESSION TRANSACTION READ ONLY");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

/** The directory in primary-key batches: each statement is a bounded range read, never a full-table scan. */
async function loadDirectory() {
  const rows = [];
  let last = 0;
  for (;;) {
    const [batch] = await conn.query(
      "SELECT id, dealer_name AS dealerName, contact_email AS contactEmail, notes, website, domains_json AS domainsJson, email_opt_out AS emailOptOut FROM dealership_contacts WHERE id > ? AND is_test = 0 ORDER BY id LIMIT ?",
      [last, READ_BATCH],
    );
    if (!batch.length) break;
    for (const r of batch) rows.push(r);
    last = Number(batch[batch.length - 1].id);
    if (batch.length < READ_BATCH) break;
    await sleep(READ_PAUSE_MS);
  }
  return rows;
}

/** Which of these dealers have cars on the lot: one index-bounded lookup per dealer_id (the plan touches hundreds, not the whole directory). */
async function activeAmong(ids) {
  const active = new Set();
  let unknown = 0;
  for (const id of ids) {
    try {
      const [r] = await conn.query("SELECT 1 FROM dealer_inventory WHERE dealer_id = ? AND removed_at IS NULL LIMIT 1", [id]);
      if (r.length) active.add(Number(id));
    } catch { unknown++; }
  }
  return { active, unknown };
}

/** Plans over the whole directory; the on-the-lot counts come from a second pass limited to the dealers the first pass touches. */
async function buildPlan(rows) {
  const first = planContactEmailCleanup(rows);
  const touched = [...new Set([...first.clear, ...first.move].map((x) => x.id).concat(first.lostReachableIds))];
  const { active, unknown } = await activeAmong(touched);
  return { plan: planContactEmailCleanup(rows, { activeIds: active }), activeUnknown: unknown };
}

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
  try {
    const rows = await loadDirectory();
    const { plan, activeUnknown } = await buildPlan(rows);
    const c = plan.counts;
    const kinds = (o) => Object.entries(o).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") || "none";
    console.log(`DRY RUN  directory rows checked ${fmt(c.rows)} (read in primary-key batches of ${READ_BATCH}, ${STATEMENT_CAP_S} s cap per statement)`);
    console.log(`Would CLEAR ${fmt(c.clear)} stored addresses (${fmt(c.clearActive)} on rooftops with cars on the lot): ${kinds(c.clearByKind)}`);
    console.log(`Would MOVE  ${fmt(c.move)} addresses from notes into contact_email (${fmt(c.moveActive)} on rooftops with cars on the lot)`);
    console.log(`Notes addresses NOT moved: ${kinds(c.moveRejected)}`);
    console.log(`Reachable email, today ${fmt(c.reachableBefore)} -> after cleanup ${fmt(c.reachableAfter)}`);
    console.log(`Dealers left with NO reachable email after cleanup: ${fmt(c.noReachableAfter)} (of which ${fmt(c.lostReachable)} have one today and would lose it; ${fmt(c.lostReachableActive)} of those have cars on the lot)`);
    if (activeUnknown) console.log(`${fmt(activeUnknown)} on-the-lot lookups timed out or failed; the on-the-lot figures above are a floor.`);
    if (planOut) {
      const plan2 = {
        generatedAt: new Date().toISOString(),
        counts: c,
        clear: plan.clear.map((x) => ({ id: x.id, kind: x.kind, fp: fingerprint(x.id, x.old, null) })),
        move: plan.move.map((x) => ({ id: x.id, fp: fingerprint(x.id, null, x.next) })),
        lostReachableIds: plan.lostReachableIds,
      };
      fs.writeFileSync(planOut, JSON.stringify(plan2), { mode: 0o600 });
      console.log(`Plan written to ${planOut}: ${fmt(plan2.clear.length + plan2.move.length)} rows (ids, kinds and fingerprints only, no addresses).`);
    }
    console.log("DRY RUN — nothing was changed.");
  } catch (e) {
    console.error(`DRY RUN failed, nothing was changed: ${scrub(e)}`);
    await conn.end().catch(() => {});
    process.exit(2);
  }
  await conn.end();
  process.exit(0);
}

if (APPLY) {
  const saved = JSON.parse(fs.readFileSync(PLAN_IN, "utf8"));
  const current = planContactEmailCleanup(await loadDirectory());
  // Only items that still plan out exactly as the reviewed file says; a row whose address or notes changed since is left alone.
  const savedClear = new Map((saved.clear || []).map((x) => [x.id, x.fp]));
  const savedMove = new Map((saved.move || []).map((x) => [x.id, x.fp]));
  const plan = {
    clear: current.clear.filter((x) => savedClear.get(x.id) === fingerprint(x.id, x.old, null)),
    move: current.move.filter((x) => savedMove.get(x.id) === fingerprint(x.id, null, x.next)),
  };
  console.log(`Plan check: ${fmt(plan.clear.length)} of ${fmt(savedClear.size)} clears and ${fmt(plan.move.length)} of ${fmt(savedMove.size)} moves still match the reviewed plan.`);
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
