import { serverSecret } from "./serverSecret";

export type ListingsProvider = "auto.dev" | "marketcheck" | "demo";

export interface ResolvedListingsProvider {
  provider: ListingsProvider;
  key: string | null;
}

/**
 * Normalize LISTINGS_PROVIDER. Accepts marketcheck, auto.dev / autodev / auto_dev.
 * Unknown values are ignored so a typo cannot silently disable listings.
 */
export function normalizeListingsProviderName(raw: string): ListingsProvider | null {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "marketcheck") return "marketcheck";
  if (v === "auto.dev" || v === "auto_dev" || v === "autodev" || v === "auto") return "auto.dev";
  return null;
}

/**
 * Choose the coarse listings provider from configuration.
 *
 * Preference: LISTINGS_PROVIDER override (if that key is present) →
 * MarketCheck if MARKETCHECK_API_KEY is set → Auto.dev if AUTO_DEV_API_KEY
 * is set → demo (no key). Both keys set without an override → MarketCheck.
 */
export function resolveListingsProvider(): ResolvedListingsProvider {
  const override = normalizeListingsProviderName(serverSecret("LISTINGS_PROVIDER"));
  const marketcheck = serverSecret("MARKETCHECK_API_KEY");
  const autoDev = serverSecret("AUTO_DEV_API_KEY");

  if (override === "marketcheck" && marketcheck) {
    return { provider: "marketcheck", key: marketcheck };
  }
  if (override === "auto.dev" && autoDev) {
    return { provider: "auto.dev", key: autoDev };
  }
  if (marketcheck) return { provider: "marketcheck", key: marketcheck };
  if (autoDev) return { provider: "auto.dev", key: autoDev };
  return { provider: "demo", key: null };
}

/** True iff a listings API key is configured. Never returns key material. */
export function hasListingsApiKey(): boolean {
  return Boolean(serverSecret("MARKETCHECK_API_KEY") || serverSecret("AUTO_DEV_API_KEY"));
}
