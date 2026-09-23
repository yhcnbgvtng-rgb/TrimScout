import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withProbeRetry } from '../src/probeRetry.js';

describe('probeRetry.js — one retry-after-backoff for a bot-protection probe', () => {
  it('returns the first result unchanged when its classification is not in retryClasses', async () => {
    let calls = 0;
    const probeFn = async () => { calls++; return { classification: 'CLOUDFLARE', httpStatus: 403 }; };
    const result = await withProbeRetry(probeFn, { retryClasses: new Set(['HTTP_429']), delayMs: 0 });
    assert.equal(calls, 1, 'must not call probeFn a second time for a non-retryable class');
    assert.equal(result.classification, 'CLOUDFLARE');
  });

  it('retries exactly once when the first result is in retryClasses, and returns the SECOND result', async () => {
    let calls = 0;
    const probeFn = async () => {
      calls++;
      return calls === 1 ? { classification: 'HTTP_429', httpStatus: 429 } : { classification: 'NONE', httpStatus: 200 };
    };
    const result = await withProbeRetry(probeFn, { retryClasses: new Set(['HTTP_429']), delayMs: 0 });
    assert.equal(calls, 2, 'must call probeFn exactly twice — original + one retry');
    assert.equal(result.classification, 'NONE', 'must return the retry result, not the original 429');
  });

  it('never retries a second time even if the retry also comes back retryable — one retry, not a loop', async () => {
    let calls = 0;
    const probeFn = async () => { calls++; return { classification: 'HTTP_429', httpStatus: 429 }; };
    const result = await withProbeRetry(probeFn, { retryClasses: new Set(['HTTP_429']), delayMs: 0 });
    assert.equal(calls, 2, 'must stop after exactly one retry, not keep retrying');
    assert.equal(result.classification, 'HTTP_429');
  });

  it('actually waits delayMs before retrying', async () => {
    let calls = 0;
    const probeFn = async () => { calls++; return calls === 1 ? { classification: 'HTTP_429' } : { classification: 'NONE' }; };
    const start = Date.now();
    await withProbeRetry(probeFn, { retryClasses: new Set(['HTTP_429']), delayMs: 50 });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 45, `expected at least ~50ms delay before the retry, got ${elapsed}ms`);
  });

  it('calls onRetry with the first (retryable) result before waiting', async () => {
    let onRetryArg = null;
    let calls = 0;
    const probeFn = async () => { calls++; return calls === 1 ? { classification: 'HTTP_429', httpStatus: 429 } : { classification: 'NONE' }; };
    await withProbeRetry(probeFn, {
      retryClasses: new Set(['HTTP_429']),
      delayMs: 0,
      onRetry: (first) => { onRetryArg = first; },
    });
    assert.deepEqual(onRetryArg, { classification: 'HTTP_429', httpStatus: 429 });
  });

  it('is a no-op pass-through when retryClasses is omitted entirely', async () => {
    let calls = 0;
    const probeFn = async () => { calls++; return { classification: 'HTTP_429' }; };
    const result = await withProbeRetry(probeFn, { delayMs: 0 });
    assert.equal(calls, 1);
    assert.equal(result.classification, 'HTTP_429');
  });
});
