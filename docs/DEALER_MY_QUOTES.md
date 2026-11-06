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
This PR ships `scrapers/lightsail-crawler/src/rfqDealerInvites.js` only; `deals_api_server.js` is deliberately NOT edited here
(its md5 is pinned by `docs/box-patches/2026-10-27-sweep-guards`). The install step adds the wiring and regenerates the md5s
with that package's `make-patches.sh`. Wiring to add (import, handler, two routes, column + index in `ensureQuotePackageColumns`):

```diff
@@ -39,6 +39,7 @@ import { createRfqStageHandler } from "./rfqStages.js";
 import { createRfqMessagesHandler } from "./rfqMessages.js";
 import { createChatAdminHandlers } from "./rfqChatAdmin.js";
 import { createRfqNotSelectedHandler } from "./rfqNotSelected.js";
+import { createDealerInvitesHandlers } from "./rfqDealerInvites.js";
 import { createStableCache, builtForOtherBuild } from "./stableCache.js";
 import { createStatsCache, warmStatsCache } from "./statsCache.js";
 import { createInventoryStats } from "./inventoryStats.js";
@@ -1292,6 +1293,8 @@ async function ensureQuotePackageColumns(pool) {
   await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS sent_at DATETIME NULL");
   await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS viewed_at DATETIME NULL");
   await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS view_token VARCHAR(64) NULL");
+  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS dealer_user_id VARCHAR(128) NULL");
+  await pool.query("CREATE INDEX IF NOT EXISTS idx_rfq_invites_dealer_user ON rfq_invites (dealer_user_id)");
   await pool.query("CREATE INDEX IF NOT EXISTS idx_rfq_invites_view_token ON rfq_invites (view_token)");
   await pool.query("CREATE INDEX IF NOT EXISTS idx_rfq_invites_contact_email ON rfq_invites (dealer_contact_email)");
   quotePackageColumnsEnsured = true;
@@ -1603,6 +1606,13 @@ const handleRfqNotSelected = createRfqNotSelectedHandler({
   logRfqEvent,
 });
 
+// GET /api/dealer-invites?dealerUserId=… and POST /api/dealer-invites/claim — dealer "My Quotes" (rfqDealerInvites.js).
+const dealerInvites = createDealerInvitesHandlers({
+  getPool, readBody, sendJson,
+  ensureColumns: ensureQuotePackageColumns,
+  loadTestDealers,
+});
+
 // POST /api/rfqs/:id/invites/:inviteId/stage — one action on the staged Cash / Finance deal (rules: dealStages.js).
 const handleRfqStage = createRfqStageHandler({
   getPool, readBody, sendJson,
@@ -4178,6 +4188,8 @@ if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return
   if (req.method === "GET" && rfqInviteTokenMatch) {
     return run(handleRfqInviteByToken, rfqInviteTokenMatch[1]);
   }
+  if (req.method === "GET" && pathname === "/api/dealer-invites") return run(dealerInvites.list, url.searchParams);
+  if (req.method === "POST" && pathname === "/api/dealer-invites/claim") return run(dealerInvites.claim);
   const rfqInviteNotSelectedMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/not-selected$/);
   if (req.method === "POST" && rfqInviteNotSelectedMatch) {
     return run(handleRfqNotSelected, Number(rfqInviteNotSelectedMatch[1]), Number(rfqInviteNotSelectedMatch[2]));
```

The live box drifts from the mirror: anchor a patcher on the box's real text and dry-run it on a copy first. Existing invites
have no `dealer_user_id`, so the tab is empty for a dealer until they open a link while signed in.
