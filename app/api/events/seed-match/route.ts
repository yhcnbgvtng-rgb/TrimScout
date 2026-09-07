import { NextResponse } from "next/server";
import { logSpendEvent } from "@/lib/apiSpendGuard";

// Fire-and-forget beacon from the free seed-match flow (FactoryMatchFlow),
// logged as its own event type so it never gets conflated with paid_decode
// in the logs — this endpoint costs nothing to serve and is never gated:
// the whole point of the seed tier is that it stays open and free.
export async function POST() {
  logSpendEvent("seed_match", {});
  return NextResponse.json({ ok: true });
}
