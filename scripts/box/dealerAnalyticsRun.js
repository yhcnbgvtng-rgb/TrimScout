// Dealer Analytics job orchestration: the guards (run window, sync finished, crawl gate, sync lock) and the steps.
// All I/O comes in through `deps` so the ordering and the stop-on-error behaviour are unit-tested without a box.
//
// deps = {
//   q(sql, params) -> rows        read/write SQL (dry runs get a read-only wrapper, see readOnlyQuery)
//   dbNow() -> 'YYYY-MM-DD HH:MM:SS'   the DB's own clock
//   now() -> Date,  sleep(ms),  log(msg)
//   syncStatus() -> {finished, finishedAt?, detail}      box2's own nightly sync
//   checkCrawlGate() -> '' when no crawl is running, else the reason
//   lockApi(path, body) -> json    POST /api/ops/sync-lock/* on the deals API
//   owner                           lock owner string
//   startHeartbeat?                 defaults to startSyncLockHeartbeat
// }
import { startSyncLockHeartbeat } from "./syncLockHeartbeat.js";
import { waitForSyncLock } from "./syncLockWait.js";
import {
  CANDIDATES_SQL, DAYS_FOR_VINS_SQL, DDL, DEFAULTS, INSERT_CHANGES_SQL, MARKET_MAKES_SQL, NEXT_VINS_SQL, UPSERT_MARKET_SQL,
  addDays, assertYmd, canStartNow, chunk, dealerRanges, deriveEvents, dropsSql, isWriteSql, marketRows, marketSql, pastStop,
  sqlDateTime, summaryRow, summarySql, upsertSummarySql, utcDay,
} from "./dealerAnalyticsCore.js";

export class StopError extends Error {
  /** code: 'deadline' | 'lock-lost' | 'crawl-active' */
  constructor(code, message) {
    super(message || code);
    this.name = "StopError";
    this.code = code;
  }
}

/** Dry-run wrapper: any statement that is not a read throws before it reaches the database. */
export function readOnlyQuery(q) {
  return async (sql, params) => {
    if (isWriteSql(sql)) throw new Error(`dry run: refusing to run a write statement: ${sql.slice(0, 60)}`);
    return q(sql, params);
  };
}

const notReady = (reason) => ({ status: "not-ready", reason });

/**
 * Runs `work(ctx)` only when it is safe: inside the start window, after box2's nightly sync finished, with no crawl running,
 * holding the shared sync lock (heartbeat renewed). ctx.checkpoint() must be called between batches; it throws StopError when the
 * lock was lost, the 21:30 ET stop time passed, or a crawl started. The lock is always released.
 */
export async function runGuarded({ deps, cfg = DEFAULTS, dryRun = false, work, skipIfDone = true, log = deps.log }) {
  const now = deps.now();
  if (!canStartNow(now, cfg)) return notReady(`outside the start window (${cfg.startAfter}-${cfg.startBefore} ET)`);
  const sync = await deps.syncStatus();
  if (!sync.finished) return notReady(`nightly sync not finished: ${sync.detail}`);
  const gate = await deps.checkCrawlGate();
  if (gate) return notReady(`crawl active: ${gate}`);
  if (skipIfDone && deps.alreadyDone && (await deps.alreadyDone(sync.finishedAt))) return { status: "already-done" };

  let heartbeat = null;
  let held = false;
  if (!dryRun) {
    try {
      await waitForSyncLock({
        tryAcquire: () => deps.lockApi("/api/ops/sync-lock/acquire", { owner: deps.owner, heartbeat: true }),
        sleep: deps.sleep,
        now: () => deps.now().getTime(),
        pollMs: cfg.lockPollMs ?? 30_000,
        maxWaitMs: cfg.lockWaitMs,
        onPoll: ({ heldBy, waitedMs }) => log(`[dealer-analytics] sync lock held by ${heldBy}; waited ${Math.round(waitedMs / 1000)}s`),
      });
    } catch (err) {
      return notReady(`lock-timeout: ${err.message}`);
    }
    held = true;
    heartbeat = (deps.startHeartbeat || startSyncLockHeartbeat)({
      heartbeat: () => deps.lockApi("/api/ops/sync-lock/heartbeat", { owner: deps.owner }),
      reacquire: () => deps.lockApi("/api/ops/sync-lock/acquire", { owner: deps.owner, heartbeat: true }),
      log,
      intervalMs: cfg.heartbeatMs ?? 30_000,
    });
  }
  let beats = 0;
  const ctx = {
    syncFinishedAt: sync.finishedAt,
    async checkpoint() {
      if (heartbeat && heartbeat.isLost()) throw new StopError("lock-lost", "sync lock was lost");
      if (pastStop(deps.now(), cfg)) throw new StopError("deadline", `reached ${cfg.stopAt} ET`);
      beats += 1;
      if (beats % cfg.gateCheckEvery === 0) {
        const g = await deps.checkCrawlGate();
        if (g) throw new StopError("crawl-active", g);
      }
      if (cfg.throttleMs) await deps.sleep(cfg.throttleMs);
    },
  };
  try {
    return { status: "ok", ...(await work(ctx)) };
  } finally {
    if (heartbeat) heartbeat.stop();
    if (held) {
      try { await deps.lockApi("/api/ops/sync-lock/release", { owner: deps.owner }); } catch (err) { log(`[dealer-analytics] could not release the sync lock (${err.message}); the server reclaims it after 10 min of heartbeat silence`); }
    }
  }
}

// ---- step 1: price changes ----------------------------------------------------------------------------------------------
async function fetchDays(q, vins, sinceDate) {
  return q(DAYS_FOR_VINS_SQL, [vins, sinceDate]);
}
async function writeEvents(q, events, cfg, stats) {
  for (const part of chunk(events, cfg.insertBatch)) {
    const res = await q(INSERT_CHANGES_SQL, [part]);
    stats.inserted += Number(res?.affectedRows ?? 0);
  }
}
function tally(events, stats) {
  stats.events += events.length;
  for (const e of events) {
    if (e[5] < e[4]) stats.drops += 1; else stats.increases += 1;
    stats.byDay[e[1]] = (stats.byDay[e[1]] || 0) + 1;
  }
}
const newStats = () => ({ events: 0, inserted: 0, drops: 0, increases: 0, candidates: 0, byDay: {} });

/** Nightly: VINs the sync touched in the last `windowDays` UTC days -> their days rows -> changes inside the window. */
export async function derivePriceChanges({ q, ctx, cfg, excluded, day, dryRun, log, sinceOverride = null }) {
  const fromDate = sinceOverride || addDays(day, -(cfg.windowDays - 1));
  const lookbackFrom = addDays(fromDate, -cfg.lookbackDays);
  // last_seen_at is a DATETIME in the DB's local zone; start a day early so zone skew can only add candidates, never drop them.
  const start = new Date(`${addDays(fromDate, -1)}T00:00:00Z`);
  const end = new Date(ctx.nowMs + 3600_000);
  const stats = newStats();
  const seen = new Set();
  for (let t = start.getTime(); t < end.getTime(); t += 6 * 3600_000) {
    const rows = await q(CANDIDATES_SQL, [sqlDateTime(new Date(t)), sqlDateTime(new Date(Math.min(t + 6 * 3600_000, end.getTime())))]);
    const vins = [];
    for (const r of rows) if (!excluded.has(Number(r.dealer_id)) && !seen.has(r.vin)) { seen.add(r.vin); vins.push(r.vin); }
    stats.candidates += vins.length;
    for (const batch of chunk(vins, cfg.vinBatch)) {
      await ctx.checkpoint();
      const events = deriveEvents(await fetchDays(q, batch, lookbackFrom), { fromDate, toDate: day, excluded });
      tally(events, stats);
      if (!dryRun && events.length) await writeEvents(q, events, cfg, stats);
    }
  }
  log(`[dealer-analytics] price changes ${dryRun ? "(dry run) " : ""}${fromDate}..${day}: ${stats.candidates} VINs checked, ${stats.events} changes (${stats.drops} drops, ${stats.increases} increases)${dryRun ? "" : `, ${stats.inserted} new rows`}`);
  return stats;
}

// ---- step 2: market averages ----------------------------------------------------------------------------------------------
export async function buildMarket({ q, ctx, excluded, day, dryRun, log, computedAt }) {
  const makes = (await q(MARKET_MAKES_SQL)).map((r) => r.make).sort();
  let rows = 0;
  for (const make of makes) {
    await ctx.checkpoint();
    const out = marketRows(day, make, await q(marketSql(excluded), [make]), computedAt);
    rows += out.length;
    if (!dryRun && out.length) await q(UPSERT_MARKET_SQL, [out]);
  }
  log(`[dealer-analytics] market averages ${dryRun ? "(dry run) " : ""}${day}: ${makes.length} makes, ${rows} make/model/year/cond rows`);
  return { makes: makes.length, rows };
}

// ---- step 3: per-dealer daily summary (last: reads the change events) -------------------------------------------------------
export async function buildSummary({ q, ctx, cfg, excluded, day, dryRun, log, computedAt }) {
  const [{ m }] = await q("SELECT MAX(dealer_id) AS m FROM dealer_inventory");
  const maxId = Number(m || 0);
  const sSql = summarySql(day, excluded);
  const dSql = dropsSql(day);
  let dealers = 0;
  let warnedNoChanges = false;
  for (const [from, to] of dealerRanges(maxId, cfg.dealerChunk)) {
    await ctx.checkpoint();
    const sums = await q(sSql, [from, to]);
    if (!sums.length) continue;
    let dropRows = [];
    try {
      dropRows = await q(dSql, [from, to]);
    } catch (err) {
      // A dry run before the tables exist has no change history yet: drops read as 0 instead of stopping the run.
      if (!(dryRun && err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146))) throw err;
      if (!warnedNoChanges) { log("[dealer-analytics] dealer_price_changes does not exist yet: price-drop columns are 0 in this dry run"); warnedNoChanges = true; }
    }
    const drops = new Map(dropRows.map((r) => [Number(r.dealer_id), r]));
    const out = sums.map((s) => summaryRow(day, s, drops.get(Number(s.dealer_id)), computedAt));
    dealers += out.length;
    if (!dryRun) await q(upsertSummarySql(), [out]);
  }
  log(`[dealer-analytics] daily summary ${dryRun ? "(dry run) " : ""}${day}: ${dealers} dealers`);
  return { dealers };
}

// ---- nightly job ------------------------------------------------------------------------------------------------------------
export async function runNightly({ deps, cfg = DEFAULTS, excluded, dryRun = false, day = null, steps = ["changes", "market", "summary"] }) {
  const log = deps.log;
  const runDay = assertYmd(day || utcDay(deps.now()));
  const q0 = deps.q;
  const q = dryRun ? readOnlyQuery(q0) : q0;
  const runDeps = {
    ...deps,
    alreadyDone: dryRun ? null : async (finishedAt) => {
      try {
        const rows = await q0("SELECT COUNT(*) AS n FROM dealer_analytics_runs WHERE day = ? AND status = 'ok' AND finished_at >= FROM_UNIXTIME(?)", [runDay, Math.floor(finishedAt.getTime() / 1000)]);
        return Number(rows[0]?.n) > 0;
      } catch (err) {
        if (err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146)) return false;
        throw err;
      }
    },
  };
  return runGuarded({
    deps: runDeps, cfg, dryRun, log,
    work: async (ctx) => {
      ctx.nowMs = deps.now().getTime();
      const started = deps.dbNow ? await deps.dbNow() : null;
      if (!dryRun) {
        for (const ddl of DDL) await q0(ddl);
        // A 'running' row left by a crashed earlier run must not be mistaken for this one's.
        await q0("UPDATE dealer_analytics_runs SET status = 'failed', finished_at = NOW(), detail = 'superseded by a later run' WHERE day = ? AND status = 'running'", [runDay]);
        await q0("INSERT INTO dealer_analytics_runs (day, started_at, status) VALUES (?, NOW(), 'running')", [runDay]);
      }
      const computedAt = started || (await q0("SELECT NOW() AS n"))[0].n;
      const out = {};
      try {
        if (steps.includes("changes")) out.changes = await derivePriceChanges({ q, ctx, cfg, excluded, day: runDay, dryRun, log });
        if (steps.includes("market")) out.market = await buildMarket({ q, ctx, excluded, day: runDay, dryRun, log, computedAt });
        if (steps.includes("summary")) out.summary = await buildSummary({ q, ctx, cfg, excluded, day: runDay, dryRun, log, computedAt });
      } catch (err) {
        if (!dryRun) await q0("UPDATE dealer_analytics_runs SET status = 'failed', finished_at = NOW(), detail = ? WHERE day = ? AND status = 'running'", [String(err.message).slice(0, 500), runDay]).catch(() => {});
        throw err;
      }
      if (!dryRun) await q0("UPDATE dealer_analytics_runs SET status = 'ok', finished_at = NOW(), detail = ? WHERE day = ? AND status = 'running'", [JSON.stringify({ changes: out.changes?.events, market: out.market?.rows, dealers: out.summary?.dealers }), runDay]);
      return { day: runDay, ...out };
    },
  });
}

// ---- backfill ---------------------------------------------------------------------------------------------------------------
/**
 * One-off history backfill: walk every VIN in dealer_inventory in key order, derive every change from the full days history.
 * Dry run (the default) counts only. Resumable: `state` ({lastVin}) is saved through saveState after each batch, so a run that
 * stops at the 21:30 ET deadline pauses cleanly and the next night continues from there.
 */
export async function runBackfill({ deps, cfg = DEFAULTS, excluded, apply = false, from = null, to = null, limitVins = null, state = { lastVin: "", vinsDone: 0 }, saveState = async () => {} }) {
  const log = deps.log;
  const q = apply ? deps.q : readOnlyQuery(deps.q);
  const stats = newStats();
  const result = await runGuarded({
    deps, cfg, dryRun: !apply, skipIfDone: false, log,
    work: async (ctx) => {
      const toDate = to || utcDay(deps.now());
      if (apply) for (const ddl of DDL) await q(ddl);
      let paused = null;
      try {
        for (;;) {
          await ctx.checkpoint();
          const vins = (await q(NEXT_VINS_SQL, [state.lastVin, cfg.vinBatch])).map((r) => r.vin);
          if (!vins.length) break;
          const events = deriveEvents(await fetchDays(q, vins, "2000-01-01"), { fromDate: from, toDate, excluded });
          tally(events, stats);
          if (apply && events.length) await writeEvents(q, events, cfg, stats);
          state.lastVin = vins[vins.length - 1];
          state.vinsDone += vins.length;
          await saveState({ ...state, events: stats.events });
          if (limitVins && state.vinsDone >= limitVins) break;
        }
      } catch (err) {
        if (err instanceof StopError && err.code === "deadline") paused = err.message;
        else throw err;
      }
      log(`[dealer-analytics] backfill ${apply ? "APPLIED" : "(dry run)"}: ${state.vinsDone} VINs done, ${stats.events} changes (${stats.drops} drops, ${stats.increases} increases)${apply ? `, ${stats.inserted} new rows` : ""}${paused ? `; PAUSED at the stop time, resume from ${state.lastVin}` : ""}`);
      return { stats, paused: Boolean(paused), lastVin: state.lastVin, vinsDone: state.vinsDone };
    },
  });
  return result;
}
