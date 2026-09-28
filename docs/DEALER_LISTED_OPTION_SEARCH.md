# Searching dealer-listed factory options

Three different things in this codebase can tell you "this car has option
X," and they are not interchangeable:

| Source | Where | Trust | Searchable today? |
|---|---|---|---|
| OEM window sticker | `lib/factoryOptionCatalogStore.ts` (`searchFactoryOptions`) | `factory_verified` — ground truth | Yes — `GET /api/admin/factory-options?q=` |
| Dealer-listed coded option (Dealer.com, or any other source with a real per-item code) | `lib/dealerOptionSearch.ts` (`searchDealerListedOptions`) | Real, dealer-reported, has a code and often a real price — never factory-verified | Yes — `GET /api/admin/dealer-options?make=&q=` |
| DealerOn free-text feature mentions | `parseFeaturesFromDescription()` in `scrapers/lightsail-crawler/src/standalone.js` | Real, dealer-written, but unpriced and uncoded | Yes — `GET /api/admin/dealer-features?make=&q=` |

Only the first covers a real Monroney sticker; only 5 brands have one
(Ford, GM, Genesis, Hyundai, Stellantis — see `docs/FACTORY_BUILD_PROVIDERS.md`).
The other two are dealer-site data for any make, and must never be shown
as factory-verified.

## Where this data actually lives (as of 2026-09-17)

An earlier version of this system ran on its own dedicated Lightsail
crawler box (`inventory_api_server.js`, a `vehicle_options` table keyed by
`brand_id`) — **that box is decommissioned.** If you find references to it
elsewhere (old memory, old comments), they describe dead infrastructure;
don't design or deploy anything against it.

The live pipeline today is the deals box's `dealer_inventory` table (port
3004, `deals_api_server.js`) — see `lib/inventoryApi.ts` and
[[project_trimscout_dealer_inventory_pipeline]]. Each vehicle's
`options_json` column is an opaque JSON blob written by
`scripts/box/inventory-sync.mjs`'s `options()` mapper from the crawl's
`factoryOptions` (real per-item codes) and `dealerListedOptions` (mixed:
real Dealer.com codes *and* DealerOn's uncoded `"FEATURE"`-placeholder
mentions, both produced in `standalone.js`). That blob alone isn't
searchable in aggregate — grouping it would mean scanning and
JSON-parsing 250K+ MEDIUMTEXT rows per query.

`ensureInventoryTable()` in `deals_api_server.js` also maintains a
normalized side table, `dealer_inventory_options` (one row per option/
feature per vehicle, `make` denormalized onto it — the same design the
old crawler box used for `vehicle_options`, for the same reason: a facet
query needs to group/count without a join or a full-table JSON scan).
`handleInventoryBulk` deletes and reinserts a vehicle's rows there
whenever a bulk-upsert payload carries a non-empty `options[]` array. A
second small table, `dealer_option_names` (`make`, `code`) →
canonical name, resolves a coded facet row's label cheaply — mirroring
the old crawler box's `option_names` table (an aggregate `MIN(name)` over
the options table directly was confirmed live to take 45s at a comparable
row count on that system; this avoids repeating that mistake).

## Why "coded" and "feature" are two separate facets

Dealer.com's own data layer gives each package/option a real, stable
per-item code (`PKG-{id}`, `OPT-{id}`) — see `extractDealerListedOptions()`
in `standalone.js`. `handleInventoryOptionFacet` (`GET
/api/inventory/options/facet?make=&type=coded`) groups
`dealer_inventory_options` rows by that code, and `GET
/api/inventory?make=&optionCode=` filters by an exact match.
`lib/dealerOptionSearch.ts`'s `searchDealerListedOptions()` /
`listVehiclesWithDealerOption()` just add name matching on top of that
facet.

DealerOn (and similar platforms with no structured package feed) publish
only a free-text VDP description. `parseFeaturesFromDescription()` splits
that into individual feature lines, but has no way to give each one a
real, stable code — every line gets the literal placeholder code
`"FEATURE"` (`UNCODED_FEATURE_CODE` on the box, `UNCODED_FEATURE_PLACEHOLDER`
in `lib/dealerOptionSearch.ts`). Grouping those by `code` the way the
coded facet does would collapse every DealerOn feature mention on every
vehicle of a make into one meaningless bucket keyed on that shared
placeholder — so `type=feature` groups by `name` instead, scoped to just
that placeholder code. It has its own exact-match filter too: `GET
/api/inventory?make=&featureText=`. `lib/dealerOptionSearch.ts`'s
`searchDealerFeatureText()` / `listVehiclesWithDealerFeature()` read that
facet the same way the coded functions read `optionCode` — same
null-on-unreachable / `[]`-on-no-matches contract, exposed at `GET
/api/admin/dealer-features`.

**Until 2026-09-17, `parseFeaturesFromDescription()` wasn't even called**
— it wrote real code once (feeding `extractSchemaOrgVehicle()`'s
`dealerListedOptions`), then got deliberately reverted after a live
failure on Porsche Beverly Hills: that dealer's description field was
sometimes an undelimited third-party spec-sheet dump ("Standard
EquipmentMECHANICALFull-Time All-Wheel3.36 Axle Ratio...") with no real
item boundaries, and splitting it produced garbled garbage rather than
real features. `looksUndelimited()` now guards against exactly that
pattern (two or more "words jammed together with no separator" signals),
so the parser is wired back in. Separately, `inventory-sync.mjs`'s
`options()` mapper used to hardcode `code: null` for every dealer-listed
option regardless of source, discarding real Dealer.com codes along with
the placeholder ones — fixed the same day, so a real code now survives
into `dealer_inventory_options` when the source actually has one.

These stay unpriced (`price: 0`/`null`, meaning "unknown", not "free")
and are never shown as factory-verified — DealerOn's free-text mentions
are the dealer's own words about the car, nothing more.
