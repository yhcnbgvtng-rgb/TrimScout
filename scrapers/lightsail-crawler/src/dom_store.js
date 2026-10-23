// Daily vehicle DOM snapshots.
//
// Full (or compact extracted) HTML is gzipped and keyed by VIN+date under
// data/dom_blobs/. If today's DOM hash matches yesterday's, only the hash
// is recorded and the blob is not rewritten. Full blobs are retained for
// 7 days; hashes + prices live indefinitely in data/dom_index.json and
// (when MariaDB is configured) vehicle_dom_snapshots.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { priceChangeVsYesterday } from './price_diff.js';
import { easternDateStamp } from './date_utils.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const DOM_RETAIN_DAYS = 7;
export const DOM_INDEX_FILENAME = 'dom_index.json';
export const DOM_BLOBS_DIRNAME = 'dom_blobs';

export function domPaths(cwd = process.cwd()) {
  const dataDir = path.resolve(cwd, 'data');
  return {
    dataDir,
    indexPath: path.join(dataDir, DOM_INDEX_FILENAME),
    blobsDir: path.join(dataDir, DOM_BLOBS_DIRNAME),
  };
}

export function hashDom(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

// Which occurrence of the VIN to build the window around. A Team Velocity page names the VIN first in its <head> (canonical / og:url / twitter:url
// meta and link tags carry the page URL, which ends in the VIN), so the first occurrence is markup, not the car: the window around it was the page head
// (box4, 2026-10-23: VIN at offset 327-742 of 8.3-8.7 KB blobs, no stock or price text). Rules, in order:
//   1. drop occurrences inside <head>, inside any tag's attributes (meta/link content=, href=, data-*), and inside a URL;
//   2. of what is left (the page body), take the one closest to stock / price / MSRP text (searched within the window, after the head);
//   3. no body occurrence has such text near it: the last body occurrence; no body occurrence at all: the last occurrence anywhere.
// Returns -1 when the VIN is not on the page. Same window as before (4,000 before, 8,000 after).
const NEAR_FIELD = /stock\s*(?:#|no\b|number)|\bstock\b|\bprice\b|\bmsrp\b/gi;
export function pickVinOccurrence(text, vin) {
  const all = [];
  for (let i = text.indexOf(vin); i !== -1; i = text.indexOf(vin, i + 1)) all.push(i);
  if (!all.length) return -1;
  const headEnd = (() => { const m = /<\/head\s*>/i.exec(text); return m ? m.index + m[0].length : 0; })();
  const inTag = (i) => text.lastIndexOf('<', i) > text.lastIndexOf('>', i);
  const inUrl = (i) => {
    const tok = text.slice(Math.max(0, i - 80), i).split(/[\s"'`(,;]/).pop();
    return /^(?:https?:)?\/\//i.test(tok) || tok.startsWith('/') || tok.includes('://');
  };
  const body = all.filter((i) => i >= headEnd && !inTag(i) && !inUrl(i));
  if (!body.length) return all[all.length - 1];
  let best = -1, bestDist = Infinity;
  for (const i of body) {
    const lo = Math.max(headEnd, i - 4000), hi = Math.min(text.length, i + 8000);
    const win = text.slice(lo, hi);
    NEAR_FIELD.lastIndex = 0;
    for (let m = NEAR_FIELD.exec(win); m; m = NEAR_FIELD.exec(win)) {
      const d = Math.abs(lo + m.index - i);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  return best !== -1 ? best : body[body.length - 1];
}

// Prefer a compact vehicle node over the full page so we are not storing
// chrome, nav, and tracker scripts for every VIN every day.
export function extractVehicleDom(html, vin = null) {
  const text = String(html || '');
  const ddc = text.match(/DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/)
    || text.match(/window\.DDC\.dataLayer\[.vehicles.\]\s*=\s*(\[[\s\S]*?\]);/);
  if (ddc) return ddc[0];

  const ldBlocks = [...text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldBlocks) {
    if (/Vehicle|Car|Product/i.test(m[1]) && (!vin || m[1].includes(vin))) return m[1].trim();
  }
  // No JSON-LD block carries this car's VIN. A block that merely matches /Vehicle|Car|Product/ is then the dealer's own (Team Velocity's only
  // JSON-LD is the AutoDealer graph, which matches on the word "vehicles"): storing it keeps nothing about the car, so every such page was cached
  // as the same dealer text. Keep the page around the VIN instead (where the stock number, price and details sit).
  if (vin) {
    const idx = pickVinOccurrence(text, vin);
    if (idx !== -1) {
      return text.slice(Math.max(0, idx - 4000), Math.min(text.length, idx + 8000));
    }
  }
  // VIN not on the page at all (or none given): the first Vehicle-like JSON-LD block, as before.
  for (const m of ldBlocks) {
    if (/Vehicle|Car|Product/i.test(m[1])) return m[1].trim();
  }
  return text;
}

export function blobPath(vin, date, cwd = process.cwd()) {
  const safeVin = String(vin || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  return path.join(domPaths(cwd).blobsDir, safeVin, `${date}.html.gz`);
}

export async function loadDomIndex(cwd = process.cwd()) {
  try {
    return JSON.parse(await fs.readFile(domPaths(cwd).indexPath, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveDomIndex(index, cwd = process.cwd()) {
  const { dataDir, indexPath } = domPaths(cwd);
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = `${indexPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index));
  await fs.rename(tmp, indexPath);
}

function previousDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function captureVehicleDom({
  vin,
  date,
  html,
  price = null,
  yesterdayPrice = null,
  isNew = false,
  isSold = false,
  cwd = process.cwd(),
  index = null,
} = {}) {
  if (!vin || !date) return null;
  const key = String(vin).toUpperCase();
  const idx = index || await loadDomIndex(cwd);
  if (!idx[key]) idx[key] = {};

  const compact = extractVehicleDom(html, key);
  const hash = hashDom(compact);
  const yday = previousDate(date);
  const yRec = idx[key][yday];
  const hashUnchanged = Boolean(yRec && yRec.hash === hash);
  const { priceChangeType, oldPrice, priceDiff } = priceChangeVsYesterday({
    todayPrice: price,
    yesterdayPrice: yesterdayPrice ?? yRec?.price ?? null,
    isNew: isNew || !yRec,
    isSold,
  });

  let blobStored = false;
  if (!hashUnchanged && !isSold && compact) {
    const dest = blobPath(key, date, cwd);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, await gzip(Buffer.from(compact, 'utf8')));
    blobStored = true;
  }

  idx[key][date] = {
    hash,
    price: price ?? null,
    oldPrice,
    priceDiff,
    priceChangeType,
    blobStored,
    hashUnchanged,
  };

  if (!index) await saveDomIndex(idx, cwd);
  return idx[key][date];
}

export async function recordSoldDom({
  vin,
  date,
  yesterdayPrice = null,
  cwd = process.cwd(),
  index = null,
} = {}) {
  if (!vin || !date) return null;
  const key = String(vin).toUpperCase();
  const idx = index || await loadDomIndex(cwd);
  if (!idx[key]) idx[key] = {};
  const yday = previousDate(date);
  const yRec = idx[key][yday];
  idx[key][date] = {
    hash: yRec?.hash || null,
    price: null,
    oldPrice: yesterdayPrice ?? yRec?.price ?? null,
    priceDiff: 0,
    priceChangeType: 'SOLD',
    blobStored: false,
    hashUnchanged: true,
  };
  if (!index) await saveDomIndex(idx, cwd);
  return idx[key][date];
}

export async function readDomBlob(vin, date, cwd = process.cwd()) {
  const buf = await fs.readFile(blobPath(vin, date, cwd));
  return (await gunzip(buf)).toString('utf8');
}

export function flattenDomIndex(index) {
  const rows = [];
  for (const [vin, dates] of Object.entries(index || {})) {
    for (const [snapshotDate, rec] of Object.entries(dates || {})) {
      rows.push({ vin, snapshotDate, ...rec });
    }
  }
  return rows;
}

// `today` defaults to the Eastern calendar date (every real caller in this
// pipeline passes it explicitly anyway — see standalone.js's todayDate —
// but the default matters for direct/ad-hoc invocations and must agree
// with the rest of the pipeline's date bucketing, not silently fall back
// to UTC).
export async function pruneDomBlobs({ retainDays = DOM_RETAIN_DAYS, today = easternDateStamp(), cwd = process.cwd() } = {}) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const { blobsDir } = domPaths(cwd);
  let removed = 0;
  let vinDirs;
  try {
    vinDirs = await fs.readdir(blobsDir);
  } catch {
    return { removed: 0, cutoff: cutoffStr };
  }
  for (const vin of vinDirs) {
    const dir = path.join(blobsDir, vin);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const m = file.match(/^(\d{4}-\d{2}-\d{2})\.html\.gz$/);
      if (!m) continue;
      if (m[1] < cutoffStr) {
        await fs.unlink(path.join(dir, file)).catch(() => {});
        removed++;
      }
    }
  }
  return { removed, cutoff: cutoffStr };
}
