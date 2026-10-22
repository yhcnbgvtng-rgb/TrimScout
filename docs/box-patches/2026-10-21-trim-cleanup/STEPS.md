# Box patch: trim cleanup at ingest (#570, f49fa59) + one-time re-clean of stored trims

Code only on the PR branch `feat/trim-cleanup-box-patch`. Nothing here has been run, and no box was read or touched while writing it. Do each box in a no-crawl window, one box at a time, on Paul's own typed GO. No restart: every crawl is a fresh Node process, so the next 22:00 start loads the patched files.

## What #570 changes, and which box files that touches
| Where | File | Touched by #570? | Shipped by this patch? |
|---|---|---|---|
| crawl boxes 1, 3, 4 (`~/nj-scraper/scrapers/lightsail-crawler`) | `src/ingestSanitize.js` (+38 lines: `decodeHtmlEntities`, `cleanTrim`) | yes | **yes** |
| crawl boxes 1, 3, 4 | `src/standalone.js` (+1 import name, +2 lines calling `cleanTrim` before the window-sticker step) | yes | **yes** |
| crawl boxes | `src/db.js` | yes (1 call) | **no**: only `mclaren_crawler.js` imports it; the nightly path (`standalone.js` -> shards -> sync) never loads it |
| box2 deals-api (`/opt/trimscout-deals/src/deals_api_server.js`) | - | **no** | n/a. Trims reach deals-api already cleaned by the patched crawl boxes through the nightly sync; deals-api itself has no trim rule and is not restarted. (Follow-up if wanted: apply the same `cleanTrim` in the sync upsert's `INV_STR(v.trim)` so an unpatched box can never write a dirty trim.) |
| box2's own crawl (box2 crawls 19 states) | same two files | yes, **if** box2 runs `standalone.js` from a checkout | **not determined**: this session did not read box2. Tell me the directory (it is not `/opt/trimscout-deals/src`, which is the deals-api tree) and the same `drift-check.sh` runs there with the directory as its argument |

There is **no env-var off switch** for this change (#570 did not add one). The way back is the file restore in step 6.

## Patch and md5s
| # | File | md5 |
|---|---|---|
| 1 | `01-clean-trim.patch` (paths relative to `scrapers/lightsail-crawler`, `patch -p1`; git diff of #570 for the two files) | `a9192b3c500e7cf1cdeea4fda87f47a3` |
| - | `drift-check.sh` | `29fca34d8483207391c6ccbe0d4d43fe` |

md5s of the two files, repo side (main, which is what the patch was cut from; a box's `standalone.js` is hand-patched and will normally differ, so on a box the **drift check output is the authority**):
| File | before (b7a1e1d) | after (f49fa59) |
|---|---|---|
| `src/ingestSanitize.js` | `5104868c6d9639f377c3bf948b603b06` | `58e0bd3167a0f19a20e6521bd360a62f` |
| `src/standalone.js` | `6f45cc081243bbc7ab0ce41d66d3f27d` | `ee0df6ee1b69e1c622ff8451123727b8` |

Boxes' known `standalone.js` md5s from earlier work (before #570 is applied): box3/box4 `718da826…` (after #564/#565), box1 `0eb20a19…`. Their after-md5s are NOT known here and are not guessed: `drift-check.sh` prints the patched-copy md5s and step 5 must match them.
Repo-side proof: the patch applied to main's pre-#570 files produces exactly the after md5s above, and `drift-check.sh` passes against that copy, reports ALREADY PATCHED on the post-#570 files, and FAILS (as it should) on 2026-09-27 files. The patch applies cleanly to the repo's versions of both files from 2026-10-07 onward; the boxes' own versions were not read.
The boxes' checkouts are hand-patched and dirty: do NOT `git pull`, `git merge` or `git commit` there. Box IPs: box1 34.203.148.79, box3 184.73.158.210, box4 100.50.85.234.

## Steps (repeat per box; set `BOX` to the IP)
0. From the Mac, in the repo checkout:
```bash
P=docs/box-patches/2026-10-21-trim-cleanup; ssh -i ~/.ssh/trimscout_box_2026 ubuntu@BOX 'mkdir -p /tmp/tc'
scp -i ~/.ssh/trimscout_box_2026 $P/{01-clean-trim.patch,drift-check.sh} ubuntu@BOX:/tmp/tc/
```
1. On the box, preconditions (stop if anything prints a process, or if it is past 21:30 ET) and file integrity:
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
cd /tmp/tc && md5sum *   # patch a9192b3c500e..., drift-check.sh 29fca34d8483...
```
2. Drift check + dry run (read-only, works on copies). It must end `DRIFT CHECK PASS`, or `ALREADY PATCHED`; save its "md5 of the patched COPIES" block:
```bash
bash /tmp/tc/drift-check.sh        # default dir: ~/nj-scraper/scrapers/lightsail-crawler
```
   If it says FAIL, stop for that box and send back its md5 lines and output (an old `ingestSanitize.js` or a `standalone.js` without the `resolveMileage` line needs a different patch).
3. Backup (record the md5s):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/trim-cleanup-20261021; mkdir -p $B; cp -p src/standalone.js src/ingestSanitize.js $B/; (cd $B && md5sum *.js | tee md5s.txt)
```
4. Apply and verify:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && patch -p1 < /tmp/tc/01-clean-trim.patch
md5sum src/standalone.js src/ingestSanitize.js   # must equal the step 2 patched-copies block
for f in standalone ingestSanitize; do cp src/$f.js /tmp/chk.mjs && node --check /tmp/chk.mjs || echo "SYNTAX FAIL $f"; done; rm -f /tmp/chk.mjs; echo SYNTAX_DONE
grep -c "cleanTrim" src/standalone.js src/ingestSanitize.js   # expect 3 and 1
```
5. Restore (puts the backed-up files back and re-checks against `md5s.txt`):
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/trim-cleanup-20261021; cp -p $B/standalone.js $B/ingestSanitize.js src/; cat $B/md5s.txt; md5sum src/standalone.js src/ingestSanitize.js
```
(Step numbering: the restore is step 5; the "6" some earlier patch docs used for restore does not apply here.)

## What to watch
Values change only when a car's page is fetched again. After the first crawl on a patched box, from box2's reader account, **index-bounded counts only** (always name a make and model; no table scan):
```sql
SELECT trim, COUNT(*) FROM dealer_inventory FORCE INDEX (idx_inv_make_model_trim) WHERE make='Ford' AND model='Bronco' GROUP BY BINARY trim;
```
Rows from that box's dealers should no longer show `&reg;`, `®` or a trailing 4WD/AWD/4x4/RWD/FWD/2WD (Kia keeps its drivetrain word by design). Known side effect: nothing stores drivetrain separately, and the admin "by drivetrain" analytics (`INV_DRIVETRAIN`) infer it from `trim`/`engine`/`body_style`, so a car that carried its drivetrain only in the trim leaves that bucket.

# Re-clean of rows already in the database (`scripts/box/2026-10-21-trim-reclean.mjs`)
**Order matters: patch the crawl boxes first.** A dirty trim from an unpatched box is written straight back by its next sync. Run this only after all crawling boxes carry the patch above, in a no-crawl, no-sync window, on Paul's GO per phase. The script runs only on box2 (it needs the DB and the sync-lock endpoints) and the box has no checkout, so it ships as one stdin-piped bundle built on the Mac. (The pattern is the same as `scripts/box/2026-10-16-option-reclean.mjs`; there is no file literally named `reclean.bundle.mjs` in the repo.)

How it stays cheap: every query is bounded by make AND model. Makes and models are found by one-seek index skip-scans; a model's distinct trims come from the covering index `idx_inv_make_model_trim`; a dirty trim's rows are one equality range on it. Each query is capped at 20 s (`max_statement_time`), a timeout is retried once with the rows split by year, a second timeout stops the run. No VINs are printed or put in any summary.

Phases (all take `--makes=Ford,Kia`, `--model=F-150` with one make, `--deadline-et=21:40`, `--pause-ms=250`, `--out=DIR`):
| Phase | DB account | Writes | What it does |
|---|---|---|---|
| `selftest` | none | nothing | proves the bundle loads and the rule behaves |
| `dryrun` | **reader** | **nothing** (no files, no DB) | counts only: rows to change per make, by reason (entity / mark / drivetrain / whitespace), distinct trims, how many cleaned trims already exist on the model (facet merges), top-30 `from -> to` pairs. Refuses while the sync lock is held |
| `plan` | reader | `--out`: `plan.jsonl` (0600; one line per row: batch, make, model, **vin, dealer_id**, old trim, new trim), `batches.json`, `plan-summary.json` (counts + md5 of `plan.jsonl`) | the exact rows to change. VINs live only in this file on box2, because restore cannot find a row without its key; nothing prints or ships them |
| `apply` | **writer** | `dealer_inventory.trim` only (BEFORE UPDATE trigger keeps `trim_rev` in step) | takes the sync lock (heartbeated), one transaction per batch of **<= `--batch` rows (default 2,000, hard cap 5,000)**, every UPDATE guarded by the OLD trim so a row changed since the plan is skipped; checkpoint after each batch (resumes); hard stop at the deadline; refuses if `plan.jsonl` no longer matches its summary md5 |
| `verify` | reader | nothing | re-reads the applied rows by primary key: stillDirty must be 0; reports rows already at the planned value / changed since / gone |
| `restore` | writer (only with `--go`) | `dealer_inventory.trim` back to the old value | dry by default; only rows that still hold the cleaned value; `--through-batch=N` for a partial undo |

Runbook (from the Mac, repo checkout; `node_modules` present for esbuild):
```bash
node scripts/box/2026-10-21-trim-reclean.mjs --emit > /tmp/trim-reclean.bundle.mjs
K="-i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65"; R='cd /opt/trimscout-deals && node --input-type=module -'
ssh $K "$R --phase=selftest" < /tmp/trim-reclean.bundle.mjs
ssh $K "$R --phase=dryrun" < /tmp/trim-reclean.bundle.mjs > dryrun-counts.json     # reader, writes nothing
# review dryrun-counts.json with Paul; then, on a typed GO:
ssh $K "$R --phase=plan --out=/home/ubuntu/trim-reclean-20261021" < /tmp/trim-reclean.bundle.mjs
ssh $K "$R --phase=apply --out=/home/ubuntu/trim-reclean-20261021 --batch=2000" < /tmp/trim-reclean.bundle.mjs
ssh $K "$R --phase=verify --out=/home/ubuntu/trim-reclean-20261021" < /tmp/trim-reclean.bundle.mjs
# undo, if ever: --phase=restore (dry) then --phase=restore --go
```
After a real apply: rebuild the option facets the usual way (`inv_option_facets` / `inv_option_summary` are keyed on trim and still hold the old spellings until then; this script never touches them), and delete the `--out` directory when done (it holds VINs).
Not measured: how long the dry run takes on the live table (it is index-only, bounded per model; the existing option re-clean's batch/pause rails are reused). Watch box2's load on the first `--makes=Mazda` trial before running all makes.
