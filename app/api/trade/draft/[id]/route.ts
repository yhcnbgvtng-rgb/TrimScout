// /api/trade/draft/:id?k=<token>
//   GET  the draft's fields + photos (with short-lived signed thumbnails) — how the phone and the desktop stay in sync
//   PUT  { fields } autosave the form
// The token is the capability; guests and the phone hand-off use it without logging in.
import { NextResponse } from "next/server";
import { s3Storage } from "@/lib/trade/storage";
import { loadDraft, saveDraftFields } from "@/lib/trade/service";
import { signTradePhotos } from "@/lib/trade/access";
import { tradeErrorResponse, uploadRateLimited } from "@/lib/trade/routeKit";

const tokenOf = (req: Request) => new URL(req.url).searchParams.get("k");

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const draft = await loadDraft(s3Storage, id, tokenOf(req));
    return NextResponse.json({ draft: { id: draft.id, fields: draft.fields, photos: draft.photos, updatedAt: draft.updatedAt, sent: Boolean(draft.consumedRfqId) }, signed: await signTradePhotos(s3Storage, draft.photos) });
  } catch (err) {
    return tradeErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limited = uploadRateLimited(req, `draft:${id}`);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const draft = await loadDraft(s3Storage, id, tokenOf(req));
    const saved = await saveDraftFields(s3Storage, draft, body?.fields);
    return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (err) {
    return tradeErrorResponse(err);
  }
}
