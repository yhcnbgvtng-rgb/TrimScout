# Fix stored makes the VIN contradicts (box2 `dealer_inventory`) — code and docs only, NOTHING IS APPLIED

Apply only on Paul's typed **GO**, in a daytime idle window, one numbered step at a time. Box2 only (`ssh box2`, 52.202.234.65; `docs/BOXES.md`). Script: `scripts/box/2026-10-28-make-from-vin-fix.mjs` (pure parts in `scripts/lib/makeFromVinFix.mjs`, tests in `scripts/box/make-from-vin-fix.test.mjs`). Cut from the #609 apply; the read-only counterpart is `scripts/box/2026-10-24-make-wmi-reclean.mjs`.

## What it does
`make := reconcileMake(make, vin, model).make` (the rule `vinWmi.js` gives the crawler and the deals-API write path) for **`wmi-conflict` rows only**: the stored make is outside the family the VIN's WMI can carry and the VIN names the right one (a Nissan stored on an F-150 VIN becomes Ford). Blank makes (`wmi-fill`) and shared-WMI conflicts that need a vPIC decode (`conflict-unresolved`, `unresolved`) are only counted. Nothing but `make` is written.

The box has no checkout and the deals-api patch that ships `vinWmi.js` is not installed, so the script is emitted as ONE bundle (vinWmi + tables inside) and piped over ssh: nothing is installed on the box except the rollback file it writes into the directory you run it from.

## Measured on box2, 2026-10-27 20:35-20:55 ET (read-only, reader account, 10-20 s caps, index-bounded: `vin LIKE 'WMI%'` grouped by `LEFT(vin,5)`; 252 WMIs; only `1FM`, `1FT` needed a deeper split)

| | rows read | named make (fixable) | needs vPIC (`conflict-unresolved`+`unresolved`) | blank (`wmi-fill`) | **7YA false positives** |
|---|---:|---:|---:|---:|---:|
| active (`removed_at IS NULL`) | 2,700,631 | 6,765 | 1,010 | 22 | 1,415 |
| removed | 2,359,978 | 9,057 | 2,173 | 457 | 1,076 |

The "roughly 18.9k" is active + removed named conflicts **including** 7YA (6,765 + 1,415 + 9,057 + 1,076 = 18,313) plus the blanks (479). **About 2,491 of them are not mislabelled** (below), so the real fixable set is **15,822 rows (6,765 active, 9,057 removed)**; a further ~3,200 shared-WMI rows need a vPIC decode and are not touched here.

### Top 20 pairs, stored make -> make the VIN names (7YA excluded)
| # | total | active | removed | stored -> VIN |
|--:|--:|--:|--:|---|
| 1 | 1,071 | 512 | 559 | Nissan -> Chevrolet |
| 2 | 952 | 453 | 499 | Nissan -> Ford |
| 3 | 719 | 284 | 435 | Nissan -> Jeep |
| 4 | 705 | 317 | 388 | Infiniti -> Nissan |
| 5 | 614 | 348 | 266 | Nissan -> Toyota |
| 6 | 581 | 273 | 308 | Acura -> Honda |
| 7 | 424 | 197 | 227 | Nissan -> Honda |
| 8 | 389 | 209 | 180 | Nissan -> GMC |
| 9 | 337 | 121 | 216 | Nissan -> Hyundai |
| 10 | 316 | 58 | 258 | GMC -> Chevrolet |
| 11 | 311 | 163 | 148 | Nissan -> Ram |
| 12 | 279 | 86 | 193 | Nissan -> Mazda |
| 13 | 272 | 95 | 177 | Nissan -> Volkswagen |
| 14 | 265 | 115 | 150 | Mitsubishi -> Chevrolet |
| 15 | 253 | 102 | 151 | Acura -> Toyota |
| 16 | 244 | 116 | 128 | Honda -> Toyota |
| 17 | 179 | 38 | 141 | Ford -> Chevrolet |
| 18 | 178 | 69 | 109 | Mitsubishi -> Ford |
| 19 | 175 | 98 | 77 | Honda -> Chevrolet |
| 20 | 166 | 61 | 105 | Mitsubishi -> Jeep |

Spot check of the biggest WMI/stored-make groups by model (active rows): `3N1`+Infiniti = Sentra/Kicks/Versa; `5FN`+Acura = Pilot/Odyssey/Passport; `5J8`+Honda = MDX/RDX; `1HG`+Acura = Accord; `KM8`+Nissan = Palisade/Kona/IONIQ 5; `1FT`+Nissan = F-150/Super Duty/Ranger; `1C4`+Nissan = Wrangler/Grand Cherokee/Durango; `4S4`+Honda = Outback/Ascent/Forester; `1G1`+Nissan = Malibu/Corvette/Camaro. The model agrees with the VIN every time: these are real mislabels (roster-brand fallback on a multi-franchise lot), not table errors.

### The one table error found: `7YA` (Kia Sportage Hybrid)
The old #1 pair, **Kia -> Hyundai, 1,413 active rows (1,415 with two others), was wrong**: every one is a **2027 Kia Sportage Hybrid** built at the Georgia metaplant, whose WMI `7YA` `vinWmi.js` lists as Hyundai only (it also builds the IONIQ 5/9). Applying the rule as written would have turned them into Hyundais. The script therefore excludes `7YA` (`EXCLUDE_WMI`, reported as `excluded-wmi`). **Separate, bigger point:** `vinWmi.js` is the file in the not-yet-installed make-wmi crawler/deals-api patch (`docs/box-patches/2026-10-26-make-wmi/`); installed as is, the crawler and the write path would do the same to new Sportage Hybrids every night. Fix the table (`7YA` -> Hyundai, Kia, Genesis) in its own PR before that patch goes on a box; that changes the pinned md5s there, so it is deliberately not done here.

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
1. **Dry run** (reader account, no lock, writes nothing; ~10-15 min with removed rows). Read the pairs: they must match the table above (plus whatever arrived overnight) and `excluded-wmi` must be about 1.4k active; **STOP if any pair you do not recognise has a large count**:
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
Nothing was written on box2; the apply path was tested only against an in-memory table, never against MariaDB. A dry run of the emitted bundle was executed on box2 for four WMIs (read-only) and matched the full count. Out of scope: the ~3,200 shared-WMI rows (vPIC step), the 479 blank makes, and the `7YA` table fix.
