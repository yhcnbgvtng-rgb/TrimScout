import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuplicateVinRequest, planVinKeepers, buildRowsSelect, buildRetireStatement, MAX_DUPLICATE_VINS } from '../src/vinKeeper.js';
import { distinctVins, runDuplicateVins, DUPLICATE_VINS_PATH } from '../../../scripts/box/syncSuperseded.js';

const V1 = '3N1AB8CV6RY276712', V2 = 'KMHGC4DD9DU247439';
const FB = '2026-10-09T20:00:00Z'; // run start - 48h
const row = (vin, dealerId, first, last, extra = {}) => ({ vin, dealerId, firstSeenAt: first, lastSeenAt: last, source: 'nightly', ...extra });

describe('parseDuplicateVinRequest', () => {
  it('accepts VINs, upper-cases and de-duplicates them', () => {
    const r = parseDuplicateVinRequest({ vins: [V1.toLowerCase(), V1, V2], foreignBefore: FB, dryRun: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.vins, [V1, V2]);
    assert.equal(r.dryRun, true);
  });
  it('rejects a missing cutoff, empty/oversized lists and malformed VINs', () => {
    assert.equal(parseDuplicateVinRequest({ vins: [V1] }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: [], foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: Array.from({ length: MAX_DUPLICATE_VINS + 1 }, () => V1), foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: ['SHORT'], foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: [V1], foreignBefore: 'nope' }).ok, false);
  });
});

describe('planVinKeepers', () => {
  it('a VIN under one store is kept as is', () => {
    const p = planVinKeepers([row(V1, 5, '2026-10-01T00:00:00Z', '2026-10-11T14:00:00Z')], { foreignBefore: FB });
    assert.deepEqual(p.retire, []);
    assert.deepEqual(p.keep, [[V1, 5]]);
    assert.equal(p.vinsWithDuplicates, 0);
  });
  it('two stores both refreshed tonight (the live Fred Anderson Kia / Asheville Toyota shape): the incumbent keeps it', () => {
    const rows = [row(V1, 6571, '2026-09-24T10:54:00Z', '2026-10-11T14:42:00Z'), row(V1, 12885, '2026-10-08T09:28:00Z', '2026-10-11T14:40:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 6571]]);
    assert.deepEqual(p.retire, [[V1, 12885]]);
    assert.equal(p.vinsWithDuplicates, 1);
  });
  it('the choice does not depend on row order or on which box ran the sync (no ping-pong)', () => {
    const rows = [row(V1, 6571, '2026-09-24T10:54:00Z', '2026-10-11T14:42:00Z'), row(V1, 12885, '2026-10-08T09:28:00Z', '2026-10-11T14:40:00Z'), row(V1, 777, '2026-10-02T00:00:00Z', '2026-10-11T01:00:00Z')];
    const a = planVinKeepers(rows, { foreignBefore: FB });
    const b = planVinKeepers([...rows].reverse(), { foreignBefore: FB });
    assert.deepEqual(a.keep, b.keep);
    assert.deepEqual(new Set(a.retire.map((x) => x.join('|'))), new Set(b.retire.map((x) => x.join('|'))));
    assert.deepEqual(a.keep, [[V1, 6571]]);
  });
  it('a row nobody has refreshed within the window never outranks one that was, however old the other is', () => {
    const rows = [row(V1, 1, '2026-01-01T00:00:00Z', '2026-10-03T12:00:00Z'), row(V1, 2, '2026-10-09T00:00:00Z', '2026-10-11T14:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 2]]);
    assert.deepEqual(p.retire, [[V1, 1]]);
  });
  it('the "no store matched" bucket (0) loses to a real store even when it is older and fresher', () => {
    const rows = [row(V1, 0, '2026-09-01T00:00:00Z', '2026-10-11T15:00:00Z'), row(V1, 4493, '2026-10-05T00:00:00Z', '2026-10-11T14:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 4493]]);
    assert.deepEqual(p.retire, [[V1, 0]]);
  });
  it('when every row is stale, one is still kept (the incumbent) rather than all retired', () => {
    const rows = [row(V1, 9, '2026-09-10T00:00:00Z', '2026-10-01T00:00:00Z'), row(V1, 3, '2026-09-01T00:00:00Z', '2026-10-02T00:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 3]]);
    assert.deepEqual(p.retire, [[V1, 9]]);
  });
  it('equal first_seen falls back to the lowest store id; null first_seen ranks last', () => {
    const t = '2026-10-11T14:00:00Z';
    assert.deepEqual(planVinKeepers([row(V1, 9, '2026-10-01T00:00:00Z', t), row(V1, 4, '2026-10-01T00:00:00Z', t)], { foreignBefore: FB }).keep, [[V1, 4]]);
    assert.deepEqual(planVinKeepers([row(V1, 1, null, t), row(V1, 2, '2026-10-01T00:00:00Z', t)], { foreignBefore: FB }).keep, [[V1, 2]]);
  });
  it('never retires or keeps rows that are not live nightly rows', () => {
    const t = '2026-10-11T14:00:00Z';
    const rows = [row(V1, 1, '2026-10-01T00:00:00Z', t, { source: 'manual' }), row(V1, 2, '2026-10-02T00:00:00Z', t), row(V1, 3, '2026-10-03T00:00:00Z', t, { removedAt: '2026-10-05T00:00:00Z' })];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 2]]);
    assert.deepEqual(p.retire, []);
  });
  it('handles MariaDB datetime strings and Date objects alike, and several VINs at once', () => {
    const rows = [
      row(V1, 1, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-11T14:00:00Z')), row(V1, 2, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-11T14:00:00Z')),
      row(V2, 7, '2026-10-01 00:00:00', '2026-10-11 14:00:00'), row(V2, 8, '2026-10-01 00:00:00', '2026-10-11 14:00:00'),
    ];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 1], [V2, 7]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    assert.equal(p.retire.length, 2);
    assert.equal(p.vinsWithDuplicates, 2);
  });
  it('throws without a cutoff', () => assert.throws(() => planVinKeepers([], {}), /foreignBefore/));
});

describe('statements', () => {
  it('reads only live nightly rows of the listed VINs, by primary-key prefix', () => {
    const { sql, args } = buildRowsSelect([V1, V2]);
    assert.match(sql, /WHERE removed_at IS NULL AND source = 'nightly' AND vin IN \(\?, \?\)$/);
    assert.deepEqual(args, [V1, V2]);
  });
  it('retires by primary key and re-checks the row is still live', () => {
    const { sql, args } = buildRetireStatement([[V1, 12885], [V2, 5]]);
    assert.match(sql, /^UPDATE dealer_inventory FORCE INDEX \(PRIMARY\) SET removed_at = CURRENT_TIMESTAMP WHERE removed_at IS NULL AND source = 'nightly' AND \(\(vin = \? AND dealer_id = \?\) OR \(vin = \? AND dealer_id = \?\)\)$/);
    assert.deepEqual(args, [V1, 12885, V2, 5]);
  });
});

describe('sync client: distinctVins / runDuplicateVins', () => {
  const rows = [{ vin: V2, dealerId: 5 }, { vin: V1, dealerId: 6 }, { vin: V1, dealerId: 7 }, { vin: V1.toLowerCase(), dealerId: 7 }, { vin: V2, dealerId: 0 }, { vin: null, dealerId: 5 }, { vin: 'X', dealerId: null }];
  it('lists each matched-store VIN once, sorted, upper-cased', () => assert.deepEqual(distinctVins(rows), [V1, V2].sort()));
  it('sends batches, sums the counts and passes the dry-run flag through', async () => {
    const calls = [];
    const api = async (path, body) => { calls.push([path, body]); return { vinsWithDuplicates: 1, wouldRetire: 2, retired: 3 }; };
    const dry = await runDuplicateVins({ api, rows, foreignBefore: FB, dryRun: true, batch: 1, log: () => {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], DUPLICATE_VINS_PATH);
    assert.equal(calls[0][1].dryRun, true);
    assert.deepEqual(dry, { vins: 2, calls: 2, retired: 0, wouldRetire: 4, vinsWithDuplicates: 2, failedCalls: 0 });
    const live = await runDuplicateVins({ api, rows, foreignBefore: FB, log: () => {} });
    assert.equal(live.retired, 3);
    assert.equal(live.wouldRetire, 0);
  });
  it('a failed batch is logged and skipped; a 404 stops the step; a lost lock stops it before any call', async () => {
    const logs = [];
    let n = 0;
    const flaky = async () => { n++; if (n === 1) throw new Error('HTTP 500 boom'); return { retired: 1 }; };
    const r = await runDuplicateVins({ api: flaky, rows, foreignBefore: FB, batch: 1, log: (m) => logs.push(m) });
    assert.equal(r.failedCalls, 1);
    assert.equal(r.retired, 1);
    const old = await runDuplicateVins({ api: async () => { throw new Error('POST x -> HTTP 404 Not Found'); }, rows, foreignBefore: FB, batch: 1, log: (m) => logs.push(m) });
    assert.equal(old.calls, 1);
    const lost = await runDuplicateVins({ api: async () => { throw new Error('should not be called'); }, rows, foreignBefore: FB, isLockLost: () => true, log: () => {} });
    assert.equal(lost.calls, 0);
  });
});
