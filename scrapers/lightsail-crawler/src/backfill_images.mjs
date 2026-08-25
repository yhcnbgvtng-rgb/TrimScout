#!/usr/bin/env node
// Nationwide vehicle photo backfill. Every platform found in this dataset
// exposes a real photo through a cheap, reliable field:
//   - Dealer.com (DDC dataLayer): raw.images[0].uri (ACTUAL_PHOTO)
//   - Porsche retailer platform (*.porsche.com/en/inventory/): og:image meta
//   - schema.org JSON-LD (e.g. Porsche Beverly Hills): the `image` property
// Never fabricates a URL — only stores what the vehicle's own page actually
// serves. Checkpoints every 250 records so a crash loses only minutes.

import { gotScraping } from "got-scraping";
import fs from "node:fs";
import vm from "node:vm";

const INVENTORY_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/data/lightsail_inventory.json";
const LOG_PATH =
  "/Users/paul/Claude - GitHub/TrimScout/scrapers/lightsail-crawler/backfill_images.log";
const CONCURRENCY = 14;
const REQUEST_TIMEOUT_MS = 12000;
const CHECKPOINT_EVERY = 250;

function extractImage(html, pageUrl) {
  const ddcMatch =
    html.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/) ||
    html.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
  if (ddcMatch) {
    try {
      const sandbox = {};
      vm.runInNewContext("vehicles = " + ddcMatch[1], sandbox);
      const raw = sandbox.vehicles && sandbox.vehicles[0];
      const uri = raw && Array.isArray(raw.images) && raw.images[0] && raw.images[0].uri;
      if (uri) return uri;
    } catch {
      // fall through
    }
  }

  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  if (og && og[1]) return og[1];

  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      if (parsed && parsed["@type"] === "Vehicle" && parsed.image) {
        const img = Array.isArray(parsed.image) ? parsed.image[0] : parsed.image;
        if (typeof img === "string") {
          if (img.startsWith("http")) return img;
          const origin = new URL(pageUrl).origin;
          return origin + (img.startsWith("/") ? img : `/${img}`);
        }
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
  let targets = inventory.filter((v) => !v.imageUrl && v.url);
  const limit = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : null;
  if (limit) targets = targets.slice(0, limit);

  const log = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const logLine = (s) => log.write(`${new Date().toISOString()} ${s}\n`);

  logLine(`=== Starting image backfill: ${targets.length} vehicles ===`);
  console.log(`Targets: ${targets.length}`);

  let updated = 0;
  let notFound = 0;
  let failed = 0;
  let processed = 0;

  await pMap(
    targets,
    async (v) => {
      try {
        const res = await gotScraping(v.url, { timeout: { request: REQUEST_TIMEOUT_MS }, retry: { limit: 1 } });
        const img = extractImage(res.body, v.url);
        if (img) {
          v.imageUrl = img;
          updated++;
        } else {
          notFound++;
        }
      } catch (err) {
        failed++;
        logLine(`FAILED ${v.vin} (${v.dealerName}) -> ${err.message}`);
      }

      processed++;
      if (processed % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory));
        const msg = `Checkpoint: ${processed}/${targets.length} | updated=${updated} notFound=${notFound} failed=${failed}`;
        console.log(msg);
        logLine(msg);
      }
    },
    CONCURRENCY
  );

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory));

  const summary = `=== DONE === processed=${processed} updated=${updated} notFound=${notFound} failed=${failed}`;
  console.log(summary);
  logLine(summary);
  log.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
