# Shadow duplicates: one VIN, several live rows (2026-10-11)

Read-only investigation on box2 (reader login, `max_statement_time=20`, read-only session, no lock, dealer-id-first batching) plus the Oct 3 classification (`TrimScout-retired-classification-2026-10-10/`). Nothing was written, deployed or restarted.

## Size

| | |
|---|---|
| Oct 3 list: "listed + in stock elsewhere" | 37,719 rows / 35,907 VINs |
| …of those VINs, still held by 2+ live rows today | 13,594 |
| **All live rows (2026-10-11)** | 2,248,880 rows, 2,033,124 distinct VINs |
| **VINs live under 2+ stores** | **176,027** (391,783 rows → **215,756 surplus**) |
| …2 stores / 3 / 4 / 5 / 6 | 147,868 / 19,190 / 6,660 / 2,017 / 292 |
| Surplus rows where the extra row was refreshed within 48h of the keeper | 181,790 (the rest, 33,966, are stale) |
| Surplus in the "no store matched" bucket (dealer_id 0) | 7,880 |

The Oct 3 list is a slice of a much larger problem. Of its 35,907 VINs, the old row is already retired (`removed_at` set) for 30,368 pairs checked and still live for 2,964, so cleaning *that list* alone would retire at most ~3,000 rows; the 215,756 above is the real cleanup.

## Cause

Nothing is wrong with one row; the same VIN is *uploaded under more than one store* and **nothing ever retires the extra row**.

1. **The crawl keeps one record per VIN per state shard** (`inventory_merge.js`: `updatedSnapshot[vin]`). A car shown by several sites (a dealer group pooling its inventory, a used car on a sister store's site, a neighbouring-state store) is stored under whichever store crawled it last that night, so the owner can change from night to night.
2. **The same VIN lands in more than one shard.** box2's own shards hold 7,386 VINs twice (8,460 extra) across states; and 19 states are crawled by two boxes, each with its own shard. Each shard is uploaded, so each store's row is refreshed every night.
3. **#449 (superseded rows) keeps both on purpose** (`supersededRetire.js`: "a row a run just wrote is never touched, so a VIN legitimately uploaded under two stores keeps both") and protects rows another box refreshed in the last 48h. That is exactly the shape of 181,790 of the surplus rows. **#449 is also not deployed**: box2's `~/inventory-sync` has no `runSupersede`, and `deals_api_server.js` has no `/api/inventory/superseded`, so it is not what produced today's state; it would not have fixed it either.
4. **The sweep only visits stores that uploaded something** (`inventorySweep.js`), so a store whose cars all moved to a sister site (uploaded zero) is never swept and its rows sit there stale (33,966 surplus rows). A store that did upload is swept the next night, which is what correctly retired the 30,368 old rows of the Oct 3 list.
5. **The bulk upsert revives**: `ON DUPLICATE KEY UPDATE … removed_at = NULL`. A row retired by hand or by the sweep comes back the next night if any shard still carries the VIN under that store (the "came back: 25,375 VINs, 19,803 at the same dealer" line in box2's last sync log; the other ~5,600 are VINs that came back under a *different* store).
6. **Dealer id remapping is not a cause.** `dealerIdFor` resolves by listing-URL host first, then name; every duplicate pair sits under distinct directory ids with distinct URL hosts (only 133 pairs share a host). The one remap-related slice is the unmatched bucket: 7,880 surplus rows are filed under dealer_id 0 (e.g. a Hendrick BMW Northlake X5 also filed under "East Bay MINI Authorized Service" with a Pleasanton listing URL).

## Five real examples (live rows, 2026-10-11 ~17:00 ET)

1. **Wholesale Volvo, 4 stores, 2 states, 2 boxes** — `YV4A22RK7L1558633`, stock `317565U`: Volvo Cars Danbury CT (14494, box1, last seen 10-11 12:50) · Volvo Cars Hudson Valley NY (14628, box1, 12:50) · Lincoln White Plains NY (16333, box4, 10-10 13:51) · Hudson Valley Volkswagen NY (15722, box1, 10-10 09:45). One shared wholesale feed, four sites, three shards. Mechanism: 2 + 3.
2. **Store whose cars moved to a sister site** — `4T1BK1EB3JU276634` (2018 Avalon): Fred Anderson Toyota of Asheville (6571, last seen 10-11 14:42, URL ashevilletoyota.com) and Fred Anderson Kia (12885, stock `JU276634P`, **last seen 10-08**, URL kiaofraleigh.com). Same box, same state; Fred Anderson Kia stopped uploading, is never swept, and stays live three days stale. Mechanism: 1 + 4.
3. **Cross-box, same state** — `7FARS6H98RE078486` CR-V Hybrid (IA): Billion Hyundai (11836, box1, last seen 10-11 12:46, iowacityhyundai.com) and Billion Community Buick GMC (10230, box3, 12:02, billioncommunitybuickgmc.com). Iowa is crawled by both boxes; each uploads its shard every night, #449's 48h cross-box guard protects both. Mechanism: 2 + 3.
4. **Same box, owner flipped** — `1GKS2BKD6MR417174` Yukon (IL, box4): Steve Schmitt Inc. (8498, last seen 10-10 13:25) and Steve Schmitt of Litchfield (8512, 10-11 15:30), same stock `B11485A`. The shard's one record moved from the first store to the second; the first row is 26h stale and still live because its store keeps uploading other cars only until the next sweep reaches it. Mechanism: 1.
5. **Unmatched bucket** — `5UX23EU0XT9208568` X5: Hendrick BMW Northlake (7784, stock `TN492`) and dealer_id 0 "East Bay MINI Authorized Service" (stock `ZTN492`, a Pleasanton CA URL). Mechanism: 6.

Same-box, same-state VINs (the case #449 was written for) are 38,064 of the 176,027 (22,955 fresh + 15,109 stale); the other 137,963 involve a second state shard or a second box, which #449 cannot touch.

## What this PR changes (code only; nothing runs until deployed and enabled)

- `scrapers/lightsail-crawler/src/vinKeeper.js` — the keeper rule, one live row per VIN, chosen only from stored facts so every box and every night picks the same row (no ping-pong): refreshed within 48h → real store over dealer_id 0 → earliest `first_seen_at` (the incumbent) → lowest dealer id. Only `source = 'nightly'` rows take part.
- `POST /api/inventory/duplicate-vins { vins, foreignBefore, dryRun? }` in `deals_api_server.js` — selects the VINs' live nightly rows by primary-key prefix, plans in JS, retires by primary key (re-checking `removed_at IS NULL`).
- `inventory-sync.mjs` — after a **complete** run, `RETIRE_DUPLICATE_VINS=1` retires, `RETIRE_DUPLICATE_VINS_DRY_RUN=1` only counts. **Off by default**, like #449.
- `scripts/box/2026-10-11-dedupe-active-vins.mjs` — the one-off cleanup: dry run by default (reader, 20 s cap, dealer-id ranges, writes a plan file that doubles as the rollback list); `--apply --fleet-idle --plan=FILE` takes the sync lock and retires exactly the reviewed plan.
- Caveat: for groups that share one feed there is no evidence of which rooftop physically holds the car; the incumbent rule is a stable convention. `dedupeMergedFeeds.js` (evidence-based, review-first) should run first for the groups it knows.

## Idle-window steps (not run)

Pre-conditions on every box: no crawl, sync, sweep or fill running; the sync lock is free (`grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -2` ends in a release); no long query on the deals box.

1. **Deals box (box2)** — copy `src/vinKeeper.js` to `/opt/trimscout-deals/src/` and patch `deals_api_server.js`: add the import, `handleInventoryDuplicateVins` and the route line (anchor on the live file's text, it has drifted from the repo, see docs/BOXES.md), `node --check`, back up first, restart `trimscout-deals-api` under pm2. Probe: `POST /api/inventory/duplicate-vins` with `dryRun:true` and one VIN.
2. **Dry run of the cleanup** — copy the script to `/opt/trimscout-deals/`, `node 2026-10-11-dedupe-active-vins.mjs`. Review the count (expect ~215,700) and a sample of the plan file.
3. **Apply** — `sudo node 2026-10-11-dedupe-active-vins.mjs --apply --fleet-idle --plan=/home/ubuntu/dedupe-vins-plan-XXXX.json`. Rollback: set `removed_at = NULL` for the plan's `(vin, dealerId)` pairs under the lock.
4. **Stop it coming back** — on each crawl box, only after that box has the modular client (docs/SYNC_FRESHNESS.md), set `RETIRE_DUPLICATE_VINS_DRY_RUN=1` for one night, read the `[sync] duplicate VINs (dry run)` line (`wouldRetire` should be small and stable), then `RETIRE_DUPLICATE_VINS=1`.
5. After the first live night: re-run step 2's dry run; the count should be near zero.
