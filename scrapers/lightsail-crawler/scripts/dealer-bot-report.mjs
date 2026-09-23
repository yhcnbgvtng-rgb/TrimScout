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
import { loadNjDealers, canonicalBrandName, NJ_BRANDS_IN_CORE, NJ_BRANDS_IN_EXPANSION } from '../src/nj_policy.js';
import { loadExpansionDealersForState } from '../src/expansionDealerFiles.js';
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
import { loadMaDealers } from '../src/ma_policy.js';
import { loadCaDealers } from '../src/ca_policy.js';
import { loadPaDealers } from '../src/pa_policy.js';
import { loadOkDealers } from '../src/ok_policy.js';
import { loadIlDealers } from '../src/il_policy.js';
import { loadOhDealers } from '../src/oh_policy.js';
import { loadMiDealers } from '../src/mi_policy.js';
import { loadWaDealers } from '../src/wa_policy.js';
import { loadAzDealers } from '../src/az_policy.js';
import { loadTnDealers } from '../src/tn_policy.js';
import { loadInDealers } from '../src/in_policy.js';
import { loadMoDealers } from '../src/mo_policy.js';
import { loadIaDealers } from '../src/ia_policy.js';
import { loadMdDealers } from '../src/md_policy.js';
import { loadWiDealers } from '../src/wi_policy.js';
import { loadCoDealers } from '../src/co_policy.js';
import { loadMnDealers } from '../src/mn_policy.js';
import { loadAlDealers } from '../src/al_policy.js';
import { loadLaDealers } from '../src/la_policy.js';
import { loadKyDealers } from '../src/ky_policy.js';
import { loadOrDealers } from '../src/or_policy.js';
import { loadNvDealers } from '../src/nv_policy.js';
import { loadUtDealers } from '../src/ut_policy.js';
import { loadCtDealers } from '../src/ct_policy.js';
import { loadArDealers } from '../src/ar_policy.js';
import { loadMsDealers } from '../src/ms_policy.js';
import { loadKsDealers } from '../src/ks_policy.js';
import { loadNmDealers } from '../src/nm_policy.js';
import { loadNeDealers } from '../src/ne_policy.js';
import { loadWvDealers } from '../src/wv_policy.js';
import { loadIdDealers } from '../src/id_policy.js';
import { loadHiDealers } from '../src/hi_policy.js';
import { loadMeDealers } from '../src/me_policy.js';
import { loadMtDealers } from '../src/mt_policy.js';
import { loadSdDealers } from '../src/sd_policy.js';
import { loadNdDealers } from '../src/nd_policy.js';
import { loadAkDealers } from '../src/ak_policy.js';
import { loadDeDealers } from '../src/de_policy.js';
import { loadWyDealers } from '../src/wy_policy.js';
import { probeDealer } from '../src/http_probe.js';
import { buildTablePdf, buildSummaryBlocks } from '../src/pdf_table.js';
import { CLASSIFICATION_ORDER, summarizeBotRows } from '../src/bot_protection.js';
import { SUPPORTED_STATES } from '../src/states.js';
import { resolveRunDate } from '../src/date_utils.js';
import { extractDealerIdentity } from '../src/dealerPageIdentityPlain.js';
import { detectDomainDrift, detectNameDrift } from '../src/dealerDriftDetect.js';

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
  MA: loadMaDealers,
  CA: loadCaDealers,
  PA: loadPaDealers,
  OK: loadOkDealers,
  IL: loadIlDealers,
OH: loadOhDealers,
  MI: loadMiDealers,
  WA: loadWaDealers,
  AZ: loadAzDealers,
  TN: loadTnDealers,
  IN: loadInDealers,
  MO: loadMoDealers,
  IA: loadIaDealers,
  MD: loadMdDealers,
  WI: loadWiDealers,
  CO: loadCoDealers,
  MN: loadMnDealers,
  AL: loadAlDealers,
  LA: loadLaDealers,
  KY: loadKyDealers,
  OR: loadOrDealers,
  NV: loadNvDealers,
  UT: loadUtDealers,
  CT: loadCtDealers,
  AR: loadArDealers,
  MS: loadMsDealers,
  KS: loadKsDealers,
  NM: loadNmDealers,
  NE: loadNeDealers,
  WV: loadWvDealers,
  ID: loadIdDealers,
  HI: loadHiDealers,
  ME: loadMeDealers,
  MT: loadMtDealers,
  SD: loadSdDealers,
  ND: loadNdDealers,
  AK: loadAkDealers,
  DE: loadDeDealers,
  WY: loadWyDealers,
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

// Brand recognition here is deliberately independent of CRAWLER_BRAND_SET:
// this report merges the OEM-locator-backed core brands with the
// separately-materialized expansion brands (see expansionDealerFiles.js)
// regardless of which brand set the current process env selects. Ford et
// al. only ever appear in isNjBrandOut() because that check is scoped to
// whichever single brand set is currently active (NJ_BRANDS_OUT_CORE
// really means "the OTHER set's brands", not "never in scope") — the
// brands genuinely out of scope for *both* sets are NJ_BRANDS_OUT_EXPANSION
// (Genesis/Tesla/Rivian/Lucid/Hummer: no traditional franchise network).
// So refuse only when the filter isn't recognized by either IN list.
const knownBrand = brandFilter
  ? [...NJ_BRANDS_IN_CORE, ...NJ_BRANDS_IN_EXPANSION].some((b) => canonicalBrandName(b) === canonicalBrandName(brandFilter))
  : true;
if (brandFilter && !knownBrand) {
  console.error(`Refusing unknown brand "${brandFilter}". Not in the core or expansion in-scope lists.`);
  process.exit(1);
}

const cwd = process.cwd();
// Expansion brands (Ford/Lincoln/Chevrolet/GMC/Buick/Cadillac/Stellantis)
// have no OEM-locator dump, so STATE_DEALER_LOADERS alone can never see
// them (confirmed live 2026-09-23 — see expansionDealerFiles.js's header)
// — merge in their pre-materialized dealer files directly, deduped the
// same way the core loaders already dedup (name+domain).
const coreDealers = STATE_DEALER_LOADERS[stateFilter]({ cwd, brand: brandFilter });
const expansionDealers = loadExpansionDealersForState(stateFilter, { cwd, brand: brandFilter });
const seenDealerKey = new Set();
const dealers = [];
for (const d of [...coreDealers, ...expansionDealers]) {
  const key = `${String(d.make).toLowerCase()}|${String(d.name).toLowerCase()}|${String(d.domain).toLowerCase().replace(/^www\./, '')}`;
  if (seenDealerKey.has(key)) continue;
  seenDealerKey.add(key);
  dealers.push(d);
}
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
  const resolvedUrl = result.url || result.fetchedUrl || null;
  // Detect-only: the identity extraction never fetches anything itself —
  // it just reads the body http_probe.js already pulled down for
  // classification, when the response was NONE/clean.
  const observed = extractDealerIdentity(result.body, result.httpStatus);
  const domainDrift = detectDomainDrift(d.domain, resolvedUrl);
  const nameDrift = detectNameDrift(d.name, observed.name);
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
    url: resolvedUrl,
    ready: result.classification === 'NONE' && Number(result.httpStatus) === 200 ? 'Y' : 'N',
    domainDrift,
    nameDrift,
  };
  rows.push(row);
  if (domainDrift || nameDrift) {
    console.log(`    drift: ${domainDrift ? `domain ${domainDrift.configured} -> ${domainDrift.resolved}` : ''}${domainDrift && nameDrift ? '; ' : ''}${nameDrift ? `name "${nameDrift.configured}" -> "${nameDrift.observed}"` : ''}`);
  }
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
  driftFlagged: rows
    .filter((r) => r.domainDrift || r.nameDrift)
    .map((r) => ({
      brand: r.brand,
      dealerName: r.dealerName,
      domain: r.domain,
      state: r.state,
      domainDrift: r.domainDrift,
      nameDrift: r.nameDrift,
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
console.log(`Domain/name drift flagged: ${report.driftFlagged.length}`);
console.log('No WAF/captcha/challenge bypass was attempted.');
