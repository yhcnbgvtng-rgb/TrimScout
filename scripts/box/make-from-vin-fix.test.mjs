// scripts/box/2026-10-28-make-from-vin-fix.mjs: the pure planning / keyset apply loop (scripts/lib/makeFromVinFix.mjs) against an in-memory table, and source checks for the
// safety rails. Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeChange, planFromGroups, walkGroups, backupLine, parseBackup, applyConflicts } from '../lib/makeFromVinFix.mjs';

const SRC = fs.readFileSync(new URL('./2026-10-28-make-from-vin-fix.mjs', import.meta.url), 'utf8');
const vin = (p5, i) => p5 + String(i).padStart(12, '0');

describe('makeChange / planFromGroups', () => {
  it('rewrites only wmi-conflict rows', () => {
    assert.equal(makeChange({ make: 'GMC', vin: vin('2B3LJ', 1), model: 'Challenger' })?.to, 'Dodge');
    assert.equal(makeChange({ make: 'Nissan', vin: vin('KM8UB', 1), model: 'Palisade' })?.to, 'Hyundai');
    assert.equal(makeChange({ make: 'Kia', vin: vin('7YAPB', 1), model: 'Sportage Hybrid' }), null); // 7YA is also built Kia: excluded until vinWmi.js lists it
    assert.equal(makeChange({ make: 'GMC', vin: vin('1GKB0', 1), model: 'Yukon' }), null); // agrees
    assert.equal(makeChange({ make: 'GMC', vin: vin('XZZCJ', 1), model: 'X' }), null); // unknown WMI
    assert.equal(makeChange({ make: 'Ford', vin: vin('JN8AZ', 1), model: 'QX80' }), null); // shared WMI: conflict-unresolved, needs vPIC
    assert.equal(makeChange({ make: null, vin: vin('1GKB0', 1), model: 'Yukon' }), null); // blank: fill is not this script's job
  });
  it('counts, pairs and the not-touched buckets', () => {
    const p = planFromGroups([{ p5: '7YAPB', make: 'Kia', model: null, n: 9 }, { p5: '2B3LJ', make: 'GMC', model: 'Challenger', n: 3 }, { p5: '1GKB0', make: 'GMC', model: 'Yukon', n: 40 }, { p5: 'JN8AZ', make: 'Ford', model: 'QX80', n: 2 }, { p5: '4S3GT', make: 'GMC', model: null, n: 2 }]);
    assert.equal(p.total, 56); assert.equal(p.kept, 40); assert.equal(p.rowsToChange, 5);
    assert.deepEqual(p.pairs, { 'GMC -> Dodge': 3, 'GMC -> Subaru': 2 });
    assert.deepEqual(p.counted, { 'excluded-wmi': 9, 'conflict-unresolved': 2 });
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
