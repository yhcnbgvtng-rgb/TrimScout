/**
 * Does the buyer's state take the trade-in off the price that vehicle tax is charged on? The box's copy of lib/trade/stateTradeCredit.ts.
 *
 * ONE rule table for the website and the deals box: this file carries the same rule per state + DC (rule, Michigan's cap, South
 * Carolina's flat-rate fee) as STATE_TRADE_CREDIT, and tradeTaxSaving() is the same arithmetic as tradeTaxCredit() once the state is known
 * (the box is handed the state, never a ZIP). lib/trade/stateTradeCreditBox.test.ts fails if the two drift. Sources, dates and notes live
 * in the TypeScript file; they are display text and are not repeated here.
 *
 *   full / capped / new_only  the trade-in lowers the taxable price (capped: up to a yearly limit; new_only: new vehicles only)
 *   none / unconfirmed        no credit is applied: the dealer's tax stands as quoted
 *
 * Pure. No imports.
 */
const r2 = (n) => Math.round(n * 100) / 100;

/** Michigan (MCL 205.51): $5,000 in 2019, +$1,000 each January 1; no limit once the cap would pass $14,000. */
const miCap = (year) => {
  const cap = 5000 + 1000 * (year - 2019);
  return cap > 14000 ? null : Math.max(cap, 0);
};

export const STATE_TRADE_CREDIT = {
  AL: { rule: "full" },
  AK: { rule: "unconfirmed" },
  AZ: { rule: "full" },
  AR: { rule: "full" },
  CA: { rule: "none" },
  CO: { rule: "full" },
  CT: { rule: "full" },
  DE: { rule: "full" },
  DC: { rule: "unconfirmed" },
  FL: { rule: "full" },
  GA: { rule: "full" },
  HI: { rule: "full" },
  ID: { rule: "full" },
  IL: { rule: "full" },
  IN: { rule: "full" },
  IA: { rule: "full" },
  KS: { rule: "full" },
  KY: { rule: "full" },
  LA: { rule: "full" },
  ME: { rule: "full" },
  MD: { rule: "full" },
  MA: { rule: "full" },
  MI: { rule: "capped", cap: miCap },
  MN: { rule: "full" },
  MS: { rule: "full" },
  MO: { rule: "full" },
  MT: { rule: "none" },
  NE: { rule: "full" },
  NV: { rule: "full" },
  NH: { rule: "unconfirmed" },
  NJ: { rule: "full" },
  NM: { rule: "full" },
  NY: { rule: "full" },
  NC: { rule: "full" },
  ND: { rule: "full" },
  OH: { rule: "new_only" },
  OK: { rule: "unconfirmed" },
  OR: { rule: "none" },
  PA: { rule: "full" },
  RI: { rule: "unconfirmed" },
  SC: { rule: "full", flatRate: 0.05, maxTax: 500 },
  SD: { rule: "full" },
  TN: { rule: "full" },
  TX: { rule: "full" },
  UT: { rule: "full" },
  VT: { rule: "full" },
  VA: { rule: "none" },
  WA: { rule: "full" },
  WV: { rule: "full" },
  WI: { rule: "full" },
  WY: { rule: "full" },
};

const NJ_LUXURY_SURCHARGE_RATE = 0.004;
const NJ_LUXURY_SURCHARGE_THRESHOLD = 45000;
const njLuxurySurchargeApplies = ({ state, isNew, sellingPrice }) =>
  state === "NJ" && isNew === true && typeof sellingPrice === "number" && sellingPrice >= NJ_LUXURY_SURCHARGE_THRESHOLD;

const sumAmounts = (items) => (Array.isArray(items) ? items : []).reduce((t, x) => t + (Number.isFinite(Number(x?.amount)) ? Number(x.amount) : 0), 0);

/** Selling price + add-ons: the part of the price the state taxes (lib/salesTax.ts salesTaxBase). */
export function salesTaxBase(sellingPrice, addOns) {
  const price = typeof sellingPrice === "number" && Number.isFinite(sellingPrice) ? sellingPrice : 0;
  return price + sumAmounts(addOns);
}

/** The dealer's quoted sales-tax lines, summed (lib/trade/stateTradeCredit.ts quotedTaxOf: every line named like "tax"). */
export const quotedTaxOf = (dueAtSigning) => sumAmounts((Array.isArray(dueAtSigning) ? dueAtSigning : []).filter((l) => /tax/i.test(String(l?.name || ""))));

/** A stored dealer quote is for a new car when it carries no miles (lib/salesTax.ts quoteIsNew). */
export const quoteIsNew = (q) => q?.miles == null;

/**
 * The tax the trade-in saves, same result as tradeTaxCredit() in lib/trade/stateTradeCredit.ts. `state` is the two-letter state.
 * Returns { status: "credit" | "none" | "unconfirmed", state, mid, low, high }; the amounts are zero unless status is "credit".
 */
export function tradeTaxSaving(input) {
  const state = input.state ? String(input.state).toUpperCase() : null;
  const none = (status) => ({ status, state, mid: 0, low: 0, high: 0 });
  const entry = state ? STATE_TRADE_CREDIT[state] : undefined;
  if (!entry || entry.rule === "unconfirmed") return none("unconfirmed");
  if (entry.rule === "none") return none("none");
  if (entry.rule === "new_only" && !input.isNew) return none("none");
  const { allowance } = input;
  const base = salesTaxBase(input.sellingPrice, input.addOns);
  if (!allowance || !(base > 0) || !(input.quotedTax > 0)) return none("credit");
  // NJ's 0.4% luxury surcharge is on the selling price and is not reduced by a trade-in.
  const luxury = njLuxurySurchargeApplies({ state, isNew: input.isNew, sellingPrice: input.sellingPrice }) ? input.sellingPrice * 0.004 : 0;
  const taxOnBase = Math.max(0, input.quotedTax - luxury);
  const rate = taxOnBase / base;
  const limit = entry.cap ? entry.cap(input.year ?? new Date().getFullYear()) : null;
  const saving = (value) => {
    const counted = Math.min(Math.max(value, 0), base, limit ?? Infinity);
    if (entry.flatRate != null && entry.maxTax != null) {
      const after = Math.min(entry.maxTax, entry.flatRate * (base - counted));
      return r2(Math.max(0, Math.min(taxOnBase, entry.maxTax) - after));
    }
    return r2(counted * rate);
  };
  return { status: "credit", state, mid: saving(allowance.mid), low: saving(allowance.low), high: saving(allowance.high) };
}
