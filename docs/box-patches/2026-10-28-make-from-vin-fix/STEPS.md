# Fix stored makes the VIN contradicts (box2 `dealer_inventory`) — code and docs only, NOTHING IS APPLIED

Apply only on Paul's typed **GO**, in a daytime idle window, one numbered step at a time. Box2 only (`ssh box2`, 52.202.234.65; `docs/BOXES.md`). Script: `scripts/box/2026-10-28-make-from-vin-fix.mjs` (pure parts in `scripts/lib/makeFromVinFix.mjs`, tests in `scripts/box/make-from-vin-fix.test.mjs`). Cut from the #609 apply; the read-only counterpart is `scripts/box/2026-10-24-make-wmi-reclean.mjs`.

## What it does
`make := reconcileMake(make, vin, model).make` (the rule `vinWmi.js` gives the crawler and the deals-API write path) for **`wmi-conflict` rows only**: the stored make is outside the family the VIN's WMI can carry and the VIN names the right one (a Nissan stored on an F-150 VIN becomes Ford). Blank makes (`wmi-fill`) and shared-WMI conflicts that need a vPIC decode (`conflict-unresolved`, `unresolved`) are only counted. Nothing but `make` is written.

The box has no checkout and the deals-api patch that ships `vinWmi.js` is not installed, so the script is emitted as ONE bundle (vinWmi + tables inside; **needs #618 merged first**: it imports `WMI_LIST` from `vinWmi.js`) and piped over ssh: nothing is installed on the box except the rollback file it writes into the directory you run it from.

## Measured on box2 (read-only, reader account, 10-20 s caps, index-bounded: `vin LIKE 'WMI%'` grouped by `LEFT(vin,5)`, 252 WMIs)

**Re-measured 2026-10-27 21:05-21:15 ET with this script's emitted bundle on the fixed table (#618), active rows:** 2,700,631 rows read, **6,738 to rewrite**, 979 `conflict-unresolved` + 26 `unresolved` (need a vPIC decode, not touched), 22 blank (`wmi-fill`, not touched), no `Kia -> Hyundai` pair. Removed rows (`--include-removed`) were measured before the table fix: 2,359,978 read, 9,057 named conflicts (of which 1,076 were the 7YA false positives, counted separately, so ~9,057 on the old table less the few dozen the fix reclassifies), 2,173 needing vPIC, 457 blank. Step 1 below re-measures them on the fixed table.

The "roughly 18.9k" was active + removed named conflicts **including** 7YA (6,765 + 1,415 + 9,057 + 1,076 = 18,313) plus the blanks (479): about 2.5k of it was the Kia Sportage Hybrid false positive. The real fixable set is about **15.8k rows (6,738 active + ~9k removed)**.

### Top 20 pairs, stored make -> make the VIN names (active, fixed table)
| # | rows | stored -> VIN |
|--:|--:|---|
| 1 | 512 | Nissan -> Chevrolet |
| 2 | 453 | Nissan -> Ford |
| 3 | 348 | Nissan -> Toyota |
| 4 | 317 | Infiniti -> Nissan |
| 5 | 284 | Nissan -> Jeep |
| 6 | 273 | Acura -> Honda |
| 7 | 209 | Nissan -> GMC |
| 8 | 197 | Nissan -> Honda |
| 9 | 163 | Nissan -> Ram |
| 10 | 121 | Nissan -> Hyundai |
| 11 | 116 | Honda -> Toyota |
| 12 | 115 | Mitsubishi -> Chevrolet |
| 13 | 102 | Acura -> Toyota |
| 14 | 98 | Honda -> Chevrolet |
| 15 | 95 | Honda -> Acura |
| 16 | 95 | Nissan -> Volkswagen |
| 17 | 86 | Nissan -> Mazda |
| 18 | 81 | Honda -> Ford |
| 19 | 74 | Kia -> Chevrolet |
| 20 | 69 | Mitsubishi -> Ford |

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
1. **Dry run** (reader account, no lock, writes nothing; ~10-15 min with removed rows). Read the pairs: they must match the table above (plus whatever arrived overnight) and no `Kia -> Hyundai` pair may appear; **STOP if any pair you do not recognise has a large count**:
```bash
ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --include-removed' < /tmp/make-fix.bundle.mjs | tee /tmp/make-fix-dryrun.txt
```
2. Gate (above). Then a **first small apply** (200 rows, rollback file in a dedicated dir):
```bash
ssh box2 'mkdir -p /opt/trimscout-deals/make-fix-out && cd /opt/trimscout-deals && node --input-type=module - --apply --fleet-idle --include-removed --limit=200 --out=/opt/trimscout-deals/make-fix-out' < /tmp/make-fix.bundle.mjs
```
Check: `rewritten: 200`, `skipped: 0`; spot-read 5 rows from the rollback file against `/api/inventory` (right make for the VIN); `curl -s localhost:3004/health` fine.
3. Full apply (same command without `--limit`). It stops by itself on the first error or 10 s timeout (no retry), at 21:30 ET, or when done; rerunning is safe (idempotent) and picks up where it stopped. It releases the sync lock in `finally`; confirm with the lock-log line from the gate.
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
