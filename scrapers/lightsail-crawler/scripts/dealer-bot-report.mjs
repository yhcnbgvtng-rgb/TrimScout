#!/usr/bin/env node
// NJ dealer bot-protection report.
//
// Fetches each configured in-scope NJ rooftop with a normal HTTP client
// (node:https — no got-scraping, no browser, no challenge solver).
// Classifies NONE / CLOUDFLARE / VERCEL_CHECKPOINT / HTTP_403 / HTTP_429 /
// DNS_DEAD / HTTP_404 / HTTP_5XX / CONN_RESET / TIMEOUT / TLS / OTHER.
// Emits JSON + a PDF (summary page, then table). No sales-email column —
// inbox harvest is a crawl-time job, not this probe.
//
// Usage:
//   node scripts/dealer-bot-report.mjs
//   node scripts/dealer-bot-report.mjs --brand=Toyota
//   CRAWLER_BRAND=Porsche node scripts/dealer-bot-report.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadNjDealers, isNjBrandOut } from '../src/nj_policy.js';
import { probeDealer } from '../src/http_probe.js';
import { buildTablePdf, buildSummaryBlocks } from '../src/pdf_table.js';
import { CLASSIFICATION_ORDER, summarizeBotRows } from '../src/bot_protection.js';

const brandFilter = (process.argv.find((a) => a.startsWith('--brand=')) || '')
  .slice('--brand='.length) || process.env.CRAWLER_BRAND || null;

if (brandFilter && isNjBrandOut(brandFilter)) {
  console.error(`Refusing excluded brand "${brandFilter}". NJ crawler brands-out are not reported.`);
  process.exit(1);
}

const cwd = process.cwd();
const dealers = loadNjDealers({ cwd, brand: brandFilter });
if (dealers.length === 0) {
  console.error('No NJ in-scope dealers found. Check dealers/nj/*.json and src/nj_dealer_seed.js.');
  process.exit(1);
}

console.log(`Probing ${dealers.length} NJ rooftop(s)${brandFilter ? ` for ${brandFilter}` : ''} with a normal HTTP client (no bypass)...`);

const rows = [];
for (let i = 0; i < dealers.length; i++) {
  const d = dealers[i];
  process.stdout.write(`  [${i + 1}/${dealers.length}] ${d.make} · ${d.name} (${d.domain})... `);
  const result = await probeDealer(d);
  const row = {
    brand: d.make,
    dealerName: d.name,
    domain: d.domain,
    domainSource: d.domainSource || '',
    previousDomain: d.previousDomain || '',
    state: d.state || 'NJ',
    classification: result.classification,
    httpStatus: result.httpStatus,
    wafVendor: result.wafVendor || '',
    notes: result.notes || '',
    url: result.url || result.fetchedUrl || null,
    ready: result.classification === 'NONE' && Number(result.httpStatus) === 200 ? 'Y' : 'N',
  };
  rows.push(row);
  console.log(`${row.classification}${row.httpStatus ? ` ${row.httpStatus}` : ''}${row.wafVendor ? ` · ${row.wafVendor}` : ''}`);
}

const generatedAt = new Date().toISOString();
const { summary, brandRates, ready } = summarizeBotRows(rows);
for (const cls of CLASSIFICATION_ORDER) {
  if (summary[cls] == null) summary[cls] = 0;
}

const report = {
  generatedAt,
  brandFilter: brandFilter || 'ALL_IN_SCOPE',
  dealerCount: rows.length,
  summary,
  brandRates,
  readyToCrawl: ready.map((r) => ({
    brand: r.brand,
    dealerName: r.dealerName,
    domain: r.domain,
    httpStatus: r.httpStatus,
  })),
  policy: {
    detectOnly: true,
    bypassForbidden: true,
    client: 'node:https',
    homepageBefore404: true,
    salesEmailColumn: false,
  },
  dealers: rows,
};

const outDir = path.resolve(cwd, 'data', 'reports');
await fs.mkdir(outDir, { recursive: true });
const stamp = generatedAt.slice(0, 10);
const brandSlug = (brandFilter || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const jsonPath = path.join(outDir, `dealer-bot-report-${brandSlug}-${stamp}.json`);
const pdfPath = path.join(outDir, `dealer-bot-report-${brandSlug}-${stamp}.pdf`);
const latestJson = path.join(outDir, 'dealer-bot-report-latest.json');
const latestPdf = path.join(outDir, 'dealer-bot-report-latest.pdf');

await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`);

const pdf = buildTablePdf({
  title: 'NJ dealer bot-protection report',
  subtitle: `${generatedAt}  |  ${brandFilter || 'all in-scope brands'}  |  detect only, no WAF bypass  |  ${rows.length} rooftops`,
  summaryBlocks: buildSummaryBlocks({
    generatedAt,
    dealerCount: rows.length,
    summary,
    brandRates,
    ready,
  }),
  columns: [
    { key: 'ready', header: 'OK', width: 0.4 },
    { key: 'brand', header: 'Brand', width: 1.1 },
    { key: 'dealerName', header: 'Dealer', width: 1.8 },
    { key: 'domain', header: 'Domain', width: 1.7 },
    { key: 'classification', header: 'Class', width: 1.4 },
    { key: 'wafVendor', header: 'Vendor', width: 1.2 },
    { key: 'httpStatus', header: 'HTTP', width: 0.5 },
    { key: 'notes', header: 'Notes', width: 1.8 },
  ],
  rows,
});
await fs.writeFile(pdfPath, pdf);
await fs.writeFile(latestPdf, pdf);

console.log(`\nJSON: ${jsonPath}`);
console.log(`PDF:  ${pdfPath}`);
console.log('Summary:', summary);
console.log(`Ready to crawl (NONE/200): ${ready.length}`);
console.log('No WAF/captcha/challenge bypass was attempted.');
