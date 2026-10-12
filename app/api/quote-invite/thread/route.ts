// GET  /api/quote-invite/thread?t=…        — the dealer's own conversation with the buyer on this quote.
// POST /api/quote-invite/thread { t, text } — the dealer posts a message on it.
// Behind the invite's tracked-link token, like the rest of the quote page. The thread is built from THIS invite only
// (lib/dealThread.ts), so one dealer never sees another's words, and the buyer's contact details are never in it: a
// message with an email, phone or link is refused, and old buyer notes that carry one are blanked until the deal is final.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, getRfqInviteByViewToken, postRfqMessage, RfqApiError } from "@/lib/rfqApi";
import { buildThread, canPostToThread, isFinallyAccepted, MAX_CHAT_LENGTH } from "@/lib/dealThread";
import { findIdentityInfo } from "@/lib/identityFilter";

const TOKEN = /^[A-Za-z0-9_-]{8,80}$/;

async function load(token: string) {
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return null;
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return null;
  const invite = rfq.invites.find((i) => i.id === found.invite.id);
  return invite ? { rfq, invite, rfqId: found.rfqId } : null;
}

function payload(rfq: NonNullable<Awaited<ReturnType<typeof load>>>["rfq"], invite: NonNullable<Awaited<ReturnType<typeof load>>>["invite"], readOnlyReason: string | null) {
  const gate = canPostToThread(rfq, invite);
  return {
    viewer: "dealer" as const,
    entries: buildThread(rfq, invite, "dealer"),
    canPost: gate.ok && !readOnlyReason,
    readOnlyReason: readOnlyReason ?? (gate.ok ? null : gate.reason),
    finalAccepted: isFinallyAccepted(rfq, invite),
    // Whether the box can store chat yet (needs the rfq-messages patch). Reading never depends on it.
    messaging: Array.isArray(invite.messages),
    otherParty: "Buyer",
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = (sp.get("t") || "").trim();
  const preview = sp.get("preview") === "1";
  if (preview && !(await requireAdminSession())) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  if (!TOKEN.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const row = await load(token);
  if (!row) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  return NextResponse.json(payload(row.rfq, row.invite, preview ? "Admin preview — read-only." : null));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!TOKEN.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (text.length > MAX_CHAT_LENGTH) return NextResponse.json({ error: `Keep messages under ${MAX_CHAT_LENGTH} characters.` }, { status: 400 });
  const found = findIdentityInfo(text);
  if (found) return NextResponse.json({ error: `Messages can't include ${found}. Names, phone numbers (even spelled out), emails and addresses can't be shared here.` }, { status: 400 });
  const row = await load(token);
  if (!row) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const gate = canPostToThread(row.rfq, row.invite);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 });
  try {
    await postRfqMessage(row.rfqId, row.invite.id, { kind: "message", from: "dealer", text });
    const fresh = await getRfq(row.rfqId);
    const invite = fresh?.invites.find((i) => i.id === row.invite.id) ?? row.invite;
    return NextResponse.json(payload(fresh ?? row.rfq, invite, null));
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not send that message." }, { status });
  }
}
