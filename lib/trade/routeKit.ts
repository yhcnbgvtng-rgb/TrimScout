/** Shared plumbing for the trade routes: error mapping and the upload rate limits. */
import { NextResponse } from "next/server";
import { StorageNotConfigured } from "./storage";
import { TradeError } from "./service";
import { firstTrippedLimit, isRateLimitExempt, tooManyRequests } from "../rateLimit";
import { clientIpFromHeaders } from "../clientIp";

export function tradeErrorResponse(err: unknown): NextResponse {
  if (err instanceof TradeError) return NextResponse.json({ error: err.message, ...(err.errors ? { errors: err.errors } : {}) }, { status: err.status });
  if (err instanceof StorageNotConfigured) return NextResponse.json({ error: "Photo uploads aren't available right now. Please try again shortly." }, { status: 503 });
  console.error("trade route:", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Something went wrong with the trade-in. Try again." }, { status: 502 });
}

/** Per request/draft, per buyer and per IP. Returns a 429 response when tripped, else null. */
export function uploadRateLimited(req: Request, targetId: string, user?: { id?: unknown; email?: string | null; role?: unknown } | null): NextResponse | null {
  if (isRateLimitExempt(user)) return null;
  const checks: Array<{ name: "trade_photo_target" | "trade_photo_user" | "trade_photo_ip"; subject: string }> = [
    { name: "trade_photo_target", subject: targetId },
    { name: "trade_photo_ip", subject: clientIpFromHeaders(req.headers) },
  ];
  if (user?.id != null) checks.push({ name: "trade_photo_user", subject: String(user.id) });
  const tripped = firstTrippedLimit(checks);
  return tripped ? tooManyRequests(tripped, `That's a lot of photo uploads in a short window. Try again in about ${Math.max(1, Math.ceil(tripped.retryAfterSec / 60))} min.`) : null;
}
