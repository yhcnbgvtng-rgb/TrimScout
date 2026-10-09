# Merged-feed dedupe (dry run) and the wholesale rule — 2026-10-10 (code only, nothing applied)

## Merged-feed dedupe dry run (`scripts/box/2026-10-10-dedupe-merged-feeds.mjs`, `src/dedupeMergedFeeds.js`)
Dry run only (it refuses `--apply`): SELECT-only reads with a 20 s cap, then a plan per group. Preview against today's data (before any re-crawl, `--tie review` / `--tie hub`):

| Group | In-stock rows | Distinct VINs | Held by one rooftop | **Shared** | Decided by evidence | Rows retired with `--tie hub` |
|---|---|---|---|---|---|---|
| McGovern Hyundai (11951 Milford, 11952 Route 2, 11953 Route 93, 12087 Concord) | 2,893 | 1,531 | 169 | **1,362** | 0 | 1,362 (hub = Concord) |
| Fred Beans Hyundai (12243 Mechanicsburg, 12094 Flemington, 12240 Abington) | 1,899 | 1,183 | 511 | **672** | 94 by stock prefix (MH, MK -> Mechanicsburg) | 714 (94 evidence + 576 hub + 2 unresolved) |
| Johnson Lexus (7513 Raleigh, 7515 Durham) | 1,599 | 1,218 | 837 | **381** | 0 | 381 (hub = Raleigh) |

What the data says: for these groups the shared rows are identical (same stock number, same price on 390/390 McGovern and 286/287 Fred Beans shared VINs), so **nothing stored says which rooftop physically has a shared car**. The plan uses only evidence, in order: `fresh` (after a re-crawl, only one rooftop's site still lists the VIN), `stock` (a stock-number prefix that, among VINs held by one rooftop only, points to one rooftop with >= 5 examples and >= 95% purity), then a tie policy: `review` (leave unresolved, retire nothing) or `hub` (the group's largest rooftop keeps it — a convention, not evidence). The learned McGovern prefixes (HW, HC, HU, HM) do not appear on the shared cars, which is why stock decides nothing there. Fred Beans Abington (12240) shares the same feed in the data and is included.

Run it after the re-crawl with `--run-start <crawl start> --require-fresh-keeper` so a stale row is never kept over a fresh one. Right now Johnson Lexus Durham is fresh (seen 10/09) and Raleigh is not: `hub` would keep the stale Raleigh rows and retire the fresh Durham ones, which is why the real run waits for the re-crawl and Paul picks the tie policy.

## Wholesale rule (`retailOnly`)
`inventoryListQuery` takes `retailOnly=1` and adds `(i.cond IS NULL OR i.cond <> 'wholesale')`; `searchInventory` (the buyer /search call) always sends it; the admin sheet (`listInventory`) never does. The rows stay in the table. EXPLAIN on six real buyer-search shapes (state+make, make+model, state+make+model sorted by trim, make only, state only, used + make+model) shows the **same index and row estimate with and without the clause**.

Scope to decide: the rule is by condition, not by dealer. In-stock cars by condition today: new 1,338,506, used 766,344, cpo 82,330, **wholesale 24,254 across 532 dealers**. Coconut Creek (11249) has 2,142, but Pompano (11270) has 2,890, House of Imports (CA) 1,125, South Bay 1,095, Stevens Creek 1,002, Houston North 752. If only Coconut Creek should be hidden, the clause becomes `NOT (i.dealer_id = 11249 AND i.cond = 'wholesale')`.
### Buyer dropdown / facet counts (added 2026-10-10)
`/api/inventory/facets`, `/api/inventory/makes` and the option / colour catalog now follow the same rule (`RETAIL_ONLY_FACETS=0` is the kill switch).
- **State / make / model / trim counts:** NOT a WHERE clause. Those are index-only GROUP BYs over indexes without `cond`; a cond predicate forces a row lookup per counted row (the shape that already blew the 20 s cap on Ford). Instead the counts are computed as before and the wholesale cars are **subtracted** bucket by bucket (`src/retailFacets.js`) from a small cached aggregate of (make, state, model, trim) -> n. Reading that aggregate: a bare `WHERE cond='wholesale' GROUP BY make,state,...` timed out at 20 s on the live table, so it reads dealer ids first (24,254 cars at 532 dealers, 23 queries, slowest 7.2 s) and then 10 dealers per query by the (removed_at, dealer_id, cond) index prefix; it has its own stale-while-revalidate cache key, and if it cannot be read the dropdowns load with the old counts (never an error).
- **Option / colour catalog:** the nightly facet rebuild's two aggregates (options, colours) and the live fallback skip wholesale cars; counts change at the next rebuild.
- **Checked read-only against the live table:** subtraction equals the exact cond-predicate count for Mercedes-Benz in FL (10,326 -> 4,061) and CA (10,335 -> 6,694) on all 149 and 190 models; Hyundai IL differs by 4 of 4,964 (data moved between the two reads).
- Admin facets (`/api/inventory/admin-facets`) and the admin stats are deliberately untouched.

Deploy later (needs a deals-api patch + restart, Paul's GO): the box copy of `inventoryListQuery.js` is a single-clause change.
