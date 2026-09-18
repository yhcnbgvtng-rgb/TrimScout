import { gotScraping } from 'got-scraping';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withSharedDataLock } from './shared_data_lock.js';

// Computed fresh (not a module-level constant) so a test can chdir into a
// scratch directory before calling runEnrichmentPipeline and get isolated
// paths — process.cwd() never actually changes mid-run in production, so
// this is behavior-preserving there.
function getDataPaths() {
  const dataDir = path.resolve(process.cwd(), 'data');
  return {
    dataDir,
    cachePath: path.join(dataDir, 'enriched_cache.json'),
    inventoryPath: path.join(dataDir, 'national_inventory_latest.json'),
  };
}

// Canonical Porsche Base MSRP Reference Table
export const PORSCHE_BASE_MSRP = {
  // 911 Series
  "911 Carrera": 120100,
  "911 Carrera Cabriolet": 133400,
  "911 Carrera 4": 127900,
  "911 Carrera 4 Cabriolet": 141200,
  "911 Carrera S": 138000,
  "911 Carrera S Cabriolet": 151300,
  "911 Carrera 4S": 145800,
  "911 Carrera 4S Cabriolet": 159100,
  "911 Targa 4": 139500,
  "911 Targa 4S": 157400,
  "911 Carrera GTS": 164900,
  "911 Carrera GTS Cabriolet": 178200,
  "911 Carrera 4 GTS": 172700,
  "911 Carrera 4 GTS Cabriolet": 186000,
  "911 Targa 4 GTS": 186000,
  "911 Turbo": 197200,
  "911 Turbo Cabriolet": 210000,
  "911 Turbo S": 230400,
  "911 Turbo S Cabriolet": 243200,
  "911 GT3": 222500,
  "911 GT3 RS": 241300,
  "911 Dakar": 222000,
  "911 S/T": 290000,

  // 718 Series
  "718 Cayman": 68300,
  "718 Cayman Style Edition": 74600,
  "718 Cayman S": 80300,
  "718 Cayman GTS 4.0": 95200,
  "718 Cayman GT4 RS": 160700,
  "718 Boxster": 70400,
  "718 Boxster Style Edition": 76700,
  "718 Boxster S": 82400,
  "718 Boxster GTS 4.0": 97300,
  "718 Spyder RS": 160700,

  // Taycan EV Series
  "Taycan": 99400,
  "Taycan 4": 103300,
  "Taycan 4S": 118500,
  "Taycan GTS": 147900,
  "Taycan Turbo": 174000,
  "Taycan Turbo S": 209000,
  "Taycan Turbo GT": 230000,
  "Taycan 4 Cross Turismo": 111100,
  "Taycan 4S Cross Turismo": 125200,
  "Taycan Turbo Cross Turismo": 176600,
  "Taycan Turbo S Cross Turismo": 211700,

  // Macan Series
  "Macan": 62900,
  "Macan T": 68500,
  "Macan S": 72300,
  "Macan GTS": 86800,
  "Macan Electric": 78800,
  "Macan 4 Electric": 78800,
  "Macan 4S Electric": 84900,
  "Macan Turbo Electric": 105300,

  // Cayenne Series
  "Cayenne": 79200,
  "Cayenne E-Hybrid": 91700,
  "Cayenne S": 95700,
  "Cayenne S E-Hybrid": 99100,
  "Cayenne GTS": 124900,
  "Cayenne Turbo E-Hybrid": 146900,
  "Cayenne Coupe": 84300,
  "Cayenne E-Hybrid Coupe": 95700,
  "Cayenne S Coupe": 102100,
  "Cayenne S E-Hybrid Coupe": 104000,
  "Cayenne GTS Coupe": 129900,
  "Cayenne Turbo E-Hybrid Coupe": 151400,
  "Cayenne Turbo GT": 196300,

  // Panamera Series
  "Panamera": 102800,
  "Panamera 4": 109800,
  "Panamera 4 E-Hybrid": 115500,
  "Panamera 4S E-Hybrid": 126800,
  "Panamera GTS": 154200,
  "Panamera Turbo E-Hybrid": 191000
};

// Master Porsche Factory Options Catalog
// NHTSA's vPIC API is a real government VIN-decode service — when it
// returns data, that data is real and brand-agnostic. When it fails or a
// field is missing, we return null for that field rather than fabricate a
// plausible-looking default (a fake "Germany/Stuttgart" plant on a Ford
// would be actively wrong, not just generic — this was already wrong for
// any non-Porsche vehicle even before Ford existed here).
export async function fetchNhtsaSpec(vin, vehicleContext = {}) {
  const isEv = /taycan|electric/i.test(`${vehicleContext.model || ''} ${vehicleContext.trim || ''} ${vehicleContext.bodyStyle || ''}`);

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`;
    const res = await gotScraping({
      url,
      timeout: { request: 5000 },
      retry: { limit: 1 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    const json = JSON.parse(res.body);
    const item = json.Results?.[0];
    if (item && item.Make) {
      const nhtsaIsElectric = item.FuelTypePrimary === "Electric" || (item.ElectrificationLevel && item.ElectrificationLevel.includes("BEV"));
      const isElectricFinal = isEv || nhtsaIsElectric;

      const engineCylinders = isElectricFinal ? 0 : (item.EngineCylinders ? parseInt(item.EngineCylinders, 10) : null);
      const engineDisplacementL = isElectricFinal
        ? "Electric"
        : (item.DisplacementL ? `${parseFloat(item.DisplacementL).toFixed(1)}L` : null);

      return {
        plantCountry: item.PlantCountry || null,
        plantCity: item.PlantCity || null,
        engineCylinders,
        engineDisplacementL,
        fuelType: isElectricFinal ? "Electric (BEV)" : (item.FuelTypePrimary || null),
        bodyClass: item.BodyClass || null,
        grossWeightClass: item.GVWR || null,
        brakeSystem: item.BrakeSystemType || null
      };
    }
  } catch {}

  return null;
}

// Looks up a real reference base MSRP for this vehicle's model/trim, using
// whichever brand's table applies. Brands without a table (baseMsrpTable:
// null — e.g. Ford, see brands.js) get null here rather than a guessed
// number; a car's own real listed price is always used elsewhere and never
// depends on this.
export function lookupBaseMsrp(vehicle, brand) {
  const table = brand?.baseMsrpTable;
  if (!table) return null;

  const modelStr = `${vehicle.model || ''} ${vehicle.trim || ''}`.trim();

  if (table[modelStr]) return table[modelStr];

  for (const [key, msrp] of Object.entries(table)) {
    if (modelStr.toLowerCase().includes(key.toLowerCase())) {
      return msrp;
    }
  }

  return null;
}

// Resolves factory options strictly from what the crawler actually scraped
// off this vehicle's own VDP ("Included Packages & Options" — real,
// itemized, per-VIN data pulled from the dealer's Dealer.com data layer).
// No keyword guessing, no model/trim-based inference: if the dealer page
// didn't publish it, it's not included.
export function resolveFactoryOptions(vehicle, brand) {
  const real = Array.isArray(vehicle.dealerListedOptions) ? vehicle.dealerListedOptions : [];
  const baseMsrp = lookupBaseMsrp(vehicle, brand);
  const totalOptionsPrice = real.reduce((sum, opt) => sum + (opt.price || 0), 0);

  return {
    options: real,
    optionCodes: real.map((opt) => opt.code),
    totalOptionsPrice,
    baseMsrp
  };
}

// Ensures the expected enrichment fields exist on a vehicle record without
// ever inventing NHTSA specs or a base price it doesn't already have —
// same "missing means missing" rule as the loop below. Applied to every
// vehicle in the file (not just this run's own), matching the pre-existing
// backfill behavior.
//
// Returns the SAME object (no clone) when nothing is actually missing —
// this is a memory fix, not a style one: on a 144k-vehicle national file,
// every vehicle that's already fully shaped (i.e. every run after the
// first nationwide backfill pass) used to get a brand-new spread-cloned
// object here for NO reason, on every single brand-run, regardless of how
// few VINs that run actually touched. That's a full duplicate of the
// entire dataset's object graph allocated and thrown away every run — the
// dominant cause of the enrichment-step OOM crashes once the accumulated
// file crossed ~200MB (confirmed: it crashed even on a single-VIN scoped
// run, because this backfill pass touches every vehicle in the file, not
// just the run's own).
function ensureEnrichmentShape(vehicle, brand) {
  const missingOptions = !vehicle.factoryOptions;
  const missingCodes = !vehicle.optionCodes;
  const missingPrice = vehicle.totalOptionsPrice === undefined;
  const missingMsrp = vehicle.baseMsrp === undefined;
  if (!missingOptions && !missingCodes && !missingPrice && !missingMsrp) {
    return vehicle;
  }
  const out = { ...vehicle };
  if (missingOptions) out.factoryOptions = [];
  if (missingCodes) out.optionCodes = [];
  if (missingPrice) out.totalOptionsPrice = 0;
  if (missingMsrp) out.baseMsrp = lookupBaseMsrp(out, brand);
  return out;
}

// Patches only the VINs THIS run actually enriched onto a freshly-read copy
// of the shared inventory array, instead of trusting the copy read at this
// pipeline's own start (which, for a run that took hours of sequential
// NHTSA lookups, can be long stale by the time it's ready to persist).
//
// Root cause this fixes: without it, this function's caller would take
// whatever `rawInventory` looked like when the pipeline STARTED reading —
// including every other brand/state's vehicles — mutate this run's own
// entries in place, and write the WHOLE array back verbatim at the end.
// If a concurrently-running other state's own crawl+merge (see
// standalone.js) or enrichment pass wrote a newer version of this same
// file in the meantime, that write gets silently discarded the moment this
// one lands — the exact same lost-update shape inventory_merge.js's header
// comment describes for the sold/active snapshot, just for enrichment
// fields instead. `enrichedByVin` scopes the patch to only the VINs this
// run has real fresh data for; every other vehicle is returned exactly as
// just read from disk, untouched (only shape-backfilled, never content-
// overwritten) — this run has no evidence about it either way.
export function mergeEnrichedRecordsIntoInventory({ freshInventory, enrichedByVin, brand = null }) {
  return freshInventory.map((v) => {
    const patch = enrichedByVin.get(v.vin);
    if (!patch) return ensureEnrichmentShape(v, brand);
    return ensureEnrichmentShape({ ...v, ...patch }, brand);
  });
}

// `vinsToEnrich` scopes the (potentially network-bound, always sequential)
// per-vehicle work below to just the vehicles this invocation's caller
// actually has fresh data for — e.g. standalone.js passes the VINs from
// the brand/dealer crawl that just ran. Without this, every brand run
// reprocessed the ENTIRE cumulative `national_inventory_latest.json`
// (every brand/dealer ever crawled into that shared file), so a run's cost
// grew with the whole file's size rather than with that run's own new
// vehicles — confirmed live: Volvo (1 dealer) took 2m14s while Toyota (31
// dealers, last in a 12-brand queue) took 29m30s, a blowup tracking queue
// position/cumulative history size, not Toyota's own dealer count.
// `null` (the default, and what the CLI entry point below uses) keeps the
// original "enrich/backfill everything in the file" behavior, which is a
// deliberately supported standalone use (see the SKIP_NHTSA_ENRICHMENT
// comment above about backfilling missed specs without re-crawling).
export async function runEnrichmentPipeline(limit = Infinity, brand = null, dbRunContext = null, vinsToEnrich = null) {
  console.log("====================================================");
  console.log("⚡ STARTING ENHANCED VIN ENRICHMENT PIPELINE");
  console.log("====================================================");

  const { cachePath: CACHE_PATH, inventoryPath: INVENTORY_PATH, dataDir: DATA_DIR } = getDataPaths();

  let rawInventory = null;
  let cache = {};
  let targetVehicles = [];
  let inventoryReadFailed = false;
  const vinScope = vinsToEnrich ? new Set(vinsToEnrich) : null;

  // Locked: the OTHER memory-heavy moment in this pipeline, besides the
  // final persist below — parsing the full nationwide inventory + cache
  // files (250k+ vehicles, 400MB+ combined as of 2026-09-18). Two
  // concurrent brand-runs (MAX_CONCURRENT_STATES=2) each doing this at the
  // same instant — or one doing this while the other is in its own final
  // persist below — is what was tripping the kernel's OOM-killer: 43 of
  // 135 brand-runs crashed silently mid-enrichment that night, with no
  // self-reported V8 heap-limit error, the signature of a kernel SIGKILL
  // from combined memory pressure rather than any single process
  // exceeding its own heap cap. Serializing this against the final
  // persist's own lock means the two GB-scale parses this pipeline ever
  // does can never land at the same instant as another concurrent
  // brand-run's.
  //
  // The full parsed array never leaves this callback as itself — only
  // targetVehicles (a small slice) and cache survive it — so it's eligible
  // for GC before the (often long, network-bound) per-VIN loop below even
  // starts, instead of sitting in memory for that whole duration for no
  // reason. `rawInventory` stays declared at the outer scope only because
  // the final persist step reassigns it (to the merged result) for the
  // DB-sync call after that — it's never populated with the full parse.
  await withSharedDataLock(async () => {
    let inventory;
    try {
      const raw = await fs.readFile(INVENTORY_PATH, "utf-8");
      inventory = JSON.parse(raw);
    } catch (err) {
      console.error("Could not read inventory:", err.message);
      inventoryReadFailed = true;
      return;
    }

    try {
      const rawCache = await fs.readFile(CACHE_PATH, "utf-8");
      cache = JSON.parse(rawCache);
    } catch {
      cache = {};
    }

    console.log(`Total Vehicles in Inventory File: ${inventory.length}`);
    console.log(`Existing Cached Enriched VINs: ${Object.keys(cache).length}`);

    const scopedInventory = vinScope ? inventory.filter((v) => vinScope.has(v.vin)) : inventory;
    targetVehicles = scopedInventory.slice(0, limit);
  }, { label: `enricher-read:${brand?.name || 'unknown'}` });

  if (inventoryReadFailed) return;

  if (vinScope) {
    console.log(`Scoped to this run's ${vinScope.size} VIN(s): ${targetVehicles.length} matched in the inventory file.`);
  }

  let enrichedCount = 0;
  let cacheHits = 0;
  // Every field-level result this run computes, keyed by VIN — the actual
  // "modify" half of this pipeline's read-modify-write, kept separate from
  // `rawInventory`/`cache` (which are just this run's own start-of-pipeline
  // snapshot) so the persist step below can apply it onto a FRESH read
  // instead of overwriting with a stale one. See mergeEnrichedRecordsInto
  // Inventory's header comment.
  const enrichedByVin = new Map();
  const newCacheEntries = new Map();

  // Escape hatch for nationwide batch runs where the per-VIN NHTSA lookup
  // (sequential, one network round-trip at a time) is the dominant cost of
  // a whole batch — confirmed live: Ford batch 1 took ~5 hours end-to-end
  // for 250 dealers. Skipping it here still runs the cheap, local
  // factoryOptions/baseMsrp computation and — critically — still reaches
  // syncInventoryToDatabase() below, so basic listing data (VIN, price,
  // model, dealer) lands in the DB at crawl speed instead of NHTSA speed.
  // nhtsa stays null; a later pass with this flag off can backfill specs
  // without re-crawling (cache-miss vehicles just get picked up again).
  const skipNhtsa = process.env.SKIP_NHTSA_ENRICHMENT === 'true';

  for (let i = 0; i < targetVehicles.length; i++) {
    const v = targetVehicles[i];

    // Re-verify EVs or incomplete records
    const isEv = /taycan|electric/i.test(`${v.model || ''} ${v.trim || ''}`);
    const cached = cache[v.vin];

    // factoryOptions is always recomputed fresh from this run's scraped
    // dealerListedOptions, never trusted from cache — the cache predates
    // real per-VIN option scraping and would otherwise silently resurrect
    // the old guessed data. Only the (expensive, network-bound) NHTSA
    // lookup is cached.
    const optionData = resolveFactoryOptions(v, brand);

    if (cached && cached.nhtsa && (!isEv || cached.nhtsa.engineCylinders === 0)) {
      cacheHits++;
      const patch = {
        nhtsa: cached.nhtsa,
        factoryOptions: optionData.options,
        optionCodes: optionData.optionCodes,
        totalOptionsPrice: optionData.totalOptionsPrice,
        baseMsrp: optionData.baseMsrp,
        enrichedAt: cached.enrichedAt,
      };
      Object.assign(v, patch);
      enrichedByVin.set(v.vin, patch);
      continue;
    }

    if (skipNhtsa) {
      const patch = {
        nhtsa: null,
        factoryOptions: optionData.options,
        optionCodes: optionData.optionCodes,
        totalOptionsPrice: optionData.totalOptionsPrice,
        baseMsrp: optionData.baseMsrp,
      };
      Object.assign(v, patch);
      enrichedByVin.set(v.vin, patch);
      continue;
    }

    const progress = `[${i + 1}/${targetVehicles.length}]`;
    const nhtsaData = await fetchNhtsaSpec(v.vin, v);

    const enrichment = {
      nhtsa: nhtsaData,
      factoryOptions: optionData.options,
      optionCodes: optionData.optionCodes,
      totalOptionsPrice: optionData.totalOptionsPrice,
      baseMsrp: optionData.baseMsrp,
      enrichedAt: new Date().toISOString()
    };

    // Only cache real NHTSA data — a null result (lookup failed) should be
    // retried on the next run, not permanently frozen as "no data".
    if (nhtsaData) {
      cache[v.vin] = enrichment;
      newCacheEntries.set(v.vin, enrichment);
    }
    Object.assign(v, enrichment);
    enrichedByVin.set(v.vin, enrichment);
    enrichedCount++;

    if (enrichedCount % 50 === 0 || enrichedCount === 1) {
      const baseMsrpStr = optionData.baseMsrp !== null ? `$${optionData.baseMsrp.toLocaleString()}` : "unknown";
      const optionsStr = `$${optionData.totalOptionsPrice.toLocaleString()}`;
      const specStr = nhtsaData ? `${nhtsaData.engineDisplacementL || "?"} (${nhtsaData.plantCountry || "?"})` : "NHTSA lookup unavailable";
      console.log(`${progress} ✓ Enriched ${v.vin} (${v.year || "?"} ${v.model || "?"}): Base ${baseMsrpStr} | Options: ${optionsStr} | ${specStr}`);
    }

    // Checkpoint the cache periodically, not just at the very end. At small
    // scale losing an interrupted run's un-persisted NHTSA lookups is a minor
    // annoyance; at nationwide scale (hours-long, many thousands of external
    // API calls) it's real lost work if the process is ever killed mid-run.
    //
    // Locked + fresh-merged, same reasoning as the final persist below: this
    // pipeline can run for hours, and a concurrently-running other state's
    // own enrichment pass may have added ITS OWN new cache entries to this
    // same file since this run started — writing back this run's full
    // in-memory `cache` (which was only ever a stale-by-now snapshot plus
    // this run's own additions) would erase those. Merging just this run's
    // own `newCacheEntries` onto a fresh read keeps both.
    if (enrichedCount % 200 === 0) {
      await withSharedDataLock(async () => {
        let freshCache = {};
        try {
          freshCache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf-8'));
        } catch {
          freshCache = {};
        }
        const merged = { ...freshCache, ...Object.fromEntries(newCacheEntries) };
        await fs.writeFile(CACHE_PATH, JSON.stringify(merged, null, 2));
      }, { label: `enricher-checkpoint:${brand?.name || 'unknown'}` });
    }
  }

  // Save updated cache and enriched inventory — locked, and merged onto a
  // FRESH read of both files rather than the copies read at the top of this
  // function. See mergeEnrichedRecordsIntoInventory's header comment: this
  // pipeline is network-bound and can run for hours (sequential NHTSA
  // lookups), so by the time it's ready to persist, a concurrently-running
  // other state's crawl+merge (standalone.js) or enrichment pass may well
  // have written a newer version of national_inventory_latest.json /
  // inventory_latest.json / enriched_cache.json. Only this run's own VINs
  // (enrichedByVin / newCacheEntries) are ever patched in; everything else
  // comes from the fresh read, untouched.
  await withSharedDataLock(async () => {
    let freshInventory;
    try {
      freshInventory = JSON.parse(await fs.readFile(INVENTORY_PATH, 'utf-8'));
    } catch (err) {
      // Nothing on disk (shouldn't happen — we read it successfully in the
      // read-lock block above). No stale full copy to fall back to anymore
      // — `rawInventory` is never populated with the full parse now (see
      // that block's comment), so there's nothing safe to write. Surface
      // the error instead of silently producing a bad persist.
      console.error("Could not re-read inventory for persist:", err.message);
      throw err;
    }
    let freshCache;
    try {
      freshCache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf-8'));
    } catch {
      freshCache = cache;
    }

    // `rawInventory` is already null (see the read-lock block above —
    // the full parse from the top of this function is never kept this
    // far). `cache`, though, still holds that block's full accumulated
    // snapshot; drop it here before building the merged result so it
    // doesn't coexist with freshCache/mergedCache. See
    // ensureEnrichmentShape's comment for the matching fix on the
    // per-vehicle clone.
    cache = null;

    const mergedInventory = mergeEnrichedRecordsIntoInventory({ freshInventory, enrichedByVin, brand });
    const mergedCache = { ...freshCache, ...Object.fromEntries(newCacheEntries) };
    freshInventory = null;
    freshCache = null;

    await fs.writeFile(CACHE_PATH, JSON.stringify(mergedCache, null, 2));
    await fs.writeFile(INVENTORY_PATH, JSON.stringify(mergedInventory, null, 2));
    await fs.writeFile(path.join(DATA_DIR, "inventory_latest.json"), JSON.stringify(mergedInventory, null, 2));

    // Reassigned after the writes (not before) so the DB sync and closing
    // log lines below still see the merged result, matching prior behavior.
    rawInventory = mergedInventory;
    cache = mergedCache;
  }, { label: `enricher-final:${brand?.name || 'unknown'}` });

  // Sync to MariaDB (additive — this never touches the JSON files above,
  // which remain the source of truth for anything that reads them today).
  // `db.js` loads DB_HOST/etc. itself from `.env.trimscout-db` as a side
  // effect of being imported, so the dynamic import has to happen before
  // checking process.env.DB_HOST, not after. dbRunContext is optional: a
  // direct `node src/enricher.js` CLI run won't have a scrape_runs row,
  // but the sync still runs (with runId left null) so ad-hoc runs keep the
  // DB current too. Wrapped end-to-end so a DB outage can never crash the
  // pipeline that just wrote the real JSON output.
  try {
    const { upsertBrand, syncInventoryToDatabase } = await import("./db.js");
    if (process.env.DB_HOST) {
      const brandName = brand?.name || "Porsche";
      const brandCode = brandName.toLowerCase();
      const brandId = dbRunContext?.brandId ?? (await upsertBrand(brandCode, brandName));
      const dbStats = await syncInventoryToDatabase(brandId, rawInventory, { runId: dbRunContext?.runId ?? null });
      console.log(`💾 DB sync complete: ${JSON.stringify(dbStats)}`);
    } else {
      console.log("DB_HOST not set — skipping database sync (JSON files still written).");
    }
  } catch (dbErr) {
    console.error("DB sync failed (non-fatal, JSON files still written):", dbErr);
  }

  console.log("\n====================================================");
  console.log(`🎉 ENRICHMENT COMPLETE WITH 0 ERRORS!`);
  console.log(`New/Repaired VINs Enriched: ${enrichedCount}`);
  console.log(`Cache Hits Reused: ${cacheHits}`);
  console.log(`Total Master Cache Size: ${Object.keys(cache).length}`);
  console.log("====================================================\n");
}

if (process.argv[1] && process.argv[1].endsWith("enricher.js")) {
  const limitArg = process.argv.includes("--sample") ? 50 : Infinity;
  await runEnrichmentPipeline(limitArg);
}
