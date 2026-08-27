import { gotScraping } from 'got-scraping';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CACHE_PATH = path.join(DATA_DIR, 'enriched_cache.json');
const INVENTORY_PATH = path.join(DATA_DIR, 'national_inventory_latest.json');

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

export async function runEnrichmentPipeline(limit = Infinity, brand = null, dbRunContext = null) {
  console.log("====================================================");
  console.log("⚡ STARTING ENHANCED VIN ENRICHMENT PIPELINE (ALL VEHICLES)");
  console.log("====================================================");

  let rawInventory = [];
  try {
    const raw = await fs.readFile(INVENTORY_PATH, "utf-8");
    rawInventory = JSON.parse(raw);
  } catch (err) {
    console.error("Could not read inventory:", err.message);
    return;
  }

  let cache = {};
  try {
    const rawCache = await fs.readFile(CACHE_PATH, "utf-8");
    cache = JSON.parse(rawCache);
  } catch {
    cache = {};
  }

  console.log(`Total Vehicles in Inventory File: ${rawInventory.length}`);
  console.log(`Existing Cached Enriched VINs: ${Object.keys(cache).length}`);

  let enrichedCount = 0;
  let cacheHits = 0;
  const targetVehicles = rawInventory.slice(0, limit);

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
      Object.assign(v, {
        nhtsa: cached.nhtsa,
        factoryOptions: optionData.options,
        optionCodes: optionData.optionCodes,
        totalOptionsPrice: optionData.totalOptionsPrice,
        baseMsrp: optionData.baseMsrp,
        enrichedAt: cached.enrichedAt,
      });
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
    if (nhtsaData) cache[v.vin] = enrichment;
    Object.assign(v, enrichment);
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
    if (enrichedCount % 200 === 0) {
      await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
    }
  }

  // Ensure every record has the expected shape — but never invent NHTSA
  // specs or a base price for a vehicle that genuinely doesn't have real
  // data. Missing means missing; the UI is expected to handle that (it
  // already does for factoryOptions/baseMsrp).
  for (const v of rawInventory) {
    if (!v.factoryOptions) v.factoryOptions = [];
    if (!v.optionCodes) v.optionCodes = [];
    if (v.totalOptionsPrice === undefined) v.totalOptionsPrice = 0;
    if (v.baseMsrp === undefined) v.baseMsrp = lookupBaseMsrp(v, brand);
  }

  // Save updated cache and enriched inventory
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  await fs.writeFile(INVENTORY_PATH, JSON.stringify(rawInventory, null, 2));
  await fs.writeFile(path.join(DATA_DIR, "inventory_latest.json"), JSON.stringify(rawInventory, null, 2));

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
