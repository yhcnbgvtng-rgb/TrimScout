# Cash / Finance deal stages

After the vehicle links are entered, Step 2 asks one question: **Lease or buy?** Two tiles, neither assumed:
**Lease** (unchanged) and **Cash / Finance** (this document). Both start by getting the dealer's out-the-door
(OTD) price. Cash / Finance then runs in stages, and each stage locks before the next opens:

| # | Stage | Who moves | Locks when | Locked number |
| --- | --- | --- | --- | --- |
| 1 | **Out-the-door price** | Dealer quotes the itemized OTD (selling price + fees + tax + add-ons - rebates). Buyer may counter; dealer accepts or re-quotes (existing counter flow). **No finance terms exist yet.** | Either side accepts: the buyer accepts the quote, or the dealer accepts the buyer's counter. | `otd.amount` |
| 2 | **Trade-in** (only if the buyer said yes) | Dealer offers a trade value. The buyer accepts, or counters **once**; the dealer then accepts the counter or sends **one** revised offer; the buyer accepts or walks. | Buyer accepts the offer, or dealer accepts the counter. | `trade.value`; `trueOtd = otd - trade value`. Estimated sales-tax saving shown where the state credits trade-ins. |
| 3 | **Payment** | Buyer picks **Pay cash** (closes at the true OTD) or **Get financing**: down payment, optional preferred term, and "I have outside financing to compare". The dealer quotes APR + term; the monthly is **computed** from `trueOtd - down` (never typed). Buyer accepts, or still pays cash. | Cash chosen, or financing accepted. Either one closes the deal (the request becomes "picked" with that dealer's quote). | `payment.method`, monthly |

No trade-in: stage 2 is skipped before it opens (`trade.status = "skipped"`), `trueOtd = otd`.

**Walk away:** either side can walk at any stage (`walk`); the deal becomes `walked`, nothing is possible after.
Nothing binds anyone ("a request, not a bid"). **Multi-dealer:** every dealer has their own stage state
(`rfq_invites.stage_json`); the buyer's page, the Deal Tracker and the compare view show each dealer's stage. Closing with
one dealer picks the request; the other dealers' deals end because the request is closed.

## Where the rules live
* `scrapers/lightsail-crawler/src/dealStages.js`: the pure state machine, imported by both the deals server and the app
  (`lib/dealStages.ts`). One copy of every gate. Tests: `scrapers/lightsail-crawler/test/dealStages.test.js`.
* `scrapers/lightsail-crawler/src/rfqStages.js`: the server handler, `POST /api/rfqs/:id/invites/:inviteId/stage`
  `{ action, actor, state? }`. Takes the OTD and tax rate from the stored quote (never from the browser), optimistic-locks
  the write (`stage_json <=> previous`), closes the request on cash / finance accept. Tests: `rfqStages.test.js`.
* Scoped **audit keys** are pinned to their own side (buyer key only acts as `buyer`, test-dealer key only as `dealer`);
  `auditKey.js` allows the route for both with the existing ownership guards.
* App routes: buyer `POST /api/rfqs/:id/invites/:inviteId/stage`, dealer `POST /api/quote-invite/stage` (tracked-link token).
  Each side has an explicit allow-list of actions (`lib/dealStageInput.ts`). Accepting the buyer's OTD counter
  (`/api/quote-invite/accept-counter`) is what locks stage 1 for the dealer.
* UI: `StagedDeals` (buyer, on `/rfq/:id`), `DealerStagePanel` (dealer quote page), `DealStageBar` (shared; also on each
  Deal Tracker card). Staged mode in `UsedCompare` removes the shortcut "Choose this quote" and request-level walk.
* A request is staged when `quotePrefs = { quoteType: "cash", staged: true, ... }`. Older cash / finance requests and all
  lease requests keep their original flows.

## Emails (SAFE MODE)
Each move sends one notice to the other side through the same SAFE MODE sender as every other email (`sendViaResend`
always goes to `SAFE_MODE_RECIPIENT`, subject tagged `[SAFE MODE]`), so real, audit and test deals behave the same.
No contact details are included. Copy: "A request, not a bid."

## Trade tax note
`TRADE_TAX_CREDIT_STATES` in `dealStages.js` is deliberately short (states where a trade-in lowers the taxable amount).
Outside it the app counts no saving and says the dealer's paperwork confirms the tax. Verify per state before extending.
The saving is shown, not subtracted: `trueOtd = otd - trade value`.

## Rollout: the website ships first, the stages stay OFF until the box is patched
The web changes (two-tile Step 2, stage panels, tracker bar) are safe to ship on their own. New "Cash / Finance" requests only
go out **staged** when `FEATURE_DEAL_STAGES` is on (default **off**, `lib/featureFlags.ts`; `/api/rfqs` drops the
`staged` marker otherwise via `gateStagedPrefs`). While it is off, Cash / Finance is the original single cash sheet (the
dealer quotes the OTD, the buyer picks), the wizard does not promise the four stages, and nothing calls the new endpoint.

## Deploy (server part): NOT deployed yet; do this in an idle window, on Paul's GO
1. Confirm idle: no `inventory-sync.mjs` running on any box (`pgrep -f inventory-sync.mjs` on box1-4; the script also
   refuses to run if it is running locally on box2), and outside the 22:00-23:30 ET crawl/sync window.
2. On box2 (deals box) as `ubuntu`:
   ```bash
   curl -fsSL -o 2026-10-11-rfq-deal-stages.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-rfq-deal-stages.sh && bash 2026-10-11-rfq-deal-stages.sh
   ```
   It backs up `deals_api_server.js`, installs `dealStages.js` + `rfqStages.js` next to it, applies five anchored edits
   (import, `stage_json` column, invite mapper, handler, route; each asserts exactly one match, idempotent), runs
   `node --check`, restarts `trimscout-deals-api`, and prints the health status code (401 = up and guarding).
3. Verify: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3004/api/rfqs/1/invites/1/stage` returns 401 without the
   key (route exists; before the patch it is 404). Then, on a SAFE-MODE audit RFQ, run one full path against the box
   (accept OTD, trade offer, accept, choose cash).
4. Only then set `FEATURE_DEAL_STAGES=on` in Vercel and redeploy (~1 min). New Cash / Finance requests are now staged.
5. Rollback: set `FEATURE_DEAL_STAGES` off (new requests revert to the single sheet; requests already staged stop at
   "The staged deal isn't available yet" only if the box is also rolled back). Box rollback:
   `sudo cp /opt/trimscout-deals/src/deals_api_server.js.bak.<STAMP> /opt/trimscout-deals/src/deals_api_server.js && sudo pm2 restart trimscout-deals-api`
   (the added files and the nullable `stage_json` column are harmless to leave).
6. Live-drift caution (BOXES.md): the live server text can differ from the repo mirror. The script asserts its anchors
   and aborts without changing anything if one is missing. It was tested against the mirror both fresh and **after** the
   2026-10-08 trade-in patch (`rfqStages.test.js`). If an anchor is missing on the live file, stop and report; do not force it.
