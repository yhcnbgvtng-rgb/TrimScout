# Box patch: crawl politeness refit (#605 + #606) against each box's own files

Code and docs only. **Nothing here is installed and no box was written to.** On 2026-10-28 the four source files below were copied **read-only** (scp through box2) from box4, box1 and box3 into `box-src/<box>/`; no `.env`, key or config file was copied. The patches in `patches/<box>/` are `diff -u` of those exact copies, and `scrapers/lightsail-crawler/test/politeness_box_refit.test.js` pins every md5 below and applies every patch in CI.

The earlier `docs/box-patches/2026-10-27-crawl-politeness/` patches (#605) were cut against origin/main and **do not apply** to the boxes' `standalone.js` (2 of 17 hunks reject on all three boxes; box1's `http_probe.js` and `dealer-bot-report.mjs` reject too). This directory replaces them for the boxes. Install only on Paul's typed **GO**, in an idle window, one box and one numbered step at a time, **box4 first, then box1, then box3.**

Crawler dir on each box: `/home/ubuntu/nj-scraper/scrapers/lightsail-crawler` (`$C` below). Aliases/jumps: `docs/BOXES.md`.

## md5 table (files as copied 2026-10-28 -> after the patch)
| Box | File | Before | After |
|---|---|---|---|
| box4 | `src/standalone.js` | `a1f4e0bf9228bedb4ca8e2a567b2fb54` (make-wmi installed, incl. #597/#608) | `d05cd479b8f8d22a77d4d9fb1ef2e31a` |
| box4 | `src/http_probe.js` | `5930f6d2e458c12797151b59b4a6ced4` | `099540146a853c5e36fbfadd0d25e50d` |
| box4 | `scripts/dealer-bot-report.mjs` | `b1fe50a16ae9043f622ca5c6d92d360d` | `35a0904b5566ad619be0aac5e4a84400` |
| box3 | `src/standalone.js` | `2e69d8748b9addbff93dac618bb71f1e` (make-wmi **not** installed) | `3523e7367d3b862a38b00a4dd6a62695` |
| box3 | `src/http_probe.js` / `scripts/dealer-bot-report.mjs` | same as box4 before | same as box4 after |
| box1 | `src/standalone.js` | `02f73e161e29dde0fe0633759328c9a8` (make-wmi **not** installed) | `627a49f3fe9c470469dd203d95de1bf6` |
| box1 | `src/http_probe.js` | `f4ee7e9eb577fa83e06ffafc2ebf3289` | `018a7068f43b6ce5a3ff4e21b25287cb` |
| box1 | `scripts/dealer-bot-report.mjs` | `e566bafffd5627888cd1d5e1bf8cc6ff` | `6272b480e5e0a81fb7034953d4a8ae98` |
| all | `src/politeness.js` (new) | absent | `f42053242068b414cb400da303ddee9d` |

Any other "before" md5 on the night: **stop and report**, do not improvise.

**Order with the make-wmi patch (`2026-10-26-make-wmi`)** on box1/box3: either order works. box3 + make-wmi gives `a1f4e0bf…`, and box4's standalone patch then applies to it (result `d05cd479…`); box1's patch also applies after make-wmi (the md5 then differs from the table, so only the syntax check applies). Do not rely on the table's "after" md5 for box1/box3 if make-wmi went in first; use box4's patch for box3 in that case.

## Not in this refit
- `scripts/run-crawl-queue.mjs` (#605's loud-skip change) **does not exist on box1, box3 or box4** (the crawl queue is not installed there), so there is nothing to patch. Take it with the queue cutover.
- Behaviour, knobs and rollback are as in `2026-10-27-crawl-politeness/STEPS.md`: per-domain gate (`CRAWLER_DOMAIN_CONCURRENCY` default 6, `CRAWLER_DOMAIN_MIN_GAP_MS` 100), 429 backoff, a 403 halts the store for the night, spread of sister stores, **and the patchright fallback is deleted** (#606). Throughput impact is not measured.

## Install, per box (stop at any failed check)
Work from this directory's copy on the Mac; replace `BOX` with `box4`, then `box1`, then `box3`.

1. **Idle + time.** On the box: `pgrep -fa '^node .*(standalone|run-daily-crawl|inventory-sync)|run_nightly_chain|run_sync' | grep -v pgrep` prints nothing, sync lock free, before 21:50 ET (crons start 22:00).
2. **Drift check (read-only).** `ssh BOX 'cd ~/nj-scraper/scrapers/lightsail-crawler && md5sum src/standalone.js src/http_probe.js scripts/dealer-bot-report.mjs'` must equal the "Before" column.
3. **Stage and dry-run on a copy, off the checkout.**
   ```
   ssh BOX 'rm -rf ~/politeness-stage && mkdir -p ~/politeness-stage/src ~/politeness-stage/scripts && cd ~/nj-scraper/scrapers/lightsail-crawler && cp -p src/standalone.js src/http_probe.js ~/politeness-stage/src/ && cp -p scripts/dealer-bot-report.mjs ~/politeness-stage/scripts/'
   scp -J box2 -i ~/.ssh/LightsailDefaultKey-us-east-1.pem -o IdentitiesOnly=yes -r docs/box-patches/2026-10-28-politeness-refit/{politeness.js,patches/BOX} ubuntu@<BOX private IP>:politeness-stage/
   ssh BOX 'cd ~/politeness-stage && for f in standalone.js:src http_probe.js:src dealer-bot-report.mjs:scripts; do patch -p1 -s < BOX/${f%%:*}.patch; done; cp politeness.js src/; md5sum src/* scripts/*; for x in src/*.js scripts/*.mjs; do cp $x /tmp/chk.mjs && node --check /tmp/chk.mjs || echo SYNTAX FAIL $x; done'
   ```
   The patched md5s must equal the "After" column and no `SYNTAX FAIL`. (Only `~/politeness-stage` is written here; the checkout is untouched.)
4. **Backup** the live three files: `mkdir -p ~/backups/politeness-refit-<stamp> && cp -p <3 files> there && md5sum <3 files> > md5sums-before.txt`.
5. **Install** by copying the three staged files over the live ones plus `src/politeness.js`; `politeness.js` first, `standalone.js` last. `md5sum` them against the table, `node --check` each, and `node -e "import('./src/politeness.js')"` from `$C`.
6. **Dry run, no crawl:** `node scripts/dealer-bot-report.mjs --state=OK --brand=Mazda` (one request per store). Expect normal classes and a `notReady` array in the JSON. Do not run a full crawl as the check.
7. **First night:** leave crons alone. Next morning compare 429/403/5xx skips and wall-clock hours with the previous night (`docs/CAPACITY_SLA.md`). If a night runs long, raise `CRAWLER_DOMAIN_CONCURRENCY` before anything else. Install the next box only after box4 has run one night clean.

## Rollback
Copy the three files back from `~/backups/politeness-refit-<stamp>/` and check md5 against `md5sums-before.txt`. `politeness.js` is only imported by the patched files; leaving it is harmless. Soft rollback without restoring: `CRAWLER_DOMAIN_CONCURRENCY=8 CRAWLER_DOMAIN_MIN_GAP_MS=0 CRAWLER_SPREAD_SCHEDULE=false` (the 403 halt and 429 backoff stay).

## Verified here / not verified
- Verified: copies' md5s (box4 `standalone.js` is `a1f4e0bf…`), each patch applies to its copy and gives the md5 above, `node --check` passes on all outputs, no patchright/`withProbeRetry` left in `standalone.js`, ordering with make-wmi (test file).
- Not verified: a real crawl with the patched files (needs the box's `node_modules` and data), and throughput. Two of 17 `standalone.js` hunks and box1's `http_probe.js` / `dealer-bot-report.mjs` hunks were refitted by hand against the box text; the dry run in step 6 is the first run of that code.
