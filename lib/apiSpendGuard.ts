// Spend protection for every route that calls a paid vendor (MarketCheck
// today; NeoVIN or anything else later). Two independent lines of defense,
// both server-side, both enforced BEFORE the vendor call ever fires:
//
//   1. A per-IP rate limit on "paid decode" traffic — same in-memory,
//      per-instance bucket pattern as middleware.ts, just usable from a
//      Node.js route handler (middleware.ts runs on the Edge runtime, a
//      separate process, so it can't share state with these routes).
//   2. A hard daily $ budget kill switch, shared across all instances of
//      this same warm serverless container. Once the estimated spend for
//      the day crosses PAID_DECODE_DAILY_BUDGET_USD, every paid-decode
//      route returns 429 without calling the vendor, until midnight UTC.
//
// Same honest limitation middleware.ts already documents: this is
// in-memory and per-instance, not distributed. On Vercel that means the
// real ceiling is "per-instance budget × however many warm instances are
// running", not a single global number. That's still a large improvement
// over no limit at all, and catches the common cases (one client or one
// leaked script hammering an endpoint, a single hot instance runing away).
// A durable fix needs a shared store (Vercel KV / Upstash Redis) — noted
// in README.md as a deliberate follow-up, not done here.
import { env } from "node:process";
import { isMarketCheckEnabled } from "./serverSecret";
import { clientIpFromHeaders } from "./clientIp";

function numEnv(name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

// ---------------------------------------------------------------------
// Feature flag: paid VIN/options decode (the 15-manufacturer listing-feed
// engine in lib/listingFeedBuild.ts, and any future NeoVIN adapter) stays
// OFF by default. Flip PAID_VIN_DECODE_ENABLED=true only once the seed
// shortlist's honesty checks are green — this is a deliberate, explicit
// kill switch, not an oversight.
// ---------------------------------------------------------------------
export function isPaidVinDecodeEnabled(): boolean {
  return boolEnv("PAID_VIN_DECODE_ENABLED", false);
}

// ---------------------------------------------------------------------
// Per-IP rate limiting for paid-decode-classified routes
// ---------------------------------------------------------------------
interface Bucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, Bucket>();

let lastSweep = Date.now();
function sweepIfDue(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}

function isAllowed(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweepIfDue(now);
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

// ---------------------------------------------------------------------
// Daily $ budget kill switch
// ---------------------------------------------------------------------
interface DailySpend {
  dateKey: string;
  totalUsd: number;
  callCount: number;
}
let dailySpend: DailySpend = { dateKey: "", totalUsd: 0, callCount: 0 };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC calendar day
}

function currentDailySpend(): DailySpend {
  const key = todayKey();
  if (dailySpend.dateKey !== key) {
    dailySpend = { dateKey: key, totalUsd: 0, callCount: 0 };
  }
  return dailySpend;
}

function dailyBudgetUsd(): number {
  // No safe default exists here — this is a real dollar ceiling on a real
  // vendor contract, and only the account holder can say what they're
  // willing to spend per day. Until PAID_DECODE_DAILY_BUDGET_USD is set,
  // default to 0 (block everything) rather than guess a number that could
  // either surprise-bill someone or silently allow more than they meant.
  return numEnv("PAID_DECODE_DAILY_BUDGET_USD", 0);
}

// ---------------------------------------------------------------------
// Real per-call MarketCheck pricing (published rate card, confirmed
// 2026-09-08 at marketcheck.com/apis/pricing — "data fees" charged in
// addition to the monthly plan fee, on every call regardless of plan
// tier). Each call site below reports its own actual call composition
// via `estCostUsd` rather than one flat guess, since TrimScout's real
// costs span a 3x range depending on which endpoint fires:
//   /v2/search/car/active   -> "Inventory Search API"  -> $0.002/call
//   /v2/history/car/:vin    -> "VIN History API"        -> $0.006/call
//   /v2/listing/car/:id     -> not a separately published line item;
//                              treated as Inventory-Search-equivalent
//                              ($0.002) — confirm with MarketCheck's
//                              account console if exact precision matters
// A caller that doesn't know its own composition falls back to
// PAID_DECODE_EST_COST_USD, defaulted to the cheapest real rate ($0.002)
// rather than an invented number.
// ---------------------------------------------------------------------
export const MARKETCHECK_CALL_COST_USD = {
  search: 0.002,
  history: 0.006,
  listingDetail: 0.002,
} as const;

function estCostPerCallUsd(): number {
  return numEnv("PAID_DECODE_EST_COST_USD", MARKETCHECK_CALL_COST_USD.search);
}

// ---------------------------------------------------------------------
// Structured, grep-able event log — no dashboard, no aggregation
// endpoint, same "events only" pattern as the RFQ experiment. Pipe
// Vercel's log drain into whatever actually alerts a human later.
// ---------------------------------------------------------------------
export type SpendEventType = "seed_match" | "paid_decode" | "paid_decode_blocked" | "quote_request" | "spend_alert";

export function logSpendEvent(type: SpendEventType, payload: Record<string, unknown>) {
  const line = { event: type, at: new Date().toISOString(), ...payload };
  if (type === "paid_decode_blocked" || type === "spend_alert") {
    console.error(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
}

// ---------------------------------------------------------------------
// Lightweight spike-without-conversion heuristic. Not a real alerting
// pipeline (no Slack/PagerDuty wiring here — nothing was provisioned to
// send to) — this just makes the condition loud in the logs the moment it
// happens, via the same log line a real alert rule can match on.
// ---------------------------------------------------------------------
interface RecentActivity {
  paidDecodeTimestamps: number[];
  lastQuoteRequestAt: number;
}
const recent: RecentActivity = { paidDecodeTimestamps: [], lastQuoteRequestAt: 0 };

function alertWindowMs(): number {
  return numEnv("PAID_DECODE_ALERT_WINDOW_MS", 10 * 60_000); // 10 min
}
function alertQpsThreshold(): number {
  return numEnv("PAID_DECODE_ALERT_QPS_THRESHOLD", 30); // calls per window
}

export function recordQuoteRequest() {
  recent.lastQuoteRequestAt = Date.now();
  logSpendEvent("quote_request", {});
}

function checkSpikeWithoutConversion(now: number) {
  const windowMs = alertWindowMs();
  recent.paidDecodeTimestamps = recent.paidDecodeTimestamps.filter((t) => now - t <= windowMs);
  if (recent.paidDecodeTimestamps.length < alertQpsThreshold()) return;
  const hadConversionInWindow = now - recent.lastQuoteRequestAt <= windowMs;
  if (!hadConversionInWindow) {
    logSpendEvent("spend_alert", {
      reason: "paid_decode spike with no quote-request conversion in the same window",
      paidDecodeCallsInWindow: recent.paidDecodeTimestamps.length,
      windowMs,
    });
  }
}

// ---------------------------------------------------------------------
// The gate every paid-vendor call site checks first.
// ---------------------------------------------------------------------
export interface PaidDecodeGuardResult {
  allowed: boolean;
  status: 429;
  message: string;
}

/** Fails closed for the whole vendor when MarketCheck is off for the release (see serverSecret.ts). */
const MARKETCHECK_OFF_MESSAGE = "Market data is not part of this release.";

export function guardPaidDecode(opts: {
  kind: string;
  request: Request;
  /**
   * The real cost of THIS call, in dollars — e.g. a listing-facts request
   * for 3 VINs (search + history + listing-detail each) should pass
   * `3 * (MARKETCHECK_CALL_COST_USD.search + .history + .listingDetail)`,
   * not the single-call default. Omit only when the call site really is
   * exactly one vendor request at the default rate.
   */
  estCostUsd?: number;
}): PaidDecodeGuardResult | null {
  const now = Date.now();
  const ip = clientIpFromHeaders(opts.request.headers);

  if (!isMarketCheckEnabled()) {
    logSpendEvent("paid_decode_blocked", { reason: "marketcheck_disabled", kind: opts.kind, ip });
    return { allowed: false, status: 429, message: MARKETCHECK_OFF_MESSAGE };
  }

  const spend = currentDailySpend();
  const budget = dailyBudgetUsd();
  if (spend.totalUsd >= budget) {
    logSpendEvent("paid_decode_blocked", { reason: "daily_budget_exceeded", kind: opts.kind, ip, spentUsd: spend.totalUsd, budgetUsd: budget });
    return { allowed: false, status: 429, message: "Daily API budget reached — try again after midnight UTC." };
  }

  const limit = numEnv("PAID_DECODE_PER_IP_LIMIT", 20);
  const windowMs = numEnv("PAID_DECODE_WINDOW_MS", 60_000);
  if (!isAllowed(`paid_decode:${ip}`, limit, windowMs)) {
    logSpendEvent("paid_decode_blocked", { reason: "rate_limited", kind: opts.kind, ip });
    return { allowed: false, status: 429, message: "Too many requests. Please wait a moment and try again." };
  }

  // Allowed — charge the real cost and log the call now, since the caller
  // is about to make it.
  const cost = opts.estCostUsd ?? estCostPerCallUsd();
  spend.totalUsd += cost;
  spend.callCount += 1;
  recent.paidDecodeTimestamps.push(now);
  checkSpikeWithoutConversion(now);
  logSpendEvent("paid_decode", { kind: opts.kind, ip, estCostUsd: cost, dailyTotalUsd: spend.totalUsd });
  return null;
}

// ---------------------------------------------------------------------
// Per-desk (per-dealer) cap — a dealer's inbox shouldn't be spammable by
// spinning up many RFQs/deal-requests targeting the same dealer name.
// Independent of the per-IP limit above (different abuse shape: many
// different buyers/IPs all naming the same dealer).
// ---------------------------------------------------------------------
const deskBuckets = new Map<string, Bucket>();

export function guardPerDeskCap(dealerName: string): boolean {
  const now = Date.now();
  const limit = numEnv("QUOTE_REQUEST_PER_DESK_DAILY_LIMIT", 15);
  const key = `desk:${dealerName.trim().toLowerCase()}`;
  const existing = deskBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    deskBuckets.set(key, { count: 1, resetAt: now + 24 * 60 * 60_000 });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

// Test-only: clears all in-memory state so tests don't leak counters into
// each other. Never called from production code.
export function resetSpendGuardStateForTests() {
  rateBuckets.clear();
  deskBuckets.clear();
  dailySpend = { dateKey: "", totalUsd: 0, callCount: 0 };
  recent.paidDecodeTimestamps = [];
  recent.lastQuoteRequestAt = 0;
}
