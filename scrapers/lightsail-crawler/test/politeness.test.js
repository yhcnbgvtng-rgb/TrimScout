import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRetryAfter, backoffDelayMs, domainKey, DomainGate, DomainHaltedError, politeRequest, pMapStoppable,
  nameStem, clusterDealers, spreadSchedule,
} from '../src/politeness.js';

// A fake clock: sleep() advances time instead of waiting, so the whole file runs in milliseconds.
function fakeClock() {
  const c = { t: 1_000_000, slept: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.slept.push(ms); c.t += ms; };
  return c;
}
const res = (statusCode, headers = {}, body = '') => ({ statusCode, headers, body });
const classifyLike = (r) => (r.statusCode === 403 ? 'HTTP_403' : r.body === 'cf' ? 'CLOUDFLARE' : 'NONE');

describe('parseRetryAfter', () => {
  it('reads delta-seconds, HTTP dates, and rejects garbage', () => {
    assert.equal(parseRetryAfter('30'), 30_000);
    assert.equal(parseRetryAfter('1.5'), 1500);
    assert.equal(parseRetryAfter(['7']), 7000);
    assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 30_000);
    assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:00:00 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 0, 'a date in the past is 0, never negative');
    assert.equal(parseRetryAfter('soon'), null);
    assert.equal(parseRetryAfter(''), null);
    assert.equal(parseRetryAfter(undefined), null);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt, jitters within [exp/2, exp], and respects the cap', () => {
    assert.equal(backoffDelayMs(0, { baseMs: 1000, random: () => 0 }), 500);
    assert.equal(backoffDelayMs(0, { baseMs: 1000, random: () => 1 }), 1000);
    assert.equal(backoffDelayMs(3, { baseMs: 1000, random: () => 1 }), 8000);
    assert.equal(backoffDelayMs(20, { baseMs: 1000, capMs: 60_000, random: () => 1 }), 60_000);
    for (let i = 0; i < 50; i++) {
      const d = backoffDelayMs(2, { baseMs: 1000 });
      assert.ok(d >= 2000 && d <= 4000, `jitter out of range: ${d}`);
    }
  });
  it('actually varies (not a fixed delay)', () => {
    const seen = new Set(Array.from({ length: 30 }, () => backoffDelayMs(4, { baseMs: 1000 })));
    assert.ok(seen.size > 5);
  });
});

describe('domainKey', () => {
  it('collapses hosts to the site', () => {
    assert.equal(domainKey('https://www.PerformanceFord.com/new'), 'performanceford.com');
    assert.equal(domainKey('inventory.nelsonmazdaok.com'), 'nelsonmazdaok.com');
    assert.equal(domainKey('nelsonmazdaok.com:8443'), 'nelsonmazdaok.com');
    assert.equal(domainKey('dealer.example.co.uk'), 'example.co.uk');
    assert.equal(domainKey(''), '');
  });
});

describe('DomainGate', () => {
  it('never exceeds the per-domain concurrency cap, but different domains do not share it', async () => {
    const gate = new DomainGate({ maxConcurrent: 2, minGapMs: 0 });
    let live = 0; let peak = 0; const liveBy = { a: 0, b: 0 }; const peakBy = { a: 0, b: 0 };
    const task = (d) => gate.run(d, async () => {
      live++; liveBy[d]++; peak = Math.max(peak, live); peakBy[d] = Math.max(peakBy[d], liveBy[d]);
      await new Promise((r) => setTimeout(r, 5));
      live--; liveBy[d]--;
    });
    await Promise.all([...Array(6).fill('a'), ...Array(6).fill('b')].map(task));
    assert.equal(peakBy.a, 2);
    assert.equal(peakBy.b, 2);
    assert.equal(peak, 4, 'two domains may run in parallel with each other');
  });

  it('spaces request starts on a domain by minGapMs', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ maxConcurrent: 1, minGapMs: 200, now: c.now, sleep: c.sleep });
    const starts = [];
    for (let i = 0; i < 3; i++) await gate.run('x.com', async () => { starts.push(c.now()); });
    assert.equal(starts[1] - starts[0], 200);
    assert.equal(starts[2] - starts[1], 200);
  });

  it('slowDown pauses the domain and halves its concurrency (floor 1)', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ maxConcurrent: 4, minGapMs: 0, now: c.now, sleep: c.sleep });
    gate.slowDown('x.com', 5000);
    assert.equal(gate.limitOf('x.com'), 2);
    const t0 = c.now();
    await gate.run('x.com', async () => {});
    assert.ok(c.now() - t0 >= 5000, 'the next request waits out the cooldown');
    gate.slowDown('x.com', 10); gate.slowDown('x.com', 10); gate.slowDown('x.com', 10);
    assert.equal(gate.limitOf('x.com'), 1);
  });

  it('halt is sticky, first reason wins, and fires onHalt once', () => {
    const seen = [];
    const gate = new DomainGate({ onHalt: (d, r) => seen.push([d, r]) });
    assert.equal(gate.halt('x.com', 'HTTP_403'), true);
    assert.equal(gate.halt('x.com', 'HTTP_429'), false);
    assert.equal(gate.isHalted('x.com'), 'HTTP_403');
    assert.deepEqual(seen, [['x.com', 'HTTP_403']]);
    assert.deepEqual(gate.haltedDomains(), [{ domain: 'x.com', reason: 'HTTP_403' }]);
  });
});

describe('politeRequest — 429', () => {
  const base = (c, gate, doFetch, extra = {}) => politeRequest({ gate, url: 'https://x.com/a', doFetch, classify: classifyLike, now: c.now, sleep: c.sleep, backoff: { random: () => 1 }, ...extra });

  it('honours Retry-After when it is longer than the backoff, then succeeds', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    const replies = [res(429, { 'retry-after': '30' }), res(200, {}, 'ok')];
    const out = await base(c, gate, async () => replies.shift());
    assert.equal(out.statusCode, 200);
    assert.ok(c.slept.includes(30_000), `expected a 30s wait, slept ${c.slept}`);
    assert.equal(out.polite.retries, 1);
    assert.equal(gate.isHalted('x.com'), null);
    assert.equal(gate.limitOf('x.com'), 2, 'concurrency halved after a 429');
  });

  it('uses the jittered exponential backoff when there is no Retry-After, growing per attempt', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    const replies = [res(429), res(429), res(200)];
    await base(c, gate, async () => replies.shift(), { backoff: { baseMs: 1000, random: () => 1 } });
    const waits = c.slept.filter((ms) => ms >= 1000);
    assert.deepEqual(waits.slice(0, 2), [1000, 2000]);
  });

  it('pauses OTHER workers on the domain too, not just the caller', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ maxConcurrent: 4, minGapMs: 0, now: c.now, sleep: c.sleep });
    gate.slowDown('x.com', 8000);
    const t0 = c.now();
    await gate.run('x.com', async () => {});
    assert.ok(c.now() - t0 >= 8000);
  });

  it('gives the store up after max retries: halts as HTTP_429 and stops sending', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    let calls = 0;
    const out = await base(c, gate, async () => { calls++; return res(429); }, { max429Retries: 2 });
    assert.equal(calls, 3, '1 try + 2 retries');
    assert.equal(out.polite.haltedAs, 'HTTP_429');
    assert.equal(gate.isHalted('x.com'), 'HTTP_429');
    await assert.rejects(() => base(c, gate, async () => { calls++; return res(200); }), DomainHaltedError);
    assert.equal(calls, 3, 'no request after the halt');
  });

  it('halts at once when Retry-After is longer than the cap (does not sleep on a worker for an hour)', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    let calls = 0;
    const out = await base(c, gate, async () => { calls++; return res(429, { 'retry-after': '3600' }); }, { maxWaitMs: 120_000 });
    assert.equal(calls, 1);
    assert.equal(out.polite.haltedAs, 'HTTP_429');
    assert.equal(c.slept.length, 0);
  });

  it('never waits longer than maxWaitMs per retry', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    const replies = [res(429, { 'retry-after': '100' }), res(200)];
    await base(c, gate, async () => replies.shift(), { maxWaitMs: 120_000 });
    assert.ok(Math.max(...c.slept) <= 120_000);
  });
});

describe('politeRequest — 403 and WAF walls: log, stop, no bypass', () => {
  it('a 403 is returned once, never retried, and halts the domain', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    const logs = [];
    let calls = 0;
    const out = await politeRequest({ gate, url: 'https://x.com/a', doFetch: async () => { calls++; return res(403); }, classify: classifyLike, now: c.now, sleep: c.sleep, log: (m) => logs.push(m) });
    assert.equal(calls, 1);
    assert.equal(out.statusCode, 403);
    assert.equal(out.polite.haltedAs, 'HTTP_403');
    assert.equal(c.slept.length, 0, 'no waiting, no retry');
    assert.match(logs.join('\n'), /halting this domain.*no bypass/);
    await assert.rejects(() => politeRequest({ gate, url: 'https://www.x.com/b', doFetch: async () => { calls++; return res(200); } }), (e) => e.code === 'DOMAIN_HALTED' && e.reason === 'HTTP_403');
    assert.equal(calls, 1, 'a different URL on the same site sends nothing');
  });

  it('a Cloudflare challenge served as a 200 or 503 also halts without a retry', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    let calls = 0;
    const out = await politeRequest({ gate, url: 'https://y.com/', doFetch: async () => { calls++; return res(503, {}, 'cf'); }, classify: classifyLike, now: c.now, sleep: c.sleep });
    assert.equal(calls, 1, 'a challenge 503 is not retried like an ordinary 5xx');
    assert.equal(out.polite.haltedAs, 'CLOUDFLARE');
  });

  it('a halt on one domain leaves other domains alone', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    await politeRequest({ gate, url: 'https://x.com/', doFetch: async () => res(403), classify: classifyLike, now: c.now, sleep: c.sleep });
    const ok = await politeRequest({ gate, url: 'https://z.com/', doFetch: async () => res(200, {}, 'hi'), classify: classifyLike, now: c.now, sleep: c.sleep });
    assert.equal(ok.statusCode, 200);
  });
});

describe('politeRequest — 5xx and transport errors', () => {
  it('retries a 5xx once with a jittered wait, and never halts for it', async () => {
    const c = fakeClock();
    const gate = new DomainGate({ minGapMs: 0, now: c.now, sleep: c.sleep });
    let calls = 0;
    const out = await politeRequest({ gate, url: 'https://x.com/', doFetch: async () => { calls++; return res(502); }, classify: classifyLike, now: c.now, sleep: c.sleep });
    assert.equal(calls, 2);
    assert.equal(out.statusCode, 502);
    assert.equal(gate.isHalted('x.com'), null);
  });
  it('propagates a transport error untouched', async () => {
    const gate = new DomainGate({ minGapMs: 0 });
    await assert.rejects(() => politeRequest({ gate, url: 'https://x.com/', doFetch: async () => { throw new Error('ECONNRESET'); } }), /ECONNRESET/);
  });
});

describe('pMapStoppable', () => {
  it('runs everything when nothing stops it', async () => {
    const seen = [];
    const ran = await pMapStoppable([1, 2, 3, 4, 5], async (x) => { seen.push(x); }, 2);
    assert.equal(ran, 5);
    assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
  });
  it('stops handing out work once shouldStop flips (a halted store), and swallows a failing item', async () => {
    let stop = false; const seen = [];
    const ran = await pMapStoppable(Array.from({ length: 50 }, (_, i) => i), async (x) => {
      seen.push(x);
      if (x === 3) throw new Error('boom');
      if (x === 5) stop = true;
    }, 1, () => stop);
    assert.equal(ran, 6);
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
  });
});

describe('schedule spreading', () => {
  const store = (name, domain, extra = {}) => ({ name, domain, ...extra });
  const adjacentSameCluster = (list) => {
    const ids = clusterDealers(list);
    let n = 0; for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) n++;
    return n;
  };

  it('nameStem picks the distinctive word and ignores makes and filler', () => {
    assert.equal(nameStem('Performance Ford Randolph'), 'performance');
    assert.equal(nameStem('NELSON MAZDA NORMAN'), 'nelson');
    assert.equal(nameStem('Bob Moore Mazda'), 'moore');
    assert.equal(nameStem('Ford of Hope'), 'hope');
    assert.equal(nameStem('Kia'), '');
  });

  it('clusters by explicit group, shared site, or shared name stem', () => {
    const list = [
      store('Nelson Mazda', 'nelsonmazdaok.com'), store('Nelson Mazda Norman', 'nelsonmazdanorman.com'),
      store('Bob Moore Mazda', 'bobmooremazda.com'), store('SW Mazda', 'swmazda.com', { group: 'sw' }), store('Other SW', 'othersw.com', { group: 'SW' }),
      store('Alpha Honda', 'shared.com'), store('Beta Toyota', 'www.shared.com'),
    ];
    const id = clusterDealers(list);
    assert.equal(id[0], id[1], 'same name stem');
    assert.notEqual(id[0], id[2]);
    assert.equal(id[3], id[4], 'same group, case-insensitive');
    assert.equal(id[5], id[6], 'same registrable domain');
  });

  it('does not leave same-group stores back to back when there is anything else to put between them', () => {
    const list = [
      store('Performance Ford Randolph', 'pf1.com'), store('Performance Ford East Hanover', 'pf2.com'), store('Performance Ford Somerville', 'pf3.com'),
      store('Alpha Chevrolet', 'a.com'), store('Bravo Chevrolet', 'b.com'), store('Charlie Chevrolet', 'c.com'), store('Delta Chevrolet', 'd.com'), store('Echo Chevrolet', 'e.com'),
    ];
    const out = spreadSchedule(list, { minGap: 2 });
    assert.equal(adjacentSameCluster(out), 0);
    const pos = out.map((d, i) => (d.name.startsWith('Performance') ? i : -1)).filter((i) => i >= 0);
    assert.ok(pos[1] - pos[0] >= 2 && pos[2] - pos[1] >= 2, `Performance stores at ${pos}`);
  });

  it('keeps every store exactly once, and is deterministic', () => {
    const list = Array.from({ length: 40 }, (_, i) => store(`Group${i % 4} Motors ${i}`, `s${i}.com`));
    const a = spreadSchedule(list); const b = spreadSchedule(list);
    assert.deepEqual(a.map((d) => d.name), b.map((d) => d.name));
    assert.deepEqual(a.map((d) => d.name).sort(), list.map((d) => d.name).sort());
  });

  it('degrades gracefully when one group is most of the list (adjacent only when unavoidable)', () => {
    const list = [store('Same Auto 1', 'a1.com'), store('Same Auto 2', 'a2.com'), store('Same Auto 3', 'a3.com'), store('Lone Honda', 'l.com')];
    const out = spreadSchedule(list);
    assert.equal(out.length, 4);
    assert.ok(adjacentSameCluster(out) <= 1);
  });

  it('leaves tiny lists and an empty list alone', () => {
    assert.deepEqual(spreadSchedule([]), []);
    const two = [store('A One', 'a.com'), store('A Two', 'a.com')];
    assert.deepEqual(spreadSchedule(two), two);
  });

  it('the OK Mazda roster keeps both Nelson stores apart from each other', () => {
    const ok = [store('BOB MOORE MAZDA', 'bobmooremazda.com'), store('NELSON MAZDA', 'nelsonmazdaok.com'), store('NELSON MAZDA NORMAN', 'nelsonmazdanorman.com'), store('SOUTHWEST MAZDA', 'swmazda.com')];
    const out = spreadSchedule(ok, { minGap: 2 });
    const i = out.findIndex((d) => d.name === 'NELSON MAZDA'); const j = out.findIndex((d) => d.name === 'NELSON MAZDA NORMAN');
    assert.ok(Math.abs(i - j) >= 2, `Nelson stores at ${i} and ${j}`);
  });
});

// standalone.js is a top-level script (importing it starts a crawl), so its wiring is pinned from source, like the other seam tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
describe('standalone.js wiring (source pins)', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'standalone.js'), 'utf-8');
  it('every plain-HTTP dealer request goes through the gate: gotScraping( appears only inside the two gated helpers', () => {
    assert.equal((src.match(/gotScraping\(/g) || []).length, 2);
    assert.match(src, /politeGot\(sitemapUrl/);
    assert.match(src, /politeGot\(`https:\/\/\$\{host/);
  });
  it('a wall stops the store: no patchright fallback and no further URL fetches once politeWall is set', () => {
    assert.match(src, /if \(politeWall\) \{[\s\S]*?continue;\s*\}\s*if \(vehicleUrls\.length === 0 && process\.env\.CRAWLER_PATCHRIGHT_FALLBACK/);
    assert.match(src, /pMapStoppable\(pageUrls, extractOne, PAGE_WORKERS, \(\) => politeWall !== null/);
  });
  it('the wall/backoff log lines keep the formats the sweep guard parses', () => {
    const guard = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'box', 'syncSweepGuard.js'), 'utf-8');
    const skipRe = new RegExp(/const SKIP_RE = \/(.*)\/;/.exec(guard)[1]);
    const retryRe = new RegExp(/const RETRY_RE = \/(.*)\/;/.exec(guard)[1]);
    assert.ok(skipRe.exec('   🛡️ SKIP Performance Ford Randolph: HTTP_403 (403) — halted for the night, no bypass, no retry [https://performanceford.com/new]'));
    assert.ok(retryRe.exec('   ⏳ Fred Beans Acura of Abington: HTTP_429 — waiting 30s (Retry-After 30s), then retrying [fredbeans.com]'));
    assert.match(src, /🛡️ SKIP \$\{politeStoreName \|\| evt\.domain\}: \$\{evt\.cls\}/);
    assert.match(src, /⏳ \$\{politeStoreName \|\| evt\.domain\}: \$\{evt\.cls\} — waiting/);
  });
});
