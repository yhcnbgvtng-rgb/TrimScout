# Option normalize audit — 2026-10-07

## Status / owner decisions (2026-10-07, after the audit below)
Implemented in this PR: drop bare Engine/Transmission/Wheels (and Tires/Radio); **keep ECO**; **drop Plus**; **repair** a truncated
`Multi-Information Display (MID` to `(MID)` (only that label — anything else truncated is dropped, never completed); the description
parser no longer splits inside parentheses or between digits; no new broad rules on trailing digits, lowercase starts, leading digits or
slashes. Rules live in `DENY_RULES` in `scrapers/lightsail-crawler/src/inventoryOptionRows.js` (shared by the nightly write path, the
canonical-key purge classifier, and the backfill). The backfill (`scripts/box/2026-09-28-backfill-inventory-options.mjs`) is now a
**dry run by default**; `--apply` writes; the facet rebuild is a separate `--rebuild-facets`. **--apply and the rebuild are on HOLD.**

# Audit (below was read-only: nothing written, rebuilt, crawled or deployed)

## What I measured, and its limit
Source: live `GET /api/inventory/catalog?make=` per make (the exact list /search shows: already >=25 vehicles,
<=60 options, existing #333 junk filter applied). So this is the junk that **leaks past today's filter into buyer
facets** — the part that matters. It is NOT the full stored-row picture (`inv_option_facets` / `dealer_inventory_options`
need box-side SQL; that is the step before `--apply`). Raw drafts: scratchpad `catalog.json`, `rules.mjs`, `dry.mjs`.

Existing infra to extend, not replace: `src/inventoryOptionRows.js` (`looksLikeNonOptionText`, `looksLikeJunkCanonicalKey`,
`splitOptionLabel`), `optionSentenceFilter.js`, `2026-09-28-backfill-inventory-options.mjs` (already has --dry-run, keyset resume,
memory guard).

## Patterns found (live, with sample VINs)
| Pattern | Examples (vehicles) | Sample VINs |
|---|---|---|
| "See …" cross-refs | See toyota 24,576; See onstar (Chevy 21,837 / GMC 15,238 / Buick / Cadillac); See dealer or vw 1,975 | 2T36CRAV0TC41E689 · 1GCPSBEK3S1203007 · 1V2AE2CA9SC205614 |
| URL crumbs (".com" split off) | "com or dealer for details" 21,694 (Chevy); "com/connected-services for details" 23,478 (Toyota); bare "com" (Honda 1,538, Kia, Acura, Chrysler, Infiniti, VW) | 1GCUDDED5NZ631855 · 2HGFE1F95RH321386 |
| bare "N in" (screen size split at decimal) | Toyota "3 In" 21,649 / "5 in" 9,757 / "9 in" 7,439 | 2T36CRAV0TC43J830 |
| Glued section header | Toyota "Standard EquipmentExterior18-in" 5,770 (existing caps-run rule misses it: only 1 capital) | 3TMLB5JN0TM42D374 |
| Instrument-cluster noise | Clock (13 makes, 3-9k each), odometer, fuel gauge | — |
| Legal / SiriusXM / OnStar boilerplate fragments | "registered in the U", "... are trademarks of ...", "an active data plan", artists, creators, comedy, live sports, talk and news, news (Chevy/GMC/Buick/Cadillac 3-19k each) | 1GNERGKW7NJ135121 |
| Single-word stubs | look, Now, Inc, Tag, Plus, power, rear, mud, snow, cooled, durability, unlock, Siri, ECO | — |
| Truncated at a comma/decimal | "Multi-Information Display (MID", "drive mode (Trail", "get involved with", "illuminated 3", "Engine: 3", "Wheels: 18 x 7", "Radio: AM/FM 8", bare "Engine"/"Transmission"/"Wheels" | 7JDDA3VL3TG060621 (Volvo) |
| Marketing sentences | "To Keep You Safe", "putting YOU in control of the whole experience", "From Our Sales Floor To Your Door" (Mitsubishi) | JA4APUAU2VU002609 |

Root cause worth fixing at the source: the description parser splits on commas/decimals **inside parentheses and numbers**
("Display (MID, ...)", "12.3"" ...). A fix there (don't split inside parens / between digits) removes truncated fragments at
the origin; deny rules only catch what slips through.

## Proposed rules (`rules.mjs`, deny-list on trimmed raw label; exact patterns in file)
see-ref · url-crumb · see-details · legal-boiler · glued-header · instrument (exact words only) · stub-word (exact words only) ·
unbalanced-paren · dangling-preposition · marketing (you/your) · spec-truncated.
Rename map: only trim/collapse whitespace and capitalize first letter (no invention, blank stays blank). Canonical-key merge
already exists (allowlist `resolveKey`); no new renames beyond that.
**Rules I deliberately did NOT adopt (false positives found in dry run):** blanket "ends with digit" (hits real "Sync 4",
"Premium Content 1"), "starts lowercase" (real options: "heated mirrors"), "starts with digit" (real "10-Speed Automatic",
"4-Zone Climate Control"), "contains /" (real "Radio: AM/FM/HD Audio System").

## Dry-run result (against the live buyer-facing catalog, 27 makes touched)
138 catalog entries would drop, 142 would be case-normalized. Largest: Chevrolet 16, GMC 16, Toyota 15, Buick 9, VW 9,
Cadillac 8, Honda 7, Mitsubishi 7. Per-entry list with vehicle counts: `dry.txt` in scratchpad (copied below).

## Needs your call before the PR (review bucket)
- Bare "Engine"/"Transmission"/"Wheels" (10k/5k vehicles) — I treat as truncated headers; confirm.
- "Siri", "ECO", "AWD/4WD", "Plus" — AWD/4WD kept; Siri/ECO/Plus dropped as stubs (ECO is possibly a real Toyota drive mode).
- Truncated-but-real options ("Multi-Information Display (MID") — drop in v1, rather than invent a closing paren.
- Digital gauge cluster *with* settings kept (feature), plain Clock/odometer/fuel gauge dropped.

## PR plan (not started; no deploy tonight)
1. `inventoryOptionRows.js`: add the rules to `looksLikeNonOptionText` AND `looksLikeJunkCanonicalKey` (single shared source) + unit tests
   built from the real strings above (junk drops) and the false-positive list (must survive).
2. Source fix in the description feature parser (no split inside parens/digits) + test.
3. Backfill: extend `2026-09-28-backfill-inventory-options.mjs` (already replaces per vehicle from options_json, so it is idempotent and
   never invents options) — `--dry-run` default, `--apply` required to write, per-make CSV of drops/renames. Never touches options_json.
4. **HOLD `--apply`** until you say. Pre-apply: run the box-side `--dry-run` for real stored-row counts per make (box2, off-window).
5. Facet rebuild only after apply, separately.
## Per-entry dry-run list
```

## Ford: 60 shown -> drop 0, case/space-rename 5

## Chevrolet: 60 shown -> drop 19, case/space-rename 5
   DROP [see-ref] See onstar (21837 veh)
   DROP [url-crumb] com or dealer for details (21694 veh)
   DROP [stub-word] artists (19114 veh)
   DROP [stub-word] creators (19114 veh)
   DROP [legal-boiler] an active data plan (14496 veh)
   DROP [legal-boiler] Android and Android Auto are trademarks of Google LLC (14496 veh)
   DROP [marketing] To use Android Auto on your car display (14496 veh)
   DROP [stub-word] Siri (14463 veh)
   DROP [legal-boiler] Apple CarPlay is a trademark of Apple Inc (14462 veh)
   DROP [legal-boiler] iPhone and Apple Music are trademarks for Apple Inc (14462 veh)
   DROP [legal-boiler] registered in the U (14462 veh)
   DROP [stub-word] comedy (13861 veh)
   DROP [stub-word] live sports (13817 veh)
   DROP [stub-word] talk and news (13817 veh)
   DROP [spec-truncated] transmission (10759 veh)
   DROP [spec-truncated] Engine (10752 veh)
   DROP [spec-truncated] Wheels (5964 veh)
   DROP [stub-word] news (5580 veh)
   DROP [legal-boiler] on your phone or connected devices (5297 veh)

## Toyota: 60 shown -> drop 15, case/space-rename 28
   DROP [see-ref] See toyota (24576 veh)
   DROP [url-crumb] com/connected-services for details (23478 veh)
   DROP [bare-size] 3 In (21649 veh)
   DROP [stub-word] unlock (16957 veh)
   DROP [unbalanced] Multi-Information Display (MID (12503 veh)
   DROP [bare-size] 5 in (9757 veh)
   DROP [instrument] Clock (8988 veh)
   DROP [instrument] odometer (8183 veh)
   DROP [url-crumb] com/audio-multimedia for details (7676 veh)
   DROP [bare-size] 9 in (7439 veh)
   DROP [stub-word] ECO (7176 veh)
   DROP [instrument] fuel gauge (6679 veh)
   DROP [glued-header] Standard EquipmentExterior18-in (5770 veh)
   DROP [stub-word] snow (5526 veh)
   DROP [unbalanced] drive mode (Trail (5520 veh)

## Hyundai: 60 shown -> drop 1, case/space-rename 3
   DROP [instrument] Clock (5189 veh)

## Nissan: 60 shown -> drop 1, case/space-rename 5
   DROP [instrument] Clock (4969 veh)

## Jeep: 60 shown -> drop 0, case/space-rename 1

## Honda: 60 shown -> drop 7, case/space-rename 3
   DROP [instrument] Clock (3381 veh)
   DROP [stub-word] look (2115 veh)
   DROP [stub-word] Now (1847 veh)
   DROP [url-crumb] com (1538 veh)
   DROP [url-crumb] Check vehicle compatibility at https://mygarage (1219 veh)
   DROP [instrument] odometer (1211 veh)
   DROP [spec-truncated] Bluetooth® streaming audio and 1 USB-C 3 (1113 veh)

## GMC: 60 shown -> drop 18, case/space-rename 9
   DROP [see-ref] See onstar (15238 veh)
   DROP [url-crumb] com or dealer for details (15121 veh)
   DROP [stub-word] artists (13394 veh)
   DROP [stub-word] creators (13394 veh)
   DROP [stub-word] comedy (12240 veh)
   DROP [stub-word] live sports (12231 veh)
   DROP [stub-word] talk and news (12231 veh)
   DROP [stub-word] Siri (8958 veh)
   DROP [legal-boiler] Apple CarPlay is a trademark of Apple Inc (8956 veh)
   DROP [legal-boiler] iPhone and Apple Music are trademarks for Apple Inc (8956 veh)
   DROP [legal-boiler] registered in the U (8956 veh)
   DROP [legal-boiler] an active data plan (8955 veh)
   DROP [legal-boiler] Android and Android Auto are trademarks of Google LLC (8955 veh)
   DROP [marketing] To use Android Auto on your car display (8955 veh)
   DROP [stub-word] mud (5566 veh)
   DROP [spec-truncated] Transmission (5446 veh)
   DROP [spec-truncated] Engine (5349 veh)
   DROP [stub-word] Power (5012 veh)

## Subaru: 60 shown -> drop 5, case/space-rename 11
   DROP [instrument] Clock (3411 veh)
   DROP [url-crumb] com for cell phone compatibility) (1289 veh)
   DROP [spec-truncated] illuminated 3 (1276 veh)
   DROP [instrument] Odometer (1194 veh)
   DROP [url-crumb] com for cellphone compatibility) (1101 veh)

## Ram: 60 shown -> drop 0, case/space-rename 1

## Mazda: 60 shown -> drop 4, case/space-rename 7
   DROP [instrument] Clock (3586 veh)
   DROP [instrument] Odometer (1820 veh)
   DROP [stub-word] look (1451 veh)
   DROP [legal-boiler] without eating up your data allowance (1435 veh)

## Kia: 60 shown -> drop 4, case/space-rename 1
   DROP [instrument] Clock (1745 veh)
   DROP [stub-word] durability (713 veh)
   DROP [spec-truncated] Wheels: 18 x 7 (571 veh)
   DROP [url-crumb] com (567 veh)

## Volkswagen: 60 shown -> drop 9, case/space-rename 2
   DROP [instrument] Clock (2146 veh)
   DROP [unbalanced] App-Connect smartphone integration (w/Apple CarPlay (1997 veh)
   DROP [see-ref] See dealer or vw (1975 veh)
   DROP [unbalanced] Android Auto and MirrorLink) via USB (1626 veh)
   DROP [url-crumb] com/connected for important details (1146 veh)
   DROP [stub-word] cooled (624 veh)
   DROP [url-crumb] com/connected for details (579 veh)
   DROP [url-crumb] com (548 veh)
   DROP [stub-word] look (366 veh)

## Mercedes-Benz: 60 shown -> drop 1, case/space-rename 0
   DROP [stub-word] Inc (1549 veh)

## Buick: 60 shown -> drop 11, case/space-rename 21
   DROP [see-ref] See onstar (4670 veh)
   DROP [url-crumb] com or dealer for details (4630 veh)
   DROP [stub-word] power (4343 veh)
   DROP [stub-word] artists (3845 veh)
   DROP [stub-word] creators (3845 veh)
   DROP [stub-word] news (3757 veh)
   DROP [legal-boiler] on your phone or connected devices (3755 veh)
   DROP [stub-word] rear (1998 veh)
   DROP [spec-truncated] Engine (1828 veh)
   DROP [spec-truncated] Transmission (1524 veh)
   DROP [marketing] SiriusXM Trial Subscription With your trial subscription (1320 veh)

## Volvo: 60 shown -> drop 1, case/space-rename 0
   DROP [dangling] get involved with (93 veh)

## Cadillac: 60 shown -> drop 10, case/space-rename 4
   DROP [see-ref] See onstar (3704 veh)
   DROP [url-crumb] com or dealer for details (3703 veh)
   DROP [stub-word] artists (3481 veh)
   DROP [stub-word] creators (3481 veh)
   DROP [stub-word] comedy (2871 veh)
   DROP [stub-word] live sports (2870 veh)
   DROP [stub-word] talk and news (2870 veh)
   DROP [spec-truncated] Transmission (1042 veh)
   DROP [spec-truncated] Engine (1024 veh)
   DROP [stub-word] tag (1016 veh)

## Lincoln: 60 shown -> drop 0, case/space-rename 1

## Lexus: 60 shown -> drop 1, case/space-rename 1
   DROP [instrument] Clock (610 veh)

## Acura: 60 shown -> drop 2, case/space-rename 2
   DROP [instrument] Clock (320 veh)
   DROP [url-crumb] com (199 veh)

## Dodge: 60 shown -> drop 0, case/space-rename 3

## Chrysler: 60 shown -> drop 4, case/space-rename 2
   DROP [spec-truncated] 17 x 7 (482 veh)
   DROP [spec-truncated] Engine: 3 (386 veh)
   DROP [url-crumb] com (325 veh)
   DROP [instrument] Clock (303 veh)

## Mitsubishi: 60 shown -> drop 7, case/space-rename 0
   DROP [stub-word] Tag (217 veh)
   DROP [spec-truncated] Radio: AM/FM 8 (132 veh)
   DROP [marketing] From Our Sales Floor To Your Door (114 veh)
   DROP [marketing] To Keep You Safe (114 veh)
   DROP [marketing] putting YOU in control of the whole experience (110 veh)
   DROP [instrument] Clock (99 veh)
   DROP [marketing] cleaning and adjusting vehicles (84 veh)

## Infiniti: 60 shown -> drop 3, case/space-rename 4
   DROP [instrument] Clock (791 veh)
   DROP [unbalanced] advanced voice recognition (one shot VDE (502 veh)
   DROP [url-crumb] com (298 veh)

## Porsche: 60 shown -> drop 2, case/space-rename 1
   DROP [instrument] Clock (258 veh)
   DROP [stub-word] Plus (210 veh)

## Mini: 60 shown -> drop 1, case/space-rename 0
   DROP [instrument] Clock (371 veh)

## Genesis: 60 shown -> drop 3, case/space-rename 0
   DROP [stub-word] look (85 veh)
   DROP [marketing] Meet your ultimate co-pilot (84 veh)
   DROP [marketing] until GPS linked cruise control set the pace (81 veh)

## Land Rover: 60 shown -> drop 1, case/space-rename 1
   DROP [spec-truncated] Tires: 22 (53 veh)

## Tesla: 28 shown -> drop 2, case/space-rename 5
   DROP [stub-word] tag (101 veh)
   DROP [stub-word] durability (92 veh)

## Harley-Davidson: 19 shown -> drop 3, case/space-rename 10
   DROP [unbalanced] 312 mm) display guiding the way (42 veh)
   DROP [marketing] s how you move (42 veh)
   DROP [marketing] t where you&#8217 (42 veh)

## Alfa Romeo: 46 shown -> drop 1, case/space-rename 1
   DROP [spec-truncated] Radio: AM/FM/HD 8 (25 veh)

## INEOS: 3 shown -> drop 0, case/space-rename 1

## International: 3 shown -> drop 0, case/space-rename 1

## Isuzu: 4 shown -> drop 0, case/space-rename 1

## Rolls-Royce: 2 shown -> drop 0, case/space-rename 1

## Can-Am: 1 shown -> drop 0, case/space-rename 1

## Hillsboro: 2 shown -> drop 2, case/space-rename 0
   DROP [marketing] don't let it be you (30 veh)
   DROP [marketing] I think if you tried us (30 veh)

TOTAL dropped catalog entries: 138 | renames: 142 | makes touched: 27
```
