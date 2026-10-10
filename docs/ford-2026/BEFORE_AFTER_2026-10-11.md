# Ford 2026 option policies: read-only before/after on box2 (2026-10-11)

Policy: `src/optionPolicies/ford-2026.json` (F-150, Maverick, Ranger, Bronco Sport, Bronco; 2026 only), built from `ford_lineup_options_by_trim.csv` by `scripts/build-ford-option-policy.mjs`. Run by `scripts/box/2026-10-11-ford-option-policy-dry-run.mjs`.

Read-only on box2: 5,687 dealers with Ford stock, 150,584 in-stock 2026 Fords read in 681 queries (batches of 20 dealers, 20 s cap per query), 0 timeouts, slowest query 3,133 ms, 312 s total. Nothing was written, no lock was taken, no facets were rebuilt.

## Before and after, per model

Before = the option rows stored today (`dealer_inventory_options`, what the facets and filters read). After = what the policy keeps from the same vehicle's option list. Kept / removed split the stored rows by whether the policy keeps that line for the vehicle's trim (several stored lines can fold into one policy entry, so kept can exceed the after count).

| Model | Vehicles | Rows before | Rows kept | Rows removed | Rows after (policy) | Cars with 0 options before | Cars with 0 options after | No trusted trim |
|---|---|---|---|---|---|---|---|---|
| F-150 | 41,650 | 392,425 | 49,320 | 343,105 | 26,349 | 41.5% | 74.2% | 2,395 (5.8%) |
| Maverick | 10,213 | 74,013 | 8,924 | 65,089 | 3,633 | 38.8% | 77.7% | 900 (8.8%) |
| Ranger | 6,682 | 53,146 | 10,102 | 43,044 | 5,587 | 45.1% | 70.5% | 289 (4.3%) |
| Bronco Sport | 20,387 | 135,510 | 10,197 | 125,313 | 7,105 | 32.9% | 75.9% | 570 (2.8%) |
| Bronco | 17,436 | 168,327 | 35,139 | 133,188 | 10,829 | 35.9% | 70% | 759 (4.4%) |
| **All five** | 96,368 | 823,421 | 113,682 | 709,739 | 53,503 | | | |

Average option lines per vehicle in the dealers' feeds, and dealer add-ons set aside (never shown on the website):

| Model | Raw lines / vehicle | Dealer add-ons set aside |
|---|---|---|
| F-150 | 12.23 | 681 |
| Maverick | 9.57 | 140 |
| Ranger | 10.39 | 127 |
| Bronco Sport | 9.09 | 667 |
| Bronco | 12.15 | 207 |

## Top 10 options that remain, per model (vehicles carrying each)

### F-150

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | XLT (301A) | package | 4,672 |
| 2 | XLT Mid (302A) | package | 4,644 |
| 3 | Bedliner – Tough Bed Spray-In | option | 2,450 |
| 4 | Bed Utility Package | package | 2,049 |
| 5 | Lariat Mid (501A) | package | 1,935 |
| 6 | XLT High (303A) | package | 1,396 |
| 7 | Lariat Black Appearance Package | package | 1,381 |
| 8 | FX4 Off-Road Package | package | 1,302 |
| 9 | Tow/Haul Package | package | 1,250 |
| 10 | Mobile Office Package | package | 1,150 |

### Maverick

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | XLT Luxury Package | package | 947 |
| 2 | Power-Sliding Rear Window | option | 686 |
| 3 | XLT (301A) Equipment Group | package | 600 |
| 4 | Ford Co-Pilot360 | package | 295 |
| 5 | Bedliner – Tough Bed spray-in | option | 268 |
| 6 | Conventional 17" Spare Tire | option | 237 |
| 7 | 4K Tow Package | package | 227 |
| 8 | XL (101A) Equipment Group | package | 179 |
| 9 | Black Appearance Package | package | 126 |
| 10 | Engine Block Heater | option | 27 |

### Ranger

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Trailer Tow Package | package | 1,246 |
| 2 | Equipment Group XLT High (301A) | package | 750 |
| 3 | Black Running Boards | option | 686 |
| 4 | FX4 Off-Road Package | package | 604 |
| 5 | Convenience Package | package | 499 |
| 6 | Black Appearance Package | package | 477 |
| 7 | Bedliner – Tough Bed Spray-In | option | 413 |
| 8 | Advanced Towing Package Plus Technology Package | package | 256 |
| 9 | Integrated Box Side Step | option | 166 |
| 10 | Technology Package | package | 108 |

### Bronco Sport

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Convenience Package | package | 2,034 |
| 2 | Outer Banks Tech Package+ | package | 1,433 |
| 3 | Class II Trailer Tow Package with Trailer Sway Control | package | 949 |
| 4 | Badlands Tech Package | package | 608 |
| 5 | Black Appearance Package | package | 328 |
| 6 | Interior Protection Package | package | 249 |
| 7 | Bronze Package | package | 226 |
| 8 | Black Diamond Off-Road Package | package | 211 |
| 9 | Front Brush Guard with Integrated Recovery Hooks | option | 193 |
| 10 | Sasquatch Badlands Package | package | 185 |

### Bronco

| # | Option | Kind | Vehicles |
|---|---|---|---|
| 1 | Big Bend Mid Package (222A) | package | 2,242 |
| 2 | Sasquatch Package | package | 1,337 |
| 3 | Keyless Entry Keypad | option | 963 |
| 4 | Black Appearance Package | package | 905 |
| 5 | Outer Banks - Lux Package (314A) | package | 881 |
| 6 | Badlands - Mid Package (332A) | package | 845 |
| 7 | Side Step | option | 751 |
| 8 | Badlands - Lux Package (334A) | package | 637 |
| 9 | Front Stabilizer Disconnect | package | 572 |
| 10 | Black Diamond Package | package | 409 |

## Trims that are not trusted (these cars get no options)

Per the rule "no trusted trim means no options". The strings below are the commonest untrusted trims. They are NOT aliased: as with the Toyota policies, an alias is added only after approval. Candidates are listed after the table.

- **F-150** (2,395 cars): `(blank)` 890, `XLT 302A` 68, `4WD Automatic` 56, `XLT 4WD SuperCrew 5.5'` 51, `Raptor R` 40, `XLT Intransit` 36, `XLT 4WD Automatic` 34, `XLT In Transit` 31, `STX 200A` 30, `XLT 5-1/2 Box` 27
- **Maverick** (900 cars): `Lobo Standard` 363, `Lobo High` 185, `(blank)` 122, `XLT Fleet` 26, `XLT Demo` 13, `XLT 301A Hybrid` 10, `XLT Crossroads Courtesy Demo` 9, `Truck SuperCrew I-4 cyl` 7, `XLT FWD CVT` 7, `Base` 6
- **Ranger** (289 cars): `(blank)` 120, `XLT 4WD SuperCrew 5'` 13, `XL STX` 8, `XLT 300A` 8, `LARIAT 4WD SuperCrew 5'` 6, `XL 4WD Automatic` 6, `XLT 4WD Automatic` 6, `XL 100A` 5, `XL 2WD SuperCrew 5'` 5, `XLT Sport` 5
- **Bronco Sport** (570 cars): `(blank)` 133, `Big Bend Demo` 54, `Big Bend 4WD Automatic` 34, `Outer Banks 4WD Automatic` 30, `Big Bend 200A` 29, `Big Bend - Crossroads` 27, `Outer Banks Demo` 22, `Badlands 4WD Automatic` 21, `Big Bend IN TRANSIT` 15, `Outer Banks 300A` 15
- **Bronco** (759 cars): `(blank)` 297, `Outer Banks 4WD Automatic` 21, `4WD Automatic` 20, `Big Bend 4WD Automatic` 19, `Big Bend 222A` 17, `Big Bend - Crossroads` 16, `Badlands 4 Door Advanced` 15, `SUV EcoBoost&reg I-4 Engine` 13, `Badlands 4WD Automatic` 11, `Outer Banks 314A` 9

Candidate aliases for approval (none applied): `Lobo High` and `Lobo Standard` -> Maverick `Lobo`; a trailing Ford order code (`XLT 302A`, `Big Bend 222A`, `STX 200A`) -> the trim before it; status words (`Demo`, `Fleet`, `In Transit`) -> ignored; `Raptor R` -> F-150 `Raptor`.

## What the "no interior items" rule costs

Ford's configurator tags 27 priced options "Interior" (Power Moonroof, Integrated Trailer Brake Controller, Pro Power Onboard, Slide-Out Tailgate, Aux Switches and Wiring...). The policy drops them. Same read-only run with them kept:

| Model | Rows after (rule applied) | Rows after (interior kept) | Cars with 0 options after (rule applied) | Cars with 0 options after (interior kept) | Cars that would gain an option |
|---|---|---|---|---|---|
| F-150 | 26,349 | 27,340 | 74.2% | 73.7% | ~208 |
| Maverick | 3,633 | 4,060 | 77.7% | 77.3% | ~41 |
| Ranger | 5,587 | 6,268 | 70.5% | 70.5% | ~0 |
| Bronco Sport | 7,105 | 8,635 | 75.9% | 75.4% | ~102 |
| Bronco | 10,829 | 11,023 | 70% | 69.6% | ~70 |

Top options with the interior items kept:

- **F-150**: XLT (301A) 4,672; XLT Mid (302A) 4,644; Bedliner – Tough Bed Spray-In 2,450; Bed Utility Package 2,049; Lariat Mid (501A) 1,935; XLT High (303A) 1,396; Lariat Black Appearance Package 1,381; FX4 Off-Road Package 1,302; Tow/Haul Package 1,250; Mobile Office Package 1,150
- **Maverick**: XLT Luxury Package 947; Power-Sliding Rear Window 686; XLT (301A) Equipment Group 600; Power Moonroof 427; Ford Co-Pilot360 295; Bedliner – Tough Bed spray-in 268; Conventional 17" Spare Tire 237; 4K Tow Package 227; XL (101A) Equipment Group 179; Black Appearance Package 126
- **Ranger**: Trailer Tow Package 1,246; Power-Sliding Rear Window 695; Black Running Boards 686; Equipment Group XLT High (301A) 630; FX4 Off-Road Package 604; Convenience Package 499; Black Appearance Package 477; Bedliner – Tough Bed Spray-In 413; Advanced Towing Package Plus Technology Package 256; Integrated Box Side Step 166
- **Bronco Sport**: Convenience Package 2,034; Power Moonroof 1,521; Outer Banks Tech Package+ 1,433; Class II Trailer Tow Package with Trailer Sway Control 949; Badlands Tech Package 608; Black Appearance Package 328; Interior Protection Package 249; Bronze Package 226; Black Diamond Off-Road Package 211; Front Brush Guard with Integrated Recovery Hooks 193
- **Bronco**: Big Bend Mid Package (222A) 2,242; Sasquatch Package 1,337; Keyless Entry Keypad 963; Black Appearance Package 905; Outer Banks - Lux Package (314A) 881; Badlands - Mid Package (332A) 845; Side Step 751; Badlands - Lux Package (334A) 637; Front Stabilizer Disconnect 572; Black Diamond Package 409

## Untouched

Fords outside the five models, or other model years, were read but not classified: 2026 Explorer 13,505, 2026 Mustang 5,783, 2026 F-250SD 4,971, 2026 F-350SD 3,554, 2026 Super Duty F-250 SRW 2,767, 2026 F-250 2,384, 2026 Mustang Mach-E 2,232, 2026 F-350 1,558, 2026 Expedition 1,474, 2026 Super Duty F-350 SRW 1,329, 2026 Super Duty 1,264, 2026 Transit-250 1,246.

