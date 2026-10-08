// /api/trade/draft — the buyer's in-progress trade-in.
//   POST            start a draft → { draftId, token, resumePath }
//   GET ?latest=1   the signed-in buyer's latest unsent draft (resume on any device) → { draft, token } | { draft: null }
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireBuyerLogin } from "@/lib/buyerAccess";
import { s3Storage } from "@/lib/trade/storage";
import { createDraft, draftToken, latestDraftFor } from "@/lib/trade/service";
import { tradeErrorResponse, uploadRateLimited } from "@/lib/trade/routeKit";

async function buyer() {
  const session = await auth();
  const u = session?.user as { id?: string; role?: string; email?: string | null } | undefined;
  return u?.id && u.role === "buyer" ? u : null;
}

export async function POST(req: Request) {
  const user = await buyer();
  if (!user && requireBuyerLogin()) return NextResponse.json({ error: "Sign in to add a trade-in." }, { status: 401 });
  const limited = uploadRateLimited(req, "draft-create", user);
  if (limited) return limited;
  try {
    const draft = await createDraft(s3Storage, user?.id ?? null);
    const token = draftToken(draft.id);
    return NextResponse.json({ draftId: draft.id, token, resumePath: `/trade/draft/${draft.id}?k=${token}` });
  } catch (err) {
    return tradeErrorResponse(err);
  }
}

export async function GET(req: Request) {
  const user = await buyer();
  if (!user) return NextResponse.json({ draft: null });
  try {
    const found = await latestDraftFor(s3Storage, user.id as string);
    return NextResponse.json(found ? { draft: { id: found.draft.id, fields: found.draft.fields, photos: found.draft.photos, updatedAt: found.draft.updatedAt }, token: found.token } : { draft: null });
  } catch (err) {
    return tradeErrorResponse(err);
  }
}
