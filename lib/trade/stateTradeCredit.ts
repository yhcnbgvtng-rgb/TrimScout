/**
 * Does the buyer's state take the trade-in off the price that vehicle tax is charged on?
 *
 * One entry per state + DC, each from the state's own revenue / motor vehicle / legislature page (URL and the date it was checked
 * sit beside the entry). Where an official source could not be opened or does not settle the rule, the entry is "unconfirmed" and
 * the compare keeps the dealer's full-price tax with a small note. Nothing here comes from a dealer blog or an aggregator.
 *
 *   full         the trade-in value is deducted from the taxable price
 *   capped       deducted up to a limit (Michigan: an annual dollar cap)
 *   new_only     deducted on a new vehicle only (Ohio)
 *   none         no deduction; tax is on the full price
 *   unconfirmed  not confirmed from an official source: the dealer's tax stands as quoted
 *
 * Leases: some official sources cover a trade-in on a lease, but a lease quote's monthly and taxes are the dealer's and are not
 * recomputed here, so lease tax is left as quoted in every state (see PR).
 *
 * Pure and client-safe.
 */
import { getZipCoordinates } from "../otdCalculator";
import { isResolvedState } from "../sameStateCheck";
import { njLuxurySurchargeApplies, salesTaxBase } from "../salesTax";
import type { LineItem } from "../leaseQuote";
import { sumItems } from "../leaseMath";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type TradeCreditRule = "full" | "capped" | "new_only" | "none" | "unconfirmed";

export interface StateTradeCredit {
  rule: TradeCreditRule;
  /** What the state calls the charge on the vehicle (many have no sales tax on cars). */
  tax: string;
  /** The official page opened for this entry; null when none could be opened. */
  url: string | null;
  checked: string;
  note: string;
  /** Capped states: the most trade-in value that counts in a given year, or null for no limit that year. */
  cap?: (year: number) => number | null;
  /** A flat-rate charge with a ceiling (South Carolina's fee): recomputed after the credit instead of scaling the quoted tax. */
  flatRate?: number;
  maxTax?: number;
}

const CHECKED = "2026-10-31";

/** Michigan (MCL 205.51): $5,000 in 2019, +$1,000 each January 1 ($12,000 in 2026); no limit once the cap would pass $14,000. */
const miCap = (year: number): number | null => {
  const cap = 5000 + 1000 * (year - 2019);
  return cap > 14000 ? null : Math.max(cap, 0);
};

export const STATE_TRADE_CREDIT: Record<string, StateTradeCredit> = {

  AL: { rule: "full", tax: "sales tax", url: "https://www.revenue.alabama.gov/wp-content/uploads/2021/12/810-6-1-.22-2.pdf", checked: CHECKED, note: "Allowance cannot exceed the sales price (Ala. Admin. Code r. 810-6-1-.22)." }, // https://www.revenue.alabama.gov/wp-content/uploads/2021/12/810-6-1-.22-2.pdf · checked 2026-10-31
  AK: { rule: "unconfirmed", tax: "local sales tax", url: null, checked: CHECKED, note: "No statewide sales tax; municipal codes differ and no official page stating a trade-in rule could be opened." }, // no official source opened · checked 2026-10-31
  AZ: { rule: "full", tax: "transaction privilege tax", url: "https://azdor.gov/sites/default/files/2023-03/RULINGS_TPT_1996_tpr96-1.pdf", checked: CHECKED, note: "Entire trade-in value reduces gross receipts; deduction cannot exceed the receipts (TPR 96-1)." }, // https://azdor.gov/sites/default/files/2023-03/RULINGS_TPT_1996_tpr96-1.pdf · checked 2026-10-31
  AR: { rule: "full", tax: "sales tax", url: "https://www.dfa.arkansas.gov/office/motor-vehicle/vehicle-tag-renewal/", checked: CHECKED, note: "Tax is computed on total consideration less the trade-in credit; invoice must show the trade-in VIN and allowance." }, // https://www.dfa.arkansas.gov/office/motor-vehicle/vehicle-tag-renewal/ · checked 2026-10-31
  CA: { rule: "none", tax: "sales tax", url: "https://cdtfa.ca.gov/industry/motor-vehicle-dealers/industry-topics.htm", checked: CHECKED, note: "CDTFA: the trade-in allowance cannot be deducted." }, // https://cdtfa.ca.gov/industry/motor-vehicle-dealers/industry-topics.htm · checked 2026-10-31
  CO: { rule: "full", tax: "sales tax", url: "https://tax.colorado.gov/sales-use-tax-topics-motor-vehicle-sales", checked: CHECKED, note: "Trade-in must itself be subject to licensing/registration and part of the purchase." }, // https://tax.colorado.gov/sales-use-tax-topics-motor-vehicle-sales · checked 2026-10-31
  CT: { rule: "full", tax: "sales tax", url: "https://portal.ct.gov/dmv/vehicle-services/sales-tax-registrations", checked: CHECKED, note: "Full credit on a purchase from a licensed dealer. Whether the credit lowers the price used for the 7.75% rate over $50,000 was not verified from an official page." }, // https://portal.ct.gov/dmv/vehicle-services/sales-tax-registrations · checked 2026-10-31
  DE: { rule: "full", tax: "document fee", url: "https://delcode.delaware.gov/title30/c030/index.html", checked: CHECKED, note: "Delaware has no sales tax; the document fee is on the gross purchase price less trade-in or allowance. One vehicle per application." }, // https://delcode.delaware.gov/title30/c030/index.html · checked 2026-10-31
  DC: { rule: "unconfirmed", tax: "excise tax", url: "https://code.dccouncil.gov/us/dc/council/code/sections/50-2201.03", checked: CHECKED, note: "Titling excise tax is on fair market value; no official page states how a trade-in is treated." }, // https://code.dccouncil.gov/us/dc/council/code/sections/50-2201.03 · checked 2026-10-31
  FL: { rule: "full", tax: "sales tax", url: "https://floridarevenue.com/Forms_library/gt800030.pdf", checked: CHECKED, note: "Registered dealers may deduct a trade-in allowance. The local surtax applies only to the first $5,000 of price." }, // https://floridarevenue.com/Forms_library/gt800030.pdf · checked 2026-10-31
  GA: { rule: "full", tax: "title ad valorem tax", url: "https://dor.georgia.gov/title-ad-valorem-tax-tavt-faq", checked: CHECKED, note: "Dealer sales only; a reduction is made for the trade-in." }, // https://dor.georgia.gov/title-ad-valorem-tax-tavt-faq · checked 2026-10-31
  HI: { rule: "full", tax: "general excise tax", url: "https://files.hawaii.gov/tax/forms/current/g45ins.pdf", checked: CHECKED, note: "Trade-in allowance is a price adjustment subtracted from the new article's sales price (GET filing instructions)." }, // https://files.hawaii.gov/tax/forms/current/g45ins.pdf · checked 2026-10-31
  ID: { rule: "full", tax: "sales tax", url: "https://tax.idaho.gov/taxes/sales-use/transportation/motor-vehicles/dealers/sales-price/", checked: CHECKED, note: "Dealer sale; trade-in must take place at the time of the sale." }, // https://tax.idaho.gov/taxes/sales-use/transportation/motor-vehicles/dealers/sales-price/ · checked 2026-10-31
  IL: { rule: "full", tax: "sales tax", url: "https://tax.illinois.gov/forms/sales/vehicleusetax/st-556-lse-transaction-return-for-leases-instructions.html", checked: CHECKED, note: "The $10,000 trade-in credit limit applied only to sales in 2020 and 2021 and no longer applies." }, // https://tax.illinois.gov/forms/sales/vehicleusetax/st-556-lse-transaction-return-for-leases-instructions.html · checked 2026-10-31
  IN: { rule: "full", tax: "sales tax", url: "https://www.in.gov/dor/files/sib28s.pdf", checked: CHECKED, note: "Like-kind exchange in a single transaction (vehicle for vehicle)." }, // https://www.in.gov/dor/files/sib28s.pdf · checked 2026-10-31
  IA: { rule: "full", tax: "new registration fee", url: "https://www.legis.iowa.gov/docs/code/321.105A.pdf", checked: CHECKED, note: "Iowa charges a 5% fee for new registration, not a sales tax; the purchase price excludes the trade-in value." }, // https://www.legis.iowa.gov/docs/code/321.105A.pdf · checked 2026-10-31
  KS: { rule: "full", tax: "sales tax", url: "https://www.ksrevenue.gov/pub1526.html", checked: CHECKED, note: "Tax is charged on the net price after the trade-in allowance; trade-in must go into the dealer's resale inventory." }, // https://www.ksrevenue.gov/pub1526.html · checked 2026-10-31
  KY: { rule: "full", tax: "motor vehicle usage tax", url: "https://revenue.ky.gov/Property/Motor-Vehicles/Pages/Motor-Vehicle-Usage-Tax.aspx", checked: CHECKED, note: "Trade-in allowance is granted when purchasing new vehicles." }, // https://revenue.ky.gov/Property/Motor-Vehicles/Pages/Motor-Vehicle-Usage-Tax.aspx · checked 2026-10-31
  LA: { rule: "full", tax: "sales tax", url: "https://public.powerdms.com/LADPSC/documents/1063751", checked: CHECKED, note: "LA OMV Policy 47.01 (rev. 08/25/2025): credit cannot exceed the price of the vehicle purchased." }, // https://public.powerdms.com/LADPSC/documents/1063751 · checked 2026-10-31
  ME: { rule: "full", tax: "sales tax", url: "https://legislature.maine.gov/statutes/36/title36sec1765.html", checked: CHECKED, note: "Tax is levied only on the difference between the sale price and the trade-in; same category of item only." }, // https://legislature.maine.gov/statutes/36/title36sec1765.html · checked 2026-10-31
  MD: { rule: "full", tax: "excise tax", url: "https://mva.maryland.gov/your-mva-guide/businesses/bulletins-businesses/taxable-price", checked: CHECKED, note: "Price less an allowance for a trade-in of a non-leased vehicle; no dollar cap on the MVA bulletin." }, // https://mva.maryland.gov/your-mva-guide/businesses/bulletins-businesses/taxable-price · checked 2026-10-31
  MA: { rule: "full", tax: "sales tax", url: "https://budget.digital.mass.gov/govbudget/fy26/tax-expenditure-budget/sales-tax/miscellaneous-exemptions/3-606/", checked: CHECKED, note: "Taxed only on the excess of the purchase price over the trade-in (M.G.L. c.64H s.26)." }, // https://budget.digital.mass.gov/govbudget/fy26/tax-expenditure-budget/sales-tax/miscellaneous-exemptions/3-606/ · checked 2026-10-31
  MI: { rule: "capped", tax: "sales tax", url: "https://legislature.mi.gov/documents/mcl/archive/2025/June/mcl-Act-167-of-1933.pdf", checked: CHECKED, note: "MCL 205.51: credit is the lesser of the trade value or an annual cap of $5,000 in 2019 plus $1,000 each January 1 ($12,000 in 2026); no limit once the cap would exceed $14,000.", cap: miCap }, // https://legislature.mi.gov/documents/mcl/archive/2025/June/mcl-Act-167-of-1933.pdf · checked 2026-10-31
  MN: { rule: "full", tax: "sales tax", url: "https://www.revenue.state.mn.us/guide/motor-vehicle-sales", checked: CHECKED, note: "A trade-in allowance reduces the sales price when the seller takes a motor vehicle in trade." }, // https://www.revenue.state.mn.us/guide/motor-vehicle-sales · checked 2026-10-31
  MS: { rule: "full", tax: "sales tax", url: "https://www.dor.ms.gov/motor-vehicle/motor-vehicle-frequently-asked-questions", checked: CHECKED, note: "Tax is on the net purchase price after dealer discounts and trade-ins." }, // https://www.dor.ms.gov/motor-vehicle/motor-vehicle-frequently-asked-questions · checked 2026-10-31
  MO: { rule: "full", tax: "sales tax", url: "https://dor.mo.gov/motor-vehicle/titling-registration/buying-vehicle.html", checked: CHECKED, note: "Purchase price less trade-in allowance." }, // https://dor.mo.gov/motor-vehicle/titling-registration/buying-vehicle.html · checked 2026-10-31
  MT: { rule: "none", tax: "none (no general sales tax)", url: "https://revenue.mt.gov/taxes/general-sales-tax", checked: CHECKED, note: "Montana has no general sales tax and no vehicle sales tax was found, so there is nothing to credit." }, // https://revenue.mt.gov/taxes/general-sales-tax · checked 2026-10-31
  NE: { rule: "full", tax: "sales tax", url: "https://nebraskalegislature.gov/laws/statutes.php?statute=77-2703", checked: CHECKED, note: "Computed on the difference between the sales price and the trade-in allowance." }, // https://nebraskalegislature.gov/laws/statutes.php?statute=77-2703 · checked 2026-10-31
  NV: { rule: "full", tax: "sales tax", url: "https://tax.nv.gov/wp-content/uploads/2024/03/Automotive.pdf", checked: CHECKED, note: "Trade-in reduces the purchase price; tax is paid on the net selling price." }, // https://tax.nv.gov/wp-content/uploads/2024/03/Automotive.pdf · checked 2026-10-31
  NH: { rule: "unconfirmed", tax: "none (no general sales tax)", url: null, checked: CHECKED, note: "No official page could be opened (revenue.nh.gov and dmv.nh.gov returned 403)." }, // no official source opened · checked 2026-10-31
  NJ: { rule: "full", tax: "sales tax", url: "https://www.nj.gov/treasury/taxation/documents/pdf/guides/New-Jersey-Consumer-Automotive-Tax-Guide.pdf", checked: CHECKED, note: "Credit only when the trade-in goes to a registered NJ dealer for resale and the purchase contract and trade-in are executed at the same time." }, // https://www.nj.gov/treasury/taxation/documents/pdf/guides/New-Jersey-Consumer-Automotive-Tax-Guide.pdf · checked 2026-10-31
  NM: { rule: "full", tax: "motor vehicle excise tax", url: "https://www.tax.newmexico.gov/?p=1820", checked: CHECKED, note: "4% of the vehicle's price less any trade-in credit." }, // https://www.tax.newmexico.gov/?p=1820 · checked 2026-10-31
  NY: { rule: "full", tax: "sales tax", url: "https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/taxable_receipt.htm", checked: CHECKED, note: "Tax is due only on the reduced price after the trade-in credit; the seller must plan to resell the trade-in." }, // https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/taxable_receipt.htm · checked 2026-10-31
  NC: { rule: "full", tax: "highway use tax", url: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-187.3.html", checked: CHECKED, note: "G.S. 105-187.3: sales price less any allowance given by the retailer for a vehicle taken in trade." }, // https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-187.3.html · checked 2026-10-31
  ND: { rule: "full", tax: "motor vehicle excise tax", url: "https://www.tax.nd.gov/special-taxes", checked: CHECKED, note: "Tax base is the sales price less any trade-in amount." }, // https://www.tax.nd.gov/special-taxes · checked 2026-10-31
  OH: { rule: "new_only", tax: "sales tax", url: "https://codes.ohio.gov/ohio-revised-code/section-5739.01", checked: CHECKED, note: "ORC 5739.01(H)(2) credits a trade-in on a new motor vehicle bought from a new motor vehicle dealer; OAC 5703-9-36 says Ohio allows no deduction for a trade-in on a used vehicle." }, // https://codes.ohio.gov/ohio-revised-code/section-5739.01 · checked 2026-10-31
  OK: { rule: "unconfirmed", tax: "sales tax and excise tax", url: "https://www.oklegislature.gov/cf_pdf/2023-24%20ENR/SB/SB984%20ENR.PDF", checked: CHECKED, note: "SB 984 (eff. 2023-11-01) credits a trade-in against the 1.25% sales tax, but the 3.25% excise tax treatment could not be confirmed current from an official page." }, // https://www.oklegislature.gov/cf_pdf/2023-24%20ENR/SB/SB984%20ENR.PDF · checked 2026-10-31
  OR: { rule: "none", tax: "vehicle privilege tax", url: "https://www.oregon.gov/dor/programs/businesses/pages/vehicle-privilege-and-use-taxes.aspx", checked: CHECKED, note: "Oregon has no sales tax; trade-ins are not subtracted from the retail price for the privilege or use tax." }, // https://www.oregon.gov/dor/programs/businesses/pages/vehicle-privilege-and-use-taxes.aspx · checked 2026-10-31
  PA: { rule: "full", tax: "sales tax", url: "https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F061%2Fchapter31%2Fs31.44.html", checked: CHECKED, note: "61 Pa. Code 31.44: deduction for a trade-in allowed at the same time as the sale." }, // https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F061%2Fchapter31%2Fs31.44.html · checked 2026-10-31
  RI: { rule: "unconfirmed", tax: "sales tax", url: "https://rules.sos.ri.gov/Regulations/Part/280-20-70-28", checked: CHECKED, note: "Regulation gives credit only for a private passenger automobile traded toward one; truck trade-ins get none. TrimScout does not know the vehicle class, so the credit cannot be applied reliably." }, // https://rules.sos.ri.gov/Regulations/Part/280-20-70-28 · checked 2026-10-31
  SC: { rule: "full", tax: "infrastructure maintenance fee", url: "https://dor.sc.gov/sites/dor/files/Documents/Policy%20Manuals/sales-and-use-tax-auto-and-truck-dealers-guide.pdf", checked: CHECKED, note: "The fee is 5% of gross proceeds (capped at $500) and excludes the trade-in value.", flatRate: 0.05, maxTax: 500 }, // https://dor.sc.gov/sites/dor/files/Documents/Policy%20Manuals/sales-and-use-tax-auto-and-truck-dealers-guide.pdf · checked 2026-10-31
  SD: { rule: "full", tax: "motor vehicle excise tax", url: "https://sdlegislature.gov/api/Statutes/32-5B.html?all=true", checked: CHECKED, note: "SDCL 32-5B-4: the trade-in value allowed by the seller is deducted from the total consideration." }, // https://sdlegislature.gov/api/Statutes/32-5B.html?all=true · checked 2026-10-31
  TN: { rule: "full", tax: "sales tax", url: "https://www.tn.gov/content/dam/tn/revenue/documents/tax_manuals/june-2025/auto-dealership-manual.pdf", checked: CHECKED, note: "Tax on the new vehicle is calculated on the price less the trade-in credit. The local and single-article tax caps were not isolated, so the credit is an estimate." }, // https://www.tn.gov/content/dam/tn/revenue/documents/tax_manuals/june-2025/auto-dealership-manual.pdf · checked 2026-10-31
  TX: { rule: "full", tax: "motor vehicle sales tax", url: "https://comptroller.texas.gov/taxes/publications/96-254/trade-ins.php", checked: CHECKED, note: "Trade-in must be a motor vehicle, part of the same transaction, transferred to the seller." }, // https://comptroller.texas.gov/taxes/publications/96-254/trade-ins.php · checked 2026-10-31
  UT: { rule: "full", tax: "sales tax", url: "https://files.tax.utah.gov/tax/forms/2025/pub-05.pdf", checked: CHECKED, note: "An allowance for a trade-in on the purchase of a vehicle may be excluded; single transaction." }, // https://files.tax.utah.gov/tax/forms/2025/pub-05.pdf · checked 2026-10-31
  VT: { rule: "full", tax: "purchase and use tax", url: "https://legislature.vermont.gov/statutes/section/32/219/08902", checked: CHECKED, note: "32 V.S.A. 8902(5)(B): the value allowed by the seller on a motor vehicle accepted by the seller." }, // https://legislature.vermont.gov/statutes/section/32/219/08902 · checked 2026-10-31
  VA: { rule: "none", tax: "sales and use tax", url: "https://www.dmv.virginia.gov/vehicles/taxes-fees/sut", checked: CHECKED, note: "DMV worked example: a $5,000 trade-in does not reduce the $40,000 taxed price." }, // https://www.dmv.virginia.gov/vehicles/taxes-fees/sut · checked 2026-10-31
  WA: { rule: "full", tax: "sales tax", url: "https://dor.wa.gov/education/industry-guides/auto-dealers/trade-ins", checked: CHECKED, note: "Selling price excludes trade-in property of like kind. The page does not address local sales tax." }, // https://dor.wa.gov/education/industry-guides/auto-dealers/trade-ins · checked 2026-10-31
  WV: { rule: "full", tax: "titling tax", url: "https://dmv.wv.gov/titles", checked: CHECKED, note: "6% titling tax is calculated on purchase price minus trade-in value." }, // https://dmv.wv.gov/titles · checked 2026-10-31
  WI: { rule: "full", tax: "sales tax", url: "https://docs.legis.wisconsin.gov/document/administrativecode/Tax%2011.83", checked: CHECKED, note: "Wis. Admin. Code Tax 11.83: sale minus any trade-in allowance if the sale and trade-in are one transaction." }, // https://docs.legis.wisconsin.gov/document/administrativecode/Tax%2011.83 · checked 2026-10-31
  WY: { rule: "full", tax: "sales tax", url: "https://www.dot.state.wy.us/files/live/sites/wydot/files/shared/Motor%20Vehicle%20Services/WYSalesUseTaxStatementForMotorVehicleSales_08.01.22.pdf", checked: CHECKED, note: "Revenue Dept. sales/use tax statement has a 'less trade-in' line; the trade-in title must be in the purchaser's name." }, // https://www.dot.state.wy.us/files/live/sites/wydot/files/shared/Motor%20Vehicle%20Services/WYSalesUseTaxStatementForMotorVehicleSales_08.01.22.pdf · checked 2026-10-31
};

export const UNCONFIRMED_TRADE_TAX_NOTE = "Tax shown on full price; your state may give a trade-in credit.";

/** The buyer's two-letter state from a ZIP, or null when the ZIP is missing or can't be placed. */
export function stateOfZip(zip: string | null | undefined): string | null {
  const clean = String(zip ?? "").replace(/\D/g, "");
  if (clean.length < 3) return null;
  const st = getZipCoordinates(clean).state;
  return isResolvedState(st) ? st : null;
}

export interface TradeTaxCredit {
  /** credit: the state gives one; none: it does not; unconfirmed: not confirmed (full-price tax, note shown). */
  status: "credit" | "none" | "unconfirmed";
  state: string | null;
  taxName: string | null;
  /** Tax saved at the midpoint / low / high of the dealer's allowance. Zero unless status is "credit". */
  mid: number;
  low: number;
  high: number;
}

const NO_CREDIT = (status: TradeTaxCredit["status"], state: string | null, taxName: string | null = null): TradeTaxCredit => ({ status, state, taxName, mid: 0, low: 0, high: 0 });

export interface TradeTaxCreditInput {
  zip: string | null | undefined;
  /** Allowance low / mid / high; equal when the dealer gave one number. */
  allowance: { low: number; mid: number; high: number } | null;
  sellingPrice: number;
  addOns?: Array<Pick<LineItem, "amount">> | null;
  /** The sales-tax line(s) the dealer quoted. */
  quotedTax: number;
  isNew: boolean;
  year?: number;
}

/**
 * The tax the trade-in saves under the buyer's state rule. The dealer's own quote is never edited: the saving is a separate line beside it.
 * The rate is the one the dealer's quote implies (quoted tax over the taxable base), so county / city add-ons carry through; the
 * credit is that rate on the part of the allowance the state lets through, never more than the taxable price. Surcharges are not in the base.
 */
export function tradeTaxCredit(input: TradeTaxCreditInput): TradeTaxCredit {
  const state = stateOfZip(input.zip);
  const entry = state ? STATE_TRADE_CREDIT[state] : undefined;
  if (!entry || entry.rule === "unconfirmed") return NO_CREDIT("unconfirmed", state, entry?.tax ?? null);
  if (entry.rule === "none") return NO_CREDIT("none", state, entry.tax);
  if (entry.rule === "new_only" && !input.isNew) return NO_CREDIT("none", state, entry.tax);
  const { allowance } = input;
  const base = salesTaxBase(input.sellingPrice, input.addOns);
  if (!allowance || !(base > 0) || !(input.quotedTax > 0)) return NO_CREDIT("credit", state, entry.tax);
  // NJ's 0.4% luxury surcharge is on the selling price and is not reduced by a trade-in.
  const luxury = njLuxurySurchargeApplies({ state, isNew: input.isNew, sellingPrice: input.sellingPrice }) ? input.sellingPrice * 0.004 : 0;
  const taxOnBase = Math.max(0, input.quotedTax - luxury);
  const rate = taxOnBase / base;
  const limit = entry.cap ? entry.cap(input.year ?? new Date().getFullYear()) : null;
  const saving = (value: number): number => {
    const counted = Math.min(Math.max(value, 0), base, limit ?? Infinity);
    if (entry.flatRate != null && entry.maxTax != null) {
      const after = Math.min(entry.maxTax, entry.flatRate * (base - counted));
      return r2(Math.max(0, Math.min(taxOnBase, entry.maxTax) - after));
    }
    return r2(counted * rate);
  };
  return { status: "credit", state, taxName: entry.tax, mid: saving(allowance.mid), low: saving(allowance.low), high: saving(allowance.high) };
}

/** The dealer's quoted sales-tax lines, summed. */
export const quotedTaxOf = (dueAtSigning: LineItem[] | null | undefined): number => sumItems((dueAtSigning || []).filter((l) => /tax/i.test(String(l?.name || ""))));
