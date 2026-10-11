# Toyota option policy v2: policy counts and the box2 read-only dry-run plan (2026-10-11)

Source: `toyota_lineup_options_by_trim.csv` (v2: 758 rows, 24 models, 125 trims). It replaces the Oct 9 Toyota CSV; nothing from the older file is used.
Generator: `scripts/build-toyota-option-policy.mjs` -> `scrapers/lightsail-crawler/src/optionPolicies/toyota-2026-2027.json` + `POLICY_REPORT.md`.
**Nothing is applied by this change.** The apply is a separate step in the next idle window, on Paul's GO.

## Rules

Kept (every paid factory sticker line): paints incl. two-tone, packages, options, drivetrain and transmission. Dropped: accessories, $0 items, "No Additional Cost" items, subscription-only items (v2 already carries none of these). Tacoma/Tundra cab and bed choices are notes on the Base rows and are never options. 2026 RAV4 (non plug-in) stays PR #432's policy; Mirai has no row in v2 and is not buildable, so its policy is unchanged (none).

Paul's calls (Oct 11): (1) Tundra TRD Off-Road Package added as a package row on SR5 $2,125, Limited $3,580, Limited i-FORCE MAX $3,580, Platinum $2,180, 1794 Edition $2,140 (the five trims where v2 only has it inside the Mudbath pop-up); (2) Tacoma TRD Off-Road keeps separate manual and automatic package rows; (3) bZ AWD deltas kept (+$5,000 XLE, +$2,000 Limited) and flagged `unconfirmed: true`; (4) Digital Key ($275) kept.

## Policy entries, old vs new, by category

Toyota 2026-2027 policy file (23 model-years, 119 trims; the 2026 RAV4 file is unchanged and not counted):

| Category | Old (Oct 9) | New (v2) | Change |
|---|---|---|---|
| Package | 117 | 117 | 0 |
| Option (incl. AWD/4WD drivetrain) | 209 | 223 | +14 |
| Paint (incl. two-tone) | 269 | 269 | 0 |
| Powertrain (transmission) | 5 | 5 | 0 |
| **Total** | **600** | **614** | **+14** |

Net +14 hides churn: 79 entries added, 65 removed, 34 re-kinded (e.g. Tundra Head-Up Display package -> option, Tacoma Towing Technology Package option -> package).
Added: 5 Tundra TRD Off-Road Packages (Paul), bZ AWD x2 and Front-Wheel Drive Plus/Panoramic Roof/JBL/paints (the bZ model is now named `bZ`, scope `toyota|bz|2027`; the old `toyota|bz bz4x|2027` scope is gone and the old spelling is still matched), Sequoia TRD Off-Road Package (4x4 only) on SR5/Limited and TRD Front Skid Plate, Tacoma A/T packages, Digital Key renames. Removed entries are mostly renames (v2 spells two-tones "w/ ... roof", drops the asterisks in "Digital Key* Capability", shortens transmission names); aliases cover the old wordings so dealer text still matches.

By model-year (package / option / paint / powertrain, old -> new): the only changed rows are 4Runner 0/28/16/0 -> 5/23/16/0, Corolla Cross 7/5 -> 5/7 pkg/opt, RAV4 PHEV 8/0 -> 5/3, Sequoia 13/22 -> 16/23, Tacoma 12/30 -> 22/23, Tundra 35/38 -> 29/49, C-HR 4/0 -> 1/3, Corolla 6/2 -> 4/4, bZ 2/1/9/0 -> 0/5/9/0. All other model-years are identical.

## Behaviour change to know about

v2 has no "Accessory package" rows, so the per-model dealer add-on name lists are now empty (`dealerAddons.keys: []`). The generic dealer-product patterns (floor mats, PermaPlate, lifetime oil, nitrogen, VIN etch, ...) still send those lines to `dealer_addons`; an accessory name that only the old CSV listed (e.g. "Carpet Mat Package"-style names not covered by a pattern) is now dropped instead of set aside. Either way it is not shown as a factory option.

## Read-only dry-run plan (box2, not run yet)

Script: `scripts/box/2026-10-11-toyota-option-policy-dry-run.mjs` (a copy of the Ford dry run: reader account only, 20 s per-query cap, no writes, no sync lock, no facet rebuild, no restart; a second timeout stops the run).

1. Copy the script, `scripts/lib/optionPolicyDryRun.mjs` and the merged `src/optionPolicies/*.json` + `src/factoryOptionAllowlist.js` to a scratch dir on box2 (never into `/opt/trimscout-deals`).
2. `node 2026-10-11-toyota-option-policy-dry-run.mjs --env /opt/trimscout-deals/.env.trimscout-db --out ./out --batch 20`
3. Read `out/toyota_option_policy_dry_run.json`: per policy scope, **before** = option rows stored today (`dealer_inventory_options`) and **after** = rows the policy keeps from each car's `options_json`; also rows kept/removed, cars with 0 options before/after, cars with no trusted trim, dealer add-ons set aside, top remaining options.
4. Compare against the Oct 10 apply (48,934 cars / 742,497 rows deleted) for drift, and list every scope whose cars-with-0-options rate rises sharply.
5. Report the counts to Paul. The apply (plan -> apply -> one facet rebuild, `DISABLE_FACET_REBUILD=1` kept) is a separate run in the idle window, only on his GO.

Before/after counts on live inventory are produced by step 3 (there is no box access from this change). The counts above are the policy-entry counts.
