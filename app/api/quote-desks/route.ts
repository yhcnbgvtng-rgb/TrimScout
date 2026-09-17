import { NextResponse } from "next/server";
import type { Dealership } from "@/lib/dealershipsApi";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { matchDirectoryDealership } from "@/lib/dealerContactLookup";
import { deskFromDealership, deskFromRooftop, inviteRouting, type InviteRouting, maskEmail, INVITE_BLOCK_MESSAGES, type DealerDesk } from "@/lib/quotePackage";

// The confirm step asks: for these dealerships, who would the quote request
// go to? Answers with the named desk, masked — never the address itself.
// A rooftop with no named person isn't blocked: it routes to the store's
// sales desk (shared inbox) or the ops queue, and says which.

const MAX = 3;

export interface PublicDesk {
  dealerName: string;
  found: boolean;
  knownNamed: boolean;
  contactName: string | null;
  role: DealerDesk["role"] | null;
  emailMasked: string | null;
  emailDomain: string | null;
  emailOptOut: boolean;
  blockedReason: keyof typeof INVITE_BLOCK_MESSAGES | null;
  blockedMessage: string | null;
  /** Where the request goes: a named person, the rooftop's shared inbox, or our routing queue. */
  routing: InviteRouting;
}

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

  const desks: PublicDesk[] = dealers.map((d: { dealerName: string; state: string }) => {
    const row = matchDirectoryDealership(rows, d);
    const named = row ? deskFromDealership(row) : null;
    const desk = named?.knownNamed ? named : row ? deskFromRooftop(row) : null;
    const blocked: PublicDesk["blockedReason"] = desk?.emailOptOut ? "dealer_opted_out" : null;
    return {
      dealerName: d.dealerName,
      found: Boolean(row),
      knownNamed: Boolean(desk?.knownNamed),
      contactName: desk?.contactName || null,
      role: desk?.role || null,
      emailMasked: desk?.knownNamed ? maskEmail(desk.email) : null,
      emailDomain: desk?.knownNamed ? desk.emailDomain : null,
      emailOptOut: Boolean(desk?.emailOptOut),
      blockedReason: blocked,
      blockedMessage: blocked ? INVITE_BLOCK_MESSAGES[blocked] : null,
      routing: inviteRouting(desk),
    };
  });
  return NextResponse.json({ desks, degraded });
}
