// One retry-after-backoff wrapper for a bot-protection probe, scoped to
// only the classifications where retrying the same target might actually
// help. Extracted from standalone.js so the retry/backoff behavior itself
// (does it retry exactly once? does it skip retrying for a non-retryable
// class? does it wait before retrying?) has a real unit test, without
// needing a live HTTP probe.
//
// See probeDealerBotProtectionWithRetry in standalone.js for the real
// production evidence behind this: a real-night audit (box2 core,
// 2026-09-22) found only 23 dealers fleet-wide skipped for HTTP_429
// specifically — the "you're going too fast, try again later" class — out
// of ~1,900 skipped total. One retry after a real wait costs a box roughly
// 20 minutes total across a whole night's run, trivial against the 23-24h
// SLA.
export async function withProbeRetry(probeFn, { retryClasses, delayMs, onRetry } = {}) {
  const first = await probeFn();
  if (!retryClasses || !retryClasses.has(first.classification)) return first;
  if (onRetry) onRetry(first);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return probeFn();
}
