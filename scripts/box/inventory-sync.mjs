#!/usr/bin/env node
/**
 * Sync the nightly dealer-inventory crawl (data/inventory/<STATE>.json per-state shards on the crawl box)
 * into the deals box's dealer_inventory table, so the site's Vehicles sheet shows what the crawler pulled.
 *
 * Runs on each of the four crawl boxes after scripts/run-daily-crawl.mjs (via run_sync_when_safe.sh):
 *   TRIMSCOUT_API_KEY=… node inventory-sync.mjs /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/inventory
 *   ... [--dry-run]    read the shards + dealership directory, print the request/sweep plan, send nothing
 *   ... [--no-resume]  ignore saved progress and start over
 *
 * Was a single national_inventory_latest.json until the crawler's state-sharding fix (inventory_shards.js,
 * 2026-09) replaced that one nationwide file with one file per state — this reads a *directory* of those
 * shards instead of one file (a bare file path still works, for a one-off manual run against a single shard).
 * Each shard has the exact same top-level-array-of-vehicle-objects shape the old national file had, so
 * everything past file discovery (row building, store matching, upsert, sweep) is unchanged.
 *
 * Depends only on its siblings in this same directory (syncLockWait.js, syncLockHeartbeat.js, syncCheckpoint.js,
 * syncHttp.js, syncBatching.js, syncSweep.js, syncRun.js) — deploy ALL of them together to ~/inventory-sync/
 * on a box, never this file alone. scrapers/lightsail-crawler/docs/INVENTORY_SYNC_SPEED.md has the gated deploy checklist.
 *
 * Reads the JSON, resolves each vehicle's store to a directory row (dealer name + state),
 * upserts by (VIN, store) in chunks, then sweeps every store that had ACTIVE vehicles in the file so VINs the
 * crawler no longer lists are marked removed. Idempotent — re-running just refreshes last_seen. The write phase
 * (syncRun.js) saves its progress after every request: a run that dies partway — even in the sweep — is picked up
 * by running the same command again, without repeating finished upserts (see syncCheckpoint.js for why the
 * sweep cutoff is saved too). It never restarts itself.
 *
 * Four boxes now run this (box1/box2 via a waiter cron started 22:05/22:10 ET, box3/box4 as the last stage of
 * run_nightly_chain.sh) against the SAME deals-box database. Each run starts whenever ITS OWN box's crawl
 * finishes, not at a fixed clock time, so two runs can still land together on an unlucky night (this
 * happened for real 2026-09-23: two concurrent /api/inventory/bulk calls hit a MySQL "Deadlock found when
 * trying to get lock" error). Acquires a lock from the deals-api server itself
 * (POST /api/ops/sync-lock/acquire — see handleSyncLockAcquire in deals_api_server.js) before the write
 * phase, so a second box's run waits for the first to finish instead of colliding. A single, unclustered
 * PM2 process backs that server, so an in-memory lock there is enough — no DB table needed.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { waitForSyncLock } from "./syncLockWait.js";
import { startSyncLockHeartbeat } from "./syncLockHeartbeat.js";
import { computeFileIdentity } from "./syncCheckpoint.js";
import { createApi } from "./syncHttp.js";
import { planBatches } from "./syncBatching.js";
import { shardMileage } from "./shardMileage.js";
import { runWritePhase, configFromEnv } from "./syncRun.js";
import { SweepAbortError, LockLostError } from "./syncSweep.js";
import { isFreshRecord, freshnessConfig, checkShardStructure, shardPlan } from "./syncFreshness.js";
import { DEFAULT_DIR as RETIRED_DIR_DEFAULT, isRecentDrop, retiredList, writeRetiredFile, loadRecentRetired, cameBack, formatCameBack } from "./syncRetired.js";

// The box-resident default is box2's static IP (the deals API host); every box's inventory-sync/.env sets
// TRIMSCOUT_DEALS_HOST explicitly, so this only matters if that line is ever missing.
const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || "52.202.234.65";
const DEALS_PORT = process.env.TRIMSCOUT_DEALS_PORT || "3004";
const AUTH_PORT = process.env.TRIMSCOUT_AUTH_PORT || "3003";
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;
// Which crawl box this run came from, for the admin Vehicles sheet's "Box" column — set in each
// box's inventory-sync/.env (box1/box2/box3/box4). Falls back to the box's own hostname so a box
// that predates this label still tags its rows with *something* recognizable instead of nothing.
const BOX_LABEL = process.env.TRIMSCOUT_BOX_LABEL || os.hostname();
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const inputPath = argv.find((a) => !a.startsWith("--"));
const DRY_RUN = flags.has("--dry-run");
const NO_RESUME = flags.has("--no-resume");
// --dry-run --write-retired: also write this run's retired file (no lock, no writes to the deals box) — seeds ~/sweep-retired/.
const WRITE_RETIRED = flags.has("--write-retired");
const RETIRED_DIR = process.env.SWEEP_RETIRED_DIR || RETIRED_DIR_DEFAULT;
if (!inputPath || !KEY) {
  // --dry-run needs the key too: it still reads the dealership directory (a GET) to assign stores.
  console.error("usage: TRIMSCOUT_API_KEY=… node inventory-sync.mjs <data/inventory dir, or a single shard .json file> [--dry-run] [--no-resume]");
  process.exit(2);
}
const config = configFromEnv(process.env);
const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`${ts()} ${m}`);

// A bare file still works (manual/one-off use); the normal nightly case is a directory of per-state shards.
// Sorted for a deterministic, reproducible run order — matters for log-reading, not for correctness.
const isDir = fs.statSync(inputPath).isDirectory();
const files = isDir
  ? fs.readdirSync(inputPath).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(inputPath, f))
  : [inputPath];
if (files.length === 0) {
  console.error(`no .json shard files found in ${inputPath}`);
  process.exit(2);
}

// node:http with explicit per-call deadlines (syncHttp.js) instead of fetch(): fetch gives up on any response
// that takes more than 300s to start, which a loaded deals box can exceed on a bulk upsert or a sweep.
// Per-call deadlines can be overridden (ms) — SYNC_BULK_TIMEOUT_MS / SYNC_SWEEP_TIMEOUT_MS / SYNC_STATS_TIMEOUT_MS —
// but the defaults (20 min for bulk and sweep) are meant to be left alone.
const envMs = (name) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : undefined; };
const timeouts = Object.fromEntries(Object.entries({ bulk: envMs("SYNC_BULK_TIMEOUT_MS"), sweep: envMs("SYNC_SWEEP_TIMEOUT_MS"), stats: envMs("SYNC_STATS_TIMEOUT_MS") }).filter(([, v]) => v !== undefined));
const api = createApi({ host: DEALS_HOST, key: KEY, timeouts });
const dealsApi = (path, body, opts) => api(DEALS_PORT, path, body, opts);

// Identifies this run in the lock-holder message another box's wait loop prints — not used for anything
// else, so it doesn't need to be globally unique, just recognizable in a log.
const LOCK_OWNER = `${os.hostname()}-${path.basename(inputPath)}-${process.pid}`;
// Same 20h budget run_sync_when_safe.sh already gives the CRAWLER's own lock before it even starts
// a sync — "how long are we willing to wait tonight" is one number, not two. Previously this gave up
// after 3h and exited the process; a box's sync then just stayed dead, undetected, until someone
// noticed and relaunched it by hand (happened for real 2026-09-29). Waiting longer costs nothing —
// the lock is a plain one-writer-at-a-time serialization, not a sign of anything wrong — so this now
// only exits (non-zero) if the full 20h budget is actually exhausted.
async function acquireSyncLock({ pollMs = Number(process.env.SYNC_LOCK_POLL_MS) || 30_000, maxWaitMs = 20 * 60 * 60 * 1000 } = {}) {
  await waitForSyncLock({
    tryAcquire: () => api(DEALS_PORT, "/api/ops/sync-lock/acquire", { owner: LOCK_OWNER, heartbeat: true }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollMs,
    maxWaitMs,
    onPoll: ({ heldBy, heldSinceMs, waitedMs }) =>
      log(`[sync] another box's sync is running (${heldBy}, held ${Math.round(heldSinceMs / 1000)}s) — waited ${Math.round(waitedMs / 1000)}s so far, still polling...`),
  });
}
// Best-effort — a failed release just means the server's own staleness timeout clears it later; must
// never throw and mask whatever real error is already in flight.
let lockHeartbeat = null;
const releaseSyncLock = () => {
  if (lockHeartbeat) { lockHeartbeat.stop(); lockHeartbeat = null; }
  return api(DEALS_PORT, "/api/ops/sync-lock/release", { owner: LOCK_OWNER }).catch(() => {});
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Stream the JSON array object by object instead of parsing the whole file: each record carries NHTSA,
// options and price-history blobs, so 150k of them parsed at once is hundreds of MB on a small box.
// Only the compact mapped row is kept per vehicle.
function* streamTopLevelObjects(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(1 << 20);
  // A multi-byte character can straddle a 1 MiB read boundary; decoding each chunk on its own turned it into U+FFFD U+FFFD
  // (a corrupted dealer name / option string). A StringDecoder carries the partial character into the next chunk.
  const decoder = new StringDecoder("utf8");
  let depth = 0, inStr = false, esc = false, started = false, cur = "";
  for (;;) {
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (n <= 0) break;
    const chunk = decoder.write(buf.subarray(0, n));
    for (const ch of chunk) {
      if (!started) { if (ch === "[") started = true; continue; }
      if (depth === 0) { if (ch === "{") { depth = 1; cur = "{"; } continue; }
      cur += ch;
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { yield JSON.parse(cur); cur = ""; } }
    }
  }
  fs.closeSync(fd);
}

// Directory rows → (name|state) and (name) lookups, so each store gets its directory id (the sheet joins on it).
const dir = (await api(AUTH_PORT, "/api/dealerships")).dealerships || [];
const byNameState = new Map(), byName = new Map(), byDomain = new Map();
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
for (const d of dir) {
  const st = String(d.state || "").toUpperCase();
  byNameState.set(`${norm(d.dealerName)}|${st}`, d.id);
  if (!byName.has(norm(d.dealerName))) byName.set(norm(d.dealerName), d.id);
  // The crawl's dealer names are its own spellings; the listing URL's host is the reliable key.
  for (const dom of [...(d.domains || []), d.website ? hostOf(d.website) : ""]) { const k = String(dom || "").toLowerCase().replace(/^www\./, ""); if (k && !byDomain.has(k)) byDomain.set(k, d.id); }
}
const dealerIdFor = (v) => {
  const st = String(v.state || "").toUpperCase();
  const host = hostOf(v.url || "");
  const byHost = host && (byDomain.get(host) ?? byDomain.get(host.split(".").slice(-2).join(".")));
  if (byHost) return byHost;
  for (const name of [v.dealerName, v.configDealerName]) {
    if (!name) continue;
    const id = byNameState.get(`${norm(name)}|${st}`) ?? byName.get(norm(name));
    if (id) return id;
  }
  return null;
};
const cond = (t) => ({ NEW: "new", USED: "used", CERTIFIED: "cpo", CPO: "cpo", "CERTIFIED PRE-OWNED": "cpo", CERTIFIED_PRE_OWNED: "cpo", WHOLESALE: "wholesale" })[String(t || "").toUpperCase()] || null;
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
// Factory + dealer-listed options, compacted to what the sheet shows (code / name / price).
// dealerListedOptions carries two different shapes depending on the source platform:
// Dealer.com's structured packages/options each have a real, stable code (PKG-{id}/OPT-{id} —
// extractDealerListedOptions() in standalone.js); DealerOn's free-text feature mentions
// (parseFeaturesFromDescription()) have no per-item code at all and share the literal
// placeholder "FEATURE". Previously this always hardcoded code: null here, discarding a real
// Dealer.com code even when one existed — preserve it when present instead, so a downstream
// facet can actually tell "this exact coded package" apart from "any of these free-text mentions".
const options = (v) => {
  const out = [];
  for (const o of Array.isArray(v.factoryOptions) ? v.factoryOptions : []) if (o && (o.name || o.code)) out.push({ code: o.code || null, name: o.name || null, price: num(o.price), kind: "factory" });
  for (const o of Array.isArray(v.dealerListedOptions) ? v.dealerListedOptions : []) {
    const name = typeof o === "string" ? o : o && (o.name || o.title);
    if (!name) continue;
    const code = typeof o === "object" && o && o.code ? String(o.code).slice(0, 64) : null;
    out.push({ code, name, price: num(o && o.price), kind: "dealer" });
  }
  return out.length ? out.slice(0, 200) : null;
};

const rows = [];
let total = 0;
// What this run is allowed to claim about the crawl output (syncFreshness.js): only records the crawl refreshed recently
// are uploaded (an upload stamps last_seen_at = now, which is a lie for a stale shard record), a truncated shard is not
// read at all, and no store from an over-size shard is swept (retiring rows presumes the file is complete).
const fcfg = freshnessConfig();
const RUN_NOW_MS = Date.now();
const noSweepStores = new Set();       // dealer ids that came from an over-size shard
const skippedShards = [];              // { file, reason } — unreadable/truncated: nothing uploaded from them
let staleSkipped = 0, freshUploaded = 0;
const staleByStore = new Map();        // store name -> stale records skipped
const dropped = [];                    // records read but not uploaded (sold, or stale) — see syncRetired.js
let newestShardMs = 0;
for (const shardFile of files) {
  const shardStat = fs.statSync(shardFile);
  const sizeBytes = shardStat.size;
  newestShardMs = Math.max(newestShardMs, shardStat.mtimeMs);
  const plan = shardPlan({ sizeBytes, structure: checkShardStructure(shardFile), maxBytes: fcfg.shardMaxBytes });
  if (plan.action === "skip") {
    skippedShards.push({ file: shardFile, reason: plan.reason });
    log(`[sync] ✗ SKIPPING ${path.basename(shardFile)}: ${plan.reason}. Nothing from it is uploaded and none of its stores are swept; this run will exit non-zero.`);
    continue;
  }
  if (plan.action === "noSweep") log(`[sync] ⚠ ${path.basename(shardFile)}: ${plan.reason}. Its fresh records are uploaded, but none of its stores are swept.`);
  for (const v of streamTopLevelObjects(shardFile)) {
    total++;
    const vinOk = /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v.vin || "").toUpperCase());
    const isActive = (v.status || "ACTIVE").toUpperCase() === "ACTIVE";
    if (!vinOk || !isActive) {
      if (vinOk && isRecentDrop(v, RUN_NOW_MS)) dropped.push({ vin: v.vin.toUpperCase(), dealerId: dealerIdFor(v), dealerName: v.dealerName || v.configDealerName || "", state: String(v.state || "").toUpperCase() });
      continue;
    }
    if (!isFreshRecord(v, RUN_NOW_MS, fcfg.maxRecordAgeMs)) {
      staleSkipped++;
      if (isRecentDrop(v, RUN_NOW_MS)) dropped.push({ vin: v.vin.toUpperCase(), dealerId: dealerIdFor(v), dealerName: v.dealerName || v.configDealerName || "", state: String(v.state || "").toUpperCase() });
      const k = v.dealerName || v.configDealerName || "?";
      staleByStore.set(k, (staleByStore.get(k) || 0) + 1);
      continue;
    }
    freshUploaded++;
    if (plan.action === "noSweep") { const id = dealerIdFor(v); if (id) noSweepStores.add(id); }
    rows.push({
      vin: v.vin.toUpperCase(), dealerId: dealerIdFor(v), dealerName: v.dealerName || v.configDealerName, condition: cond(v.inventoryType), year: v.year, make: v.make, model: v.model, trim: v.trim,
      bodyStyle: v.bodyStyle, exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, mileage: shardMileage(v.mileage, cond(v.inventoryType)), price: v.price, msrp: v.msrp, stockNumber: v.stockNumber, vdpUrl: v.url, imageUrl: v.imageUrl, source: "nightly",
      windowStickerUrl: v.windowStickerUrl || null, engine: v.engine || null, transmission: v.transmission || null, daysOnLot: num(v.daysOnLot), oldPrice: num(v.oldPrice), priceDiff: num(v.priceDiff),
      priceChangeType: v.priceChangeType || null, changeType: v.changeType || null, priceHistory: Array.isArray(v.priceHistory) && v.priceHistory.length ? v.priceHistory.slice(-60) : null,
      options: options(v), optionsTotal: num(v.totalOptionsPrice), baseMsrp: num(v.baseMsrp), crawlFirstSeen: v.firstSeen || null, sourceBox: BOX_LABEL, state: /^[A-Za-z]{2}$/.test(String(v.state || "").trim()) ? String(v.state).trim().toUpperCase() : null,
    });
  }
}
const unmatched = rows.filter((r) => !r.dealerId).length;
log(`${total} vehicles in file, ${rows.length} active with a valid VIN and refreshed in the last ${Math.round(fcfg.maxRecordAgeMs / 3600_000)}h`);
if (staleSkipped) {
  const top = [...staleByStore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n} (${c})`).join(", ");
  log(`[sync] skipped ${staleSkipped} ACTIVE record(s) the crawl has not refreshed within ${Math.round(fcfg.maxRecordAgeMs / 3600_000)}h (not uploaded, not re-stamped as seen) across ${staleByStore.size} store name(s); most: ${top}`);
}
log(`stores matched to the directory: ${rows.length - unmatched}/${rows.length} vehicles (${unmatched} unmatched — kept, keyed to store 0)`);

// Came-back count (syncRetired.js): VINs uploaded now that an earlier run's retired file (last 7 days, this box) listed.
// Files written at/after the newest shard belong to this same crawl output (an earlier attempt tonight) and are ignored.
const retiredHistory = loadRecentRetired(RETIRED_DIR, RUN_NOW_MS, { notAfterMs: newestShardMs });
log(formatCameBack(cameBack(rows, retiredHistory.map), retiredHistory.files));
const sweptStoreIds = (failedStores = []) => new Set([...new Set(rows.map((r) => r.dealerId).filter(Boolean))].filter((id) => !noSweepStores.has(id) && !failedStores.includes(id)));
const writeRetired = (failedStores) => {
  try {
    const list = retiredList(dropped, rows, sweptStoreIds(failedStores));
    const file = writeRetiredFile(RETIRED_DIR, list, BOX_LABEL, Date.now());
    log(`[sync] retired list: ${list.length} VIN(s) from swept stores written to ${file}`);
  } catch (err) {
    log(`[sync] could not write the retired list (${err.message}) — the sync itself is unaffected`);
  }
};

// Resume state (syncCheckpoint.js): identifies the crawl output by each shard's path/size/mtime — not its
// content, so checking it is cheap — plus a digest of every row's (vin, store) pair (syncRun.js). State for a
// different crawl output (a new night's files) is ignored entirely rather than resumed into unrelated data.
const fileIdentity = computeFileIdentity(files.map((f) => { const s = fs.statSync(f); return { path: f, size: s.size, mtimeMs: s.mtimeMs }; }));
const CHECKPOINT_PATH = process.env.SYNC_CHECKPOINT_PATH || path.join(os.homedir(), ".inventory-sync-checkpoint.json");
const runStore = {
  load: () => { if (NO_RESUME) return null; try { return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8")); } catch { return null; } },
  // Written to a temp file and renamed into place, so a kill mid-write can never leave a half-written state.
  save: (state) => { const tmp = `${CHECKPOINT_PATH}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, CHECKPOINT_PATH); },
  clear: () => { try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* nothing to clear */ } },
};

if (DRY_RUN) {
  // Read-only: the shards and the dealership directory have been read; nothing below touches the lock or any write endpoint.
  const sorted = rows.slice().sort((a, b) => (a.dealerId ?? 0) - (b.dealerId ?? 0) || (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0));
  const plan = planBatches(sorted, 0, { maxRows: config.batchRows, maxBytes: config.batchMaxBytes });
  const stores = new Set(rows.map((r) => r.dealerId).filter(Boolean));
  const mb = (n) => (n / 1048576).toFixed(2);
  log(`[dry-run] upsert plan: ${plan.rows} rows -> ${plan.batches} requests of <= ${config.batchRows} rows / <= ${mb(config.batchMaxBytes)}MB (largest ${plan.maxRowsInBatch} rows); body size median ${mb(plan.medianBytes)}MB, p95 ${mb(plan.p95Bytes)}MB, max ${mb(plan.maxBytes)}MB, total ${mb(plan.totalBytes)}MB`);
  log(`[dry-run] sweep plan: ${stores.size} stores -> ${Math.ceil(stores.size / config.sweepBatchStores)} batches of <= ${config.sweepBatchStores} stores, concurrency ${config.sweepConcurrency} (+ the store-0 bucket)`);
  const m = process.memoryUsage();
  log(`[dry-run] memory: rss ${mb(m.rss)}MB, heapUsed ${mb(m.heapUsed)}MB`);
  if (WRITE_RETIRED) writeRetired([]);
  log("[dry-run] nothing was sent: no lock taken, no writes to the deals box" + (WRITE_RETIRED ? " (retired file written locally)" : ""));
  process.exit(0);
}

// Only the write phase below needs the lock — everything above (reading shards, matching stores) is
// local/read-only and safe to run in parallel with another box's sync.
log(`[sync] acquiring sync lock as ${LOCK_OWNER}...`);
await acquireSyncLock();
// Prove liveness for the whole upsert + sweep: without it a slow-but-healthy sync looks dead to the
// server's staleness rule and another box reclaims the lock (two writers — happened 2026-10-01).
lockHeartbeat = startSyncLockHeartbeat({
  heartbeat: () => api(DEALS_PORT, "/api/ops/sync-lock/heartbeat", { owner: LOCK_OWNER }),
  reacquire: () => api(DEALS_PORT, "/api/ops/sync-lock/acquire", { owner: LOCK_OWNER, heartbeat: true }),
  log,
  intervalMs: Number(process.env.SYNC_HEARTBEAT_MS) || 30_000,
});
let failed = false;
try {
  const r = await runWritePhase({ rows, fileIdentity, api: dealsApi, store: runStore, isLockLost: () => lockHeartbeat?.isLost() === true, log, config, sweepExclude: noSweepStores, sourceBox: BOX_LABEL, foreignGraceMs: fcfg.foreignGraceMs });
  writeRetired(r.failedStores || []);
  // Same fields as always (the ops scripts and log reads that parse this line keep working), plus run details.
  log(JSON.stringify({ upserted: r.upserted, sweptStores: r.sweptStores, sweepFailed: r.sweepFailed, removed: r.removed, live: r.live, resumed: r.resumed, skippedRows: r.skippedRows, sweepMode: r.sweepMode, timings: { upsertMs: r.timings.upsertMs, sweepMs: r.timings.sweepMs, totalMs: r.timings.totalMs, requests: r.timings.requests, p50RequestMs: r.timings.p50RequestMs, p95RequestMs: r.timings.p95RequestMs } }));
  // Zero-scrape staleness (zeroScrape.js): stores that scraped nothing for 3 nights while their platform was healthy are hidden
  // from buyer search (stale_at; never removed). OFF unless ZERO_SCRAPE_STALE=1 — the server aggregate reads every live row, so it is
  // switched on deliberately — and only after a COMPLETE run: a skipped shard or failed sweep means "nothing scraped" proves nothing.
  if (process.env.ZERO_SCRAPE_STALE === "1") {
    if (skippedShards.length || (r.sweepFailed || 0) > 0) log("[sync] zero-scrape staleness skipped: this run was incomplete (skipped shard or failed sweep)");
    else {
      try {
        const z = await dealsApi("/api/inventory/zero-scrape", { runStart: new Date(RUN_NOW_MS).toISOString(), dryRun: process.env.ZERO_SCRAPE_DRY_RUN === "1" });
        log(`[sync] zero-scrape staleness: ${JSON.stringify(z)}`);
      } catch (e) { log(`[sync] zero-scrape staleness failed (non-fatal): ${e.message}`); }
    }
  }
} catch (err) {
  failed = true;
  if (err instanceof SweepAbortError || err instanceof LockLostError) {
    console.error(`${ts()} [sync] STOPPED: ${err.message}`);
  } else {
    console.error(`${ts()} [sync] FAILED:`, err);
  }
  console.error(`${ts()} [sync] Progress is saved in ${CHECKPOINT_PATH}. Running this same command again, while the crawl output on disk is unchanged, resumes from there — upserts that finished are not repeated, and the sweep cutoff is reused. Nothing restarts it automatically. Use --no-resume to ignore the saved state.`);
} finally {
  await releaseSyncLock();
}
if (failed) process.exitCode = 1;
else if (skippedShards.length) { log(`[sync] exiting 3: ${skippedShards.length} shard file(s) were not synced (${skippedShards.map((x) => path.basename(x.file)).join(", ")}) — the rest of the run completed`); process.exitCode = 3; }
