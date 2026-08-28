import { chromium } from 'patchright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runEnrichmentPipeline } from './enricher.js';
import { getBrand } from './brands.js';

// Alternate Porsche discovery path: instead of scraping each dealer's own
// (often bot-protected) website, this queries Porsche's own official
// nationwide inventory search (finder.porsche.com) — one source instead of
// 215, and one Porsche isn't going to permanently block itself from. Plain
// HTTP (got-scraping) still gets a "Vercel Security Checkpoint" 429 from
// this box's IP even against Finder itself — confirmed live — but a
// stealth-patched headless browser (patchright, a Playwright fork that
// removes the automation fingerprints that flagged plain Playwright with
// "Failed to verify your browser") reliably gets through, still from the
// same box/IP. Reuses the exact diff/sold/snapshot/DB-sync tail from
// standalone.js so this is a drop-in alternative discovery mechanism, not
// a parallel, uncoordinated pipeline.

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const CHANGES_DIR = path.join(DATA_DIR, 'daily_changes');
const LATEST_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, 'latest_snapshot.json');

await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
await fs.mkdir(CHANGES_DIR, { recursive: true });

const dealersPath = path.resolve(process.cwd(), process.env.CRAWLER_DEALERS_FILE || 'dealers.json');
const dealers = JSON.parse(await fs.readFile(dealersPath, 'utf-8'));
const brand = getBrand(process.env.CRAWLER_BRAND || 'Porsche');

// dealers.json must carry real lat/lng per dealer (one-time geocoded via
// scripts/geocode_dealers.mjs — state-centroid precision isn't tight enough
// for Finder's position=City,lat,lng,radiusMiles search). Dealers missing
// coordinates are skipped as search origins; their inventory can still
// surface via a neighboring dealer's radius since dedup is by VIN, not by
// which query found a vehicle.

console.log('====================================================');
console.log(`🏎️ ${brand.name.toUpperCase()} FINDER-BASED NATIONWIDE TRACKER`);
console.log(`Search origins (configured dealers): ${dealers.length}`);
console.log('====================================================\n');

let previousSnapshot = {};
try {
    previousSnapshot = JSON.parse(await fs.readFile(LATEST_SNAPSHOT_PATH, 'utf-8'));
    console.log(`Loaded previous baseline: ${Object.keys(previousSnapshot).length} vehicles.`);
} catch {
    console.log('No previous baseline found. Starting fresh initial scan.');
}

let dbBrandId = null;
let dbRunId = null;
try {
    const dbMod = await import('./db.js');
    if (process.env.DB_HOST) {
        dbBrandId = await dbMod.upsertBrand(brand.name.toLowerCase(), brand.name);
        await dbMod.upsertDealers(dbBrandId, dealers);
        dbRunId = await dbMod.startScrapeRun(dbBrandId, dealers.length);
        console.log(`💾 DB scrape_run started: id=${dbRunId} (brand_id=${dbBrandId})`);
    } else {
        console.log('DB_HOST not set — skipping database run-tracking.');
    }
} catch (dbErr) {
    console.error('DB run-tracking start failed (non-fatal):', dbErr.message);
}

function cleanString(val) {
    if (!val || val === 'null' || val === 'undefined' || val === 'NULL' || val === 'None') return null;
    const str = val.toString().trim();
    return str === '' || str === 'null' ? null : str;
}

function cleanPrice(val) {
    if (val === null || val === undefined) return null;
    const num = typeof val === 'number' ? val : parseFloat(val.toString().replace(/[^\d.]/g, ''));
    if (isNaN(num) || num <= 0 || num >= 5000000 || num === 2147483647) return null;
    return Math.round(num);
}

// Maps one Finder ItemList "Car" JSON-LD entry to our shared vehicle record
// shape. Real, per-VIN, per-dealer data straight from Porsche's own system
// — no guessing, no cross-referencing.
function mapFinderCarToVehicle(item) {
    const vin = cleanString(item.vehicleIdentificationNumber);
    if (!vin || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;

    const offers = item.offers || {};
    const seller = offers.seller || {};
    const address = seller.address || {};
    const price = cleanPrice(offers.price);
    const yearStr = item.vehicleModelDate || item.modelDate;
    const year = yearStr ? parseInt(String(yearStr).slice(0, 4), 10) : null;
    const isUsed = /UsedCondition/i.test(offers.itemCondition || item.itemCondition || '');

    return {
        vin: vin.toUpperCase(),
        dealerName: cleanString(seller.name) || 'Unknown Porsche Center',
        configDealerName: cleanString(seller.name) || 'Unknown Porsche Center',
        city: cleanString(address.addressLocality),
        state: null, // Finder's seller.address doesn't expose state directly; backfilled from our dealers.json list below.
        stockNumber: null,
        inventoryType: isUsed ? 'USED' : 'NEW',
        year: Number.isFinite(year) ? year : null,
        make: 'Porsche',
        model: cleanString(item.name),
        trim: cleanString(item.vehicleConfiguration) !== cleanString(item.name) ? cleanString(item.vehicleConfiguration) : null,
        bodyStyle: cleanString(item.bodyType),
        price,
        msrp: price,
        mileage: item.mileageFromOdometer?.value ? Math.round(item.mileageFromOdometer.value) : 0,
        exteriorColor: cleanString(item.color),
        interiorColor: cleanString(item.vehicleInteriorColor),
        engine: cleanString(item.vehicleEngine?.fuelType),
        transmission: cleanString(item.vehicleTransmission),
        dealerListedOptions: [],
        imageUrl: cleanString(item.image),
        url: cleanString(offers.url),
    };
}

// Fetches one search results page and returns its Car items (or throws).
// Separated from the retry/pagination logic below so a mistimed challenge
// (Vercel's checkpoint occasionally hasn't finished resolving by the time
// we read the DOM — confirmed live: a legitimately-stocked dealer returned
// a clean "0 vehicles" once, indistinguishable from real emptiness without
// a retry) can be retried on its own terms.
async function fetchFinderPage(context, url, waitMs) {
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(waitMs);
        const ldBlocks = await page.evaluate(() =>
            [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent)
        );
        const pageCars = [];
        for (const block of ldBlocks) {
            try {
                const parsed = JSON.parse(block);
                const items = Array.isArray(parsed.itemListElement) ? parsed.itemListElement : [];
                for (const item of items) {
                    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                    if (types.includes('Car')) pageCars.push(item);
                }
            } catch {
                // not the ItemList block, skip
            }
        }
        return pageCars;
    } finally {
        await page.close();
    }
}

// One Finder search: a (city, lat, lng, radiusMiles) origin, paginated
// until a page returns no new Car entries. Returns raw mapped vehicles;
// caller dedupes by VIN.
async function searchFinderOrigin(context, originLabel, position, maxPages = 20) {
    const found = [];
    let sawAnyPage = false;
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `https://finder.porsche.com/us/en-US/search?position=${encodeURIComponent(position)}&page=${pageNum}`;
        let pageCars = null;
        // Up to 3 attempts per page, with a longer settle time each retry —
        // covers both a slow-to-resolve challenge and a one-off navigation
        // race (evaluate running mid-redirect).
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                pageCars = await fetchFinderPage(context, url, 3500 * attempt);
                break;
            } catch (err) {
                console.log(`  ⚠️ ${originLabel} page ${pageNum} attempt ${attempt} failed: ${err.message.split('\n')[0]}`);
            }
        }
        if (pageCars === null) continue; // every attempt failed; try the next page rather than aborting the whole origin
        sawAnyPage = true;
        // A first page with zero cars and no thrown error is ambiguous (the
        // dealer/area may genuinely have nothing in range, or the page may
        // have rendered before the checkpoint's JS challenge finished) — one
        // extra, more patient retry before accepting it as real.
        if (pageCars.length === 0 && pageNum === 1) {
            try {
                pageCars = await fetchFinderPage(context, url, 9000);
            } catch {
                // leave pageCars as the empty result from the first attempt
            }
        }
        if (pageCars.length === 0) break; // no more pages
        for (const raw of pageCars) {
            const v = mapFinderCarToVehicle(raw);
            if (v) found.push(v);
        }
    }
    return { vehicles: found, ok: sawAnyPage };
}

const currentInventory = new Map();
const todayDate = new Date().toISOString().slice(0, 10);
const todayIso = new Date().toISOString();
const dealerStats = {};
const failedDealerNames = new Set();
let activeDealersCount = 0;
let erroredDealersCount = 0;

// Known Porsche dealer city -> approximate coordinates, filled in from
// dealers.json entries that already carry lat/lng if present; otherwise
// this dealer is skipped as a search origin (its inventory can still
// surface via a nearby dealer's radius).
// A smaller radius keeps each query's result count manageable in dense
// metros (confirmed live: 60mi around SF/LA-area dealers hit the page cap
// repeatedly) without losing coverage — every one of our 215 dealers is
// already its own search origin, so a tighter radius just means more
// (cheap, VIN-deduped) overlap between neighboring dealers' queries rather
// than any gap.
const RADIUS_MILES = Number(process.env.FINDER_RADIUS_MILES) || 30;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
});

const dealersWithCoords = dealers.filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number');
console.log(`Dealers with usable lat/lng for search origins: ${dealersWithCoords.length}/${dealers.length}`);

for (let i = 0; i < dealersWithCoords.length; i++) {
    const dealer = dealersWithCoords[i];
    const progress = `[${i + 1}/${dealersWithCoords.length}]`;
    const position = `${dealer.city},${dealer.lat},${dealer.lng},${RADIUS_MILES}`;
    console.log(`${progress} 🔎 Searching near ${dealer.name} (${dealer.city}, ${dealer.state})...`);

    try {
        const { vehicles, ok } = await searchFinderOrigin(context, dealer.name, position);
        if (!ok) {
            erroredDealersCount++;
            failedDealerNames.add(dealer.name);
            console.log(`${progress} ❌ Search failed entirely for ${dealer.name}.`);
        } else {
            let newCount = 0;
            for (const v of vehicles) {
                // Finder's own seller.name is real per-vehicle data, but it
                // won't always string-match our configured dealer name
                // exactly (punctuation/suffix differences) — and unlike the
                // dealer-sitemap crawler, there's no guarantee it matches
                // *any* of our 215 configured dealers at all (radius search
                // can surface a real Porsche center we haven't configured).
                // configDealerName previously duplicated dealerName, which
                // defeated syncInventoryToDatabase's own name-mismatch
                // fallback (confirmed live: 85/318 vehicles silently
                // dropped as skippedNoDealer in the first validation run).
                // Point it at the actual search-anchor dealer instead, so a
                // real DB dealer_id always resolves.
                const matched = dealers.find((d) => d.name === v.dealerName);
                if (matched) {
                    v.state = matched.state;
                } else {
                    v.configDealerName = dealer.name;
                    v.state = v.state || dealer.state;
                }
                if (!currentInventory.has(v.vin)) newCount++;
                currentInventory.set(v.vin, v);
            }
            dealerStats[dealer.name] = vehicles.length;
            if (vehicles.length > 0) activeDealersCount++;
            console.log(`${progress} ✅ ${vehicles.length} vehicles seen (${newCount} new). Running total: ${currentInventory.size}`);
        }
    } catch (err) {
        erroredDealersCount++;
        failedDealerNames.add(dealer.name);
        console.error(`${progress} ❌ Error searching near ${dealer.name}: ${err.message}`);
    }

    try {
        await fs.writeFile(
            path.join(DATA_DIR, 'checkpoint_raw_inventory.json'),
            JSON.stringify(Array.from(currentInventory.values()), null, 2)
        );
    } catch {}
}

await browser.close();

console.log(`\n🎉 Finder-Based Crawl Complete!`);
console.log(`Total Live Vehicles Tracked: ${currentInventory.size}`);

// --- Same diff / sold / snapshot / DB-sync tail as standalone.js --------
const updatedSnapshot = {};
const priceDrops = [];
const priceIncreases = [];
const newArrivals = [];
const soldVehicles = [];
const allRecords = [];

for (const [vin, cur] of currentInventory.entries()) {
    const prev = previousSnapshot[vin];
    let changeType = 'UNCHANGED';
    let priceDiff = 0;
    let oldPrice = null;
    let daysOnLot = 0;
    let firstSeen = todayDate;
    let priceHistory = [];

    if (!prev) {
        changeType = 'NEW_ARRIVAL';
        priceHistory = cur.price ? [{ date: todayDate, price: cur.price }] : [];
        newArrivals.push(cur);
    } else {
        firstSeen = prev.firstSeen || todayDate;
        priceHistory = prev.priceHistory || [];
        const prevFirst = new Date(firstSeen).getTime();
        const now = new Date(todayDate).getTime();
        daysOnLot = Math.max(0, Math.floor((now - prevFirst) / (1000 * 60 * 60 * 24)));

        if (cur.price && prev.price && cur.price !== prev.price) {
            priceDiff = cur.price - prev.price;
            oldPrice = prev.price;
            priceHistory.push({ date: todayDate, price: cur.price });
            if (priceDiff < 0) {
                changeType = 'PRICE_DROP';
                priceDrops.push({ ...cur, oldPrice, priceDiff, daysOnLot });
            } else {
                changeType = 'PRICE_INCREASE';
                priceIncreases.push({ ...cur, oldPrice, priceDiff, daysOnLot });
            }
        }
    }

    const record = { ...cur, oldPrice, priceDiff, daysOnLot, firstSeen, lastSeen: todayDate, changeType, priceHistory, status: 'ACTIVE', updatedAt: todayIso };
    updatedSnapshot[vin] = record;
    allRecords.push(record);
}

for (const [vin, prev] of Object.entries(previousSnapshot)) {
    if (!currentInventory.has(vin) && prev.status === 'ACTIVE') {
        const dealerKey = prev.configDealerName || prev.dealerName;
        if (failedDealerNames.has(dealerKey)) {
            updatedSnapshot[vin] = prev;
            allRecords.push(prev);
            continue;
        }
        const soldRecord = { ...prev, status: 'SOLD_OR_REMOVED', changeType: 'SOLD', soldDate: todayDate, lastSeen: todayDate, updatedAt: todayIso };
        updatedSnapshot[vin] = soldRecord;
        soldVehicles.push(soldRecord);
        allRecords.push(soldRecord);
    }
}

const dailySummary = {
    date: todayDate,
    timestamp: todayIso,
    totalDealersConfigured: dealers.length,
    activeDealersCount,
    stats: {
        totalActiveInventory: currentInventory.size,
        totalNewArrivals: newArrivals.length,
        totalPriceDrops: priceDrops.length,
        totalPriceIncreases: priceIncreases.length,
        totalSoldOrRemoved: soldVehicles.length,
    },
    topPriceDrops: priceDrops.sort((a, b) => a.priceDiff - b.priceDiff).slice(0, 50),
    dealerBreakdown: dealerStats,
};

await fs.writeFile(LATEST_SNAPSHOT_PATH, JSON.stringify(updatedSnapshot, null, 2));
await fs.writeFile(path.join(DATA_DIR, 'national_inventory_latest.json'), JSON.stringify(allRecords, null, 2));
await fs.writeFile(path.join(DATA_DIR, 'inventory_latest.json'), JSON.stringify(allRecords, null, 2));
await fs.writeFile(path.join(CHANGES_DIR, `daily_changes_${todayDate}.json`), JSON.stringify(dailySummary, null, 2));

console.log('\n====================================================');
console.log(`📊 FINDER-BASED PORSCHE MARKET SUMMARY (${todayDate})`);
console.log(`Active Live Inventory:   ${currentInventory.size}`);
console.log(`New Arrivals Today:     ${newArrivals.length}`);
console.log(`Price Drops Today:      ${priceDrops.length}`);
console.log(`Sold / Removed Today:   ${soldVehicles.length}`);
console.log('====================================================\n');

try {
    console.log('⚡ Triggering automatic spec enrichment pipeline...');
    await runEnrichmentPipeline(Infinity, brand, { brandId: dbBrandId, runId: dbRunId });
} catch (enrichErr) {
    console.error('Enrichment step warning:', enrichErr.message);
}

if (dbRunId) {
    try {
        const { finishScrapeRun } = await import('./db.js');
        await finishScrapeRun(dbRunId, {
            dealersActive: activeDealersCount,
            dealersErrored: erroredDealersCount,
            totalVehicles: currentInventory.size,
            newArrivals: newArrivals.length,
            priceDrops: priceDrops.length,
            priceIncreases: priceIncreases.length,
            soldOrRemoved: soldVehicles.length,
        });
        console.log(`💾 DB scrape_run ${dbRunId} marked COMPLETE.`);
    } catch (dbErr) {
        console.error('DB run-tracking finish failed (non-fatal):', dbErr.message);
    }
}

try {
    const { closePool } = await import('./db.js');
    await closePool();
} catch {}
process.exit(0);
