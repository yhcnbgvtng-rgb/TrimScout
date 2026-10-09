# Audit API (scoped key for TrimScout's AI auditor)

Two scoped API keys on the deals API (`scrapers/lightsail-crawler/src/deals_api_server.js`) that together run a full end-to-end test without ever touching a real dealer or a real RFQ:

- **Buyer audit key** (`TRIMSCOUT_AUDIT_API_KEY`) acts as **one test buyer** (`TRIMSCOUT_AUDIT_BUYER_USER_ID`).
- **Test-dealer audit key** (`TRIMSCOUT_AUDIT_DEALER_KEY`) acts as the **three test dealerships** (`dealership_contacts.is_test = 1`).

Policy lives in `scrapers/lightsail-crawler/src/auditKey.js`, checked in `requireAuth` plus a route gate at the top of the request handler.

Status: **code only — not deployed.** Nothing here is live until the box deploy (bottom of this doc).

## Auth

Send the key exactly like the shared key:

```
X-Trimscout-Api-Key: <audit key>
```

The box needs `TRIMSCOUT_AUDIT_API_KEY` **and** `TRIMSCOUT_AUDIT_BUYER_USER_ID` for the buyer key, and `TRIMSCOUT_AUDIT_DEALER_KEY` for the dealer key. A scoped key is rejected (401) if its config is incomplete or if it equals any other key — it never silently degrades to full access. Each key has its own 60-requests-per-minute bucket.

| Situation | Status |
|---|---|
| Missing / wrong key | 401 |
| Route not in the list below (any verb), or another buyer's data | **403** |
| More than 60 requests in a rolling minute (denied calls count) | 429 + `Retry-After` |

Default deny: a route added to the server later is closed to this key until it is added to `AUDIT_ROUTES`.

## Guarantees

- **Nothing real is reachable.** The buyer key only sees `audit = 1` rows it owns. The dealer key only reaches invites on an `audit_forced_safe` RFQ whose dealer is an `is_test` dealership (name **and** email must match the same test row). A real dealer, a real RFQ, or a real request/bid is a 403 on every verb — pinned by tests that point both keys at real ids across every route the server defines.
- **Invites are fenced for every key (including the full key).** `POST /api/rfqs/:id/invites`: an audit RFQ can only invite `is_test` dealers, and an `is_test` dealer can only be invited to an audit RFQ. Likewise bids: an audit request only takes bids from test dealers and test dealers only bid on audit requests.
- **Test dealers are invisible to the real directory** (`GET /api/dealerships` on the auth API filters `is_test = 0`), so real buyers and the real invite flow never see them.
- **Every record carries `audit = 1`.** RFQs, deal requests, bids, quotes, deals — and children inherit it: invites, quotes and `rfq_events` from their RFQ, bids from their request. `audit_at` records when, `deleted_at` is the soft delete.
- **Left out of the real world.** The dealer-matching list (`GET /api/deal-requests` as the full key) returns `audit = 0` only unless `?includeAudit=1`. Dealer dashboards (`/api/dealer-bids`, `/api/dealer-won-deals`), dealer responsiveness and the per-request market exclude audit rows. Ops metrics counters (`email_*`) skip audit RFQs. Offline metric queries on `rfq_events` should add `WHERE audit = 0`. The admin RFQ desk still lists audit RFQs (flagged `audit: true`) because an admin has to release them.
- **All email stays on SAFE MODE.** RFQs the buyer key creates are `audit_forced_safe = 1` (`auditForcedSafeMode: true`) and start `approvalStatus: "pending"`. The outbox never hands a dealer address to the sender for them, so mail can only go to `pausmi@outlook.com`. Test-dealer addresses are on the reserved `.test` TLD as a second layer.
- **Never allowed to either key:** `mark-paid` and the rest of `/api/deals/*` after creation, every `/api/ops/*` route, admin routes (approval, patch, invite create/delete, delivery), `pick`/`walk`, inventory writes/export/stats.
- **Logged.** One JSON line per call: `{"audit_key":true,"key":"audit"|"audit_dealer","at":…,"route":"GET /api/rfqs/:id","status":200,"ms":3}`. Route template and status only — no key, ids, tokens or query string.

## Allowed endpoints

### Create a test RFQ — `POST /api/rfqs`

`buyerUserId` may be omitted; if sent it must equal the test buyer (else 403). Body shape is `handleCreateRfq`'s:

```jsonc
{
  "vin": "WP0AB2A96NS123456",          // required unless lane = "alternate"
  "vehicleYear": 2026,
  "vehicleMake": "Porsche",
  "vehicleModel": "911",
  "vehicleTrim": "Carrera",             // required for packageKind "match"
  "stockNumber": "P1234",               // optional
  "packageKind": "match" | "links",     // default "match"
  "mustHaves": [{ "code": "X", "name": "Sport Chrono", "status": "hit" }],  // "match": non-empty, every status "hit"
  "linkPastes": [ /* "links": 1–3 resolved links */ ],
  "lane": "same_spec" | "alternate",    // alternate needs "alternateAsk": {…} and no VIN
  "quotePrefs": { "quoteType": "cash", "cash": { "zip": "07405", "timeline": "this_month" } },
  "leasePrefs": { … },
  "buyerNote": "string ≤ 1000",
  "tradeInExpected": false,
  "dealReference": "TS-ABC123"
}
```

`201` → `{ "rfq": RFQ }`

### Read RFQs

- `GET /api/rfqs?buyerUserId=<test buyer>` → `{ "rfqs": [RFQ] }` (`all` and `approval` params are rejected)
- `GET /api/rfqs/:id` → `{ "rfq": RFQ }` (403 unless it is the test buyer's)

```jsonc
// RFQ  (publicRfqRequest)
{
  "id": "17", "buyerUserId": "9001",
  "vin": "…", "stockNumber": null, "vehicleYear": 2026, "vehicleMake": "…", "vehicleModel": "…", "vehicleTrim": "…",
  "mustHaves": [], "linkPastes": [], "packageKind": "match", "lane": "same_spec", "alternateAsk": null,
  "quotePrefs": null, "leasePrefs": null, "buyerNote": null, "tradeInExpected": null, "dealReference": null,
  "status": "collecting", "pickedQuoteId": null, "createdAt": "…",
  "approvalStatus": "pending" | "approved" | "rejected", "rejectionReason": null,
  "auditForcedSafeMode": true,
  "invites": [ /* publicRfqInvite: per-desk status + current quote + priorQuotes */ ]
}
```

### Bid / request reads

- `GET /api/deal-requests?buyerUserId=<test buyer>[&status=active]` → `{ "dealRequests": [DealRequest] }`
- `GET /api/deal-requests/:id` → `{ "dealRequest": DealRequest }`
- `GET /api/deal-requests/:id/bids` → `{ "bids": [Bid] }`, ranked best-first
- `GET /api/deal-requests/:id/bids/:bidId` → `{ "bid": Bid }`
- `GET /api/deal-requests/:id/market` → `{ "leadingDiscountPercent": 7.5 | null, "bidCount": 3 }`

All `:id` routes are 403 unless the request belongs to the test buyer.

```jsonc
// Bid  (publicDealBid)
{
  "id": "77", "dealRequestId": "5", "dealerUserId": "31", "dealerName": "…", "dealerCity": "…", "dealerState": "NJ",
  "distanceMiles": 12.4, "matchedVin": "…", "matchedVehicleTitle": "…", "matchedVehicleSpec": "…", "vehicleStatus": "…",
  "msrp": 0, "dealerDiscountDollars": 0, "dealerDiscountPercent": 0, "manufacturerRebates": 0, "sellingPrice": 0,
  "salesTax": 0, "dmvFees": 0, "docFee": 0, "dealerAccessories": 0, "tradeInAllowance": null,
  "totalOtdPrice": 0, "quotedOtdPrice": 0,       // quotedOtdPrice = total − tax − DMV; the number bids rank on
  "netOtdWithTradeIn": null, "financeMonthlyEstimate": null, "leaseMonthlyEstimate": null, "notes": null,
  "rank": 1, "isTopDeal": true, "status": "active", "createdAt": "…",
  "salesRep": { "name": "…", "title": "…", "phone": "…" } | null,
  "leadingDiscountPercent": 7.5
}

// DealRequest  (publicDealRequest)
{
  "id": "5", "buyerUserId": "9001", "strategy": "exact_auction" | "firm_offer" | "flexible_discount",
  "referenceBrandCode": "…", "referenceVin": "…", "referenceYear": 2026, "referenceMake": "…", "referenceModel": "…", "referenceTrim": "…",
  "referencePrice": 0, "referenceMsrp": 0, "targetOtdPrice": null, "targetDiscountPercent": null,
  "paymentMethod": "all_three" | "cash" | "finance" | "lease", "dealStructure": null, "tradeIn": null,
  "buyerZip": "07405", "buyerState": "NJ", "searchRadiusMiles": 100, "sameStateOnly": true, "buyerComment": null,
  "status": "active", "createdAt": "…", "expiresAt": "…"
}
```

### Inventory search (to pick a VIN for an RFQ)

Public listing data, read-only: `GET /api/inventory`, `GET /api/inventory/vin/:vin`, `GET /api/inventory/makes`, `GET /api/inventory/facets`. (No export, stats or any write.)

### Buyer key: create a bid request — `POST /api/deal-requests`

`buyerUserId` may be omitted; if sent it must be the test buyer. The request is stored `audit = 1`, so it never reaches the dealer-matching list. Body is `handleCreateDealRequest`'s:

```jsonc
{ "strategy": "exact_auction"|"firm_offer"|"flexible_discount",
  "referenceBrandCode": "porsche", "referenceVin": "…", "referenceMake": "…", "referenceModel": "…",
  "paymentMethod": "all_three"|"cash"|"finance"|"lease", "buyerZip": "07405", "buyerState": "NJ",
  "searchRadiusMiles": 100, "sameStateOnly": true, "buyerComment": "no contact info allowed" }
// → 201 { "dealRequest": DealRequest }   (DealRequest.audit === true)
```

### Buyer key: counter a test dealer — `POST /api/rfqs/:id/invites/:inviteId/buyer-counter`

Only when the RFQ is the test buyer's own `audit_forced_safe` RFQ **and** the countered desk is an `is_test` dealer; otherwise 403.

```jsonc
{ "counter": { /* structured counter object, stored verbatim */ } }
// → 200 { "rfq": RFQ }   409 if the RFQ is closed or the desk has no current quote
```

### Buyer key: create a deal — `POST /api/deals`

Creates the `pending_payment` row only (the key can never call `mark-paid`). Allowed only for the test buyer's own audit request and **that request's** audit bid by a test dealer; the body must name that dealer and VIN. Anything else — a real request, a real dealer's bid, a bid from a different request, someone else's request — is 403.

```jsonc
{ "buyerUserId": 9001, "dealRequestId": 30, "bidId": 40,          // both required for this key
  "dealerName": "AUDIT TEST Dealer 1", "matchedVin": "WP0AB2A96NS123456",
  "totalOtdPrice": 61250.0, "platformFeeCents": 49900, "winningBid": { /* the bid, verbatim */ } }
// → 201 { "deal": { …, "audit": true } }
```

### Test-dealer key

Each route below is bound by a guard to an audit RFQ/request **and** an `is_test` dealer; nothing else is reachable (no query parameters accepted).

| Route | What it is |
|---|---|
| `GET /api/rfq-invites/by-token/:token` | view an invite → `{ rfqId, invite }` |
| `GET /api/rfqs/:id` | read the RFQ (only if every invite on it is a test invite) → `{ rfq: RFQ }` |
| `POST /api/rfqs/:id/invites/:inviteId/quotes` | submit an itemized quote; also how a dealer **responds to / accepts a buyer counter** — a counter reopens the invite, and the dealer re-quotes (at the counter terms to accept) |
| `POST /api/rfqs/:id/invites/:inviteId/decline` | decline: `{ "declineReason": "soft_lead"\|"wrong_car"\|"options_mismatch"\|"other" }` |
| `GET /api/deal-requests/:id` | view an audit request → `{ dealRequest }` |
| `POST /api/deal-requests/:id/bids` | bid on an audit request (`dealerName` must be a test dealer) → `201 { bid: Bid }` |

```jsonc
// POST …/quotes  (handleSubmitRfqQuote) — itemized
{ "price": 60000, "fees": [{ "label": "Doc fee", "amount": 799 }, { "label": "Dest.", "amount": 1995 }],
  "vin": "WP0AB2A96NS123456", "stockNumber": "A100", "expiresAt": "2026-10-20T00:00:00Z",
  "mustHaveAcknowledgement": true, "notes": "optional" }
// → 201 { "quote": { id, price, fees, totalOtdPrice, vin, …, supersededAt } }   400 lists missing fields

// POST …/bids  (handleSubmitBid)
{ "dealerUserId": 7001, "dealerName": "AUDIT TEST Dealer 1", "matchedVin": "WP0AB2A96NS123456",
  "msrp": 0, "dealerDiscountDollars": 0, "dealerDiscountPercent": 0, "sellingPrice": 0, "salesTax": 0, "dmvFees": 0,
  "docFee": 0, "dealerAccessories": 0, "totalOtdPrice": 0, "notes": "" }
// → 201 { "bid": Bid }   (Bid.audit === true)
```

Note: there is no separate dealer "accept" endpoint in the API today; "accept" for a dealer is submitting the quote at the buyer's counter terms.

## Test dealerships and cleanup

- `node scripts/audit/seed-test-dealers.mjs` (dry run) / `--apply` creates the 3 test dealerships (`AUDIT TEST Dealer 1–3`, `audit-dealer-N@audit.trimscout.test`, `is_test = 1`). Idempotent; aborts if a real dealership already has one of those names.
- `node scripts/audit/audit-cleanup.mjs` (dry run) prints, per table, the `audit = 1` rows older than 7 days not yet soft-deleted. `--apply --expect-total N` soft-deletes them (`deleted_at = NOW()`) and refuses unless N equals the dry run's total. It never hard-deletes and never touches `audit = 0` rows. `--days` changes the 7.
- Both read `.env.trimscout-db` from the current directory, so run them from `/opt/trimscout-deals` on the box.

## Schema changes (all idempotent `ADD COLUMN IF NOT EXISTS`, run lazily by the deals API on first use)

| Table | Added |
|---|---|
| `rfq_requests`, `rfq_invites`, `rfq_quotes`, `rfq_events`, `deal_requests`, `deal_bids`, `deals` | `audit TINYINT(1) NOT NULL DEFAULT 0`, `audit_at DATETIME NULL`, `deleted_at DATETIME NULL` |
| `rfq_requests` | `audit_forced_safe TINYINT(1) NOT NULL DEFAULT 0` (from #429) |
| `dealership_contacts` | `is_test TINYINT(1) NOT NULL DEFAULT 0` (also ensured by the auth API) |

Existing rows default to `audit = 0` / `deleted_at NULL`, so nothing changes for real data.

## Box deploy (do not run until Paul says GO)

Files that change, on the deals box (`/opt/trimscout-deals/src/`) and the auth box:

1. `deals_api_server.js` — **anchored patch** (the box copy has drifted from the repo mirror; follow the `scripts/box/*.sh` pattern: backup, exact-replace with asserts, `node --check`, restart). Covers both #429 and this PR.
2. `auditKey.js` — **new file**, same directory (this PR replaces #429's version; the deals API imports it).
3. `auth_api_server.js` (auth API) — anchored patch: `ensureDealerTestColumn` + `WHERE is_test = 0` in `handleListDealerships`.
4. Box env for the deals API: `TRIMSCOUT_AUDIT_API_KEY`, `TRIMSCOUT_AUDIT_BUYER_USER_ID`, `TRIMSCOUT_AUDIT_DEALER_KEY`. Keys are pasted by Paul via the secure card, never through chat or the repo.
5. `scripts/audit/seed-test-dealers.mjs` and `scripts/audit/audit-cleanup.mjs` — copy to `/opt/trimscout-deals/` (they are run by hand, not by the server).

Order: take **one DB backup**, patch deals + auth files (`node --check` each), **restart deals-api once** (and the auth API), then `node seed-test-dealers.mjs` (dry run, read it) → `--apply`, then confirm `GET /api/dealerships` no longer lists them and that a smoke call with each audit key returns 403 on `/api/deals` GET and 200 on an allowed read. The schema changes run on the first RFQ/deal call after restart; per the restart-ALTER note, restart when no long SELECT is running. Next.js changes (`lib/rfq.ts`, `lib/inviteOutbox.ts`) ship with the normal merge.

Rollback: restore the backed-up `deals_api_server.js` / `auth_api_server.js` and restart; the new columns are additive and harmless to leave.

## Open requirement for any future "test mode"

On `main` today every dealer email is hard-wired to `SAFE_MODE_RECIPIENT`. The unmerged test-mode work (`lib/testMode.ts`, an optional per-recipient override in `sendQuoteInviteEmail`) must skip the override when `rfq.auditForcedSafeMode` is true. `lib/auditKeyApp.test.ts` pins this: it fails if the outbox ever hands a dealer address to the sender for such an RFQ.
