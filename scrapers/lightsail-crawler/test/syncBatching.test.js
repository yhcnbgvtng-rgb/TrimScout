// Bulk-upsert request bodies are capped by rows AND bytes: the deals API refuses a body over 30MB, and a
// feature-heavy vehicle can be ~10x a typical one, so a row cap alone can't keep a request under it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { takeBatch, planBatches, DEFAULT_BATCH_ROWS, DEFAULT_BATCH_MAX_BYTES } from '../../../scripts/box/syncBatching.js';

const row = (i, pad = 0) => ({ vin: `VIN${String(i).padStart(14, '0')}`, dealerId: 1, note: 'x'.repeat(pad) });
const rows = (n, pad) => Array.from({ length: n }, (_, i) => row(i, pad));

describe('takeBatch', () => {
  it('produces a valid {"vehicles":[...]} body whose size is exactly reported, in row order', () => {
    const rs = rows(5, 10);
    const b = takeBatch(rs, 0, { maxRows: 100, maxBytes: 1e6 });
    assert.equal(b.count, 5);
    assert.equal(b.bytes, Buffer.byteLength(b.body));
    assert.deepEqual(JSON.parse(b.body).vehicles, rs);
  });

  it('stops at maxRows', () => {
    const b = takeBatch(rows(10), 0, { maxRows: 4, maxBytes: 1e6 });
    assert.equal(b.count, 4);
    assert.deepEqual(JSON.parse(b.body).vehicles.map((v) => v.vin), rows(4).map((v) => v.vin));
  });

  it('stops before the body would exceed maxBytes — never over, whatever the rows look like', () => {
    const rs = rows(50, 1000); // ~1.1KB each
    const b = takeBatch(rs, 0, { maxRows: 1000, maxBytes: 10_000 });
    assert.ok(b.count > 1 && b.count < 50);
    assert.ok(b.bytes <= 10_000, `${b.bytes} > 10000`);
    assert.equal(b.bytes, Buffer.byteLength(b.body));
    // one more row would not have fit
    const bigger = takeBatch(rs, 0, { maxRows: b.count + 1, maxBytes: 1e9 });
    assert.ok(bigger.bytes > 10_000);
  });

  it('always takes at least one row, so a single oversized vehicle goes out alone instead of wedging the run', () => {
    const rs = [row(1, 50_000), row(2)];
    const b = takeBatch(rs, 0, { maxRows: 100, maxBytes: 1000 });
    assert.equal(b.count, 1);
    assert.ok(b.bytes > 1000);
    assert.equal(takeBatch(rs, 1, { maxRows: 100, maxBytes: 1000 }).count, 1);
  });

  it('counts bytes, not characters (multi-byte text)', () => {
    const rs = [{ vin: 'A', n: '™'.repeat(100) }, { vin: 'B', n: '™'.repeat(100) }];
    const b = takeBatch(rs, 0, { maxRows: 10, maxBytes: 1e6 });
    assert.equal(b.bytes, Buffer.byteLength(b.body));
    assert.ok(b.bytes > b.body.length);
  });

  it('starts at the given offset and returns an empty batch past the end', () => {
    const rs = rows(6);
    assert.deepEqual(JSON.parse(takeBatch(rs, 4, { maxRows: 10, maxBytes: 1e6 }).body).vehicles.map((v) => v.vin), rs.slice(4).map((v) => v.vin));
    assert.equal(takeBatch(rs, 6).count, 0);
  });

  it('defaults are the current row cap and a byte cap well under the server\'s 30MB limit', () => {
    assert.equal(DEFAULT_BATCH_ROWS, 2000);
    assert.ok(DEFAULT_BATCH_MAX_BYTES <= 15 * 1024 * 1024);
  });
});

describe('planBatches', () => {
  it('covers every row exactly once and summarizes the request sizes', () => {
    const rs = rows(1000, 100);
    const plan = planBatches(rs, 0, { maxRows: 300, maxBytes: 1e9 });
    assert.equal(plan.rows, 1000);
    assert.equal(plan.batches, 4);
    assert.equal(plan.maxRowsInBatch, 300);
    assert.ok(plan.minBytes <= plan.medianBytes && plan.medianBytes <= plan.p95Bytes && plan.p95Bytes <= plan.maxBytes);
    assert.equal(plan.totalBytes, takeBatch(rs, 0, { maxRows: 300, maxBytes: 1e9 }).bytes + takeBatch(rs, 300, { maxRows: 300, maxBytes: 1e9 }).bytes + takeBatch(rs, 600, { maxRows: 300, maxBytes: 1e9 }).bytes + takeBatch(rs, 900, { maxRows: 300, maxBytes: 1e9 }).bytes);
  });

  it('a start offset plans only the remainder; an empty list plans nothing', () => {
    assert.equal(planBatches(rows(10), 4, { maxRows: 3 }).rows, 6);
    assert.equal(planBatches(rows(10), 4, { maxRows: 3 }).batches, 2);
    assert.deepEqual(planBatches([], 0), { batches: 0, rows: 0, totalBytes: 0, minBytes: 0, medianBytes: 0, p95Bytes: 0, maxBytes: 0, maxRowsInBatch: 0 });
  });
});
