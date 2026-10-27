// Client half of the sweep guards (server half: scrapers/lightsail-crawler/src/inventorySweep.js; why and how to install:
// docs/box-patches/2026-10-27-sweep-guards/STEPS.md).
//
// Audit 2026-10-27 of box2's 81,268 retirements: 32,068 had the same VIN live at another store, and ~23% of a week's retirements came back. The causes were
// a store whose site answered 403/429/5xx on part of the crawl (Fred Beans Acura of Abington: 2,125 cars, one 429 retry, 279 extracted -> 1,888 "retired") and
// sister rooftops that share one group inventory (Blaise Alexander State College / Altoona). This module decides, from the crawl logs the box already has,
// which stores must not be swept tonight, and turns the env tunables into the request fields the deals API understands.
//
// Pure functions plus one directory read; no network.
import fs from "node:fs";
import path from "node:path";

const HOSTILE = new Set(["CLOUDFLARE", "VERCEL_CHECKPOINT", "HTTP_403", "HTTP_429"]);
/** The crawl's hostile-answer classes: bot walls and rate limits (403/429) and any server error (HTTP_5xx). DNS/404/timeouts say nothing about the store's stock. */
export const isHostileClass = (cls) => HOSTILE.has(cls) || /^HTTP_5/.test(String(cls || ""));

// The crawler's skip line (same pattern as syncBlocked.js, repeated here so this module stands alone: a box whose ~/inventory-sync predates syncBlocked.js can still run it).
const SKIP_RE = /🛡️ SKIP (.+?): ([A-Z_0-9]+)(?: \((\d{3})\))? — (.*?)(?:; vendor=([A-Za-z0-9_-]+))? \[(https?:\/\/[^\]\s]+)\]/;

// "⏳ Fred Beans Acura of Abington: HTTP_429 — waiting 45s and retrying once before giving up": the crawl hit a wall, waited and carried on with whatever it
// could still read. The store then reports a "successful" partial extraction (279 of 2,125), which is why a plain SKIP-line check is not enough.
const RETRY_RE = /⏳ (.+?): ([A-Z_0-9]+) — waiting/;

/** Hostile answers in one crawl log's text: [{ name, cls, kind: "skip" | "retry", url }], one per store (a skip outranks a retry). */
export function parseHostileLines(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    let name, cls, kind, url = null;
    if (line.includes("SKIP")) {
      const m = SKIP_RE.exec(line);
      if (!m) continue;
      name = m[1]; cls = m[2]; url = m[6]; kind = "skip";
    } else if (line.includes("⏳")) {
      const m = RETRY_RE.exec(line);
      if (!m) continue;
      name = m[1]; cls = m[2]; kind = "retry";
    } else continue;
    if (!isHostileClass(cls)) continue;
    name = name.trim();
    const prev = out.get(name);
    if (!prev || (prev.kind === "retry" && kind === "skip")) out.set(name, { name, cls, kind, url });
  }
  return [...out.values()];
}

const NOT_CRAWL_LOG = /bot-report|write-dealers|^run-all|^chain-/;
const LOG_DATE = /-(\d{4}-\d{2}-\d{2})\.log$/;

/**
 * The newest night's per-store crawl logs: every log whose filename date (the crawl's start date) is the latest one present. A fixed mtime window
 * would also pull in the previous night's logs when the sync starts the morning after a long crawl, and a store that was blocked two nights ago would
 * be skipped for no reason. Returns [] when the newest crawl is older than `maxAgeMs` (no crawl tonight: nothing to say).
 */
export function latestCrawlLogs(dir, nowMs, maxAgeMs = 36 * 3600_000) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const dated = names.filter((n) => n.endsWith(".log") && !NOT_CRAWL_LOG.test(n)).map((n) => ({ n, d: (LOG_DATE.exec(n) || [])[1] })).filter((x) => x.d);
  if (!dated.length) return [];
  const newest = dated.reduce((m, x) => (x.d > m ? x.d : m), "");
  const files = dated.filter((x) => x.d === newest).map((x) => path.join(dir, x.n));
  const newestMtime = Math.max(0, ...files.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
  return nowMs - newestMtime <= maxAgeMs ? files : [];
}

/**
 * @param {object} p
 * @param {string[]} p.files
 * @param {(entry: { name: string, url: string }) => number | null} p.dealerIdFor
 * @returns {{ ids: Set<number>, entries: { dealerId: number, name: string, cls: string, kind: string }[], unmatched: number }}
 */
export function collectHostileStores({ files, dealerIdFor, readFile = (f) => fs.readFileSync(f, "utf8") }) {
  const byId = new Map();
  let unmatched = 0;
  for (const f of files) {
    let text;
    try { text = readFile(f); } catch { continue; }
    for (const e of parseHostileLines(text)) {
      const id = dealerIdFor({ name: e.name, url: e.url || "" });
      if (!id) { unmatched++; continue; }
      const prev = byId.get(id);
      if (!prev || (prev.kind === "retry" && e.kind === "skip")) byId.set(id, { dealerId: Number(id), name: e.name, cls: e.cls, kind: e.kind });
    }
  }
  return { ids: new Set([...byId.keys()].map(Number)), entries: [...byId.values()].sort((a, b) => a.dealerId - b.dealerId), unmatched };
}

const num = (v, def, min, max) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= min && n <= max ? n : def; };

/**
 * Tunables. Defaults are ON: installing this client is the opt-in. Setting SWEEP_MIN_MISSES=1, SWEEP_PROTECT_ELSEWHERE=0, SWEEP_MIN_FRESH_RATIO=0 and
 * SWEEP_SKIP_HOSTILE=0 in inventory-sync/.env gives back the old behaviour without touching the code (the rollback in STEPS.md uses file restores instead).
 * @returns {{ fields: object, skipHostile: boolean, requireGuards: boolean, logMaxAgeMs: number }}
 */
export function guardConfigFromEnv(env = process.env) {
  const minMisses = Math.floor(num(env.SWEEP_MIN_MISSES, 2, 1, 5));
  const ratio = num(env.SWEEP_MIN_FRESH_RATIO, 0.5, 0, 1);
  const fields = {};
  if (minMisses > 1) fields.minMisses = minMisses;
  if (env.SWEEP_PROTECT_ELSEWHERE !== "0") fields.protectElsewhere = true;
  if (ratio > 0) { fields.minFreshRatio = ratio; fields.minLiveForRatio = Math.floor(num(env.SWEEP_MIN_LIVE_FOR_RATIO, 10, 1, 100_000)); }
  return {
    fields,
    skipHostile: env.SWEEP_SKIP_HOSTILE !== "0",
    // Refuse to sweep at all if the deals API does not acknowledge the guards (an API that predates them would silently ignore the fields and retire as before).
    requireGuards: Object.keys(fields).length > 0 && env.SWEEP_REQUIRE_GUARDS !== "0",
    logMaxAgeMs: num(env.SWEEP_LOG_MAX_AGE_H, 36, 1, 24 * 14) * 3600_000,
  };
}

/**
 * The "[sync] sweep guard:" summary line. The crawl logs name every store that hit a wall, but only a store with rows in tonight's upload that is also swept
 * (not in noSweepStores) is actually protected by the guard; the rest were not crawled into this sync or are never swept, so counting them overstated the effect.
 * @param {{ logs: number, hostile: { entries: { dealerId: number }[], unmatched: number }, sweepableIds: Set<number> }} p
 */
export function describeGuardCounts({ logs, hostile, sweepableIds }) {
  const swept = hostile.entries.filter((e) => sweepableIds.has(Number(e.dealerId))).length;
  const other = hostile.entries.length - swept;
  return `[sync] sweep guard: ${logs} crawl log(s) read, ${swept} crawled and swept store(s) hit a 403/429/5xx wall (${other} more in the logs had no rows tonight or are never swept; ${hostile.unmatched} not matched to the directory)`;
}

/** One log line per skipped store, capped, plus a total — the audit trail for "why was this store not swept tonight". */
export function describeSkips({ hostile = [], partial = [], nameOf = () => "?", max = 40 }) {
  const lines = [];
  if (hostile.length) {
    lines.push(`[sync] sweep skipped for ${hostile.length} store(s) whose crawl hit a 403/429/5xx wall tonight (their cars stay live, no miss counted):`);
    for (const h of hostile.slice(0, max)) lines.push(`[sync]   ${h.name} (#${h.dealerId}): ${h.cls}${h.kind === "retry" ? " during the crawl (retried)" : " (skipped)"}`);
    if (hostile.length > max) lines.push(`[sync]   ... and ${hostile.length - max} more`);
  }
  if (partial.length) {
    lines.push(`[sync] sweep skipped for ${partial.length} store(s) whose crawl returned under the fresh-ratio of their live cars (partial crawl; no miss counted):`);
    for (const p of partial.slice(0, max)) lines.push(`[sync]   ${nameOf(p.dealerId)} (#${p.dealerId}): ${p.fresh} fresh of ${p.live} live (${Math.round((100 * p.fresh) / Math.max(1, p.live))}%)`);
    if (partial.length > max) lines.push(`[sync]   ... and ${partial.length - max} more`);
  }
  return lines;
}
