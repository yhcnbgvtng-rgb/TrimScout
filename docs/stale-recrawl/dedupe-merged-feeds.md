# Merged-feed dedupe (dry run) and the wholesale rule — 2026-10-10 (code only, nothing applied)

## Merged-feed dedupe dry run (`scripts/box/2026-10-10-dedupe-merged-feeds.mjs`, `src/dedupeMergedFeeds.js`)
Dry run only (it refuses `--apply`): SELECT-only reads with a 20 s cap, then a plan per group. Preview against today's data (before any re-crawl, `--tie review` / `--tie hub`):

| Group | In-stock rows | Distinct VINs | Held by one rooftop | **Shared** | Decided by evidence | Rows retired with `--tie hub` |
|---|---|---|---|---|---|---|
| McGovern Hyundai (11951 Milford, 11952 Route 2, 11953 Route 93, 12087 Concord) | 2,893 | 1,531 | 169 | **1,362** | 0 | 1,362 (hub = Concord) |
| Fred Beans Hyundai (12243 Mechanicsburg, 12094 Flemington, 12240 Abington) | 1,899 | 1,183 | 511 | **672** | 94 by stock prefix (MH, MK -> Mechanicsburg) | 714 (94 evidence + 576 hub + 2 unresolved) |
| Johnson Lexus (7513 Raleigh, 7515 Durham) | 1,599 | 1,218 | 837 | **381** | 0 | 381 (hub = Raleigh) |

What the data says: for these groups the shared rows are identical (same stock number, same price on 390/390 McGovern and 286/287 Fred Beans shared VINs), so **nothing stored says which rooftop physically has a shared car**. The plan uses only evidence, in order: `fresh` (after a re-crawl, only one rooftop's site still lists the VIN), `stock` (a stock-number prefix that, among VINs held by one rooftop only, points to one rooftop with >= 5 examples and >= 95% purity), then a tie policy: `review` (leave unresolved, retire nothing) or `hub` (the group's largest rooftop keeps it — a convention, not evidence). The learned McGovern prefixes (HW, HC, HU, HM) do not appear on the shared cars, which is why stock decides nothing there. Fred Beans Abington (12240) shares the same feed in the data and is included.

Run it after the re-crawl with `--run-start <crawl start> --require-fresh-keeper` so a stale row is never kept over a fresh one. Right now Johnson Lexus Durham is fresh (seen 10/09) and Raleigh is not: `hub` would keep the stale Raleigh rows and retire the fresh Durham ones, which is why the real run waits for the re-crawl and Paul picks the tie policy.

The wholesale rule (retailOnly, facet counts) moved to its own PR: see docs/wholesale-retail-only.md on main.
