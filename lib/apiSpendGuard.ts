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
  return numEnv("PAID_DECODE_DAILY_BUDGET_USD", 15);
}

function estCostPerCallUsd(): number {
  // MarketCheck doesn't hand back real-time per-call billing here, so this
  // is a flat, deliberately conservative estimate — tune via env once
  // real invoice data is available. Overestimating trips the kill switch
  // earlier (safer); underestimating lets real spend run ahead of this
  // counter, which is exactly the failure mode a real cost API would fix.
  return numEnv("PAID_DECODE_EST_COST_USD", 0.05);
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

export function guardPaidDecode(opts: { kind: string; request: Request }): PaidDecodeGuardResult | null {
  const now = Date.now();
  const ip = clientIpFromHeaders(opts.request.headers);

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

  // Allowed — charge the estimate and log the real call now, since the
  // caller is about to make it.
  const cost = estCostPerCallUsd();
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
