# Trade allowance with the quote, then confirm or revise

On a request with a trade-in, **every invited dealer gives a trade allowance together with their vehicle quote**, the buyer compares on
the **post-trade** number, and the dealer the buyer selects then **confirms or revises that number in one in-app step**. Nothing here
changes non-trade pricing, and nothing happens by email reply: the notices only link into TrimScout.
Builds on [TRADE_IN.md](TRADE_IN.md) (the buyer's trade, the six photos, equity math).

```
quote (car + trade allowance)  →  compare on post-trade OTD  →  buyer selects  →  dealer: Confirm as quoted | Revise
                                                                                        │                       │
                                                                          settled, others told once      buyer: Accept | Go back | Walk away
```

## 1. Quote with a trade

When the request has a trade-in, the dealer's quote form (Finance / Cash sheet **and** lease calculator) has a **required** trade section and
the submit button stays disabled until it is complete:

| Field | Rule |
| --- | --- |
| Allowance | one number **or** a low/high range; must be > $0 |
| Basis | *Preliminary, subject to inspection* (default) or *Firm, if the vehicle matches the description and photos* |
| Good until | defaults to the vehicle quote's expiry; the allowance can never outlive the quote |
| Payoff | the dealer confirms the buyer's estimated payoff was used and that they'll pay off the lien; net equity (allowance − payoff, negative allowed) shows live |
| Conditions | structured chips (no frame damage, needs 2nd key, clean title, …) plus free text |
| **or** "Can't quote this trade" | reason code (wrong brand mix, salvage title, …); the vehicle quote still counts, the desk sits out best-deal |

"Request more photos" (optional slots and a note, in-app, one open ask per desk) is unchanged. With no trade on the request the section does not appear.

**Server-side lock** (not just the UI). `lib/trade/quoteTrade.ts` → `recordTradeWithQuote()` runs in all three routes that record a vehicle quote
(`quote-invite/used-quote`, `quote-invite/lease-quote`, `rfqs/[id]/invites/[inviteId]/quotes`) and answers **422 `trade_allowance_required`**
when a trade request's quote carries no allowance/decline and the desk has no live one on file. The deals box refuses the quote again if the
app is ever skipped (the patch below). A re-quote after a buyer counter keeps the allowance on file; a lapsed one must be replaced.

## 2. Compare

Every card shows vehicle OTD, the trade allowance with **Preliminary/Firm** and **good-until**, payoff, **net equity (green positive, red negative)**,
post-trade OTD, and the dealer's **conditions** beside the number. A range shows low–high and says it is compared at the midpoint.

* Default sort = **post-trade OTD** (`lib/trade/rank.ts`). *Vehicle OTD only* is one click away.
  * cash: vehicle OTD − net equity (negative equity makes it larger)
  * finance: the equity is applied as the compare already does (positive → cash down, negative → rolled into the amount financed); desks rank on the monthly at **their** rate and term on that adjusted amount, then cash due. Ranking only: the dealer's own monthly is never overwritten (an "≈ monthly" line shows what was used).
  * lease: positive equity is a cap cost reduction, negative is rolled into the cap cost; rank on the monthly moved by Δcap × (1/term + money factor).
* A desk with **no live trade number** (none, declined, expired) shows **"No trade quote"** / "Can't quote this trade", sorts after desks that can be compared, and **never gets the best-deal badge or a "Lowest" chip**. Their vehicle quote still counts and is still in the table.
* **"Based on earlier details"** appears on a number when the buyer changed the trade after it was given; the dealer sees the same banner with *My number still stands* (reconfirm) or can update it. Photo changes also still send the existing once-per-batch notice.
* The allowance expires with the vehicle quote ("Trade value expired", not applied).

## 3. Confirm or revise (after the buyer selects)

Selecting a quote on a trade request calls `openConfirmAfterPick()`, which opens a **trade_confirmation** for the winner (status `pending`, deadline
`TRADE_CONFIRM_DEADLINE_HOURS`, default 24). **The other dealers stay open** (not told, not closed) until the number is settled, so "go back" finds
every original number intact. If the winner has no live allowance (no trade, declined, expired) nothing opens and the other dealers are closed out immediately, as before.

Dealer (quote page, behind their own invite link; only the selected desk has this step):
* **Confirm as quoted**: one click. A range needs **one number inside it** (that is the single final number).
* **Revise trade value**: new number, **required reason** (inspection finding · photos don't match the description · payoff changed · other + text), optionally cite which of their original conditions it comes from.
* Notified in-app (their quote page and the deal thread) and by the existing notice email that **links in and says not to reply**.
* **No action by the deadline → the original number stands** (`expired`, final = quoted). It is persisted the next time anyone opens the request (`sweepIfDue`), not by a cron.

Buyer (their request page):
* While pending: who is confirming, by when, "if they don't, their quoted number stands", and **Walk away**.
* On a revision: **before / after** table (allowance, net equity, and out-the-door after trade, or the amount financed / cap cost and ≈ monthly), the reason, then **Accept revised number**, **Go back and pick another quote**, or **Walk away**.
* **Go back**: the request reopens to the compare (`picked → collecting`), every other desk's original numbers are intact, nobody is penalised, and the revising desk is marked **Revised** (its card still shows what it originally quoted). Re-selecting it later shows the revised number again without asking the dealer twice.
* Once the number is final (confirmed, accepted, or defaulted) the other dealers get the one "not selected this time" note (`settleAndCloseOut`).

## 4. Guardrails

* `TRADE_REVISION_THRESHOLD_PCT` (default **10**): a revision that lowers the number by **more than** that (measured from the quoted number, or the bottom of a range) **and cites none of the dealer's original conditions** needs a written explanation of **≥ 20 characters** and sets `revision_flagged` for internal review. Citing a listed chip/the conditions text lifts the requirement and the flag.
* A **Firm** quote that is revised needs a structured reason (for "other", ≥ 20 characters) and is flagged `firm_breach`.
* The buyer is never blocked from walking away, at any point before the number is settled.
* A revision is never binding until the buyer accepts it.

## 5. Desk honesty (internal only)

Per quote, stored on the `trade_confirmation` and flattened by `quoteMetrics()`: `trade_allowance_prelim`, `trade_allowance_final`, `revision_delta`,
`revision_reason_code`, `basis`, `confirmed_within_deadline` (+ `revision_flagged`, `firm_breach`). Per dealer (`GET /api/admin/trade-honesty`, shown in the
collapsed **"Desk honesty on trade values"** panel on the admin *All quote requests* page): % confirmed as quoted, average revision delta, firm-breach count,
median time to confirm (plus flagged count and % acted within the deadline). **Not shown to buyers or dealers**; a test pins that nothing outside the admin route and panel uses it.

## 6. Data model and audit

Same convention as the rest of the RFQ extensions (JSON on the existing box rows; `dealer_quote_id` = the invite id so it survives a re-quote):

| Spec | Where |
| --- | --- |
| `dealer_trade_appraisal` (+ `basis`, `good_until`, `conditions_text`, `condition_chips[]`, `payoff_used`, `equity_computed`, `allowance_low/high/single`, declined) | `rfq_invites.trade_appraisal_json` (already existed; new keys `conditionChips`, `declined`, `reconfirmedAt`) |
| `trade_confirmation` (`status`, `allowance_prelim/final`, `revision_reason_code/text`, `revision_flagged`, `firm_breach`, `requested_at`, `resolved_at`, `deadline_at`, buyer decision) | `rfq_invites.trade_confirmation_json` (**new**) |
| allowance change log: actor, action, before, after, time | `rfq_trade_audit` table (**new**), `GET /api/admin/rfqs/:id/trade-audit` (admin only) |

Audit actions: `appraisal_set`, `appraisal_updated`, `appraisal_reconfirmed`, `trade_declined`, `confirmation_opened`, `allowance_confirmed`, `allowance_revised`,
`revision_accepted`, `revision_declined_went_back`, `buyer_walked_at_confirm`, `allowance_defaulted_at_deadline`, `confirmation_reopened`.

## Code map

| | |
| --- | --- |
| Rules (pure, shared by box and app) | `scrapers/lightsail-crawler/src/tradeConfirm.js` → typed in `lib/trade/confirm.ts` |
| Box handlers | `scrapers/lightsail-crawler/src/rfqTradeConfirm.js` |
| Box patch (**code only, not run**) | `scripts/box/2026-10-16-rfq-trade-confirm.sh` |
| Quote-time lock | `lib/trade/dealer.ts` (`resolveTradeForQuote`), `lib/trade/quoteTrade.ts` |
| Ranking | `lib/trade/rank.ts`; cells in `components/trade/TradeCompareCells.tsx` |
| Orchestration | `lib/trade/confirmFlow.ts` · routes: `api/rfqs/[id]/pick`, `api/rfqs/[id]/trade-confirm`, `api/quote-invite/trade-confirm`, `api/quote-invite/trade` |
| Dealer UI | `components/trade/TradeAllowanceFields.tsx`, `useDealerTrade.tsx`, `DealerTradePanel.tsx`, `DealerTradeConfirm.tsx` |
| Buyer UI | `components/trade/BuyerTradeConfirm.tsx`, `UsedCompare.tsx`, `LeaseCompare.tsx` |
| Notices | `lib/tradeConfirmNotice.ts` (SAFE MODE sender) + thread events in `lib/dealThread.ts` |
| Tests | `lib/trade/confirm.test.ts`, `quoteCompare.test.tsx`, `confirmFlow.test.ts`, `scripts/box/rfq-trade-confirm.test.mjs` |

## Deploying (needs Paul's GO, as for every box change)

1. Read `docs/BOXES.md`. Order on box2: `2026-10-08-rfq-trade-in.sh` → `2026-10-12-rfq-not-selected.sh` → **`2026-10-16-rfq-trade-confirm.sh`** (installs two modules and restarts the deals API, so: idle window outside 22:00–23:30 ET, no inventory-sync running; the script refuses otherwise; backups are written, rollback is in its header).
2. **Do not merge/deploy the app before the box patch.** The app sends the allowance with every trade-request quote and calls the new endpoints.
3. Optionally set `TRADE_REVISION_THRESHOLD_PCT` / `TRADE_CONFIRM_DEADLINE_HOURS` (defaults 10 / 24).
4. Verify with a test deal: quote with no allowance → 422; quote with one → shows on the compare; pick → dealer sees the confirm step; revise → buyer sees before/after; go back → compare reopens; `GET /api/admin/rfqs/:id/trade-audit`.

## Known limits / decisions

* **Staged Cash/Finance deals** (`FEATURE_DEAL_STAGES`, off by default) select a dealer through `accept_otd` and already have their own trade-offer/counter stage; they do **not** use this confirm step. Dealers still give the allowance with the quote, but the stage's own trade negotiation remains the confirm mechanism there.
* The finance/lease "≈ monthly after trade" is used for **ranking only**; the dealer's monthly is not recomputed on screen (unchanged principle).
* Expiry is applied lazily (when the request or the dealer's page is opened), not by a timer.
* No trade-in sales-tax credit is applied (unchanged; `TODO(tax)` in `lib/trade/otd.ts`).
