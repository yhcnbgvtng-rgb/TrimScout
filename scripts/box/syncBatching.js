// Builds the /api/inventory/bulk request bodies for inventory-sync.mjs, capped by row count AND by
// serialized size.
//
// A row-count cap alone isn't safe: the deals API refuses any body over 30MB, and a vehicle carrying a
// long options list or price history can be an order of magnitude bigger than a typical one, so 2000
// "ordinary" rows fit but 2000 rows from a feature-heavy shard might not. Sizing by bytes keeps every
// request comfortably under that limit however the data looks, and is what makes it safe to raise the
// row cap.
//
// Each row is serialized exactly once, here, and the body string is assembled from those pieces — the
// size is exact, and nothing is stringified a second time when the request is sent. Rows are serialized
// lazily per batch (never all up front): 700k pre-serialized rows would double the process's memory.

export const DEFAULT_BATCH_ROWS = 2000;
export const DEFAULT_BATCH_MAX_BYTES = 12 * 1024 * 1024; // 40% of the server's 30MB body limit

const PREFIX = '{"vehicles":[';
const SUFFIX = "]}";

/**
 * Take the next batch starting at rows[start].
 * Stops at `maxRows` rows or before the body would exceed `maxBytes` — whichever comes first — but always
 * includes at least one row, so a single oversized row still goes out (alone) rather than wedging the run.
 * @returns {{ count: number, bytes: number, body: string }}
 */
export function takeBatch(rows, start, { maxRows = DEFAULT_BATCH_ROWS, maxBytes = DEFAULT_BATCH_MAX_BYTES, stringify = JSON.stringify } = {}) {
  const parts = [];
  let bytes = PREFIX.length + SUFFIX.length;
  for (let i = start; i < rows.length && parts.length < maxRows; i++) {
    const s = stringify(rows[i]);
    const sep = parts.length ? 1 : 0; // the comma
    const size = Buffer.byteLength(s) + sep;
    if (parts.length > 0 && bytes + size > maxBytes) break;
    parts.push(s);
    bytes += size;
  }
  return { count: parts.length, bytes, body: PREFIX + parts.join(",") + SUFFIX };
}

/**
 * Plan every batch without keeping any bodies — used by `--dry-run` to show how a real crawl output would
 * split, so a batch-size change can be judged against real data before any request is sent.
 * @returns {{ batches: number, rows: number, totalBytes: number, minBytes: number, medianBytes: number, p95Bytes: number, maxBytes: number, maxRowsInBatch: number }}
 */
export function planBatches(rows, start = 0, opts = {}) {
  const sizes = [];
  let i = start;
  let maxRowsInBatch = 0;
  while (i < rows.length) {
    const b = takeBatch(rows, i, opts);
    sizes.push(b.bytes);
    maxRowsInBatch = Math.max(maxRowsInBatch, b.count);
    i += b.count;
  }
  const sorted = sizes.slice().sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
  return {
    batches: sizes.length,
    rows: rows.length - start,
    totalBytes: sizes.reduce((a, b) => a + b, 0),
    minBytes: sorted[0] ?? 0,
    medianBytes: at(0.5),
    p95Bytes: at(0.95),
    maxBytes: sorted[sorted.length - 1] ?? 0,
    maxRowsInBatch,
  };
}
