# Lease quote fields (v2)

The dealer's lease reply (`/quote-request/received`, `LeaseCalculatorForm`) is one structured quote. It is validated by
`validateLeaseQuote` in `lib/leaseQuote.ts`, on the form **and** in `POST /api/quote-invite/lease-quote` (422 with the list of
errors). The server runs `coerceLeaseQuote` → `finalizeLeaseQuote` first, so the buyer never relies on the browser for the
derived fields below.

## Storage

There are no `lease_quote` / `quote_fee_line` tables. The whole quote is stored as JSON in `rfq_quotes.lease_json`
(see `scripts/box/2026-09-13-lease-quotes.sh`), so v2 needs **no box migration**: the new keys ride inside the JSON. Every v2
key is optional on the `LeaseQuote` type, so quotes stored before v2 still read and compare (the buyer sees "Not given").
Only *new dealer submissions* are held to the v2 requirements. A buyer logging a quote a dealer gave by phone or email
(`/api/rfqs/[id]/invites/[inviteId]/quotes`) keeps the pre-v2 rules (`legacy: true`), because they cannot know the lender or
tax method.

## Why each field is required

| Field | Why the buyer needs it |
|---|---|
| MSRP used for residual | The residual % means nothing without its base; lenders sometimes use an adjusted MSRP. The residual dollars auto-fill from it. If the dealer types a different residual (beyond $1 rounding) the server sets `residualEnteredDirectly` and the buyer sees "Residual entered directly". |
| Lender | A captive's money factor and a bank's are not comparable; the buyer should know who the lease is with. |
| Credit tier assumed | The money factor is only valid at that tier. If it is below the buyer's stated band the buyer sees "Priced at a lower tier". |
| Tax method | The same payment is taxed monthly, on total payments or on cap cost depending on the state. The calculator applies it (`computeLeaseTax`) to "Monthly with est. tax" and "Due at signing". There is no verified state default table yet (`lib/leaseDefaults.ts` is empty by design), so the field starts blank. |
| Vehicle status / ETA | A car in transit or on order is not the same quote as one on the lot. ETA is required unless in stock. |
| Good through | Required, today or later, at most 45 days out. Defaults to the last day of the month (programs reset monthly). |
| Security deposit | Shown in due at signing as "Refundable security deposit"; not counted in total lease cost. $0 is allowed. |
| Disposition fee, excess mileage $/mile | End-of-lease costs that change what the lease really costs. $0 is allowed. Disposition fee is part of total lease cost. |
| Fee category / taxable / timing | Dealer fees and government (pass-through) fees are shown as separate subtotals. "Rolled into cap cost" lines raise the net cap cost instead of due at signing. Default taxable: doc fee yes; title, registration and added lines no (the dealer edits it). |
| Incentive eligibility + attestation | Each incentive shows as "Dealer-claimed" with who it is open to and the proof needed; the dealer attests once when any incentive is over $0. |
| Add-on taxable / removable / timing | Rolled-in add-ons are in the net cap cost; signing add-ons are in due at signing. |
| Net cap cost override reason | The calculated net cap = selling price + rolled fees and add-ons (+ rolled acquisition fee) − incentives − cap reduction. The dealer may overwrite it, but a different figure needs a reason, shown to the buyer as "Adjusted by dealer: …". The server recomputes it from `sellingPrice`. |

`capCost` stays the *gross* cap cost (before the cap reduction) so trade-equity and buyer-counter math read it as before; the
form's "Net cap cost" is `capCost − capReduction`.

## Total lease cost

`(monthly with tax × term) + due at signing − first month − refundable security deposit + disposition fee`, set by the server in
`totalLeaseCost`. It is the secondary sort on the buyer compare, after the monthly. The deposit is paid at signing, so it is in
due at signing, but it comes back, so it is taken out of the cost.

## Sanity warnings (never block)

Money factor outside 0.00001–0.01 and residual outside 20–85%.
