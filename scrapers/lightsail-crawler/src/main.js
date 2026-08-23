import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';
import { gotScraping } from 'got-scraping';
import vm from 'node:vm';

await Actor.init();

// 1. Fetch User Input
const input = await Actor.getInput() || {};
const {
    sitemapUrl = 'https://www.paulmillerporsche.com/sitemap.xml',
    storeName = 'PORSCHE_PAUL_MILLER_STORE',
    includeSold = true,
    notifyWebhookUrl = '',
    maxConcurrency = 10,
    proxyConfiguration: customProxyConfig,
} = input;

log.info('🚗 Starting Paul Miller Porsche Daily VIN Tracker...');
log.info(`Using persistent Key-Value Store: "${storeName}"`);

// 2. Open Persistent Key-Value Store across Actor runs
const kvStore = await Actor.openKeyValueStore(storeName);
const previousSnapshot = (await kvStore.getValue('LATEST_SNAPSHOT')) || {};
const previousVins = Object.keys(previousSnapshot);
log.info(`Loaded previous snapshot containing ${previousVins.length} vehicles.`);

// 3. Configure Proxy (if configured in Apify)
let proxyConfiguration;
if (customProxyConfig) {
    proxyConfiguration = await Actor.createProxyConfiguration(customProxyConfig);
}

// 4. Fetch and Parse Sitemap to get all Vehicle Detail URLs
log.info(`Fetching sitemap from ${sitemapUrl}...`);
let vehicleUrls = [];

try {
    const sitemapResponse = await gotScraping({
        url: sitemapUrl,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
    });

    const xml = sitemapResponse.body;
    // Match vehicle URLs formatted with UUID hash ending in .htm
    const matches = [...xml.matchAll(/<loc>(https:\/\/www\.paulmillerporsche\.com\/[^<]+-[a-f0-9]{32}\.htm)<\/loc>/gi)];
    vehicleUrls = [...new Set(matches.map((m) => m[1].trim()))];
    log.info(`Found ${vehicleUrls.length} vehicle detail URLs in sitemap.`);
} catch (error) {
    log.error(`Failed to fetch sitemap: ${error.message}`);
    throw error;
}

if (vehicleUrls.length === 0) {
    log.warning('No vehicle URLs found in sitemap! Check sitemap URL or site structure.');
}

// Map to hold scraped data during this run
const currentInventory = new Map();
const todayIso = new Date().toISOString();
const todayDate = todayIso.slice(0, 10);

// 5. Setup CheerioCrawler to scrape vehicle detail pages with polite rate limiting
const crawler = new CheerioCrawler({
    proxyConfiguration,
    minConcurrency: 1,
    maxConcurrency: Math.min(maxConcurrency, 5),
    maxRequestRetries: 4,
    requestHandlerTimeoutSecs: 30,
    navigationTimeoutSecs: 30,
    sameDomainDelaySecs: 0.5,
    additionalMimeTypes: ['application/xml', 'text/xml'],

    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...request.headers,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            };
        },
    ],

    async requestHandler({ $, request, body }) {
        const url = request.url;
        const html = body;

        let vehicle = null;

        // Strategy A: Parse Dealer.com DDC.dataLayer['vehicles']
        const ddcMatch = html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
                         html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);

        if (ddcMatch) {
            try {
                const sandbox = {};
                vm.runInNewContext('vehicles = ' + ddcMatch[1], sandbox);

                if (sandbox.vehicles && sandbox.vehicles.length > 0) {
                    const raw = sandbox.vehicles[0];

                    const packages = [];
                    if (Array.isArray(raw.packages)) {
                        for (const pkg of raw.packages) {
                            if (pkg.packageName && pkg.packageName !== 'null') {
                                packages.push(pkg.packageName);
                            }
                            if (Array.isArray(pkg.includedOptionList)) {
                                for (const opt of pkg.includedOptionList) {
                                    if (opt.textMap && opt.textMap.description) {
                                        packages.push(opt.textMap.description + (opt.msrPrice ? ` ($${opt.msrPrice})` : ''));
                                    }
                                }
                            }
                        }
                    }

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
                            : url.includes('/new/') || url.includes('/exotic-new/')
                                ? 'NEW'
                                : 'USED';

                    vehicle = {
                        vin: raw.vin ? raw.vin.trim().toUpperCase() : null,
                        stockNumber: raw.stockNumber || null,
                        inventoryType,
                        year: raw.year ? parseInt(raw.year, 10) : null,
                        make: raw.make || 'Porsche',
                        model: raw.model || null,
                        trim: raw.trim && raw.trim !== 'null' ? raw.trim : null,
                        bodyStyle: raw.bodyStyle || raw.normalBodyStyle || null,
                        price,
                        msrp,
                        salePrice,
                        askingPrice,
                        mileage,
                        exteriorColor: raw.exteriorColor || null,
                        interiorColor: raw.interiorColor || null,
                        engine: raw.engine || null,
                        transmission: raw.transmission || null,
                        drivetrain: raw.driveLine || null,
                        fuelEconomy: raw.fuelEconomy || null,
                        options: [...new Set(packages)],
                        photos: Array.isArray(raw.photos) ? raw.photos : [],
                        url,
                    };
                }
            } catch (err) {
                log.debug(`VM parsing error on ${url}: ${err.message}`);
            }
        }

        // Strategy B: Fallback regex & DOM parsing
        if (!vehicle || !vehicle.vin) {
            const vinMatch = html.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i) || html.match(/"vin":\s*"([A-HJ-NPR-Z0-9]{17})"/i);
            const priceMatch = html.match(/class="[^"]*price-value[^"]*">\$?([\d,]+)/i);
            const stockMatch = html.match(/Stock\s*#:\s*([A-Z0-9]+)/i);
            const titleText = $('h1').first().text().trim() || $('title').text().trim();

            if (vinMatch) {
                vehicle = {
                    vin: vinMatch[1].toUpperCase(),
                    stockNumber: stockMatch ? stockMatch[1] : null,
                    inventoryType: url.includes('/new/') ? 'NEW' : url.includes('/certified/') ? 'CERTIFIED_PRE_OWNED' : 'USED',
                    year: null,
                    make: 'Porsche',
                    model: titleText || null,
                    trim: null,
                    bodyStyle: null,
                    price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
                    msrp: null,
                    salePrice: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
                    askingPrice: null,
                    mileage: 0,
                    exteriorColor: null,
                    interiorColor: null,
                    engine: null,
                    transmission: null,
                    drivetrain: null,
                    fuelEconomy: null,
                    options: [],
                    photos: [],
                    url,
                };
            }
        }

        if (vehicle && vehicle.vin) {
            currentInventory.set(vehicle.vin, vehicle);
        } else {
            log.warning(`Could not extract VIN from ${url}`);
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

// Run crawler on all discovered URLs
log.info(`Starting crawl of ${vehicleUrls.length} vehicle detail pages...`);
await crawler.run(vehicleUrls);
log.info(`Crawl finished. Successfully processed ${currentInventory.size} live vehicles.`);

// 6. Perform Daily Diff / Change Detection
const updatedSnapshot = {};
const newArrivals = [];
const priceDrops = [];
const priceIncreases = [];
const modifiedVehicles = [];
const unchangedVehicles = [];
const soldOrRemovedVehicles = [];

const allProcessedRecords = [];

// A. Analyze all currently active vehicles
for (const [vin, current] of currentInventory.entries()) {
    const prev = previousSnapshot[vin];

    let changeType = 'UNCHANGED';
    let priceDiff = 0;
    let oldPrice = null;
    let daysOnLot = 0;
    let firstSeen = todayDate;
    let priceHistory = [];

    if (!prev) {
        // Newly added vehicle
        changeType = 'NEW_ARRIVAL';
        firstSeen = todayDate;
        priceHistory = [{ date: todayDate, price: current.price }];
        newArrivals.push(current);
    } else {
        // Existing vehicle
        firstSeen = prev.firstSeen || todayDate;
        const firstSeenTime = new Date(firstSeen).getTime();
        const nowTime = new Date(todayDate).getTime();
        daysOnLot = Math.max(0, Math.round((nowTime - firstSeenTime) / (1000 * 60 * 60 * 24)));

        priceHistory = Array.isArray(prev.priceHistory) ? [...prev.priceHistory] : [];
        oldPrice = prev.price;

        if (current.price !== null && oldPrice !== null && current.price !== oldPrice) {
            priceDiff = current.price - oldPrice;
            priceHistory.push({ date: todayDate, price: current.price, diff: priceDiff });

            if (priceDiff < 0) {
                changeType = 'PRICE_DROP';
                priceDrops.push({ ...current, oldPrice, priceDiff });
            } else {
                changeType = 'PRICE_INCREASE';
                priceIncreases.push({ ...current, oldPrice, priceDiff });
            }
        } else if (current.mileage !== prev.mileage || current.inventoryType !== prev.inventoryType) {
            changeType = 'MODIFIED';
            modifiedVehicles.push(current);
        } else {
            changeType = 'UNCHANGED';
            unchangedVehicles.push(current);
        }
    }

    const fullVehicleRecord = {
        ...current,
        status: 'ACTIVE',
        changeType,
        oldPrice,
        priceDiff,
        firstSeen,
        lastSeen: todayDate,
        daysOnLot,
        priceHistory,
        updatedAt: todayIso,
    };

    updatedSnapshot[vin] = fullVehicleRecord;
    allProcessedRecords.push(fullVehicleRecord);
}

// B. Identify removed or sold vehicles (present in previous run, missing today)
for (const vin of previousVins) {
    if (!currentInventory.has(vin)) {
        const prev = previousSnapshot[vin];
        const firstSeen = prev.firstSeen || todayDate;
        const firstSeenTime = new Date(firstSeen).getTime();
        const nowTime = new Date(todayDate).getTime();
        const daysOnLot = Math.max(0, Math.round((nowTime - firstSeenTime) / (1000 * 60 * 60 * 24)));

        const soldRecord = {
            ...prev,
            status: 'SOLD_OR_REMOVED',
            changeType: 'SOLD_OR_REMOVED',
            soldOrRemovedDate: todayDate,
            daysOnLot,
            lastSeen: prev.lastSeen || todayDate,
            updatedAt: todayIso,
        };

        soldOrRemovedVehicles.push(soldRecord);

        if (includeSold) {
            allProcessedRecords.push(soldRecord);
        }
    }
}

// 7. Calculate Daily Summary Statistics
const activeVehicles = Object.values(updatedSnapshot);
const totalActive = activeVehicles.length;
const totalWithPrice = activeVehicles.filter((v) => v.price && v.price > 0);
const avgPrice = totalWithPrice.length > 0
    ? Math.round(totalWithPrice.reduce((sum, v) => sum + v.price, 0) / totalWithPrice.length)
    : 0;

const dailySummary = {
    recordType: 'DAILY_SUMMARY',
    dealership: 'Paul Miller Porsche',
    date: todayDate,
    timestamp: todayIso,
    stats: {
        totalActiveInventory: totalActive,
        averagePrice: avgPrice,
        newArrivalsCount: newArrivals.length,
        soldOrRemovedCount: soldOrRemovedVehicles.length,
        priceDropsCount: priceDrops.length,
        priceIncreasesCount: priceIncreases.length,
        modifiedCount: modifiedVehicles.length,
        unchangedCount: unchangedVehicles.length,
    },
    changes: {
        newVins: newArrivals.map((v) => ({ vin: v.vin, year: v.year, model: v.model, price: v.price })),
        priceDrops: priceDrops.map((v) => ({ vin: v.vin, year: v.year, model: v.model, oldPrice: v.oldPrice, newPrice: v.price, drop: Math.abs(v.priceDiff) })),
        soldOrRemovedVins: soldOrRemovedVehicles.map((v) => ({ vin: v.vin, year: v.year, model: v.model, lastPrice: v.price, daysOnLot: v.daysOnLot })),
    },
};

log.info('========================================');
log.info(`📊 DAILY INVENTORY SUMMARY (${todayDate})`);
log.info(`Total Active Vehicles: ${totalActive}`);
log.info(`New Arrivals:         ${newArrivals.length}`);
log.info(`Sold/Removed:         ${soldOrRemovedVehicles.length}`);
log.info(`Price Drops:          ${priceDrops.length}`);
log.info(`Price Increases:      ${priceIncreases.length}`);
log.info('========================================');

// 8. Push Records to Apify Dataset
log.info('Pushing records to Apify Default Dataset...');
await Actor.pushData(dailySummary);
if (allProcessedRecords.length > 0) {
    await Actor.pushData(allProcessedRecords);
}

// 9. Persist Updated State in Key-Value Store
log.info('Persisting inventory snapshots to Key-Value Store...');
await kvStore.setValue('LATEST_SNAPSHOT', updatedSnapshot);
await kvStore.setValue(`SNAPSHOT_${todayDate}`, updatedSnapshot);
await kvStore.setValue('LATEST_CHANGES', dailySummary);

// 10. Optional Webhook Notification (Slack / Discord / Zapier)
if (notifyWebhookUrl && (newArrivals.length > 0 || priceDrops.length > 0 || soldOrRemovedVehicles.length > 0)) {
    try {
        log.info(`Sending daily change alert to webhook: ${notifyWebhookUrl}`);
        await gotScraping.post(notifyWebhookUrl, {
            json: {
                text: `*Paul Miller Porsche Inventory Update (${todayDate})*\n` +
                      `• *Active Inventory*: ${totalActive}\n` +
                      `• *New Arrivals*: ${newArrivals.length}\n` +
                      `• *Price Drops*: ${priceDrops.length}\n` +
                      `• *Sold/Removed*: ${soldOrRemovedVehicles.length}\n` +
                      (priceDrops.length > 0 ? `\n🔥 *Top Price Drops*:\n` + priceDrops.slice(0, 5).map((p) => `• ${p.year} ${p.model} (${p.vin}): \$${p.price.toLocaleString()} (-\$${Math.abs(p.priceDiff).toLocaleString()})`).join('\n') : ''),
                summary: dailySummary,
            },
        });
    } catch (err) {
        log.warning(`Failed to send webhook notification: ${err.message}`);
    }
}

log.info('✅ Paul Miller Porsche inventory tracking finished successfully.');
await Actor.exit();
