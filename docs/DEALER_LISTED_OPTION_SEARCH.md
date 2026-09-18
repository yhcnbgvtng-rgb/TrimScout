# Searching dealer-listed factory options

Three different things in this codebase can tell you "this car has option
X," and they are not interchangeable:

| Source | Where | Trust | Searchable today? |
|---|---|---|---|
| OEM window sticker | `lib/factoryOptionCatalogStore.ts` (`searchFactoryOptions`) | `factory_verified` — ground truth | Yes — `GET /api/admin/factory-options?q=` |
| Dealer.com structured data | `lib/dealerOptionSearch.ts` (`searchDealerListedOptions`) | Real, dealer-reported, has a code and often a real price — never factory-verified | Yes — `GET /api/admin/dealer-options?brand=&q=` |
| DealerOn free-text feature mentions | `parseFeaturesFromDescription()` in `scrapers/lightsail-crawler/src/standalone.js` | Real, dealer-written, but unpriced and uncoded | **No** — see below |

Only the first covers a real Monroney sticker; only 5 brands have one (Ford,
GM, Genesis, Hyundai, Stellantis — see `docs/FACTORY_BUILD_PROVIDERS.md`).
The other two are dealer-site data for any brand, sourced from the
Lightsail crawl box's `vehicle_options` table, and must never be shown as
factory-verified.

## Why Dealer.com options are searchable and DealerOn features aren't

Dealer.com's own data layer gives each package/option a real, stable
per-item code (`PKG-{id}`, `OPT-{id}`) — see `extractDealerListedOptions()`
in `standalone.js`. The box's `inventory_api_server.js` already facets on
that code (`GET /api/vehicles/facets?brand=` → `facets.optionCode`, each
row `{value: code, label: name, count}`), and already supports an exact
filter (`GET /api/vehicles?brand=&optionCode=`). `lib/dealerOptionSearch.ts`
just adds name matching on top of that existing facet — no box changes.

DealerOn (and similar platforms with no structured package feed) publish
only a free-text VDP description. `parseFeaturesFromDescription()` splits
that into individual feature lines, but has no way to give each one a
real, stable code — every line gets the literal placeholder code
`"FEATURE"`. Because the box's facet groups by `(code, name)`, every
DealerOn feature mention on every vehicle of a brand collapses into one
meaningless bucket keyed on that shared placeholder. You can still see a
given vehicle's own feature list (it's right there in that vehicle's
`options[]`), but there is no way to ask "which vehicles mention a
panoramic sunroof" in aggregate — that needs a box-side fix (e.g. a
FULLTEXT index or a per-name facet on `vehicle_options.name` for
uncoded rows), which needs a deploy to the Lightsail box.
