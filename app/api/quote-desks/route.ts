import { NextResponse } from "next/server";
import type { Dealership } from "@/lib/dealershipsApi";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { publicDeskFor, type PublicDesk } from "@/lib/publicDesk";

// The confirm step asks: for these dealerships, who would the quote request
// go to? Answers with the named desk, masked — never the address itself.
// A rooftop with no named person isn't blocked: it routes to the store's
// sales desk (shared inbox) or the ops queue, and says which.

const MAX = 3;

export type { PublicDesk };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const asked = Array.isArray(body?.dealers) ? body.dealers : [];
  const dealers = asked
    .map((d: unknown) => {
      const o = (d || {}) as Record<string, unknown>;
      return {
        dealerName: typeof o.dealerName === "string" ? o.dealerName.trim() : "",
        state: typeof o.state === "string" ? o.state.trim() : "",
      };
    })
    .filter((d: { dealerName: string }) => d.dealerName)
    .slice(0, MAX);
  if (dealers.length === 0) return NextResponse.json({ desks: [] });

  let rows: Dealership[] = [];
  let degraded = false;
  try {
    rows = await cachedDealerDirectory();
  } catch {
    degraded = true;
  }

  const desks = dealers.map((d: { dealerName: string; state: string }) => publicDeskFor(rows, d));
  return NextResponse.json({ desks, degraded });
}
