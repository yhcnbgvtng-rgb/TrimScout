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

## Allowed filter combinations, gates and latency SLOs

`/api/vehicles/search` refuses anything that would be an unbounded scan (HTTP 400, never reaches
the box). Measured live 2026-09-30: bare searches 503'd at the 20s `max_statement_time` and four at
once left three timeouts — so the fix is gating and shape, **never a raised timeout**.

| Request | Result |
|---|---|
| no `make` (bare, state-only, price-only, `q`-only, zip/radius-only) | **400** "Pick a make to search…" |
| `make` | OK |
| `make` + `model` (+ `trim`) | OK — the fast path |
| `make` + `state` (+ `model`) | OK |
| `optionKeys` without `model` | **400** "Pick a model before filtering by factory options." |
| `optionKeys` with `make` + `model` | OK, at most 8 keys |
| `radiusMiles` without `make` | **400** (`radiusMiles requires make`) |

Latency SLOs (p95, warm, one buyer): `make`+`model` **< 2s**; with ZIP radius **< 3s** (Part B);
bare **refused** immediately. Under load the box allows at most `INV_SEARCH_MAX_CONCURRENT`
(default 6) list queries at once and waits at most `INV_SEARCH_QUEUE_WAIT_MS` (3000) for a slot,
then answers **503 + `Retry-After: 2`** ("Search is busy right now") — fast and recoverable instead
of queueing behind slow queries into a timeout cascade.

**Counts.** The page is fetched first; the total is skipped entirely when the page is short (it *is*
the total), otherwise counted only up to `countCap` (the buyer route sends 1000) through a
`LIMIT cap+1` derived table that stops early. The response then carries `totalCapped: true` and the
UI shows "1,000+ vehicles". Admin calls send no `countCap` and still get the exact count.

**Buyer page query = deferred join.** The inner query picks the page's `(vin, dealer_id)` pairs from
the covering index only; just those ≤24 rows are then read whole (`deferredPageSql`). Default order
is `trim` for make+model and `model` for make+state (the exact index order of
`idx_inv_stock_make_model_trim` / `idx_inv_facet_make_state_model`, so no filesort); make alone keeps
the dealer-name default (`idx_inv_stock_make_dealer`).

**Factory-options catalog.** `GET /api/catalog/options` now returns only keys with ≥ 25 vehicles,
junk / listing-position codes dropped, labels cleaned, most common first, **max 60** (Ford F-150 had
95,895 stored (model, trim, key) facet rows and only 4,111 with 20+ vehicles).

### Measured on the live deals box, 2026-10-01 (24-row page, SELECT only, 10s cap)

| Shape | Before | After |
|---|---|---|
| `make=Ford` | 47 ms | 63 ms (deferred join; dealer order) |
| `make=Ford&model=F-150` (57,574 in stock) | 952 ms (filesort) | **204 ms** (sort=trim, index order) |
| …page 3 | — | 123 ms |
| F-150 + 1 option | timeout | **235 ms** |
| F-150 + 2 options | **> 10 s** | **891 ms** |
| F-150 in NJ (1,555) | **> 10 s** | **1.0 s** (`idx_inv_facet_make_model_state_trim`) |
| Porsche in NJ | **> 10 s** | **20 ms** (`idx_inv_facet_make_state_model`, sort=model) |
| Ford in NJ / TX | 71 ms | 31 / 27 ms |
| Capped count, F-150 | exact `COUNT(*)` | **11 ms** |
| `optionKeys` with no make/model | unbounded | **400** |

**Known gap — explicit non-index sorts** (`price`, `mileage`, `days`): F-150 `sort=price:asc` still
exceeds 10s. None of those columns are in the make+model index, so each candidate costs a row
lookup, and the box's `innodb_buffer_pool_size` is the MariaDB default **128 MB** on a 15.7 GB host
whose `dealer_inventory` is several GB — most lookups miss to disk. Raising it (it is dynamic in
10.11) is the single biggest lever for load behaviour; it is a production DB setting and has not been
changed by this work.

### EXPLAIN snapshots (live, trimmed)

```
make=Ford                      i ref idx_inv_stock_make_dealer          Using index condition; Using where
make=Ford&model=F-150          i ref idx_inv_stock_make_model_trim      Using index condition; Using where; Using filesort   (dealer sort — why the default is now trim)
make+model, capped count       <derived2> ALL 1001 / i ref idx_inv_stock_make_model_trim  Using where; Using index   (covering, stops at cap+1)
make+model+optionKeys          PRIMARY i idx_inv_stock_make_model_trim → <derived2> key0 (vin,dealer_id) ← DERIVED dealer_inventory_options range idx_opt_canonical (Using index)
state=NJ&make=Ford (dealer)    i ref idx_inv_stock_state                Using index condition; Using where
```
`optionKeys` stays a JOIN against a derived table (never a correlated subquery); the derived table
reads `idx_opt_canonical` index-only. `idx_opt_dealer_canonical` and the make/model FORCE INDEX
paths are unchanged. Query shapes are pinned in `test/inventory_list_query.test.js`.

## Dropdown payloads: stale-while-revalidate, write-proof, restart-proof

`GET /api/catalog/{makes,facets,options}` (box: `/api/inventory/{makes,facets,catalog}`) are served
from `stableCache.js`, **not** the write-invalidated `invCached`. Found live 2026-10-01: `invCached`
is cleared by every bulk upsert and every removing sweep (and a concurrent clear discards an
in-flight result), so while crawl boxes push continuously those whole-table GROUP BYs could never be
cached — and on a box that is I/O-bound from those same writes (60-78% iowait, 128 MB buffer pool)
they cannot finish inside the 20 s cap either. The Make dropdown sat on "Loading…". Now: a fresh
entry is served; an expired one is served **immediately** while a single background refresh runs; a
failed refresh keeps serving the stale value; every success is persisted to
`/opt/trimscout-deals/facet-cache.json` so a deals-api restart doesn't lose it. Only the *hit counts*
can be minutes-to-hours stale; the vehicle list is always live. A cold cache (first boot, no file)
has nothing to serve and must be warmed once while the box is quiet.

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
