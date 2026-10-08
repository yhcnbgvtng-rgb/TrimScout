// POST /api/trade/draft/:id/photos?k=<token> — { op: "sign" | "confirm" | "remove", slot, width?, height?, capturedAt? }
//   sign     → a presigned PUT for trade/{id}/{slot}.jpg (JPEG only; the browser resizes + strips EXIF first)
//   confirm  → verify the object landed (size, type, dimensions) and record it on the draft
//   remove   → drop an optional or replaced photo
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { s3Storage } from "@/lib/trade/storage";
import { confirmPhoto, loadDraft, presignPhotoUpload, recordDraftPhoto, removeDraftPhoto, TradeError } from "@/lib/trade/service";
import { signTradePhotos } from "@/lib/trade/access";
import { tradeErrorResponse, uploadRateLimited } from "@/lib/trade/routeKit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().catch(() => null);
  const limited = uploadRateLimited(req, `draft:${id}`, session?.user as { id?: string; email?: string | null; role?: string } | undefined);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const draft = await loadDraft(s3Storage, id, new URL(req.url).searchParams.get("k"));
    if (draft.consumedRfqId) throw new TradeError("This trade-in was already sent with a request.", 409);
    const scope = { kind: "draft" as const, id };
    if (body?.op === "sign") return NextResponse.json(await presignPhotoUpload(s3Storage, scope, body.slot));
    if (body?.op === "confirm") {
      const photo = await confirmPhoto(s3Storage, scope, body.slot, body);
      const next = await recordDraftPhoto(s3Storage, draft, photo);
      return NextResponse.json({ photos: next.photos, signed: await signTradePhotos(s3Storage, [photo]) });
    }
    if (body?.op === "remove") {
      const next = await removeDraftPhoto(s3Storage, draft, body.slot);
      return NextResponse.json({ photos: next.photos });
    }
    return NextResponse.json({ error: "Unknown photo operation." }, { status: 400 });
  } catch (err) {
    return tradeErrorResponse(err);
  }
}
