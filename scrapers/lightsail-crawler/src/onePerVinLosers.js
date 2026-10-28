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

/**
 * Re-decides the given VINs: reads their visible rows (a PK-prefix range per VIN) and the losers already stored for them, writes the difference.
 * This is what the sync upsert calls for the chunk it just wrote, and what the reconcile calls for stored VINs.
 * @returns {Promise<{ vins: number, added: number, deleted: number }>}
 */
export async function refreshVinLosers(pool, vins, { retailOnly = true, batch = 500, statementSeconds = 10 } = {}) {
  const list = [...new Set(vins.map(upper).filter(Boolean))].sort();
  const out = { vins: list.length, added: 0, deleted: 0 };
  for (let i = 0; i < list.length; i += batch) {
    const part = list.slice(i, i + batch);
    const [rows] = await pool.query(capped(`SELECT vin, dealer_id, last_seen_at, price FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin IN (?) AND ${visibleSql({ retailOnly })}`, statementSeconds), [part]);
    const [have] = await pool.query(capped(`SELECT vin, dealer_id FROM ${LOSERS_TABLE} WHERE vin IN (?)`, statementSeconds), [part]);
    const r = await applyDiff(pool, diffLosers(have.map((x) => ({ vin: x.vin, dealerId: x.dealer_id })), losersOf(rows)));
    out.added += r.added; out.deleted += r.deleted;
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
export async function reconcileLosers(pool, { pageVins = 500, retailOnly = true, maxMs = Infinity, now = Date.now, statementSeconds = 10 } = {}) {
  const t0 = now();
  let cursor = "";
  const s = { vins: 0, added: 0, deleted: 0, done: false };
  while (true) {
    if (now() - t0 > maxMs) return s;
    const [rows] = await pool.query(capped(`SELECT DISTINCT vin FROM ${LOSERS_TABLE} WHERE vin > ? ORDER BY vin LIMIT ?`, statementSeconds), [cursor, pageVins]);
    if (!rows.length) { s.done = true; return s; }
    const r = await refreshVinLosers(pool, rows.map((x) => x.vin), { retailOnly, statementSeconds });
    s.vins += r.vins; s.added += r.added; s.deleted += r.deleted;
    cursor = rows[rows.length - 1].vin;
    if (rows.length < pageVins) { s.done = true; return s; }
  }
}

/**
 * The server's handle on all of this. `mode` is ONE_PER_VIN_LOSERS: anything but "maintain" makes every method a no-op, so the patch is inert until
 * the box is switched on. Failures are logged and swallowed — a dedupe table must never fail a sync write.
 */
export function createLoserMaintenance({ getPool, mode = "off", retailOnly = true, log = console.error, delayMs = 15 * 60_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const on = mode === "maintain";
  let timer = null, running = false;
  const stamp = () => new Date().toISOString();
  return {
    enabled: on,
    async afterUpsert(vins) {
      if (!on || !vins.length) return;
      try { const pool = getPool(); await ensureLosersTable(pool); await refreshVinLosers(pool, vins, { retailOnly, statementSeconds: 5 }); }
      catch (err) { log(`${stamp()} one-per-VIN losers: upsert refresh skipped: ${err.message}`); }
    },
    scheduleReconcile() {
      if (!on) return;
      clearTimer(timer);
      timer = setTimer(async () => {
        if (running) { this.scheduleReconcile(); return; }
        running = true;
        try { const pool = getPool(); await ensureLosersTable(pool); const r = await reconcileLosers(pool, { retailOnly }); log(`${stamp()} one-per-VIN losers reconciled: ${JSON.stringify(r)}`); }
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
  const { backgroundSeconds = BACKGROUND_STATEMENT_SECONDS, backgroundWaitMs = BACKGROUND_WAIT_MS, coldWaitMs = COLD_WAIT_MS } = deps;
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
      const shared = stableCached(`vin-losers-table:${days || 0}`, () => read(backgroundSeconds, backgroundWaitMs));
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
