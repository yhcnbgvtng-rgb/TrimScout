import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlockedReport, buildBlockedUpsert, buildBlockedCleanup, blockedRowsToJson, BLOCKED_TABLE_DDL } from '../src/blockedStores.js';
import { parseBlockedLines, collectBlocked, postBlocked, BLOCKED_PATH } from '../../../scripts/box/syncBlocked.js';

const h = { toInt: (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null), toStr: (v, n) => (v == null ? null : String(v).slice(0, n)) };
const LOG = [
  '[24/25] 🏢 Crawling Valencia BMW (Valencia, CA)...',
  '[24/25] 🛡️ SKIP Valencia BMW: HTTP_403 (403) — HTTP 403 Forbidden; vendor=Akamai [https://www.valenciabmw.com/sitemap.xml]',
  '[20/25] 🛡️ SKIP Cloninger Ford of Hickory: CLOUDFLARE (403) — Cloudflare mitigated (challenge) [https://www.cloningerfordhickory.net/sitemap.xml]',
  '[3/9] 🛡️ SKIP Dead Site Motors: DNS_DEAD — domain does not resolve [https://deadsite.example/]',
  '[4/9] 🛡️ SKIP Error Motors: HTTP_5XX (500) — server error [https://err.example/]',
  '[24/25] 🛡️ SKIP Valencia BMW: HTTP_403 (403) — HTTP 403 Forbidden; vendor=Akamai [https://www.valenciabmw.com/sitemap.xml]',
  '[5/25] ✅ Extracted 954 vehicles from BERMAN NISSAN OF CHICAGO. (Running Total: 1772)',
].join('\n');

describe('parseBlockedLines', () => {
  it('keeps bot-protection skips only (Cloudflare / 403 / 429 / Vercel), once per store, with vendor and site', () => {
    assert.deepEqual(parseBlockedLines(LOG), [
      { name: 'Valencia BMW', cls: 'HTTP_403', vendor: 'Akamai', url: 'https://www.valenciabmw.com/sitemap.xml' },
      { name: 'Cloninger Ford of Hickory', cls: 'CLOUDFLARE', vendor: null, url: 'https://www.cloningerfordhickory.net/sitemap.xml' },
    ]);
  });
  it('ignores crawled stores and empty input', () => {
    assert.deepEqual(parseBlockedLines('[5/25] ✅ Extracted 954 vehicles from X. (Running Total: 1)'), []);
    assert.deepEqual(parseBlockedLines(''), []);
  });
});

describe('collectBlocked / postBlocked', () => {
  const dealerIdFor = ({ name, url }) => (/valenciabmw/.test(url) ? 7650 : /cloninger/.test(name.toLowerCase()) ? 1022 : null);
  it('resolves each blocked store to its directory id, de-duplicates across logs and counts the unmatched', () => {
    const r = collectBlocked({ files: ['a', 'b'], dealerIdFor, readFile: () => LOG + '\n[1/2] 🛡️ SKIP Unknown Motors: HTTP_403 (403) — x; vendor=Akamai [https://unknown.example/]' });
    assert.deepEqual(r.stores.map((s) => s.dealerId), [1022, 7650]);
    assert.equal(r.unmatched, 2);
  });
  it('skips an unreadable log instead of failing', () => {
    const r = collectBlocked({ files: ['a'], dealerIdFor, readFile: () => { throw new Error('gone'); } });
    assert.deepEqual(r, { stores: [], unmatched: 0 });
  });
  it('posts the report, and a failing API only logs', async () => {
    const calls = [];
    await postBlocked({ api: async (p, b) => { calls.push({ p, b }); return { stored: 1 }; }, box: 'box2', date: '2026-10-10', stores: [{ dealerId: 7650, name: 'Valencia BMW', cls: 'HTTP_403', vendor: 'Akamai' }], log: () => {} });
    assert.equal(calls[0].p, BLOCKED_PATH);
    assert.equal(calls[0].b.box, 'box2');
    const logs = [];
    const r = await postBlocked({ api: async () => { throw new Error('404'); }, box: 'box2', date: '2026-10-10', stores: [], log: (m) => logs.push(m) });
    assert.equal(r, null);
    assert.match(logs[0], /non-fatal/);
  });
});

describe('blocked-store storage rules', () => {
  const ok = { box: 'box2', date: '2026-10-10', stores: [{ dealerId: 7650, name: 'Valencia BMW', cls: 'HTTP_403', vendor: 'Akamai' }, { dealerId: '7650', cls: 'HTTP_403' }, { dealerId: 1022, name: 'Cloninger', cls: 'CLOUDFLARE' }] };
  it('parses a report and de-duplicates stores', () => {
    const r = parseBlockedReport(ok, h);
    assert.equal(r.ok, true);
    assert.deepEqual(r.stores.map((s) => s.dealerId), [7650, 1022]);
  });
  it('rejects a bad box, date, store id or class (DNS_DEAD is not a block)', () => {
    assert.equal(parseBlockedReport({ ...ok, box: '' }, h).ok, false);
    assert.equal(parseBlockedReport({ ...ok, date: '10/10/2026' }, h).ok, false);
    assert.equal(parseBlockedReport({ ...ok, stores: [{ dealerId: 0, cls: 'HTTP_403' }] }, h).ok, false);
    assert.equal(parseBlockedReport({ ...ok, stores: [{ dealerId: 5, cls: 'DNS_DEAD' }] }, h).ok, false);
    assert.equal(parseBlockedReport({ box: 'box2', date: '2026-10-10' }, h).ok, false);
  });
  it('upserts keeping first_blocked_on, and clears only this box\'s older flags', () => {
    const p = parseBlockedReport(ok, h);
    const up = buildBlockedUpsert(p);
    assert.match(up.sql, /ON DUPLICATE KEY UPDATE name = VALUES\(name\).*last_blocked_on = VALUES\(last_blocked_on\)/);
    assert.doesNotMatch(up.sql, /first_blocked_on = VALUES/);
    assert.deepEqual(up.args[0][0], [7650, 'Valencia BMW', 'HTTP_403', 'Akamai', 'box2', '2026-10-10', '2026-10-10']);
    assert.equal(buildBlockedUpsert({ ...p, stores: [] }), null);
    assert.deepEqual(buildBlockedCleanup(p), { sql: 'DELETE FROM crawl_blocked_stores WHERE source_box = ? AND last_blocked_on < ?', args: ['box2', '2026-10-10'] });
  });
  it('creates only a table (primary key, no secondary index) and shapes rows for the admin', () => {
    assert.match(BLOCKED_TABLE_DDL, /^CREATE TABLE IF NOT EXISTS crawl_blocked_stores/);
    assert.doesNotMatch(BLOCKED_TABLE_DDL, /INDEX|UNIQUE|\bKEY \w+ \(/);
    assert.deepEqual(blockedRowsToJson([{ dealer_id: 7650, name: 'V', block_class: 'HTTP_403', vendor: null, source_box: 'box2', first_blocked_on: new Date(2026, 9, 1), last_blocked_on: '2026-10-10' }]),
      [{ dealerId: 7650, name: 'V', cls: 'HTTP_403', vendor: null, box: 'box2', firstBlockedOn: '2026-10-01', lastBlockedOn: '2026-10-10' }]);
  });
});
