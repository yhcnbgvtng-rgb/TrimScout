// The chat-style panel on the deal and quote screens: the full buyer/dealer history from what the deal already stores, system
// events as small inline notes, the right side for each party, unread counting, isolation between dealers, and the privacy rule
// (the buyer's contact details are never shown before the deal is final).
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bubbleAlign, buildThread, canPostToThread, isFinallyAccepted, REDACTED_BUYER_TEXT, unreadCount, type ThreadEntry } from "./dealThread";
import { DealThreadPanel } from "../components/DealThreadPanel";
import { normalizeFeeOverrides } from "./feeOverride";
import type { RfqInvite, RfqRequest } from "./rfq";
import type { UsedCashQuote } from "./usedQuote";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const FUTURE = "2099-01-01T00:00:00Z";
const lines = (tax: number) => [{ name: "Sales tax", amount: tax }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 660 }];
const used = (tax = 2650, over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: 40000, dueAtSigning: lines(tax), addOns: [], noAddOns: true, rebates: [], miles: null, stockNumber: null, cpo: false, expiresAt: FUTURE, ...over });
const overrides = normalizeFeeOverrides({ dueAtSigning: lines(2750), sellingPrice: 40000, addOns: [], zip: "07405", submitted: [{ key: "sales_tax", reason: "county rate 6.875%" }], now: new Date("2026-10-11T10:30:00Z") }).overrides;

const invite = (id: string, name: string, over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: "2026-10-11T00:00:00Z", respondedAt: null, viewToken: `tok${id}abcdefghij`,
    quote: { id: `q${id}`, inviteId: id, dealerName: name, price: 40000, fees: [], totalOtdPrice: 44109, vin: "V", stockNumber: null, expiresAt: FUTURE, submittedAt: "2026-10-11T09:00:00Z", mustHaveAcknowledgement: true, notes: `${name} note: fresh off the truck`, used: used() },
    ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "9001", vin: "V", status: "collecting", pickedQuoteId: null, createdAt: "2026-10-10T08:00:00Z", buyerNote: "Looking to buy this week.", invites, ...over }) as unknown as RfqRequest;

const A = invite("1", "Alpha Motors", {
  messages: [{ id: "m1", from: "buyer", text: "Can you hold it until Friday?", at: "2026-10-11T11:00:00Z" }, { id: "m2", from: "dealer", text: "Yes, held for you.", at: "2026-10-11T11:05:00Z" }],
  buyerCounter: { againstQuoteId: "q1", note: "Best you can do on the price?", sentAt: "2026-10-11T10:00:00Z", sheet: null } as never,
  stage: { stage: "trade", log: [{ at: "2026-10-11T12:00:00Z", actor: "buyer", type: "accept_otd", amount: 44109 }, { at: "2026-10-11T12:10:00Z", actor: "dealer", type: "trade_offer", value: 9000 }] } as never,
});
const B = invite("2", "Bravo Autos", { messages: [{ id: "m9", from: "buyer", text: "BRAVO-ONLY secret message", at: "2026-10-11T11:30:00Z" }] });
Object.assign(A.quote!, { used: used(2750, { feeOverrides: overrides }) });

describe("what's on the thread", () => {
  const rfq = rfqOf([A, B]);
  const t = buildThread(rfq, A, "buyer");
  it("has the buyer's note, the dealer's quote note, the counter and its note, chat, and inline system events — oldest first", () => {
    const text = t.map((e) => `${e.side}/${e.kind}: ${e.text}`);
    assert.ok(text.includes("buyer/note: Looking to buy this week."));
    assert.ok(text.includes("dealer/note: Alpha Motors note: fresh off the truck"));
    assert.ok(text.includes("buyer/note: Best you can do on the price?"));
    assert.ok(text.includes("buyer/message: Can you hold it until Friday?"));
    assert.ok(text.includes("dealer/message: Yes, held for you."));
    const events = t.filter((e) => e.side === "system").map((e) => e.text);
    assert.ok(events.some((e) => /Dealer sent a quote: \$44,209 out the door/.test(e)), "quote");
    assert.ok(events.some((e) => /Buyer sent a counter/.test(e)), "counter");
    assert.ok(events.some((e) => /Dealer adjusted a fee — Sales tax: TrimScout \$2,650 → dealer \$2,750 \(\+\$100\) — county rate 6.875%/.test(e)), "override");
    assert.ok(events.includes("Buyer locked the out-the-door price at $44,109"), "accept");
    assert.ok(events.includes("Dealer offered $9,000 for the trade-in"), "trade-in value");
    assert.deepEqual(t.map((e) => e.at), [...t.map((e) => e.at)].sort());
  });
  it("shows a counter the dealer accepted", () => {
    const accepted = invite("3", "Charlie", { quote: { ...A.quote!, id: "q3", used: used(2650, { counterAccepted: { counterSentAt: "2026-10-11T10:00:00Z", acceptedAt: "2026-10-11T10:45:00Z" } }) } as never });
    assert.ok(buildThread(rfqOf([accepted]), accepted, "buyer").some((e) => e.text === "Dealer accepted the buyer's counter"));
  });
  it("puts each side where it belongs: yours on the right, theirs on the left, events centered", () => {
    assert.equal(bubbleAlign("buyer", "buyer"), "mine");
    assert.equal(bubbleAlign("dealer", "buyer"), "theirs");
    assert.equal(bubbleAlign("dealer", "dealer"), "mine");
    assert.equal(bubbleAlign("buyer", "dealer"), "theirs");
    assert.equal(bubbleAlign("system", "dealer"), "center");
  });
  it("counts only the other side's messages after you last looked; system lines never count", () => {
    const e: ThreadEntry[] = [
      { id: "1", at: "2026-10-11T10:00:00Z", side: "dealer", kind: "message", text: "a" },
      { id: "2", at: "2026-10-11T11:00:00Z", side: "buyer", kind: "message", text: "b" },
      { id: "3", at: "2026-10-11T12:00:00Z", side: "system", kind: "event", text: "c" },
      { id: "4", at: "2026-10-11T13:00:00Z", side: "dealer", kind: "note", text: "d" },
    ];
    assert.equal(unreadCount(e, "buyer", null), 2);
    assert.equal(unreadCount(e, "buyer", "2026-10-11T10:30:00Z"), 1);
    assert.equal(unreadCount(e, "buyer", "2026-10-11T14:00:00Z"), 0);
    assert.equal(unreadCount(e, "dealer", null), 1);
  });
});

describe("isolation: each dealer sees only their own thread", () => {
  const rfq = rfqOf([A, B]);
  it("dealer A's thread never contains dealer B's messages, notes, quote or events — and the reverse", () => {
    const forA = JSON.stringify(buildThread(rfq, A, "dealer"));
    const forB = JSON.stringify(buildThread(rfq, B, "dealer"));
    assert.doesNotMatch(forA, /BRAVO-ONLY|Bravo/);
    assert.match(forA, /Alpha Motors note/);
    assert.doesNotMatch(forB, /Can you hold it until Friday|Alpha|held for you|county rate/);
    assert.match(forB, /BRAVO-ONLY/);
  });
  it("the buyer gets one thread per dealer, never merged", () => {
    const a = JSON.stringify(buildThread(rfq, A, "buyer"));
    assert.doesNotMatch(a, /BRAVO-ONLY/);
  });
  it("the routes read exactly one invite: the dealer's by its own token, the buyer's by the id in the URL", () => {
    const d = read("app/api/quote-invite/thread/route.ts");
    assert.match(d, /getRfqInviteByViewToken\(token\)/);
    assert.match(d, /rfq\.invites\.find\(\(i\) => i\.id === found\.invite\.id\)/);
    assert.match(d, /buildThread\(row\.rfq, row\.invite, "dealer"\)/);
    assert.doesNotMatch(d, /rfq\.invites\.(map|filter|flatMap)/);
    const b = read("app/api/rfqs/[id]/invites/[inviteId]/thread/route.ts");
    assert.match(b, /rfq\.buyerUserId !== buyer\.id/);
    assert.match(b, /rfq\.invites\.find\(\(i\) => i\.id === inviteId\)/);
    assert.match(b, /buildThread\(rfq, invite, "buyer"\)/);
    assert.doesNotMatch(b, /rfq\.invites\.(map|filter|flatMap)/);
  });
  it("posting is token/buyer scoped and goes through the guard, never straight to the box", () => {
    for (const f of ["app/api/quote-invite/thread/route.ts", "app/api/rfqs/[id]/invites/[inviteId]/thread/route.ts"]) {
      const r = read(f);
      assert.match(r, /sendWithGuard\(/, f);
      assert.match(r, /canPostToThread\(/, f);
      assert.match(r, /hasAttachment\(body\)/, f);
      assert.doesNotMatch(r, /postChatMessage\(|postRfqMessage\(/, f);
    }
  });
});

describe("privacy: no buyer contact info before final acceptance", () => {
  const leaky = invite("1", "Alpha Motors", {
    buyerCounter: { againstQuoteId: "q1", note: "Call me at 201-555-0147 or jane.doe@gmail.com", sentAt: "2026-10-11T10:00:00Z", sheet: null } as never,
    messages: [{ id: "m1", from: "buyer", text: "text me 201-555-0147", at: "2026-10-11T11:00:00Z" }],
  });
  const note = rfqOf([leaky], { buyerNote: "Reach me at jane.doe@gmail.com" });
  it("blanks the buyer's own words that carry a phone, email or link, for the dealer", () => {
    const t = buildThread(note, leaky, "dealer");
    const blob = JSON.stringify(t);
    assert.doesNotMatch(blob, /555-0147|jane\.doe|gmail/);
    assert.equal(t.filter((e) => e.text === REDACTED_BUYER_TEXT).length, 3);
  });
  it("the buyer still sees their own words", () => {
    assert.match(JSON.stringify(buildThread(note, leaky, "buyer")), /555-0147/);
  });
  it("the thread carries no buyer identity at all — only the word 'Buyer'", () => {
    const blob = JSON.stringify(buildThread(rfqOf([A], { buyerUserId: "9001" }), A, "dealer"));
    assert.doesNotMatch(blob, /9001|buyerUserId|email|phone/i);
    assert.doesNotMatch(read("lib/dealThread.ts"), /buyerEmail|buyerPhone|buyerName|buyerUserId/);
    assert.doesNotMatch(read("app/api/quote-invite/thread/route.ts"), /buyerEmail|buyerPhone|buyerName|buyerUserId/);
  });
  it("final acceptance is only the buyer tapping Accept final deal (staged), or picked the quote (single sheet / lease)", () => {
    const st = (over: object) => ({ ...leaky, stage: over as never });
    assert.equal(isFinallyAccepted({ pickedQuoteId: null }, leaky), false);
    assert.equal(isFinallyAccepted({ pickedQuoteId: "q1" }, leaky), true, "no staged deal: the pick is the acceptance");
    assert.equal(isFinallyAccepted({ pickedQuoteId: "q99" }, leaky), false);
    assert.equal(isFinallyAccepted({ pickedQuoteId: null }, st({ stage: "closed", final: { status: "accepted" } })), true);
    assert.equal(isFinallyAccepted({ pickedQuoteId: null }, st({ stage: "closed" })), false, "closed without the final acceptance is not final");
    for (const stage of ["otd", "trade", "payment", "final"]) assert.equal(isFinallyAccepted({ pickedQuoteId: "q1" }, st({ stage })), false, `locking ${stage} is not final acceptance`);
  });
  it("the stage log's later steps read as inline notes, and the release is recorded as a fact only — never the details", () => {
    const staged = invite("1", "Alpha Motors", { stage: { stage: "closed", final: { status: "accepted" }, release: { at: "2026-10-11T15:00:00Z", contact: { name: "Jane Doe", email: "jane.doe@gmail.com", phone: "201-555-0147" } },
      trade: { counter: { value: 8500, at: "2026-10-11T12:20:00Z", note: "call me 201-555-0147" } },
      payment: { financeCounter: { apr: 5.9, termMonths: 60, monthly: 600, note: "Please do 5.9", at: "2026-10-11T13:00:00Z" } },
      log: [
        { at: "2026-10-11T12:15:00Z", actor: "dealer", type: "trade_hold", value: 9000 },
        { at: "2026-10-11T13:30:00Z", actor: "dealer", type: "finance_quote", apr: 6.5, termMonths: 60, monthly: 610 },
        { at: "2026-10-11T13:40:00Z", actor: "buyer", type: "finance_counter", apr: 5.9, termMonths: 60, monthly: 600 },
        { at: "2026-10-11T13:50:00Z", actor: "dealer", type: "finance_accept_counter", apr: 5.9, termMonths: 60, monthly: 600 },
        { at: "2026-10-11T14:59:00Z", actor: "buyer", type: "accept_final", trueOtd: 35000 },
        { at: "2026-10-11T15:00:00Z", actor: "system", type: "buyer_details_released" },
      ] } as never });
    const r = rfqOf([staged], { buyerNote: null });
    const forDealer = buildThread(r, staged, "dealer");
    const blob = JSON.stringify(forDealer);
    const events = forDealer.filter((e) => e.side === "system").map((e) => e.text);
    assert.ok(events.includes("Dealer held firm at $9,000 for the trade-in"));
    assert.ok(events.includes("Buyer countered financing at 5.9% for 60 mo — $600/mo"));
    assert.ok(events.includes("Financing agreed — $600/mo at 5.9%"));
    assert.ok(events.includes("Buyer accepted the final deal"));
    assert.ok(events.includes("Buyer details were released to the winning dealer"));
    assert.doesNotMatch(blob, /Jane|jane\.doe|gmail|555-0147/, "the release never leaks the contact into the thread");
    assert.ok(forDealer.some((e) => e.text === "Please do 5.9"), "a harmless buyer counter note is shown");
    assert.ok(forDealer.some((e) => e.text === REDACTED_BUYER_TEXT), "even after final acceptance a number typed into a note stays blanked: details only travel through the release");
  });
  it("before final acceptance a counter note carrying contact info is blanked for the dealer, but the buyer still sees their own words", () => {
    const pre = invite("1", "Alpha Motors", { stage: { stage: "trade", trade: { counter: { value: 8500, at: "2026-10-11T12:20:00Z", note: "call me 201-555-0147" } }, log: [] } as never });
    const r = rfqOf([pre], { buyerNote: null });
    assert.doesNotMatch(JSON.stringify(buildThread(r, pre, "dealer")), /555-0147/);
    assert.match(JSON.stringify(buildThread(r, pre, "buyer")), /555-0147/);
  });
  it("the panel doesn't pre-check or hint at what trips the filter: the server screens, logs and answers with a plain note", () => {
    const src = read("components/DealThreadPanel.tsx");
    assert.doesNotMatch(src, /findIdentityInfo|findContactInfo/);
    assert.match(src, /canSend = Boolean\(data\?\.canPost && data\.messaging\) && !sending && text\.trim\(\)\.length > 0;/);
  });
});

describe("who can post", () => {
  it("not on a walked request, a closed or declined desk, or after the dealer left", () => {
    assert.equal(canPostToThread({ status: "collecting" }, { status: "quoted" }).ok, true);
    assert.equal(canPostToThread({ status: "picked" }, { status: "quoted" }).ok, true);
    assert.equal(canPostToThread({ status: "walked" }, { status: "quoted" }).ok, false);
    assert.equal(canPostToThread({ status: "collecting" }, { status: "quoted", notSelectedAt: "x" }).ok, false);
    assert.equal(canPostToThread({ status: "collecting" }, { status: "declined" }).ok, false);
    assert.equal(canPostToThread({ status: "collecting" }, { status: "quoted", dealerUnsubscribedAt: "x" }).ok, false);
  });
});

describe("the panel", () => {
  const rfq = rfqOf([A]);
  const data = (viewer: "buyer" | "dealer", over = {}) => ({ viewer, entries: buildThread(rfq, A, viewer), canPost: true, readOnlyReason: null, finalAccepted: false, messaging: true, otherParty: viewer === "buyer" ? "Alpha Motors" : "Buyer", ...over });
  const render = (viewer: "buyer" | "dealer", over = {}) => renderToStaticMarkup(<DealThreadPanel endpoint="/x" viewer={viewer} seenKey="k" heading="Conversation" initial={data(viewer, over)} />);
  it("renders bubbles on the right sides with timestamps, inline event notes, the compose box and the mobile drawer button", () => {
    const html = render("buyer");
    assert.match(html, /data-testid="deal-thread"/);
    assert.match(html, /data-testid="thread-bubble-mine"[^>]*data-side="buyer"/);
    assert.match(html, /data-testid="thread-bubble-theirs"[^>]*data-side="dealer"/);
    assert.match(html, /data-testid="thread-event"/);
    assert.match(html, /Dealer adjusted a fee/);
    assert.match(html, /data-testid="thread-compose"/);
    assert.match(html, /data-testid="thread-send"/);
    assert.match(html, /data-testid="thread-open"/);
    assert.match(html, /lg:hidden/, "the drawer button is mobile only");
    assert.match(html, /translate-y-full[^"]*lg:sticky[^"]*lg:translate-y-0/, "slide-up drawer on mobile, a sticky side panel on desktop");
    assert.match(html, /Oct \d+/, "timestamps");
  });
  it("flips sides for the dealer", () => {
    const html = render("dealer");
    assert.match(html, /data-testid="thread-bubble-mine"[^>]*data-side="dealer"/);
    assert.match(html, /data-testid="thread-bubble-theirs"[^>]*data-side="buyer"/);
  });
  it("reads but cannot send until the box patch is applied, or when the desk is closed", () => {
    assert.match(render("buyer", { messaging: false }), /Sending messages isn&#x27;t available yet/);
    assert.match(render("buyer", { messaging: false }), /data-testid="thread-compose"[^>]*disabled/);
    assert.match(render("buyer", { canPost: false, readOnlyReason: "This quote was closed, so the conversation is read-only." }), /read-only/);
  });
  it("auto-scrolls to the newest, polls, and keeps an unread badge for the drawer", () => {
    const src = read("components/DealThreadPanel.tsx");
    assert.match(src, /el\.scrollTop = el\.scrollHeight/);
    assert.match(src, /window\.setInterval/);
    assert.match(src, /data-testid="thread-unread"/);
  });
  it("is mounted on the buyer's deal screen (one dealer at a time) and the dealer's quote screen", () => {
    assert.match(read("app/rfq/[id]/page.tsx"), /<DealThreadPanel[\s\S]*?endpoint=\{`\/api\/rfqs\/\$\{rfq\.id\}\/invites\/\$\{threadInvite\.id\}\/thread`\}/);
    assert.match(read("app/rfq/[id]/page.tsx"), /data-testid="thread-dealer-select"/);
    assert.match(read("app/quote-request/received/page.tsx"), /<DealThreadPanel endpoint=\{`\/api\/quote-invite\/thread\?t=/);
  });
});
