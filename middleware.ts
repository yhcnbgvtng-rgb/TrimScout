import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders } from "./lib/clientIp";

// Lightweight, in-memory, per-instance rate limiting. This is NOT
// distributed — on Vercel each instance/region keeps its own counters, so
// a determined attacker spread across instances can exceed these numbers.
// That's a real limitation, not an oversight: a proper fix needs a shared
// store (Upstash Redis / Vercel KV) and is a separate, deliberate
// follow-up. This still raises the bar substantially above "no limiting at
// all" for the common case (a single client hammering one endpoint).

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Sweep occasionally so `buckets` doesn't grow unbounded over a long-lived
// instance's lifetime.
let lastSweep = Date.now();
function sweepIfDue(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function isAllowed(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweepIfDue(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

// { path prefix, requests allowed, window } — tightest on auth/checkout
// (credential stuffing, payment abuse), looser on deal-request/RFQ
// creation.
//
// Auth is scoped to specific sensitive paths, NOT the whole /api/auth/*
// prefix — that prefix also covers NextAuth's own frequent, routine
// session/csrf/provider checks (/api/auth/session, /api/auth/csrf, ...),
// which fire on every page load. Sharing one bucket with those meant
// ordinary browsing could exhaust the limit and start blocking real
// session checks — caught this via direct testing, not by inspection.
//
// /api/deal-requests and /api/rfqs are the two "quote-request" surfaces —
// each gets a per-IP cap here; the RFQ invite route additionally enforces
// a per-desk (per-dealer-name) cap of its own in lib/apiSpendGuard.ts,
// since that's a different abuse shape (many IPs/buyers all naming the
// same dealer) that an IP-keyed bucket can't see.
//
// Paid-vendor routes (inventory/comparables/listing-facts/sticker-decode)
// are NOT listed here — they're gated inside their own route handlers via
// lib/apiSpendGuard.ts instead, because that gate also needs the shared
// daily-$-budget counter, not just a per-IP request count.
const RULES: { match: (path: string) => boolean; limit: number; windowMs: number }[] = [
  {
    match: (p) => p === "/api/auth/signup" || p.startsWith("/api/auth/callback/"),
    limit: 10,
    windowMs: 60_000,
  },
  { match: (p) => p.startsWith("/api/checkout/"), limit: 10, windowMs: 60_000 },
  { match: (p) => p.startsWith("/api/deal-requests"), limit: 20, windowMs: 60_000 },
  { match: (p) => p.startsWith("/api/rfqs"), limit: 20, windowMs: 60_000 },
  // Unauthenticated by design (an invited dealer has no account yet), so
  // gated here against token-guessing the same way /api/auth/signup is.
  { match: (p) => p === "/api/dealer-signup-invite", limit: 20, windowMs: 60_000 },
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ruleIndex = RULES.findIndex((r) => r.match(pathname));
  if (ruleIndex === -1) return NextResponse.next();
  const rule = RULES[ruleIndex];

  const key = `${clientIpFromHeaders(req.headers)}:${ruleIndex}`;
  if (!isAllowed(key, rule.limit, rule.windowMs)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/auth/:path*",
    "/api/checkout/:path*",
    "/api/deal-requests/:path*",
    "/api/rfqs/:path*",
    "/api/dealer-signup-invite",
  ],
};
