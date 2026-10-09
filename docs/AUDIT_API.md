# Audit API (scoped key for TrimScout's AI auditor)

A second API key on the deals API (`scrapers/lightsail-crawler/src/deals_api_server.js`) that can only act as **one test buyer**. Policy lives in `scrapers/lightsail-crawler/src/auditKey.js` and is checked in `requireAuth` plus a route gate at the top of the request handler.

Status: **code only — not deployed.** Nothing here is live until the box deploy (bottom of this doc).

## Auth

Send the key exactly like the shared key:

```
X-Trimscout-Api-Key: <audit key>
```

The box needs `TRIMSCOUT_AUDIT_API_KEY` **and** `TRIMSCOUT_AUDIT_BUYER_USER_ID`. If either is missing, or the audit key equals the full key, the audit key is rejected (401) — it never silently degrades to full access.

| Situation | Status |
|---|---|
| Missing / wrong key | 401 |
| Route not in the list below (any verb), or another buyer's data | **403** |
| More than 60 requests in a rolling minute (denied calls count) | 429 + `Retry-After` |

Default deny: a route added to the server later is closed to this key until it is added to `AUDIT_ROUTES`.

## Guarantees

- **One buyer.** Everything is confined to `TRIMSCOUT_AUDIT_BUYER_USER_ID`. List routes must pass `buyerUserId=<that id>`; id routes check the row's `buyer_user_id` first. Missing rows and other buyers' rows are both 403 (no id probing).
- **SAFE MODE forced.** RFQs this key creates are stored with `audit_forced_safe = 1` (returned as `auditForcedSafeMode: true`). Dealer email for them can only go to `pausmi@outlook.com` (`SAFE_MODE_RECIPIENT`), never to a dealer. They are also created `approvalStatus: "pending"`, so the admin gate holds them anyway.
- **Never allowed:** `POST /api/deals` and every `/api/deals/*` route, every dealer route (`/api/dealer-*`, bid submission, quote/decline, invite-token), every `/api/ops/*` route, inventory writes/export/stats, RFQ approval/patch/invite/delivery/pick/walk, and `buyer-counter`.
- **Logged.** Every call prints one JSON line to the server log: `{"audit_key":true,"at":…,"route":"GET /api/rfqs/:id","status":200,"ms":3}`. Route template and status only — no key, ids or query string.

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

## Not available to this key (reference only)

These were requested as reference shapes but are **writes**, so the key gets 403 on them. A buyer-side agent that should act on bids needs a separate decision (see the PR description).

```jsonc
// POST /api/deal-requests  (handleCreateDealRequest) — creates a bid request
{ "buyerUserId": 9001, "strategy": "exact_auction"|"firm_offer"|"flexible_discount",
  "referenceBrandCode": "porsche", "referenceVin": "…", "referenceMake": "…", "referenceModel": "…",
  "paymentMethod": "all_three"|"cash"|"finance"|"lease", "buyerZip": "07405", "buyerState": "NJ",
  "searchRadiusMiles": 100, "sameStateOnly": true, "buyerComment": "no contact info allowed" }
// → 201 { "dealRequest": DealRequest }

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter  (handleBuyerCounter) — counters a desk's current quote
{ "counter": { /* structured counter object, stored verbatim */ } }
// → 200 { "rfq": RFQ }   409 if the RFQ is closed or the desk has no current quote
```

## Box deploy (do not run until Paul says GO)

Files the deploy changes on the deals-API box (`scrapers/lightsail-crawler/src/` → box app dir):

1. `deals_api_server.js` — auth, route gate, forced-safe column, `auditForcedSafeMode` field. **The box copy has drifted from the repo mirror** (see TrimScout box-file-drift notes), so this must be applied as an anchored patch on the box's actual text, not a file copy.
2. `auditKey.js` — **new file**, same directory (imported by `deals_api_server.js`).
3. Box env (`.env` / the file `loadDbEnv()` reads): add `TRIMSCOUT_AUDIT_API_KEY` and `TRIMSCOUT_AUDIT_BUYER_USER_ID`. The key is pasted on the box by Paul via the secure card — never through chat or the repo.
4. DB: no manual step. `ensureQuotePackageColumns` adds `rfq_requests.audit_forced_safe` (`ALTER … ADD COLUMN IF NOT EXISTS`) on first RFQ read/write after restart. Per the restart-ALTER note, do the restart when no long SELECT is running.
5. Restart the deals API process.

Next.js side (`lib/rfq.ts`, `lib/inviteOutbox.ts`) deploys through the normal Vercel merge; it needs no box change.

## Open requirement for any future "test mode"

On `main` today every dealer email is hard-wired to `SAFE_MODE_RECIPIENT`. The unmerged test-mode work (`lib/testMode.ts`, an optional per-recipient override in `sendQuoteInviteEmail`) must skip the override when `rfq.auditForcedSafeMode` is true. `lib/auditKeyApp.test.ts` pins this: it fails if the outbox ever hands a dealer address to the sender for such an RFQ.
