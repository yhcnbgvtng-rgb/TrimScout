import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOSERS_DDL, LOSERS_TABLE, diffLosers, losersOf, visibleSql, applyDiff, refreshVinLosers, backfillLosers, reconcileLosers,
  createLoserMaintenance, loserBucketsSql, facetsOnePerVin, _resetCooldown, FAIL_COOLDOWN_MS, COLD_WAIT_MS,
} from '../src/onePerVinLosers.js';
import { createStableCache } from '../src/stableCache.js';
import { BACKGROUND_STATEMENT_SECONDS, BACKGROUND_WAIT_MS } from '../src/refreshTimeouts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../..');

// ---- an in-memory stand-in for the three tables, understanding exactly the statements the module issues ----
const inv = (vin, dealer_id, last_seen_at, price, extra = {}) => ({ vin, dealer_id, last_seen_at, price, removed_at: null, stale_at: null, cond: 'new', make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT', ...extra });
const visible = (r) => r.removed_at == null && r.stale_at == null && r.cond !== 'wholesale';
function fakeDb(rows, stored = []) {
  const db = { rows, losers: new Set(stored.map(([v, d]) => `${v}|${d}`)), log: [] };
  const losersList = () => [...db.losers].map((k) => { const [vin, d] = k.split('|'); return { vin, dealer_id: Number(d) }; }).sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id));
  db.query = async (sql, args = []) => {
    const s = sql.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '');
    db.log.push(s);
    if (/^CREATE TABLE/.test(s)) return [[]];
    if (/FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE vin IN \(\?\)/.test(s)) return [db.rows.filter((r) => visible(r) && args[0].includes(r.vin))];
    if (/FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE vin > \? .*LIMIT \?/.test(s)) return [db.rows.filter((r) => visible(r) && r.vin > args[0]).sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id)).slice(0, args[1])];
    if (/SELECT DISTINCT vin FROM/.test(s)) return [[...new Set(losersList().filter((l) => l.vin > args[0]).map((l) => l.vin))].slice(0, args[1]).map((vin) => ({ vin }))];
    if (new RegExp(`FROM ${LOSERS_TABLE} WHERE vin IN`).test(s)) return [losersList().filter((l) => args[0].includes(l.vin))];
    if (new RegExp(`FROM ${LOSERS_TABLE} WHERE vin > \\? AND vin <= \\?`).test(s)) return [losersList().filter((l) => l.vin > args[0] && l.vin <= args[1])];
    if (new RegExp(`FROM ${LOSERS_TABLE} WHERE vin > \\?$`).test(s)) return [losersList().filter((l) => l.vin > args[0])];
    if (/^INSERT IGNORE INTO/.test(s)) { for (const [v, d] of args[0]) db.losers.add(`${v}|${d}`); return [{ affectedRows: args[0].length }]; }
    if (/^DELETE FROM/.test(s)) { db.losers.delete(`${args[0]}|${args[1]}`); return [{ affectedRows: 1 }]; }
    if (/GROUP BY i\.make/.test(s)) {
      let i = 0; const days = /INTERVAL \? DAY/.test(s) ? args[i++] : null; const set = /l\.dealer_id IN \(\?\)/.test(s) ? new Set(args[i++]) : null;
      const out = new Map();
      for (const l of losersList()) {
        const r = db.rows.find((x) => x.vin === l.vin && x.dealer_id === l.dealer_id);
        if (!r || !visible(r) || (set && !set.has(l.dealer_id)) || (days && r.age_days > days)) continue;
        const k = [r.make, r.state, r.model, r.trim].join('|'); const b = out.get(k) || { make: r.make, state: r.state, model: r.model, trim: r.trim, n: 0 }; b.n++; out.set(k, b);
      }
      return [[...out.values()]];
    }
    throw new Error('fake db: unhandled SQL ' + s);
  };
  return db;
}
const V1 = '1FTFW1E50NFA00001', V2 = '1FTFW1E50NFA00002', V3 = '1FTFW1E50NFA00003';
const OLD = '2026-10-26 22:00:00', NEW = '2026-10-27 02:00:00';
const keys = (db) => [...db.losers].sort();

describe('diffLosers / losersOf', () => {
  it('adds the missing, deletes the stale, both in primary-key order', () => {
    const d = diffLosers([{ vin: 'B', dealerId: 1 }, { vin: 'A', dealerId: 9 }], [{ vin: 'C', dealerId: 2 }, { vin: 'B', dealerId: 1 }, { vin: 'A', dealerId: 3 }]);
    assert.deepEqual(d.add, [{ vin: 'A', dealerId: 3 }, { vin: 'C', dealerId: 2 }]);
    assert.deepEqual(d.del, [{ vin: 'A', dealerId: 9 }]);
  });
  it('same VIN at two stores: the older sighting loses; a tie goes to the lower price; a single store has no loser', () => {
    assert.deepEqual(losersOf([inv(V1, 1, NEW, 5), inv(V1, 2, OLD, 1)]), [{ vin: V1, dealerId: 2 }]);
    assert.deepEqual(losersOf([inv(V1, 1, NEW, 5), inv(V1, 2, NEW, 4)]), [{ vin: V1, dealerId: 1 }]);
    assert.deepEqual(losersOf([inv(V1, 1, NEW, 5)]), []);
  });
});

describe('refreshVinLosers (the sync upsert hook)', () => {
  it('stores the loser of a duplicate pair and nothing for a single-store VIN', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5), inv(V2, 3, NEW, 5)]);
    const r = await refreshVinLosers(db, [V1, V2]);
    assert.deepEqual(keys(db), [`${V1}|1`]);
    assert.deepEqual([r.vins, r.added, r.deleted], [2, 1, 0]);
  });
  it('a re-sighting at the other store flips the loser; the winner being retired clears the entry', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)], [[V1, 1]]);
    db.rows[0].last_seen_at = '2026-10-27 03:00:00';
    await refreshVinLosers(db, [V1]);
    assert.deepEqual(keys(db), [`${V1}|2`]);
    db.rows[0].removed_at = '2026-10-27 04:00:00';
    await refreshVinLosers(db, [V1]);
    assert.deepEqual(keys(db), []);
  });
  it('a wholesale competitor does not make a retail row lose (the buyer list ignores wholesale rows)', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5, { cond: 'wholesale' })]);
    await refreshVinLosers(db, [V1]);
    assert.deepEqual(keys(db), []);
  });
  it('reads by VIN-in-list only: no GROUP BY, no full scan shape, writes are sorted single-row deletes / one multi-row insert', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)], [[V2, 7]]);
    await refreshVinLosers(db, [V1, V2]);
    assert.ok(db.log.every((s) => !/GROUP BY|HAVING/i.test(s)));
    assert.ok(db.log.some((s) => /^DELETE FROM .* WHERE vin = \? AND dealer_id = \?$/.test(s)));
    assert.equal(db.log.filter((s) => /^INSERT IGNORE/.test(s)).length, 1);
  });
  it('batches 500 VINs per statement', async () => {
    const db = fakeDb([]);
    await refreshVinLosers(db, Array.from({ length: 1100 }, (_, i) => `1FTFW1E50NFB${String(i).padStart(5, '0')}`));
    assert.equal(db.log.filter((s) => /FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE vin IN/.test(s)).length, 3);
  });
});

describe('backfillLosers', () => {
  const stock = () => {
    const rows = [];
    for (let i = 0; i < 40; i++) { const vin = `1FTFW1E50NFC${String(i).padStart(5, '0')}`; rows.push(inv(vin, 1, OLD, 5)); if (i % 3 === 0) rows.push(inv(vin, 2, NEW, 5)); if (i % 9 === 0) rows.push(inv(vin, 3, NEW, 4)); }
    return rows;
  };
  const expected = (rows) => keys(fakeDb(rows)).length === 0 ? losersOf(rows.filter(visible)).map((l) => `${l.vin}|${l.dealerId}`).sort() : [];

  it('walks the table in pages, never splitting a VIN across pages, and ends with exactly the losers the rule gives', async () => {
    const db = fakeDb(stock());
    const s = await backfillLosers(db, { pageRows: 7 });
    assert.equal(s.done, true);
    assert.ok(s.pages > 5);
    assert.deepEqual(keys(db), expected(db.rows));
    assert.equal(s.added, keys(db).length);
  });
  it('is idempotent: a second run adds and deletes nothing', async () => {
    const db = fakeDb(stock());
    await backfillLosers(db, { pageRows: 7 });
    const s = await backfillLosers(db, { pageRows: 11 });
    assert.deepEqual([s.added, s.deleted], [0, 0]);
  });
  it('removes stale entries inside the walked range and past the last VIN, and keeps its own statements to PK ranges', async () => {
    const db = fakeDb(stock(), [['1FTFW1E50NFC00001', 5], ['1FTFW1E50NFZ99999', 5], ['1FTFW1E50NFC00020', 9]]);
    const s = await backfillLosers(db, { pageRows: 7 });
    assert.ok(!db.losers.has('1FTFW1E50NFC00001|5') && !db.losers.has('1FTFW1E50NFZ99999|5') && !db.losers.has('1FTFW1E50NFC00020|9'));
    assert.equal(s.deleted, 3);
    assert.ok(db.log.every((q) => !/GROUP BY|HAVING|COUNT\(/i.test(q)));
    assert.ok(db.log.filter((q) => /FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE/.test(q)).every((q) => /WHERE vin > \? AND .*ORDER BY vin, dealer_id LIMIT \?$/.test(q)));
  });
  it('a dry run counts but writes nothing', async () => {
    const db = fakeDb(stock());
    const s = await backfillLosers(db, { pageRows: 7, dryRun: true });
    assert.equal(db.losers.size, 0);
    assert.ok(s.added > 0);
    assert.ok(db.log.every((q) => !/^(INSERT|DELETE)/.test(q)));
  });
  it('stops on shouldStop and resumes from lastVin to the same result as one run', async () => {
    const whole = fakeDb(stock()); await backfillLosers(whole, { pageRows: 7 });
    const db = fakeDb(stock());
    let calls = 0;
    const first = await backfillLosers(db, { pageRows: 7, shouldStop: () => ++calls > 3 });
    assert.equal(first.done, false);
    assert.ok(first.lastVin > '');
    const rest = await backfillLosers(db, { pageRows: 7, startAfter: first.lastVin });
    assert.equal(rest.done, true);
    assert.deepEqual(keys(db), keys(whole));
  });
  it('refuses a page that is one VIN (would loop forever)', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 1), inv(V1, 2, OLD, 2), inv(V1, 3, OLD, 3)]);
    await assert.rejects(backfillLosers(db, { pageRows: 3 }), /share one VIN/);
  });
  it('paces itself between pages', async () => {
    const db = fakeDb(stock()); const sleeps = [];
    await backfillLosers(db, { pageRows: 7, sleepMs: 150, sleep: async (ms) => sleeps.push(ms) });
    assert.ok(sleeps.length > 3 && sleeps.every((ms) => ms === 150));
  });
});

describe('reconcileLosers (after a sweep)', () => {
  it('drops entries whose winner or loser was retired and keeps the rest', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5), inv(V2, 3, OLD, 5), inv(V2, 4, NEW, 5)], [[V1, 1], [V2, 3]]);
    db.rows[3].removed_at = '2026-10-27 05:00:00'; // V2's winner swept: its loser is now the only live row
    const s = await reconcileLosers(db, { pageVins: 1 });
    assert.equal(s.done, true);
    assert.deepEqual(keys(db), [`${V1}|1`]);
    assert.deepEqual([s.added, s.deleted], [0, 1]);
  });
});

describe('createLoserMaintenance', () => {
  it('is inert unless ONE_PER_VIN_LOSERS=maintain: no query, no timer', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)]); let timers = 0;
    const m = createLoserMaintenance({ getPool: () => db, mode: undefined, setTimer: () => { timers++; } });
    await m.afterUpsert([V1]); m.scheduleReconcile();
    assert.deepEqual([db.log.length, timers, m.enabled], [0, 0, false]);
  });
  it('maintain: the upsert hook writes the loser; a failure is logged and never thrown into the sync', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)]);
    await createLoserMaintenance({ getPool: () => db, mode: 'maintain' }).afterUpsert([V1]);
    assert.deepEqual(keys(db), [`${V1}|1`]);
    const logs = [];
    await createLoserMaintenance({ getPool: () => ({ query: async () => { throw new Error('lock wait'); } }), mode: 'maintain', log: (m) => logs.push(m) }).afterUpsert([V1]);
    assert.match(logs[0], /upsert refresh skipped: .*(lock wait|CREATE)|upsert refresh skipped/);
  });
  it('reconcile is debounced: each schedule replaces the pending timer, then one pass runs', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)], [[V1, 1], [V3, 9]]);
    let pending = null, cleared = 0; const logs = [];
    const m = createLoserMaintenance({ getPool: () => db, mode: 'maintain', log: (x) => logs.push(x), delayMs: 123, setTimer: (fn, ms) => { assert.equal(ms, 123); pending = fn; return { unref() {} }; }, clearTimer: () => { cleared++; } });
    m.scheduleReconcile(); m.scheduleReconcile(); m.scheduleReconcile();
    assert.equal(cleared, 3);
    await pending();
    assert.deepEqual(keys(db), [`${V1}|1`]);
    assert.match(logs.at(-1), /reconciled: .*"deleted":1/);
  });
});

describe('facet read side', () => {
  const LISTS = () => ({ states: [{ state: 'NJ', n: 10 }], makes: [{ make: 'Ford', n: 10 }], models: [], trims: [] });
  const mk = (db, extra = {}) => { const cache = new Map(); return { pool: db, stableCached: async (k, fn) => { if (!cache.has(k)) cache.set(k, await fn()); return cache.get(k); }, withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 1000, retailOnlyFacets: true, enabled: true, ...extra }; };
  beforeEach(() => _resetCooldown());

  it('off by default: no query, counts unchanged, applied false', async () => {
    const db = fakeDb([]);
    const r = await facetsOnePerVin(mk(db, { enabled: false }), LISTS(), {});
    assert.deepEqual([r.applied, db.log.length, r.lists.makes[0].n], [false, 0, 10]);
  });
  it('subtracts one count per visible loser; a swept, stale or wholesale loser is not subtracted (the join revalidates)', async () => {
    const rows = [inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5), inv(V2, 3, OLD, 5), inv(V2, 4, NEW, 5), inv(V3, 5, OLD, 5), inv(V3, 6, NEW, 5)];
    const db = fakeDb(rows, [[V1, 1], [V2, 3], [V3, 5]]);
    rows[2].removed_at = 'x';        // V2's loser swept since the last reconcile
    rows[4].cond = 'wholesale';      // V3's loser is wholesale (the wholesale bucket already took it)
    const r = await facetsOnePerVin(mk(db), LISTS(), {});
    assert.equal(r.applied, true);
    assert.equal(r.lists.makes[0].n, 9);
    assert.equal(r.lists.states[0].n, 9);
  });
  it('the seen-window leaves out a loser the stale buckets already took', async () => {
    const rows = [inv(V1, 1, OLD, 5, { age_days: 9 }), inv(V1, 2, NEW, 5)];
    const r = await facetsOnePerVin(mk(fakeDb(rows, [[V1, 1]])), LISTS(), {}, { days: 7 });
    assert.equal(r.lists.makes[0].n, 10);
  });
  it('a contact set only subtracts that set\'s losers', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5), inv(V2, 3, OLD, 5), inv(V2, 4, NEW, 5)], [[V1, 1], [V2, 3]]);
    assert.equal((await facetsOnePerVin(mk(db), LISTS(), {}, { dealerIds: new Set([3]) })).lists.makes[0].n, 9);
  });
  it('the all-stores buckets are read once per window (stale-while-revalidate cache)', async () => {
    const db = fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)], [[V1, 1]]); const deps = mk(db);
    await facetsOnePerVin(deps, LISTS(), {}, { days: 7 }); await facetsOnePerVin(deps, LISTS(), {}, { days: 7 });
    assert.equal(db.log.filter((s) => /GROUP BY i\.make/.test(s)).length, 1);
  });
  it('hidden (wholesale / stale) buckets are still subtracted when the table is off or failing', async () => {
    const hidden = [{ make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT', n: 3 }];
    const off = await facetsOnePerVin(mk(fakeDb([]), { enabled: false }), LISTS(), {}, { hidden });
    assert.equal(off.lists.makes[0].n, 7);
    const bad = await facetsOnePerVin(mk({ query: async () => { throw new Error('no such table'); } }), LISTS(), {}, { hidden });
    assert.deepEqual([bad.applied, bad.lists.makes[0].n], [false, 7]);
  });
  it('a failure is not retried for a minute: a missing table can never make every facet miss run a slow query', async () => {
    let t = 1_000_000, calls = 0;
    const deps = mk({ query: async () => { calls++; throw new Error('max_statement_time exceeded'); } }, { now: () => t });
    await facetsOnePerVin(deps, LISTS(), {}); await facetsOnePerVin(deps, LISTS(), {}); await facetsOnePerVin(deps, LISTS(), {}, { days: 7 });
    assert.equal(calls, 2, 'one per window key, then the cooldown');
    t += FAIL_COOLDOWN_MS + 1;
    await facetsOnePerVin(deps, LISTS(), {});
    assert.equal(calls, 3);
  });
});

describe('the all-stores buckets read gets the background budget', () => {
  const LISTS = () => ({ states: [{ state: 'NJ', n: 10 }], makes: [{ make: 'Ford', n: 10 }], models: [], trims: [] });
  const stmtSeconds = (sql) => Number(/^SET STATEMENT max_statement_time=(\d+) FOR /.exec(sql)?.[1]);
  const rowsDb = () => fakeDb([inv(V1, 1, OLD, 5), inv(V1, 2, NEW, 5)], [[V1, 1]]);
  // A database that records the budget each statement was sent with, on top of the in-memory tables.
  const recording = (db) => { const seconds = []; return { seconds, query: (sql, args) => { if (/GROUP BY i\.make/.test(sql)) seconds.push([stmtSeconds(sql)]); return db.query(sql, args); } }; };
  beforeEach(() => _resetCooldown());

  it('a COLD miss uses 120 s / 150 s, not the 20 s buyer budget (the cause: it hit max_statement_time on every attempt after a restart)', async () => {
    const db = rowsDb(); const rec = recording(db); const waits = [];
    const cache = createStableCache({ ttlMs: 60_000, log: { log() {}, error() {} } }); // no runBackground wired: a cold key never gets the background budget from the cache
    const deps = { pool: rec, stableCached: cache.get, withPoolTimeout: (p, ms) => { waits.push(ms); return p; }, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true };
    const r = await facetsOnePerVin(deps, LISTS(), {});
    assert.equal(r.applied, true);
    assert.deepEqual(rec.seconds, [[BACKGROUND_STATEMENT_SECONDS]]);
    assert.deepEqual(waits, [BACKGROUND_WAIT_MS]);
    assert.ok(BACKGROUND_WAIT_MS > BACKGROUND_STATEMENT_SECONDS * 1000, 'the JS wait must outlast the statement');
  });

  it('a contact-set read keeps the interactive budget', async () => {
    const rec = recording(rowsDb());
    const deps = { pool: rec, stableCached: async (k, fn) => fn(), withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true };
    await facetsOnePerVin(deps, LISTS(), {}, { dealerIds: new Set([1]) });
    assert.deepEqual(rec.seconds, [[20]]);
  });

  it('a slow cold read: the caller gets unadjusted lists after the bounded wait, no cooldown, and the NEXT call is adjusted from the cache', async () => {
    const db = rowsDb(); let release;
    const gate = new Promise((r) => { release = r; });
    const pool = { query: async (sql, args) => { if (/GROUP BY i\.make/.test(sql)) await gate; return db.query(sql, args); } };
    const cache = createStableCache({ ttlMs: 60_000, log: { log() {}, error() {} } });
    const deps = { pool, stableCached: cache.get, withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true, coldWaitMs: 20 };
    const a = await facetsOnePerVin(deps, LISTS(), {});
    assert.deepEqual([a.applied, a.lists.makes[0].n], [false, 10]);
    const b = await facetsOnePerVin(deps, LISTS(), {}); // joins the same single flight; still waiting, still no cooldown
    assert.equal(b.applied, false);
    release();
    await new Promise((r) => setTimeout(r, 10));
    const c = await facetsOnePerVin(deps, LISTS(), {});
    assert.deepEqual([c.applied, c.lists.makes[0].n], [true, 9]);
  });

  it('a slow cold read that then FAILS starts the failure cooldown (no retry storm)', async () => {
    let t = 1_000_000, reads = 0;
    const pool = { query: async () => { reads++; await new Promise((r) => setTimeout(r, 30)); throw new Error('max_statement_time exceeded'); } };
    const cache = createStableCache({ ttlMs: 60_000, log: { log() {}, error() {} } });
    const deps = { pool, stableCached: cache.get, withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true, coldWaitMs: 5, now: () => t };
    const origErr = console.error; console.error = () => {};
    try {
      const a = await facetsOnePerVin(deps, LISTS(), {});
      assert.equal(a.applied, false);
      await new Promise((r) => setTimeout(r, 60));
      await facetsOnePerVin(deps, LISTS(), {});
      assert.equal(reads, 1, 'inside the cooldown the read is not started again');
      t += FAIL_COOLDOWN_MS + 1;
      await facetsOnePerVin(deps, LISTS(), {});
      assert.equal(reads, 2);
    } finally { console.error = origErr; }
  });

  it('after a restart the persisted cache entry serves the buckets at once; the refresh runs behind it on the background budget', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opvl-cache-')), 'cache.json');
    const key = 'vin-losers-table:0';
    fs.writeFileSync(file, JSON.stringify({ [key]: { at: 1, value: [{ make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT', n: 4 }] } }));
    let release; const gate = new Promise((r) => { release = r; });
    const pool = { query: async () => { await gate; return [[]]; } }; // the refresh is slower than the request
    const cache = createStableCache({ ttlMs: 60_000, filePath: file, now: () => 10 * 60_000, log: { log() {}, error() {} }, runBackground: (fn) => fn() });
    const deps = { pool, stableCached: cache.get, withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true };
    const r = await facetsOnePerVin(deps, LISTS(), {});
    assert.deepEqual([r.applied, r.lists.makes[0].n], [true, 6], 'the persisted buckets (4) are subtracted without waiting for the refresh');
    release();
  });

  it('COLD_WAIT_MS stays well under the buyer connection wait', () => { assert.ok(COLD_WAIT_MS < 45_000); });
});

describe('SQL shapes', () => {
  it('every statement balances its placeholders', () => {
    for (const o of [{}, { days: 7 }, { dealerIds: new Set([1, 2]) }, { days: 7, dealerIds: new Set([1]), retailOnly: false }]) {
      const q = loserBucketsSql(o);
      assert.equal(q.sql.split('?').length - 1, q.args.length);
    }
  });
  it('the bucket query joins the two tables on the whole primary key', () => {
    assert.match(loserBucketsSql().sql, /JOIN dealer_inventory i ON i\.vin = l\.vin AND i\.dealer_id = l\.dealer_id/);
  });
  it('the module never looks for duplicate VINs with a GROUP BY vin / HAVING COUNT', () => {
    const src = fs.readFileSync(path.join(HERE, '../src/onePerVinLosers.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/GROUP BY vin|HAVING/i.test(src));
  });
  it('both dealer_inventory reads are pinned to the primary key (the default plan scans idx_inv_removed: 0.8 s instead of 7 ms per chunk)', () => {
    const src = fs.readFileSync(path.join(HERE, '../src/onePerVinLosers.js'), 'utf8');
    const reads = src.match(/FROM dealer_inventory [A-Z ]*\(?[A-Z]*\)? ?WHERE vin (IN|>)/g) || [];
    assert.equal(reads.length, 2);
    assert.ok(reads.every((r) => r.includes('FORCE INDEX (PRIMARY)')));
  });
  it('the table has the same key types as dealer_inventory and an index on dealer_id', () => {
    assert.match(LOSERS_DDL, /vin CHAR\(17\) NOT NULL/);
    assert.match(LOSERS_DDL, /PRIMARY KEY \(vin, dealer_id\)/);
    assert.match(LOSERS_DDL, /INDEX idx_vl_dealer \(dealer_id\)/);
    assert.match(visibleSql({ retailOnly: false }), /^removed_at IS NULL AND stale_at IS NULL$/);
  });
  it('applyDiff chunks big inserts', async () => {
    const db = fakeDb([]);
    await applyDiff(db, { add: Array.from({ length: 2500 }, (_, i) => ({ vin: `V${String(i).padStart(6, '0')}`, dealerId: 1 })), del: [] });
    assert.equal(db.log.filter((s) => /^INSERT IGNORE/.test(s)).length, 3);
  });
});

describe('the box patch and the box2 snapshot', () => {
  const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-27-box2');
  const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  it('the snapshot files match their recorded md5s (they are verbatim read-only copies of box2 /opt/trimscout-deals/src)', () => {
    const lines = fs.readFileSync(path.join(SNAP, 'MD5S.txt'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    for (const l of lines) { const [sum, name] = l.split(/\s+/); assert.equal(md5(path.join(SNAP, name)), sum, name); }
  });
  it('applies with zero fuzz to the box2 snapshot, still parses, and the new behaviour is behind OFF-by-default flags', { skip: spawnSync('patch', ['--version']).status !== 0 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opvl-'));
    const file = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(path.join(SNAP, 'deals_api_server.js'), file);
    const r = spawnSync('patch', ['-F0', '--no-backup-if-mismatch', file, path.join(ROOT, 'docs/box-patches/2026-10-29-one-per-vin-losers/deals_api_server.js.patch')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
    const out = fs.readFileSync(file, 'utf8');
    assert.match(out, /const ONE_PER_VIN_FACETS = process\.env\.ONE_PER_VIN_FACETS === "1";/);
    assert.match(out, /mode: process\.env\.ONE_PER_VIN_LOSERS/);
    assert.match(out, /await loserMaint\.afterUpsert\(chunk\.map/);
    assert.match(out, /loserMaint\.scheduleReconcile\(\);/);
    assert.equal((out.match(/facetsOnePerVin\(onePerVinDeps\(\)/g) || []).length, 2, 'both facet handlers');
    assert.ok(out.indexOf('loserMaint.afterUpsert') > out.indexOf('timings.upsertMs += performance.now() - tUpsert;'));
  });
  it('STEPS.md: md5 table matches the files, and it carries backup, rollback, restart gate, EXPLAINs and says nothing is installed', () => {
    const steps = fs.readFileSync(path.join(ROOT, 'docs/box-patches/2026-10-29-one-per-vin-losers/STEPS.md'), 'utf8');
    // onePerVinLosers.js is no longer pinned here: 2026-10-30-losers-refresh-budget supersedes the module (pinned in its own STEPS.md, checked below)
    const want = { '2026-10-29-one-per-vin-losers-backfill.mjs': 'scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs' };
    for (const [name, rel] of Object.entries(want)) assert.ok(steps.includes(`${md5(path.join(ROOT, rel))}  FINAL  ${name}`), `${name} md5 in STEPS.md is stale`);
    assert.ok(steps.includes(`${md5(path.join(SNAP, 'deals_api_server.js'))}  BASE`));
    for (const must of ['NOTHING IS INSTALLED', 'Gate', 'Rollback', 'DROP TABLE dealer_inventory_vin_losers', 'FORCE INDEX (PRIMARY)', 'pm2 restart deals-api', 'Never restart while the lock is held', 'bak.opvl', '--phase=explain', 'ONE_PER_VIN_FACETS=1']) assert.ok(steps.includes(must), must);
  });
  it('the refresh-budget STEPS.md pins the md5 of the module and names the BASE it replaces', () => {
    const steps = fs.readFileSync(path.join(ROOT, 'docs/box-patches/2026-10-30-losers-refresh-budget/STEPS.md'), 'utf8');
    assert.ok(steps.includes(`${md5(path.join(ROOT, 'scrapers/lightsail-crawler/src/onePerVinLosers.js'))}  FINAL  onePerVinLosers.js`), 'onePerVinLosers.js md5 in the refresh-budget STEPS.md is stale');
    assert.ok(steps.includes('65db034542a7b50e36714ab88db42123  BASE  onePerVinLosers.js'));
  });
});
