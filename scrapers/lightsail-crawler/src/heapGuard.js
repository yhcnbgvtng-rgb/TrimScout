// Heap guard for one crawl process (standalone.js).
//
// 2026-11-05 night: MD Nissan (box1) and FL Infiniti (box5) died with "Reached heap limit ... JavaScript heap out of memory" (SIGABRT) while
// extracting one very large store (Eastern's Nissan of White Marsh, 2,423 VDP URLs; Infiniti of South Miami, 3,295). The process held ~3.58 GB
// of live heap (Mark-Compact reclaimed nothing), and an abort writes nothing: the stores already finished in that run were lost with it.
//
// This does two things, both cheap:
//   * heapPressure(): is live heap close to the limit? standalone.js stops handing out URLs for the current store (same mechanism as the
//     1-hour cutoff), flags the store as a partial crawl (excluded from the sold-diff and the sweep) and goes on to save what it has.
//   * detachStrings(): a regexp capture / slice of a page is a V8 "sliced string" that keeps the WHOLE page alive. A vehicle built from
//     captures of a 1 MB page then pins 1 MB per car in currentInventory. structuredClone copies every string flat, so only the field values stay.
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
 * @param {{ ratio?: number, stats?: () => { used_heap_size: number, heap_size_limit: number }, minIntervalMs?: number, now?: () => number }} [opts]
 * @returns {{ pressured: () => boolean, snapshot: () => { usedMb: number, limitMb: number, ratio: number } }}
 */
export function makeHeapGuard({ ratio = heapGuardRatio(), stats = () => v8.getHeapStatistics(), minIntervalMs = 500, now = Date.now } = {}) {
  let last = { at: -Infinity, pressured: false };
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
      last = { at: t, pressured: used >= ratio * limit };
      return last.pressured;
    },
    snapshot() {
      const { used, limit } = read();
      return { usedMb: Math.round(used / 1048576), limitMb: Math.round(limit / 1048576), ratio };
    },
  };
}

/** A copy of a plain record whose strings do not point into a larger string (a page body). Falls back to the original if it cannot be cloned. */
export function detachStrings(record) {
  try { return structuredClone(record); } catch { return record; }
}
