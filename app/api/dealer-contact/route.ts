import { NextResponse } from "next/server";
import { listDealerships } from "@/lib/dealershipsApi";
import { dealerContactStatus, type DirectoryDealership } from "@/lib/dealerContactLookup";

// Public (no login) — the wizard asks this while the buyer is still choosing
// who gets their offer, before it requires signing in. It answers one question
// per dealership: can we actually reach them? Never the email address itself —
// see DealerContactStatus for why.

const MAX_DEALERS_PER_REQUEST = 3;

// listDealerships() pulls the entire contact directory (thousands of rows) in
// one call, and the wizard asks again on every vehicle change. One shared copy
// per server instance, refreshed on a short TTL, keeps that from turning a
// three-dealer lookup into three full-directory fetches.
const DIRECTORY_TTL_MS = 60_000;
let cachedDirectory: { rows: DirectoryDealership[]; loadedAt: number } | null = null;

async function loadDirectory(): Promise<DirectoryDealership[]> {
  const now = Date.now();
  if (cachedDirectory && now - cachedDirectory.loadedAt < DIRECTORY_TTL_MS) {
    return cachedDirectory.rows;
  }
  const rows = await listDealerships();
  cachedDirectory = { rows, loadedAt: now };
  return rows;
}

export async function POST(req: Request) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = Array.isArray(body?.dealers) ? body.dealers : [];
  const dealers = requested
    .map((d: any) => ({
      dealerName: typeof d?.dealerName === "string" ? d.dealerName.trim() : "",
      state: typeof d?.state === "string" ? d.state.trim() : "",
    }))
    .filter((d: { dealerName: string }) => d.dealerName.length > 0)
    .slice(0, MAX_DEALERS_PER_REQUEST);

  if (dealers.length === 0) {
    return NextResponse.json({ results: [] });
  }

  try {
    const directory = await loadDirectory();
    return NextResponse.json({
      results: dealers.map((d: { dealerName: string; state: string }) =>
        dealerContactStatus(directory, d)
      ),
    });
  } catch {
    // A directory outage must not block the offer. Report every dealer as
    // unmatched so the buyer is offered the same "do you have an email?"
    // path they'd get for a genuinely missing record, rather than an error
    // they can't act on.
    return NextResponse.json({
      results: dealers.map((d: { dealerName: string }) => ({
        dealerName: d.dealerName,
        matched: false,
        addressLine: null,
        phone: null,
        hasEmail: false,
        emailOptOut: false,
      })),
      degraded: true,
    });
  }
}
