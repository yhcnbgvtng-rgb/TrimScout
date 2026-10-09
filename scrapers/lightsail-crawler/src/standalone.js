import { gotScraping } from 'got-scraping';
import { chromium } from 'patchright';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { runEnrichmentPipeline } from './enricher.js';
import { getBrand } from './brands.js';
import { normalizeVehicleFields, splitPorscheTrimFromModelName } from './modelNormalizer.js';
import { recoverModelTrim, recoverTrim } from './listingModel.js';
import { enrichYearAndModelFromUrl } from './porscheUrlFields.js';
import { findVehicleLd, readSchemaOrgVehicleFields } from './porscheSchemaOrgFields.js';
import { classifyFetchResult, isBotProtected, isUncrawlable, decideProbeNext, BOT_CLASSES } from './bot_protection.js';
import { withProbeRetry } from './probeRetry.js';
import { writeProgress, emptyProgress } from './progress.js';
import { dealerProbeUrls } from './nj_policy.js';
import {
    loadDomIndex,
    saveDomIndex,
    captureVehicleDom,
    recordSoldDom,
    flattenDomIndex,
    pruneDomBlobs,
} from './dom_store.js';
import { inventoryChangeTypeToPriceChangeType } from './price_diff.js';
import { looksLikeOptionSentence } from './optionSentenceFilter.js';
import { mergeInventorySnapshot } from './inventory_merge.js';
import { buildBrandChangeRecord, mergeDailyChangesDocument } from './daily_changes.js';
import { withSharedDataLock } from './shared_data_lock.js';
import { inventoryShardPath, inventoryShardsDir, snapshotShardPath } from './inventory_shards.js';

// One line per run so a heap limit can be sized from data: peak RSS and the heap limit this run had.
// (A run killed by the heap limit never reaches this — its own "Last few GCs" block shows the peak.)
process.on('exit', () => {
    try {
        console.log(`[mem] peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB, heap limit ${Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)} MB`);
    } catch { /* never fail an exit over a log line */ }
});
import { readJsonLarge, writeJsonLarge } from './bigJson.js';
import { resolveKeptMake } from './brand_match.js';
import { isLikelyVdpUrl } from './vdpUrlFilter.js';
import { fillFromFacebookPixelViewContent } from './facebookPixelFields.js';
import { fillColorsFromLabels } from './listingColors.js';
import { carryOptionsForward } from './optionsCapture.js';
import {
    collectSalesEmail,
    applyContactToDealer,
    loadDealerContacts,
    saveDealerContacts,
} from './sales_email.js';
import { applyWindowSticker } from './window_sticker.js';
import { recoverTrimFromUrl } from './vdpUrlTrim.js';
import { parseFeaturesFromDescription } from './descriptionFeatures.js';
import { resolveRunDate } from './date_utils.js';
import {
    readOdometer,
    resolveMileage,
    priceFromSource,
    priceFromSchemaOrgOffers,
    numberIsPaymentCopy,
} from './ingestSanitize.js';

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

await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
await fs.mkdir(CHANGES_DIR, { recursive: true });
await fs.mkdir(inventoryShardsDir(), { recursive: true });

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
// Which state this run belongs to — inferred from the dealer file itself
// (every dealer record built by nj_policy.js/ny_policy.js carries a
// `state`), with an explicit CRAWLER_STATE override for dealer files that
// predate that field. Used for the daily_changes slot (as before) AND, as
// of the state-sharding fix, to pick this run's own inventory/snapshot
// shard (see inventory_shards.js) instead of one nationwide file.
const state = process.env.CRAWLER_STATE || dealers[0]?.state || 'UNKNOWN';
const LATEST_SNAPSHOT_PATH = snapshotShardPath(state);
const INVENTORY_SHARD_PATH = inventoryShardPath(state);
// Used only to keep this run's own diagnostic checkpoint file (see the
// per-dealer checkpoint write below) from colliding with a concurrently
// running other state+brand's checkpoint file — never parsed back, so it
// just needs to be unique-enough per (state, brand), not reversible.
const checkpointSlug = `${state}_${brand.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const startedAt = new Date().toISOString();
const PAGE_WORKERS = Number(process.env.CRAWLER_CONCURRENCY) || 8;

console.log('====================================================');
console.log(`🏎️ ${brand.name.toUpperCase()} ALL-DEALERSHIP NATIONWIDE TRACKER`);
console.log(`Total Authorized ${brand.name} Centers Configured: ${dealers.length}`);
console.log(`Page workers: ${PAGE_WORKERS} (target 6–8) · Chromium recycle every ${Number(process.env.CRAWLER_PATCHRIGHT_RECYCLE_AFTER) || 10} dealers`);
console.log('Challenge pages are skipped and logged — no WAF/captcha bypass.');
console.log('====================================================\n');

const runProgress = emptyProgress({
    status: 'running',
    currentBrand: brand.name,
    dealersDone: 0,
    dealersTotal: dealers.length,
    startedAt,
});
// Real bug found live 2026-09-27: this is the one writeProgress() call in
// the whole file that wasn't wrapped like flushRunProgress()'s own call
// below, at a time when src/progress.js's write-tmp-then-rename raced on
// a single shared, unlocked tmp path whenever two states ran concurrently
// (MAX_CONCURRENT_STATES > 1) — confirmed live: MI Honda's first shard
// (2026-09-27, box4) died 2 seconds in this way, losing that shard's
// entire dealer list. writeProgress() itself is now race-free (it takes
// shared_data_lock.js's lock around its whole read+merge+write+rename, the
// same primitive already used for daily_changes — see progress.js). This
// try/catch stays anyway, same as every other writeProgress() call here:
// a write to this file is never worth crashing a whole crawl over.
try {
    await writeProgress(runProgress);
} catch (err) {
    console.error(`⚠️ Progress write failed: ${err.message}`);
}

let domIndex = await loadDomIndex();

let previousSnapshot = {};
try {
    previousSnapshot = await readJsonLarge(LATEST_SNAPSHOT_PATH);
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
        await dbMod.ensureNjOpsSchema();
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
            if (!description || looksLikeOptionSentence(description)) continue;
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
            // findVehicleLd handles both a flat Vehicle/Car object (the
            // 2026-09-22 fix below) and a schema.org "@graph" wrapper
            // bundling multiple entities into one block (2026-09-28 fix —
            // see its own comment in porscheSchemaOrgFields.js).
            //
            // Confirmed live 2026-09-22 on Porsche's own official retailer
            // platform (jackdaniels.porsche.com): its Vehicle JSON-LD uses
            // "@type":["Car","Product"] — an array, never the bare string
            // "Vehicle" this only used to match — so this strategy silently
            // returned null for every Porsche-network dealer's own real
            // markup, not just non-standard third-party ones.
            const found = findVehicleLd(parsed);
            if (found) {
                vehicleLd = found;
                break;
            }
        } catch {
            // not valid JSON, skip
        }
    }
    if (!vehicleLd) return null;

    const vin = vehicleLd.vehicleIdentificationNumber.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;

    // A monthly/lease Offer (UnitPriceSpecification per month, or a "$299/mo"
    // string) is not the vehicle's price — see ingestSanitize.js.
    const price = priceFromSchemaOrgOffers(vehicleLd.offers, cleanPrice);
    // Some dealer sites' schema.org Vehicle JSON-LD omits vehicleModelDate
    // and/or bakes trim into the URL slug rather than `model` (confirmed
    // live: Champion Porsche). See porscheUrlFields.js for the recovery
    // logic and its safety gates.
    const { year, model } = enrichYearAndModelFromUrl({ vehicleLd, url, dealer });

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
        model,
        trim: null,
        bodyStyle: cleanString(vehicleLd.bodyType),
        price,
        msrp: price,
        // mileage/exteriorColor/interiorColor/engine/transmission were all
        // hardcoded to null/0 despite real schema.org data being available
        // under these exact property names — confirmed live 2026-09-22 on
        // two real Porsche-network VDPs. See porscheSchemaOrgFields.js.
        ...readSchemaOrgVehicleFields(vehicleLd),
        // Wired into parseFeaturesFromDescription() (added 2026-09-26) —
        // that function already exists specifically to handle a VDP
        // description field safely, including the exact undelimited-
        // spec-sheet-dump case (Porsche Beverly Hills: "Standard
        // EquipmentMECHANICALFull-Time All-Wheel3.36 Axle Ratio...") that
        // was the reason this used to be hardcoded to []: with no commas/
        // periods/newlines to split on, that whole string becomes ONE
        // token far longer than parseFeaturesFromDescription's own 60-char
        // cap, so it's discarded there — the exact garbage case this
        // comment used to warn about never reaches dealerListedOptions.
        // Confirmed live 2026-09-26: this was found sitting fully built
        // and correctly guarded (marketing-prose detection, bulleted-list
        // preference, length caps) but never actually called anywhere —
        // Strategy 2 shipped dealerListedOptions: [] for every vehicle on
        // every brand regardless, which is most of why options_json runs
        // ~79-99% blank across Nissan/Honda/Toyota/Chevrolet/Kia.
        dealerListedOptions: parseFeaturesFromDescription(vehicleLd.description),
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
    // strip the confirmed-matching prefix rather than guess a split — see
    // splitPorscheTrimFromModelName's own comment for why this needs to be
    // case-insensitive.
    const trim = splitPorscheTrimFromModelName(rawModelRange, modelName);

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
        mileage: readOdometer(typeof car.mileageValue === 'number' ? car.mileageValue : null),
        exteriorColor: null,
        interiorColor: null,
        engine: cleanString(car.engineType),
        transmission: null,
        dealerListedOptions: [],
        imageUrl: extractImageUrl(html, null, url),
        url,
    };
}

async function safeFetch(url, timeoutMs = 7000, patchrightPage = null) {
    // patchright fallback: a real browser navigation (not gotScraping's
    // plain HTTP, and not even an in-page fetch()) — confirmed live that
    // Cloudflare's bot-fight challenge treats navigations and fetch()
    // requests differently, only clearing on real page.goto() navigations.
    // Only used for dealers whose plain HTTP fetch already came back
    // bot-blocked; every dealer that already worked keeps using gotScraping
    // unchanged.
    if (patchrightPage) {
        // res.text() reads the raw HTTP response body (same shape gotScraping
        // returns) rather than page.content()/DOM state — confirmed live
        // page.content() came back empty for an XML response (Chromium
        // doesn't populate a normal DOM for it), while res.text() returns
        // the real body correctly and fast (~300ms once the domain's
        // Cloudflare challenge is already cleared).
        const res = await patchrightPage.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const body = res ? await res.text() : '';
        return { body, statusCode: res ? res.status() : 0 };
    }
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

// Detect-only probe. Uses the same HTTP client as the crawl so we classify
// what the crawler itself would see. Never launches a browser, never
// retries a challenge, never tries to "solve" it.
async function probeDealerBotProtection(dealer) {
    let soft = null;
    for (const url of dealerProbeUrls(dealer)) {
        let cls;
        try {
            const res = await safeFetch(url, 8000);
            cls = {
                ...classifyFetchResult({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: res.body,
                }),
                url,
            };
        } catch (error) {
            cls = { ...classifyFetchResult({ error }), url };
        }
        const action = decideProbeNext(cls);
        if (action === 'accept' || action === 'stop') return cls;
        if (action === 'continue' && !soft) soft = cls;
    }
    return soft || { classification: 'NONE', httpStatus: 200, notes: '', url: null };
}

// HTTP_429 specifically means "you're going too fast, try again later" — the
// textbook retry-after-backoff case, and the one production evidence
// actually supports: a real-night audit (box2 core, 2026-09-22) found only
// 23 dealers fleet-wide skipped for HTTP_429 specifically, out of ~1,900
// skipped total (versus 1,095 Cloudflare + 665 HTTP_403 — deterministic WAF
// blocks a retry can't help with). One retry after a real wait costs this
// box roughly 20 minutes total across a whole night's run — trivial against
// the 23-24h SLA — while a blanket slowdown of every dealer's page-fetch
// concurrency to reduce 429s in the first place was estimated at 4-5 HOURS
// added for a box this size, which the fleet's SLA margin (see
// docs/CAPACITY_SLA.md) can't absorb. Deliberately does NOT retry
// CONN_RESET/TIMEOUT/DNS_DEAD/TLS here — see INFRA_NO_HOMEPAGE_RETRY's own
// comment in bot_protection.js for why those don't benefit from retrying
// the same target.
const PROBE_RETRY_CLASSES = new Set([BOT_CLASSES.HTTP_429]);
const PROBE_RETRY_DELAY_MS = 45_000;

async function probeDealerBotProtectionWithRetry(dealer) {
    return withProbeRetry(() => probeDealerBotProtection(dealer), {
        retryClasses: PROBE_RETRY_CLASSES,
        delayMs: PROBE_RETRY_DELAY_MS,
        onRetry: (first) => console.log(`  ⏳ ${dealer.name}: ${first.classification} — waiting ${Math.round(PROBE_RETRY_DELAY_MS / 1000)}s and retrying once before giving up`),
    });
}

async function flushRunProgress(extra = {}) {
    Object.assign(runProgress, extra, {
        vehiclesSeen: currentInventory.size,
        currentBrand: brand.name,
    });
    try {
        await writeProgress(runProgress);
    } catch (err) {
        console.error(`⚠️ Progress write failed: ${err.message}`);
    }
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

// Some platforms (confirmed live 2026-09-25: Audi's own OEM-endorsed retailer
// sitemap template, e.g. audiforsythcounty.com's sitemap-vdp-sitemap_*.xml)
// wrap every <loc> value in a CDATA section — <loc><![CDATA[https://...]]></loc>
// — which the plain `<loc>([^<]+)</loc>` pattern below can never match: the
// capture group requires a non-'<' character immediately after <loc>, but the
// very next character is the '<' that starts <![CDATA[, so the match fails
// silently on every single URL in the file. A real dealer's real inventory
// (confirmed live: 237 valid VIN-tagged VDP URLs) was being read as zero and
// logged as "No inventory URLs detected" — not a bot block, not a missing
// sitemap, just this one regex never seeing the URLs that were right there.
// Matches either shape; group 1 or group 2 holds the URL, whichever branch fired.
const LOC_RE = /<loc>\s*(?:<!\[CDATA\[([^\]]+)\]\]>|([^<]+))\s*<\/loc>/gi;
const locMatches = (xml) => [...xml.matchAll(LOC_RE)].map((m) => decodeXmlEntities((m[1] ?? m[2] ?? '').trim())).filter(Boolean);

async function fetchSitemapXmlUrls(sitemapUrl, depth = 0, brand, patchrightPage = null) {
    if (depth > 2) return [];
    const brandWord = brand.name.toLowerCase();
    try {
        let xml = '';
        if (patchrightPage) {
            // Same patchright-navigation fallback as safeFetch — see its
            // header comment. gzip sitemaps aren't handled on this path (the
            // browser already transparently decompresses gzip transfer
            // encoding), which covers every case actually seen live so far.
            const res = await patchrightPage.goto(sitemapUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
            xml = res ? await res.text() : '';
        } else {
            const res = await gotScraping({
                url: sitemapUrl,
                responseType: 'buffer',
                timeout: { request: 8000 },
                retry: { limit: 1 },
            });
            if (sitemapUrl.endsWith('.gz') || (res.rawBody[0] === 0x1f && res.rawBody[1] === 0x8b)) {
                try { xml = zlib.gunzipSync(res.rawBody).toString('utf-8'); } catch { xml = res.rawBody.toString('utf-8'); }
            } else {
                xml = res.rawBody.toString('utf-8');
            }
        }

        const childSitemaps = [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].flatMap((m) => locMatches(m[1]));
        if (childSitemaps.length > 0) {
            const inventoryChild = childSitemaps.filter((u) => new RegExp(`vehicle|inventory|cars|${brandWord}|sitemap`, 'i').test(u));
            const targets = inventoryChild.length > 0 ? inventoryChild : childSitemaps;
            let nested = [];
            for (const child of targets.slice(0, 8)) {
                nested.push(...await fetchSitemapXmlUrls(child, depth + 1, brand, patchrightPage));
            }
            return nested;
        }

        const allUrls = locMatches(xml);
        return allUrls.filter((u) => isLikelyVdpUrl(u, brand));
    } catch {
        return [];
    }
}

async function resolveSitemapUrls(dealer, brand, patchrightPage = null) {
    const candidateUrls = [
        dealer.sitemapUrl,
        dealer.inventorySitemapUrl,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap-inventory.xml`,
        `https://${dealer.domain || new URL(dealer.sitemapUrl).hostname}/sitemap.xml`,
        dealer.fallbackUrl
    ].filter(Boolean);

    for (const url of candidateUrls) {
        const found = await fetchSitemapXmlUrls(url, 0, brand, patchrightPage);
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

// Same worker-pool shape as pMap, but each of the `pages.length` workers
// gets its own dedicated patchright Page (all sharing one context, so the
// Cloudflare clearance cookie from the homepage visit applies to every
// page) instead of firing independent gotScraping requests. Concurrency is
// capped at pages.length rather than a plain number, since a genuinely
// concurrent navigation needs its own Page object — one Page can't
// navigate two URLs "at once".
async function pMapWithPages(items, mapper, pages) {
    let cursor = 0;
    const workers = pages.map((page) => (async () => {
        while (cursor < items.length) {
            const idx = cursor++;
            try {
                await mapper(items[idx], idx, page);
            } catch {}
        }
    })());
    await Promise.allSettled(workers);
}

// Lazily launched — only the dealers whose plain-HTTP sitemap fetch comes
// back empty ever need this, so most crawl runs never pay the cost of
// starting a browser at all. Reused across dealers that need it (fresh
// context per dealer — closed in the main loop's finally block), but the
// browser process itself is recycled every PATCHRIGHT_RECYCLE_AFTER uses
// rather than kept alive for an entire multi-hour, hundreds-of-dealers run.
// Confirmed live (Acura, 08-29): a single long-lived browser hit a kernel-
// level "TCP: out of memory" around dealer 14 of a run using the fallback
// on roughly half the dealers so far — contexts were being closed
// correctly, but Chromium's own per-connection socket/process state
// apparently still accumulates across many hours in one browser process.
// Periodic recycling bounds that regardless of the exact leak source.
let patchrightBrowser = null;
let patchrightUseCount = 0;
const PATCHRIGHT_RECYCLE_AFTER = Number(process.env.CRAWLER_PATCHRIGHT_RECYCLE_AFTER) || 10;
async function getPatchrightBrowser() {
    if (patchrightBrowser && patchrightUseCount >= PATCHRIGHT_RECYCLE_AFTER) {
        await patchrightBrowser.close().catch(() => {});
        patchrightBrowser = null;
        patchrightUseCount = 0;
    }
    if (!patchrightBrowser) {
        patchrightBrowser = await chromium.launch({ headless: true });
    }
    patchrightUseCount++;
    return patchrightBrowser;
}

const PATCHRIGHT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PATCHRIGHT_PAGE_POOL_SIZE = Number(process.env.CRAWLER_PATCHRIGHT_CONCURRENCY) || 3;

// Attempts the same dealer via a real browser instead of gotScraping —
// only called after the plain-HTTP path already came back with zero
// vehicle URLs. Confirmed live (Chevrolet, 08-28): plain HTTP to both the
// homepage and every sitemap path gets Cloudflare's standard bot-fight
// "Attention Required" challenge (HTTP 403), which patchright resolves via
// a real homepage navigation — subsequent navigations to other paths on
// the same domain then clear fast (~300ms-2.5s) reusing that same
// context's cookies, no need to re-solve per URL. Returns null (no
// context left dangling) if even the homepage navigation doesn't produce
// real content, so the dealer is correctly left in failedDealerNames
// rather than reported as a false success.
async function tryPatchrightFallback(dealer, brand) {
    const browser = await getPatchrightBrowser();
    const context = await browser.newContext({ userAgent: PATCHRIGHT_USER_AGENT });
    // Every fetch through this fallback only ever reads the raw HTTP
    // response body (res.text() — see safeFetch/fetchSitemapXmlUrls), never
    // rendered pixels or evaluated JS, so images/fonts/media/stylesheets
    // are pure overhead here — a real dealer VDP page pulls in dozens of
    // them. First smoke test (before this) took 19+ minutes for one
    // 280-vehicle dealer at 3-way concurrency; aborting these request
    // types is the standard fix for exactly that cost.
    await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
            return route.abort();
        }
        return route.continue();
    });
    try {
        const homepageUrl = `https://${dealer.domain}`;
        const page = await context.newPage();
        await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(6000);

        const vehicleUrls = await resolveSitemapUrls(dealer, brand, page);
        if (vehicleUrls.length === 0) {
            await context.close();
            return null;
        }

        const pages = [page];
        for (let p = 1; p < PATCHRIGHT_PAGE_POOL_SIZE; p++) {
            pages.push(await context.newPage());
        }
        return { context, pages, vehicleUrls };
    } catch {
        await context.close().catch(() => {});
        return null;
    }
}

const currentInventory = new Map();
// Calendar-date bucketing (file naming, firstSeen/lastSeen, DOM retention)
// uses the Eastern calendar date, not UTC — see date_utils.js. todayIso
// below is a real UTC instant (when this run happened) and stays as-is.
//
// Uses CRAWLER_RUN_DATE (set by run-daily-crawl.mjs to its own canonical
// once-per-run date) when present, rather than computing this
// subprocess's own Eastern date fresh — see resolveRunDate()'s comment in
// date_utils.js for the midnight-crossing ledger-split bug this fixes.
// Falls back to computing it fresh when unset, so a manual/ad hoc
// `node src/standalone.js` run (not launched by the driver) is unaffected.
const todayDate = resolveRunDate();
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
let skippedBotProtection = 0;
const dealerContacts = await loadDealerContacts();

// A single pathological dealer (huge sitemap, a slow-failing site) should
// never be able to stall the whole nationwide run — confirmed live
// (Acura, West Herr Acura, 08-30) a dealer can run for hours with nothing
// to stop it. Closing the patchright context on timeout is a REAL cancel,
// not just abandoning a promise: it aborts in-flight page navigations, so
// pMapWithPages's remaining workers fail-fast and the loop actually moves
// on within seconds of the timeout firing, not "eventually."
const DEALER_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

for (let i = 0; i < dealers.length; i++) {
    const dealer = dealers[i];
    const progress = `[${i + 1}/${dealers.length}]`;
    console.log(`${progress} 🏢 Crawling ${dealer.name} (${dealer.city}, ${dealer.state})...`);
    runProgress.currentDealer = dealer.name;
    await flushRunProgress();

    const botProbe = await probeDealerBotProtectionWithRetry(dealer);
    if (isUncrawlable(botProbe.classification)) {
        if (isBotProtected(botProbe.classification)) skippedBotProtection++;
        failedDealerNames.add(dealer.name);
        dealerStats[dealer.name] = 0;
        runProgress.skippedForBotProtection = skippedBotProtection;
        runProgress.dealersDone = i + 1;
        runProgress.lastError = `${dealer.name}: ${botProbe.classification}${botProbe.httpStatus ? ` HTTP ${botProbe.httpStatus}` : ''} — skipped, no bypass`;
        const kind = isBotProtected(botProbe.classification) ? 'bot protection' : 'uncrawlable';
        console.log(`${progress} 🛡️ SKIP ${dealer.name}: ${botProbe.classification}${botProbe.httpStatus ? ` (${botProbe.httpStatus})` : ''} — ${botProbe.notes || kind} [${botProbe.url || dealer.domain}]`);
        await flushRunProgress();
        continue;
    }

    try {
        const contact = await collectSalesEmail(dealer, {
            getHtml: async (url) => {
                try {
                    const res = await safeFetch(url, 8000);
                    return {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: res.body,
                    };
                } catch (error) {
                    return { error };
                }
            },
        });
        applyContactToDealer(dealer, contact);
        if (dealer.domain) {
            dealerContacts[dealer.domain] = {
                dealerName: dealer.name,
                brand: dealer.make || brand.name,
                ...contact,
            };
            await saveDealerContacts(dealerContacts);
        }
        if (contact.salesEmail) {
            console.log(`${progress} ✉️ ${dealer.name} sales inbox: ${contact.salesEmail} (${contact.emailSourceUrl})`);
        }
    } catch (emailErr) {
        console.error(`${progress} ✉️ Email collect failed for ${dealer.name}: ${emailErr.message}`);
    }

    let patchrightFallback = null;
    let dealerTimedOut = false;
    const dealerTimeoutHandle = setTimeout(() => {
        dealerTimedOut = true;
        console.log(`${progress} ⏱️ ${dealer.name} has been running over 1 hour — abandoning it and moving to the next dealer.`);
        if (patchrightFallback) {
            patchrightFallback.context.close().catch(() => {});
        }
    }, DEALER_TIMEOUT_MS);

    try {
        let vehicleUrls = await resolveSitemapUrls(dealer, brand);
        if (vehicleUrls.length === 0 && process.env.CRAWLER_PATCHRIGHT_FALLBACK !== 'false') {
            // Challenge / WAF pages were already skipped above. This fallback
            // is only for a sitemap that came back empty without a detected
            // challenge — it is not a captcha solver and must not be used as
            // one. Set CRAWLER_PATCHRIGHT_FALLBACK=false on the NJ box if
            // you want HTTP-only crawls.
            console.log(`${progress} 🛡️ No inventory URLs via plain HTTP for ${dealer.name} — trying patchright fallback...`);
            patchrightFallback = await tryPatchrightFallback(dealer, brand);
            if (patchrightFallback) {
                vehicleUrls = patchrightFallback.vehicleUrls;
                console.log(`${progress} 🛡️ Patchright recovered ${vehicleUrls.length} vehicle URLs for ${dealer.name}.`);
            }
        }
        if (vehicleUrls.length === 0) {
            console.log(`${progress} ⚠️ No inventory URLs detected for ${dealer.name}.`);
            dealerStats[dealer.name] = 0;
            failedDealerNames.add(dealer.name);
            continue;
        }
        // Hard backstop for a pathologically large single lot (a genuine
        // used-car superstore, or a megadealer group whose sitemap covers
        // several physical locations at once) — DEALER_TIMEOUT_MS already
        // bounds this dealer's wall-clock time, but a huge vehicle count
        // still means a huge downstream NHTSA-enrichment bill for this one
        // dealer even with the enrichment pool parallelized (see
        // enricher.js). Slicing rather than sampling: the sitemap/DDC
        // ordering is typically newest-first already, so the kept subset is
        // still representative, real inventory, not an arbitrary chunk.
        // 0 (the default) means no cap, matching every dealer's behavior
        // before this existed.
        const maxVehiclesPerDealer = Number(process.env.CRAWLER_MAX_VEHICLES_PER_DEALER) || 0;
        if (maxVehiclesPerDealer > 0 && vehicleUrls.length > maxVehiclesPerDealer) {
            console.log(`${progress} ✂️ ${dealer.name} has ${vehicleUrls.length} vehicle URLs — capping to ${maxVehiclesPerDealer}.`);
            vehicleUrls = vehicleUrls.slice(0, maxVehiclesPerDealer);
        }
        if (dealerTimedOut) {
            // The 1-hour mark already passed during sitemap resolution
            // itself (rare — that phase has its own short per-request
            // timeouts) — don't start a whole new extraction pass on a
            // dealer we've already decided to abandon.
            dealerStats[dealer.name] = 0;
            failedDealerNames.add(dealer.name);
            continue;
        }

        console.log(`${progress} Found ${vehicleUrls.length} vehicle URLs. Extracting data...`);

        let dealerCount = 0;
        const extractOne = async (url, _idx, patchrightPage) => {
            try {
                const res = await safeFetch(url, patchrightPage ? 15000 : 7000, patchrightPage);
                const html = res.body;
                const pageClass = classifyFetchResult({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: html,
                });
                if (isBotProtected(pageClass.classification)) {
                    return;
                }
                let vehicle = null;

                // Strategy 1: DDC DataLayer (Dealer.com)
                const ddcMatch = html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
                                 html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
                if (ddcMatch) {
                    try {
                        vm.runInContext('vehicles = ' + ddcMatch[1], ddcEvalContext);
                        if (ddcEvalContext.vehicles && ddcEvalContext.vehicles.length > 0) {
                            const raw = ddcEvalContext.vehicles[0];
                            const askingPrice = priceFromSource(raw.askingPrice, cleanPrice);
                            const salePrice = priceFromSource(raw.salePrice, cleanPrice);
                            const retailValue = priceFromSource(raw.retailValue, cleanPrice);
                            const price = salePrice || askingPrice || retailValue || null;
                            const msrp = retailValue || askingPrice || null;
                            // null when the page had no odometer — never a `|| 0` default
                            // (resolveMileage below decides what a stated 0 means per condition).
                            const mileage = readOdometer(raw.odometer ?? raw.mileage);

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

                // Strategy 2b: manufacturer's own official retailer platform
                // (RSC) — only Porsche has one of these (confirmed this
                // session: Audi, VW, and Lamborghini each run separate,
                // brand-specific systems), so this is skipped entirely for
                // other brands rather than wastefully attempted. Tried
                // BEFORE the generic schema.org strategy below when this
                // brand has one, so its richer, brand-authoritative fields
                // (real trim, stock #, model) aren't silently discarded by
                // a same-page schema.org block winning the race just
                // because it happened to run first and also found a VIN.
                // Confirmed live 2026-09-22 (Porsche inventory audit):
                // RSC-platform VDPs often ALSO emit a generic schema.org
                // Vehicle block for SEO, which used to win here every time
                // and permanently hid 2b's real data for those dealers
                // despite hasOfficialRetailerPlatform saying they should
                // use it.
                if (brand.hasOfficialRetailerPlatform && (!vehicle || !vehicle.vin)) {
                    vehicle = extractPorscheRetailerVehicle(html, url, dealer);
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
                    // A figure sitting next to "/mo", "per month" or "down" is a lease
                    // payment, not the price — drop it (price stays blank) rather than
                    // store it. No minimum-price rule: cheap used cars are real prices.
                    const priceIsPayment = (m) => !!m && numberIsPaymentCopy(html, m.index + m[0].lastIndexOf(m[1]), m[1].length);
                    if (priceIsPayment(priceMatch)) priceMatch = null;
                    if (!priceMatch && vinMatch) {
                        const vinIndex = html.indexOf(vinMatch[1]);
                        if (vinIndex !== -1) {
                            const windowStart = Math.max(0, vinIndex - 2000);
                            const windowEnd = Math.min(html.length, vinIndex + 2000);
                            const windowText = html.slice(windowStart, windowEnd);
                            priceMatch = windowText.match(/"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?/i);
                            if (priceMatch && numberIsPaymentCopy(windowText, priceMatch.index + priceMatch[0].lastIndexOf(priceMatch[1]), priceMatch[1].length)) priceMatch = null;
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
                            mileage: null,
                            exteriorColor: null,
                            interiorColor: null,
                            engine: null,
                            transmission: null,
                            url,
                        };
                    }
                }

                // Strategy 3b: Facebook Pixel "ViewContent" fallback — see
                // facebookPixelFields.js's own header for why. Runs after
                // every extraction strategy above regardless of which one
                // (if any) produced `vehicle`, and only fills gaps — a
                // real value any stronger strategy already found is never
                // overwritten.
                vehicle = fillFromFacebookPixelViewContent(vehicle, html);
                // The page's own labelled Exterior / Interior Color fields (listingColors.js) — blanks only.
                vehicle = fillColorsFromLabels(vehicle, html);

                if (vehicle && vehicle.vin && vehicle.vin.length >= 16) {
                    // Multi-brand isolation check — see brand_match.js. Most
                    // brands are single-nameplate (brand.name IS the real
                    // make); Stellantis is multi-nameplate (brand.nameplates
                    // = Jeep/Ram/Dodge/Chrysler/Fiat, since they share the
                    // same rooftops) and resolveKeptMake keeps each
                    // vehicle's own real nameplate instead of collapsing it
                    // to the umbrella crawl-scope name. A vehicle that
                    // doesn't match this crawl's target brand/nameplates at
                    // all (e.g. a used Porsche trade-in found on a
                    // single-franchise VW store's own site) is still kept,
                    // tagged with its own real make, rather than discarded —
                    // see resolveKeptMake's own header for why.
                    const keptMake = resolveKeptMake(brand, vehicle);

                    if (keptMake) {
                        // Collapse to the canonical nameplate. keptMake is
                        // either the crawl's own resolved nameplate (any raw
                        // label variant a source site used — "FORD TRUCK",
                        // "FORD MEDIUM TRUCK", etc. — is the same vehicle,
                        // not a different make) or, for an off-brand
                        // vehicle, its own real make as the site reported
                        // it — never overwritten to this crawl's brand.
                        vehicle.make = keptMake;
                        // Blank model recovery — see listingModel.js. ~1.2% of in-stock rows arrived with year + make but no
                        // model (Honda/Toyota/Audi/Hyundai/Nissan/Ford ...) although the page's own title, JSON-LD, breadcrumbs or URL
                        // name it. Runs here, after every extraction strategy converged and before the brand normalizer, for any
                        // make. Never overwrites a model a strategy found; only a name the database already uses for that make
                        // (or a short structured schema.org model) is ever written. Logged either way so a platform where this
                        // recovers nothing is visible in the crawl log.
                        if (!vehicle.model || !String(vehicle.model).trim()) {
                            // extractOne's outer catch drops the vehicle on any throw, so a bug here must never escape.
                            let recovered = null;
                            try { recovered = recoverModelTrim({ vehicle, html, url }); } catch (err) { console.log(`⚠️ model recovery error (ignored): ${vehicle.vin} ${err.message}`); }
                            if (recovered && recovered.model) {
                                vehicle.model = recovered.model;
                                if (recovered.trim && !(vehicle.trim && String(vehicle.trim).trim())) vehicle.trim = recovered.trim;
                                console.log(`ℹ️ blank model recovered from ${recovered.source}: ${vehicle.vin} -> ${recovered.model}${recovered.trim ? ` / ${recovered.trim}` : ''}`);
                            } else {
                                console.log(`⚠️ model still blank after page recovery: ${vehicle.vin} ${url}`);
                            }
                        }
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
                        // Dispatches on the real kept make, not the umbrella
                        // brand.name, so both a multi-nameplate config and
                        // an off-brand vehicle get their own normalization.
                        vehicle = normalizeVehicleFields(keptMake, vehicle);
                        // URL-slug trim recovery — see vdpUrlTrim.js. Runs
                        // here, after every extraction strategy converges,
                        // for the same reason applyWindowSticker below
                        // does: cross-brand and cross-platform by
                        // construction, not keyed to which strategy (DDC,
                        // schema.org, regex fallback) produced `vehicle`.
                        // Only fills a genuinely blank trim — never
                        // overwrites a real value a stronger strategy
                        // already found. Logged so a state/brand where
                        // this can't recover anything (HTTP 200 but still
                        // blank) is visible in the crawl log, not silent.
                        if (!vehicle.trim) {
                            const recoveredTrim = vehicle.model ? recoverTrimFromUrl(url, vehicle.model, vehicle.vin) : null;
                            if (recoveredTrim) {
                                vehicle.trim = recoveredTrim;
                            } else {
                                console.log(`⚠️ trim still blank after HTTP 200 and URL-slug recovery: ${vehicle.vin} ${url}`);
                            }
                        }
                        // Page-text trim (title / JSON-LD name) when the URL slug had none — same "only a blank trim" rule.
                        if (!vehicle.trim && vehicle.model) {
                            let pageTrim = null;
                            try { pageTrim = recoverTrim({ vehicle, html }); } catch (err) { console.log(`⚠️ trim recovery error (ignored): ${vehicle.vin} ${err.message}`); }
                            if (pageTrim) vehicle.trim = pageTrim.trim;
                        }
                        // Condition is final here, so this is the one place a used/CPO
                        // listing with no odometer becomes null instead of a 0 default.
                        vehicle.mileage = resolveMileage(vehicle.mileage, vehicle.inventoryType);
                        applyWindowSticker(vehicle, html, url, { classification: pageClass.classification });
                        // Options once per VIN (optionsCapture.js): a VIN whose options were captured earlier keeps them (a junk or
                        // half-loaded page tonight cannot replace them); a fresh good parse is stamped as the capture. The listing page
                        // is fetched anyway for price and stock — options come from the same response, so there is no separate
                        // request to skip here.
                        try { carryOptionsForward(vehicle, previousSnapshot[vehicle.vin]); } catch (err) { console.log(`⚠️ options carry-forward error (ignored): ${vehicle.vin} ${err.message}`); }
                        currentInventory.set(vehicle.vin, vehicle);
                        dealerCount++;
                        const prev = previousSnapshot[vehicle.vin];
                        try {
                            await captureVehicleDom({
                                vin: vehicle.vin,
                                date: todayDate,
                                html,
                                price: vehicle.price,
                                yesterdayPrice: prev?.price ?? null,
                                isNew: !prev,
                                cwd: process.cwd(),
                                index: domIndex,
                            });
                        } catch {}
                    }
                }
            } catch {}
        };

        if (patchrightFallback) {
            await pMapWithPages(vehicleUrls, extractOne, patchrightFallback.pages);
        } else {
            await pMap(vehicleUrls, extractOne, PAGE_WORKERS);
        }

        dealerStats[dealer.name] = dealerCount;
        if (dealerCount > 0) {
            activeDealersCount++;
        } else {
            // Pages were fetched but nothing survived extraction — same "no
            // real evidence this run" situation as the zero-URL case above.
            failedDealerNames.add(dealer.name);
        }
        if (dealerTimedOut) {
            // Closing the context made pMapWithPages settle instead of throw
            // (each worker's own try/catch swallows the abort), so this is
            // the success path even though the dealer was really cut short.
            failedDealerNames.add(dealer.name);
            console.log(`${progress} ⏱️ Kept ${dealerCount} vehicles extracted before the 1-hour cutoff for ${dealer.name}. (Running Total: ${currentInventory.size})`);
        } else {
            console.log(`${progress} ✅ Extracted ${dealerCount} vehicles from ${dealer.name}. (Running Total: ${currentInventory.size})`);
        }
    } catch (err) {
        erroredDealersCount++;
        failedDealerNames.add(dealer.name);
        runProgress.lastError = `${dealer.name}: ${err.message}`;
        console.error(`${progress} ❌ Error crawling ${dealer.name}: ${err.message}`);
    } finally {
        clearTimeout(dealerTimeoutHandle);
        if (patchrightFallback) {
            await patchrightFallback.context.close().catch(() => {});
        }
        runProgress.dealersDone = i + 1;
        runProgress.skippedForBotProtection = skippedBotProtection;
        await flushRunProgress();
        try {
            await saveDomIndex(domIndex);
        } catch (domErr) {
            console.error(`⚠️ DOM index write failed: ${domErr.message}`);
        }
    }

    // Checkpoint after every dealer. A full nationwide run can take hours;
    // without this, a stall or crash partway through loses everything —
    // the real output files only get written after the whole loop finishes.
    //
    // Scoped to this run's own state+brand (not a single shared filename):
    // with run-daily-crawl.mjs now able to run more than one state's brand
    // loop at once, a shared, unscoped checkpoint filename would have two
    // processes overwriting the same file all through both runs, leaving
    // whichever wrote last as pure noise (this file is diagnostic-only —
    // never read back by anything in this repo — but corrupting it for
    // nothing when a one-line scope fixes it isn't worth doing).
    try {
        await writeJsonLarge(
            path.join(DATA_DIR, `checkpoint_raw_inventory_${checkpointSlug}.json`),
            Array.from(currentInventory.values())
        );
    } catch (checkpointErr) {
        console.error(`⚠️ Checkpoint write failed: ${checkpointErr.message}`);
    }
}

if (patchrightBrowser) {
    await patchrightBrowser.close().catch(() => {});
}

console.log(`\n🎉 Nationwide Crawl Complete!`);
console.log(`Total Active ${brand.name} Centers with Live Inventory: ${activeDealersCount}`);
console.log(`Total Live Vehicles Tracked: ${currentInventory.size}`);

// Compute this state's diffs — merged against this state's OWN shared
// snapshot shard (every brand ever crawled for this state, not every
// brand/state in the whole box — see inventory_shards.js), scoped so this
// run only ever touches its own brand's dealers. See inventory_merge.js's
// header comment for the cross-brand data-loss bug this fixes: without
// that scoping, every other brand's active inventory got mislabeled
// SOLD_OR_REMOVED on every run, and then dropped entirely two runs later.
//
// Concurrency: the snapshot+inventory read/merge/write below runs inside a
// lock SCOPED TO THIS STATE (see shared_data_lock.js) — a different state's
// concurrent brand-run touches a completely different shard file, so it
// never even attempts this lock, unlike the old single nationwide lock
// every brand-run used to queue behind. The daily_changes file is still
// genuinely nationwide-shared (every state's brands append into the SAME
// day's file), so it keeps its own lock, scoped by today's date instead.
// Both critical sections — critically — re-read their file FRESH right
// here, rather than trusting `previousSnapshot` (read once at process
// start, ~a whole crawl ago) or a read taken outside the lock: with
// run-daily-crawl.mjs running up to MAX_CONCURRENT_STATES states' brand
// loops at once, another BRAND in this same state (or another state, for
// daily_changes) may have written a newer version of either file at any
// point during this run's own (possibly hours-long) crawl; merging against
// the stale start-of-run copy would silently discard that update the
// moment this run writes. The early `previousSnapshot` read up top is left
// in place and still used for the per-vehicle DOM "yesterdayPrice"/"isNew"
// bookkeeping during the crawl above — that's informational, not
// authoritative, so a bit of staleness there is harmless; only the actual
// merge below needs the freshest possible base.
let latestPreviousSnapshot = {};
let dailyChangesDoc;
let updatedSnapshot;
let allRecords;
let newArrivals;
let priceDrops;
let priceIncreases;
let soldVehicles;

await withSharedDataLock(async () => {
    try {
        latestPreviousSnapshot = await readJsonLarge(LATEST_SNAPSHOT_PATH);
    } catch {
        latestPreviousSnapshot = {};
    }

    ({ updatedSnapshot, allRecords, newArrivals, priceDrops, priceIncreases, soldVehicles } = mergeInventorySnapshot({
        previousSnapshot: latestPreviousSnapshot,
        currentInventory,
        dealers,
        failedDealerNames,
        todayDate,
        todayIso,
        toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    }));

    for (const soldRecord of soldVehicles) {
        try {
            await recordSoldDom({
                vin: soldRecord.vin,
                date: todayDate,
                yesterdayPrice: soldRecord.price ?? null,
                cwd: process.cwd(),
                index: domIndex,
            });
        } catch {}
    }

    // Streamed element by element and renamed into place (bigJson.js): a large state's shard no longer has to fit in
    // one V8 string (~512 MB), and a kill mid-write can't leave a truncated file for the sync to read.
    await writeJsonLarge(LATEST_SNAPSHOT_PATH, updatedSnapshot);
    await writeJsonLarge(INVENTORY_SHARD_PATH, allRecords);
}, { scope: state, label: `standalone:${state}/${brand.name}` });

// Persist this brand's slot in today's daily_changes_<date>.json — merged
// in (read-modify-write), never a whole-file overwrite. See
// daily_changes.js's header comment: overwriting here used to make every
// earlier brand run today vanish from this file the moment the next brand
// finished. Locked separately from the snapshot/inventory write above,
// scoped by date rather than state, since this file is the one place every
// state's brands today still genuinely share one file.
const brandChangeRecord = buildBrandChangeRecord({
    brand: brand.name,
    state,
    todayDate,
    todayIso,
    totalDealersConfigured: dealers.length,
    activeDealersCount,
    currentInventorySize: currentInventory.size,
    newArrivals,
    priceDrops,
    priceIncreases,
    soldVehicles,
    dealerStats,
    skippedForBotProtection: skippedBotProtection,
});

await withSharedDataLock(async () => {
    let existingChangesDoc = null;
    try {
        existingChangesDoc = await readJsonLarge(path.join(CHANGES_DIR, `daily_changes_${todayDate}.json`));
    } catch {
        // No file yet today (first brand of the day, or first day ever) — fine.
    }

    dailyChangesDoc = mergeDailyChangesDocument({
        existing: existingChangesDoc,
        state,
        brand: brand.name,
        brandRecord: brandChangeRecord,
        todayDate,
        todayIso,
    });

    await writeJsonLarge(path.join(CHANGES_DIR, `daily_changes_${todayDate}.json`), dailyChangesDoc);
}, { scope: `daily-changes-${todayDate}`, label: `standalone:${state}/${brand.name}/daily-changes` });

try {
    await saveDomIndex(domIndex);
    const pruned = await pruneDomBlobs({ today: todayDate });
    console.log(`DOM snapshots: hashes kept indefinitely; pruned ${pruned.removed} blob(s) older than 7 days (cutoff ${pruned.cutoff}).`);
} catch (domErr) {
    console.error('DOM snapshot finalize warning:', domErr.message);
}

console.log('\n====================================================');
console.log(`📊 NATIONWIDE PORSCHE MARKET SUMMARY (${todayDate})`);
console.log(`Active Live Inventory:   ${currentInventory.size}`);
console.log(`New Arrivals Today:     ${newArrivals.length}`);
console.log(`Price Drops Today:      ${priceDrops.length}`);
console.log(`Sold / Removed Today:   ${soldVehicles.length}`);
console.log(`Skipped bot protection: ${skippedBotProtection}`);
console.log(`Data Output:            ${DATA_DIR}`);
console.log('====================================================\n');

// Automatically trigger enrichment pipeline on all captured inventory
try {
    console.log('⚡ Triggering automatic spec enrichment pipeline...');
    // Only this run's own dealers' vehicles need enrichment — they're the
    // ones just (re)crawled with fresh dealerListedOptions. Every other
    // brand's already-enriched vehicles in the shared inventory file are
    // left completely alone (see enricher.js's vinsToEnrich comment).
    await runEnrichmentPipeline(Infinity, brand, { brandId: dbBrandId, runId: dbRunId }, Array.from(currentInventory.keys()), state);
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
        if (process.env.DB_HOST) {
            try {
                const { upsertDomSnapshots, upsertDealers } = await import('./db.js');
                await upsertDomSnapshots(flattenDomIndex(domIndex).filter((r) => r.snapshotDate === todayDate));
                if (dbBrandId) await upsertDealers(dbBrandId, dealers);
            } catch (domDbErr) {
                console.error('DB DOM/dealer contact sync failed (non-fatal):', domDbErr.message);
            }
        }
        await finishScrapeRun(dbRunId, {
            dealersActive: activeDealersCount,
            dealersErrored: erroredDealersCount,
            totalVehicles: currentInventory.size,
            newArrivals: newArrivals.length,
            priceDrops: priceDrops.length,
            priceIncreases: priceIncreases.length,
            soldOrRemoved: soldVehicles.length,
            skippedBotProtection,
            failedDealerNames: Array.from(failedDealerNames),
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

await flushRunProgress({
    status: 'complete',
    currentDealer: null,
    dealersDone: dealers.length,
    priceDrops: priceDrops.length,
    newArrivals: newArrivals.length,
    skippedForBotProtection: skippedBotProtection,
    finishedAt: new Date().toISOString(),
});
process.exit(0);
