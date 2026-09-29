// inventory-sync.mjs had no resume — a crash redid the whole file from row 0. This checkpoint is
// purely an optimization on top of already-idempotent upserts: a second run against the SAME
// source file skips rows already covered, a run against a DIFFERENT file starts at 0.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFileIdentity, sortRows, makeCheckpoint, resumeFrom } from '../../../scripts/box/syncCheckpoint.js';

const rowsFixture = [
  { vin: 'VIN3', dealerId: 1 },
  { vin: 'VIN1', dealerId: 2 },
  { vin: 'VIN2', dealerId: 1 },
  { vin: 'VIN4', dealerId: 0 },
];

describe('computeFileIdentity', () => {
  it('is stable regardless of shard order', () => {
    const a = [{ path: 'NJ.json', size: 100, mtimeMs: 5 }, { path: 'NY.json', size: 200, mtimeMs: 6 }];
    const b = [{ path: 'NY.json', size: 200, mtimeMs: 6 }, { path: 'NJ.json', size: 100, mtimeMs: 5 }];
    assert.equal(computeFileIdentity(a), computeFileIdentity(b));
  });

  it('changes when a shard is resized/rewritten (new crawl content)', () => {
    const a = [{ path: 'NJ.json', size: 100, mtimeMs: 5 }];
    const b = [{ path: 'NJ.json', size: 101, mtimeMs: 5 }];
    assert.notEqual(computeFileIdentity(a), computeFileIdentity(b));
  });
});

describe('sortRows', () => {
  it('orders by (dealerId, vin) deterministically', () => {
    assert.deepEqual(sortRows(rowsFixture).map((r) => `${r.dealerId}:${r.vin}`), ['0:VIN4', '1:VIN2', '1:VIN3', '2:VIN1']);
  });
});

describe('resumeFrom / makeCheckpoint', () => {
  it('a second start on the same file skips dealers/rows already completed', () => {
    const sorted = sortRows(rowsFixture);
    const identity = 'fileA';
    const checkpoint = makeCheckpoint(identity, sorted[1]); // last completed = dealer 1 / VIN2
    const remaining = resumeFrom(sorted, checkpoint, identity);
    assert.deepEqual(remaining.map((r) => `${r.dealerId}:${r.vin}`), ['1:VIN3', '2:VIN1']);
  });

  it('a different file ignores the old checkpoint and starts at 0', () => {
    const sorted = sortRows(rowsFixture);
    const checkpoint = makeCheckpoint('fileA', sorted[1]);
    const remaining = resumeFrom(sorted, checkpoint, 'fileB');
    assert.deepEqual(remaining, sorted);
  });

  it('no checkpoint at all starts at 0', () => {
    const sorted = sortRows(rowsFixture);
    assert.deepEqual(resumeFrom(sorted, null, 'fileA'), sorted);
  });

  it('a checkpoint at the very last row resumes to an empty remainder', () => {
    const sorted = sortRows(rowsFixture);
    const checkpoint = makeCheckpoint('fileA', sorted.at(-1));
    assert.deepEqual(resumeFrom(sorted, checkpoint, 'fileA'), []);
  });
});
