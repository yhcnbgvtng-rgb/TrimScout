// Dealer overrides of the fees TrimScout calculates (sales tax, title & registration): stored with both values, flagged to the
// buyer with the original, the new amount, the difference and the reason, totals recomputed from the dealer's lines, the doc fee
// locked, an override kept (not wiped) when the price later moves, and the buyer told through the SAFE MODE sender.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { activeOverrides, calcFee, calcSalesTax, calcTitleRegistration, canOverrideFee, normalizeFeeOverrides, overridableKey, overrideDifference, overrideSummary, overrideTotalDelta, OVERRIDE_REASON_MAX } from "./feeOverride";
import { applyCashCounter, applyFinanceCounter } from "./counterSheet";
import { cashOutTheDoor, financeMonthly, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";
import { buildFeeOverrideNotice } from "./feeOverrideNotice";
import { SAFE_MODE_RECIPIENT, sendFeeOverrideNotice } from "./dealerEmail";
import { DealerAdjustedFlag } from "../components/DealerAdjustedFlag";
import { UsedCompare } from "../components/UsedCompare";
import { UsedQuoteForm } from "../components/UsedQuoteForm";
import type { RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const FUTURE = "2099-01-01T00:00:00Z";
const ZIP = "07405"; // NJ: 6.625% state rate
const PRICE = 40000;
const CALC_TAX = 2650; // 40,000 × 6.625%
const CALC_REG = 660; // 40,000 × 1.1% + 220

const lines = (tax = CALC_TAX, doc = 799, reg = CALC_REG) => [{ name: "Sales tax", amount: tax }, { name: "Doc fee", amount: doc }, { name: "Title & registration", amount: reg }];
const norm = (dueAtSigning = lines(), submitted: unknown = [], over: Record<string, unknown> = {}) =>
  normalizeFeeOverrides({ dueAtSigning, sellingPrice: PRICE, addOns: [], zip: ZIP, submitted, now: new Date("2026-10-11T12:00:00Z"), ...over });
const cash = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: PRICE, dueAtSigning: lines(), addOns: [], noAddOns: true, rebates: [], miles: null, stockNumber: "S1", cpo: false, expiresAt: FUTURE, ...over });

describe("what TrimScout calculates", () => {
  it("sales tax is the ZIP-state rate on price + add-ons; title & registration is 1.1% + $220", () => {
    assert.equal(calcSalesTax(ZIP, PRICE, []), CALC_TAX);
    assert.equal(calcSalesTax(ZIP, PRICE, [{ name: "Nitrogen", amount: 400 }]), 2676.5);
    assert.equal(calcTitleRegistration(PRICE), CALC_REG);
    assert.equal(calcSalesTax("", PRICE, []), null, "no usable ZIP: nothing is calculated, so nothing can be overridden");
    assert.equal(calcFee("sales_tax", { zip: ZIP, sellingPrice: null }), null);
  });
  it("only sales tax and title & registration can be overridden; the doc fee never can", () => {
    assert.equal(overridableKey("Sales tax"), "sales_tax");
    assert.equal(overridableKey("Title & registration"), "title_registration");
    assert.equal(overridableKey("Doc fee"), null);
    assert.equal(overridableKey("Documentation fee"), null);
    assert.equal(overridableKey("Dealer prep"), null);
    assert.equal(canOverrideFee("Doc fee"), false);
    assert.equal(canOverrideFee("Nitrogen fill"), false);
  });
});

describe("override storage", () => {
  it("stores the calculated and the dealer-entered values, the reason and a timestamp", () => {
    const r = norm(lines(2750), [{ key: "sales_tax", reason: "county rate 6.875%" }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.overrides, [{ key: "sales_tax", label: "Sales tax", calculated: CALC_TAX, amount: 2750, reason: "county rate 6.875%", at: "2026-10-11T12:00:00.000Z" }]);
    assert.equal(overrideDifference(r.overrides[0]), 100);
  });
  it("covers both lines at once, with the sheet's own amount winning over anything the browser claims", () => {
    const r = norm(lines(2750, 799, 700), [{ key: "sales_tax", reason: "county rate", amount: 1, calculated: 1 }, { key: "title_registration", reason: "plate transfer", calculated: 5 }]);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.overrides.map((o) => [o.key, o.calculated, o.amount]), [["sales_tax", CALC_TAX, 2750], ["title_registration", CALC_REG, 700]]);
  });
  it("keeps the original timestamp when a revision leaves the amount alone", () => {
    const r = norm(lines(2750), [{ key: "sales_tax", reason: "county rate", amount: 2750, at: "2026-10-10T09:00:00Z" }]);
    assert.equal(r.overrides[0].at, "2026-10-10T09:00:00Z");
  });
  it("a different amount with no reason is refused, naming both figures", () => {
    for (const reason of [undefined, "", "  ", "ab"]) {
      const r = norm(lines(2750), reason === undefined ? [] : [{ key: "sales_tax", reason }]);
      assert.equal(r.overrides.length, 0);
      assert.match(r.errors.join(" "), /Sales tax: you entered \$2,750 instead of TrimScout's \$2,650 — add a short reason/);
    }
    assert.match(norm(lines(2750), [{ key: "sales_tax", reason: "x".repeat(OVERRIDE_REASON_MAX + 1) }]).errors.join(" "), /under 140 characters/);
  });
  it("an override that matches TrimScout's figure, or has nothing to override, is refused", () => {
    assert.match(norm(lines(), [{ key: "sales_tax", reason: "same" }]).errors.join(" "), /nothing to override/);
    assert.match(norm(lines(), [{ key: "sales_tax", reason: "no zip" }], { zip: "" }).errors.join(" "), /no TrimScout calculation/);
    assert.deepEqual(norm(lines(), []).overrides, []);
  });
  it("the doc fee stays locked: an override on it, or on any other fee, is refused", () => {
    const r = norm(lines(CALC_TAX, 999), [{ key: "doc_fee", label: "Doc fee", reason: "market adjustment" }]);
    assert.match(r.errors.join(" "), /Doc fee can't be overridden — only sales tax and title & registration can; the doc fee stays locked/);
    assert.deepEqual(r.overrides, []);
    assert.match(norm(lines(), [{ key: "nitrogen", label: "Nitrogen", reason: "whatever" }]).errors.join(" "), /can't be overridden/);
  });
  it("stale overrides on a stored quote (the line moved since) are not shown", () => {
    const q = cash({ dueAtSigning: lines(2750), feeOverrides: [{ key: "sales_tax", label: "Sales tax", calculated: CALC_TAX, amount: 2750, reason: "county", at: "x" }] });
    assert.equal(activeOverrides(q).length, 1);
    assert.equal(activeOverrides({ ...q, dueAtSigning: lines(2600) }).length, 0);
    assert.equal(activeOverrides(cash()).length, 0);
  });
});

describe("total math", () => {
  const over = (tax: number, reg: number) => cash({ dueAtSigning: lines(tax, 799, reg) });
  it("out the door is the dealer's lines: price + tax + doc + title/reg, so an override moves it by exactly the difference", () => {
    const base = cashOutTheDoor(cash());
    assert.equal(base, 40000 + 2650 + 799 + 660);
    assert.equal(cashOutTheDoor(over(2750, 660)), base + 100);
    assert.equal(cashOutTheDoor(over(2650, 600)), base - 60);
    assert.equal(cashOutTheDoor(over(2750, 700)), base + 140);
    const ovs = norm(lines(2750, 799, 700), [{ key: "sales_tax", reason: "county" }, { key: "title_registration", reason: "plate transfer" }]).overrides;
    assert.equal(overrideTotalDelta(ovs), 140);
    assert.equal(cashOutTheDoor(over(2750, 700)) - cashOutTheDoor(cash()), overrideTotalDelta(ovs));
  });
  it("a finance sheet rolls the override into the amount financed and the monthly", () => {
    const amountFinanced = (tax: number) => 40000 - 3000 + tax + 799 + 660;
    const monthly = (tax: number) => financeMonthly(amountFinanced(tax), 6, 60) as number;
    assert.ok(monthly(2750) > monthly(2650));
    assert.equal(Math.round((amountFinanced(2750) - amountFinanced(2650)) * 100) / 100, 100);
  });
  it("the counter keeps a dealer-overridden tax as quoted when the buyer lowers the price — and recalculates one that wasn't overridden", () => {
    const quoted = cash({ dueAtSigning: lines(2750), feeOverrides: [{ key: "sales_tax", label: "Sales tax", calculated: CALC_TAX, amount: 2750, reason: "county rate 6.875%", at: "x" }] });
    const kept = applyCashCounter(quoted, { sellingPrice: 38000 }, ZIP);
    assert.equal(kept.dueAtSigning.find((l) => l.name === "Sales tax")?.amount, 2750, "not silently wiped");
    assert.equal(kept.feeOverrides?.length, 1);
    const plain = applyCashCounter(cash(), { sellingPrice: 38000 }, ZIP);
    assert.equal(plain.dueAtSigning.find((l) => l.name === "Sales tax")?.amount, 2517.5, "an un-overridden tax follows the new price");
    const fin: UsedFinanceQuote = { ...quoted, kind: "finance", downPayment: 3000, amountFinanced: 37000, apr: 6, termMonths: 60, monthlyPaymentPreTax: 700, monthlyPaymentWithEstTax: null } as UsedFinanceQuote;
    assert.equal(applyFinanceCounter(fin, { sellingPrice: 38000 }, ZIP).dueAtSigning.find((l) => l.name === "Sales tax")?.amount, 2750);
  });
  it("the dealer is still prompted to review tax when the price moves (the prompt stays wired in both forms)", () => {
    const form = read("components/UsedQuoteForm.tsx");
    assert.match(form, /counterPriceChanged\(counterSheet\) && !taxConfirmed/);
    assert.match(form, /\.\.\.\(taxPending \? \[TAX_PROMPT_COPY\] : \[\]\)/);
    assert.match(form, /<TaxUpdatePrompt pending=\{taxPending\}/);
  });
});

describe("the buyer's flag", () => {
  const ov = norm(lines(2750), [{ key: "sales_tax", reason: "county rate 6.875%" }]).overrides;
  it("shows 'Dealer adjusted' with TrimScout's amount, the dealer's amount, the difference and the reason", () => {
    const html = renderToStaticMarkup(<DealerAdjustedFlag overrides={ov} />);
    assert.match(html, /Dealer adjusted/);
    assert.match(html, /data-testid="adjusted-original">\$2,650</);
    assert.match(html, /data-testid="adjusted-new">\$2,750</);
    assert.match(html, /data-testid="adjusted-diff">\+\$100</);
    assert.match(html, /Dealer&#x27;s reason: “county rate 6.875%”/);
    assert.equal(renderToStaticMarkup(<DealerAdjustedFlag overrides={[]} />), "");
  });
  it("a lower dealer amount reads as a minus", () => {
    const html = renderToStaticMarkup(<DealerAdjustedFlag overrides={norm(lines(CALC_TAX, 799, 600), [{ key: "title_registration", reason: "plate transfer" }]).overrides} />);
    assert.match(html, /data-testid="adjusted-diff">−\$60</);
  });
  it("sits on the right line of the compare: tax flag under Sales tax, title flag under the named fees", () => {
    const quote = cash({ dueAtSigning: lines(2750, 799, 700), feeOverrides: norm(lines(2750, 799, 700), [{ key: "sales_tax", reason: "county" }, { key: "title_registration", reason: "plate transfer" }]).overrides });
    const rfq = { id: "17", vin: "V", status: "collecting", pickedQuoteId: null, quotePrefs: { quoteType: "cash", cash: { zip: ZIP } }, invites: [{ id: "1", dealerName: "Adjust Motors", status: "quoted", quote: { id: "q1", inviteId: "1", dealerName: "Adjust Motors", price: PRICE, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: FUTURE, submittedAt: "2026-10-11T00:00:00Z", mustHaveAcknowledgement: true, notes: null, used: quote }, vehicle: null }] } as unknown as RfqRequest;
    const html = renderToStaticMarkup(<UsedCompare rfq={rfq} prefs={rfq.quotePrefs!} onPick={() => {}} onWalk={() => {}} busy={false} />);
    assert.match(html, /data-testid="dealer-adjusted-sales_tax"/);
    assert.match(html, /data-testid="dealer-adjusted-title_registration"/);
    assert.match(html, /county/);
    assert.match(html, /plate transfer/);
    const plain = renderToStaticMarkup(<UsedCompare rfq={{ ...rfq, invites: [{ ...rfq.invites[0], quote: { ...rfq.invites[0].quote!, used: cash() } }] } as RfqRequest} prefs={rfq.quotePrefs!} onPick={() => {}} onWalk={() => {}} busy={false} />);
    assert.doesNotMatch(plain, /Dealer adjusted/, "no flag without an override");
  });
  it("tells the dealer's screen the same story: summary line", () => {
    assert.equal(overrideSummary(ov[0]), "Sales tax: TrimScout $2,650 → dealer $2,750 (+$100) — county rate 6.875%");
  });
});

describe("the buyer notice goes through the SAFE MODE sender", () => {
  const ov = norm(lines(2750, 799, 600), [{ key: "sales_tax", reason: "county rate 6.875%" }, { key: "title_registration", reason: "plate transfer" }]).overrides;
  const n = buildFeeOverrideNotice({ dealerName: "Adjust Motors", vehicle: "2026 Toyota RAV4 XLE", overrides: ov, url: "https://trimscout.example/rfq/17" })!;
  it("names every adjusted line with the original, the new amount, the difference and the reason — and says the doc fee isn't part of it", () => {
    assert.match(n.subject, /^\[SAFE MODE\] Dealer adjusted a fee on your quote: 2026 Toyota RAV4 XLE$/);
    assert.match(n.html, /SAFE MODE:<\/strong> this buyer notification was redirected here/);
    for (const s of ["Sales tax", "Title &amp; registration", "$2,650", "$2,750", "+$100", "$660", "$600", "−$60", "county rate 6.875%", "plate transfer", "doc fee is not part of this"]) assert.ok(n.html.includes(s), s);
    assert.equal(buildFeeOverrideNotice({ dealerName: "x", vehicle: "y", overrides: [], url: "u" }), null);
  });
  it("no contact details in it, and the sender can only ever address the safe recipient", () => {
    assert.doesNotMatch(n.html, /@[a-z0-9-]+\.[a-z]{2,}/i);
    assert.equal(SAFE_MODE_RECIPIENT, "pausmi@outlook.com");
    assert.match(read("lib/dealerEmail.ts"), /export async function sendFeeOverrideNotice[\s\S]*?sendViaResend\(notice\.subject, notice\.html\)/);
    assert.equal(typeof sendFeeOverrideNotice, "function");
  });
});

describe("wiring", () => {
  it("the used-quote route recomputes and validates overrides server-side, stores them whole, logs the deal event and emails the buyer", () => {
    const r = read("app/api/quote-invite/used-quote/route.ts");
    assert.match(r, /normalizeFeeOverrides\(\{ dueAtSigning: quote\.dueAtSigning/);
    assert.match(r, /feeOverrides: fees\.overrides\.length \? fees\.overrides : null/);
    assert.match(r, /kind: "event", type: "fee_override"/);
    assert.match(r, /sendFeeOverrideNotice\(notice\)/);
    assert.match(r, /status: 422/);
  });
  it("the dealer form: Edit + a required reason on tax and title & registration only; the doc fee row has none", () => {
    const f = read("components/UsedQuoteForm.tsx");
    assert.doesNotMatch(f, /fee-edit-/, "no Edit buttons: both fees are live fields");
    assert.match(f, /data-testid=\{`fee-reason-\$\{k\}`\}/);
    assert.match(f, /list === fees && standing \? overridableKey\(it\.name\) : null/);
    assert.match(f, /feeOverrides: feeCheck\.overrides/);
    assert.match(f, /\.\.\.feeCheck\.errors/);
    assert.match(f, /the doc fee stays as you set it and has no override/);
  });
});

describe("the dealer's sheet", () => {
  const prefs = { quoteType: "cash", cash: { zip: ZIP, timeline: null } } as const;
  const form = (initial: UsedCashQuote) => renderToStaticMarkup(<UsedQuoteForm token="tok12345678" vin="V" stockNumber={null} prefs={prefs} buyerMiles={null} initial={initial} onSubmitted={() => {}} />);
  it("shows TrimScout's amount: sales tax and title & registration are directly editable, and the doc fee has no override", () => {
    const html = form(cash());
    assert.doesNotMatch(html, /data-testid="fee-edit-/, "sales tax and title & registration are directly editable — no Edit buttons, and the doc fee never had one");
    assert.doesNotMatch(html, /fee-reason-/, "no reason box until the dealer taps Edit");
    assert.match(html, /data-testid="fee-amount-sales_tax"[^>]*value="2,650"/, "TrimScout's calculated tax");
    assert.match(html, /data-testid="fee-amount-title_registration"[^>]*value="660"/, "title & registration pre-filled with TrimScout's estimate");
  });
  it("title & registration is a live, pre-filled field with a state-estimate hint and no reason box until the amount changes", () => {
    const html = form(cash());
    assert.match(html, /data-testid="fee-amount-title_registration"[^>]*/);
    assert.doesNotMatch(html, /aria-label="Title &amp; registration amount \(calculated by TrimScout\)"/, "not the read-only variant");
    assert.match(html, /data-testid="title-estimate-hint">TrimScout estimate for NJ: \$660</);
    assert.doesNotMatch(html, /fee-override-title_registration/);
  });
  it("a changed title & registration amount opens with its reason, and the buyer's flag shows the estimate beside the dealer's number", () => {
    const ov = norm(lines(CALC_TAX, 799, 700), [{ key: "title_registration", reason: "plate transfer" }]).overrides;
    const html = form(cash({ dueAtSigning: lines(CALC_TAX, 799, 700), feeOverrides: ov }));
    assert.match(html, /data-testid="fee-override-title_registration"/);
    assert.match(html, /value="plate transfer"/);
    const flag = renderToStaticMarkup(<DealerAdjustedFlag overrides={ov} />);
    assert.match(flag, /Dealer adjusted/);
    assert.match(flag, /data-testid="adjusted-original">\$660</);
    assert.match(flag, /data-testid="adjusted-new">\$700</);
  });
  it("sales tax is a live, pre-filled field with a state-estimate hint and no reason box until the amount changes", () => {
    const html = form(cash());
    assert.match(html, /data-testid="fee-amount-sales_tax"[^>]*value="2,650"/);
    assert.doesNotMatch(html, /aria-label="Sales tax amount \(calculated by TrimScout\)"/, "not the read-only variant");
    assert.match(html, /data-testid="tax-estimate-hint">TrimScout estimate for NJ: \$2,650</);
    assert.doesNotMatch(html, /fee-override-sales_tax/);
  });
  it("typing the estimate back is not an override (nothing submitted)", () => {
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /editing\[k\] && \(calcs\[k\] == null \|\| Math\.abs/);
  });
  it("a revision that already differs from TrimScout opens with the earlier reason in place", () => {
    const ov = norm(lines(2750), [{ key: "sales_tax", reason: "county rate 6.875%" }]).overrides;
    const html = form(cash({ dueAtSigning: lines(2750), feeOverrides: ov }));
    assert.match(html, /data-testid="fee-override-sales_tax"/);
    assert.match(html, /value="county rate 6.875%"/);
    assert.match(html, /data-overridden="true"/);
    assert.match(html, /data-testid="fee-reset-sales_tax"/);
    assert.doesNotMatch(html, /fee-edit-sales_tax/);
    assert.match(html, /\+\$100\.00/, "shows the difference from TrimScout's figure");
  });
  it("a typed tax with no reason on file opens the line and the sheet cannot be sent (the reason is required)", () => {
    const html = form(cash({ dueAtSigning: lines(2750) }));
    assert.match(html, /data-testid="fee-reason-sales_tax"/);
    assert.match(html, /placeholder="e.g. county rate 6.875%"/);
  });
});
