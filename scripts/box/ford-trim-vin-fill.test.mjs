// The box2 Ford trim VIN fill (2026-10-27-ford-trim-vin-fill.mjs): rule learning, planning, the hard limit, and source checks for the safety rails.
// Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vinKey, buildMapping, fillFor, trimRawFor, planFills, applyFills, fillBackupLine, MIN_ROWS, MIN_SHARE } from './2026-10-27-ford-trim-vin-fill.mjs';
import * as mod from '../../scrapers/lightsail-crawler/src/fordTrim.js';

const SRC = fs.readFileSync(new URL('./2026-10-27-ford-trim-vin-fill.mjs', import.meta.url), 'utf8');

describe('vinKey', () => {
  it('takes positions 5-7 and 10', () => {
    assert.equal(vinKey('1FTFW1E50NFA12345'), 'W1E|N');
    assert.equal(vinKey('1ftfw1e50nfa12345'), 'W1E|N');
  });
  it('is null for anything that is not 17 characters', () => { assert.equal(vinKey('SHORT'), null); assert.equal(vinKey(null), null); assert.equal(vinKey('1FTFW1E50NFA123456'), null); });
});

describe('buildMapping', () => {
  const g = (model, trim, k, y, count) => ({ model, trim, k, y, count });
  it('trusts a key with >= 5 clean rows at >= 95% agreement', () => {
    const m = buildMapping([g('F-150', 'XLT', 'W1E', 'N', 95), g('F-150', 'Lariat', 'W1E', 'N', 5)], mod);
    assert.deepEqual([...m.keys()], ['F-150|W1E|N']);
    assert.equal(m.get('F-150|W1E|N').trim, 'XLT');
  });
  it('rejects 94% agreement', () => assert.equal(buildMapping([g('F-150', 'XLT', 'W1E', 'N', 94), g('F-150', 'Lariat', 'W1E', 'N', 6)], mod).size, 0));
  it('rejects fewer than 5 clean rows even at 100%', () => assert.equal(buildMapping([g('F-150', 'XLT', 'W1E', 'N', 4)], mod).size, 0));
  it('exactly 5 rows at 100% is enough', () => assert.equal(buildMapping([g('F-150', 'XLT', 'W1E', 'N', 5)], mod).size, 1));
  it('only clean rows vote: blanks, junk and sentence trims are not counted', () => {
    const m = buildMapping([g('F-150', 'XLT', 'W1E', 'N', 3), g('F-150', '', 'W1E', 'N', 50), g('F-150', '4X4 CREWCAB XLT', 'W1E', 'N', 50), g('F-150', '8 FOOT BED', 'W1E', 'N', 50)], mod);
    assert.equal(m.size, 0); // 3 clean rows < 5
  });
  it('keys are per model and per year', () => {
    const m = buildMapping([g('F-150', 'XLT', 'W1E', 'N', 10), g('Ranger', 'XL', 'W1E', 'N', 10), g('F-150', 'Lariat', 'W1E', 'P', 10)], mod);
    assert.equal(m.get('F-150|W1E|N').trim, 'XLT');
    assert.equal(m.get('Ranger|W1E|N').trim, 'XL');
    assert.equal(m.get('F-150|W1E|P').trim, 'Lariat');
  });
  it('F-250 and F-350 pool as Super Duty; unprofiled models are ignored', () => {
    const m = buildMapping([g('F-250', 'Lariat', 'W2B', 'N', 3), g('F-350', 'Lariat', 'W2B', 'N', 3), g('Transit', 'XLT', 'X1Y', 'N', 99)], mod);
    assert.equal(m.get('Super Duty|W2B|N').trim, 'Lariat');
    assert.equal(m.size, 1);
  });
  it('documents the thresholds', () => { assert.equal(MIN_ROWS, 5); assert.equal(MIN_SHARE, 0.95); });
});

describe('fillFor', () => {
  const mapping = new Map([['F-150|W1E|N', { trim: 'XLT', rows: 100, share: 1 }]]);
  const mk = (trim) => ({ model: 'F-150', trim, vin: '1FTFW1E50NFA12345' });
  it('fills blank, null and unreadable trims', () => {
    for (const t of ['', null, '8 FOOT BED', 'Preferred']) assert.equal(fillFor(mk(t), mapping, mod), 'XLT', String(t));
  });
  it('never touches a clean trim or one the text normalizer can read', () => {
    assert.equal(fillFor(mk('Lariat'), mapping, mod), null);
    assert.equal(fillFor(mk('4X4 CREWCAB XLT'), mapping, mod), null);
  });
  it('is null without a trusted key, with a bad VIN, or on an unprofiled model', () => {
    assert.equal(fillFor({ model: 'F-150', trim: '', vin: '1FTFW1E51PFA12345' }, mapping, mod), null);
    assert.equal(fillFor({ model: 'F-150', trim: '', vin: 'SHORT' }, mapping, mod), null);
    assert.equal(fillFor({ model: 'Transit', trim: '', vin: '1FTFW1E50NFA12345' }, mapping, mod), null);
  });
});

describe('trimRawFor', () => {
  it('keeps the original text', () => assert.equal(trimRawFor({ trim: '8 FOOT BED', trim_raw: null }), '8 FOOT BED'));
  it('a blank original stays NULL', () => { assert.equal(trimRawFor({ trim: '', trim_raw: null }), null); assert.equal(trimRawFor({ trim: null, trim_raw: null }), null); });
  it('a trim_raw already on the row wins', () => assert.equal(trimRawFor({ trim: 'x', trim_raw: 'dealer text' }), 'dealer text'));
});

describe('planFills', () => {
  const groups = [
    { model: 'F-150', trim: 'XLT', k: 'W1E', y: 'N', count: 100 },
    { model: 'F-150', trim: '', k: 'W1E', y: 'N', count: 30 }, { model: 'F-150', trim: null, k: 'W1E', y: 'N', count: 2 },
    { model: 'F-150', trim: '8 FOOT BED', k: 'W1E', y: 'N', count: 4 }, { model: 'F-150', trim: '8 FOOT BED', k: 'X9Z', y: 'N', count: 6 },
    { model: 'F-150', trim: '4X4 CREWCAB XLT', k: 'W1E', y: 'N', count: 9 }, { model: 'Transit', trim: '', k: 'W1E', y: 'N', count: 7 },
  ];
  const mapping = buildMapping(groups, mod);
  const plan = planFills(groups, mapping, mod);
  it('counts per model, counts only', () => {
    assert.deepEqual(plan.perModel['F-150'], { rows: 151, clean: 100, fixable: 9, fillable: 36, unreadableNoRule: 6 });
    assert.equal(plan.perModel.Transit, undefined);
    assert.equal(plan.rowsToFill, 36);
  });
  it('lists the groups to walk, including the NULL-trim one', () => {
    assert.deepEqual(plan.groups.map((x) => [x.trim, x.rows]), [['', 30], ['8 FOOT BED', 4], [null, 2]]);
  });
  it('a second pass after the fills plans nothing', () => {
    const after = groups.map((x) => (['', null].includes(x.trim) || (x.trim === '8 FOOT BED' && x.k === 'W1E') ? { ...x, trim: 'XLT' } : x));
    assert.equal(planFills(after, buildMapping(after, mod), mod).rowsToFill, 0);
  });
});

describe('applyFills', () => {
  const mapping = new Map([['F-150|W1E|N', { trim: 'XLT' }]]);
  const mkRows = (n, trim = '') => Array.from({ length: n }, (_, i) => ({ vin: `1FTFW1E50NFA${String(i).padStart(5, '0')}`, dealer_id: 'd1', model: 'F-150', trim, trim_raw: null }));
  const harness = (rows, { move = (b) => b.length } = {}) => {
    const log = { backups: [], updates: [] };
    return {
      log,
      args: {
        groups: [{ model: 'F-150', trim: '', rows: rows.length }], mapping, mod, batchSize: 4,
        fetchPage: async (_g, cursor, n) => rows.filter((r) => !cursor || r.vin > cursor.vin).slice(0, n),
        writeBackup: (b) => { log.backups.push(b.length); },
        updateBatch: async (b) => { log.updates.push(b.length); return move(b); },
      },
    };
  };
  it('walks a group in pages and fills every fillable row', async () => {
    const h = harness(mkRows(10));
    const r = await applyFills({ ...h.args, limit: 1000 });
    assert.equal(r.updated, 10);
    assert.deepEqual(h.log.updates, [4, 4, 2]);
    assert.deepEqual(r.perModel, { 'F-150': 10 });
  });
  it('--limit is a hard cap, even mid-batch', async () => {
    const h = harness(mkRows(10));
    const r = await applyFills({ ...h.args, limit: 6 });
    assert.equal(r.updated, 6);
    assert.deepEqual(h.log.updates, [4, 2]);
  });
  it('writes the rollback batch before every update', async () => {
    const order = [];
    const h = harness(mkRows(5));
    await applyFills({ ...h.args, limit: 100, writeBackup: () => order.push('backup'), updateBatch: async (b) => { order.push('update'); return b.length; } });
    assert.deepEqual(order, ['backup', 'update', 'backup', 'update']);
  });
  it('skips rows without a trusted key (they are paged past, not retried) and stops a group whose update moved nothing', async () => {
    const rows = [...mkRows(3), { vin: '1FTFW1E51PFA99999', dealer_id: 'd1', model: 'F-150', trim: '', trim_raw: null }];
    const h = harness(rows);
    assert.equal((await applyFills({ ...h.args, limit: 100 })).updated, 3);
    const h2 = harness(mkRows(8), { move: () => 0 });
    const r = await applyFills({ ...h2.args, limit: 100 });
    assert.equal(r.updated, 0); assert.equal(r.skipped, 4); assert.deepEqual(h2.log.updates, [4]);
  });
  it('refuses to run without a positive limit', async () => { await assert.rejects(() => applyFills({ ...harness(mkRows(1)).args, limit: 0 }), /positive limit/); });
  it('rollback line has the before-state and the trim written', () => {
    const row = { vin: 'V', dealer_id: 'd', model: 'F-150', trim: '8 FOOT BED', trim_raw: null };
    assert.deepEqual(JSON.parse(fillBackupLine({ row, after: 'XLT' })), { vin: 'V', dealer_id: 'd', model: 'F-150', trim_before: '8 FOOT BED', trim_raw_before: null, trim_after: 'XLT' });
  });
});

describe('safety rails in the source', () => {
  it('dry run is the default; --apply needs --fleet-idle and --limit', () => {
    assert.match(SRC, /APPLY && !FLEET_IDLE/);
    assert.match(SRC, /--apply needs --limit=N/);
    assert.match(SRC, /if \(!APPLY\) \{ console\.log\("DRY RUN - nothing was changed\."\)/);
  });
  it('takes the sync lock, releases it in finally, exits 4 when held, checks the retired-IP guard', () => {
    assert.match(SRC, /sync-lock\/\$\{action\}/); assert.match(SRC, /finally \{ await release\(\)/); assert.match(SRC, /process\.exit\(4\)/); assert.match(SRC, /pointsAtDeadIp/);
  });
  it('never alters the table and never deletes', () => { assert.doesNotMatch(SRC, /ALTER TABLE|DELETE FROM|DROP /i); });
  it('the update is by primary key and requires the trim to be unchanged', () => { assert.match(SRC, /WHERE vin = \? AND dealer_id = \? AND \$\{same\}/); });
  it('statements are capped at 20 s', () => { assert.match(SRC, /max_statement_time=\$\{STATEMENT_CAP_S\}/); });
});
