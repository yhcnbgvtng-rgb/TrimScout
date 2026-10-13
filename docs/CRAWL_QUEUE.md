# Crawl shard queue (2026-10-13)

Dynamic load balancing for the nightly crawl: instead of each box crawling a fixed list of states, every crawl box takes the next
**(state, brand) dealer shard** from a queue on box2, biggest first, until the queue is empty. box2 hosts the queue and receives the
syncs; it stops crawling.

**Status: code only.** Nothing here runs unless the per-box flag file says so, and no box has been changed. The flag is **off by
default**; with it off the fixed-state crons behave exactly as before, and rolling back is flipping it off.

## Why

Last week's real numbers (per-night run summaries on the four boxes, 2026-10-06 .. 2026-10-12): the fixed split leaves the boxes
unevenly loaded (box1 ~9 h, box2 ~8 h, box3/box4 ~7 h plus a core stage, and on 2026-10-11 box3 ran 23.4 h and box4 21.5 h). The
24 h SLA is only as good as the slowest box. A queue lets whichever box is free take the next shard, so the fleet finishes together.

## Design

| Piece | What it does | Where |
|---|---|---|
| Job table | `crawl_queue_jobs`, one row per (night, state, brand): estimate, heavy flag, status `queued/claimed/done/failed`, attempts, claimed-by, claim token, heartbeat, lease expiry, duration. Created on first use (`CREATE TABLE IF NOT EXISTS`). | box2 MariaDB, `src/crawlQueueServer.js` |
| Claim / lease / heartbeat | A claim is a lease (15 min). The worker renews it every 2 min. A lapsed lease puts the job back in the queue on the next claim call, remembering which box dropped it; **that box is not handed it again**. Results carry the claim token, so a zombie can neither complete nor fail someone else's claim. | `src/crawlQueueCore.js` (pure state machine, unit-tested) |
| Attempts | 2 per shard (first run + one retry on a different box). A crash, error or lapsed lease is retried; a shard **killed at the 2 h cap is not retried** (the same cap would burn another 2 h). Out of attempts = `failed`, visible in `status`. | core |
| 2 h kill | Unchanged: every 25-dealer chunk still runs under the driver's own `PER_BRAND_TIMEOUT_MS` via `runBrandSharded` / `runStep`. The queue changes who runs a shard, not how. | `scripts/run-crawl-queue.mjs` |
| Biggest first | `ORDER BY est_seconds DESC` among shards the claiming box may take. Estimates = median of the last 7 nights' ok runs (committed snapshot `config/crawl_queue_timings.json`, replaced per shard by the queue's own history once it has 2+ nights). | `src/crawlQueuePlan.js`, `crawlQueueSeed.js` |
| Worker | N slots per box (4; box1 2). Each loops claim -> run -> report. Heavy-heap shards (TX/FL etc.) limited per box (`maxHeavy`, reserved before the claim so slots can't race past it). Stops starting shards after the night budget (23 h from the night's first start). When only other boxes' jobs remain it waits 20 min for a dead peer's lease to lapse, then leaves so the box can sync. | `src/crawlQueueWorker.js` |
| Shared VIN cache | A shard may land on a box that never saw it, so its per-brand NHTSA cache is cold. Before a job the worker **pulls** other boxes' lookups (incremental byte offset per state) into `data/enriched_cache/<ST>.json`, the state-wide file **#496's top-up already reads**; after a job it **pushes** the lookups that appeared. Server keeps one append-only NDJSON file per state **on disk, not in MariaDB**, drops VINs it already has, serves one download at a time. #496's behaviour is untouched: the enricher is not modified. Best-effort: any failure leaves the job running exactly as today. | `src/vinCacheShared.js`, server half in `crawlQueueServer.js` |
| Sync: only finished shards | The worker records each shard it finished (server accepted the completion, crawl `ok`) in `data/crawl_queue/manifest-<night>.json`. The sync uploads **only** those files, never "every `*.json` in `data/inventory`" (the rule behind the 2026-10-03 stale-shard incident). No manifest, or a host box: exit 0, nothing synced. A manifest entry whose file is older than the job that wrote it is dropped. | `src/syncManifest.js` |
| Sync: taking turns + backpressure | The existing cross-box sync lock stays (one sync at a time, heartbeated, never auto-retried). New: box2 samples its own iowait/load every 5 s; the heavy calls (`bulk`, `sweep`, ...) and cache pushes wait while it reports `ok:false` (pause at 30 % iowait or load/cpu >= 3, resume below 18 %, so no flapping). Fails **open** if the endpoint is missing, and gives up waiting after 30 min rather than stalling a sync. | `src/crawlQueuePressure.js`, `/api/ops/sync-pressure` |
| Foreign-row grace | The sync's sweep leaves rows "another box wrote recently" alone (48 h). With shards moving between boxes that would keep a sold car live for two nights. In queue mode the grace is **since the queue night began**: rows another box wrote tonight stay protected (two brands of one rooftop synced by different boxes), last night's may be retired. | `src/syncManifest.js` |
| Flag | `<crawler>/data/crawl_queue/flag.json` `{enabled, box, role, slots, brandSets, maxHeavy, excludeStates}`. Missing / malformed / `enabled:false` = **off**. `CRAWL_QUEUE=0` forces off, `=1` forces on. `role:"host"` (box2): its cron-started crawl and sync exit immediately. | `src/crawlQueueFlag.js` |
| Hook | One block at the top of `run-daily-crawl.mjs main()`: if the flag module is absent or says off it falls straight through. Cron lines are not edited; the box-chain `run_nightly_chain.sh` calls the same driver twice and the second call finds the queue drained. | `scripts/run-daily-crawl.mjs` |

### Rules kept

* `DISABLE_FACET_REBUILD=1` stays: the installer refuses unless `deals-api` shows it before, and re-checks it after the one restart.
* Sync lock kept; heartbeats unchanged. **A crashed sync is never retried automatically**: nothing here wraps or loops the sync. A night with no manifest simply syncs nothing and is looked at by hand.
* No Cloudflare / Akamai / WAF bypass: every shard still goes through the detect-only bot-protection report (`dealer-bot-report.mjs --brand=`) and `standalone.js`'s own handling; a brand the report does not clear is skipped, exactly as in the fixed driver.
* A core job never inherits the expansion brand set from the cron's environment (that bug emptied the expansion dealer files once); every child process gets its brand set explicitly.

## Dry run

```
node scrapers/lightsail-crawler/scripts/crawl-queue-plan.mjs                      # default fleet box1 box3 box4
node scrapers/lightsail-crawler/scripts/crawl-queue-plan.mjs --boxes=box3:4,box4:4 --exclude-last-box=box1 --pct=75 --assignment
node scrapers/lightsail-crawler/scripts/crawl-queue-plan.mjs --history=<dir of box/summary_*.json> --export-timings=scrapers/lightsail-crawler/config/crawl_queue_timings.json
```

It reads files only. The simulation is the live policy (every free slot takes the longest remaining shard it may take), driven by
the 850 shards that ran last week and their median ok durations.

| Fleet | p50 (typical night) | p75 (slow night) |
|---|---|---|
| **Phase 1** — box3 x4 + box4 x4 slots; box1 stays on its fixed cron with its 13 states (672 shards) | **15.4 h** each | **19.8 h** each |
| Phase 2 — box1 (x2, core only) joins; all 850 shards | **14.1 h** each | **17.9 h** each |
| For comparison: today's four boxes, fixed split | 8.3 - 9.3 h per box | |

Both boxes finish within minutes of each other in the simulation (that is the point). Removing box2 from crawling costs wall-clock:
its 19 states were ~40 slot-hours a night, spread over fewer slots. Every scenario stays under the 24 h SLA, but a p75 night on the
two-box fleet leaves ~4 h of margin. Raising `slots` on box3/box4 (they have 4 vCPU / 15 GB) is the lever; measure before using it.

## Known limits (read before flipping the flag)

1. **box1 cannot join yet.** It has no per-brand shard code (#480: `brandSlug`, `legacyShardSplit.js`) and no `expansionDealerFiles.js`; box2 is in the same state. Queue jobs write per-brand shard files, so a box without that code would merge brands into one state file and the manifest could not tell them apart. The installer checks this and refuses `--workers box1,...`. Until #480 is deployed there (`docs/BRAND_SHARDS.md`, a separate gated deploy), box1 keeps its fixed cron for its 13 states and those states are **excluded from the queue** (`excludeStates`, identical on both workers). box1's sync is untouched.
2. **A shard that changes box starts cold.** Its snapshot, price history and enrichment cache live on the box that last crawled it. The shared VIN cache removes the NHTSA cost; price-drop detection, the price history and the crawl's first-seen date for that shard restart from the first sighting on the new box (the sync upserts the new box's `firstSeen` over the old one). The dry run shows roughly 70 % of shards move on a given night. Making the claim prefer a shard's last box when estimates are close is the obvious follow-up if this hurts.
3. **First night: cold VIN caches.** The shared cache starts empty, so the first queue night re-does lookups for every shard that lands on a box without it. Seed it first: the cutover plan runs a one-off low-rate seeding from box3/box4's existing per-brand cache files (`#496`'s fix bounds the damage if it is skipped; the 216k-lookup night was this exact failure).
4. **Timings are single-sample-ish and assume every slot is as fast as the night it was measured.** `--pct=75` and per-box `:speed` (`--boxes=box1:2:core:1.5`) show the sensitivity. Box4's core stage has only one night of history.
5. Skipped (`bot-report` not clear) and failed shards are not synced; the status endpoint lists failures. Partial-success shards are not synced either (conservative; the old behaviour synced them).
6. The queue's own history needs 2 nights per shard before it overrides the committed snapshot; refresh the snapshot weekly with `--history ... --export-timings`.
7. Brand shards of one state can now run at once on one box (the fixed driver ran one brand per state at a time). They take the existing per-state data lock in turn around their short read/write sections, so correctness is unchanged; contention on a big state's legacy file shows up as lock waits in the logs.
8. **A night where a box dies before its sync is looked at by hand — nothing retries it.** The shards that box finished are listed in its `manifest-<night>.json`; sync them once the cause is understood with `CRAWL_QUEUE_NIGHT=<night> CRAWL_QUEUE=1 TRIMSCOUT_BOX_LABEL=<box> node inventory-sync.mjs <crawler>/data/inventory --dry-run` first, then without `--dry-run`. Shards it had not finished are back in the queue (or `failed` in `status`) and are crawled by the next night as usual.
9. Admin "Box" column: rows keep the crawling box's label (`box3`/`box4`), so a shard's label changes when it moves.

## Wednesday 2026-10-14 cutover (every box step waits for GO typed by Paul)

All commands are `scripts/box/2026-10-14-crawl-queue-install.sh <command>` from Paul's Mac, clean checkout of main. Each mutating
command refuses without an interactive terminal and a typed `GO`; the read-only ones (`preflight`, `status`, `pilot-check`) don't need it.

1. **Morning** `preflight` (read-only, safe any time): idle check (no crawl, sync, sync lock or lock file), anchors still match the live files, what each box has.
2. **Once every sync from Tuesday night has landed** (`preflight` shows all four boxes idle and the sync lock free; it refuses otherwise) `install`: backs up every file it touches (`<file>.cq-bak.<stamp>` + `~/crawl-queue-install/<stamp>/manifest.json` with hashes), installs the code on box3, box4 and box2, **flag OFF everywhere**, restarts `deals-api` once on box2 (the only restart), checks `DISABLE_FACET_REBUILD=1` and that the queue routes answer.
3. **Afternoon** `pilot DE --box box3` (GO): a real crawl of every Delaware shard through the queue on box3 (own queue night `<date>-pilot`, 2 slots, the nightly untouched, flag still off). Then `pilot-check DE --box box3` (read-only): queue status, the manifest, and the sync's own `--dry-run` over exactly those shards. A real pilot sync is the same command without `--dry-run`, run by hand only if the dry run looks right.
4. **~21:00** `flag on` (GO): re-runs preflight, checks the API answers, then writes the flag on box3, box4 (workers) and box2 (host). Takes effect at the **22:00 ET** cron; no cron line is edited.
5. **22:00 - morning** watch with `status`; the first queue night is the real test. `rollback` (GO) flips the flag off everywhere; the next cron run is the fixed-state crawl. A crawl already running is not stopped by it.
6. `rollback --restore` additionally puts every backed-up file back (only files unchanged since the install) and restarts `deals-api`.

If the pilot or any preflight fails, the flag stays off and tonight is a normal fixed-state night.

## Files

`src/crawlQueue{Core,Flag,Plan,Client,Pressure,Seed,Worker,Server}.js`, `src/vinCacheShared.js`, `src/syncManifest.js`,
`scripts/run-crawl-queue.mjs` (worker, pilot, status), `scripts/crawl-queue-plan.mjs` (dry run), `config/crawl_queue_timings.json`
(last week's timings), `scripts/box/2026-10-14-crawl-queue-{install.sh,patch.mjs,anchors.json}` (installer, anchored patcher, the six anchors), tests `test/crawl_queue_*.test.js`, `test/vin_cache_shared.test.js`, `scripts/box/crawl-queue-install.test.mjs`.
