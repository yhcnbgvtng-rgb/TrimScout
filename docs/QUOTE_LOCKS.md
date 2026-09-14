# Quote locks — apples-to-apples Finance / Cash / Lease quotes

Buyers lock the structure on **Configure Quote Request → Quote setup**; every invited
dealer quotes to the same locks through the matching sheet, in TrimScout only (no
email reply). A quote request, not a binding purchase and not an auction.

## Buyer locks (Quote setup)

| Type | Required before Continue / send | Optional |
|---|---|---|
| **Finance** | Term (36/48/60/72/84) · Down payment ($, 0 allowed) · Credit band (excellent / good / fair / rebuilding — no "prefer not to say") · ZIP | Timeline |
| **Cash** | ZIP | Timeline |
| **Lease** | Term · Miles/year · Due-at-signing intent (first month + fees only / money down) · Credit band · ZIP | Timeline |

Credit-band copy, everywhere the buyer picks it:
> No credit pull — this is your own estimate so dealers quote the same band.

**Empty state.** Continue stays disabled and the section ends with
`To continue, set your term, down payment, credit band and ZIP — dealers quote to these, so they can't be blank.`
(only the missing ones are listed). The server refuses a finance request whose locks
don't parse (`Finance requests need a term, down payment, credit band and ZIP…`).

Implementation: `lib/creditBand.ts`, `missingFinanceLocks` / `parseQuotePrefs` in
`lib/usedQuote.ts`, `parseLeasePrefs` in `lib/leaseQuote.ts`, `missingLocks` in
`components/BiddingWizard.tsx`.

## Dealer submit — Finance (`UsedQuoteForm`, `POST /api/quote-invite/used-quote`)

Same VIN/stock as the request. Required:

1. Selling price
2. Fees itemized — sales tax, doc fee, title & registration always listed; a single lump ("Fees", "OTD", "Due") is rejected
3. Sales tax as its own line ($0 if none applies) — or the rate context from the buyer's ZIP
4. Amount financed
5. APR
6. Monthly payment — computed from amount financed / APR / term; no typed monthly
7. Term confirmed — **must equal the buyer's lock** (else `Term must be the buyer's lock: 60 months.`)
8. Down payment applied — **must equal the buyer's lock** (else `Down payment must be the buyer's lock: $3,000.`)
9. Quote good-until date (future)
10. Add-ons — either "No add-ons — $0" or each add-on as its own named line with a price; never folded into price or payment

Optional: lender name, rebate / incentive lines (reduce cash due), trade equity.
Credit band is shown read-only ("Quoting to credit band") — the dealer rates that band.

Rejections (form and server, same `validateUsedQuote`): term/down off the lock, un-itemized
fees, missing sales-tax line, add-ons neither listed nor declared none, past expiry,
monthly-only submissions.

**Cash:** selling price · itemized fees with sales-tax line · add-ons (or none) · expiry.
OTD = price + fees + add-ons − rebates. Miles + CPO only on a used car.

**Lease (`LeaseCalculatorForm`):** monthly · due at signing itemized · cap cost · money
factor · residual · term/miles confirmed (or an explicit counter) · expiry. The banner
shows the buyer's locked band and up-front intent.

## Buyer compare (`UsedCompare`)

- Header: `same car on every row: VIN …` + the buyer's locks.
- **Finance rank:** monthly first, then cash due at signing (down + fees + tax + add-ons −
  rebates), then amount financed (`compareFinanceQuotes`). Lowest monthly and lowest
  cash-due cells are each highlighted; the glance card shows both numbers for the top row.
- Columns always shown: Monthly (with est. tax) · Cash due at signing (expandable:
  down, each fee, add-ons, rebates) · APR · term · amount financed (+ lender) · Selling
  price · Fees & tax (expandable) · Add-ons · Rebates · Expires · Status.
- **Cash rank:** out the door, lowest highlighted.
- Expired rows grey out and can't be chosen; waiting rows show dashes; "Waiting on N
  dealers — quotes appear here as they reply" when none has quoted.
