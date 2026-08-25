import { gotScraping } from 'got-scraping';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { runEnrichmentPipeline } from './enricher.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const CHANGES_DIR = path.join(DATA_DIR, 'daily_changes');
const LATEST_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, 'latest_snapshot.json');

await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
await fs.mkdir(CHANGES_DIR, { recursive: true });

const dealersPath = path.resolve(process.cwd(), 'dealers.json');
const dealers = JSON.parse(await fs.readFile(dealersPath, 'utf-8'));

console.log('====================================================');
console.log(`🏎️ PORSCHE ALL-DEALERSHIP NATIONWIDE TRACKER`);
console.log(`Total Authorized Porsche Centers Configured: ${dealers.length}`);
console.log('====================================================\n');

let previousSnapshot = {};
try {
    previousSnapshot = JSON.parse(await fs.readFile(LATEST_SNAPSHOT_PATH, 'utf-8'));
    console.log(`Loaded previous baseline: ${Object.keys(previousSnapshot).length} vehicles.`);
} catch {
    console.log('No previous baseline found. Starting fresh initial scan.');
}

function cleanString(val) {
    if (!val || val === 'null' || val === 'undefined' || val === 'NULL' || val === 'None') return null;
    const str = val.toString().trim();
    return str === '' || str === 'null' ? null : str;
}

// Extracts the real "Included Packages & Options" section from a Dealer.com
// DDC.dataLayer vehicle record — genuine, itemized, per-VIN data as
// published on the dealer's own VDP. Not a guess: if the dealer didn't
// list it, it isn't included here.
function extractDealerListedOptions(raw) {
    const items = [];
    if (!Array.isArray(raw.packages)) return items;

    for (const pkg of raw.packages) {
        // Dealer.com dumps the vehicle's entire baseline standard-equipment
        // catalog (power windows, ABS, cupholders...) into an unnamed
        // bucket (packageName "null", id -1) — but on some dealer sites
        // (confirmed on paulmillerporsche.com, e.g. VIN WP0BB2A99TS258067)
        // that same unnamed bucket also holds real, specifically-installed
        // factory options with genuine dollar prices (e.g. a $3,210 memory
        // seats package). Skipping the whole bucket throws those real
        // options away along with the baseline noise. The reliable signal
        // isn't the package name, it's the price: baseline equipment is
        // always listed at $0 here, real installed options are not — so
        // filter unnamed-bucket items by price instead of dropping the
        // bucket wholesale.
        const isNamedPackage = Boolean(pkg.packageName) && pkg.packageName !== 'null';

        if (isNamedPackage) {
            items.push({
                code: `PKG-${pkg.id ?? pkg.packageName}`,
                name: pkg.packageName,
                price: typeof pkg.msrp === 'number' ? pkg.msrp : 0,
                category: 'package',
            });
        }

        const optionList = Array.isArray(pkg.includedOptionList)
            ? pkg.includedOptionList
            : Array.isArray(pkg.includedOptions)
            ? pkg.includedOptions
            : [];

        for (const opt of optionList) {
            const description = opt.textMap && opt.textMap.description;
            if (!description) continue;
            const price = typeof opt.msrPrice === 'number' ? opt.msrPrice : 0;
            if (!isNamedPackage && price <= 0) continue;
            items.push({
                code: opt.textMap.id && opt.textMap.id !== 'null' ? `OPT-${opt.textMap.id}` : 'OPT',
                name: description,
                price,
                category: 'option',
            });
        }
    }

    const seen = new Set();
    return items.filter((item) => {
        const key = `${item.code}|${item.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Boilerplate that shows up at the end of DealerOn (and similar) VDP
// descriptions, unrelated to the actual vehicle — fees, disclaimers, taxes.
// Everything from the first match onward is dropped before feature parsing.
const DESCRIPTION_BOILERPLATE_MARKERS = [
    /plus government fees/i,
    /dealer document (processing )?charge/i,
    /price does not include/i,
    /see dealer for details/i,
    /\*.*disclaimer/i,
];

// Universal baseline equipment that a standard third-party data provider
// (the same vocabulary appears verbatim across many dealer platforms,
// including the Dealer.com "packageName: null" bucket found earlier) lists
// for every vehicle regardless of trim or options — Air Conditioning, Power
// windows, ABS brakes, etc. Some dealer VDP descriptions dump this entire
// list rather than a curated highlights reel; presenting it as this car's
// distinguishing "installed options" would be exactly the fabrication this
// scraper exists to avoid. Filtered out case-insensitively; whatever
// survives is presumed to be genuinely distinguishing.
const GENERIC_BASELINE_EQUIPMENT = new Set([
    '10 speakers', '4-wheel disc brakes', 'abs brakes', 'adaptive suspension',
    'air conditioning', 'alloy wheels', 'apple carplay & android auto',
    'apple carplay', 'android auto', 'artificial leather seat trim',
    'auto high-beam headlights', 'auto-dimming door mirrors',
    'auto-dimming rear-view mirror', 'auto-leveling suspension',
    'automatic temperature control', 'brake assist', 'bumpers: body-color',
    'compass', 'delay-off headlights', 'driver door bin',
    'driver vanity mirror', 'dual front impact airbags',
    'dual front side impact airbags', 'electronic stability control',
    'exterior parking camera rear', 'four wheel independent suspension',
    'front anti-roll bar', 'front bucket seats', 'front center armrest',
    'front dual zone a/c', 'front reading lights', 'fully automatic headlights',
    'garage door transmitter: homelink', 'heated door mirrors',
    'heated front seats', 'heated steering wheel', 'illuminated entry',
    'knee airbag', 'leather seat trim', 'leather steering wheel',
    'low tire pressure warning', 'memory seat', 'occupant sensing airbag',
    'outside temperature display', 'overhead airbag', 'overhead console',
    'panic alarm', 'passenger door bin', 'passenger vanity mirror',
    'power door mirrors', 'power driver seat', 'power passenger seat',
    'power steering', 'power windows', 'radio data system',
    'rain sensing wipers', 'rear anti-roll bar', 'rear fog lights',
    'rear reading lights', 'rear seat center armrest',
    'rear side impact airbag', 'rear window defroster',
    'remote keyless entry', 'security system', 'speed control',
    'speed-sensing steering', 'split folding rear seat', 'spoiler',
    'steering wheel mounted audio controls', 'telescoping steering wheel',
    'tilt steering wheel', 'traction control', 'trip computer',
    'variably intermittent wipers', 'bluetooth®', 'bluetooth',
    'mp3 player', 'ipod/mp3 input', 'keyless entry',
    'remote trunk release', 'back-up camera', 'satellite radio',
    'navigation', 'nav system', 'porsche communication management',
    'navigation system', 'am/fm radio: siriusxm', 'am/fm radio',
    'rear air conditioning', 'rear window wiper', 'sport steering wheel',
    'tachometer', 'turn signal indicator mirrors',
    'emergency communication system', 'leather shift knob',
    'standard seat trim', 'voltmeter', 'audio memory', 'hvac memory',
]);

// Some descriptions end with a duplicated/truncated title fragment
// ("2026 Porsche Macan S 2026 Porsche Macan") rather than a real feature —
// an artifact of how the field was assembled, not vehicle content.
const SPEAKER_COUNT_PATTERN = /^\d+ speakers$/i;
const DUPLICATED_TITLE_PATTERN = /^\d{4} porsche .+ \d{4} porsche/i;

// Extracts a real, dealer-published feature list from a VDP's free-text
// description field (used on DealerOn and similar platforms). This is
// genuinely written by the dealer for this specific vehicle, but unlike
// Dealer.com's structured packages it has no per-item price or code — just
// names. Represented with price: 0 (unknown, not "free") and a distinct
// category so it's never confused with itemized, priced packages.
//
// Some dealers write flowing marketing prose instead of a feature list
// ("Porsche North Houston is delighted to showcase this Panamera... We
// invite you to Activate Your Ownership with us today!"). Splitting that
// on commas/periods produces sentence fragments, not features — worse than
// no data. These are strong, specific markers that a description is
// marketing narrative rather than a structured list; when present, skip
// extraction entirely rather than emit fragments.
const MARKETING_PROSE_MARKERS = [
    /we invite you/i,
    /activate your ownership/i,
    /is delighted to/i,
    /trade-in proposals/i,
    /finance department/i,
    /detailing department/i,
    /accessories boutique/i,
    /simply call/i,
    /if you like this vehicle/i,
];

function parseFeaturesFromDescription(description) {
    if (!description) return [];
    if (MARKETING_PROSE_MARKERS.some((marker) => marker.test(description))) return [];

    let text = description;
    for (const marker of DESCRIPTION_BOILERPLATE_MARKERS) {
        const idx = text.search(marker);
        if (idx !== -1) text = text.slice(0, idx);
    }

    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/KEY FEATURES INCLUDE/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

    let rawItems = text.split(/[\n,.]/).map((s) => s.trim());

    // Some descriptions mix a genuine bulleted feature list with trailing
    // prose in the same field ("- Sport Chrono Package ... The vehicle has
    // been freshly detailed ... All prices plus sales tax..."). When most
    // items are clearly bulleted, trust only the bulleted ones.
    const bulletedCount = rawItems.filter((s) => /^[-•]\s/.test(s)).length;
    if (bulletedCount >= 3) {
        rawItems = rawItems.filter((s) => /^[-•]\s/.test(s)).map((s) => s.replace(/^[-•]\s+/, ''));
    }

    const seen = new Set();
    const features = [];
    for (const item of rawItems) {
        const clean = item.replace(/\s+/g, ' ').trim();
        if (clean.length < 3 || clean.length > 60) continue;
        const key = clean.toLowerCase();
        if (GENERIC_BASELINE_EQUIPMENT.has(key)) continue;
        if (SPEAKER_COUNT_PATTERN.test(key) || DUPLICATED_TITLE_PATTERN.test(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        features.push({ code: 'FEATURE', name: clean, price: 0, category: 'feature' });
    }
    return features;
}

// Strategy 2: schema.org Vehicle JSON-LD. Used by DealerOn and other
// platforms that publish structured vehicle markup for SEO. Real per-VIN
// data (VIN, price, model, dealer-written feature list) straight from the
// page's own structured data — not scraped by guessing at page text.
function extractSchemaOrgVehicle(html, url, dealer) {
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    let vehicleLd = null;
    for (const block of ldBlocks) {
        try {
            const parsed = JSON.parse(block[1]);
            if (parsed && parsed['@type'] === 'Vehicle' && parsed.vehicleIdentificationNumber) {
                vehicleLd = parsed;
                break;
            }
        } catch {
            // not valid JSON, skip
        }
    }
    if (!vehicleLd) return null;

    const vin = vehicleLd.vehicleIdentificationNumber.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;

    const price = vehicleLd.offers?.price ? Math.round(Number(vehicleLd.offers.price)) : null;
    const year = vehicleLd.vehicleModelDate ? parseInt(vehicleLd.vehicleModelDate, 10) : null;

    return {
        vin,
        dealerName: dealer.name,
        city: dealer.city,
        state: dealer.state,
        stockNumber: null,
        inventoryType: url.includes('/used') || url.toLowerCase().includes('used') ? 'USED' : 'NEW',
        year: Number.isFinite(year) ? year : null,
        make: cleanString(vehicleLd.manufacturer?.name) || 'Porsche',
        model: cleanString(vehicleLd.model),
        trim: null,
        bodyStyle: cleanString(vehicleLd.bodyType),
        price,
        msrp: price,
        mileage: 0,
        exteriorColor: null,
        interiorColor: null,
        engine: cleanString(vehicleLd.vehicleEngine?.name),
        transmission: null,
        dealerListedOptions: parseFeaturesFromDescription(vehicleLd.description),
        url,
    };
}

async function safeFetch(url, timeoutMs = 7000) {
    return Promise.race([
        gotScraping({
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: { request: timeoutMs },
            retry: { limit: 1 },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), timeoutMs + 500)),
    ]);
}

// Sitemap XML escapes reserved characters inside <loc> (e.g. a literal "+"
// in a URL slug becomes "&#x2B;"), but that was never being decoded back —
// every <loc> value was stored and used verbatim, so any URL containing an
// escaped character 404'd both when the crawler itself re-fetched it and
// when a trimscout.com visitor clicked through to the dealer's listing.
function decodeXmlEntities(str) {
    return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

async function fetchSitemapXmlUrls(sitemapUrl, depth = 0) {
    if (depth > 2) return [];
    try {
        const res = await gotScraping({
            url: sitemapUrl,
            responseType: 'buffer',
            timeout: { request: 8000 },
            retry: { limit: 1 },
        });

        let xml = '';
        if (sitemapUrl.endsWith('.gz') || (res.rawBody[0] === 0x1f && res.rawBody[1] === 0x8b)) {
            try { xml = zlib.gunzipSync(res.rawBody).toString('utf-8'); } catch { xml = res.rawBody.toString('utf-8'); }
        } else {
            xml = res.rawBody.toString('utf-8');
        }

        const childSitemaps = [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi)].map((m) => decodeXmlEntities(m[1].trim()));
        if (childSitemaps.length > 0) {
            const inventoryChild = childSitemaps.filter((u) => /vehicle|inventory|cars|porsche|sitemap/i.test(u));
            const targets = inventoryChild.length > 0 ? inventoryChild : childSitemaps;
            let nested = [];
            for (const child of targets.slice(0, 8)) {
                nested.push(...await fetchSitemapXmlUrls(child, depth + 1));
            }
            return nested;
        }

        const allUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => decodeXmlEntities(m[1].trim()));
        return allUrls.filter((u) =>
            /-[a-f0-9]{32}\.htm/i.test(u) ||
            /\/vehicle-details/i.test(u) ||
            /\/inventory\/(?:new|used|certified|porsche|all)/i.test(u) ||
            /\/(?:new|used|certified|cpo)\/(?:Porsche|inventory)\//i.test(u) ||
            /WP0[A-Z0-9]{13,14}|WP1[A-Z0-9]{13,14}/i.test(u)
        );
    } catch {
        return [];
    }
}

async function resolveSitemapUrls(dealer) {
    const candidateUrls = [
        dealer.sitemapUrl,
        dealer.inventorySitemapUrl,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap-inventory.xml`,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap.xml`,
        dealer.fallbackUrl
    ].filter(Boolean);

    for (const url of candidateUrls) {
        const found = await fetchSitemapXmlUrls(url);
        if (found.length > 0) {
            return found;
        }
    }
    return [];
}

async function pMap(items, mapper, concurrency = 8) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const idx = cursor++;
            try {
                await mapper(items[idx], idx);
            } catch {}
        }
    });
    await Promise.allSettled(workers);
}

const currentInventory = new Map();
const todayDate = new Date().toISOString().slice(0, 10);
const todayIso = new Date().toISOString();
const dealerStats = {};

let activeDealersCount = 0;
let erroredDealersCount = 0;

for (let i = 0; i < dealers.length; i++) {
    const dealer = dealers[i];
    const progress = `[${i + 1}/${dealers.length}]`;
    console.log(`${progress} 🏢 Crawling ${dealer.name} (${dealer.city}, ${dealer.state})...`);

    try {
        const vehicleUrls = await resolveSitemapUrls(dealer);
        if (vehicleUrls.length === 0) {
            console.log(`${progress} ⚠️ No inventory URLs detected for ${dealer.name}.`);
            dealerStats[dealer.name] = 0;
            continue;
        }

        console.log(`${progress} Found ${vehicleUrls.length} vehicle URLs. Extracting data...`);

        let dealerCount = 0;
        await pMap(vehicleUrls, async (url) => {
            try {
                const res = await safeFetch(url, 7000);
                const html = res.body;
                let vehicle = null;

                // Strategy 1: DDC DataLayer (Dealer.com)
                const ddcMatch = html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
                                 html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
                if (ddcMatch) {
                    try {
                        const sandbox = {};
                        vm.runInNewContext('vehicles = ' + ddcMatch[1], sandbox);
                        if (sandbox.vehicles && sandbox.vehicles.length > 0) {
                            const raw = sandbox.vehicles[0];
                            const askingPrice = parseFloat(raw.askingPrice || '0') || null;
                            const salePrice = parseFloat(raw.salePrice || '0') || null;
                            const retailValue = parseFloat(raw.retailValue || '0') || null;
                            const price = salePrice || askingPrice || retailValue || null;
                            const msrp = retailValue || askingPrice || null;
                            const mileage = parseFloat(raw.odometer || raw.mileage || '0') || 0;

                            const inventoryType = raw.inventoryType
                                ? raw.inventoryType.toUpperCase()
                                : raw.certified === 'true'
                                    ? 'CERTIFIED_PRE_OWNED'
                                    : url.includes('/new/')
                                        ? 'NEW'
                                        : 'USED';

                            vehicle = {
                                vin: raw.vin ? raw.vin.trim().toUpperCase() : null,
                                dealerName: dealer.name,
                                city: dealer.city,
                                state: dealer.state,
                                stockNumber: cleanString(raw.stockNumber),
                                inventoryType,
                                year: raw.year ? parseInt(raw.year, 10) : null,
                                make: cleanString(raw.make) || 'Porsche',
                                model: cleanString(raw.model),
                                trim: cleanString(raw.trim),
                                bodyStyle: cleanString(raw.bodyStyle),
                                price,
                                msrp,
                                mileage,
                                exteriorColor: cleanString(raw.exteriorColor),
                                interiorColor: cleanString(raw.interiorColor),
                                engine: cleanString(raw.engine),
                                transmission: cleanString(raw.transmission),
                                dealerListedOptions: extractDealerListedOptions(raw),
                                url,
                            };
                        }
                    } catch {}
                }

                // Strategy 2: schema.org Vehicle JSON-LD (DealerOn and others).
                if (!vehicle || !vehicle.vin) {
                    vehicle = extractSchemaOrgVehicle(html, url, dealer);
                }

                // Strategy 3: last-resort structured-field scan. Only trusts
                // explicit, labeled VIN/price/year signals (a JSON key, a
                // microdata itemprop, or the VIN literally embedded in the
                // URL slug, which every platform we've seen does). It does
                // NOT guess model from freeform page text — that produced
                // false positives like a "2029 Porsche 718" whose own URL
                // said "cayenne-coupe" (a phone number or unrelated page
                // text matched instead). Model/year are left null rather
                // than guessed; a real VIN is still useful on its own since
                // NHTSA decoding downstream can supply accurate specs.
                if (!vehicle || !vehicle.vin) {
                    const vinMatch = html.match(/vehicleIdentificationNumber["']?\s*:\s*["']([A-HJ-NPR-Z0-9]{16,17})/i) ||
                                     html.match(/"vin":\s*"([A-HJ-NPR-Z0-9]{16,17})"/i) ||
                                     html.match(/itemprop=["']vehicleIdentificationNumber["'][^>]*content=["']([A-HJ-NPR-Z0-9]{16,17})["']/i) ||
                                     url.match(/(WP0[A-Z0-9]{13,14}|WP1[A-Z0-9]{13,14})/i);

                    const priceMatch = html.match(/"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?/i) ||
                                       html.match(/itemprop=["']price["'][^>]*content=["']([\d,]+(?:\.\d+)?)["']/i);

                    const yearMatch = html.match(/vehicleModelDate["']?\s*:\s*["']?(\d{4})["']?/i) ||
                                      html.match(/itemprop=["']vehicleModelDate["'][^>]*content=["'](\d{4})["']/i);

                    if (vinMatch) {
                        const rawPriceStr = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
                        const price = rawPriceStr ? Math.round(parseFloat(rawPriceStr)) : null;
                        const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

                        vehicle = {
                            vin: vinMatch[1].trim().toUpperCase(),
                            dealerName: dealer.name,
                            city: dealer.city,
                            state: dealer.state,
                            stockNumber: null,
                            inventoryType: url.includes('/new') ? 'NEW' : url.includes('/certified') || url.includes('/cpo') ? 'CERTIFIED_PRE_OWNED' : 'USED',
                            year: Number.isFinite(year) && year >= 1950 && year <= new Date().getFullYear() + 1 ? year : null,
                            make: 'Porsche',
                            model: null,
                            trim: null,
                            bodyStyle: null,
                            price,
                            msrp: null,
                            mileage: 0,
                            exteriorColor: null,
                            interiorColor: null,
                            engine: null,
                            transmission: null,
                            url,
                        };
                    }
                }

                if (vehicle && vehicle.vin && vehicle.vin.length >= 16) {
                    // Multi-brand isolation check: only store Porsche vehicles
                    const isPorsche = vehicle.make?.toLowerCase().includes('porsche') ||
                                      vehicle.vin.startsWith('WP0') ||
                                      vehicle.vin.startsWith('WP1') ||
                                      /911|carrera|cayman|boxster|taycan|macan|cayenne|panamera/i.test(vehicle.model || '');

                    if (isPorsche) {
                        currentInventory.set(vehicle.vin, vehicle);
                        dealerCount++;
                    }
                }
            } catch {}
        }, 8);

        dealerStats[dealer.name] = dealerCount;
        if (dealerCount > 0) activeDealersCount++;
        console.log(`${progress} ✅ Extracted ${dealerCount} vehicles from ${dealer.name}. (Running Total: ${currentInventory.size})`);
    } catch (err) {
        erroredDealersCount++;
        console.error(`${progress} ❌ Error crawling ${dealer.name}: ${err.message}`);
    }

    // Checkpoint after every dealer. A full nationwide run can take hours;
    // without this, a stall or crash partway through loses everything —
    // the real output files only get written after the whole loop finishes.
    try {
        fs.writeFileSync(
            path.join(DATA_DIR, 'checkpoint_raw_inventory.json'),
            JSON.stringify(Array.from(currentInventory.values()), null, 2)
        );
    } catch (checkpointErr) {
        console.error(`⚠️ Checkpoint write failed: ${checkpointErr.message}`);
    }
}

console.log(`\n🎉 Nationwide Crawl Complete!`);
console.log(`Total Active Porsche Centers with Live Inventory: ${activeDealersCount}`);
console.log(`Total Live Vehicles Tracked: ${currentInventory.size}`);

// Compute Nationwide Diffs
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
        daysOnLot = 0;
        firstSeen = todayDate;
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

    const record = {
        ...cur,
        oldPrice,
        priceDiff,
        daysOnLot,
        firstSeen,
        lastSeen: todayDate,
        changeType,
        priceHistory,
        status: 'ACTIVE',
        updatedAt: todayIso,
    };

    updatedSnapshot[vin] = record;
    allRecords.push(record);
}

// Identify Sold / Removed Vehicles
for (const [vin, prev] of Object.entries(previousSnapshot)) {
    if (!currentInventory.has(vin) && prev.status === 'ACTIVE') {
        const soldRecord = {
            ...prev,
            status: 'SOLD_OR_REMOVED',
            changeType: 'SOLD',
            soldDate: todayDate,
            lastSeen: todayDate,
            updatedAt: todayIso,
        };
        updatedSnapshot[vin] = soldRecord;
        soldVehicles.push(soldRecord);
        allRecords.push(soldRecord);
    }
}

// Persist Daily Changes & Latest Inventory Files
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
console.log(`📊 NATIONWIDE PORSCHE MARKET SUMMARY (${todayDate})`);
console.log(`Active Live Inventory:   ${currentInventory.size}`);
console.log(`New Arrivals Today:     ${newArrivals.length}`);
console.log(`Price Drops Today:      ${priceDrops.length}`);
console.log(`Sold / Removed Today:   ${soldVehicles.length}`);
console.log(`Data Output:            ${DATA_DIR}`);
console.log('====================================================\n');

// Automatically trigger enrichment pipeline on all captured inventory
try {
    console.log('⚡ Triggering automatic spec enrichment pipeline...');
    await runEnrichmentPipeline();
} catch (enrichErr) {
    console.error('Enrichment step warning:', enrichErr.message);
}
