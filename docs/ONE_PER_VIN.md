# One listing per VIN on /search

The buyer `/search` shows each VIN once. A VIN live at several stores (docs/SHADOW_DUPLICATES.md) is kept at the store that saw it **most recently**; a tie goes to the **nearest store** when the buyer's zip is known, otherwise the **lowest price** (a missing price ranks last), then the lowest dealer id.

Display only: no row is retired or changed, the raw `dealer_inventory` is untouched, and admin / dealer views (`listInventory`, exports, the VIN page) never send `onePerVin`, so they list every store.

## Where it lives

| Layer | What |
|---|---|
| Box SQL (`inventoryListQuery.js`, `onePerVin.js`) | `onePerVin=1\|latest` (needs `inStock=1`) adds `NOT EXISTS (SELECT 1 FROM dealer_inventory j WHERE j.vin = i.vin …)`: a primary-key-prefix seek, one dive per row the page or capped count walks. It uses the same visibility rules as the buyer list (in stock, not stale, retail, seen within the window). The page, the capped count and the deferred-join page all take it from the one WHERE, and every FORCE INDEX is unchanged. |
| Box facets (`onePerVinLosers.js` + `docs/box-patches/2026-10-29-one-per-vin-losers/`) | `/api/inventory/facets?onePerVin=1` and `/contact-facets` subtract the rows that lose the rule, read from a small precomputed table `dealer_inventory_vin_losers (vin, dealer_id)` joined to `dealer_inventory` by primary key. The table is kept by the sync upsert, a post-sweep reconcile and a backfill script; nothing scans for duplicate VINs at request time. Flags `ONE_PER_VIN_LOSERS=maintain` and `ONE_PER_VIN_FACETS=1`, both off by default. A failed read leaves the counts unadjusted (`onePerVin:false`) and is not retried for 60 s. |
| Web (`lib/onePerVin.ts`, `buyerSearch.ts`, `inventoryApi.ts`) | Sends `onePerVin=1` (or `latest` when a zip is given, because distance is not in the database), breaks the remaining ties by distance, and collapses the page itself when the box has not been patched (the box echoes `onePerVin:true` when it applied the rule). |

## Deploy state

* Web: safe to ship alone. With an unpatched box the box ignores `onePerVin`; the web app collapses duplicates within each page and lowers the total by what it dropped. Cross-page duplicates, exact totals and facet counts need the box.
* Box (box2, the deals box): **not installed.** Install needs Paul's GO. The hooks into `deals_api_server.js` ship as `docs/box-patches/2026-10-28-one-per-vin/deals_api_server.js.patch`, not as an edit to the repo file, because that file is pinned by the sweep-guards install package (`scripts/box/sweep-guards-install.test.mjs`); the patch is written against that pinned text and a test applies it with zero fuzz. Steps: back up, copy `src/onePerVin.js`, `src/onePerVinServer.js` and the new `src/inventoryListQuery.js` to `/opt/trimscout-deals/src/`, `patch -F0` the server (anchor on the live file's text if it has drifted, docs/BOXES.md), `node --check`, restart `trimscout-deals-api`. Probe: `GET /api/inventory?inStock=1&make=Ford&onePerVin=1&limit=1` must carry `"onePerVin":true`; time a Ford `sort=trim` page and a capped count before/after (target about 1 s).
* **Installed on box2 2026-10-27 (rows, pages, totals):** `onePerVin.js`, a hand-merged `inventoryListQuery.js`, and the import + `onePerVin:true` echo in `deals_api_server.js`. The earlier facet patch (a live GROUP BY for duplicate VINs) was **not** installed: it exceeds the 20 s cap on the live data. `docs/box-patches/2026-10-28-one-per-vin/` now holds only the two hunks that were installed.
* **Facet counts: code only.** `docs/box-patches/2026-10-29-one-per-vin-losers/STEPS.md` (backup, gate, EXPLAINs, rollback). Until it is installed and switched on, facet counts still double-count duplicate VINs.
* `docs/box-snapshots/2026-10-27-box2/` is a verbatim read-only copy of box2's live `deals_api_server.js` and `inventoryListQuery.js` (md5s in `MD5S.txt`). The repo's own copies under `scrapers/lightsail-crawler/src/` differ from the box (the box lacks some merged work, the repo lacks box-only edits); box patches are written against the snapshot.
