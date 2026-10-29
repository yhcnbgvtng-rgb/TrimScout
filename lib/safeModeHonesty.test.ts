// PR 2: SAFE MODE stays exactly as it is, but product state and send hygiene stop pretending otherwise.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { drainQueuedInvites, rooftopOptedOut, sendCounterNotice, sendQueuedInvite } from "./inviteOutbox";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import { buyerCounterSubject, quoteInviteSubject } from "./quoteInviteEmail";
import { rfqLifecycleDetail } from "./rfqTracker";
import { SAFE_MODE_ACTIVE, SAFE_MODE_HELD_COPY, safeModeSubject } from "./safeMode";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const baseInvite = { id: "14", dealerName: "Route 22 Toyota", dealerContactEmail: "grok.dealer@trimscout.test", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sales desk", role: "sales", emailMasked: "s••@r.com", source: "rooftop" }, vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null }, quote: null } as unknown as RfqInvite;
const rfq = (over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "9001", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", status: "collecting", createdAt: "2026-10-08T00:00:00Z", packageKind: "links", linkPastes: [{ vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerName: "Route 22 Toyota", dealerState: "NJ", vdpUrl: "https://www.route22toyota.com/x", condition: "new" }], invites: [invite], quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: null, tradeInExpected: false, approvalStatus: "approved", ...over }) as unknown as RfqRequest;


const invite = (over: Partial<RfqInvite> = {}): RfqInvite => ({ ...(baseInvite as RfqInvite), ...over });
const mail = { subject: "Buyer counter", html: "<p>counter</p>" };
const spy = () => {
  const sent: string[] = [];
  return { sent, send: (async (s: string) => { sent.push(s); return true; }) as never };
};

describe("SAFE MODE subjects and tracker copy", () => {
  it("the override is on, and a subject names the dealer the mail was meant for", () => {
    assert.equal(SAFE_MODE_ACTIVE, true);
    assert.equal(safeModeSubject("Route 22 Toyota", "Hello"), "[SAFE MODE · Route 22 Toyota] Hello");
  });
  it("invite and counter subjects carry the tag; neither mentions a buyer", () => {
    const counter = { dealerName: "Route 22 Toyota", contactName: "Sam", vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE" }, dealReference: null, summary: "", note: null, priorMonthly: 500, kind: "cash" as const, rows: null, viewUrl: "https://x.test/v" };
    assert.match(buyerCounterSubject(counter as never), /^\[SAFE MODE · Route 22 Toyota\] Buyer counter on your cash quote: 2026 Toyota RAV4 XLE/);
    assert.match(quoteInviteSubject({ quoteType: "cash", dealerName: "Route 22 Toyota", vehicle: counter.vehicle, buyerZip: "07405" } as never), /^\[SAFE MODE · Route 22 Toyota\] /);
  });
  it("the tracker never says dealers have a request while SAFE MODE holds the mail back", () => {
    const detail = rfqLifecycleDetail(rfq({ invites: [invite({ deliveryStatus: "sent" })] }));
    assert.equal(detail, SAFE_MODE_HELD_COPY);
    assert.doesNotMatch(detail, /have it|replied/i);
  });
  it("lib/safeMode.ts is pure, so client code can import it", () => {
    assert.doesNotMatch(read("lib/safeMode.ts"), /^import /m);
  });
});

describe("send-time opt-out", () => {
  it("an unsubscribed invite is not sent and not marked; the outbox counts it", async () => {
    resetOpsMetricsForTests();
    const marked: string[] = []; const { sent, send } = spy();
    const deps = { directory: [], send, mark: (async (_r: string, i: string) => { marked.push(i); }) as never, emailEnabled: () => true };
    assert.equal(await sendQueuedInvite(rfq(), invite({ dealerUnsubscribedAt: "2026-10-27T10:00:00Z" }), deps), "opted_out");
    assert.deepEqual([sent.length, marked.length], [0, 0]);
    assert.equal(opsSnapshot().counters.email_opted_out, 1);
  });
  it("a directory row with emailOptOut stops it too, and a normal row does not", () => {
    const row = (emailOptOut: boolean) => [{ id: 1, dealerName: "Route 22 Toyota", state: "NJ", address: null, city: null, zipCode: null, phone: null, contactEmail: "sales@route22.example", emailOptOut }] as never;
    const r = rfq({ linkPastes: [{ vin: "2T36CRAVXTC39J403", dealerName: "Route 22 Toyota", dealerState: "NJ" }] as never });
    assert.equal(rooftopOptedOut(invite(), r, row(true)), true);
    assert.equal(rooftopOptedOut(invite(), r, row(false)), false);
  });
  it("drain reports opted_out alongside the other results", async () => {
    const { send } = spy();
    const out = await drainQueuedInvites([rfq({ invites: [invite({ dealerUnsubscribedAt: "2026-10-27T10:00:00Z" })] })], { directory: [], send, mark: (async () => {}) as never, emailEnabled: () => true });
    assert.equal(out.opted_out, 1); assert.equal(out.sent, 0); assert.equal(out.queued, 1);
  });
});

describe("a failed 'mark sent' is visible", () => {
  it("the invite is still reported sent, and the failure is logged and counted", async () => {
    resetOpsMetricsForTests();
    const { send } = spy();
    const errors: unknown[][] = []; const original = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      const result = await sendQueuedInvite(rfq(), invite(), { directory: [], send, mark: (async () => { throw new Error("box down"); }) as never, emailEnabled: () => true });
      assert.equal(result, "sent");
    } finally { console.error = original; }
    assert.equal(opsSnapshot().counters.email_mark_failed, 1);
    assert.match(String(errors[0]?.[0]), /could not mark it sent/);
  });
});

describe("counter notice gating", () => {
  const deps = (over: Record<string, unknown> = {}) => ({ directory: [], emailEnabled: () => true, ...spy(), ...over });
  it("sends once when released, switch on and not opted out", async () => {
    resetOpsMetricsForTests();
    const d = deps();
    assert.equal(await sendCounterNotice(rfq(), invite(), mail, d), "sent");
    assert.deepEqual(d.sent, ["Buyer counter"]);
    assert.equal(opsSnapshot().counters.email_counter_sent, 1);
  });
  it("holds for an unreleased request, parks on the email switch, skips an unsubscribed rooftop: nothing is sent", async () => {
    const a = deps(); const b = deps({ emailEnabled: () => false }); const c = deps();
    assert.equal(await sendCounterNotice(rfq({ approvalStatus: "pending" }), invite(), mail, a), "held_for_approval");
    assert.equal(await sendCounterNotice(rfq(), invite(), mail, b), "parked_switch_off");
    assert.equal(await sendCounterNotice(rfq(), invite({ dealerUnsubscribedAt: "2026-10-27T10:00:00Z" }), mail, c), "opted_out");
    assert.deepEqual([a.sent.length, b.sent.length, c.sent.length], [0, 0, 0]);
  });
  it("a send that returns false or throws is logged and counted, never thrown at the buyer", async () => {
    resetOpsMetricsForTests();
    const original = console.error; const lines: string[] = []; console.error = (...a: unknown[]) => { lines.push(String(a[0])); };
    try {
      assert.equal(await sendCounterNotice(rfq(), invite(), mail, deps({ send: (async () => false) as never })), "failed");
      assert.equal(await sendCounterNotice(rfq(), invite(), mail, deps({ send: (async () => { throw new Error("resend down"); }) as never })), "failed");
    } finally { console.error = original; }
    assert.equal(opsSnapshot().counters.email_counter_failed, 2);
    assert.ok(lines.some((l) => /threw/.test(l)));
  });
  it("audit and test requests stay out of ops metrics", async () => {
    resetOpsMetricsForTests();
    await sendCounterNotice(rfq({ auditForcedSafeMode: true }), invite(), mail, deps());
    assert.deepEqual(opsSnapshot().counters, {});
  });
});

describe("wiring", () => {
  it("the counter route goes through sendCounterNotice and has no bare sender or swallowed catch", () => {
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts");
    assert.match(route, /sendCounterNotice\(rfq, invite,/);
    assert.doesNotMatch(route, /sendQuoteInviteEmail|\.catch\(\(\) => false\)/);
  });
  it("a failed admin approval alert leaves a trace", () => {
    const route = read("app/api/rfqs/route.ts");
    assert.match(route, /bump\("admin_alert_failed"\)/);
  });
  it("SAFE MODE itself is untouched: the sender still has no recipient argument", () => {
    const src = read("lib/dealerEmail.ts");
    assert.match(src, /export const SAFE_MODE_RECIPIENT = "pausmi@outlook\.com";/);
    assert.match(src, /to: \[SAFE_MODE_RECIPIENT\]/);
    assert.match(src, /export async function sendQuoteInviteEmail\(subject: string, html: string\)/);
  });
});
