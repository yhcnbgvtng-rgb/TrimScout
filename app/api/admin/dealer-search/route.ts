// POST /api/admin/dealer-search { q, state? } — the admin "Add dealer" type-ahead.
// Like /api/dealer-search but for an admin session, so it also returns the
// directory's sales email (to prefill the field). Opted-out rooftops are
// flagged, not hidden, so the admin sees why one can't be added.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { searchDirectoryDealerships } from "@/lib/dealerSearch";

const LIMIT = 8;

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 80) : "";
  const state = typeof body?.state === "string" && /^[A-Za-z]{2}$/.test(body.state.trim()) ? body.state.trim().toUpperCase() : null;
  if (q.length < 2) return NextResponse.json({ matches: [] });
  let rows: Awaited<ReturnType<typeof cachedDealerDirectory>> = [];
  try {
    rows = await cachedDealerDirectory();
  } catch {
    return NextResponse.json({ matches: [], degraded: true });
  }
  const hits = searchDirectoryDealerships(rows, q, { state, limit: LIMIT });
  return NextResponse.json({
    matches: hits.map((h) => ({
      id: h.row.id,
      dealerName: (h.row.dealerName || "").trim(),
      city: h.row.city?.trim() || null,
      state: h.row.state?.trim().toUpperCase() || null,
      email: h.row.contactEmail?.trim() || "",
      emailOptOut: Boolean(h.row.emailOptOut),
    })),
  });
}
