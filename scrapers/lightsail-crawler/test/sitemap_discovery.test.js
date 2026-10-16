// Sitemap discovery: every candidate leaves a record, "failed" is told apart from "empty", failed stores get one apex-first retry at the
// end of the run, and a store that had >100 vehicles and returns none is alerted in the run summary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyAttempt, describeAttempt, summarizeDiscovery, candidateSitemapUrls, previousCountsByDealer,
  zeroVdpAlerts, formatZeroVdpAlert, ZERO_VDP_ALERT_MIN_PREVIOUS,
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
    assert.match(src, /attempt\.error = \(err && \(err\.code \|\| err\.name\)\) \|\| 'ERROR'/);
    assert.match(src, /attempt\.status = err\.response\.statusCode/);
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
