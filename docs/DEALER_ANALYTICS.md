# Dealership analytics (Admin → Site Analytics)

Deep dealer / inventory velocity from the nightly Lightsail crawl of franchise rooftops (public listing pages). Everything is aggregated on the deals box and drawn on the existing Site Analytics page — nothing is scraped at page-load time.

**DOM here means days on market — days a vehicle has sat on the lot.** It is never the HTML DOM. (The crawl box may keep page snapshots in a table named `vehicle_dom_snapshots`; that is unrelated to these metrics.)

## Tables that power the page (deals box, MariaDB)

| Table | What it holds | Used for |
|---|---|---|
| `dealer_inventory` | one row per (VIN, store): make / model / trim / year, price, msrp, `days_on_lot`, `window_sticker_url`, `options_json`, `image_url`, `first_seen_at`, `last_seen_at`, `removed_at`, `crawl_first_seen`, `price_diff` | every DOM, velocity, pricing, coverage and quality figure |
| `dealer_inventory_days` | one row per (VIN, store, day) with that day's price | price cuts by lot age |
| `dealership_contacts` | the dealer directory: state, city, `contact_email` | state filter, sales-email coverage |

Endpoint: `GET /api/inventory/analytics?state=&make=&dealerId=&model=&from=&to=` on the deals API (`scripts/box/2026-09-17-inventory-analytics.sh`), reached by the app through `GET /api/admin/inventory?analytics=1&…` (admin session). Results are cached **10 minutes per filter set** and invalidated by every bulk upsert / sweep, so the nightly sync (06:15 ET) refreshes them; the first page load after a sync recomputes once (~1 s on 150k rows) and every later load is served from cache. If the tables grow past a few million rows, the next step is a `inventory_daily_summary` table written by the sync — the SQL in `computeInventoryAnalytics` is the spec for it.

## Metric definitions

| Metric | Definition |
|---|---|
| **DOM (per vehicle)** | `days_on_lot` from the crawl when present, else `(removed_at ?? today) − (crawl_first_seen ?? first_seen_at)` in whole days |
| **Avg / median DOM** | mean and MEDIAN() of per-vehicle DOM over in-stock rows (`removed_at IS NULL`) in the filter scope, by model / dealer / model+trim / model year / drivetrain / powertrain |
| **Bands** | 0–14 · 15–45 · 46–90 · 90+ days; counts and shares |
| **Removed** | the crawl stopped seeing the VIN at that store (sold-ish, or moved) — the only churn signal public listings give |
| **Weekly turn rate** | removed in the last 7 days ÷ on lot now, ×100 |
| **Market days supply** | on lot ÷ weekly sales pace, where pace = removed in 28 days ÷ 4 (falls back to the last 7 days when there is no 28-day history yet) |
| **List vs MSRP** | (MSRP − list price) ÷ MSRP, only where both are known and > 0; positive = discount |
| **Price cuts by lot age** | from `dealer_inventory_days`: every day-over-day price decrease, bucketed by the vehicle's age on the day of the cut (< 30 / 30–59 / 60–89 / 90+), with count, average $ cut and average % |
| **Model mix vs brand norm** | this scope's share of each model within its brand, minus the brand's share across every store we crawl (share points) |
| **Sticker URL coverage** | in-stock rows with `window_sticker_url` ÷ in-stock rows |
| **Options resolved** | in-stock rows with `options_json` (must-have matching can work on these) ÷ in-stock rows. Listing options are never treated as the factory Monroney |
| **Sales email coverage** | rooftops with a `contact_email` in the directory ÷ rooftops with inventory |
| **No price / no photo** | in-stock rows with no positive price / no `image_url` |
| **Stale** | in-stock rows not seen by the crawl in 2 days — the proxy for crawl failures or bot walls at that store |
| **Drivetrain / powertrain** | read from the listing's trim / engine text (AWD, xDrive, 4MATIC…; Hybrid, Plug-in, Electric, Diesel); "Not stated" when the page didn't say |

Not captured by the crawl today (shown as notes, not numbers): on-lot vs in-transit / in-production, and local geo cohorts beyond the state filter.

## Scope and defaults

The crawler is scoped to franchise brands that don't publish window stickers publicly — Toyota, Lexus, Kia, Honda, Acura, Nissan, Infiniti, Subaru, Mazda, VW, Audi, BMW, Mercedes-Benz, Volvo, Porsche, MINI, Mitsubishi. The page filters to those by default (`lib/dealerAnalytics.ts` → `IN_SCOPE_MAKES`); "include out-of-scope brands" widens it. Default views are single-franchise rollups; a dealer group only dominates a view when you filter to it.

## Verifying the math

`lib/dealerAnalytics.test.ts` pins the formulas (DOM, bands, median, turn, days supply, discount, mix). `scripts/probes/verify-dealer-analytics.mts [dealerId]` recomputes one dealer's DOM / bands / coverage / discount from raw rows and diffs it against the endpoint.
