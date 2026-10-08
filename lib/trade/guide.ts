/**
 * Optional sanity check on a dealer's trade allowance against a value guide. Runs ONLY when a guide endpoint is
 * explicitly configured (TRADE_GUIDE_API_URL); otherwise it is skipped and nothing is called, so a paid
 * provider can never be hit by default.
 */
import { serverSecret } from "../serverSecret";

export const OUTLIER_SHARE = 0.5;

/** True when `allowance` is more than 50% above or below the guide value. */
export function isOutlier(allowance: number, guide: number | null | undefined): boolean {
  if (!(guide && guide > 0) || !(allowance > 0)) return false;
  return Math.abs(allowance - guide) / guide > OUTLIER_SHARE;
}

export async function guideValue(input: { vin: string; mileage: number; zip: string }, fetcher: typeof fetch = fetch): Promise<number | null> {
  const base = serverSecret("TRADE_GUIDE_API_URL");
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("vin", input.vin); url.searchParams.set("mileage", String(input.mileage)); url.searchParams.set("zip", input.zip);
    const key = serverSecret("TRADE_GUIDE_API_KEY");
    const res = await fetcher(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: unknown };
    const v = Number(json?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null; // a guide outage never blocks a dealer
  }
}
