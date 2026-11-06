# dom_index delta merge for box1 (v2) and box5 (PR #721) — code only until Paul's GO

Fixes the outstanding lost-update race documented in `../2026-11-06-dom-index-save-boxes-15/STEPS.md` (#720 installed on box1/box5 2026-11-06 ~16:31 ET fixed the string limit
and the shared `.tmp` name, not this). Brand processes (2 on box1, 8 on box5) share `data/dom_index.json`; each used to save its own stale copy after every dealer.

## What changes (2 files, nothing else)
- `src/dom_index_delta.js` — NEW.
- `src/standalone.js` — patched (zero fuzz) against the live post-#719 file of each box; box1 and box5 differ, so there are two patches (`standalone.js.b1.patch`, `standalone.js.b5.patch`).
  Per-dealer `saveDomIndex(domIndex)` becomes a delta checkpoint; the loaded index is read-only; at the end of the run the delta is merged under the lock; today's DB rows come from the delta.
Not touched: `dom_store.js` (#720), `bigJson.js`, `heapGuard.js` (#719), `shared_data_lock.js`, `pid_lock.js`, `run-daily-crawl.mjs`, `data/`, crontab, env, heap size.

## How a merge works (src/dom_index_delta.js)
1. Each process records only the VIN-dates it wrote. After every dealer the delta is checkpointed to `data/dom_index_delta/delta-<pid>-<startMs>.json` (temp name + fsync + rename: a kill leaves the previous complete checkpoint; the half-written temp can never match the delta name). An unchanged delta only gets its mtime touched.
2. At the end of the run, under `withSharedDataLock({ scope: 'dom-index' })` (max wait 20 min): orphaned deltas are CLAIMED by an atomic rename to `claimed-<mergerPid>-...` (so a delta its owner rewrote can never be deleted unmerged), then the current index is STREAMED through the merge into `dom_index.json.tmp-<pid>-<ms>`, one VIN at a time (untouched VINs are copied verbatim, every VIN is validated as JSON), the temp file is read back and checked (entry count), and only then renamed over the index.
3. Order of durability: (a) both full records of every conflict are written and fsynced to a conflict file, (b) the index is renamed, (c) the delta/claimed files are deleted. A failure or kill anywhere before (b) leaves the index byte-identical and every delta on disk; a kill between (b) and (c) just replays the same deltas (identical records are no-ops).
4. An unreadable or malformed existing index makes the merge throw (`DomIndexUnreadableError`), exactly as the load does after #720: nothing is written, deltas stay.
5. Orphan rule: a delta is merged by someone else only if its owner pid is dead, or the owner pid is alive but the file has had no checkpoint/heartbeat for 6 h (pid numbers get reused). Merging a still-live process's delta early would also be harmless: records are idempotent and its owner still merges its in-memory delta at the end (tested). A merger's own `claimed-` files are recovered if that merger died.

## Same VIN, same date, two different records: the policy, exactly
States do NOT have disjoint VINs (a car can move between sister stores or states, a brand can be rerun the same day, a SOLD record can meet a live one), so overlap is handled, not assumed away.
- Identical records: nothing happens.
- Different records: exactly ONE stays in `dom_index.json`, chosen by score: live beats SOLD (+4), has a hash (+2), has a stored page (+1). Higher score is kept.
- **Equal score — for example two LIVE records with different prices from two stores, both with a stored page — the one with the larger canonical JSON text is kept. That is arbitrary.** It only makes the result independent of which process merges first. It does NOT mean that price is the true one; for such a VIN-date the index price may be either store's. The reason is recorded as `tie-canonical-arbitrary` so these are easy to find.
- **Both full records are written to `data/dom_index_conflicts/<day>-<pid>-<ms>-<n>.jsonl` and fsynced BEFORE the index is replaced.** One line per conflict: `{ at, mergedBy, vin, date, reason, kept, dropped, keptSource, droppedSource }` (`kept`/`dropped` are the complete records; sources are `index` or `delta:<state>/<brand>:<file>` / `orphan-delta:...`). One file per merge, so concurrent merges can never interleave lines. Nothing leaves the index without both records being durable.
- Anything that wants to know whether a VIN-date was contested, or needs the other store's price, must read those files; yesterday's lookup and DB rows use whatever the index kept. After a replay the same conflict can appear in a second file (duplicates are possible, losses are not).

## Evidence (Mac, node 22.14, `--max-old-space-size=3584`, limit 3632 MB; synthetic 480 MB / 204k-VIN / 2.45M vin-date index shaped like box1's)
`scripts/dom-index-merge-heaptest.mjs`: the process holds a loaded copy of the index, retained "crawler" allocations (millions of small objects) bring used heap to #719's guard threshold (limit - (1.25 x index + 256 MB) = 2776 MB) or beyond, the reference is dropped (no explicit gc, like production), then the merge runs with 3000 new VINs + 500 conflicting VIN-dates.

| merge | used heap when merge starts | peak used heap | headroom to 3632 MB | time |
|---|---|---|---|---|
| first design (load current file, merge in memory) | 2887 MB (at threshold) | 3284 MB | 348 MB | 14.4 s |
| same, +256 MB in-flight overshoot | 3038 MB | 3332 MB | 300 MB | 16.9 s |
| same, loaded index still referenced | 2886 MB | 3425 MB | 207 MB | 18.8 s |
| **streaming (this PR), at threshold** | 2886 MB | 2981 MB | **651 MB** | 11.6 s |
| streaming, +256 MB past threshold | 3037 MB | 3104 MB | 528 MB | 11.9 s |
| streaming, +500 MB past threshold | 3279 MB | 3399 MB | 233 MB | 15.8 s |
| streaming, 3.2 GB used | 3203 MB | 3280 MB | 352 MB | 15.7 s |
| streaming, no ballast (index only) | 654 MB | 811 MB | 2821 MB | 6.0 s |
The first design passed but left only 200-350 MB at the guard threshold, so the merge was rewritten to stream. The streaming merge itself adds roughly 70-120 MB of live data on top of whatever the process holds, and none of these runs aborted. Used heap includes garbage V8 has not collected yet. The time is mostly V8 working hard against a nearly full heap; the lock is held that long. Caveats: synthetic ballast, a Mac not the boxes, and one run each.
Tests: `test/dom_index_delta.test.js` (25) covers, among others, six real processes starting from the same stale index (control shows the old behaviour losing entries; the delta flow loses none and keeps both records of 20 contested VIN-dates), kills mid-checkpoint, kills before the index rename / after the rename before any delta is deleted / after the first of several deltas is deleted (replay checks that every record ever written is in the index or complete in a conflict file), PID reuse, claimed files, a streaming-vs-in-memory equivalence run on a random index with odd characters, duplicate keys, truncated and non-object indexes. `test/dom_index_delta_package.test.js` runs check/apply/restore on a fake box1 and box5 built from the real live files.

## Run it (from this directory; nothing is staged on the box)
```
ssh box1 'bash -s -- check' < install.sh     # read-only trial on copies in a mktemp dir
ssh box1 'bash -s -- apply' < install.sh     # ONLY on Paul's GO. Same for box5. Backup: ~/backups/dom-index-delta-20261106
ssh box1 'bash -s -- restore' < install.sh   # warns if unmerged delta files remain (they are safe on disk; do not delete them)
```
Pinned before-md5: box1 standalone.js f81fbd61…, box5 752cf191…; dom_store.js 541b78ff… (#720), heapGuard.js 452ce895… (#719), bigJson.js 650637d9…, shared_data_lock.js 218bd329…, pid_lock.js c5356386…; after-md5s are in `install.sh`. Refuses on any other md5, 21:30-07:00 ET, or a crawl/sync running. `install.sh` is generated by `build-install.py` from `install.template.sh`, the patches (made by `mkpatch.py` from the live files) and `src/dom_index_delta.js`; the package test fails if they drift.

## Remaining risks
- Heap: measured on synthetic ballast on a Mac; the real end-of-run heap on the boxes (and fragmentation) is unmeasured. 233-650 MB of headroom in the runs above.
- The lock is held for 6-16 s per merge at box1 size; 18 states finishing together queue (max wait 20 min, then the merge throws and the delta stays on disk for the next run).
- Contested VIN-dates keep one record by the rule above; the other lives only in the conflict files. The `dom_index_conflicts` and `dom_index_delta` directories are not pruned (small).
- A kill loses entries back to the last per-dealer checkpoint at worst, and only if the delta file was never merged.
- Not yet run on a box: the first real run is the first night after apply.
- Restore after nights of use leaves `delta-*` files on disk that are not in the index until the package is applied again.
