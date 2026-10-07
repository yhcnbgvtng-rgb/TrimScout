// What the nightly sync is allowed to say about the crawl output it reads. Pure (plus one small file probe), so the
// rules are unit-tested instead of rediscovered in production.
//
// Why this exists (traced 2026-10-07, Brownsville Toyota TX): the sync uploaded EVERY record with status ACTIVE in every
// shard file. A shard keeps records forever, so box3's TX.json still held 152 Brownsville records last refreshed
// 2026-09-26 (the last time box3 crawled that store; Toyota TX moved to box2 afterwards). Uploading them made the deals
// API stamp last_seen_at = NOW() and clear removed_at (handleInventoryBulk: ON DUPLICATE KEY UPDATE ...), so sold cars
// looked freshly seen — and box3 then swept the store, retiring the live cars box2 had written that morning.
//
// Three rules:
//   1. FRESHNESS   — only records the crawl actually refreshed recently (record.updatedAt) are uploaded. A record with
//                    no/invalid updatedAt is NOT fresh (fail closed). Stale records are skipped, never "re-seen".
//   2. COMPLETENESS — a shard file that is truncated is not read at all; one over the size limit (the crawler's merge
//                    dies near V8's ~512MB string cap, so such a file is a partial merge) is read for its fresh records
//                    but none of its stores are swept. Retiring rows is a claim of completeness; don't make it from
//                    an incomplete file.
//   3. a store is only swept if this run uploaded at least one fresh row for it (existing behaviour) AND it isn't excluded
//                    by rule 2 — see sweepableStores().
import fs from "node:fs";

export const DEFAULT_MAX_RECORD_AGE_HOURS = 30;          // nightly crawl + the hours until its sync starts, with margin
export const DEFAULT_FOREIGN_GRACE_HOURS = 48;           // two nights: a row another box wrote more recently than this is theirs
export const DEFAULT_SHARD_MAX_BYTES = 480 * 1024 * 1024; // just under V8's max string length, where merges start failing
const FUTURE_SKEW_MS = 10 * 60 * 1000;                    // box clocks drift; a record "from" a few minutes ahead is still fresh

/** Is this crawl record recent enough to be treated as seen by this run? Unknown age = not fresh. */
export function isFreshRecord(rec, nowMs, maxAgeMs) {
  const t = Date.parse(rec && rec.updatedAt);
  if (!Number.isFinite(t)) return false;
  return t >= nowMs - maxAgeMs && t <= nowMs + FUTURE_SKEW_MS;
}

/** Env-driven limits, with the defaults above. */
export function freshnessConfig(env = process.env) {
  const hours = (k, d) => { const n = Number(env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    maxRecordAgeMs: hours("SYNC_MAX_RECORD_AGE_HOURS", DEFAULT_MAX_RECORD_AGE_HOURS) * 3600_000,
    foreignGraceMs: hours("SYNC_FOREIGN_GRACE_HOURS", DEFAULT_FOREIGN_GRACE_HOURS) * 3600_000,
    shardMaxBytes: hours("SYNC_SHARD_MAX_MB", DEFAULT_SHARD_MAX_BYTES / 1048576) * 1048576,
  };
}

/**
 * Cheap structural check of a shard (a JSON array of records): first non-space byte `[`, last non-space byte `]`.
 * A file cut off mid-write or by a failed merge ends elsewhere. Does not parse the file.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkShardStructure(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const { size } = fs.fstatSync(fd);
    if (size < 2) return { ok: false, reason: `only ${size} byte(s)` };
    const head = Buffer.alloc(Math.min(64, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const first = head.toString("utf8").trimStart()[0];
    if (first !== "[") return { ok: false, reason: `does not start with "[" (starts with ${JSON.stringify(first)})` };
    const tailLen = Math.min(64, size);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const last = tail.toString("utf8").trimEnd().slice(-1);
    if (last !== "]") return { ok: false, reason: `does not end with "]" (ends with ${JSON.stringify(last)}) — truncated?` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err.message}` };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to close */ }
  }
}

/**
 * What to do with one shard file.
 *   skip     — structurally broken: upload nothing from it, sweep nothing for it.
 *   noSweep  — over the size limit: upload its fresh records, but none of its stores may be swept.
 *   normal   — read it and let its stores be swept as usual.
 */
export function shardPlan({ sizeBytes, structure, maxBytes }) {
  if (!structure.ok) return { action: "skip", reason: structure.reason };
  if (sizeBytes > maxBytes) return { action: "noSweep", reason: `${(sizeBytes / 1048576).toFixed(0)}MB is over the ${(maxBytes / 1048576).toFixed(0)}MB limit — the crawl's merge for this state is unreliable at this size` };
  return { action: "normal" };
}

/** Stores that may be swept: uploaded at least one fresh row this run, minus anything excluded (rule 2). */
export function sweepableStores(freshDealerIds, excluded = new Set()) {
  return [...new Set(freshDealerIds.filter(Boolean))].filter((id) => !excluded.has(id));
}

/** How long a row written by ANOTHER box is protected from this box's sweep: it must have gone unseen since this instant. */
export function foreignBeforeIso(startedAtIso, foreignGraceMs) {
  return new Date(Date.parse(startedAtIso) - foreignGraceMs).toISOString();
}
