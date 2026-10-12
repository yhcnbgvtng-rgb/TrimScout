// A buyer accepts one dealer: every other invited dealer gets one polite "not selected this time" note (through the invite
// outbox and the SAFE MODE sender), their quotes close, and the buyer is offered the "Add your trade-in" step.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { closeOutLosers, sendNotSelectedNotice } from "./inviteOutbox";
import { dealersOwedNotSelected, invitesToClose } from "./rfqClose";
import { acceptedDeal, dealerMayAppraise, needsTradePrompt } from "./acceptTrade";
import { notSelectedHtml, notSelectedSubject } from "./quoteInviteEmail";
import { inviteAcceptsCounter } from "./inviteState";
import { analyzeLeaseQuotes } from "./leaseCompare";
import { buildStageNotice, buildTradeAddedNotice } from "./dealStageNotice";
import { initialStageState, applyStageAction, type DealStageState } from "./dealStages";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import { SAFE_MODE_RECIPIENT, sendQuoteInviteEmail } from "./dealerEmail";
import { AddTradeInPrompt } from "../components/AddTradeInPrompt";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const FUTURE = "2099-01-01T00:00:00Z";
const mk = (id: string, name: string, over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: `desk${id}@${name.replace(/\W/g, "").toLowerCase()}.example`, status: "quoted", declineReason: null, invitedAt: "2026-10-11T00:00:00Z", respondedAt: "2026-10-11T01:00:00Z", deliveryStatus: "sent", viewToken: `tok${id}abcdefgh`, desk: { contactName: "Sam Rivera", role: "sales_manager", emailMasked: "s••@x.com", source: "rooftop" },
    vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null },
    quote: { id: `q${id}`, inviteId: id, dealerName: name, price: 40000 + Number(id), fees: [], totalOtdPrice: 43000 + Number(id), vin: "2T36CRAVXTC39J403", stockNumber: null, expiresAt: FUTURE, submittedAt: "2026-10-11T01:00:00Z", mustHaveAcknowledgement: true, notes: null }, ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "9001", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", stockNumber: null, mustHaves: [], status: "collecting", pickedQuoteId: null, createdAt: "2026-10-08T00:00:00Z", packageKind: "links", linkPastes: [], invites, quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, tradeInExpected: false, approvalStatus: "approved", ...over }) as unknown as RfqRequest;

/** An in-memory deals box for the not-selected endpoint: the same step semantics as scripts/box/2026-10-12-rfq-not-selected.sh. */
function fakeBox() {
  const closed = new Set<string>(); const claimed = new Map<string, number>(); const sent = new Set<string>(); const log: string[] = [];
  const mark = (async (_rfq: string, invite: string, step: "close" | "claim" | "sent" | "release") => {
    log.push(`${step}:${invite}`);
    await Promise.resolve();
    if (step === "close") closed.add(invite);
    if (step === "claim") {
      if (sent.has(invite) || claimed.has(invite)) return { claimed: false, invite: null };
      claimed.set(invite, Date.now()); return { claimed: true, invite: null };
    }
    if (step === "sent") sent.add(invite);
    if (step === "release") claimed.delete(invite);
    return { claimed: false, invite: null };
  }) as never;
  return { mark, closed, sent, log };
}
const recorder = (ok = true) => { const calls: unknown[][] = []; return { calls, send: (async (...a: unknown[]) => { calls.push(a); return ok; }) as never }; };
const deps = (box: ReturnType<typeof fakeBox>, r: ReturnType<typeof recorder>, enabled = true) => ({ mark: box.mark, send: r.send, emailEnabled: () => enabled });

describe("who is owed the not-selected note", () => {
  const winner = mk("1", "Winner Toyota");
  it("every other live invite, not the winner; never a dealer who walked, declined, expired, unsubscribed or was already told", () => {
    const rfq = rfqOf([
      winner, mk("2", "Loser A"), mk("3", "Loser B"),
      mk("4", "Walked", { stage: { ...initialStageState({}), stage: "walked" } as DealStageState }),
      mk("5", "Declined", { status: "declined", quote: null }), mk("6", "Expired", { status: "expired" }),
      mk("7", "Unsub", { dealerUnsubscribedAt: "2026-10-10T00:00:00Z" }), mk("8", "Told", { notSelectedNoticeSentAt: "2026-10-11T02:00:00Z" }),
    ]);
    assert.deepEqual(dealersOwedNotSelected(rfq, "1").map((i) => i.id), ["2", "3"]);
    assert.deepEqual(invitesToClose(rfq, "1").map((i) => i.id), ["2", "3", "7", "8"], "closing is idempotent, so told/unsubscribed desks are still closed");
  });
});

describe("exactly-once sending", () => {
  it("each owed dealer gets exactly one note, the winner none", async () => {
    const box = fakeBox(); const r = recorder();
    const rfq = rfqOf([mk("1", "Winner Toyota"), mk("2", "Loser A"), mk("3", "Loser B")]);
    const out = await closeOutLosers(rfq, "1", deps(box, r));
    assert.equal(out.sent, 2);
    assert.equal(r.calls.length, 2);
    assert.deepEqual([...box.sent].sort(), ["2", "3"]);
    assert.ok(!box.log.some((l) => l.endsWith(":1")), "the winner is never touched");
  });
  it("a second accept, a retry or a drain sends nothing more (the box stamp says sent)", async () => {
    const box = fakeBox(); const r = recorder();
    const rfq = rfqOf([mk("1", "Winner"), mk("2", "Loser A")]);
    await closeOutLosers(rfq, "1", deps(box, r));
    await closeOutLosers(rfq, "1", deps(box, r));
    await closeOutLosers(rfq, "1", deps(box, r));
    assert.equal(r.calls.length, 1);
  });
  it("two accepts racing send once: the claim is atomic on the box", async () => {
    const box = fakeBox(); const r = recorder();
    const rfq = rfqOf([mk("1", "Winner"), mk("2", "Loser A"), mk("3", "Loser B")]);
    await Promise.all([closeOutLosers(rfq, "1", deps(box, r)), closeOutLosers(rfq, "1", deps(box, r))]);
    assert.equal(r.calls.length, 2, "one per loser, not two");
  });
  it("a failed send hands the claim back so the next pass retries; a stale copy that already shows it sent is skipped", async () => {
    const box = fakeBox(); const bad = recorder(false); const good = recorder();
    const rfq = rfqOf([mk("1", "Winner"), mk("2", "Loser A")]);
    assert.equal((await closeOutLosers(rfq, "1", deps(box, bad))).failed, 1);
    assert.equal(box.sent.size, 0);
    assert.equal((await closeOutLosers(rfq, "1", deps(box, good))).sent, 1);
    assert.equal(await sendNotSelectedNotice(rfq, mk("2", "Loser A", { notSelectedNoticeSentAt: "2026-10-11T03:00:00Z" }), deps(box, good)), "already_sent");
    assert.equal(good.calls.length, 1);
  });
  it("counted in ops metrics for real requests only", async () => {
    resetOpsMetricsForTests();
    const box = fakeBox(); const r = recorder();
    await closeOutLosers(rfqOf([mk("1", "W"), mk("2", "L")], { audit: true }), "1", deps(box, r));
    assert.deepEqual(opsSnapshot().counters, {});
    await closeOutLosers(rfqOf([mk("1", "W"), mk("3", "L2")]), "1", deps(fakeBox(), r));
    assert.equal(opsSnapshot().counters.notselected_sent, 1);
  });
});

describe("goes through the outbox rules and SAFE MODE", () => {
  it("an unreleased request sends nothing and closes nothing", async () => {
    const box = fakeBox(); const r = recorder();
    const out = await closeOutLosers(rfqOf([mk("1", "W"), mk("2", "L")], { approvalStatus: "pending" }), "1", deps(box, r));
    assert.equal(out.held_for_approval, 1);
    assert.equal(r.calls.length, 0);
    assert.equal(box.closed.size, 0);
  });
  it("with the email switch off the quote still closes, nothing is claimed or sent, and a later pass sends it", async () => {
    const box = fakeBox(); const r = recorder();
    const rfq = rfqOf([mk("1", "W"), mk("2", "L")]);
    const off = await closeOutLosers(rfq, "1", deps(box, r, false));
    assert.equal(off.parked_switch_off, 1);
    assert.deepEqual([...box.closed], ["2"]);
    assert.equal(r.calls.length, 0);
    assert.ok(!box.log.includes("claim:2"));
    assert.equal((await closeOutLosers(rfq, "1", deps(box, r, true))).sent, 1);
  });
  it("the sender gets subject + html only: no recipient argument, so the dealer's address can never be used (audit=1 and normal alike)", async () => {
    for (const over of [{}, { audit: true }, { auditForcedSafeMode: true }]) {
      const box = fakeBox(); const r = recorder();
      await closeOutLosers(rfqOf([mk("1", "Winner Toyota"), mk("2", "Loser A")], over), "1", deps(box, r));
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].length, 2);
      assert.ok(!JSON.stringify(r.calls[0]).includes("desk2@"), "no dealer address in the message");
    }
  });
  it("the real SAFE MODE sender posts only to the safe recipient", async () => {
    const original = globalThis.fetch; const prevKey = process.env.RESEND_API_KEY; const bodies: { to: string[] }[] = [];
    process.env.RESEND_API_KEY = "re_test_key";
    globalThis.fetch = (async (_u: unknown, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as never;
    try {
      const box = fakeBox();
      const out = await closeOutLosers(rfqOf([mk("1", "W"), mk("2", "L")], { audit: true }), "1", { mark: box.mark, send: sendQuoteInviteEmail, emailEnabled: () => true });
      assert.equal(out.sent, 1);
      assert.deepEqual(bodies.map((b) => b.to), [[SAFE_MODE_RECIPIENT]]);
    } finally {
      globalThis.fetch = original; if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    }
  });
  it("the review copy names the intended dealer under SAFE MODE", async () => {
    const box = fakeBox(); const r = recorder();
    await closeOutLosers(rfqOf([mk("1", "Winner Toyota"), mk("2", "Loser A")]), "1", deps(box, r));
    assert.match(String(r.calls[0][0]), /^\[SAFE MODE · Loser A\]/);
  });
});

describe("the note's content", () => {
  const input = { dealerName: "Loser A", contactName: "Sam Rivera", vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE" }, dealReference: "TS-ABC234" };
  it("has the deal number, the vehicle and a thank-you; no price, winner, buyer or link to act on", () => {
    const subject = notSelectedSubject(input); const html = notSelectedHtml(input);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(subject, /TS-ABC234/); assert.match(subject, /2026 Toyota RAV4 XLE/);
    assert.match(text, /Thank you for quoting/); assert.match(text, /TS-ABC234/);
    assert.doesNotMatch(html, /\$\d/); assert.doesNotMatch(html, /href="(?!https:\/\/[^"]*trimscout)/i);
    assert.doesNotMatch(text, /won|winner|chose (?:another|a different) dealer|selected another|price|offer of/i);
  });
  it("is built from the loser's own record: the winner's name, price and contact never reach it", async () => {
    const box = fakeBox(); const r = recorder();
    await closeOutLosers(rfqOf([mk("1", "Winner Toyota"), mk("2", "Loser A")]), "1", deps(box, r));
    const sent = JSON.stringify(r.calls[0]);
    assert.doesNotMatch(sent, /Winner Toyota|desk1@|43001|40001|tok1abcdefgh/);
  });
});

describe("closed quotes", () => {
  const rfq = rfqOf([mk("1", "W"), mk("2", "L", { notSelectedAt: "2026-10-11T04:00:00Z" })]);
  it("a not-selected quote cannot be countered", () => {
    assert.equal(inviteAcceptsCounter(rfq.invites[0]), true);
    assert.equal(inviteAcceptsCounter(rfq.invites[1]), false);
  });
  it("the lease compare marks the row and the compare hides Counter for it", () => {
    const lease = rfqOf([mk("2", "L", { notSelectedAt: "2026-10-11T04:00:00Z" })], { leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" } as never });
    assert.equal(analyzeLeaseQuotes(lease)!.rows[0].notSelected, true);
    assert.match(read("components/LeaseCompare.tsx"), /onCounter && !r\.unsubscribed && !r\.notSelected/);
  });
  it("every route that could revise, counter or move a closed quote refuses it", () => {
    for (const f of ["app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts", "app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts", "app/api/quote-invite/lease-quote/route.ts", "app/api/quote-invite/used-quote/route.ts", "app/api/quote-invite/accept-counter/route.ts", "app/api/quote-invite/stage/route.ts", "app/api/quote-invite/trade/route.ts"]) {
      assert.match(read(f), /notSelectedAt|isNotSelected/, f);
    }
  });
  it("the tracker says so: staged summary and compare chips", () => {
    assert.match(read("lib/dealStages.ts"), /Not selected: you chose another dealer/);
    assert.match(read("components/UsedCompare.tsx"), /not-selected-chip/);
  });
  it("the pick and the OTD acceptance both trigger the close-out, after the response", () => {
    const pick = read("app/api/rfqs/[id]/pick/route.ts"); const stage = read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts");
    assert.match(pick, /after\(async \(\) => \{ await closeOutLosers\(existing, winner\.id\)/);
    assert.match(stage, /action\.type === "accept_otd" && result\.stage\.otd\.status === "locked"\) after\(/);
  });
  it("a dealer accepting the buyer's OTD counter triggers the same close-out, only once the stage is locked", () => {
    const route = read("app/api/quote-invite/accept-counter/route.ts");
    assert.match(route, /if \(stageLocked\) after\(async \(\) => \{ await closeOutLosers\(rfq, invite\.id\)/);
    assert.ok(route.indexOf("stageLocked = true") < route.indexOf("closeOutLosers(rfq, invite.id)"));
    assert.match(route, /import \{ closeOutLosers \} from "@\/lib\/inviteOutbox"/);
  });
  it("the same exactly-once and SAFE MODE rules apply (it is the same closeOutLosers): a repeated accept sends nothing more", async () => {
    const box = fakeBox(); const r = recorder();
    const rfq = rfqOf([mk("1", "Countered Dealer"), mk("2", "Loser A"), mk("3", "Loser B")], { audit: true });
    await closeOutLosers(rfq, "1", deps(box, r));
    await closeOutLosers(rfq, "1", deps(box, r));
    assert.equal(r.calls.length, 2);
    assert.ok(r.calls.every((c) => c.length === 2));
  });
});

describe("the Add your trade-in prompt", () => {
  const lockedStage = (tradeExpected: boolean) => {
    const r = applyStageAction(initialStageState({ tradeInExpected: tradeExpected }), { type: "accept_otd", actor: "buyer" }, { otdAmount: 43749 });
    assert.equal(r.ok, true); return (r as { ok: true; state: DealStageState }).state;
  };
  const staged = (over: Partial<RfqRequest> = {}, stage = lockedStage(false)) => rfqOf([mk("1", "Winner Toyota", { stage }), mk("2", "Loser A")], { quotePrefs: { quoteType: "cash", staged: true, cash: { zip: "07405", timeline: "this_month" } } as never, ...over });
  const lease = (over: Partial<RfqRequest> = {}) => rfqOf([mk("1", "Winner Toyota"), mk("2", "Loser A")], { status: "picked", pickedQuoteId: "q1", leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" } as never, quotePrefs: null, ...over });

  it("Cash / Finance: appears once the OTD is locked, with the accepted number; not before", () => {
    assert.equal(needsTradePrompt(staged({}, initialStageState({}))), null);
    const deal = needsTradePrompt(staged())!;
    assert.equal(deal.kind, "cash_finance"); assert.equal(deal.invite.id, "1"); assert.equal(deal.lockedOtd, 43749); assert.equal(deal.tradeStageOpen, false);
  });
  it("Cash / Finance with a trade expected but not yet added: the trade stage is open, so Skip moves the deal on", () => {
    assert.equal(needsTradePrompt(staged({ tradeInExpected: true }, lockedStage(true)))!.tradeStageOpen, true);
  });
  it("Lease: appears once a quote is picked, for the picked dealer", () => {
    const deal = needsTradePrompt(lease())!;
    assert.equal(deal.kind, "lease"); assert.equal(deal.invite.id, "1");
    assert.equal(needsTradePrompt(lease({ status: "collecting", pickedQuoteId: null })), null);
  });
  it("not when a trade-in is already on the request, the request was walked, or payment has begun", () => {
    assert.equal(needsTradePrompt(lease({ tradeIn: { vin: "T" } as never })), null);
    assert.equal(needsTradePrompt(lease({ status: "walked" })), null);
    const asked = applyStageAction(lockedStage(false), { type: "request_finance", actor: "buyer", downPayment: 1000 }, {});
    assert.equal(needsTradePrompt(staged({}, (asked as { ok: true; state: DealStageState }).state)), null);
  });
  it("a not-selected dealer is never the accepted one", () => {
    const rfq = staged(); rfq.invites[0] = { ...rfq.invites[0], notSelectedAt: "2026-10-11T05:00:00Z" } as RfqInvite;
    assert.equal(acceptedDeal(rfq), null);
  });
  it("renders the prompt with the locked OTD and a Skip button (Cash / Finance and Lease)", () => {
    const html = renderToStaticMarkup(<AddTradeInPrompt rfq={staged()} headers={{}} onRfq={() => {}} />);
    assert.match(html, /Add your trade-in/); assert.match(html, /\$43,749 stays locked/); assert.match(html, /data-testid="trade-prompt-skip"/); assert.match(html, /Skip, no trade-in/);
    const leaseHtml = renderToStaticMarkup(<AddTradeInPrompt rfq={lease()} headers={{}} onRfq={() => {}} />);
    assert.match(leaseHtml, /cap cost reduction/); assert.match(leaseHtml, /data-kind="lease"/);
    assert.equal(renderToStaticMarkup(<AddTradeInPrompt rfq={rfqOf([mk("1", "W")])} headers={{}} onRfq={() => {}} />), "", "nothing before the buyer accepts");
  });
  it("is mounted on the buyer's request page, and the attach route needs an accepted deal and a complete draft", () => {
    assert.match(read("app/rfq/[id]/page.tsx"), /<AddTradeInPrompt rfq=\{rfq\}/);
    const route = read("app/api/rfqs/[id]/trade-in/route.ts");
    assert.match(route, /needsTradePrompt\(rfq\)/); assert.match(route, /prepareTradeForRfq/); assert.match(route, /type: "add_trade"/);
  });
  it("the winner is asked for a value: staged gets the add_trade notice, lease gets the trade-added notice, both SAFE MODE", () => {
    const st = applyStageAction(lockedStage(false), { type: "add_trade", actor: "buyer" }, { hasTradeInOnFile: true });
    const n = buildStageNotice({ actor: "buyer", action: { type: "add_trade" }, state: (st as { ok: true; state: DealStageState }).state, dealerName: "Winner Toyota", vehicle: "2026 Toyota RAV4", url: "https://x.test/q" })!;
    assert.match(n.subject, /^\[SAFE MODE\] Buyer added a trade-in/); assert.match(n.html, /stays locked/); assert.match(n.html, /offer a trade value/);
    const l = buildTradeAddedNotice({ dealerName: "Winner Toyota", vehicle: "2026 Toyota RAV4", url: "https://x.test/q", lease: true });
    assert.match(l.subject, /^\[SAFE MODE\]/); assert.match(l.html, /cap cost reduction/);
  });
  it("the winning dealer may appraise after a pick; losers and closed quotes may not", () => {
    const rfq = lease();
    assert.equal(dealerMayAppraise(rfq, rfq.invites[0]), true);
    assert.equal(dealerMayAppraise(rfq, rfq.invites[1]), false);
    assert.equal(dealerMayAppraise(rfqOf([], { status: "collecting" }), mk("3", "X", { notSelectedAt: "2026-10-11T05:00:00Z" })), false);
    assert.equal(dealerMayAppraise(rfqOf([], { status: "collecting" }), mk("3", "X")), true);
  });
});
