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
2. At the end of the run, `mergeDomDelta` writes a final checkpoint and runs the merge in a worker process that holds the **kernel flock** (see "The merge lock" below; max wait 20 min). In the worker: orphaned deltas are CLAIMED by an atomic rename to `claimed-<mergerPid>-...` (so a delta its owner rewrote can never be deleted unmerged), then the current index is STREAMED through the merge into `dom_index.json.tmp-<pid>-<ms>`, one VIN at a time (untouched VINs are copied verbatim, every VIN is validated as JSON), the temp file is read back and checked (entry count), and only then renamed over the index.
3. Order of durability: (a) both full records of every conflict are written and fsynced to a conflict file, (b) the index is renamed, (c) the delta/claimed files are deleted. A failure or kill anywhere before (b) leaves the index byte-identical and every delta on disk; a kill between (b) and (c) just replays the same deltas (identical records are no-ops).
4. An unreadable or malformed existing index makes the merge throw (`DomIndexUnreadableError`), exactly as the load does after #720: nothing is written, deltas stay.
5. **Who owns a file is decided by process identity, never by age** (`judgeOwner`). The owner's pid, **process start identity** (Linux: `starttime`, field 22 of `/proc/<pid>/stat`) and **boot identity** (`/proc/sys/kernel/random/boot_id`) are in the delta's file name; a claim file carries the identity of the MERGER that made it. Verdicts:
   - `dead`: the pid is not running -> claimable.
   - `reused`: the pid is running but is not the recorded process (different start identity: genuine PID reuse), or the recorded boot identity differs from this boot (restarted machine) -> claimable.
   - `alive`: the pid is running AND start and boot identity match -> **never touched, however old the file is** (the old 6-hour heartbeat rule is gone; so is the mtime heartbeat).
   - `uncertain`: nothing recorded for a running pid (files from older builds), start identity unreadable, boot identity unknown -> **left untouched and reported** in the merge's log line (`NOT TOUCHED, owner identity uncertain: ...`) and in the result's `uncertain` list. It is never guessed at; a human or a later run with a decidable owner deals with it.
   A merger's own claim files are skipped; a dead or reused merger's claims are taken over; a live merger's claims are left alone. A file claimed by mistake would still be harmless (records are idempotent and the owner merges its in-memory delta at the end), but the claim now only happens when the owner is provably gone.

## The merge lock: a kernel flock held by the merge worker
Three designs were looked at; the first two are rejected with evidence.

1. **`shared_data_lock.js`** (what the first #721 build used). Probed with real processes (`scripts/dom-index-lock-probe.mjs`): a live holder's lock was TAKEN once it was older than the stale limit (two holders); a dead owner whose pid is now another live process stalls everyone; its release checks the pid only, so a former holder's late release DELETED a replacement's lock; reclaim reads the lock and then removes the path, so it can delete a fresh lock created in between.
2. **A hard-linked token file with identity-judged takeover** (no age rule, token-checked release, `assertHeld()` before the index rename). Its age/pid-reuse/late-release cases passed, but a deterministic three-process replay (`scripts/dom-index-lock-takeover-demo.mjs`, frozen copy of that code in `scripts/legacy/`) broke it: a contender C1 judges a dead lock and pauses before renaming it; the live holder H takes the lock, streams its merge, passes `assertHeld()` and pauses before the index rename; C1 resumes and renames the path aside, which moves **H's live lock**; a third process C3 finds the empty path, takes the lock, merges and commits; H resumes and renames its merge over C3's commit. Output:
```
H   holds the lock from +0 ms until its commit at +45 ms (it passed assertHeld at the start of that window)
C3  acquired the lock at +40 ms and committed at +41 ms
critical sections overlap: YES - two mergers committed concurrently
final index keys: BASE, H  ->  C3 RECORD LOST (overwritten by H)
```
   Two mergers committed concurrently and C3's record was lost. Any scheme in which one process decides "that lock is stale, remove it" and a second step acts on the decision has this window, and adding another check before the rename only narrows it.
3. **Kernel flock (this PR).** The merge runs in a short-lived worker process started as `flock -x -F -E 200 -w <secs> data/locks/dom-index.merge.flock node --max-old-space-size=1024 dom_index_delta.js --merge-worker '<json>'`. `flock(1)` takes the lock and then EXECS the worker (`-F`/`--no-fork`: without it flock forks and its parent keeps the descriptor, so the lock would outlive a killed worker for as long as that parent lives; CI on Linux caught exactly that before `-F` was added), which inherits the locked descriptor: the process that streams the index and renames it over `dom_index.json` IS the lock holder. The kernel drops the lock when that process exits or is killed, for any reason, at that instant. So:
   - no lock contents, no staleness, no age, no pid or identity judgement, no takeover, nothing to remove: the sequence above cannot happen because there is no step at which a lock can be taken from a live holder (a stopped or hung holder keeps it; a dead one cannot commit any more);
   - contenders wait inside `flock(1)` for at most `maxWaitMs` (20 min) and then give up with exit 200; their deltas stay on disk for the next run;
   - the crawler process only waits for the worker; the merge's memory is out of the crawler heap (measured below);
   - if the crawler process is killed while its worker holds the lock, the worker finishes the merge by itself and releases the lock; if the worker is killed, the lock is freed at once, the index is untouched or complete, and the delta is merged by the next merger (its owner is gone);
   - the worker refuses to merge a delta file that does not contain the number of VIN-dates its owner wrote (fail closed);
   - identity of delta OWNERS (pid + start + boot) is still used, but only to decide which orphaned delta files may be claimed, never to decide who holds the lock.
   Requirements and limits: util-linux `flock(1)` (2.39.3 on box1/box5) or python3 with `fcntl` (used automatically where flock(1) is missing, e.g. macOS dev machines; both take the same kernel lock, tested against each other); a local filesystem (ext4 on both boxes). **`data/locks/dom-index.merge.flock` must never be deleted or replaced while a merge can run** (nothing in this code does; a new inode would be a different lock). If neither launcher exists the merge refuses (nothing changed, delta kept) instead of running unlocked. Test scaffolding: `DOM_INDEX_MERGE_PAUSE_DIR` + `DOM_INDEX_MERGE_PAUSE_POINTS` make the worker freeze at a named point; inert unless both are set (they are not in any cron line).
Tests (`test/dom_index_lock.test.js`, 7, real processes, deterministic pauses): the scenario above replayed against the flock (holder frozen after streaming and before the rename, lock file artificially 30 days old; a stale-lock contender and a third contender both time out; the index is byte-identical meanwhile; after the holder commits they go through one after the other; all four records present; critical sections disjoint); a holder stopped with SIGSTOP keeps the lock, commits after SIGCONT; the worker killed at the same point frees the lock at once and the next merger also merges the dead one's delta; the crawler killed while its worker holds the lock, the worker finishes alone; 8 processes merging at the same instant (all succeed, every record present, sections never overlap); the lock file keeps its inode; python3 launcher and flock(1) exclude each other. Starting the worker without the flock makes the exclusion tests fail (checked).

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
The first design passed but left only 200-350 MB at the guard threshold, so the merge was rewritten to stream. **Since the flock change the merge runs in its own worker process**, so the crawler's heap does not move at all while it waits (re-measured with the same script, merge in the worker): crawler peak used heap 2890 MB while it was 2887 MB before the merge (headroom 742 MB, unchanged), and 3281 MB vs 3279 MB at +500 MB past the threshold; the worker's peak RSS was 133-141 MB; the merge took 6.5 s with an empty-ish heap and 10.6-16.6 s against a nearly full crawler heap (CPU contention and the worker's spawn, not memory). Used heap includes garbage V8 has not collected yet. Caveats: synthetic ballast, a Mac not the boxes, one run each.
Tests: `test/dom_index_delta.test.js` (33) covers, among others, six real processes starting from the same stale index (control shows the old behaviour losing entries; the delta flow loses none and keeps both records of 20 contested VIN-dates), kills mid-checkpoint, kills before the index rename / after the rename before any delta is deleted / after the first of several deltas is deleted (replay checks that every record ever written is in the index or complete in a conflict file), a real owner process kept alive with a 30-day-old checkpoint while a second real process runs recovery attempts and the owner checkpoints 100 more times (its delta is never claimed or deleted, nothing merged early, nothing lost, then the same owner killed -> exactly one claim and a complete merge), genuine PID reuse and reboot cases, uncertain identity, dead/reused/live/uncertain merger claims, a streaming-vs-in-memory equivalence run on a random index with odd characters, duplicate keys, truncated and non-object indexes. `test/dom_index_delta_package.test.js` runs check/apply/restore on a fake box1 and box5 built from the real live files.

## Run it (from this directory; nothing is staged on the box)
```
ssh box1 'bash -s -- check' < install.sh     # read-only trial on copies in a mktemp dir
ssh box1 'bash -s -- apply' < install.sh     # ONLY on Paul's GO. Same for box5. Backup: ~/backups/dom-index-delta-20261106
ssh box1 'bash -s -- restore' < install.sh   # warns if unmerged delta files remain (they are safe on disk; do not delete them)
```
Pinned before-md5: box1 standalone.js f81fbd61…, box5 752cf191…; dom_store.js 541b78ff… (#720), heapGuard.js 452ce895… (#719), bigJson.js 650637d9…, shared_data_lock.js 218bd329…, pid_lock.js c5356386…; after-md5s are in `install.sh`. Refuses on any other md5, 21:30-07:00 ET, or a crawl/sync running. `install.sh` is generated by `build-install.py` from `install.template.sh`, the patches (made by `mkpatch.py` from the live files) and `src/dom_index_delta.js`; the package test fails if they drift.

## Remaining risks
- Heap: the merge no longer runs in the crawler process (worker ~140 MB RSS), so the crawler's end-of-run heap is not affected by it; the worker's footprint on the boxes is measured only on a Mac with a synthetic index.
- Each merge starts `flock` + a node worker (about 0.3 s of startup); a box needs `flock(1)` or python3 (both present on box1/box5).
- The lock is held for 6-16 s per merge at box1 size; 18 states finishing together queue (max wait 20 min, then the merge throws and the delta stays on disk for the next run). A hung but alive worker blocks everyone until it ends (nothing is ever taken from a live holder).
- Contested VIN-dates keep one record by the rule above; the other lives only in the conflict files. The `dom_index_conflicts` and `dom_index_delta` directories are not pruned (small).
- A kill loses entries back to the last per-dealer checkpoint at worst, and only if the delta file was never merged.
- Identity needs `/proc` (Ubuntu boxes have it; verified on box1: boot_id and starttime readable). A pid that cannot be read is `uncertain`, so the worst case is an orphan delta that stays on disk and is reported, not a lost or wrongly merged one. Real PID wraparound cannot be forced in a test; the tests use a REAL running process whose pid appears in a file written by a "predecessor" (different start identity), which is exactly what reuse looks like.
- `shared_data_lock.js` (not changed, not used by the new merge) keeps its age rule for the other data files it guards; not in scope here.
- Not yet run on a box: the first real run is the first night after apply.
- Restore after nights of use leaves `delta-*` files on disk that are not in the index until the package is applied again.
