// The deals box runs a plain-JS copy of the state trade tax credit (scrapers/lightsail-crawler/src/stateTradeCredit.js) and the staged-deal
// true OTD built on it (dealStages.js stagedTrueOtd). These tests fail if either drifts from the website's one calculation
// (lib/trade/stateTradeCredit.ts tradeTaxCredit + lib/trade/trueOtd.ts trueOtdBreakdown), state by state and number by number.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATE_TRADE_CREDIT } from "./stateTradeCredit";
import { tradeTaxCredit } from "./stateTradeCredit";
import { trueOtdBreakdown } from "./trueOtd";
import { quotedEquityOf } from "./trueOtd";
// Plain JS modules shared with the deals box.
import { STATE_TRADE_CREDIT as BOX_TABLE, tradeTaxSaving, quotedTaxOf as boxQuotedTaxOf } from "../../scrapers/lightsail-crawler/src/stateTradeCredit.js";
import { stagedTrueOtd, taxInputsOf, TRADE_TAX_CREDIT_STATES } from "../../scrapers/lightsail-crawler/src/dealStages.js";
const BOX: Record<string, any> = BOX_TABLE;
import { quotedTaxOf } from "./stateTradeCredit";
import { cashOutTheDoor } from "../usedQuote";
import { quoteIsNew } from "../salesTax";

// One ZIP per state the tests use (the website derives the state from the ZIP; the box is handed the state).
const ZIP: Record<string, string> = { NJ: "07030", TX: "75201", MI: "48201", OH: "43215", SC: "29401", CA: "90001", FL: "33101", VA: "23219", MA: "02108", NY: "10001" };

describe("box state trade credit = website", () => {
  it("has the same rule, cap and flat-rate fee for all 51 jurisdictions", () => {
    assert.deepEqual(Object.keys(BOX).sort(), Object.keys(STATE_TRADE_CREDIT).sort());
    for (const st of Object.keys(STATE_TRADE_CREDIT)) {
      const web = STATE_TRADE_CREDIT[st];
      assert.equal(BOX[st].rule, web.rule, st);
      assert.equal(BOX[st].flatRate, web.flatRate, st);
      assert.equal(BOX[st].maxTax, web.maxTax, st);
      for (const year of [2025, 2026, 2027, 2030, 2034]) assert.equal(BOX[st].cap ? BOX[st].cap(year) : undefined, web.cap ? web.cap(year) : undefined, `${st} ${year}`);
    }
  });

  it("the derived credit-state list is exactly the states the website credits", () => {
    const web = Object.keys(STATE_TRADE_CREDIT).filter((s) => ["full", "capped", "new_only"].includes(STATE_TRADE_CREDIT[s].rule)).sort();
    assert.deepEqual([...TRADE_TAX_CREDIT_STATES].sort(), web);
  });

  const quotes = [
    { kind: "cash", sellingPrice: 40000, addOns: [], rebates: [], dueAtSigning: [{ name: "Sales tax", amount: 2650 }, { name: "Doc fee", amount: 799 }] },
    { kind: "cash", sellingPrice: 52000, addOns: [{ name: "Tint", amount: 500 }], rebates: [{ name: "Rebate", amount: 1000 }], dueAtSigning: [{ name: "Sales tax", amount: 3478.12 }, { name: "Luxury tax", amount: 208 }, { name: "Title & registration", amount: 320 }] },
    { kind: "cash", sellingPrice: 28900, miles: 31000, addOns: [], rebates: [], dueAtSigning: [{ name: "State sales tax", amount: 1914.62 }, { name: "Doc fee", amount: 400 }] },
  ];

  it("gives the same tax saving and the same true OTD as the website for every state, quote, trade value and payoff", () => {
    let checked = 0;
    for (const st of Object.keys(ZIP)) for (const q of quotes) for (const value of [3000, 9000, 15000, 80000]) for (const payoff of [0, 4000]) {
      const used: any = q;
      const otd = cashOutTheDoor(used);
      const eq = quotedEquityOf({ low: value, high: value, mid: value, isRange: false }, payoff);
      const credit = tradeTaxCredit({ zip: ZIP[st], allowance: { low: value, mid: value, high: value }, sellingPrice: used.sellingPrice, addOns: used.addOns, quotedTax: quotedTaxOf(used.dueAtSigning), isNew: quoteIsNew(used) });
      const web = trueOtdBreakdown({ originalOtd: otd, eq, taxCredit: credit });
      const box = stagedTrueOtd({ otd, tradeValue: value, payoff, tax: taxInputsOf(used, st) });
      assert.equal(box.trueOtd, web.trueOtd.mid, `${st} price ${used.sellingPrice} trade ${value} payoff ${payoff}`);
      assert.equal(box.taxSavings, web.taxSaving ? web.taxSaving.mid : null, `${st} saving`);
      assert.equal(boxQuotedTaxOf(used.dueAtSigning), quotedTaxOf(used.dueAtSigning));
      checked++;
    }
    assert.equal(checked, 10 * 3 * 4 * 2);
  });

  it("matches tradeTaxCredit directly, including the unconfirmed and no-credit statuses", () => {
    for (const st of ["AK", "OK", "CA", "VA", "OH", "MI", "SC", "NJ"]) {
      const used: any = quotes[0];
      const input = { allowance: { low: 9000, mid: 9000, high: 9000 }, sellingPrice: 40000, addOns: [], quotedTax: 2650, isNew: true };
      const web = tradeTaxCredit({ ...input, zip: ({ ...ZIP, AK: "99501", OK: "73101" } as Record<string, string>)[st] });
      const box = tradeTaxSaving({ ...input, state: st });
      assert.equal(box.status, web.status, st);
      assert.equal(box.mid, web.mid, st);
      void used;
    }
  });
});
