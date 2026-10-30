#!/usr/bin/env node
/**
 * Dealer Analytics nightly job (box2). See docs/DEALER_ANALYTICS_NIGHTLY.md.
 *
 *   node dealer-analytics-nightly.mjs [--dry-run] [--create-tables] [--day=YYYY-MM-DD] [--steps=changes,market,summary]
 *
 *   (no flags)       real run. Only starts after box2's nightly sync finished, with no crawl running, between 06:00 and 18:00 ET;
 *                    takes the shared sync lock; stops at 21:30 ET. Finished days are skipped, so cron can fire it hourly.
 *   --dry-run        read-only (reader DB user + a statement guard): derives and counts everything, writes nothing, no lock.
 *   --create-tables  only runs the CREATE TABLE IF NOT EXISTS statements (writer user) and exits.
 *
 * Exit codes: 0 ok / already done, 2 not ready (nothing written), 4 stopped at the deadline or because a crawl started, 1 any error.
 * Any error stops the run: later steps are skipped, the lock is released, the run row is marked failed.
 */
import { DDL, DEFAULTS, excludedSet, parseExcludedEnv } from "./dealerAnalyticsCore.js";
import { StopError, runNightly } from "./dealerAnalyticsRun.js";
import { exitCodeFor, log, makeDeps, makePool } from "./dealerAnalyticsBox.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const dryRun = Boolean(args["dry-run"]);
const excluded = excludedSet(parseExcludedEnv(process.env.DEALER_ANALYTICS_EXCLUDE));
const cfg = {
  ...DEFAULTS,
  lockWaitMs: Number(process.env.DEALER_ANALYTICS_LOCK_WAIT_MS) || DEFAULTS.lockWaitMs,
  throttleMs: process.env.DEALER_ANALYTICS_THROTTLE_MS != null ? Number(process.env.DEALER_ANALYTICS_THROTTLE_MS) : DEFAULTS.throttleMs,
};

const db = await makePool({ readOnly: dryRun });
let code = 1;
try {
  if (args["create-tables"]) {
    for (const ddl of DDL) await db.q(ddl);
    log(`[dealer-analytics] created (if missing): ${DDL.length} tables`);
    code = 0;
  } else {
    log(`[dealer-analytics] start${dryRun ? " (dry run)" : ""}; excluded dealer ids: ${[...excluded].join(",")}`);
    const steps = args.steps ? String(args.steps).split(",") : undefined;
    const result = await runNightly({ deps: makeDeps({ q: db.q }), cfg, excluded, dryRun, day: args.day || null, steps });
    log(`[dealer-analytics] ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
    code = exitCodeFor(result);
  }
} catch (err) {
  if (err instanceof StopError) { log(`[dealer-analytics] STOPPED (${err.code}): ${err.message}`); code = 4; }
  else { log(`[dealer-analytics] ERROR: ${err.stack || err.message}`); code = 1; }
} finally {
  await db.close().catch(() => {});
}
process.exit(code);
