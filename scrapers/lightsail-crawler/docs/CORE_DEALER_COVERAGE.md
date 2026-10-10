# Core dealer coverage: why brands go missing, and how to refresh them (2026-10-09)

## How a core brand gets its dealers

Core dealer files (`dealers/<state>/<brand>.json`) are **not in git**. Every state's
`write-<state>-dealer-files.mjs` step regenerates them at the start of each crawl from
`dealers/oem-dumps/<brand>.json` (plus the in-repo Acura/Porsche locators and listing-verified hosts).
A (state, brand) pair with no rows in the dumps gets an empty file and the driver skips the brand
("no dealers in ..."), so nothing is crawled and nothing fails.

The dumps in git are a 2026-09-20 snapshot from before most states were added, and they are copied to
the boxes by hand. A box's dumps are only as complete as the last time someone ran the fetcher there.

## The three symptoms (Oct 8 core crawl)

1. **Hyundai: 0 lines.** Hyundai joined `NJ_BRANDS_IN_CORE` on 2026-09-20 and `fetchHyundai()` was added
   the same day, but no `dealers/oem-dumps/hyundai.json` was ever produced or committed (it is absent from
   `_status.json`, which predates it). With no dump, `write-<state>-dealer-files` wrote `[]` for Hyundai in
   every state and the driver skipped it everywhere.
2. **WA and MI ran about 6 brands.** The locator dumps hold rows for the original states only. WA and MI
   have rows for just the brands that arrive by another route: Porsche (in-repo `dealers.json`, 48 states)
   and the six directory-filled brands (BMW, Audi, Volvo, Honda, Nissan, Infiniti) via
   `materialize-core-locator-gap-dealer-files.mjs`. Toyota, Subaru, Kia, Mazda, VW, Lexus, Mini,
   Mitsubishi, Acura and Mercedes had no WA/MI rows, so they were skipped. That is the same count.
3. **WI missing Hyundai, Subaru, Toyota.** Same mechanism: no WI rows in those three dumps. The WI seeds
   (zips and Toyota city pages) are present in `fetch-oem-dealer-locators.mjs`, and a plain GET of the
   Hyundai and Subaru locators with the WI zips returns WI dealers (checked 2026-10-09 from a laptop), so
   nothing blocks them. The dumps were just never re-fetched for them.

**Not verified:** the boxes' actual dump files and logs, because the brief ruled out touching them. The
causes above follow from the code and the committed dumps. To confirm on a box (read-only):

```bash
cd ~/<crawler dir> && ls -l dealers/oem-dumps/hyundai.json; node scripts/check-core-dealer-coverage.mjs --states=WI,WA,MI
```

## What this change adds

- `fetch-oem-dealer-locators.mjs --brands=... --states=...` refreshes only some dumps and/or states and
  leaves everything else in the dump as it was.
- A fetch that returns no rows (blocked locator) no longer replaces a non-empty dump. Before, a full run
  overwrote the directory-filled Honda/Nissan/etc. dumps with `[]`.
- `scripts/check-core-dealer-coverage.mjs`: read-only, no network. Prints brands x states counts and exits 1
  when any pair has zero dealers.
- The driver logs `COVERAGE GAP <state> <brand>` and records `coverageGaps` per state, instead of a quiet skip.

## Box deploy steps (not done; each needs the user)

1. Merge, then `git pull` on box1, box2, box3, box4 (code only; nothing running is affected).
2. On **one** box (box2 suggested; it has the auth-api for step 3), refresh the dumps. Idle window only,
   not while a crawl is running, because the fetcher makes a few hundred plain GETs to OEM locators:
   ```bash
   node scripts/fetch-oem-dealer-locators.mjs --brands=hyundai          # new dump, all states
   node scripts/fetch-oem-dealer-locators.mjs --brands=toyota,subaru,kia,mazda,volkswagen,lexus,mini,mitsubishi,mercedes-benz --states=WI,WA,MI
   ```
   Other states in each dump are kept; Honda/Nissan/etc. are not touched.
3. `node scripts/check-core-dealer-coverage.mjs --states=<that box's CRAWL_STATES>`. Pairs it still lists are
   real gaps to look at, not crawl failures.
4. Copy `dealers/oem-dumps/` to the other core boxes (same manual copy as the gap-fill brands), and run the
   check there with each box's own `CRAWL_STATES`.
5. Re-run `recommend-shard-split.mjs` (below) before 22:00: the new rooftops change every box's projection.

## Box 1: finishing its 13 states overnight

Measured facts from `CAPACITY_SLA.md`: box1 is 2 vCPU, runs at 77.4 s/rooftop, and its 13 states are 1,889
rooftops. At `CRAWLER_MAX_CONCURRENT_STATES=2` that projects to 20.3 h, so it cannot be overnight at any
rate we have measured. Adding Hyundai and the WA/MI/WI brands makes it longer.

- **Do not raise concurrency.** The 4.8x per-rooftop gap against box2 tracks processes per vCPU
  (box1 was 2.0 at 4x). The hard rule in that doc is floor(1.5 x vCPU), and box1 is at 2 on purpose.
  More processes on 2 cores inflates the per-rooftop time more than it adds throughput.
- **Split instead.** Overnight (about 10 h) at 2x and 77.4 s means about 930 rooftops, roughly half of
  today's list. Two ways, both crontab-only:
  1. *Static:* shorten box1's `CRAWL_STATES` to about that size (largest states first off the list) and
     give the rest to box2 (6x, 16.2 s/rooftop measured, 4.2 h for its 3,745 rooftops at that rate; its
     `checkProjectedRuntime` uses the generic rate, so set `CRAWLER_P90_SEC_PER_ROOFTOP` per box).
  2. *Queue (already built, off by default):* `CRAWLER_STEAL_ENABLED=1` on box2/3/4 so they claim box1's
     unstarted states longest-first once their own lists are done. Box1 keeps `CRAWLER_STEAL_ENABLED` as is.
  Recommended: do (1) now, because it is deterministic, and turn (2) on afterwards as the safety net.
- Generate the exact lists after the dumps are refreshed (read-only):
  ```bash
  node scripts/recommend-shard-split.mjs --brand-set=core --boxes=4 --concurrency=2,6,6,6 --p90=77.4,16.2,16.2,16.2
  ```
  Per the 2026-09-25 run of that command a time-fair split gives box1 only about 3 states; pick a middle
  value (about 5 to 6 states) if you want box1 busy but done by morning.
