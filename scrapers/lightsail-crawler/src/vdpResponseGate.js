// Decides whether a fetched vehicle detail page (VDP) may produce a vehicle at all.
//
// Confirmed 2026-10-10 (Audi, box2 logs 2026-10-07..09): Audi's retailer platform answers some VDP requests with HTTP 503 and
// its "Site currently not available" maintenance page, a different set of VINs each night (487, 74, 309 VINs; only 5 failed
// two nights running). extractOne only stopped on WAF classes (Cloudflare/Vercel/403/429), so a 5xx/404 page fell through every
// strategy to the last-resort one, which takes the VIN straight from the URL and leaves year, model, trim and price null. That
// stub was written as an ACTIVE row, so new Audi cars showed up with a blank model (53 in three nights, 440 in stock).
// An error page has no vehicle on it; skipping it writes nothing, and the car is picked up on the next night's crawl.
import { BOT_CLASSES } from './bot_protection.js';

/** null when the page may be parsed; otherwise a short reason (used in the crawl log). */
export function vdpSkipReason(pageClass) {
  if (!pageClass || pageClass.classification === BOT_CLASSES.NONE) return null;
  return pageClass.notes || `${pageClass.classification}${pageClass.httpStatus ? ` (${pageClass.httpStatus})` : ''}`;
}
