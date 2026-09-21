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

## Known data-quality caveat

`scripts/recommend-shard-split.mjs`, when run from a plain git checkout
(rather than one of the live boxes), undercounts CORE brand rooftops for
many states — this repo's own `dealers/` directory is missing some
core-brand dealer files that only exist on the live boxes (a pre-existing
drift, not introduced by this SLA work). Run the tool from a box with the
real data (or reconcile the drift into git) for an accurate core-brand
recommendation. Expansion-brand counts are unaffected — those dealer
files are fully committed.
