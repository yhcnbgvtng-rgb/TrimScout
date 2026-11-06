// Quote compare ranking: out the door counts proven rebates only; a conditional rebate is shown, not subtracted. One green winner,
// ties settled by fewer add-ons then the later expiry; % off MSRP never ranks; alternates are never ranked against the exact build.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashOtdIfEligible, cashOutTheDoor, financeCashDue, parseRebateLines, validateUsedQuote, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";
import { compareCashQuotes, rankGenericQuotes, tieBreakCash } from "./cashCompare";
import { applyCashCounter, applyFinanceCounter, keepRebateEligibility } from "./counterSheet";
import { UsedCompare } from "../components/UsedCompare";
import type { RfqRequest } from "./rfq";

const day = 864e5;
const at = (days: number) => new Date(Date.now() + days * day).toISOString();
const ZIP = "07405";
const ASKED = "5J6RS4H53TL000001", ALT_A = "5J6RS4H53TL000002", ALT_B = "5J6RS4H53TL000003", EXACT_B = ASKED;

const cash = (sellingPrice: number, fees: number, over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({
  kind: "cash", sellingPrice, msrp: 50000, addOns: [], noAddOns: true, miles: null, stockNumber: null, cpo: false, expiresAt: at(5), rebates: [],
  noSurcharges: true, dueAtSigning: [{ name: "Doc fee", amount: fees }], ...over,
});
const PROVEN = { name: "Dealer cash", amount: 1000 };
const COND = { name: "Loyalty cash", amount: 1500, eligibility: "conditional" as const, condition: "current Honda owner" };

describe("out the door counts proven rebates only", () => {
  it("a rebate with no eligibility field (every older quote) is proven and is subtracted", () => {
    assert.equal(cashOutTheDoor(cash(40000, 500, { rebates: [PROVEN] })), 39500);
  });
  it("a conditional rebate is not subtracted from the ranked out the door", () => {
    assert.equal(cashOutTheDoor(cash(40000, 500, { rebates: [PROVEN, COND] })), 39500);
    assert.equal(cashOutTheDoor(cash(40000, 500, { rebates: [COND] })), 40500);
  });
  it("out the door if eligible takes the conditional ones off too, and equals the ranked figure when there are none", () => {
    assert.equal(cashOtdIfEligible(cash(40000, 500, { rebates: [PROVEN, COND] })), 38000);
    assert.equal(cashOtdIfEligible(cash(40000, 500, { rebates: [PROVEN] })), cashOutTheDoor(cash(40000, 500, { rebates: [PROVEN] })));
  });
  it("finance cash due follows the same rule", () => {
    const f = { downPayment: 2000, dueAtSigning: [{ name: "Doc fee", amount: 500 }], addOns: [], rebates: [PROVEN, COND] };
    assert.equal(financeCashDue(f), 1500);
  });
  it("a conditional rebate needs a note on what to qualify for", () => {
    const prefs = { quoteType: "cash", cash: { zip: ZIP, timeline: null } } as never;
    const q = cash(40000, 500, { dueAtSigning: [{ name: "Doc fee", amount: 500 }, { name: "Sales tax", amount: 0 }, { name: "Title & registration", amount: 0 }], rebates: [{ ...COND, condition: "" }] });
    const bad = validateUsedQuote(q, prefs, { vin: ASKED }).errors.join(" ");
    assert.match(bad, /conditional rebate needs a short note/i);
    const ok = validateUsedQuote({ ...q, rebates: [COND] }, prefs, { vin: ASKED }).errors.join(" ");
    assert.doesNotMatch(ok, /conditional rebate/i);
  });
  it("the server read keeps the conditional mark and note, and nothing else is conditional", () => {
    const r = parseRebateLines([{ name: "A", amount: "100" }, { name: "B", amount: 200, eligibility: "conditional", condition: "  vet   only " }, { name: "C", amount: 5, eligibility: "weird" }]);
    assert.deepEqual(r, [{ name: "A", amount: 100 }, { name: "B", amount: 200, eligibility: "conditional", condition: "vet only" }, { name: "C", amount: 5 }]);
  });
  it("a buyer counter cannot turn the dealer's conditional rebate into a proven one", () => {
    const before = cash(40000, 500, { rebates: [PROVEN, COND] });
    // The counter form sends name + amount only.
    const after = applyCashCounter(before, { rebates: [{ name: "Dealer cash", amount: 1000 }, { name: "Loyalty cash", amount: 1500 }] });
    assert.equal(after.rebates?.find((l) => l.name === "Loyalty cash")?.eligibility, "conditional");
    assert.equal(cashOutTheDoor(after), 39500);
    assert.deepEqual(keepRebateEligibility([{ name: "Brand new", amount: 300 }], before.rebates), [{ name: "Brand new", amount: 300 }], "a line the buyer adds is theirs to claim");
  });
  it("finance counter: the amount financed moves by proven rebates only", () => {
    const before = { kind: "finance", sellingPrice: 40000, msrp: 50000, addOns: [], noAddOns: true, miles: null, stockNumber: null, cpo: false, expiresAt: at(5), rebates: [COND], noSurcharges: true, dueAtSigning: [{ name: "Doc fee", amount: 500 }], downPayment: 0, amountFinanced: 40500, apr: 5, termMonths: 60, monthlyPaymentPreTax: 764, monthlyPaymentWithEstTax: null } as UsedFinanceQuote;
    const same = applyFinanceCounter(before, { rebates: [{ name: "Loyalty cash", amount: 1500 }] });
    assert.equal(same.amountFinanced, 40500, "the conditional rebate was never in the amount financed, so nothing moves");
    const withProven = applyFinanceCounter(before, { rebates: [{ name: "Loyalty cash", amount: 1500 }, { name: "Buyer-claimed", amount: 500 }] });
    assert.equal(withProven.amountFinanced, 40000);
  });
});

describe("one winner; ties", () => {
  const A = cash(40000, 500, { addOns: [{ name: "Nitrogen", amount: 200 }], noAddOns: false, expiresAt: at(9) });
  const B = cash(40000, 500, { expiresAt: at(3) });
  const C = cash(40000, 500, { expiresAt: at(9) });
  it("same out the door: fewer add-ons first", () => {
    // A has an add-on so its OTD is $200 higher; give B the same OTD another way.
    const aSame = cash(39800, 500, { addOns: [{ name: "Nitrogen", amount: 200 }], noAddOns: false });
    const bSame = cash(40000, 500);
    assert.equal(cashOutTheDoor(aSame), cashOutTheDoor(bSame));
    assert.ok(tieBreakCash(bSame, aSame) < 0, "the one with no add-ons sorts first");
  });
  it("then the earlier expiry goes last", () => {
    assert.ok(tieBreakCash(C, B) < 0);
    assert.ok(tieBreakCash(B, C) > 0);
    assert.equal(tieBreakCash(C, C), 0);
  });
  it("a quote with no end date is never the one that expires first", () => {
    assert.ok(tieBreakCash(cash(40000, 500, { expiresAt: "" }), C) < 0);
  });
  it("the lowest-out-the-door badge goes to exactly one of several tied quotes", () => {
    const r = compareCashQuotes([
      { id: "1", otd: 40500, quote: B }, { id: "2", otd: 40500, quote: C }, { id: "3", otd: 41000, quote: cash(40500, 500) },
    ]);
    assert.deepEqual(r.lowestOtd, ["2"], "same OTD, same add-ons: the later expiry wins");
  });
  it("% off MSRP never moves the winner: the deeper discount with the higher OTD does not win", () => {
    const deep = cash(30000, 9000, { msrp: 50000 }); // 40% off, OTD 39,000
    const shallow = cash(39000, 0, { msrp: 40000 });   // 2.5% off, OTD 39,000 - add a dollar
    const cheaper = cash(38900, 0, { msrp: 40000 });
    const r = compareCashQuotes([{ id: "deep", otd: cashOutTheDoor(deep), quote: deep }, { id: "cheap", otd: cashOutTheDoor(cheaper), quote: cheaper }, { id: "sh", otd: cashOutTheDoor(shallow), quote: shallow }]);
    assert.deepEqual(r.lowestOtd, ["cheap"]);
    assert.deepEqual(r.biggestDiscount, ["deep"], "the discount is its own fairness badge, not the rank");
  });
});

describe("plain quote cards", () => {
  const rows = [
    { id: "alt", otd: 30000, exact: false },
    { id: "b", otd: 41000, exact: true },
    { id: "a", otd: 40000, exact: true },
  ];
  it("exact-build by lowest OTD first, alternates after; one winner", () => {
    const r = rankGenericQuotes(rows);
    assert.deepEqual(r.order, ["a", "b", "alt"]);
    assert.equal(r.lowestId, "a");
  });
  it("an alternate never wins, however cheap", () => {
    assert.notEqual(rankGenericQuotes(rows).lowestId, "alt");
  });
  it("no winner without a real comparison: one exact build, or an exact tie", () => {
    assert.equal(rankGenericQuotes([{ id: "a", otd: 1, exact: true }, { id: "x", otd: 0, exact: false }]).lowestId, null);
    assert.equal(rankGenericQuotes([{ id: "a", otd: 5, exact: true }, { id: "b", otd: 5, exact: true }]).lowestId, null);
  });
});

type Q = { name: string; vin: string; used: UsedCashQuote };
const render = (qs: Q[]) => renderToStaticMarkup(<UsedCompare rfq={({
  id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: at(0), vin: ASKED, stockNumber: null, lane: "same_spec", alternateAsk: null,
  vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: ZIP } },
  invites: qs.map((q, i) => ({ id: String(i + 1), dealerName: q.name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: at(0), respondedAt: at(0), tradeAppraisal: null,
    quote: { id: `q${i + 1}`, price: q.used.sellingPrice, fees: [], totalOtdPrice: 0, vin: q.vin, stockNumber: null, expiresAt: at(5), submittedAt: at(0), mustHaveAcknowledgement: true, notes: null, used: q.used } })),
}) as unknown as RfqRequest} prefs={{ quoteType: "cash", cash: { zip: ZIP, timeline: null } } as never} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const colOrder = (html: string) => [...html.matchAll(/<span class="block text-sm font-bold leading-snug text-white">([^<]+)<\/span>/g)].map((m) => m[1]);
const glance = (html: string) => { const i = html.indexOf('data-testid="used-glance-best"'); return i < 0 ? "" : html.slice(i, html.indexOf("</div>", i)); };

describe("UsedCompare: proven vs conditional", () => {
  // Zed's headline price is lower only if the conditional rebate is counted.
  const zed = cash(40000, 500, { rebates: [COND] });           // ranked 40,500; if eligible 39,000
  const yan = cash(40000, 500, { rebates: [PROVEN] });         // ranked 39,500
  const html = render([{ name: "Zed", vin: ASKED, used: zed }, { name: "Yan", vin: ASKED, used: yan }]);
  it("ranks on the proven figure: Yan first even though Zed would win with the conditional rebate", () => {
    assert.deepEqual(colOrder(html), ["Yan", "Zed"]);
    assert.match(glance(html), /\$39,500/);
    assert.match(glance(html), /Yan/);
  });
  it("shows the conditional rebate as not applied with its condition, plus out the door if eligible", () => {
    assert.match(html, /data-testid="conditional-rebates"[\s\S]*Not applied — if you qualify[\s\S]*Loyalty cash[\s\S]*current Honda owner/);
    assert.match(html, /data-testid="otd-if-eligible">\$39,000/);
    assert.match(html, /not ranked/);
  });
  it("exactly one 'Lowest out the door' badge", () => {
    assert.equal((html.match(/data-testid="badge-lowest-otd"/g) || []).length, 1);
  });
  it("no 'if eligible' row when nobody has a conditional rebate", () => {
    assert.doesNotMatch(render([{ name: "Yan", vin: ASKED, used: yan }, { name: "Xi", vin: ASKED, used: cash(41000, 500) }]), /otd-if-eligible|Out the door if eligible/);
  });
  it("proven rebate lines are still listed and subtracted as before", () => {
    assert.match(html, /data-testid="rebate-lines"/);
    assert.match(html, />Dealer cash<\/span><span>−\$1,000/);
  });
});

describe("UsedCompare: ties and alternates", () => {
  it("two exact-build quotes tied on OTD: only one green winner; the one with fewer add-ons is first", () => {
    const withAddOn = cash(39800, 500, { addOns: [{ name: "Nitrogen", amount: 200 }], noAddOns: false });
    const clean = cash(40000, 500);
    const html = render([{ name: "Padded", vin: ASKED, used: withAddOn }, { name: "Clean", vin: EXACT_B, used: clean }, { name: "Higher", vin: ASKED, used: cash(42000, 500) }]);
    assert.deepEqual(colOrder(html).slice(0, 2), ["Clean", "Padded"]);
    assert.equal((html.match(/data-testid="badge-lowest-otd"/g) || []).length, 1);
    assert.match(html, /Clean<\/span><div[^>]*>(?:(?!<\/div>).)*badge-lowest-otd/);
  });
  it("a cheaper alternate is listed after the exact builds, wears no Lowest-OTD or Best deal, and is not the headline", () => {
    const html = render([{ name: "Exact1", vin: ASKED, used: cash(41000, 500) }, { name: "Exact2", vin: ASKED, used: cash(42000, 500) }, { name: "Alt", vin: ALT_A, used: cash(30000, 500) }]);
    assert.deepEqual(colOrder(html), ["Exact1", "Exact2", "Alt"]);
    assert.match(glance(html), /Exact1/);
    assert.doesNotMatch(html, /Alt<\/span><div[^>]*>(?:(?!<\/div>).)*(badge-lowest-otd|badge-best-deal)/);
    assert.doesNotMatch(html, /badge-best-alternate/, "one alternate is not a comparison");
  });
  it("two alternates: the lower one is Best alternate, and neither outranks the exact build", () => {
    const html = render([{ name: "Exact", vin: ASKED, used: cash(45000, 500) }, { name: "AltHi", vin: ALT_A, used: cash(32000, 500) }, { name: "AltLo", vin: ALT_B, used: cash(30000, 500) }]);
    assert.equal((html.match(/data-testid="badge-best-alternate"/g) || []).length, 1);
    assert.match(html, /AltLo<\/span><div[^>]*>(?:(?!<\/div>).)*badge-best-alternate/);
    assert.match(glance(html), /Exact/);
  });
});

describe("Live Bid Room and plain cards: nothing reads as a ranking or as true OTD", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const room = read("components/LiveDealRoom.tsx");
  it("no trophies, rank badges, winner styling or % off MSRP sort", () => {
    assert.doesNotMatch(room, /Trophy|sortBy|setSortBy|#\{index|isFirst/);
    assert.doesNotMatch(room, /Lowest quote|>\s*% off MSRP\s*</);
  });
  it("the price is labelled as not the out-the-door and the % off MSRP stays as a secondary figure", () => {
    assert.match(room, /Price \+ doc fee/);
    assert.match(room, /This is not the out-the-door price/);
    assert.match(room, /Dealer Discount/);
    assert.doesNotMatch(room, />Quoted Price</);
  });
  it("QuoteCompareCard: only the winner's total is highlighted, and the cards are ordered by OTD", () => {
    const page = read("app/rfq/[id]/page.tsx");
    assert.match(page, /\$\{lowest \? "text-brand-400" : "text-white"\}/);
    assert.match(page, /rankGenericQuotes\(/);
    assert.match(page, /orderedQuotedInvites\.map\(/);
    assert.doesNotMatch(page, /\{quotedInvites\.map\(\(invite\) => \(\s*<QuoteCompareCard/);
  });
});
