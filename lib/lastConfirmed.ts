/**
 * How old a buyer-search car's last sighting may be, from `last_seen_at` (the last night a crawl actually saw it listed).
 * Buyers never see the date or a badge; it only works quietly behind the page:
 *   over 3 days  -> not eligible for a quote request (RFQ_MAX_AGE_DAYS)
 *   over 7 days  -> hidden from buyer search, its count and the facets (STALE_HIDE_DAYS; the box filters on `seenWithinDays`)
 * Admin views and a car's direct page still show a hidden car. The admin Vehicles tab shows the date and time.
 * Ages are elapsed time.
 */

/** A car last seen more than this many days ago is hidden from buyer search. The one place the number lives: the web query sends it to the box as `seenWithinDays`, and the box's catalog rebuild default (STALE_HIDE_DAYS in deals_api_server.js) is pinned to it by lastConfirmed.test.ts. */
export const STALE_HIDE_DAYS = 7;
/** The tighter hide line used when the last-seen staleness rule is on (STALE_RULE=1, server-side env; see scrapers/lightsail-crawler/src/staleRule.js). */
export const STALE_RULE_HIDE_DAYS = 4;
/** How many days back buyer search reaches: 7 (STALE_HIDE_DAYS) while the rule is off, STALE_RULE_HIDE_DAYS once STALE_RULE=1. Server-side only. */
export function buyerHideDays(env: Record<string, string | undefined> = process.env): number {
  if (env.STALE_RULE !== "1") return STALE_HIDE_DAYS;
  const n = Number(env.STALE_RULE_HIDE_DAYS);
  return Number.isInteger(n) && n >= 2 && n <= 30 ? n : STALE_RULE_HIDE_DAYS;
}
/** A car last seen more than this many days ago cannot be picked for a quote request (it may already be sold). */
export const RFQ_MAX_AGE_DAYS = 3;

const DAY_MS = 86_400_000;

const ageMs = (lastSeenAt: string | null | undefined, now: number): number | null => {
  if (!lastSeenAt) return null;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) ? now - t : null;
};

/** True when the car was last seen more than STALE_HIDE_DAYS ago — buyer search leaves it out. A missing/unusable date is never hidden. */
export function isHiddenFromBuyerSearch(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  const age = ageMs(lastSeenAt, now);
  return age !== null && age > buyerHideDays() * DAY_MS;
}

/** True when the car may be picked for an RFQ: seen within RFQ_MAX_AGE_DAYS. A missing/unusable date is allowed (nothing to judge by). */
export function isRfqEligible(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  const age = ageMs(lastSeenAt, now);
  return age === null || age <= RFQ_MAX_AGE_DAYS * DAY_MS;
}
