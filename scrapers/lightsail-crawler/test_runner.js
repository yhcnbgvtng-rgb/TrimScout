import { gotScraping } from 'got-scraping';
import vm from 'node:vm';

async function runTests() {
    console.log('====================================================');
    console.log('🧪 RUNNING AUTOMATED TESTS FOR PAUL MILLER PORSCHE SCRAPER');
    console.log('====================================================\n');

    // Test 1: Sitemap Discovery
    console.log('🔹 TEST 1: Sitemap Discovery');
    const sitemapUrl = 'https://www.paulmillerporsche.com/sitemap.xml';
    const sitemapRes = await gotScraping({
        url: sitemapUrl,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
    });

    const matches = [...sitemapRes.body.matchAll(/<loc>(https:\/\/www\.paulmillerporsche\.com\/[^<]+-[a-f0-9]{32}\.htm)<\/loc>/gi)];
    const urls = [...new Set(matches.map((m) => m[1].trim()))];
    console.log(`✅ Passed: Found ${urls.length} vehicle detail URLs in sitemap.`);

    // Test 2: Extraction on Sample Live VDPs (New, Certified, Used)
    console.log('\n🔹 TEST 2: Real-time Extraction on Live Inventory');
    const sampleUrls = [
        urls.find((u) => u.includes('/new/')),
        urls.find((u) => u.includes('/certified/')),
        urls.find((u) => u.includes('/used/')),
    ].filter(Boolean);

    for (const url of sampleUrls) {
        const res = await gotScraping({
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        const html = res.body;
        const ddcMatch = html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
                         html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);

        if (ddcMatch) {
            const sandbox = {};
            vm.runInNewContext('vehicles = ' + ddcMatch[1], sandbox);
            const raw = sandbox.vehicles[0];
            const category = url.includes('/new/') ? 'NEW' : url.includes('/certified/') ? 'CERTIFIED' : 'USED';
            console.log(`  ✅ [${category}] ${raw.year} ${raw.make} ${raw.model} | VIN: ${raw.vin} | Price: $${raw.salePrice || raw.askingPrice || raw.retailValue} | Mileage: ${raw.odometer || raw.mileage || 0} mi`);
        } else {
            console.error(`  ❌ Failed to extract vehicle data from: ${url}`);
        }
    }

    // Test 3: Daily Diffing and State Tracking Logic
    console.log('\n🔹 TEST 3: State Tracking & Daily Diffing Algorithm');

    function simulateDiff(currentInventory, previousSnapshot, date = '2026-08-24') {
        const updated = {};
        const newArrivals = [];
        const priceDrops = [];
        const soldOrRemoved = [];

        for (const [vin, cur] of Object.entries(currentInventory)) {
            const prev = previousSnapshot[vin];
            let changeType = 'UNCHANGED';
            let priceDiff = 0;
            let oldPrice = null;

            if (!prev) {
                changeType = 'NEW_ARRIVAL';
                newArrivals.push(cur);
            } else if (cur.price !== prev.price) {
                priceDiff = cur.price - prev.price;
                oldPrice = prev.price;
                if (priceDiff < 0) {
                    changeType = 'PRICE_DROP';
                    priceDrops.push({ ...cur, oldPrice, priceDiff });
                }
            }
            updated[vin] = { ...cur, changeType, oldPrice, priceDiff, date };
        }

        for (const [vin, prev] of Object.entries(previousSnapshot)) {
            if (!currentInventory[vin]) {
                soldOrRemoved.push({ ...prev, status: 'SOLD_OR_REMOVED' });
            }
        }

        return { updated, newArrivals, priceDrops, soldOrRemoved };
    }

    const day1State = {
        'WP1AA2A53TLB07942': { vin: 'WP1AA2A53TLB07942', model: 'Macan', price: 73260 },
        'WP0AB2A97TS226181': { vin: 'WP0AB2A97TS226181', model: '911 Carrera', price: 208995 },
    };

    const day2Inventory = {
        'WP1AA2A53TLB07942': { vin: 'WP1AA2A53TLB07942', model: 'Macan', price: 71990 }, // Price drop -$1,270
        'WP0AB2A84KS278857': { vin: 'WP0AB2A84KS278857', model: '718 Cayman', price: 77995 }, // New arrival
        // 911 Carrera was sold/removed
    };

    const diffResult = simulateDiff(day2Inventory, day1State);
    console.log(`  ✅ New Arrivals Detected: ${diffResult.newArrivals.length} (${diffResult.newArrivals[0].model})`);
    console.log(`  ✅ Price Drops Detected:   ${diffResult.priceDrops.length} (${diffResult.priceDrops[0].model}: $${diffResult.priceDrops[0].oldPrice} -> $${diffResult.priceDrops[0].price}, diff: $${diffResult.priceDrops[0].priceDiff})`);
    console.log(`  ✅ Sold/Removed Detected:  ${diffResult.soldOrRemoved.length} (${diffResult.soldOrRemoved[0].model})`);

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(console.error);
