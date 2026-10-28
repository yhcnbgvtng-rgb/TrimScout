import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  LOSERS_TABLE, BUCKETS_TABLE, META_TABLE, SHARD_LEN, SHARDS_PER_STATEMENT, BUCKETS_DDL, META_DDL, shardOf, shardBucketsSql, recomputeShards, backfillBuckets,
  verifyShards, bucketCountsSql, bucketsReady, refreshVinLosers, reconcileLosers, createLoserMaintenance, facetsOnePerVin, _resetCooldown,
} from '../src/onePerVinLosers.js';
import { createStableCache } from '../src/stableCache.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../..');

// ---- an in-memory stand-in for dealer_inventory, the losers table, the buckets table and the meta table ----
const inv = (vin, dealer_id, last_seen_at, price, extra = {}) => ({ vin, dealer_id, last_seen_at, price, removed_at: null, stale_at: null, cond: 'new', make: 'Ford', state: 'NJ', model: 'F-150', trim: 'XLT', ...extra });
const visible = (r) => r.removed_at == null && r.stale_at == null && r.cond !== 'wholesale';
const byPk = (a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id);

function fakeDb(rows, stored = [], { ready = false } = {}) {
  const db = { rows, losers: new Set(stored.map(([v, d]) => `${v}|${d}`)), buckets: new Map(), meta: new Map(ready ? [['buckets_ready', '1']] : []), log: [], tx: [], failOn: null };
  const losersList = () => [...db.losers].map((k) => { const [vin, d] = k.split('|'); return { vin, dealer_id: Number(d) }; }).sort(byPk);
  const bkey = (r) => [r.shard, r.make, r.state, r.model, r.trim, r.seen_on].join('|');
  const aggregate = (prefixes) => {
    const out = new Map();
    for (const l of losersList()) {
      if (!prefixes.some((p) => l.vin.startsWith(p))) continue;
      const r = db.rows.find((x) => x.vin === l.vin && x.dealer_id === l.dealer_id);
      if (!r || !visible(r)) continue;
      const row = { shard: l.vin.slice(0, SHARD_LEN), make: r.make ?? '', state: r.state ?? '', model: r.model ?? '', trim: r.trim ?? '', seen_on: r.last_seen_at ? String(r.last_seen_at).slice(0, 10) : '1970-01-01', n: 0 };
      const k = bkey(row); const b = out.get(k) || row; b.n++; out.set(k, b);
    }
    return [...out.values()];
  };
  const run = async (sql, args = []) => {
    const s = sql.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '');
    db.log.push(s);
    if (db.failOn && db.failOn.test(s)) throw new Error('Query execution was interrupted (max_statement_time exceeded)');
    if (/FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE vin IN \(\?\)/.test(s)) return [db.rows.filter((r) => visible(r) && args[0].includes(r.vin)).map((r) => ({ ...r }))];
    if (/SELECT DISTINCT vin FROM/.test(s)) return [[...new Set(losersList().filter((l) => l.vin > args[0]).map((l) => l.vin))].slice(0, args[1]).map((vin) => ({ vin }))];
    if (new RegExp(`SELECT DISTINCT LEFT\\(vin, ${SHARD_LEN}\\) AS shard FROM ${LOSERS_TABLE} WHERE vin > \\? ORDER BY vin LIMIT \\?`).test(s)) {
      const shards = [...new Set(losersList().filter((l) => l.vin > args[0]).map((l) => l.vin.slice(0, SHARD_LEN)))];
      return [shards.slice(0, args[1]).map((shard) => ({ shard }))];
    }
    if (new RegExp(`FROM ${LOSERS_TABLE} WHERE vin IN`).test(s)) return [losersList().filter((l) => args[0].includes(l.vin))];
    if (/^INSERT IGNORE INTO/.test(s)) { for (const [v, d] of args[0]) db.losers.add(`${v}|${d}`); return [{ affectedRows: args[0].length }]; }
    if (new RegExp(`^DELETE FROM ${LOSERS_TABLE} WHERE vin = \\? AND dealer_id = \\?$`).test(s)) { db.losers.delete(`${args[0]}|${args[1]}`); return [{ affectedRows: 1 }]; }
    if (s.startsWith(`SELECT LEFT(l.vin, ${SHARD_LEN}) AS shard`)) return [aggregate(args.map((a) => a.replace(/%$/, '')))];
    if (new RegExp(`^DELETE FROM ${BUCKETS_TABLE} WHERE shard IN \\(\\?\\)$`).test(s)) {
      const set = new Set(args[0]); for (const [k, v] of [...db.buckets]) if (set.has(v.shard)) db.buckets.delete(k); return [{ affectedRows: 1 }];
    }
    if (new RegExp(`^INSERT INTO ${BUCKETS_TABLE} `).test(s)) {
      for (const [shard, make, state, model, trim, seen_on, n] of args[0]) { const row = { shard, make, state, model, trim, seen_on, n }; if (db.buckets.has(bkey(row))) throw new Error('Duplicate entry'); db.buckets.set(bkey(row), row); }
      return [{ affectedRows: args[0].length }];
    }
    if (new RegExp(`^SELECT shard, make, state, model, \`trim\`, seen_on, n FROM ${BUCKETS_TABLE} WHERE shard IN`).test(s)) { const set = new Set(args[0]); return [[...db.buckets.values()].filter((v) => set.has(v.shard))]; }
    if (new RegExp(`^SELECT NULLIF\\(make, ''\\).* FROM ${BUCKETS_TABLE}`).test(s)) {
      const out = new Map();
      for (const v of db.buckets.values()) {
        if (/WHERE seen_on >= DATE_SUB\(CURDATE\(\), INTERVAL \? DAY\)/.test(s) && !(v.seen_on >= db.windowStart(args[0]))) continue;
        const k = [v.make, v.state, v.model, v.trim].join('|'); const b = out.get(k) || { make: v.make || null, state: v.state || null, model: v.model || null, trim: v.trim || null, n: 0 }; b.n += v.n; out.set(k, b);
      }
      return [[...out.values()]];
    }
    if (new RegExp(`^SELECT v FROM ${META_TABLE} WHERE k = 'buckets_ready'`).test(s)) { if (!db.metaExists) throw new Error("Table doesn't exist"); return [db.meta.has('buckets_ready') ? [{ v: db.meta.get('buckets_ready') }] : []]; }
    if (/GROUP BY i\.make/.test(s)) { // the legacy full GROUP BY, for the parity checks
      const out = new Map();
      for (const l of losersList()) {
        const r = db.rows.find((x) => x.vin === l.vin && x.dealer_id === l.dealer_id);
        if (!r || !visible(r)) continue;
        const k = [r.make, r.state, r.model, r.trim].join('|'); const b = out.get(k) || { make: r.make, state: r.state, model: r.model, trim: r.trim, n: 0 }; b.n++; out.set(k, b);
      }
      return [[...out.values()]];
    }
    throw new Error('fake db: unhandled SQL ' + s);
  };
  db.metaExists = true;
  db.windowStart = () => '0000-00-00';
  db.query = run;
  db.getConnection = async () => {
    const snapshot = { buckets: new Map([...db.buckets].map(([k, v]) => [k, { ...v }])) };
    db.tx.push('getConnection');
    return {
      query: run,
      beginTransaction: async () => { db.tx.push('begin'); },
      commit: async () => { db.tx.push('commit'); },
      rollback: async () => { db.tx.push('rollback'); db.buckets = snapshot.buckets; },
      release: () => { db.tx.push('release'); },
    };
  };
  return db;
}
const V = (i, tail = 'A') => `1FTFW1E5${tail}${String(i).padStart(8, '0')}`.slice(0, 17); // shard = '1FTFW1E5'
const OLD = '2026-10-26 22:00:00', NEW = '2026-10-27 02:00:00';
const bucketSummary = (db) => [...db.buckets.values()].map((b) => `${b.shard}|${b.make}|${b.state}|${b.model}|${b.trim}|${b.seen_on}|${b.n}`).sort();

describe('shardBucketsSql', () => {
  it('is a prefix-range read joined by primary key: LIKE per shard, no BINARY, no losers-table-wide GROUP BY without the shard range', () => {
    const q = shardBucketsSql(['1FTFW1E5', '1C6RREBG']);
    assert.match(q.sql, /WHERE \(l\.vin LIKE \? OR l\.vin LIKE \?\) AND i\.removed_at IS NULL AND i\.stale_at IS NULL AND \(i\.cond IS NULL OR i\.cond <> 'wholesale'\)/);
    assert.match(q.sql, /JOIN dealer_inventory i ON i\.vin = l\.vin AND i\.dealer_id = l\.dealer_id/);
    assert.doesNotMatch(q.sql, /BINARY/);
    assert.deepEqual(q.args, ['1FTFW1E5%', '1C6RREBG%']);
  });
  it('retailOnly false drops the wholesale predicate', () => {
    assert.doesNotMatch(shardBucketsSql(['1FTFW1E5'], { retailOnly: false }).sql, /wholesale/);
  });
});

describe('recomputeShards', () => {
  const stock = () => [inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5), inv(V(2), 1, OLD, 5), inv(V(2), 3, NEW, 4), inv(V(3), 1, OLD, 5, { trim: 'Lariat' }), inv(V(3), 2, NEW, 5, { trim: 'Lariat' })];
  it('writes exactly the visible losers grouped by (shard, make, state, model, trim, seen date)', async () => {
    const db = fakeDb(stock(), [[V(1), 1], [V(2), 1], [V(3), 1]]);
    const r = await recomputeShards(db, [shardOf(V(1))]);
    assert.deepEqual([r.shards, r.groups], [1, 1]);
    assert.deepEqual(bucketSummary(db), ['1FTFW1E5|Ford|NJ|F-150|Lariat|2026-10-26|1', '1FTFW1E5|Ford|NJ|F-150|XLT|2026-10-26|2']);
  });
  it('a shard with no visible losers ends with no rows (the old rows are deleted)', async () => {
    const db = fakeDb(stock(), [[V(1), 1]]);
    await recomputeShards(db, [shardOf(V(1))]);
    assert.equal(db.buckets.size, 1);
    db.rows[0].removed_at = 'x'; // the loser's own row is swept
    await recomputeShards(db, [shardOf(V(1))]);
    assert.equal(db.buckets.size, 0);
  });
  it('uses one transaction per group of up to 25 shards, and every statement carries the 10 s stop', async () => {
    const db = fakeDb([]);
    const shards = Array.from({ length: 60 }, (_, i) => `1FTFW${String(i).padStart(3, '0')}`);
    const raw = [];
    const wrapped = { ...db, query: async (sql, a) => { raw.push(sql); return db.query(sql, a); }, getConnection: async () => { const c = await db.getConnection(); const q = c.query; c.query = async (sql, a) => { raw.push(sql); return q(sql, a); }; return c; } };
    const r = await recomputeShards(wrapped, shards);
    assert.equal(r.groups, Math.ceil(60 / SHARDS_PER_STATEMENT));
    assert.equal(db.tx.filter((t) => t === 'begin').length, 3);
    assert.equal(db.tx.filter((t) => t === 'commit').length, 3);
    assert.ok(raw.length > 0 && raw.every((s) => /^SET STATEMENT max_statement_time=10 FOR /.test(s)), 'every statement is capped at 10 s');
  });
  it('a failing insert rolls the group back: the previous rows for those shards survive, and the error propagates', async () => {
    const db = fakeDb(stock(), [[V(1), 1]]);
    await recomputeShards(db, [shardOf(V(1))]);
    const before = bucketSummary(db);
    db.losers.add(`${V(2)}|1`);
    db.failOn = /^INSERT INTO/;
    await assert.rejects(recomputeShards(db, [shardOf(V(1))]), /max_statement_time/);
    assert.deepEqual(bucketSummary(db), before);
    assert.ok(db.tx.includes('rollback'));
  });
  it('works without a transaction-capable pool (plain query object)', async () => {
    const db = fakeDb(stock(), [[V(1), 1]]);
    await recomputeShards({ query: db.query }, [shardOf(V(1))]);
    assert.equal(db.buckets.size, 1);
  });
});

describe('maintenance keeps the buckets exact (sync hook and reconcile)', () => {
  it('refreshVinLosers with buckets: the loser flag AND its bucket follow the rows', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5), inv(V(2), 4, NEW, 5)]);
    const r = await refreshVinLosers(db, [V(1), V(2)], { buckets: true });
    assert.deepEqual([r.added, r.bucketErrors], [1, 0]);
    assert.deepEqual(bucketSummary(db), ['1FTFW1E5|Ford|NJ|F-150|XLT|2026-10-26|1']);
  });
  it('a re-sighting of the loser on a later date moves its count to the new date; a trim fix moves it to the new trim', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, '2026-10-28 02:00:00', 5)], [[V(1), 1]]);
    await refreshVinLosers(db, [V(1)], { buckets: true });
    assert.deepEqual(bucketSummary(db), ['1FTFW1E5|Ford|NJ|F-150|XLT|2026-10-26|1']);
    db.rows[0].last_seen_at = '2026-10-27 03:00:00';
    db.rows[0].trim = 'Lariat';
    await refreshVinLosers(db, [V(1)], { buckets: true });
    assert.deepEqual(bucketSummary(db), ['1FTFW1E5|Ford|NJ|F-150|Lariat|2026-10-27|1']);
  });
  it('the reconcile after a sweep drops a swept loser from the counts', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5), inv(V(2), 1, OLD, 5), inv(V(2), 2, NEW, 5)], [[V(1), 1], [V(2), 1]]);
    await recomputeShards(db, [shardOf(V(1))]);
    assert.equal(db.buckets.values().next().value.n, 2);
    db.rows[0].removed_at = 'swept';
    const s = await reconcileLosers(db, { buckets: true });
    assert.equal(s.done, true);
    assert.equal([...db.buckets.values()].reduce((n, b) => n + b.n, 0), 1);
  });
  it('a bucket failure never undoes the losers write and is reported, not thrown', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5)]);
    db.failOn = /^SELECT LEFT\(l\.vin/;
    const r = await refreshVinLosers(db, [V(1)], { buckets: true });
    assert.deepEqual([r.added, r.bucketErrors], [1, 1]);
    assert.deepEqual([...db.losers], [`${V(1)}|1`]);
  });
  it('buckets off (the default): no bucket statement is ever issued', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5)]);
    await refreshVinLosers(db, [V(1)]);
    assert.ok(db.log.every((s) => !s.includes(BUCKETS_TABLE) && !/LEFT\(l\.vin/.test(s)));
  });
  it('createLoserMaintenance passes the buckets flag through afterUpsert and the reconcile', async () => {
    const db = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5)]);
    db.query = (q => async (sql, a) => (/^CREATE TABLE/.test(sql) ? [[]] : q(sql, a)))(db.query);
    const on = createLoserMaintenance({ getPool: () => db, mode: 'maintain', buckets: true, log() {} });
    await on.afterUpsert([V(1)]);
    assert.equal(db.buckets.size, 1);
    const off = fakeDb([inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5)]);
    const mOff = createLoserMaintenance({ getPool: () => off, mode: 'maintain', buckets: false, log() {} });
    off.query = (q => async (sql, a) => (/^CREATE TABLE/.test(sql) ? [[]] : q(sql, a)))(off.query);
    await mOff.afterUpsert([V(1)]);
    assert.equal(off.buckets.size, 0);
  });
});

describe('backfillBuckets', () => {
  const stock = () => {
    const rows = [];
    for (let i = 0; i < 60; i++) {
      const vin = `1FT${String(i % 12).padStart(5, '0')}A${String(i).padStart(8, '0')}`.slice(0, 17);
      rows.push(inv(vin, 1, OLD, 5)); rows.push(inv(vin, 2, NEW, 5, { trim: i % 2 ? 'XLT' : 'Lariat' }));
    }
    return rows;
  };
  const losersFor = (rows) => rows.filter((r) => r.dealer_id === 1).map((r) => [r.vin, r.dealer_id]);

  it('pages through the losers table by shard and ends exact, shard by shard', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    const s = await backfillBuckets(db, { pageShards: 4 });
    assert.equal(s.done, true);
    assert.ok(s.pages >= 3);
    assert.equal([...db.buckets.values()].reduce((n, b) => n + b.n, 0), 60);
    assert.deepEqual((await verifyShards(db, [...new Set(rows.map((r) => shardOf(r.vin)))])).mismatched, []);
  });
  it('is idempotent and resumable from the last finished shard', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    const first = await backfillBuckets(db, { pageShards: 3, shouldStop: (() => { let n = 0; return () => ++n > 2; })() });
    assert.equal(first.done, false);
    const second = await backfillBuckets(db, { pageShards: 3, startAfter: first.lastShard });
    assert.equal(second.done, true);
    const snap = bucketSummary(db);
    await backfillBuckets(db, { pageShards: 3 });
    assert.deepEqual(bucketSummary(db), snap);
  });
  it('a dry run reads every group and writes nothing', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    const s = await backfillBuckets(db, { pageShards: 4, dryRun: true });
    assert.equal(s.done, true);
    assert.ok(s.rows > 0);
    assert.equal(db.buckets.size, 0);
    assert.ok(db.log.every((l) => !/^(INSERT INTO|DELETE FROM) dealer_inventory_vin_loser_buckets/.test(l)));
  });
  it('stops at the first failing statement (the 10 s cap) and reports the error', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    db.failOn = /^SELECT LEFT\(l\.vin/;
    await assert.rejects(backfillBuckets(db, { pageShards: 4 }), /max_statement_time/);
    assert.equal(db.log.filter((l) => /^SELECT LEFT\(l\.vin/.test(l)).length, 1, 'no retry');
  });
  it('honors maxMs', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    let t = 0;
    const s = await backfillBuckets(db, { pageShards: 2, maxMs: 5, now: () => (t += 3) });
    assert.equal(s.done, false);
  });
  it('every statement of the backfill carries a statement stop of 10 s by default', async () => {
    const rows = stock();
    const db = fakeDb(rows, losersFor(rows));
    const raw = [];
    await backfillBuckets({ query: async (sql, a) => { raw.push(sql); return db.query(sql, a); }, getConnection: async () => { const c = await db.getConnection(); const q = c.query; c.query = async (sql, a) => { raw.push(sql); return q(sql, a); }; return c; } }, { pageShards: 5 });
    assert.ok(raw.length > 0 && raw.every((s) => /^SET STATEMENT max_statement_time=10 FOR /.test(s)));
  });
});

describe('verifyShards', () => {
  it('names the shards whose stored buckets differ from a fresh aggregate', async () => {
    const rows = [inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5)];
    const db = fakeDb(rows, [[V(1), 1]]);
    await recomputeShards(db, [shardOf(V(1))]);
    assert.deepEqual((await verifyShards(db, [shardOf(V(1))])).mismatched, []);
    db.buckets.values().next().value.n = 9;
    assert.deepEqual((await verifyShards(db, [shardOf(V(1))])).mismatched, [shardOf(V(1))]);
  });
});

describe('facet read from the buckets', () => {
  const lists = { states: [{ state: 'NJ', n: 10 }], makes: [{ make: 'Ford', n: 10 }], models: [{ model: 'F-150', n: 10 }], trims: [{ trim: 'XLT', n: 10 }] };
  const deps = (db, extra = {}) => ({
    pool: db, stableCached: createStableCache({ now: () => 0 }).cached ?? ((key, fn) => fn()), withPoolTimeout: (p) => p, statementSeconds: () => 20, waitMs: () => 45_000, retailOnlyFacets: true, enabled: true, ...extra,
  });
  const passthrough = (key, fn) => fn();
  const rows = () => [inv(V(1), 1, OLD, 5), inv(V(1), 2, NEW, 5), inv(V(2), 1, OLD, 5), inv(V(2), 2, NEW, 5)];

  it('flag on and marker set: counts come from the buckets table, with no join and no GROUP BY over the losers table', async () => {
    _resetCooldown();
    const db = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: true });
    await recomputeShards(db, [shardOf(V(1))]);
    db.log.length = 0;
    const r = await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: true }), lists, { state: '', make: 'Ford', model: 'F-150' }, { days: null });
    assert.equal(r.applied, true);
    assert.deepEqual(r.lists.makes, [{ make: 'Ford', n: 8 }]);
    assert.ok(db.log.some((s) => s.includes(`FROM ${BUCKETS_TABLE}`)));
    assert.ok(db.log.every((s) => !/GROUP BY i\.make/.test(s) && !s.includes(`FROM ${LOSERS_TABLE} l JOIN`)), 'the full GROUP BY is not run');
  });
  it('gives the same lists as the full GROUP BY it replaces', async () => {
    _resetCooldown();
    const db = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: true });
    await recomputeShards(db, [shardOf(V(1))]);
    const viaBuckets = await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: true }), lists, { make: 'Ford', model: 'F-150' }, {});
    _resetCooldown();
    const viaJoin = await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: false }), lists, { make: 'Ford', model: 'F-150' }, {});
    assert.deepEqual(viaBuckets.lists, viaJoin.lists);
  });
  it('marker missing (backfill not finished) or meta table missing: falls back to the losers-table GROUP BY', async () => {
    _resetCooldown();
    const db = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: false });
    const r = await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: true }), lists, { make: 'Ford' }, {});
    assert.equal(r.applied, true);
    assert.ok(db.log.some((s) => /GROUP BY i\.make/.test(s)));
    _resetCooldown();
    const db2 = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: true });
    db2.metaExists = false;
    const r2 = await facetsOnePerVin(deps(db2, { stableCached: passthrough, buckets: true }), lists, { make: 'Ford' }, {});
    assert.equal(r2.applied, true);
    assert.ok(db2.log.some((s) => /GROUP BY i\.make/.test(s)));
  });
  it('flag off: the buckets are never read, even with the marker set', async () => {
    _resetCooldown();
    const db = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: true });
    await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: false }), lists, { make: 'Ford' }, {});
    assert.ok(db.log.every((s) => !s.includes(BUCKETS_TABLE) && !s.includes(META_TABLE)));
  });
  it('the seen-window is a date filter on the buckets; a contact set keeps the join query', async () => {
    _resetCooldown();
    const db = fakeDb(rows(), [[V(1), 1], [V(2), 1]], { ready: true });
    await recomputeShards(db, [shardOf(V(1))]);
    db.windowStart = (days) => { assert.equal(days, 7); return '2026-10-27'; };
    const r = await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: true }), lists, { make: 'Ford' }, { days: 7 });
    assert.deepEqual(r.lists.makes, [{ make: 'Ford', n: 10 }], 'the 2026-10-26 losers are outside the window');
    assert.equal(bucketCountsSql({ days: 7 }).args[0], 7);
    assert.match(bucketCountsSql({ days: 7 }).sql, /WHERE seen_on >= DATE_SUB\(CURDATE\(\), INTERVAL \? DAY\)/);
    assert.doesNotMatch(bucketCountsSql({}).sql, /WHERE/);
    db.log.length = 0;
    await facetsOnePerVin(deps(db, { stableCached: passthrough, buckets: true }), lists, { make: 'Ford' }, { dealerIds: new Set([1]) });
    assert.ok(db.log.every((s) => !s.includes(BUCKETS_TABLE)), 'contact-set reads stay on the small join query');
  });
  it('bucketsReady: true only for the marker value 1; any error is "not ready"', async () => {
    const db = fakeDb([], [], { ready: true });
    assert.equal(await bucketsReady(db), true);
    db.meta.set('buckets_ready', '0');
    assert.equal(await bucketsReady(db), false);
    db.metaExists = false;
    assert.equal(await bucketsReady(db), false);
  });
});

describe('DDL and the box package', () => {
  const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  it('the buckets primary key leads with the shard and fits the InnoDB key limit', () => {
    assert.match(BUCKETS_DDL, /PRIMARY KEY \(shard, make, state, model, `trim`, seen_on\)/);
    const bytes = SHARD_LEN * 4 + (64 + 16 + 96 + 160) * 4 + 3;
    assert.ok(bytes < 3072, `${bytes} bytes`);
    assert.match(META_DDL, /k VARCHAR\(32\) NOT NULL PRIMARY KEY/);
  });
  it('STEPS.md pins the md5 of the module and the scripts it tells the installer to copy', () => {
    const steps = fs.readFileSync(path.join(ROOT, 'docs/box-patches/2026-10-31-loser-buckets/STEPS.md'), 'utf8');
    for (const rel of ['scrapers/lightsail-crawler/src/onePerVinLosers.js', 'scripts/box/2026-10-31-loser-buckets.mjs']) {
      assert.ok(steps.includes(`${md5(path.join(ROOT, rel))}  FINAL  ${path.basename(rel)}`), `${rel} md5 in STEPS.md is stale`);
    }
  });
  it('the box script caps every statement at 10 s, stops on the first error and never touches dealer_inventory', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/box/2026-10-31-loser-buckets.mjs'), 'utf8');
    assert.match(src, /statementSeconds: 10/);
    assert.doesNotMatch(src, /(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|TRUNCATE TABLE) dealer_inventory(?![_a-z])/);
    assert.match(src, /buckets_ready/);
  });
});
