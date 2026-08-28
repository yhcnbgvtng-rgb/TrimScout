import { gotScraping } from 'got-scraping';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { runEnrichmentPipeline } from './enricher.js';
import { getBrand } from './brands.js';
import { normalizeVehicleFields } from './modelNormalizer.js';

// One shared V8 context, reused for every vehicle's DDC dataLayer eval
// (Strategy 1) instead of creating a fresh one per call via
// vm.runInNewContext. Confirmed this session (twice — first in a separate
// one-off backfill script, now here against Ford's much larger per-dealer
// inventories) that vm.runInNewContext leaks measurably: each call
// contextifies a new global object that V8 is slow to collect, and across
// thousands of vehicles in one long-running process this accumulates
// enough retained memory to OOM even well within a normal heap size — it
// crashed a 512MB box on a single 1,005-vehicle dealer. Safe to share: the
// eval + the read of its result happen synchronously with no `await`
// between them, so nothing else can interleave mid-evaluation even though
// many vehicles are processed concurrently overall.
const ddcEvalContext = vm.createContext({});

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const CHANGES_DIR = path.join(DATA_DIR, 'daily_changes');
const LATEST_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, 'latest_snapshot.json');

await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
await fs.mkdir(CHANGES_DIR, { recursive: true });

// One invocation crawls one brand's dealer list — a dedicated dealers.json
// per brand/deployment, not a mixed file. Enrichment runs as a single
// batch pass over the whole inventory at the end, which needs one brand
// config (base-MSRP table, etc.) to apply consistently; mixing brands in
// one file would need per-vehicle brand resolution there too, which isn't
// built. Override with CRAWLER_BRAND, otherwise inferred from the dealer
// list itself, defaulting to Porsche so existing deployments need zero
// changes.
const dealersPath = path.resolve(process.cwd(), process.env.CRAWLER_DEALERS_FILE || 'dealers.json');
const dealers = JSON.parse(await fs.readFile(dealersPath, 'utf-8'));
const brand = getBrand(process.env.CRAWLER_BRAND || dealers[0]?.make || 'Porsche');

console.log('====================================================');
console.log(`🏎️ ${brand.name.toUpperCase()} ALL-DEALERSHIP NATIONWIDE TRACKER`);
console.log(`Total Authorized ${brand.name} Centers Configured: ${dealers.length}`);
console.log('====================================================\n');

let previousSnapshot = {};
try {
    previousSnapshot = JSON.parse(await fs.readFile(LATEST_SNAPSHOT_PATH, 'utf-8'));
    console.log(`Loaded previous baseline: ${Object.keys(previousSnapshot).length} vehicles.`);
} catch {
    console.log('No previous baseline found. Starting fresh initial scan.');
}

// --- DB scrape-run tracking (additive) ---------------------------------
// Once dealers are loaded, register this run in MariaDB: upsert the brand
// row and this run's dealer list (both idempotent — safe on every run,
// not just the first), then open a scrape_runs row so enricher.js's later
// syncInventoryToDatabase() call can attach daily_change_log rows and the
// final stats to the same run. All non-fatal: `db.js` loads DB_HOST from
// .env.trimscout-db as a side effect of the dynamic import, so the import
// has to happen before the process.env.DB_HOST check, not after.
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

// Rejects prices that are structurally impossible rather than just
// implausible: <= 0, an absurd >$5M sticker (no real Porsche listing hits
// this — a sign of a misparsed field), or exactly 2147483647 (INT32_MAX,
// the classic "null" sentinel some dealer platforms use for a missing
// price instead of an actual empty value).
function cleanPrice(val) {
    if (val === null || val === undefined) return null;
    const num = typeof val === 'number' ? val : parseFloat(val.toString().replace(/[^\d.]/g, ''));
    if (isNaN(num) || num <= 0 || num >= 5000000 || num === 2147483647) return null;
    return Math.round(num);
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

    const price = cleanPrice(vehicleLd.offers?.price);
    const year = vehicleLd.vehicleModelDate ? parseInt(vehicleLd.vehicleModelDate, 10) : null;

    return {
        vin,
        dealerName: dealer.name,
        city: dealer.city,
        state: dealer.state,
        stockNumber: null,
        inventoryType: url.includes('/used') || url.toLowerCase().includes('used') ? 'USED' : 'NEW',
        year: Number.isFinite(year) ? year : null,
        // The page's own manufacturer field is the real signal — dealer.make
        // is only "which brand we're targeting at this dealer", not a
        // guarantee every vehicle there is that brand. Multi-franchise
        // dealer groups (confirmed live: an NJ Ford dealer's sitemap also
        // surfaced Ram, VW, Honda, Mazda, and Maserati vehicles) would get
        // every vehicle mislabeled if dealer.make won here.
        make: cleanString(vehicleLd.manufacturer?.name) || dealer.make || null,
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
        // Deliberately not parsing options from vehicleLd.description here.
        // Confirmed live on Porsche Beverly Hills: that field is sometimes an
        // undelimited third-party spec-sheet dump ("Standard
        // EquipmentMECHANICALFull-Time All-Wheel3.36 Axle Ratio...") with no
        // real item boundaries — splitting it produces mashed-together
        // garbage, not real per-VIN options. Left empty (honest) rather than
        // risk shipping that as an itemized options list.
        dealerListedOptions: [],
        imageUrl: extractImageUrl(html, vehicleLd, url),
        url,
    };
}

// Best-effort real photo URL for this vehicle, tried across the platforms
// seen so far. Never fabricated — only what the page itself actually
// serves, in the same order confirmed live: og:image (Porsche retailer
// platform), then schema.org's own `image` property (sometimes a
// site-relative path, e.g. Porsche Beverly Hills — resolved against the
// vehicle's own page URL).
function extractImageUrl(html, vehicleLd, pageUrl) {
    const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
    if (og && og[1]) return og[1];
    if (vehicleLd?.image) {
        const img = Array.isArray(vehicleLd.image) ? vehicleLd.image[0] : vehicleLd.image;
        if (typeof img === 'string') {
            if (img.startsWith('http')) return img;
            try {
                return new URL(img, pageUrl).href;
            } catch {
                return null;
            }
        }
    }
    return null;
}

// Strategy 2b: Porsche's own official retailer platform
// (*.porsche.com/en/inventory/...). Runs the same Next.js RSC streaming
// architecture as finder.porsche.com — real vehicle data is embedded as
// JSON fragments inside self.__next_f.push(...) calls, not in a simple
// top-level __NEXT_DATA__ tag. This is a majority platform in this
// dataset (roughly 70% of dealers use it); a prior fragile regex-based
// approach against this same platform was found (live, on the deployed
// Lightsail crawler) to sometimes attach the wrong model to a VIN — e.g.
// labeling a Cayenne listing "Porsche 911" — because proximity-based
// regex matching near a VIN can pick up an unrelated nearby field. This
// extracts the vehicle's own compact, flat "car" object instead, which
// carries real vin/model/year/price/mileage as direct keys.
function decodeRscStream(html) {
    const matches = [...html.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)];
    let full = '';
    for (const m of matches) {
        try {
            full += JSON.parse(m[1]);
        } catch {
            // skip malformed fragment
        }
    }
    return full;
}

function extractBracketedValue(text, key, openChar, closeChar) {
    const marker = `"${key}":${openChar}`;
    const startIdx = text.indexOf(marker);
    if (startIdx === -1) return null;
    const start = startIdx + marker.length - 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) {
                const raw = text.slice(start, i + 1);
                try {
                    return JSON.parse(raw);
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function extractPorscheRetailerVehicle(html, url, dealer) {
    if (!html.includes('self.__next_f.push')) return null;
    const decoded = decodeRscStream(html);
    const car = extractBracketedValue(decoded, 'car', '{', '}');
    if (!car || !car.vin) return null;

    const vin = car.vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;

    // Porsche's own feed is inconsistent about case for this field ("Macan"
    // and "macan" both appear across different listings of the same real
    // model) — normalizing casing isn't guessing content, just presenting
    // the same real value consistently.
    const rawModelRange = cleanString(car.modelRangeName);
    const modelRange = rawModelRange && /^[a-z]/.test(rawModelRange) && !/^\d/.test(rawModelRange)
        ? rawModelRange.charAt(0).toUpperCase() + rawModelRange.slice(1)
        : rawModelRange;
    const modelName = cleanString(car.modelName);
    // modelName includes modelRangeName as a prefix ("718" + "718 Spyder");
    // strip the confirmed-matching prefix rather than guess a split.
    const trim = rawModelRange && modelName && modelName.startsWith(rawModelRange)
        ? cleanString(modelName.slice(rawModelRange.length)) || null
        : modelName;

    const price = cleanPrice(car.priceTotalTotal);

    return {
        vin,
        dealerName: dealer.name,
        city: dealer.city,
        state: dealer.state,
        stockNumber: cleanString(car.listingId),
        inventoryType: car.realcarStatus === 'new' ? 'NEW' : car.realcarStatus === 'preowned' ? 'USED' : url.toLowerCase().includes('new') ? 'NEW' : 'USED',
        year: Number.isFinite(car.modelModelYear) ? car.modelModelYear : null,
        make: 'Porsche',
        model: modelRange,
        trim,
        bodyStyle: null,
        price,
        msrp: price,
        mileage: typeof car.mileageValue === 'number' ? Math.round(car.mileageValue) : 0,
        exteriorColor: null,
        interiorColor: null,
        engine: cleanString(car.engineType),
        transmission: null,
        dealerListedOptions: [],
        imageUrl: extractImageUrl(html, null, url),
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

async function fetchSitemapXmlUrls(sitemapUrl, depth = 0, brand) {
    if (depth > 2) return [];
    const brandWord = brand.name.toLowerCase();
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
            const inventoryChild = childSitemaps.filter((u) => new RegExp(`vehicle|inventory|cars|${brandWord}|sitemap`, 'i').test(u));
            const targets = inventoryChild.length > 0 ? inventoryChild : childSitemaps;
            let nested = [];
            for (const child of targets.slice(0, 8)) {
                nested.push(...await fetchSitemapXmlUrls(child, depth + 1, brand));
            }
            return nested;
        }

        const allUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => decodeXmlEntities(m[1].trim()));
        const vinPattern = brand.vinPrefixes.map((p) => `${p}[A-Z0-9]{13,14}`).join('|');
        return allUrls.filter((u) =>
            /-[a-f0-9]{32}\.htm/i.test(u) ||
            /\/vehicle-details/i.test(u) ||
            new RegExp(`\\/inventory\\/(?:new|used|certified|${brandWord}|all)`, 'i').test(u) ||
            new RegExp(`\\/(?:new|used|certified|cpo)\\/(?:${brand.name}|inventory)\\/`, 'i').test(u) ||
            new RegExp(vinPattern, 'i').test(u)
        );
    } catch {
        return [];
    }
}

async function resolveSitemapUrls(dealer, brand) {
    const candidateUrls = [
        dealer.sitemapUrl,
        dealer.inventorySitemapUrl,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap-inventory.xml`,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap.xml`,
        dealer.fallbackUrl
    ].filter(Boolean);

    for (const url of candidateUrls) {
        const found = await fetchSitemapXmlUrls(url, 0, brand);
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

// Dealers whose crawl produced zero real evidence this run — either the
// sitemap fetch itself failed/was bot-blocked (fetchSitemapXmlUrls swallows
// that and returns [], indistinguishable here from "genuinely zero
// inventory"), or every page fetched failed extraction. Confirmed live:
// bot-blocking alone hits roughly 80% of configured dealers to some degree.
// A vehicle whose dealer lands in this set is excluded from the sold-diff
// below rather than being marked SOLD on no real evidence either way.
const failedDealerNames = new Set();

let activeDealersCount = 0;
let erroredDealersCount = 0;

for (let i = 0; i < dealers.length; i++) {
    const dealer = dealers[i];
    const progress = `[${i + 1}/${dealers.length}]`;
    console.log(`${progress} 🏢 Crawling ${dealer.name} (${dealer.city}, ${dealer.state})...`);

    try {
        const vehicleUrls = await resolveSitemapUrls(dealer, brand);
        if (vehicleUrls.length === 0) {
            console.log(`${progress} ⚠️ No inventory URLs detected for ${dealer.name}.`);
            dealerStats[dealer.name] = 0;
            failedDealerNames.add(dealer.name);
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
                        vm.runInContext('vehicles = ' + ddcMatch[1], ddcEvalContext);
                        if (ddcEvalContext.vehicles && ddcEvalContext.vehicles.length > 0) {
                            const raw = ddcEvalContext.vehicles[0];
                            const askingPrice = cleanPrice(raw.askingPrice);
                            const salePrice = cleanPrice(raw.salePrice);
                            const retailValue = cleanPrice(raw.retailValue);
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

                            // Prefer the vehicle's own scraped dealership identity
                            // (DDC.dataLayer's address.accountName) over the crawl
                            // config's dealer.name — some dealer groups (e.g.
                            // Schumacher's NJ Chevrolet rooftops) share inventory
                            // across multiple domains, so which URL the crawler
                            // happened to visit doesn't reliably tell you which
                            // physical location a given vehicle is actually at.
                            // Same principle as the make-field fix below: trust
                            // the vehicle's own data over which dealer's crawl
                            // loop discovered it.
                            const realDealerName = cleanString(raw.address?.accountName) || dealer.name;
                            const realCity = cleanString(raw.address?.city) || dealer.city;
                            const realState = cleanString(raw.address?.state) || dealer.state;

                            vehicle = {
                                vin: raw.vin ? raw.vin.trim().toUpperCase() : null,
                                dealerName: realDealerName,
                                // Guaranteed-valid fallback for DB dealer_id resolution
                                // (a real string match against dealers.json's own
                                // `name` field) — used only if realDealerName doesn't
                                // match any known dealer, so a vehicle is never
                                // silently dropped just because its real scraped
                                // dealership name doesn't exactly match our config.
                                configDealerName: dealer.name,
                                city: realCity,
                                state: realState,
                                stockNumber: cleanString(raw.stockNumber),
                                inventoryType,
                                year: raw.year ? parseInt(raw.year, 10) : null,
                                make: cleanString(raw.make) || dealer.make || brand.name,
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
                                imageUrl: Array.isArray(raw.images) && raw.images[0]?.uri ? raw.images[0].uri : null,
                                url,
                            };
                        }
                    } catch {}
                }

                // Strategy 2: schema.org Vehicle JSON-LD (DealerOn and others).
                if (!vehicle || !vehicle.vin) {
                    vehicle = extractSchemaOrgVehicle(html, url, dealer);
                }

                // Strategy 2b: manufacturer's own official retailer platform
                // (RSC) — only Porsche has one of these (confirmed this
                // session: Audi, VW, and Lamborghini each run separate,
                // brand-specific systems), so this is skipped entirely for
                // other brands rather than wastefully attempted.
                if (brand.hasOfficialRetailerPlatform && (!vehicle || !vehicle.vin)) {
                    vehicle = extractPorscheRetailerVehicle(html, url, dealer);
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
                    const urlVinPattern = brand.vinPrefixes.map((p) => `${p}[A-Z0-9]{13,14}`).join('|');
                    const vinMatch = html.match(/vehicleIdentificationNumber["']?\s*:\s*["']([A-HJ-NPR-Z0-9]{16,17})/i) ||
                                     html.match(/"vin":\s*"([A-HJ-NPR-Z0-9]{16,17})"/i) ||
                                     html.match(/itemprop=["']vehicleIdentificationNumber["'][^>]*content=["']([A-HJ-NPR-Z0-9]{16,17})["']/i) ||
                                     url.match(new RegExp(`(${urlVinPattern})`, 'i'));

                    // Prefer schema.org microdata (itemprop="price"), which lives
                    // in the same structured Product/Offer block as the VIN
                    // itemprop above. Only fall back to the freeform "price" JSON
                    // key if it appears near the VIN's own position in the page —
                    // a page-wide match can (and did, confirmed live at Porsche
                    // Naples: implausible $815/$1,554 "prices" on certified
                    // listings, a tiny fraction of any real Porsche's price) grab
                    // an unrelated dollar figure from somewhere else entirely,
                    // like a finance-calculator payment estimate.
                    let priceMatch = html.match(/itemprop=["']price["'][^>]*content=["']([\d,]+(?:\.\d+)?)["']/i);
                    if (!priceMatch && vinMatch) {
                        const vinIndex = html.indexOf(vinMatch[1]);
                        if (vinIndex !== -1) {
                            const windowStart = Math.max(0, vinIndex - 2000);
                            const windowEnd = Math.min(html.length, vinIndex + 2000);
                            priceMatch = html.slice(windowStart, windowEnd).match(/"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?/i);
                        }
                    }

                    const yearMatch = html.match(/vehicleModelDate["']?\s*:\s*["']?(\d{4})["']?/i) ||
                                      html.match(/itemprop=["']vehicleModelDate["'][^>]*content=["'](\d{4})["']/i);

                    if (vinMatch) {
                        const rawPriceStr = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
                        const price = cleanPrice(rawPriceStr);
                        const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

                        vehicle = {
                            vin: vinMatch[1].trim().toUpperCase(),
                            dealerName: dealer.name,
                            city: dealer.city,
                            state: dealer.state,
                            stockNumber: null,
                            inventoryType: url.includes('/new') ? 'NEW' : url.includes('/certified') || url.includes('/cpo') ? 'CERTIFIED_PRE_OWNED' : 'USED',
                            year: Number.isFinite(year) && year >= 1950 && year <= new Date().getFullYear() + 1 ? year : null,
                            // No real manufacturer field is scraped by this
                            // strategy (see comment above) — left null rather
                            // than asserting dealer.make, since multi-brand
                            // dealers mean that's not reliable. The isolation
                            // check just below gates on VIN prefix instead.
                            make: null,
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
                    // Multi-brand isolation check: some dealers (especially
                    // multi-franchise groups) surface other brands they also
                    // sell in the same sitemap/pages — only keep vehicles
                    // that actually match the brand this run is targeting.
                    const isTargetBrand = vehicle.make?.toLowerCase().includes(brand.name.toLowerCase()) ||
                                      brand.vinPrefixes.some((p) => vehicle.vin.startsWith(p));

                    if (isTargetBrand) {
                        // Collapse to the canonical brand name. isTargetBrand
                        // just confirmed this vehicle genuinely belongs to
                        // this brand (by label match or VIN prefix), so any
                        // raw label variant the source site used — "FORD
                        // TRUCK", "FORD MEDIUM TRUCK", etc. — is the same
                        // vehicle, not a different make; storing the raw
                        // variant instead of "Ford"/"Chevrolet" just splits
                        // one brand into several make values downstream.
                        vehicle.make = brand.name;
                        // Un-mix model/trim/body_style for brands whose
                        // source sites bake trim/body-style tokens into the
                        // model field (confirmed live: Porsche dealer.com
                        // feeds do this inconsistently per-site, e.g. raw
                        // model "Macan S" or "Cayenne GTS Coupe"). Applied
                        // uniformly here (after all extraction strategies
                        // converge) rather than per-strategy, so every path
                        // — DDC, schema.org, the Porsche retailer platform —
                        // gets the same cleanup. No-op for every other
                        // brand (see modelNormalizer.js's brand dispatcher).
                        vehicle = normalizeVehicleFields(brand.name, vehicle);
                        currentInventory.set(vehicle.vin, vehicle);
                        dealerCount++;
                    }
                }
            } catch {}
        }, Number(process.env.CRAWLER_CONCURRENCY) || 8);

        dealerStats[dealer.name] = dealerCount;
        if (dealerCount > 0) {
            activeDealersCount++;
        } else {
            // Pages were fetched but nothing survived extraction — same "no
            // real evidence this run" situation as the zero-URL case above.
            failedDealerNames.add(dealer.name);
        }
        console.log(`${progress} ✅ Extracted ${dealerCount} vehicles from ${dealer.name}. (Running Total: ${currentInventory.size})`);
    } catch (err) {
        erroredDealersCount++;
        failedDealerNames.add(dealer.name);
        console.error(`${progress} ❌ Error crawling ${dealer.name}: ${err.message}`);
    }

    // Checkpoint after every dealer. A full nationwide run can take hours;
    // without this, a stall or crash partway through loses everything —
    // the real output files only get written after the whole loop finishes.
    try {
        await fs.writeFile(
            path.join(DATA_DIR, 'checkpoint_raw_inventory.json'),
            JSON.stringify(Array.from(currentInventory.values()), null, 2)
        );
    } catch (checkpointErr) {
        console.error(`⚠️ Checkpoint write failed: ${checkpointErr.message}`);
    }
}

console.log(`\n🎉 Nationwide Crawl Complete!`);
console.log(`Total Active ${brand.name} Centers with Live Inventory: ${activeDealersCount}`);
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
        // configDealerName is the crawl-loop dealer key (reliable even for
        // shared-inventory dealer groups where the vehicle's own scraped
        // dealerName differs — see the DDC extraction comment above); older
        // records predate that field, so fall back to dealerName for those.
        const dealerKey = prev.configDealerName || prev.dealerName;
        if (failedDealerNames.has(dealerKey)) {
            // This vehicle's dealer produced zero real evidence this run
            // (bot-blocked, fetch failure, or extraction failure) — carry it
            // forward unchanged instead of marking it sold. Worst case a
            // genuinely-sold vehicle stays ACTIVE one extra day; the
            // alternative (mass-marking a blocked dealer's whole active
            // inventory SOLD, confirmed happening live) is far worse.
            updatedSnapshot[vin] = prev;
            allRecords.push(prev);
            continue;
        }

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
    await runEnrichmentPipeline(Infinity, brand, { brandId: dbBrandId, runId: dbRunId });
} catch (enrichErr) {
    console.error('Enrichment step warning:', enrichErr.message);
}

// Close out the DB scrape_run row (non-fatal). This has to run after
// enrichment, not before: enrichment's syncInventoryToDatabase() call is
// what actually populates the vehicles this run touched, and its own
// per-chunk changeType counts are more authoritative than the pre-
// enrichment diff computed above — but that diff's aggregate counts are
// what scrape_runs' own summary columns want, so they're used here.
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

// The mysql2 connection pool keeps sockets/timers open, so the process
// never exits on its own once the crawl is genuinely done — confirmed live:
// this silently stalled an entire multi-batch sequence for 1.5+ hours
// (the orchestrating shell script blocks on this process, waiting for it
// to return control) because nothing forced the event loop to end. Also
// almost certainly why the daily Porsche/Ford-NJ cron processes are
// observed lingering as idle "zombies" long after their own logs show
// completion. Close the pool if it was ever opened, then exit explicitly.
try {
    const { closePool } = await import('./db.js');
    await closePool();
} catch {
    // db.js may never have been imported this run (DB_HOST unset) — fine.
}
process.exit(0);
