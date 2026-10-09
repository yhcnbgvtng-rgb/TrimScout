// "Options once per VIN" — the rule for when a vehicle's factory / dealer-listed options are (re)taken.
//
// A car's options almost never change between the night it first appears and the night it sells, yet every nightly sync used to
// ship, parse, diff and sometimes rewrite them again (measured 2026-10-08 on the box logs: options were 30–42% of the deals-API
// time inside each box's sync, 14–46 min per box per night). The rule:
//
//   * a VIN with a GOOD capture (not empty, not mostly junk under the current deny rules) is never re-taken: later nights only
//     update price, stock, last_seen and removed;
//   * a VIN whose capture was empty or junk is taken again ONCE, no sooner than 7 days after the first try, and never again after
//     that — no loop;
//   * a change to the deny rules or the allowlist never re-crawls anything: stored options_json is re-cleaned in the DB
//     (scripts/box/2026-09-28-backfill-inventory-options.mjs, dry run first).
//
// This module is pure (no I/O) and is the single source of the decision, used by the deals API on ingest and by the crawler's
// carry-forward. Colors, transmission and trim are NOT options and keep their own backfills.
import { optionRowsFromOptions } from "./inventoryOptionRows.js";

/** More than this share of a capture's labels being junk makes it a junk capture ("mostly junk"). */
export const OPTIONS_JUNK_SHARE_MAX = 0.5;
/** A failed (empty / junk) capture is tried again once, no sooner than this many days after the first try. */
export const OPTIONS_RETRY_AFTER_DAYS = 7;
/** First try + one retry. After this many tries a VIN is never tried again. */
export const OPTIONS_MAX_ATTEMPTS = 2;
export const OPTION_SOURCES = ["vdp", "sticker", "feed"];

const DAY_MS = 24 * 3600 * 1000;

/** "vdp" (the dealer's listing page — what the nightly crawl reads), "sticker" or "feed"; anything else is treated as "vdp". */
export function normalizeOptionsSource(source) {
  const s = typeof source === "string" ? source.trim().toLowerCase() : "";
  return OPTION_SOURCES.includes(s) ? s : "vdp";
}

/**
 * @param {unknown} options  the crawl's option list ([{ code, name, price }])
 * @param {{ resolveKey?: Function }} [opts]
 * @returns {{ state: "good" | "empty" | "junk", kept: number, junkDropped: number, junkShare: number }}
 *   empty = nothing usable came in at all; junk = nothing survives the deny rules, or more than half the labels are junk.
 */
export function assessOptionsCapture(options, opts = {}) {
  if (!Array.isArray(options) || options.length === 0) return { state: "empty", kept: 0, junkDropped: 0, junkShare: 0 };
  const { rows, junkDropped } = optionRowsFromOptions(options, opts);
  const total = rows.length + junkDropped;
  if (total === 0) return { state: "empty", kept: 0, junkDropped: 0, junkShare: 0 };
  const junkShare = junkDropped / total;
  if (rows.length === 0 || junkShare > OPTIONS_JUNK_SHARE_MAX) return { state: "junk", kept: rows.length, junkDropped, junkShare };
  return { state: "good", kept: rows.length, junkDropped, junkShare };
}

const asMs = (t) => {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime() : Date.parse(String(t));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * What to do with one incoming vehicle's options, given what is stored for that VIN.
 *
 * @param {{ existing: { capturedAt?: Date|string|null, attempts?: number|null, checkedAt?: Date|string|null } | null,
 *           incoming: { options?: unknown, source?: string|null },
 *           now?: Date, resolveKey?: Function }} input   existing = null for a VIN we have never stored.
 * @returns {{ action: "skip" | "wait" | "give_up" | "capture" | "attempt_failed",
 *             useIncoming: boolean,           // write this payload's options_json / facet rows
 *             set: { capturedAt?: Date, source?: string, attempts?: number, checkedAt?: Date },  // columns to write (absent = leave)
 *             assessment?: ReturnType<typeof assessOptionsCapture> }}
 *   skip      — already captured: ignore the payload's options entirely.
 *   wait      — one failed try on record, less than 7 days ago: not looked at.
 *   give_up   — two tries used: never again.
 *   capture   — a good capture: store, stamp options_captured_at + options_source.
 *   attempt_failed — empty / junk: the try is counted; whatever real options survive the deny rules are still stored (as before),
 *                    but the VIN is not marked captured.
 */
export function decideOptionsIngest({ existing, incoming, now = new Date(), resolveKey }) {
  if (existing && existing.capturedAt) return { action: "skip", useIncoming: false, set: {} };
  const attempts = Math.max(0, Number(existing?.attempts) || 0);
  if (attempts >= OPTIONS_MAX_ATTEMPTS) return { action: "give_up", useIncoming: false, set: {} };
  if (attempts >= 1) {
    const checked = asMs(existing?.checkedAt);
    if (checked != null && now.getTime() - checked < OPTIONS_RETRY_AFTER_DAYS * DAY_MS) return { action: "wait", useIncoming: false, set: {} };
  }
  const assessment = assessOptionsCapture(incoming?.options, { resolveKey });
  if (assessment.state === "good") {
    return { action: "capture", useIncoming: true, set: { capturedAt: now, source: normalizeOptionsSource(incoming?.source), checkedAt: now }, assessment };
  }
  // Empty or junk: this try is counted (the first night a VIN shows up with nothing usable is its first try; the one retry comes
  // no sooner than 7 days later; then never again).
  return { action: "attempt_failed", useIncoming: assessment.kept > 0, set: { attempts: attempts + 1, checkedAt: now }, assessment };
}

/**
 * Crawler side: given the previous night's record for this VIN and tonight's, keep the previous options when they were a good
 * capture (the same rule, applied to the shard so a nightly parse of a junk-heavy or half-loaded page cannot replace good
 * options). Returns the vehicle (mutated) with optionsCapturedAt / optionsSource stamped on a fresh good capture.
 */
export function carryOptionsForward(vehicle, prev, { now = new Date(), resolveKey } = {}) {
  if (!vehicle) return vehicle;
  if (prev && prev.optionsCapturedAt && Array.isArray(prev.dealerListedOptions) && prev.dealerListedOptions.length > 0) {
    vehicle.dealerListedOptions = prev.dealerListedOptions;
    vehicle.optionsCapturedAt = prev.optionsCapturedAt;
    vehicle.optionsSource = prev.optionsSource || "vdp";
    return vehicle;
  }
  const a = assessOptionsCapture(vehicle.dealerListedOptions, { resolveKey });
  if (a.state === "good") {
    vehicle.optionsCapturedAt = now.toISOString();
    vehicle.optionsSource = normalizeOptionsSource(vehicle.optionsSource);
  }
  return vehicle;
}

/**
 * Crawler side, for a crawl that makes a SEPARATE request for a VIN's options (finder_crawler.js's fetchVehicleOptions): whether
 * that request is worth making, from the previous night's record of the VIN. A captured VIN never; a VIN that already used its
 * tries never; a VIN with one failed try only once 7 days have passed. (The nightly standalone crawl has no separate options
 * request — they are read from the same listing page as price and stock — so it only applies carryOptionsForward.)
 */
export function shouldFetchOptions(prev, now = new Date()) {
  if (!prev) return true;
  if (prev.optionsCapturedAt) return false;
  const attempts = Math.max(0, Number(prev.optionsAttempts) || 0);
  if (attempts >= OPTIONS_MAX_ATTEMPTS) return false;
  if (attempts >= 1) {
    const checked = asMs(prev.optionsCheckedAt);
    if (checked != null && now.getTime() - checked < OPTIONS_RETRY_AFTER_DAYS * DAY_MS) return false;
  }
  return true;
}

/** Stamp the outcome of an options request on the vehicle record: captured when good, otherwise one more counted try. */
export function stampOptionsTry(vehicle, prev, { now = new Date(), source = "vdp", resolveKey } = {}) {
  const a = assessOptionsCapture(vehicle.dealerListedOptions, { resolveKey });
  vehicle.optionsCheckedAt = now.toISOString();
  if (a.state === "good") {
    vehicle.optionsCapturedAt = now.toISOString();
    vehicle.optionsSource = normalizeOptionsSource(source);
  } else {
    vehicle.optionsAttempts = Math.max(0, Number(prev?.optionsAttempts) || 0) + 1;
  }
  return vehicle;
}
