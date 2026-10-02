#!/usr/bin/env node
/**
 * Is the shared inventory-sync lock free? One of the two checks the sync-speed deploy gate is built on
 * (scrapers/lightsail-crawler/docs/INVENTORY_SYNC_SPEED.md): take the lock with a throwaway owner and hand it
 * straight back. Run it twice, a couple of minutes apart, before touching anything.
 *
 *   exit 0  FREE — acquired and released
 *   exit 1  HELD — a sync is running (prints by whom and for how long); nothing was changed
 *   exit 2  could not tell (deals API unreachable, bad key, ...); nothing was changed unless it says otherwise
 *
 * The throwaway owner asks for heartbeat handling and never sends one, so even if the release call were lost
 * the server would reclaim the lock after its 10-minute heartbeat-silence rule instead of the 3-hour rule
 * that applies to clients that never heartbeat. The release is retried; if it still fails this prints the
 * owner loudly so it can be released by hand.
 *
 * Needs the same environment as inventory-sync.mjs (source ~/inventory-sync/.env): TRIMSCOUT_API_KEY, and
 * TRIMSCOUT_DEALS_HOST / TRIMSCOUT_DEALS_PORT (defaults: box2's deals API).
 */
import { createApi, withRetry } from "./syncHttp.js";

const host = process.env.TRIMSCOUT_DEALS_HOST || "52.202.234.65";
const port = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const key = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
if (!key) {
  console.error("TRIMSCOUT_API_KEY is not set (source ~/inventory-sync/.env first)");
  process.exit(2);
}
const api = createApi({ host, key, timeouts: { lock: 10_000 } });
const owner = `lock-probe-${process.pid}`;

let acquired;
try {
  acquired = await api(port, "/api/ops/sync-lock/acquire", { owner, heartbeat: true });
} catch (err) {
  console.error(`could not tell: ${err.message}`);
  process.exit(2);
}
if (!acquired || !acquired.acquired) {
  console.log(`HELD by ${acquired && acquired.heldBy} for ${Math.round(((acquired && acquired.heldSinceMs) || 0) / 1000)}s`);
  process.exit(1);
}
try {
  await withRetry(() => api(port, "/api/ops/sync-lock/release", { owner }), { retries: 3, delayMs: 1000 });
} catch (err) {
  console.error(`ERROR: the probe took the lock as "${owner}" but could not release it (${err.message}). The server reclaims it after 10 minutes of heartbeat silence; to release it now: POST /api/ops/sync-lock/release {"owner":"${owner}"}`);
  process.exit(2);
}
console.log("FREE");
