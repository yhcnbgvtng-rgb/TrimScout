# One listing per VIN on /search

The buyer `/search` shows each VIN once. A VIN live at several stores (docs/SHADOW_DUPLICATES.md) is kept at the store that saw it **most recently**; a tie goes to the **nearest store** when the buyer's zip is known, otherwise the **lowest price** (a missing price ranks last), then the lowest dealer id.

Display only: no row is retired or changed, the raw `dealer_inventory` is untouched, and admin / dealer views (`listInventory`, exports, the VIN page) never send `onePerVin`, so they list every store.

## Where it lives

| Layer | What |
|---|---|
| Box SQL (`inventoryListQuery.js`, `onePerVin.js`) | `onePerVin=1\|latest` (needs `inStock=1`) adds `NOT EXISTS (SELECT 1 FROM dealer_inventory j WHERE j.vin = i.vin …)`: a primary-key-prefix seek, one dive per row the page or capped count walks. It uses the same visibility rules as the buyer list (in stock, not stale, retail, seen within the window). The page, the capped count and the deferred-join page all take it from the one WHERE, and every FORCE INDEX is unchanged. |
| Box facets (`deals_api_server.js`) | `/api/inventory/facets?onePerVin=1` and `/contact-facets` subtract the rows that lose the rule, from a cached aggregate (`vin-losers:<days>`, built from VINs held by 2+ visible rows, a first-character slice at a time). Same subtraction pattern as wholesale and stale cars; a failed read leaves the counts unadjusted and the response says `onePerVin:false`. |
| Web (`lib/onePerVin.ts`, `buyerSearch.ts`, `inventoryApi.ts`) | Sends `onePerVin=1` (or `latest` when a zip is given, because distance is not in the database), breaks the remaining ties by distance, and collapses the page itself when the box has not been patched (the box echoes `onePerVin:true` when it applied the rule). |

## Deploy state

* Web: safe to ship alone. With an unpatched box the box ignores `onePerVin`; the web app collapses duplicates within each page and lowers the total by what it dropped. Cross-page duplicates, exact totals and facet counts need the box.
* Box (box2, the deals box): **not installed.** Install needs Paul's GO: copy `src/onePerVin.js` to `/opt/trimscout-deals/src/`, patch `inventoryListQuery.js` (import + the `onePerVin` block just before `whereSql`) and `deals_api_server.js` (import, `vinLoserRows` / `vinLoserBucketsOrNull`, the three small hunks in `handleInventoryFacets`, `handleContactFacets`, `handleListInventory`). Anchor on the live files' text (they drift from the repo, see docs/BOXES.md), `node --check`, back up first, restart `trimscout-deals-api`. Probe: `GET /api/inventory?inStock=1&make=Ford&onePerVin=1&limit=1` must carry `"onePerVin":true`; time a Ford `sort=trim` page and a capped count before/after (target about 1 s).
* `vin-losers` scans the primary key in 33 slices at first call; it is cached stale-while-revalidate, so only the first request after a restart waits.
