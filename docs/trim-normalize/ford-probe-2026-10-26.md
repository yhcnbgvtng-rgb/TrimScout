# Ford trim probe, 2026-10-26

Read-only profile of `trim` for `make = 'Ford'` in `dealer_inventory` on box2. Counts only, no row data. Nothing was written or restarted. Proposal only: no normalizer is built or enabled by this doc.

## How it was run

- box2 (`52.202.234.65`, per `docs/BOXES.md`), `mysql` with the deals app's `DB_READER_USER` (read-only account), `SET SESSION TRANSACTION READ ONLY`, `max_statement_time=90`.
- Three queries total, all `WHERE make='Ford' AND removed_at IS NULL` (plus one `COUNT(*) WHERE make='Ford'`): `GROUP BY model, trim`, and `GROUP BY model, trim, SUBSTRING(vin,5,3), SUBSTRING(vin,10,1)`. `EXPLAIN` showed an index-only plan on the make-leading covering index (`idx_inv_facet_make_model_state_trim`, ~753k rows examined). Each ran in about 4 s.
- Active = `removed_at IS NULL`. The live site shows fewer cars (328,585 for Ford at the last check) because it also hides stale rows.

## 1. Totals

| | rows |
|---|---|
| Ford rows, all (including removed) | 660,018 |
| Ford rows, active (`removed_at IS NULL`) | 358,539 |
| Distinct trim strings, active | 5,189 (incl. blank/NULL) |
| Distinct (model, trim) pairs, active | 8,091 |
| Active rows in the 9 models below | 287,996 (80.3%) |

The other 70,543 active rows are Bronco Sport, Edge, Transit, Mach-E, Fusion, Focus, Lightning and so on; not profiled further.

## 2. Top 40 trim strings per model (active rows)

`Expedition` includes Expedition MAX; `Super Duty` folds F-250/350/450/550 (SD, SRW, DRW spellings); `Mustang` excludes Mach-E; `F-150` excludes Lightning.

### F-150 (87,385 rows)

`XLT` 34,290; `Lariat` 12,708; `STX` 9,310; `XL` 8,261; `Platinum` 3,905; (blank) 3,378; `Raptor` 3,266; `Tremor` 2,666; `King Ranch` 2,460; `4X4 CREWCAB XLT` 360; `XLT 4WD SuperCrew 5.5'` 353; `Limited` 337; `Truck SuperCrew` 214; `Truck SuperCrew Cab V-6` 212; `Base` 173; `4X4 Crew Lariat` 169; `XLT 4WD Supercrew 5.5 Box` 153; `Raptor R` 119; `FX4` 115; `LARIAT 4WD SuperCrew 5.5'` 100; `4WD Automatic` 90; `XLT 302A` 75; `STX 4WD SuperCrew 5.5'` 66; `Truck SuperCrew Cab V-8` 65; `Lariat 4WD Supercrew 5.5 Box` 56; `SVT Raptor` 55; `XLT 4WD Automatic` 55; `XLT 4WD SuperCrew 5.5` 54; `XL 4WD SuperCrew 5.5'` 52; `F150 Raptor CRW` 50; `STX 4WD Supercrew 5.5 Box` 46; `King Ranch 4WD SuperCrew` 43; `Platinum 4WD SUPERCREW` 43; `XL 4WD Supercrew 5.5 Box` 41; `4WD` 39; `Raptor 4WD SuperCrew 5.5'` 39; `XL Fleet` 36; `Raptor 4WD Supercrew 5.5 Box` 35; `XLT 4x4 SuperCrew Cab 5.5 ft. box 145 in. WB` 35; `4x4` 33

### Super Duty (54,963 rows)

`XL` 13,209; `Lariat` 9,257; `XLT` 6,232; `Platinum` 4,307; (blank) 2,636; `King Ranch` 2,578; `XL DRW` 1,502; `LARIAT` 1,061; `Base` 695; `Truck Crew Cab V-8` 693; `F 250 Lariat` 509; `Lariat DRW` 504; `F 250 XL` 446; `F-250 XL` 374; `F-250 Lariat` 361; `Platinum DRW` 331; `F-350 XL` 324; `F 250 XLT` 320; `F 350 Lariat` 301; `Preferred` 282; `XLT DRW` 267; `F-250 XLT` 264; `F-350 Lariat` 254; `King Ranch DRW` 240; `F 350 XL` 223; `Limited` 218; `F 350 XLT` 199; `F-350 XLT` 184; `F 350 Platinum` 176; `4WD Automatic` 157; `F 250 Platinum` 153; `F-250 Platinum` 134; `XL Fleet` 124; `F 250 King Ranch` 123; `F-550 XL` 109; `LARIAT 4WD` 97; `F 350 King Ranch` 97; `F-350 Platinum` 93; `XL 4WD` 92; `XL Commercial` 85

### Ranger (11,736 rows)

`XLT` 5,402; `XL` 2,476; `Lariat` 1,700; `Raptor` 1,072; (blank) 436; `XLT 4WD Supercrew 5 Box` 45; `XLT 4WD SUPERCREW 5'` 45; `Truck SuperCrew I-4 cyl` 34; `Base` 22; `Truck SuperCrew` 21; `Lariat 4WD Supercrew 5 Box` 19; `LARIAT 4WD SuperCrew 5'` 19; `XL STX` 13; `XL 2WD SuperCrew 5'` 12; `Sport` 11; `XL 4WD SUPERCREW 5'` 11; `XLT 2.3 Liter EcoBoost` 10; `LARIAT 4WD SuperCrew 5` 9; `RAPTOR 4WD SUPERCREW 5'` 9; `STX` 9; `XLT 300A` 9; `4WD Automatic` 8; `XL 4WD SuperCrew 5 Box` 8; `XLT 2WD SuperCrew 5'` 8; `Edge` 7; `XL 4WD Automatic` 7; `Inventory` 6; `Raptor 4WD Supercrew 5 Box` 6; `Raptor 4x4 SuperCrew 5 ft. box 128.7 in. WB` 6; `Truck SuperCab I-4 cyl` 6; `XL Fleet` 6; `XLT 4WD Automatic` 6; `XLT SuperCrew` 6; `FX4 Off-Road` 5; `Lariat 4x4` 5; `Lariat 4x4 SuperCrew 5 ft. box 126.8 in. WB` 5; `Truck SuperCab` 5; `XL 2WD Supercrew 5 BOX` 5; `XL 4WD Supercab 6 Box` 5; `XLT 4x4 SuperCrew 5 ft. box 128.7 in. WB` 5

### Maverick (13,867 rows)

`XLT` 7,145; `XL` 2,386; `Lariat` 2,221; `Tremor` 570; `Lobo Standard` 407; `Lobo High` 232; (blank) 169; `Lobo` 150; `XLT AWD Supercrew` 84; `XL AWD Supercrew` 35; `XLT FWD SuperCrew` 25; `XLT Fleet` 23; `LARIAT AWD SuperCrew` 21; `Truck SuperCrew I-4 cyl` 21; `Truck SuperCrew` 20; `XLT Advanced` 19; `XL FWD SuperCrew` 18; `Lariat Advanced` 13; `XLT AWD` 12; `XLT Demo` 12; `XLT 301A Hybrid` 10; `Tremor AWD Supercrew` 9; `XLT Hybrid` 9; `Base` 7; `Lariat AWD` 7; `Lobo High AWD SuperCrew` 7; `HYBRID ENGINE` 6; `LARIAT Advanced AWD Supercrew` 6; `Lariat HYBRID AWD` 6; `Lobo Standard All-Wheel Drive SuperCrew 4.5 ft. bo` 6; `Lobo Standard AWD Supercrew` 6; `XLT All-Wheel Drive Supercrew 4.5 ft. box 121.1 in` 6; `Lariat 501A Hybrid` 5; `New 2026 Ford Maverick XLT SuperCrew` 5; `XL 101A Hybrid` 5; `XLT 2.0 Liter EcoBoost` 5; `XLT Crossroads Courtesy Demo` 5; `XLT In Transit` 5; `Lariat Hybrid` 4; `LARIAT SuperCrew` 4

### Bronco (27,325 rows)

`Big Bend` 8,973; `Outer Banks` 5,790; `Badlands` 4,311; `Raptor` 1,779; `Heritage Edition` 1,497; `Base` 1,445; `Wildtrak` 850; (blank) 795; `Black Diamond` 422; `Stroppe Edition` 109; `Big Bend 4 Door` 97; `Outer Banks 4 Door` 61; `Everglades` 56; `Badlands 4 Door Advanced` 46; `First Edition` 46; `Outer Banks Advanced` 34; `Wildtrak Advanced` 29; `Badlands Advanced` 27; `SUV V-6 cyl` 24; `RAPTOR 4 DOOR ADVANCED` 23; `Heritage Limited Edition` 22; `Big Bend 222A` 20; `Big Bend 4WD Automatic` 19; `Outer Banks 4WD Automatic` 19; `Big Bend - Crossroads` 16; `SUV I-4 cyl` 16; `4WD Manual` 14; `4x4` 13; `Wildtrak 4 Door Advanced` 13; `Black Diamond 4 Door` 12; `SUV EcoBoost&reg I-4 Engine` 12; `Outer Banks Sport Utility` 11; `4WD Automatic` 10; `Badlands In Transit` 10; `Big Bend 4x4` 10; `Hennessey Velociraptor 500` 10; `Badlands 4WD Automatic` 9; `Badlands SASQUATCH` 9; `Badlands 334A` 8; `Base 4 Door 4x4` 8

### Explorer (49,247 rows)

`Active` 10,815; `XLT` 7,823; `ST` 6,620; `Platinum` 4,559; `ST-Line` 4,124; `ST Line` 3,760; `Tremor` 3,696; `Limited` 1,998; (blank) 1,476; `Active w/200A Pkg` 697; `Timberline` 561; `Active W200a Pkg` 486; `Sport` 362; `Base` 271; `4WD Automatic` 156; `XLT 4WD` 140; `King Ranch` 109; `ST 4WD` 80; `Active W100a Pkg` 65; `Platinum 4WD` 65; `ST Line 4WD` 61; `Active W200a Pkg 4WD` 51; `Active w/100A Pkg` 46; `Active 4WD` 36; `Police` 33; `Tremor 4WD` 32; `Limited 4WD` 27; `ST Line RWD` 27; `Active 200A` 24; `XLT 4X4` 21; `Active Crossroads Courtesy Demo` 18; `ACTIVE RWD` 18; `Active RWD Automatic` 17; `Eddie Bauer` 17; `ST 400A` 17; `ST Line 300A` 16; `Active Demo` 14; `Active W200a Pkg RWD` 14; `Active With 200A Pkg` 14; `Active 4X4` 13

### Escape (15,806 rows)

`Active` 3,608; `SE` 2,596; `ST-Line` 1,787; `St Line` 1,621; `SEL` 1,216; `Titanium` 1,095; `Platinum` 822; `ST-Line Select` 623; `ST Line Select` 380; `S` 347; (blank) 249; `PHEV` 174; `XLT` 124; `ST-Line Elite` 107; `ST Line Elite` 97; `ST Line AWD` 77; `Active AWD` 64; `Titanium Hybrid` 64; `SE Hybrid` 50; `Base` 44; `ST Line Select AWD` 38; `Limited` 37; `Active FWD` 30; `SE Sport Hybrid` 24; `SEL AWD` 24; `SEL Hybrid` 24; `SE AWD` 23; `Platinum AWD` 19; `Active AWD Rear Camera` 17; `Plug In Hybrid` 16; `ST Line FWD` 15; `XLS` 14; `SE Plug In Hybrid` 13; `Active Certified` 12; `Titanium AWD` 12; `SE 4WD` 11; `SEL Plug In Hybrid` 9; `SE FWD` 8; `Titanium 4WD` 8; `4WD 4dr SE` 7

### Expedition (15,604 rows)

`Platinum` 4,682; `Active` 3,539; `Limited` 2,188; `XLT` 1,398; `Tremor` 1,034; `King Ranch` 848; (blank) 357; `MAX Platinum` 294; `Timberline` 165; `MAX Active` 138; `XL` 87; `Platinum 4x4` 66; `Platinum MAX` 43; `Limited MAX` 42; `MAX King Ranch` 41; `Limited 4x4` 34; `XLT MAX` 26; `Eddie Bauer` 25; `Platinum Sport Utility` 21; `Platinum 600A` 19; `Active 202A` 18; `Base` 18; `ACTIVE 4X4` 16; `Limited 4x2` 14; `Platinum 4WD Automatic` 13; `TREMOR 4X4` 12; `Active 4x2` 11; `XLT 4x2` 11; `XLT 4x4` 11; `Active Crossroads Courtesy Demo` 10; `Active 4x4` 10; `Platinum 4WD Pano Roof` 10; `King Ranch MAX` 9; `Platinum Crossroads Courtesy Demo` 9; `Active MAX` 8; `Inventory` 8; `King Ranch 4x4` 8; `Active 8 Passenger` 7; `Active Sport Utility` 6; `King Ranch vehicles -` 6

### Mustang (12,063 rows)

`EcoBoost` 2,603; `GT Premium` 2,120; `Ecoboost Premium` 1,860; `GT` 992; `Dark Horse` 611; `Ecoboost Fastback` 592; (blank) 509; `Dark Horse SC` 299; `Ecoboost Premium Fastback` 296; `GT Premium Fastback` 258; `V6` 158; `Shelby GT500` 145; `GT Fastback` 130; `Ecoboost Premium Convertible` 116; `Coupe I-4 cyl` 98; `Shelby GT350` 73; `Mach 1` 70; `Dark Horse Premium` 58; `GT Premium Convertible` 52; `Coupe V-8 cyl` 48; `V6 Premium` 44; `GT Deluxe` 39; `Base` 29; `Boss 302` 27; `Ecoboost Convertible` 24; `Coupe EcoBoost I4 GTDi` 23; `RTR SPEC 3` 22; `Dark Horse Fastback` 19; `I4CP` 19; `GT Premium RTR Spec` 18; `Bullitt` 15; `Deluxe` 15; `Premium` 15; `Rear-Wheel Drive` 15; `RWD Automatic` 14; `CAR EcoBoost&reg Engine` 13; `Shelby Super Snake` 13; `Cobra` 12; `Convertible I-4 cyl` 12; `GT350` 11

## 3. Proposed mapping to official trims

Official trims per model:

- **F-150**: XL, STX, XLT, Lariat, King Ranch, Platinum, Limited, Tremor, Raptor, Raptor R
- **Super Duty**: XL, XLT, Lariat, King Ranch, Platinum, Limited (Tremor is a package here: dropped when another trim is present)
- **Ranger**: XL, STX, XLT, Lariat, Tremor, Raptor
- **Maverick**: XL, XLT, Lariat, Tremor, Lobo
- **Bronco**: Base, Big Bend, Black Diamond, Outer Banks, Badlands, Wildtrak, Heritage, Heritage Limited, Everglades, Raptor, First Edition, Stroppe Edition
- **Explorer**: Base, Active, ST-Line, ST, XLT, Limited, Platinum, King Ranch, Timberline, Tremor, Police Interceptor, Sport, Eddie Bauer
- **Escape**: S, SE, SEL, XLS, XLT, Limited, Titanium, Active, ST-Line, ST-Line Select, ST-Line Elite, Platinum
- **Expedition**: XL, XLT, Limited, King Ranch, Platinum, Timberline, Tremor, Active, Eddie Bauer (MAX is a body length, not a trim)
- **Mustang**: Base, EcoBoost, EcoBoost Premium, GT, GT Premium, GT Deluxe, V6, V6 Premium, Mach 1, Dark Horse, Shelby GT350/GT500, Bullitt, Boss 302, Cobra

Matching rules (applied in order, longest official trim first, each match consumed so `XL` is not found inside `XLT`):

1. Upper-case and collapse every non-alphanumeric run to one space, so `ST-Line`, `ST Line`, `St Line` and `ST_LINE` compare equal. Output is the canonical spelling.
2. If the string is already exactly an official trim: **clean**, untouched.
3. Otherwise find official trims as whole words anywhere in the string. Exactly one hit: **fixable**. This strips drivetrain (`4X4`, `4WD`, `AWD`), cab and box (`CREWCAB`, `SuperCrew 5.5' Box`, `145 in. WB`), `DRW`, `Fleet`, `Advanced`, option-package codes (`200A`, `w/200A Pkg`), `Fastback/Convertible`, model prefixes (`F-250 `, `F 350 `), dealer words (`Crossroads Courtesy Demo`), and case (`LARIAT`).
4. Several hits: drop a hit that is contained in another (`GT` inside `GT Premium`); drop `Tremor` on Super Duty/Ranger/Maverick (a package there); `XL STX` becomes `STX`; drop `Sport` and `RTR` when another trim is present; `Sport Utility` and `Sport Appearance Package` are scrubbed first. Anything still with 2+ hits is **ambiguous**.
5. Zero hits: **leftover**. Blank/NULL: **blank**.
6. Aliases: `Heritage Edition` -> `Heritage`, `Heritage Limited Edition` -> `Heritage Limited`, `Dark Horse SC/Premium/Fastback` -> `Dark Horse`, `Lobo Standard/High` -> `Lobo`.

### Share of rows it would fix (9 models, 287,996 active rows)

| model | rows | already clean | fixable | ambiguous | leftover | blank |
|---|---|---|---|---|---|---|
| F-150 | 87,385 | 77,322 | 4,901 | 2 | 1,782 | 3,378 |
| Super Duty | 54,963 | 35,803 | 12,343 | 6 | 4,175 | 2,636 |
| Ranger | 11,736 | 10,663 | 443 | 0 | 194 | 436 |
| Maverick | 13,867 | 12,472 | 1,145 | 0 | 81 | 169 |
| Bronco | 27,325 | 23,781 | 2,511 | 3 | 235 | 795 |
| Explorer | 49,247 | 40,955 | 6,510 | 0 | 306 | 1,476 |
| Escape | 15,806 | 12,376 | 2,910 | 0 | 271 | 249 |
| Expedition | 15,604 | 13,966 | 1,200 | 0 | 81 | 357 |
| Mustang | 12,063 | 6,952 | 4,171 | 3 | 428 | 509 |
| **all 9** | **287,996** | **234,290** (81.4%) | **36,134** (12.5%) | 14 | 7,553 (2.6%) | 10,005 (3.5%) |

The mapping rewrites **36,134 rows** (12.5% of the 9 models, 10.1% of all active Ford rows) across 3,275 distinct strings. After it, **93.9%** of in-scope rows carry an official trim (up from 81.4%). Largest wins: `ST Line` 3,760 and `St Line` 1,621 -> ST-Line; `Ecoboost Premium` 1,860 and `Ecoboost Fastback` 592; `XL DRW` 1,502; `Heritage Edition` 1,497; `LARIAT` 1,061; `Active w/200A Pkg` 697; Super Duty `F 250/F-250/F 350 <trim>` about 5,000 rows together; `4X4 CREWCAB XLT` 360; `XLT 4WD SuperCrew 5.5'` 353.

Super Duty is the heaviest case: 12,343 fixable rows (22% of its rows) because dealers prefix the series (`F 250 Lariat`) or add `DRW`.

## 4. Leftovers that do not map

7,553 rows across 1,116 distinct strings (plus 10,005 blank and 14 ambiguous). Breakdown:

- **Engine / body / drivetrain text only, 4,087 rows (413 strings)**: `Truck Crew Cab V-8` 693, `Truck SuperCrew` 214, `Truck SuperCrew Cab V-6` 212, `4WD Automatic` (Super Duty 157, Explorer 156, F-150 90), `Coupe I-4 cyl` 98, `Truck 2V DEVCT NA` 74+43, `TRUCK 4 Valve OHV` 71, `Truck Regular Cab 8` 71, `SUV V-6 cyl` 24, `DRW` 62, `4x4` 44+33. These come from the dealer's engine-description line, not a trim; recover from VIN (below) or the engine field.
- **Generic words, 3,247 rows**: `Base` 959 (Super Duty 695, F-150 173), `Preferred` 282, `PHEV` 174 (Escape powertrain), `FX4` 118 (an F-150 package, not a trim), `Standard` 37, `Fleet` 22, `Police` 36, `Black Widow` 42, `Roush` 25, `Shelby` 21 (tuner/special builds: keep as a note, not a trim), truncated codes such as `F250 4X4 CREWC`, `F350 4X4CREW/CS`, `LARI` 17, `SCAB`.
- **Dealer/scrape junk, about 219 rows (58 strings)**: `Inventory` 61, `Inventory <Dealer name>`, `vehicles - Doggett Ford`, `Cloth`, `TRUCK Oxford White`, `Young Volkswagen of Layton` 26. Blank these out; the trim is not in the string. (`AAF Customs Edition` and `Inventory Route 23 Auto` style strings sit mostly outside these 9 models, i.e. in the 70,543 unprofiled rows.)

## 5. VIN tie-break

Ford VIN positions 5-7 carry line/series/body/cab and position 10 the model year. Within one model and year, that 3-character code often maps to one trim. Measured on the 270k rows that already have an official trim (after the mapping above):

| model | share of rows whose (model, VIN 5-7, VIN 10) maps to one trim |
|---|---|
| Escape | 100.0% |
| Expedition | 99.9% |
| Explorer | 99.9% |
| Maverick | 96.7% |
| Bronco | 92.6% |
| Ranger | 90.7% |
| F-150 | 86.0% (e.g. `W3L`+2026: XLT 100%; `W1E`+2023: XLT 54%, XL 17%, Lariat 17%) |
| Mustang | 73.6% |
| Super Duty | 51.5% (series code does not encode trim) |

Proposed rule: for blank, leftover and ambiguous rows only, take the key (model group, VIN 5-7, VIN 10), look at the mapped-clean rows with that key, and apply the majority trim only when there are at least 5 such rows and the majority is at least 95%. Anything below that stays blank (a wrong trim is worse than none). Trial run on the counts: **5,154 of 10,002 blank rows, 1,262 of 7,551 leftover rows and 3 of 14 ambiguous rows (6,419 rows, 36.5% of what string-mapping leaves) would be filled**, almost all in Escape, Expedition, Explorer, F-150 and Maverick; Super Duty and Mustang would gain little. The keys must be learned per model year and re-learned as new codes appear. It also breaks ties between `XL STX`-style strings. It is circular if the clean rows themselves are wrong, so spot-check a sample against window stickers before writing.

## Not done / caveats

- Proposal only; nothing written to the table, no normalizer code, no flag.
- Counts are active rows at 20:3x ET 2026-10-26; the nightly sync changes them.
- `S` for Escape and `Base` are the weakest word matches; review the Escape `S` rows (347 clean already) before enabling.
- `Tremor` and `STX` are trims on F-150 but packages on other lines, hence the model-specific rules.
- Rows whose model is NULL (35) and the unprofiled models were not mapped.

## Implementation (follow-up PR on this branch)

The mapping above is implemented in `scrapers/lightsail-crawler/src/fordTrim.js` and used in three places: the crawler (`standalone.js`, after the sticker step), the deals-API write path (`handleInventoryBulk`, next to `normalizeMakeForWrite`), and the box2 clean-up `scripts/box/2026-10-27-ford-trim-normalize.mjs` (`--dry-run` by default, `--apply --fleet-idle`, `--rollback=FILE`).

Differences from the probe's trial numbers, by decision:

- **"Base" and the Escape "S" are not matched inside longer text**, so a row is never moved to them (e.g. Bronco `Base 4 Door 4x4` stays as it is). An exact `Base` / `S` is left alone. Replaying the probe's 358,539 active rows through the module gives 36,080 rewrites (probe table: 36,134), 7,647 leftovers (7,553) and 14 ambiguous.
- **Tremor** is dropped only when another trim is in the same string on Super Duty, Ranger and Maverick; a bare `Tremor` stays, and on F-150, Explorer and Expedition it is a trim.
- **No VIN tie-break**; blank and unreadable trims are never touched.
- **The dealer's original text is kept** in a new column `dealer_inventory.trim_raw` (no raw trim column existed). It is set only when the trim is rewritten; `NULL` means the stored trim is exactly what the dealer sent.
