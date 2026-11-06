# Dealer "My Quotes"

Signed-in dealers see their own quote requests in the dealer portal (**My Quotes** tab). Legacy Leads / My Bids are untouched (cutover later).

## Rules

- **Linked by account, not name.** `rfq_invites.dealer_user_id` (BIGINT, write-once). Set when (a) a dealer signs up with a `quoteInviteToken` from a quote-email link, or (b) a signed-in dealer first opens the token page (`/api/quote-invite/context`). The box bind is `UPDATE ... WHERE dealer_user_id IS NULL`, so an invite is never re-homed. Invites sent before this ships stay unlinked until their dealer next opens the link while signed in.
- **Four chips only:** Needs quoting | In process | Awarded | Not awarded. No Completed (dealers cannot mark completed). Server-derived in `lib/dealerQuotes.ts`:
  - Needs quoting: invited, no live quote (incl. a buyer counter that reopened the invite).
  - In process: quoted, request still open.
  - Awarded: buyer picked this invite's live quote.
  - Not awarded: buyer picked another / walked, desk closed (`notSelectedAt`), declined, expired, or rooftop opted out with no quote.
- **No buyer data.** Rows carry vehicle, TQ- reference, quoted OTD, status, last activity, TEST flag and a link. Stage data is read through `stageForDealer` for activity time only. The box list never selects `buyer_user_id`.
- **Audit.** Audit / forced-safe requests are hidden from real dealers; accounts in `DEALER_TEST_MODE_EMAILS` (server env, comma-separated) see them badged TEST. Unreleased (pending/rejected) requests never appear.
- **Link.** Rows open the existing token page (`/quote-request/received?t=…`), built server-side; the browser gets the URL, not a separate token field.

## Not deployed by this PR

Code only. To go live:

1. Box (deals API, `deals_api_server.js` mirror changed here): adds the `dealer_user_id` column + index on first start, `GET /api/dealer-invites?dealerUserId=&includeAudit=`, `POST /api/rfq-invites/:id/bind-dealer`. The live box file drifts from this mirror, so apply as a box patch anchored on the box's actual text, not by copying the file.
2. Vercel: set `DEALER_TEST_MODE_EMAILS` if test dealers should see audit rows.
3. Until the box is patched, `/api/dealer-quotes` returns 502 ("Could not load your quotes") and the bind calls fail silently (best effort); nothing else changes.

The scoped audit keys stay locked out of both new routes (default deny in `auditKey.js`).
