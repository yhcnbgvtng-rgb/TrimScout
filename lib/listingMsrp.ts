// A used listing whose MSRP is exactly its asking price (e.g. Fette Ford's 2021 F-150 Raptor at $64,500) carries no real sticker MSRP: the feed repeated the
// price into the MSRP field. Display only: show no MSRP and no "% off" for it. The data is left as crawled (the root cause is in the crawler's extraction).
export function distinctMsrp(msrp: number | null | undefined, price: number | null | undefined): number | null {
  if (typeof msrp !== "number" || !Number.isFinite(msrp) || msrp <= 0) return null;
  if (typeof price === "number" && Number.isFinite(price) && Math.abs(msrp - price) < 0.5) return null;
  return msrp;
}
