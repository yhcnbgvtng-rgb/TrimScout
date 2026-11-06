# Heap guard for box1-v2 and box5 (2026-11-06) — code only until Paul's GO

Night B 2026-11-05: `MD Nissan` (box1, 566 s) and `FL Infiniti` (box5, 270 s) aborted with `JavaScript heap out of memory` at ~3.58 GB (the 3584 MB default).
Both died inside the single biggest store of the shard (Eastern's Nissan of White Marsh, 2,423 VDP URLs; Infiniti of South Miami, 3,295). An abort writes nothing,
so every store the run had already read was lost with it.

## What the package does
- `src/heapGuard.js` (new): stops handing out URLs for the current store once live heap passes the LOWER of 85% of the limit and (limit - reserve), where
  reserve = 1.25 x dom_index.json + 256 MB. Measured 2026-11-06 with a box1-sized index (489 MB): standalone.js saves the whole index after every store with one
  `JSON.stringify`; at 85% live heap that save survived with ~40 MB to spare and at 88% it aborted, so a plain 85% line was not safe on box1. With the reserve the guard
  trips at ~2.8 GB on box1; the same run then survived the save, 8 in-flight pages and a merge-sized allocation. box5 (107 MB index) keeps ~85%.
  The store is flagged a partial crawl (excluded from the sold-diff) and the run finishes and saves. `CRAWLER_HEAP_GUARD_RATIO=0` turns it off.
- `standalone.js`: stores a flat copy of each vehicle (`structuredClone`). Defensive and UNMEASURED: whether page-slice strings pinned the heap on 11-05 is not shown.
- `syncSweepGuard.js` (sync client, both boxes pinned at c9c3ccf4…): reads the guard's crawl-log line and keeps that store out of tonight's sweep, so no miss is counted.
  Without it the unread part of a store (e.g. 40% of 1,000 cars) was swept and counted a miss every night, retiring after the third; the ratio guard only helps below 50% fresh.
- `run-daily-crawl.mjs`: `CRAWLER_HEAVY_HEAP_EXTRA="MD:nissan,FL:infiniti"` raises named runs to the 5120 MB heavy heap without a code edit. Nothing sets it.

## Run it (from this directory; nothing is staged on the box)
```
ssh box1 'bash -s -- check' < install.sh     # read-only trial on copies in a mktemp dir. Run 2026-11-06 12:4x ET: ok on box1 and box5
ssh box1 'bash -s -- apply' < install.sh     # ONLY on Paul's GO. Same for box5. Backup: ~/backups/heap-guard-20261106
ssh box1 'bash -s -- restore' < install.sh
```
Pinned before-md5s: crawler box1 standalone 8c39cf86…, driver 89b6bb52…; box5 standalone 2e69d874…, driver f3d6c4b5…; both boxes syncSweepGuard.js c9c3ccf4…. Refuses on any other md5, 21:30-07:00 ET, or a crawl/sync running.
No restart, no cron change: the next crawl is a fresh Node process.

## Optional second step (not in the script): heap limit
box1 is 16 GB at 2 concurrent states, so two 5120 MB runs fit. box5 is 31 GB but its cron runs `CRAWLER_MAX_CONCURRENT_STATES=8`
(docs/BOXES.md says 4: stale); 8 x 3584 MB already leaves ~3 GB, so do NOT raise the default there. Per-run override only, in the cron line:
`CRAWLER_HEAVY_HEAP_EXTRA=MD:nissan` (box1), `CRAWLER_HEAVY_HEAP_EXTRA=FL:infiniti` (box5). Needs its own GO (crontab edit).
