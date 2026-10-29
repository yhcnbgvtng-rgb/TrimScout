// GET  /api/quote-invite/thread?t=…        — the dealer's own conversation with the buyer on this quote.
// POST /api/quote-invite/thread { t, text } — the dealer posts a message on it (screened: lib/chatSend.ts).
// Behind the invite's tracked-link token, like the rest of the quote page. The thread is built from THIS invite only
// (lib/dealThread.ts), so one dealer never sees another's words. Nothing identifying goes through: the deals server refuses names, phone
// numbers in any form, emails, handles, other links and files, logs the attempt (a warning on the first, a pause on the third in 30 days)
// and the blocked text is never shown to the buyer.
import { NextResponse, after } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getChatPaused, getRfq, getRfqInviteByViewToken, RfqApiError } from "@/lib/rfqApi";
import { buildThread, canPostToThread, isFinallyAccepted, MAX_CHAT_LENGTH } from "@/lib/dealThread";
import { hasAttachment } from "@/lib/identityFilter";
import { PAUSED_NOTE } from "@/lib/chatGuard";
import { sendWithGuard } from "@/lib/chatSend";
import { notifyNewMessage } from "@/lib/noticeOutbox";

const TOKEN = /^[A-Za-z0-9_-]{8,80}$/;

async function load(token: string) {
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return null;
  const rfq = await getRfq(found.rfqId).catch(() => null);
  if (!rfq) return null;
  const invite = rfq.invites.find((i) => i.id === found.invite.id);
  return invite ? { rfq, invite, rfqId: found.rfqId } : null;
}

type Row = NonNullable<Awaited<ReturnType<typeof load>>>;

async function payload(row: Row, readOnlyReason: string | null) {
  const gate = canPostToThread(row.rfq, row.invite);
  const paused = await getChatPaused(row.rfqId, row.invite.id);
  return {
    viewer: "dealer" as const,
    entries: buildThread(row.rfq, row.invite, "dealer"),
    canPost: gate.ok && !readOnlyReason && !paused,
    readOnlyReason: readOnlyReason ?? (paused ? PAUSED_NOTE : gate.ok ? null : gate.reason),
    paused,
    finalAccepted: isFinallyAccepted(row.rfq, row.invite),
    // Whether the box can store chat yet (needs the rfq-messages patch). Reading never depends on it.
    messaging: Array.isArray(row.invite.messages),
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
  return NextResponse.json(await payload(row, preview ? "Admin preview — read-only." : null));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!TOKEN.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  if (hasAttachment(body)) return NextResponse.json({ error: "No images or files in chat." }, { status: 400 });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (text.length > MAX_CHAT_LENGTH) return NextResponse.json({ error: `Keep messages under ${MAX_CHAT_LENGTH} characters.` }, { status: 400 });
  const row = await load(token);
  if (!row) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const gate = canPostToThread(row.rfq, row.invite);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 });
  try {
    const outcome = await sendWithGuard({ rfqId: row.rfqId, inviteId: row.invite.id, from: "dealer", text, dealerName: row.invite.dealerName });
    const fresh = await getRfq(row.rfqId);
    const invite = fresh?.invites.find((i) => i.id === row.invite.id) ?? row.invite;
    // Only a delivered message earns an email, and the email never carries its text.
    if (outcome.status === "delivered") after(() => notifyNewMessage(fresh ?? row.rfq, invite, "buyer"));
    return NextResponse.json({ ...(await payload({ rfq: fresh ?? row.rfq, invite, rfqId: row.rfqId }, null)), outcome });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not send that message." }, { status });
  }
}
