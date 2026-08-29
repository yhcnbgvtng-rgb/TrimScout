// McLaren inventory crawler — deliberately NOT built on standalone.js's
// per-dealer sitemap-crawl loop. McLaren's ~30 North American retailers
// don't each run an independent inventory site; all of their Qualified
// (certified pre-owned) stock is served from one shared official platform,
// preowned.mclaren.com, searchable per-country with no dealer filter
// needed (https://preowned.mclaren.com/amn/{us|ca}/en/vehicles, paginated
// as .../page2, .../page3, ...). Each result links to a detail page
// (.../vehicles/{slug}) that embeds the real VIN, price, mileage, colors,
// and selling retailer name directly in server-rendered HTML — confirmed
// live this session, no bot-blocking (plain fetch, no patchright needed).
//
// Scale is tiny by this codebase's standards (~90-120 vehicles total across
// both countries, vs. hundreds of dealers / thousands of vehicles for the
// mass-market brands), so this file skips standalone.js's snapshot/diff
// machinery in favor of a small self-contained one (see loadSnapshot/
// diffAgainstSnapshot below) rather than force-fitting a per-dealer loop
// onto a brand that doesn't have one.

import fs from 'node:fs/promises';
import path from 'node:path';
import { getBrand } from './brands.js';
import {
  upsertBrand,
  upsertDealers,
  startScrapeRun,
  finishScrapeRun,
  syncInventoryToDatabase,
  closePool,
} from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const DEALERS_FILE = process.env.MCLAREN_DEALERS_FILE || 'mclaren_dealers.json';
const SNAPSHOT_PATH = path.resolve(process.cwd(), 'data', 'mclaren_snapshot.json');
const COUNTRIES = [
  { code: 'us', path: 'amn/us/en/vehicles' },
  { code: 'ca', path: 'amn/ca/en/vehicles' },
];

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractDetailUrls(html, origin) {
  const urls = new Set();
  const re = /<article id="vehicle-[^"]*"[\s\S]*?<a href="(\/amn\/[a-z]{2}\/en\/vehicles\/[a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    urls.add(origin + m[1]);
  }
  return [...urls];
}

// The platform renders each spec as a label/value span pair:
// <span class="inline-block key ...">Model year</span><span class="inline-block ...">2020</span>
// — confirmed live against real detail pages; the vehicle's core identity
// (VIN, model, price, stock number, selling retailer + address/phone,
// engine displacement/fuel type) lives separately in a clean schema.org
// "car" JSON-LD block, which is the authoritative source for those fields.
function extractSpanValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`class="inline-block key[^"]*">${escaped}</span><span class="inline-block[^"]*">([\\s\\S]*?)</span>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractJsonLdCar(html) {
  const idx = html.indexOf('"@type":"car"');
  if (idx === -1) return null;
  const start = html.lastIndexOf("<script type='application/ld+json'>", idx);
  const end = html.indexOf('</script>', start);
  if (start === -1 || end === -1) return null;
  const block = html.slice(start, end);
  const jsonStart = block.indexOf('{');
  try {
    return JSON.parse(block.slice(jsonStart));
  } catch {
    return null;
  }
}

function parseDetailPage(html, url) {
  const car = extractJsonLdCar(html);
  const vin = car?.vehicleIdentificationNumber ? car.vehicleIdentificationNumber.toUpperCase() : null;
  if (!vin || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;

  const yearText = extractSpanValue(html, 'Model year');
  const year = yearText ? Number(yearText) : null;

  const mileageText = extractSpanValue(html, 'Mileage');
  const mileageMatch = mileageText ? mileageText.match(/([\d,]+)\s*(miles|km)/i) : null;
  const mileage = mileageMatch
    ? Math.round(Number(mileageMatch[1].replace(/,/g, '')) * (mileageMatch[2].toLowerCase() === 'km' ? 0.621371 : 1))
    : 0;

  const interiorColor = extractSpanValue(html, 'Interior');
  const powerText = extractSpanValue(html, 'Power');
  const powerMatch = powerText ? powerText.match(/(\d+)\s*hp/i) : null;
  const displacement = car?.vehicleEngine?.engineDisplacement;
  const engine = [
    powerMatch ? `${powerMatch[1]} hp` : null,
    displacement ? `${displacement}cc` : null,
    car?.vehicleEngine?.fuelType || null,
  ].filter(Boolean).join(' / ') || null;

  const priceNum = car?.offers?.price ? Number(car.offers.price) : null;
  const image = Array.isArray(car?.image) && car.image.length > 0
    ? new URL(car.image[0], url).href
    : null;

  return {
    vin,
    dealerName: car?.offers?.seller?.name || null,
    stockNumber: car?.sku || null,
    inventoryType: 'USED',
    year: Number.isFinite(year) ? year : null,
    make: 'McLaren',
    model: car?.model || null,
    trim: null,
    bodyStyle: null,
    price: Number.isFinite(priceNum) ? priceNum : null,
    msrp: Number.isFinite(priceNum) ? priceNum : null,
    mileage,
    exteriorColor: car?.color || null,
    interiorColor,
    engine,
    transmission: null,
    dealerListedOptions: [],
    imageUrl: image,
    url,
  };
}

async function loadSnapshot() {
  try {
    return JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveSnapshot(snapshot) {
  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
}

function applyDiff(record, prevSnapshot, todayDate) {
  const prev = prevSnapshot[record.vin];
  let changeType = 'UNCHANGED';
  let oldPrice = null;
  let priceDiff = 0;
  let firstSeen = todayDate;
  let daysOnLot = 0;

  if (!prev) {
    changeType = 'NEW_ARRIVAL';
  } else {
    firstSeen = prev.firstSeen || todayDate;
    daysOnLot = Math.max(0, Math.floor((Date.now() - new Date(firstSeen).getTime()) / 86400000));
    if (typeof prev.price === 'number' && typeof record.price === 'number' && prev.price !== record.price) {
      oldPrice = prev.price;
      priceDiff = record.price - prev.price;
      changeType = priceDiff < 0 ? 'PRICE_DROP' : 'PRICE_INCREASE';
    }
  }

  return {
    ...record,
    changeType,
    oldPrice,
    priceDiff,
    firstSeen,
    lastSeen: todayDate,
    daysOnLot,
    status: 'ACTIVE',
  };
}

async function main() {
  const brand = getBrand('McLaren');
  const dealersRaw = JSON.parse(await fs.readFile(path.resolve(process.cwd(), DEALERS_FILE), 'utf-8'));
  const dealers = dealersRaw.map((d) => ({
    id: d.id,
    name: d.name,
    city: d.city,
    state: d.state,
    domain: d.domain,
    lat: d.lat,
    lng: d.lng,
  }));
  // Lookup keyed by every real display name a vehicle's detail page might
  // show for a dealer, normalized — covers the one known reversed-order
  // case ("The Collection McLaren" retailer shows as "McLaren The
  // Collection" in the API but "The Collection McLaren" on vehicle pages).
  const dealerByDisplayName = new Map();
  for (const d of dealersRaw) {
    dealerByDisplayName.set(d.name.trim().toLowerCase(), d.name);
    if (d.altName) dealerByDisplayName.set(d.altName.trim().toLowerCase(), d.name);
  }

  console.log('====================================================');
  console.log('🏎️  McLAREN NORTH AMERICA TRACKER');
  console.log(`Retailers configured: ${dealers.length}`);
  console.log('====================================================\n');

  const brandId = await upsertBrand('mclaren', 'McLaren');
  await upsertDealers(brandId, dealers);
  const runId = await startScrapeRun(brandId, dealers.length);

  const prevSnapshot = await loadSnapshot();
  const todayDate = new Date().toISOString().slice(0, 10);
  const allRecords = [];
  let unmatchedDealerNames = new Set();

  for (const country of COUNTRIES) {
    const origin = 'https://preowned.mclaren.com';
    let page = 1;
    let detailUrls = [];
    while (true) {
      const listUrl = page === 1
        ? `${origin}/${country.path}?sort=price:ASC`
        : `${origin}/${country.path}/page${page}?sort=price:ASC`;
      const html = await fetchText(listUrl);
      if (!html) break;
      const urls = extractDetailUrls(html, origin);
      if (urls.length === 0) break;
      detailUrls.push(...urls);
      console.log(`[${country.code.toUpperCase()}] page ${page}: ${urls.length} listings (running total: ${detailUrls.length})`);
      page++;
      await new Promise((r) => setTimeout(r, 300));
      if (page > 25) break; // sanity cap, not expected to hit at this brand's scale
    }
    detailUrls = [...new Set(detailUrls)];
    console.log(`[${country.code.toUpperCase()}] ${detailUrls.length} total unique vehicle detail pages.\n`);

    for (const url of detailUrls) {
      const html = await fetchText(url);
      if (!html) continue;
      const record = parseDetailPage(html, url);
      if (!record || !record.vin) continue;

      const normalizedName = (record.dealerName || '').trim().toLowerCase();
      const configName = dealerByDisplayName.get(normalizedName);
      if (!configName) {
        unmatchedDealerNames.add(record.dealerName || '(none found)');
      }
      record.configDealerName = configName || record.dealerName;
      allRecords.push(applyDiff(record, prevSnapshot, todayDate));
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n✅ Extracted ${allRecords.length} vehicles total.`);
  if (unmatchedDealerNames.size > 0) {
    console.log(`⚠️  Dealer names seen on vehicle pages with no exact config match (used as-is): ${[...unmatchedDealerNames].join(', ')}`);
  }

  const newSnapshot = {};
  for (const r of allRecords) {
    newSnapshot[r.vin] = { price: r.price, firstSeen: r.firstSeen };
  }
  await saveSnapshot(newSnapshot);

  const stats = {
    dealersActive: new Set(allRecords.map((r) => r.configDealerName)).size,
    dealersErrored: 0,
    totalVehicles: allRecords.length,
    newArrivals: allRecords.filter((r) => r.changeType === 'NEW_ARRIVAL').length,
    priceDrops: allRecords.filter((r) => r.changeType === 'PRICE_DROP').length,
    priceIncreases: allRecords.filter((r) => r.changeType === 'PRICE_INCREASE').length,
    soldOrRemoved: 0,
  };

  try {
    const syncStats = await syncInventoryToDatabase(brandId, allRecords, { runId });
    console.log('DB sync stats:', JSON.stringify(syncStats));
  } catch (err) {
    console.error('DB sync failed:', err.message);
    await finishScrapeRun(runId, stats, err.message);
    await closePool();
    process.exit(1);
  }

  await finishScrapeRun(runId, stats);
  await closePool();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await closePool();
  process.exit(1);
});
