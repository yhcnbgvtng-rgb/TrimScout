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
- load: `bigJson.readJsonLarge` (whole-file parse below 64 MB, VIN-by-VIN above). A missing file is `{}` as before; a file that exists but cannot be read is renamed
  `dom_index.json.unreadable-<ms>` (not overwritten) before starting empty.
- file format: still one JSON object keyed by VIN. Only difference: a newline between VINs. Whole-file `JSON.parse` readers keep working.
- NOT changed: heapGuard.js / `heapReserveBytes` (1.25 x index + 256 MB). The new save needs far less than that, so the guard is now more conservative than necessary — left alone on purpose.
- NOT changed: two crawl processes still each hold their own copy of the index and the last save wins (pre-existing). Unlike before, they no longer share one fixed `.tmp` name.
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
