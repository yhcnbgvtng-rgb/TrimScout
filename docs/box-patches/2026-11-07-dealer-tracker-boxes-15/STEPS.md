# Per-dealer crawl performance tracker for box1 (v2) and box5: code only until Paul's GO

Answers "which dealers are slow, which end partial, and why" for the nightly crawl. Nothing like it existed (searched repo, docs, branches, PRs, stashes, session transcripts 2026-11-07).
Changes **2 files** per box and nothing else: `src/dealerTracker.js` (new, node built-ins only) and `src/standalone.js` (14 hooks). The same hooks are in the repo's `src/standalone.js`.
Not touched: `heapGuard.js` (#719), `dom_store.js` (#720), `dom_index_delta.js` (#721), `bigJson.js` (#726 may or may not be installed, both fine), `data/` (the tracker only creates `data/dealer_tracker/`), crontab, env, heap size, any log line.

## What is written
`data/dealer_tracker/crawl-<run date>.jsonl`, one file per run date, shared by every crawl process on the box (8 on box5, 2 on box1). Per dealer ATTEMPT (a sitemap-retry pass is a separate attempt):

| record | when | use |
|---|---|---|
| `run_start` | process start | box (the machine hostname, e.g. `ip-172-26-13-207`; the summary shows box1..box5), state, brand, dealer count, node, heap limit, page workers |
| `begin` | attempt starts | an attempt with a `begin` and **no `end`** was interrupted (OOM abort, SIGKILL, crash, power loss) |
| `end` | attempt finishes by any route | everything below |
| `run_end` | dealer loop finished | a run with no `run_end` did not finish (or is still running) |

`end` fields: `run, attempt, pid, box, state, brand, dealer{id,key,name,city,state,domain}, retry, index, total, startedAt, endedAt, durationMs, msToDiscovery`,
`urls{discovered, attempted, succeeded, blocked, skippedVdp, errored}`, `vins`, `errors{exception, urlErrors, errorName, errorMessage}`,
`blocking{pageBlocked, blockClass, wall{cls,status}, probeClass, probeHttpStatus}`, `status` (`complete | partial | skipped | failed | incomplete`), `reason`, `degraded[]`,
`discoveryOutcome`, `browserFallback` (box5's patchright context existed), `countedAsFailedStore` (the crawl's own `failedDealerNames` verdict: excluded from sold-diff and sweep), `heapStop{usedMb,limitMb,stopAtMb}`, `mem`.

Reasons: `probe_skip`, `wall_sitemap`, `wall_mid_crawl`, `no_inventory_urls`, `discovery_failed`, `timeout_1h`, `timeout_before_extract`, `heap_stop`, `exception`, `all_pages_blocked`, `all_pages_skipped_vdp`, `no_vehicles_extracted`, `stopped_early_unknown`; `incomplete` + `process_exit` / `next_attempt_started` / `loop_finished_with_open_attempt` for attempts left open.
`degraded` on a `complete` attempt: `pages_blocked`, `vdp_skipped`, `url_errors` (some pages lost, store still counted as done: that is what the crawl itself does).

**Unavailable is null, never 0**: `discovered` is null when discovery never ran or failed; `msToDiscovery`, `browserFallback`, `countedAsFailedStore`, `probeClass` are null when not observed.
**Memory**: `mem.process` is whole-process (RSS, used heap at start/end, heap limit, sampled peaks, lifetime peak RSS, host free memory); V8 cannot attribute memory to a dealer, so `mem.dealerAttributable` is always **null**.
`mem.dealerEstimate.heapUsedDeltaMb` = used heap at end minus start (dealers run one at a time in a process), flagged `exact:false`: it includes GC timing and what the dealer left retained. Peaks are sampled at most every 2 s on URL starts, not continuously.
**Not recorded**: page bodies, vehicle-page URLs, headers, cookies, env values, credentials, buyer data. Error messages: URLs and paths removed, 160 chars.

## Safety properties (tested)
- Observes only. Every hook is an inserted line except one: extractOne's swallow-all `} catch {}` becomes `} catch { dealerTrack.urlError(); }`. The package refuses unless the patch removes exactly 1 line and the patched file differs from the original in exactly 1 existing line.
- Never throws: each method has its own try/catch; the context passed to `end()`/`endProbeSkip()`/`noUrls()` is a thunk evaluated inside it (a bad identifier cannot throw into the crawl). No timers, no `await`, no stdout (existing log formats unchanged: a local run printed byte-identical stdout with the original, tracker off, and tracker on).
- Write failures: counted, one stderr line, tracker stops after 3 consecutive failures; start-up failure returns a no-op tracker.
- Concurrency: one `appendFileSync` (O_APPEND, one write(2)) per record, each < 4 KB: 8 concurrent processes tested, no torn or lost lines.
- Crash: SIGKILL leaves `begin` with no `end`; a clean exit (incl. uncaught exception) with an attempt open writes `incomplete/process_exit`.
- Kill switch: `CRAWLER_DEALER_TRACKER=off`.

## Overhead, retention, and the shared file under load
Measured (Mac, node 22, 5,000 attempts x 200 URLs): 0.03 us per URL (about 32 ms per million URLs), 57 us per attempt (2 appends), 1.9 KB per attempt on disk (9.4 MB for 5,000 attempts). Disk on box5 on 2026-11-07: 600 GB free.

**Cleanup (14 days).** At start-up each process deletes `crawl-YYYY-MM-DD.jsonl` files in its own directory whose date is older than `CRAWLER_DEALER_TRACKER_RETAIN_DAYS` (default 14), counted back from the EARLIER of its run date and today. It never deletes: a file written to in the last 48 h (an active file, even one with an old date, e.g. a replayed run), its own file, or anything outside that directory or not matching the exact name pattern. Even if a file were deleted under a writer, each append reopens the path (`O_APPEND|O_CREAT`) and recreates the directory once on ENOENT: the writer keeps going, nothing throws.
**Size cap (64 MB per day file, `CRAWLER_DEALER_TRACKER_MAX_FILE_MB`).** Other processes write the same file, so the size is re-read every 20 appends. At the cap a process writes ONE `logging_stopped` marker (`reason: size_cap`, file size, cap, attempts it had logged, open attempt id) and stops adding `begin`/`run_start`/`run_end` records. The attempt it has open still gets its `end` record. So a capped log never leaves a finished dealer looking interrupted, and never contains an `end` without its `begin`. Overshoot is bounded by writers x 20 appends x < 4 KB (about 640 KB for 8 writers) plus one marker per process.
**Torn records.** Records are framed `"\n<json>\n"`: if a writer dies mid-record (ENOSPC), the next record starts on its own line; a torn record costs only itself. Readers skip and count malformed lines (the summary prints the count).
**Write failures.** A failed append is counted; after 3 in a row the process stops writing (a marker with `reason: write_failures` is attempted, and will usually fail too), prints one `[dealer-tracker]` line on stderr, and the crawl carries on. In that case there is NO marker in the file, so the last dealer may read as interrupted: the stderr line in the crawl's log is the evidence.

**Telling "logging stopped" from "interrupted"** (the summary does this; `--json` has both lists):

| in the file | meaning | summary |
|---|---|---|
| `begin`, no `end`, no `logging_stopped` for that run | the process died mid-attempt (OOM abort, SIGKILL, crash) or is still running | "Interrupted attempts" |
| `begin`, no `end`, and the run ALSO has `logging_stopped` | still a genuine interruption: after a cap stop the open attempt always gets its `end`, so a missing one means the process died | "Interrupted attempts" |
| `logging_stopped` record | writing stopped (cap or failures); later dealers of that run are simply absent | "LOGGING STOPPED ... INCOMPLETE" with logged vs run total and `>= N missing` |
| run with no `run_end` | loop did not finish, or the cap stopped writing (check for `logging_stopped`), or still running | "Runs with no run_end" |

Not-complete rates on a day with a stop cover only the logged part of those runs; the summary says so at the top.

## Reading it
```
cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler
node scripts/dealer-tracker-summary.mjs --box box5 --top 25        # newest day; also --date, --days N, --state TX, --brand Infiniti, --json, --file
```
(`scripts/dealer-tracker-summary.mjs` is not in this install, which changes two files only: copy it to a laptop with the day file, or run it from a checkout. It reads files only.) Shows: not-complete rate and reasons, slowest dealers (time, urls found/tried/blocked, vins, peak RSS, heap delta), interrupted attempts, heap stops, not-complete rate by box/state/brand.

## Could it explain box5's high partial-store rate?
It will split box5's partial/skipped/failed stores by cause per dealer: heap stop vs wall vs 1-hour timeout vs discovery failure vs no vehicles vs exceptions, with duration, URLs tried, peak memory and `countedAsFailedStore`, and show attempts killed outright (OOM abort). It cannot say anything about nights before it is installed, and it does not by itself say WHY a wall happened or a heap filled. First data: the first crawl after install (22:00 ET).

## Coverage limits
- box1 and box5 only (pins are those two boxes' post-#721 `standalone.js`). box2/3/4 run different files; a package for them would need their md5s.
- Per dealer, not per URL: no per-request timing. `msToDiscovery` lumps the bot probe, contact-email collection and sitemap discovery; extraction time is the rest.
- `urls.succeeded` = attempted minus blocked, skipped-VDP and errored; a fetched page with no vehicle on it counts as succeeded (compare with `vins`). `errored` also counts an error after a vehicle was stored (rare).
- A heap/OOM kill shows only as a missing `end`; the cause must come from the box log (`Last few GCs`). A `heap_stop` (the #719 guard) is recorded with its snapshot.
- Not covered: the end-of-run phases (delta merge, enrichment, inventory sync) and the sweep itself.
- Dealer files without an `id` give `dealer.id` null; `dealer.key` then falls back to domain, then name|city|state.

## Install order with #726 (bigJson)
#726's package pins this `standalone.js` md5 (post-#721) and **refuses once this package has changed it**. This package accepts bigJson.js in either state. So: install #726 first, then this; if this goes first, #726's `check` refuses until its two standalone.js pins are extended to the "after" md5s printed by `build-install.py`.

## Steps (all need Paul's separate GO; none done)
1. Between 07:00 and 21:30 ET, no crawl or sync running (the script refuses otherwise). Optional: `ssh box1 'bash -s -- check' < install.sh`, same for box5 (read-only; run 2026-11-07 for this PR, see PR).
2. `ssh box1 'bash -s -- apply' < install.sh`, then `ssh box5 'bash -s -- apply' < install.sh`. Backup in `/home/ubuntu/backups/dealer-tracker-20261107`. No restart, no cron or env change.
3. After the first 22:00 crawl: `ls -la data/dealer_tracker`, run the summary, confirm the crawl logs and `[mem]` lines look as before.
4. Roll back: `ssh <box> 'bash -s -- restore' < install.sh` (puts the original `standalone.js` back, removes `dealerTracker.js`; records stay).
