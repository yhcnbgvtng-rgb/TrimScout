/**
 * Pure, isomorphic helpers for the "typical OTD" market-context band —
 * safe to import from both server code (lib/dealsApi.ts) and client
 * components (components/BiddingWizard.tsx), same split as
 * lib/dealerResponsiveness.ts.
 */

export interface TypicalOtdStats {
  make: string;
  model: string;
  sampleSize: number;
  /** null when sampleSize is too small to say anything honest — never a fabricated default. */
  avgDiscountPercent: number | null;
}

/** Below this many real quotes, showing a number would look more precise than it is. */
export const TYPICAL_OTD_MIN_SAMPLE_SIZE = 3;

// Shown as informational context only — never a bid floor the buyer must
// beat. Real, computed from actual dealer bid history; degrades to an
// honest "not enough data yet" rather than guessing at a plausible-sounding
// industry number.
export function formatTypicalOtdLabel(stats: TypicalOtdStats | null): string | null {
  if (!stats) return null;
  if (stats.sampleSize < TYPICAL_OTD_MIN_SAMPLE_SIZE || stats.avgDiscountPercent === null) {
    return "Not enough quote history yet for this model";
  }
  const pct = Math.round(stats.avgDiscountPercent * 10) / 10;
  return `Typical OTD for this model: ${pct}% off MSRP (based on ${stats.sampleSize} recent quotes)`;
}
