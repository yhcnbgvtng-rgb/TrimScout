// POST /api/desk-resolve { url } — which dealer desk a pasted vehicle-page
// link belongs to, from its hostname and the contacts on file. The pasted
// page is never requested; when no domain on file matches, only the site's
// ORIGIN is asked where it redirects (lib/hostRedirect.ts), so a store that
// moved from freedomfordnj.com to freedomfordusa.com still resolves. A
// match made that way is NOT written back from here: this route has no login,
// and the old full-row PUT from a cache up to 60 s old could undo an admin's
// contact-email edit and let anyone add alias domains. Alias domains are for
// an admin-review queue (docs/DOMAIN_ALIAS_SUGGESTIONS.md), which needs a box
// endpoint that is not installed yet. Display fields only — never an email address.
import { NextResponse } from "next/server";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { resolveDeskWithRedirect, type DeskContact } from "@/lib/deskResolve";
import { resolveHostRedirect } from "@/lib/hostRedirect";
import { deskFromDealership } from "@/lib/quotePackage";
import { classifyPaste } from "@/lib/pasteImport";
import type { Dealership } from "@/lib/dealershipsApi";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const kind = classifyPaste(url);
  if (kind.kind === "invalid") {
    return NextResponse.json({ status: "invalid", error: kind.error, reason: kind.reason }, { status: 422 });
  }

  let contacts: Dealership[] = [];
  let degraded = false;
  try {
    contacts = await cachedDealerDirectory();
  } catch {
    degraded = true;
  }
  const knownNamed = (row: DeskContact) => Boolean(deskFromDealership(row as Dealership)?.knownNamed);
  const resolution = await resolveDeskWithRedirect(url, contacts, knownNamed, resolveHostRedirect);

  return NextResponse.json({ ...resolution, degraded });
}
