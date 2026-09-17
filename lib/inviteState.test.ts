import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inviteUnsubscribed,
  inviteUnsubscribedNoQuote,
  inviteAcceptsCounter,
  unsubscribedDealers,
  rfqNeedsRepick,
  unsubscribedBannerCopy,
} from "./inviteState";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-17T12:00:00Z");

const lease = (over: Partial<LeaseQuote> = {}): LeaseQuote => ({
  capCost: 52000, residualPercent: 58, residualAmount: 30160, moneyFactor: 0.00225, termMonths: 36, milesPerYear: 10000, capReduction: 0,
  monthlyPaymentPreTax: 612, monthlyPaymentWithEstTax: 652.5,
  dueAtSigning: { firstMonth: 652.5, acquisitionFee: 695, capReduction: 0, taxes: 0, otherFees: [] },
  incentives: [], addOns: [], expiresAt: "2026-09-30T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" }, ...over,
});

const invite = (over: Partial<RfqInvite> & { id: string; dealerName: string }): RfqInvite => {
  const l = over.quote ? null : undefined; // no-op; explicit quote passed via over when needed
  void l;
  return {
    id: over.id, dealerName: over.dealerName, dealerContactEmail: null,
    status: over.status ?? "invited", declineReason: null, invitedAt: "2026-09-17T00:00:00Z", respondedAt: null,
    quote: over.quote ?? null,
    dealerUnsubscribedAt: over.dealerUnsubscribedAt ?? null,
    desk: { contactName: `${over.dealerName} desk`, role: "gsm", emailMasked: "x••@d.com", source: "directory" },
  } as RfqInvite;
};

const quoteFor = (id: string, l: LeaseQuote): RfqInvite["quote"] =>
  ({ id: `q${id}`, price: l.monthlyPaymentPreTax, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: l.expiresAt, mustHaveAcknowledgement: true, notes: null, lease: l } as unknown as RfqInvite["quote"]);

const rfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: "1", buyerUserId: "b", invites, status: "collecting", pickedQuoteId: null, createdAt: "2026-09-17T00:00:00Z",
  vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", mustHaves: [],
  leasePrefs: { termMonths: 36, milesPerYear: 10000, zip: "07405", timeline: null }, ...over,
});

describe("inviteState — dealer unsubscribe helpers", () => {
  it("scenario 1: sole invite, no quote, unsubscribed → needs re-pick", () => {
    const only = invite({ id: "1", dealerName: "Solo Chevrolet", dealerUnsubscribedAt: "2026-09-17T10:00:00Z" });
    const r = rfq([only]);
    assert.equal(inviteUnsubscribed(only), true);
    assert.equal(inviteUnsubscribedNoQuote(only), true);
    assert.equal(inviteAcceptsCounter(only), false);
    assert.equal(rfqNeedsRepick(r), true);
    const dealers = unsubscribedDealers(r);
    assert.deepEqual(dealers, [{ dealerName: "Solo Chevrolet", hadQuote: false, inviteId: "1" }]);
    assert.match(unsubscribedBannerCopy(dealers)!.title, /Solo Chevrolet is no longer accepting/);
  });

  it("scenario 2: multi-dealer, one unsubscribed (no quote) — the other is still live, no re-pick", () => {
    const gone = invite({ id: "1", dealerName: "Gone Chevrolet", dealerUnsubscribedAt: "2026-09-17T10:00:00Z" });
    const live = invite({ id: "2", dealerName: "Live Chevrolet", status: "invited" });
    const r = rfq([gone, live]);
    assert.equal(rfqNeedsRepick(r), false); // a live rooftop remains
    assert.deepEqual(unsubscribedDealers(r).map((d) => d.dealerName), ["Gone Chevrolet"]);
    // counter/reply expectations: off for the unsubscribed one, on for a quoted live one
    assert.equal(inviteAcceptsCounter(gone), false);
  });

  it("scenario 3: quote already in before the dealer unsubscribed — stays choosable, counter off, chip shown", () => {
    const l = lease({ monthlyPaymentPreTax: 599 });
    const withQuote = invite({ id: "1", dealerName: "Quoted Chevrolet", status: "quoted", quote: quoteFor("1", l), dealerUnsubscribedAt: "2026-09-17T10:00:00Z" });
    const r = rfq([withQuote]);
    assert.equal(inviteUnsubscribedNoQuote(withQuote), false); // there IS a quote to keep
    assert.equal(inviteAcceptsCounter(withQuote), false);       // but no counters to an unsubscribed desk
    assert.equal(rfqNeedsRepick(r), false);                     // a quote is choosable, nothing to re-pick
    assert.deepEqual(unsubscribedDealers(r), [{ dealerName: "Quoted Chevrolet", hadQuote: true, inviteId: "1" }]);
    // the compare keeps the quote as an eligible, choosable row and flags it unsubscribed
    const c = analyzeLeaseQuotes(r, NOW)!;
    const row = c.rows.find((x) => x.dealerName === "Quoted Chevrolet")!;
    assert.equal(row.unsubscribed, true);
    assert.equal(row.kind, "eligible");
    assert.ok(row.quoteId, "quote stays choosable");
    assert.ok(row.chips.includes("Unsubscribed — won't reply"));
  });

  it("no-quote unsubscribed row is classified 'unsubscribed' in the compare, not 'waiting'", () => {
    const gone = invite({ id: "1", dealerName: "Gone Chevrolet", dealerUnsubscribedAt: "2026-09-17T10:00:00Z" });
    const quoted = invite({ id: "2", dealerName: "Quoted Chevrolet", status: "quoted", quote: quoteFor("2", lease({ monthlyPaymentPreTax: 620 })) });
    const c = analyzeLeaseQuotes(rfq([gone, quoted]), NOW)!;
    const goneRow = c.rows.find((x) => x.dealerName === "Gone Chevrolet")!;
    assert.equal(goneRow.kind, "unsubscribed");
    assert.deepEqual(goneRow.chips, ["Unsubscribed — won't reply"]);
  });

  it("banner copy stays neutral and never uses auction language", () => {
    const copy = unsubscribedBannerCopy([
      { dealerName: "A Ford", hadQuote: false, inviteId: "1" },
      { dealerName: "B Ford", hadQuote: true, inviteId: "2" },
    ])!;
    assert.match(copy.title, /2 dealerships are no longer accepting/);
    assert.match(copy.body, /Choose a different vehicle at another dealership/);
    assert.doesNotMatch(`${copy.title} ${copy.body}`, /bid|auction/i);
  });

  it("no unsubscribed rooftops → no banner", () => {
    assert.equal(unsubscribedBannerCopy(unsubscribedDealers(rfq([invite({ id: "1", dealerName: "Normal Chevrolet" })]))), null);
  });
});
