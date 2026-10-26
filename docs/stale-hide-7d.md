# Stale cars on buyer search (updated 2026-10-26)

Age = now - `last_seen_at`. Buyers never see the date or a badge: no "Last seen" text on /search results or vehicle pages. It works quietly:

| age | buyer search | quote request (RFQ) |
|---|---|---|
| up to 3 days | shown | can be picked |
| 3 to 7 days | shown | checkbox disabled; a saved pick is dropped by the pick-status check |
| over 7 days | hidden, and out of the count and facets | n/a |

Both lines are constants in `lib/lastConfirmed.ts`: `RFQ_MAX_AGE_DAYS = 3`, `STALE_HIDE_DAYS = 7` (4 while `STALE_RULE=1`, see stale-rule.md). The admin Vehicles tab has a sortable "Last seen" column (Eastern date and time, `2026-10-22 06:28 ET`). Admin views and a car's direct page still show hidden cars.

## Web (live on deploy)
`searchInventory`, `inventoryFacets` and `inventoryMakes` send `seenWithinDays`; the admin list never does. `toBuyerVehicle` replaces the date with `rfqEligible`; `listingFor` (pick-status) treats a car unseen for over 3 days as "gone".

## Box / deals-api: nothing new, nothing installed
The filter (`seenWithinDays` -> `i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)` in `inventoryListQuery.js`, with `staleFacets.js` for the facet counts) shipped in #457. As of 2026-10-26 the file on box2 (`/opt/trimscout-deals/src/inventoryListQuery.js`) already contains it. The clause is a plain post-filter and no index has `last_seen_at` as a leading column, so it must not change a plan:

```bash
# read-only: EXPLAIN only, reader login, writes nothing (run on box2)
node scripts/box/probe-stale-hide-plan.mjs /opt/trimscout-deals/src/inventoryListQuery.js
```

Run 2026-10-26: make, make+state, make+model and make+model+state, list and count each, keep the index and access type they have without the clause (idx_inv_stock_make_dealer, idx_inv_stock_state, idx_inv_facet_state_make, idx_inv_stock_make_model_trim, idx_inv_facet_make_model_state_trim). Exit 0. Re-run it after any change to `inventoryListQuery.js`.
