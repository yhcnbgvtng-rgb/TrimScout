import { serverSecret } from "./serverSecret";

// Auto.dev support was removed (2026-09-02) — the key that used to back it
// leaked (hardcoded in client-bundled code) and the decision after
// rotating/revoking it was to drop the provider rather than reconfigure it.
export type ListingsProvider = "marketcheck" | "demo";

export interface ResolvedListingsProvider {
  provider: ListingsProvider;
  key: string | null;
}

/**
 * Normalize LISTINGS_PROVIDER. Accepts marketcheck only.
 * Unknown values are ignored so a typo cannot silently disable listings.
 */
export function normalizeListingsProviderName(raw: string): ListingsProvider | null {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "marketcheck") return "marketcheck";
  return null;
}

/**
 * Choose the coarse listings provider from configuration.
 *
 * Preference: LISTINGS_PROVIDER override (if that key is present) →
 * MarketCheck if MARKETCHECK_API_KEY is set → demo (no key).
 */
export function resolveListingsProvider(): ResolvedListingsProvider {
  const override = normalizeListingsProviderName(serverSecret("LISTINGS_PROVIDER"));
  const marketcheck = serverSecret("MARKETCHECK_API_KEY");

  if (override === "marketcheck" && marketcheck) {
    return { provider: "marketcheck", key: marketcheck };
  }
  if (marketcheck) return { provider: "marketcheck", key: marketcheck };
  return { provider: "demo", key: null };
}

/** True iff a listings API key is configured. Never returns key material. */
export function hasListingsApiKey(): boolean {
  return Boolean(serverSecret("MARKETCHECK_API_KEY"));
}
