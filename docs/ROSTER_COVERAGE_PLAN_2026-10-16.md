# Roster and coverage plan: AR, MI, LA, DE Kia (read-only plan, nothing applied)

Written 2026-10-16. Evidence is from read-only checks of the four crawl boxes, box2's database (reader account) and the repo.

## What is actually wrong

The state-to-box assignment is not the problem. **Kia is a core-brand-set brand** (`NJ_BRANDS_IN_CORE`, not expansion), and the states are already on boxes that crawl core:

| State | Core crawl runs on | Kia rooftops in that box's `dealers/<st>/kia.json` | Full Kia locator roster |
|---|---|---|---|
| AR | box3 (core list) | **0** | 8 |
| MI | box4 (core list) | **0** | 22 |
| LA | box1 | **2** | 14 |
| DE | box1 | **2** | 4 |

An empty roster means the Kia job for that state is skipped without a log line, which is why no `ar-kia` / `mi-kia` log exists. LA and DE do run, but with a 2-store roster ("Centers Configured: 2").

Why the rosters are thin: `dealers/<st>/kia.json` is generated from `dealers/oem-dumps/kia.json` (`locatorRowsForState`). That in-repo dump has **184 rows in 14 states and zero rows for AR, MI, LA, DE**. The full roster already exists: `scrapers/dealer-rosters/kia/roster_raw.json` (kia.com locator, 2026-09-15) has **800 dealers**, with AR 8, MI 22, LA 14, DE 4, all with a website. Box rosters also drift apart: Kia rooftops across all states are box1 399, box2 682, box3 367, box4 367, and 29 states on box1 have two or fewer.

Not a block, not a parser change. Separately, PR 551 covers stores that are on the roster but fail sitemap discovery at night.

## Which box takes AR and MI

No move. Keep AR on **box3** and MI on **box4**. Moving a state would change the claim order and the capacity preflight for no benefit, and box2 is the deals box (MariaDB, deals-api; 11 OOM kills Oct 10-16), so it should not take more crawl. Queue mode (`crawl_queue/flag.json`) is off, so `CRAWL_STATES` is still the order that matters.

## Rebuild steps (on a dev machine, in a fresh worktree; boxes untouched until a GO)

1. Refresh the roster: `python3 scrapers/dealer-rosters/kia/crawl_locator.py query_zips.json roster_raw.json` (950 ZIPs, radius 120 mi, 6 concurrent; the Sep 15 file is a month old).
2. Convert to the dump shape `{city, domain, lat, lng, make: "Kia", name, source: "oem-locator", sourceUrl, state}` (domain = host of the dealer `url`, no `www.`) and replace `dealers/oem-dumps/kia.json`. Keep any existing row the new roster lacks.
3. Regenerate files: `node scripts/write-ar-dealer-files.mjs`, and the matching `write-mi/la/de` scripts. Expected counts after the megadealer filter: AR about 8, MI about 22, LA about 14, DE about 4. Anything lower is a filter drop to review by name.
4. Check by count before any copy: `dealers/<st>/kia.json` length for all states against the locator count per state. This same check should be run for the other core brands, because several dumps in the repo are empty (audi, bmw, honda, infiniti, nissan, volvo: 0 rows) and others cover only 16 states.
5. PR with the dump, the regenerated files and a test that fails when a state with a locator row has an empty roster.
6. On Paul's GO, in an idle window, copy only `dealers/{ar}/kia.json` to box3, `{mi}` to box4, `{la,de}` to box1 (check mtime first, keep a backup copy, no restart needed, files are read at job start).
7. Verify the next night: the log shows "Configured: 8 / 22 / 14 / 4", the stores' `last_seen_at` moves, and PR 551's zero-VDP alert line stays quiet for them.

## Extra crawl time (estimates, not measured on the new rosters)

Per-rooftop planning constants from cron: box1 55 s, box2 30 s (P90). Observed on box1: LA Kia 362 s for 2 rooftops, DE Kia 108 s for 2.

| Box | State | Rooftops added | Added state-job time (30 to 55 s each) |
|---|---|---|---|
| box3 | AR | +8 | 4 to 7 min |
| box4 | MI | +22 | 11 to 20 min |
| box1 | LA | +12 | 6 to 11 min |
| box1 | DE | +2 | 1 to 2 min |

That is 44 rooftops, 22 to 40 minutes of work spread over three boxes, and only counts toward wall time if that state is the longest chain on its box (box1 runs 2 states at once, box3 core 6, box4 unreported). Context: box3's core preflight is 4.0 h for 932 rooftops at 6x concurrency, so +8 is about +2 min. All three stay far inside the 24 h SLA. Sync and DB load rise a little: these stores' cars are already in the database (they are the stale ones), so most of it is updates, not new rows (not measured).

## Not covered

AR-style empty rosters for other brands and states (step 4's audit will size it), and group-shared inventory (four Crain Kia stores each extract the same group total of about 1,250 cars).
