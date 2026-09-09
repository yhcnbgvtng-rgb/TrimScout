/**
 * Soft-friction check on a buyer's own target OTD price (wizard Step 3,
 * "I'll Set My Price"). Never blocks submission — an absurdly aggressive
 * target just trains dealers to ignore the request, so this only warns.
 */

/** Above this much off MSRP, the target reads as unrealistic rather than merely aggressive. */
export const UNREALISTIC_DISCOUNT_PERCENT = 25;

export function discountPercentOffMsrp(msrp: number, targetOtdPrice: number): number | null {
  if (!(msrp > 0) || !(targetOtdPrice > 0)) return null;
  return ((msrp - targetOtdPrice) / msrp) * 100;
}

/** null when the target is within a sane band (or the inputs are missing) — nothing to warn about. */
export function discountRealismWarning(msrp: number, targetOtdPrice: number): string | null {
  const pct = discountPercentOffMsrp(msrp, targetOtdPrice);
  if (pct === null || pct <= UNREALISTIC_DISCOUNT_PERCENT) return null;
  return `That's ${Math.round(pct)}% off MSRP — most dealers won't quote that aggressively. You can still submit.`;
}
