import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COUNTER_COPY, buildCounterFromEdits, counterSummary, parseBuyerCounter, parseCounterEdits } from "./buyerCounter";
import { analyzeLeaseQuotes } from "./leaseCompare";
import type { LeaseQuote } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

const NOW = new Date("2026-09-13T12:00:00Z");
const PREFS = { termMonths: 36 as const, milesPerYear: 10000 as const, zip: "07405", timeline: null };
const quote: LeaseQuote = {
  capCost: 66000, residualPercent: 55, residualAmount: 39391, moneyFactor: 0.0019, termMonths: 36, milesPerYear: 10000, capReduction: 0,
  monthlyPaymentPreTax: 939, monthlyPaymentWithEstTax: 1001, dueAtSigning: { firstMonth: 1001, acquisitionFee: 695, capReduction: 0, taxes: 0, otherFees: [{ name: "Doc fee", amount: 299 }] },
  incentives: [{ name: "Lease cash / rebate", amount: 1500 }], addOns: [], expiresAt: "2026-09-30T00:00:00Z", notes: null, counter: { counterOffer: false, note: "" },
};

describe("buyer counter — the dealer's own sheet with price-side edits, a request not a bid", () => {
  it("parseCounterEdits keeps numbers and named lines only, per kind; buildCounterFromEdits re-applies them to the quote on file", () => {
    const raw = { againstQuoteId: "q1", note: "  Loyalty applies. ", edits: { capCost: "$64,500", capReduction: 1000, incentives: [{ name: "Lease cash / rebate", amount: 1500 }, { name: "Loyalty", amount: "750" }, { name: "", amount: 5 }], otherFees: [{ name: "Doc fee", amount: 199 }], moneyFactor: 0.001, termMonths: 24 } };
    const p = parseCounterEdits(raw, "lease")!;
    assert.deepEqual(p, { againstQuoteId: "q1", note: "Loyalty applies.", edits: { capCost: 64500, capReduction: 1000, incentives: [{ name: "Lease cash / rebate", amount: 1500 }, { name: "Loyalty", amount: 750 }], otherFees: [{ name: "Doc fee", amount: 199 }] } }, "money factor / term in the payload are ignored — they're not edits");
    const built = buildCounterFromEdits({ lease: quote }, p, NOW);
    assert.ok(built.counter);
    const sheet = built.counter!.sheet!;
    assert.equal(sheet.kind, "lease");
    assert.equal((sheet.after as LeaseQuote).capCost, 64500 - 750, "the added incentive lowers the cap by its amount");
    assert.equal((sheet.after as LeaseQuote).moneyFactor, quote.moneyFactor);
    assert.equal((sheet.after as LeaseQuote).termMonths, 36);
    assert.ok((sheet.after as LeaseQuote).monthlyPaymentPreTax < quote.monthlyPaymentPreTax);
    assert.deepEqual(sheet.changed.sort(), ["capCost", "capReduction", "fee:Doc fee", "incentive:Loyalty"]);
    assert.equal(built.counter!.againstQuoteId, "q1");
    assert.equal(built.counter!.note, "Loyalty applies.");
    assert.match(counterSummary(built.counter!), /Cap cost −\$2,250 · Loyalty −\$750 · Cap reduction \+\$1,000 · Doc fee −\$100 → \$/);
  });
  it("refuses a counter that raises the price, moves a locked line, or changes nothing", () => {
    assert.match(buildCounterFromEdits({ lease: quote }, { againstQuoteId: "q1", edits: { capCost: 70000 } }).errors.join(" "), /can lower this, not raise it/);
    assert.match(buildCounterFromEdits({ lease: quote }, { againstQuoteId: "q1", edits: {} }).errors.join(" "), /Change at least one number/);
    assert.equal(parseCounterEdits({ edits: { capCost: 1 } }, "lease"), null, "no quote id → nothing");
    assert.equal(parseCounterEdits("junk", "cash"), null);
    assert.equal(buildCounterFromEdits({}, { againstQuoteId: "q1", edits: { sellingPrice: 1 } }).counter, null);
  });
  it("legacy counters (target monthly asks) still parse and summarise; copy never says bid or auction", () => {
    const legacy = parseBuyerCounter({ againstQuoteId: "q1", targetMonthlyMax: 875, note: "x" })!;
    assert.equal(counterSummary(legacy), "≤ $875/mo");
    assert.equal(parseBuyerCounter({ againstQuoteId: "q1" }), null);
    assert.match(COUNTER_COPY, /request, not a binding bid/);
  });
  it("compare: a countered desk shows its last numbers greyed as 'Buyer countered'; a revised quote is a live row badged Revised", () => {
    const base = (over: Partial<RfqInvite>): RfqInvite => ({ id: "1", dealerName: "Desk", dealerContactEmail: null, status: "invited", declineReason: null, invitedAt: "2026-09-13T00:00:00Z", respondedAt: null, quote: null, ...over });
    const priorQuote = { id: "q1", price: 939, fees: [], totalOtdPrice: 0, vin: "V", stockNumber: null, expiresAt: quote.expiresAt, submittedAt: "2026-09-13T01:00:00Z", mustHaveAcknowledgement: true, notes: null, lease: quote, supersededAt: "2026-09-13T02:00:00Z" } as unknown as NonNullable<RfqInvite["quote"]>;
    const rfq = (invites: RfqInvite[]): RfqRequest => ({ id: "1", buyerUserId: "b", invites, status: "collecting", pickedQuoteId: null, createdAt: "2026-09-13T00:00:00Z", vin: "V", stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", mustHaves: [], leasePrefs: PREFS });
    const counter = { againstQuoteId: "q1", targetMonthlyMax: 875, maxCashDueAtSigning: null, termMonths: null, milesPerYear: null, note: null, sentAt: NOW.toISOString() };

    const pending = analyzeLeaseQuotes(rfq([base({ buyerCounter: counter, priorQuotes: [priorQuote] })]), NOW)!;
    assert.equal(pending.rows[0].kind, "countered");
    assert.equal(pending.rows[0].monthly, 939, "last numbers stay visible");
    assert.deepEqual(pending.rows[0].chips, ["You countered — waiting on a revised quote"]);
    assert.equal(pending.glance.lowestMonthly, null, "a countered (superseded) quote is not eligible");
    assert.match(pending.glance.noEligible!, /You countered a quote — revised numbers appear here/);

    const revisedLease = { ...quote, monthlyPaymentPreTax: 880 };
    const revised = analyzeLeaseQuotes(rfq([base({ status: "quoted", buyerCounter: counter, priorQuotes: [priorQuote], quote: { ...priorQuote, id: "q2", lease: revisedLease, supersededAt: null } })]), NOW)!;
    assert.equal(revised.rows[0].kind, "eligible");
    assert.equal(revised.rows[0].revised, true);
    assert.equal(revised.rows[0].chips[0], "Revised after your counter (v2)");
    assert.equal(revised.glance.lowestMonthly?.amount, 880);
  });

  it("wiring: box stores the counter and supersedes the quote; buyer route is owner-only and emails the desk; dealer page prefills and can decline; compare has Counter per live row", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    const box = read("scrapers/lightsail-crawler/src/deals_api_server.js");
    assert.match(box, /ADD COLUMN IF NOT EXISTS buyer_counter_json TEXT NULL/);
    assert.match(box, /ADD COLUMN IF NOT EXISTS superseded_at DATETIME NULL/);
    assert.match(box, /UPDATE rfq_quotes SET superseded_at = NOW\(\) WHERE invite_id = \? AND superseded_at IS NULL/);
    assert.match(box, /SET status = 'invited', responded_at = NULL, buyer_counter_json = \?, buyer_counter_at = NOW\(\)/);
    assert.match(read("scripts/box/2026-09-13-buyer-counter.sh"), /"counter handler"/);
    const route = read("app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts");
    assert.match(route, /rfq\.buyerUserId !== session\.user\.id/);
    assert.match(route, /invite\.quote\.id !== payload\.againstQuoteId/);
    assert.match(route, /buildCounterFromEdits\(invite\.quote, payload\)/, "the sheet is rebuilt server-side from the quote on file");
    assert.match(route, /buyerCounterHtml\(input\)/);
    assert.match(route, /rows: counter\.sheet \? counterDiff\(counter\.sheet\)/, "the dealer's email carries the line-by-line comparison");
    assert.doesNotMatch(route, /Counters are for lease quotes/, "cash and finance quotes can be countered too");
    const dealer = read("app/quote-request/received/page.tsx");
    assert.match(dealer, /data-testid="buyer-counter-panel"/);
    assert.match(dealer, /initial=\{ctx\.priorLease\}/);
    assert.match(dealer, /initial=\{ctx\.priorUsed \|\| null\}/, "the cash/finance sheet prefills from the prior quote too");
    assert.match(dealer, /<CounterComparison sheet=\{ctx\.buyerCounter\.sheet\} beforeLabel="You quoted" afterLabel="Buyer's counter" \/>/);
    assert.match(dealer, /prefs=\{ctx\.leasePrefs\}/, "terms never change in a counter — the calculator keeps the buyer's locks");
    assert.match(dealer, /\/api\/quote-invite\/decline/);
    const compare = read("components/LeaseCompare.tsx");
    assert.match(compare, /data-testid="counter-quote"/);
    assert.match(compare, /<CounterSheetForm/);
    assert.match(compare, />Buyer countered</);
    assert.match(compare, />Revised</);
    const used = read("components/UsedCompare.tsx");
    assert.match(used, /data-testid="counter-quote"/);
    assert.match(used, /<CounterSheetForm dealerName=\{invite\.dealerName\} quote=\{\{ used \}\}/);
    assert.match(read("app/rfq/[id]/page.tsx"), /router\.push\(`\/rfq\/\$\{rfqId\}\/counter\/\$\{inviteId\}`\)/, "after sending, the buyer lands on the before/after page");
    assert.match(read("app/rfq/[id]/counter/[inviteId]/page.tsx"), /data-testid="counter-review"/);
    for (const f of ["components/CounterSheetForm.tsx", "components/CounterComparison.tsx", "components/LeaseCompare.tsx", "components/UsedCompare.tsx", "lib/quoteInviteEmail.ts", "lib/counterSheet.ts", "app/quote-request/received/page.tsx", "app/rfq/[id]/counter/[inviteId]/page.tsx"]) {
      assert.doesNotMatch(read(f).replace(/not an auction, not a bid|not a binding bid|not a bid/g, ""), /auction|bid[- ]out|bid war|\bbids?\b/i, f);
    }
  });
});

describe("every add-on, fee and rebate is shown by name — never a bare total", () => {
  it("compare tables list each line; nothing hides behind a collapsed total", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    const used = read("components/UsedCompare.tsx");
    assert.doesNotMatch(used, /<details>/, "no collapsed totals on the cash/finance compare");
    assert.match(used, /data-testid="itemized-lines"/);
    // Lease compare (locked 9 columns): the primary row carries a one-line summary
    // ("1 add-on +$899 · 1 incentive") under Due at signing; every line is named in
    // the expanded detail, with the masked contact email there and nowhere else.
    const lease = read("components/LeaseCompare.tsx");
    assert.match(lease, /<th className="px-4 py-3">Dealer<\/th>|Dealer<\/th>/);
    assert.doesNotMatch(lease, /Add-ons \/ incentives<\/th>/, "no mid-table add-ons column");
    assert.match(lease, /data-testid="lines-summary"/);
    assert.match(lease, /data-testid="money-note"/, "deltas sit under the money columns, not in the dealer cell");
    assert.doesNotMatch(lease, /r\.chips\.map\(\(c\) => \(\s*<span key=\{c\} className="rounded bg-border/, "no comparison badges in the dealer cell");
    assert.match(lease, /Quoted by <span className="text-ink-light">/, "masked email only in the expand detail");
    const headers = lease.match(/<th className="[^"]*px-4 py-3[^"]*">([^<]+)<\/th>/g)!.map((h) => h.replace(/<[^>]+>/g, ""));
    assert.deepEqual(headers, ["Dealer", "Monthly", "Due at signing", "Cap cost", "MF (APR)", "Residual %", "Term / miles", "Expires", "Status"]);
    const form = read("components/CounterSheetForm.tsx");
    assert.doesNotMatch(form, /truncate text-\[11px\]/, "line names wrap, never truncate, on the counter sheet");
  });
});
