# Buyer inventory search (`/search`)

A buyer-facing page over `dealer_inventory` — the crawler's own real, nightly-crawled dealer
inventory (see [`DEALER_ANALYTICS.md`](./DEALER_ANALYTICS.md) for how that data gets there). Two
ways in, one shared result set:

- A natural-language box ("black 4Runner under 40k with a moonroof near 07601") that Gemini
  translates into structured filters.
- A generic filter panel — make/model/trim, price, odometer, days on lot, colors, must-have
  factory options, ZIP + radius, sort — that works standalone with **zero AI**, always.

Both feed the same deterministic search endpoint (`GET /api/vehicles/search`), so the page never
depends on Gemini being configured or reachable. `dealer_inventory` is the only source of truth
here — this never reads MarketCheck, and never will (a deliberate scope decision for this
feature, not an oversight).

## Non-goals (confirmed scope, don't re-add without asking)

- No LLM ranking or scoring of vehicles — Gemini only fills query parameters; the same SQL that
  powers the generic filter panel does the actual matching, so "AI search" and "filter panel
  search" can never disagree about which vehicles match.
- No embeddings, no vector search.
- No AI vendor besides Gemini.
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
| `radiusMiles` | Filters to `distanceMiles <= radiusMiles`. **Requires `make` to also be set** — a nationwide radius scan with no make has nothing selective to index on (see `inventoryListQuery.js`'s make= index hint), so this returns **400** instead of running an unbounded query. The `/search` page's filter panel disables the radius input until both a ZIP and a make are entered, and the NL route (below) silently drops an AI-set radius with no make rather than failing the whole search. |
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

Distinct makes with live in-stock inventory, for the make picker. Wraps the box's existing
`GET /api/inventory/stats` — no dedicated box endpoint of its own.

### `POST /api/search/parse`

The NL box. Body: `{ "q": "<free text>", "zip"?: "<optional ZIP>" }`.

Gemini is shown **only** the buyer's own text plus a compact, real-values-only catalog slice
(distinct makes, option codes, colors) — **never** inventory rows, VINs, or dealer data — so it
can only pick values that actually exist in TrimScout's inventory, never hallucinate a make or
option code that isn't real. It fills the exact same query parameters `/api/vehicles/search`
accepts; the route then runs that search as a direct function call (`lib/buyerSearch.ts`'s
`runBuyerSearch`), not a second HTTP round trip to itself.

```bash
curl -X POST https://trimscout.com/api/search/parse \
  -H "Content-Type: application/json" \
  -d '{"q": "black 4Runner under 40k with a moonroof near 07601", "zip": "07601"}'
```

Response shape:

```json
{
  "available": true,
  "filters": { "make": "Toyota", "model": "4Runner", "priceMax": 40000, "exteriorColor": "Black", "zip": "07601", "...": null },
  "confidence": 0.86,
  "clarifications": ["..."],
  "displayChips": [{ "field": "make", "label": "Toyota" }, "..."],
  "results": { "total": 12, "limit": 50, "offset": 0, "vehicles": ["..."] }
}
```

When `GEMINI_API_KEY` or `GEMINI_MODEL` isn't configured, this returns `{"available": false,
"message": "..."}` with a **200**, not an error — the filter panel keeps working either way. A
real parse failure (bad Gemini response, non-2xx from Gemini) is a genuine 502, distinct from "not
configured."

If Gemini sets `radiusMiles` with no `make` (violating the guardrail above), the route drops the
radius and adds a `clarifications` entry explaining why, rather than failing the whole search —
an NL shopper never typed that internal query-cost rule, so it should never surface as an error to
them the way it does on the deterministic route.

## Gemini setup

```bash
GEMINI_API_KEY=
GEMINI_MODEL=
```

Both are **required together, with no hardcoded model default** — a wrong or stale model id
should fail loudly (`isGeminiEnabled()` returns false, the NL box reports itself unavailable),
never silently downgrade to some other model. See
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) for current
model ids.

**Free-tier rate limits**: Gemini's free tier caps requests per minute and per day (check current
limits on the model you choose — they change). This feature has no request-level rate limiting or
budget guard of its own (unlike the MarketCheck spend guard in
[`api-spend-protection.md`](./api-spend-protection.md)) — if usage grows enough to hit free-tier
limits or warrants a paid tier, add one modeled on `lib/apiSpendGuard.ts` before that becomes an
outage rather than after.

## Where the code lives

- `scrapers/lightsail-crawler/src/inventoryListQuery.js` — the shared, pure, unit-tested SQL
  query/filter/sort builder (`test/inventory_list_query.test.js`) — this is the one place both
  `/api/inventory` (admin) and the buyer search's box calls build their WHERE clause.
- `scrapers/lightsail-crawler/src/deals_api_server.js` — `handleInventoryCatalogOptions` (the
  `/api/inventory/catalog` box endpoint behind `GET /api/catalog/options`).
- `lib/inventoryApi.ts` — `searchInventory()`, `catalogOptions()`, the `BuyerSearchQuery` type.
- `lib/buyerSearchQuery.ts` — `parseBuyerSearchParams()` (the radius/make guardrail,
  `sort=distance` handling) and `parsedSearchFiltersToParams()` (Gemini's filters onto the wire) —
  both pure and unit-tested (`lib/buyerSearchQuery.test.ts`) without spinning up a request.
- `lib/buyerSearch.ts` — `runBuyerSearch()`, shared between the deterministic route and the NL
  parse route.
- `lib/searchParse.ts` — `parseSearchQuery()`, modeled directly on `lib/contractExtraction.ts`'s
  `serverSecret`-gated / typed-error / JSON-fence-stripping pattern. Unit-tested against mocked
  Gemini responses (`lib/searchParse.test.ts`) — no test ever calls the real Gemini API
  (`generativelanguage.googleapis.com` is in `lib/testdata/blockLiveHttp.ts`'s blocklist).
- `app/api/vehicles/search/route.ts`, `app/api/catalog/options/route.ts`,
  `app/api/catalog/makes/route.ts`, `app/api/search/parse/route.ts` — the public routes.
- `app/search/page.tsx` + `components/BuyerSearchView.tsx` — the page itself.

## Box deploys

Everything on `scrapers/lightsail-crawler/src/*.js` needs an explicit deploy to box2
(`3.237.204.55`) — merging to `main` does **not** update the running server. As of this feature:

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
