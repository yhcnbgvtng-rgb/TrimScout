#!/usr/bin/env node
/**
 * Dealer Analytics price-change backfill (box2). DRY RUN BY DEFAULT: nothing is written without --apply.
 *
 *   node dealer-analytics-backfill.mjs [--apply] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--limit-vins=N] [--state=FILE] [--restart]
 *
 * Walks every VIN in dealer_inventory in key order and derives each price change from the full dealer_inventory_days history
 * (about 33 days today), so the first run of the page already has a month of drops. Same guards as the nightly job (start window,
 * sync finished, no crawl, shared sync lock when applying, stop at 21:30 ET). Progress is saved in --state (default
 * ~/dealer-analytics/backfill-state.json), so a run paused at the deadline continues from the same VIN next time; --restart starts over.
 * Safe to rerun: rows are INSERT IGNORE on the table's primary key.
 *
 * Exit codes: 0 finished or paused at the stop time, 2 not ready, 4 stopped (lock lost / crawl started), 1 error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULTS, assertYmd, excludedSet, parseExcludedEnv } from "./dealerAnalyticsCore.js";
import { StopError, runBackfill } from "./dealerAnalyticsRun.js";
import { exitCodeFor, log, makeDeps, makePool } from "./dealerAnalyticsBox.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const apply = Boolean(args.apply);
const statePath = args.state || path.join(os.homedir(), "dealer-analytics", "backfill-state.json");
const excluded = excludedSet(parseExcludedEnv(process.env.DEALER_ANALYTICS_EXCLUDE));
const cfg = { ...DEFAULTS, lockWaitMs: Number(process.env.DEALER_ANALYTICS_LOCK_WAIT_MS) || DEFAULTS.lockWaitMs };

let state = { lastVin: "", vinsDone: 0 };
if (!args.restart && fs.existsSync(statePath)) state = { ...state, ...JSON.parse(fs.readFileSync(statePath, "utf8")) };
// A dry run never touches the state file: it always starts from the beginning (or --limit-vins).
if (!apply) state = { lastVin: "", vinsDone: 0 };
const saveState = async (s) => { if (apply) { fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify({ lastVin: s.lastVin, vinsDone: s.vinsDone, events: s.events, savedAt: new Date().toISOString() })); } };

const db = await makePool({ readOnly: !apply });
let code = 1;
try {
  log(`[dealer-analytics] backfill ${apply ? "APPLY" : "dry run"}; resume after VIN "${state.lastVin}" (${state.vinsDone} done); excluded: ${[...excluded].join(",")}`);
  const result = await runBackfill({
    deps: makeDeps({ q: db.q }), cfg, excluded, apply, state, saveState,
    from: args.from ? assertYmd(args.from) : null, to: args.to ? assertYmd(args.to) : null,
    limitVins: args["limit-vins"] ? Number(args["limit-vins"]) : null,
  });
  log(`[dealer-analytics] backfill ${result.status}${result.reason ? `: ${result.reason}` : ""}${result.paused ? " (paused at the stop time)" : ""}`);
  code = exitCodeFor(result);
} catch (err) {
  if (err instanceof StopError) { log(`[dealer-analytics] STOPPED (${err.code}): ${err.message}`); code = 4; }
  else { log(`[dealer-analytics] ERROR: ${err.stack || err.message}`); code = 1; }
} finally {
  await db.close().catch(() => {});
}
process.exit(code);
