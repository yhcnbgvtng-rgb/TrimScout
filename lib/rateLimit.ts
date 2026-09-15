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
  rfq_create_ip: { limit: 5, windowMs: 10 * 60_000 },
  rfq_create_user: { limit: 3, windowMs: 10 * 60_000 },
  rfq_create_global: { limit: 120, windowMs: 60_000 },
  invite_send_ip: { limit: 12, windowMs: 10 * 60_000 },
  invite_send_user: { limit: 9, windowMs: 10 * 60_000 },
  invite_send_global: { limit: 300, windowMs: 60_000 },
  signup_ip: { limit: 5, windowMs: 10 * 60_000 },
  signup_global: { limit: 200, windowMs: 60_000 },
};

export function namedLimit(name: RateLimitName, subject: string, now?: number): RateLimitVerdict {
  const d = DEFAULTS[name];
  const upper = name.toUpperCase();
  return checkRateLimit(`${name}:${subject}`, numEnv(`RATE_${upper}_LIMIT`, d.limit), numEnv(`RATE_${upper}_WINDOW_MS`, d.windowMs), now);
}

/** Run several named limits; the first that trips wins (its Retry-After is the one sent). */
export function firstTrippedLimit(checks: Array<{ name: RateLimitName; subject: string }>, now?: number): (RateLimitVerdict & { name: RateLimitName }) | null {
  for (const c of checks) {
    const v = namedLimit(c.name, c.subject, now);
    if (!v.ok) return { ...v, name: c.name };
  }
  return null;
}

export function tooManyRequests(v: RateLimitVerdict, message = "Too many requests — please wait a moment and try again."): NextResponse {
  return NextResponse.json({ error: message, retryAfterSec: v.retryAfterSec }, { status: 429, headers: { "Retry-After": String(v.retryAfterSec), "X-RateLimit-Limit": String(v.limit), "X-RateLimit-Remaining": String(v.remaining) } });
}

export function serviceBusy(retryAfterSec = 30, message = "We're lining up your quote — try again in a moment."): NextResponse {
  return NextResponse.json({ error: message, retryAfterSec }, { status: 503, headers: { "Retry-After": String(retryAfterSec) } });
}

/** Test-only. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  lastSweep = 0;
}
