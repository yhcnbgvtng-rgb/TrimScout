// Thin network glue for the nightly crawler's opt-in "lite" mode: asks the deals box which of
// this run's VINs already have real stored factory options, so enricher.js can decide (via
// liteCrawlOptionsGuard.js) which ones to leave alone. This is a NEW dependency the crawl box
// didn't have before — previously it only talked to NHTSA and the deals-api DB connection used for
// run tracking, never deals-api's own HTTP server during a crawl. Fails OPEN on any error (network,
// auth, deals-api down, bad response) by returning an empty Set: a lookup failure must never stop
// or degrade the crawl itself, only fall back to this mode's pre-existing full-extraction behavior
// for every VIN, as if the mode were off for that batch.
import { gotScraping } from "got-scraping";

const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || "52.202.234.65";
const DEALS_PORT = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
// Matches the deals box's own batch cap on this endpoint (see handleInventoryOptionsStatus in
// deals_api_server.js) — kept in both places rather than shared, since one is a crawl-box process
// and the other a deals-box process with no code sharing between them at deploy time.
const BATCH_SIZE = 2000;

export async function lookupKnownGoodOptionVins(vins) {
  const known = new Set();
  if (!vins.length || !KEY) return known;
  for (let i = 0; i < vins.length; i += BATCH_SIZE) {
    const batch = vins.slice(i, i + BATCH_SIZE);
    try {
      const res = await gotScraping({
        url: `http://${DEALS_HOST}:${DEALS_PORT}/api/inventory/options-status`,
        method: "POST",
        json: { vins: batch },
        headers: { "X-Trimscout-Api-Key": KEY },
        timeout: { request: 15000 },
        retry: { limit: 1 },
      });
      const body = JSON.parse(res.body);
      for (const [vin, hasOptions] of Object.entries(body.status || {})) if (hasOptions) known.add(vin);
    } catch (err) {
      console.error(`[lite-mode] options-status lookup failed for a batch of ${batch.length} VINs — treating all as unknown (full extraction proceeds): ${err.message}`);
    }
  }
  return known;
}
