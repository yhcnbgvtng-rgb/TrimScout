import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BuyerSearchStateError, getBuyerSearchState, putBuyerSearchState } from "@/lib/buyerSearchStateApi";
import { sanitizeState } from "@/lib/buyerPicks";

export const dynamic = "force-dynamic";

// The signed-in buyer's own picks + viewed marks. Scoped to the SESSION's user id — never a client-supplied one.
// Guests get 401 and keep their state in sessionStorage; if the box store is unavailable this answers 503 and the
// page falls back to localStorage, so nothing here can block searching.
async function userId(): Promise<string | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  return id || null;
}

function fail(err: unknown) {
  const status = err instanceof BuyerSearchStateError ? (err.status === 404 ? 503 : err.status) : 503;
  return NextResponse.json({ error: "Saved picks are unavailable right now." }, { status: status >= 400 && status < 600 ? status : 503 });
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Sign in to save picks." }, { status: 401 });
  try { return NextResponse.json(await getBuyerSearchState(id)); } catch (err) { return fail(err); }
}

export async function PUT(req: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Sign in to save picks." }, { status: 401 });
  const body = await req.json().catch(() => null) as { picks?: unknown; viewed?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  const clean = sanitizeState(body);
  try {
    await putBuyerSearchState(id, { ...(Array.isArray(body.picks) ? { picks: clean.picks } : {}), ...(Array.isArray(body.viewed) ? { viewed: clean.viewed } : {}) });
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
