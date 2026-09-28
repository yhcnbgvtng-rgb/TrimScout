# Buyer inventory search (`/search`)

A buyer-facing page over `dealer_inventory` — the crawler's own real, nightly-crawled dealer
inventory (see [`DEALER_ANALYTICS.md`](./DEALER_ANALYTICS.md) for how that data gets there). A
filter panel — searchable State/Make/Model/Trim/Factory-options dropdowns with live hit counts,
price/odometer/days-on-lot/colors/ZIP+radius/sort under a "More" popover — feeds one deterministic
search endpoint (`GET /api/vehicles/search`). `dealer_inventory` is the only source of truth here
— this never reads MarketCheck, and never will (a deliberate scope decision for this feature, not
an oversight).

**No AI/natural-language search** — a prior version of this page had a Gemini-backed NL box
("black 4Runner under 40k with a moonroof near 07601") feeding the same search endpoint. It was
removed from the page's UI (PR #341, 2026-09-27) in favor of the filter-first redesign below. The
underlying `POST /api/search/parse` route, `lib/searchParse.ts`, and their Gemini plumbing were
deleted outright in a follow-up (2026-09-27) once confirmed unused anywhere else — see this file's
git history for that design if a future AI entry point is ever wanted again.

## Non-goals (confirmed scope, don't re-add without asking)

- No LLM ranking, scoring, or natural-language parsing of a search query — see above.
- No embeddings, no vector search.
- No paid per-dealer geocoding — distance uses the same ZIP/city/state approximation
  (`lib/otdCalculator.ts`'s `calculateDistanceMiles`) every other distance feature in this app
  already uses.
- No changes to the Lightsail crawl-claim queue / crawler concurrency — unrelated system.

## Data model additions

Two additions to `dealer_inventory` (deals box, MariaDB), both **not backfilled** — they start
empty/0 for rows that existed before this feature shipped, and populate only from new crawl
writes going forward (there's no historical record to backfill either one from):

| Addition | What it's for |
|---|---|
| `dealer_inventory.price_change_count INT NOT NULL DEFAULT 0` | Incremented in `handleInventoryBulk`'s upsert only when the incoming price genuinely differs from what was stored. Powers `minPriceChanges=` — "vehicles that have had at least N real price changes" — as a plain indexed column read, not a live aggregate over `dealer_inventory_days`. |
| `dealer_inventory_options` table: `(vin, dealer_id, code)` | A normalized, indexed side table for real factory option codes, replacing a scan of the free-text `options_json` blob. Delete-then-reinsert per vehicle on every bulk upsert (a full replace of the set, never additive) — so an option a later crawl no longer sees stops matching. Powers `optionCodes=`'s must-have-**ALL** filter, a real `HAVING COUNT(DISTINCT code) = N` set-containment query, not a substring match. |

Schema + backend: PR 1 (#300). Box deploy: `scripts/box/2026-09-25-buyer-search-schema.sh`.

## API

### `GET /api/vehicles/search`

Public — no admin session, no API key from the browser (the server holds the deals-box key).
Reads `dealer_inventory` only, in-stock vehicles only (`removed_at IS NULL` is forced server-side;
there's no `inStock=` toggle for buyers — a removed listing is never useful to show a shopper).

| Param | Notes |
|---|---|
| `make`, `model`, `trim`, `cond`, `q` | Same semantics as the admin sheet's filters. |
| `priceMin`, `priceMax` | On `dealer_inventory.price`. |
| `minDays`, `maxDays` | Days on lot. |
| `odometerMax` | Max mileage. |
| `exteriorColor`, `interiorColor` | Exact match against the plain color columns. |
| `optionCodes` | Comma-separated factory option codes, **all** must be present (real set containment — see above). Get real codes that exist for a make/model/trim from `GET /api/catalog/options` below, never hand-typed. |
| `minPriceChanges` | See `price_change_count` above. |
| `possibleDemo` | `1` to also allow new-condition vehicles with > 500 miles (the same "likely a demo/loaner" heuristic used elsewhere in this app — there's no separate demo/loaner condition value in this schema). |
| `zip` | Buyer's own ZIP — every vehicle in the response gets a `distanceMiles` computed from it (Haversine over the same ZIP/city/state approximation used everywhere else in this app; see `lib/otdCalculator.ts`). Does **not** filter results by itself. |
| `radiusMiles` | Filters to `distanceMiles <= radiusMiles`. **Requires `make` to also be set** — a nationwide radius scan with no make has nothing selective to index on (see `inventoryListQuery.js`'s make= index hint), so this returns **400** instead of running an unbounded query. The `/search` page's filter panel disables the radius input until both a ZIP and a make are entered. |
| `sort` | A plain column sort (`price:asc`, `mileage:desc`, …) or `distance` (only meaningful with `zip=`) — `distance` is **not** a box-side sort key; it's computed in-memory on the already-fetched page, in the route. |
| `limit`, `offset` | Capped at 100 (well below the admin sheet's 2000 — this is a page of results for a shopper, not a bulk export). |

The response strips two fields off every vehicle that a buyer has no reason to see:
`sourceBox` and `crawlFirstSeen` (crawl-pipeline provenance, not vehicle or deal facts).

```bash
curl "https://trimscout.com/api/vehicles/search?make=Toyota&model=4Runner&priceMax=40000&zip=07601&radiusMiles=50&sort=distance&limit=10"
```

### `GET /api/catalog/options`

`?make=&model=&trim=` (any/all optional) → the option codes and exterior/interior colors that
**actually exist** among in-stock vehicles matching that scope, each option code with a live
vehicle count. This is what feeds the filter panel's option checklist and color pickers — never a
global, unscoped list — specifically so the panel can never offer a combination (e.g. a color that
doesn't exist on that model) that returns zero results.

```bash
curl "https://trimscout.com/api/catalog/options?make=Toyota&model=4Runner"
```

### `GET /api/catalog/makes`

Distinct makes with live in-stock inventory. Superseded on the `/search` page itself by
`GET /api/catalog/facets` below (which also returns per-make counts), but still used wherever only
a plain make list is needed. Wraps the box's existing `GET /api/inventory/stats` — no dedicated
box endpoint of its own.

### `GET /api/catalog/facets`

`?state=&make=&model=` (each optional) → hit counts for the State/Make/Model/Trim dropdowns,
cross-scoped by whichever of the others is already set: `state` scopes the make count and vice
versa; `make` also returns a model list (scoped by `state` too, if set); `make` + `model` together
also return a trim list. Backed by a dedicated box handler (`GET /api/inventory/facets`) reading
`dealer_inventory`'s native `state`/`make`/`model` columns directly — no JOIN — with its own
composite covering indexes (`idx_inv_facet_make_state_model`, `idx_inv_facet_state_make`,
`idx_inv_facet_make_model_state_trim`) so every cross-scoped combination stays index-only. Each
distinct filter combination is its own cache entry, never `inventoryStats()`'s or
`inventoryMakes()`'s shared whole-table cache key.

```bash
curl "https://trimscout.com/api/catalog/facets?make=Ford&model=F-150"
```

## Where the code lives

- `scrapers/lightsail-crawler/src/inventoryListQuery.js` — the shared, pure, unit-tested SQL
  query/filter/sort builder (`test/inventory_list_query.test.js`) — this is the one place both
  `/api/inventory` (admin) and the buyer search's box calls build their WHERE clause.
- `scrapers/lightsail-crawler/src/deals_api_server.js` — `handleInventoryCatalogOptions` (the
  `/api/inventory/catalog` box endpoint behind `GET /api/catalog/options`) and
  `handleInventoryFacets` (`/api/inventory/facets`, behind `GET /api/catalog/facets`).
- `lib/inventoryApi.ts` — `searchInventory()`, `catalogOptions()`, `inventoryFacets()`, the
  `BuyerSearchQuery` type.
- `lib/buyerSearchQuery.ts` — `parseBuyerSearchParams()` (the radius/make guardrail,
  `sort=distance` handling), pure and unit-tested (`lib/buyerSearchQuery.test.ts`) without
  spinning up a request.
- `lib/buyerSearch.ts` — `runBuyerSearch()`, the box call + distance post-processing behind
  `GET /api/vehicles/search`.
- `app/api/vehicles/search/route.ts`, `app/api/catalog/options/route.ts`,
  `app/api/catalog/makes/route.ts`, `app/api/catalog/facets/route.ts` — the public routes.
- `app/search/page.tsx` + `components/BuyerSearchView.tsx` +
  `components/search/SearchableDropdown.tsx` — the page itself.

## Box deploys

Everything on `scrapers/lightsail-crawler/src/*.js` needs an explicit deploy to box2
(`52.202.234.65`) — merging to `main` does **not** update the running server. As of this feature:

- `scripts/box/2026-09-25-buyer-search-schema.sh` — PR 1's schema (already run).
- `scripts/box/2026-09-25-inventory-catalog-endpoint.sh` — PR 2's new
  `/api/inventory/catalog` handler (already run).
- `scripts/box/2026-09-25-deploy-pr2-query-filters.sh` — redeploys `inventoryListQuery.js` with
  PR 2's `priceMin`/`priceMax`/`maxDays`/`exteriorColor`/`interiorColor` filters (already run —
  see below for why this was a separate, later script).

**A caution from how this actually shipped**: PR 2's box deploy script only patched
`deals_api_server.js` for the new catalog endpoint — it didn't occur to re-deploy
`inventoryListQuery.js` itself, even though PR 2 also changed that file. The gap was silent:
`GET /api/vehicles/search?priceMax=40000` returned **no error**, just unfiltered results, because
the box's old `inventoryListQuery.js` simply didn't recognize `priceMax` as a param and dropped it
on the floor. It was caught by browser-testing PR 4's actual page against live box2 data, not by
any test suite (a unit test of `inventoryListQuery.js` proves the function is correct; it can't
prove the box is running that function). **When a PR changes a box-side `.js` file, its deploy
script must re-deploy every file that PR changed** — check the PR's diff against the deploy
script's file list, not just "does the script exist," before considering the PR live.
