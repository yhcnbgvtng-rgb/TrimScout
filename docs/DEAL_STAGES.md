# Cash / Finance deal stages

After the vehicle links are entered, Step 2 asks one question: **Lease or buy?** Two tiles, neither assumed:
**Lease** (unchanged) and **Cash / Finance** (this document). Both start by getting the dealer's out-the-door
(OTD) price. Cash / Finance then runs in four stages, and each stage locks before the next opens:

| # | Stage | Who moves | Locks when | Locked number |
| --- | --- | --- | --- | --- |
| 1 | **Out-the-door price** | Dealer quotes the itemized OTD (selling price + fees + tax + add-ons - rebates). Buyer may counter; dealer accepts or re-quotes (existing counter flow). **No finance terms exist yet.** | Either side accepts: the buyer accepts the quote, or the dealer accepts the buyer's counter. | `otd.amount` |
| 2 | **Trade-in** (only if the buyer said yes) | Dealer offers a trade value. The buyer **accepts, or counters** (own number + optional note, always higher than the offer); the dealer **accepts, revises or holds firm**; the buyer answers again; **it repeats until both sides agree.** | Buyer accepts the offer, or dealer accepts the counter. | `trade.value`; `trueOtd = otd - trade value + payoff` (payoff = the buyer's stated payoff on the trade-in, read by the server). Shown **live** while negotiating ("if you accept: ..."). |
| 3 | **Payment** | The buyer picks ONE of: **Paying cash**; **Bringing my own financing** (optional lender name, no rate); **Get a financing offer from the dealer** (down payment, term 36/48/60/72, optional credit range, "I have outside financing to compare"). For a dealer offer the dealer sends **APR + term + lender**; the **monthly and amount financed are computed** from `trueOtd - down` and any value the dealer submits with them must match (else `math_mismatch`). The buyer **accepts or counters the APR (and term)**; the dealer **accepts, revises or holds firm**; repeat until agreed. | Cash chosen, own financing chosen, or the financing terms agreed. | `payment.method`, and for dealer financing `financeQuote` (APR, term, monthly, amount financed, lender). |
| 4 | **Final deal** | The buyer sees a summary (vehicle, OTD, trade, payoff, true OTD, payment method, and APR / term / monthly / amount financed / lender when financed) and taps **Accept final deal**. Until then "Change how I pay" steps back to stage 3. | The buyer accepts. The request becomes "picked" with this dealer's quote. | `final.summary`; **`release`** (below). |

No trade-in: stage 2 is skipped before it opens (`trade.status = "skipped"`), `trueOtd = otd`.
**Add your trade-in after accepting:** with the OTD locked and payment not yet started, the buyer can still add a trade-in
(`add_trade`): stage 2 re-opens, the OTD stays locked, and the dealer's offer reaches the true OTD. `skip_trade` carries on without
one when a trade was expected but no offer exists yet. Other dealers are told "not selected" and their deals close: see `docs/NOT_SELECTED_NOTICE.md`.

**Walk away:** either side can walk at any stage (`walk`); the deal becomes `walked`, nothing is possible after.
Nothing binds anyone ("a request, not a bid"). **Multi-dealer:** every dealer has their own stage state
(`rfq_invites.stage_json`); the buyer's page, the Deal Tracker and the compare view show each dealer's stage. The buyer's
acceptance of the OTD picks the dealer (the others are closed out, see `NOT_SELECTED_NOTICE.md`); final acceptance closes the request.

## Buyer details release (final acceptance only)
* **Before** `accept_final`, no dealer ever receives the buyer's name, email, phone or ZIP-as-contact from this flow: not in a
  stage notice email, not in the dealer page's stage state (`stageForDealer`), not in any event log, not in any action the dealer can send.
* The buyer's browser cannot send them. The buyer route (`/api/rfqs/:id/invites/:inviteId/stage`) assembles them from the signed-in
  buyer (name, email, phone from the account; ZIP from the request; guests: their email) **only when the action is `accept_final`**
  and passes them to the box as `buyerContact`; the box ignores them for any other action or any actor but the buyer.
* They are stored on the **winning invite's** `stage_json.release` and nowhere else. Losing dealers' invites have no release, and
  `stageForDealer(state, { notSelected })` drops it for a closed-out dealer regardless.
* The winning dealer sees them on their quote page (block `buyer-details`) and gets one email, **"Deal accepted, here's your buyer"**
  (`buildBuyerDetailsEmail`), sent by `sendBuyerDetailsRelease` in the invite outbox after the response. It goes through the SAFE MODE
  sender, which has no `to` parameter: SAFE MODE, `audit=1` and buyer-test-mode deals all send **only to pausmi@outlook.com**
  (subject tagged `[SAFE MODE · <dealer>]`). It also respects the release gate and the outbound-email switch.
* Logged as stage events: every `trade_counter`, `trade_hold`, `finance_counter`, `finance_hold`, accept, and the release
  (`buyer_details_released`: that it happened and for which dealer; never the details).
* A dealer whose quote is closed (not selected) can do nothing but walk away.

## Where the rules live
* `scrapers/lightsail-crawler/src/dealStages.js`: the pure state machine, imported by both the deals server and the app
  (`lib/dealStages.ts`). One copy of every gate. Tests: `scrapers/lightsail-crawler/test/dealStages.test.js`.
* `scrapers/lightsail-crawler/src/rfqStages.js`: the server handler, `POST /api/rfqs/:id/invites/:inviteId/stage`
  `{ action, actor, state?, buyerContact? }`. Takes the OTD, tax rate and trade payoff from what is stored (never from the browser),
  optimistic-locks the write (`stage_json <=> previous`), closes the request on `accept_final`. Tests: `rfqStages.test.js`.
* Scoped **audit keys** are pinned to their own side (buyer key only acts as `buyer`, test-dealer key only as `dealer`);
  `auditKey.js` allows the route for both with the existing ownership guards.
* App routes: buyer `POST /api/rfqs/:id/invites/:inviteId/stage`, dealer `POST /api/quote-invite/stage` (tracked-link token).
  Each side has an explicit allow-list of actions (`lib/dealStageInput.ts`). Accepting the buyer's OTD counter
  (`/api/quote-invite/accept-counter`) is what locks stage 1 for the dealer.
* UI: `StagedDeals` (buyer, on `/rfq/:id`; includes the final review), `DealerStagePanel` (dealer quote page), `DealStageBar` (shared, four steps, wraps to two columns on a phone; also on each
  Deal Tracker card). Tests: `lib/dealStages.test.tsx`, `lib/buyerRelease.test.tsx`. Staged mode in `UsedCompare` removes the shortcut "Choose this quote" and request-level walk.
* A request is staged when `quotePrefs = { quoteType: "cash", staged: true, ... }`. Older cash / finance requests and all
  lease requests keep their original flows.

## Emails (SAFE MODE)
Each move sends one notice to the other side through the same SAFE MODE sender as every other email (`sendViaResend`
always goes to `SAFE_MODE_RECIPIENT`, subject tagged `[SAFE MODE]`), so real, audit and test deals behave the same.
No stage notice includes contact details. The single exception is the "Deal accepted, here's your buyer" email after final acceptance (above). Copy: "A request, not a bid."

## Trade tax note
No tax amount is shown. After the trade locks, buyer and dealer see "Trade-in may lower your sales tax — dealer will confirm"
(and the email says the same). `TRADE_TAX_CREDIT_STATES` / `tradeTaxSavings` remain in `dealStages.js` only as unverified
data and are not displayed; verify each state from an official source before ever using them. `trueOtd = otd - trade value`.

## Rollout: the website ships first, the stages stay OFF until the box is patched
The web changes (two-tile Step 2, stage panels, tracker bar) are safe to ship on their own. New "Cash / Finance" requests only
go out **staged** when `FEATURE_DEAL_STAGES` is on (default **off**, `lib/featureFlags.ts`; `/api/rfqs` drops the
`staged` marker otherwise via `gateStagedPrefs`). While it is off, Cash / Finance is the original single cash sheet (the
dealer quotes the OTD, the buyer picks), the wizard does not promise the four stages, and nothing calls the new endpoint.

## Deploy (second half: trade counter loop, payment choice, financing offer, final acceptance, release)
Run **after** the trade-in (#414, `2026-10-08-rfq-trade-in.sh`), stage (#482, `2026-10-11-rfq-deal-stages.sh`) and not-selected
(#490, `2026-10-12-rfq-not-selected.sh`) patches, in that order. This one is `scripts/box/2026-10-13-rfq-deal-stages-v2.sh`: it installs
`dealStages.js` + `rfqStages.js` only (no edits to `deals_api_server.js`, no schema change), refuses to run if an earlier patch is missing
or inventory-sync is running, and restarts `trimscout-deals-api` once. **Idle window (outside 22:00-23:30 ET), on Paul's GO.**
1. `pgrep -f inventory-sync.mjs` on box1-4 returns nothing; it is outside the crawl/sync window.
2. On box2 as `ubuntu`:
   ```bash
   curl -fsSL -o 2026-10-13-rfq-deal-stages-v2.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-13-rfq-deal-stages-v2.sh && bash 2026-10-13-rfq-deal-stages-v2.sh
   ```
   It prints `installed ...` for both modules, `syntax ok`, the health code and the stage-route code (both **401** = up and guarding).
3. Verify on a SAFE-MODE audit RFQ with a trade-in: accept the OTD, run one trade counter and a hold, agree it, choose "Get a financing
   offer", counter the APR, agree, tap **Accept final deal**. Check: the request is `picked`, the dealer's page shows the buyer block,
   one `[SAFE MODE · ...] Deal accepted, here's your buyer` email arrives at pausmi@outlook.com, `rfq_events` has `buyer_details_released`
   with no contact in its payload, and the other dealers' pages show nothing.
4. Only then set `FEATURE_DEAL_STAGES=on` in Vercel and redeploy. **The feature stays behind that flag**: while it is off, new Cash /
   Finance requests are the original single cash sheet and nothing here is reachable.
5. Rollback: flag off; box: `for m in dealStages.js rfqStages.js; do sudo cp /opt/trimscout-deals/src/$m.bak.<STAMP> /opt/trimscout-deals/src/$m; done; sudo pm2 restart trimscout-deals-api`.
   Stage JSON written by v2 (`v: 2`) is read by v1 only up to stage 3; do not roll back after real deals reached stage 4.

## Deploy (first half, #482): NOT deployed yet; do this in an idle window, on Paul's GO
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
