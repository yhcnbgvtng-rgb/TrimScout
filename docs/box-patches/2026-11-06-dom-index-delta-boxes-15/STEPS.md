# dom_index delta merge for box1 (v2) and box5 (PR #721) — code only until Paul's GO

Fixes the outstanding lost-update race documented in `../2026-11-06-dom-index-save-boxes-15/STEPS.md` (#720 installed on box1/box5 2026-11-06 ~16:31 ET fixed the string limit
and the shared `.tmp` name, not this). Brand processes (2 on box1, 8 on box5) share `data/dom_index.json`; each used to save its own stale copy after every dealer.

## What changes (2 files, nothing else)
- `src/dom_index_delta.js` — NEW.
- `src/standalone.js` — patched (zero fuzz) against the live post-#719 file of each box; box1 and box5 differ, so there are two patches (`standalone.js.b1.patch`, `standalone.js.b5.patch`).
  Per-dealer `saveDomIndex(domIndex)` becomes a delta checkpoint; the loaded index is read-only; at the end of the run the delta is merged under the lock; today's DB rows come from the delta.
Not touched: `dom_store.js` (#720), `bigJson.js`, `heapGuard.js` (#719), `shared_data_lock.js` (still used by the rest of standalone.js, unchanged), `pid_lock.js`, `run-daily-crawl.mjs`, `data/`, crontab, env, heap size.

## How a merge works (src/dom_index_delta.js)
1. Each process records only the VIN-dates it wrote. After every dealer the delta is checkpointed to `data/dom_index_delta/delta-<pid>-<startMs>-<startIdentity>-<bootIdentity>.json` (temp name + fsync + rename: a kill leaves the previous complete checkpoint; the half-written temp can never match the delta name). An unchanged delta is not rewritten unless its file has gone.
2. At the end of the run, under the **dom-index merge lock** (`data/locks/dom-index.merge.lock`, see "The merge lock" below; max wait 20 min): orphaned deltas are CLAIMED by an atomic rename to `claimed-<mergerPid>-...` (so a delta its owner rewrote can never be deleted unmerged), then the current index is STREAMED through the merge into `dom_index.json.tmp-<pid>-<ms>`, one VIN at a time (untouched VINs are copied verbatim, every VIN is validated as JSON), the temp file is read back and checked (entry count), and only then renamed over the index.
3. Order of durability: (a) both full records of every conflict are written and fsynced to a conflict file, (b) the index is renamed, (c) the delta/claimed files are deleted. A failure or kill anywhere before (b) leaves the index byte-identical and every delta on disk; a kill between (b) and (c) just replays the same deltas (identical records are no-ops).
4. An unreadable or malformed existing index makes the merge throw (`DomIndexUnreadableError`), exactly as the load does after #720: nothing is written, deltas stay.
5. **Who owns a file is decided by process identity, never by age** (`judgeOwner`). The owner's pid, **process start identity** (Linux: `starttime`, field 22 of `/proc/<pid>/stat`) and **boot identity** (`/proc/sys/kernel/random/boot_id`) are in the delta's file name; a claim file carries the identity of the MERGER that made it. Verdicts:
   - `dead`: the pid is not running -> claimable.
   - `reused`: the pid is running but is not the recorded process (different start identity: genuine PID reuse), or the recorded boot identity differs from this boot (restarted machine) -> claimable.
   - `alive`: the pid is running AND start and boot identity match -> **never touched, however old the file is** (the old 6-hour heartbeat rule is gone; so is the mtime heartbeat).
   - `uncertain`: nothing recorded for a running pid (files from older builds), start identity unreadable, boot identity unknown -> **left untouched and reported** in the merge's log line (`NOT TOUCHED, owner identity uncertain: ...`) and in the result's `uncertain` list. It is never guessed at; a human or a later run with a decidable owner deals with it.
   A merger's own claim files are skipped; a dead or reused merger's claims are taken over; a live merger's claims are left alone. A file claimed by mistake would still be harmless (records are idempotent and the owner merges its in-memory delta at the end), but the claim now only happens when the owner is provably gone.

## The merge lock (why it is not `shared_data_lock.js`)
`shared_data_lock.js` was inspected line by line and probed with real processes (`scripts/dom-index-lock-probe.mjs`, output below). Its behavior:
- **A live holder's lock is taken once it is `staleAfterMs` (10 min) old.** Probe: holder alive, lock 2.6 s old with the limit shortened to 2 s -> a contender TOOK THE LOCK while the holder still believed it held it (two holders). A merge is seconds normally, but nothing in that lock lets a slow one (swap, disk stall, a long queue behind a big index) keep it.
- Ownership is the **pid alone**: a dead owner whose pid is now another live process is not reclaimed until the 10-minute age (probe: contender gave up after 4 s; by default it waits up to 5 min and throws).
- `reclaimIfStale` reads the lock, decides, then removes the PATH, and `release` reads the pid then removes the path: between the read and the remove another process can reclaim and create a fresh lock, and the remove deletes THAT. The release check is pid-only, so a former holder with the same pid deletes a replacement's lock (probe (3): the replacement's lock WAS DELETED).
So it was not safe for the dom-index merge. Other callers keep using it unchanged (not touched here, so their pins stay).
The dom-index merge lock (`acquireDomIndexLock` in `dom_index_delta.js`):
- created by hard-linking a fully written file (random 128-bit token, pid, start identity, boot identity, label) onto the lock path: atomic and never visible half-written;
- **taken over only from a dead holder or a reused pid** (same `judgeOwner` identity rule as the deltas). **No age rule at all**: a live holder keeps the lock however long the merge takes; contenders wait up to `maxWaitMs` (20 min) and then throw, naming the holder and verdict (their deltas stay on disk for the next run). An **uncertain** holder (identity not recorded, unreadable lock file) is waited for, never broken;
- a dead holder's lock is broken by renaming the path aside and checking the **token of what actually moved**; if the race moved a different lock it is linked straight back;
- **released only with its own token**: a former holder's late release deletes nothing of a replacement's;
- `lock.assertHeld()` is checked immediately before the index rename (the only step that changes the index): a merger whose lock was taken from it throws `DomLockLostError` and leaves the index untouched and every delta on disk.
Residual window, stated plainly: release reads the token and then removes the path. That can only hurt if a LIVE holder's lock is removed by something outside this protocol in those microseconds; inside the protocol a live holder's lock is never removed. Hung-but-alive holder: everyone else times out after 20 min and retries next run (a stuck process is a human problem; nothing is stolen).
Tests (`test/dom_index_lock.test.js`, 10, real processes): a live holder with a lock artificially 30 days old (startedAt and mtime) cannot be taken by three real contenders plus this process, then releases normally; a waiter waits for a holder and takes the lock only after release; a SIGKILLed holder is replaced at once; pid reuse (different start identity) and reboot (different boot identity) are replaced at once, the real identical process never, uncertain and unreadable never; 8 real processes acquiring together (also all racing to break one dead holder's lock): never two inside, no lost read-modify-write, no leftovers; `breakDomLock` that grabbed the wrong lock puts it back; a former owner's late `assertHeld` fails and its late release deletes nothing of the replacement's; a merge whose lock is taken before the commit abandons (index byte-identical, delta kept, the new holder's lock untouched). Re-introducing the age rule, or releasing without the token check, makes these fail (checked).

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
Tests: `test/dom_index_delta.test.js` (32) covers, among others, six real processes starting from the same stale index (control shows the old behaviour losing entries; the delta flow loses none and keeps both records of 20 contested VIN-dates), kills mid-checkpoint, kills before the index rename / after the rename before any delta is deleted / after the first of several deltas is deleted (replay checks that every record ever written is in the index or complete in a conflict file), a real owner process kept alive with a 30-day-old checkpoint while a second real process runs recovery attempts and the owner checkpoints 100 more times (its delta is never claimed or deleted, nothing merged early, nothing lost, then the same owner killed -> exactly one claim and a complete merge), genuine PID reuse and reboot cases, uncertain identity, dead/reused/live/uncertain merger claims, a streaming-vs-in-memory equivalence run on a random index with odd characters, duplicate keys, truncated and non-object indexes. `test/dom_index_delta_package.test.js` runs check/apply/restore on a fake box1 and box5 built from the real live files.

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
- Identity needs `/proc` (Ubuntu boxes have it; verified on box1: boot_id and starttime readable). A pid that cannot be read is `uncertain`, so the worst case is an orphan delta that stays on disk and is reported, not a lost or wrongly merged one. Real PID wraparound cannot be forced in a test; the tests use a REAL running process whose pid appears in a file written by a "predecessor" (different start identity), which is exactly what reuse looks like.
- `shared_data_lock.js` (not changed, not used by the new merge) keeps its age rule for the other data files it guards; not in scope here.
- Not yet run on a box: the first real run is the first night after apply.
- Restore after nights of use leaves `delta-*` files on disk that are not in the index until the package is applied again.
