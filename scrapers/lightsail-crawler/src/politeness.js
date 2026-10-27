// Crawl politeness: per-domain rate limiting, 429 backoff, and the "a wall means stop" rule. Pure + injectable clock/sleep/random
// so every branch is unit-tested without a network (test/politeness.test.js).
//
// The rules, in order of importance:
//   1. A 403 / Cloudflare / Vercel challenge is a WALL. It is logged and the whole domain is halted for the rest of this process
//      (one process = one night's shard): no retry, no second request, no browser fallback. Nothing here works around a WAF.
//   2. A 429 means "slower". Wait max(Retry-After, jittered exponential backoff), pause EVERY worker on that domain for that long,
//      halve the domain's concurrency for the rest of the night, retry a bounded number of times, then give the store up
//      (halted as HTTP_429) rather than keep hitting it.
//   3. A 5xx gets one jittered retry; it never halts the domain.
//   4. At most `maxConcurrent` requests are in flight per domain, spaced `minGapMs` apart.
//
// Retry-After is honoured up to `maxWaitMs`; a longer ask halts the store (we do not sit on a worker for an hour).

/** Retry-After header -> milliseconds. Accepts delta-seconds or an HTTP date; null when absent/garbage. Never negative. */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return null;
  const raw = String(Array.isArray(value) ? value[0] : value).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** Exponential backoff with jitter: attempt 0,1,2... -> a delay in [exp/2, exp], exp = min(cap, base * 2^attempt). */
export function backoffDelayMs(attempt, { baseMs = 2000, capMs = 60_000, random = Math.random } = {}) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
}

const TWO_LEVEL_TLDS = new Set(['co.uk', 'com.au', 'co.nz', 'com.mx', 'co.jp', 'org.uk', 'com.br']);

/** Site identity for rate limiting: lower-cased host, no www./port, collapsed to registrable domain (dealer.sub.example.com -> example.com). */
export function domainKey(urlOrHost) {
  if (!urlOrHost) return '';
  let host = String(urlOrHost).trim().toLowerCase();
  try { host = new URL(/^[a-z]+:\/\//.test(host) ? host : `https://${host}`).hostname; } catch { /* keep as given */ }
  host = host.replace(/^www\./, '').replace(/:\d+$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL_TLDS.has(last2) ? parts.slice(-3).join('.') : last2;
}

/** Thrown for a request to a domain that already hit a wall tonight. No network call was made. */
export class DomainHaltedError extends Error {
  constructor(domain, reason) {
    super(`${domain} halted for the night (${reason})`);
    this.name = 'DomainHaltedError';
    this.code = 'DOMAIN_HALTED';
    this.domain = domain;
    this.reason = reason;
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-domain gate. `run(domain, fn)` waits for: the domain's cooldown, a free slot (<= current limit in flight), and the minimum gap
 * since the last request started on that domain — then runs fn. FIFO per domain.
 */
export class DomainGate {
  constructor({ maxConcurrent = 4, minGapMs = 150, now = Date.now, sleep = realSleep, onHalt = null } = {}) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.minGapMs = Math.max(0, minGapMs);
    this.now = now;
    this.sleep = sleep;
    this.onHalt = onHalt;
    this.state = new Map();
  }

  _s(domain) {
    let s = this.state.get(domain);
    if (!s) { s = { limit: this.maxConcurrent, inFlight: 0, nextStart: 0, cooldownUntil: 0, halted: null, waiters: [] }; this.state.set(domain, s); }
    return s;
  }

  isHalted(domain) { return this._s(domain).halted; }
  limitOf(domain) { return this._s(domain).limit; }
  haltedDomains() { return [...this.state].filter(([, s]) => s.halted).map(([d, s]) => ({ domain: d, reason: s.halted })); }

  /** Stop all further requests to the domain for the life of this gate. First reason wins. */
  halt(domain, reason) {
    const s = this._s(domain);
    if (s.halted) return false;
    s.halted = reason;
    if (this.onHalt) this.onHalt(domain, reason);
    return true;
  }

  /** Nothing starts on this domain for ms (extends, never shortens), and the domain's concurrency is halved (floor 1). */
  slowDown(domain, ms) {
    const s = this._s(domain);
    s.cooldownUntil = Math.max(s.cooldownUntil, this.now() + ms);
    s.limit = Math.max(1, Math.floor(s.limit / 2));
  }

  async run(domain, fn) {
    const s = this._s(domain);
    await this._acquire(s);
    try { return await fn(); } finally { s.inFlight--; this._wake(s); }
  }

  async _acquire(s) {
    // FIFO: wait for our turn at the head, then for slot / cooldown / gap.
    const ticket = {};
    s.waiters.push(ticket);
    for (;;) {
      if (s.waiters[0] === ticket && s.inFlight < s.limit) {
        const wait = Math.max(s.cooldownUntil, s.nextStart) - this.now();
        if (wait <= 0) break;
        await this.sleep(wait);
        continue;
      }
      await new Promise((resolve) => { ticket.wake = resolve; });
    }
    s.waiters.shift();
    s.inFlight++;
    s.nextStart = this.now() + this.minGapMs;
    this._wake(s);
  }

  _wake(s) { const head = s.waiters[0]; if (head && head.wake) { const w = head.wake; head.wake = null; w(); } }
}

const WALL_CLASSES = new Set(['CLOUDFLARE', 'VERCEL_CHECKPOINT', 'HTTP_403']);

/**
 * One polite GET. `doFetch()` returns { statusCode, headers, body } (a thrown HTTPError with .response is unwrapped by the caller's
 * doFetch). `classify(res)` -> bot class string (the crawler passes classifyFetchResult). Returns the final response with
 * `res.polite = { retries, waitedMs, haltedAs }`. Throws DomainHaltedError when the domain was already halted (no request sent);
 * transport errors from doFetch propagate untouched.
 */
export async function politeRequest({
  gate, url, doFetch, classify = () => 'NONE', domain = domainKey(url),
  max429Retries = 3, max5xxRetries = 1, maxWaitMs = 120_000, backoff = {}, now = Date.now, sleep = realSleep, log = () => {},
}) {
  let retries429 = 0;
  let retries5xx = 0;
  let waitedMs = 0;
  for (;;) {
    const halted = gate.isHalted(domain);
    if (halted) throw new DomainHaltedError(domain, halted);
    const res = await gate.run(domain, doFetch);
    const status = Number(res.statusCode) || 0;
    const cls = classify(res);
    const done = (haltedAs = null) => { res.polite = { retries: retries429 + retries5xx, waitedMs, haltedAs }; return res; };

    if (WALL_CLASSES.has(cls) || status === 403) {
      const reason = WALL_CLASSES.has(cls) ? cls : 'HTTP_403';
      gate.halt(domain, reason);
      log(`🛑 ${domain}: ${reason} (HTTP ${status}) — halting this domain for the night, no bypass [${url}]`, { kind: 'halt', domain, cls: reason, status, url });
      return done(reason);
    }
    if (status === 429) {
      const asked = parseRetryAfter(res.headers && (res.headers['retry-after'] ?? res.headers.get?.('retry-after')), now());
      if ((asked != null && asked > maxWaitMs) || retries429 >= max429Retries) {
        gate.halt(domain, 'HTTP_429');
        log(`🛑 ${domain}: HTTP 429 ${asked != null && asked > maxWaitMs ? `Retry-After ${Math.round(asked / 1000)}s exceeds the ${Math.round(maxWaitMs / 1000)}s cap` : `still 429 after ${retries429} retr${retries429 === 1 ? 'y' : 'ies'}`} — halting this domain for the night [${url}]`, { kind: 'halt', domain, cls: 'HTTP_429', status, url });
        return done('HTTP_429');
      }
      const wait = Math.min(maxWaitMs, Math.max(asked ?? 0, backoffDelayMs(retries429, backoff)));
      retries429++;
      gate.slowDown(domain, wait);
      log(`⏳ ${domain}: HTTP 429 — waiting ${Math.round(wait / 1000)}s${asked != null ? ` (Retry-After ${Math.round(asked / 1000)}s)` : ''}, concurrency now ${gate.limitOf(domain)}, retry ${retries429}/${max429Retries}`, { kind: 'wait', domain, cls: 'HTTP_429', status, waitMs: wait, retryAfterMs: asked, url });
      await sleep(wait);
      waitedMs += wait;
      continue;
    }
    if (status >= 500 && status < 600 && retries5xx < max5xxRetries) {
      const wait = backoffDelayMs(retries5xx, { ...backoff, baseMs: backoff.baseMs ?? 2000 });
      retries5xx++;
      await sleep(wait);
      waitedMs += wait;
      continue;
    }
    return done();
  }
}

/** Like a worker-pool map, but workers stop picking up items once shouldStop() is true (a halted store). Returns how many items ran. */
export async function pMapStoppable(items, mapper, concurrency, shouldStop = () => false) {
  let cursor = 0;
  let ran = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length && !shouldStop()) {
      const idx = cursor++;
      ran++;
      try { await mapper(items[idx], idx); } catch { /* one URL failing never stops the store */ }
    }
  });
  await Promise.allSettled(workers);
  return ran;
}

// ---- schedule spreading -------------------------------------------------------------------------------------------------

const GENERIC_NAME_WORDS = new Set([
  'the', 'of', 'and', 'auto', 'automotive', 'motors', 'motor', 'cars', 'car', 'group', 'sales', 'new', 'used', 'north', 'south', 'east', 'west',
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy', 'chrysler', 'dodge', 'ford', 'genesis', 'gmc', 'honda', 'hyundai', 'infiniti',
  'jeep', 'kia', 'lexus', 'lincoln', 'mazda', 'mercedes', 'mercedes-benz', 'mini', 'mitsubishi', 'nissan', 'porsche', 'ram', 'subaru', 'toyota',
  'volkswagen', 'vw', 'volvo', 'stellantis', 'cdjr', 'fiat', 'alfa', 'romeo',
]);

/** First distinctive word of a store name ("Performance Ford Randolph" -> "performance"); '' when nothing distinctive. */
export function nameStem(name) {
  for (const w of String(name || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (w.length >= 4 && !GENERIC_NAME_WORDS.has(w)) return w;
  }
  return '';
}

/**
 * Cluster stores that are probably one operator: same explicit `group`/`dealerGroup`, same site (registrable domain), or same
 * distinctive first name word. Over-grouping only costs a little re-ordering; under-grouping is what gets a group rate-limited.
 * Returns an array of cluster ids parallel to `dealers`.
 */
export function clusterDealers(dealers) {
  const parent = dealers.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  const join = (key, i) => { if (!key) return; if (seen.has(key)) parent[find(i)] = find(seen.get(key)); else seen.set(key, i); };
  dealers.forEach((d, i) => {
    join(d.group || d.dealerGroup ? `g:${String(d.group || d.dealerGroup).toLowerCase()}` : '', i);
    join(d.domain ? `d:${domainKey(d.domain)}` : '', i);
    join(nameStem(d.name) ? `n:${nameStem(d.name)}` : '', i);
  });
  return dealers.map((_, i) => find(i));
}

/**
 * Reorder so stores of one cluster are as far apart as possible (never adjacent unless a cluster is more than half the list).
 * Deterministic: each step takes the cluster that has waited longest since it last ran (>= minGap slots ago when any exists),
 * largest remaining cluster first on ties, original order within a cluster. Same members in, same members out.
 */
export function spreadSchedule(dealers, { minGap = 3 } = {}) {
  if (dealers.length < 3) return dealers.slice();
  const ids = clusterDealers(dealers);
  const queues = new Map();
  dealers.forEach((d, i) => { if (!queues.has(ids[i])) queues.set(ids[i], []); queues.get(ids[i]).push(d); });
  const lastAt = new Map();
  const out = [];
  while (out.length < dealers.length) {
    const live = [...queues].filter(([, q]) => q.length);
    const rested = live.filter(([id]) => !lastAt.has(id) || out.length - lastAt.get(id) >= minGap);
    const pool = rested.length ? rested : live;
    pool.sort(([ia, a], [ib, b]) => b.length - a.length || (lastAt.get(ia) ?? -1) - (lastAt.get(ib) ?? -1));
    const [id, q] = rested.length ? pool[0] : [...pool].sort(([ia], [ib]) => (lastAt.get(ia) ?? -1) - (lastAt.get(ib) ?? -1))[0];
    out.push(q.shift());
    lastAt.set(id, out.length - 1);
  }
  return out;
}
