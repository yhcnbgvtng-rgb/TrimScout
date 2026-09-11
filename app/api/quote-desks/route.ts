import { NextResponse } from "next/server";
import { listDealerships } from "@/lib/dealershipsApi";
import { matchDirectoryDealership } from "@/lib/dealerContactLookup";
import { deskFromDealership, maskEmail, INVITE_BLOCK_MESSAGES, type DealerDesk } from "@/lib/quotePackage";

// The confirm step asks: for these dealerships, who would the quote request
// go to? Answers with the named desk, masked — never the address itself.
// A rooftop with no named person comes back blocked, with the reason.

const MAX = 3;
const TTL_MS = 60_000;
let cache: { rows: Awaited<ReturnType<typeof listDealerships>>; at: number } | null = null;

async function directory() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await listDealerships();
  cache = { rows, at: Date.now() };
  return rows;
}

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

  let rows: Awaited<ReturnType<typeof listDealerships>> = [];
  let degraded = false;
  try {
    rows = await directory();
  } catch {
    degraded = true;
  }

  const desks: PublicDesk[] = dealers.map((d: { dealerName: string; state: string }) => {
    const row = matchDirectoryDealership(rows, d);
    const desk = row ? deskFromDealership(row) : null;
    const blocked: PublicDesk["blockedReason"] = !desk || !desk.knownNamed
      ? "no_named_contact"
      : desk.emailOptOut
        ? "dealer_opted_out"
        : null;
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
    };
  });
  return NextResponse.json({ desks, degraded });
}
