// Sitemap discovery: every candidate leaves a record, "failed" is told apart from "empty", failed stores get one apex-first retry at the
// end of the run, and a store that had >100 vehicles and returns none is alerted in the run summary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyAttempt, describeAttempt, summarizeDiscovery, candidateSitemapUrls, previousCountsByDealer,
  zeroVdpAlerts, formatZeroVdpAlert, ZERO_VDP_ALERT_MIN_PREVIOUS, robotsSitemapUrls,
} from '../src/sitemapDiscovery.js';

const att = (o) => ({ url: 'https://x.com/sitemap.xml', status: 200, error: null, locs: 0, vdp: 0, ...o });

describe('classifyAttempt', () => {
  it('2xx with vehicle URLs is ok, 2xx without is empty', () => {
    assert.equal(classifyAttempt(att({ locs: 10, vdp: 4 })), 'ok');
    assert.equal(classifyAttempt(att({ locs: 10, vdp: 0 })), 'empty');
    assert.equal(classifyAttempt(att({ locs: 0, vdp: 0 })), 'empty');
  });
  it('404 and 410 are a missing sitemap (empty), not a failure', () => {
    for (const status of [404, 410]) assert.equal(classifyAttempt(att({ status })), 'empty', String(status));
  });
  it('errors, 403, 408, 429, 5xx and no status are failures', () => {
    assert.equal(classifyAttempt(att({ status: null, error: 'ETIMEDOUT' })), 'failed');
    for (const status of [403, 408, 429, 500, 502, 503]) assert.equal(classifyAttempt(att({ status })), 'failed', String(status));
    assert.equal(classifyAttempt(att({ status: null })), 'failed');
  });
});

describe('summarizeDiscovery', () => {
  it('found URLs -> ok even if an earlier candidate failed', () => {
    const s = summarizeDiscovery([att({ status: 503 }), att({ vdp: 5, locs: 9 })], 5);
    assert.equal(s.outcome, 'ok');
  });
  it('nothing found and a candidate errored -> failed, naming why', () => {
    const s = summarizeDiscovery([att({ status: null, error: 'ETIMEDOUT' }), att({ status: 404 }), att({ status: 429 })], 0);
    assert.equal(s.outcome, 'failed');
    assert.equal(s.failures, 2);
    assert.match(s.note, /ETIMEDOUT/);
    assert.match(s.note, /HTTP 429/);
  });
  it('nothing found and every candidate answered -> empty', () => {
    const s = summarizeDiscovery([att({ status: 404 }), att({ locs: 3, vdp: 0 })], 0);
    assert.equal(s.outcome, 'empty');
    assert.equal(s.failures, 0);
  });
  it('describeAttempt prints status or error and the verdict', () => {
    assert.match(describeAttempt(att({ locs: 1064, vdp: 800 })), /HTTP 200, 1064 <loc>, 800 VDP \[ok\]/);
    assert.match(describeAttempt(att({ status: null, error: 'ETIMEDOUT' })), /ERROR ETIMEDOUT \[failed\]/);
    assert.match(describeAttempt(att({ status: 404 })), /HTTP 404 \[empty\]/);
  });
});

describe('candidateSitemapUrls', () => {
  const dealer = { domain: 'kiaofcapecoral.com', sitemapUrl: 'https://www.kiaofcapecoral.com/sitemap.xml', inventorySitemapUrl: 'https://www.kiaofcapecoral.com/sitemap-inventory.xml', fallbackUrl: 'https://kiaofcapecoral.com/' };
  it('keeps the shipped order for the first pass', () => {
    assert.deepEqual(candidateSitemapUrls(dealer), [
      'https://www.kiaofcapecoral.com/sitemap.xml', 'https://www.kiaofcapecoral.com/sitemap-inventory.xml',
      'https://kiaofcapecoral.com/sitemap-inventory.xml', 'https://kiaofcapecoral.com/sitemap.xml', 'https://kiaofcapecoral.com/',
    ]);
  });
  it('retry pass tries the apex host first, then everything else, no duplicates', () => {
    const list = candidateSitemapUrls(dealer, { apexFirst: true });
    assert.equal(list[0], 'https://kiaofcapecoral.com/sitemap.xml');
    assert.equal(list[1], 'https://kiaofcapecoral.com/sitemap-inventory.xml');
    assert.equal(new Set(list).size, list.length);
    for (const u of candidateSitemapUrls(dealer)) assert.ok(list.includes(u), u);
  });
  it('copes with a record that only has sitemapUrl', () => {
    const list = candidateSitemapUrls({ sitemapUrl: 'https://www.a.com/sitemap.xml' }, { apexFirst: true });
    assert.equal(list[0], 'https://a.com/sitemap.xml');
  });
});

describe('zero-VDP alert', () => {
  const snap = {};
  for (let i = 0; i < 150; i++) snap[`V${i}`] = { status: 'ACTIVE', configDealerName: 'Big Store', dealerName: 'Big Store' };
  for (let i = 0; i < 100; i++) snap[`S${i}`] = { status: 'ACTIVE', dealerName: 'Edge Store' };
  for (let i = 0; i < 300; i++) snap[`R${i}`] = { status: 'SOLD_OR_REMOVED', dealerName: 'Gone Store' };
  const previousCounts = previousCountsByDealer(snap);

  it('counts only ACTIVE records, by the crawl-loop dealer key', () => {
    assert.equal(previousCounts.get('Big Store'), 150);
    assert.equal(previousCounts.get('Edge Store'), 100);
    assert.equal(previousCounts.get('Gone Store'), undefined);
  });
  it('alerts for zero now after MORE than 100 before; exactly 100 does not', () => {
    assert.equal(ZERO_VDP_ALERT_MIN_PREVIOUS, 100);
    const alerts = zeroVdpAlerts({ dealerStats: { 'Big Store': 0, 'Edge Store': 0, 'Gone Store': 0 }, previousCounts });
    assert.deepEqual(alerts.map((a) => a.dealer), ['Big Store']);
  });
  it('a store with vehicles this run is not alerted, and the reason says why for failures and bot skips', () => {
    assert.deepEqual(zeroVdpAlerts({ dealerStats: { 'Big Store': 3 }, previousCounts }), []);
    const failed = zeroVdpAlerts({ dealerStats: { 'Big Store': 0 }, previousCounts, failedDealerNames: new Set(['Big Store']) });
    assert.equal(failed[0].reason, 'failed');
    const skipped = zeroVdpAlerts({ dealerStats: { 'Big Store': 0 }, previousCounts, failedDealerNames: new Set(['Big Store']), skippedBotProtection: new Set(['Big Store']) });
    assert.equal(skipped[0].reason, 'bot-protection skip');
    assert.match(formatZeroVdpAlert(failed[0]), /ZERO-VDP ALERT: Big Store returned 0 vehicles \(previous run 150; failed\)/);
  });
  it('worst store first', () => {
    const p = new Map([['A', 200], ['B', 900]]);
    assert.deepEqual(zeroVdpAlerts({ dealerStats: { A: 0, B: 0 }, previousCounts: p }).map((a) => a.dealer), ['B', 'A']);
  });
});

describe('standalone.js wiring (source guards: the script is not importable)', () => {
  const src = fs.readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
  it('the catch no longer swallows the reason: it records status or error on the attempt', () => {
    const walker = fs.readFileSync(new URL('../src/sitemapDiscovery.js', import.meta.url), 'utf8');
    assert.match(walker, /attempt\.error = \(err && \(err\.code \|\| err\.name\)\) \|\| 'ERROR'/);
    assert.match(walker, /attempt\.status = err\.response\.statusCode/);
    assert.match(src, /walkSitemap\(sitemapUrl, \{ brand, fetchXml, attempts, depth \}\)/);
  });
  it('the empty-inventory line keeps its prefix (box_report counts it) and now carries the reason', () => {
    assert.match(src, /⚠️ No inventory URLs detected for \$\{dealer\.name\}\. \[\$\{discovery\.note\}\]/);
  });
  it('only a FAILED discovery in the first pass queues a retry, once, and the retry skips the bot probe and email collection', () => {
    assert.match(src, /discovery\.outcome === 'failed' && !retry && SITEMAP_RETRY_PASS/);
    assert.match(src, /work\.push\(\{ dealer, retry: true \}\)/);
    assert.match(src, /retry \? \{ classification: 'NONE' \} : await probeDealerBotProtectionWithRetry/);
    assert.match(src, /if \(!retry\) try \{\s+const contact = await collectSalesEmail/);
    assert.match(src, /resolveSitemapDiscovery\(dealer, brand, null, \{ apexFirst: retry \}\)/);
  });
  it('a recovered retry clears the failed flag so the sold-diff sees real evidence', () => {
    assert.match(src, /if \(retry\) \{\s+failedDealerNames\.delete\(dealer\.name\)/);
  });
  it('the summary prints the zero-VDP alert lines from the previous snapshot counts', () => {
    assert.match(src, /previousCountsByDealerName = previousCountsByDealer\(latestPreviousSnapshot\)/);
    assert.match(src, /Zero-VDP alerts:/);
    assert.match(src, /formatZeroVdpAlert/);
  });
  it('the retry pass can be switched off', () => {
    assert.match(src, /CRAWLER_SITEMAP_RETRY_PASS !== 'false'/);
  });
});

describe('robotsSitemapUrls', () => {
  const robots = 'User-agent: *\nDisallow: /x\nSitemap: https://kiaofcapecoral.com/sitemap_index.xml\nsitemap: https://www.kiaofcapecoral.com/vehicles.xml\nSitemap: https://other-site.com/sitemap.xml\nSitemap: ftp://kiaofcapecoral.com/a.xml\nSitemap: not a url\n';
  it('keeps Sitemap: lines on the dealer\'s own site (www or apex) and drops third-party, non-http and malformed ones', () => {
    assert.deepEqual(robotsSitemapUrls(robots, 'www.kiaofcapecoral.com'), ['https://kiaofcapecoral.com/sitemap_index.xml', 'https://www.kiaofcapecoral.com/vehicles.xml']);
  });
  it('skips URLs that were already tried and de-duplicates', () => {
    assert.deepEqual(robotsSitemapUrls(robots + 'Sitemap: https://kiaofcapecoral.com/sitemap_index.xml\n', 'kiaofcapecoral.com', ['https://kiaofcapecoral.com/sitemap_index.xml']), ['https://www.kiaofcapecoral.com/vehicles.xml']);
  });
  it('caps the list and handles empty input', () => {
    const many = Array.from({ length: 9 }, (_, i) => `Sitemap: https://a.com/s${i}.xml`).join('\n');
    assert.equal(robotsSitemapUrls(many, 'a.com').length, 5);
    assert.deepEqual(robotsSitemapUrls('', 'a.com'), []);
    assert.deepEqual(robotsSitemapUrls(robots, ''), []);
  });
});

// ---- robots.txt -> declared sitemap index -> vehicle sitemap, end to end on fixtures (no network) ----
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChildSitemaps, walkSitemap, discoverViaRobots, locMatches } from '../src/sitemapDiscovery.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'robots-sitemap');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const kia = { name: 'Kia', vinPrefixes: ['5XY', 'KND', 'KNA'] };

// Serves fixture files by URL basename; other *-sitemap.xml children are empty, anything else is a 404. Records every request.
function fakeSite(requests = []) {
  return async (url) => {
    requests.push(url);
    const name = new URL(url).pathname.split('/').pop();
    const known = ['sitemap_index.xml', 'vehicle-sitemap.xml', 'page-sitemap.xml'];
    if (known.includes(name)) return { status: 200, xml: fixture(name) };
    if (/-sitemap\.xml$/.test(name)) return { status: 200, xml: '<urlset></urlset>' };
    const err = new Error('Not Found'); err.response = { statusCode: 404 }; throw err;
  };
}

describe('selectChildSitemaps', () => {
  const kids = ['post', 'page', 'category', 'post_tag', 'author', 'attachment', 'service', 'staff', 'coupon', 'vehicle'].map((k) => `https://x.test/${k}-sitemap.xml`);
  it('puts the inventory child first even when it is listed after the cap', () => {
    assert.equal(kids.indexOf('https://x.test/vehicle-sitemap.xml'), 9);
    assert.deepEqual(selectChildSitemaps(kids, 'Kia'), ['https://x.test/vehicle-sitemap.xml']);
  });
  it('with no inventory-looking child keeps the first `max` in file order', () => {
    const plain = Array.from({ length: 12 }, (_, i) => `https://x.test/sitemap-${i + 1}.xml`);
    assert.deepEqual(selectChildSitemaps(plain, 'Kia'), plain.slice(0, 8));
  });
  it('does not let a brand-named host make every child look like inventory', () => {
    const k = ['post', 'page', 'category', 'post_tag', 'author', 'attachment', 'service', 'staff', 'coupon', 'vehicle'].map((n) => `https://www.examplekia.test/${n}-sitemap.xml`);
    assert.deepEqual(selectChildSitemaps(k, 'Kia'), ['https://www.examplekia.test/vehicle-sitemap.xml']);
  });
  it('recognises vdp/new/used/brand named children', () => {
    for (const u of ['https://x.test/sitemap-vdp-sitemap_1.xml', 'https://x.test/new-sitemap.xml', 'https://x.test/used.xml', 'https://x.test/kia-sitemap.xml']) {
      assert.deepEqual(selectChildSitemaps(['https://x.test/page-sitemap.xml', u], 'Kia'), [u], u);
    }
  });
});

describe('locMatches', () => {
  it('reads plain, CDATA and entity-escaped <loc> values', () => {
    assert.deepEqual(locMatches('<loc>https://a.test/x&#x2B;y</loc><loc><![CDATA[https://a.test/z]]></loc>'), ['https://a.test/x+y', 'https://a.test/z']);
  });
});

describe('robots.txt declared sitemap index (fixture)', () => {
  it('the fixture robots.txt (CRLF) declares the index on the www host, reached from the apex dealer host', () => {
    assert.deepEqual(robotsSitemapUrls(fixture('robots.txt'), 'examplekia.test', ['https://examplekia.test/sitemap.xml']), ['https://www.examplekia.test/sitemap_index.xml']);
  });

  it('walks the declared index and finds the vehicle sitemap listed tenth', async () => {
    const attempts = [];
    const urls = await walkSitemap('https://www.examplekia.test/sitemap_index.xml', { brand: kia, fetchXml: fakeSite(), attempts });
    assert.equal(urls.length, 3);
    assert.ok(urls.every((u) => /Kia-Sportage-/.test(u)));
    assert.equal(attempts[0].locs, 10);
    assert.equal(attempts[0].vdp, 3);
    assert.ok(attempts.some((a) => a.url.endsWith('/vehicle-sitemap.xml') && a.vdp === 3));
  });

  it('discoverViaRobots: robots.txt -> declared index -> vehicles, logging the declaration and the yield', async () => {
    const requests = [];
    const logs = [];
    const attempts = [{ url: 'https://examplekia.test/sitemap.xml', status: 200, error: null, locs: 0, vdp: 0 }];
    const out = await discoverViaRobots({
      dealerHost: 'examplekia.test', brand: kia, attempts,
      fetchRobots: async () => fixture('robots.txt'), fetchXml: fakeSite(requests), log: (l) => logs.push(l),
    });
    assert.equal(out.urls.length, 3);
    assert.deepEqual(out.declared, ['https://www.examplekia.test/sitemap_index.xml']);
    assert.match(logs[0], /robots\.txt declares 1 sitemap\(s\) not tried yet/);
    assert.match(logs[1], /yielded 3 vehicle URL\(s\)/);
    assert.ok(requests.includes('https://www.examplekia.test/vehicle-sitemap.xml'));
    assert.equal(summarizeDiscovery(attempts, out.urls.length).outcome, 'ok');
  });

  it('a declared sitemap with no vehicles ends empty without throwing, and robots.txt errors are logged not retried', async () => {
    const attempts = [];
    const none = await discoverViaRobots({
      dealerHost: 'examplekia.test', brand: kia, attempts,
      fetchRobots: async () => 'Sitemap: https://www.examplekia.test/page-sitemap.xml\n', fetchXml: fakeSite(),
    });
    assert.deepEqual(none.urls, []);
    assert.equal(attempts.length, 1);
    const logs = [];
    const err = Object.assign(new Error('x'), { response: { statusCode: 403 } });
    const refused = await discoverViaRobots({ dealerHost: 'examplekia.test', brand: kia, attempts: [], fetchRobots: async () => { throw err; }, fetchXml: fakeSite(), log: (l) => logs.push(l) });
    assert.deepEqual(refused.urls, []);
    assert.match(logs[0], /robots\.txt HTTP 403 - not retried/);
  });
});
