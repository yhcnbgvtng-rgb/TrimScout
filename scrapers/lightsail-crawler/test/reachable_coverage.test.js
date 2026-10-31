import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStableCache } from '../src/stableCache.js';
import { bucketsFromDirectory, overlayReachable, scopeSql, withReachableCoverage, DIRECTORY_SQL } from '../src/reachableCoverage.js';

const quiet = { log() {}, error() {} };
const DIRECTORY = [
  { id: 1, dealerName: 'LaFontaine Chrysler Dodge Jeep Ram of Walled Lake', contactEmail: 'wendy@lafontaine.com', website: 'lafontainecdjrwalledlake.com', domainsJson: null, emailOptOut: 0 },
  { id: 2, dealerName: 'Autoplex Hyundai', contactEmail: 'accessibility@hmausa.com', website: 'autoplex-tx.com', domainsJson: null, emailOptOut: 0 },
  { id: 3, dealerName: 'Gmail Motors', contactEmail: 'gina@gmail.com', website: null, domainsJson: null, emailOptOut: 0 },
  { id: 4, dealerName: 'Opted Out Toyota', contactEmail: 'sales@optedouttoyota.com', website: 'optedouttoyota.com', domainsJson: '["optedouttoyota.com"]', emailOptOut: 1 },
  { id: 5, dealerName: 'Nothing Motors', contactEmail: null, website: null, domainsJson: null, emailOptOut: 0 },
];

describe('reachable coverage', () => {
  it('buckets the directory with the shared rule', () => {
    const b = bucketsFromDirectory(DIRECTORY);
    assert.deepEqual([...b.entries()], [['1', 'reachable'], ['2', 'none'], ['3', 'unverified'], ['4', 'none'], ['5', 'none']]);
  });

  it('overlays counts and per-dealer status on the stats payload without touching the rest', () => {
    const stats = { totals: { n: 9 }, coverage: { byMake: [], dealers: 6, dealersWithEmail: 5 }, dom: { byModel: [1], byDealer: [{ dealerId: 1, hasEmail: true }, { dealerId: 2, hasEmail: true }, { dealerId: 99 }] } };
    const out = overlayReachable(stats, [1, 2, 3, 99], bucketsFromDirectory(DIRECTORY));
    assert.deepEqual(out.coverage, { byMake: [], dealers: 6, dealersReachable: 1, dealersUnverified: 1, dealersWithEmail: 1 });
    assert.deepEqual(out.dom.byDealer.map((r) => [r.emailStatus, r.hasEmail]), [['reachable', true], ['none', false], ['none', false]]);
    assert.deepEqual(out.dom.byModel, [1]);
    assert.equal(out.totals, stats.totals);
  });

  it('the ids query reads only dealer_inventory columns the (removed_at, dealer_id) index holds, plus the filters', () => {
    const { sql, args } = scopeSql({ state: '', make: '', dealerId: null, model: '', from: '', to: '' });
    assert.equal(sql, 'SELECT i.dealer_id AS dealerId FROM dealer_inventory i WHERE i.removed_at IS NULL AND i.dealer_id > 0 GROUP BY i.dealer_id');
    assert.deepEqual(args, []);
    assert.ok(!/dealer_name|dealership_contacts|JOIN|MEDIAN/i.test(sql));
    const filtered = scopeSql({ state: 'NJ', make: 'Toyota', dealerId: 7, model: 'RAV4', from: '2026-01-01', to: '2026-02-01' });
    assert.deepEqual(filtered.args, ['NJ', 'Toyota', 7, 'RAV4', '2026-01-01', '2026-02-01 23:59:59']);
    assert.ok(!/dealership_contacts|JOIN/i.test(DIRECTORY_SQL.replace('FROM dealership_contacts', '')), 'the directory read is one table, no join');
  });

  it('runs two cheap reads once per 30 minutes, in its own cache, and serves the rest from memory', async () => {
    let t = 0; const seen = [];
    const cache = createStableCache({ ttlMs: 30 * 60_000, now: () => t, log: quiet }).get;
    const run = async (sql) => { seen.push(sql.slice(0, 20)); return sql === DIRECTORY_SQL ? DIRECTORY : [{ dealerId: 1 }, { dealerId: 3 }]; };
    const stats = { coverage: { dealers: 2 }, dom: { byDealer: [] } };
    const a = await withReachableCoverage({ stats, f: {}, cache, run, log: quiet });
    t = 29 * 60_000;
    const b = await withReachableCoverage({ stats, f: {}, cache, run, log: quiet });
    assert.equal(a.coverage.dealersReachable, 1); assert.equal(a.coverage.dealersUnverified, 1);
    assert.deepEqual(b.coverage, a.coverage);
    assert.equal(seen.length, 2);
  });

  it('a failing read leaves the stats payload as it was and is not cached', async () => {
    const cache = createStableCache({ ttlMs: 30 * 60_000, log: quiet }).get;
    const stats = { coverage: { dealers: 2, dealersWithEmail: 7 } };
    let fail = true;
    const run = async (sql) => { if (fail) throw new Error('statement timeout'); return sql === DIRECTORY_SQL ? DIRECTORY : [{ dealerId: 1 }]; };
    assert.equal(await withReachableCoverage({ stats, f: {}, cache, run, log: quiet }), stats);
    fail = false;
    assert.equal((await withReachableCoverage({ stats, f: {}, cache, run, log: quiet })).coverage.dealersReachable, 1);
  });
});
