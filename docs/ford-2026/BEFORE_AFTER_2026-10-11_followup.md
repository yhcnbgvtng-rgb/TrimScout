# Ford 2026 option policies, follow-up: paid Interior options kept + approved trim aliases (read-only before/after on box2, 2026-10-11)

Policy: `src/optionPolicies/ford-2026.json` after the follow-up to #455. Run by `scripts/box/2026-10-11-ford-option-policy-dry-run.mjs` (same caps and batching as the #455 run).

Read-only on box2: 5,687 dealers with Ford stock, 150,584 in-stock 2026 Fords read in 681 queries (batches of 20 dealers, 20 s cap per query), 0 timeouts, slowest query 3,430 ms, 311 s total. Nothing was written, no lock was taken, no facets were rebuilt.

## Before and after, per model

Before = the option rows stored today (`dealer_inventory_options`, what the facets and filters read). After = what the policy keeps from the same vehicle's option list. Kept / removed split the stored rows by whether the policy keeps that line for the vehicle's trim (several stored lines can fold into one policy entry, so kept can exceed the after count).

| Model | Vehicles | Rows before | Rows kept | Rows removed | Rows after (policy) | Cars with 0 options before | Cars with 0 options after | No trusted trim |
|---|---|---|---|---|---|---|---|---|
| F-150 | 41,650 | 392,425 | 51,112 | 341,313 | 27,907 | 41.5% | 73.1% | 2,075 (5.0%) |
| Maverick | 10,213 | 74,013 | 9,842 | 64,171 | 4,459 | 38.8% | 75.4% | 246 (2.4%) |
| Ranger | 6,682 | 53,146 | 10,274 | 42,872 | 6,315 | 45.1% | 70.2% | 257 (3.8%) |
| Bronco Sport | 20,387 | 135,510 | 11,896 | 123,614 | 8,786 | 32.9% | 74.9% | 387 (1.9%) |
| Bronco | 17,436 | 168,327 | 35,559 | 132,768 | 10,973 | 35.9% | 69.6% | 679 (3.9%) |
| **All five** | 96,368 | 823,421 | 118,683 | 704,738 | 58,440 | | | |

## Change versus #455 (interior items dropped, no trim aliases)

| Model | Cars with 0 options before | 0 options after: previous | 0 options after: now | Change (points) | Rows after: previous | Rows after: now | No trusted trim: previous | No trusted trim: now |
|---|---|---|---|---|---|---|---|---|
| F-150 | 41.5% | 74.2% | 73.1% | -1.1 | 26,349 | 27,907 | 2,395 | 2,075 |
| Maverick | 38.8% | 77.7% | 75.4% | -2.3 | 3,633 | 4,459 | 900 | 246 |
| Ranger | 45.1% | 70.5% | 70.2% | -0.3 | 5,587 | 6,315 | 289 | 257 |
| Bronco Sport | 32.9% | 75.9% | 74.9% | -1 | 7,105 | 8,786 | 570 | 387 |
| Bronco | 35.9% | 70% | 69.6% | -0.4 | 10,829 | 10,973 | 759 | 679 |

Average option lines per vehicle in the dealers' feeds, and dealer add-ons set aside (never shown on the website):

| Model | Raw lines / vehicle | Dealer add-ons set aside |
|---|---|---|
| F-150 | 12.23 | 681 |
| Maverick | 9.57 | 140 |
| Ranger | 10.39 | 127 |
| Bronco Sport | 9.09 | 666 |
| Bronco | 12.15 | 205 |

## Top 10 options that remain, per model (vehicles carrying each)

### F-150

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | XLT (301A) | package | 4,773 |
| 2 | XLT Mid (302A) | package | 4,742 |
| 3 | Bedliner – Tough Bed Spray-In | option | 2,522 |
| 4 | Bed Utility Package | package | 2,112 |
| 5 | Lariat Mid (501A) | package | 1,959 |
| 6 | XLT High (303A) | package | 1,406 |
| 7 | Lariat Black Appearance Package | package | 1,398 |
| 8 | FX4 Off-Road Package | package | 1,316 |
| 9 | Tow/Haul Package | package | 1,261 |
| 10 | Mobile Office Package | package | 1,158 |

### Maverick

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | XLT Luxury Package | package | 961 |
| 2 | Power-Sliding Rear Window | option | 781 |
| 3 | XLT (301A) Equipment Group | package | 610 |
| 4 | Power Moonroof | option | 547 |
| 5 | Bedliner – Tough Bed spray-in | option | 373 |
| 6 | Ford Co-Pilot360 | package | 309 |
| 7 | Conventional 17" Spare Tire | option | 254 |
| 8 | 4K Tow Package | package | 232 |
| 9 | XL (101A) Equipment Group | package | 182 |
| 10 | Black Appearance Package | package | 126 |

### Ranger

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Trailer Tow Package | package | 1,258 |
| 2 | Power-Sliding Rear Window | option | 699 |
| 3 | Black Running Boards | option | 686 |
| 4 | Equipment Group XLT High (301A) | package | 633 |
| 5 | FX4 Off-Road Package | package | 608 |
| 6 | Convenience Package | package | 499 |
| 7 | Black Appearance Package | package | 482 |
| 8 | Bedliner – Tough Bed Spray-In | option | 422 |
| 9 | Advanced Towing Package Plus Technology Package | package | 256 |
| 10 | Integrated Box Side Step | option | 167 |

### Bronco Sport

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Convenience Package | package | 2,063 |
| 2 | Power Moonroof | option | 1,545 |
| 3 | Outer Banks Tech Package+ | package | 1,451 |
| 4 | Class II Trailer Tow Package with Trailer Sway Control | package | 972 |
| 5 | Badlands Tech Package | package | 609 |
| 6 | Black Appearance Package | package | 332 |
| 7 | Interior Protection Package | package | 250 |
| 8 | Bronze Package | package | 235 |
| 9 | Black Diamond Off-Road Package | package | 221 |
| 10 | Front Brush Guard with Integrated Recovery Hooks | option | 197 |

### Bronco

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Big Bend Mid Package (222A) | package | 2,265 |
| 2 | Sasquatch Package | package | 1,356 |
| 3 | Keyless Entry Keypad | option | 976 |
| 4 | Black Appearance Package | package | 917 |
| 5 | Outer Banks - Lux Package (314A) | package | 890 |
| 6 | Badlands - Mid Package (332A) | package | 860 |
| 7 | Side Step | option | 753 |
| 8 | Badlands - Lux Package (334A) | package | 646 |
| 9 | Front Stabilizer Disconnect | package | 577 |
| 10 | Black Diamond Package | package | 421 |

## Trims that are not trusted (these cars get no options)

Per the rule "no trusted trim means no options". These are the commonest untrusted trims left. As with the Toyota policies, an alias is added only after approval.

- **F-150** (2,075 cars): `(blank)` 890, `4WD Automatic` 56, `XLT 4WD SuperCrew 5.5'` 51, `Raptor R` 40, `XLT 4WD Automatic` 34, `XLT 5-1/2 Box` 27, `XLT 4WD SUPERCREW 5.5'` 23, `4X2 Crewcab STX` 22, `XLT 4WD SUPERCREW 5.5` 22, `STX 4WD SuperCrew 5.5'` 18
- **Maverick** (246 cars): `(blank)` 122, `XLT Crossroads Courtesy Demo` 9, `Truck SuperCrew I-4 cyl` 7, `XLT FWD CVT` 7, `Base` 6, `XLT AWD CVT` 6, `XLT CC` 6, `New 2026 Ford Maverick XLT SuperCrew®` 5, `Maverick XLT FW` 4, `XL FWD CVT` 4
- **Ranger** (257 cars): `(blank)` 120, `XLT 4WD SuperCrew 5'` 13, `XL STX` 8, `LARIAT 4WD SuperCrew 5'` 6, `XL 4WD Automatic` 6, `XLT 4WD Automatic` 6, `XL 2WD SuperCrew 5'` 5, `XLT Sport` 5, `Inventory` 4, `EcoBoost&reg Engine` 3
- **Bronco Sport** (387 cars): `(blank)` 133, `Big Bend 4WD Automatic` 34, `Outer Banks 4WD Automatic` 30, `Big Bend - Crossroads` 27, `Badlands 4WD Automatic` 21, `Big Bend Upcoming Demo` 11, `Base` 8, `Bronco SPT OB` 8, `Outer Banks - Crossroads` 8, `New 2026 Ford Bronco Sport Big Bend® 5 Door SUV, SUV &amp; Crossovers` 7
- **Bronco** (679 cars): `(blank)` 297, `Outer Banks 4WD Automatic` 21, `4WD Automatic` 20, `Big Bend 4WD Automatic` 19, `Big Bend - Crossroads` 16, `Badlands 4 Door Advanced` 15, `SUV EcoBoost&reg I-4 Engine` 13, `Badlands 4WD Automatic` 11, `RAPTOR 4 DOOR ADVANCED` 8, `60th Anniversary` 7

Only the approved aliases are applied (see POLICY_REPORT.md); every string above stays untrusted.

## Untouched

Fords outside the five models, or other model years, were read but not classified: 2026 Explorer 13,505, 2026 Mustang 5,783, 2026 F-250SD 4,971, 2026 F-350SD 3,554, 2026 Super Duty F-250 SRW 2,767, 2026 F-250 2,384, 2026 Mustang Mach-E 2,232, 2026 F-350 1,558, 2026 Expedition 1,474, 2026 Super Duty F-350 SRW 1,329, 2026 Super Duty 1,264, 2026 Transit-250 1,246.

