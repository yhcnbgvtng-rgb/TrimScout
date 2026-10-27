# One per VIN, facet counts: the losers table (code only — NOTHING IS INSTALLED)

Replaces the idea in PR #604 of finding duplicate VINs live (`vinLoserRows`, a GROUP BY over the primary key that cannot finish inside the 20 s cap — even a
2-character VIN slice timed out on box2 2026-10-27). Nothing scans for duplicates at request time any more.

**Design.** One small table, `dealer_inventory_vin_losers (vin, dealer_id)`, holds a key for every row that LOSES the one-listing-per-VIN rule (`onePerVin.js`:
freshest sighting wins; tie -> lowest price -> lowest dealer id). It is kept current by:

| Writer | When | Cost |
|---|---|---|
| `afterUpsert` (hook in the sync upsert, after each chunk) | every `/api/inventory/bulk` chunk, for that chunk's VINs | one PK-range SELECT on `dealer_inventory` + one on the losers table, then a multi-row `INSERT IGNORE` / single-row deletes: 7–12 ms on the live table (measured) |
| `scheduleReconcile` (hook inside `scheduleCatalogFacetRebuild`, so it rides the same 15-min debounce after every sweep / retire / bulk write) | after a sweep, supersede, duplicate-vins or zero-scrape | walks the losers table by VIN (500 per statement) and re-decides each; catches a winner that was retired or a loser that came back |
| `2026-10-29-one-per-vin-losers-backfill.mjs --phase=run` | once at install; re-runnable any time as the verification pass | dealer_inventory in primary-key order, 5,000 rows per statement (11–137 ms measured), side table only |

The facet counts then subtract ONE `GROUP BY` over the losers table joined back to `dealer_inventory` by its whole primary key (`eq_ref`). The join
re-checks each loser against the live row (removed / stale / wholesale / seen-window), so a loser swept since the last reconcile is simply not counted. It
is cached stale-while-revalidate per window (the same `stableCached` the other facet buckets use); a contact set is its own small query. A failure leaves
the counts as they were, says `onePerVin:false`, and is not retried for 60 s.

**Why a table of keys and not a column on `dealer_inventory`:** a column is a 2.2M-row ALTER on the hot table, and the facet GROUP BYs are index-only over
indexes that do not contain it — a `dup_loser = 0` predicate would force a row lookup per counted row (the shape that already blew the cap on Ford).
Nothing on `dealer_inventory` changes. Dropping the table is the whole rollback of the data.

Both switches are OFF unless set (env on `deals-api`): `ONE_PER_VIN_LOSERS=maintain` (keep the table current) and `ONE_PER_VIN_FACETS=1` (facets subtract it).
With neither set the patched server behaves exactly as today.

## Files

| File | Role |
|---|---|
| `scrapers/lightsail-crawler/src/onePerVinLosers.js` | NEW on the box `src/`: table DDL, diff / refresh / backfill / reconcile, the maintenance handle, the facet read |
| `scrapers/lightsail-crawler/src/onePerVin.js` | already on box2 (md5 `493f213e63398ff6e272f25d99d02a84`, unchanged) |
| `scrapers/lightsail-crawler/src/retailFacets.js` | already on box2 (md5 `3e2d8fb3ab3513ba65e82884370221bf`, unchanged) |
| `deals_api_server.js.patch` | 7 hunks against **box2's live file** (the copy in `docs/box-snapshots/2026-10-27-box2/`, md5 `d2b48dc73da2511b659638c60a349cd0`); a test applies it with `-F0` |
| `scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs` | phases `explain`, `create`, `count`, `dry`, `run` |

<!-- MD5S:START -->
```
65db034542a7b50e36714ab88db42123  FINAL  onePerVinLosers.js
6fef17503a2949e4fd37f283890e175a  FINAL  2026-10-29-one-per-vin-losers-backfill.mjs
d2b48dc73da2511b659638c60a349cd0  BASE   deals_api_server.js (box2 live, 2026-10-27 17:27 ET)
6e35309faa02b5d8c24f6f66101055f3  FINAL  deals_api_server.js (after the patch)
```
<!-- MD5S:END -->

## EXPLAINs (read-only, box2 reader account, 2026-10-27; the losers table does not exist yet, so its side is a 20,000-row derived stand-in)

```
backfill page   SELECT … FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin > ? AND <visible> ORDER BY vin, dealer_id LIMIT 5000
                type range  key PRIMARY  Extra: Using where                      11–137 ms for 5,000 rows (default plan: idx_inv_removed, 0.6–1.0 s)
refresh / hook  SELECT … FROM dealer_inventory FORCE INDEX (PRIMARY) WHERE vin IN (<500>) AND <visible>
                type range  key PRIMARY  rows 305  Extra: Using where            7–12 ms for 500 VINs (default plan: idx_inv_removed, 0.77–0.83 s — a ref on
                                                                                  removed_at IS NULL with the VIN list only as an index condition)
facet buckets   … FROM <losers> l JOIN dealer_inventory i ON i.vin = l.vin AND i.dealer_id = l.dealer_id WHERE <visible> GROUP BY make,state,model,trim
                l: ALL (the whole small table)   i: eq_ref  key PRIMARY  key_len 72  ref l.vin,l.dealer_id  rows 1
contact set     i: range key idx_inv_dealer  (dealer_id IN …)   l: ref key0 on (vin, dealer_id)
```

The default plan for the first two is the reason `FORCE INDEX (PRIMARY)` is in the code: without it each upsert chunk would pay ~0.8 s.
**After step 3 below, re-run `--phase=explain`**: the losers-table statements (PK lookups, the `vin > ? AND vin <= ?` range, the `DISTINCT vin` keyset, and the
real join) must show `PRIMARY` / `idx_vl_dealer` and no `ALL` on `dealer_inventory`. Check `SHOW CREATE TABLE` shows the same charset/collation as
`dealer_inventory` — a mismatch stops the join from using the key (the EXPLAIN would show `ALL` on `i`). Stop and report if it does.

## Gate (every step that writes, and the restart)

Do nothing until ALL hold, checked in this order, and re-check before each step:
1. The sync lock is free — read it the way the sync gate script does (the 2026-10-27 install used a read-only gate script); never acquire the lock just to look.
2. No inventory sync is running on any box (`pgrep -f inventory-sync` on box1–box4) and no other backfill / unretire / option-apply script is running on box2.
3. Not inside the nightly crawl+sync window (22:00–06:30 ET).
4. `pm2 describe deals-api` online, `/health` OK.
Never restart while the lock is held. Never run the backfill during a sync (it only reads and writes the side table, but a 2.2M-row walk should not compete with the sync).

## Install (on Paul's GO, box2 only)

```bash
# 0. stage (run from a checkout of this PR on your Mac; nothing on the box changes yet). The stage dir sits under /opt/trimscout-deals so node finds its mysql2.
ssh box2 'mkdir -p /opt/trimscout-deals/opvl-stage/scripts/box /opt/trimscout-deals/opvl-stage/scrapers/lightsail-crawler/src'
scp scrapers/lightsail-crawler/src/{onePerVinLosers,onePerVin,retailFacets}.js box2:/opt/trimscout-deals/opvl-stage/scrapers/lightsail-crawler/src/
scp scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs box2:/opt/trimscout-deals/opvl-stage/scripts/box/
scp docs/box-patches/2026-10-29-one-per-vin-losers/deals_api_server.js.patch box2:/opt/trimscout-deals/opvl-stage/
# on box2, in /opt/trimscout-deals/opvl-stage: md5sum the files against the table above.
# 1. backup + md5s
cd /opt/trimscout-deals/src && S=$(date +%Y%m%d%H%M%S)
cp -p deals_api_server.js deals_api_server.js.bak.opvl.$S && md5sum deals_api_server.js | tee ~/opvl-md5s-before.txt   # must be d2b48dc7…; if not, STOP (drift) and re-diff against docs/box-snapshots
# 2. zero-fuzz patch on a staged COPY, then syntax check
cp deals_api_server.js ../opvl-stage/stage.js && patch -F0 --no-backup-if-mismatch ../opvl-stage/stage.js < ../opvl-stage/deals_api_server.js.patch && node --check ../opvl-stage/stage.js && md5sum ../opvl-stage/stage.js
# 3. create the table (writer account; nothing else changes), then re-run the EXPLAINs
cd /opt/trimscout-deals/opvl-stage && node scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs --phase=create && node scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs --phase=explain
# 4. install the module and the patched server, then restart ONLY when the gate holds (plain restart, flags still off)
cd /opt/trimscout-deals/src && cp ../opvl-stage/scrapers/lightsail-crawler/src/onePerVinLosers.js . && cp ../opvl-stage/stage.js deals_api_server.js
pm2 restart deals-api      # then: curl /health, pm2 logs deals-api --lines 50, time a Ford /search page (about 1 s). Behaviour must be unchanged (flags off).
```

## Turn it on (each sub-step on Paul's say-so, gate re-checked)

1. **Maintain on.** `ONE_PER_VIN_LOSERS=maintain pm2 restart deals-api --update-env` (check `pm2 env 0` first for how env is supplied on this box, and keep every other variable). From then on each upsert chunk keeps its VINs current.
2. **Dry run, then backfill.** `--phase=dry` (run as `node scripts/box/2026-10-29-one-per-vin-losers-backfill.mjs --phase=…` from `/opt/trimscout-deals/opvl-stage`) prints how many it would add (expect about 600k) and delete (about 0); then `--phase=run --state=$HOME/opvl-state.json --deadline-et=21:30`. About 450 pages; resumable. `--phase=count` afterwards: `stored` vs `stillVisible`.
3. **Check.** Re-run `--phase=run` (idempotent: `added 0, deleted 0` or a handful from live writes). Compare `stillVisible` with the uncapped Ford count drop seen at install (276,242 vs 345,278, i.e. about 69k fewer for Ford).
4. **Facets on.** `ONE_PER_VIN_FACETS=1 pm2 restart deals-api --update-env`. Probe: `GET /api/inventory/facets?onePerVin=1` must carry `"onePerVin":true` and make counts must drop by about the stillVisible per make; the first call after a restart is the cold query (expect well under the 20 s cap — time it), later calls are cached. Watch `pm2 logs` for "duplicate-VIN buckets unavailable".

## Rollback (any step)

* Facets only: unset `ONE_PER_VIN_FACETS`, `pm2 restart deals-api --update-env` — the web falls back to unadjusted facet counts at once.
* Maintenance: unset `ONE_PER_VIN_LOSERS`, restart. The table just stops being updated; nothing reads it with the flag off.
* Code: `cp deals_api_server.js.bak.opvl.<S> deals_api_server.js`, remove `onePerVinLosers.js`, plain restart (gate).
* Data: `DROP TABLE dealer_inventory_vin_losers` (nothing else references it). `dealer_inventory` was never written.

## What this does not do

* It does not retire or merge any row; the 317,546 VINs live at 2+ stores stay. This is display only (see docs/SHADOW_DUPLICATES.md for the cleanup).
* Between a new duplicate appearing and the upsert hook running for it the count can be off by that VIN (the hook runs in the same chunk, so in practice it is the same second). A winner swept without a following reconcile is corrected within the 15-minute debounce, or by the next backfill/`count` pass.
* `ONE_PER_VIN_LOSERS` / `RETAIL_ONLY_FACETS` changes need a re-run of the backfill (the table encodes the retail-only rule).
