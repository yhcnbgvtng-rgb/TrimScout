# Wholesale cars stay out of buyer search, dropdowns and counts (2026-10-10)

Cars whose condition is `wholesale` (a dealer's wholesale lot, not retail stock a buyer can request a quote on) are left out of everything the buyer sees: search results, the State / Make / Model / Trim dropdown counts, the make list and the option / colour catalog. The rows stay in the table and the admin Vehicles tab still shows them. Code only until the deals-api patch and restart.

## Search results (`retailOnly`)
`inventoryListQuery` takes `retailOnly=1` and adds `(i.cond IS NULL OR i.cond <> 'wholesale')`; `searchInventory` (the buyer /search call) always sends it; the admin sheet (`listInventory`) never does. The rows stay in the table. EXPLAIN on six real buyer-search shapes (state+make, make+model, state+make+model sorted by trim, make only, state only, used + make+model) shows the **same index and row estimate with and without the clause**.

Scope to decide: the rule is by condition, not by dealer. In-stock cars by condition today: new 1,338,506, used 766,344, cpo 82,330, **wholesale 24,254 across 532 dealers**. Coconut Creek (11249) has 2,142, but Pompano (11270) has 2,890, House of Imports (CA) 1,125, South Bay 1,095, Stevens Creek 1,002, Houston North 752. If only Coconut Creek should be hidden, the clause becomes `NOT (i.dealer_id = 11249 AND i.cond = 'wholesale')`.
### Buyer dropdown / facet counts (added 2026-10-10)
`/api/inventory/facets`, `/api/inventory/makes` and the option / colour catalog now follow the same rule (`RETAIL_ONLY_FACETS=0` is the kill switch).
- **State / make / model / trim counts:** NOT a WHERE clause. Those are index-only GROUP BYs over indexes without `cond`; a cond predicate forces a row lookup per counted row (the shape that already blew the 20 s cap on Ford). Instead the counts are computed as before and the wholesale cars are **subtracted** bucket by bucket (`src/retailFacets.js`) from a small cached aggregate of (make, state, model, trim) -> n. Reading that aggregate: a bare `WHERE cond='wholesale' GROUP BY make,state,...` timed out at 20 s on the live table, so it reads dealer ids first (24,254 cars at 532 dealers, 23 queries, slowest 7.2 s) and then 10 dealers per query by the (removed_at, dealer_id, cond) index prefix; it has its own stale-while-revalidate cache key, and if it cannot be read the dropdowns load with the old counts (never an error).
- **Option / colour catalog:** the nightly facet rebuild's two aggregates (options, colours) and the live fallback skip wholesale cars; counts change at the next rebuild.
- **Checked read-only against the live table:** subtraction equals the exact cond-predicate count for Mercedes-Benz in FL (10,326 -> 4,061) and CA (10,335 -> 6,694) on all 149 and 190 models; Hyundai IL differs by 4 of 4,964 (data moved between the two reads).
- Admin facets (`/api/inventory/admin-facets`) and the admin stats are deliberately untouched.

Deploy later (needs a deals-api patch + restart, Paul's GO): the box copy of `inventoryListQuery.js` is a single-clause change.
