# Boxes — single source of truth

**Read this before touching any box.** Never trust IPs in old script comments. Work from a fresh worktree off `origin/main`.
Machine-readable mirror: [`config/boxes.json`](../config/boxes.json) (loaded by `config/boxes.mjs`); `test/boxes_doc.test.mjs` fails if the two disagree or a retired IP appears anywhere else in the repo.

Legend: **[verified]** read-only check from Grok Bot's computer, 2026-10-10 08:15 ET · **[repo]** read from code/docs · **UNVERIFIED** not confirmed live.

Last verified: **2026-10-10 08:15 ET** for box2/3/4 (read-only, from Grok Bot's computer). **box1 (v2) and box5 are from Paul's 2026-11-03 report, not re-checked live.** Update the date when someone re-checks a box live.

**2026-11-03 fleet change:** box1 was replaced by **box1-v2** (new machine, same label `box1`), and **box5** (Lightsail `crawler-box-5`) was added. The old box1 was deleted on **2026-11-04** (see Retired boxes).

| | box1 (v2) | box2 (crawler + deals box) | box3 | box4 | box5 (new) |
|---|---|---|---|---|---|
| Public IP | 3.211.168.213 (static IP `StaticIp-1`) | 52.202.234.65 (static IP `trimscout-box2-static`) | 184.73.158.210 (static IP `trimscout-box3-static`) | 100.50.85.234 (static IP `trimscout-box4-static`) | 18.209.128.97 (static IP `trimscout-box5-static`) |
| Private IP | 172.26.5.232 | 172.26.6.89 (was 172.26.14.74 until 2026-11-04) | 172.26.15.105 | 172.26.11.241 | 172.26.13.207 |
| Size | 4 vCPU / 16 GB, $84/mo | 4 vCPU / 32 GB, $144/mo, Lightsail `crawler-box-2-v2` (bundle `m_xlarge_1_0`, us-east-1a), static IP `trimscout-box2-static`; MariaDB `innodb_buffer_pool_size` 20G | UNVERIFIED (4 vCPU / 15 GB per CRAWL_QUEUE.md) | UNVERIFIED | 8 vCPU / 32 GB, $164/mo, Ubuntu 24.04 (Lightsail `crawler-box-5`) |
| SSH user | `ubuntu` | `ubuntu` | `ubuntu` | `ubuntu` | `ubuntu` |
| SSH alias | `box1`, ProxyJump via box2 (private IP) | `box2`, direct | `box3`, ProxyJump via box2 (private IP) | `box4`, ProxyJump via box2 (private IP) | `box5`, ProxyJump via box2 (private IP) |
| Role | Crawl box | Crawl box **and** the deals box: deals API `:3004`, auth/directory API `:3003`, MariaDB, dealer-analytics, crawl-claim queue [repo: SPIKE_RUNBOOK.md] | Crawl box (expansion + core chain) | Crawl box (expansion + core chain) | Crawl box (started 2026-11-03) |
| Last verified | 2026-11-03 (Paul's report) | 2026-11-04 (new instance, read-only checks; other rows 2026-10-10) | 2026-10-10 | 2026-10-10 | 2026-11-03 (Paul's report) |

**2026-11-04 box2 rebuild:** box2 moved to a new Lightsail instance, `crawler-box-2-v2` (m_xlarge_1_0, 4 vCPU / 32 GB), restored from snapshot `box2-phase2-20261104-clean` (taken after MariaDB was stopped cleanly). The public IP 52.202.234.65 (static IP `trimscout-box2-static`) moved to the new instance; the **private IP changed to 172.26.6.89**. Buyer downtime was about 60 minutes (17:19-18:18 ET), almost all of it the snapshot. The old instance `crawler-box-2` is **stopped and kept as the rollback** (rolling back loses any writes made after 2026-11-04 18:18 ET); an older snapshot, `box2-warm-20261104`, is also kept. The new instance has a new SSH host key, so clear the old `known_hosts` entry for 52.202.234.65. Nothing in the boxes' crontabs, `inventory-sync` env or crawler config referenced the old private IP (checked 2026-11-04).

**box5 now has a static IP (2026-11-04).** `trimscout-box5-static` = 18.209.128.97 replaced the old dynamic public IP (listed under Do not use); the private IP is unchanged (172.26.13.207). It survives stop/start (the 2026-09-28 billing-gate outage changed the old dynamic IPs). Still prefer the box2 ProxyJump route. box5's `~/inventory-sync/run_sync_when_safe.sh` has `MAX_WAIT_S=90000` (25 h) as of 2026-11-04.

**Port 22 (SSH) is open only to `108.53.209.159/32` and `172.26.0.0/16`.** From anywhere else the boxes are unreachable; the private `172.26.x.x` addresses work only from inside the Lightsail VPC (e.g. via box2).

**Planned (not done):** the 7 states box2 still crawls (MD, CO, AL, OR, VT, WY, ND) move to box1-v2, and box2 becomes buyers-only (deals API, MariaDB, dealer-analytics, no crawl). The 32 GB plan is done (2026-11-04); the crawl move is not. Until that happens the tables below show the current state.

Box2/3/4 values in the table are **[verified]** (2026-10-10) except Role text marked [repo]; box1-v2 and box5 values come from Paul's 2026-11-03 report. SSH key (from Grok Bot's computer): `~/.ssh/lightsail_key.pem`, user `ubuntu`. The "deals box" is **box2** — there is no separate machine (older scripts naming another IP were stale).

## Checkout paths

| Box | Crawler path | Branch |
|---|---|---|
| box1 (v2) | UNVERIFIED (new machine; check before assuming the old path/branch) | UNVERIFIED |
| box2 | `/home/ubuntu/nj-scraper` | `cursor/nj-crawler-ops-36e4` |
| box3 | `/home/ubuntu/nj-scraper` | `expansion-brands` |
| box4 | `/home/ubuntu/nj-scraper` | `expansion-brands` |
| box5 | UNVERIFIED (new machine) | UNVERIFIED |

- box2 deals API: `/opt/trimscout-deals` (server files in `src/`, pm2 `deals-api`). Not a git checkout; patched by box patch scripts.
- Inventory sync client: `~/inventory-sync/` (`run_sync_when_safe.sh`) on each crawl box. Copy into it only on Paul's GO. (box1-v2 and box5 need it installed/checked: UNVERIFIED.)

## Known drift

As of 2026-10-10 the four then-existing crawler checkouts (box1 was the old machine, now retired; box1-v2 and box5 are not covered by this paragraph) were at `b8ea6e3` (2026-09-22), **150 commits behind `origin/main`**, each with **560–860 uncommitted local files**. Crawler-side PRs merged after Sept 22 are **NOT running on the boxes** unless they were hand-copied. The deals-api in `/opt/trimscout-deals` is patched separately and **is current**. Before assuming a crawler change is live, check the file on the box.

## Cron and CRAWL_STATES (all times ET; box2/3/4 verified 2026-10-10, box1-v2/box5 per Paul 2026-11-03)

| Box | Cron | CRAWL_STATES | Settings |
|---|---|---|---|
| box1 (v2) | 22:00 crawl; sync 22:05 via `~/inventory-sync/run_sync_when_safe.sh` (Paul, 2026-11-03) | AK,AZ,CT,DE,IA,ID,KS,LA,MN,RI,VA | `CRAWLER_MAX_CONCURRENT_STATES=2` (P90 / lite settings: UNVERIFIED on the new machine) |
| box2 | 22:00 `run-daily-crawl`; sync 22:10 (UNVERIFIED since box5 split) | MD,CO,AL,OR,VT,WY,ND (was 21 states until 2026-11-03; the rest moved to box5) | concurrency and P90: UNVERIFIED since the split (were 6 / 30). **Planned: these 7 states move to box1-v2 and box2 stops crawling.** |
| box3 | 22:00 `run_nightly_chain.sh` | expansion: AL,IA,IN,LA,MI,NJ,OH,PA,TX,VA,WI; then core: AR,MA,MO,NH,SC,SD,NE,UT,WI (2026-10-10; **not re-checked after box1-v2/box5**: several overlap box5's states, confirm before relying on it) | expansion concurrency 4, max 1000/dealer; core concurrency 6 |
| box4 | 22:00 `run_nightly_chain.sh` | expansion: CA,FL,GA,IL,KY,MA,MN,MO,NC,NY,OK,TN; then core: FL,HI,IL,KY,MI,MS,NJ,NM,WA (2026-10-10; **not re-checked after box5**: confirm) | not reported (concurrency/limits UNVERIFIED) |
| box5 | 22:00 crawl; sync 22:05 (Paul, 2026-11-03) | NY,OH,PA,CA,TX,NC,GA,TN,IN,OK,ME,NV,WV,MT | concurrency 4 |

`CRAWL_STATES` order is the order claims are tried, not an exclusive allotment (CAPACITY_SLA.md). Re-verify with `crontab -l` before relying on these.

## Crawl queue mode (flag off by default — docs/CRAWL_QUEUE.md)

With `data/crawl_queue/flag.json` enabled on a box, the 22:00 crons above are unchanged but `CRAWL_STATES` stops mattering: workers (box3, box4) take
(state, brand) shards from a queue hosted on box2, box2 (`role: host`) does not crawl and its sync exits at once, and each worker's sync uploads only
the shards in its own manifest. box1 (v2) and box5 stay on their fixed crons until they have the per-brand shard code (#480). The queue plan was written for the four-box fleet; revisit it before the flag is turned on. Flag off (the default) = everything above as written.

## Retired boxes

| Box | Public IP | Private IP | Status |
|---|---|---|---|
| old box1 (Ubuntu-1) | released (see Do not use) | 172.26.1.32 | Replaced by box1-v2 on 2026-11-03. **Deleted 2026-11-04**; its static IP `trimscout-box1-static` was released. Snapshot `box1-pre-upgrade-2026-11-02` is kept for about a week. Do not SSH to it or deploy to it. Older `docs/box-patches/*` STEPS still name 172.26.1.32 as box1; those are historical records, use the table above. |


## Do not use

Retired addresses. They are dead or belong to someone else now. They may appear **only here**; `test/boxes_doc.test.mjs` fails if they show up anywhere else in the repo.

<!-- DEAD-IPS:START -->
- 3.208.49.1 — old deals box IP
- 3.237.204.55 — old deals box IP (older scripts called it "box2")
- 98.92.140.11 — old box1 public IP
- 34.205.155.92 — original single Lightsail crawler; not any current box
- 34.203.148.79 — old box1 (Ubuntu-1) static IP `trimscout-box1-static`, released 2026-11-04
- 44.200.197.211 — box5's old dynamic public IP, replaced by the static IP on 2026-11-04
<!-- DEAD-IPS:END -->

## Changing a box address

Edit `config/boxes.json` **and** this file in the same PR; the test checks they agree. Scripts that run standalone on a box (`scripts/box/inventory-sync.mjs`, `scrapers/lightsail-crawler/src/crawl_claims.js`) keep an inline default of the deals host because they are copied to boxes without the repo; the test pins that default to this doc. Set `TRIMSCOUT_DEALS_HOST` to override.
