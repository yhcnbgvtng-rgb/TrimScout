// Queue-mode glue for inventory-sync.mjs (installed next to it in ~/inventory-sync/ by the crawl-queue install script).
//
// With the crawl-queue flag OFF every function here is a pass-through, so the sync behaves exactly as it always has.
// With it ON:
//   selectShards   the sync uploads ONLY the shards this box finished tonight (the worker's manifest), never "every *.json in
//                  data/inventory". Last night's incident was that rule: 6-11-day-old shards were uploaded and resurrected sold
//                  cars. A host (box2) or a box that finished nothing exits 0 — nothing to sync is not an error.
//   foreign grace  shards move between boxes now, so "another box wrote this row in the last 48h, leave it alone" would keep a
//                  sold car live for two days after its shard changed boxes. The grace becomes "since this queue night began": rows
//                  another box wrote TONIGHT stay protected (two brands of one dealer synced by different boxes — the case the
//                  protection exists for), last night's rows may be retired when tonight's crawl did not see them again.
//   backpressure   the heavy calls to box2 wait while box2's iowait is over the pause line (crawlQueuePressure.js).
import fs from "node:fs";
import path from "node:path";
import { readFlag } from "./crawlQueueFlag.js";
import { queueNight } from "./crawlQueueCore.js";
import { makePressureWaiter, withBackpressure } from "./crawlQueuePressure.js";

const queueNightFor = (env, now = Date.now()) => (env.CRAWL_QUEUE_NIGHT && /^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(env.CRAWL_QUEUE_NIGHT) ? env.CRAWL_QUEUE_NIGHT : queueNight(now));

const CRAWLER_DIR = () => process.env.CRAWLER_DIR || "/home/ubuntu/nj-scraper/scrapers/lightsail-crawler";

export const queueState = (env = process.env) => readFlag(CRAWLER_DIR(), env);
export const manifestPath = (crawlerDir, night) => path.join(crawlerDir, "data", "crawl_queue", `manifest-${night}.json`);

/**
 * Hours of "rows another box wrote are theirs": from just before the queue night began until now. Anything written during THIS
 * night by another box (the other brand's shard of a shared rooftop) is protected; anything older is last night's and may be
 * retired when this night's crawl did not see it again. 20h when the night's start is unknown.
 */
export function foreignGraceHours(nightStartedAt, now = Date.now()) {
  if (!Number.isFinite(nightStartedAt)) return 20;
  return Math.max(2, Math.ceil((now - nightStartedAt) / 3_600_000) + 1);
}
function nightStart(crawlerDir, night) {
  try { return JSON.parse(fs.readFileSync(path.join(crawlerDir, "data", "crawl_queue", `night-${night}.json`), "utf-8")).startedAt; } catch { return NaN; }
}

// Evaluated at import, before inventory-sync.mjs reads its freshness config.
if (queueState().enabled) process.env.SYNC_FOREIGN_GRACE_HOURS ||= String(foreignGraceHours(nightStart(CRAWLER_DIR(), queueNightFor(process.env))));

/** Pure: which of `allFiles` (absolute paths) the manifest vouches for, plus why the rest are left out. */
export function chooseShards(allFiles, manifest, { statMtimeMs = (f) => fs.statSync(f).mtimeMs } = {}) {
  const byBase = new Map(allFiles.map((f) => [path.basename(f), f]));
  const files = []; const dropped = [];
  for (const s of (manifest && manifest.shards) || []) {
    const f = byBase.get(s.file);
    if (!f) { dropped.push({ file: s.file, reason: "file is not in the inventory directory" }); continue; }
    let m = null;
    try { m = statMtimeMs(f); } catch { dropped.push({ file: s.file, reason: "cannot stat" }); continue; }
    // The shard must have been written by the job that finished it (startedAt), not be a leftover from an earlier night.
    if (s.startedAt && m < s.startedAt - 60_000) { dropped.push({ file: s.file, reason: "older than the job that supposedly wrote it" }); continue; }
    files.push(f);
  }
  return { files, dropped };
}

export function selectShards(allFiles, { env = process.env, log = console.log, exit = (c) => process.exit(c), now = Date.now() } = {}) {
  const q = readFlag(CRAWLER_DIR(), env);
  if (!q.enabled) return allFiles;
  if (q.role === "host") { log(`[queue] ${q.box} hosts the crawl queue and does not crawl — no shards to sync here`); exit(0); return []; }
  const night = queueNightFor(env, now);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath(CRAWLER_DIR(), night), "utf-8")); } catch { /* none */ }
  if (!manifest || !Array.isArray(manifest.shards) || manifest.shards.length === 0) {
    log(`[queue] no finished shards recorded for night ${night} on ${q.box} — nothing to sync (a failed night is looked at by hand; it is never auto-retried)`);
    exit(0); return [];
  }
  const { files, dropped } = chooseShards(allFiles, manifest);
  for (const d of dropped) log(`[queue] not syncing ${d.file}: ${d.reason}`);
  log(`[queue] syncing ${files.length} shard(s) this box finished on night ${night} (of ${allFiles.length} files in the directory; the rest are left alone)`);
  if (files.length === 0) { exit(0); return []; }
  return files;
}

/** dealsApi wrapper; identity when the flag is off. */
export function queueApi(dealsApi, { env = process.env, log = console.log } = {}) {
  if (!queueState(env).enabled) return dealsApi;
  return withBackpressure(dealsApi, makePressureWaiter({ log }));
}
