# Design note: paid-only factory options in the /search catalog filter

Status: proposal only. Nothing here is built, and nothing was run against a box except read-only counts (2026-10-18, box2, reader account).
Related: `OPTIONS_PAID_ONLY` flag (compare view and wizard picker) in this PR.

## What has to change
`GET /api/inventory/catalog` returns `{ key, label, vehicleCount }` per option, read from `inv_option_facets` / `inv_option_summary`. Those are
rebuilt after each sync by `rebuildCatalogFacets` (`deals_api_server.js`) by joining `dealer_inventory` to `dealer_inventory_options` and grouping on
`canonical_key`. **`dealer_inventory_options` has no price column** (`vin, dealer_id, canonical_key, label, code`). The price exists only inside
`dealer_inventory.options_json` (`[{code, name, price, kind}]`). So "count an option only where its row is priced above 0" cannot be done from the stored rows.

## Recommended approach
1. Add `price INT NULL` to `dealer_inventory_options`, filled by the write path (`inventoryOptionRows.js` already holds each line's price) and by the
   existing backfill (`2026-09-28-backfill-inventory-options.mjs`, idempotent, replaces per vehicle from `options_json`).
2. In `rebuildCatalogFacets`, behind the same flag, count `COUNT(*) ... WHERE o.price > 0` (per row, so a label that is $0 on one car and paid on another
   counts only the paid cars). Same grouping, same tables, same swap-per-make transaction. Flag off = the current query.
3. Leave `/api/inventory/catalog` and the web app unchanged (the web app already renders whatever keys come back).

Why not compute it at request time from `options_json`: the per-request join already hit the 20 s cap for Ford F-150 and RAV4 (see the comment above
`catalogFacets`), and parsing JSON is heavier than a join.

## How heavy
Measured on box2, read-only, 2026-10-18, parsing `options_json` with `JSON_TABLE` in model-year chunks:
- Volvo (14,266 cars with option data): about 1 second per query.
- Ford (about 227k cars with option data): about 7 minutes for three queries run back to back in year chunks.
- All 36 brands over 500 cars (about 1.48M cars with option data, 8.7M deduped rows): about 45 minutes in total.
Unchunked Ford hit a 120 s cap. So **do not parse JSON in the rebuild**. Doing it once in the backfill (off-window, chunked, resumable) and then
reading the new column is the cheap path. The extra column adds one `INT` per row on a roughly 9.5M-row table; after the backfill the rebuild should
cost about what it does now, because the `WHERE o.price > 0` rides on the same join.

## What the paid-only rule does to the filter (measured, for sizing)
Cars with no paid option row, by the per-row rule: 1,041,074 of 1,484,144 (70%). Some brands lose nearly everything (Honda 48,300 of 48,815;
Toyota 96,184 of 106,872; Chevrolet 165,908 of 183,506). The filter will look much emptier for those brands. That is a product call to make before
turning it on.

## Open issues to settle first
- Code `FEATURE` rows are stored with price 0 meaning "unknown", and the global junk rules already exempt them. A paid-only count must decide whether
  they are "standard" (hidden) or "unknown" (hidden too, but not counted as free). The JSON has no link from a component to its package, so a
  package's price cannot be pushed down to its parts.
- 16% of priced package rows (139k of 847k) have no stored row, mostly Honda, Nissan, Subaru, Hyundai, Mazda. A paid-only filter would not show them.

## How to test it on box2 later (no writes until step 4)
1. **Read-only first.** As `trimscout_reader`, with `SET SESSION TRANSACTION READ ONLY` and `max_statement_time=120`, run the proposed `price > 0` count
   for one small make (Volvo) and compare to the 2026-10-18 figures: 11,892 cars with a paid row, 2,374 without.
2. **EXPLAIN** the new rebuild query on a copy of one make's rows or on box2 off-window; confirm it uses `idx_opt_dealer_canonical` and not a full scan.
3. **Dry-run the backfill** (`--dry-run` is the default): per-make counts of rows that would get a price, no writes, memory guard on.
4. **Apply on one small make** with the sync lock held and the fleet idle, then rebuild that make only. Compare `vehicle_count` per key against
   step 1, and check `GET /api/inventory/catalog?make=Volvo` with the flag on vs off.
5. Only then widen to the rest of the makes, largest last, one rebuild at a time, watching the sync lock and swap.
