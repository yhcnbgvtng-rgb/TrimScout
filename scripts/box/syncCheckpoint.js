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
