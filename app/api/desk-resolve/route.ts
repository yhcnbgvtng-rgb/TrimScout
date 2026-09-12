// POST /api/desk-resolve { url } — which dealer desk a pasted vehicle-page
// link belongs to, from its hostname and the contacts on file. The pasted
// page is never requested; when no domain on file matches, only the site's
// ORIGIN is asked where it redirects (lib/hostRedirect.ts), so a store that
// moved from freedomfordnj.com to freedomfordusa.com still resolves. A
// match made that way is remembered on the desk (domains[]) so the next
// paste is an exact hit. Display fields only — never an email address.
import { NextResponse } from "next/server";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { resolveDeskWithRedirect, type DeskContact } from "@/lib/deskResolve";
import { resolveHostRedirect } from "@/lib/hostRedirect";
import { deskFromDealership } from "@/lib/quotePackage";
import { classifyPaste } from "@/lib/pasteImport";
import { updateDealership, type Dealership } from "@/lib/dealershipsApi";

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

  if (resolution.status === "unique" && resolution.via === "redirect" && resolution.aliasHosts?.length) {
    // Best-effort: persist both hosts as aliases so this becomes an exact
    // domain hit next time. A box that predates the column just ignores it.
    const row = contacts.find((c) => c.id === resolution.desk.deskId);
    if (row) {
      const domains = Array.from(new Set([...(row.domains || []), ...resolution.aliasHosts]));
      if (domains.length !== (row.domains || []).length) {
        const { id: _id, createdAt: _c, updatedAt: _u, emailOptOut: _o, ...input } = row;
        void updateDealership(row.id, { ...input, domains }).catch(() => undefined);
      }
    }
  }

  return NextResponse.json({ ...resolution, degraded });
}
