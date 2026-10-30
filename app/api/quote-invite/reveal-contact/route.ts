// GET  /api/quote-invite/reveal-contact?t=<signed token>  what the reveal page shows before the button (vehicle, VIN, total).
// POST /api/quote-invite/reveal-contact { t }             "Reveal buyer contact info": logs the reveal on the deal, returns the details.
// The token is the signed, expiring, single-dealer link from the "Your offer was accepted" email (lib/contactRevealToken.ts);
// rate-limited per IP and per token. Gates and logic: lib/contactReveal.ts. Responses are never cached.
import { NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/clientIp";
import { describeReveal, performReveal, type RevealDeps } from "@/lib/contactReveal";
import { getRfq, revealBuyerContact } from "@/lib/rfqApi";

const deps: RevealDeps = { getRfq, revealOnBox: revealBuyerContact };
const noStore = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex" };
const respond = (out: { status: number; body: unknown }) => {
  const retry = (out.body as { retryAfterSec?: number })?.retryAfterSec;
  return NextResponse.json(out.body, { status: out.status, headers: { ...noStore, ...(retry ? { "Retry-After": String(retry) } : {}) } });
};

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") || "";
  return respond(await describeReveal(t, clientIpFromHeaders(req.headers), deps));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return respond(await performReveal(typeof body?.t === "string" ? body.t : "", clientIpFromHeaders(req.headers), deps));
}
