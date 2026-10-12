// The Cash / Finance flow in the app: the stage helpers, what each side may ask for, the notice emails (SAFE MODE),
// the routes that carry actions to the deals server, and the rendered buyer / dealer panels in each stage.
// The rules themselves (every gate, skip, close and walk) are tested in scrapers/lightsail-crawler/test/dealStages.test.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyStageAction, gateStagedPrefs, initialStageState, isStagedRfq, stageOf, stageProgress, stageSummary, type DealStageState, type StageAction } from "./dealStages";
import { parseStageAction } from "./dealStageInput";
import { buildStageNotice } from "./dealStageNotice";
import { financeMonthly, cashOutTheDoor, parseQuotePrefs } from "./usedQuote";
import { monthlyPayment, cashQuoteOtd } from "../scrapers/lightsail-crawler/src/dealStages.js";
import { rfqQuoteTypeLabel } from "./rfqTracker";
import { DealStageBar } from "../components/DealStageBar";
import { StagedDeals } from "../components/StagedDeals";
import { DealerStagePanel } from "../components/DealerStagePanel";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const NOW = new Date("2026-10-11T15:00:00Z");
const FUTURE = "2099-01-01T00:00:00Z";
const usedCash = { kind: "cash" as const, sellingPrice: 40000, addOns: [], noAddOns: true, rebates: [], miles: null, stockNumber: null, cpo: false, expiresAt: FUTURE, dueAtSigning: [{ name: "Sales tax", amount: 2650 }, { name: "Doc fee", amount: 799 }, { name: "Title & registration", amount: 300 }] };
const invite = (stage: DealStageState | null, over: Partial<RfqInvite> = {}): RfqInvite =>
  ({ id: "11", dealerName: "Test Motors", dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: "2026-10-11T00:00:00Z", respondedAt: "2026-10-11T01:00:00Z", viewToken: "tok12345", quote: { id: "q1", inviteId: "11", dealerName: "Test Motors", price: 40000, fees: [], totalOtdPrice: 43749, vin: "V", stockNumber: null, expiresAt: FUTURE, submittedAt: "2026-10-11T01:00:00Z", mustHaveAcknowledgement: true, notes: null, used: usedCash }, stage, ...over }) as unknown as RfqInvite;
const rfqOf = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
  ({ id: "7", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: "2026-10-11T00:00:00Z", vin: "VIN", stockNumber: null, vehicleYear: 2026, vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleTrim: "XLE", mustHaves: [], quotePrefs: { quoteType: "cash", staged: true, cash: { zip: "07030" } }, tradeInExpected: true, tradeIn: { vin: "T" }, invites, ...over }) as unknown as RfqRequest;

const ctx = { otdAmount: 43749, hasTradeInOnFile: true, state: "NJ", taxRate: 0.06625, now: NOW };
const go = (s: DealStageState | null, a: StageAction, actor: "buyer" | "dealer") => { const r = applyStageAction(s, { ...a, actor }, ctx); assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; state: DealStageState }).state; };
const atTrade = () => go(initialStageState({ tradeInExpected: true }), { type: "accept_otd" }, "buyer");
const atPayment = () => go(go(atTrade(), { type: "trade_offer", value: 9000 }, "dealer"), { type: "trade_accept" }, "buyer");
const CONTACT = { name: "Pat Buyer", email: "pat@example.com", phone: "555-0100", zip: "07030" };
const finalAccepted = (): DealStageState => {
  const r = applyStageAction(go(atPayment(), { type: "choose_cash" }, "buyer"), { type: "accept_final", actor: "buyer" }, { ...ctx, buyerContact: CONTACT });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; state: DealStageState }).state;
};

describe("staged flag and helpers", () => {
  it("only a cash request marked staged is staged; lease and old cash/finance requests are not", () => {
    assert.equal(isStagedRfq(rfqOf([])), true);
    assert.equal(isStagedRfq(rfqOf([], { quotePrefs: { quoteType: "cash", cash: { zip: "07030" } } })), false);
    assert.equal(isStagedRfq(rfqOf([], { quotePrefs: { quoteType: "finance", finance: { termMonths: 60, downPayment: 0, creditBand: "excellent", zip: "07030" } } as never })), false);
    assert.equal(isStagedRfq(rfqOf([], { leasePrefs: { termMonths: 36, milesPerYear: 12000, zip: "07030" } as never })), false);
  });
  it("stageOf starts a desk with no history at stage 1 (trade skipped when no trade is expected) and is null off the staged flow", () => {
    assert.equal(stageOf(rfqOf([]), invite(null))?.stage, "otd");
    assert.equal(stageOf(rfqOf([], { tradeInExpected: false }), invite(null))?.trade.status, "skipped");
    assert.equal(stageOf(rfqOf([], { quotePrefs: { quoteType: "cash", cash: { zip: "07030" } } }), invite(null)), null);
  });
  it("parseQuotePrefs keeps the staged flag on cash only, and only when true", () => {
    assert.equal((parseQuotePrefs({ quoteType: "cash", staged: true, cash: { zip: "07030" } }) as { staged?: boolean }).staged, true);
    assert.equal("staged" in (parseQuotePrefs({ quoteType: "cash", staged: "yes", cash: { zip: "07030" } }) as object), false);
    assert.equal("staged" in (parseQuotePrefs({ quoteType: "cash", cash: { zip: "07030" } }) as object), false);
  });
  it("the shared JS money math equals the app's", () => {
    for (const [p, apr, n] of [[35000, 5.9, 60], [20000, 0, 48], [41234.56, 12.5, 72]] as const) assert.equal(monthlyPayment(p, apr, n), financeMonthly(p, apr, n));
    assert.equal(cashQuoteOtd(usedCash), cashOutTheDoor(usedCash));
  });
  it("labels: the tracker calls it Cash / Finance; summaries read in plain words", () => {
    assert.equal(rfqQuoteTypeLabel(rfqOf([])), "Cash / Finance");
    assert.equal(stageSummary(initialStageState({})), "Stage 1 of 4: out-the-door price");
    assert.match(stageSummary(atTrade()), /waiting for the dealer's trade-in offer/);
    assert.match(stageSummary(go(atPayment(), { type: "choose_cash" }, "buyer")), /review and accept the final deal/);
    assert.match(stageSummary(go(atTrade(), { type: "walk" }, "buyer")), /Walked away at Trade-in/);
    assert.deepEqual(stageProgress(atPayment()).map((s) => s.state), ["locked", "locked", "current", "upcoming"]);
  });
});

describe("rollout gate: FEATURE_DEAL_STAGES", () => {
  const staged = { quoteType: "cash" as const, staged: true as const, cash: { zip: "07030" } };
  it("flag off: the staged marker is dropped, so the request is the original single cash sheet", () => {
    const g = gateStagedPrefs(staged, false);
    assert.equal("staged" in g, false);
    assert.equal(isStagedRfq(rfqOf([], { quotePrefs: g })), false);
    assert.deepEqual(g, { quoteType: "cash", cash: { zip: "07030" } });
  });
  it("flag on: unchanged; null and finance prefs pass through untouched", () => {
    assert.deepEqual(gateStagedPrefs(staged, true), staged);
    assert.equal(gateStagedPrefs(null, false), null);
    const fin = { quoteType: "finance" as const, finance: { termMonths: 60, downPayment: 0, creditBand: "excellent", zip: "07030" } };
    assert.equal(gateStagedPrefs(fin, false), fin);
  });
  it("the create route applies the gate with the flag, and the wizard only promises stages when the flag is on", () => {
    assert.match(read("app/api/rfqs/route.ts"), /gateStagedPrefs\(parseQuotePrefs\(body\.quotePrefs\), featureEnabled\("dealStages"\)\)/);
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /quoteType !== "lease" && featureStatus\.dealStages \? \(\s*<ol[^>]*data-testid="buy-path-stages"/);
  });
});

describe("what each side may ask for", () => {
  it("buyer: accept / counter / cash / finance / walk only; dealer: offer / accept counter / quote / walk only", () => {
    for (const t of ["accept_otd", "trade_counter", "trade_accept", "choose_cash", "choose_own_financing", "request_finance", "finance_counter", "finance_accept", "change_payment", "accept_final", "walk"]) assert.ok(parseStageAction({ type: t }, "buyer"), `buyer ${t}`);
    for (const t of ["trade_offer", "trade_hold", "trade_accept_counter", "finance_quote", "finance_hold", "finance_accept_counter", "walk"]) assert.ok(parseStageAction({ type: t }, "dealer"), `dealer ${t}`);
    for (const t of ["trade_offer", "trade_hold", "trade_accept_counter", "finance_quote", "finance_hold", "finance_accept_counter"]) assert.equal(parseStageAction({ type: t }, "buyer"), null, `buyer must not ${t}`);
    for (const t of ["choose_cash", "choose_own_financing", "finance_accept", "finance_counter", "request_finance", "change_payment", "accept_final", "trade_counter", "trade_accept", "accept_otd"]) assert.equal(parseStageAction({ type: t }, "dealer"), null, `dealer must not ${t}`);
    assert.equal(parseStageAction({ type: "bid_up" }, "buyer"), null);
    assert.equal(parseStageAction(null, "buyer"), null);
  });
  it("drops fields the action doesn't read, so a browser can't send its own OTD or tax rate", () => {
    assert.deepEqual(parseStageAction({ type: "accept_otd", otdAmount: 1, amount: 1, taxRate: 0 }, "buyer"), { type: "accept_otd" });
    const a = parseStageAction({ type: "request_finance", downPayment: "5000", outsideFinancing: true, termMonths: 60, trueOtd: 1 }, "buyer");
    assert.deepEqual(a, { type: "request_finance", downPayment: "5000", termMonths: 60, outsideFinancing: true, creditRange: null });
    assert.deepEqual(parseStageAction({ type: "trade_offer", value: 9000, basis: "weird" }, "dealer"), { type: "trade_offer", value: 9000, basis: "preliminary" });
  });
});

describe("notice emails: SAFE MODE, to the other side, never a bid", () => {
  const base = { dealerName: "Test Motors", vehicle: "2026 Toyota RAV4 XLE", url: "https://example.test/x" };
  const n = (actor: "buyer" | "dealer", action: StageAction, state: DealStageState) => buildStageNotice({ ...base, actor, action, state });
  it("goes to the other party and is tagged SAFE MODE in subject and body", () => {
    const toDealer = n("buyer", { type: "accept_otd" }, atTrade())!;
    assert.equal(toDealer.audience, "dealer");
    const toBuyer = n("dealer", { type: "trade_offer", value: 9000 }, go(atTrade(), { type: "trade_offer", value: 9000 }, "dealer"))!;
    assert.equal(toBuyer.audience, "buyer");
    for (const x of [toDealer, toBuyer]) { assert.match(x.subject, /^\[SAFE MODE\]/); assert.match(x.html, /SAFE MODE:/); assert.match(x.html, /A request, not a bid/); assert.doesNotMatch(x.html, /auction|bid war|highest bidder/i); }
  });
  it("covers every action with the numbers that matter", () => {
    assert.match(n("buyer", { type: "accept_otd" }, atTrade())!.html, /\$43,749/);
    const offered = go(atTrade(), { type: "trade_offer", value: 9000 }, "dealer");
    assert.match(n("dealer", { type: "trade_offer" }, offered)!.html, /\$9,000/);
    const countered = go(offered, { type: "trade_counter", value: 11000 }, "buyer");
    assert.match(n("buyer", { type: "trade_counter" }, countered)!.html, /\$11,000/);
    const locked = atPayment();
    assert.match(n("buyer", { type: "trade_accept" }, locked)!.html, /True out-the-door = \$43,749 - \$9,000 = \$34,749/);
    assert.match(n("buyer", { type: "choose_cash" }, go(locked, { type: "choose_cash" }, "buyer"))!.html, /paying? cash|pay cash/i);
    assert.match(n("buyer", { type: "choose_own_financing" }, go(locked, { type: "choose_own_financing", lenderName: "Navy Federal" }, "buyer"))!.html, /own financing[\s\S]*Navy Federal/);
    const asked = go(locked, { type: "request_finance", downPayment: 4000, outsideFinancing: true }, "buyer");
    assert.match(n("buyer", { type: "request_finance" }, asked)!.html, /\$30,749 to finance|\$30,749/);
    assert.match(n("buyer", { type: "request_finance" }, asked)!.html, /outside financing/);
    const quoted = go(asked, { type: "finance_quote", apr: 5.9, termMonths: 60, lenderName: "Ally" }, "dealer");
    assert.match(n("dealer", { type: "finance_quote" }, quoted)!.html, /5\.9% APR for 60 months through Ally/);
    const fcountered = go(quoted, { type: "finance_counter", apr: 4.9 }, "buyer");
    assert.match(n("buyer", { type: "finance_counter" }, fcountered)!.html, /4\.9% APR over 60 months/);
    assert.match(n("dealer", { type: "finance_hold" }, go(fcountered, { type: "finance_hold" }, "dealer"))!.html, /holding at 5\.9% APR/i);
    assert.match(n("buyer", { type: "finance_accept" }, go(quoted, { type: "finance_accept" }, "buyer"))!.html, /Financing agreed/);
    assert.match(n("dealer", { type: "walk" }, go(atTrade(), { type: "walk", reason: "price" }, "dealer"))!.html, /Dealer walked away|ended this deal/);
  });
  it("never states a calculated tax saving: only that the trade may lower sales tax and the dealer confirms", () => {
    const h = n("buyer", { type: "trade_accept" }, atPayment())!.html;
    assert.match(h, /Trade-in may lower your sales tax — dealer will confirm/);
    assert.doesNotMatch(h, /\$795|sales-tax saving/);
  });
  it("sends nothing for an action that needs no email, and never includes contact details", () => {
    assert.equal(n("buyer", { type: "bogus" as never }, atTrade()), null);
    const html = n("buyer", { type: "choose_cash" }, go(atPayment(), { type: "choose_cash" }, "buyer"))!.html;
    assert.doesNotMatch(html, /@|\(\d{3}\)|\d{3}-\d{4}/);
  });
});

describe("routes and wiring", () => {
  it("buyer route: buyer credential, allow-listed actions, actor forced to buyer, state from the ZIP, SAFE MODE notice", () => {
    const s = read("app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts");
    assert.match(s, /parseStageAction\(body\?\.action, "buyer"\)/);
    assert.match(s, /actor: "buyer"/);
    assert.match(s, /hasBuyerCredential/); assert.match(s, /rfq\.buyerUserId !== buyer\.id/);
    assert.match(s, /isStagedRfq\(rfq\)/);
    assert.match(s, /zipStateTax\(zip\)\?\.state/);
    assert.match(s, /sendDealStageNotice\(notice\)/);
    assert.doesNotMatch(s, /body\??\.(actor|otd|amount|taxRate)/, "nothing numeric or identity-bearing is read from the body");
  });
  it("dealer route: tokened, allow-listed to the dealer's actions, actor forced to dealer, SAFE MODE notice", () => {
    const s = read("app/api/quote-invite/stage/route.ts");
    assert.match(s, /parseStageAction\(body\?\.action, "dealer"\)/);
    assert.match(s, /actor: "dealer"/);
    assert.match(s, /getRfqInviteByViewToken\(token\)/);
    assert.match(s, /sendDealStageNotice\(notice\)/);
    assert.doesNotMatch(s, /body\??\.actor/);
  });
  it("the dealer accepting the buyer's OTD counter is what locks stage 1; and the context hands the dealer page the stage", () => {
    const a = read("app/api/quote-invite/accept-counter/route.ts");
    assert.match(a, /isStagedRfq\(rfq\)[\s\S]*?postDealStage\(found\.rfqId, invite\.id, \{ action: \{ type: "accept_otd" \}, actor: "dealer" \}\)/);
    const c = read("app/api/quote-invite/context/route.ts");
    assert.match(c, /staged: isStagedRfq\(rfq\)/); assert.match(c, /stage: stageForDealer\(stageOf\(rfq, invite\), \{ notSelected: Boolean\(invite\.notSelectedAt\) \}\)/);
  });
  it("every dealer-side e-mail still goes through the SAFE MODE sender", () => {
    const e = read("lib/dealerEmail.ts");
    assert.match(e, /export async function sendDealStageNotice[\s\S]*?sendViaResend\(notice\.subject, notice\.html\)/);
  });
  it("the unpatched deals server is reported as 'not available yet', not a broken page", () => {
    const s = read("lib/rfqApi.ts");
    assert.match(s, /err\.status === 404 && err\.message === "Not found"[\s\S]*?isn't available yet/);
  });
  it("the wizard sends Cash / Finance as a staged cash request, with no finance locks in the first quote", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /quoteType: "cash", staged: true/);
    assert.match(w, /Lease or buy\?/);
    assert.doesNotMatch(read("scrapers/lightsail-crawler/src/dealStages.js"), /creditBand/, "credit band is never part of the OTD stage");
  });
  it("the compare view drops the shortcut 'Choose this quote' and request walk when staged, but keeps the old behaviour otherwise", () => {
    const u = read("components/UsedCompare.tsx");
    assert.match(u, /\{staged \? null : <button[\s\S]{0,400}?data-testid="choose-quote"/);
    assert.match(u, /\{collecting && !staged \? \(/);
    const p = read("app/rfq/[id]/page.tsx");
    assert.equal((p.match(/staged=\{isStagedRfq\(rfq\)\}/g) || []).length, 2);
    assert.equal((p.match(/<StagedDeals /g) || []).length, 2);
  });
  it("the dealer page shows the stage panel in every state: unanswered, quoted, submitted, accepted-counter, closed", () => {
    const d = read("app/quote-request/received/page.tsx");
    assert.ok((d.match(/\{stagePanel\}/g) || []).length >= 5);
  });
  it("lease requests are untouched: no stage panel, the lease branch has no stage code", () => {
    const d = read("app/quote-request/received/page.tsx");
    assert.doesNotMatch(d.slice(d.indexOf("<LeaseCalculatorForm")), /DealerStagePanel/);
  });
  it("the deal tracker shows the progress bar per dealer", () => {
    const t = read("components/DealTrackerDashboard.tsx");
    assert.match(t, /data-testid="rfq-stage-progress"/); assert.match(t, /<DealStageBar state=\{st\} compact \/>/);
  });
});

describe("rendered panels", () => {
  const html = (state: DealStageState | null, over: Partial<RfqRequest> = {}) => renderToStaticMarkup(<StagedDeals rfq={rfqOf([invite(state)], over)} headers={{}} onRfq={() => {}} />);
  it("stage 1: accept the itemized out-the-door; no financing anywhere", () => {
    const h = html(null);
    assert.match(h, /data-testid="accept-otd"/); assert.match(h, /Accept \$43,749 out the door/);
    assert.match(h, /data-state="current"/);
    assert.doesNotMatch(h, /request-financing|choose-cash/);
    assert.match(h, /A request, not a bid/);
  });
  it("stage 1 with no usable quote waits instead of offering to accept", () => {
    const h = renderToStaticMarkup(<StagedDeals rfq={rfqOf([invite(null, { quote: null, status: "invited" })])} headers={{}} onRfq={() => {}} />);
    assert.doesNotMatch(h, /accept-otd/); assert.match(h, /Waiting for this dealer/);
  });
  it("stage 2: waiting for an offer, then accept or counter, then waiting while the counter is with the dealer, then accept or counter again", () => {
    assert.match(html(atTrade()), /Waiting for their trade value|Your trade-in is with the dealer/);
    const offered = go(atTrade(), { type: "trade_offer", value: 9000 }, "dealer");
    const h = html(offered);
    assert.match(h, /data-testid="accept-trade"/); assert.match(h, /data-testid="counter-trade"/); assert.match(h, /\$9,000/);
    const countered = go(offered, { type: "trade_counter", value: 11000 }, "buyer");
    assert.match(html(countered), /Your counter is with the dealer/); assert.doesNotMatch(html(countered), /accept-trade/);
    const revised = go(countered, { type: "trade_offer", value: 10000 }, "dealer");
    const hr = html(revised);
    assert.match(hr, /data-testid="accept-trade"/); assert.match(hr, /data-testid="counter-trade"/, "the loop repeats: the buyer can counter again");
    assert.match(hr, /data-testid="trade-counter-note"/); assert.match(hr, /data-testid="live-true-otd"[^>]*>True out-the-door if you accept \$10,000/);
  });
  it("stage 2 without the trade on file says so instead of pretending", () => {
    assert.match(html(atTrade(), { tradeIn: null }), /didn&#x27;t attach|didn't attach/);
  });
  it("stage 3: locked numbers with the true OTD and tax saving; pay cash or ask for financing", () => {
    const h = html(atPayment());
    assert.match(h, /data-testid="true-otd"[^>]*>\$34,749/); assert.match(h, /Trade-in may lower your sales tax — dealer will confirm/); assert.doesNotMatch(h, /trade-tax-savings|saving from trade/i);
    assert.match(h, /data-testid="pay-cash"/); assert.match(h, /data-testid="pay-own"/); assert.match(h, /data-testid="pay-dealer"/);
    assert.match(h, /Paying cash/); assert.match(h, /Bringing my own financing/); assert.match(h, /Get a financing offer from the dealer/);
    assert.match(h, /data-testid="choose-cash"/);
  });
  it("stage 3 with a financing quote shows APR, term, monthly and the accept button", () => {
    const quoted = go(go(atPayment(), { type: "request_finance", downPayment: 4000 }, "buyer"), { type: "finance_quote", apr: 5.9, termMonths: 60, lenderName: "Ally" }, "dealer");
    const h = html(quoted);
    assert.match(h, /data-testid="finance-quote"/); assert.match(h, /5\.9% APR/); assert.match(h, /60 months/); assert.match(h, /Ally/); assert.match(h, /data-testid="accept-financing"/); assert.match(h, /data-testid="counter-financing"/); assert.match(h, /data-testid="switch-to-cash"/);
    assert.match(h, /data-testid="finance-math"[^>]*>\$34,749 true out-the-door - \$4,000 down = \$30,749 financed/);
  });
  it("closed and walked deals are final and offer no actions", () => {
    const cash = html(finalAccepted());
    assert.match(cash, /data-testid="stage-closed"/); assert.match(cash, /paying cash at \$34,749 out the door/); assert.doesNotMatch(cash, /choose-cash|walk-stage|accept-final/);
    const walked = html(go(atTrade(), { type: "walk" }, "dealer"));
    assert.match(walked, /data-testid="stage-walked"/); assert.match(walked, /dealer walked away/i); assert.doesNotMatch(walked, /accept-trade|walk-stage/);
  });
  it("no trade-in: the bar shows the trade step skipped and the buyer goes straight to payment", () => {
    const s = go(initialStageState({ tradeInExpected: false }), { type: "accept_otd" }, "buyer");
    const h = html(s, { tradeInExpected: false, tradeIn: null });
    assert.match(h, /data-state="skipped"/); assert.match(h, /data-testid="choose-cash"/);
  });
  it("several dealers: an overview line shows each dealer's stage, and each has its own card", () => {
    const rfq = rfqOf([invite(null), invite(atPayment(), { id: "12", dealerName: "Other Motors" })]);
    const h = renderToStaticMarkup(<StagedDeals rfq={rfq} headers={{}} onRfq={() => {}} />);
    assert.match(h, /data-testid="stage-overview"/);
    assert.equal((h.match(/data-testid="staged-deal-card"/g) || []).length, 2);
    assert.match(h, /Stage 1 of 4/); assert.match(h, /Stage 3: pay cash, bring your own financing, or get a dealer offer/);
  });
  it("a closed request shows no actions even on an open stage", () => {
    const h = renderToStaticMarkup(<StagedDeals rfq={rfqOf([invite(atTrade())], { status: "picked" })} headers={{}} onRfq={() => {}} />);
    assert.doesNotMatch(h, /accept-trade|walk-stage/);
  });
  it("the progress bar renders locked numbers and a monthly for a financed close", () => {
    const fin = go(go(go(atPayment(), { type: "request_finance", downPayment: 4000 }, "buyer"), { type: "finance_quote", apr: 5.9, termMonths: 60, lenderName: "Ally" }, "dealer"), { type: "finance_accept" }, "buyer");
    const h = renderToStaticMarkup(<DealStageBar state={fin} />);
    assert.match(h, /Locked \$43,749/); assert.match(h, /Locked \$9,000/); assert.match(h, /\/mo/); assert.match(h, /grid-cols-2[^"]*sm:grid-cols-4/, "four steps wrap to two columns on a phone");
  });
  const dealer = (state: DealStageState, over: { hasTrade?: boolean; rfqOpen?: boolean } = {}) => renderToStaticMarkup(<DealerStagePanel token="tok12345" stage={state} quotedOtd={43749} hasTrade={over.hasTrade ?? true} rfqOpen={over.rfqOpen ?? true} onChanged={() => {}} />);
  it("dealer stage 1: no actions here, the sheet is the quote; no finance inputs", () => {
    const h = dealer(initialStageState({ tradeInExpected: true }));
    assert.match(h, /data-testid="dealer-stage-otd"/); assert.doesNotMatch(h, /apr-input|trade-offer-input/);
  });
  it("dealer stage 2: needs the trade; offers a value; answers one counter", () => {
    assert.match(dealer(atTrade(), { hasTrade: false }), /hasn&#x27;t added the trade-in yet|hasn't added the trade-in yet/);
    assert.match(dealer(atTrade()), /data-testid="send-trade-offer"/);
    const countered = go(go(atTrade(), { type: "trade_offer", value: 9000 }, "dealer"), { type: "trade_counter", value: 11000 }, "buyer");
    const h = dealer(countered);
    assert.match(h, /data-testid="accept-trade-counter"/); assert.match(h, /data-testid="revise-trade-offer"/);
  });
  it("dealer stage 3: waits for the buyer; then quotes APR and term on the true OTD minus down, monthly computed", () => {
    assert.doesNotMatch(dealer(atPayment()), /apr-input/);
    const asked = go(atPayment(), { type: "request_finance", downPayment: 4000 }, "buyer");
    const h = dealer(asked);
    assert.match(h, /data-testid="apr-input"/); assert.match(h, /\$30,749/); assert.match(h, /data-testid="send-finance-quote"/); assert.match(h, /data-testid="lender-input"/);
    assert.doesNotMatch(h, /monthly payment input|name="monthly"/);
  });
  it("dealer sees closed / walked outcomes and no actions once the request is closed", () => {
    assert.match(dealer(finalAccepted(), { rfqOpen: false }), /data-testid="dealer-stage-closed"/);
    const w = dealer(go(atTrade(), { type: "walk" }, "buyer"), { rfqOpen: false });
    assert.match(w, /data-testid="dealer-stage-walked"/); assert.doesNotMatch(w, /dealer-walk-stage/);
    assert.doesNotMatch(dealer(atTrade(), { rfqOpen: false }), /send-trade-offer|dealer-walk-stage/);
  });
});
