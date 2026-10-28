// One listing per VIN, facet side: a small table (dealer_inventory_vin_losers) holds ONE row per (vin, dealer_id) that LOSES the rule in onePerVin.js
// (the store that saw the VIN most recently keeps it; ties go to the lowest price, then the lowest dealer_id). The facet counts then subtract a
// single GROUP BY over that table, joined back to dealer_inventory by primary key. No request ever scans for duplicate VINs: the table is kept
// current by the sync upsert (afterUpsert), by a debounced reconcile after sweeps (scheduleReconcile), and rebuilt/verified by backfillLosers
// (scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs). Display-only: dealer_inventory is never written.
//
// Why a table of keys and not a column on dealer_inventory: a column is a 2.2M-row ALTER on the hot table (the restart ALTERs already hang behind
// long SELECTs, project_trimscout_admin_vehicles_filter_first) and the facet GROUP BYs are index-only over indexes that do not contain it, so a
// `dup_loser = 0` predicate would force a row lookup per counted row (the shape that blew the 20 s cap on Ford, retailFacets.js). A losers table is
// ~600k keys; the join revalidates each loser against the live row (removed / stale / wholesale / seen-window), so a loser that was swept since the
// last reconcile is simply not counted.
//
// Everything that touches the database takes its pool / helpers as arguments so the tests drive it with an in-memory fake. Pure parts are exported.
import { planVinLosers } from "./onePerVin.js";
import { adjustFacetLists } from "./retailFacets.js";
import { BACKGROUND_STATEMENT_SECONDS, BACKGROUND_WAIT_MS } from "./refreshTimeouts.js";

export const LOSERS_TABLE = "dealer_inventory_vin_losers";
// Same column types as dealer_inventory's primary key (vin CHAR(17), dealer_id INT) and no explicit charset, so the PK-to-PK join uses the index.
export const LOSERS_DDL = `CREATE TABLE IF NOT EXISTS ${LOSERS_TABLE} (
  vin CHAR(17) NOT NULL,
  dealer_id INT NOT NULL DEFAULT 0,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vin, dealer_id),
  INDEX idx_vl_dealer (dealer_id)
) ENGINE=InnoDB`;


// ---- per-bucket loser counts (incremental) ------------------------------------------------------------------------------------------------
// The facets subtract the visible losers by (make, state, model, trim). Computing that with one GROUP BY over the whole losers table joined to
// dealer_inventory takes longer than the 120 s background budget on box2 (605k losers), so after any cache clear the facets fell back to undeduped
// counts. The counts are therefore kept in a small table, one row per (VIN shard, make, state, model, trim, last-seen date), and a facet reads
// only that table (a GROUP BY over a few hundred thousand narrow rows, no join).
//
// A "shard" is the first SHARD_LEN characters of the VIN. Whenever VINs are re-decided (the sync upsert hook, the post-sweep reconcile) the shards
// of those VINs are recomputed from the losers table joined to dealer_inventory by primary key: a bounded range per shard (LIKE 'XXXXXXXX%' is a
// prefix range on the primary key), 25 shards per statement, every statement capped at 10 s. The recompute is exact for its shard, so the table can
// never drift by arithmetic (no +1 / -1 deltas): a missed recompute leaves a shard stale until the next time one of its VINs is touched (the next
// nightly sync) or the next reconcile. Reads and the recompute SELECT take no row locks (the aggregate is read into Node, then written with a
// DELETE + multi-row INSERT in one transaction on the small table).
//
// The seen-window (`days`) is kept as a DATE dimension: the read sums the dates >= CURDATE() - days. The base facet lists use the exact time
// (last_seen_at >= NOW() - days), so the one boundary day can differ by that day's losers; documented in docs/box-patches/2026-10-31-loser-buckets.
//
// Switched on by ONE_PER_VIN_BUCKETS=1 (maintenance and reading); the read only uses the table once the backfill has set the buckets_ready marker.
export const BUCKETS_TABLE = "dealer_inventory_vin_loser_buckets";
export const META_TABLE = "dealer_inventory_vin_loser_meta";
export const SHARD_LEN = 8;
export const BUCKETS_DDL = `CREATE TABLE IF NOT EXISTS ${BUCKETS_TABLE} (
  shard CHAR(${SHARD_LEN}) NOT NULL,
  make VARCHAR(64) NOT NULL DEFAULT '',
  state VARCHAR(16) NOT NULL DEFAULT '',
  model VARCHAR(96) NOT NULL DEFAULT '',
  \`trim\` VARCHAR(160) NOT NULL DEFAULT '',
  seen_on DATE NOT NULL,
  n INT NOT NULL,
  PRIMARY KEY (shard, make, state, model, \`trim\`, seen_on),
  INDEX idx_vlb_seen (seen_on)
) ENGINE=InnoDB`;
export const META_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
  k VARCHAR(32) NOT NULL PRIMARY KEY,
  v VARCHAR(255) NOT NULL,
  at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`;
export const bucketsEnabled = (env = process.env) => env.ONE_PER_VIN_BUCKETS === "1";

/** The visibility rule a competing row must meet (alias-free). Same as the buyer list minus the seen-window, which only ever hides a loser before its winner. */
export function visibleSql({ retailOnly = true } = {}) {
  return `removed_at IS NULL AND stale_at IS NULL${retailOnly ? " AND (cond IS NULL OR cond <> 'wholesale')" : ""}`;
}

const keyOf = (vin, dealerId) => `${vin}|${dealerId}`;
const upper = (v) => String(v || "").trim().toUpperCase();

/** Rows of some VINs -> the (vin, dealerId) losers (mode "1": ties go to the lowest price, then dealer id). */
export function losersOf(rows) {
  return planVinLosers(rows.map((r) => ({ vin: r.vin, dealerId: r.dealer_id ?? r.dealerId, lastSeenAt: r.last_seen_at ?? r.lastSeenAt, price: r.price })))
    .map((l) => ({ vin: l.vin, dealerId: l.dealerId }));
}

/** What to write so `existing` becomes `desired`. Pure. Both are [{ vin, dealerId }]; the output is sorted by primary key (the upsert deadlock rule). */
export function diffLosers(existing, desired) {
  const have = new Set(existing.map((r) => keyOf(r.vin, r.dealerId ?? r.dealer_id)));
  const want = new Set(desired.map((r) => keyOf(r.vin, r.dealerId)));
  const byPk = (a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealerId - b.dealerId);
  const add = desired.filter((r) => !have.has(keyOf(r.vin, r.dealerId))).sort(byPk);
  const del = existing.map((r) => ({ vin: r.vin, dealerId: r.dealerId ?? r.dealer_id })).filter((r) => !want.has(keyOf(r.vin, r.dealerId))).sort(byPk);
  return { add, del };
}

// FORCE INDEX (PRIMARY) on the two dealer_inventory reads below: measured read-only on box2 2026-10-27, the optimizer's own pick (idx_inv_removed, ref removed_at IS NULL
// with the VIN condition only as an index condition) takes 0.6-1.0 s for a 500-VIN list or a 5,000-row page; the primary key takes 7-137 ms.
const capped = (sql, seconds) => `SET STATEMENT max_statement_time=${seconds} FOR ${sql}`;

/** Writes a diff. Inserts are multi-row and PK-sorted; deletes are single-row const lookups (a pair IN-list full-scans the PK on this MariaDB). */
export async function applyDiff(pool, { add, del }, { chunk = 1000 } = {}) {
  for (let i = 0; i < add.length; i += chunk) {
    await pool.query(`INSERT IGNORE INTO ${LOSERS_TABLE} (vin, dealer_id) VALUES ?`, [add.slice(i, i + chunk).map((r) => [r.vin, r.dealerId])]);
  }
  for (const r of del) await pool.query(`DELETE FROM ${LOSERS_TABLE} WHERE vin = ? AND dealer_id = ?`, [r.vin, r.dealerId]);
  return { added: add.length, deleted: del.length };
}

let ensured = null;
/** Creates the table once per process (IF NOT EXISTS). The install creates it by hand first (STEPS.md); this only covers a restart after that. */
export function ensureLosersTable(pool) {
  if (!ensured) ensured = pool.query(LOSERS_DDL).catch((e) => { ensured = null; throw e; });
  return ensured;
}
export const _resetEnsured = () => { ensured = null; };

// ---- bucket maintenance -----------------------------------------------------------------------------------------------------------------

export const shardOf = (vin) => upper(vin).slice(0, SHARD_LEN);
const BUCKET_STATEMENT_SECONDS = 10; // the stop for every bucket statement (a recompute group is a bounded prefix-range read)
export const SHARDS_PER_STATEMENT = 25;

/** The aggregate of the visible losers of some shards. Joins to dealer_inventory by primary key so a loser that was swept / went stale / is wholesale is not counted. */
export function shardBucketsSql(shards, { retailOnly = true } = {}) {
  const where = ["i.removed_at IS NULL", "i.stale_at IS NULL"];
  if (retailOnly) where.push("(i.cond IS NULL OR i.cond <> 'wholesale')");
  return {
    sql: `SELECT LEFT(l.vin, ${SHARD_LEN}) AS shard, COALESCE(i.make, '') AS make, COALESCE(i.state, '') AS state, COALESCE(i.model, '') AS model, COALESCE(i.\`trim\`, '') AS \`trim\`, COALESCE(DATE(i.last_seen_at), '1970-01-01') AS seen_on, COUNT(*) AS n FROM ${LOSERS_TABLE} l JOIN dealer_inventory i ON i.vin = l.vin AND i.dealer_id = l.dealer_id WHERE (${shards.map(() => "l.vin LIKE ?").join(" OR ")}) AND ${where.join(" AND ")} GROUP BY 1, 2, 3, 4, 5, 6`,
    args: shards.map((x) => `${x}%`),
  };
}

const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Makes the bucket table exact for the given shards. One group of up to SHARDS_PER_STATEMENT shards per transaction: read the aggregate (no locks), then
 * DELETE the group's rows and INSERT the new ones. A shard with no visible losers ends with no rows. Throws on the first failing statement (the caller decides).
 * Without pool.getConnection (a test stand-in) the same statements run without a transaction.
 * @returns {Promise<{ shards: number, groups: number, rows: number }>}
 */
export async function recomputeShards(pool, shards, { retailOnly = true, perStatement = SHARDS_PER_STATEMENT, statementSeconds = BUCKET_STATEMENT_SECONDS, onGroup } = {}) {
  const list = [...new Set(shards.map(upper).filter(Boolean))].sort();
  const out = { shards: list.length, groups: 0, rows: 0 };
  for (let i = 0; i < list.length; i += perStatement) {
    const group = list.slice(i, i + perStatement);
    const q = shardBucketsSql(group, { retailOnly });
    const [rows] = await pool.query(capped(q.sql, statementSeconds), q.args);
    const conn = pool.getConnection ? await pool.getConnection() : pool;
    try {
      if (pool.getConnection) await conn.beginTransaction();
      await conn.query(capped(`DELETE FROM ${BUCKETS_TABLE} WHERE shard IN (?)`, statementSeconds), [group]);
      if (rows.length) await conn.query(capped(`INSERT INTO ${BUCKETS_TABLE} (shard, make, state, model, \`trim\`, seen_on, n) VALUES ?`, statementSeconds), [rows.map((r) => [r.shard, r.make, r.state, r.model, r.trim, dateStr(r.seen_on), Number(r.n)])]);
      if (pool.getConnection) await conn.commit();
    } catch (e) {
      if (pool.getConnection) await conn.rollback().catch(() => {});
      throw e;
    } finally { if (pool.getConnection) conn.release(); }
    out.groups++; out.rows += rows.length;
    if (onGroup) onGroup(group, rows.length);
  }
  return out;
}

/**
 * Walks the losers table one page of shards at a time (a bounded PK range, LIMIT-ed) and recomputes each page's shards. Resumable (`startAfter` = the
 * last shard done), stoppable (`maxMs`, `shouldStop`), and every statement stops at `statementSeconds` (default 10): the first failure ends the run.
 * `dryRun` reads the aggregate for each group but writes nothing.
 */
export async function backfillBuckets(pool, o = {}) {
  const { pageShards = SHARDS_PER_STATEMENT * 4, retailOnly = true, dryRun = false, maxMs = Infinity, sleepMs = 0, statementSeconds = BUCKET_STATEMENT_SECONDS } = o;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const t0 = now();
  const pad = "Z".repeat(Math.max(0, 17 - SHARD_LEN));
  let cursor = o.startAfter ? `${o.startAfter}${pad}` : "";
  const s = { pages: 0, shards: 0, rows: 0, lastShard: o.startAfter || "", done: false };
  while (true) {
    if (now() - t0 > maxMs || (o.shouldStop && o.shouldStop())) return s;
    const [found] = await pool.query(capped(`SELECT DISTINCT LEFT(vin, ${SHARD_LEN}) AS shard FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT ?`, statementSeconds), [cursor, pageShards]);
    if (!found.length) { s.done = true; return s; }
    const shards = found.map((r) => r.shard);
    if (dryRun) {
      for (let i = 0; i < shards.length; i += SHARDS_PER_STATEMENT) {
        const q = shardBucketsSql(shards.slice(i, i + SHARDS_PER_STATEMENT), { retailOnly });
        const [rows] = await pool.query(capped(q.sql, statementSeconds), q.args);
        s.rows += rows.length;
      }
      s.shards += shards.length;
    } else {
      const r = await recomputeShards(pool, shards, { retailOnly, statementSeconds });
      s.shards += r.shards; s.rows += r.rows;
    }
    s.pages++; s.lastShard = shards[shards.length - 1]; cursor = `${s.lastShard}${pad}`;
    if (o.onPage) o.onPage({ ...s });
    if (found.length < pageShards) { s.done = true; return s; }
    if (sleepMs) await sleep(sleepMs);
  }
}

/** Compares the stored buckets of some shards with a fresh aggregate. Read-only. @returns {Promise<{ checked: number, mismatched: string[] }>} */
export async function verifyShards(pool, shards, { retailOnly = true, statementSeconds = BUCKET_STATEMENT_SECONDS } = {}) {
  const list = [...new Set(shards.map(upper).filter(Boolean))].sort();
  const mismatched = [];
  for (let i = 0; i < list.length; i += SHARDS_PER_STATEMENT) {
    const group = list.slice(i, i + SHARDS_PER_STATEMENT);
    const q = shardBucketsSql(group, { retailOnly });
    const [fresh] = await pool.query(capped(q.sql, statementSeconds), q.args);
    const [stored] = await pool.query(capped(`SELECT shard, make, state, model, \`trim\`, seen_on, n FROM ${BUCKETS_TABLE} WHERE shard IN (?)`, statementSeconds), [group]);
    const k = (r) => [r.shard, r.make, r.state, r.model, r.trim, dateStr(r.seen_on), Number(r.n)].join("\u0001");
    for (const g of group) {
      const fa = fresh.filter((r) => r.shard === g).map(k).sort().join("\n"), fb = stored.filter((r) => r.shard === g).map(k).sort().join("\n");
      if (fa !== fb) mismatched.push(g);
    }
  }
  return { checked: list.length, mismatched };
}

/** The facet read from the bucket table: all stores, optional seen-window. No join, no losers table. */
export function bucketCountsSql({ days = null } = {}) {
  const args = [];
  let where = "";
  if (days) { where = " WHERE seen_on >= DATE_SUB(CURDATE(), INTERVAL ? DAY)"; args.push(days); }
  return { sql: `SELECT NULLIF(make, '') AS make, NULLIF(state, '') AS state, NULLIF(model, '') AS model, NULLIF(\`trim\`, '') AS \`trim\`, SUM(n) AS n FROM ${BUCKETS_TABLE}${where} GROUP BY make, state, model, \`trim\``, args };
}

/** True when the backfill has set the buckets_ready marker (and the table can be read). Any error (table missing) is "not ready". */
export async function bucketsReady(pool, seconds = 5) {
  try { const [rows] = await pool.query(capped(`SELECT v FROM ${META_TABLE} WHERE k = 'buckets_ready'`, seconds)); return rows.length > 0 && String(rows[0].v) === "1"; }
  catch { return false; }
}

/**
 * Re-decides the given VINs: reads their visible rows (a PK-prefix range per VIN) and the losers already stored for them, writes the difference.
 * This is what the sync upsert calls for the chunk it just wrote, and what the reconcile calls for stored VINs.
 * @returns {Promise<{ vins: number, added: number, deleted: number }>}
 */
export async function refreshVinLosers(pool, vins, { retailOnly = true, batch = 500, statementSeconds = 10, buckets = false } = {}) {
  const list = [...new Set(vins.map(upper).filter(Boolean))].sort();
  const out = { vins: list.length, added: 0, deleted: 0 };
  if (buckets) out.bucketErrors = 0;
  for (let i = 0; i < list.length; i += batch) {
    const part = list.slice(i, i + batch);
    const [rows] = await pool.query(capped(`SELECT vin, dealer_id, last_seen_at, price FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin IN (?) AND ${visibleSql({ retailOnly })}`, statementSeconds), [part]);
    const [have] = await pool.query(capped(`SELECT vin, dealer_id FROM ${LOSERS_TABLE} WHERE vin IN (?)`, statementSeconds), [part]);
    const r = await applyDiff(pool, diffLosers(have.map((x) => ({ vin: x.vin, dealerId: x.dealer_id })), losersOf(rows)));
    out.added += r.added; out.deleted += r.deleted;
    if (buckets) {
      // Every VIN of the batch, not only the ones whose loser flag changed: the loser rows\' own bucket (trim, state, last-seen date) moves on every sighting.
      // A bucket failure never undoes or hides the losers write above; the shard is simply recomputed the next time one of its VINs is touched.
      try { await recomputeShards(pool, part.map(shardOf), { retailOnly }); }
      catch (err) { out.bucketErrors++; out.bucketError = err.message; }
    }
  }
  return out;
}

/**
 * Walks dealer_inventory in primary-key order, `pageRows` rows per statement (a bounded range scan each, never a GROUP BY), decides every VIN on the
 * page and makes the losers table match for the VIN range the page covered — adding the missing and deleting the stale, so it is both the one-time
 * backfill and the verification pass. Resumable: pass the returned `lastVin` as `startAfter`.
 * @param {{ pageRows?: number, retailOnly?: boolean, startAfter?: string, dryRun?: boolean, maxMs?: number, shouldStop?: () => boolean, sleepMs?: number, sleep?: Function, now?: Function, onPage?: Function, statementSeconds?: number }} o
 */
export async function backfillLosers(pool, o = {}) {
  const { pageRows = 5000, retailOnly = true, dryRun = false, maxMs = Infinity, sleepMs = 0, statementSeconds = 15 } = o;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const t0 = now();
  let cursor = o.startAfter || "";
  const s = { pages: 0, rowsRead: 0, vinsWithLosers: 0, losers: 0, added: 0, deleted: 0, lastVin: cursor, done: false };
  while (true) {
    if (now() - t0 > maxMs || (o.shouldStop && o.shouldStop())) return s;
    const [rows] = await pool.query(capped(`SELECT vin, dealer_id, last_seen_at, price FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin > ? AND ${visibleSql({ retailOnly })} ORDER BY vin, dealer_id LIMIT ?`, statementSeconds), [cursor, pageRows]);
    const last = rows.length >= pageRows;
    let page = rows, hi = null;
    if (last) {
      // The page can end in the middle of a VIN's rows: drop that VIN and let the next page start before it.
      const tail = rows[rows.length - 1].vin;
      page = rows.filter((r) => r.vin !== tail);
      if (!page.length) throw new Error(`backfill: ${pageRows} rows share one VIN (${tail}); raise pageRows`);
      hi = page[page.length - 1].vin;
    }
    const losers = losersOf(page);
    const [have] = await pool.query(capped(`SELECT vin, dealer_id FROM ${LOSERS_TABLE} WHERE vin > ?${hi ? " AND vin <= ?" : ""}`, statementSeconds), hi ? [cursor, hi] : [cursor]);
    const diff = diffLosers(have.map((x) => ({ vin: x.vin, dealerId: x.dealer_id })), losers);
    const w = dryRun ? { added: diff.add.length, deleted: diff.del.length } : await applyDiff(pool, diff);
    s.pages++; s.rowsRead += page.length; s.losers += losers.length; s.added += w.added; s.deleted += w.deleted;
    s.vinsWithLosers += new Set(losers.map((l) => l.vin)).size;
    if (hi) { cursor = hi; s.lastVin = hi; } else { s.done = true; s.lastVin = page.length ? page[page.length - 1].vin : cursor; }
    if (o.onPage) o.onPage({ ...s });
    if (s.done) return s;
    if (sleepMs) await sleep(sleepMs);
  }
}

/** Re-decides every VIN that currently has a stored loser (keyset over the small table). Catches a winner that was swept/retired, and a loser that came back. */
export async function reconcileLosers(pool, { pageVins = 500, retailOnly = true, maxMs = Infinity, now = Date.now, statementSeconds = 10, buckets = false } = {}) {
  const t0 = now();
  let cursor = "";
  const s = { vins: 0, added: 0, deleted: 0, done: false };
  if (buckets) s.bucketErrors = 0;
  while (true) {
    if (now() - t0 > maxMs) return s;
    const [rows] = await pool.query(capped(`SELECT DISTINCT vin FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT ?`, statementSeconds), [cursor, pageVins]);
    if (!rows.length) { s.done = true; return s; }
    const r = await refreshVinLosers(pool, rows.map((x) => x.vin), { retailOnly, statementSeconds, buckets });
    s.vins += r.vins; s.added += r.added; s.deleted += r.deleted;
    if (buckets) s.bucketErrors += r.bucketErrors || 0;
    cursor = rows[rows.length - 1].vin;
    if (rows.length < pageVins) { s.done = true; return s; }
  }
}

/**
 * The server's handle on all of this. `mode` is ONE_PER_VIN_LOSERS: anything but "maintain" makes every method a no-op, so the patch is inert until
 * the box is switched on. Failures are logged and swallowed — a dedupe table must never fail a sync write.
 */
export function createLoserMaintenance({ getPool, mode = "off", retailOnly = true, log = console.error, delayMs = 15 * 60_000, setTimer = setTimeout, clearTimer = clearTimeout, buckets = bucketsEnabled() } = {}) {
  const on = mode === "maintain";
  let timer = null, running = false;
  const stamp = () => new Date().toISOString();
  return {
    enabled: on,
    async afterUpsert(vins) {
      if (!on || !vins.length) return;
      try { const pool = getPool(); await ensureLosersTable(pool); const r = await refreshVinLosers(pool, vins, { retailOnly, statementSeconds: 5, buckets }); if (r.bucketErrors) log(`${stamp()} one-per-VIN losers: bucket recompute failed (${r.bucketError}); shards stay stale until touched again`); }
      catch (err) { log(`${stamp()} one-per-VIN losers: upsert refresh skipped: ${err.message}`); }
    },
    scheduleReconcile() {
      if (!on) return;
      clearTimer(timer);
      timer = setTimer(async () => {
        if (running) { this.scheduleReconcile(); return; }
        running = true;
        try { const pool = getPool(); await ensureLosersTable(pool); const r = await reconcileLosers(pool, { retailOnly, buckets }); log(`${stamp()} one-per-VIN losers reconciled: ${JSON.stringify(r)}`); }
        catch (err) { log(`${stamp()} one-per-VIN losers: reconcile failed: ${err.message}`); }
        finally { running = false; }
      }, delayMs);
      timer?.unref?.();
    },
  };
}

// ---- facet read side -------------------------------------------------------------------------------------------------------------------------

/**
 * The (make, state, model, trim) buckets of the losers that are still visible. Joins to dealer_inventory by primary key so a swept / stale / wholesale /
 * out-of-window loser is not subtracted. `dealerIds` limits it to those stores (the contact filter).
 */
export function loserBucketsSql({ days = null, dealerIds = null, retailOnly = true } = {}) {
  const where = ["i.removed_at IS NULL", "i.stale_at IS NULL"];
  const args = [];
  if (retailOnly) where.push("(i.cond IS NULL OR i.cond <> 'wholesale')");
  if (days) { where.push("i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"); args.push(days); }
  if (dealerIds) { where.push("l.dealer_id IN (?)"); args.push([...dealerIds]); }
  return {
    sql: `SELECT i.make AS make, i.state AS state, i.model AS model, i.trim AS \`trim\`, COUNT(*) AS n FROM ${LOSERS_TABLE} l JOIN dealer_inventory i ON i.vin = l.vin AND i.dealer_id = l.dealer_id WHERE ${where.join(" AND ")} GROUP BY i.make, i.state, i.model, i.trim`,
    args,
  };
}

const failedAt = new Map();
export const _resetCooldown = () => failedAt.clear();
export const FAIL_COOLDOWN_MS = 60_000;
// A caller that finds the all-stores buckets neither cached nor persisted (first ever run, or a restart before the cache file has the key) waits at most
// this long for the one in-flight read. Past it the caller gets the unadjusted lists NOW (no cooldown: the read is still running and will fill the cache).
export const COLD_WAIT_MS = 15_000;

/**
 * Facet lists with the duplicate-VIN losers subtracted. `hidden` are the buckets the caller already subtracts (wholesale / stale), or null.
 * The all-stores read is the big GROUP BY over the losers table. It ALWAYS runs on the background budget (120 s statement, 150 s connection wait),
 * whether stableCached calls it as a warm-entry refresh (already the background budget) or as a cold miss (which used to get the 20 s buyer budget and
 * hit max_statement_time on every attempt after a restart, so the buckets never landed). A cold caller waits at most COLD_WAIT_MS and is not blocked
 * on the read finishing. A contact-set read is its own small query and keeps the interactive budget.
 * Off (`enabled` false), failed, or in a failure cooldown: the lists come back as they were with `applied: false` — and a failed read is not
 * retried for FAIL_COOLDOWN_MS, so a missing table can never turn every facet cache miss into a slow query.
 * @param {{ pool: any, stableCached: Function, withPoolTimeout: Function, statementSeconds: () => number, waitMs: () => number, retailOnlyFacets: boolean, enabled?: boolean, now?: () => number }} deps
 */
export async function facetsOnePerVin(deps, lists, f, { days = null, dealerIds = null, hidden = null } = {}) {
  const { pool, stableCached, withPoolTimeout, statementSeconds, waitMs, retailOnlyFacets, enabled = false } = deps;
  const { backgroundSeconds = BACKGROUND_STATEMENT_SECONDS, backgroundWaitMs = BACKGROUND_WAIT_MS, coldWaitMs = COLD_WAIT_MS, buckets: useBuckets = bucketsEnabled() } = deps;
  const now = deps.now || Date.now;
  const none = { lists: hidden ? adjustFacetLists(lists, hidden, f) : lists, applied: false };
  if (!enabled) return none;
  const key = `${days || 0}|${dealerIds ? "set" : "all"}`;
  if (failedAt.has(key) && now() - failedAt.get(key) < FAIL_COOLDOWN_MS) return none;
  try {
    const read = async (seconds, waitFor) => {
      const q = loserBucketsSql({ days, dealerIds, retailOnly: retailOnlyFacets });
      const [rows] = await withPoolTimeout(pool.query(capped(q.sql, seconds), q.args), waitFor, "Timed out waiting for an available database connection or a slow query");
      return rows.map((r) => ({ make: r.make, state: r.state, model: r.model, trim: r.trim, n: Number(r.n) }));
    };
    let buckets;
    if (dealerIds) buckets = await read(statementSeconds(), waitMs());
    else {
      // The all-stores buckets are shared by every facet request in the window (stale-while-revalidate): one read, the background budget, bounded wait.
      // With ONE_PER_VIN_BUCKETS=1 and the backfill's buckets_ready marker set, the buckets come from the small per-bucket counts table (no join, no full GROUP BY);
      // otherwise (flag off, backfill not finished, marker missing) from the losers table GROUP BY as before.
      const readAll = async () => {
        if (useBuckets && await bucketsReady(pool)) {
          const q = bucketCountsSql({ days });
          const [rows] = await withPoolTimeout(pool.query(capped(q.sql, backgroundSeconds), q.args), backgroundWaitMs, "Timed out waiting for an available database connection or a slow query");
          return rows.map((r) => ({ make: r.make, state: r.state, model: r.model, trim: r.trim, n: Number(r.n) }));
        }
        return read(backgroundSeconds, backgroundWaitMs);
      };
      const shared = stableCached(`vin-losers-table:${days || 0}`, readAll);
      let timer;
      const pending = Symbol("pending");
      const first = await Promise.race([shared, new Promise((r) => { timer = setTimeout(() => r(pending), coldWaitMs); })]).finally(() => clearTimeout(timer));
      if (first === pending) {
        // Still reading: answer unadjusted now and let the read finish into the cache. A late failure starts the cooldown, a late success clears it.
        shared.then(() => failedAt.delete(key), (err) => {
          failedAt.set(key, now());
          console.error(`${new Date().toISOString()} duplicate-VIN buckets read failed after ${coldWaitMs}ms, facet counts left unadjusted for ${FAIL_COOLDOWN_MS / 1000}s: ${err.message}`);
        });
        return none;
      }
      buckets = first;
    }
    failedAt.delete(key);
    return { lists: adjustFacetLists(lists, [...(hidden || []), ...buckets], f), applied: true };
  } catch (err) {
    failedAt.set(key, now());
    console.error(`${new Date().toISOString()} duplicate-VIN buckets unavailable, facet counts left unadjusted for ${FAIL_COOLDOWN_MS / 1000}s: ${err.message}`);
    return none;
  }
}
