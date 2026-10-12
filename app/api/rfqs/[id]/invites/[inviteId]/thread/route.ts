// GET  /api/rfqs/:id/invites/:inviteId/thread        — the buyer's conversation with ONE dealer on their request.
// POST /api/rfqs/:id/invites/:inviteId/thread { text } — the buyer posts a message to that dealer.
// One thread per dealer, never merged (lib/dealThread.ts builds it from that invite only). Buyer-authenticated like the
// stage route; the other desks' quotes, notes and messages are not reachable from here. Contact details are refused.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, postRfqMessage, RfqApiError } from "@/lib/rfqApi";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { buildThread, canPostToThread, isFinallyAccepted, MAX_CHAT_LENGTH } from "@/lib/dealThread";
import { findContactInfo } from "@/lib/piiFilter";

async function authorize(req: Request, id: string, inviteId: string) {
  const session = await auth();
  if (!hasBuyerCredential(session, req) || (session?.user && (session.user as { role?: string }).role !== "buyer")) {
    return { error: NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 }) };
  }
  const rfq = await getRfq(id);
  if (!rfq) return { error: NextResponse.json({ error: "RFQ not found." }, { status: 404 }) };
  const buyer = buyerForRfq(session, req, rfq);
  if (!buyer) return { error: NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 }) };
  if (rfq.buyerUserId !== buyer.id) return { error: NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 }) };
  const invite = rfq.invites.find((i) => i.id === inviteId);
  if (!invite) return { error: NextResponse.json({ error: "Dealer not found on this request." }, { status: 404 }) };
  return { rfq, invite };
}

function payload(rfq: NonNullable<Awaited<ReturnType<typeof getRfq>>>, invite: NonNullable<Awaited<ReturnType<typeof getRfq>>>["invites"][number]) {
  const gate = canPostToThread(rfq, invite);
  return {
    viewer: "buyer" as const,
    entries: buildThread(rfq, invite, "buyer"),
    canPost: gate.ok,
    readOnlyReason: gate.ok ? null : gate.reason,
    finalAccepted: isFinallyAccepted(rfq, invite),
    messaging: Array.isArray(invite.messages),
    otherParty: invite.dealerName,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id, inviteId } = await params;
  const a = await authorize(req, id, inviteId).catch(() => ({ error: NextResponse.json({ error: "Could not load this conversation." }, { status: 502 }) }));
  if ("error" in a) return a.error;
  return NextResponse.json(payload(a.rfq, a.invite));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (text.length > MAX_CHAT_LENGTH) return NextResponse.json({ error: `Keep messages under ${MAX_CHAT_LENGTH} characters.` }, { status: 400 });
  const found = findContactInfo(text);
  if (found) return NextResponse.json({ error: `Messages can't include ${found} — TrimScout passes them along without sharing your contact details.` }, { status: 400 });
  const a = await authorize(req, id, inviteId).catch(() => ({ error: NextResponse.json({ error: "Could not send that message." }, { status: 502 }) }));
  if ("error" in a) return a.error;
  const gate = canPostToThread(a.rfq, a.invite);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 });
  try {
    await postRfqMessage(id, inviteId, { kind: "message", from: "buyer", text });
    const fresh = await getRfq(id);
    const invite = fresh?.invites.find((i) => i.id === inviteId) ?? a.invite;
    return NextResponse.json(payload(fresh ?? a.rfq, invite));
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not send that message." }, { status });
  }
}
