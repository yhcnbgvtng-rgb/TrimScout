# Keep cars whose make nothing can name, on crawl boxes 1, 3, 4 (PR B) — code, tests and docs only. NOTHING IS INSTALLED by this PR.

Install only on Paul's typed **GO**, one box at a time, after that box's sync has finished and before 21:30 ET (`install-keep-unresolved.sh` refuses outside 07:00-21:30 ET and while a crawl/sync runs). Read `docs/BOXES.md` first. Planned: crawl boxes after their syncs on 2026-10-30, all done by 21:30 ET. Stacked on PR A (`docs/box-patches/2026-10-29-box2-vin-guard`, the 5 new prefixes), which has to be merged first or this PR retargeted when it merges.

## The problem
The 10-28 crawl logs on boxes 1/3/4 show **~4,300 unique cars skipped** with `make unresolvable (no page make, VIN not in the WMI table ...)` (box1 1,502, box3 735, box4 2,081). The message is wrong: the prefixes are in the table (`5N1` 421, `5NM` 367, `5TD` 360, `KND` 350, `KMH` 347, `JF2` 344, `5XY` 288 ... on box1). They are **shared-plant** prefixes (Nissan/Infiniti, Hyundai/Genesis/Kia, Toyota/Lexus, Subaru/Toyota), the page gave no make, and the roster brand (a Honda store listing a Nissan Rogue) is outside the prefix's family, so neither the VIN nor the fallback could name it and the car was dropped. A dropped car is missing from the shard, so the sweep retires it after two misses.

## What changes
1. **`vinWmi.js`: the model name picks the make among the makes the prefix can carry** (`makeFromModelInFamily`, `MODEL_NAMES`). Safe by construction: only the makes of that VIN's family are considered; a model matching exactly one of them names it, none or several say nothing; a stored make that is already inside the family is never second-guessed; single-make prefixes never consult the model. A Rogue on a Honda lot becomes Nissan, a QX60 Infiniti, a Sportage Kia, a Sienna Toyota, a TX 350 Lexus, a Forester Subaru, a Civic on a Nissan VIN stays unresolved (a model of a make outside the family is not evidence).
2. **`brand_match.js`: `makeSource: 'unresolved'`** (make null) instead of `makeSource: null`, and one log line `make_source=unresolved (make left blank, car kept ...)` (replaces the misleading "VIN not in the WMI table ... skipped" text, which is gone).
3. **`standalone.js`: the car is kept**, not skipped (the `if (!keptMake) console.log(...skipped...)` line and the `if (keptMake)` gate become a plain block; `vehicle.make = keptMake` assigns null). Null make was checked against every normalizer that runs after it (`normalizeVehicleFields`, `cleanTrim`, `normalizeTrimForWrite`, `applyParsedPriceGuard`, `recoverModelTrim`, `applyWindowSticker`): none throws. The deals API stores a blank make (blank-make rows already exist), and `normalizeMakeForWrite` leaves it blank.

**Not done: VIN positions 4-8.** The brief allowed "VIN position 4-8 or the model name where safe". A VDS table needs ground truth per 5-8 character prefix that the repo does not have (the stored data is exactly what is wrong), so it was not guessed. The new `make_source=unresolved` log lines list the VINs that remain; decode them once with the NHTSA vPIC step of `scripts/box/2026-10-24-make-wmi-reclean.mjs --vpic` and add what is certain.

## md5 table (all pinned in `install-keep-unresolved.sh`, which refuses on any other value)
| File | Before | After |
|---|---|---|
| `src/vinWmi.js` | `7371d7d9bd40bd9586b4ef8a848a4969` (make-wmi; `274e6047…` also accepted, the box2 package's table) | `ca01f12109ab5eb40901d68b022486db` |
| `src/brand_match.js` | `2b421d128ce20aab0644820bb0702271` | `255cfe545bc30d8e41d45edf4cb33180` |
| `src/standalone.js` box3, box4 | `d05cd479b8f8d22a77d4d9fb1ef2e31a` | `1e3766e5d0a5b3042f766c8ea205332d` |
| `src/standalone.js` box3, box4, **after the trim wiring (#630)** | `6f4c4f2a4b4db2ab2830e11074723dba` | `d948a134a70ea055c4a2dac235e8d474` |
| `src/standalone.js` box1 | `8c39cf86d3017210d586ff3afeb33969` | `ede2990ec93118428f0854be09006699` |
| `src/standalone.js` box1, **after the trim wiring (#630)** | `980769d114cba511aef4bc5ff033e0ae` | `84a36177398ab6408b5302d1a585cb41` |
| patch `standalone.js.keep-unresolved.patch` | | `b06c4d5b2f5cb1c34812c08f81678a41` |

`stellantisMake.js` (`4017f1f9…`), `ingestGuards.js` (`88ec75c5…`) and `stellantisVinTable.js` (`2bb09025…`) must already be the make-wmi versions; the script checks and refuses otherwise. The standalone md5s are the ones #630 read on the boxes 2026-10-29, reproduced here from `2026-10-28-politeness-refit/box-src` + patches; not re-read live while writing this.

## Fit with the trim wiring (#630): either order
The patch touches the `keptMake` block (~line 1085); #630 adds an import (~line 42) and a trim block (~line 1157). They do not overlap, the patch applies with zero fuzz to the file before or after #630, and both orders reach the same md5 (a test checks it for box1 and box3/4). `install-trim-wiring.sh` in this PR was extended to recognise the four files this patch leaves behind (it refused any other md5), so **#630's script also works after this one**. Recommended anyway: #630 first (it is already staged and was reviewed first), then this.

## Steps (per box, same ssh form as `2026-10-29-trim-wiring-boxes-134/STEPS.md`: the `-i` does not reach the jump host, use the ProxyCommand form there; box4 172.26.11.241, box3 172.26.15.105, box1 172.26.1.32)
D=docs/box-patches/2026-10-29-keep-unresolved-make-boxes-134 (from a fresh worktree off `origin/main` after merge)
1. Stage (writes only `/tmp/keepmake-stage` on the box), then verify the md5s against `manifest.txt`:
```bash
$SSHB ubuntu@$IP 'mkdir -p /tmp/keepmake-stage'
$SCPB $D/files/vinWmi.js $D/files/brand_match.js $D/standalone.js.keep-unresolved.patch ubuntu@$IP:/tmp/keepmake-stage/
```
2. Read-only check (gates, md5 of every file, trial on copies in a temp dir, the 10-case smoke test against the box's own `stellantisMake`/`ingestGuards`/`stellantisVinTable`). Must end `CHECK only, nothing written`:
```bash
$SSHB ubuntu@$IP 'bash -s -- check' < $D/install-keep-unresolved.sh
```
3. Apply on Paul's GO (backup in `~/backups/keep-unresolved-make-20261029/`, installs vinWmi -> brand_match -> standalone, verifies md5s and syntax, loads the installed `brand_match.js` and resolves a Rogue on a Honda roster, restores itself on any failure; no restart):
```bash
$SSHB ubuntu@$IP 'bash -s -- apply' < $D/install-keep-unresolved.sh
```
4. First look after the next 22:00 crawl (read-only): `grep -c "make_source=unresolved" logs/*-<date>.log` per box, and that `make unresolvable` is 0; unique VINs in the `unresolved` lines are what is left to decode. Compare with the 10-28 skip counts above. The kept cars have a blank make, so they appear in unfiltered search only, until a repair fills them.
5. After the next sync: blank-make rows should rise by about the `unresolved` count and retirements for these cars should stop (the retired-cars audit saw them as misses).

## Rollback (per box)
```bash
$SSHB ubuntu@$IP 'bash -s -- rollback' < $D/install-keep-unresolved.sh
```
Restores all three files from the backup after checking each against its recorded md5. Cars already crawled and stored with a blank make stay stored.

## Known limits
- Cars the model cannot place (no model on the page, or a model that matches nothing) are kept with a **blank make**, not guessed.
- A stored make that is inside the prefix's family stays: a Solterra stored as Toyota on `JTM` (224 box1 fallback lines) is not corrected, because the rule never second-guesses a nameplate inside a family. Fixing that needs a different rule (model as proof) and was left out on purpose.
- `box2`'s VIN-guard package now ships the same table (`ca01f121`, model inference included, `inferModel` opt-out) (one file; not needed for this install). The stored-row repair (`scripts/box/2026-10-28-make-from-vin-fix.mjs`) bundles the repo's `vinWmi.js` but passes `inferModel:false`, so its audited #633 rules and counts are unchanged by the model fallback (it stages model inference as its own `model-*` rules); the crawler and the deals-API write path keep `inferModel` on (the default).

## What was tested (no box access)
`scripts/box/keep-unresolved-make-boxes-134.test.mjs` (13): the patch on the rebuilt box1 and box3/4 files, with and without the trim wiring, both orders; `install-keep-unresolved.sh` on a fake box in all four states (check writes nothing, apply lands on the pinned md5s, rollback is byte for byte, second apply says ALREADY INSTALLED); refusal on time, running crawl, md5 drift of any of six files, tampered or missing staged files, mixed states. `vin_wmi.test.js`, `make_fallback.test.js` cover the inference and the kept car. **Not tested:** the real boxes' files (md5s are reproduced from the repo's box-src, not read live), and a real crawl.
