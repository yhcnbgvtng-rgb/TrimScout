# Box patch: crawl politeness (per-domain rate limit, 429 backoff, 403 = stop the store)

Code and docs only. **Nothing is installed and no box was touched.** Install only on Paul's typed **GO**, in an idle window (no crawl, no sync running), one numbered step at a time, one box at a time. Addresses, SSH aliases and paths: `docs/BOXES.md`. The boxes' crawler checkouts are far behind `origin/main` with hundreds of local edits, so **nothing here can be `git pull`ed or blindly copied over** (see Step 2).

## Why (box2, night of 2026-10-26)
282 HTTP 429 skips, 40 HTTP 403, 36 5xx; Performance Ford Randolph / East Hanover / Somerville blocked on ~3 nights in 4 (Akamai). The old code: one fixed 45 s retry of the *probe* only, none for sitemap or page fetches; 8 page workers hammering one domain; sister stores crawled back to back; and after a 403 on a page it kept requesting the store's remaining pages.

## What changes
| Rule | Where | Behaviour |
|---|---|---|
| Per-domain cap + spacing | `src/politeness.js` `DomainGate`, used for every plain-HTTP request in `standalone.js` | at most `CRAWLER_DOMAIN_CONCURRENCY` (default 6) in flight per registrable domain, `CRAWLER_DOMAIN_MIN_GAP_MS` (default 100) between starts |
| 429 | `politeRequest` | wait `max(Retry-After, jittered exponential backoff)`, capped at 120 s; **every worker on that domain pauses** for that long; the domain's concurrency is halved (floor 1) for the rest of the run; 3 retries, then the store is given up and halted as `HTTP_429`. A `Retry-After` over 120 s gives up at once. |
| 403 / Cloudflare / Vercel challenge | `politeRequest` + dealer loop | **logged as a `🛡️ SKIP` line, the domain is halted for the rest of the run: no retry, no further request, no patchright fallback, no sitemap retry pass.** Mid-crawl: remaining URLs are not requested, the store is flagged blocked (excluded from sold-diff / sweep like any partial crawl). Nothing is bypassed. |
| 5xx | `politeRequest` | one jittered retry; never halts the domain |
| Schedule spread | `spreadSchedule` in `standalone.js` and `dealer-bot-report.mjs` | stores of one operator (same `group`, same registrable domain, or same distinctive first name word) are kept ≥3 slots apart where the list allows |
| Preflight probe | `dealer-bot-report.mjs` | 429 → Retry-After/backoff, up to 2 retries; 5xx → one jittered retry; 403 never retried. Report now has `notReady[]` (store, class, status). |
| Silent shard skip | `run-crawl-queue.mjs` | a `skipped-bot-report` shard now logs `SKIPPED TONIGHT — … <store>: <class> <status>` and records `reason` in `queue_summary_*.json` |

Log lines keep the formats `scripts/box/syncSweepGuard.js` parses (`🛡️ SKIP <store>: <CLASS> (<code>) — … [url]`, `⏳ <store>: <CLASS> — waiting`), so the sweep guard sees the new walls. Pinned by `test/politeness.test.js`.

Env knobs (all optional): `CRAWLER_DOMAIN_CONCURRENCY`, `CRAWLER_DOMAIN_MIN_GAP_MS`, `CRAWLER_SPREAD_SCHEDULE=false`, `CRAWLER_SPREAD_MIN_GAP`, `CRAWLER_PROBE_429_RETRIES`, `CRAWLER_PROBE_MAX_WAIT_MS`.

## Why OK__mazda stopped (finding, NOT confirmed on the box)
Not verifiable from the repo, and I did not touch a box. What the code shows: OK Mazda is 4 stores (Bob Moore, Nelson Tulsa, Nelson Norman, Southwest Lawton; 933 vehicles, 169–199 s a night). `run-crawl-queue.mjs` runs the bot-report preflight first and skips the whole shard when **no** store is `NONE`+200 — and the preflight was a single un-retried probe per store, in file order (the two Nelson stores adjacent), while the fleet was producing hundreds of 429/5xx. The skip returned `skipped-bot-report` with **no log line**, no manifest entry, and `entriesFromSummary` drops `skipped` rows — so the shard disappears with no error anywhere, matching "stopped after the 10-22 run, no error logged". Nothing in the git history since 10-18 touches OK, Mazda, the queue seed or the dealer files (checked), so a code change is not the cause.
This PR makes the preflight tolerant and the skip loud, so the next occurrence names the store and class. **To confirm on box2 (read-only, later, on GO):**
```
grep -l . ~/nj-scraper/logs/ok-mazda-bot-report-2026-10-2[3-7].log   # per-store classes for each night
grep -h "mazda" ~/nj-scraper/data/daily_crawl_runs/queue_summary_2026-10-2[3-7].json | head
ls -la ~/nj-scraper/data/inventory/OK__mazda.json                      # mtime = last time the shard was written
```
If the logs show all four stores `NONE 200` and no skip, the cause is elsewhere (e.g. the shard was never offered: check `[queue] … shard(s) offered` and `localDeclared`); report back rather than assuming.

## Files
```
# md5  role  file   (BASE = origin/main at 746d1f4)
f42053242068b414cb400da303ddee9d  NEW    src/politeness.js            (self-contained, no imports)
170bfcdae4deaaaab21ad6f99d3624be  BASE   src/standalone.js
2d5c59c4d59d8598ffe12dd38ad5ffa8  FINAL  src/standalone.js
5930f6d2e458c12797151b59b4a6ced4  BASE   src/http_probe.js
099540146a853c5e36fbfadd0d25e50d  FINAL  src/http_probe.js
b1fe50a16ae9043f622ca5c6d92d360d  BASE   scripts/dealer-bot-report.mjs
35a0904b5566ad619be0aac5e4a84400  FINAL  scripts/dealer-bot-report.mjs
b18261f8cd20e3d465ed96e8b1fc6607  BASE   scripts/run-crawl-queue.mjs
5982306b1244a9ab981b47f6318aaa01  FINAL  scripts/run-crawl-queue.mjs
```
`*.patch` here are `git diff origin/main` for each file: reference only.

## Install (on Paul's GO; stop at any failed check)
1. **Idle check, per box.** No `run-daily-crawl` / `run_nightly_chain` / `inventory-sync` process, sync lock free. Use anchored `pgrep -f '^node .*standalone.js'`-style patterns (an unanchored pattern matches your own ssh shell).
2. **Compare the box's files to BASE.** `md5sum` the four files above on the box. If a file equals BASE, the `.patch` applies (`patch -p1 --dry-run` first). If it differs (expected: the checkouts are ~150 commits behind with local edits), **refit**: anchor on the box's own text, do not overwrite. `src/politeness.js` is new and safe to copy as is. Test every refit on a copy with `node --check` first.
3. **Backup** each file to `~/backups/crawl-politeness-<stamp>/` with `md5sums-before.txt`.
4. **Install** `politeness.js`, then `http_probe.js`, `dealer-bot-report.mjs`, `run-crawl-queue.mjs`, then `standalone.js` last. `node --check` each; `node -e "import('./src/politeness.js')"` from the crawler dir.
5. **Dry run, no crawl:** `node scripts/dealer-bot-report.mjs --state=OK --brand=Mazda` (4 requests, one per store). Expect normal classes, a `notReady` array in the JSON, and no `429` storm. Do **not** run a full crawl as the check.
6. **First night:** leave the crons alone. Next morning compare to the 10-26 baseline: 429 skips, 403 skips, 5xx, wall-clock hours vs the SLA (`docs/CAPACITY_SLA.md`), and look for `⏳` / `🛡️ SKIP` lines naming stores. Throughput impact of the 6-per-domain cap and 100 ms gap is **not measured**; if a night runs long, raise `CRAWLER_DOMAIN_CONCURRENCY` (cron env) before anything else.

## Rollback
Restore the files from `~/backups/crawl-politeness-<stamp>/` (check md5 against `md5sums-before.txt`). `politeness.js` is only imported by the patched files; leaving it is harmless. Soft rollback without restoring: `CRAWLER_DOMAIN_CONCURRENCY=8 CRAWLER_DOMAIN_MIN_GAP_MS=0 CRAWLER_SPREAD_SCHEDULE=false` (the 403 halt and 429 backoff stay).

## Not covered / decide before GO
- **Browser fallback is unchanged and is not a rate-limit tool.** `tryPatchrightFallback` (empty sitemap, no wall detected) drives a real browser through Cloudflare's interstitial; its own comment says it clears the challenge. This PR only guarantees it is never reached after a 403/challenge/429 halt. If "never bypass Cloudflare" should be absolute, set `CRAWLER_PATCHRIGHT_FALLBACK=false` in each box's cron env (coverage cost unmeasured). Your call.
- **The gate is per process.** Two shards crawling sister stores at the same moment in different processes (queue slots, or two boxes) do not see each other. Spreading is within one shard's list; cross-shard spacing would need queue-level ordering by group (not built).
- Group detection is heuristic (`group` field, domain, name stem). Dealer files have no group field today, so the stem rule does the work; over-grouping only reorders.
- Halting by registrable domain means a 403 on any page of a site (even `/contact`) stops that whole store for the night, as requested.
