# 2026 Toyota RAV4 — canonical option vocabulary (draft, Part C starter)

Source: `rav4_2026_options_by_trim.csv` (toyota.com configurator, 2026 RAV4 hybrid, 6 trims; Plug-in Hybrid not included) + `rav4_options.md` for package contents that the CSV left blank (SE Convenience/Weather/Moonroof).
Per-row detail: `rav4_option_normalization.csv` (189 rows: 106 rows exploded from the factory source items, plus 83 per-trim "not listed" matrix rows).
Nothing was committed, no PR opened, deals box / DB not touched.

## 1. What the repo has today (read-only review of `yhcnbgvtng-rgb/TrimScout` main)

**There is no curated canonical option vocabulary in the repo.** "Canonical key" today means a *derived* key, not a controlled list:

| File | What it does |
|---|---|
| `scrapers/lightsail-crawler/src/inventoryOptionRows.js` | `normalizeOptionKey(label)`: lowercase, `B&W`→`bowers wilkins`, punctuation→space, collapse, cap 80 chars. That string IS `dealer_inventory_options.canonical_key`. Also the junk/deny rules (`DENY_RULES`, `looksLikeNonOptionText`), Toyota footnote-number repair (`TRUNCATION_REPAIRS`), and the buyer catalog filter (`buyerOptionCatalog`, ≥25 vehicles, max 60). |
| `scrapers/lightsail-crawler/src/factoryOptionAllowlist.js` | The hook a controlled vocabulary plugs into: per-make JSON `{ "toyota": { "<key>": { "label": "...", "aliases": ["..."] } } }` loaded from `OPTION_ALLOWLIST_PATH`; aliases fold onto one key at write time (`resolveAllowlisted`), and `OPTION_CATALOG_MODE=allowlist` gates the buyer catalog. **Ships empty** (only a Jeep test fixture exists in `test/factory_option_allowlist.test.js`). Keys/aliases must be `normalizeOptionKey()` output. |
| `lib/factoryOptionCatalog.ts` (+ `lib/factoryOptionCatalogStore.ts`) | Separate window-sticker pipeline: same `normalizeOptionKey`, ids `opt_<key_with_underscores>`, grows from stickers; `allowlistFromCatalogEntries()` bridges it into the allowlist shape. |
| `lib/toyotaSticker.ts` | `TOYOTA_OPTION_CODES = {}` — empty on purpose; notes a live 2026 RAV4 XSE listing carried package codes `["CY","DA"]`. |
| `scrapers/lightsail-crawler/src/descriptionFeatures.js` | `GENERIC_BASELINE_EQUIPMENT` drops "heated steering wheel", "rain sensing wipers", "garage door transmitter: homelink", "auto-dimming rear-view mirror" etc. from DealerOn description text **at crawl time** (see open question 3). |
| `scripts/box/2026-09-25-option-canonical-keys.sh`, `docs/OPTION_NORMALIZE_AUDIT_2026-10-07.md`, `docs/BUYER_SEARCH.md` | Schema/history of canonical_key; audit of live Toyota junk ("See toyota", "3 In", …). |
| `lib/optionsMatch.ts` | must-have hit/miss is exact-code containment; no vocabulary. |

Consequence: **every key below is `proposed`.** Where the repo shows the same normalized string as a real live label (tests/fixtures), that's noted as evidence the dealer spelling exists — not as an existing controlled key. Live key counts for Toyota (`dealer_inventory_options`) could not be checked (box/DB off-limits for this task); doing that read-only off-window is the next step to turn aliases into evidence.

Key format follows the allowlist contract: `normalizeOptionKey()` output (lowercase, spaces). Proposed allowlist placement: `toyota` make block.

## 2. Feature vocabulary (deduped) — 43 proposed keys

### Equipment features (20)
| canonical_key | Label | Source on 2026 RAV4 | Buyer / VDP synonyms → alias candidates | Ambiguity / rule | Repo evidence |
|---|---|---|---|---|---|
| `awd` | All-wheel drive | $1,400 opt LE/SE/XLE; std Woodland/XSE/Limited | AWD, all wheel drive, 4WD*, 4x4*, Electronic On-Demand AWD | *4WD/4x4 should NOT alias to awd (different systems); keep separate | 'AWD' kept as real option (inventory_option_rows.test.js) |
| `fwd` | Front-wheel drive | std LE/SE/XLE; n/a on AWD-only trims | FWD, 2WD, front wheel drive | low buyer value as must-have | — |
| `power liftgate` | Power liftgate | SE Convenience Pkg $400 ("Height-adjustable power liftgate w/ jam protection") | power rear door, power tailgate, power hatch, power back door, height-adjustable power liftgate | **Hands-free / kick-sensor is NOT stated.** Propose separate `hands free liftgate` key (not populated from this data); a hands-free VDP line satisfies power liftgate, never the reverse | — |
| `heated steering wheel` | Heated steering wheel | Weather Pkg $375 (SE, XLE Prem, XSE) | heated leather steering wheel, heated wheel | — | in GENERIC_BASELINE_EQUIPMENT (dropped from DealerOn text) |
| `rain sensing wipers` | Rain-sensing wipers | Weather Pkg | rain-sensing variable intermittent wipers, auto wipers, automatic wipers | "variable intermittent wipers" alone is NOT rain-sensing | in GENERIC_BASELINE_EQUIPMENT |
| `windshield wiper de icer` | Wiper de-icer | Weather Pkg | windshield wiper de-icer, de-icer function, heated wiper park area | — | — |
| `moonroof` | Power tilt/slide moonroof | Moonroof Pkg $850 (SE, Woodland) | sunroof, moonroof, power moonroof, tilt/slide moonroof | Is a panoramic roof a "moonroof" hit? (Q1) | — |
| `panoramic moonroof` | Panoramic moonroof | Panoramic Moonroof Pkg $1,850 XLE / $700 XSE | panoramic sunroof, panoramic glass roof, pano roof, dual-panel moonroof | includes front tilt/slide section | 'Panoramic Moonroof' / 'Panoramic Sunroof' kept as real options in tests |
| `digital rearview mirror` | Digital rearview mirror | Panoramic Moonroof Pkg | digital rear-view mirror, camera mirror, smart rearview mirror | NOT the same as auto-dimming mirror | — |
| `homelink garage door opener` | HomeLink | Panoramic Moonroof Pkg | HomeLink, universal garage door opener, garage door transmitter | — | 'garage door transmitter: homelink' in GENERIC_BASELINE_EQUIPMENT |
| `front cross traffic alert` | Front cross-traffic alert | XLE Driver Assist $650 | FCTA | distinct from rear cross-traffic alert (RCTA) | — |
| `lane change assist` | Lane change assist | XLE Driver Assist | LCA | NOT blind spot monitor; NOT lane departure alert / lane tracing assist (TSS features) | — |
| `traffic jam assist` | Traffic jam assist | XLE Driver Assist | TJA, hands-free traffic jam assist | — | — |
| `driver monitor` | Driver attention monitor | XLE Driver Assist | driver monitoring system, driver attention monitor | — | — |
| `advanced park` | Advanced Park | XSE Driver Assist $420 | Toyota Advanced Park, automated parking, park assist* | *generic "park assist" / parking sensors must NOT alias | — |
| `shift by wire shifter` | Shift-by-wire toggle shifter | XSE Driver Assist | toggle shifter | low buyer value | — |
| `jbl premium audio` | JBL premium audio | JBL Pkg $620 (XSE) | JBL, JBL 9-speaker, JBL premium audio system with subwoofer | generic "premium audio" must NOT alias (brand-specific) | — |
| `20 inch wheels` | 20-in. wheels | 20-In. Wheel Pkg $1,240 (Limited) | 20" wheels, 20-in alloy wheels, 235/50R20 | — | ('20 Inch Aluminum Wheels' appears as a kept real label in tests) |
| `upgraded spare tire` | Larger temporary spare | 20-In. Wheel Pkg | 165/90D18 spare | NOT full-size spare | — |
| `head up display` | Head-up display | $600 standalone (Limited) | HUD, heads-up display, 10-in color HUD | — | — |

### Package-level keys (8)
`convenience package`, `weather package`, `moonroof package`, `panoramic moonroof package`, `xle driver assist package`, `xse driver assist package`, `jbl premium audio package`, `20 in wheel package`.
Purpose: a sticker/VDP line that names only the package can expand into the feature keys above. Package names repeat across Toyota models with different contents, so the expansion map must be keyed by make+model+year+trim (see the per-row CSV), not by package name alone.

### Paint (7 keys; Toyota name kept as `feature_label`)
| Toyota name | Family key | Code | Trims (price) | Note |
|---|---|---|---|---|
| Ice Cap | `exterior white` | 0040 | LE, SE, XLE, Woodland | |
| Wind Chill Pearl | `exterior white` | 0089 | XLE, Limited ($475) | |
| Midnight Black Metallic | `exterior black` | 0218 | all | |
| Meteor Shower | `exterior gray` | 04V8 | LE, SE, XLE, Limited | warm gray/greige |
| Storm Cloud | `exterior gray` (provisional) | 01L6 | LE, SE, XLE, Woodland, Limited | **ambiguous: blue-gray/indigo** (Q5) |
| Urban Rock | `exterior gray` | 01M6 | Woodland only | gray-brown |
| Ruby Flare Pearl | `exterior red` | 03T3 | LE, XLE, Limited ($475) | |
| Blueprint | `exterior blue` | 08X8 | SE, XLE, Limited | |
| Everest | `exterior color family tbd` | 06X7 | Woodland only | **sources conflict: muted off-white vs green** (Q5) |
| Storm Cloud / Wind Chill Pearl / Meteor Shower **with Midnight Black Metallic roof** | body family + `two tone black roof` | 0M22 / 02VP / 02SQ | XSE only ($500 / $975 / $500) | |

Codes 04V8, 01L6, 08X8, 01M6, 02VP are confirmed from toyota.com configurator build URLs; the rest come from third-party paint-code references (buildpriceoption.com, importarchive.com). No green, silver or other families appear on the 2026 RAV4 hybrid.

### Interior (material 3 + color 5 keys)
| Toyota name | Material key | Color key | Trims |
|---|---|---|---|
| Black fabric | `cloth seats` | `interior black` | LE (only choice) |
| Black/Blue fabric | `cloth seats` | `interior black blue` | SE (only choice) |
| Light Gray / Black / Harvest Beige SofTex | `softex seats` | `interior gray` / `interior black` / `interior beige` | XLE Premium, Limited |
| Mineral / Black SofTex | `softex seats` | `interior green` (Mineral, third-party "sage green", verify) / `interior black` | Woodland |
| Black/Blue SofTex/fabric mixed media | `softex fabric seats` | `interior black blue` | XSE (only choice) |

SofTex is Toyota's synthetic leather. Aliases: SofTex, synthetic leather, leatherette, faux leather, vegan leather. **It must never satisfy a "leather seats" must-have** (Q4).

## 3. Per-trim availability (only what the data shows; "unknown" = not offered as a package/option in the configurator, so standard or not available can't be told apart)
| canonical_key | LE | SE | XLE Premium | Woodland | XSE | Limited |
|---|---|---|---|---|---|---|
| `awd` | Opt $1,400 | Opt $1,400 | Opt $1,400 | Std | Std | Std |
| `fwd` | Std | Std | Std | not available (AWD only) | not available (AWD only) | not available (AWD only) |
| `power liftgate` | unknown | Convenience Package $400 | unknown | unknown | unknown | unknown |
| `heated steering wheel` | unknown | Weather Package $375 | Weather Package $375 | unknown | Weather Package $375 | unknown |
| `rain sensing wipers` | unknown | Weather Package $375 | Weather Package $375 | unknown | Weather Package $375 | unknown |
| `windshield wiper de icer` | unknown | Weather Package $375 | Weather Package $375 | unknown | Weather Package $375 | unknown |
| `moonroof` | unknown | Moonroof Package $850 | unknown | Moonroof Package $850 | unknown | unknown |
| `panoramic moonroof` | unknown | unknown | Panoramic Moonroof Package $1,850 | unknown | Panoramic Moonroof Package $700 | unknown |
| `digital rearview mirror` | unknown | unknown | Panoramic Moonroof Package $1,850 | unknown | Panoramic Moonroof Package $700 | unknown |
| `homelink garage door opener` | unknown | unknown | Panoramic Moonroof Package $1,850 | unknown | Panoramic Moonroof Package $700 | unknown |
| `front cross traffic alert` | unknown | unknown | XLE Driver Assist Package $650 | unknown | unknown | unknown |
| `lane change assist` | unknown | unknown | XLE Driver Assist Package $650 | unknown | unknown | unknown |
| `traffic jam assist` | unknown | unknown | XLE Driver Assist Package $650 | unknown | unknown | unknown |
| `driver monitor` | unknown | unknown | XLE Driver Assist Package $650 | unknown | unknown | unknown |
| `advanced park` | unknown | unknown | unknown | unknown | XSE Driver Assist Package $420 | unknown |
| `shift by wire shifter` | unknown | unknown | unknown | unknown | XSE Driver Assist Package $420 | unknown |
| `jbl premium audio` | unknown | unknown | unknown | unknown | JBL Premium Audio Package $620 | unknown |
| `20 inch wheels` | unknown | unknown | unknown | unknown | unknown | 20-In. Wheel Package $1,240 |
| `upgraded spare tire` | unknown | unknown | unknown | unknown | unknown | 20-In. Wheel Package $1,240 |
| `head up display` | unknown | unknown | unknown | unknown | unknown | 10-In. Color Head-Up Display (HUD) $600 |

Interior and paint availability per trim is in the CSV. Paint is marked `optional` (a choice), with the price where it's extra-cost. An interior is `standard` when it's the trim's only interior.

## 4. Out of scope
357 `Accessory (dealer/port)` rows (LE 61, SE 60, XLE 61, Woodland 54, XSE 60, Limited 61) are excluded. They are dealer- or port-installed, never factory build, so they can't count as a factory hit. Examples are the tow hitch receiver, Protection Plus and Illumination packages, Connected Services and Yakima/ARB/Thule (non-genuine). The 6 `Base` MSRP rows are excluded too.

## 5. Open questions for Paul
1. **Moonroof hierarchy.** Should a buyer's "moonroof/sunroof" must-have count a panoramic roof as a hit? It has a front tilt/slide section. Proposal: yes, panoramic satisfies moonroof, but moonroof never satisfies panoramic.
2. **Hands-free vs power liftgate.** RAV4 data only says "power liftgate". Should the vocabulary keep `hands free liftgate` as its own key, with one-way satisfaction (hands-free → power)? Dealer VDPs often say "hands-free power liftgate" loosely.
3. **Baseline-equipment drop.** `descriptionFeatures.js` drops "heated steering wheel", "rain sensing wipers" and the "homelink" garage door transmitter from DealerOn description text as generic. On a RAV4 these are paid Weather and Panoramic Moonroof package items. With that filter, a DealerOn RAV4 can never be a hit for them, only unknown. Should these be removed from the generic list, or made make- or model-aware?
4. **SofTex vs leather.** Confirm SofTex (synthetic leather) is its own key and never counts as "leather seats".
5. **Color families.** Should Storm Cloud be gray, blue or both? And Everest: off-white or green? Sources conflict, so it is left unassigned. Should paint go into the option vocabulary at all, or stay on `dealer_inventory.exterior_color` with a family map?
6. **Package expansion.** Should a VDP or sticker line naming only a package ("Weather Package") count as hits for its features, using a model, year and trim-scoped expansion table? Toyota package codes (e.g. `CY`/`DA` on a live XSE) would need a code map. `TOYOTA_OPTION_CODES` is empty today.
7. **"unknown" cells.** Many features aren't offered as options on higher trims, e.g. power liftgate on XLE/Woodland/XSE/Limited and heated wheel on Limited. They are probably standard there, but the configurator data doesn't say. Should we pull Toyota's standard-equipment spec sheets next, so must-haves can resolve to standard hits by trim instead of unknown?
8. **Package dependencies.** Several packages carry "Additional change(s) required" (Convenience, SE Moonroof, XLE Driver Assist, Panoramic Moonroof, XSE Driver Assist, JBL, 20-in wheels). The dependency targets weren't captured. Do you want them captured?
9. **Scope.** The Plug-in Hybrid was skipped. Should it be included before this becomes the Toyota allowlist seed?
