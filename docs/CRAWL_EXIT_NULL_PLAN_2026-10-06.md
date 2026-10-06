# Crawl failures ("exit null" / V8 kills) — evidence and plan, 2026-10-06

Status: **plan only**. Nothing here was run as a crawl, and no recovery re-crawls were started.
Written from read-only looks at the four crawl boxes on 2026-10-06 (summaries, child logs, file sizes, memory).

## What the failures are (verified)
Failed brands in the last nights' `summary_*.json`:

| Night / box | Failed brands |
|---|---|
| 10-05 box3 | OH GMC, Buick, Stellantis · MI Chevrolet · TX Ford, Lincoln, Chevrolet, GMC, Buick, Cadillac, Stellantis |
| 10-05 box4 | NC Ford · FL Ford, Lincoln, Chevrolet, GMC, Buick, Cadillac, Stellantis |
| 10-06 box4 (core job) | 17 FL core brands (Toyota, Lexus, Kia, Honda, Acura, Nissan, Infiniti, Subaru, Mazda, Volkswagen, Audi, BMW, Mercedes-Benz, Volvo, …) |
| 10-05 box2 | CA Honda (single) |
| box1 | none in the last three nights |

Two different-looking symptoms, one cause:
- Brands with **25 or fewer dealers** (one child process) show `signal: SIGABRT`.
- Brands with **more than 25 dealers** (sharded) show `exit null`, signal none. That `null` was the aggregation bug in `runBrandSharded` (fixed in #394, merged, **not yet on the boxes**), which threw away the real code of the failed shard. Every sharded failure in the table has dealerCount > 25, every SIGABRT one has ≤ 25.
- The child logs name the cause. For example `fl-lexus-2026-10-06.log`, `fl-toyota-shard0/1-2026-10-06.log` on box4:
  `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, stack in `v8::internal::Builtin_JsonParse`.
  **The child dies parsing the cumulative per-state files.** Not an OS OOM kill (`dmesg` shows none), not a bot block.
- File sizes right now: box4 `FL.json` 518 MB, `snapshots/FL.json` 522 MB, `enriched_cache/FL.json` 264 MB; box3 `TX.json` 532 MB, `snapshots/TX.json` 536 MB, `MI.json` 332 MB, `OH.json` 269 MB. Each child runs with `--max-old-space-size=3584`, and a ~520 MB pretty-printed JSON string plus its object graph does not fit.
- Boxes: 4-vCPU boxes have 15.8 GB RAM and **no swap**; box1 has 7.8 GB, no swap. box3/box4 run 4 states at once (expansion) and **6** (core), so six children at a 3.5 GB heap cap is 21 GB on a 15.8 GB box if they ever all peak together.

## Fix plan, in order
1. **Already done — PR #395, deployed to all four boxes 2026-10-06 (working tree, backups in `src/.pre-395-*`).** Streaming writer and a streaming reader for files over 64 MB, atomic rename, compact output (~30% smaller). It removes the `JSON.parse` of the whole file, which is the failing call. It takes effect on the **next crawl process** that starts; nothing running was changed. *Expected result:* no `Builtin_JsonParse` heap fatals in tomorrow's logs, and FL/TX/OH/MI/NC brands finishing. Measure that before changing anything else.
2. **Get real reporting onto the boxes: deploy #394** (`run-daily-crawl.mjs` + `box_report.js`) by the same patch-over-the-box's-own-file method used for #395. Then any failure that remains reports a real exit code/signal and credits finished shards. (Box `run-daily-crawl.mjs` has drifted; patch, don't copy.)
3. **Stop the files growing without bound** (the real reason they are at the wall). The per-state files carry records forward, including cars the sweep already retired. Proposal: when `standalone.js` merges a brand run, drop carried-forward records not seen for N days (start with 14) and that the DB already shows removed. Needs a look at what the merge uses carried-forward records for (price history, first-seen) before choosing N — this is the one step that needs a code review first.
4. **Per-brand output files instead of one cumulative state file** (`data/inventory/<ST>.<brand>.json`). Removes the shared-file growth and the per-shard whole-file read entirely. Larger change; the sync reads every `*.json` in `data/inventory`, so stale-file cleanup (see the 2026-10-03 stale-shard incident) has to be designed in at the same time.
5. **Memory safety net, only if 1–2 don't clear it:**
   - cap concurrency on the heavy boxes: expansion chain `CRAWLER_MAX_CONCURRENT_STATES` 4 → 2 and core 6 → 3 on box3/box4, with the heap cap raised to ~6 GB for the big states. Measured nightly runtimes were 13.8 h (box3) and 14.5 h (box4) against a 24 h SLA, so there is room, but recompute with `recommend-shard-split.mjs` first.
   - add a 4 GB swapfile on box2/3/4 as a cushion (turns a hard abort into a slowdown; not a fix, and heap thrash in swap is slow).
6. **Do not shrink `MAX_DEALERS_PER_SHARD`.** Each shard run reads and rewrites the whole state file, so more, smaller shards means more 500 MB reads, not fewer. Peak memory is driven by the file, not the shard.

## Not started (per instruction)
- No recovery re-crawls. Thin-state domestic list, for when a go is given: **OH** GMC, Buick, Stellantis · **MI** Chevrolet · **TX** Ford, Lincoln, Chevrolet, GMC, Buick, Cadillac, Stellantis · **FL** Ford, Lincoln, Chevrolet, GMC, Buick, Cadillac, Stellantis plus the FL core brands above · **NC** Ford · **CA** Honda.
- Do not start any until a night with #395 live confirms the fix, so a re-crawl is not just another failed run.
