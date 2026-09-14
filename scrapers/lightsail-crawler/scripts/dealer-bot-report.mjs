#!/usr/bin/env node
// NJ dealer bot-protection report.
//
// Fetches each configured in-scope NJ rooftop with a normal HTTP client
// (node:https — no got-scraping, no browser, no challenge solver).
// Classifies NONE / CLOUDFLARE / VERCEL_CHECKPOINT / HTTP_403 / HTTP_429 /
// TIMEOUT / TLS / OTHER. Emits JSON + a PDF table.
//
// Usage:
//   node scripts/dealer-bot-report.mjs
//   node scripts/dealer-bot-report.mjs --brand=Toyota
//   CRAWLER_BRAND=Porsche node scripts/dealer-bot-report.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadNjDealers, isNjBrandOut } from '../src/nj_policy.js';
import { probeDealer, probeUrl } from '../src/http_probe.js';
import { buildTablePdf } from '../src/pdf_table.js';
import {
  collectSalesEmail,
  applyContactToDealer,
  loadDealerContacts,
  saveDealerContacts,
} from '../src/sales_email.js';

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

const dealerContacts = await loadDealerContacts(cwd);
const rows = [];
for (let i = 0; i < dealers.length; i++) {
  const d = dealers[i];
  process.stdout.write(`  [${i + 1}/${dealers.length}] ${d.make} · ${d.name} (${d.domain})... `);
  const result = await probeDealer(d);
  let contact = { salesEmail: null, secondaryEmail: null, emailSourceUrl: null, collectedAt: null };
  if (result.classification === 'NONE') {
    contact = await collectSalesEmail(d, {
      getHtml: async (url) => probeUrl(url),
    });
    applyContactToDealer(d, contact);
    if (d.domain) {
      dealerContacts[d.domain] = {
        dealerName: d.name,
        brand: d.make,
        ...contact,
      };
    }
  }
  const row = {
    brand: d.make,
    dealerName: d.name,
    domain: d.domain,
    state: d.state || 'NJ',
    classification: result.classification,
    httpStatus: result.httpStatus,
    salesEmail: contact.salesEmail || '',
    notes: result.notes || '',
    url: result.url || result.fetchedUrl || null,
    emailSourceUrl: contact.emailSourceUrl || null,
  };
  rows.push(row);
  console.log(`${row.classification}${row.httpStatus ? ` ${row.httpStatus}` : ''}${row.salesEmail ? ` · ${row.salesEmail}` : ''}`);
}
await saveDealerContacts(dealerContacts, cwd);

const generatedAt = new Date().toISOString();
const summary = rows.reduce((acc, r) => {
  acc[r.classification] = (acc[r.classification] || 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt,
  brandFilter: brandFilter || 'ALL_IN_SCOPE',
  dealerCount: rows.length,
  summary,
  policy: {
    detectOnly: true,
    bypassForbidden: true,
    client: 'node:https',
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
  subtitle: `${generatedAt}  ·  ${brandFilter || 'all in-scope brands'}  ·  detect only, no WAF bypass  ·  ${rows.length} rooftops`,
  columns: [
    { key: 'brand', header: 'Brand', width: 1.1 },
    { key: 'dealerName', header: 'Dealer', width: 1.8 },
    { key: 'domain', header: 'Domain', width: 1.7 },
    { key: 'state', header: 'State', width: 0.6 },
    { key: 'classification', header: 'Classification', width: 1.3 },
    { key: 'httpStatus', header: 'HTTP', width: 0.5 },
    { key: 'salesEmail', header: 'Sales email', width: 1.6 },
    { key: 'notes', header: 'Notes', width: 1.6 },
  ],
  rows,
});
await fs.writeFile(pdfPath, pdf);
await fs.writeFile(latestPdf, pdf);

console.log(`\nJSON: ${jsonPath}`);
console.log(`PDF:  ${pdfPath}`);
console.log('Summary:', summary);
console.log('No WAF/captcha/challenge bypass was attempted.');
