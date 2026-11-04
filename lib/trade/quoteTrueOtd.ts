/**
 * The inputs the True OTD breakdown needs, gathered from a quote request the same way for every view (buyer compare, Deal Tracker).
 * No arithmetic here: it only picks the trade equity, the buyer's tax zip and the quoted figures, then calls lib/trade/trueOtd.ts.
 */
import type { RfqInvite, RfqRequest } from "../rfq";
import { isExpired } from "../leaseQuote";
import { quoteIsNew } from "../salesTax";
import { cashOutTheDoor, type QuotePrefs, type UsedQuote } from "../usedQuote";
import { tradeEquity, type TradeEquity } from "./otd";
import { appraisalForCompare } from "./confirm";
import { quotedTaxOf, tradeTaxCredit, type TradeTaxCredit } from "./stateTradeCredit";
import { trueOtdBreakdown, type TrueOtdBreakdown } from "./trueOtd";

/** The trade equity for one dealer's quote: the confirmed allowance once settled, else what the desk originally quoted. */
export const inviteTradeEquity = (rfq: Pick<RfqRequest, "tradeIn">, invite: RfqInvite): TradeEquity => {
  const trade = rfq.tradeIn ?? null;
  return tradeEquity(Boolean(trade), trade?.payoffEstimate, appraisalForCompare(invite.tradeAppraisal, invite.tradeConfirmation), new Date(), { quoteExpiresAt: invite.quote?.expiresAt ?? null, tradeUpdatedAt: trade?.updatedAt ?? null });
};

/** The buyer's tax zip for a Finance / Cash request. */
export const quoteTaxZip = (prefs: QuotePrefs | null | undefined): string | null => (!prefs ? null : prefs.quoteType === "finance" ? prefs.finance?.zip || null : prefs.cash?.zip || null);

export const taxCreditForQuote = (used: UsedQuote, eq: TradeEquity, zip: string | null): TradeTaxCredit =>
  tradeTaxCredit({ zip, allowance: eq.status === "quoted" ? eq.allowance : null, sellingPrice: used.sellingPrice, addOns: used.addOns, quotedTax: quotedTaxOf(used.dueAtSigning), isNew: quoteIsNew(used) });

export const trueOtdForQuote = (used: UsedQuote, eq: TradeEquity, zip: string | null): TrueOtdBreakdown =>
  trueOtdBreakdown({ originalOtd: cashOutTheDoor(used), eq, taxCredit: taxCreditForQuote(used, eq, zip) });

/** Every live cash quote on the request whose dealer put a trade allowance on it. Empty with no trade, a finance request, or no allowance yet. */
export function rfqTrueOtdRows(rfq: RfqRequest): Array<{ invite: RfqInvite; b: TrueOtdBreakdown }> {
  const prefs = rfq.quotePrefs;
  if (!rfq.tradeIn || !prefs || prefs.quoteType === "finance") return [];
  const zip = quoteTaxZip(prefs);
  const out: Array<{ invite: RfqInvite; b: TrueOtdBreakdown }> = [];
  for (const invite of rfq.invites) {
    const used = invite.quote?.used;
    if (!used || isExpired({ expiresAt: used.expiresAt })) continue;
    const b = trueOtdForQuote(used, inviteTradeEquity(rfq, invite), zip);
    if (b.applies) out.push({ invite, b });
  }
  return out;
}
