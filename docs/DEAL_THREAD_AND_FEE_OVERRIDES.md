# Dealer fee overrides and the deal conversation panel

Two changes to the dealer quote / counter screens and the buyer's deal screen. Read `docs/BOXES.md` before touching a box.

## 1. Dealer overrides of TrimScout-calculated fees

On a Cash / Finance sheet TrimScout calculates two lines: **sales tax** (the buyer's ZIP-state rate on selling price + add-ons, the figure the counter sheet already uses) and **title & registration** (`estimateTitleRegistration`: 1.1% of price + $220). The dealer sees TrimScout's amount with an **Edit** button; editing needs the dealer's own amount and a required reason (3–140 characters, for example "county rate 6.875%", "plate transfer"). The **doc fee has no Edit and cannot be overridden** (server refuses it).

- Stored on the quote (`used.feeOverrides`, the box already stores the whole `used` JSON, so **no box change**): `{ key, label, calculated, amount, reason, at }`. The due-at-signing line holds the dealer's amount, so out the door, amount financed, cash due and the monthly all recompute from the lines. The server recomputes `calculated` itself; the browser's copy is ignored. A line that differs from TrimScout's figure without a reason is a 422.
- Buyer: every overridden line in the compare shows a **Dealer adjusted** flag with TrimScout's amount, the dealer's amount, the difference and the reason. The buyer gets one email through the SAFE MODE sender (`sendFeeOverrideNotice`, subject `[SAFE MODE] Dealer adjusted a fee on your quote: …`).
- Price changes: the buyer's counter keeps an overridden sales tax **as the dealer quoted it** (never replaced by TrimScout's figure) and the dealer is still prompted to review tax (`TAX_PROMPT_COPY`), exactly as before. On accepting a counter, an override survives only while its line still equals the dealer's amount.
- Deal event: each override is logged as a `fee_override` row in `rfq_events` through the messages endpoint below. **Until the box patch is applied that single log call 404s and is skipped; the override still saves and the buyer is still emailed.**

## 2. Chat-style conversation panel

`lib/dealThread.ts` builds one thread per dealer from what the deal already stores: the buyer's note, the dealer's quote notes, the buyer's counter and its note, chat messages, and small inline system lines for quotes, counters, accepts, fee overrides and the deal stages (out-the-door lock, trade-in values, payment). Desktop: a panel on the right of the dealer's quote screen (`/quote-request/received`) and the buyer's deal screen (`/rfq/[id]`, one dealer at a time via a picker). Mobile: a slide-up drawer with an unread badge. Auto-scrolls to the newest; compose box at the bottom; polls every 20 s.

- **Isolation:** the builder takes one invite. The dealer route reads the invite behind its own token; the buyer route reads the invite id in the URL after the buyer-ownership check. No route maps over `rfq.invites`.
- **Privacy:** no buyer name, email, phone or id is ever in a thread. Messages with an email, phone or link are refused (client, Next route, and box). Older buyer notes and counter notes that carry one are blanked for the dealer, including after final acceptance: the buyer's details reach the winning dealer only through the dedicated release when the buyer taps "Accept final deal" (`lib/dealStages.ts`, #493), never through a thread. Locking the out-the-door price, a trade value or a payment choice is not final acceptance (`isFinallyAccepted`).
- Read-only (with the reason shown) on a walked request, a closed/declined desk, or after the dealer left TrimScout.
- No email is sent per chat message (in-app only: polling + the unread badge).

## Box deploy (deals-api): needed only to *send* chat messages and to log the override event

Everything above reads and works without it; the compose box says "Sending messages isn't available yet" until the patch is in.

**Do not run without Paul's GO, in an idle window (no inventory sync running — the script refuses if one is).** Run on the deals box as `ubuntu`. Needs the 2026-10-11 deal-stages patch (`2026-10-11-rfq-deal-stages.sh`) already applied; the script asserts and changes nothing otherwise.

1. Dry run against a **copy** of the live file (no sudo, no pm2, nothing copied):
   ```bash
   cp /opt/trimscout-deals/src/deals_api_server.js /tmp/deals_api_server.copy.js
   TEST_ONLY=1 FILE=/tmp/deals_api_server.copy.js bash 2026-10-11-rfq-messages.sh
   ```
   Expect `applied: import, column, invite mapper, handler, route` and `syntax ok`. If an anchor assertion fails, stop — the live file has drifted (see `docs/BOXES.md` "Known drift"); do not force it.
2. Confirm idle: `pgrep -f inventory-sync.mjs` prints nothing.
3. Apply for real:
   ```bash
   curl -fsSL -o 2026-10-11-rfq-messages.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-rfq-messages.sh && bash 2026-10-11-rfq-messages.sh
   ```
   It backs up the file, installs `src/rfqMessages.js`, makes four anchored edits (import, `rfq_invites.messages_json TEXT NULL` column, `messages` on the invite mapper, the `POST /api/rfqs/:id/invites/:inviteId/messages` route), runs `node --check`, restarts `trimscout-deals-api`, and prints the health status (401 means up).
4. Verify: a buyer message and a dealer message on a test request appear in each other's panel, never on another dealer's; a message containing a phone number is refused; submit a quote with an overridden tax and confirm a `fee_override` row in `rfq_events`.
5. Rollback: restore the printed `deals_api_server.js.bak.<stamp>` and `sudo pm2 restart trimscout-deals-api`. The column is harmless to leave.
