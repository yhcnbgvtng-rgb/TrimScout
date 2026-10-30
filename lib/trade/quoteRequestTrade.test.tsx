// "Do you have a trade-in?" at the end of Configure Quote Request: the payoff stays private unless the buyer shares it,
// dealers see a summary without it, the dealer email says "Trade-in included" and nothing else, and the wizard asks the question.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coerceTradeIn } from "./coerce";
import { parseTradeFields } from "./validate";
import { redactDealerTradePayload, redactAppraisalForDealer, redactConfirmationForDealer, redactTradeForDealer } from "./dealerView";
import { isSafeMake, isSafeYear, parseVpicModels, TRADE_MAKES } from "./vehicleChoices";
import { TradeSummary } from "../../components/trade/TradeSummary";
import { quoteInviteHtml } from "../quoteInviteEmail";
import type { DealerTradeAppraisal } from "./types";

const financed = (over: Record<string, unknown> = {}) => ({
  vin: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", trim: "EX", decodedFromVin: true, mileage: 120000, zip: "07981",
  conditionBand: "good", titleStatus: "clean", ownership: "financed", lenderName: "Chase Auto", payoffEstimate: 18500, keys: "2+", historyFlag: "no", odometerConfirmed: true, ...over,
});
const record = (over: Record<string, unknown> = {}) => coerceTradeIn({ ...financed(), photos: [], ...over })!;

describe("share-payoff flag", () => {
  it("defaults to off, and only a financed/leased trade can turn it on", () => {
    const off = parseTradeFields(financed());
    assert.ok(off.ok && off.fields.sharePayoff === false);
    const on = parseTradeFields(financed({ sharePayoff: true }));
    assert.ok(on.ok && on.fields.sharePayoff === true);
    const owned = parseTradeFields(financed({ ownership: "owned", sharePayoff: true }));
    assert.ok(owned.ok && owned.fields.sharePayoff === false);
  });
  it("older records without the flag read as not shared", () => assert.equal(record().sharePayoff, false));
});

describe("what a dealer gets of the trade", () => {
  const appraisal = { allowanceSingle: 12000, allowanceLow: null, allowanceHigh: null, basis: "firm", payoffUsed: 18500, equityComputed: -6500 } as unknown as DealerTradeAppraisal;

  it("hides payoff amount and lender unless the buyer shared them, and keeps everything else", () => {
    const t = redactTradeForDealer(record());
    assert.equal(t.payoffEstimate, 0);
    assert.equal(t.lenderName, null);
    assert.equal(t.ownership, "financed", "dealer still learns there is a payoff");
    assert.equal(t.mileage, 120000);
    assert.equal(t.conditionBand, "good");
    assert.equal(JSON.stringify(t).includes("18500"), false);
    assert.equal(JSON.stringify(t).includes("Chase"), false);
  });
  it("passes the record through untouched when the buyer shared", () => {
    const shared = record({ sharePayoff: true });
    assert.equal(redactTradeForDealer(shared), shared);
    assert.equal(redactTradeForDealer(shared).payoffEstimate, 18500);
  });
  it("also hides the payoff inside the dealer's own appraisal and confirmation (equity = allowance - payoff)", () => {
    const a = redactAppraisalForDealer(appraisal, record());
    assert.equal(a.payoffUsed, 0);
    assert.equal(a.equityComputed, 0);
    assert.equal(a.allowanceSingle, 12000);
    assert.equal(redactAppraisalForDealer(appraisal, record({ sharePayoff: true })).payoffUsed, 18500);
    assert.equal(redactAppraisalForDealer(null, record()), null);
    assert.equal(redactConfirmationForDealer({ payoffUsed: 18500 } as unknown as import("./confirm").TradeConfirmation, record()).payoffUsed, 0);
  });
  it("redactDealerTradePayload covers the record, appraisal and confirmation in one body", () => {
    const body = redactDealerTradePayload({ tradeIn: record(), appraisal: appraisal as DealerTradeAppraisal, confirmation: { payoffUsed: 18500 } as unknown as import("./confirm").TradeConfirmation, signed: [1] }, record());
    assert.equal(body.tradeIn.payoffEstimate, 0);
    assert.equal(body.appraisal!.payoffUsed, 0);
    assert.equal(body.confirmation!.payoffUsed, 0);
    assert.deepEqual(body.signed, [1]);
  });
  it("the quote-invite trade route redacts before it responds", () => {
    const src = fs.readFileSync(new URL("../../app/api/quote-invite/trade/route.ts", import.meta.url), "utf8");
    assert.match(src, /NextResponse\.json\(redactDealerTradePayload\(\{\s*tradeIn: rfq\.tradeIn!, signed,/);
    assert.match(src, /\}, rfq\.tradeIn!\)\);/);
    assert.match(src, /payoffShared\(rfq\.tradeIn\) \? \{ equityComputed/);
  });
});

describe("TradeSummary payoff row", () => {
  const html = (t: ReturnType<typeof record>, viewer?: "buyer" | "dealer") => renderToStaticMarkup(<TradeSummary trade={t} signed={[]} viewer={viewer} />);
  it("dealer sees 'Payoff: Yes' with no amount or lender when not shared", () => {
    const out = html(redactTradeForDealer(record()));
    assert.match(out, /Payoff<\/dt><dd[^>]*>Yes \(amount not shared\)/);
    assert.doesNotMatch(out, /18,500|Chase/);
  });
  it("dealer sees amount and lender when the buyer chose to share", () => {
    assert.match(html(record({ sharePayoff: true })), /Chase Auto · \$18,500/);
  });
  it("the buyer always sees their own payoff and whether it is shared", () => {
    assert.match(html(record(), "buyer"), /\$18,500.*not shared with dealers/);
    assert.match(html(record({ sharePayoff: true }), "buyer"), /shared with dealers/);
  });
  it("an owned car has no payoff row at all", () => assert.doesNotMatch(html(record({ ownership: "owned", payoffEstimate: 0 })), /Payoff/));
});

describe("dropdown choices", () => {
  it("offers common makes and guards the vPIC query values", () => {
    assert.ok(TRADE_MAKES.includes("Honda") && TRADE_MAKES.includes("Mercedes-Benz"));
    assert.ok(isSafeMake("Land Rover") && isSafeMake("Mercedes-Benz"));
    for (const bad of ["", "../x", "Honda/../../a", "a?b=c", "x".repeat(41), 5]) assert.ok(!isSafeMake(bad), String(bad));
    assert.ok(isSafeYear(2018) && !isSafeYear(1950) && !isSafeYear(2018.5) && !isSafeYear(NaN));
  });
  it("turns a vPIC response into a sorted, de-duplicated model list and shrugs off junk", () => {
    const body = { Results: [{ Model_Name: "Pilot" }, { Model_Name: "Accord" }, { Model_Name: "Accord" }, { Model_Name: "  " }, { Model_Name: 7 }, null] };
    assert.deepEqual(parseVpicModels(body), ["Accord", "Pilot"]);
    for (const junk of [null, {}, { Results: "x" }, "x"]) assert.deepEqual(parseVpicModels(junk), []);
  });
});

describe("dealer email wording", () => {
  const base = { quoteType: "cash", dealerName: "Route 22 Toyota", contactName: "Sam", role: "sales", rooftop: { city: null, state: "NJ", address: null }, vehicle: { vin: "", vdpUrl: null }, dealReference: "TQ-ABC123", viewUrl: "https://x/view?t=1", unsubscribeUrl: null, purchaseTimelineLabel: null, buyerZip: "07981", leasePrefs: null, financePrefs: null, buyerNote: null, tradeInExpected: true, tradeInIncluded: true } as unknown as Parameters<typeof quoteInviteHtml>[0];
  it("says 'Trade-in included' and never leaks payoff, contact details, or the word bid", () => {
    const html = quoteInviteHtml(base);
    assert.match(html, />Trade-in<\/td><td[^>]*>Trade-in included/);
    assert.doesNotMatch(html.replace(/not an auction, not a bid/g, "").replace(/not a bid/g, ""), /\bbid\b|payoff|lender|@|\$\d/i);
  });
});

describe("wizard question", () => {
  const src = fs.readFileSync(new URL("../../components/BiddingWizard.tsx", import.meta.url), "utf8");
  it("asks 'Do you have a trade-in?' with Yes and Skip as the last thing in step 3, ahead of Review & Send", () => {
    const q = src.indexOf('title="Do you have a trade-in?"');
    assert.ok(q > src.indexOf('title="Note to the dealer"'), "after the dealer note");
    assert.ok(q < src.indexOf("{/* STEP 4: REVIEW & BROADCAST"), "before step 4");
    assert.match(src, /data-testid=\{id\}/);
    assert.match(src, /\["trade-yes"|"trade-yes"/);
    assert.match(src, /"trade-skip"/);
  });
  it("Yes opens the existing TradeInStep form (no new form), Skip clears it, and Continue waits for a complete trade", () => {
    assert.match(src, /\{tradeInExpected \? \(\s*<div className="mt-4">\s*<TradeInStep enabled hideToggle/);
    assert.match(src, /if \(!val\) setTradeAttempted\(false\)/);
    assert.match(src, /if \(step === 3 && tradeInExpected && !tradeStep\.ready\) \{ setTradeAttempted\(true\); return; \}/);
  });
  it("uses quote request wording, not bid", () => {
    const section = src.slice(src.indexOf('title="Do you have a trade-in?"'), src.indexOf("{/* STEP 4: REVIEW & BROADCAST"));
    assert.doesNotMatch(section, /\bbid/i);
  });
});
