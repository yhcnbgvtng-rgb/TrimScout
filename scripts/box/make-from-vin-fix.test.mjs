// scripts/box/2026-10-28-make-from-vin-fix.mjs: the pure planning / keyset apply loop (scripts/lib/makeFromVinFix.mjs) against an in-memory table, and source checks for the
// safety rails. Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeChange, planFromGroups, walkGroups, backupLine, parseBackup, applyConflicts, readPrefixByWalk, fetchMatching } from '../lib/makeFromVinFix.mjs';

const SRC = fs.readFileSync(new URL('./2026-10-28-make-from-vin-fix.mjs', import.meta.url), 'utf8');
const vin = (p5, i) => p5 + String(i).padStart(12, '0');

describe('makeChange / planFromGroups', () => {
  it('rewrites only wmi-conflict rows', () => {
    assert.equal(makeChange({ make: 'GMC', vin: vin('2B3LJ', 1), model: 'Challenger' })?.to, 'Dodge');
    assert.equal(makeChange({ make: 'Nissan', vin: vin('KM8UB', 1), model: 'Palisade' })?.to, 'Hyundai');
    assert.equal(makeChange({ make: 'Kia', vin: vin('7YAPB', 1), model: 'Sportage Hybrid' }), null); // 7YA is Hyundai/Kia/Genesis in vinWmi.js: kept
    assert.equal(makeChange({ make: 'GMC', vin: vin('1GKB0', 1), model: 'Yukon' }), null); // agrees
    assert.equal(makeChange({ make: 'GMC', vin: vin('XZZCJ', 1), model: 'X' }), null); // unknown WMI
    assert.equal(makeChange({ make: 'Ford', vin: vin('JN8AZ', 1), model: 'Crossover' }), null); // shared WMI, model not decisive: conflict-unresolved, needs vPIC
    assert.deepEqual(makeChange({ make: 'Ford', vin: vin('JN8AZ', 1), model: 'QX80' }), { to: 'Infiniti', via: 'wmi-conflict' }); // shared WMI, but the model names one of its makes
    assert.equal(makeChange({ make: null, vin: vin('1GKB0', 1), model: 'Yukon' }), null); // blank: fill is not this script's job
  });
  it('counts, pairs and the not-touched buckets', () => {
    const p = planFromGroups([{ p5: '7YAPB', make: 'Kia', model: null, n: 9 }, { p5: '2B3LJ', make: 'GMC', model: 'Challenger', n: 3 }, { p5: '1GKB0', make: 'GMC', model: 'Yukon', n: 40 }, { p5: 'JN8AZ', make: 'Ford', model: 'Crossover', n: 2 }, { p5: '4S3GT', make: 'GMC', model: null, n: 2 }]);
    assert.equal(p.total, 56); assert.equal(p.kept, 49); assert.equal(p.rowsToChange, 5);
    assert.deepEqual(p.pairs, { 'GMC -> Dodge': 3, 'GMC -> Subaru': 2 });
    assert.deepEqual(p.counted, { 'conflict-unresolved': 2 });
    assert.equal(walkGroups(p.conflicts).length, 2);
  });
});

describe('applyConflicts (in-memory table)', () => {
  const mk = () => {
    const rows = [];
    for (let i = 1; i <= 250; i++) rows.push({ vin: vin('2B3LJ', i), dealer_id: 1 + (i % 3), make: 'GMC', model: 'Challenger' });
    rows.push({ vin: vin('2B3LJ', 999), dealer_id: 1, make: 'Dodge', model: 'Challenger' }); // already right: not in the (p5, GMC) walk
    const log = { backups: [], order: [] };
    const sorted = () => rows.slice().sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id));
    const io = {
      fetchBatch: async (g, cur, n) => sorted().map((r) => ({ ...r })).filter((r) => r.vin.startsWith(g.p5) && r.make === g.make && (!cur || r.vin > cur.vin || (r.vin === cur.vin && r.dealer_id > cur.dealer_id))).slice(0, n),
      writeBackup: (batch, to) => { log.order.push('backup'); log.backups.push(...batch.map((r) => backupLine(r, to))); },
      updateBatch: async (batch, to) => { log.order.push('update'); let n = 0; for (const b of batch) { const r = rows.find((x) => x.vin === b.vin && x.dealer_id === b.dealer_id && x.make === b.make); if (r) { r.make = to; n++; } } return n; },
    };
    return { rows, log, io };
  };
  const groups = [{ p5: '2B3LJ', make: 'GMC', n: 250 }];
  it('fixes everything in 100-row chunks, backup before every update, then a second run finds nothing', async () => {
    const { rows, log, io } = mk();
    const r = await applyConflicts({ groups, batchSize: 100, ...io });
    assert.equal(r.updated, 250); assert.equal(r.skipped, 0);
    assert.ok(rows.every((x) => x.make === 'Dodge'));
    assert.deepEqual(log.order, ['backup', 'update', 'backup', 'update', 'backup', 'update']);
    assert.equal(log.backups.length, 250);
    assert.equal((await applyConflicts({ groups, batchSize: 100, ...io })).updated, 0);
  });
  it('--limit is a hard cap, and the deadline stops before the next chunk', async () => {
    const a = mk(); const r = await applyConflicts({ groups, limit: 120, batchSize: 100, ...a.io });
    assert.equal(r.updated, 120); assert.equal(r.stopped, 'limit'); assert.equal(a.rows.filter((x) => x.make === 'Dodge').length, 121);
    const b = mk(); let calls = 0; const r2 = await applyConflicts({ groups, batchSize: 100, shouldStop: () => ++calls > 1, ...b.io });
    assert.equal(r2.updated, 100); assert.equal(r2.stopped, 'deadline');
  });
  it('a row whose make changed under us is skipped, not overwritten; an error ends the run', async () => {
    const { rows, io } = mk();
    const upd = io.updateBatch; io.updateBatch = async (batch, to) => { rows.find((x) => x.vin === batch[0].vin && x.dealer_id === batch[0].dealer_id).make = 'Jeep'; return upd(batch, to); };
    const r = await applyConflicts({ groups, batchSize: 100, ...io });
    assert.equal(r.skipped, 3); assert.equal(rows.filter((x) => x.make === 'Jeep').length, 3);
    await assert.rejects(applyConflicts({ groups, ...io, fetchBatch: async () => { throw new Error('max_statement_time exceeded'); } }), /max_statement_time/);
  });
  it('backup lines round-trip', () => assert.deepEqual(parseBackup(backupLine({ vin: 'V', dealer_id: 2, make: 'GMC', model: 'X' }, 'Dodge') + '\n\n'), [{ vin: 'V', dealer_id: 2, model: 'X', make_before: 'GMC', make_after: 'Dodge' }]));
});

describe('safety rails in the script source', () => {
  it('dry run by default, fleet-idle, lock, 10 s cap, 100-row chunks, PK keyset, make guard on the UPDATE, fsync before update', () => {
    assert.match(SRC, /Refusing to --apply without --fleet-idle/);
    assert.match(SRC, /sync-lock\/\$\{action\}/); assert.match(SRC, /process\.exit\(4\)/);
    assert.match(SRC, /BATCH = 100, CAP = 10/);
    assert.match(SRC, /ORDER BY vin, dealer_id LIMIT/); assert.match(SRC, /\(vin > \? OR \(vin = \? AND dealer_id > \?\)\)/);
    assert.match(SRC, /UPDATE dealer_inventory SET make = \? WHERE BINARY make = BINARY \? AND \(/);
    assert.ok(SRC.indexOf('fsyncSync') < SRC.indexOf('UPDATE dealer_inventory SET make = ? WHERE BINARY'));
    assert.match(SRC, /writing \? env\.DB_WRITER_USER : \(env\.DB_READER_USER/);
    assert.doesNotMatch(SRC, /DELETE |INSERT |ALTER |DROP /);
  });
});

describe('readPrefixByWalk (in-memory table)', () => {
  const mk = () => {
    const t = [];
    for (let d = 1; d <= 3; d++) for (let i = 0; i < 40; i++) t.push({ vin: vin(i % 2 ? '1FTEW' : '1FMCU', i), dealer_id: d, make: i % 5 === 0 ? 'GMC' : 'Ford', model: i % 3 ? 'F-150' : 'Escape', active: i % 7 === 0 ? 0 : 1 });
    t.push({ vin: vin('1GCUY', 1), dealer_id: 1, make: 'Chevrolet', model: 'Silverado 1500', active: 1 }); // outside the prefix
    return t.sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id));
  };
  const fetcher = (t, calls) => (prefix, cur, n) => {
    const rows = t.filter((r) => r.vin.startsWith(prefix) && (!cur || r.vin > cur.vin || (r.vin === cur.vin && r.dealer_id > cur.dealer_id))).slice(0, n);
    calls.push(rows.length);
    return rows;
  };
  const groupBy = (t, prefix, activeOnly, withModel) => {
    const m = new Map();
    for (const r of t.filter((r) => r.vin.startsWith(prefix) && (!activeOnly || r.active))) { const k = [r.vin.slice(0, 5), r.make, withModel ? r.model : null].join('|'); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const asMap = (groups) => new Map(groups.map((g) => [[g.p5, g.make, g.model].join('|'), g.n]));
  it('matches a GROUP BY for any chunk size, active only or not, with and without model', async () => {
    const t = mk();
    for (const chunk of [1, 7, 50, 119, 120, 5000]) for (const activeOnly of [true, false]) for (const withModel of [true, false]) {
      const calls = [];
      const r = await readPrefixByWalk({ prefix: '1F', withModel, activeOnly, chunk, fetchChunk: fetcher(t, calls) });
      assert.deepEqual([...asMap(r.groups)].sort(), [...groupBy(t, '1F', activeOnly, withModel)].sort(), `chunk=${chunk} active=${activeOnly} model=${withModel}`);
      assert.equal(r.scanned, 120);
      assert.ok(calls.every((n) => n <= chunk), 'no chunk exceeds its limit');
    }
  });
  it('stops at the deadline and propagates a fetch error (no retry)', async () => {
    const t = mk();
    await assert.rejects(readPrefixByWalk({ prefix: '1F', withModel: false, activeOnly: true, chunk: 10, fetchChunk: fetcher(t, []), shouldStop: () => true }), /deadline/);
    let n = 0;
    await assert.rejects(readPrefixByWalk({ prefix: '1F', withModel: false, activeOnly: true, chunk: 10, fetchChunk: async () => { n++; throw new Error('max_statement_time exceeded'); } }), /max_statement_time/);
    assert.equal(n, 1);
  });
  it('discovery in the script is the walk, with no GROUP BY left in it', () => {
    assert.match(SRC, /readPrefixByWalk\(/);
    assert.doesNotMatch(SRC, /GROUP BY LEFT\(vin,5\)/);
  });
});

describe('fetchMatching (apply-path PK walk)', () => {
  const table = () => {
    const t = [];
    for (let i = 1; i <= 90; i++) t.push({ vin: vin('3N1AB', i), dealer_id: 1 + (i % 4), make: i % 3 === 0 ? 'Infiniti' : i % 3 === 1 ? 'Nissan' : 'infiniti', model: 'Sentra', active: i % 10 === 0 ? 0 : 1 });
    t.push({ vin: vin('3N1AC', 1), dealer_id: 1, make: 'Infiniti', model: 'X', active: 1 }); // other p5
    return t.sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id));
  };
  const fetcher = (t, calls) => async (p5, cur, k) => {
    const rows = t.filter((r) => r.vin.startsWith(p5) && (!cur || r.vin > cur.vin || (r.vin === cur.vin && r.dealer_id > cur.dealer_id))).slice(0, k);
    calls.push(rows.length);
    return rows.map((r) => ({ ...r }));
  };
  const group = { p5: '3N1AB', make: 'Infiniti', n: 0 };
  const expected = (t, activeOnly) => t.filter((r) => r.vin.startsWith('3N1AB') && r.make === 'Infiniti' && (!activeOnly || r.active)).map((r) => `${r.vin}|${r.dealer_id}`);
  it('returns exactly the rows a "p5% AND BINARY make = ? [AND active]" SELECT would, in key order, whatever the chunk size', async () => {
    const t = table();
    for (const chunk of [1, 5, 16, 89, 90, 91, 2000]) for (const activeOnly of [true, false]) {
      const calls = [], got = [];
      let cur = null;
      for (;;) { // drive it the way applyConflicts does: batches of 7 after the last returned row
        const b = await fetchMatching({ group, cursor: cur, n: 7, activeOnly, chunk, fetchChunk: fetcher(t, calls) });
        if (!b.length) break;
        got.push(...b.map((r) => `${r.vin}|${r.dealer_id}`)); cur = { vin: b[b.length - 1].vin, dealer_id: b[b.length - 1].dealer_id };
      }
      assert.deepEqual(got, expected(t, activeOnly), `chunk=${chunk} active=${activeOnly}`);
      assert.ok(calls.every((n) => n <= chunk), 'no statement reads more than its chunk');
    }
  });
  it('make is matched exactly (case-sensitive) and a fetch error propagates without retry', async () => {
    const t = table();
    const b = await fetchMatching({ group, cursor: null, n: 1000, activeOnly: false, chunk: 20, fetchChunk: fetcher(t, []) });
    assert.ok(b.every((r) => r.make === 'Infiniti') && b.length === 30);
    let n = 0;
    await assert.rejects(fetchMatching({ group, cursor: null, n: 5, activeOnly: true, chunk: 10, fetchChunk: async () => { n++; throw new Error('max_statement_time exceeded'); } }), /max_statement_time/);
    assert.equal(n, 1);
  });
  it('drives applyConflicts end to end, and the script no longer has the make-filtered SELECT', async () => {
    const t = table(); const writes = [];
    const r = await applyConflicts({
      groups: [group], batchSize: 10,
      fetchBatch: (g, cur, n) => fetchMatching({ group: g, cursor: cur, n, activeOnly: true, chunk: 8, fetchChunk: fetcher(t, []) }),
      writeBackup: () => {},
      updateBatch: async (rows) => { writes.push(...rows.map((x) => `${x.vin}|${x.dealer_id}`)); return rows.length; },
    });
    assert.deepEqual(writes, expected(t, true)); assert.equal(r.updated, writes.length);
    assert.match(SRC, /fetchMatching\(/);
    assert.doesNotMatch(SRC, /WHERE vin LIKE \? AND BINARY make = BINARY \?\$\{ACTIVE_ONLY/);
  });
});
