import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWLER_ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
import {
  acceptNjDealer,
  isNjBrandIn,
  isNjBrandOut,
  isMegadealerOrSuperstore,
  loadNjDealers,
  canonicalBrandName,
  buildDealerRecord,
} from '../src/nj_policy.js';
import { classifyFetchResult, isBotProtected, isUncrawlable, pickProbeResult, detectWafVendor, summarizeBotRows, BOT_CLASSES } from '../src/bot_protection.js';
import { looksLikeBrandCityGuess, applyVerifiedNjDomains, overlayKey } from '../src/nj_verified_domains.js';
import { buildTablePdf, winAnsiSafe, buildSummaryBlocks } from '../src/pdf_table.js';
import { extractWindowSticker, applyWindowSticker, captureWindowStickerFromPage } from '../src/window_sticker.js';
import { loadNyDealers, acceptNyDealer } from '../src/ny_policy.js';
import { loadFlDealers, acceptFlDealer } from '../src/fl_policy.js';
import { loadGaDealers, acceptGaDealer } from '../src/ga_policy.js';
import { SUPPORTED_STATES, isSupportedState } from '../src/states.js';
import { computeEta, emptyProgress, writeProgress, readProgress, renderProgressHtml } from '../src/progress.js';
import { priceChangeVsYesterday, inventoryChangeTypeToPriceChangeType } from '../src/price_diff.js';
import { captureVehicleDom, loadDomIndex, pruneDomBlobs, hashDom, extractVehicleDom } from '../src/dom_store.js';
import {
  extractEmailsFromHtml,
  pickPreferredSalesEmails,
  emailBelongsToDealer,
  collectSalesEmail,
} from '../src/sales_email.js';

describe('NJ brand policy', () => {
  it('keeps in-scope brands and rejects the OUT list', () => {
    assert.equal(isNjBrandIn('Toyota'), true);
    assert.equal(isNjBrandIn('Mercedes-Benz'), true);
    assert.equal(isNjBrandIn('Mini'), true);
    assert.equal(isNjBrandOut('Ford'), true);
    assert.equal(isNjBrandOut('Chevy'), true);
    assert.equal(isNjBrandOut('Hyundai'), true);
    assert.equal(isNjBrandIn('Ford'), false);
    assert.equal(canonicalBrandName('mercedes'), 'Mercedes-Benz');
  });

  it('skips megadealer groups, used superstores, and multi-franchise lots', () => {
    assert.equal(isMegadealerOrSuperstore({ name: 'Open Road Acura of Wayne' }), true);
    assert.equal(isMegadealerOrSuperstore({ name: 'AutoNation Honda' }), true);
    assert.equal(isMegadealerOrSuperstore({ name: 'CarMax Edison' }), true);
    assert.equal(isMegadealerOrSuperstore({ name: 'Quality Chevrolet GMC' }), true);
    assert.equal(isMegadealerOrSuperstore({ name: 'Paul Miller Porsche' }), false);
  });

  it('accepts only NJ in-scope single-franchise rooftops', () => {
    assert.equal(acceptNjDealer({ name: 'Paul Miller Porsche', state: 'NJ', make: 'Porsche', domain: 'paulmillerporsche.com' }), true);
    assert.equal(acceptNjDealer({ name: 'Paul Miller Porsche', state: 'NY', make: 'Porsche', domain: 'paulmillerporsche.com' }), false);
    assert.equal(acceptNjDealer({ name: 'Route 1 Ford', state: 'NJ', make: 'Ford', domain: 'route1ford.com' }), false);
    assert.equal(acceptNjDealer({ name: 'Open Road Mazda of Morristown', state: 'NJ', make: 'Mazda', domain: 'openroadmazda.com' }), false);
    const jd = buildDealerRecord({
      name: 'Jack Daniels Porsche',
      city: 'Upper Saddle River',
      domain: 'jackdaniels.porsche.com',
      make: 'Porsche',
    });
    assert.equal(jd.sitemapUrl, 'https://jackdaniels.porsche.com/sitemap.xml');
  });

  it('loads NJ lists without excluded brands', () => {
    const all = loadNjDealers({ cwd: CRAWLER_ROOT });
    assert.ok(all.length > 20);
    assert.ok(all.every((d) => d.state === 'NJ'));
    assert.ok(all.every((d) => isNjBrandIn(d.make)));
    assert.ok(all.every((d) => !isNjBrandOut(d.make)));
    assert.ok(all.every((d) => !isMegadealerOrSuperstore(d)));
    const toyota = loadNjDealers({ cwd: CRAWLER_ROOT, brand: 'Toyota' });
    assert.ok(toyota.length > 0);
    assert.ok(toyota.every((d) => d.make === 'Toyota'));
    const acura = loadNjDealers({ cwd: CRAWLER_ROOT, brand: 'Acura' });
    const key = acura.find((d) => /key acura/i.test(d.name));
    assert.ok(key);
    assert.equal(key.domain, 'keyacuraofatlanticcity.com');
    const bmw = loadNjDealers({ cwd: CRAWLER_ROOT, brand: 'BMW' });
    const circle = bmw.find((d) => /circle bmw/i.test(d.name));
    assert.ok(circle);
    assert.equal(circle.domain, 'circlebmw.com');
    const porsche = loadNjDealers({ cwd: CRAWLER_ROOT, brand: 'Porsche' });
    const princeton = porsche.find((d) => /princeton/i.test(d.name));
    assert.ok(princeton);
    assert.equal(princeton.domain, 'princetonporsche.com');
  });

  it('keeps only locator or listing hosts and drops invented brandofcity templates', () => {
    const all = loadNjDealers({ cwd: CRAWLER_ROOT });
    const allowed = new Set(['oem-locator', 'listing-verified', 'curated-overlay']);
    assert.ok(all.length > 20);
    assert.ok(all.every((d) => allowed.has(d.domainSource)), 'every rooftop must have a verified source');
    assert.ok(all.every((d) => d.domainSource !== 'pattern-guess'));
    const hosts = new Set(all.map((d) => d.domain));
    assert.equal(hosts.has('66toyota.com'), false);
    assert.equal(hosts.has('mitsubishiturnersville.com'), false);
    assert.equal(hosts.has('hudsonmitsubishi.com'), false);
    assert.equal(hosts.has('route22mitsubishi.com'), false);
    assert.equal(hosts.has('mazdaofmorristown.com'), false);
    assert.equal(hosts.has('volvocarsmorristown.com'), false);
    const toyota = all.find((d) => /sansone toyota/i.test(d.name));
    assert.ok(toyota);
    assert.equal(toyota.domain, 'sansonestoyota.com');
    const mitsubishi = loadNjDealers({ cwd: CRAWLER_ROOT, brand: 'Mitsubishi' });
    assert.ok(mitsubishi.length >= 8);
    assert.ok(mitsubishi.every((d) => d.domainSource === 'oem-locator'));
    assert.ok(mitsubishi.some((d) => d.domain === 'acmitsubishi.com'));
    assert.ok(!mitsubishi.some((d) => /nielsen/i.test(d.name)));
  });
});

describe('NJ domain quality', () => {
  it('flags brandofcity / volvocars{city} templates and overlays verified hosts', () => {
    assert.equal(looksLikeBrandCityGuess({ domain: 'mazdaofmorristown.com' }), true);
    assert.equal(looksLikeBrandCityGuess({ domain: 'hondaofwatchung.com' }), true);
    assert.equal(looksLikeBrandCityGuess({ domain: 'volvocarsmorristown.com' }), true);
    assert.equal(looksLikeBrandCityGuess({ domain: 'hudsontoyota.com' }), false);
    assert.equal(looksLikeBrandCityGuess({ domain: 'dchkayhonda.com' }), false);
    assert.ok(overlayKey('Acura', 'Key Acura of Atlantic City').includes('key acura atlantic city'));

    const { dealers, replacements } = applyVerifiedNjDomains([
      { name: 'Key Acura of Atlantic City', make: 'Acura', domain: 'keyacura.com' },
      { name: 'BMW of Morristown', make: 'BMW', domain: 'bmwofmorristown.com' },
      { name: 'Hudson Toyota', make: 'Toyota', domain: 'hudsontoyota.com' },
    ], { cwd: CRAWLER_ROOT });
    assert.equal(dealers.find((d) => d.name.startsWith('Key')).domain, 'keyacuraofatlanticcity.com');
    assert.equal(dealers.find((d) => d.name.startsWith('BMW')).domain, 'morristownbmw.com');
    assert.equal(dealers.find((d) => d.name.startsWith('Hudson')).domain, 'hudsontoyota.com');
    assert.ok(replacements.some((r) => r.to === 'keyacuraofatlanticcity.com'));
  });
});

describe('bot-protection classification (detect only)', () => {
  it('flags Cloudflare, Vercel, 403, 429, timeout, TLS', () => {
    assert.equal(
      classifyFetchResult({
        statusCode: 403,
        headers: { server: 'cloudflare', 'cf-ray': 'abc' },
        body: '<html>Attention Required! Cloudflare</html>',
      }).classification,
      BOT_CLASSES.CLOUDFLARE
    );
    assert.equal(
      classifyFetchResult({
        statusCode: 429,
        headers: {},
        body: 'Vercel Security Checkpoint',
      }).classification,
      BOT_CLASSES.VERCEL_CHECKPOINT
    );
    assert.equal(classifyFetchResult({ statusCode: 403, body: 'Forbidden' }).classification, BOT_CLASSES.HTTP_403);
    assert.equal(classifyFetchResult({ statusCode: 429, body: 'slow down' }).classification, BOT_CLASSES.HTTP_429);
    assert.equal(classifyFetchResult({ error: new Error('Fetch timeout') }).classification, BOT_CLASSES.TIMEOUT);
    assert.equal(classifyFetchResult({ error: new Error('SSL routines:tls') }).classification, BOT_CLASSES.TLS);
    assert.equal(classifyFetchResult({ statusCode: 200, body: '<urlset></urlset>' }).classification, BOT_CLASSES.NONE);
    assert.equal(classifyFetchResult({ statusCode: 404, body: 'not found' }).classification, BOT_CLASSES.HTTP_404);
    assert.equal(classifyFetchResult({ statusCode: 503, body: 'unavailable' }).classification, BOT_CLASSES.HTTP_5XX);
    const dnsErr = new Error('getaddrinfo ENOTFOUND mazdaofmorristown.com');
    dnsErr.code = 'ENOTFOUND';
    assert.equal(classifyFetchResult({ error: dnsErr }).classification, BOT_CLASSES.DNS_DEAD);
    const resetErr = new Error('socket hang up');
    resetErr.code = 'ECONNRESET';
    assert.equal(classifyFetchResult({ error: resetErr }).classification, BOT_CLASSES.CONN_RESET);
    assert.equal(isBotProtected('CLOUDFLARE'), true);
    assert.equal(isBotProtected('NONE'), false);
    assert.equal(isBotProtected('DNS_DEAD'), false);
    assert.equal(isBotProtected('HTTP_404'), false);
    assert.equal(isUncrawlable('DNS_DEAD'), true);
    assert.equal(isUncrawlable('NONE'), false);
    const cf403 = classifyFetchResult({
      statusCode: 403,
      headers: { server: 'CloudFront', 'x-amz-cf-id': 'abc', 'x-cache': 'Error from cloudfront' },
      body: 'Forbidden',
    });
    assert.equal(cf403.classification, BOT_CLASSES.HTTP_403);
    assert.equal(cf403.wafVendor, 'CloudFront');
    assert.equal(detectWafVendor({ 'akamai-grn': '0.abc', 'x-akamai-age': '1' }, ''), 'Akamai');
    assert.equal(detectWafVendor({ 'server-timing': 'ak_p; desc="1"' }, ''), 'Akamai');
  });

  it('tries homepage before classifying sitemap 404 and still stops on WAF', () => {
    const after404 = pickProbeResult([
      { classification: 'HTTP_404', httpStatus: 404, url: 'https://example.com/sitemap.xml' },
      { classification: 'NONE', httpStatus: 200, url: 'https://example.com/' },
    ]);
    assert.equal(after404.classification, 'NONE');
    assert.equal(after404.httpStatus, 200);

    const still404 = pickProbeResult([
      { classification: 'HTTP_404', httpStatus: 404, url: 'https://example.com/sitemap.xml' },
      { classification: 'HTTP_404', httpStatus: 404, url: 'https://example.com/' },
    ]);
    assert.equal(still404.classification, 'HTTP_404');

    const wafFirst = pickProbeResult([
      { classification: 'CLOUDFLARE', httpStatus: 403, url: 'https://example.com/sitemap.xml' },
      { classification: 'NONE', httpStatus: 200, url: 'https://example.com/' },
    ]);
    assert.equal(wafFirst.classification, 'CLOUDFLARE');

    const dnsFirst = pickProbeResult([
      { classification: 'DNS_DEAD', url: 'https://nope.example/sitemap.xml' },
      { classification: 'NONE', httpStatus: 200, url: 'https://nope.example/' },
    ]);
    assert.equal(dnsFirst.classification, 'DNS_DEAD');
  });
});

describe('progress persist', () => {
  it('survives a write + read the way a browser refresh would', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-progress-'));
    const written = await writeProgress({
      ...emptyProgress(),
      status: 'running',
      currentBrand: 'Toyota',
      dealersDone: 3,
      dealersTotal: 10,
      vehiclesSeen: 40,
      priceDrops: 2,
      newArrivals: 5,
      skippedForBotProtection: 1,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    }, cwd);
    const read = await readProgress(cwd);
    assert.equal(read.currentBrand, 'Toyota');
    assert.equal(read.dealersDone, 3);
    assert.equal(read.skippedForBotProtection, 1);
    assert.ok(read.eta);
    assert.match(renderProgressHtml(written), /Toyota/);
    assert.ok(computeEta({ startedAt: written.startedAt, dealersDone: 3, dealersTotal: 10 }));
  });
});

describe('today vs yesterday price diffs', () => {
  it('records PRICE_DROP / PRICE_INCREASE / UNCHANGED / NEW / SOLD', () => {
    assert.equal(priceChangeVsYesterday({ todayPrice: 100, yesterdayPrice: 120 }).priceChangeType, 'PRICE_DROP');
    assert.equal(priceChangeVsYesterday({ todayPrice: 130, yesterdayPrice: 120 }).priceChangeType, 'PRICE_INCREASE');
    assert.equal(priceChangeVsYesterday({ todayPrice: 120, yesterdayPrice: 120 }).priceChangeType, 'UNCHANGED');
    assert.equal(priceChangeVsYesterday({ todayPrice: 120, isNew: true }).priceChangeType, 'NEW');
    assert.equal(priceChangeVsYesterday({ yesterdayPrice: 120, isSold: true }).priceChangeType, 'SOLD');
    assert.equal(inventoryChangeTypeToPriceChangeType('NEW_ARRIVAL'), 'NEW');
  });
});

describe('DOM snapshot store', () => {
  it('skips rewriting the blob when the hash matches yesterday and prunes old blobs', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nj-dom-'));
    const html = '<script>DDC.dataLayer["vehicles"] = [{"vin":"WP0AA2A59SL000001","price":100}];</script>';
    const compact = extractVehicleDom(html, 'WP0AA2A59SL000001');
    assert.match(compact, /WP0AA2A59SL000001/);

    await captureVehicleDom({
      vin: 'WP0AA2A59SL000001',
      date: '2026-09-13',
      html,
      price: 100,
      isNew: true,
      cwd,
    });
    const second = await captureVehicleDom({
      vin: 'WP0AA2A59SL000001',
      date: '2026-09-14',
      html,
      price: 90,
      yesterdayPrice: 100,
      cwd,
    });
    assert.equal(second.hash, hashDom(compact));
    assert.equal(second.hashUnchanged, true);
    assert.equal(second.blobStored, false);
    assert.equal(second.priceChangeType, 'PRICE_DROP');

    const staleDir = path.join(cwd, 'data', 'dom_blobs', 'WP0AA2A59SL000001');
    await fs.writeFile(path.join(staleDir, '2026-08-01.html.gz'), Buffer.from('old'));
    const pruned = await pruneDomBlobs({ today: '2026-09-14', retainDays: 7, cwd });
    assert.equal(pruned.removed, 1);
    const index = await loadDomIndex(cwd);
    assert.ok(index.WP0AA2A59SL000001['2026-09-13']);
    assert.ok(index.WP0AA2A59SL000001['2026-09-14']);
  });
});

describe('public sales email collect', () => {
  it('prefers generic inboxes and keeps a labeled personal as secondary', () => {
    const html = `
      <a href="mailto:jane.doe@hudsontoyota.com">Jane Doe, Internet Sales</a>
      <a href="mailto:sales@hudsontoyota.com">sales</a>
      <span>cars.com help: help@cars.com</span>
    `;
    const found = extractEmailsFromHtml(html, { dealerHost: 'hudsontoyota.com' });
    assert.ok(found.some((f) => f.email === 'sales@hudsontoyota.com'));
    assert.ok(!found.some((f) => f.email.endsWith('@cars.com')));
    const picked = pickPreferredSalesEmails(found);
    assert.equal(picked.salesEmail, 'sales@hudsontoyota.com');
    assert.equal(picked.secondaryEmail, 'jane.doe@hudsontoyota.com');
    assert.equal(emailBelongsToDealer('sales@hudsontoyota.com', 'hudsontoyota.com'), true);
    assert.equal(emailBelongsToDealer('sales@gmail.com', 'hudsontoyota.com'), false);
  });

  it('skips challenge pages and never follows third-party hosts', async () => {
    const contact = await collectSalesEmail(
      { domain: 'exampledealer.com', name: 'Example' },
      {
        getHtml: async (url) => {
          if (url.includes('/contact')) {
            return { statusCode: 403, headers: { server: 'cloudflare' }, body: 'Attention Required! Cloudflare' };
          }
          return { statusCode: 200, body: '<a href="mailto:info@exampledealer.com">info</a>' };
        },
      }
    );
    assert.equal(contact.salesEmail, 'info@exampledealer.com');
  });
});

describe('window sticker capture (link only)', () => {
  it('captures a public VDP sticker link and leaves a page without one null', () => {
    const withLink = extractWindowSticker(
      `<html><a href="/inventory/window-sticker.pdf" aria-label="View window sticker">Window Sticker</a></html>`,
      'https://hudsontoyota.com/new/VIN.htm'
    );
    assert.equal(withLink.windowStickerUrl, 'https://hudsontoyota.com/inventory/window-sticker.pdf');
    assert.equal(withLink.windowStickerSource, 'vdp_link');
    assert.ok(withLink.collectedAt);
    assert.equal(withLink.collectedAt, withLink.windowStickerCollectedAt);

    const none = extractWindowSticker('<html><p>No sticker here</p></html>', 'https://hudsontoyota.com/new/VIN.htm');
    assert.equal(none.windowStickerUrl, null);
    assert.equal(none.windowStickerSource, null);
    assert.equal(none.collectedAt, null);

    const download = extractWindowSticker(
      `<html><a href="/docs/monroney.pdf" download>Manufacturer sticker</a></html>`,
      'https://example.com/vdp'
    );
    assert.match(download.windowStickerUrl, /monroney\.pdf$/);
    assert.equal(download.windowStickerSource, 'vdp_link');

    const embed = extractWindowSticker(
      `<html><iframe src="https://cdn.example.com/windowsticker/WP0AA.pdf"></iframe></html>`,
      'https://example.com/vdp'
    );
    assert.match(embed.windowStickerUrl, /windowsticker/);
    assert.equal(embed.windowStickerSource, 'vdp_embed');

    const layer = extractWindowSticker(
      `<script>DDC.dataLayer["vehicles"] = [{"windowStickerUrl":"https://cdn.example.com/sticker.pdf"}];</script>`,
      'https://example.com/vdp'
    );
    assert.equal(layer.windowStickerUrl, 'https://cdn.example.com/sticker.pdf');
    assert.equal(layer.windowStickerSource, 'vdp_datalayer');

    const vehicle = applyWindowSticker({ vin: '4T1B11HK1SU000001' }, '<img alt="Window Sticker" src="/sticker/monroney.png">', 'https://example.com/vdp');
    assert.match(vehicle.windowStickerUrl, /monroney/);
    assert.equal(vehicle.windowStickerSource, 'vdp_image');
    assert.ok(vehicle.collectedAt);
  });

  it('does not harvest stickers from challenge pages (same skip as the crawler)', () => {
    const html = '<a href="/window-sticker.pdf">Window Sticker</a>';
    const page = classifyFetchResult({
      statusCode: 403,
      headers: { server: 'cloudflare', 'cf-ray': 'x' },
      body: html,
    });
    assert.equal(isBotProtected(page.classification), true);
    const skipped = captureWindowStickerFromPage({
      html,
      pageUrl: 'https://example.com/vdp',
      classification: page.classification,
    });
    assert.equal(skipped.windowStickerUrl, null);
    assert.equal(skipped.windowStickerSource, null);
    const contact = applyWindowSticker({ vin: 'WP0AA2A59SL000001' }, html, 'https://example.com/vdp', {
      classification: page.classification,
    });
    assert.equal(contact.windowStickerUrl, null);
  });
});

describe('NY locator seed (no brandofcity guesses)', () => {
  it('loads NY in-scope rooftops from OEM locators and listings only', () => {
    assert.equal(acceptNyDealer({ name: 'Acura of Huntington', state: 'NY', make: 'Acura', domain: 'acuraofhuntington.com' }), true);
    assert.equal(acceptNyDealer({ name: 'Open Road Acura of Wayne', state: 'NY', make: 'Acura', domain: 'openroadacura.com' }), false);
    assert.equal(acceptNyDealer({ name: 'Route 1 Ford', state: 'NY', make: 'Ford', domain: 'route1ford.com' }), false);
    const all = loadNyDealers({ cwd: CRAWLER_ROOT });
    assert.ok(all.length > 0);
    assert.ok(all.every((d) => d.state === 'NY'));
    assert.ok(all.every((d) => isNjBrandIn(d.make)));
    assert.ok(all.every((d) => !isMegadealerOrSuperstore(d)));
    assert.ok(all.every((d) => d.domainSource === 'oem-locator' || d.domainSource === 'listing-verified'));
    const acura = loadNyDealers({ cwd: CRAWLER_ROOT, brand: 'Acura' });
    assert.ok(acura.length > 0);
    assert.ok(acura.every((d) => d.make === 'Acura'));
    assert.ok(acura.every((d) => d.fallbackUrl.endsWith('/')));
    const toyota = loadNyDealers({ cwd: CRAWLER_ROOT, brand: 'Toyota' });
    assert.ok(toyota.length > 10);
    assert.ok(toyota.every((d) => d.domainSource === 'oem-locator'));
    assert.ok(toyota.some((d) => d.domain === 'toyotaofmanhattan.com'));
    const lexus = loadNyDealers({ cwd: CRAWLER_ROOT, brand: 'Lexus' });
    assert.ok(lexus.length > 5);
    const honda = loadNyDealers({ cwd: CRAWLER_ROOT, brand: 'Honda' });
    assert.ok(honda.every((d) => d.domainSource !== 'pattern-guess'));
  });
});

describe('state registry (src/states.js)', () => {
  it('lists NJ, NY, FL, GA as supported and rejects anything else', () => {
    assert.deepEqual(SUPPORTED_STATES, ['NJ', 'NY', 'FL', 'GA']);
    assert.equal(isSupportedState('FL'), true);
    assert.equal(isSupportedState('fl'), true);
    assert.equal(isSupportedState('GA'), true);
    assert.equal(isSupportedState('ga'), true);
    assert.equal(isSupportedState(' NJ '), true);
    assert.equal(isSupportedState('CT'), false);
    assert.equal(isSupportedState(''), false);
    assert.equal(isSupportedState(null), false);
  });
});

describe('FL locator seed (no brandofcity guesses)', () => {
  it('loads FL in-scope rooftops from OEM locators and listings only', () => {
    assert.equal(acceptFlDealer({ name: 'Acura of Fort Myers', state: 'FL', make: 'Acura', domain: 'acuraoffortmyers.com' }), true);
    assert.equal(acceptFlDealer({ name: 'AutoNation Acura', state: 'FL', make: 'Acura', domain: 'autonationacura.com' }), false);
    assert.equal(acceptFlDealer({ name: 'Route 1 Ford', state: 'FL', make: 'Ford', domain: 'route1ford.com' }), false);
    assert.equal(acceptFlDealer({ name: 'Acura of Fort Myers', state: 'NJ', make: 'Acura', domain: 'acuraoffortmyers.com' }), false);

    const all = loadFlDealers({ cwd: CRAWLER_ROOT });
    assert.ok(all.length > 0);
    assert.ok(all.every((d) => d.state === 'FL'));
    assert.ok(all.every((d) => isNjBrandIn(d.make)));
    assert.ok(all.every((d) => !isNjBrandOut(d.make)));
    assert.ok(all.every((d) => !isMegadealerOrSuperstore(d)));
    assert.ok(all.every((d) => ['oem-locator', 'listing-verified', 'curated-overlay'].includes(d.domainSource)), 'every rooftop must have a verified source');
    assert.ok(all.every((d) => d.domainSource !== 'pattern-guess'));

    // Acura and Porsche's FL rows come straight out of the existing
    // nationwide in-repo locator dumps (acura-dealers.json / dealers.json),
    // which already covered every state including FL before this branch —
    // confirming loadFlDealers actually reaches that data, not just an
    // empty seed.
    const acura = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Acura' });
    assert.ok(acura.length > 10);
    assert.ok(acura.every((d) => d.make === 'Acura'));
    assert.ok(acura.every((d) => d.domainSource === 'oem-locator'));
    const fortMyers = acura.find((d) => /acura of fort myers/i.test(d.name));
    assert.ok(fortMyers);
    assert.equal(fortMyers.domain, 'acuraoffortmyers.com');
    // Regression check for a real cross-state name collision in the
    // shared oem_locator.js dedup key (fixed 2026-09-15 while adding GA,
    // but the bug itself predates GA and already affected this exact FL
    // rooftop): acura-dealers.json also carries a same-named "Crown Acura"
    // in OH and VA — a state-less dedup key silently dropped this FL one
    // in their favor. See stateScopedKey() in src/oem_locator.js.
    const crownAcura = acura.find((d) => /crown acura/i.test(d.name));
    assert.ok(crownAcura, 'FL Crown Acura must survive the cross-state OH/VA Crown Acura name collision');
    assert.equal(crownAcura.domain, 'crownacura.com');

    const porsche = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Porsche' });
    assert.ok(porsche.length > 10);
    assert.ok(porsche.every((d) => d.make === 'Porsche'));
    const braman = porsche.find((d) => /braman porsche/i.test(d.name));
    assert.ok(braman);
    assert.equal(braman.domain, 'bramanporsche.com');

    // A brand with no working locator (Honda/Nissan/etc., blocked for
    // NJ/NY too) stays honestly empty for FL rather than inventing a host.
    const honda = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Honda' });
    assert.equal(honda.length, 0);

    // Toyota/Subaru FL rows come from the live OEM-locator dumps this
    // branch's fetch-oem-dealer-locators.mjs run added (real fetches
    // against toyota.com's dealer-hub pages and subaru.com's dealer-
    // distance API, not invented brandofcity hosts).
    const toyota = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Toyota' });
    assert.ok(toyota.length > 20);
    assert.ok(toyota.every((d) => d.domainSource === 'oem-locator'));
    assert.ok(toyota.some((d) => d.domain === 'arlingtontoyota.com'));
    const subaru = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Subaru' });
    assert.ok(subaru.length > 10);
    assert.ok(subaru.some((d) => d.domain === 'bertsmithsubaru.com'));
  });
});

describe('GA locator seed (no brandofcity guesses)', () => {
  it('loads GA in-scope rooftops from OEM locators and listings only', () => {
    assert.equal(acceptGaDealer({ name: 'Acura of Columbus', state: 'GA', make: 'Acura', domain: 'acuraofcolumbus.com' }), true);
    assert.equal(acceptGaDealer({ name: 'AutoNation Acura', state: 'GA', make: 'Acura', domain: 'autonationacura.com' }), false);
    assert.equal(acceptGaDealer({ name: 'Rick Hendrick Chevrolet', state: 'GA', make: 'Chevrolet', domain: 'rickhendrickchevrolet.com' }), false);
    assert.equal(acceptGaDealer({ name: 'Acura of Columbus', state: 'FL', make: 'Acura', domain: 'acuraofcolumbus.com' }), false);

    const all = loadGaDealers({ cwd: CRAWLER_ROOT });
    assert.ok(all.length > 0);
    assert.ok(all.every((d) => d.state === 'GA'));
    assert.ok(all.every((d) => isNjBrandIn(d.make)));
    assert.ok(all.every((d) => !isNjBrandOut(d.make)));
    assert.ok(all.every((d) => !isMegadealerOrSuperstore(d)));
    assert.ok(all.every((d) => ['oem-locator', 'listing-verified', 'curated-overlay'].includes(d.domainSource)), 'every rooftop must have a verified source');
    assert.ok(all.every((d) => d.domainSource !== 'pattern-guess'));

    // Acura and Porsche's GA rows come straight out of the existing
    // nationwide in-repo locator dumps (acura-dealers.json / dealers.json),
    // which already covered every state including GA before this branch —
    // confirming loadGaDealers actually reaches that data, not just an
    // empty seed.
    const acura = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Acura' });
    assert.ok(acura.length > 5);
    assert.ok(acura.every((d) => d.make === 'Acura'));
    assert.ok(acura.every((d) => d.domainSource === 'oem-locator'));
    const columbus = acura.find((d) => /acura of columbus/i.test(d.name));
    assert.ok(columbus);
    assert.equal(columbus.domain, 'acuraofcolumbus.com');

    const porsche = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Porsche' });
    assert.ok(porsche.length > 0);
    assert.ok(porsche.every((d) => d.make === 'Porsche'));
    const hennessy = porsche.find((d) => /hennessy porsche/i.test(d.name));
    assert.ok(hennessy);
    assert.equal(hennessy.domain, 'hennessyporsche.com');

    // A brand with no working locator (Honda/Nissan/etc., blocked for
    // NJ/NY/FL too) stays honestly empty for GA rather than inventing a
    // host.
    const honda = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Honda' });
    assert.equal(honda.length, 0);

    // Toyota/Subaru GA rows come from the live OEM-locator dumps this
    // branch's fetch-oem-dealer-locators.mjs run added (real fetches
    // against toyota.com's dealer-hub pages and subaru.com's dealer-
    // distance API, not invented brandofcity hosts).
    const toyota = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Toyota' });
    assert.ok(toyota.length > 20);
    assert.ok(toyota.every((d) => d.domainSource === 'oem-locator'));
    assert.ok(toyota.some((d) => d.domain === 'atlantatoyota.com'));
    const subaru = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Subaru' });
    assert.ok(subaru.length > 5);
    assert.ok(subaru.some((d) => d.domain === 'cpsubaru.com'));

    // Same real-world same-name-different-state dealer group collision
    // caught while building this branch (src/oem_locator.js's dedup key
    // was state-less until now — see stateScopedKey()'s comment): "Kia
    // Autosport" and "Rick Case Kia" are each a genuinely distinct rooftop
    // in both FL and GA, and both must survive independently.
    const gaKia = loadGaDealers({ cwd: CRAWLER_ROOT, brand: 'Kia' });
    const flKia = loadFlDealers({ cwd: CRAWLER_ROOT, brand: 'Kia' });
    const gaAutosport = gaKia.find((d) => /kia autosport/i.test(d.name));
    const flAutosport = flKia.find((d) => /kia autosport/i.test(d.name));
    assert.ok(gaAutosport, 'GA Kia Autosport (Columbus) must not be dropped by a cross-state dedup collision');
    assert.ok(flAutosport, 'FL Kia Autosport (Pensacola) must not be dropped by a cross-state dedup collision');
    assert.notEqual(gaAutosport.domain, flAutosport.domain);
  });
});

describe('PDF table + brand registry', () => {
  it('emits a WinAnsi-safe summary PDF without a sales-email column or checkmark glyph', () => {
    assert.equal(winAnsiSafe('✓ ready — yes'), 'Y ready - yes');
    const rows = [
      { brand: 'Toyota', dealerName: 'Hudson Toyota', domain: 'hudsontoyota.com', classification: 'NONE', httpStatus: 200, ready: 'Y', notes: '✓' },
      { brand: 'Mazda', dealerName: 'Mazda of Morristown', domain: 'mazdaofmorristown.com', classification: 'DNS_DEAD', httpStatus: null, ready: 'N', notes: '' },
    ];
    const { summary, brandRates, ready } = summarizeBotRows(rows);
    const buf = buildTablePdf({
      title: 'NJ dealer bot-protection report',
      subtitle: 'detect only',
      summaryBlocks: buildSummaryBlocks({
        generatedAt: '2026-09-14T02:52:48Z',
        dealerCount: rows.length,
        summary,
        brandRates,
        ready,
      }),
      columns: [
        { key: 'ready', header: 'OK' },
        { key: 'brand', header: 'Brand' },
        { key: 'dealerName', header: 'Dealer' },
        { key: 'classification', header: 'Class' },
      ],
      rows,
    });
    const latin1 = buf.toString('latin1');
    assert.ok(latin1.includes('%PDF-1.4'));
    assert.ok(latin1.includes('Ready to crawl now'));
    assert.ok(latin1.includes('DNS_DEAD'));
    assert.ok(latin1.includes('Hudson Toyota'));
    assert.ok(!latin1.includes('Sales email'));
    assert.ok(!latin1.includes('salesEmail'));
    assert.ok(!latin1.includes('✓'));
    assert.ok(!latin1.includes('\u00E2'));
    assert.equal(canonicalBrandName('mercedes'), 'Mercedes-Benz');
    assert.equal(canonicalBrandName('Toyota'), 'Toyota');
  });
});
