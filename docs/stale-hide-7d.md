# Cars not seen for 7+ days stay out of buyer search (2026-10-10)

Replaces #450's "Last confirmed" label. Age = now - `last_seen_at`; the label date is the calendar date in US Eastern.

| age | buyer search | dealer cell |
|---|---|---|
| under 3 days | shown | no label |
| 3 to 7 days | shown | small grey "Last seen Oct 7" |
| over 7 days | hidden, and out of the count and facets | n/a (admin views and a car's direct page still show it, with the label) |

`STALE_HIDE_DAYS = 7` lives in `lib/lastConfirmed.ts`. No new column.

## Web (live on deploy)
The label and the age helpers. `searchInventory`, `inventoryFacets` and `inventoryMakes` send `seenWithinDays=7`; the admin list never does.

## Box / deals-api (waits for an idle window, needs a restart)
- `inventoryListQuery.js`: `seenWithinDays=N` -> `i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, a plain post-filter (single-file patch). An un-patched box ignores the param, so until the patch the hiding does nothing; nothing breaks.
- `deals_api_server.js` + new `staleFacets.js` (copy both): `/api/inventory/facets` and `/makes` subtract the stale non-wholesale cars bucket by bucket from a cached aggregate read in one-day slices of `last_seen_at` (same subtraction as the wholesale cars, so a stale wholesale car is not subtracted twice). A failed read leaves the counts unadjusted, never an error.
- The nightly option/colour catalog rebuild and its live fallback use `STALE_HIDE_DAYS` (env, default 7; `0` turns it off). `stale_hide.test.js` pins that default to the web constant.
- Not measured: EXPLAIN of the list query with the new clause on the live table, and the stale aggregate's runtime. Do both in the deploy window before the restart.
