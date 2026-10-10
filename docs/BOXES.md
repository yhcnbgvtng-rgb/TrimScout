# Boxes — single source of truth

**Read this before touching any box.** Never trust IPs in old script comments. Work from a fresh worktree off `origin/main`.
Machine-readable mirror: [`config/boxes.json`](../config/boxes.json) (loaded by `config/boxes.mjs`); `test/boxes_doc.test.mjs` fails if the two disagree or a retired IP appears anywhere else in the repo.

Legend: **[given]** supplied by Paul 2026-10-10 · **[repo]** read from code/docs in this repo · **UNVERIFIED** not confirmed against the live machine (this doc was written read-only, no SSH).

Last verified: **2026-10-10 against Paul's statement and the repo only — no box was contacted.** Update the date when someone re-checks a box live.

| | box1 | box2 (crawler + deals box) | box3 | box4 |
|---|---|---|---|---|
| Public IP | 34.203.148.79 [repo: fleet-report.mjs] | 52.202.234.65 [given] | 184.73.158.210 [repo] | 100.50.85.234 [repo] |
| Private IP | 172.26.1.32 [given] | UNVERIFIED (not supplied) | 172.26.15.105 [given] | 172.26.11.241 [given] |
| SSH user | `ubuntu` [repo] | `ubuntu` [repo] | `ubuntu` [repo] | `ubuntu` [repo] |
| SSH alias | `box1` — ProxyJump via box2 [given] | `box2` — direct [given] | `box3` — ProxyJump via box2 [given] | `box4` — ProxyJump via box2 [given] |
| Role | Crawl box (expansion/core state slices) [repo: CAPACITY_SLA.md] | Crawl box **and** the deals box: deals API `:3004`, auth/directory API `:3003`, MariaDB, crawl-claim queue [repo: SPIKE_RUNBOOK.md] | Crawl box; TX shard [repo: SYNC_FRESHNESS.md] | Crawl box; FL shard [repo] |
| Last verified | 2026-10-10 (doc only) | 2026-10-10 (doc only) | 2026-10-10 (doc only) | 2026-10-10 (doc only) |

The "deals box" is **box2** — there is no separate machine (older scripts that said a different IP for "the deals box" were stale).
SSH aliases live in each person's `~/.ssh/config`, not in this repo; the alias definitions above are **[given], UNVERIFIED** here.

## Checkout paths

| Box | Path | Branch / state |
|---|---|---|
| box2 crawler | `/home/ubuntu/nj-scraper` | `cursor/nj-crawler-ops-36e4`, **150 commits behind `main` as of Oct 10** [given] — do not assume it has current code |
| box2 deals API | `/opt/trimscout-deals` (server files in `/opt/trimscout-deals/src/`, pm2 `trimscout-deals-api`) | not a git checkout; files are copied in by box patch scripts [repo: docs/SPIKE_RUNBOOK.md, INVENTORY_SYNC_SPEED.md] |
| box1, box3, box4 crawler | `~/nj-scraper` (`nj-scraper/scrapers/lightsail-crawler`) [repo: fleet-report.mjs] | branch UNVERIFIED |
| Inventory sync client (all crawl boxes) | `~/inventory-sync/` [repo: INVENTORY_SYNC_SPEED.md] | a deploy dir; copy only on Paul's GO |

## Cron and CRAWL_STATES

**UNVERIFIED for every box** — live crontabs are not in the repo and were not read. What the repo documents:
- Each box's nightly crawl is one crontab line (or `scripts/run_nightly_chain.sh` with `CHAIN_EXPANSION_ENV` / `CHAIN_CORE_ENV`) that sets `CRAWL_STATES=<slice>`; `CRAWL_STATES` is the *order* of claims tried, not an exclusive allotment (CAPACITY_SLA.md).
- Inventory → deals sync: nightly, ~06:15 ET on the crawl boxes [memory notes; UNVERIFIED].
- Dual-crawled states per `docs/SYNC_FRESHNESS.md` (from the four crontabs at that time): AL, CA, GA, IA, IN, LA, MA, MI, MN, MO, NC, NJ, NY, OH, OK, PA, TN, TX, VA.
- Do not copy state lists from this doc; run `crontab -l` on the box and paste the result here with the date when you verify.

| Box | Cron lines | CRAWL_STATES |
|---|---|---|
| box1 | UNVERIFIED | UNVERIFIED (13-state list as of 2026-09 per CAPACITY_SLA.md) |
| box2 | UNVERIFIED | UNVERIFIED |
| box3 | UNVERIFIED | UNVERIFIED (TX shard) |
| box4 | UNVERIFIED | UNVERIFIED (FL shard) |

## Do not use

Retired addresses. They are dead or belong to someone else now. They may appear **only here**; `test/boxes_doc.test.mjs` fails if they show up anywhere else in the repo.

<!-- DEAD-IPS:START -->
- 3.208.49.1 — old deals box IP
- 3.237.204.55 — old deals box IP (older scripts called it "box2")
- 98.92.140.11 — old box1 public IP
- 34.205.155.92 — original single Lightsail crawler; not any current box
<!-- DEAD-IPS:END -->

## Changing a box address

Edit `config/boxes.json` **and** this file in the same PR; the test checks they agree. Scripts that run standalone on a box (`scripts/box/inventory-sync.mjs`, `scrapers/lightsail-crawler/src/crawl_claims.js`) keep an inline default of the deals host because they are copied to boxes without the repo; the test pins that default to this doc. Set `TRIMSCOUT_DEALS_HOST` to override.
