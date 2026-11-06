# Dealer "My Quotes" (code only, not installed)

Signed-in dealer tracker: Needs quoting | In process | Awarded | Not awarded. No "Completed" (dealers cannot mark a sale done).

- **Link:** `rfq_invites.dealer_user_id`, set the first time a signed-in dealer account opens the invite's tracked link
  (`/api/quote-invite/context` -> box `POST /api/dealer-invites/claim`). First account wins; a different account gets 409.
  There is no dealer-name listing: an invite never linked to the account is not shown.
- **List:** app `GET /api/dealer-quotes` (dealer session, else 401) -> box `GET /api/dealer-invites?dealerUserId=`.
  Status is derived in `lib/dealerQuotes.ts`. The stage is the dealer view only; buyer contact never leaves the box.
  The app returns a link (`/quote-request/received?t=…`), never the token as a field.
- **Audit / SAFE MODE:** audit RFQs are shown only to `is_test` dealers (TEST badge); a real dealer never sees one.
  No email path is touched.
- **Legacy:** the Leads and My Bids tabs are untouched (cutover later).

## Box install (NOT done — needs Paul's GO, read docs/BOXES.md first)
New file `scrapers/lightsail-crawler/src/rfqDealerInvites.js` + 12 lines in `deals_api_server.js` (import, handler, two routes,
`ALTER TABLE rfq_invites ADD COLUMN dealer_user_id` + index inside `ensureQuotePackageColumns`). The live box server drifts from
this mirror: anchor a patcher on the box's actual text and dry-run it on a copy first. Existing invites have no `dealer_user_id`,
so the tab is empty for a dealer until they open a link while signed in.
