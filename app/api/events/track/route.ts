import { NextResponse } from "next/server";
import { isTrackedEvent } from "@/lib/analytics";

/**
 * Product-analytics beacon (lib/analytics.ts). One JSON line per event in
 * the server logs, same shape as the spend guard's — nothing stored, nothing
 * gated, unknown event names dropped. Props are scalars only and capped, so
 * a page can't use this as a log-injection channel.
 */
const MAX_PROPS = 12;
const MAX_VALUE = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown; props?: unknown } | null;
  if (!body || !isTrackedEvent(body.name)) return NextResponse.json({ ok: false }, { status: 400 });
  const props: Record<string, string | number | boolean | null> = {};
  if (body.props && typeof body.props === "object") {
    for (const [k, v] of Object.entries(body.props as Record<string, unknown>).slice(0, MAX_PROPS)) {
      if (v === null || typeof v === "number" || typeof v === "boolean") props[k.slice(0, 40)] = v;
      else if (typeof v === "string") props[k.slice(0, 40)] = v.slice(0, MAX_VALUE);
    }
  }
  console.log(JSON.stringify({ event: body.name, at: new Date().toISOString(), ...props }));
  return NextResponse.json({ ok: true });
}
