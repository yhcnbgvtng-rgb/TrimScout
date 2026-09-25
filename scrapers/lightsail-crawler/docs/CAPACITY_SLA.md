# Crawler fleet capacity SLA (2026-09-21)

Hard SLA: each Lightsail box must finish its assigned daily shard in
**≤24 hours wall-clock**. This document is the written capacity math
behind the current shard map — re-derive it with
`scripts/recommend-shard-split.mjs` whenever the dealer list grows enough
to matter, rather than re-deriving it by hand.

## Measured rate (real data, not estimated)

23 real per-brand crawl durations sampled 2026-09-21 across WY/core,
HI/core, TX/expansion, CA/expansion runs:

| | Value |
|---|---|
| p50 seconds/rooftop | 41.2s |
| p90 seconds/rooftop | 93.2s |

Small sample — real production data, but worth re-measuring with more
samples over time. Both constants are env-overridable
(`CRAWLER_P50_SEC_PER_ROOFTOP`, `CRAWLER_P90_SEC_PER_ROOFTOP`) in
`src/capacity.js` so a future remeasurement doesn't need a code change.

Projected hours = `rooftops * seconds_per_rooftop / 3600 / concurrency`.

## Current shard map and compliance (p90, real rooftop counts)

| Box | Brand set | Concurrency | States | Rooftops | Projected p90 | Margin to 24h |
|---|---|---|---|---|---|---|
| Box 1 | core (18 brands) | 2 | 16 | 1,238 | 16.0h | 8.0h |
| Box 2 | core (18 brands) | 4 | 32 | 3,092 | 20.0h | 4.0h |
| Box 3 | expansion (7 brands) | 4 | 11 | 3,675 | 23.8h | **~0.2h — very thin** |
| Box 4 | expansion (7 brands) | 4 | 12 | 3,672 | 23.8h | **~0.2h — very thin** |

**Every box projects within the 24h hard SLA at p90.** Box 3/Box 4 have
almost no margin — a real slow night could tip them over. The preflight
check (`checkProjectedRuntime` in `scripts/run-daily-crawl.mjs`) refuses
to start a run that's predicted to exceed the SLA rather than silently
running over, so the failure mode if the measured rate drifts worse is
"tonight's run doesn't start" (loud, visible in the log), not "runs past
24h unnoticed."

## Expansion backlog — 27 states deferred, not covered nightly

Two 4-vCPU boxes cannot fit all 50 states' expansion-brand workload
within 24h at the measured p90 rate (total demand ~9,451 rooftops vs.
~7,416 rooftops of combined 24h capacity at this concurrency — a ~22%
shortfall). Rather than add boxes, the smallest-rooftop states were
deferred to a backlog, keeping every high-volume state (TX, CA, FL, PA,
IL, MI, IN, NJ, OH, etc.) in nightly coverage:

```
HI(15) AK(17) RI(21) DE(38) WY(41) NV(44) VT(45) ND(56) NM(60) MT(63)
ID(65) NH(65) SD(67) WV(70) ME(75) UT(85) OR(96) MS(98) NE(101) CT(108)
SC(117) AZ(119) CO(122) KS(122) MD(123) WA(130) AR(141)
```

These states' expansion-brand dealer files remain materialized on disk
(untouched) — deferring is a crontab exclusion, not data loss. Re-run
`scripts/recommend-shard-split.mjs --brand-set=expansion --boxes=2
--concurrency=4,4` after adding a box (or after this backlog itself grows
large enough to justify one) to get a fresh, real split covering them.

## Two side-jobs (core brands, box 3/box 4)

Box 3 and box 4 each also run one small core-brand state at 4am ET
(`CRAWLER_RUN_LABEL=core`, its own lock file so it never collides with
the 11pm expansion job): RI on box 3, VT on box 4 — states moved off
box 1 to lighten its load. Negligible rooftop count; not counted against
the expansion SLA above since it's a different brand set entirely.

## Daily box performance

Separate from this document's capacity math, every driver run now writes an
**ops SLA report** — this is *not* the AI Analytics system (inventory/DOM
product metrics); it only reports on the crawl operation itself: did it
finish on time, how fast was it, how much bot-blocking did it hit.

### Where to look each morning

1. **Per box**: `data/runs/<date>/<runLabel>/box-report.{json,html}` on
   that box (`runLabel` is `expansion` or `core` — box3/box4 write both,
   one per side-job). Open the `.html` for a quick read, or `.json` for
   scripting. A report is written even when the run hit its time budget
   or crashed mid-run — a missing report means the driver never even
   started (lock contention, or the box itself is down), not that
   everything was fine.
2. **Fleet-wide**: from your own machine (never from a box, and not on a
   cron), run:
   ```
   npm run fleet-report
   ```
   This pulls every box's latest `box-report.json` over SSH (read-only —
   it never touches `CRAWL_STATES` or concurrency on any box) and writes
   `data/runs/<date>/fleet-summary.{json,html}` with one row per
   box/runLabel: rooftops, hours, p90 seconds/rooftop, SLA verdict, WAF%,
   NHTSA%, and finish time in ET. Open the `.html` — **red** means
   `wallClockHours > 22` or `slaOk: false` (an actual breach or thin-margin
   overrun), **yellow** means 20–22h (within SLA but worth watching),
   **gray** means no report was found for that box/runLabel at all. Pass
   `--date=YYYY-MM-DD` for a past night or `--boxes=box1,box2` to check a
   subset.
3. **Trend over time**: `docs/capacity_history.csv` gets one row appended
   per box per runLabel per night (never rewritten), carrying that
   night's *real measured* p50/p90 seconds/rooftop — not the config
   constant. Once enough real nights have accumulated, recompute
   `CRAWLER_P50_SEC_PER_ROOFTOP` / `CRAWLER_P90_SEC_PER_ROOFTOP` (see
   `src/capacity.js`) from this file's actual distribution instead of the
   23-sample estimate this document started from, and update both the
   "Measured rate" table above and the two env-var defaults together.

### What's in a box-report.json

`identity` (host/brand set/concurrency), `schedule` (start/end,
wall-clock hours, whether it hit its time budget, `slaOk`), `scope`
(states/rooftops assigned vs. attempted vs. skipped), `throughput` (real
per-brand seconds/rooftop, vehicles/hour), `quality` (WAF-blocked count by
classification, NHTSA enrichment success rate, shared-data-lock
contention), `capacity` (projected vs. actual hours), `health`
(best-effort point-in-time free memory/load average — Chromium crash
count and a true run-long CPU/RAM peak aren't instrumented yet, and the
report says so explicitly rather than reporting a fabricated 0), and
`links` back to the underlying log files and driver summary. All of it is
derived from data `run-daily-crawl.mjs` already collects (per-brand
`dealerCount`/`durationMs`/`status`/`stats`) plus regex-parsed signals
from the per-brand log files it already writes — nothing new was added to
`standalone.js` or `enricher.js` to produce this.

An example filled report (from a dry run against realistic fixture data,
not a live box) lives at
[`data/runs/2026-09-21/expansion/box-report.json`](../data/runs/2026-09-21/expansion/box-report.json)
and its rendered [`box-report.html`](../data/runs/2026-09-21/expansion/box-report.html).

## 2026-09-25 update — box 1 is 4.8x slower per rooftop than box 2, and why the fix is a claim queue, not a bigger static shard

Box 1 sat idle for hours every night while box 2/3/4 were still grinding.
The 2026-09-21 shard map above was built from ONE fleet-wide p90 rate
(93.2s/rooftop) applied to every box equally — that assumption turned out
to be wrong, and wrong enough to explain the whole imbalance on its own.

### Root cause: measured, not estimated

Parsing real `[driver] STATE BRAND: starting/ok` log-line pairs from a
full core-brand night on box 1 and box 2 gives each box's own actual
seconds/rooftop:

| Box | vCPU | `CRAWLER_MAX_CONCURRENT_STATES` | Processes/vCPU | Paired jobs | Rooftops | Measured s/rooftop |
|---|---|---|---|---|---|---|
| Box 1 | 2 | 4 | **2.0** | 359 | 4,664 | **77.4s** |
| Box 2 | 4 | 6 | 1.5 | 660 | 8,986 | **16.2s** |

Box 1 is **4.8x slower per rooftop**, not ~2x slower as its half-the-vCPUs
would suggest. The gap tracks processes-per-vCPU, not raw vCPU count: box
1 is proportionally the more oversubscribed box despite running fewer
processes in absolute terms, and Patchright/Chromium contention under
oversubscription inflates real wall-clock per-job duration far past what
the compute difference alone predicts. This is a hypothesis backed by
strong circumstantial evidence (the ratio direction matches, the gap
magnitude is far larger than a compute-only explanation), not a
100%-proven root cause — a controlled test (same box, same brand set, two
different `CRAWLER_MAX_CONCURRENT_STATES` values, same night) would
confirm it, but the fix below doesn't require that experiment to already
work.

**Explicitly ruled out as the fix**: raising `CRAWLER_MAX_CONCURRENT_STATES`
on box 1 past its CPU-safe default. Given the oversubscription-driven root
cause, that would very plausibly make box 1's per-rooftop rate *worse*, not
better — more processes competing for the same 2 vCPUs.

### Why a static split can no longer be "fair"

`recommend-shard-split.mjs` now accepts a `--p90` value **per box**
(previously one global rate, silently assumed equal for every box — see
the CLI change below). Re-running the core-brand split with real box
1/box 2 rates (box 3/box 4 core-brand rates are not yet directly measured;
box 2's rate is used as a provisional proxy for them, since they share the
same 4 vCPU / 4-6-concurrency profile):

```
scripts/recommend-shard-split.mjs --brand-set=core --boxes=4 \
  --concurrency=4,6,6,6 --p90=77.4,16.2,16.2,16.2
```

gives box 1 only **3 states** (MI, MO, NE — 368 rooftops, ~2.0h projected)
against **~15-16 states each** (~2,690-2,700 rooftops, ~2.0h projected)
for box 2/3/4. A split sized to be time-fair leaves box 1 almost idle for
most of the night — there is no static state→box assignment that both
respects the measured throughput gap and keeps box 1 meaningfully
utilized. The static split is therefore no longer the primary
load-balancing mechanism; it becomes a small guaranteed floor per box,
with the shared claim queue below doing the real balancing as actual
throughput reveals itself run over run.

### The claim queue (`src/crawl_claims.js` + deals-api `/api/ops/crawl-claims/*`)

A `crawl_claims` table on the existing deals-api MariaDB instance (no new
service — reuses the same database already backing `dealer_inventory` and
the sync-lock) holds one row per `(run_date, brand_set, state)`:
`rooftop_count`, `status` (`unclaimed`/`claimed`/`done`/`failed`),
`claimed_by`, `claimed_at`, `heartbeat_at`, `finished_at`.

Each run:

1. **Seeds** every state for tonight's `(runDate, brandSet)` once
   (idempotent `INSERT IGNORE` — safe to call from every box). A box's own
   statically-owned states seed pre-claimed by that box; every other state
   seeds `unclaimed`.
2. Each of `CRAWLER_MAX_CONCURRENT_STATES` local worker slots first drains
   this box's own owned states, then — once its local list is exhausted —
   **claims** the largest still-unclaimed state that fits inside its
   remaining budget (`maxRooftops`, derived from
   `CRAWLER_STEAL_P90_SEC_PER_ROOFTOP` and the time left before the 24h
   budget), atomically (`UPDATE ... ORDER BY rooftop_count DESC LIMIT 1`,
   retried once on a race with a peer box).
3. Sends a **heartbeat** every 5 minutes while a claimed state is in
   flight (a real state has taken up to ~11.85h — far longer than the
   90-minute `CRAWL_CLAIM_STALE_MS` staleness window, so a claim without a
   heartbeat is what actually marks it abandoned and reclaimable, not the
   claim's age alone).
4. **Releases** the state as `done` on success, or back to `unclaimed`
   (for a peer to retry tonight) on a fatal error.

This is scoped by `brandSet`, so a core-brand-set run can only ever claim
core rows and an expansion run only expansion rows — stealing never
crosses the brand-set boundary the existing shard map already respects.
Guarantees this gives, matching the fleet's existing invariants: exactly
one active claim per `(state, brandSet)` per night; per-state shard writes
(`data/inventory/<state>.json`) stay untouched — a claim only changes
*which box* runs a state, never how that state's own data is written;
NHTSA rate-limiting stays per-box-IP as before (the queue moves work, not
API-key/IP-scoped rate budgets); a box that can't fit a state's remaining
work within its own leftover budget simply doesn't claim it, so the 24h
per-box SLA and `checkProjectedRuntime`'s preflight refusal are both
unaffected.

### Enabling it per box

Off by default everywhere — every existing box's behavior is completely
unchanged unless explicitly opted in. To enable on a box's crontab entry:

```
CRAWLER_STEAL_ENABLED=1
CRAWLER_STEAL_P90_SEC_PER_ROOFTOP=<this box's own measured rate, e.g. 77.4 for box1, 16.2 for box2>
```

Recommended rollout: enable on box 1 and box 2 first (their rates are
directly measured), watch one night's `box-report.json`
(`scope.statesStolen` lists every state a box picked up from the shared
queue) and the claims table's `/api/ops/crawl-claims/status` endpoint for
sane behavior — no double-claims, no state left permanently `claimed` past
its heartbeat window — before enabling on box 3/box 4, whose core-brand
rate is still a proxy estimate rather than a direct measurement.

### Observability

`box-report.json`'s `scope.statesStolen` lists every state that box
picked up from the shared queue rather than its own static assignment.
`npm run fleet-report`'s fleet-summary should be read alongside
`/api/ops/crawl-claims/status?runDate=&brandSet=` on the deals box for the
full picture of who donated and who stole on a given night.

## Known data-quality caveat

`scripts/recommend-shard-split.mjs`, when run from a plain git checkout
(rather than one of the live boxes), undercounts CORE brand rooftops for
many states — this repo's own `dealers/` directory is missing some
core-brand dealer files that only exist on the live boxes (a pre-existing
drift, not introduced by this SLA work). Run the tool from a box with the
real data (or reconcile the drift into git) for an accurate core-brand
recommendation. Expansion-brand counts are unaffected — those dealer
files are fully committed.
