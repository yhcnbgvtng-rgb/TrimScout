import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CREDIT_BAND_COPY, cashOutTheDoor, compareFinanceQuotes, financeCashDue, financeMonthly, missingFinanceLocks, parseQuotePrefs, validateUsedQuote, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";

const NOW = new Date("2026-09-13T12:00:00Z");
const cashPrefs = parseQuotePrefs({ quoteType: "cash", cash: { zip: "07405" } })!;
const finPrefs = parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07405", timeline: "asap" } })!;
const FEES = [{ name: "Sales tax", amount: 2551 }, { name: "Doc fee", amount: 299 }, { name: "Title & registration", amount: 380 }];
const cash = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: 38500, dueAtSigning: FEES, addOns: [], noAddOns: true, rebates: [], miles: 34512, stockNumber: "P1234", cpo: true, expiresAt: "2026-09-30T00:00:00Z", notes: null, ...over });
const fin = (over: Partial<UsedFinanceQuote> = {}): UsedFinanceQuote => ({ ...cash(), kind: "finance", downPayment: 3000, tradeEquity: null, amountFinanced: 35500 + 3230, apr: 6.49, termMonths: 60, monthlyPaymentPreTax: financeMonthly(38730, 6.49, 60)!, monthlyPaymentWithEstTax: null, lenderName: null, ...over } as UsedFinanceQuote);
const USED = { vin: "V", condition: "used" as const };
const NEW = { vin: "V", condition: "new" as const };

describe("Finance / Cash quote locks — structured, itemized, apples to apples", () => {
  it("parses prefs strictly: cash needs a ZIP; finance needs term + down ≥ 0 + credit band + ZIP (all locks); lease is never a quotePrefs type", () => {
    assert.deepEqual(cashPrefs, { quoteType: "cash", cash: { zip: "07405", timeline: null } });
    assert.deepEqual(finPrefs, { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07405", timeline: "asap" } });
    assert.equal(parseQuotePrefs({ quoteType: "lease", lease: {} }), null);
    assert.equal(parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 61, downPayment: 0, creditBand: "good", zip: "07405" } }), null, "term off the list");
    assert.equal(parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 60, downPayment: 0, zip: "07405" } }), null, "credit band is a lock — 'prefer not to say' is not accepted");
    assert.equal(parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 60, downPayment: 0, creditBand: "good", zip: "" } }), null, "ZIP required");
    assert.equal(parseQuotePrefs({ quoteType: "cash", cash: { zip: "" } }), null);
  });
  it("credit-band copy is the product line, verbatim", () => {
    assert.equal(CREDIT_BAND_COPY, "No credit pull — this is your own estimate so dealers quote the same band.");
  });
  it("missingFinanceLocks names what's blank, in form order — the Continue gate and empty state", () => {
    assert.deepEqual(missingFinanceLocks({ termMonths: "", downPayment: "", creditBand: "", zip: "" }), ["term", "down payment", "credit band", "ZIP"]);
    assert.deepEqual(missingFinanceLocks({ termMonths: 60, downPayment: "0", creditBand: "fair", zip: "07405" }), []);
    assert.deepEqual(missingFinanceLocks({ termMonths: 60, downPayment: "$2,500", creditBand: "good", zip: "0740" }), ["ZIP"]);
    assert.deepEqual(missingFinanceLocks({ termMonths: 60, downPayment: "-5", creditBand: "good", zip: "07405" }), ["down payment"]);
  });
  it("amortized payment: $38,730 at 6.49% for 60 → $757.62; 0% is straight division", () => {
    assert.equal(financeMonthly(38730, 6.49, 60), 757.62);
    assert.equal(financeMonthly(36000, 0, 60), 600);
    assert.equal(financeMonthly(0, 5, 60), null);
  });
  it("a complete cash quote passes; OTD = selling price + itemized fees + add-ons − rebates", () => {
    assert.deepEqual(validateUsedQuote(cash(), cashPrefs, USED, NOW).errors, []);
    assert.equal(cashOutTheDoor(cash()), 41730);
    assert.equal(cashOutTheDoor(cash({ noAddOns: false, addOns: [{ name: "Paint protection", amount: 500 }], rebates: [{ name: "Loyalty", amount: 1000 }] })), 41230);
  });
  it("a complete finance quote passes; cash due at signing = down + fees + tax + add-ons − rebates; miles only required on a used car", () => {
    assert.deepEqual(validateUsedQuote(fin(), finPrefs, USED, NOW).errors, []);
    assert.equal(financeCashDue(fin()), 6230);
    assert.equal(financeCashDue(fin({ noAddOns: false, addOns: [{ name: "Nitrogen", amount: 199 }], rebates: [{ name: "Conquest", amount: 750 }] })), 5679);
    assert.deepEqual(validateUsedQuote(fin({ miles: null, cpo: false }), finPrefs, NEW, NOW).errors, [], "new car: no miles needed");
    assert.ok(validateUsedQuote(fin({ miles: null }), finPrefs, USED, NOW).errors.some((e) => /Miles on the car/.test(e)));
  });
  it("blocks: lump fees, no sales-tax line, missing/past expiry, bad amounts, monthly-only finance, wrong kind", () => {
    const lump = validateUsedQuote(cash({ dueAtSigning: [{ name: "Fees", amount: 3230 }] }), cashPrefs, USED, NOW);
    assert.ok(lump.errors.some((e) => /single unlabeled lump/.test(e)));
    const otdLump = validateUsedQuote(cash({ dueAtSigning: [{ name: "OTD", amount: 41730 }] }), cashPrefs, USED, NOW);
    assert.ok(otdLump.errors.some((e) => /single unlabeled lump/.test(e)), "a single OTD line is a lump");
    const noTax = validateUsedQuote(cash({ dueAtSigning: [{ name: "Doc fee", amount: 299 }, { name: "Title", amount: 380 }] }), cashPrefs, USED, NOW);
    assert.ok(noTax.errors.some((e) => /Sales tax .* own line/.test(e)));
    assert.deepEqual(validateUsedQuote(cash({ dueAtSigning: [{ name: "Sales tax", amount: 0 }, { name: "Doc fee", amount: 299 }, { name: "Title", amount: 380 }] }), cashPrefs, USED, NOW).errors, [], "$0 tax is a valid tax line");
    const past = validateUsedQuote(cash({ expiresAt: "2026-09-01T00:00:00Z" }), cashPrefs, USED, NOW);
    assert.ok(past.errors.some((e) => /must be in the future/.test(e)));
    const bad = validateUsedQuote(cash({ sellingPrice: 0, miles: -1 }), cashPrefs, USED, NOW);
    assert.ok(bad.errors.some((e) => /Selling price/.test(e)) && bad.errors.some((e) => /Miles on the car/.test(e)));
    const monthlyOnly = validateUsedQuote({ kind: "finance", monthlyPaymentPreTax: 650, expiresAt: "2026-09-30T00:00:00Z" } as Partial<UsedFinanceQuote>, finPrefs, USED, NOW);
    assert.ok(monthlyOnly.errors.some((e) => /Amount financed/.test(e)) && monthlyOnly.errors.some((e) => /Selling price/.test(e)));
    const wrongKind = validateUsedQuote(cash(), finPrefs, USED, NOW);
    assert.ok(wrongKind.errors.some((e) => /asked for a finance quote/.test(e)));
  });
  it("add-ons: each its own line or an explicit none — never buried; rebates need a name and amount", () => {
    const neither = validateUsedQuote(fin({ noAddOns: false, addOns: [] }), finPrefs, USED, NOW);
    assert.ok(neither.errors.some((e) => /Add-ons: list each one/.test(e)));
    const both = validateUsedQuote(fin({ noAddOns: true, addOns: [{ name: "Etch", amount: 299 }] }), finPrefs, USED, NOW);
    assert.ok(both.errors.some((e) => /not both/.test(e)));
    const nameless = validateUsedQuote(fin({ noAddOns: false, addOns: [{ name: "", amount: 299 }] }), finPrefs, USED, NOW);
    assert.ok(nameless.errors.some((e) => /Every add-on needs a name/.test(e)));
    assert.deepEqual(validateUsedQuote(fin({ noAddOns: false, addOns: [{ name: "Etch", amount: 299 }] }), finPrefs, USED, NOW).errors, []);
    assert.ok(validateUsedQuote(fin({ rebates: [{ name: "X", amount: 0 }] }), finPrefs, USED, NOW).errors.some((e) => /rebate/.test(e)));
  });
  it("finance: term and down must equal the buyer's locks — a different structure is rejected, not countered", () => {
    const longer = validateUsedQuote(fin({ termMonths: 72 }), finPrefs, USED, NOW);
    assert.ok(longer.errors.some((e) => /Term must be the buyer's lock: 60 months/.test(e)));
    const lessDown = validateUsedQuote(fin({ downPayment: 2000 }), finPrefs, USED, NOW);
    assert.ok(lessDown.errors.some((e) => /Down payment must be the buyer's lock: \$3,000/.test(e)));
    assert.doesNotMatch(JSON.stringify(validateUsedQuote(fin({ termMonths: 72 }), finPrefs, USED, NOW).errors), /counter/i);
  });
  it("compare order: monthly first, then cash due at signing, then amount financed", () => {
    const a = fin({ monthlyPaymentPreTax: 700, downPayment: 3000 });
    const b = fin({ monthlyPaymentPreTax: 700, downPayment: 3000, dueAtSigning: [...FEES, { name: "Dealer prep", amount: 400 }] });
    const c = fin({ monthlyPaymentPreTax: 690, dueAtSigning: [...FEES, { name: "Dealer prep", amount: 2000 }] });
    assert.deepEqual([b, a, c].sort(compareFinanceQuotes).map((q) => financeCashDue(q)), [financeCashDue(c), 6230, 6630]);
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — Finance | Cash locks on Step 2; dealer sheets; compare column sets; lease locks", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("Step 2: used shows Finance | Cash only (no lease tile, no 'coming soon'); locks gate Continue; quotePrefs ride the payload for new and used", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /\(isUsed \? \(\["finance", "cash"\] as const\) : \(\["lease", "finance", "cash"\] as const\)\)\.map/);
    assert.doesNotMatch(w, /coming soon|USED_LEASE|CPO lease/i, "no lease teaser on Used Step 2");
    assert.match(w, /isUsed \? "grid-cols-2" : "grid-cols-3"/);
    assert.match(w, /\{isUsed \? "Choose finance or cash to continue\." : "Choose lease, finance or cash to continue\."\}/);
    assert.match(w, /hint="Pick one\. Dealers quote through the matching calculator\."/);
    assert.match(w, /const quoteSetupComplete = Boolean\(quoteType\) && missingLocks\.length === 0 && !\(quoteType === "lease" && isUsed\);/);
    assert.match(w, /missingFinanceLocks\(\{ termMonths: financeTerm, downPayment, creditBand, zip: huntZip \}\)/);
    assert.match(w, /\(leaseDasIntent \? \[\] : \["due-at-signing intent"\]\), \.\.\.\(creditBand \? \[\] : \["credit band"\]\)/, "lease locks band + DAS intent");
    assert.match(w, /quoteType === "finance" && creditBand\s*\? \(\{ quoteType: "finance", finance: \{ termMonths: financeTerm \|\| 60, downPayment/);
    assert.match(w, /quoteType === "cash"\s*\? \(\{ quoteType: "cash", cash: \{ zip/);
    assert.doesNotMatch(w, /Prefer not to say/, "credit band is required — no opt-out");
    assert.match(w, /data-testid="finance-credit-band"/);
    assert.match(w, /data-testid="lease-credit-band"/);
    assert.match(w, /data-testid="lease-das-intent"/);
    assert.match(w, /data-testid="missing-locks"/);
    assert.match(w, /creditBand: creditBand \|\| null,\s*dueAtSigningIntent: leaseDasIntent \|\| null,/);
  });
  it("create route refuses a used lease and requires Finance / Cash prefs on a used car", () => {
    const r = read("app/api/rfqs/route.ts");
    assert.match(r, /Used cars quote as Finance or Cash — a used lease isn't offered yet\./);
    assert.match(r, /if \(used && !parseQuotePrefs\(body\.quotePrefs\)\)/);
    assert.match(r, /Finance requests need a term, down payment, credit band and ZIP before they can be sent\./);
  });
  it("dealer page routes used asks to the Finance / Cash sheet; the sheet computes the monthly and has no checklist gate", () => {
    const dealerPage = read("app/quote-request/received/page.tsx");
    assert.match(dealerPage, /ctx\.quotePrefs \? \([\s\S]*?<UsedQuoteForm/);
    assert.doesNotMatch(dealerPage, /must-confirm|mustConfirm/i);
    // Every sheet says trade-ins come after the OTD price — the quote is the car alone.
    assert.equal((dealerPage.match(/<TradeInNote expected=\{ctx\.tradeInExpected\} \/>/g) || []).length, 2, "cash/finance intro and the lease intro both carry the trade-in note");
    assert.match(dealerPage, /Trade-ins are handled after an out-the-door price is agreed/);
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /validateUsedQuote\(quote, prefs, \{ vin: f\.vin, stockNumber: f\.stockNumber, condition \}\)/);
    assert.match(f, /financeMonthly\(amountFinanced, apr, term\)/);
    assert.match(f, /data-testid="add-ons"/);
    assert.match(f, /data-testid="no-add-ons"/);
    assert.match(f, /data-testid="rebates"/);
    assert.match(f, /data-testid="lock-mismatch"/);
    assert.doesNotMatch(f, /counterOffer|creditAssumption|Prefer not/, "no counters, no dealer-picked credit tier");
    assert.match(f, /\{used \? field\(\{ k: "miles"/, "miles only on a used car");
    assert.doesNotMatch(f, /checklist|mustConfirm|acks/i, "dealer submit needs no checklist answers");
    assert.doesNotMatch(f, /monthlyPaymentPreTax: num\(f\./, "no typed monthly");
    const route = read("app/api/quote-invite/used-quote/route.ts");
    assert.match(route, /validateUsedQuote\(quote, rfq\.quotePrefs, \{ vin, stockNumber, condition \}\)/);
    assert.match(route, /addOns: toLines\(raw\.addOns\) \?\? \[\],\s*noAddOns: Boolean\(raw\.noAddOns\),\s*rebates: toLines\(raw\.rebates\) \?\? \[\],/);
    assert.doesNotMatch(route, /checklist|mustConfirm/i);
  });
  it("deal page: used deals use UsedCompare (Finance / Cash columns), never the lease grid; the lease calculator is untouched", () => {
    const page = read("app/rfq/[id]/page.tsx");
    assert.match(page, /\{rfq\.quotePrefs && \([\s\S]*?<UsedCompare rfq=\{rfq\} prefs=\{rfq\.quotePrefs\}/);
    assert.match(page, /\{rfq\.leasePrefs && \(\s*<div className="space-y-3">\s*<h2[^>]*>Compare lease quotes/);
    const c = read("components/UsedCompare.tsx");
    assert.doesNotMatch(c, /moneyFactor|residual/i);
    assert.match(c, />Out the door</);
    assert.match(c, />Cash due at signing</);
    assert.match(c, />APR · financed</);
    assert.match(c, />Fees & tax</);
    assert.match(c, />Add-ons</);
    assert.match(c, /compareFinanceQuotes\(a\.used as UsedFinanceQuote, b\.used as UsedFinanceQuote\)/);
    assert.match(c, /same car on every row: VIN/);
    // Dealer-side counter offers never existed on used quotes; the buyer's own counter (2026-09-17) does.
    assert.doesNotMatch(c, /isFinanceCounter|dealer counter/i);
    assert.match(c, /<CounterSheetForm dealerName=\{invite\.dealerName\} quote=\{\{ used \}\}/);
    assert.match(read("lib/rfqTracker.ts"), /quotePrefs\?\.quoteType === "finance"\) return "Finance"/);
  });
});
