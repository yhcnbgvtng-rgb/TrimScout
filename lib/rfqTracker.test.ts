import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEASE_SHEET_RULES,
  leaseSheetRows,
  relativeTime,
  rfqDealNumber,
  rfqQuoteTypeLabel,
  rfqTrackerStatus,
  rfqTrackerStatusLabel,
  rfqVehicleSummary,
  rfqVehicles,
  RFQ_LIFECYCLE,
  rfqLifecycleDetail,
  rfqLifecycleStage,
} from "./rfqTracker";
import type { RfqInvite, RfqRequest } from "./rfq";

const base = (over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: "118",
  buyerUserId: "u1",
  invites: [],
  status: "collecting",
  pickedQuoteId: null,
  createdAt: "2026-09-13T12:00:00Z",
  vin: "1GNS6MKD2TR280381",
  stockNumber: null,
  vehicleYear: 2026,
  vehicleMake: "Chevrolet",
  vehicleModel: "Tahoe",
  vehicleTrim: "LS",
  mustHaves: [],
  packageKind: "links",
  dealReference: "TS-K7M3Q2",
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: "this_month" },
  linkPastes: [
    { vin: "1GNS6MKD2TR280381", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", dealerName: "Scott Chevrolet", dealerState: "PA", vdpUrl: "https://www.scottcars.net/x", buildConfidence: "verified_factory" },
    { vin: "1GNS6NKD5TR434507", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LT", dealerName: "Schumacher Chevrolet of Denville", dealerState: "NJ", vdpUrl: null, buildConfidence: "dealer_listing_only" },
  ],
  ...over,
});
const invite = (over: Partial<RfqInvite>): RfqInvite => ({ id: "i1", dealerName: "Scott Chevrolet", dealerContactEmail: null, status: "invited", declineReason: null, invitedAt: "2026-09-13T12:00:00Z", respondedAt: null, quote: null, ...over });
const quoted = invite({ id: "i2", status: "quoted", quote: { id: "q1", price: 0, otdPrice: 0, notes: null, submittedAt: "2026-09-13T13:00:00Z" } as unknown as RfqInvite["quote"] });

describe("rfqTracker — what My Deal Tracker shows for a lease quote request", () => {
  it("reads the package's vehicles with desk, state and the factory-verified flag", () => {
    const vs = rfqVehicles(base());
    assert.equal(vs.length, 2);
    assert.deepEqual([vs[0].dealerName, vs[0].dealerState, vs[0].factoryVerified], ["Scott Chevrolet", "PA", true]);
    assert.deepEqual([vs[1].dealerName, vs[1].factoryVerified], ["Schumacher Chevrolet of Denville", false]);
    assert.equal(rfqVehicleSummary(base()), "2026 Chevrolet Tahoe LS + 1 more");
    assert.equal(rfqVehicleSummary(base({ linkPastes: [] })), "2026 Chevrolet Tahoe LS", "falls back to the spec fields");
  });

  it("status: awaiting → quotes in → closed (chosen / walked)", () => {
    assert.equal(rfqTrackerStatus(base({ invites: [invite({})] })), "awaiting");
    assert.equal(rfqTrackerStatusLabel(base({ invites: [invite({})] })), "Awaiting quotes");
    assert.equal(rfqTrackerStatusLabel(base({ invites: [invite({}), quoted] })), "1 quote in");
    assert.equal(rfqTrackerStatusLabel(base({ status: "picked", invites: [quoted] })), "Closed — quote chosen");
    assert.equal(rfqTrackerStatusLabel(base({ status: "walked" })), "Closed — walked away");
  });

  it("quote type is Lease only when lease prefs are on the request; deal number prefers TS-…", () => {
    assert.equal(rfqQuoteTypeLabel(base()), "Lease");
    assert.equal(rfqQuoteTypeLabel(base({ leasePrefs: null })), "Quote");
    assert.equal(rfqDealNumber(base()), "TS-K7M3Q2");
    assert.equal(rfqDealNumber(base({ dealReference: null })), "#118");
  });

  it("the lease sheet rows are the buyer's Step 2 prefs (term, miles, ZIP, timeline), optional ones only when set; rules line is fixed", () => {
    assert.deepEqual(leaseSheetRows(base().leasePrefs!), [
      { label: "Term", value: "36 months" },
      { label: "Miles / year", value: "10,000" },
      { label: "ZIP", value: "07405 (tax context)" },
      { label: "Timeline", value: "Within the month" },
    ]);
    const bare = { termMonths: 36 as const, milesPerYear: 10000 as const, zip: "", timeline: null };
    assert.deepEqual(leaseSheetRows(bare), [
      { label: "Term", value: "36 months" },
      { label: "Miles / year", value: "10,000" },
    ]);
    assert.match(LEASE_SHEET_RULES, /lease calculator — or mark a counter\. Request, not a binding bid\./);
    assert.doesNotMatch(LEASE_SHEET_RULES, /auction/i);
  });

  it("relative time reads like a person wrote it", () => {
    const now = new Date("2026-09-13T12:00:00Z").getTime();
    assert.equal(relativeTime("2026-09-13T11:59:40Z", now), "Just now");
    assert.equal(relativeTime("2026-09-13T11:45:00Z", now), "15 min ago");
    assert.equal(relativeTime("2026-09-13T09:00:00Z", now), "3 h ago");
    assert.equal(relativeTime("2026-09-12T12:00:00Z", now), "Yesterday");
    assert.equal(relativeTime("garbage", now), "");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — send lands in My Deal Tracker; the deal page carries the sheet; dealers still only quote via the calculator", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const wizard = read("components/BiddingWizard.tsx");
  const page = read("app/page.tsx");
  const tracker = read("components/DealTrackerDashboard.tsx");
  const detail = read("app/rfq/[id]/page.tsx");

  it("a package with ≥1 desk sent hands off to the host; all-blocked stays on the wizard with the reasons", () => {
    assert.match(wizard, /if \(onQuoteRequestSent && sentRows\.some\(\(r\) => r\.sent\)\) \{[\s\S]*?onQuoteRequestSent\(\{ rfqId, rows: sentRows \}\);\s*return;/);
    assert.match(wizard, /setSentPackage\(\{ rfqId, rows \}\);/);
    assert.match(page, /onQuoteRequestSent=\{\(sent\) => \{[\s\S]*?setFocusRfqId\(sent\.rfqId\);[\s\S]*?setCurrentView\("track_deals"\);/);
  });

  it("the tracker lists quote requests from /api/rfqs (so refresh / re-login finds them) with deal #, vehicle, Lease, status, desks, time", () => {
    assert.match(page, /fetch\("\/api\/rfqs"\)/);
    assert.match(tracker, /data-testid="quote-requests"/);
    for (const fn of ["rfqDealNumber", "rfqQuoteTypeLabel", "rfqTrackerStatusLabel", "rfqVehicleSummary", "relativeTime"]) assert.match(tracker, new RegExp(`${fn}\\(rfq`));
    assert.match(tracker, /desk\{rfq\.invites\.length === 1 \? "" : "s"\} invited/);
    assert.match(tracker, /href=\{`\/rfq\/\$\{rfq\.id\}`\}/);
  });

  it("the deal page shows the Lease quote sheet for lease requests, above the compare; no auction copy", () => {
    assert.match(detail, /\{rfq\.leasePrefs \? <LeaseQuoteSheet rfq=\{rfq\} onSaved=\{setRfq\} \/> : null\}/);
    assert.match(detail, /<LeaseCompare data=\{leaseCompare \|\| analyzeLeaseQuotes\(rfq\)!\}/);
    const sheet = read("components/LeaseQuoteSheet.tsx");
    assert.match(sheet, /LEASE_SHEET_RULES/);
    assert.match(sheet, /emailMasked/);
    assert.doesNotMatch(sheet, /dealerContactEmail|auction|bid\b/i);
  });
});

describe("lifecycle strip — Draft → In progress → Sent, awaiting dealer response → Walked away | Successful", () => {
  const inv = (over: Record<string, unknown>) => ({ id: "1", dealerName: "D", status: "invited", deliveryStatus: "sent", quote: null, ...over }) as unknown as RfqRequest["invites"][number];
  const rfq = (over: Partial<RfqRequest>) => ({ status: "collecting", invites: [], ...over }) as unknown as RfqRequest;
  it("stages", () => {
    assert.equal(rfqLifecycleStage(rfq({ invites: [] })), "in_progress");
    assert.equal(rfqLifecycleStage(rfq({ invites: [inv({ deliveryStatus: "queued" })] })), "in_progress");
    assert.equal(rfqLifecycleStage(rfq({ invites: [inv({}), inv({ id: "2", deliveryStatus: "queued" })] })), "in_progress", "one still queued");
    assert.equal(rfqLifecycleStage(rfq({ invites: [inv({})] })), "awaiting");
    assert.equal(rfqLifecycleStage(rfq({ invites: [inv({ deliveryStatus: "viewed" })] })), "awaiting");
    assert.equal(rfqLifecycleStage(rfq({ invites: [inv({ status: "quoted", quote: { id: "q" } })] })), "awaiting", "quotes in is still the sent stage — the buyer decides");
    assert.equal(rfqLifecycleStage(rfq({ status: "walked", invites: [inv({})] })), "walked");
    assert.equal(rfqLifecycleStage(rfq({ status: "picked", invites: [inv({ status: "quoted", quote: { id: "q" } })] })), "successful");
  });
  it("detail line names what's happening", () => {
    assert.match(rfqLifecycleDetail(rfq({ invites: [inv({}), inv({ id: "2" })] })), /2 dealers have it — none has replied yet/);
    assert.match(rfqLifecycleDetail(rfq({ invites: [inv({ status: "quoted", quote: { id: "q" } }), inv({ id: "2" })] })), /1 of 2 dealers replied — compare and pick one, or walk away/);
    assert.match(rfqLifecycleDetail(rfq({ invites: [inv({ deliveryStatus: "queued" })] })), /Sending to 1 dealer…/);
    assert.match(rfqLifecycleDetail(rfq({ status: "walked" })), /walked away/);
    assert.match(rfqLifecycleDetail(rfq({ status: "picked" })), /chose a quote/);
  });
  it("labels, in order, are the five the buyer sees", () => {
    assert.deepEqual(RFQ_LIFECYCLE.map((s) => s.label), ["Draft", "In progress", "Sent — awaiting dealer response", "Walked away", "Successful"]);
  });
  it("wiring: every tracker card opens with the strip; a saved draft gets its own card with Resume", () => {
    const d = fs.readFileSync(path.join(process.cwd(), "components/DealTrackerDashboard.tsx"), "utf8");
    assert.match(d, /<QuoteStatusStrip stage=\{rfqLifecycleStage\(rfq\)\} detail=\{rfqLifecycleDetail\(rfq\)\} \/>\s*<div className="flex flex-wrap items-start justify-between gap-2">/);
    assert.match(d, /data-testid="quote-draft"[\s\S]*?<QuoteStatusStrip stage="draft"[\s\S]*?Resume/);
    assert.match(d, /readQuoteDraft\(\)/);
  });
});
