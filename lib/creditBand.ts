/**
 * The buyer's self-estimated credit band — a lock on finance and lease
 * requests so every dealer quotes the same tier. Never a pull; the buyer
 * picks it, and it's required before send so the sheets compare apples
 * to apples.
 */
export type CreditBand = "excellent" | "good" | "fair" | "rebuilding";
export const CREDIT_BANDS: readonly CreditBand[] = ["excellent", "good", "fair", "rebuilding"];
export const CREDIT_BAND_LABELS: Record<CreditBand, string> = {
  excellent: "Excellent (750+)",
  good: "Good (700–749)",
  fair: "Fair (650–699)",
  rebuilding: "Rebuilding (under 650)",
};
/** Shown wherever the buyer picks a band. */
export const CREDIT_BAND_COPY = "No credit pull — this is your own estimate so dealers quote the same band.";

export function parseCreditBand(v: unknown): CreditBand | null {
  return (CREDIT_BANDS as readonly unknown[]).includes(v) ? (v as CreditBand) : null;
}
