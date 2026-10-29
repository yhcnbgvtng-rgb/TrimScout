// PR 3: the thread notices (quote in, declined, rejected, buyer closed, new message). Copy only says "quote request", carries no
// contact details and no message text, and every send still goes through the SAFE MODE sender (subject + html, no recipient).
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { findContactInfo } from "./piiFilter";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import { MESSAGE_NOTICE_WINDOW_MS, invitesToTellClosed, notifyBuyerClosed, notifyDealerDeclined, notifyDealerQuoted, notifyNewMessage, notifyRequestRejected, resetNoticeDebounceForTests, sendThreadNotice } from "./noticeOutbox";
import { buildBuyerClosedNotice, buildDealerDeclinedNotice, buildDealerQuotedNotice, buildNewMessageNotice, buildRequestRejectedNotice, type ThreadNotice } from "./threadNotice";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(f, "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const baseInvite = (over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id: "14", dealerName: "Route 22 Toyota", dealerContactEmail: "sales@route22toyota.com", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sales desk", role: "sales", emailMasked: "s••@r.com", source: "rooftop" }, vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null }, quote: null, ...over }) as unknown as RfqInvite;
const baseRfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "2", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", status: "collecting", createdAt: "2026-09-17T00:00:00Z", packageKind: "links", linkPastes: [{ vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerName: "Route 22 Toyota", dealerState: "NJ", vdpUrl: "https://www.route22toyota.com/x", condition: "new" }], invites, quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: null, tradeInExpected: false, ...over }) as unknown as RfqRequest;

const invite = (over: Partial<RfqInvite> = {}): RfqInvite => baseInvite(over);
const rfq = (invites: RfqInvite[] = [invite()], over: Partial<RfqRequest> = {}): RfqRequest => baseRfq(invites, over);
const released = (invites?: RfqInvite[], over: Partial<RfqRequest> = {}) => rfq(invites, { approvalStatus: "approved", ...over });
const sentInvite = (over: Partial<RfqInvite> = {}) => invite({ deliveryStatus: "sent", ...over });
const spy = () => {
  const calls: unknown[][] = [];
  return { calls, send: (async (...a: unknown[]) => { calls.push(a); return true; }) as never };
};
const deps = (over: Record<string, unknown> = {}) => ({ directory: [], emailEnabled: () => true, ...spy(), ...over });
const vehicle = { year: 2026, make: "Toyota", model: "RAV4", trim: "XLE" };

const all = (): ThreadNotice[] => [
  buildDealerQuotedNotice({ dealerName: "Route 22 Toyota", vehicle, revised: false, url: "https://x.test/rfq/17" }),
  buildDealerQuotedNotice({ dealerName: "Route 22 Toyota", vehicle, revised: true, url: "https://x.test/rfq/17" }),
  buildDealerDeclinedNotice({ dealerName: "Route 22 Toyota", vehicle, url: "https://x.test/rfq/17" }),
  buildRequestRejectedNotice({ vehicle, url: "https://x.test/rfq/17" }),
  buildBuyerClosedNotice({ dealerName: "Route 22 Toyota", vehicle, reference: "TS-ABC123", url: "https://x.test/q?t=tok", unsubscribeUrl: "https://x.test/unsub" }),
  buildNewMessageNotice({ to: "buyer", dealerName: "Route 22 Toyota", vehicle, reference: "TS-ABC123", url: "https://x.test/rfq/17" }),
  buildNewMessageNotice({ to: "dealer", dealerName: "Route 22 Toyota", vehicle, reference: "TS-ABC123", url: "https://x.test/q?t=tok", unsubscribeUrl: "https://x.test/unsub" }),
];

describe("notice copy", () => {
  it("every notice is SAFE MODE tagged for who it was meant for, and says 'quote request' without bid or auction words", () => {
    for (const n of all()) {
      assert.match(n.subject, /^\[SAFE MODE · (buyer|Route 22 Toyota)\] /, n.subject);
      assert.match(n.html, /SAFE MODE:<\/strong> redirected here instead of/);
      assert.doesNotMatch(`${n.subject} ${text(n.html)}`, /\bbids?\b|\bbidding\b|auction|reverse/i, n.subject);
      assert.match(text(n.html), /quote request/i, n.subject);
    }
  });
  it("no notice carries contact details", () => {
    for (const n of all()) {
      const body = text(n.html);
      assert.equal(findContactInfo(`${n.subject} ${body}`), null, n.subject);
      assert.doesNotMatch(body, /@/, n.subject);
      assert.doesNotMatch(body, /\b\d{3}[-. )]*\d{3}[-. ]*\d{4}\b/, n.subject);
    }
  });
  it("buyer-bound mail never names the dealer's contact, dealer-bound mail never names the buyer", () => {
    for (const n of all().filter((x) => x.audience === "buyer")) assert.doesNotMatch(n.html, /Sales desk|sales@/i);
    for (const n of all().filter((x) => x.audience === "dealer")) assert.doesNotMatch(text(n.html), /buyer's (name|email|phone|address)/i);
  });
  it("a revised quote reads differently from a first quote, and a rejection leaves the reason on the tracker", () => {
    const [first, revised, , rejected] = all();
    assert.match(first.subject, /^\[SAFE MODE · buyer\] New quote from/);
    assert.match(revised.subject, /Revised quote from/);
    assert.match(text(rejected.html), /reason is on your tracker/);
  });
  it("only dealer-bound mail carries a stop link, and the message notice has nowhere to put message text", () => {
    const [, , , , closed, toBuyer, toDealer] = all();
    assert.match(closed.html, /Stop these emails/); assert.match(toDealer.html, /Stop these emails/);
    assert.doesNotMatch(toBuyer.html, /Stop these emails/);
    assert.equal(buildNewMessageNotice.length, 1);
  });
});

describe("sending", () => {
  beforeEach(() => { resetOpsMetricsForTests(); resetNoticeDebounceForTests(); });

  it("a quote tells the buyer through the SAFE MODE sender: subject + html only, counted once", async () => {
    const d = deps();
    assert.equal(await notifyDealerQuoted(released([sentInvite()]), sentInvite(), d), "sent");
    assert.equal(d.calls.length, 1); assert.equal(d.calls[0].length, 2, "no recipient argument");
    assert.equal(opsSnapshot().counters.notice_sent, 1);
  });
  it("a counter makes the next quote a revised one", async () => {
    const d = deps();
    await notifyDealerQuoted(released(), invite({ buyerCounter: { sentAt: "2026-10-29T00:00:00Z" } as never }), d);
    assert.match(String(d.calls[0][0]), /Revised quote from/);
  });
  it("a decline and a rejection each send one buyer notice", async () => {
    const d = deps();
    assert.equal(await notifyDealerDeclined(released(), invite(), d), "sent");
    assert.equal(await notifyRequestRejected(rfq([invite()], { approvalStatus: "rejected" }), d), "sent", "a rejection is about a request that was never released");
    assert.equal(d.calls.length, 2);
  });
  it("everything except a rejection waits for the admin release; the email switch parks them all", async () => {
    const held = deps(); const parked = deps({ emailEnabled: () => false });
    assert.equal(await notifyDealerQuoted(rfq([invite()], { approvalStatus: "pending" }), invite(), held), "held_for_approval");
    assert.equal(await notifyRequestRejected(released(), parked), "parked_switch_off");
    assert.deepEqual([held.calls.length, parked.calls.length], [0, 0]);
    assert.equal(opsSnapshot().counters.notice_skipped, 2);
  });
  it("a closed request tells each dealer who had it, once; queued, declined and already-closed invites are left alone", async () => {
    const r = released([sentInvite({ id: "1" }), sentInvite({ id: "2", status: "quoted" }), invite({ id: "3" }), sentInvite({ id: "4", status: "declined" }), sentInvite({ id: "5", notSelectedAt: "2026-10-28T00:00:00Z" })]);
    assert.deepEqual(invitesToTellClosed(r).map((i) => i.id), ["1", "2"]);
    const d = deps();
    assert.deepEqual(await notifyBuyerClosed(r, d), ["sent", "sent"]);
    assert.equal(d.calls.length, 2);
    assert.match(String(d.calls[0][0]), /^\[SAFE MODE · Route 22 Toyota\] Quote request closed:/);
  });
  it("an unsubscribed rooftop is not told, and the dealer-bound mail needs a quote link", async () => {
    const d = deps();
    assert.deepEqual(await notifyBuyerClosed(released([sentInvite({ dealerUnsubscribedAt: "2026-10-28T00:00:00Z" })]), d), ["opted_out"]);
    assert.deepEqual(await notifyBuyerClosed(released([sentInvite({ viewToken: null })]), { ...d, ...spy() }), ["failed"]);
    assert.equal(d.calls.length, 0);
  });
  it("message notices carry no message text, even when the thread holds a phone number", async () => {
    const d = deps();
    const withChat = sentInvite({ messages: [{ id: "m1", from: "dealer", text: "call me on 555-123-4567 or jo@x.com", at: "2026-10-29T00:00:00Z" }] });
    assert.equal(await notifyNewMessage(released([withChat]), withChat, "buyer", d), "sent");
    assert.doesNotMatch(`${d.calls[0][0]} ${d.calls[0][1]}`, /555|jo@x\.com|call me/);
  });
  it("a second message notice to the same side of the same thread within 10 minutes is held back; the other side and a later one are not", async () => {
    let t = 1_000_000; const d = deps({ now: () => t });
    const r = released([sentInvite()]);
    assert.equal(await notifyNewMessage(r, sentInvite(), "buyer", d), "sent");
    t += 60_000;
    assert.equal(await notifyNewMessage(r, sentInvite(), "buyer", d), "debounced");
    assert.equal(await notifyNewMessage(r, sentInvite(), "dealer", d), "sent", "the other side has its own window");
    assert.equal(await notifyNewMessage(r, sentInvite({ id: "99" }), "buyer", d), "sent", "another dealer's thread too");
    t += MESSAGE_NOTICE_WINDOW_MS;
    assert.equal(await notifyNewMessage(r, sentInvite(), "buyer", d), "sent");
  });
  it("a failed send does not start the debounce window", async () => {
    let ok = false; const d = deps({ send: (async () => ok) as never }); const orig = console.error; console.error = () => {};
    try {
      const r = released([sentInvite()]);
      assert.equal(await notifyNewMessage(r, sentInvite(), "buyer", d), "failed");
      ok = true;
      assert.equal(await notifyNewMessage(r, sentInvite(), "buyer", d), "sent");
    } finally { console.error = orig; }
  });
  it("a throwing sender is logged and counted, never thrown at the caller", async () => {
    const orig = console.error; const lines: string[] = []; console.error = (...a: unknown[]) => { lines.push(String(a[0])); };
    try {
      assert.equal(await notifyDealerQuoted(released(), invite(), deps({ send: (async () => { throw new Error("resend down"); }) as never })), "failed");
    } finally { console.error = orig; }
    assert.equal(opsSnapshot().counters.notice_failed, 1);
    assert.ok(lines.some((l) => /threw/.test(l)));
  });
  it("audit and test requests stay out of ops metrics", async () => {
    await notifyDealerQuoted(released([invite()], { auditForcedSafeMode: true }), invite(), deps());
    assert.deepEqual(opsSnapshot().counters, {});
  });
  it("sendThreadNotice refuses dealer-bound mail with no invite", async () => {
    const orig = console.error; console.error = () => {};
    try { assert.equal(await sendThreadNotice(released(), null, "dealer", () => all()[4], deps()), "failed"); } finally { console.error = orig; }
  });
});

describe("wiring", () => {
  const after = (f: string, call: RegExp, why: string) => assert.match(read(f), call, why);
  it("both quote routes tell the buyer after the response", () => {
    after("app/api/quote-invite/used-quote/route.ts", /after\(\(\) => notifyDealerQuoted\(rfq, found\.invite\)\)/, "used-quote");
    after("app/api/quote-invite/lease-quote/route.ts", /after\(\(\) => notifyDealerQuoted\(rfq, found\.invite\)\)/, "lease-quote");
  });
  it("decline, rejection and walk-away each send their notice", () => {
    after("app/api/quote-invite/decline/route.ts", /notifyDealerDeclined\(rfq, found\.invite\)/, "decline");
    after("app/api/admin/rfqs/[id]/approval/route.ts", /afterResponse\(\(\) => notifyRequestRejected\(rfq\)\)/, "rejection");
    after("app/api/rfqs/[id]/walk/route.ts", /after\(\(\) => notifyBuyerClosed\(existing\)\)/, "walk");
  });
  it("both chat routes email only when the guard delivered the message", () => {
    after("app/api/quote-invite/thread/route.ts", /if \(outcome\.status === "delivered"\) after\(\(\) => notifyNewMessage\(fresh \?\? row\.rfq, invite, "buyer"\)\)/, "dealer -> buyer");
    after("app/api/rfqs/[id]/invites/[inviteId]/thread/route.ts", /if \(outcome\.status === "delivered"\) after\(\(\) => notifyNewMessage\(fresh \?\? a\.rfq, invite, "dealer"\)\)/, "buyer -> dealer");
  });
  it("no notice module can name a recipient: SAFE MODE stays in dealerEmail.ts", () => {
    for (const f of ["lib/noticeOutbox.ts", "lib/threadNotice.ts"]) assert.doesNotMatch(read(f), /pausmi@|\bto:\s*\[|sendViaResend/, f);
    assert.match(read("lib/dealerEmail.ts"), /to: \[SAFE_MODE_RECIPIENT\]/);
  });
});
