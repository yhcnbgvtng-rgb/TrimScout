// Moves records from a state-wide legacy shard (<ST>.json) into per-brand shards (<ST>__<brand>.json).
// See inventory_shards.js for why. A run's "scope" is the set of dealer names in its own dealer file — the same
// scoping inventory_merge.js uses, so a record has exactly one owner run.
import fs from 'node:fs/promises';
import { readJsonLarge, writeJsonLarge } from './bigJson.js';

export const dealerKeyOf = (rec) => rec?.configDealerName || rec?.dealerName;

async function readIfExists(file) {
  try {
    return await readJsonLarge(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Records in the legacy file that belong to `scopeNames`. Snapshot files are objects keyed by VIN, inventory files
 * are arrays; the result has the same shape. Nothing is modified on disk.
 */
export async function readLegacyInScope(legacyPath, scopeNames, kind) {
  const legacy = await readIfExists(legacyPath);
  if (legacy === null) return kind === 'snapshot' ? {} : [];
  if (kind === 'snapshot') {
    const out = {};
    for (const [vin, rec] of Object.entries(legacy)) if (scopeNames.has(dealerKeyOf(rec))) out[vin] = rec;
    return out;
  }
  return Array.isArray(legacy) ? legacy.filter((r) => scopeNames.has(dealerKeyOf(r))) : [];
}

/**
 * Removes `scopeNames`' records from the legacy file (rewritten atomically; deleted once empty). Call only AFTER the
 * brand shard holding those records is on disk. Returns the number of records removed.
 */
export async function stripLegacyInScope(legacyPath, scopeNames, kind) {
  const legacy = await readIfExists(legacyPath);
  if (legacy === null) return 0;
  let kept;
  let removed = 0;
  if (kind === 'snapshot') {
    kept = {};
    for (const [vin, rec] of Object.entries(legacy)) {
      if (scopeNames.has(dealerKeyOf(rec))) removed++; else kept[vin] = rec;
    }
  } else {
    kept = (Array.isArray(legacy) ? legacy : []).filter((r) => {
      const inScope = scopeNames.has(dealerKeyOf(r));
      if (inScope) removed++;
      return !inScope;
    });
  }
  if (removed === 0) return 0;
  const empty = kind === 'snapshot' ? Object.keys(kept).length === 0 : kept.length === 0;
  if (empty) await fs.rm(legacyPath, { force: true });
  else await writeJsonLarge(legacyPath, kept);
  return removed;
}

/**
 * Splits a whole legacy file into per-brand files. `brandOf(rec)` returns the shard slug for a record (null = leave
 * it in the legacy file). `targetPathOf(slug)` gives the output path. Existing brand files are merged, never
 * overwritten blindly: on a VIN collision the record already in the brand file wins (it is newer — a brand-run wrote
 * it after the split began). Returns { moved, left, bySlug }.
 */
export async function splitLegacyFile(legacyPath, kind, { brandOf, targetPathOf }) {
  const legacy = await readIfExists(legacyPath);
  if (legacy === null) return { moved: 0, left: 0, bySlug: {} };
  const groups = new Map();
  const leftover = kind === 'snapshot' ? {} : [];
  const entries = kind === 'snapshot' ? Object.entries(legacy) : legacy.map((r) => [r?.vin, r]);
  for (const [key, rec] of entries) {
    const slug = brandOf(rec);
    if (!slug) {
      if (kind === 'snapshot') leftover[key] = rec; else leftover.push(rec);
      continue;
    }
    if (!groups.has(slug)) groups.set(slug, kind === 'snapshot' ? {} : []);
    const g = groups.get(slug);
    if (kind === 'snapshot') g[key] = rec; else g.push(rec);
  }
  const bySlug = {};
  let moved = 0;
  for (const [slug, recs] of groups) {
    const target = targetPathOf(slug);
    const existing = await readIfExists(target);
    let merged;
    if (kind === 'snapshot') {
      merged = { ...recs, ...(existing || {}) };
    } else {
      const have = new Set((existing || []).map((r) => r?.vin));
      merged = [...(existing || []), ...recs.filter((r) => !have.has(r?.vin))];
    }
    await writeJsonLarge(target, merged);
    bySlug[slug] = kind === 'snapshot' ? Object.keys(recs).length : recs.length;
    moved += bySlug[slug];
  }
  const left = kind === 'snapshot' ? Object.keys(leftover).length : leftover.length;
  if (left === 0) await fs.rm(legacyPath, { force: true });
  else await writeJsonLarge(legacyPath, leftover);
  return { moved, left, bySlug };
}
