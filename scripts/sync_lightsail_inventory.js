#!/usr/bin/env node
// Syncs the crawler's freshly scraped + enriched nationwide inventory
// (scrapers/lightsail-crawler/data/national_inventory_latest.json) into the
// file the live app actually serves (data/lightsail_inventory.json).
//
// These two locations are otherwise disconnected: running the crawler alone
// does not update what the site shows. Run this after `node src/standalone.js`
// (from scrapers/lightsail-crawler) has finished, then commit + push
// data/lightsail_inventory.json to deploy the refreshed data.
//
// Usage:
//   node scripts/sync_lightsail_inventory.js [--source <path>] [--force]
//
//   --source  Override the crawler output path (default: crawler's
//             national_inventory_latest.json).
//   --force   Skip the "record count didn't shrink drastically" safety
//             check. Use if you intentionally ran a partial/pilot crawl.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEST_PATH = path.join(ROOT, "data", "lightsail_inventory.json");
const BACKUP_PATH = path.join(ROOT, "data", "lightsail_inventory.backup.json");
const DEFAULT_SOURCE_PATH = path.join(
  ROOT,
  "scrapers",
  "lightsail-crawler",
  "data",
  "national_inventory_latest.json"
);

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE_PATH, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) {
      args.source = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--force") {
      args.force = true;
    }
  }
  return args;
}

function readJsonArray(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array of vehicle records`);
  }
  return parsed;
}

function countWithRealOptions(records) {
  return records.filter((r) => Array.isArray(r.factoryOptions) && r.factoryOptions.length > 0).length;
}

// dealerListedOptions is the crawler's raw intermediate field — enricher.js
// already folds it into factoryOptions/optionCodes, so it's redundant
// payload for the app to ship. Strip it before writing the served copy.
function stripInternalFields(record) {
  const { dealerListedOptions, ...rest } = record;
  return rest;
}

function main() {
  const { source, force } = parseArgs(process.argv.slice(2));

  console.log("====================================================");
  console.log("🔄 SYNCING CRAWLER OUTPUT -> LIVE-SERVED INVENTORY");
  console.log("====================================================");
  console.log(`Source: ${source}`);
  console.log(`Dest:   ${DEST_PATH}`);

  const incoming = readJsonArray(source, "Crawler output");
  if (incoming.length === 0) {
    throw new Error("Crawler output has zero records — refusing to sync. Check the crawler run for errors.");
  }

  const missingVin = incoming.filter((r) => !r.vin).length;
  if (missingVin > 0) {
    console.warn(`⚠️  ${missingVin} incoming record(s) are missing a VIN.`);
  }

  let existingCount = 0;
  if (fs.existsSync(DEST_PATH)) {
    const existing = readJsonArray(DEST_PATH, "Existing served inventory");
    existingCount = existing.length;

    // Guard against accidentally clobbering the live dataset with a
    // partial/broken crawl run. A full nationwide run should land in the
    // same ballpark as what's already being served.
    const shrinkRatio = incoming.length / existingCount;
    if (shrinkRatio < 0.5 && !force) {
      throw new Error(
        `Incoming data has ${incoming.length} records vs ${existingCount} currently served ` +
          `(${Math.round(shrinkRatio * 100)}%). This looks like a partial crawl, not a full ` +
          `nationwide refresh. Re-run with --force if this is intentional (e.g. a pilot run).`
      );
    }

    fs.writeFileSync(BACKUP_PATH, fs.readFileSync(DEST_PATH));
    console.log(`📦 Backed up existing served inventory to ${path.relative(ROOT, BACKUP_PATH)}`);
  }

  const outgoing = incoming.map(stripInternalFields);
  fs.writeFileSync(DEST_PATH, JSON.stringify(outgoing, null, 2));

  console.log("\n====================================================");
  console.log("✅ SYNC COMPLETE");
  console.log("====================================================");
  console.log(`Previously served: ${existingCount} vehicles`);
  console.log(`Now served:        ${outgoing.length} vehicles`);
  console.log(`With real dealer-listed options: ${countWithRealOptions(outgoing)} vehicles`);
  console.log(`\nNext: git add data/lightsail_inventory.json && git commit && git push`);
}

try {
  main();
} catch (err) {
  console.error(`\n❌ Sync failed: ${err.message}`);
  process.exit(1);
}
