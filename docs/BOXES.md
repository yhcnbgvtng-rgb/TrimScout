# Boxes — single source of truth

**Read this before touching any box.** Never trust IPs in old script comments. Work from a fresh worktree off `origin/main`.
Machine-readable mirror: [`config/boxes.json`](../config/boxes.json) (loaded by `config/boxes.mjs`); `test/boxes_doc.test.mjs` fails if the two disagree or a retired IP appears anywhere else in the repo.

Legend: **[verified]** read-only check from Grok Bot's computer, 2026-10-10 08:15 ET · **[repo]** read from code/docs · **UNVERIFIED** not confirmed live.

Last verified: **2026-10-10 08:15 ET** (read-only, from Grok Bot's computer). Update the date when someone re-checks a box live.

| | box1 | box2 (crawler + deals box) | box3 | box4 |
|---|---|---|---|---|
| Public IP | 34.203.148.79 | 52.202.234.65 | 184.73.158.210 | 100.50.85.234 |
| Private IP | 172.26.1.32 | 172.26.14.74 | 172.26.15.105 | 172.26.11.241 |
| SSH user | `ubuntu` | `ubuntu` | `ubuntu` | `ubuntu` |
| SSH alias | `box1`, ProxyJump via box2 (private IP) | `box2`, direct | `box3`, ProxyJump via box2 (private IP) | `box4`, ProxyJump via box2 (private IP) |
| Role | Crawl box | Crawl box **and** the deals box: deals API `:3004`, auth/directory API `:3003`, MariaDB, crawl-claim queue [repo: SPIKE_RUNBOOK.md] | Crawl box (expansion + core chain) | Crawl box (expansion + core chain) |
| Last verified | 2026-10-10 | 2026-10-10 | 2026-10-10 | 2026-10-10 |

All values in the table are **[verified]** except Role text marked [repo]. SSH key (from Grok Bot's computer): `~/.ssh/lightsail_key.pem`, user `ubuntu`. The "deals box" is **box2** — there is no separate machine (older scripts naming another IP were stale).

## Checkout paths

| Box | Crawler path | Branch |
|---|---|---|
| box1 | `/home/ubuntu/nj-scraper` | `cursor/nj-crawler-ops-36e4` |
| box2 | `/home/ubuntu/nj-scraper` | `cursor/nj-crawler-ops-36e4` |
| box3 | `/home/ubuntu/nj-scraper` | `expansion-brands` |
| box4 | `/home/ubuntu/nj-scraper` | `expansion-brands` |

- box2 deals API: `/opt/trimscout-deals` (server files in `src/`, pm2 `trimscout-deals-api`). Not a git checkout; patched by box patch scripts.
- Inventory sync client: `~/inventory-sync/` (`run_sync_when_safe.sh`) on each crawl box. Copy into it only on Paul's GO.

## Known drift

All four crawler checkouts are at `b8ea6e3` (2026-09-22), **150 commits behind `origin/main`**, each with **560–860 uncommitted local files**. Crawler-side PRs merged after Sept 22 are **NOT running on the boxes** unless they were hand-copied. The deals-api in `/opt/trimscout-deals` is patched separately and **is current**. Before assuming a crawler change is live, check the file on the box.

## Cron and CRAWL_STATES (all times ET, verified 2026-10-10)

| Box | Cron | CRAWL_STATES | Settings |
|---|---|---|---|
| box1 | 22:00 `run-daily-crawl`; sync 22:05 via `~/inventory-sync/run_sync_when_safe.sh` | AK,AZ,CT,DE,IA,ID,KS,LA,MN,NY,OH,RI,VA | `CRAWLER_MAX_CONCURRENT_STATES=2`, P90=55, `CRAWLER_LITE_NIGHTLY=shadow` |
| box2 | 22:00 `run-daily-crawl`; sync 22:10 | AL,CA,CO,GA,IN,MD,ME,MT,NC,ND,NV,OK,OR,PA,TN,TX,VT,WV,WY | concurrency 6, P90=30 |
| box3 | 22:00 `run_nightly_chain.sh` | expansion: AL,IA,IN,LA,MI,NJ,OH,PA,TX,VA,WI; then core: AR,MA,MO,NH,SC,SD,NE,UT,WI | expansion concurrency 4, max 1000/dealer; core concurrency 6 |
| box4 | 22:00 `run_nightly_chain.sh` | expansion: CA,FL,GA,IL,KY,MA,MN,MO,NC,NY,OK,TN; then core: FL,HI,IL,KY,MI,MS,NJ,NM,WA | not reported (concurrency/limits UNVERIFIED) |

`CRAWL_STATES` order is the order claims are tried, not an exclusive allotment (CAPACITY_SLA.md). Re-verify with `crontab -l` before relying on these.

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
