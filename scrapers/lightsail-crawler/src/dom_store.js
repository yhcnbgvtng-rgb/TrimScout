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
  for (const m of ldBlocks) {
    if (/Vehicle|Car|Product/i.test(m[1])) return m[1].trim();
  }

  if (vin) {
    const idx = text.indexOf(vin);
    if (idx !== -1) {
      return text.slice(Math.max(0, idx - 4000), Math.min(text.length, idx + 8000));
    }
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

export async function pruneDomBlobs({ retainDays = DOM_RETAIN_DAYS, today = new Date().toISOString().slice(0, 10), cwd = process.cwd() } = {}) {
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
