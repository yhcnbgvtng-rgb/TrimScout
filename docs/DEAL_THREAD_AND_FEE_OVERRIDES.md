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
- **Privacy:** no buyer name, email, phone or id is ever in a thread. Messages are refused (client, Next route, and box — one shared rule set, `identityFilter.js`) if they contain a name or introduction, an email, a phone number in any form (digits, spelled out, split up, "double five"), a street address, a link, or any social/messaging platform (Instagram, Meta, Facebook, Twitter/X, WhatsApp, Snapchat, TikTok, Discord, ...). Older buyer notes and counter notes that trip the same filter are blanked for the dealer, including after final acceptance: the buyer's details reach the winning dealer only through the dedicated release when the buyer taps "Accept final deal" (`lib/dealStages.ts`, #493), never through a thread. Locking the out-the-door price, a trade value or a payment choice is not final acceptance (`isFinallyAccepted`).
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
   It backs up the file, installs `src/rfqMessages.js` and `src/identityFilter.js`, makes four anchored edits (import, `rfq_invites.messages_json TEXT NULL` column, `messages` on the invite mapper, the `POST /api/rfqs/:id/invites/:inviteId/messages` route), runs `node --check`, restarts `trimscout-deals-api`, and prints the health status (401 means up).
4. Verify: a buyer message and a dealer message on a test request appear in each other's panel, never on another dealer's; a message containing a phone number is refused; submit a quote with an overridden tax and confirm a `fee_override` row in `rfq_events`.
5. Rollback: restore the printed `deals_api_server.js.bak.<stamp>` and `sudo pm2 restart trimscout-deals-api`. The column is harmless to leave.

---

# Conversation identity guard (hardening of the thread filter)

One module, `scrapers/lightsail-crawler/src/identityFilter.js`, is the only rule set: the Next app (`lib/identityFilter.ts`) and the deals server (`rfqMessages.js`) both import it. The box is the authority (it screens, logs strikes and enforces pauses); the Next routes only forward, run the AI check and send the email.

**What is refused** (the sender sees only "This message wasn't sent because it looks like contact information." The blocked text is never shown to the other side and never stored in the attempts log):
- *Normalization first:* Unicode look-alikes (Cyrillic/Greek homoglyphs, fullwidth, math and circled digits, emoji keycap digits, other-script digits, zero-width characters), spaced/dotted/dashed characters rejoined, and number words converted to digits ("five five five", "double five", "triple seven", "oh" beside digits, "5ive"). Every rule runs on the raw text and on each normalized view.
- *Rules:* names and introductions, phone numbers (any form), emails (including "at gmail dot com"), handles, social/messaging platforms (Instagram, Meta, Facebook, Twitter/X, WhatsApp, ...), street addresses, any link except `trimscout.com`, and images or files (the request is rejected; there are no attachments in chat). Prices, VINs, stock numbers, APRs, dates and mileage pass.
- *Across messages:* the sender's last 5 delivered messages joined together are checked; the message that completes a phone number, email or handle is refused (the earlier ones stay delivered; the refused one counts as an attempt).
- *Borderline:* a message that clears every rule but scores above `RISK_THRESHOLD` (digit density, odd spacing, mixed letters and numbers, look-alike characters, number words, a plain 7-9 digit token) is held and sent to a 3-second yes/no AI check. Yes: blocked. No: delivered. Error, timeout, no key or a garbled answer: **held for an admin, not delivered**.

**Strikes** (dealers only; keyed on the rooftop name, so a pause covers every deal): every blocked or held-then-blocked or reported-then-blocked message is logged without its text. The first attempt shows the dealer a visible warning. The 3rd in 30 days pauses that dealer's chat on all deals and emails Paul through the SAFE MODE sender. An admin lifts the pause (attempts before the lift stop counting).

**Admin:** `/admin/chat-review` lists held messages and buyer reports with **Release** and **Block** (held: Release delivers, Block counts as an attempt; reported: Release dismisses, Block hides the message for both sides and counts as an attempt), and the paused dealers with **Lift pause**.

**Buyer:** every dealer chat message has a **Report** flag that sends it to the admin queue (it stays visible until an admin blocks it). **Both sides** see, above the compose box: "Contact details are shared automatically when the buyer accepts the final deal. Sharing them earlier breaks TrimScout's terms."

**Env vars:** `ANTHROPIC_API_KEY` (existing; without it every borderline message goes to the admin queue), optional `CHAT_AI_REVIEW=off` (never call the AI; always queue) and optional `CHAT_AI_REVIEW_MODEL` (default `claude-haiku-4-5-20251001`). Nothing new is required.

## Box deploy: layer on top of the rfq-messages patch (`2026-10-11-rfq-messages.sh`)

**Needs Paul's GO, in an idle window (no inventory sync; the script refuses if one runs). Requires `2026-10-11-rfq-messages.sh` to be applied first** (the script asserts and changes nothing otherwise). **Deploy the app first** (this PR merged and live on Vercel): the box's message response changes shape and older app code only reads `message`.

1. Dry run against a **copy** of the live file:
   ```bash
   cp /opt/trimscout-deals/src/deals_api_server.js /tmp/deals_api_server.copy.js
   TEST_ONLY=1 FILE=/tmp/deals_api_server.copy.js bash 2026-10-12-rfq-chat-guard.sh
   ```
   Expect `applied: import, handler, routes` and `syntax ok`. An anchor assertion failure means the live file drifted: stop.
2. `pgrep -f inventory-sync.mjs` prints nothing.
3. Apply:
   ```bash
   curl -fsSL -o 2026-10-12-rfq-chat-guard.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-12-rfq-chat-guard.sh && bash 2026-10-12-rfq-chat-guard.sh
   ```
   It backs up the server file and the two modules it replaces, installs `identityFilter.js`, `rfqChatGuard.js`, `rfqMessages.js`, `rfqChatAdmin.js`, adds the five routes, runs `node --check`, restarts `trimscout-deals-api`, and prints the health status (401 = up). The three tables (`rfq_chat_attempts`, `rfq_chat_review`, `rfq_chat_pauses`) are created on first use with `CREATE TABLE IF NOT EXISTS`; no existing table is touched.
4. Verify on a test request: a message with a phone number is refused with the plain note and logged (no text); a dealer's first refused message shows the warning; split a number across messages and the completing one is refused; `/admin/chat-review` loads; a buyer Report appears there; Release/Block work.
5. Rollback: restore the printed `.bak.<stamp>` files (`deals_api_server.js`, `identityFilter.js`, `rfqMessages.js`) and `sudo pm2 restart trimscout-deals-api`. The tables are harmless to leave.
