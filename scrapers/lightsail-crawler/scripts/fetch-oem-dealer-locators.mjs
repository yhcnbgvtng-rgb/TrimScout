#!/usr/bin/env node
// Fetch official OEM dealer-locator pages/APIs for IN brands.
// Detect-only: never spoof a browser, never retry a 403 with a different
// client, never invent brandofcity.com hosts.
//
// Writes dealers/oem-dumps/<brand>.json plus _status.json.
// Re-run on Lightsail if Honda/Acura/BMW return 403 from this IP.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFromUrl, isOemMarketingHost } from '../src/oem_locator.js';
import { normalizeDealerHost } from '../src/nj_verified_domains.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dealers', 'oem-dumps');
const UA = 'Mozilla/5.0 (compatible; TrimScout-locator/1.0; +https://github.com/yhcnbgvtng-rgb/TrimScout)';
const TIMEOUT_MS = 15000;

function hostOf(url) {
  return hostFromUrl(url) || normalizeDealerHost(url);
}

function row({ make, name, city, state, domain, lat = null, lng = null, sourceUrl = null }) {
  const host = hostOf(domain);
  if (!host || isOemMarketingHost(host) || !name || !state) return null;
  return {
    make,
    name: String(name).trim(),
    city: city ? String(city).trim() : null,
    state: String(state).trim().toUpperCase(),
    domain: host,
    lat,
    lng,
    source: 'oem-locator',
    sourceUrl,
  };
}

async function fetchText(url, { accept = 'text/html,application/json;q=0.9,*/*;q=0.8', referer } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: accept,
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url };
  } catch (err) {
    return { ok: false, status: 0, text: '', url, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts) {
  const got = await fetchText(url, { accept: 'application/json,text/plain,*/*', ...opts });
  if (!got.ok) return { ...got, json: null };
  try {
    return { ...got, json: JSON.parse(got.text) };
  } catch (err) {
    return { ...got, json: null, error: err.message };
  }
}

function uniqRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const key = `${r.make}|${r.state}|${r.name}|${r.domain}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => {
    const s = a.state.localeCompare(b.state);
    if (s) return s;
    return a.name.localeCompare(b.name);
  });
}

async function writeDump(brand, rows, status) {
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dest = path.join(OUT_DIR, `${slug}.json`);
  await fs.writeFile(dest, `${JSON.stringify(uniqRows(rows), null, 2)}\n`);
  return { brand, dest: path.relative(ROOT, dest), count: uniqRows(rows).length, ...status };
}

function parseToyotaCards(html, sourceUrl) {
  const rows = [];
  for (const card of html.split('class="dealer-card"').slice(1)) {
    const name = card.match(/dealer-card__title-heading">([^<]+)/)?.[1]?.trim();
    const addr = (card.match(/dealer-card__title-subHeading">\s*([^<]+)/)?.[1] || '').replace(/\s+/g, ' ').trim();
    const site = card.match(/data-aa-action="km-dealer-visit_site"[^>]*data-primary-href="(https?:\/\/[^"?]+)/)?.[1]
      || card.match(/data-primary-href="(https?:\/\/[^"?]+)"[^>]*data-aa-action="km-dealer-visit_site"/)?.[1]
      || card.match(/href="(https?:\/\/(?!www\.google)[^"?]+)\?intsrc=tcom:dealerlisting:dealervisit/)?.[1];
    const m = addr.match(/,\s*([^,]+),\s*([A-Z]{2}),\s*(\d{5})/);
    if (!name || !site || !m) continue;
    const rec = row({
      make: 'Toyota',
      name,
      city: m[1],
      state: m[2],
      domain: site,
      sourceUrl,
    });
    if (rec && (rec.state === 'NJ' || rec.state === 'NY')) rows.push(rec);
  }
  return rows;
}

async function fetchToyota() {
  const cities = [
    'new-jersey/avenel',
    'new-jersey/cherry-hill',
    'new-jersey/vineland',
    'new-jersey/turnersville',
    'new-jersey/mays-landing',
    'new-york/brooklyn',
    'new-york/buffalo',
    'new-york/rochester',
    'new-york/syracuse',
    'new-york/albany',
    'new-york/binghamton',
    'new-york/yonkers',
    'new-york/white-plains',
  ];
  const rows = [];
  const pages = [];
  for (const slug of cities) {
    const url = `https://www.toyota.com/dealers/${slug}/dealers/`;
    const got = await fetchText(url);
    pages.push({ url, status: got.status, ok: got.ok });
    if (got.ok) rows.push(...parseToyotaCards(got.text, url));
  }
  const njNy = rows.filter((r) => r.state === 'NJ' || r.state === 'NY');
  return writeDump('toyota', njNy, {
    locator: 'https://www.toyota.com/dealers/directory/',
    note: 'Official Toyota dealer-hub city pages (dealer-card websites).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

async function fetchLexus() {
  const url = 'https://www.lexus.com/rest/lexus/dealers';
  const got = await fetchJson(url, { referer: 'https://www.lexus.com/dealers' });
  const dealers = got.json?.dealers || [];
  const rows = [];
  for (const d of dealers) {
    const addr = d.dealerAddress || {};
    if (addr.state !== 'NJ' && addr.state !== 'NY') continue;
    rows.push(row({
      make: 'Lexus',
      name: d.dealerName,
      city: addr.city,
      state: addr.state,
      domain: d.dealerSiteUrl,
      lat: d.dealerLatitude ?? null,
      lng: d.dealerLongitude ?? null,
      sourceUrl: url,
    }));
  }
  return writeDump('lexus', rows, {
    locator: url,
    note: 'Official Lexus REST dealer directory.',
    httpStatus: got.status,
    blocked: got.status === 403,
    nationwideCount: dealers.length,
  });
}

async function fetchMercedes() {
  const zips = [
    '07004', '07024', '07030', '07052', '07701', '07739', '07860',
    '08034', '08096', '08234', '08648', '08807', '08902',
    '10001', '10301', '10451', '10940', '11201', '11501', '11743',
    '12205', '12601', '13212', '13501', '13901', '14221', '14623', '14850',
  ];
  const rows = [];
  const pages = [];
  for (const zip of zips) {
    const url = `https://nafta-service.mbusa.com/api/dlrsrv/v1/dealers?zip=${zip}&distance=120&filter=mbdealer&country=us&language=en`;
    const got = await fetchJson(url, { referer: 'https://www.mbusa.com/en/dealers' });
    pages.push({ zip, status: got.status, ok: got.ok });
    for (const d of got.json?.dealers || []) {
      const addr = (d.address || [])[0] || {};
      if (addr.state !== 'NJ' && addr.state !== 'NY') continue;
      rows.push(row({
        make: 'Mercedes-Benz',
        name: d.name,
        city: addr.city,
        state: addr.state,
        domain: d.url,
        lat: addr.location?.lat ? Number(addr.location.lat) : null,
        lng: addr.location?.lng ? Number(addr.location.lng) : null,
        sourceUrl: url,
      }));
    }
  }
  return writeDump('mercedes-benz', rows, {
    locator: 'https://www.mbusa.com/en/dealers',
    note: 'Official MBUSA dealerLocatorService (zip + distance + mbdealer filter).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

function parseMitsubishi(html, sourceUrl) {
  const rows = [];
  const dealerRe = /"(Dealer_\d+)":\{[^{}]*?"name":"([^"]+)"[^{}]*?"url":"([^"]+)"/g;
  const dealers = new Map();
  let m;
  while ((m = dealerRe.exec(html))) {
    dealers.set(m[1], { id: m[1], name: m[2], url: m[3] });
  }
  const addrRe = /"\$(Dealer_\d+)\.address":\{[^{}]*?"addressLine2":"([^"]*)"[^{}]*?"addressLine3":"([^"]*)"[^{}]*?"postalArea":"([^"]*)"/g;
  while ((m = addrRe.exec(html))) {
    const d = dealers.get(m[1]);
    if (!d) continue;
    d.city = m[2];
    d.state = m[3];
    d.zip = m[4];
  }
  for (const d of dealers.values()) {
    const state = String(d.state || '').toUpperCase();
    if (state !== 'NJ' && state !== 'NY') continue;
    const name = d.name || '';
    if (/parts depot|parts only/i.test(name)) continue;
    if (!/mitsubishi/i.test(name) && /subaru|toyota|honda|nissan/i.test(name)) continue;
    rows.push(row({
      make: 'Mitsubishi',
      name: d.name,
      city: d.city,
      state,
      domain: d.url,
      sourceUrl,
    }));
  }
  return rows;
}

async function fetchMitsubishi() {
  const url = 'https://www.mitsubishicars.com/dealers';
  const got = await fetchText(url);
  const rows = got.ok ? parseMitsubishi(got.text, url) : [];
  return writeDump('mitsubishi', rows, {
    locator: url,
    note: 'Official Mitsubishi dealers page (embedded Apollo dealer cache).',
    httpStatus: got.status,
    blocked: got.status === 403,
  });
}

async function tryBlocked(brand, locator, urls) {
  const pages = [];
  for (const url of urls) {
    const got = await fetchText(url);
    pages.push({ url, status: got.status, ok: got.ok, error: got.error || null });
  }
  return writeDump(brand, [], {
    locator,
    note: 'Official locator blocked or empty from this IP. Do not bypass. Re-run on Lightsail.',
    pages,
    blocked: pages.some((p) => p.status === 403),
  });
}

async function fetchHonda() {
  return tryBlocked('honda', 'https://automobiles.honda.com/tools/dealership-locator', [
    'https://automobiles.honda.com/tools/dealership-locator',
    'https://automobiles.honda.com/platform/api/v1/dealer',
  ]);
}

async function fetchBmw() {
  return tryBlocked('bmw', 'https://www.bmwusa.com/dealer-locator.html', [
    'https://www.bmwusa.com/dealer-locator.html',
  ]);
}

async function fetchMini() {
  return tryBlocked('mini', 'https://www.miniusa.com/dealer-locator.html', [
    'https://www.miniusa.com/dealer-locator.html',
    'https://www.miniusa.com/api/dealers',
  ]);
}

async function fetchKia() {
  return tryBlocked('kia', 'https://www.kia.com/us/en/find-a-dealer', [
    'https://www.kia.com/us/en/find-a-dealer',
    'https://www.kia.com/us/en/find-a-dealer/result?zipCode=07030',
  ]);
}

async function fetchNissan() {
  return tryBlocked('nissan', 'https://www.nissanusa.com/dealer-locator.html', [
    'https://www.nissanusa.com/dealer-locator.html',
  ]);
}

async function fetchInfiniti() {
  return tryBlocked('infiniti', 'https://www.infinitiusa.com/dealer-locator.html', [
    'https://www.infinitiusa.com/dealer-locator.html',
  ]);
}

async function fetchSubaru() {
  return tryBlocked('subaru', 'https://www.subaru.com/find-a-retailer.html', [
    'https://www.subaru.com/find-a-retailer.html',
    'https://www.subaru.com/services/dealers',
  ]);
}

async function fetchMazda() {
  return tryBlocked('mazda', 'https://www.mazdausa.com/shopping-tools/find-a-dealer', [
    'https://www.mazdausa.com/shopping-tools/find-a-dealer',
  ]);
}

async function fetchVolkswagen() {
  return tryBlocked('volkswagen', 'https://www.vw.com/en/dealer-locator.html', [
    'https://www.vw.com/en/dealer-locator.html',
  ]);
}

async function fetchAudi() {
  return tryBlocked('audi', 'https://www.audiusa.com/us/web/en/dealer-locator.html', [
    'https://www.audiusa.com/us/web/en/dealer-locator.html',
  ]);
}

async function fetchVolvo() {
  return tryBlocked('volvo', 'https://www.volvocars.com/us/dealers/', [
    'https://www.volvocars.com/us/dealers/',
    'https://www.volvocars.com/us/api/dealers',
  ]);
}

async function copyInRepo(brand, file, make) {
  const src = path.join(ROOT, file);
  let parsed = [];
  try {
    parsed = JSON.parse(await fs.readFile(src, 'utf-8'));
  } catch {
    parsed = [];
  }
  const rows = [];
  for (const raw of Array.isArray(parsed) ? parsed : []) {
    const state = String(raw.state || '').toUpperCase();
    if (state !== 'NJ' && state !== 'NY') continue;
    rows.push(row({
      make: make || raw.make,
      name: raw.name,
      city: raw.city,
      state,
      domain: raw.domain,
      lat: raw.lat ?? null,
      lng: raw.lng ?? null,
      sourceUrl: file,
    }));
  }
  return writeDump(brand, rows, {
    locator: file,
    note: 'In-repo official locator dump (not re-fetched).',
    httpStatus: 200,
    blocked: false,
  });
}

const status = [];

await fs.mkdir(OUT_DIR, { recursive: true });

status.push(await copyInRepo('acura', 'acura-dealers.json', 'Acura'));
status.push(await copyInRepo('porsche', 'dealers.json', 'Porsche'));
status.push(await fetchLexus());
status.push(await fetchToyota());
status.push(await fetchMercedes());
status.push(await fetchMitsubishi());
status.push(await fetchHonda());
status.push(await fetchBmw());
status.push(await fetchMini());
status.push(await fetchKia());
status.push(await fetchNissan());
status.push(await fetchInfiniti());
status.push(await fetchSubaru());
status.push(await fetchMazda());
status.push(await fetchVolkswagen());
status.push(await fetchAudi());
status.push(await fetchVolvo());

await fs.writeFile(path.join(OUT_DIR, '_status.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  detectOnly: true,
  brands: status,
}, null, 2)}\n`);

for (const s of status) {
  console.log(`${s.brand}: ${s.count} NJ+NY rows  ${s.blocked ? 'BLOCKED' : 'ok'}  ${s.note}`);
}
