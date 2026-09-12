// POST /api/desk-resolve { url } — which dealer desk a pasted vehicle-page
// link belongs to, from its hostname and the contacts on file. This route
// never requests the pasted URL: dealer sites sit behind Cloudflare and the
// buyer's own browser is the only visitor. Answers with display fields
// only — never an email address.
import { NextResponse } from "next/server";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { resolveDeskFromVdpUrl, type DeskContact } from "@/lib/deskResolve";
import { deskFromDealership } from "@/lib/quotePackage";
import { classifyPaste } from "@/lib/pasteImport";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const kind = classifyPaste(url);
  if (kind.kind === "invalid") {
    return NextResponse.json({ status: "invalid", error: kind.error, reason: kind.reason }, { status: 422 });
  }

  let contacts: DeskContact[] = [];
  let degraded = false;
  try {
    contacts = await cachedDealerDirectory();
  } catch {
    degraded = true;
  }
  const resolution = resolveDeskFromVdpUrl(url, contacts, (row) => Boolean(deskFromDealership(row)?.knownNamed));
  return NextResponse.json({ ...resolution, degraded });
}
