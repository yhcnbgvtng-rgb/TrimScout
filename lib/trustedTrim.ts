/**
 * A trim we can show a buyer. NHTSA's vPIC leaves Trim blank on most
 * Toyotas and fills Series with an engineering platform code instead
 * ("64 Series", "Wagon Body Style") — that is not a trim, and printing it
 * gave "2026 Toyota RAV4 64 Series" on the RFQ vehicle card. Anything that
 * reads like such a code is dropped, so the title falls back to
 * "year make model" with no suffix.
 */
const PLATFORM_CODE = [
  /^\d+\s*series$/i, // "64 Series" (a bare number; BMW "3 Series" is a model, never a trim)
  /^series\s*\d+$/i,
  /\bbody\s*style$/i, // "Wagon Body Style"
];

export function trustedTrim(trim: string | null | undefined): string {
  const t = (trim || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return PLATFORM_CODE.some((re) => re.test(t)) ? "" : t;
}
