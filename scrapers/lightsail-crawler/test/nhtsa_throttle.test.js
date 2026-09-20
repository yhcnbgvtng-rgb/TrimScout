import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// throttleNhtsaRequest reads CRAWLER_NHTSA_MAX_PER_SECOND once at module
// load (same pattern as CRAWLER_BRAND_SET in nj_policy.js) — cache-bust the
// import so this test can set a fast, deterministic rate instead of the
// production default.
async function loadEnricher(maxPerSecond) {
  const prev = process.env.CRAWLER_NHTSA_MAX_PER_SECOND;
  process.env.CRAWLER_NHTSA_MAX_PER_SECOND = String(maxPerSecond);
  try {
    return await import(`../src/enricher.js?t=${Date.now()}-${Math.random()}`);
  } finally {
    if (prev === undefined) delete process.env.CRAWLER_NHTSA_MAX_PER_SECOND;
    else process.env.CRAWLER_NHTSA_MAX_PER_SECOND = prev;
  }
}

// ---------------------------------------------------------------------
// Real bug this guards against: NHTSA's vPIC edge enforces an undocumented
// per-IP REQUEST RATE limit, confirmed live 2026-09-20 — a sustained run
// failed after ~135 requests regardless of concurrency level. Without a
// real rate limiter (just a concurrency cap), N workers all firing at once
// blow straight through any request-rate ceiling even at low concurrency.
// This proves the throttle actually enforces real wall-clock spacing
// between requests, not just "waits its turn in a queue" with no real
// pacing.
// ---------------------------------------------------------------------
describe('throttleNhtsaRequest (NHTSA rate limiting)', () => {
  it('serializes N calls to real minimum spacing — 10 calls at 5/sec take at least ~1.8s, not ~0s', async () => {
    const { throttleNhtsaRequest } = await loadEnricher(5);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => throttleNhtsaRequest()));
    const elapsed = Date.now() - t0;
    // 10 calls at 5/sec = 9 gaps of 200ms = 1800ms minimum. Generous lower
    // bound (1500ms) to avoid timer-jitter flakiness; the real point is
    // "not instant", and 10 calls with no throttle at all complete in <5ms.
    assert.ok(elapsed >= 1500, `expected >=1500ms of real spacing across 10 calls at 5/sec, got ${elapsed}ms`);
  });

  it('never lets more than maxPerSecond calls resolve within any 1-second window', async () => {
    const { throttleNhtsaRequest } = await loadEnricher(4);
    const resolvedAt = [];
    await Promise.all(Array.from({ length: 12 }, async () => {
      await throttleNhtsaRequest();
      resolvedAt.push(Date.now());
    }));
    resolvedAt.sort((a, b) => a - b);
    // Sliding-window check: for every timestamp, count how many resolved
    // within the following 1000ms — none should exceed maxPerSecond (+1
    // for boundary slack, since slot scheduling isn't a strict sliding
    // window but a fixed-interval schedule).
    for (let i = 0; i < resolvedAt.length; i++) {
      const windowEnd = resolvedAt[i] + 1000;
      const countInWindow = resolvedAt.filter((t) => t >= resolvedAt[i] && t < windowEnd).length;
      assert.ok(countInWindow <= 5, `expected <=5 calls to resolve within 1s of ${resolvedAt[i]}, got ${countInWindow}`);
    }
  });

  it('a low-rate config genuinely paces slower than a higher-rate config for the same call count', async () => {
    const slow = await loadEnricher(2);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => slow.throttleNhtsaRequest()));
    const slowElapsed = Date.now() - t0;

    const fast = await loadEnricher(20);
    const t1 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => fast.throttleNhtsaRequest()));
    const fastElapsed = Date.now() - t1;

    assert.ok(slowElapsed > fastElapsed, `expected the 2/sec config (${slowElapsed}ms) to be slower than the 20/sec config (${fastElapsed}ms)`);
  });
});
