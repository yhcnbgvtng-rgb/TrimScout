import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blocksSecondRequest, buyerTestEmails, isBuyerTestMode, rfqIsTestOrAudit, testRequestIsFlagged } from "./buyerTestMode";
import { rfqCreateActor } from "./buyerAccess";
import { wizardAuthState } from "./quoteDraft";
import { testRequestsToWalk } from "./buyerTestModeWalk";
import { sendQueuedInvite } from "./inviteOutbox";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import { hasActiveRfq } from "./rfqLogic";
import type { RfqInvite, RfqRequest } from "./rfq";

const ON = { BUYER_TEST_MODE_EMAILS: "Paul@Example.com, ,junk,second@example.org" };
const OFF = {};
const OWNER = { user: { id: "1", email: "paul@example.com", role: "admin" } };
const BUYER = { user: { id: "2", email: "someone@gmail.com", role: "buyer" } };

describe("BUYER_TEST_MODE_EMAILS", () => {
  it("is off by default: unset, blank or junk lists nobody", () => {
    for (const v of [undefined, "", "   ", ",", "not-an-email"]) assert.deepEqual(buyerTestEmails({ BUYER_TEST_MODE_EMAILS: v }), [], String(v));
    assert.equal(isBuyerTestMode(OWNER.user, OFF), false);
  });
  it("matches listed emails case-insensitively and ignores junk entries", () => {
    assert.deepEqual(buyerTestEmails(ON), ["paul@example.com", "second@example.org"]);
    assert.equal(isBuyerTestMode({ email: "PAUL@example.com" }, ON), true);
    assert.equal(isBuyerTestMode({ email: " second@example.org " }, ON), true);
  });
  it("never matches a real buyer, a missing email or a missing user", () => {
    assert.equal(isBuyerTestMode(BUYER.user, ON), false);
    assert.equal(isBuyerTestMode({ email: null }, ON), false);
    assert.equal(isBuyerTestMode({}, ON), false);
    assert.equal(isBuyerTestMode(null, ON), false);
  });
});

describe("who may create a request in test mode", () => {
  it("an allowlisted account sends as a buyer whatever its stored role, flagged testMode", () => {
    assert.deepEqual(rfqCreateActor(OWNER, {}, { ...ON, REQUIRE_BUYER_LOGIN: "true" }), { kind: "buyer", ownerId: "1", testMode: true });
  });
  it("with the list unset the same admin is refused, as before", () => {
    const a = rfqCreateActor(OWNER, {}, { REQUIRE_BUYER_LOGIN: "true" });
    assert.equal(a.kind, "deny");
  });
  it("a real buyer is a plain buyer, never testMode, even with test mode configured", () => {
    assert.deepEqual(rfqCreateActor(BUYER, {}, ON), { kind: "buyer", ownerId: "2" });
  });
  it("an allowlisted email with no session id is not honoured", () => {
    assert.equal(rfqCreateActor({ user: { email: "paul@example.com", role: "buyer" } }, {}, { ...ON, REQUIRE_BUYER_LOGIN: "true" }).kind, "deny");
  });
});

describe("the one-active-request limit", () => {
  const open = [{ status: "collecting" as const }];
  it("still blocks a normal buyer", () => {
    assert.equal(hasActiveRfq(open), true);
    assert.equal(blocksSecondRequest(open, false), true);
  });
  it("never blocks test mode, however many are open", () => {
    assert.equal(blocksSecondRequest(open, true), false);
    assert.equal(blocksSecondRequest([...open, ...open, ...open], true), false);
  });
  it("blocks nothing when nothing is open", () => {
    assert.equal(blocksSecondRequest([{ status: "walked" as const }, { status: "picked" as const }], false), false);
  });
});

describe("test requests are flagged, and never left unflagged", () => {
  it("only audit === true counts as flagged (an old box that returns nothing fails closed)", () => {
    assert.equal(testRequestIsFlagged({ audit: true }), true);
    assert.equal(testRequestIsFlagged({ audit: false }), false);
    assert.equal(testRequestIsFlagged({}), false);
  });
  it("audit and the audit key both mark a request test/audit", () => {
    assert.equal(rfqIsTestOrAudit({ audit: true }), true);
    assert.equal(rfqIsTestOrAudit({ auditForcedSafeMode: true }), true);
    assert.equal(rfqIsTestOrAudit({}), false);
  });
});

describe("the wizard treats the test account as a buyer", () => {
  it("test mode makes any role a buyer; without it an admin is not", () => {
    assert.equal(wizardAuthState({ role: "admin", testMode: true }), "buyer");
    assert.equal(wizardAuthState({ role: "admin" }), "not_buyer");
    assert.equal(wizardAuthState({ role: "dealer", testMode: false }), "not_buyer");
    assert.equal(wizardAuthState({ role: "buyer" }), "buyer");
    assert.equal(wizardAuthState(null), "signed_out");
  });
});

describe("Walk away from all my test requests", () => {
  const rows = [
    { id: "1", status: "collecting", audit: true },
    { id: "2", status: "collecting", audit: false },
    { id: "3", status: "walked", audit: true },
    { id: "4", status: "collecting", auditForcedSafeMode: true },
    { id: 5, status: "collecting" },
  ] as unknown as Parameters<typeof testRequestsToWalk>[0];
  it("lists only open, flagged requests — a real request is never touched", () => {
    assert.deepEqual(testRequestsToWalk(rows), ["1", "4"]);
  });
  it("is empty when there are none", () => {
    assert.deepEqual(testRequestsToWalk([]), []);
  });
});

describe("a test-mode request stays on SAFE MODE and out of metrics", () => {
  const invite = { id: "14", dealerName: "Route 22 Toyota", dealerContactEmail: "sales@route22.example", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sales desk", role: "sales", emailMasked: "s••@r.com", source: "rooftop" }, vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null }, quote: null } as unknown as RfqInvite;
  const rfq = (over: Partial<RfqRequest> = {}): RfqRequest =>
    ({ id: "17", buyerUserId: "1", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", status: "collecting", createdAt: "2026-10-11T00:00:00Z", packageKind: "links", linkPastes: [{ vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerName: "Route 22 Toyota", dealerState: "NJ", vdpUrl: "https://www.route22toyota.example/x", condition: "new" }], invites: [invite], quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: null, tradeInExpected: false, approvalStatus: "approved", ...over }) as unknown as RfqRequest;
  it("sends with no recipient argument (subject + html only) and moves no email_* counter", async () => {
    resetOpsMetricsForTests();
    const calls: unknown[][] = [];
    const deps = { directory: [], send: (async (...a: unknown[]) => { calls.push(a); return true; }) as never, mark: (async () => {}) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(rfq({ audit: true }), invite, deps), "sent");
    assert.equal(calls[0].length, 2);
    assert.ok(!JSON.stringify(calls[0]).includes("sales@route22.example"));
    assert.deepEqual(opsSnapshot().counters, {});
    await sendQueuedInvite(rfq(), invite, deps);
    assert.equal(opsSnapshot().counters.email_sent, 1, "a real request still counts");
  });
  it("is still held for admin approval like any request", async () => {
    const sent: unknown[] = [];
    const deps = { directory: [], send: (async (s: string) => { sent.push(s); return true; }) as never, mark: (async () => {}) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(rfq({ audit: true, approvalStatus: "pending" }), invite, deps), "held_for_approval");
    assert.equal(sent.length, 0);
  });
});
