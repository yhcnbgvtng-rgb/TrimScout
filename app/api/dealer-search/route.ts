// POST /api/dealer-search { q, zip? } — the dealer picker's search. Name
// words plus an optional ZIP (for the state) against the contacts on file.
// Display fields only; never an email address.
import { NextResponse } from "next/server";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { searchDirectoryDealerships } from "@/lib/dealerSearch";
import { deskMatchFromContact } from "@/lib/deskResolve";
import { deskFromDealership } from "@/lib/quotePackage";
import { getZipCoordinates } from "@/lib/otdCalculator";
import { isResolvedState } from "@/lib/sameStateCheck";

const LIMIT = 8;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 80) : "";
  const zip = typeof body?.zip === "string" ? body.zip.trim().slice(0, 5) : "";
  if (q.length < 2) return NextResponse.json({ matches: [] });

  let state: string | null = null;
  if (/^\d{5}$/.test(zip)) {
    const s = getZipCoordinates(zip).state;
    state = isResolvedState(s) ? s : null;
  }

  let rows: Awaited<ReturnType<typeof cachedDealerDirectory>> = [];
  try {
    rows = await cachedDealerDirectory();
  } catch {
    return NextResponse.json({ matches: [], degraded: true });
  }
  const hits = searchDirectoryDealerships(rows, q, { state, limit: LIMIT });
  return NextResponse.json({
    matches: hits.map((h) => deskMatchFromContact(h.row, Boolean(deskFromDealership(h.row)?.knownNamed))),
    state,
  });
}
