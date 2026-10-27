// The box2 Ford trim clean-up (2026-10-27-ford-trim-normalize.mjs): its pure planning/backup parts, and source checks for the safety rails
// (dry run by default, --fleet-idle, sync lock, backup before update, rollback guard). Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planFromGroups, backupLine, parseBackup, applyChanges } from './2026-10-27-ford-trim-normalize.mjs';
import { normalizeFordTrimForWrite } from '../../scrapers/lightsail-crawler/src/fordTrim.js';

const SRC = fs.readFileSync(new URL('./2026-10-27-ford-trim-normalize.mjs', import.meta.url), 'utf8');

describe('planFromGroups', () => {
  const groups = [
    { model: 'F-150', trim: 'XLT', count: 34290 }, { model: 'F-150', trim: '4X4 CREWCAB XLT', count: 360 }, { model: 'F-150', trim: null, count: 3378 },
    { model: 'F-250', trim: 'F 250 Lariat', count: 509 }, { model: 'F-250', trim: 'Preferred', count: 282 }, { model: 'F-150', trim: 'XLT Lariat', count: 1 },
    { model: 'Explorer', trim: 'ST Line', count: 3760 }, { model: 'Explorer', trim: 'ST-Line', count: 4124 }, { model: 'Bronco Sport', trim: 'Big Bend 4x4', count: 50 },
    { model: 'Escape', trim: 'S', count: 347 }, { model: 'Bronco', trim: 'Base 4 Door 4x4', count: 8 },
  ];
  const plan = planFromGroups(groups, normalizeFordTrimForWrite);
  it('counts rows by status', () => assert.deepEqual(plan.byStatus, { clean: 34290 + 4124 + 347, fix: 360 + 509 + 3760, blank: 3378, leftover: 282 + 8, ambiguous: 1, skipped: 50 }));
  it('lists only the rewrites, biggest first, and never a clean / blank / leftover / ambiguous / skipped group', () => {
    assert.deepEqual(plan.changes.map((c) => [c.model, c.before, c.after, c.count]), [['Explorer', 'ST Line', 'ST-Line', 3760], ['F-250', 'F 250 Lariat', 'Lariat', 509], ['F-150', '4X4 CREWCAB XLT', 'XLT', 360]]);
    assert.equal(plan.rowsToChange, 3760 + 509 + 360);
  });
  it('a second pass over the already-fixed groups plans nothing (idempotent)', () => {
    const after = groups.map((g) => { const c = plan.changes.find((x) => x.model === g.model && x.before === g.trim); return c ? { ...g, trim: c.after } : g; });
    assert.equal(planFromGroups(after, normalizeFordTrimForWrite).rowsToChange, 0);
  });
});

describe('backup and rollback records', () => {
  it('a backup line carries everything needed to restore the row', () => {
    const line = backupLine({ vin: '1FTFW1E50NFA00001', dealer_id: 7, model: 'F-150', trim: '4X4 CREWCAB XLT', trim_raw: null }, 'XLT');
    assert.deepEqual(JSON.parse(line), { vin: '1FTFW1E50NFA00001', dealer_id: 7, model: 'F-150', trim_before: '4X4 CREWCAB XLT', trim_raw_before: null, trim_after: 'XLT' });
    assert.equal(parseBackup(`${line}\n\n${line}\n`).length, 2);
  });
});

describe('safety rails (source checks)', () => {
  it('is a dry run unless --apply, and --apply needs --fleet-idle', () => {
    assert.match(SRC, /const APPLY = flag\("apply"\)/);
    assert.match(SRC, /if \(APPLY && !FLEET_IDLE\) \{[^}]*Refusing to --apply without --fleet-idle/);
    assert.match(SRC, /if \(!APPLY\) \{ console\.log\("DRY RUN - nothing was changed\."\)/);
  });
  it('takes the sync lock for any write, exits 4 when it is held, and releases it in finally', () => {
    assert.match(SRC, /sync-lock\/\$\{action\}/);
    assert.match(SRC, /process\.exit\(4\)/);
    assert.match(SRC, /finally \{ await release\(\)/);
    assert.equal((SRC.match(/await withLock\(/g) || []).length, 2, 'both the rewrite and the rollback go through the lock');
  });
  it('writes the backup (fsync) before the UPDATE of the same batch, and guards the UPDATE on the exact trim it read', () => {
    assert.ok(SRC.indexOf('fs.fsyncSync(fd)') > 0);
    assert.match(SRC, /writeBackup\(batch, c\); \/\/ before-state first, then the UPDATE\n\s+const n = await updateBatch\(batch, c\)/);
    assert.match(SRC, /FOR UPDATE dealer_inventory SET trim = \?, trim_raw = \? WHERE BINARY trim = BINARY \? AND \(\$\{batch\.map/);
  });
  it('rollback only restores rows that still carry the trim this script wrote', () => {
    assert.match(SRC, /WHERE vin = \? AND dealer_id = \? AND trim = \?`, \[r\.trim_before, r\.trim_raw_before, r\.vin, r\.dealer_id, r\.trim_after\]/);
  });
  it('reads are index-bounded on make (and model, trim) and capped at 20 s; any error stops the run', () => {
    assert.match(SRC, /WHERE make = 'Ford'\$\{ACTIVE_ONLY \? " AND removed_at IS NULL" : ""\} GROUP BY model, BINARY trim/, 'groups by the exact text: trim is a case-insensitive collation');
    assert.match(SRC, /WHERE make = 'Ford' AND model = \? AND trim = \? AND BINARY trim = BINARY \?/, 'index range on (make, model, trim), then the exact-text filter');
    assert.match(SRC, /SET STATEMENT max_statement_time=\$\{STATEMENT_CAP_S\} FOR/);
    assert.match(SRC, /no retry/);
  });
  it('has no VIN tie-break and refuses a retired box IP', () => {
    assert.doesNotMatch(SRC, /SUBSTRING\(vin|vinWmi|tie-break\)\s*\{/);
    assert.match(SRC, /pointsAtDeadIp/);
  });
});

describe('applyChanges: --limit is a hard cap', () => {
  // An in-memory table of exact-text rows per (model, trim); fetch honours n like SQL LIMIT, update moves the rows it is given.
  const makeTable = (groups) => {
    const rows = new Map(groups.map((g) => [`${g.model}|${g.before}`, Array.from({ length: g.count }, (_, i) => ({ vin: `${g.model}-${g.before}-${i}`, dealer_id: 1, model: g.model, trim: g.before, trim_raw: null }))]));
    const log = [];
    return {
      rows, log,
      fetchBatch: async (c, n) => { log.push(['fetch', n]); return (rows.get(`${c.model}|${c.before}`) || []).slice(0, n); },
      writeBackup: (batch) => log.push(['backup', batch.length]),
      updateBatch: async (batch, c) => { log.push(['update', batch.length]); const k = `${c.model}|${c.before}`; rows.set(k, rows.get(k).filter((r) => !batch.includes(r))); return batch.length; },
    };
  };
  const change = (model, before, count) => ({ model, before, after: 'X', count });

  it('the 2026-10-27 case: limit 200 changes exactly 200 rows, never 393', async () => {
    const t = makeTable([{ model: 'Explorer', before: 'ST Line', count: 3367 }]);
    const r = await applyChanges({ changes: [change('Explorer', 'ST Line', 3367)], limit: 200, batchSize: 200, ...t });
    assert.deepEqual(r, { updated: 200, skipped: 0 });
    assert.equal(t.rows.get('Explorer|ST Line').length, 3167);
  });
  it('a limit that is not a multiple of the batch size shrinks the last batch and spans groups', async () => {
    const t = makeTable([{ model: 'A', before: 'a', count: 120 }, { model: 'B', before: 'b', count: 500 }]);
    const r = await applyChanges({ changes: [change('A', 'a', 120), change('B', 'b', 500)], limit: 250, batchSize: 100, ...t });
    assert.equal(r.updated, 250);
    assert.deepEqual(t.log.filter((e) => e[0] === 'update').map((e) => e[1]), [100, 20, 100, 30]);
    assert.equal(t.rows.get('A|a').length, 0);
    assert.equal(t.rows.get('B|b').length, 370);
  });
  it('no limit drains every group, in batches no larger than batchSize', async () => {
    const t = makeTable([{ model: 'A', before: 'a', count: 450 }]);
    const r = await applyChanges({ changes: [change('A', 'a', 450)], batchSize: 200, ...t });
    assert.equal(r.updated, 450);
    assert.deepEqual(t.log.filter((e) => e[0] === 'update').map((e) => e[1]), [200, 200, 50]);
  });
  it('every batch is backed up before it is updated', async () => {
    const t = makeTable([{ model: 'A', before: 'a', count: 5 }]);
    await applyChanges({ changes: [change('A', 'a', 5)], batchSize: 2, ...t });
    const seq = t.log.filter((e) => e[0] !== 'fetch').map((e) => e[0]);
    assert.deepEqual(seq, ['backup', 'update', 'backup', 'update', 'backup', 'update']);
  });
  it('a fetch that over-returns is still capped to the room left, and an update that moves nothing ends its group', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ vin: `V${i}`, dealer_id: 1, model: 'A', trim: 'a' }));
    const r = await applyChanges({ changes: [change('A', 'a', 50), change('B', 'b', 50)], limit: 10, batchSize: 200, fetchBatch: async () => rows, writeBackup() {}, updateBatch: async (b) => b.length });
    assert.equal(r.updated, 10);
    let calls = 0;
    const stuck = await applyChanges({ changes: [change('A', 'a', 50)], batchSize: 20, fetchBatch: async () => { calls++; return rows.slice(0, 20); }, writeBackup() {}, updateBatch: async () => 0 });
    assert.deepEqual([stuck.updated, stuck.skipped, calls], [0, 20, 1]);
  });
});
