# dom_index.json incremental save for box1 (v2) and box5 (2026-11-06) — code only until Paul's GO

## Why
box1's `data/dom_index.json` is 480,663,249 bytes (read 2026-11-06 16:00 ET) and grows every night. V8 cannot build a string longer than 536,870,888 characters
(confirmed: `JSON.stringify` of a 600 MB synthetic index throws `Invalid string length`, node 22). The old save was `fs.writeFile(tmp, JSON.stringify(wholeIndex))` and the old load
`JSON.parse(await fs.readFile(...))`, so both would start throwing about 56 MB (~12%) past today's size. Worse, the old load swallowed every error and returned `{}`, so
the next save would have replaced the whole price history with an empty index. box5's index is 107 MB, box2's 55 MB (same code, further from the wall).

## What changes (one file: `src/dom_store.js`)
- save: `bigJson.writeJsonLarge` (already on both boxes, same md5, already used by standalone.js for the state shards): one VIN at a time into a uniquely named temp
  file `dom_index.json.tmp-<pid>-<ms>`, fsync, rename. A failure closes and deletes the temp file; the previous index stays. Saves in one process run in call order, one at a time.
  A temp file older than 6 h (a killed process) is removed on the next save; a younger one is never touched.
- load: `bigJson.readJsonLarge`, and it **fails closed**. Only ENOENT (no index yet) gives `{}`. A permission error, malformed or truncated JSON, an empty file, a directory in its place, or a read that keeps failing
  throws `DomIndexUnreadableError` (code `DOM_INDEX_UNREADABLE`) and leaves the file exactly as it is (nothing renamed, moved or created). Transient errors (EAGAIN, EBUSY, EINTR, EMFILE, ENFILE, EIO, ETIMEDOUT, ENOMEM)
  are retried 3 times (0.5 s, 1 s) first; EACCES and bad JSON are not. `standalone.js` loads at startup with a top-level `await`, so that brand run exits non-zero and the driver records it as a failed run, like any other
  crashed brand; nothing after the load (including every later `saveDomIndex`) runs. The previous behaviour (return `{}` on any error, next save overwrites the file) is gone.
- file format: still one JSON object keyed by VIN. Only difference: a newline between VINs. Whole-file `JSON.parse` readers keep working.
- NOT changed: heapGuard.js / `heapReserveBytes` (1.25 x index + 256 MB). The new save needs far less than that, so the guard is now more conservative than necessary — left alone on purpose.
- NOT changed: concurrent brand processes still lose each other's updates (see "Concurrent brand processes" below). This PR fixes the shared `.tmp` name, not the lost updates.
- One behavioural difference: the old save serialised the index in a single synchronous step; the new one yields between VINs, so a save can include a VIN date added by a worker a moment later. Harmless (superset; the next save has it anyway).

## Run it (from this directory; nothing is staged on the box)
```
ssh box1 'bash -s -- check' < install.sh     # read-only trial on copies in a mktemp dir. Run 2026-11-06 ~16:10 ET: ok on box1 and box5
ssh box1 'bash -s -- apply' < install.sh     # ONLY on Paul's GO. Same for box5. Backup: ~/backups/dom-index-save-20261106
ssh box1 'bash -s -- restore' < install.sh
```
Pinned: dom_store.js before 1a2e29b0… (identical on box1, box2, box5 and origin/main at 9c755091), bigJson.js 650637d9…, heapGuard.js 452ce895… (#719). After: see `DS_AFTER` in install.sh.
Refuses on any other md5, 21:30-07:00 ET, or a crawl/sync running. Never opens data/dom_index.json. No restart, no cron change: the next crawl is a fresh Node process.
`install.sh` is generated from `install.template.sh` (embeds src/dom_store.js as base64); `test/dom_index_save_package.test.js` fails if they drift.

## Concurrent brand processes share one index (checked 2026-11-06, read-only, box1 and box5)
**Yes, they share it, and it is a real lost-update race that atomic rename does not fix.**
- Every brand run is `node src/standalone.js` with `cwd` = the crawler root (`run-daily-crawl.mjs` `runStep(..., { cwd: root })`), so `DATA_DIR/dom_index.json` is one file for all of them.
  The 22:00 cron runs `CRAWLER_MAX_CONCURRENT_STATES=2` (box1) and `=8` (box5), i.e. 2 / 8 states' brand loops at once.
- Each process loads the whole index once at startup into its own `domIndex` and calls `saveDomIndex(domIndex)` after **every dealer** (standalone.js `finally` block, outside `withSharedDataLock`) and once at the end.
  Each save writes that process's copy, which has its own new VIN-dates but not what the other processes added after it started. Whichever process saves last replaces the file, and the others' new entries from that night are dropped.
  A rename makes each individual write all-or-nothing; it does nothing about two writers each overwriting the other's content.
- Evidence the old fixed `.tmp` name collided on the live boxes (`DOM index write failed: ENOENT ... rename 'dom_index.json.tmp'` in the per-brand logs): box1 6 / 10 / 3 failures on 11-03 / 11-04 / 11-05, box5 2 / 34 / 52.
  Worse than the logged failures: two processes truncating and writing the same `.tmp` file at once can leave a mixed file that is then renamed into place. Both live indexes parsed cleanly on 2026-11-06 (read-only parse, box1 419,442 VINs / 2,365,391 vin-dates, box5 376,319 / 499,343), so that has not corrupted them so far. The unique temp name in this PR removes that case; fail-closed load means a corrupt file would now stop the run instead of being replaced by `{}`.
- Evidence of lost updates is only circumstantial: entries dated 11-03 / 11-04 / 11-05 on box5 are 237,977 / 155,588 / 105,778 and on box1 87,732 / 78,181 / 105,727 (11-01: 116,789, 11-02: 72,415). Those numbers are consistent with later days losing entries but also with fewer cars being crawled, so I am not claiming a measured loss rate. A direct measurement needs a run's per-process entry counts compared with the saved file; not done.
- Consequence if real: a lost entry means tomorrow's `yRec` lookup misses, so the car is classed NEW instead of a price change, its blob is rewritten, and price history for it has a gap.
- **Proposed fix (not in this PR; needs a `standalone.js` box patch, md5-pinned, its own PR and GO):** keep the in-memory copy read-only for the `yRec` lookup, record only this run's own new/changed VIN-dates in a small per-process delta (checkpointed to a uniquely named file after each dealer, replacing the per-dealer full save), and at the end of the run take `withSharedDataLock({ scope: 'dom-index' })`, reload the current file, apply the delta (union by VIN then date; different states have disjoint VINs, and two writers of the same VIN+date write the same day's record), save once with the incremental writer, release. Cost: one ~15 s load and ~1 s save under the lock per brand run, instead of a full save per dealer. A crash loses at most the dealers since the last delta checkpoint, and an orphaned delta can be merged by the next run. Alternative considered: one index file per state like `data/inventory/<ST>.json` (no lock, but needs a one-time split of the 480 MB file and every reader changed). Not recommended first.
- Until then: lost updates continue exactly as before this PR.

## Other boxes
box2: same dom_store.js/bigJson.js md5s, 55 MB index: no urgency, same package would apply. box3/box4: not reachable by alias from the Mac on 2026-11-06, unchecked.
Not in scope of this install.

## Measurements: `scrapers/lightsail-crawler/scripts/dom-index-bigtest.mjs`
```
600 MB, new code (node 22.14, --max-old-space-size=3584, Mac):
build in memory              ok  2.1s  start heap 4 MB  peak heap 536 MB (+531)  peak RSS 659 MB
  255681 VINs, 3068172 vin-dates
digest of built index        ok  0.8s  start heap 529 MB  peak heap 546 MB (+17)  peak RSS 662 MB
new save #1                  ok  0.8s  start heap 529 MB  peak heap 603 MB (+74)  peak RSS 726 MB
new save #2                  ok  0.8s  start heap 530 MB  peak heap 612 MB (+83)  peak RSS 742 MB
new save #3                  ok  0.8s  start heap 530 MB  peak heap 612 MB (+83)  peak RSS 742 MB
  file 629145717 bytes (600.0 MB)  > V8 string limit 536,870,888
new load                     ok  2.7s  start heap 5 MB  peak heap 1197 MB (+1192)  peak RSS 1337 MB
digest of reloaded           ok  0.8s  start heap 525 MB  peak heap 542 MB (+17)  peak RSS 719 MB
  ROUND TRIP IDENTICAL (sha256 over every VIN and its full history)
  leftover files: none

480 MB, new code:
build in memory              ok  1.5s  start heap 4 MB  peak heap 446 MB (+442)  peak RSS 551 MB
  204546 VINs, 2454543 vin-dates
digest of built index        ok  0.6s  start heap 427 MB  peak heap 431 MB (+4)  peak RSS 551 MB
new save #1                  ok  0.6s  start heap 427 MB  peak heap 488 MB (+61)  peak RSS 604 MB
new save #2                  ok  0.6s  start heap 427 MB  peak heap 498 MB (+71)  peak RSS 616 MB
new save #3                  ok  0.6s  start heap 427 MB  peak heap 498 MB (+71)  peak RSS 617 MB
  file 503317698 bytes (480.0 MB)  <= V8 string limit
new load                     ok  2.1s  start heap 5 MB  peak heap 967 MB (+963)  peak RSS 1105 MB
digest of reloaded           ok  0.6s  start heap 424 MB  peak heap 427 MB (+4)  peak RSS 608 MB
  ROUND TRIP IDENTICAL (sha256 over every VIN and its full history)
  leftover files: none

480 MB, previous code (stringify/readFile) for comparison:
build in memory              ok  1.5s  start heap 4 MB  peak heap 450 MB (+446)  peak RSS 557 MB
  204546 VINs, 2454543 vin-dates
digest of built index        ok  0.6s  start heap 427 MB  peak heap 431 MB (+4)  peak RSS 556 MB
old save #1                  ok  0.6s  start heap 427 MB  peak heap 907 MB (+480)  peak RSS 2027 MB
old save #2                  ok  0.5s  start heap 427 MB  peak heap 907 MB (+480)  peak RSS 2027 MB
old save #3                  ok  0.7s  start heap 427 MB  peak heap 907 MB (+480)  peak RSS 2027 MB
  file 503113150 bytes (479.8 MB)  <= V8 string limit
old load                     ok  0.9s  start heap 4 MB  peak heap 1381 MB (+1377)  peak RSS 2527 MB
digest of reloaded           ok  0.6s  start heap 421 MB  peak heap 425 MB (+4)  peak RSS 1554 MB
  ROUND TRIP IDENTICAL (sha256 over every VIN and its full history)
  leftover files: none
```
