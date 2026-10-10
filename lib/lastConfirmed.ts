/**
 * "Last confirmed <date>" for a buyer-search car the crawl has not seen for a while.
 *
 * Instead of hiding cars of stores the crawl could not read (the zero-scrape rule), the buyer sees every car and the ones last seen 48 hours
 * or more ago say when they were last confirmed on the dealer's site. `lastConfirmedAt` is the car's last_seen_at: the last night a crawl
 * actually saw it listed.
 */
export const LAST_CONFIRMED_AFTER_HOURS = 48;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Last confirmed Oct 7" (with the year when it is not the current one), or null when the car was confirmed within the last 48 hours / the date is unusable. */
export function lastConfirmedLabel(lastConfirmedAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!lastConfirmedAt) return null;
  const t = Date.parse(lastConfirmedAt);
  if (!Number.isFinite(t)) return null;
  if (now - t < LAST_CONFIRMED_AFTER_HOURS * 3600_000) return null;
  const d = new Date(t);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return `Last confirmed ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${sameYear ? "" : `, ${d.getUTCFullYear()}`}`;
}
