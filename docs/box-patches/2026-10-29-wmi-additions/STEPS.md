# WMI table additions from the 2026-10-28 fallback logs and the Ford audit (46 new prefixes) — code and docs only, NOTHING IS INSTALLED

Install on **boxes 4, 3, 1** (crawler `src/vinWmi.js`, one file) together with #621 on Paul's typed **GO**, one box at a time, in the no-crawl window. Box2 is not touched by this package. All numbers below were measured read-only on 2026-10-29 (box2 reader account, primary-key walks of 5,000 rows, 10 s statement cap, slowest statement 609 ms; boxes 1/3/4 logs by `grep`). No writes anywhere.

## What changed
`scrapers/lightsail-crawler/src/vinWmi.js`: 46 WMIs added (table 252 -> 298; #632 added 45, the box2 VIN-guard PR #634 added the `1HT` family and moved `3GP` to shared Honda/Acura with model rules), a Scion-or-Toyota model rule for `JTK`/`JTL`/`JTN`, model rules for `3HD`/`3GP`/`1HT`, tests in `scrapers/lightsail-crawler/test/vin_wmi.test.js`. `files/vinWmi.js` here is the same file (md5 `ca01f12109ab5eb40901d68b022486db` (`63d37197…` as merged in #632), before `7371d7d9bd40bd9586b4ef8a848a4969`). The older `docs/box-patches/2026-10-26-make-wmi/` directory is left as it was (it still describes and pins the first table; `wmi-install.sh` here is the upgrade from it).

**Pin history:** #632 shipped `63d371977608d0d8a6c1e758f6ae31c3`; #634 (box2 VIN guard) rebased onto it and moved the pin to `274e60473eb1d83fe6b01def4e5f68dc`; #636 (make-from-VIN model fallback) moved it to `ca01f12109ab5eb40901d68b022486db` (that hash also carries the `inferModel` opt-out; default on). The box2 VIN-guard package and this boxes 1/3/4 installer ship the same file, and tests pin both to the repo source.

Every added WMI was checked against NHTSA vPIC `DecodeWMI` (2026-10-29) **and** against the stored rows on box2 (make/model per prefix). Two vPIC answers were overridden by the data: `JTL`/`JTN` carry 50 active Scion-badged rows (shared Toyota/Scion, never Scion -> Toyota), and `WD3` carries Winnebago motorhomes (left out).

## The log message is misleading
`make_source=fallback ... (no page make, VIN not in the WMI table)` is also printed for WMIs that **are** in the table but name more than one make and have no model to decide (`5N1`, `JTM`, `JF1`, `JF2`, `5XY`, `JA4`, `KND`, `7YA`, `3KP`, `JN1`). Of last night's 92 distinct prefixes, 10 were already in the table; 46 were genuinely missing and are added or deliberately excluded below.

## Ford (the "no VIN rule" rows)
Two different things were measured:
1. **Ford WMIs.** 368,425 active Ford rows (5 walks: `1F`, `1ZV`, `2F`, `3F`, `MAJ`; 700k rows scanned). Four WMIs were not in the table: `2FD` 40 rows, `3FR` 20, `3FC` 1, `1FV` 1. Added: **`2FD`, `3FR`, `3FC`** (Ford Canada / Blue Diamond Super Duty chassis and F-650/750) plus **`NM0`** (Transit Connect, Turkey) and **`WF0`** (Ford of Europe) from the fallback logs. **`1FV` is Freightliner (vPIC), not Ford: left out** (its one Ford-labelled row is a mislabel).
2. **Trim rules (`2026-10-27-ford-trim-vin-fill.mjs`).** Rows whose trim is blank/unreadable and have no trusted key (positions 5-7 + year, >= 5 clean rows, >= 95 % agree): **11,523** on the nine profiled models (Super Duty 6,538, F-150 2,936, Mustang 897, Bronco 414, Ranger 313, Escape 269, Maverick 107, Explorer 27, Expedition 22), against the ~9,300 expected. Why they have no rule: 9,633 sit on keys where clean rows **disagree** (VIN positions 4-8 do not determine trim: e.g. Super Duty `8W2BM`/year `V` is Lariat 2,320 / XLT 1,584 / XL 1,579), 1,463 on keys with no clean row at all, 427 on keys with fewer than 5. **No trim rule was added.** A finer key (positions 4-8 + year) would fill only 176 of the 11,523 and, tested leave-one-out on rows whose trim is known, is wrong 102 of 2,455 times (4.2 %): worse than the 95 % bar, so not shipped. These rows need a different source (window sticker / vPIC trim), not more VIN rules.

## Prefixes added (46) and expected effect
Active stored rows on box2 per the dry run of `2026-10-28-make-from-vin-fix.mjs --wmi=<these 46>` with this table (bundle emitted from #634's branch, md5 `c2bb12fa470310302e1e045db37678de`): 25,864 active rows read, **800 would be rewritten**, 26 stay `conflict-unresolved` (shared WMI, needs a vPIC decode). Including removed rows: 46,069 read, **1,493 rewrites**, 29 + 1 unresolved. (#632 as merged measured 785 / 1,437; the difference is the `3HD` / `3GP` / `1HT` model rules and `3GP` becoming shared.)

| Make | Prefixes | Active rows read | Active rewrites | Left unresolved (shared WMI) |
|---|---|--:|--:|--:|
| BMW | `3MW` `3MF` `WB5` | 10,278 | 605 | 0 |
| Alfa Romeo | `ZAS` | 958 | 75 | 0 |
| Maserati | `ZN6` | 787 | 35 | 0 |
| Toyota | `SB1` `NMT` `5TB` `VNK` `WZ1` | 1,347 | 16 | 0 |
| Toyota / Scion (shared) | `JTK` `JTL` `JTN` | 2,157 | 11 | 12 |
| Mercedes-Benz (WD4 shared with Freightliner) | `W1W` `W1X` `W1Z` `WDA` `WD4` | 985 | 17 | 2 |
| Ford | `2FD` `3FR` `3FC` `NM0` `WF0` | 627 | 7 | 0 |
| Honda, Acura | `SHS` `4W5` | 134 | 2 | 0 |
| Honda / Acura (shared) | `3HD` `3GP` | 5,371 | 7 | 7 |
| International / Chevrolet (shared) | `1HT` | 468 | 2 | 4 |
| Jaguar | `SAD` | 1,060 | 7 | 0 |
| Volvo | `LVY` `LYV` | 346 | 3 | 0 |
| Audi | `WU1` | 175 | 2 | 0 |
| Aston Martin / Bentley / Lamborghini | `SD7` `SJA` `ZPB` | 225 | 4 | 0 |
| Pontiac, Saturn, GMC, Chevrolet, Cadillac | `5Y2` `5GZ` `3GS` `1GJ` `2CT` `6G3` `LRE` | 263 | 4 | 0 |
| Polestar, VW Routan | `7SY` `2V4` | 18 | 0 | 0 |
| Kia / Hyundai, Nissan / Infiniti (shared) | `3KM` `SJK` | 665 | 3 | 1 |
| **Total (46 prefixes)** | | **25,864** | **800** | **26** |

**Important: this package does not rewrite stored rows.** It makes the crawler resolve these VINs correctly from the next crawl on. The ~785 existing active rows (1,437 with removed) are only corrected by a later `make-from-vin-fix` run, which needs its own typed GO, a fresh bundle from main (the table is baked in) and a facet rebuild on a second GO.

**Crawler, per night** (2026-10-28 logs, unique VINs, only the 46 added prefixes; the log carries no model, so shared WMIs are counted as unresolved):

| Box | fallback VINs logged | on the 46 new prefixes | make changes | same make (now VIN-derived, no fallback line) | shared, still fallback (no model in the log) |
|---|--:|--:|--:|--:|--:|
| box1 | 829 | 468 | 129 | 150 | 189 |
| box3 | 62 | 37 | 19 | 5 | 13 |
| box4 | 1,128 | 437 | 136 | 65 | 236 |
| fleet (unique) | 2,019 | 942 | 286 | 218 | 438 |

The log carries no model, so the shared column is an upper bound: on the real crawler `3GP`, `3HD`, `1HT` and `JTK`/`JTL`/`JTN` resolve from the car's model (`Prologue` -> Honda, `ZDX` -> Acura, `Silverado 5500HD` -> Chevrolet, `tC` -> Scion, any other Toyota model -> Toyota).

So about 47 % of last night's fallback lines go away or become VIN-derived, about 290 cars a night get a different (correct) make, and about 1,090 fallback lines remain: the 10 shared families already in the table, `3HD` (233, Acura roster, correct), and commercial / motorcycle / trailer / junk VINs.

## Deliberately not added
`1HA` `1HD` `54D` `7GZ` (International / Shyft / Harley: multi-make commercial; `1HT` is in, as a shared International/Chevrolet family), `1FV` `3AK` `3AL` `W2X` `WDY` (Freightliner), `WD3` (motorhome chassis, Winnebago rows), `1M2` Mack, `JHH` `5PV` Hino, `JLS` Fuso, `WB1` `3JB` motorcycles, `2G5` (Chevrolet / BrightDrop), `3C8` (Stellantis, 1 row, needs the line-code table), `SC6` Ineos and `RLL` VinFast (makes not in the table's vocabulary), trailers / RVs / low-speed (`58E` `1GX` `123` `137` `4YD` `7SX` `5AS` `7V0` `1BB` `4FG` `4DR` `537`), and unreadable VINs (`000` `821` `82H` `DPS`). `test`s pin that these stay unknown.

## Steps (per box, order 4, 3, 1; only on Paul's typed GO, with #621's steps)
0. Preconditions: no `run-daily-crawl|run_nightly_chain|run_sync|standalone` process, sync lock free, before 21:50 ET. `wmi-install.sh apply` enforces the process and clock checks itself.
1. From the Mac, in this checkout (after the PR merges):
```bash
P=docs/box-patches/2026-10-29-wmi-additions
ssh -o ProxyCommand="ssh -i ~/.ssh/LightsailDefaultKey-us-east-1.pem -o IdentitiesOnly=yes -W %h:%p ubuntu@52.202.234.65" -i ~/.ssh/LightsailDefaultKey-us-east-1.pem -o IdentitiesOnly=yes ubuntu@172.26.11.241 'mkdir -p /tmp/wa'   # box4; box3 .15.105; box1 .1.32
scp -o ProxyCommand=... -i ... -r $P/. ubuntu@172.26.11.241:/tmp/wa/
```
2. On the box: `cd /tmp/wa && md5sum -c manifest.txt && bash wmi-install.sh check` (read-only; tests a copy). Must end `CHECK PASS`. A different `vinWmi.js` md5 than `7371d7d9…` stops it: report, do not force.
3. `bash wmi-install.sh apply` (backs up to `~/backups/wmi-additions-20261030`, atomic rename, syntax + sample-VIN test on the real file, restores itself on any failure). No restart: every crawl is a fresh Node process.
4. Rollback at any time: `bash wmi-install.sh restore`.
5. Next morning, per box: `grep -c "make_source=fallback" logs/*<date>*` should fall by about the table above (box4 ~ -300, box1 ~ -330, box3 ~ -27 per night); report any `make unresolvable` increase.

## Not done / caveats
- Nothing installed, no box written, no stored row changed.
- `3MW` was left out of the first table as unconfirmed. vPIC says BMW only and the stored models agree (330i, 230i, M340i, 3 Series, 2 Series); this PR reverses that exclusion.
- The Sprinter/Metris prefixes (`W1W` `W1X` `W1Z` `WDA`) would rewrite a conversion-van or RV brand stored on a Sprinter chassis to Mercedes-Benz; none of the 17 current rewrites is such a brand, but it is the one place a good row could change.
- Box2's deals-API does not carry `vinWmi.js` (make-wmi `deals-api.sh` not installed), so the write path there is unchanged.
