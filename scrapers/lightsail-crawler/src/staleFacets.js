// Buyer dropdown counts without stale cars. The buyer search leaves cars last seen more than STALE_HIDE_DAYS ago out of its results
// (inventoryListQuery seenWithinDays); the State / Make / Model / Trim counts must agree, same subtraction approach as retailFacets.js
// (the facet queries are index-only GROUP BYs and a last_seen_at predicate would force a row lookup per counted row).
// Pure: no I/O.

/** Longest look-back, in whole days past the cutoff, the stale aggregate reads; older cars land in the last slice. */
export const STALE_MAX_SLICES = 60;

/**
 * One-day slices of last_seen_at older than the cutoff, newest first, so each aggregate query reads a bounded range of idx_inv_stock_seen.
 * `oldestDays` = DATEDIFF(NOW(), MIN(last_seen_at)) over in-stock rows. Slice k covers (k+1 days ago, k days ago]; the last one has no lower bound.
 * @returns {Array<{ upperDays: number, lowerDays: number|null }>}
 */
export function staleSlices(cutoffDays, oldestDays) {
  const last = Math.min(Math.max(Number(oldestDays) || 0, cutoffDays), cutoffDays + STALE_MAX_SLICES - 1);
  const out = [];
  for (let k = cutoffDays; k <= last; k++) out.push({ upperDays: k, lowerDays: k === last ? null : k + 1 });
  return out;
}
