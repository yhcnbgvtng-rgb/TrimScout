#!/usr/bin/env node
// Backfills year/model/trim/bodyStyle/price/msrp/engine/transmission/colors
// for vehicles where these are null. Root cause: standalone.js's Strategy 2
// (schema.org JSON-LD) extraction was added mid-session; ~13,906 vehicles
// were crawled before it existed (or before a since-fixed bug in it), so
// they carry null core fields despite their own page's JSON-LD having real
// data all along — confirmed live on Porsche Beverly Hills VIN
// WP0AA2YA1TL007682: stored record has model:null, but the page's own
// schema.org Vehicle block has model:"Panamera", vehicleModelDate:2026,
// offers.price:143195 right now. Never overwrites a field that already has
// a real value — only fills genuine gaps with data confirmed to be on the
// vehicle's own page today.

import { gotScraping } from "got-scraping";
import fs from "node:fs";
import vm from "node:vm";

const INVENTORY_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/data/lightsail_inventory.json";
const LOG_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/scrapers/lightsail-crawler/backfill_core_fields.log";
const CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 12000;
const CHECKPOINT_EVERY = 250;

function cleanString(val) {
  if (!val || val === "null" || val === "undefined" || val === "NULL" || val === "None") return null;
  const str = val.toString().trim();
  return str === "" || str === "null" ? null : str;
}

function fromDdc(html) {
  const ddcMatch =
    html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
    html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
  if (!ddcMatch) return null;
  try {
    const sandbox = {};
    vm.runInNewContext("vehicles = " + ddcMatch[1], sandbox);
    const raw = sandbox.vehicles && sandbox.vehicles[0];
    if (!raw) return null;
    const askingPrice = parseFloat(raw.askingPrice || "0") || null;
    const salePrice = parseFloat(raw.salePrice || "0") || null;
    const retailValue = parseFloat(raw.retailValue || "0") || null;
    const price = salePrice || askingPrice || retailValue || null;
    const msrp = retailValue || askingPrice || null;
    return {
      year: raw.year ? parseInt(raw.year, 10) : null,
      model: cleanString(raw.model),
      trim: cleanString(raw.trim),
      bodyStyle: cleanString(raw.bodyStyle),
      price,
      msrp,
      mileage: parseFloat(raw.odometer || raw.mileage || "0") || null,
      exteriorColor: cleanString(raw.exteriorColor),
      interiorColor: cleanString(raw.interiorColor),
      engine: cleanString(raw.engine),
      transmission: cleanString(raw.transmission),
    };
  } catch {
    return null;
  }
}

function fromSchemaOrg(html) {
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      if (parsed && parsed["@type"] === "Vehicle" && parsed.vehicleIdentificationNumber) {
        const price = parsed.offers?.price ? Math.round(Number(parsed.offers.price)) : null;
        const year = parsed.vehicleModelDate ? parseInt(parsed.vehicleModelDate, 10) : null;
        return {
          year: Number.isFinite(year) ? year : null,
          model: cleanString(parsed.model),
          trim: null,
          bodyStyle: cleanString(parsed.bodyType),
          price,
          msrp: price,
          mileage: null,
          exteriorColor: null,
          interiorColor: null,
          engine: cleanString(parsed.vehicleEngine?.name),
          transmission: null,
        };
      }
    } catch {
      // not valid JSON, skip
    }
  }
  return null;
}

async function pMap(items, mapper, concurrency) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await mapper(items[idx], idx);
    }
  });
  await Promise.allSettled(workers);
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf-8"));
  let targets = inventory.filter((v) => (!v.year || !v.model || !v.price) && v.url);
  const limit = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : null;
  if (limit) targets = targets.slice(0, limit);

  const log = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const logLine = (s) => log.write(`${new Date().toISOString()} ${s}\n`);

  logLine(`=== Starting core-field backfill: ${targets.length} vehicles ===`);
  console.log(`Targets: ${targets.length}`);

  let updated = 0;
  let noChange = 0;
  let failed = 0;
  let processed = 0;

  await pMap(
    targets,
    async (v) => {
      try {
        const res = await gotScraping(v.url, { timeout: { request: REQUEST_TIMEOUT_MS }, retry: { limit: 1 } });
        const found = fromDdc(res.body) || fromSchemaOrg(res.body);
        if (!found) {
          noChange++;
          return;
        }
        let changed = false;
        for (const [key, val] of Object.entries(found)) {
          if (val !== null && val !== undefined && (v[key] === null || v[key] === undefined)) {
            v[key] = val;
            changed = true;
          }
        }
        if (changed) {
          updated++;
          logLine(`UPDATED ${v.vin} (${v.dealerName}) -> year=${v.year} model=${v.model} price=${v.price}`);
        } else {
          noChange++;
        }
      } catch (err) {
        failed++;
        logLine(`FAILED ${v.vin} (${v.dealerName}) -> ${err.message}`);
      }

      processed++;
      if (processed % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory));
        const msg = `Checkpoint: ${processed}/${targets.length} | updated=${updated} noChange=${noChange} failed=${failed}`;
        console.log(msg);
        logLine(msg);
      }
    },
    CONCURRENCY
  );

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory));

  const summary = `=== DONE === processed=${processed} updated=${updated} noChange=${noChange} failed=${failed}`;
  console.log(summary);
  logLine(summary);
  log.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
