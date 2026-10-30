// Buyer cash compare: "Best deal" needs two comparable quotes; the headline is the lowest out the door across every quote and says
// when that is an alternate vehicle; the best quote for the buyer's exact build is named separately.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashOutTheDoor, type UsedCashQuote } from "./usedQuote";
import { UsedCompare } from "../components/UsedCompare";
import type { RfqRequest } from "./rfq";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const ZIP = "07405";
const ASKED = "5J6RS4H53TL000001", ALT_A = "5J6RS4H53TL000002", ALT_B = "5J6RS4H53TL000003", EXACT_2 = ASKED;

const cash = (sellingPrice: number, fees: number, over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({
  kind: "cash", sellingPrice, msrp: 90000, addOns: [], noAddOns: true, miles: null, stockNumber: null, cpo: false, expiresAt: future, rebates: [],
  noSurcharges: true, dueAtSigning: [{ name: "Doc fee", amount: fees }], ...over,
});
// Basil: exact build, $90,000 + $10,000 ADM + $3,513 fees = $103,513. Brewster $91,783 and Burdick $91,238 are alternates.
const BASIL = cash(90000, 3513, { noSurcharges: false, surcharges: [{ name: "ADM", amount: 10000, reason: "Additional dealer markup" }] });
const BREWSTER = cash(88000, 3783);
const BURDICK = cash(88000, 3238);

type Q = { name: string; vin: string; used: UsedCashQuote };
const render = (qs: Q[], lane: "same_spec" | "alternate" = "same_spec") => renderToStaticMarkup(<UsedCompare rfq={({
  id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: ASKED, stockNumber: null, lane, alternateAsk: lane === "alternate" ? { bodyStyle: "SUV" } : null,
  vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: ZIP } },
  invites: qs.map((q, i) => ({ id: String(i + 1), dealerName: q.name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: null,
    quote: { id: `q${i + 1}`, price: q.used.sellingPrice, fees: [], totalOtdPrice: 0, vin: q.vin, stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used: q.used } })),
}) as unknown as RfqRequest} prefs={{ quoteType: "cash", cash: { zip: ZIP, timeline: null } } as never} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);

const glance = (html: string) => { const at = html.indexOf('data-testid="used-glance-best"'); return html.slice(at, html.indexOf("</div>", at)); };

describe("Basil (exact) vs Brewster and Burdick (alternates)", () => {
  const html = render([{ name: "Basil", vin: ASKED, used: BASIL }, { name: "Brewster", vin: ALT_A, used: BREWSTER }, { name: "Burdick", vin: ALT_B, used: BURDICK }]);
  it("the figures are the ones in the report", () => {
    assert.equal(cashOutTheDoor(BASIL), 103513);
    assert.equal(cashOutTheDoor(BREWSTER), 91783);
    assert.equal(cashOutTheDoor(BURDICK), 91238);
  });
  it("the headline is Burdick $91,238, labelled as an alternate", () => {
    const g = glance(html);
    assert.match(g, /Lowest out the door/);
    assert.match(g, /\$91,238/);
    assert.match(g, /Burdick/);
    assert.match(g, /Alternate vehicle/);
    assert.match(g, /tabular-nums">\$91,238<\/p>/, "the big number is Burdick's, not Basil's or Brewster's");
  });
  it("nobody gets 'Best deal': only one quote is comparable to the exact build", () => {
    assert.doesNotMatch(html, /badge-best-deal|Best deal/);
  });
  it("Basil gets 'Best for your exact build', in the headline note and on its column", () => {
    assert.match(html, /data-testid="badge-exact-build"/);
    assert.equal((html.match(/data-testid="badge-exact-build"/g) || []).length, 1);
    assert.match(glance(html), /Best for your exact build: Basil · \$103,513/);
  });
});

describe("when there is a real comparison", () => {
  it("two exact-build quotes: the cheaper gets Best deal", () => {
    const html = render([{ name: "Basil", vin: EXACT_2, used: BASIL }, { name: "Bluff", vin: ASKED, used: cash(90000, 3000) }]);
    assert.equal((html.match(/data-testid="badge-best-deal"/g) || []).length, 1);
    assert.doesNotMatch(html, /badge-exact-build/, "no alternates in the mix, so no separate exact-build note");
  });
  it("two alternates in the alternate lane are compared with each other, so Best deal is given", () => {
    const html = render([{ name: "Brewster", vin: ALT_A, used: BREWSTER }, { name: "Burdick", vin: ALT_B, used: BURDICK }], "alternate");
    assert.equal((html.match(/data-testid="badge-best-deal"/g) || []).length, 1);
    assert.doesNotMatch(html, /badge-exact-build/);
  });
  it("a lone quote is never 'Best deal'", () => {
    assert.doesNotMatch(render([{ name: "Basil", vin: ASKED, used: BASIL }]), /badge-best-deal/);
  });
  it("only alternates in the same-spec lane: still a headline, labelled alternate, no Best deal, no exact-build note", () => {
    const html = render([{ name: "Brewster", vin: ALT_A, used: BREWSTER }, { name: "Burdick", vin: ALT_B, used: BURDICK }]);
    assert.match(glance(html), /Burdick/);
    assert.match(glance(html), /Alternate vehicle/);
    assert.doesNotMatch(html, /badge-best-deal|badge-exact-build/);
  });
});
