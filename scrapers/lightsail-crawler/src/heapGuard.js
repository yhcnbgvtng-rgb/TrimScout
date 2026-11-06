// Heap guard for one crawl process (standalone.js).
//
// 2026-11-05 night: MD Nissan (box1) and FL Infiniti (box5) died with "Reached heap limit ... JavaScript heap out of memory" (SIGABRT) while
// extracting one very large store (Eastern's Nissan of White Marsh, 2,423 VDP URLs; Infiniti of South Miami, 3,295). The process held ~3.58 GB
// of live heap (Mark-Compact reclaimed nothing), and an abort writes nothing: the stores already finished in that run were lost with it.
//
// This does two things, both cheap:
//   * heapPressure(): is live heap close to the limit? standalone.js stops handing out URLs for the current store (same mechanism as the
//     1-hour cutoff), flags the store as a partial crawl (excluded from the sold-diff and the sweep) and goes on to save what it has.
//   * detachStrings(): defensive and UNMEASURED. A regexp capture / slice of a page is a V8 "sliced string" that can keep the whole page alive, so a vehicle
//     built from captures could pin a page per car in currentInventory; structuredClone copies every string flat. Whether this is what filled the heap on
//     2026-11-05 has NOT been shown (no heap snapshot was taken); the guard, not this copy, is what protects the run.
//
// CRAWLER_HEAP_GUARD_RATIO: fraction of the heap limit that counts as pressure (default 0.85); 0 turns the guard off.

import v8 from 'node:v8';

export const DEFAULT_HEAP_GUARD_RATIO = 0.85;

export function heapGuardRatio(env = process.env) {
  const raw = env.CRAWLER_HEAP_GUARD_RATIO;
  if (raw === undefined || raw === '') return DEFAULT_HEAP_GUARD_RATIO;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return DEFAULT_HEAP_GUARD_RATIO;
  return n;
}

/**
 * @param {{ ratio?: number, reserveBytes?: number, stats?: () => { used_heap_size: number, heap_size_limit: number }, minIntervalMs?: number, now?: () => number }} [opts]
 * @returns {{ pressured: () => boolean, snapshot: () => { usedMb: number, limitMb: number, ratio: number, stopAtMb: number } }}
 */
/**
 * Heap the crawl still needs AFTER the guard trips. Measured 2026-11-06 with a box1-sized dom_index.json (489 MB, 2.37M vin-dates): standalone.js saves that
 * index after every store with one JSON.stringify, a transient string about as big as the file, and the final merge/save needs room too. With 3,078 MB live of
 * a 3,584 MB limit (85%) the save survived with ~40 MB to spare; at 88% it aborted. So the guard trips at limit - reserve, not at a fixed share of the limit.
 */
export const IN_FLIGHT_RESERVE_BYTES = 256 * 1048576; // page bodies of the 8 workers, the merge, the output writes
export const heapReserveBytes = (indexBytes = 0) => Math.round(Math.max(0, indexBytes) * 1.25) + IN_FLIGHT_RESERVE_BYTES;

export function makeHeapGuard({ ratio = heapGuardRatio(), reserveBytes = 0, stats = () => v8.getHeapStatistics(), minIntervalMs = 500, now = Date.now } = {}) {
  let last = { at: -Infinity, pressured: false };
  // The lower of "ratio of the limit" and "limit minus what saving still needs", but never below half the limit (an absurd reserve must not stop every store at once).
  const thresholdOf = (limit) => Math.max(0.5 * limit, Math.min(ratio * limit, limit - reserveBytes));
  const read = () => {
    const s = stats();
    return { used: s.used_heap_size, limit: s.heap_size_limit };
  };
  return {
    // Throttled: called once per URL by the worker pool, so reading heap statistics every call would be wasted work.
    pressured() {
      if (!(ratio > 0)) return false;
      const t = now();
      if (t - last.at < minIntervalMs) return last.pressured;
      const { used, limit } = read();
      last = { at: t, pressured: used >= thresholdOf(limit) };
      return last.pressured;
    },
    snapshot() {
      const { used, limit } = read();
      return { usedMb: Math.round(used / 1048576), limitMb: Math.round(limit / 1048576), ratio, stopAtMb: Math.round(thresholdOf(limit) / 1048576) };
    },
  };
}

/** A copy of a plain record whose strings do not point into a larger string (a page body). Falls back to the original if it cannot be cloned. */
export function detachStrings(record) {
  try { return structuredClone(record); } catch { return record; }
}

/**
 * The crawl-log line for a store the guard cut short. The sync client (scripts/box/syncSweepGuard.js, HEAP_RE) parses exactly this shape to keep the store
 * out of the sweep; test/heap_guard_sync.test.js pins the two together.
 */
export function formatHeapStopLine({ progress = '', name, usedMb, limitMb, stopAtMb, count }) {
  return `${progress ? `${progress} ` : ''}🧠 ${name}: heap ${usedMb} MB of ${limitMb} MB (guard stops at ${stopAtMb} MB) — stopped this store after ${count} vehicle(s); the rest were not read and the store is treated as a partial crawl.`;
}
