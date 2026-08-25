#!/usr/bin/env node
// Cross-references our own dealer-scraped vehicles against Porsche's
// official Finder (finder.porsche.com) to pull the authoritative factory
// build sheet — real PR-codes, full descriptions, both installed
// (special) and standard equipment — straight from Porsche's own system.
//
// Finder has no VIN search. The approach: search by dealer location +
// model line (which Finder does support), page through results, and
// match VINs against our own dataset — Finder's search results already
// include each listing's real VIN in embedded schema.org JSON-LD, so this
// is an exact match, not a fuzzy one. For matched VINs, fetch the detail
// page and pull the full equipment breakdown from an embedded RSC JSON
// payload (richer and more precise than the JSON-LD summary).
//
// Usage:
//   node enrich_from_finder.mjs --dealer "Paul Miller Porsche" --zip 07054 --lat 40.87298 --lng -74.43035 [--limit 20] [--models macan,911] [--vins <file>] [--out <path>]
//
// Finder rate-limits aggressively (a 3s/req pace was enough to trigger
// repeated 429s in testing), so this runs sequentially with deliberate,
// jittered delays — expect it to be much slower than the dealer-site
// crawler. --models restricts which of the 7 model lines to search,
// useful for keeping request volume down when you already know what
// you're looking for.

import { gotScraping } from "got-scraping";
import fs from "node:fs";
import path from "node:path";

const ALL_MODEL_SLUGS = ["911", "718-cayman", "718-boxster", "cayenne", "macan", "panamera", "taycan"];
const BASE_DELAY_MS = 8000;
const DELAY_JITTER_MS = 3000;
const MODEL_SWITCH_DELAY_MS = 12000;
const MAX_PAGES_PER_MODEL = 20; // safety cap
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 20000;

function jitteredDelay() {
  return BASE_DELAY_MS + Math.floor(Math.random() * DELAY_JITTER_MS);
}

function parseArgs(argv) {
  const args = { limit: Infinity, out: null, models: ALL_MODEL_SLUGS };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dealer") args.dealer = argv[++i];
    else if (flag === "--zip") args.zip = argv[++i];
    else if (flag === "--lat") args.lat = argv[++i];
    else if (flag === "--lng") args.lng = argv[++i];
    else if (flag === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--models") args.models = argv[++i].split(",");
    else if (flag === "--vins") args.vinsFile = argv[++i];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempt = 1) {
  try {
    const res = await gotScraping({ url, timeout: { request: 15000 } });
    if (res.statusCode === 429) {
      if (attempt > MAX_RETRIES) throw new Error("rate limited after retries");
      // Exponential backoff starting well above the base request delay —
      // a 429 means we've already outpaced Finder's limiter, so recovering
      // needs a real cooldown, not just a slightly longer version of the
      // same pace that triggered it.
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`  429 rate limited, backing off ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchWithRetry(url, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt > MAX_RETRIES) throw err;
    await sleep(BASE_BACKOFF_MS * attempt);
    return fetchWithRetry(url, attempt + 1);
  }
}

function extractJsonLdItemList(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      if (parsed["@type"] === "ItemList") return parsed.itemListElement || [];
    } catch {
      // skip
    }
  }
  return [];
}

// The RSC stream ships the page's data as a sequence of
// `self.__next_f.push([1,"..."])` calls, each a JSON-escaped string
// fragment. Concatenating the decoded fragments in order reconstructs the
// full text, inside which the vehicle's real equipment JSON lives as an
// escaped substring (not a directly parseable top-level object — we
// extract it by locating the wrapping "specialEquipment":[...] /
// "standardEquipment":[...] arrays via matched-bracket scanning).
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
  const arrStart = startIdx + marker.length - 1; // position of '['
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

function extractFinderEquipment(html) {
  const decoded = decodeRscStream(html);
  const specialEquipment = extractBracketedArray(decoded, "specialEquipment");
  const standardEquipment = extractBracketedArray(decoded, "standardEquipment");
  return { specialEquipment, standardEquipment };
}

function flattenEquipmentCategories(categories) {
  if (!Array.isArray(categories)) return [];
  const items = [];
  for (const category of categories) {
    for (const item of category.items || []) {
      if (!item.code || !item.name) continue;
      items.push({
        code: item.code,
        name: item.name,
        category: category.name || "Other",
        subtitle: item.subtitle && item.subtitle !== "$undefined" ? item.subtitle : undefined,
        description: item.description && item.description !== "$undefined" ? item.description : undefined,
      });
    }
  }
  return items;
}

async function searchFinderModel(dealerZip, lat, lng, modelSlug, targetVins) {
  const found = new Map(); // vin -> { offersUrl, listingData }
  for (let page = 1; page <= MAX_PAGES_PER_MODEL; page++) {
    const position = `${dealerZip},${lat},${lng},15`; // 15mi radius — tight around the dealer
    const url = `https://finder.porsche.com/us/en-US/search/${modelSlug}?model=${modelSlug}&position=${position}${page > 1 ? `&page=${page}` : ""}`;
    console.log(`  [${modelSlug}] fetching page ${page}...`);
    const res = await fetchWithRetry(url);
    await sleep(jitteredDelay());
    if (res.statusCode !== 200) {
      console.log(`  [${modelSlug}] page ${page} status ${res.statusCode}, stopping`);
      break;
    }
    const items = extractJsonLdItemList(res.body);
    if (items.length === 0) {
      console.log(`  [${modelSlug}] page ${page} empty, stopping pagination`);
      break;
    }
    for (const item of items) {
      const vin = item.vehicleIdentificationNumber;
      if (vin && targetVins.has(vin) && !found.has(vin)) {
        found.set(vin, { offersUrl: item.offers?.url, listing: item });
      }
    }
    if (found.size >= targetVins.size) break; // found everything we're looking for
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dealer || !args.zip || !args.lat || !args.lng) {
    console.error("Usage: node enrich_from_finder.mjs --dealer <name> --zip <zip> --lat <lat> --lng <lng> [--vins <file>] [--limit N] [--out <path>]");
    process.exit(1);
  }

  let targetVins;
  if (args.vinsFile) {
    targetVins = new Set(JSON.parse(fs.readFileSync(args.vinsFile, "utf-8")));
  } else {
    const repoDataPath = path.resolve(process.cwd(), "..", "..", "data", "lightsail_inventory.json");
    const inventory = JSON.parse(fs.readFileSync(repoDataPath, "utf-8"));
    targetVins = new Set(
      inventory.filter((v) => v.dealerName === args.dealer).map((v) => v.vin).slice(0, args.limit)
    );
  }
  console.log(`Target VINs for ${args.dealer}: ${targetVins.size}`);

  const results = {};
  let matchedSoFar = new Map();

  for (const modelSlug of args.models) {
    if (matchedSoFar.size >= targetVins.size) break;
    const remaining = new Set([...targetVins].filter((v) => !matchedSoFar.has(v)));
    const found = await searchFinderModel(args.zip, args.lat, args.lng, modelSlug, remaining);
    for (const [vin, data] of found) matchedSoFar.set(vin, data);
    console.log(`[${modelSlug}] matched ${found.size} (running total: ${matchedSoFar.size}/${targetVins.size})`);
    await sleep(MODEL_SWITCH_DELAY_MS);
  }

  console.log(`\nMatched ${matchedSoFar.size}/${targetVins.size} VINs in Finder. Fetching detail pages...`);

  let processed = 0;
  for (const [vin, { offersUrl, listing }] of matchedSoFar) {
    processed++;
    if (!offersUrl) continue;
    console.log(`[${processed}/${matchedSoFar.size}] ${vin} -> ${offersUrl}`);
    try {
      const res = await fetchWithRetry(offersUrl);
      await sleep(jitteredDelay());
      const { specialEquipment, standardEquipment } = extractFinderEquipment(res.body);
      results[vin] = {
        finderUrl: offersUrl,
        exteriorColor: listing.color,
        interiorColor: listing.vehicleInteriorColor,
        price: listing.offers?.price,
        installedOptions: flattenEquipmentCategories(specialEquipment),
        standardEquipment: flattenEquipmentCategories(standardEquipment),
      };
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results[vin] = { finderUrl: offersUrl, error: err.message };
    }
  }

  const outPath = args.out || path.resolve(process.cwd(), "finder_enrichment_output.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nDone. Wrote ${Object.keys(results).length} enriched records to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
