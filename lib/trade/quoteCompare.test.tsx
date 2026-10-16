// The buyer's compare once every dealer quotes the trade with the car: post-trade ranking (negative equity included), the
// card contents (basis, good-until, conditions, range, "Based on earlier details", "No trade quote", "Can't quote this trade"),
// the best-deal exclusions, the sort switch, and the Revised marker after the buyer goes back.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../../components/UsedCompare";
import { LeaseCompare } from "../../components/LeaseCompare";
import { analyzeLeaseQuotes } from "../leaseCompare";
import type { LeaseQuote } from "../leaseQuote";
import type { RfqInvite, RfqRequest } from "../rfq";
import type { UsedCashQuote, UsedFinanceQuote } from "../usedQuote";
import { openConfirmation, applyConfirmAction, type TradeConfirmation } from "./confirm";
import { bestDeal, financeAfterTrade, leaseAfterTrade, orderDesks, tradeEligible } from "./rank";
import { tradeEquity } from "./otd";
import { revisionEffects } from "./confirmView";
import type { DealerTradeAppraisal, TradeInRecord } from "./types";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const past = new Date(Date.now() - 864e5).toISOString();
const lines = (tax: number) => [{ name: "NJ sales tax", amount: tax }, { name: "Doc fee", amount: 495 }];
const cash = (price: number, tax = 2650): UsedCashQuote => ({ kind: "cash", sellingPrice: price, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: lines(tax), rebates: [] });
const fin = (monthly: number, financed = 40000): UsedFinanceQuote => ({ kind: "finance", sellingPrice: 42000, noAddOns: true, addOns: [], miles: null, stockNumber: null, cpo: false, expiresAt: future, dueAtSigning: lines(2650), rebates: [], downPayment: 2000, amountFinanced: financed, apr: 5.9, termMonths: 60, monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: monthly + 50 });
const tradeIn = (over: Partial<TradeInRecord> = {}): TradeInRecord => ({ vin: "1HGCM82633A004352", year: 2019, make: "Honda", model: "Accord", trim: "EX-L", decodedFromVin: true, mileage: 58000, zip: "07981", conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase", payoffEstimate: 9000, keys: "2+", historyFlag: "no", historyNotes: null, drivetrain: "2wd", options: [], optionsOther: null, extColor: null, intColor: null, serviceHistory: null, serviceNotes: null, tireBrake: null, mods: null, warningLights: null, intent: "apply_to_deal", odometerConfirmed: true, photos: [], createdAt: past, updatedAt: past, ...over });
const appr = (over: Partial<DealerTradeAppraisal> = {}): DealerTradeAppraisal => ({ allowanceSingle: 18000, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: future, payoffUsed: 9000, equityComputed: 9000, conditions: null, conditionChips: [], declined: null, createdAt: past, ...over });
const decline = (code = "salvage_title"): DealerTradeAppraisal => appr({ allowanceSingle: null, declined: { code, note: null } });
const invite = (id: string, name: string, used: UsedCashQuote | UsedFinanceQuote, tradeAppraisal: DealerTradeAppraisal | null, tradeConfirmation: TradeConfirmation | null = null): RfqInvite =>
  ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal, tradeConfirmation, quote: { id: `q${id}`, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], trade: TradeInRecord | null, quoteType: "cash" | "finance" = "cash", status: "collecting" | "picked" = "collecting"): RfqRequest => ({ id: "9", buyerUserId: "2", status, pickedQuoteId: null, createdAt: future, vin: "5J6RW2H89NL000001", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: trade, quotePrefs: quoteType === "cash" ? { quoteType, cash: { zip: "07981" } } : { quoteType, finance: { termMonths: 60, downPayment: 2000, creditBand: "excellent", zip: "07981" } }, invites }) as unknown as RfqRequest;
const render = (r: RfqRequest, initialSort?: "post_trade" | "vehicle") => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} initialSort={initialSort} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
const rowHtml = (html: string, row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";
const order = (html: string) => Array.from(html.matchAll(/data-testid="quote-col-quoted"[^>]*>[\s\S]*?<\/th>/g)).map((m) => m[0].match(/text-sm font-bold leading-snug text-white">([^<]+)</)?.[1]);

// Honda lots: vehicle OTD = price + 2,650 tax + 495 doc.
//   A  40,000 → 43,145 vehicle; allowance 5,000 vs 9,000 payoff = −4,000 → 47,145 after trade (negative equity)
//   B  44,000 → 47,145 vehicle; allowance 20,000 vs 9,000 payoff = +11,000 → 36,145 after trade
//   C  38,000 → 41,145 vehicle; no trade number at all
const three = () => rfqOf([
  invite("1", "A Negative Equity Honda", cash(40000), appr({ allowanceSingle: 5000 })),
  invite("2", "B Big Allowance Honda", cash(44000), appr({ allowanceSingle: 20000 })),
  invite("3", "C No Trade Honda", cash(38000), null),
], tradeIn());

describe("cash compare ranks on post-trade OTD", () => {
  it("orders by what the buyer pays after the trade, negative equity included; a desk with no trade quote goes last", () => {
    const html = render(three());
    assert.deepEqual(order(html), ["B Big Allowance Honda", "A Negative Equity Honda", "C No Trade Honda"]);
    assert.match(rowHtml(html, "otdafter"), /\$36,145[\s\S]*\$47,145[\s\S]*\$41,145/);
  });
  it("negative equity is shown red and ADDED to the out-the-door", () => {
    const html = render(three());
    assert.match(rowHtml(html, "netequity"), /text-rose-300[^>]*data-testid="negative-equity"[^>]*>−\$4,000/);
    assert.match(rowHtml(html, "netequity"), /text-emerald-300[^>]*data-testid="positive-equity"[^>]*>\+\$11,000/);
  });
  it("the best-deal badge goes to the lowest post-trade OTD and never to a desk with no trade quote, however cheap its vehicle", () => {
    const html = render(three());
    assert.equal((html.match(/data-testid="badge-best-deal"/g) || []).length, 1);
    assert.match(html, /B Big Allowance Honda[\s\S]*?badge-best-deal/);
    const cCol = html.split("C No Trade Honda")[1].split("</th>")[0];
    assert.doesNotMatch(cCol, /badge-best-deal/); assert.doesNotMatch(cCol, /Lowest out the door/);
    assert.match(cCol, /Not in the best-deal ranking: no trade quote yet/);
    assert.match(rowHtml(html, "tradeallow"), /No trade quote/);
  });
  it("can be switched to vehicle OTD only, which ignores the trade for ordering (the no-quote desk still can't win the badge)", () => {
    const html = render(three(), "vehicle");
    assert.deepEqual(order(html), ["C No Trade Honda", "A Negative Equity Honda", "B Big Allowance Honda"]);
    assert.match(html, /aria-pressed="true" data-testid="sort-vehicle"/);
    assert.doesNotMatch(html.split("C No Trade Honda")[1].split("</th>")[0], /badge-best-deal/);
    assert.match(html, /Vehicle OTD only/);
  });
  it("offers the sort switch only when there is a trade and more than one quote", () => {
    assert.match(render(three()), /data-testid="trade-sort"/);
    assert.doesNotMatch(render(rfqOf([invite("1", "Solo", cash(40000), appr())], tradeIn())), /data-testid="trade-sort"/);
    assert.doesNotMatch(render(rfqOf([invite("1", "A", cash(40000), null), invite("2", "B", cash(41000), null)], null)), /data-testid="trade-sort"/);
  });
  it("with no trade at all the table is ranked on the vehicle quote exactly as before", () => {
    const html = render(rfqOf([invite("1", "Pricey", cash(44000), null), invite("2", "Cheap", cash(40000), null)], null));
    assert.deepEqual(order(html), ["Cheap", "Pricey"]);
  });
  it("when nobody has a trade quote nobody wears best deal, and the glance says why", () => {
    const html = render(rfqOf([invite("1", "A", cash(40000), null), invite("2", "B", cash(41000), null)], tradeIn()));
    assert.equal((html.match(/data-testid="badge-best-deal"/g) || []).length, 0);
    assert.match(html, /No dealer has given a trade quote yet/);
  });
});

describe("what a trade card says", () => {
  it("shows the number, Preliminary or Firm, the good-until date, and the dealer's conditions next to it", () => {
    const html = render(rfqOf([
      invite("1", "Firm Honda", cash(40000), appr({ basis: "firm", conditions: "needs 2nd key", conditionChips: ["no_frame_damage"] })),
      invite("2", "Prelim Honda", cash(41000), appr({ basis: "preliminary" })),
    ], tradeIn()));
    const t = rowHtml(html, "tradeallow");
    assert.match(t, /\$18,000/); assert.match(t, /Firm/); assert.match(t, /Preliminary/);
    assert.match(t, new RegExp(`good until ${new Date(future).toLocaleDateString().replace(/\//g, "\\/")}`));
    assert.match(t, /data-testid="trade-conditions"[^>]*>Assumes no frame damage · “needs 2nd key”/);
  });
  it("a range: shows low to high, compares at the midpoint, and says so", () => {
    const html = render(rfqOf([invite("1", "Range Honda", cash(40000), appr({ allowanceSingle: null, allowanceLow: 14000, allowanceHigh: 18000 })), invite("2", "Single Honda", cash(40500), appr({ allowanceSingle: 16000 }))], tradeIn()));
    assert.match(rowHtml(html, "tradeallow"), /\$14,000 to \$18,000/);
    assert.match(rowHtml(html, "tradeallow"), /compared at the midpoint, \$16,000/);
    assert.match(rowHtml(html, "otdafter"), /\$34,145 to \$38,145/);
  });
  it("marks a number 'Based on earlier details' when the buyer changed the trade after it was given", () => {
    const html = render(rfqOf([invite("1", "Stale Honda", cash(40000), appr({ createdAt: past })), invite("2", "Fresh Honda", cash(40500), appr({ createdAt: past, reconfirmedAt: new Date().toISOString() }))], tradeIn({ updatedAt: new Date(Date.now() - 3600_000).toISOString() })));
    assert.equal((html.match(/data-testid="trade-stale"/g) || []).length, 1);
    assert.match(html, /Based on earlier details/);
  });
  it("'Can't quote this trade' shows the reason, keeps the vehicle quote, and excludes the desk from best deal", () => {
    const html = render(rfqOf([invite("1", "Salvage Honda", cash(36000), decline("salvage_title")), invite("2", "Taker Honda", cash(41000), appr())], tradeIn()));
    assert.match(rowHtml(html, "tradeallow"), /Can&#x27;t quote this trade[\s\S]*Salvage or branded title[\s\S]*vehicle quote still counts/);
    assert.deepEqual(order(html), ["Taker Honda", "Salvage Honda"]);
    assert.match(rowHtml(html, "price"), /\$36,000/);
    assert.doesNotMatch(html.split("Salvage Honda")[1].split("</th>")[0], /badge-best-deal/);
    assert.match(html, /Not in the best-deal ranking: no trade quote/);
  });
  it("an allowance that expired (or whose vehicle quote expired) is not applied", () => {
    const html = render(rfqOf([invite("1", "Old Honda", cash(36000), appr({ goodUntil: past })), invite("2", "New Honda", cash(41000), appr())], tradeIn()));
    assert.match(rowHtml(html, "tradeallow"), /Trade value expired/);
    assert.match(rowHtml(html, "otdafter"), /trade expired; not applied/);
  });
});

describe("after the buyer selects a desk", () => {
  const conf = (a: DealerTradeAppraisal, action: Parameters<typeof applyConfirmAction>[1], hours = 1) => {
    const t0 = new Date();
    const o = openConfirmation({ inviteId: "1", appraisal: a, now: t0, deadlineHours: 24 });
    assert.ok(o.ok); const r = applyConfirmAction((o as { confirmation: TradeConfirmation }).confirmation, action, { now: new Date(t0.getTime() + hours * 3600_000) });
    assert.ok(r.ok); return (r as { confirmation: TradeConfirmation }).confirmation;
  };
  it("marks the revising desk Revised after the buyer goes back, and every number is the original", () => {
    const a = appr({ allowanceSingle: 18000 });
    const revised = conf(a, { type: "revise", allowance: 17000, reasonCode: "inspection_finding", reasonText: "Scratches" });
    const wentBack = applyConfirmAction(revised, { type: "go_back" }, { now: new Date(Date.now() + 2 * 3600_000) });
    assert.ok(wentBack.ok);
    const html = render(rfqOf([invite("1", "Reviser Honda", cash(40000), a, (wentBack as { confirmation: TradeConfirmation }).confirmation), invite("2", "Other Honda", cash(40500), appr({ allowanceSingle: 17000 }))], tradeIn()));
    assert.match(html, /data-testid="revised-chip"[^>]*>Revised</);
    assert.match(html, /You went back; the number above is what they originally quoted/);
    assert.match(rowHtml(html, "tradeallow"), /\$18,000/, "the reviser's own quoted number is untouched");
    assert.match(rowHtml(html, "tradeallow"), /\$17,000/, "the other desk's original number is intact");
    assert.equal((html.match(/data-testid="revised-chip"/g) || []).length, 1);
  });
  it("a confirmed (or accepted-revision, or defaulted) number replaces the quoted one", () => {
    const a = appr({ allowanceSingle: 18000 });
    const accepted = applyConfirmAction(conf(a, { type: "revise", allowance: 17000, reasonCode: "inspection_finding", reasonText: "Scratches" }), { type: "accept_revised" }, { now: new Date(Date.now() + 2 * 3600_000) });
    assert.ok(accepted.ok);
    const html = render(rfqOf([invite("1", "Reviser Honda", cash(40000), a, (accepted as { confirmation: TradeConfirmation }).confirmation), invite("2", "Other Honda", cash(40500), appr({ allowanceSingle: 17000 }))], tradeIn(), "cash", "picked"));
    assert.match(rowHtml(html, "tradeallow"), /\$17,000/);
    assert.match(rowHtml(html, "otdafter"), /\$35,145/, "43,145 − (17,000 − 9,000) = 35,145");
  });
});

describe("rank helpers", () => {
  const eqs = (a: DealerTradeAppraisal | null) => tradeEquity(true, 9000, a);
  it("only a live number is eligible", () => {
    assert.equal(tradeEligible(eqs(appr())), true);
    assert.equal(tradeEligible(eqs(null)), false);
    assert.equal(tradeEligible(eqs(decline())), false);
    assert.equal(tradeEligible(eqs(appr({ goodUntil: past }))), false);
  });
  it("orders eligible desks first on the post-trade comparator, then the rest on the vehicle one; best is the first eligible", () => {
    const items = [{ id: "a", ok: false, post: 1, veh: 1 }, { id: "b", ok: true, post: 9, veh: 9 }, { id: "c", ok: true, post: 2, veh: 8 }];
    const o = { hasTrade: true, eligible: (t: typeof items[number]) => t.ok, byPostTrade: (x: typeof items[number], y: typeof items[number]) => x.post - y.post, byVehicle: (x: typeof items[number], y: typeof items[number]) => x.veh - y.veh };
    assert.deepEqual(orderDesks(items, { ...o, mode: "post_trade" }).map((t) => t.id), ["c", "b", "a"]);
    assert.deepEqual(orderDesks(items, { ...o, mode: "vehicle" }).map((t) => t.id), ["a", "c", "b"]);
    assert.equal(bestDeal(orderDesks(items, { ...o, mode: "vehicle" }), o)?.id, "c");
    assert.equal(bestDeal(items.filter((t) => !t.ok), o), null);
    assert.equal(bestDeal(items.filter((t) => !t.ok), { ...o, hasTrade: false })?.id, "a");
  });
  it("finance: positive equity lowers the comparable monthly, negative equity raises it; unchanged without a live number", () => {
    const q = fin(770);
    const pos = financeAfterTrade(q, eqs(appr({ allowanceSingle: 20000 })));
    const neg = financeAfterTrade(q, eqs(appr({ allowanceSingle: 5000 })));
    assert.ok(pos.applied && pos.monthly < 770 && pos.financed === 29000);
    assert.ok(neg.applied && neg.monthly > 770 && neg.financed === 44000);
    assert.deepEqual(financeAfterTrade(q, eqs(null)), { monthly: 770, financed: 40000, applied: false });
  });
  it("lease: cap cost reduction lowers the comparable monthly, rolled-in negative equity raises it", () => {
    const l = { capCost: 50000, moneyFactor: 0.002, termMonths: 36, monthlyPaymentPreTax: 700 };
    assert.ok(leaseAfterTrade(l, eqs(appr({ allowanceSingle: 20000 }))).monthly < 700);
    assert.ok(leaseAfterTrade(l, eqs(appr({ allowanceSingle: 5000 }))).monthly > 700);
    assert.equal(leaseAfterTrade(l, eqs(null)).monthly, 700);
  });
});

describe("finance compare with a trade", () => {
  it("ranks on the monthly after the equity is applied, so a bigger trade can beat a lower sticker monthly; no-quote desks last", () => {
    const html = render(rfqOf([
      invite("1", "LowMonthly Honda", fin(760), appr({ allowanceSingle: 5000 })),   // −4,000 equity rolled in → monthly goes UP
      invite("2", "BigTrade Honda", fin(780), appr({ allowanceSingle: 25000 })),    // +16,000 equity as cash down → monthly drops
      invite("3", "NoTrade Honda", fin(700), null),
    ], tradeIn(), "finance"));
    assert.deepEqual(order(html), ["BigTrade Honda", "LowMonthly Honda", "NoTrade Honda"]);
    assert.match(html, /ranked on ≈ \$\d+\/mo at their rate and term/);
    assert.doesNotMatch(html.split("NoTrade Honda")[1].split("</th>")[0], /badge-best-deal/);
  });
});

describe("lease compare with a trade", () => {
  const lease = (monthly: number, cap: number): LeaseQuote => ({ capCost: cap, residualPercent: 58, residualAmount: 30595, moneyFactor: 0.00215, termMonths: 36, milesPerYear: 12000, capReduction: 0, monthlyPaymentPreTax: monthly, monthlyPaymentWithEstTax: monthly + 40, dueAtSigning: { firstMonth: monthly, acquisitionFee: 995, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 799 }] }, incentives: [], addOns: [], expiresAt: future, notes: null, counter: { counterOffer: false, note: "" } });
  const mk = (id: string, name: string, l: LeaseQuote, a: DealerTradeAppraisal | null) => ({ ...invite(id, name, cash(1), a), quote: { id: `q${id}`, price: l.capCost, fees: [], totalOtdPrice: 0, vin: "5J6RW2H89NL000001", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, lease: l } }) as unknown as RfqInvite;
  const run = (invites: RfqInvite[], initialSort?: "post_trade" | "vehicle") => {
    const rfq = { ...rfqOf(invites, tradeIn()), quotePrefs: null, leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07981" } } as unknown as RfqRequest;
    return renderToStaticMarkup(<LeaseCompare data={analyzeLeaseQuotes(rfq)!} trade={{ record: tradeIn(), byInvite: Object.fromEntries(invites.map((i) => [i.id, i.tradeAppraisal ?? null])), confirmations: {} }} collecting initialSort={initialSort} onPick={() => {}} onWalk={() => {}} busy={false} />);
  };
  const leaseOrder = (html: string) => Array.from(html.matchAll(/data-testid="quote-col-eligible"[^>]*>[\s\S]*?<\/th>/g)).map((m) => m[0].match(/text-sm font-bold leading-snug text-white">([^<]+)</)?.[1]);
  const invs = () => [mk("1", "Cheap Sticker Lease", lease(690, 48000), appr({ allowanceSingle: 4000 })), mk("2", "Big Trade Lease", lease(720, 50000), appr({ allowanceSingle: 26000 })), mk("3", "No Trade Lease", lease(650, 47000), null)];
  it("orders on the monthly after the cap cost change, and keeps the no-trade-quote desk out of best deal", () => {
    const html = run(invs());
    assert.deepEqual(leaseOrder(html), ["Big Trade Lease", "Cheap Sticker Lease", "No Trade Lease"]);
    assert.equal((html.match(/data-testid="badge-best-deal"/g) || []).length, 1);
    assert.match(html.split("Big Trade Lease")[1].split("</th>")[0], /badge-best-deal/);
    assert.match(html, /Not in the best-deal ranking: no trade quote yet/);
    assert.match(html, /No trade quote/);
  });
  it("vehicle only keeps the lowest sticker monthly first", () => {
    assert.deepEqual(leaseOrder(run(invs(), "vehicle")), ["No Trade Lease", "Cheap Sticker Lease", "Big Trade Lease"]);
  });
});

describe("what the buyer sees when the dealer revises", () => {
  it("before and after of the allowance, the equity and the post-trade OTD", () => {
    const inv = invite("1", "Reviser Honda", cash(40000), appr({ allowanceSingle: 18000 }));
    const lines = revisionEffects({ tradeIn: tradeIn() }, inv, { allowancePrelim: 18000, allowanceFinal: 16000 });
    assert.deepEqual(lines.map((l) => [l.label, l.before, l.after]), [["Trade allowance", "$18,000", "$16,000"], ["Net trade equity", "$9,000", "$7,000"], ["Out the door after trade", "$34,145", "$36,145"]]);
  });
});
