// Pure checkpoint/resume logic for inventory-sync.mjs — extracted for unit testing without
// touching the filesystem or running a real sync.
//
// inventory-sync.mjs had no resume: a crash partway through the upsert loop meant the *next* run
// redid the whole file from row 0, even if it had already written 90% of it. Upserts are
// idempotent (re-sending an already-written row just refreshes last_seen), so redoing them isn't
// incorrect, just slow and needless load on the deals box — worse the longer a file has grown.
// This checkpoint is purely that optimization, never a second source of truth: a fresh run with
// no checkpoint (or one for a different file) still upserts everything, exactly as before.

// Stable identity for "is this the same source file(s) as last time" — built from each shard's
// path, size, and mtime rather than its content, so checking it doesn't require reading
// multi-hundred-MB files (which would defeat the point of resuming quickly). Sorted so shard
// read order doesn't matter.
export function computeFileIdentity(files) {
  return files
    .map((f) => `${f.path}:${f.size}:${f.mtimeMs}`)
    .sort()
    .join("|");
}

// The upsert loop must walk rows in this same (dealerId, vin) order every run — otherwise
// "resume after cursor X" wouldn't mean the same set of remaining rows from one run to the next.
export function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const ad = a.dealerId ?? 0,
      bd = b.dealerId ?? 0;
    if (ad !== bd) return ad - bd;
    return a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0;
  });
}

export function makeCheckpoint(fileIdentity, lastRow) {
  return { fileIdentity, lastDealerId: lastRow.dealerId ?? 0, lastVin: lastRow.vin };
}

// ---------------------------------------------------------------------------------------------------
// Run state (v2) — what lets a run that died AFTER the upserts (a sweep that hit a timeout, a lost lock)
// be picked up again without redoing hundreds of thousands of upserts, and picked up CORRECTLY.
//
// The v1 checkpoint above only remembered how far the upsert loop got. That is not enough once a sweep
// is involved, and was actively unsafe: the sweep marks every row of a store "removed" unless it was seen
// since a cutoff (`startedAt`), and a resumed run recomputed that cutoff from its OWN start time. Rows
// the earlier attempt had already upserted — and which the resumed run therefore skipped — carry the
// earlier attempt's last_seen_at, hours before the new cutoff, so the sweep retired every one of them even
// though the vehicle is still listed. The cutoff has to be chosen once per crawl output and persisted;
// every attempt on that same output reuses it, so "seen by ANY attempt since startedAt" is what keeps a row.
//
// The state also records which phase the run is in and how far through the (sorted) store list the sweep
// got, so a resumed run skips straight to where the last one stopped. A v1 checkpoint has no cutoff and is
// ignored (a full run is always safe); so is state for a different crawl output or one older than
// MAX_RESUME_AGE_MS.
export const RUN_STATE_VERSION = 2;
export const MAX_RESUME_AGE_MS = 48 * 60 * 60 * 1000;

export function newRunState({ fileIdentity, startedAt, now = Date.now() }) {
  const t = new Date(now).toISOString();
  return {
    version: RUN_STATE_VERSION,
    fileIdentity,
    startedAt,
    phase: "upsert",
    upsert: { lastDealerId: null, lastVin: null, rows: 0 },
    sweep: { nextIndex: 0, removed: 0, failedStores: [], store0Done: false },
    createdAt: t,
    updatedAt: t,
  };
}

/** The saved state if it is a usable v2 state for THIS crawl output, else null (start a fresh run). */
export function parseRunState(raw, fileIdentity, { now = Date.now(), maxAgeMs = MAX_RESUME_AGE_MS } = {}) {
  if (!raw || typeof raw !== "object" || raw.version !== RUN_STATE_VERSION) return null;
  if (raw.fileIdentity !== fileIdentity) return null;
  const startedMs = Date.parse(raw.startedAt);
  if (!Number.isFinite(startedMs) || now - startedMs > maxAgeMs) return null;
  if (raw.phase !== "upsert" && raw.phase !== "sweep") return null;
  const up = raw.upsert && typeof raw.upsert === "object" ? raw.upsert : {};
  const sw = raw.sweep && typeof raw.sweep === "object" ? raw.sweep : {};
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    version: RUN_STATE_VERSION,
    fileIdentity,
    startedAt: new Date(startedMs).toISOString(),
    phase: raw.phase,
    upsert: {
      lastDealerId: up.lastVin == null ? null : num(up.lastDealerId),
      lastVin: up.lastVin == null ? null : String(up.lastVin),
      rows: Math.max(0, num(up.rows)),
    },
    sweep: {
      nextIndex: Math.max(0, Math.floor(num(sw.nextIndex))),
      removed: Math.max(0, num(sw.removed)),
      failedStores: Array.isArray(sw.failedStores) ? sw.failedStores.map(Number).filter(Number.isFinite) : [],
      store0Done: sw.store0Done === true,
    },
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(startedMs).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(startedMs).toISOString(),
  };
}

/**
 * Index of the first row strictly after the upsert cursor in (dealerId, vin) order — the same order
 * sortRows() produces — or 0 when nothing has been upserted yet. Binary search: rows are sorted.
 */
export function upsertStartIndex(sortedRows, upsert) {
  if (!upsert || upsert.lastVin == null) return 0;
  const lastDealerId = upsert.lastDealerId ?? 0;
  let lo = 0;
  let hi = sortedRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const d = sortedRows[mid].dealerId ?? 0;
    const after = d > lastDealerId || (d === lastDealerId && sortedRows[mid].vin > upsert.lastVin);
    if (after) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Rows already covered by a checkpoint from an earlier, crashed run against the SAME source file
// are skipped. A checkpoint for a different file (a new day's crawl, a different shard set) is
// ignored entirely — starting over, not resuming into unrelated data.
export function resumeFrom(sortedRows, checkpoint, fileIdentity) {
  if (!checkpoint || checkpoint.fileIdentity !== fileIdentity) return sortedRows;
  const { lastDealerId, lastVin } = checkpoint;
  const idx = sortedRows.findIndex((r) => {
    const d = r.dealerId ?? 0;
    return d > lastDealerId || (d === lastDealerId && r.vin > lastVin);
  });
  return idx === -1 ? [] : sortedRows.slice(idx);
}
