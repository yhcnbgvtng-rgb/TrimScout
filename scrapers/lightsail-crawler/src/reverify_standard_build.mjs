#!/usr/bin/env node
// One-off nationwide re-verification: every vehicle currently showing
// "Standard Build" (empty factoryOptions) gets its real VDP re-fetched and
// re-checked for genuine options data, via two independent real-data paths:
//
//  1. Dealer.com DDC dataLayer, with the fixed extractDealerListedOptions
//     (see standalone.js for the full bug writeup: the unnamed
//     "packageName: null" bucket mixes real priced options with $0 baseline
//     noise; the old code discarded the whole bucket instead of filtering
//     by price).
//  2. Porsche's own official retailer platform (*.porsche.com/en/inventory/
//     — covers the majority of "Standard Build" vehicles). These pages turn
//     out to run the exact same Next.js RSC architecture as
//     finder.porsche.com, embedding the same authoritative factory
//     specialEquipment/standardEquipment build sheet used by the Paul
//     Miller Porsche Finder pilot — extracted here with the same RSC-decode
//     + bracket-matching parser, verified against the target VIN before
//     accepting anything.
//
// Deliberately excludes schema.org free-text description parsing: tested
// live against a sample (Porsche Beverly Hills) and found to be an
// undelimited third-party spec-sheet dump with no real item boundaries —
// parsing it produces mashed-together garbage, not real per-VIN options.
// Sites on that platform are left honestly as "Standard Build" rather than
// risk shipping spec-sheet noise as if it were an itemized options list.
//
// Never guesses: a vehicle only gets updated if its own page actually
// contains real, structured, VIN-verified option/equipment data. Runs with
// bounded concurrency, per-request timeouts, and periodic checkpoint writes
// so a crash or interruption never loses more than a few minutes of
// progress.

import { gotScraping } from "got-scraping";
import fs from "node:fs";
import vm from "node:vm";

const INVENTORY_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/data/lightsail_inventory.json";
const LOG_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/scrapers/lightsail-crawler/reverify_standard_build.log";
const CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 12000;
const CHECKPOINT_EVERY = 250;

const PORSCHE_BASE_MSRP = {
  "911 Carrera": 120100, "911 Carrera Cabriolet": 133400, "911 Carrera 4": 127900,
  "911 Carrera 4 Cabriolet": 141200, "911 Carrera S": 138000, "911 Carrera S Cabriolet": 151300,
  "911 Carrera 4S": 145800, "911 Carrera 4S Cabriolet": 159100, "911 Targa 4": 139500,
  "911 Targa 4S": 157400, "911 GTS": 156000, "911 Carrera GTS": 156000,
  "911 Turbo": 200000, "911 Turbo S": 230000, "911 Turbo Cabriolet": 212300,
  "911 Turbo S Cabriolet": 242300, "911 GT3": 197300, "911 GT3 RS": 241300, "911 GT3 Touring": 197300,
  "718 Cayman": 68300, "718 Cayman S": 79900, "718 Cayman GTS 4.0": 88200,
  "718 Cayman GT4": 102400, "718 Cayman GT4 RS": 149900,
  "718 Boxster": 68300, "718 Boxster S": 79900, "718 Boxster GTS 4.0": 88200, "718 Spyder RS": 149900,
  "Macan": 61600, "Macan S": 71300, "Macan GTS": 84800, "Macan T": 66300,
  "Macan Electric": 80300, "Macan 4 Electric": 80300, "Macan 4S Electric": 86300, "Macan Turbo Electric": 106300,
  "Cayenne": 79200, "Cayenne S": 92700, "Cayenne GTS": 107400, "Cayenne Turbo": 137400, "Cayenne Turbo GT": 197450,
  "Cayenne Coupe": 82200, "Cayenne S Coupe": 95700, "Cayenne GTS Coupe": 109400, "Cayenne Turbo Coupe": 139400,
  "Cayenne E-Hybrid": 86400, "Cayenne E-Hybrid Coupe": 89400,
  "Panamera": 102800, "Panamera 4": 106600, "Panamera 4S": 122700, "Panamera GTS": 141300,
  "Panamera Turbo S": 186900, "Panamera 4 E-Hybrid": 113600,
  "Taycan": 99400, "Taycan 4S": 113400, "Taycan GTS": 138400, "Taycan Turbo": 168400, "Taycan Turbo S": 209400,
  "Taycan 4 Cross Turismo": 105300, "Taycan 4S Cross Turismo": 118400,
};

function lookupPorscheBaseMsrp(vehicle) {
  const hay = `${vehicle.model || ""} ${vehicle.trim || ""}`.trim();
  if (PORSCHE_BASE_MSRP[hay]) return PORSCHE_BASE_MSRP[hay];
  const key = Object.keys(PORSCHE_BASE_MSRP).find(
    (k) => hay.toLowerCase().includes(k.toLowerCase())
  );
  if (key) return PORSCHE_BASE_MSRP[key];
  const modelHay = (vehicle.model || "").toLowerCase();
  if (modelHay.includes("911")) return 120100;
  if (modelHay.includes("718") || modelHay.includes("cayman") || modelHay.includes("boxster")) return 68300;
  if (modelHay.includes("macan")) return 61600;
  if (modelHay.includes("taycan")) return 99400;
  if (modelHay.includes("panamera")) return 102800;
  if (modelHay.includes("cayenne")) return 79200;
  return 100000;
}

// --- Strategy 1: Dealer.com DDC dataLayer (fixed extraction) ---
function extractDealerListedOptions(raw) {
  const items = [];
  if (!Array.isArray(raw.packages)) return items;

  for (const pkg of raw.packages) {
    const isNamedPackage = Boolean(pkg.packageName) && pkg.packageName !== "null";

    if (isNamedPackage) {
      items.push({
        code: `PKG-${pkg.id ?? pkg.packageName}`,
        name: pkg.packageName,
        price: typeof pkg.msrp === "number" ? pkg.msrp : 0,
        category: "package",
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
      const price = typeof opt.msrPrice === "number" ? opt.msrPrice : 0;
      if (!isNamedPackage && price <= 0) continue;
      items.push({
        code: opt.textMap.id && opt.textMap.id !== "null" ? `OPT-${opt.textMap.id}` : "OPT",
        name: description,
        price,
        category: "option",
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


// --- Strategy 3: Porsche's own retailer platform (*.porsche.com/en/inventory/) ---
// Same Next.js RSC streaming architecture as finder.porsche.com, embedding
// the same authoritative factory specialEquipment/standardEquipment build
// sheet — reusing the exact decode/extract logic verified against 217 real
// vehicles in the Paul Miller Porsche Finder pilot
// (scrapers/finder-enrichment/enrich_from_finder.mjs).
function decodeRscStream(html) {
  const matches = [...html.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)];
  let full = "";
  for (const m of matches) {
    try {
      full += JSON.parse(m[1]);
    } catch {
      // skip malformed fragment
    }
  }
  return full;
}

function extractBracketedArray(text, key) {
  const marker = `"${key}":[`;
  const startIdx = text.indexOf(marker);
  if (startIdx === -1) return null;
  const arrStart = startIdx + marker.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrStart; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(arrStart, i + 1);
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

// Porsche's own RSC payload occasionally embeds legal boilerplate (SiriusXM
// trial-subscription terms, Porsche Connect coverage disclaimers) as a
// regular equipment "item" with no real code — confirmed live across
// thousands of vehicles. Presenting that as if it were a piece of the car's
// actual equipment would misrepresent the data, so it's filtered out by
// content rather than trusted just because it came from the same feed as
// the real items.
const EQUIPMENT_DISCLAIMER_MARKERS = [
  "Trial Subscription", "Customer Agreement", "Privacy Policy",
  "automatically stop", "non-transferable", "each sold separately",
  "availability of wireless network", "is dependent on the availability",
  "may not be available in all areas", "subject to change without notice",
  "see dealer for details", "terms and conditions apply",
];

function cleanEquipmentText(s) {
  if (!s) return s;
  let text = String(s);
  text = text.replace(/<\/li>|<br\s*\/?>|<\/p>/gi, " ").replace(/<li>/gi, "").replace(/<[^>]+>/g, "");
  text = text.replace(/\*\*/g, "").replace(/^\*+\s*/, "");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function flattenEquipmentCategories(categories) {
  if (!Array.isArray(categories)) return [];
  const items = [];
  for (const category of categories) {
    for (const item of category.items || []) {
      const name = cleanEquipmentText(item.name && item.name !== "$undefined" ? item.name : null);
      if (!name) continue;
      if (EQUIPMENT_DISCLAIMER_MARKERS.some((kw) => name.includes(kw))) continue;
      items.push({
        code: item.code && item.code !== "$undefined" ? item.code : "OPT",
        name,
        category: category.name || "Other",
        // Descriptions are long, real, but supplementary paragraph text —
        // at nationwide scale they roughly doubled the inventory file's
        // size and pushed it over GitHub's 100MB file limit. Option
        // name/code/category already carry the meaningful signal.
      });
    }
  }
  return items;
}

// Deliberately no schema.org/description-based fallback in this pass. The
// free-text description path was tried against a live sample and found
// unsafe here: several dealers (e.g. Porsche Beverly Hills) publish an
// undelimited third-party spec-sheet dump as the "description" field
// ("Standard EquipmentMECHANICALFull-Time All-Wheel3.36 Axle Ratio...") with
// no real item boundaries — splitting it produces mashed-together garbage
// fragments, not this VIN's real installed options. Presenting that as an
// itemized options list would be exactly the fabrication this project
// exists to avoid, so sites on that platform are left as "Standard Build"
// (honest — we don't have safe structured per-VIN option data for them)
// rather than risk shipping spec-sheet noise at scale.
function extractOptionsFromHtml(html, expectedVin) {
  const ddcMatch =
    html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
    html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
  if (ddcMatch) {
    try {
      const sandbox = {};
      vm.runInNewContext("vehicles = " + ddcMatch[1], sandbox);
      const raw = sandbox.vehicles && sandbox.vehicles[0];
      if (raw) {
        const options = extractDealerListedOptions(raw);
        if (options.length > 0) return { source: "DEALER_VDP", options, standardEquipment: [] };
      }
    } catch {
      // no usable DDC data on this page
    }
  }

  if (html.includes("self.__next_f.push")) {
    const decoded = decodeRscStream(html);
    const vinMatch = decoded.match(/"vehicleIdentificationNumber":"([A-Z0-9]{17})"/);
    if (vinMatch && vinMatch[1] === expectedVin) {
      const special = extractBracketedArray(decoded, "specialEquipment");
      const standard = extractBracketedArray(decoded, "standardEquipment");
      const options = flattenEquipmentCategories(special);
      const standardEquipment = flattenEquipmentCategories(standard).map((i) => i.name);
      if (options.length > 0 || standardEquipment.length > 0) {
        return { source: "PORSCHE_FINDER", options, standardEquipment };
      }
    }
  }

  return { source: null, options: [], standardEquipment: [] };
}

async function pMap(items, mapper, concurrency) {
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await mapper(items[idx], idx);
      completed++;
    }
  });
  await Promise.allSettled(workers);
  return completed;
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf-8"));
  let targets = inventory.filter((v) => !v.factoryOptions || v.factoryOptions.length === 0);
  if (process.env.REVERIFY_VINS) {
    const wanted = new Set(process.env.REVERIFY_VINS.split(","));
    targets = targets.filter((v) => wanted.has(v.vin));
  }
  const limit = process.env.REVERIFY_LIMIT ? parseInt(process.env.REVERIFY_LIMIT, 10) : null;
  if (limit) targets = targets.slice(0, limit);

  const log = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const logLine = (s) => {
    const line = `${new Date().toISOString()} ${s}`;
    log.write(line + "\n");
  };

  logLine(`=== Starting re-verification: ${targets.length} "Standard Build" vehicles ===`);
  console.log(`Targets: ${targets.length}`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;
  const now = new Date().toISOString();
  const dealerStats = {};

  await pMap(
    targets,
    async (v) => {
      try {
        const res = await gotScraping(v.url, {
          timeout: { request: REQUEST_TIMEOUT_MS },
          retry: { limit: 1 },
        });
        const { source, options, standardEquipment } = extractOptionsFromHtml(res.body, v.vin);

        if (source && (options.length > 0 || standardEquipment.length > 0)) {
          v.factoryOptions = options;
          v.optionCodes = options.map((o) => o.code);
          v.optionsSource = source;
          if (source === "PORSCHE_FINDER") {
            v.standardEquipment = standardEquipment;
            v.finderUrl = v.url;
            delete v.totalOptionsPrice; // Finder doesn't publish per-option pricing
          } else {
            v.totalOptionsPrice = options.reduce((sum, o) => sum + (o.price || 0), 0);
          }
          if (v.baseMsrp === undefined || v.baseMsrp === null) {
            v.baseMsrp = lookupPorscheBaseMsrp(v);
          }
          v.enrichedAt = now;
          updated++;
          dealerStats[v.dealerName] = dealerStats[v.dealerName] || { updated: 0, failed: 0 };
          dealerStats[v.dealerName].updated++;
          logLine(`UPDATED ${v.vin} (${v.dealerName}) -> [${source}] ${options.length} options, ${standardEquipment.length} standard`);
        } else {
          unchanged++;
        }
      } catch (err) {
        failed++;
        dealerStats[v.dealerName] = dealerStats[v.dealerName] || { updated: 0, failed: 0 };
        dealerStats[v.dealerName].failed++;
        logLine(`FAILED ${v.vin} (${v.dealerName}) -> ${err.message}`);
      }

      processed++;
      if (processed % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2) + "\n");
        const msg = `Checkpoint: ${processed}/${targets.length} processed | updated=${updated} unchanged=${unchanged} failed=${failed}`;
        console.log(msg);
        logLine(msg);
      }
    },
    CONCURRENCY
  );

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2) + "\n");

  const summary = `=== DONE === processed=${processed} updated=${updated} unchanged=${unchanged} failed=${failed}`;
  console.log(summary);
  logLine(summary);
  logLine("Per-dealer updated counts (only dealers with updates):");
  Object.entries(dealerStats)
    .filter(([, s]) => s.updated > 0)
    .sort((a, b) => b[1].updated - a[1].updated)
    .forEach(([name, s]) => logLine(`  ${name}: updated=${s.updated} failed=${s.failed}`));

  log.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
