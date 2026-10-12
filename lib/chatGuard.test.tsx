// The Next side of the conversation guard: the AI check for borderline messages and its 3-second fallback, the send flow (screen -> AI ->
// held / blocked / delivered), the strike email to Paul through the SAFE MODE sender, the buyer's Report, the admin queue and the notice
// above the compose box. The rules, strikes and queue themselves are tested against the deals-server modules in
// scrapers/lightsail-crawler/test/rfqChatGuard.test.js.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AI_TIMEOUT_MS, aiBorderlineCheck, BLOCKED_NOTE, COMPOSE_NOTICE, FIRST_WARNING, HELD_NOTE, parseAiVerdict, PAUSED_NOTE, STRIKE_LIMIT, STRIKE_WINDOW_DAYS } from "./chatGuard";
import { sendWithGuard } from "./chatSend";
import { buildChatPauseNotice } from "./chatGuardNotice";
import { SAFE_MODE_RECIPIENT } from "./dealerEmail";
import type { ChatPostResult } from "./rfqApi";
import { DealThreadPanel } from "../components/DealThreadPanel";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const okJson = (text: string) => ({ ok: true, json: async () => ({ content: [{ type: "text", text }] }) }) as unknown as Response;

describe("the copy", () => {
  it("is exactly what was asked for", () => {
    assert.equal(COMPOSE_NOTICE, "Contact details are shared automatically when the buyer accepts the final deal. Sharing them earlier breaks TrimScout's terms.");
    assert.equal(BLOCKED_NOTE, "This message wasn't sent because it looks like contact information.");
    assert.equal(STRIKE_LIMIT, 3); assert.equal(STRIKE_WINDOW_DAYS, 30); assert.equal(AI_TIMEOUT_MS, 3000);
    assert.match(FIRST_WARNING, /breaks TrimScout's terms/);
    assert.match(PAUSED_NOTE, /paused/);
  });
});

describe("the AI check: yes / no / unavailable, never longer than 3 seconds", () => {
  const key = { apiKey: "test-key" };
  it("only a bare yes or no counts", () => {
    assert.equal(parseAiVerdict("yes"), "yes"); assert.equal(parseAiVerdict(" No. "), "no"); assert.equal(parseAiVerdict("YES!"), "yes");
    for (const bad of ["maybe", "I think yes", "", null, undefined, "yes, it shares a phone number"]) assert.equal(parseAiVerdict(bad), "unavailable");
  });
  it("asks the contact-info question, with only the message, and returns the verdict", async () => {
    let body: { messages: Array<{ content: string }> } | null = null;
    const yes = await aiBorderlineCheck("x y z", { ...key, fetchImpl: (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return okJson("yes"); }) as unknown as typeof fetch });
    assert.equal(yes, "yes");
    assert.match(body!.messages[0].content, /Does this message attempt to share personal contact info or identity/);
    assert.match(body!.messages[0].content, /x y z/);
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: (async () => okJson("no")) as unknown as typeof fetch }), "no");
  });
  it("an error, a bad status, a garbled answer, or no key is 'unavailable' (so the message is held, not delivered)", async () => {
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch }), "unavailable");
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch }), "unavailable");
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: (async () => okJson("hmm, hard to say")) as unknown as typeof fetch }), "unavailable");
    assert.equal(await aiBorderlineCheck("x", { apiKey: "", fetchImpl: (async () => okJson("no")) as unknown as typeof fetch }), "unavailable");
  });
  it("a call that takes longer than the limit is 'unavailable', even if it would have said no", async () => {
    const slow = (async (_u: string, init: RequestInit) => new Promise<Response>((resolve) => { setTimeout(() => resolve(okJson("no")), 400); init.signal?.addEventListener("abort", () => {}); })) as unknown as typeof fetch;
    const started = Date.now();
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: slow, timeoutMs: 40 }), "unavailable");
    assert.ok(Date.now() - started < 300, "gave up at the limit instead of waiting");
    // and a fetch that never settles at all
    assert.equal(await aiBorderlineCheck("x", { ...key, fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch, timeoutMs: 30 }), "unavailable");
  });
  it("uses the existing Anthropic setup and the 3 second default", () => {
    const src = read("lib/chatGuard.ts");
    assert.match(src, /serverSecret\("ANTHROPIC_API_KEY"\)/);
    assert.match(src, /AI_TIMEOUT_MS = 3000/);
    assert.match(src, /CHAT_AI_REVIEW_MODEL/);
  });
});

describe("sending a message through the guard", () => {
  const base = { rfqId: "7", inviteId: "11", from: "dealer" as const, text: "x y z w v", dealerName: "Alpha Motors" };
  const scripted = (...replies: ChatPostResult[]) => {
    const calls: Array<{ aiVerdict?: string }> = [];
    return { calls, post: (async (_r: string, _i: string, input: { aiVerdict?: string }) => { calls.push({ aiVerdict: input.aiVerdict }); return replies[calls.length - 1]; }) as never };
  };
  it("borderline: the box asks for a review, the AI answers, and the message is re-posted with the verdict", async () => {
    for (const [verdict, final, expected] of [["no", { status: "delivered" }, "delivered"], ["yes", { status: "blocked", note: BLOCKED_NOTE, warning: FIRST_WARNING, attempts: 1, paused: false, justPaused: false }, "blocked"], ["unavailable", { status: "held", note: HELD_NOTE }, "held"]] as const) {
      const s = scripted({ status: "needs_review" }, final as ChatPostResult);
      const out = await sendWithGuard(base, { post: s.post, check: async () => verdict });
      assert.equal(out.status, expected);
      assert.deepEqual(s.calls.map((c) => c.aiVerdict), [undefined, verdict]);
    }
  });
  it("when the AI call times out the message is held for an admin, never delivered", async () => {
    const s = scripted({ status: "needs_review" }, { status: "held", note: HELD_NOTE });
    const out = await sendWithGuard(base, { post: s.post, check: () => aiBorderlineCheck("x", { apiKey: "k", fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch, timeoutMs: 20 }) });
    assert.equal(out.status, "held");
    assert.equal(s.calls[1].aiVerdict, "unavailable");
  });
  it("a refused message comes back as the plain note — never its text — with the first-attempt warning for a dealer", async () => {
    const s = scripted({ status: "blocked", note: BLOCKED_NOTE, warning: FIRST_WARNING, attempts: 1, paused: false, justPaused: false });
    const out = await sendWithGuard({ ...base, text: "call me 201-555-0147" }, { post: s.post });
    assert.equal(out.status, "blocked");
    if (out.status === "blocked") { assert.equal(out.note, BLOCKED_NOTE); assert.equal(out.warning, FIRST_WARNING); }
    assert.doesNotMatch(JSON.stringify(out), /201-555/);
  });
  it("the attempt that pauses a dealer emails Paul once, through the SAFE MODE sender; nothing else does", async () => {
    const sent: Array<{ subject: string; html: string } | null> = [];
    const notify = (async (n: { subject: string; html: string } | null) => { sent.push(n); return true; }) as never;
    const third: ChatPostResult = { status: "blocked", note: BLOCKED_NOTE, warning: null, attempts: 3, paused: true, justPaused: true };
    await sendWithGuard({ ...base, text: "text me" }, { post: scripted(third).post, notify });
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.subject, /^\[SAFE MODE\] Dealer chat paused: Alpha Motors$/);
    assert.match(sent[0]!.html, /SAFE MODE:<\/strong>/);
    assert.match(sent[0]!.html, /3 messages blocked/);
    assert.match(sent[0]!.html, /\/admin\/chat-review/);
    assert.doesNotMatch(sent[0]!.html, /text me/, "the blocked text is never in the email");
    await sendWithGuard({ ...base, text: "text me" }, { post: scripted({ ...third, justPaused: false }).post, notify });
    await sendWithGuard({ ...base, from: "buyer", text: "text me" }, { post: scripted(third).post, notify });
    assert.equal(sent.length, 1, "no email for an ordinary block, an already-paused dealer, or a buyer");
    assert.equal(SAFE_MODE_RECIPIENT, "pausmi@outlook.com");
    assert.match(read("lib/dealerEmail.ts"), /export async function sendChatPauseNotice[\s\S]*?sendViaResend\(notice\.subject, notice\.html\)/);
    assert.match(buildChatPauseNotice({ dealerName: "A <b>", attempts: 3, adminUrl: "https://x" }).html, /A &lt;b&gt;/);
  });
  it("a paused dealer is told so", async () => {
    const out = await sendWithGuard(base, { post: scripted({ status: "paused", note: PAUSED_NOTE }).post });
    assert.deepEqual(out, { status: "paused", note: PAUSED_NOTE });
  });
});

describe("the report flow", () => {
  it("the buyer's Report posts to the buyer-authenticated report route, which checks the buyer owns the request and the invite is theirs", () => {
    const r = read("app/api/rfqs/[id]/invites/[inviteId]/thread/report/route.ts");
    assert.match(r, /hasBuyerCredential\(session, req\)/);
    assert.match(r, /rfq\.buyerUserId !== buyer\.id/);
    assert.match(r, /rfq\.invites\.some\(\(i\) => i\.id === inviteId\)/);
    assert.match(r, /reportChatMessage\(id, inviteId, messageId\)/);
  });
  it("the panel shows Report on the dealer's chat messages for the buyer only, and a confirmation once sent", () => {
    const entries = [
      { id: "msg-a", at: "2026-10-11T10:00:00Z", side: "dealer", kind: "message", text: "Held for you.", messageId: "a" },
      { id: "msg-b", at: "2026-10-11T10:01:00Z", side: "buyer", kind: "message", text: "Thanks", messageId: "b" },
      { id: "note", at: "2026-10-11T09:00:00Z", side: "dealer", kind: "note", text: "A note on the deal" },
    ] as never;
    const data = (viewer: "buyer" | "dealer") => ({ viewer, entries, canPost: true, readOnlyReason: null, finalAccepted: false, messaging: true, otherParty: "Alpha" });
    const buyer = renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer="buyer" seenKey="k" heading="c" initial={data("buyer")} />);
    assert.equal((buyer.match(/data-testid="thread-report"/g) || []).length, 1, "only the dealer's chat message, not the buyer's own or a note");
    const dealer = renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer="dealer" seenKey="k" heading="c" initial={data("dealer")} />);
    assert.doesNotMatch(dealer, /thread-report/);
    const src = read("components/DealThreadPanel.tsx");
    assert.match(src, /fetch\(`\$\{endpoint\}\/report`/);
    assert.match(src, /data-testid="thread-reported"/);
  });
});

describe("the notice above the compose box, for both sides", () => {
  const data = (viewer: "buyer" | "dealer", over = {}) => ({ viewer, entries: [], canPost: true, readOnlyReason: null, finalAccepted: false, messaging: true, otherParty: "x", ...over });
  for (const viewer of ["buyer", "dealer"] as const) {
    it(`${viewer}: shows it, above the compose box`, () => {
      const html = renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer={viewer} seenKey="k" heading="c" initial={data(viewer)} />);
      assert.ok(html.includes(COMPOSE_NOTICE.replace("'", "&#x27;")), "the notice text");
      assert.ok(html.indexOf('data-testid="thread-compose-notice"') < html.indexOf('data-testid="thread-compose"'), "above the box");
    });
  }
  it("a paused dealer sees why, and cannot type", () => {
    const html = renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer="dealer" seenKey="k" heading="c" initial={data("dealer", { canPost: false, readOnlyReason: PAUSED_NOTE, paused: true })} />);
    assert.ok(html.includes("Chat is paused for your dealership"));
    assert.match(html, /data-testid="thread-compose"[^>]*disabled/);
  });
  it("shows the sender the plain note, the first-attempt warning and the held note; the refused text is never echoed", () => {
    const src = read("components/DealThreadPanel.tsx");
    assert.match(src, /o\?\.status === "blocked"/);
    assert.match(src, /\.\.\.\(o\.warning \? \[o\.warning\] : \[\]\)/);
    assert.match(src, /o\?\.status === "held" \|\| o\?\.status === "paused"/);
    assert.match(src, /data-testid="thread-notice"/);
  });
});

describe("the admin review queue", () => {
  it("lists held and reported messages with Release and Block, and the paused dealers with Lift; admin session only", () => {
    const page = read("app/admin/chat-review/page.tsx");
    assert.match(page, /role !== "admin"\) redirect\("\/"\)/);
    const client = read("app/admin/chat-review/ChatReviewClient.tsx");
    for (const id of ["chat-review-queue", "chat-review-item", "chat-review-release", "chat-review-block", "chat-pauses", "chat-pause-lift"]) assert.match(client, new RegExp(`data-testid="${id}"`), id);
    assert.match(client, /Reported by the buyer/);
    assert.match(client, /Held for review/);
    for (const f of ["app/api/admin/chat-review/route.ts", "app/api/admin/chat-review/[id]/route.ts", "app/api/admin/chat-pauses/route.ts"]) {
      assert.match(read(f), /requireAdminSession\(\)/, f);
    }
    assert.match(read("app/api/admin/chat-review/[id]/route.ts"), /if \(r\.justPaused\) await sendChatPauseNotice/);
    assert.match(read("app/admin/AdminClient.tsx"), /href="\/admin\/chat-review"/);
  });
  it("the box side: queue, decision, pause list and lift routes are installed by the guard patch", () => {
    const patch = read("scripts/box/2026-10-12-rfq-chat-guard.sh");
    for (const r of ["/api/admin/chat-review", "/api/admin/chat-pauses/lift", "chat-status"]) assert.ok(patch.includes(r), r);
  });
});

describe("env vars and docs", () => {
  it("the new switches are documented next to the existing key", () => {
    const env = read(".env.example");
    for (const name of ["ANTHROPIC_API_KEY", "CHAT_AI_REVIEW", "CHAT_AI_REVIEW_MODEL"]) assert.ok(env.includes(name), name);
    const doc = read("docs/DEAL_THREAD_AND_FEE_OVERRIDES.md");
    assert.match(doc, /2026-10-12-rfq-chat-guard\.sh/);
  });
});
