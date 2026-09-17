// Admin approval before dealer release (2026-09-17). Nothing reaches a dealer
// until an admin approves the request: the outbox refuses unreleased
// requests wherever it's called from, the send route no longer sends after
// the buyer's click, and the admin desk is the only place a release happens.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { drainQueuedInvites, sendQueuedInvite } from "./inviteOutbox";
import { rfqIsReleased, type RfqInvite, type RfqRequest } from "./rfq";
import { approvalAlertHtml, approvalAlertSubject, approvalDeskUrl } from "./approvalAlertEmail";
import { inviteVehicleFor } from "./inviteDesk";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";

const invite = (over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id: "14", dealerName: "Route 22 Toyota", dealerContactEmail: "sales@route22toyota.com", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sales desk", role: "sales", emailMasked: "s••@r.com", source: "rooftop" }, vehicle: { vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", vdpUrl: null }, quote: null, ...over }) as unknown as RfqInvite;
const rfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "17", buyerUserId: "2", vin: "2T36CRAVXTC39J403", vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", status: "collecting", createdAt: "2026-09-17T00:00:00Z", packageKind: "links", linkPastes: [{ vin: "2T36CRAVXTC39J403", year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", dealerName: "Route 22 Toyota", dealerState: "NJ", vdpUrl: "https://www.route22toyota.com/x", condition: "new" }], invites, quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: null, tradeInExpected: false, ...over }) as unknown as RfqRequest;

describe("the outbox never sends an unreleased request", () => {
  const deps = () => {
    const sent: string[] = [];
    return { sent, deps: { directory: [], send: async (s: string) => { sent.push(s); return true; }, mark: (async () => {}) as never, emailEnabled: () => true } };
  };
  it("pending and rejected are held; approved sends; a row with no approvalStatus (box not yet patched) is held too — fail closed", async () => {
    resetOpsMetricsForTests();
    const d = deps();
    assert.equal(await sendQueuedInvite(rfq([invite()], { approvalStatus: "pending" }), invite(), d.deps), "held_for_approval");
    assert.equal(await sendQueuedInvite(rfq([invite()], { approvalStatus: "rejected" }), invite(), d.deps), "held_for_approval");
    assert.equal(d.sent.length, 0, "nothing left the building");
    assert.equal(opsSnapshot().counters.email_held_for_approval, 2);
    assert.equal(await sendQueuedInvite(rfq([invite()], { approvalStatus: "approved" }), invite(), d.deps), "sent");
    assert.equal(await sendQueuedInvite(rfq([invite({ id: "15" })]), invite({ id: "15" }), d.deps), "held_for_approval");
    assert.equal(d.sent.length, 1);
  });
  it("the gate comes before the email switch, so 'drain all' with the switch on still can't leak a pending request", async () => {
    const d = deps();
    const out = await drainQueuedInvites([rfq([invite({ id: "a" }), invite({ id: "b" })], { approvalStatus: "pending" }), rfq([invite({ id: "c" })], { id: "18", approvalStatus: "approved" })], d.deps);
    assert.equal(out.held_for_approval, 2);
    assert.equal(out.sent, 1);
    assert.deepEqual(d.sent.length, 1);
  });
  it("rfqIsReleased: only an explicit 'approved' counts (the tracker's display treats absent as released; the outbox does not)", () => {
    assert.equal(rfqIsReleased({ approvalStatus: "approved" }), true);
    assert.equal(rfqIsReleased({}), false);
    assert.equal(rfqIsReleased({ approvalStatus: "pending" }), false);
    assert.equal(rfqIsReleased({ approvalStatus: "rejected" }), false);
  });
});

describe("the admin alert email", () => {
  it("names the request, car, type, dealers and buyer, and links to the desk", () => {
    const r = rfq([invite()], { dealReference: "TS-ABC123", buyerNote: "No add-ons please" });
    assert.equal(approvalAlertSubject(r), "[Approval needed] TS-ABC123 · 2026 Toyota RAV4 XLE · Cash");
    const html = approvalAlertHtml(r);
    assert.match(html, /A quote request is waiting for approval/);
    assert.match(html, /Route 22 Toyota/);
    assert.match(html, /2T36CRAVXTC39J403/);
    assert.match(html, /No add-ons please/);
    assert.match(html, /\/admin\/approvals#rfq-17/);
    assert.match(approvalDeskUrl(r), /\/admin\/approvals#rfq-17$/);
    assert.doesNotMatch(html, /<script/);
  });
});

describe("wiring", () => {
  it("the buyer's send route queues only — no after() send — and tells the buyer it's under review", () => {
    const route = fs.readFileSync("app/api/rfqs/[id]/invites/route.ts", "utf8");
    assert.doesNotMatch(route, /sendQueuedInvite|after\(/, "no automatic send after the buyer's click");
    assert.match(route, /underReview: true, notice: DEGRADE_COPY\.underReview/);
    assert.match(route, /resolveInviteDesk\(rfq, \{ dealerName, dealerState, providedEmail/);
  });
  it("only the admin approval route releases, and it drains through the gated outbox", () => {
    const route = fs.readFileSync("app/api/admin/rfqs/[id]/approval/route.ts", "utf8");
    assert.match(route, /requireAdminSession\(\)/);
    assert.match(route, /setRfqApproval\(id, \{ decision, by, reason: decision === "rejected" \? reason : null \}\)/);
    assert.match(route, /if \(decision === "rejected" && !reason\) return NextResponse\.json\(\{ error: "A rejection needs a reason the buyer will read\." \}, \{ status: 400 \}\)/);
    assert.match(route, /drainQueuedInvites\(\[fresh\]\)/);
    const edit = fs.readFileSync("app/api/admin/rfqs/[id]/route.ts", "utf8");
    assert.match(edit, /adminPatchRfq\(id, \{ \.\.\.patch, adminEdit: \{ by: session\.user\?\.email/);
    const create = fs.readFileSync("app/api/rfqs/route.ts", "utf8");
    assert.match(create, /sendAdminApprovalAlert\(approvalAlertSubject\(rfq\), approvalAlertHtml\(rfq\)\)/, "one admin email per new request");
  });
  it("the box patch inserts every new request as pending and grandfathers existing rows as approved", () => {
    const box = fs.readFileSync("scrapers/lightsail-crawler/src/deals_api_server.js", "utf8");
    assert.match(box, /approval_status VARCHAR\(16\) NOT NULL DEFAULT 'approved'/);
    assert.match(box, /trade_in_expected, approval_status\)\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, 'collecting', \?, \?, \?, \?, \?, \?, \?, 'pending'\)/);
    assert.match(box, /async function handleRfqApproval/);
    assert.match(box, /async function handleAdminPatchRfq/);
    assert.match(box, /if \(\(rows\[0\]\.approval_status \|\| "approved"\) === "approved"\) return sendJson\(res, 409, \{ error: "released"/, "no edits after release");
    const script = fs.readFileSync("scripts/box/2026-09-17-rfq-approval.sh", "utf8");
    assert.match(script, /handleRfqApproval/);
  });
  it("inviteVehicleFor: the paste's car for its dealer, else the request's headline car", () => {
    const r = rfq([]);
    assert.equal(inviteVehicleFor(r, "route 22 toyota").vdpUrl, "https://www.route22toyota.com/x");
    assert.equal(inviteVehicleFor(r, "Somewhere Else").vdpUrl, null);
    assert.equal(inviteVehicleFor(r, "Somewhere Else").vin, "2T36CRAVXTC39J403");
  });
});
