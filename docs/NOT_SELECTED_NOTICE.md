# Buyer accepts a dealer: "not selected" notes, closed quotes, and "Add your trade-in"

Code only. Nothing here is live until the box patch is run (see **Box deploy**). Works for Lease and Cash / Finance.

## What "accepts" means
* **Lease / single-sheet cash:** the buyer's "Choose this quote" (`POST /api/rfqs/:id/pick`).
* **Staged Cash / Finance (#482):** the buyer's `accept_otd` on one dealer (`POST /api/rfqs/:id/invites/:inviteId/stage`).
  Also a dealer accepting the buyer's OTD counter (`POST /api/quote-invite/accept-counter`), once that locks the stage.

## 1. The "not selected this time" note
Sent once to every other invited dealer, after the response (Next `after()`), through the existing invite outbox
(`lib/inviteOutbox.ts` `closeOutLosers` / `sendNotSelectedNotice`):

* Skipped: the winner, dealers who walked away, declined, expired, unsubscribed, or were already told.
* **Exactly once:** the box keeps the books (`rfq_invites.not_selected_*`). `claim` is atomic (one caller gets `claimed: true`),
  `sent` stamps it for good, a failed send `release`s the claim for a retry, and a claim older than 10 minutes (sender died) can be taken
  again. The one residual risk: a send that succeeded but whose `sent` stamp then failed can be re-sent after the lease.
* **Outbox rules apply:** an unreleased (admin-gated) request sends nothing and closes nothing; with the outbound-dealer-email switch off the
  quote still **closes** but the note is parked, and the next accept/drain pass sends it.
* **SAFE MODE:** the sender (`sendQuoteInviteEmail`) has no recipient argument and always posts to `pausmi@outlook.com`, for normal,
  `audit=1` and test-mode requests alike. Subject and body carry a `[SAFE MODE · Dealer name]` tag so the review inbox shows who it was for.
  Remove that tag together with the SAFE MODE override.
* No details of the winning quote or the buyer: no price, no winner name, no buyer, no links.

### Email copy (for review)
Subject: `Not selected this time (TS-ABC234): 2026 Toyota RAV4 XLE`

> Hi Sam,
>
> Thank you for quoting on the **2026 Toyota RAV4 XLE** (deal TS-ABC234). The buyer has decided to go another way this time, so your quote is now closed and there is nothing more for you to do.
>
> We appreciate the time you put in, and we hope to send you another request soon.
>
> *This is a courtesy note from TrimScout. There is nothing to reply to.*

(Plus the standard TrimScout header; greeting uses the desk contact's first name, or the team for a shared inbox.)
Copy lives in `lib/quoteInviteEmail.ts` (`notSelectedSubject`, `notSelectedHtml`).

## 2. Closed quotes
`rfq_invites.not_selected_at` marks the desk. The app and the box both refuse, for that desk: buyer counters, new or revised quotes
(lease, used/cash), accepting a counter, picking the quote, and every stage move except **walking away**. The Deal Tracker, compare views and staged cards show
"Not selected"; the Counter button is gone.

## 3. "Add your trade-in" right after acceptance
`components/AddTradeInPrompt.tsx` on the buyer's request page, shown once a dealer is accepted and the request has no trade-in:

* Reuses the #414 trade-in form (VIN, year/make/model/trim, mileage, condition, ownership and payoff, six photos). Skip button.
* The accepted OTD (or lease quote) **stays locked**. Submitting goes to `POST /api/rfqs/:id/trade-in { draftId, token }`, which verifies the
  draft exactly as at send time (whole record + six photos in storage), attaches it, and tells the winning dealer (SAFE MODE) to offer a value.
* **Cash / Finance:** new state-machine actions in `dealStages.js`: `add_trade` re-opens the trade stage with the OTD still locked, so the dealer's
  `trade_offer` reaches the true OTD (`true OTD = locked OTD - trade value`, as in #482). `skip_trade` (only when a trade was expected and
  no offer exists yet) moves on to payment at the locked OTD. Refused once cash was chosen or financing requested.
* **Lease:** the request is already "picked"; the trade attaches to it and the winner appraises it (equity lands on the cap cost, `lib/trade/otd.ts`).
  Only the winner may appraise after a pick (`dealerMayAppraise`).
* Skip when no trade stage is open is remembered per browser (localStorage), nothing is stored on the box.

## Box deploy (next idle window, ON PAUL'S GO; deals-api restart on box2)
Prereqs on box2: `2026-10-08-rfq-trade-in.sh` and `2026-10-11-rfq-deal-stages.sh` applied (each is idempotent; the new patch aborts with a clear message
if the stages patch is missing and skips the trade-after-acceptance part, with a notice, if the trade patch is missing).

1. Confirm idle: no `inventory-sync.mjs` running (the script refuses otherwise) and no crawl chain mid-sync on box2.
2. `ssh ubuntu@<box2>` (see `docs/BOXES.md`), then:
   ```bash
   curl -fsSL -o 2026-10-12-rfq-not-selected.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-12-rfq-not-selected.sh && bash 2026-10-12-rfq-not-selected.sh
   ```
   It backs up `deals_api_server.js`, installs `rfqNotSelected.js`, `dealStages.js`, `rfqStages.js`, applies anchored edits (asserted exactly-once),
   `node --check`s, restarts pm2 `trimscout-deals-api`, and probes `/health` (401 = up).
3. Verify (use an `audit=1` / test-mode request only):
   * `POST /api/rfqs/:id/invites/:inviteId/not-selected {"step":"close"}` on a loser returns 200 and the invite now shows `notSelectedAt`; on the accepted dealer returns 409 `accepted`.
   * `claim` twice: first `claimed:true`, second `false`; `sent`, then `claim` again: `false`.
   * Counter / used-quote POST on the closed desk returns 409.
   * Accept a dealer on a test request: exactly one `[SAFE MODE · …] Not selected this time` per other dealer lands at pausmi@outlook.com.
   * Add a trade-in on a picked (lease) test request: 200; before the patch it was 409 `closed`.
4. Rollback: `sudo cp /opt/trimscout-deals/src/deals_api_server.js.bak.<stamp> /opt/trimscout-deals/src/deals_api_server.js && sudo pm2 restart trimscout-deals-api`. The added columns are nullable and harmless to leave.
5. Until step 2 is done the app still works: the pick/accept succeed, the close-out calls fail quietly (best effort) and no note is sent. Deploy the site and the box patch in either order.

## Not covered
* Deals box SQL is only exercised on the box (tests use an in-memory fake of the same statements).
