#!/usr/bin/env node
// Dealer bot-protection report (NJ by default; --state=NY uses locator seed).
//
// Fetches each configured in-scope rooftop with a normal HTTP client
// (node:https — no got-scraping, no browser, no challenge solver).
// Classifies NONE / CLOUDFLARE / VERCEL_CHECKPOINT / HTTP_403 / HTTP_429 /
// DNS_DEAD / HTTP_404 / HTTP_5XX / CONN_RESET / TIMEOUT / TLS / OTHER.
// Emits JSON + a PDF (summary page, then table). No sales-email column —
// inbox harvest is a crawl-time job, not this probe.
//
// Usage:
//   node scripts/dealer-bot-report.mjs
//   node scripts/dealer-bot-report.mjs --brand=Toyota
//   node scripts/dealer-bot-report.mjs --state=NY
//   node scripts/dealer-bot-report.mjs --state=FL
//   node scripts/dealer-bot-report.mjs --state=GA
//   node scripts/dealer-bot-report.mjs --state=TX
//   node scripts/dealer-bot-report.mjs --state=SC
//   node scripts/dealer-bot-report.mjs --state=VA
//   CRAWLER_BRAND=Porsche node scripts/dealer-bot-report.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadNjDealers, isNjBrandOut } from '../src/nj_policy.js';
import { loadNyDealers } from '../src/ny_policy.js';
import { loadFlDealers } from '../src/fl_policy.js';
import { loadGaDealers } from '../src/ga_policy.js';
import { loadTxDealers } from '../src/tx_policy.js';
import { loadScDealers } from '../src/sc_policy.js';
import { loadVaDealers } from '../src/va_policy.js';
import { loadNcDealers } from '../src/nc_policy.js';
import { loadRiDealers } from '../src/ri_policy.js';
import { loadVtDealers } from '../src/vt_policy.js';
import { loadNhDealers } from '../src/nh_policy.js';
import { probeDealer } from '../src/http_probe.js';
import { buildTablePdf, buildSummaryBlocks } from '../src/pdf_table.js';
import { CLASSIFICATION_ORDER, summarizeBotRows } from '../src/bot_protection.js';
import { SUPPORTED_STATES } from '../src/states.js';
import { resolveRunDate } from '../src/date_utils.js';

// One entry per supported state (see src/states.js) — a new state needs a
// loader added here, not a new if/else branch.
const STATE_DEALER_LOADERS = {
  NJ: loadNjDealers,
  NY: loadNyDealers,
  FL: loadFlDealers,
  GA: loadGaDealers,
  TX: loadTxDealers,
  SC: loadScDealers,
  VA: loadVaDealers,
  NC: loadNcDealers,
  RI: loadRiDealers,
  VT: loadVtDealers,
  NH: loadNhDealers,
};

const brandFilter = (process.argv.find((a) => a.startsWith('--brand=')) || '')
  .slice('--brand='.length) || process.env.CRAWLER_BRAND || null;
const stateFilter = ((process.argv.find((a) => a.startsWith('--state=')) || '')
  .slice('--state='.length) || process.env.CRAWLER_STATE || 'NJ')
  .toUpperCase();

if (!SUPPORTED_STATES.includes(stateFilter)) {
  console.error(`Unsupported state "${stateFilter}". Use one of: ${SUPPORTED_STATES.join(', ')}.`);
  process.exit(1);
}

if (brandFilter && isNjBrandOut(brandFilter)) {
  console.error(`Refusing excluded brand "${brandFilter}". Brands-out are not reported.`);
  process.exit(1);
}

const cwd = process.cwd();
const dealers = STATE_DEALER_LOADERS[stateFilter]({ cwd, brand: brandFilter });
if (dealers.length === 0) {
  console.error(`No ${stateFilter} in-scope dealers found. Check dealers/${stateFilter.toLowerCase()}/*.json.`);
  process.exit(1);
}

console.log(`Probing ${dealers.length} ${stateFilter} rooftop(s)${brandFilter ? ` for ${brandFilter}` : ''} with a normal HTTP client (no bypass)...`);

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
    state: d.state || stateFilter,
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
  state: stateFilter,
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
// Filename date is the Eastern calendar date, not generatedAt's UTC date —
// run-daily-crawl.mjs looks this report file up by the same Eastern date
// it computes for its own run, so the two must always agree (see
// src/date_utils.js). generatedAt itself stays a precise UTC instant,
// used only for the report body / PDF subtitle, never for the filename.
//
// Uses CRAWLER_RUN_DATE (set by run-daily-crawl.mjs to its own canonical
// once-per-run date) when present, same fix and same reason as
// standalone.js's todayDate: with up to MAX_CONCURRENT_STATES states now
// running concurrently, a state near the back of the scheduling pool can
// have its write-dealers/bot-report step start hours after the driver's
// own date was computed — independently calling easternDateStamp() here
// could then disagree with the driver's date and write this report under
// a filename readReadyBrandsForState() (which looks it up by the driver's
// date) can never find, silently falling back to "attempt every in-scope
// brand" instead of the real ready list. Falls back to computing fresh
// when unset, for manual/ad hoc runs of this script.
const stamp = resolveRunDate();
const brandSlug = (brandFilter || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const stateSlug = stateFilter.toLowerCase();
// State is part of every filename — without it, running this for NJ then
// NY on the same day (the daily driver's normal pattern) silently
// overwrote NJ's report with NY's, since both used to share the exact
// same "all"-brand, same-date filename.
const jsonPath = path.join(outDir, `dealer-bot-report-${stateSlug}-${brandSlug}-${stamp}.json`);
const pdfPath = path.join(outDir, `dealer-bot-report-${stateSlug}-${brandSlug}-${stamp}.pdf`);
const latestJson = path.join(outDir, `dealer-bot-report-${stateSlug}-latest.json`);
const latestPdf = path.join(outDir, `dealer-bot-report-${stateSlug}-latest.pdf`);

await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`);

const pdf = buildTablePdf({
  title: `${stateFilter} dealer bot-protection report`,
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
