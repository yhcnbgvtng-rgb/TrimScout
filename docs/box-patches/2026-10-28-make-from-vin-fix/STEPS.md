# Fix stored makes the VIN contradicts (box2 `dealer_inventory`) — code and docs only, NOTHING IS APPLIED

Apply only on Paul's typed **GO**, in a daytime idle window, one numbered step at a time. Box2 only (`ssh box2`, 52.202.234.65; `docs/BOXES.md`). Script: `scripts/box/2026-10-28-make-from-vin-fix.mjs` (pure parts in `scripts/lib/makeFromVinFix.mjs`, tests in `scripts/box/make-from-vin-fix.test.mjs`). Cut from the #609 apply; the read-only counterpart is `scripts/box/2026-10-24-make-wmi-reclean.mjs`.

## What it does
`make := reconcileMake(make, vin, model).make` (the rule `vinWmi.js` gives the crawler and the deals-API write path) for **`wmi-conflict` rows only**: the stored make is outside the family the VIN's WMI can carry and the VIN names the right one (a Nissan stored on an F-150 VIN becomes Ford). Blank makes (`wmi-fill`) and shared-WMI conflicts that need a vPIC decode (`conflict-unresolved`, `unresolved`) are only counted. Nothing but `make` is written.

The box has no checkout and the deals-api patch that ships `vinWmi.js` is not installed, so the script is emitted as ONE bundle (vinWmi + tables inside; **needs #618 merged first**: it imports `WMI_LIST` from `vinWmi.js`) and piped over ssh: nothing is installed on the box except the rollback file it writes into the directory you run it from.

## Measured on box2 (read-only, reader account, 10-20 s caps, index-bounded: `vin LIKE 'WMI%'` grouped by `LEFT(vin,5)`, 252 WMIs)

**Re-measured 2026-10-28 19:53-20:00 ET (box2, active rows, bundle md5 9a70eaf7..., the logging build; same discovery query as below):** 2,820,674 rows read, **7,629 to rewrite**, 1,182 `conflict-unresolved` + 26 `unresolved` (need a vPIC decode, not touched), 27 blank (`wmi-fill`, not touched), no `Kia -> Hyundai` pair. The run took about 6 minutes (252 WMIs, 370 s of query time, no timeouts, slowest prefix `3GN` 9.99 s, then `1GT` 9.5 s, `1GC` 9.4 s, `5NM` 8.8 s, `1C4` 8.4 s). The 2026-10-27 run (6,738 rewrites over 2,700,631 rows) was earlier, so the difference is a day of crawl: about 120k more rows and +891 rewrites, mostly **GMC -> Chevrolet (218) and GMC -> Ford (108), all from one dealer** (see "GMC -> Chevrolet / Ford" below). Removed rows (`--include-removed`) were last measured before the table fix: 2,359,978 read, 9,057 named conflicts (of which 1,076 were the 7YA false positives, counted separately), 2,173 needing vPIC, 457 blank. Step 1 below re-measures them on the fixed table.

**The discovery query is now a primary-key walk (this PR), not a GROUP BY.** The old per-WMI `GROUP BY LEFT(vin,5), BINARY make` is range-bounded by the primary key but still reads and groups every row in the range: on box2 the EXPLAIN for `1FT` is `type: range, key: PRIMARY, rows: 572160, Using where; Using temporary; Using filesort` (ANALYZE: 305,987 rows read, 52% active, 0.32 s) and for a small WMI (`ZFF`) `ref idx_inv_removed, rows 342` (0.45 s). Big WMIs ran 8-10 s against the 10 s cap with a deeper split as the only escape, and one earlier run (2026-10-28 19:22 ET) stalled for 23 minutes with no output for a reason that was not reproduced. The walk reads (vin, dealer_id) in 5000-row chunks (`LIMIT` counts scanned rows, removed rows included, because only the key range filters), groups in Node, logs every prefix (time, chunks, rows scanned, slowest chunk), and stops on any error or timeout. **Measured 2026-10-28 20:22-20:28 ET on the merged walk (#620):** 6 min 30 s for the whole dry run (252 WMIs, 349 s of query time, 5,185,440 rows scanned, 7,629 rewrites, identical to the GROUP BY build's counts); the slowest single statement was 844 ms (`3C7`), the slowest prefix 11.9 s in total (`3C6`, 18 chunks of at most 820 ms). The walk is bounded, not faster: expect **about 6-7 minutes** per discovery pass. An `--apply` run does two passes (one under the lock before the writes, one after to report what is left), so budget **about 13-15 minutes plus the writes** (the 200-row trial wrote 3 UPDATE statements in under 2 s each).

### GMC -> Chevrolet / Ford (checked read-only 2026-10-28)
All 218 GMC -> Chevrolet and 108 GMC -> Ford rows are one dealer (id 10229, Gregg Young Buick GMC, IA: 839 of its 865 active rows are stored GMC), so it is a roster-brand fallback on that dealer, not a table error. WMIs (all agree with NHTSA vPIC DecodeWMI): Chevrolet `1GC` 66, `3GN` 49, `1GN` 33, `1G1` 23, `3GC` 20, `KL7` 12, `2GC` 8, `2GN` 5, `1GA` 1, `2G1` 1; Ford `1FM` 46, `1FT` 39, `2FM` 10, `1FA` 4, `3FM` 4, `3FT` 2, `1ZV` 1, `3FA` 1, `MAJ` 1. The models are Silverado, Colorado, Equinox, Blazer, Tahoe, Traverse, Trax, TrailBlazer, Malibu, Corvette, F-150, Escape, Explorer, Edge, Mustang, Bronco Sport, Maverick, Ranger...; no GMC nameplate (Sierra, Canyon, Yukon, Terrain, Acadia, Savana) sits on a Chevrolet or Ford WMI, and `1GT`/`3GT` (GMC) rows are untouched.

The "roughly 18.9k" was active + removed named conflicts **including** 7YA (6,765 + 1,415 + 9,057 + 1,076 = 18,313) plus the blanks (479): about 2.5k of it was the Kia Sportage Hybrid false positive. The real fixable set is about **16.6k rows (7,629 active as of 2026-10-28 + ~9k removed)**.

### 200-row trial (2026-10-28 20:35-20:47 ET, box2, applied)
200 rows rewritten (Infiniti -> Nissan 142 on `3N1`, Nissan -> Jeep 58 on `1C4`), 0 skipped, 0 left alone, stopped by the limit, 7,429 still to fix; all 200 read back from the live table with `make` equal to the value written. Rollback file kept on box2: `/opt/trimscout-deals/make-fix-out/make-from-vin-fix-2026-10-29T00-41-11-540Z.rollback.jsonl` (200 lines, md5 `c51a525401fb744002c0a0c7e03da460`); the full run's rows are separate files. Statement timings (log-only wrapper): UPDATE 1577 / 166 / 401 ms; apply-path SELECT 1210 / 2079 / **5307** / 1649 ms. The 5.3 s read was `vin LIKE 'p5%' AND BINARY make = BINARY ? ... LIMIT 100`, which scans the whole p5 range until 100 rows match, so a group with a rare stored make could pass the 10 s cap and stop the run. **The apply-path read is now a primary-key walk too** (`fetchMatching`: `(vin, dealer_id)` chunks of 2000 rows, the make and active filters applied in Node), so no SELECT scans more than 2000 rows.

### Top 20 pairs, stored make -> make the VIN names (active, fixed table, 2026-10-28 dry run)
| # | rows | stored -> VIN |
|--:|--:|---|
| 1 | 590 | Nissan -> Chevrolet |
| 2 | 494 | Nissan -> Ford |
| 3 | 377 | Nissan -> Toyota |
| 4 | 357 | Acura -> Honda |
| 5 | 345 | Nissan -> Jeep |
| 6 | 321 | Infiniti -> Nissan |
| 7 | 218 | GMC -> Chevrolet |
| 8 | 216 | Nissan -> GMC |
| 9 | 213 | Nissan -> Honda |
| 10 | 169 | Nissan -> Ram |
| 11 | 159 | Nissan -> Hyundai |
| 12 | 131 | Nissan -> Mazda |
| 13 | 121 | Acura -> Toyota |
| 14 | 116 | Mitsubishi -> Chevrolet |
| 15 | 111 | Honda -> Toyota |
| 16 | 108 | GMC -> Ford |
| 17 | 107 | Nissan -> Volkswagen |
| 18 | 98 | Honda -> Chevrolet |
| 19 | 92 | Honda -> Acura |
| 20 | 81 | Honda -> Ford |

Spot check of the biggest WMI/stored-make groups by model (active rows): `3N1`+Infiniti = Sentra/Kicks/Versa; `5FN`+Acura = Pilot/Odyssey/Passport; `5J8`+Honda = MDX/RDX; `1HG`+Acura = Accord; `KM8`+Nissan = Palisade/Kona/IONIQ 5; `1FT`+Nissan = F-150/Super Duty/Ranger; `1C4`+Nissan = Wrangler/Grand Cherokee/Durango; `4S4`+Honda = Outback/Ascent/Forester; `1G1`+Nissan = Malibu/Corvette/Camaro. The model agrees with the VIN every time: real mislabels (roster-brand fallback on a multi-franchise lot), not table errors.

### The table error this dry run found, and its fix (#618)
The old #1 pair, **Kia -> Hyundai, 1,413 active rows, was wrong**: every one is a **2027 Kia Sportage Hybrid** built at the Georgia metaplant, whose WMI `7YA` `vinWmi.js` listed as Hyundai only (it also builds the IONIQ 5/9 and the Genesis GV70 EV). **#618 fixes the table** (`7YA` = Hyundai/Kia/Genesis; model rules decide a foreign or blank make on shared WMIs) and, from a model-ownership audit of 238 sizeable (WMI, stored make) conflicts on box2, also `3MY` (+Scion, the iA), `3N6` (+Chevrolet, City Express) and `JN1` (+Mitsubishi, Eclipse Sportback). This script runs on the fixed table, so it no longer needs, or has, a `7YA` exclusion. The counts above are from the dry run on that table.

## Gate (before every write)
1. Sync lock free (read the log, never acquire it by hand): `grep '\[sync-lock\]' ~/.pm2/logs/*deals*out*.log | tail -2` ends with a release.
2. No `inventory-sync|run_nightly_chain|run_daily_crawl|standalone|backfill|unretire|facet|apply` process on box1-box4 (`pgrep -fa`; boxes 1/3/4 via `ssh -J box2 ... ubuntu@<private ip>`). The other session's facet rebuild must be finished.
3. Not inside the nightly window (22:00-06:30 ET); the script itself stops at 21:30 ET (`--deadline-et`). `pm2 describe trimscout-deals-api` online.

## Steps
0. Mac, from the merged repo checkout (`npm i` has esbuild):
```bash
node scripts/box/2026-10-28-make-from-vin-fix.mjs --emit > /tmp/make-fix.bundle.mjs && md5 /tmp/make-fix.bundle.mjs
node --test scripts/box/make-from-vin-fix.test.mjs          # 7 pass
```
1. **Dry run** (reader account, no lock, writes nothing; about 6-7 min active-only, measured above). Read the pairs: they must match the table above (plus whatever arrived since; tonight 7,629 rewrites) and no `Kia -> Hyundai` pair may appear; **STOP if any pair you do not recognise has a large count**:
```bash
ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --include-removed' < /tmp/make-fix.bundle.mjs | tee /tmp/make-fix-dryrun.txt
```
2. Gate (above). Then a **first small apply** (200 rows, rollback file in a dedicated dir):
```bash
ssh box2 'mkdir -p /opt/trimscout-deals/make-fix-out && cd /opt/trimscout-deals && node --input-type=module - --apply --fleet-idle --include-removed --limit=200 --out=/opt/trimscout-deals/make-fix-out' < /tmp/make-fix.bundle.mjs
```
Check: `rewritten: 200`, `skipped: 0`; spot-read 5 rows from the rollback file against `/api/inventory` (right make for the VIN); `curl -s localhost:3004/health` fine.
3. Full apply (same command without `--limit`). It stops by itself on the first error or 10 s timeout (every read is a 2000-row key walk, every UPDATE 100 rows) (no retry), at 21:30 ET, or when done; rerunning is safe (idempotent) and picks up where it stopped. It releases the sync lock in `finally`; confirm with the lock-log line from the gate.
4. **Rebuild the make-keyed facets** the usual way (`inv_color_facets`, `inv_option_facets` carry `make`; `idx_inv_*make*` indexes are maintained by the UPDATE itself). Then check /search: Make facet counts for Nissan/Infiniti drop by about the fixed amount and Chevrolet/Ford/Jeep/Toyota rise.
5. Verify (read-only): rerun step 1; expect `to rewrite` near 0 (only rows that arrived since).
6. Keep `/opt/trimscout-deals/make-fix-out/*.rollback.jsonl` until Paul says delete (it holds VINs).

## Rollback
```bash
ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --rollback=/opt/trimscout-deals/make-fix-out/FILE.rollback.jsonl' < /tmp/make-fix.bundle.mjs               # counts what would be restored
ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --rollback=/opt/trimscout-deals/make-fix-out/FILE.rollback.jsonl --apply --fleet-idle' < /tmp/make-fix.bundle.mjs
```
Restores `make` only where it is still the value the script wrote. Then rebuild the facets again.

## Rails and what it costs
Every statement runs under `max_statement_time=10`; reads and writes are bounded by the primary key (`vin LIKE 'p5%'` + `(vin, dealer_id)` keyset, 100 rows per chunk); each chunk's before-state is appended and fsync'd to the rollback file before its UPDATE; the UPDATE requires `make` to still be the value read; sync lock with heartbeat; refuses retired IPs and refuses to `--apply` unbundled. The UPDATE touches ~12 secondary indexes carrying `make`, so expect it to be slower than the trim apply: use the 200-row run in step 2 to time it before the full run.
## Not done / not verified
Nothing was written on box2; the apply path was tested only against an in-memory table, never against MariaDB. A dry run of the emitted bundle was executed on box2 for four WMIs (read-only) and matched the full count. Out of scope: the shared-WMI rows that need a vPIC decode (`conflict-unresolved`/`unresolved`) and the blank makes.
