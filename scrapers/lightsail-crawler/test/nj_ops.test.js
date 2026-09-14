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
import { classifyFetchResult, isBotProtected, BOT_CLASSES } from '../src/bot_protection.js';
import { computeEta, emptyProgress, writeProgress, readProgress, renderProgressHtml } from '../src/progress.js';
import { priceChangeVsYesterday, inventoryChangeTypeToPriceChangeType } from '../src/price_diff.js';
import { captureVehicleDom, loadDomIndex, pruneDomBlobs, hashDom, extractVehicleDom } from '../src/dom_store.js';
import { buildTablePdf } from '../src/pdf_table.js';
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
    assert.equal(isBotProtected('CLOUDFLARE'), true);
    assert.equal(isBotProtected('NONE'), false);
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

describe('PDF table + brand registry', () => {
  it('emits a PDF header and resolves NJ in-scope brands', () => {
    const buf = buildTablePdf({
      title: 'NJ dealer bot-protection report',
      subtitle: 'detect only',
      columns: [
        { key: 'brand', header: 'Brand' },
        { key: 'dealerName', header: 'Dealer' },
        { key: 'classification', header: 'Classification' },
      ],
      rows: [{ brand: 'Toyota', dealerName: 'Hudson Toyota', classification: 'NONE' }],
    });
    assert.ok(buf.toString('latin1').includes('%PDF-1.4'));
    assert.equal(canonicalBrandName('mercedes'), 'Mercedes-Benz');
    assert.equal(canonicalBrandName('Toyota'), 'Toyota');
  });
});
