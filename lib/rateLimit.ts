/**
 * Fixed-window rate limits for the write paths — RFQ create, invite send,
 * signup — keyed per IP, per account and globally. In-memory: each
 * serverless instance counts its own traffic, so treat the numbers as a
 * per-instance floor and set the hard global ceiling in Vercel's firewall
 * rate-limit rules (see docs/SPIKE_RUNBOOK.md). Limits come from env so
 * they can be tightened during a spike without a code change.
 *
 * Over the limit → 429 with Retry-After. Never a 500, never a silent drop.
 */
import { env } from "node:process";
import { NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function numEnv(name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the window resets — the Retry-After the caller sends. */
  retryAfterSec: number;
  limit: number;
  remaining: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitVerdict {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: Math.ceil(windowMs / 1000), limit, remaining: limit - 1 };
  }
  b.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { ok: b.count <= limit, retryAfterSec, limit, remaining: Math.max(0, limit - b.count) };
}

/** The named limits, each overridable by env: RATE_<NAME>_LIMIT / RATE_<NAME>_WINDOW_MS. */
export type RateLimitName = "rfq_create_ip" | "rfq_create_user" | "rfq_create_global" | "invite_send_ip" | "invite_send_user" | "invite_send_global" | "signup_ip" | "signup_global";
const DEFAULTS: Record<RateLimitName, { limit: number; windowMs: number }> = {
  // Per-account / per-IP caps are sized for a real buyer iterating on a request (re-sending after edits,
  // trying an alternate VIN) — 3 creates in 10 min locked out a single person mid-flow. The global caps
  // are the spike guard; these only stop one client from hammering.
  rfq_create_ip: { limit: 20, windowMs: 10 * 60_000 },
  rfq_create_user: { limit: 12, windowMs: 10 * 60_000 },
  rfq_create_global: { limit: 120, windowMs: 60_000 },
  invite_send_ip: { limit: 40, windowMs: 10 * 60_000 },
  invite_send_user: { limit: 30, windowMs: 10 * 60_000 },
  invite_send_global: { limit: 300, windowMs: 60_000 },
  signup_ip: { limit: 5, windowMs: 10 * 60_000 },
  signup_global: { limit: 200, windowMs: 60_000 },
};

export function namedLimit(name: RateLimitName, subject: string, now?: number): RateLimitVerdict {
  const d = DEFAULTS[name];
  const upper = name.toUpperCase();
  return checkRateLimit(`${name}:${subject}`, numEnv(`RATE_${upper}_LIMIT`, d.limit), numEnv(`RATE_${upper}_WINDOW_MS`, d.windowMs), now);
}

/**
 * Accounts the send caps never apply to: admins, the `@trimscout.test` / `@example.com` smoke accounts, and
 * anything listed in RATE_LIMIT_EXEMPT_ACCOUNTS (comma-separated emails or user ids). Testing a flow means
 * creating and walking away from requests over and over — a cap sized for real buyers just gets in the way,
 * and none of these accounts reach real dealers (SAFE MODE routes every dealer email to the owner anyway).
 */
export const TEST_ACCOUNT_DOMAINS = ["trimscout.test", "example.com"];
export function isRateLimitExempt(user: { id?: unknown; email?: string | null; role?: unknown } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  const email = (user.email || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  if (TEST_ACCOUNT_DOMAINS.includes(domain)) return true;
  const listed = (process.env.RATE_LIMIT_EXEMPT_ACCOUNTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return listed.includes(email) || (user.id != null && listed.includes(String(user.id).toLowerCase()));
}

/** Run several named limits; the first that trips wins (its Retry-After is the one sent). */
export function firstTrippedLimit(checks: Array<{ name: RateLimitName; subject: string }>, now?: number): (RateLimitVerdict & { name: RateLimitName }) | null {
  for (const c of checks) {
    const v = namedLimit(c.name, c.subject, now);
    if (!v.ok) return { ...v, name: c.name };
  }
  return null;
}

/** Honest wait copy: minutes when the window is long, so "wait a moment" never sits next to "366s". */
export function retryAfterLabel(sec: number): string {
  return sec >= 90 ? `about ${Math.ceil(sec / 60)} min` : `about ${Math.max(1, sec)}s`;
}

export function tooManyRequests(v: RateLimitVerdict, message?: string): NextResponse {
  const text = message ?? `That's ${v.limit} sends in a short window — the cap that keeps dealers from being flooded. Try again in ${retryAfterLabel(v.retryAfterSec)}.`;
  return NextResponse.json({ error: text, retryAfterSec: v.retryAfterSec }, { status: 429, headers: { "Retry-After": String(v.retryAfterSec), "X-RateLimit-Limit": String(v.limit), "X-RateLimit-Remaining": String(v.remaining) } });
}

export function serviceBusy(retryAfterSec = 30, message = "We're lining up your quote — try again in a moment."): NextResponse {
  return NextResponse.json({ error: message, retryAfterSec }, { status: 503, headers: { "Retry-After": String(retryAfterSec) } });
}

/** Test-only. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  lastSweep = 0;
}
