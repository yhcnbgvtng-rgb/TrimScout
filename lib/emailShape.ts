/** Pure email-shape check, in its own module so quotePackage and dealerContactLookup can share it without importing each other. */

/** A buyer-supplied sales-adviser address, before it's allowed anywhere near a send. */
export function isPlausibleDealerEmail(value: string): boolean {
  const clean = (value || "").trim();
  if (clean.length < 6 || clean.length > 254) return false;
  if (/\s/.test(clean)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(clean);
}
