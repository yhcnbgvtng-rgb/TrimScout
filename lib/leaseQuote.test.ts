import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aprFromMoneyFactor, coerceLeaseQuote, dueAtSigningTotal, isCounter, isExpired, validateLeaseQuote, type LeaseQuote } from "./leaseQuote";

const NOW = new Date("2026-09-13T12:00:00Z");
const PREFS = { termMonths: 36 as const, milesPerYear: 10000 as const };
const good = (): LeaseQuote => ({
  capCost: 52000,
  residualPercent: 58,
  residualAmount: 30160,
  moneyFactor: 0.00225,
  termMonths: 36,
  milesPerYear: 10000,
  capReduction: 0,
  monthlyPaymentPreTax: 612,
  monthlyPaymentWithEstTax: 652.5,
  dueAtSigning: { firstMonth: 652.5, acquisitionFee: 0, capReduction: 0, taxes: 120, otherFees: [{ name: "Doc fee", amount: 299 }] },
  incentives: [{ name: "Loyalty", amount: 1000 }],
  addOns: [],
  expiresAt: "2026-09-20T00:00:00Z",
  notes: null,
  counter: { counterOffer: false, note: "" },
});

describe("validateLeaseQuote — a complete quote passes", () => {
  it("accepts the full calculator with no errors", () => {
    const v = validateLeaseQuote(good(), PREFS, { vin: "1FMEE9BP9TLA88678" }, NOW);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
  });
  it("derives APR from the money factor and totals due-at-signing", () => {
    assert.equal(aprFromMoneyFactor(0.00225), 5.4);
    assert.equal(dueAtSigningTotal(good().dueAtSigning), 1071.5);
  });
});

describe("validateLeaseQuote — blocks (acceptance 4)", () => {
  it("rejects a monthly-only reply: no cap cost, no MF, no residual", () => {
    const v = validateLeaseQuote({ monthlyPaymentPreTax: 599, termMonths: 36, milesPerYear: 10000, expiresAt: "2026-09-20T00:00:00Z" }, PREFS, { vin: "X" }, NOW);
    assert.ok(v.errors.some((e) => /Cap cost/.test(e)));
    assert.ok(v.errors.some((e) => /Money factor/.test(e)));
    assert.ok(v.errors.some((e) => /Residual %/.test(e)));
    assert.ok(v.errors.some((e) => /Due at signing must be itemized/.test(e)));
  });
  it("rejects a single unlabeled due-at-signing lump", () => {
    const q = good();
    q.dueAtSigning = { firstMonth: 0, acquisitionFee: 0, capReduction: 0, taxes: 0, otherFees: [{ name: "Due at signing", amount: 2500 }] };
    const v = validateLeaseQuote(q, PREFS, { vin: "X" }, NOW);
    assert.ok(v.errors.some((e) => /single unlabeled lump/.test(e)));
  });
  it("requires VIN or stock, positive cap cost, residual in (0,100], MF > 0, monthly > 0", () => {
    const q = { ...good(), capCost: 0, residualPercent: 101, moneyFactor: 0, monthlyPaymentPreTax: -1 };
    const v = validateLeaseQuote(q, PREFS, {}, NOW);
    for (const re of [/VIN or stock/, /Cap cost/, /Residual %/, /Money factor/, /Monthly payment \(pre-tax\)/]) assert.ok(v.errors.some((e) => re.test(e)), String(re));
  });
  it("requires a future expiry", () => {
    const v1 = validateLeaseQuote({ ...good(), expiresAt: "" }, PREFS, { vin: "X" }, NOW);
    assert.ok(v1.errors.some((e) => /expiry date is required/.test(e)));
    const v2 = validateLeaseQuote({ ...good(), expiresAt: "2026-09-01T00:00:00Z" }, PREFS, { vin: "X" }, NOW);
    assert.ok(v2.errors.some((e) => /must be in the future/.test(e)));
  });
});

describe("validateLeaseQuote — counters (acceptance 5)", () => {
  it("term/miles that differ from the buyer's prefs need counterOffer + a note", () => {
    const q = { ...good(), termMonths: 39 };
    const v = validateLeaseQuote(q, PREFS, { vin: "X" }, NOW);
    assert.ok(v.errors.some((e) => /mark it as a counter-offer/.test(e)));
    const v2 = validateLeaseQuote({ ...q, counter: { counterOffer: true, note: "" } }, PREFS, { vin: "X" }, NOW);
    assert.ok(v2.errors.some((e) => /needs a short note/.test(e)));
    const v3 = validateLeaseQuote({ ...q, counter: { counterOffer: true, note: "39 mo has a better residual this month" } }, PREFS, { vin: "X" }, NOW);
    assert.deepEqual(v3.errors, []);
    assert.equal(isCounter(q, PREFS), true);
    assert.equal(isCounter(good(), PREFS), false);
  });
});

describe("validateLeaseQuote — warns but allows", () => {
  it("extreme MF / residual, big due-at-signing, vague add-on names", () => {
    const q = { ...good(), moneyFactor: 0.009, residualPercent: 30, addOns: [{ name: "pkg", amount: 899 }] };
    q.dueAtSigning = { ...q.dueAtSigning, capReduction: 3000 };
    const v = validateLeaseQuote(q, PREFS, { vin: "X" }, NOW);
    assert.deepEqual(v.errors, []);
    assert.ok(v.warnings.some((w) => /unusually high/.test(w)));
    assert.ok(v.warnings.some((w) => /outside the usual 40–70%/.test(w)));
    assert.ok(v.warnings.some((w) => /more than twice the monthly/.test(w)));
    assert.ok(v.warnings.some((w) => /Add-ons without clear names/.test(w)));
  });
});

describe("coerceLeaseQuote / isExpired", () => {
  it("turns form strings into numbers and keeps the itemized structure", () => {
    const q = coerceLeaseQuote({ capCost: "$52,000", residualPercent: "58%", residualAmount: "30,160", moneyFactor: "0.00225", termMonths: "36", milesPerYear: "10000", capReduction: "0", monthlyPaymentPreTax: "612", monthlyPaymentWithEstTax: "", dueAtSigning: { firstMonth: "652.50", acquisitionFee: "0", capReduction: "0", taxes: "120", otherFees: [{ name: "Doc fee", amount: "299" }] }, expiresAt: "2026-09-20T00:00:00Z", counter: { counterOffer: "true", note: " ok " } });
    assert.equal(q.capCost, 52000);
    assert.equal(q.residualPercent, 58);
    assert.equal(q.monthlyPaymentWithEstTax, null);
    assert.equal(q.dueAtSigning?.otherFees[0].amount, 299);
    assert.equal(q.counter?.note, "ok");
    assert.deepEqual(validateLeaseQuote(q, PREFS, { vin: "X" }, NOW).errors, []);
  });
  it("flags an expired quote", () => {
    assert.equal(isExpired({ expiresAt: "2026-09-01T00:00:00Z" }, NOW), true);
    assert.equal(isExpired({ expiresAt: "2026-09-20T00:00:00Z" }, NOW), false);
  });
});

// ---------------------------------------------------------------------------
// Flow wiring (source-level): copy and contact rules across the lease flow.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

describe("lease flow — copy and contact rules", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const buyerFiles = ["components/BiddingWizard.tsx", "app/rfq/[id]/page.tsx", "components/LeaseCompareTable.tsx", "app/quote-request/received/page.tsx", "components/LeaseCalculatorForm.tsx", "lib/quoteInviteEmail.ts", "lib/leaseQuote.ts"];
  // Only JSX text / string literals matter to a reader; strip comments and identifiers-in-code.
  const visibleText = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/"(exact_auction|auction|firm_offer)"/g, "")
      .replace(/offerPath === "auction"|setOfferPath\("auction"\)|"direct" \| "auction"/g, "")
      .replace(/not an auction, not a bid|not a bid or an offer|A request, not a bid|request, not a bid/g, "");

  it("(6) no auction / bid / LIVE / lock-in language anywhere a buyer or dealer reads", () => {
    for (const f of buyerFiles) {
      const t = visibleText(read(f));
      assert.doesNotMatch(t, /\bauction\b|\bbid out\b|\bLIVE AUCTION\b|reverse-bid|reverse bid|lock-in|lock in\b|\bbids?\b/i, f);
    }
  });

  it("(7) no cleartext dealer email in the buyer compare — masked only — and no dealer-site price hero", () => {
    const compare = read("components/LeaseCompareTable.tsx");
    assert.match(compare, /emailMasked/);
    assert.doesNotMatch(compare, /dealerContactEmail|contactEmail\b/);
    const wizard = read("components/BiddingWizard.tsx");
    assert.doesNotMatch(wizard, /advertisedOrStickerPrice|shopperPriceSourceLabel|Advertised price/);
    assert.doesNotMatch(compare, /dealerPrice|msrp/i);
  });

  it("(1) invitees are the confirmed, unblocked named desks and nothing else; send requires ≥1", () => {
    const wizard = read("components/BiddingWizard.tsx");
    // The send list reads the desk-selection plan, whose rows are only ever
    // ticked when the desk has a named, unblocked contact.
    assert.match(wizard, /toSend = pastes\.filter\([\s\S]*?deskPlan\.rows\[p\.dealerName\]\?\.checked/);
    const plan = read("lib/deskSelection.ts");
    assert.match(plan, /const hasContact = Boolean\(d\.desk && !d\.desk\.blockedReason\)/);
    assert.match(plan, /const selectable = hasContact && !heldByState/);
    assert.match(plan, /const checked = selectable && wanted/);
    assert.match(wizard, /Tick at least one dealership with a named sales contact to send the request/);
  });

  it("dealer landing shows the calculator only for an open lease invite, with expired/closed/responded states", () => {
    const page = read("app/quote-request/received/page.tsx");
    for (const re of [/rfqStatus !== "collecting"/, /inviteStatus !== "invited"/, /!ctx\.leasePrefs/, /LeaseCalculatorForm/, /without sharing their email/]) assert.match(page, re);
    assert.doesNotMatch(page, /reply to the email you received/);
  });

  it("buyer waiting / empty states exist: no quotes yet, expired quote, no quote chosen", () => {
    const rfq = read("app/rfq/[id]/page.tsx");
    assert.match(rfq, /No lease quotes yet/);
    assert.match(rfq, /No quote chosen/);
    assert.match(rfq, /You chose this quote/);
    const compare = read("components/LeaseCompareTable.tsx");
    assert.match(compare, /This quote has expired/);
  });
});

describe("lease terms — 18 and 24 both offered, default stays 36", () => {
  it("the term set is 18 | 24 | 36 | 39 | 48 with 36 as the default", async () => {
    const { LEASE_TERMS, DEFAULT_LEASE_TERM } = await import("./leaseQuote");
    assert.deepEqual([...LEASE_TERMS], [18, 24, 36, 39, 48]);
    assert.equal(DEFAULT_LEASE_TERM, 36);
    const { LEASE_TERM_MONTHS } = await import("./dealStructure");
    assert.deepEqual([...LEASE_TERM_MONTHS], [18, 24, 36, 39, 48], "the deal-term clamp must not round an 18 away");
  });

  it("an 18-month request is quoted at 18 with no counter; a 24 against it is a counter", () => {
    const prefs18 = { termMonths: 18 as const, milesPerYear: 10000 as const };
    const at18 = { ...good(), termMonths: 18 };
    assert.deepEqual(validateLeaseQuote(at18, prefs18, { vin: "X" }, NOW).errors, []);
    assert.equal(isCounter(at18, prefs18), false);
    const at24 = { ...good(), termMonths: 24 };
    assert.ok(validateLeaseQuote(at24, prefs18, { vin: "X" }, NOW).errors.some((e) => /counter-offer/.test(e)));
    assert.equal(isCounter(at24, prefs18), true);
  });

  it("the request route accepts 18 as a lease term and still rejects terms outside the set", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/api/rfqs/route.ts"), "utf8");
    assert.match(src, /LEASE_TERMS as readonly number\[\]\)\.includes\(term\)/);
    const wizard = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
    assert.match(wizard, /LEASE_TERMS\.map\(\(t\) =>/);
    const calc = fs.readFileSync(path.join(process.cwd(), "components/LeaseCalculatorForm.tsx"), "utf8");
    assert.match(calc, /LEASE_TERMS\.map\(\(t\) =>/);
  });
});
