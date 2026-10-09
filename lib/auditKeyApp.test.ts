// App-layer half of the audit key: RFQs it created stay on SAFE MODE.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendQueuedInvite } from "./inviteOutbox";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import type { RfqInvite, RfqRequest } from "./rfq";

const invite = { id: "14", dealerName: "Route 22 Toyota", dealerContactEmail: "grok.dealer@trimscout.test", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sales desk", role: "sales", emailMasked: "s••@r.com", source: "rooftop" }, vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null }, quote: null } as unknown as RfqInvite;
const rfq = (over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "9001", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", status: "collecting", createdAt: "2026-10-08T00:00:00Z", packageKind: "links", linkPastes: [{ vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerName: "Route 22 Toyota", dealerState: "NJ", vdpUrl: "https://www.route22toyota.com/x", condition: "new" }], invites: [invite], quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: null, tradeInExpected: false, approvalStatus: "approved", ...over }) as unknown as RfqRequest;

describe("requests created by the audit key", () => {
  it("never pass the dealer's address to the sender (it can only land at SAFE_MODE_RECIPIENT)", async () => {
    const calls: unknown[][] = [];
    const send = (async (...args: unknown[]) => { calls.push(args); return true; }) as never;
    const deps = { directory: [], send, mark: (async () => {}) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(rfq({ auditForcedSafeMode: true }), invite, deps), "sent");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2, "subject + html only — no recipient argument");
    assert.ok(!JSON.stringify(calls[0]).includes("grok.dealer@trimscout.test"));
  });
  it("and an unreleased audit request is still held for admin approval", async () => {
    const sent: unknown[] = [];
    const deps = { directory: [], send: (async (s: string) => { sent.push(s); return true; }) as never, mark: (async () => {}) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(rfq({ auditForcedSafeMode: true, approvalStatus: "pending" }), invite, deps), "held_for_approval");
    assert.equal(sent.length, 0);
  });
  it("stay out of ops metrics: no email_* counters move, while a real request's do", async () => {
    resetOpsMetricsForTests();
    const deps = { directory: [], send: (async () => true) as never, mark: (async () => {}) as never, emailEnabled: () => true };
    await sendQueuedInvite(rfq({ auditForcedSafeMode: true }), invite, deps);
    await sendQueuedInvite(rfq({ auditForcedSafeMode: true, approvalStatus: "pending" }), invite, deps);
    assert.deepEqual(opsSnapshot().counters, {}, "audit sends/holds are not counted");
    await sendQueuedInvite(rfq(), invite, deps);
    assert.equal(opsSnapshot().counters.email_sent, 1);
  });
});
