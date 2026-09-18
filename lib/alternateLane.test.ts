// Quote intent (2026-09-17): same_spec vs alternate. The alternate lane needs no VIN; alternates
// never rank with same-spec quotes or win its cards; an alternate-only request compares among alternates.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { alternateAskSummary, buildAlternateAsk, EMPTY_ALTERNATE_DRAFT, isAlternateQuote, parseAlternateAsk } from "./alternateAsk";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";
import { rfqVehicleSummary } from "./rfqTracker";
import { quoteInviteHtml, quoteInviteSubject, type QuoteInviteEmailInput } from "./quoteInviteEmail";

describe("alternate ask", () => {
  it("builds from the draft; at least one thing must be said; money and links are checked", () => {
    assert.match(buildAlternateAsk(EMPTY_ALTERNATE_DRAFT).errors.join(" "), /at least one thing/);
    const ok = buildAlternateAsk({ ...EMPTY_ALTERNATE_DRAFT, bodyStyle: "SUV", makes: "Toyota, Honda", mustHaves: "AWD; heated seats", monthlyMax: "$500", dueAtSigningMax: "3,000" });
    assert.deepEqual(ok.ask, { bodyStyle: "SUV", makes: ["Toyota", "Honda"], mustHaves: ["AWD", "heated seats"], monthlyMax: 500, dueAtSigningMax: 3000, exampleUrl: null });
    assert.equal(alternateAskSummary(ok.ask), "SUV · Toyota, Honda · AWD, heated seats · ≤ $500/mo · ≤ $3,000 at signing");
    assert.match(buildAlternateAsk({ ...EMPTY_ALTERNATE_DRAFT, monthlyMax: "five hundred" }).errors.join(" "), /Monthly max must be a number/);
    assert.match(buildAlternateAsk({ ...EMPTY_ALTERNATE_DRAFT, exampleUrl: "route22toyota" }).errors.join(" "), /isn't a web address/);
    assert.equal(parseAlternateAsk({ makes: ["Kia", 5, ""], monthlyMax: -1, exampleUrl: "javascript:alert(1)" })!.exampleUrl, null);
    assert.deepEqual(parseAlternateAsk({ makes: ["Kia", 5, ""], monthlyMax: -1 })!.makes, ["Kia"]);
    assert.equal(alternateAskSummary(null), "Open to different vehicles");
  });
  it("isAlternateQuote: the alternate lane always; the same-spec lane only when the dealer quoted a different VIN", () => {
    assert.equal(isAlternateQuote({ lane: "alternate", vin: "" }, "ANYVIN"), true);
    assert.equal(isAlternateQuote({ lane: "same_spec", vin: "2T2HGCEZ9TC38B302" }, "2t2hgcez9tc38b302"), false);
    assert.equal(isAlternateQuote({ vin: "2T2HGCEZ9TC38B302" }, "2T2GKCEZXTC39B377"), true);
    assert.equal(isAlternateQuote({ vin: "2T2HGCEZ9TC38B302" }, null), false);
  });
});

const lease = (monthly: number, das: number): LeaseQuote => ({ capCost: 50000, residualPercent: 58, residualAmount: 30000, moneyFactor: 0.002, termMonths: 36, milesPerYear: 12000, capReduction: 0, monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: null, dueAtSigning: { firstMonth: monthly, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: das - monthly - 995 }] }, incentives: [], addOns: [], expiresAt: "2026-12-01T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" } });
const inv = (id: string, dealerName: string, vin: string, l: LeaseQuote): RfqInvite => ({ id, dealerName, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: "2026-09-17T00:00:00Z", respondedAt: null, quote: { id: `q${id}`, price: l.capCost, fees: [], totalOtdPrice: 0, vin, stockNumber: null, expiresAt: l.expiresAt, submittedAt: "2026-09-17T01:00:00Z", mustHaveAcknowledgement: true, notes: null, lease: l, supersededAt: null }, desk: { contactName: "Sam", role: "sales", emailMasked: "s••@x.com", source: "directory" } }) as unknown as RfqInvite;
const base = (over: Partial<RfqRequest>): RfqRequest => ({ id: "1", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-09-17T00:00:00Z", vin: "2T2HGCEZ9TC38B302", stockNumber: null, vehicleYear: 2026, vehicleMake: "Lexus", vehicleModel: "NX", vehicleTrim: "350", mustHaves: [], leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" }, invites: [], ...over }) as unknown as RfqRequest;
const NOW = new Date("2026-09-17T12:00:00Z");

describe("compare keeps the lanes apart", () => {
  it("same-spec lane: a cheaper quote on a DIFFERENT VIN is an alternate — its own block, never lowest on the cards", () => {
    const rfq = base({ invites: [inv("1", "Lexus of Route 10", "2T2HGCEZ9TC38B302", lease(718, 2955)), inv("2", "Bob Johnson Lexus", "2T2GKCEZXTC39B377", lease(600, 2000))] });
    const c = analyzeLeaseQuotes(rfq, NOW)!;
    assert.equal(c.lane, "same_spec");
    assert.equal(c.glance.lowestMonthly!.dealerName, "Lexus of Route 10", "the alternate's $600 never wins the same-spec card");
    assert.equal(c.glance.lowestDas!.dealerName, "Lexus of Route 10");
    const alt = c.rows.find((r) => r.dealerName === "Bob Johnson Lexus")!;
    assert.equal(alt.alternate, true); assert.equal(alt.quotedVin, "2T2GKCEZXTC39B377"); assert.equal(alt.bestMonthly, false); assert.equal(alt.kind, "eligible");
    assert.equal(c.rows.find((r) => r.dealerName === "Lexus of Route 10")!.alternate, false);
    assert.match(c.glance.watchOuts!, /1 alternate vehicle proposed/);
    assert.equal(c.counts.eligible, 1);
  });
  it("alternate lane: every quote is an alternate and the cards compare among them; no VIN on the request", () => {
    const rfq = base({ lane: "alternate", vin: "", vehicleYear: 0, vehicleMake: "Open", vehicleModel: "to alternatives", vehicleTrim: "", alternateAsk: { bodyStyle: "SUV", makes: ["Lexus"], mustHaves: ["AWD"], monthlyMax: 700, dueAtSigningMax: null, exampleUrl: null }, invites: [inv("1", "Lexus of Route 10", "2T2HGCEZ9TC38B302", lease(718, 2955)), inv("2", "Bob Johnson Lexus", "2T2GKCEZXTC39B377", lease(600, 2000))] });
    const c = analyzeLeaseQuotes(rfq, NOW)!;
    assert.equal(c.lane, "alternate");
    assert.equal(c.askSummary, "SUV · Lexus · AWD · ≤ $700/mo");
    assert.equal(c.glance.lowestMonthly!.dealerName, "Bob Johnson Lexus");
    assert.equal(c.counts.eligible, 2);
    assert.ok(c.rows.every((r) => r.alternate));
    assert.equal(rfqVehicleSummary(rfq), "Open to different vehicles — SUV · Lexus · AWD · ≤ $700/mo");
  });
  it("the dealer's email on the alternate lane carries the ask, not a VIN", () => {
    const input: QuoteInviteEmailInput = { quoteType: "lease", dealerName: "Lexus of Route 10", contactName: "Sam", role: "sales", rooftop: { city: null, state: "NJ", address: null }, vehicle: { vin: "", vdpUrl: null }, dealReference: "TQ-ABC123", viewUrl: "https://x/view?t=1", unsubscribeUrl: null, purchaseTimelineLabel: null, buyerZip: "07981", leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" }, financePrefs: null, buyerNote: null, tradeInExpected: null, alternateAsk: "SUV · Lexus · AWD · ≤ $700/mo" } as unknown as QuoteInviteEmailInput;
    assert.doesNotMatch(quoteInviteSubject(input), /VIN …/);
    assert.match(quoteInviteSubject(input), /open to different vehicles/);
    const html = quoteInviteHtml(input);
    assert.match(html, /Open to different vehicles/); assert.match(html, /SUV · Lexus · AWD · ≤ \$700\/mo/); assert.match(html, /enter its VIN when you quote/);
    assert.doesNotMatch(html, /VIN <\/div>|>VIN </, "no empty VIN line");
  });
});

describe("wiring", () => {
  it("wizard: intent is asked before the VIN fields; the alternate lane sends lane + ask and no pastes; box + route accept it", () => {
    const w = fs.readFileSync("components/BiddingWizard.tsx", "utf8");
    const picker = w.indexOf('data-testid="intent-picker"');
    const vehicle = w.indexOf('id="primary-link-input"');
    assert.ok(picker > -1 && picker < vehicle, "intent picker renders above the paste box");
    assert.match(w, /trackEvent\("rfq_intent_selected", \{ intent: next \}\)/);
    assert.match(w, /const vehicleImported = intent === "alternate" \? true/, "path B leaves Step 1 on intent alone — dealers chosen on the later step");
    assert.match(w, /lane: alternateLane \? "alternate" : "same_spec",/);
    assert.match(w, /linkPastes: alternateLane \? \[\] : pastes,/);
    assert.match(w, /\{\(intent === "same_spec" && intentConfirmed\) \|\| lockVehicleSelection \? \(/, "the VIN / link section only on path A, and only after the intent substep");
    const route = fs.readFileSync("app/api/rfqs/route.ts", "utf8");
    assert.match(route, /const lane = body\.lane === "alternate" \? "alternate" : "same_spec";/);
    assert.match(route, /\} else if \(lane === "alternate"\) \{/, "no 1-to-3-vehicles rule on the alternate lane");
    const box = fs.readFileSync("scrapers/lightsail-crawler/src/deals_api_server.js", "utf8");
    assert.match(box, /ADD COLUMN IF NOT EXISTS lane VARCHAR\(16\) NOT NULL DEFAULT 'same_spec'/);
    assert.match(box, /if \(lane === "same_spec"\) \{\s*if \(!vin\) return badRequest\(res, "vin is required"\);/);
    assert.match(fs.readFileSync("scripts/box/2026-09-17-rfq-lane.sh", "utf8"), /lane columns/);
    const lc = fs.readFileSync("components/LeaseCompare.tsx", "utf8");
    assert.match(lc, /data-testid="alternate-divider"/); assert.match(lc, /among alternate quotes/);
    const uc = fs.readFileSync("components/UsedCompare.tsx", "utf8");
    assert.match(uc, /data-testid="alternate-badge"/); assert.match(uc, /compared among alternate quotes/);
  });
});
