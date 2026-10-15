// Dealer surcharges: named lines or an explicit "none", required on a new/revised sheet, never in the sales-tax base, and counted in
// the out the door, amount financed and cash due. Separate from "Fees (named)"; a row in the buyer's compare; old quotes show nothing.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashOutTheDoor, financeCashDue, parseQuotePrefs, surchargeSummary, validateUsedQuote, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";
import { compareCashQuotes, feesTotal, msrpDiscount, otdExcludingAddOns } from "./cashCompare";
import { applyCashCounter, applyFinanceCounter, counterDiff } from "./counterSheet";
import { buildAcceptedQuote, verifyAcceptedQuote } from "./acceptCounter";
import { calcSalesTax } from "./feeOverride";
import { buildCounterAcceptedNotice } from "./dealerEmail";
import { buildThread } from "./dealThread";
import { UsedCompare } from "../components/UsedCompare";
import { UsedQuoteForm } from "../components/UsedQuoteForm";
import type { RfqInvite, RfqRequest } from "./rfq";

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const ZIP = "07405";
const SUR = [{ name: "Doc surcharge", amount: 400, reason: "Dealer-installed lot protection" }, { name: "Market adjustment", amount: 1000, reason: "High-demand model" }];
const cash = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({
  kind: "cash", sellingPrice: 40000, msrp: 42000, addOns: [], noAddOns: true, miles: null, stockNumber: null, cpo: false, expiresAt: future, rebates: [],
  dueAtSigning: [{ name: "Sales tax", amount: 2650 }, { name: "Doc fee", amount: 495 }, { name: "Title & registration", amount: 660 }], ...over,
});
const finance = (over: Partial<UsedFinanceQuote> = {}): UsedFinanceQuote => ({ ...(cash() as unknown as UsedFinanceQuote), kind: "finance", downPayment: 3000, amountFinanced: 40805, apr: 6, termMonths: 60, monthlyPaymentPreTax: 789, monthlyPaymentWithEstTax: null, lenderName: null, ...over });
const prefs = parseQuotePrefs({ quoteType: "cash", cash: { zip: ZIP } })!;
const car = { vin: "V", condition: "new" as const, requireMsrp: true };

const renderCompare = (useds: UsedCashQuote[]) => renderToStaticMarkup(<UsedCompare rfq={({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: ZIP } }, invites: useds.map((used, i) => ({ id: String(i + 1), dealerName: `Dealer ${i + 1}`, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: null, quote: { id: `q${i + 1}`, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } })) }) as unknown as RfqRequest} prefs={{ quoteType: "cash", cash: { zip: ZIP, timeline: null } } as never} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);

describe("validation (server and form share it)", () => {
  it("is required on a new or revised sheet: lines or 'No surcharges', $0 allowed", () => {
    const r = validateUsedQuote(cash(), prefs, { ...car, requireSurcharges: true });
    assert.ok(r.errors.some((e) => /^Surcharges: list each one/.test(e)));
    assert.deepEqual(validateUsedQuote(cash({ noSurcharges: true, surcharges: [] }), prefs, { ...car, requireSurcharges: true }).errors, []);
    assert.deepEqual(validateUsedQuote(cash({ surcharges: SUR }), prefs, { ...car, requireSurcharges: true }).errors, []);
    assert.deepEqual(validateUsedQuote(cash({ surcharges: [{ name: "Zero line", amount: 0, reason: "Placeholder line" }] }), prefs, { ...car, requireSurcharges: true }).errors, [], "a $0 amount is allowed");
  });
  it("needs a name on every line and a non-negative amount", () => {
    const bad = (surcharges: Array<{ name: string; amount: number; reason?: string }>) => validateUsedQuote(cash({ surcharges }), prefs, { ...car, requireSurcharges: true }).errors;
    assert.ok(bad([{ name: "", amount: 100, reason: "Reason" }]).some((e) => /Every surcharge needs a name/.test(e)));
    assert.ok(bad([{ name: "X", amount: 100, reason: "Reason" }]).some((e) => /Every surcharge needs a name/.test(e)), "one character is not a name");
    assert.ok(bad([{ name: "Dealer fee", amount: -1, reason: "Reason" }]).some((e) => /Every surcharge needs a name/.test(e)));
    assert.ok(bad([{ name: "Dealer fee", amount: NaN, reason: "Reason" }]).some((e) => /Every surcharge needs a name/.test(e)));
  });
  it("'none' and lines together are refused", () => {
    assert.ok(validateUsedQuote(cash({ noSurcharges: true, surcharges: SUR }), prefs, { ...car, requireSurcharges: true }).errors.some((e) => /not both/.test(e)));
  });
  it("an older quote with no surcharge field still re-validates (accepting a counter leaves the requirement off)", () => {
    assert.deepEqual(validateUsedQuote(cash(), prefs, car).errors, []);
  });
  it("the route parses and requires them; the form validates with the same gate", () => {
    const route = read("app/api/quote-invite/used-quote/route.ts");
    assert.match(route, /surcharges: Array\.isArray\(raw\.surcharges\)[\s\S]*?reason: typeof l\?\.reason === "string"[\s\S]*?noSurcharges: Boolean\(raw\.noSurcharges\),/);
    assert.match(route, /requireMsrp: true, requireSurcharges: true/);
    assert.match(read("components/UsedQuoteForm.tsx"), /requireMsrp: true, requireSurcharges: true/);
  });
});

describe("the totals", () => {
  it("out the door, and cash due on a finance quote, include surcharges", () => {
    assert.equal(cashOutTheDoor(cash()), 43805);
    assert.equal(cashOutTheDoor(cash({ surcharges: SUR })), 45205);
    assert.equal(financeCashDue(finance()), 3000 + 3805);
    assert.equal(financeCashDue(finance({ surcharges: SUR })), 3000 + 3805 + 1400);
  });
  it("'Out the door, excluding add-ons' leaves surcharges out; fees (named) never count them", () => {
    assert.equal(otdExcludingAddOns(cash({ surcharges: SUR })), otdExcludingAddOns(cash()));
    assert.equal(feesTotal(cash({ surcharges: SUR })), feesTotal(cash()));
    assert.equal(feesTotal(cash()), 1155);
  });
  it("the lowest-fees badge ignores surcharges", () => {
    const a = { id: "a", otd: 45205, quote: cash({ surcharges: SUR }) };
    const b = { id: "b", otd: 43805, quote: cash() };
    assert.deepEqual(compareCashQuotes([a, b]).lowestFees, [], "equal named fees: no badge, however different the surcharges");
    const c = { id: "c", otd: 43900, quote: cash({ dueAtSigning: [{ name: "Sales tax", amount: 2650 }, { name: "Doc fee", amount: 100 }, { name: "Title & registration", amount: 660 }] }) };
    assert.deepEqual(compareCashQuotes([a, b, c]).lowestFees, ["c"]);
  });
  it("the form builds its out the door, amount financed and cash due with them", () => {
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /sellingPrice \+ addOnTotal \+ surchargeTotal - rebateTotal - \(down \?\? 0\) - \(trade \?\? 0\) \+ dasTotal/);
    assert.match(f, /down \+ dasTotal \+ addOnTotal \+ surchargeTotal - rebateTotal/);
    assert.match(f, /sellingPrice \+ dasTotal \+ addOnTotal \+ surchargeTotal - rebateTotal/);
  });
});

describe("sales tax stays on price + add-ons", () => {
  it("a surcharge never moves the calculated tax, in the form, the server check or a counter", () => {
    assert.equal(calcSalesTax(ZIP, 40000, []), 2650);
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /const calcInput = \{ zip, sellingPrice: num\(f\.sellingPrice\), addOns: toLines\(addOns\), isNew: isNewCar \}/, "surcharges are not an input to the calculation (#540 added isNew)");
    const zero = { name: "Sales tax", amount: 0 };
    const q = cash({ surcharges: SUR, dueAtSigning: [zero, { name: "Doc fee", amount: 495 }, { name: "Title & registration", amount: 660 }] });
    assert.equal(applyCashCounter(q, {}, ZIP).dueAtSigning[0].amount, 2650);
    assert.equal(applyCashCounter({ ...q, surcharges: [] }, {}, ZIP).dueAtSigning[0].amount, 2650);
  });
});

describe("counters carry the surcharges through", () => {
  it("a cash counter keeps them, shows them as locked 'Surcharge' rows, and the out the door still adds up", () => {
    const before = cash({ surcharges: SUR });
    const after = applyCashCounter(before, { sellingPrice: 39000 }, ZIP);
    assert.deepEqual(after.surcharges, SUR);
    const rows = counterDiff({ kind: "cash", before, after, changed: [] });
    assert.deepEqual(rows.filter((r) => r.key.startsWith("surcharge:")).map((r) => r.label), ["Surcharge: Doc surcharge", "Surcharge: Market adjustment"]);
    assert.ok(rows.filter((r) => r.key.startsWith("surcharge:")).every((r) => r.locked));
    assert.equal(rows.find((r) => r.key === "otd")!.after, cashOutTheDoor(after));
  });
  it("a finance counter keeps them and the amount financed moves only by what the buyer changed", () => {
    const before = finance({ surcharges: SUR });
    const after = applyFinanceCounter(before, { sellingPrice: 39000 }, ZIP);
    assert.deepEqual(after.surcharges, SUR);
    assert.ok(Math.abs(after.amountFinanced - (before.amountFinanced - 1000 - (2650 - Math.round(39000 * 0.06625 * 100) / 100))) < 0.01);
  });
  it("accepting a counter requires the same surcharges, and the buyer notice names them", () => {
    const before = cash({ surcharges: SUR });
    const after = applyCashCounter(before, { sellingPrice: 39000 }, ZIP);
    const counter = { sentAt: "2026-10-15T00:00:00Z", sheet: { kind: "cash", before, after, changed: [] } } as never;
    const accepted = buildAcceptedQuote(after, 2584, "2026-10-15T00:00:00Z");
    assert.deepEqual(verifyAcceptedQuote(accepted, counter), []);
    assert.ok(verifyAcceptedQuote({ ...accepted, surcharges: [{ name: "Doc surcharge", amount: 1, reason: "x" }] }, counter).some((e) => /^Surcharges must match/.test(e)));
    assert.ok(verifyAcceptedQuote({ ...accepted, surcharges: [] }, counter).some((e) => /^Surcharges must match/.test(e)));
    const html = buildCounterAcceptedNotice({ dealerName: "D", vehicle: "CR-V", outTheDoor: 44000, surcharges: surchargeSummary(accepted) }).html;
    assert.match(html, /including dealer-imposed surcharges: Doc surcharge \$400 \(Dealer-installed lot protection\), Market adjustment \$1,000 \(High-demand model\)/);
    assert.doesNotMatch(buildCounterAcceptedNotice({ dealerName: "D", vehicle: "CR-V", outTheDoor: 44000 }).html, /surcharges/);
  });
});

describe("the dealer form", () => {
  const renderForm = (initial?: UsedCashQuote) => renderToStaticMarkup(<UsedQuoteForm token="tok12345678" vin="V" stockNumber={null} prefs={{ quoteType: "cash", cash: { zip: ZIP, timeline: null } }} buyerMiles={null} initial={initial} condition="new" onSubmitted={() => {}} />);
  it("has a Surcharges section modelled on Add-ons: a 'No surcharges - $0' checkbox, named lines, and 'Add a surcharge line'", () => {
    const html = renderForm();
    assert.match(html, /data-testid="eq-surcharges"/);
    assert.match(html, /data-testid="no-surcharges"/);
    assert.match(html, /No surcharges — \$0/);
    assert.match(html, /Add a surcharge line/);
    assert.ok(html.indexOf('data-testid="eq-surcharges"') > html.indexOf('data-testid="add-ons"') && html.indexOf('data-testid="eq-surcharges"') < html.indexOf('data-testid="eq-mandatory-fees"'));
  });
  it("a saved quote opens with its lines, and its out the door includes them", () => {
    const html = renderForm(cash({ surcharges: SUR }));
    assert.match(html, /value="Doc surcharge"/);
    assert.match(html, /value="Market adjustment"/);
    assert.match(html, /\$45,205\.00/);
  });
  it("the finance layout has the same section", () => {
    assert.match(read("components/UsedQuoteForm.tsx"), /data-testid="surcharges"[\s\S]*?No surcharges — \$0/);
  });
});

describe("the buyer's compare table", () => {
  const invite = (id: string, name: string, used: UsedCashQuote): RfqInvite =>
    ({ id, dealerName: name, dealerContactEmail: null, status: "quoted", declineReason: null, invitedAt: future, respondedAt: future, tradeAppraisal: null, quote: { id: `q${id}`, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: future, submittedAt: future, mustHaveAcknowledgement: true, notes: null, used } }) as unknown as RfqInvite;
  const rfqOf = (invites: RfqInvite[]): RfqRequest => ({ id: "9", buyerUserId: "2", status: "collecting", pickedQuoteId: null, createdAt: future, vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Honda", vehicleModel: "CR-V", vehicleTrim: "EX", mustHaves: [], tradeIn: null, quotePrefs: { quoteType: "cash", cash: { zip: ZIP } }, invites }) as unknown as RfqRequest;
  const render = (r: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} onCounter={async () => {}} busy={false} />);
  const labels = (html: string) => Array.from(html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)).map((m) => m[1]);
  const rowHtml = (html: string, row: string) => Array.from(html.matchAll(new RegExp(`<tr data-row="${row}">([\\s\\S]*?)</tr>`, "g")))[0]?.[1] ?? "";
  it("shows a Surcharges row between Add-ons and Rebates, naming each line, and the out the door includes them", () => {
    const html = render(rfqOf([invite("1", "With Surcharges", cash({ surcharges: SUR })), invite("2", "No Surcharges", cash({ noSurcharges: true, surcharges: [] }))]));
    const l = labels(html);
    assert.equal(l.indexOf("Surcharges"), l.indexOf("Add-ons") + 1);
    assert.equal(l.indexOf("Rebates / credits"), l.indexOf("Surcharges") + 1);
    const row = rowHtml(html, "surcharges");
    assert.match(row, /Doc surcharge/);
    assert.match(row, /Market adjustment/);
    assert.match(row, /None/);
    assert.match(rowHtml(html, "otd"), /\$45,205/);
    assert.match(rowHtml(html, "otdex"), /\$43,805/, "out the door excluding add-ons leaves surcharges out");
    assert.match(rowHtml(html, "fees"), /\$1,155/, "named fees are unchanged by surcharges");
  });
  it("quotes sent before surcharges existed show no Surcharges row at all", () => {
    const html = render(rfqOf([invite("1", "Old A", cash()), invite("2", "Old B", cash())]));
    assert.equal(labels(html).includes("Surcharges"), false);
  });
  it("an old quote beside a new one shows a dash, not a made-up zero", () => {
    const html = render(rfqOf([invite("1", "Old", cash()), invite("2", "New", cash({ surcharges: SUR }))]));
    assert.match(rowHtml(html, "surcharges"), /—/);
  });
});

describe("the thread, and the summary text", () => {
  it("the thread headline names the surcharges; a quote without them reads as before", () => {
    const inv = (used: UsedCashQuote) => ({ id: "1", dealerName: "D", status: "quoted", quote: { id: "q1", submittedAt: future, price: used.sellingPrice, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: future, mustHaveAcknowledgement: true, notes: null, used }, priorQuotes: [] }) as unknown as RfqInvite;
    const rfq = { id: "9", createdAt: future, buyerNote: null, status: "collecting", pickedQuoteId: null } as never;
    const text = (used: UsedCashQuote) => buildThread(rfq, inv(used), "buyer").find((e) => e.id === "quote-q1")!.text;
    assert.equal(text(cash()), "Dealer sent a quote: $43,805 out the door");
    assert.equal(text(cash({ noSurcharges: true, surcharges: [] })), "Dealer sent a quote: $43,805 out the door");
    assert.equal(text(cash({ surcharges: SUR })), "Dealer sent a quote: $45,205 out the door (includes dealer-imposed surcharges: Doc surcharge $400 (Dealer-installed lot protection), Market adjustment $1,000 (High-demand model))");
    assert.equal(surchargeSummary(cash()), null);
  });
  it("the buyer's explainer equation lists Surcharges after Add-ons for cash and finance", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.equal((w.match(/label: "Surcharges", note: "\$0 or each one named"/g) || []).length, 2);
  });
});

describe("each surcharge needs a short reason, shown to the buyer as dealer-imposed", () => {
  const errs = (reason: unknown) => validateUsedQuote(cash({ surcharges: [{ name: "Dealer prep", amount: 200, reason: reason as string }] }), prefs, { ...car, requireSurcharges: true }).errors;
  it("is required, 3 to 140 characters, on a new or revised sheet", () => {
    for (const bad of [undefined, "", "  ", "ab", "x".repeat(141)]) assert.ok(errs(bad).some((e) => /^Every surcharge needs a short reason/.test(e)), JSON.stringify(bad));
    for (const ok of ["abc", "Dealer-installed lot protection", "x".repeat(140)]) assert.deepEqual(errs(ok), [], ok.slice(0, 20));
  });
  it("an older quote re-validated on a counter is not asked for one", () => {
    assert.deepEqual(validateUsedQuote(cash({ surcharges: [{ name: "Dealer prep", amount: 200 }] }), prefs, car).errors, []);
  });
  it("the form has a required reason input on every line, and the route keeps it (trimmed, 140 max)", () => {
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /data-testid="surcharge-reason"/);
    assert.match(f, /aria-label="Surcharge reason"/);
    assert.match(f, /maxLength=\{SURCHARGE_REASON_MAX\}/);
    assert.match(renderToStaticMarkup(<UsedQuoteForm token="tok12345678" vin="V" stockNumber={null} prefs={{ quoteType: "cash", cash: { zip: ZIP, timeline: null } }} buyerMiles={null} initial={cash({ surcharges: SUR })} condition="new" onSubmitted={() => {}} />), /value="Dealer-installed lot protection"/);
    assert.match(read("app/api/quote-invite/used-quote/route.ts"), /\.trim\(\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 140\)/);
  });
  it("the buyer's compare labels each line 'Dealer-imposed' with its reason", () => {
    const html = renderCompare([cash({ surcharges: SUR })]);
    assert.equal((html.match(/data-testid="dealer-imposed"/g) || []).length, 2);
    assert.match(html, /Dealer-imposed — Dealer-installed lot protection/);
    assert.match(html, /Dealer-imposed — High-demand model/);
  });
});

describe("a soft warning above 10% of the selling price", () => {
  const warn = (amount: number, sellingPrice = 40000) => validateUsedQuote(cash({ sellingPrice, surcharges: [{ name: "Market adjustment", amount, reason: "High demand" }] }), prefs, { ...car, requireSurcharges: true });
  it("warns when surcharges total more than 10% — and is only ever a warning, never a block", () => {
    const over = warn(4001);
    assert.ok(over.warnings.some((w) => /more than 10% of the selling price/.test(w)));
    assert.deepEqual(over.errors, []);
  });
  it("is silent at exactly 10% and below, and counts every line together", () => {
    assert.deepEqual(warn(4000).warnings.filter((w) => /Surcharges total/.test(w)), []);
    assert.deepEqual(warn(100).warnings.filter((w) => /Surcharges total/.test(w)), []);
    const two = validateUsedQuote(cash({ surcharges: [{ name: "One", amount: 2500, reason: "Reason" }, { name: "Two", amount: 2500, reason: "Reason" }] }), prefs, { ...car, requireSurcharges: true });
    assert.ok(two.warnings.some((w) => /Surcharges total \$5,000/.test(w)));
  });
  it("shows on the dealer form through the same validation", () => {
    assert.match(read("components/UsedQuoteForm.tsx"), /validation\.warnings\.map/);
  });
});

describe("% off MSRP is on the selling price plus surcharges", () => {
  it("a surcharge can't inflate the discount", () => {
    assert.deepEqual(msrpDiscount({ sellingPrice: 40000, msrp: 42000 }), { status: "off", msrp: 42000, dollars: 2000, pct: 4.8, ratio: 2000 / 42000 });
    const withSur = msrpDiscount({ sellingPrice: 40000, msrp: 42000, surcharges: SUR });
    assert.deepEqual(withSur, { status: "off", msrp: 42000, dollars: 600, pct: 1.4, ratio: 600 / 42000 }, "40,000 + 1,400 = 41,400: the discount shrinks from $2,000 to $600");
  });
  it("moving $1,500 from price into a surcharge leaves the figure unchanged", () => {
    const a = msrpDiscount({ sellingPrice: 40000, msrp: 42000 });
    const b = msrpDiscount({ sellingPrice: 38500, msrp: 42000, surcharges: [{ name: "Adjustment", amount: 1500, reason: "Reason" }] });
    assert.deepEqual(a, b);
  });
  it("the biggest-discount badge ranks on the same figure", () => {
    const a = { id: "a", otd: 1, quote: cash({ sellingPrice: 38500, surcharges: [{ name: "Adjustment", amount: 1500, reason: "Reason" }] }) };
    const b = { id: "b", otd: 1, quote: cash({ sellingPrice: 39500 }) };
    assert.deepEqual(compareCashQuotes([a, b]).biggestDiscount, ["b"]);
  });
  it("the compare cell says so, and the dealer form's % of MSRP includes them", () => {
    assert.match(renderCompare([cash({ surcharges: SUR })]), /on price \+ surcharges/);
    assert.doesNotMatch(renderCompare([cash()]), /on price \+ surcharges/);
    assert.match(read("components/UsedQuoteForm.tsx"), /sellingPrice \+ addOnTotal \+ surchargeTotal \+ docFee/);
  });
});
