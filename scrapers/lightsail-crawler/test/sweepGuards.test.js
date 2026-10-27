// The sweep guards, end to end: the sync client (syncSweepGuard.js, syncSweep.js, syncRun.js) talking to the deals API's sweep module (inventorySweep.js)
// over a model of dealer_inventory. The examples are the ones from the 2026-10-27 audit of box2's 81,268 retirements:
//   - Fred Beans Acura of Abington (store 5100): 2,125 cars, a 429 retry on the crawl, 279 extracted -> 1,888 "retired"
//   - Blaise Alexander Hyundai (State College, 12225) / Hyundai of Altoona: one group inventory, the VINs flip to whichever site crawled cleanly
//   - VIN 1FTFW1RG9TFC24061 at Performance Ford of Somerville (1122) / East Hanover (1140) / Randolph (1142)
//
// HONEST LIMIT: nothing here runs SQL. FakeInventory below interprets each statement the way MariaDB is meant to (it reads the statement's shape and its
// args in placeholder order, and fails the test if they do not line up), so these tests prove the RULES and the request/response contract, not that
// MariaDB accepts the text. STEPS.md has the EXPLAIN UPDATE check that covers the second part before anything is enabled.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSweepRequest, runSweepRequest, buildSweepStatement, buildMissStatements, buildFreshnessCountsStatement, partialCrawlStores,
} from '../src/inventorySweep.js';
import { runSweep, SweepAbortError } from '../../../scripts/box/syncSweep.js';
import { runWritePhase, configFromEnv } from '../../../scripts/box/syncRun.js';
import { parseHostileLines, latestCrawlLogs, collectHostileStores, guardConfigFromEnv, isHostileClass, describeSkips, describeGuardCounts } from '../../../scripts/box/syncSweepGuard.js';

const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const toStr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const parse = (body) => parseSweepRequest(body, { toInt, toStr });

const ABINGTON = 5100;
const STATE_COLLEGE = 12225;
const ALTOONA = 12226; // the audit gives State College's id only; this one is a stand-in for the sister site
const SOMERVILLE = 1122, EAST_HANOVER = 1140, RANDOLPH = 1142;
const FORD_VIN = '1FTFW1RG9TFC24061';
const D = (s) => Date.parse(s);
const FULL = { minMisses: 2, protectElsewhere: true, minFreshRatio: 0.5, minLiveForRatio: 10 };

/** dealer_inventory as far as the sweep cares: (vin, dealerId) rows with last_seen, removed, and the miss counter. */
class FakeInventory {
  constructor() { this.rows = new Map(); this.statements = []; }
  put(vin, dealerId, lastSeen, extra = {}) { this.rows.set(`${vin}|${dealerId}`, { vin, dealerId, lastSeen, removed: false, missCount: 0, missAt: null, source: 'nightly', ...extra }); }
  upsert(vin, dealerId, now) { const r = this.rows.get(`${vin}|${dealerId}`); if (r) Object.assign(r, { lastSeen: now, removed: false }); else this.put(vin, dealerId, now); }
  get(vin, dealerId) { return this.rows.get(`${vin}|${dealerId}`); }
  live(dealerId) { return [...this.rows.values()].filter((r) => r.dealerId === dealerId && !r.removed); }
  async query(sql, args) {
    this.statements.push(sql);
    assert.equal((sql.match(/\?/g) || []).length, countArgs(args), `placeholders vs args in: ${sql}`);
    const at = (v) => (v instanceof Date ? v.getTime() : v);
    if (sql.startsWith('SELECT dealer_id AS dealerId')) {
      let i = 0; const seenAfter = at(args[i++]); const ids = args[i++]; const out = new Map();
      for (const r of this.rows.values()) {
        if (!ids.includes(r.dealerId) || r.removed) continue;
        const e = out.get(r.dealerId) || { dealerId: r.dealerId, live: 0, fresh: 0 };
        e.live++; if (r.lastSeen >= seenAfter) e.fresh++;
        out.set(r.dealerId, e);
      }
      return [[...out.values()]];
    }
    let i = 0;
    const kind = sql.includes('sweep_miss_count = 1') ? 'restart' : sql.includes('sweep_miss_count = a.sweep_miss_count + 1') || sql.includes('sweep_miss_count = sweep_miss_count + 1') ? 'inc' : 'retire';
    const setAt = kind === 'retire' ? null : at(args[i++]);
    const idArg = args[i++]; const ids = Array.isArray(idArg) ? idArg : [idArg];
    const seenAfter = at(args[i++]);
    if (sql.includes('source IN (?)')) i++;
    if (sql.includes('source_box = ?')) i += 2;
    let seenAfter2 = null, thr = null;
    if (sql.includes('sweep_miss_at < ?') || sql.includes('sweep_miss_at >= ?')) { /* trailing miss args */ }
    if (kind === 'inc' || (kind === 'retire' && sql.includes('sweep_miss_count >= ?'))) { seenAfter2 = at(args[i++]); thr = args[i++]; }
    assert.equal(i, countArgs(args), `every arg consumed for: ${sql}`);
    const protect = sql.includes('LEFT JOIN dealer_inventory o');
    assert.equal(protect, sql.includes('AND o.vin IS NULL'), 'the protect join only protects together with its o.vin IS NULL filter');
    const streak = (r) => r.missAt != null && r.lastSeen < r.missAt;
    if (protect) assert.ok(sql.includes('o.removed_at IS NULL AND o.last_seen_at > a.last_seen_at') && sql.includes('o.dealer_id <> a.dealer_id'), 'protection = live, other store, fresher');
    const candidates = [...this.rows.values()].filter((r) => ids.includes(r.dealerId) && !r.removed && r.lastSeen < seenAfter
      && !(protect && [...this.rows.values()].some((o) => o.vin === r.vin && o.dealerId !== r.dealerId && !o.removed && o.lastSeen > r.lastSeen)));
    let hit = [];
    if (kind === 'retire') hit = sql.includes('sweep_miss_count >= ?') ? candidates.filter((r) => streak(r) && r.missAt < seenAfter2 && r.missCount >= thr) : candidates;
    if (kind === 'restart') hit = candidates.filter((r) => !streak(r));
    if (kind === 'inc') hit = candidates.filter((r) => streak(r) && r.missAt < seenAfter2 && r.missCount < thr);
    for (const r of hit) {
      if (kind === 'retire') r.removed = true;
      if (kind === 'restart') { r.missCount = 1; r.missAt = setAt; }
      if (kind === 'inc') { r.missCount += 1; r.missAt = setAt; }
    }
    return [{ affectedRows: hit.length }];
  }
}
const countArgs = (args) => args.length;

/** One sweep call as the deals API would answer it. */
const serve = (inv) => async (body) => {
  const parsed = parse(body);
  assert.equal(parsed.ok, true, parsed.error);
  const out = await runSweepRequest((sql, args) => inv.query(sql, args), parsed);
  return { removed: out.removed, ...(parsed.batch ? { stores: parsed.dealerIds.length } : {}), ...(out.guarded ? { counted: out.counted, skipped: out.skipped } : {}) };
};
const sweep = (inv, stores, seenAfter, extra = {}) => serve(inv)({ dealerIds: stores, seenAfter: new Date(seenAfter).toISOString(), sources: ['nightly'], ...extra });
const legacy = (inv, stores, seenAfter) => sweep(inv, stores, seenAfter);

describe('server: requests without guard fields behave exactly as before', () => {
  it('parses to no guard keys and makes the one statement it always made', async () => {
    const r = parse({ dealerIds: [1, 2], seenAfter: '2026-10-27T11:52:00Z', sources: ['nightly'] });
    for (const k of ['minMisses', 'protectElsewhere', 'minFreshRatio', 'minLiveForRatio']) assert.equal(k in r, false, k);
    const inv = new FakeInventory(); inv.put('V1', 1, D('2026-10-20T00:00:00Z'));
    const out = await runSweepRequest((s, a) => inv.query(s, a), r);
    assert.deepEqual(out, { removed: 1, counted: 0, skipped: [], guarded: false });
    assert.equal(inv.statements.length, 1);
    assert.match(inv.statements[0], /^UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id IN \(\?\)/);
    assert.doesNotMatch(inv.statements[0], /JOIN|sweep_miss/);
  });

  it('validates the new fields and ignores minMisses 1 / protectElsewhere false', () => {
    assert.match(parse({ dealerId: 1, seenAfter: '2026-10-27T00:00:00Z', minMisses: 0 }).error, /minMisses/);
    assert.match(parse({ dealerId: 1, seenAfter: '2026-10-27T00:00:00Z', minMisses: 6 }).error, /minMisses/);
    assert.match(parse({ dealerId: 1, seenAfter: '2026-10-27T00:00:00Z', protectElsewhere: 'yes' }).error, /protectElsewhere/);
    assert.match(parse({ dealerId: 1, seenAfter: '2026-10-27T00:00:00Z', minFreshRatio: 1.5 }).error, /minFreshRatio/);
    const off = parse({ dealerId: 1, seenAfter: '2026-10-27T00:00:00Z', minMisses: 1, protectElsewhere: false, minFreshRatio: 0 });
    assert.deepEqual([off.ok, 'minMisses' in off, 'protectElsewhere' in off, 'minFreshRatio' in off], [true, false, false, false]);
  });

  it('the guarded statements keep their placeholders and args aligned', () => {
    const parsed = parse({ dealerIds: [3, 4], seenAfter: '2026-10-27T11:52:00Z', sources: ['nightly'], sourceBox: 'box2', foreignBefore: '2026-10-25T11:52:00Z', ...FULL });
    for (const st of [buildSweepStatement(parsed), ...buildMissStatements(parsed), buildFreshnessCountsStatement(parsed)]) assert.equal((st.sql.match(/\?/g) || []).length, st.args.length, st.sql);
  });
});

describe('rule 1: never retire a VIN that is live at another store', () => {
  it('Blaise Alexander State College / Altoona: cars the sister site uploaded tonight stay live, a car nobody lists is still counted', async () => {
    const inv = new FakeInventory(); const T = D('2026-10-26T22:00:00Z'); const old = D('2026-10-25T09:00:00Z');
    for (const v of ['A1', 'A2', 'A3']) { inv.put(v, STATE_COLLEGE, old); inv.put(v, ALTOONA, T + 1000); } // Altoona crawled clean tonight and lists the group's cars
    inv.put('SOLD1', STATE_COLLEGE, old);                                                                    // nobody lists this one
    await sweep(inv, [STATE_COLLEGE], T, { minMisses: 1, protectElsewhere: true });
    assert.deepEqual(['A1', 'A2', 'A3'].map((v) => inv.get(v, STATE_COLLEGE).removed), [false, false, false], 'live at Altoona: untouched');
    assert.equal(inv.get('SOLD1', STATE_COLLEGE).removed, true, 'not live anywhere: retired (minMisses 1 here to isolate rule 1)');
  });

  it('VIN 1FTFW1RG9TFC24061: Somerville and East Hanover copies are not retired while Randolph has it fresher', async () => {
    const inv = new FakeInventory();
    inv.put(FORD_VIN, EAST_HANOVER, D('2026-10-17T13:00:00Z'));
    inv.put(FORD_VIN, SOMERVILLE, D('2026-10-21T13:00:00Z'));
    // 10/21 sweep of East Hanover: Somerville was uploaded that night -> East Hanover's older copy is not retired (the original sweep retired it at 10:40 on 10/21).
    await sweep(inv, [EAST_HANOVER], D('2026-10-21T13:00:00Z'), { minMisses: 1, protectElsewhere: true });
    assert.equal(inv.get(FORD_VIN, EAST_HANOVER).removed, false);
    // 10/24: Randolph uploads it, Somerville is swept (original sweep retired it at 09:59 on 10/24).
    inv.put(FORD_VIN, RANDOLPH, D('2026-10-24T13:13:00Z'));
    await sweep(inv, [SOMERVILLE], D('2026-10-24T13:00:00Z'), { minMisses: 1, protectElsewhere: true });
    assert.equal(inv.get(FORD_VIN, SOMERVILLE).removed, false);
  });

  it('the same sweep WITHOUT the guard fields retires them: this is the audit bug, kept as a regression marker', async () => {
    const inv = new FakeInventory();
    inv.put(FORD_VIN, SOMERVILLE, D('2026-10-21T13:00:00Z'));
    inv.put(FORD_VIN, RANDOLPH, D('2026-10-24T13:13:00Z'));
    await legacy(inv, [SOMERVILLE], D('2026-10-24T13:00:00Z'));
    assert.equal(inv.get(FORD_VIN, SOMERVILLE).removed, true);
  });

  it('two stale copies cannot shield each other for ever: only the older one is protected, and it goes once the newer is gone', async () => {
    const inv = new FakeInventory();
    inv.put(FORD_VIN, SOMERVILLE, D('2026-10-21T13:00:00Z'));
    inv.put(FORD_VIN, RANDOLPH, D('2026-10-24T13:00:00Z'));
    const g = { minMisses: 1, protectElsewhere: true };
    await sweep(inv, [SOMERVILLE, RANDOLPH], D('2026-10-27T11:00:00Z'), g);
    assert.deepEqual([inv.get(FORD_VIN, SOMERVILLE).removed, inv.get(FORD_VIN, RANDOLPH).removed], [false, true], 'the fresher copy is retired, the older one is protected for this run');
    await sweep(inv, [SOMERVILLE, RANDOLPH], D('2026-10-28T11:00:00Z'), g);
    assert.equal(inv.get(FORD_VIN, SOMERVILLE).removed, true, 'next run nothing shields it');
  });

  it('a retired copy elsewhere does not protect', async () => {
    const inv = new FakeInventory();
    inv.put('X', 1, D('2026-10-20T00:00:00Z')); inv.put('X', 2, D('2026-10-26T00:00:00Z'), { removed: true });
    await sweep(inv, [1], D('2026-10-27T00:00:00Z'), { minMisses: 1, protectElsewhere: true });
    assert.equal(inv.get('X', 1).removed, true);
  });
});

describe('rule 2: skip a store whose crawl hit a wall or returned a fraction of its cars', () => {
  const abington = (inv, T) => {
    for (let i = 0; i < 1888; i++) inv.put(`ABN${i}`, ABINGTON, T - 86_400_000);
    for (let i = 0; i < 279; i++) inv.put(`NEW${i}`, ABINGTON, T + 1000);
  };

  it('Fred Beans Acura of Abington: 279 fresh of 2,167 live (13%) -> the server skips it, retires nothing, counts no miss', async () => {
    const inv = new FakeInventory(); const T = D('2026-10-27T11:52:00Z'); abington(inv, T);
    const r = await sweep(inv, [ABINGTON, 9999], T, FULL);
    assert.equal(r.removed, 0);
    assert.deepEqual(r.skipped, [{ dealerId: ABINGTON, live: 2167, fresh: 279 }]);
    assert.equal(inv.live(ABINGTON).length, 2167);
    assert.equal([...inv.rows.values()].filter((x) => x.missCount > 0).length, 0, 'a skipped night is not a miss');
  });

  it('the same night WITHOUT the guard retires 1,888 cars (the audit)', async () => {
    const inv = new FakeInventory(); const T = D('2026-10-27T11:52:00Z'); abington(inv, T);
    assert.equal((await legacy(inv, [ABINGTON], T)).removed, 1888);
  });

  it('a healthy store (60% fresh) is swept normally; a tiny store and store 0 are never ratio-judged', async () => {
    const inv = new FakeInventory(); const T = D('2026-10-27T11:52:00Z');
    for (let i = 0; i < 40; i++) inv.put(`H${i}`, 1, T - 1e6);
    for (let i = 0; i < 60; i++) inv.put(`F${i}`, 1, T + 1000);
    for (let i = 0; i < 4; i++) inv.put(`T${i}`, 2, T - 1e6);
    inv.put('Z', 2, T + 1000);
    inv.put('S0', 0, T - 1e6);
    const r = await sweep(inv, [0, 1, 2], T, FULL);
    assert.deepEqual(r.skipped, []);
    assert.equal(r.counted, 40 + 4 + 1, 'stale cars of stores 1, 2 and 0 are counted (first miss), none retired');
    assert.equal(r.removed, 0);
  });

  it('partialCrawlStores: exactly 50% is fine, just under is not', () => {
    const c = [{ dealerId: 1, live: 100, fresh: 50 }, { dealerId: 2, live: 100, fresh: 49 }, { dealerId: 3, live: 9, fresh: 0 }];
    assert.deepEqual(partialCrawlStores(c, { minFreshRatio: 0.5, minLiveForRatio: 10 }), [{ dealerId: 2, live: 100, fresh: 49 }]);
  });
});

describe('rule 3: retire only after two consecutive healthy sweeps missed the car', () => {
  const g = { minMisses: 2, protectElsewhere: true };
  const night1 = D('2026-10-26T11:52:00Z'), night2 = D('2026-10-27T11:52:00Z'), night3 = D('2026-10-28T11:52:00Z');
  const base = () => { const inv = new FakeInventory(); inv.put('V', 1, D('2026-10-25T09:00:00Z')); inv.put('KEEP', 1, night1 + 1000); return inv; };

  it('night 1 only counts the miss; night 2 retires', async () => {
    const inv = base();
    assert.deepEqual([(await sweep(inv, [1], night1, g)).removed, inv.get('V', 1).removed, inv.get('V', 1).missCount], [0, false, 1]);
    inv.upsert('KEEP', 1, night2 + 1000);
    assert.equal((await sweep(inv, [1], night2, g)).removed, 1);
    assert.equal(inv.get('V', 1).removed, true);
    assert.equal(inv.get('KEEP', 1).removed, false);
  });

  it('a retried or resumed run counts once: running night 1 twice is still one miss', async () => {
    const inv = base();
    await sweep(inv, [1], night1, g);
    const again = await sweep(inv, [1], night1, g);
    assert.deepEqual([again.removed, again.counted, inv.get('V', 1).missCount, inv.get('V', 1).removed], [0, 0, 1, false]);
  });

  it('a car that reappears between the two sweeps starts over', async () => {
    const inv = base();
    await sweep(inv, [1], night1, g);                        // miss 1
    inv.upsert('V', 1, night1 + 5000);                       // the crawl found it again, then it vanished again
    await sweep(inv, [1], night3, g);
    assert.deepEqual([inv.get('V', 1).removed, inv.get('V', 1).missCount], [false, 1], 'streak restarted: a single miss, not two');
  });

  it('minMisses 3: counts on nights 1 and 2, retires on night 3', async () => {
    const inv = base(); const g3 = { minMisses: 3, protectElsewhere: true };
    await sweep(inv, [1], night1, g3);
    await sweep(inv, [1], night2, g3);
    assert.deepEqual([inv.get('V', 1).removed, inv.get('V', 1).missCount], [false, 2]);
    await sweep(inv, [1], night3, g3);
    assert.equal(inv.get('V', 1).removed, true);
  });

  it('a night the store was skipped is neither a miss nor a retirement: two HEALTHY sweeps are needed', async () => {
    const inv = base();
    await sweep(inv, [1], night1, g);                         // miss 1
    await sweep(inv, [], night2, g).catch(() => {});          // blocked night: the client leaves the store out (no call at all)
    assert.equal(inv.get('V', 1).removed, false);
    await sweep(inv, [1], night3, g);                         // miss 2, healthy
    assert.equal(inv.get('V', 1).removed, true);
  });

  it('without guard fields the first miss retires (older clients are unchanged)', async () => {
    const inv = base();
    assert.equal((await legacy(inv, [1], night1)).removed, 1);
  });
});

describe('client: reading the crawl logs', () => {
  const ABINGTON_RETRY = '  ⏳ Fred Beans Acura of Abington: HTTP_429 — waiting 45s and retrying once before giving up';
  const LOG = [
    '[6/15] 🏢 Crawling Fred Beans Acura of Abington (Jenkintown, PA)...',
    ABINGTON_RETRY,
    '[6/15] ✅ Extracted 279 vehicles from Fred Beans Acura of Abington. (Running Total: 514)',
    '[6/25] 🛡️ SKIP Blaise Alexander Hyundai Of Altoona: HTTP_403 (403) — HTTP 403 Forbidden; vendor=Akamai [https://www.blaisehyundaialtoona.com/sitemap.xml]',
    '[12/24] 🛡️ SKIP Performance Ford (Randolph, NJ): HTTP_403 (403) — HTTP 403 Forbidden; vendor=Akamai [https://www.performanceforddealer.com/sitemap.xml]',
    '[3/9] 🛡️ SKIP Err Motors: HTTP_5XX (503) — server error [https://err.example/]',
    '[2/3] 🛡️ SKIP Perimeter: DNS_DEAD — getaddrinfo ENOTFOUND www.porscheperimeter.com [https://www.porscheperimeter.com/sitemap.xml]',
    '  ⏳ Slow Motors: TIMEOUT — waiting 10s',
  ].join('\n');

  it('counts a mid-crawl 429 retry as a hostile crawl even though the store then "succeeded"; DNS and timeouts are not hostile', () => {
    const got = parseHostileLines(LOG).map((e) => [e.name, e.cls, e.kind]);
    assert.deepEqual(got, [
      ['Fred Beans Acura of Abington', 'HTTP_429', 'retry'],
      ['Blaise Alexander Hyundai Of Altoona', 'HTTP_403', 'skip'],
      ['Performance Ford (Randolph, NJ)', 'HTTP_403', 'skip'],
      ['Err Motors', 'HTTP_5XX', 'skip'],
    ]);
    assert.equal(isHostileClass('HTTP_503'), true);
    assert.equal(isHostileClass('DNS_DEAD'), false);
  });

  it('a skip outranks a retry for the same store', () => {
    const t = `${ABINGTON_RETRY}\n[6/15] 🛡️ SKIP Fred Beans Acura of Abington: HTTP_403 (403) — x [https://www.fredbeansacuraabington.com/sitemap.xml]`;
    assert.equal(parseHostileLines(t)[0].kind, 'skip');
  });

  it('resolves stores to directory ids (retry lines carry no URL, so by name) and counts the unmatched', () => {
    const ids = { 'Fred Beans Acura of Abington': ABINGTON, 'Performance Ford (Randolph, NJ)': RANDOLPH };
    const r = collectHostileStores({ files: ['a'], readFile: () => LOG, dealerIdFor: ({ name }) => ids[name] ?? null });
    assert.deepEqual([...r.ids].sort((a, b) => a - b), [RANDOLPH, ABINGTON].sort((a, b) => a - b));
    assert.equal(r.unmatched, 2);
  });

  it('latestCrawlLogs reads only the newest night, never the report/driver logs, and nothing when that night is old', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-logs-'));
    const touch = (n) => fs.writeFileSync(path.join(dir, n), 'x');
    ['pa-acura-2026-10-25.log', 'pa-acura-2026-10-26.log', 'pa-hyundai-shard1-2026-10-26.log', 'nj-bot-report-2026-10-26.log', 'ok-write-dealers-2026-10-26.log', 'run-all-2026-10-26.log', 'chain-2026-10-26.log', 'notes.txt'].forEach(touch);
    const now = Date.now();
    assert.deepEqual(latestCrawlLogs(dir, now).map((f) => path.basename(f)).sort(), ['pa-acura-2026-10-26.log', 'pa-hyundai-shard1-2026-10-26.log']);
    assert.deepEqual(latestCrawlLogs(dir, now + 48 * 3600_000), [], 'older than the max age: no crawl tonight, nothing to exclude');
    assert.deepEqual(latestCrawlLogs(path.join(dir, 'missing'), now), []);
  });

  it('guardConfigFromEnv: everything on by default, each switch can turn one off, minMisses 1 is "off"', () => {
    const d = guardConfigFromEnv({});
    assert.deepEqual(d.fields, { minMisses: 2, protectElsewhere: true, minFreshRatio: 0.5, minLiveForRatio: 10 });
    assert.deepEqual([d.skipHostile, d.requireGuards], [true, true]);
    const off = guardConfigFromEnv({ SWEEP_MIN_MISSES: '1', SWEEP_PROTECT_ELSEWHERE: '0', SWEEP_MIN_FRESH_RATIO: '0', SWEEP_SKIP_HOSTILE: '0' });
    assert.deepEqual([off.fields, off.skipHostile, off.requireGuards], [{}, false, false]);
    assert.equal(guardConfigFromEnv({ SWEEP_MIN_MISSES: '9' }).fields.minMisses, 2, 'out of range falls back to the default');
  });

  it('describeGuardCounts counts only walled stores that were crawled and are swept', () => {
    const hostile = { entries: [{ dealerId: 5100 }, { dealerId: 1122 }, { dealerId: 777 }], unmatched: 2 };
    // 5100 has rows tonight; 1122 has rows but is a noSweep store (left out of sweepableIds); 777 has no rows at all.
    const line = describeGuardCounts({ logs: 9, hostile, sweepableIds: new Set([5100, 42]) });
    assert.equal(line, '[sync] sweep guard: 9 crawl log(s) read, 1 crawled and swept store(s) hit a 403/429/5xx wall (2 more in the logs had no rows tonight or are never swept; 2 not matched to the directory)');
    assert.match(describeGuardCounts({ logs: 0, hostile: { entries: [], unmatched: 0 }, sweepableIds: new Set() }), /0 crawled and swept store\(s\).*\(0 more/);
  });

  it('describeSkips names every skipped store (capped) so the log explains why a store was not swept', () => {
    const lines = describeSkips({ hostile: [{ dealerId: ABINGTON, name: 'Fred Beans Acura of Abington', cls: 'HTTP_429', kind: 'retry' }], partial: [{ dealerId: STATE_COLLEGE, live: 1272, fresh: 5 }], nameOf: () => 'Blaise Alexander Hyundai' });
    assert.match(lines.join('\n'), /Fred Beans Acura of Abington \(#5100\): HTTP_429 during the crawl \(retried\)/);
    assert.match(lines.join('\n'), /Blaise Alexander Hyundai \(#12225\): 5 fresh of 1272 live \(0%\)/);
  });
});

describe('client + server together', () => {
  const cfg = { ...configFromEnv({}), batchRows: 50, progressMs: 0, bulkRetries: 0, sweepBatchStores: 50 };
  const memoryStore = () => { const s = { data: null, load: () => (s.data ? JSON.parse(JSON.stringify(s.data)) : null), save: (x) => { s.data = JSON.parse(JSON.stringify(x)); }, clear: () => { s.data = null; } }; return s; };

  const deals = (inv, clock) => async (p, body) => {
    if (p === '/api/inventory/bulk') { for (const v of JSON.parse(body).vehicles) inv.upsert(v.vin, v.dealerId, clock.t); return { upserted: JSON.parse(body).vehicles.length }; }
    if (p === '/api/inventory/stats') return { total: inv.rows.size, vins: inv.rows.size, inStock: 0, dealers: 0, byState: [] };
    return serve(inv)(body);
  };

  it('the probe stops a sweep against an API that predates the guards, before any store is touched', async () => {
    const calls = [];
    const oldApi = async (_p, body) => { calls.push(body); return { removed: 0 }; };
    await assert.rejects(() => runSweep({ api: oldApi, stores: [1, 2], startedAt: '2026-10-27T11:52:00Z', guards: FULL, requireGuards: true, sleep: async () => {} }), (e) => e instanceof SweepAbortError && /does not acknowledge the sweep guards/.test(e.message));
    assert.deepEqual(calls.map((c) => c.dealerId), [-1], 'only the probe was sent');
  });

  it('a guard-aware API passes the probe; the fields ride on every call and the skipped stores come back', async () => {
    const inv = new FakeInventory(); const T = D('2026-10-27T11:52:00Z');
    for (let i = 0; i < 100; i++) inv.put(`P${i}`, ABINGTON, T - 1e6);
    inv.put('P0', ABINGTON, T + 1);
    const sent = [];
    const api = async (p, body) => { sent.push(body); return serve(inv)(body); };
    const r = await runSweep({ api, stores: [ABINGTON], startedAt: new Date(T).toISOString(), guards: FULL, requireGuards: true, sleep: async () => {} });
    assert.deepEqual(r.guardSkipped, [{ dealerId: ABINGTON, live: 100, fresh: 1 }]);
    assert.ok(sent.slice(1).every((b) => b.minMisses === 2 && b.protectElsewhere === true && b.minFreshRatio === 0.5));
  });

  it('Abington end to end: the crawl log says 429, so the client never even asks to sweep it; its 1,888 cars stay live', async () => {
    const clock = { t: D('2026-10-27T11:52:00Z') }; const inv = new FakeInventory();
    for (let i = 0; i < 1888; i++) inv.put(`ABN${i}`, ABINGTON, clock.t - 86_400_000);
    const rows = Array.from({ length: 279 }, (_, i) => ({ vin: `NEW${i}`, dealerId: ABINGTON, dealerName: 'Fred Beans Acura of Abington', source: 'nightly' }))
      .concat([{ vin: 'OTHER1', dealerId: 7, dealerName: 'Some Other Store', source: 'nightly' }]);
    inv.put('GONE1', 7, clock.t - 86_400_000);
    const logs = []; const api = deals(inv, clock);
    const hostile = [{ dealerId: ABINGTON, name: 'Fred Beans Acura of Abington', cls: 'HTTP_429', kind: 'retry' }];
    const r = await runWritePhase({ rows, fileIdentity: 'x', api, store: memoryStore(), config: cfg, now: () => clock.t, sleep: async () => {}, log: (m) => logs.push(m), hostileStores: hostile, guards: FULL, requireGuards: true });
    assert.equal(inv.live(ABINGTON).length, 2167, 'nothing retired at Abington');
    assert.ok(r.guardSkippedStores.includes(ABINGTON));
    assert.equal(inv.get('GONE1', 7).removed, false, 'a different, healthy store: first miss is only counted');
    assert.equal(inv.get('GONE1', 7).missCount, 1);
    assert.match(logs.join('\n'), /Fred Beans Acura of Abington \(#5100\): HTTP_429 during the crawl \(retried\)/);
    assert.match(logs.join('\n'), /sweep guards: 1 store\(s\) skipped for a 403\/429\/5xx crawl, 0 skipped as partial crawls, 1 missing car\(s\) counted/);
  });

  it('a second healthy night retires the car the first night only counted', async () => {
    const inv = new FakeInventory(); const clock = { t: D('2026-10-27T11:52:00Z') };
    inv.put('GONE1', 7, clock.t - 86_400_000);
    const api = deals(inv, clock);
    const run = (rows) => runWritePhase({ rows, fileIdentity: `n${clock.t}`, api, store: memoryStore(), config: cfg, now: () => clock.t, sleep: async () => {}, log: () => {}, guards: FULL, requireGuards: true });
    const row = [{ vin: 'KEEP', dealerId: 7, dealerName: 'S', source: 'nightly' }];
    const a = await run(row);
    clock.t += 86_400_000;
    const b = await run(row);
    assert.deepEqual([a.removed, b.removed, inv.get('GONE1', 7).removed], [0, 1, true]);
  });
});
