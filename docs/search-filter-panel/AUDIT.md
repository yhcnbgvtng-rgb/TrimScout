# /search filter panel: what our stored data can support (audit, 2026-10-26)

Read from the schema (`ensureInventoryTable` in `deals_api_server.js`), the list-query builder (`inventoryListQuery.js`), the crawl parsers and the repo's own investigation notes. **Nothing was read from a live box**, so the "how complete is it" column is unmeasured; `scripts/box/2026-10-27-filter-coverage-probe.mjs` (stacked box PR, read-only, not run) prints those numbers for each column.

| Filter | What we store | Verdict | In this PR |
|---|---|---|---|
| Condition (new / used / certified) | `cond` (`new`, `used`, `cpo`; `wholesale` is hidden from buyers) | Supported | Chips with counts (#581, #583) |
| Year range | `year` SMALLINT, indexed `(removed_at, year)` | Supported | Slider + per-year sparkline; counts need the box patch |
| Make, model, trim | `make`, `model`, `trim`, indexed | Supported | Chips with counts (#581) |
| Price range + sparkline | `price`, indexed | Supported | Slider + histogram (#583) |
| Mileage range | `mileage` INT, indexed `(removed_at, mileage)`. The query already took a maximum; the minimum is new. New cars are often 0 or blank. | Supported | Two-handle slider + histogram. The minimum needs the box patch |
| Exterior / interior colour | `exterior_color`, `interior_color`: the dealer's own words ("Midnight Black Metallic"), not a normalised palette | Supported, but spellings differ per dealer | Chips with counts (#583) |
| Body style | `body_style` VARCHAR. Filled only where the crawler can read it (e.g. the Team Velocity pixel; stores whose pixel is not read have none: `docs/investigations/2026-10-22-team-velocity-dealercom-blanks.md`) | Partly supported | Chips from the values present, with counts. Needs the box patch |
| Fuel type | **No column.** The text of `engine`, `model` and `trim` says hybrid / plug-in / electric / diesel; "gas" means an engine is stated and none of those words appear | Inferred only | Chips labelled by what they are; counts from the box patch. A car with no engine text is in no bucket |
| Drivetrain | **No column.** The trim text carries AWD / 4WD / 4x4 / xDrive / quattro / RWD / FWD (trim cleanup #579 keeps those tokens for every make); `engine` and `body_style` sometimes do | Inferred only | Chips (AWD / 4WD, RWD, FWD) from the same text rule the admin analytics use. A car that does not say is in no bucket |
| Transmission | `transmission` free text ("8-Speed Automatic", "CVT"). Often blank: the Ford backfill (#428) is not applied, GM EVs print none, Hyundai/Stellantis stickers are blocked | Partly supported | Grouped into automatic / manual / CVT / dual-clutch / single-speed; counts from the box patch |
| **Distance from ZIP** | **Dealers have no coordinates.** `dealership_contacts` holds city and state only; `geocode_dealers.mjs` exists but its output is not loaded. A ZIP maps to coordinates through a 3-digit-prefix / state-centroid table, with about a dozen hand-placed cities | **Not supportable as an exact filter** | Not built. The existing ZIP + radius control is unchanged: it trims the cars already on screen, so it can't be counted. The headline count now says so |
| Days on market | `days_on_lot` (the dealer's own figure, often blank) and `first_seen_at` / `crawl_first_seen` | Supported where the dealer states it | Bands on the existing `minDays` / `maxDays`. Cars with no stated figure are in no band |
| Dealer | `dealer_id`, `dealer_name`, indexed | Supported | The dealers with the most matching cars, with counts, multi-select. Needs the box patch |
| Paid factory options with price | `dealer_inventory_options`, price from the option policy | Supported | Chips with price and car count (#581), behind `OPTIONS_PAID_ONLY` |
| Keyword exclude | any text column | Supported | Box-side count (#583) |
| VIN pattern | `vin` CHAR(17) is the primary key's first column; `vin_rev` is indexed | Supported | `?` = one character, `*` = a run. A start or end of 3+ characters uses an index; any pattern is a cheap check once a make is set. Needs the box patch |

## What each unfinished item would need
- **Exact distance filter and count.** Latitude / longitude per dealer (load the geocoder's output into `dealership_contacts`, or geocode from street address, which we also do not store); a real ZIP-centroid table (Census ZCTA, ~33k rows); a box-side filter, a bounding box on the two columns plus haversine, applied after the make's index range. Until then radius stays a display aid.
- **Complete drivetrain and fuel type.** A stored column each, filled from the VIN decode (vPIC `DriveType`, `FuelTypePrimary`) or the window sticker. The text rules only see what a dealer happened to write.
- **Complete transmission and body style.** The crawler fix and backfills already scoped in #428 and the Team Velocity notes; vPIC also fills body class.
- **Coverage figures.** Run the probe on box2 to turn "partly supported" into percentages.

## How the page behaves when data is missing
- A box without the patch answers `404` to the counts call: those groups stay hidden, nothing else changes.
- A search whose filters the box did not apply (a shared link on an older box) says which ones were left out, instead of showing unfiltered cars under a filter pill.
- Counts are never shown stale: while a newer answer is on the way the lists stay but their numbers are hidden.
- A set too broad to count (more than the box's row cap) keeps the fixed choices (fuel, drivetrain, transmission, days) without numbers and asks for a model.
