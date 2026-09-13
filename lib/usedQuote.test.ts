import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cashOutTheDoor, financeMonthly, isFinanceCounter, parseQuotePrefs, validateUsedQuote, type UsedCashQuote, type UsedFinanceQuote } from "./usedQuote";
import { buildMustConfirmList, EMPTY_MUST_CONFIRM_DRAFT } from "./mustConfirm";

const NOW = new Date("2026-09-13T12:00:00Z");
const ITEMS = buildMustConfirmList({ ...EMPTY_MUST_CONFIRM_DRAFT, maxMiles: "40000" });
const ACKS = [{ id: "clean_title", status: "confirmed" as const }, { id: "miles_under", status: "confirmed" as const }];
const cashPrefs = parseQuotePrefs({ quoteType: "cash", cash: { zip: "07405" } })!;
const finPrefs = parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07405", timeline: "asap" } })!;
const cash = (over: Partial<UsedCashQuote> = {}): UsedCashQuote => ({ kind: "cash", sellingPrice: 38500, dueAtSigning: [{ name: "Sales tax", amount: 2551 }, { name: "Doc fee", amount: 299 }, { name: "Title & registration", amount: 380 }], miles: 34512, stockNumber: "P1234", cpo: true, checklist: ACKS, expiresAt: "2026-09-30T00:00:00Z", notes: null, ...over });
const fin = (over: Partial<UsedFinanceQuote> = {}): UsedFinanceQuote => ({ ...cash(), kind: "finance", downPayment: 3000, tradeEquity: null, amountFinanced: 35500 + 3230, apr: 6.49, termMonths: 60, monthlyPaymentPreTax: financeMonthly(38730, 6.49, 60)!, monthlyPaymentWithEstTax: null, creditAssumption: "good", counter: { counterOffer: false, note: "" }, ...over } as UsedFinanceQuote);

describe("used quote types — Finance / Cash only; structured, itemized, checklist-gated", () => {
  it("parses prefs strictly: cash needs a ZIP; finance needs a real term, a down ≥ 0 and a ZIP; lease is never a used type", () => {
    assert.deepEqual(cashPrefs, { quoteType: "cash", cash: { zip: "07405", timeline: null } });
    assert.deepEqual(finPrefs, { quoteType: "finance", finance: { termMonths: 60, downPayment: 3000, creditBand: "good", zip: "07405", timeline: "asap" } });
    assert.equal(parseQuotePrefs({ quoteType: "lease", lease: {} }), null);
    assert.equal(parseQuotePrefs({ quoteType: "finance", finance: { termMonths: 61, downPayment: 0, zip: "07405" } }), null);
    assert.equal(parseQuotePrefs({ quoteType: "cash", cash: { zip: "" } }), null);
  });
  it("amortized payment: $38,730 at 6.49% for 60 → $757.62; 0% is straight division", () => {
    assert.equal(financeMonthly(38730, 6.49, 60), 757.62);
    assert.equal(financeMonthly(36000, 0, 60), 600);
    assert.equal(financeMonthly(0, 5, 60), null);
  });
  it("a complete cash quote passes; OTD = selling price + itemized fees", () => {
    assert.deepEqual(validateUsedQuote(cash(), cashPrefs, ITEMS, { vin: "V" }, NOW).errors, []);
    assert.equal(cashOutTheDoor(cash()), 41730);
  });
  it("blocks: lump fees, missing/past expiry, bad amounts, unanswered checklist, monthly-only finance", () => {
    const lump = validateUsedQuote(cash({ dueAtSigning: [{ name: "Fees", amount: 3230 }] }), cashPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(lump.errors.some((e) => /single unlabeled lump/.test(e)));
    const past = validateUsedQuote(cash({ expiresAt: "2026-09-01T00:00:00Z" }), cashPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(past.errors.some((e) => /must be in the future/.test(e)));
    const noAck = validateUsedQuote(cash({ checklist: [] }), cashPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(noAck.errors.some((e) => /Confirm "Under 40,000 miles"/.test(e)));
    const bad = validateUsedQuote(cash({ sellingPrice: 0, miles: -1 }), cashPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(bad.errors.some((e) => /Selling price/.test(e)) && bad.errors.some((e) => /Miles on the car/.test(e)));
    const monthlyOnly = validateUsedQuote({ kind: "finance", monthlyPaymentPreTax: 650, expiresAt: "2026-09-30T00:00:00Z", checklist: ACKS } as Partial<UsedFinanceQuote>, finPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(monthlyOnly.errors.some((e) => /Amount financed/.test(e)) && monthlyOnly.errors.some((e) => /Selling price/.test(e)));
    const wrongKind = validateUsedQuote(cash(), finPrefs, ITEMS, { vin: "V" }, NOW);
    assert.ok(wrongKind.errors.some((e) => /asked for a finance quote/.test(e)));
  });
  it("finance: counter required when term or down differ from the buyer's prefs; allowed with a note", () => {
    assert.deepEqual(validateUsedQuote(fin(), finPrefs, ITEMS, { vin: "V" }, NOW).errors, []);
    const longer = fin({ termMonths: 72 });
    assert.equal(isFinanceCounter(longer, finPrefs.quoteType === "finance" ? finPrefs.finance : (null as never)), true);
    assert.ok(validateUsedQuote(longer, finPrefs, ITEMS, { vin: "V" }, NOW).errors.some((e) => /mark it as a counter-offer/.test(e)));
    assert.deepEqual(validateUsedQuote(fin({ termMonths: 72, counter: { counterOffer: true, note: "72 keeps the payment under $700" } }), finPrefs, ITEMS, { vin: "V" }, NOW).errors, []);
  });
});

import fs from "node:fs";
import path from "node:path";

describe("wiring — used = Finance | Cash; dealer sheets; compare column sets; new lease path untouched", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("Step 2: the lease tile is disabled for used ('CPO lease — coming soon'); the gate never passes lease on a used car; quotePrefs ride the payload", () => {
    const w = read("components/BiddingWizard.tsx");
    assert.match(w, /const off = id === "lease" && isUsed;/);
    assert.match(w, /\{off \? USED_LEASE_COMING_SOON : DEAL_STRUCTURE_LABELS\[id\]\}/);
    assert.match(w, /quoteType === "lease"\s*\? Boolean\(!isUsed && leaseTerm && leaseMiles && zipOk\)/);
    assert.match(w, /isUsed && quoteType === "finance"\s*\? \(\{ quoteType: "finance", finance: \{ termMonths: financeTerm \|\| 60, downPayment/);
    assert.match(w, /isUsed && quoteType === "cash"\s*\? \(\{ quoteType: "cash", cash: \{ zip/);
  });
  it("create route refuses a used lease and requires Finance / Cash prefs on a used car", () => {
    const r = read("app/api/rfqs/route.ts");
    assert.match(r, /Used cars quote as Finance or Cash — a used lease isn't offered yet\./);
    assert.match(r, /if \(used && !parseQuotePrefs\(body\.quotePrefs\)\)/);
  });
  it("dealer page routes used asks to the Finance / Cash sheet; the sheet gates on the checklist and computes the monthly", () => {
    assert.match(read("app/quote-request/received/page.tsx"), /ctx\.quotePrefs \? \([\s\S]*?<UsedQuoteForm/);
    const f = read("components/UsedQuoteForm.tsx");
    assert.match(f, /validateUsedQuote\(quote, prefs, mustConfirm/);
    assert.match(f, /financeMonthly\(amountFinanced, apr, term\)/);
    assert.match(f, /data-testid="checklist-acks"/);
    assert.doesNotMatch(f, /monthlyPaymentPreTax: num\(f\./, "no typed monthly");
    const route = read("app/api/quote-invite/used-quote/route.ts");
    assert.match(route, /validateUsedQuote\(quote, rfq\.quotePrefs, items/);
    assert.match(route, /parseMustConfirmAcks\(raw\.checklist, items\)/);
  });
  it("deal page: used deals use UsedCompare (Finance / Cash columns), never the lease grid; the lease calculator is untouched", () => {
    const page = read("app/rfq/[id]/page.tsx");
    assert.match(page, /\{rfq\.quotePrefs && \([\s\S]*?<UsedCompare rfq=\{rfq\} prefs=\{rfq\.quotePrefs\}/);
    assert.match(page, /\{rfq\.leasePrefs && \(\s*<div className="space-y-3">\s*<h2[^>]*>Compare lease quotes/);
    const c = read("components/UsedCompare.tsx");
    assert.doesNotMatch(c, /moneyFactor|residual/i);
    assert.match(c, />Out the door</);
    assert.match(c, />Amount financed</);
    assert.match(read("lib/rfqTracker.ts"), /quotePrefs\?\.quoteType === "finance"\) return "Finance"/);
  });
});
