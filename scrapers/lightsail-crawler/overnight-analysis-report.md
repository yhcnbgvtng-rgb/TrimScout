# TrimScout Overnight Analysis — 2026-08-26

Investigated live via SSH on the Lightsail box (`admin@44.205.48.153`, hostname `ip-172-26-3-26`) starting ~02:44 UTC on 2026-08-26. Read-only throughout — no code, config, or data was modified. All numbers below are pulled directly from live files/logs on the box or from live HTTP requests made from the box itself; nothing is estimated or inferred without evidence, and every "could not determine" is flagged explicitly rather than guessed.

Live paths confirmed:
- Porsche: `/home/admin/porsche-tracker/` (crawler `src/standalone.js`, dealers `dealers.json`, data `data/`)
- Ford NJ: `/home/admin/ford-nj-tracker/` (crawler `src/standalone.js`, dealers `dealers.json`, data `data/`)
- PM2: `porsche-daily-crawler` (wraps `porsche-tracker/src/standalone.js`), `porsche-dashboard`, `ford-nj-dashboard`. There is **no PM2 process for the Ford crawler** — it runs only via OS crontab.
- OS crontab (`crontab -l`): Porsche at `0 6 * * *`, Ford at `30 6 * * *`, both invoking `node src/standalone.js` directly.
- Export servers confirmed live: `http://localhost:3000/export.csv` (Porsche) → HTTP 200, `http://localhost:3001/export.csv` (Ford) → HTTP 200.

---

## Part 1 — Daily change tracking: does it work, and what does it show?

### Mechanism found
Both crawlers write, per run: a full snapshot (`data/snapshots/latest_snapshot.json`), a rolling inventory file with per-vehicle `firstSeen`/`lastSeen`/`status`/`changeType`/`priceHistory` fields (`data/inventory_latest.json`), and a dated daily summary (`data/daily_changes/daily_changes_YYYY-MM-DD.json`) with `stats: { totalActiveInventory, totalNewArrivals, totalPriceDrops, totalPriceIncreases, totalSoldOrRemoved }`, a `topPriceDrops` array, and a per-dealer inventory-count breakdown. This is real, working machinery, not aspirational code — cross-checked below.

### Porsche — 3 real days of change history exist (2026-08-23, 08-24, 08-25)

| Date | Active inventory | New arrivals | Sold/removed | Price drops | Price increases |
|---|---|---|---|---|---|
| 2026-08-23 | 4,906 | 51 | 229 | 0 | 0 |
| 2026-08-24 | 4,892 | 21 | 241 | 17 | 0 |
| 2026-08-25 | 5,040 | 294 | 348 | 50 | 7 |

Cross-check: the per-vehicle fields in `inventory_latest.json` (as of the 08-25 run) independently show `status: ACTIVE=5040 / SOLD_OR_REMOVED=348` and `changeType: UNCHANGED=4689 / SOLD=348 / NEW_ARRIVAL=294 / PRICE_DROP=50 / PRICE_INCREASE=7` — an exact match to the 08-25 daily-summary numbers. The tracking mechanism is genuinely working for Porsche, not just producing plausible-looking numbers.

**Abnormality found — corrupted price-drop data on 08-24.** The top 5 entries in `topPriceDrops` for 2026-08-24 (all Porsche Norwell) show `oldPrice: 2147483647` (exactly 2^31−1, an int32 sentinel/overflow value) and a resulting `priceDiff` of roughly **−2,147,425,747** — nonsense, not a real price change. This looks like a bug in how the price-drop calculation handles a vehicle with no prior recorded price (defaults to `INT32_MAX` instead of skipping/nulling it), triggered specifically when Porsche Norwell's inventory first appeared with no baseline to compare against. By 08-25 this is gone — that day's `topPriceDrops` shows sane values (e.g. −$10,272, −$7,588, −$4,495). This is a real, reproducible data-quality defect in the price-drop feature, currently self-masked because it only shows up on a dealer's first day in the dataset.

**Abnormality found — dual, uncoordinated scheduling.** The Porsche crawler is scheduled by *two* independent mechanisms that both point at the same `standalone.js`: the OS crontab (`0 6 * * *` → `cron.log`) and PM2's own `cron_restart: 0 6 * * *` on the `porsche-daily-crawler` process (logging separately to `~/.pm2/logs/porsche-daily-crawler-out.log`). Evidence: `cron.log` (1,013 lines) contains exactly 2 run-starts, while the PM2 out-log contains 8 ("Loaded previous baseline..." appears 8 times) since the PM2 process was created on 2026-08-23T21:15:43Z. The 08-25 daily-changes file has timestamp 19:35:48Z — mid-afternoon, not the scheduled 6am — meaning it came from an off-schedule PM2 run, not from cron.log's 06:00 run; that run's output overwrote the earlier same-day file, so only the *last* run of a calendar day survives in `daily_changes_YYYY-MM-DD.json`. This isn't destructive today (all Porsche numbers above cross-checked cleanly), but two independent schedulers hitting the same output files is a real risk for a corrupted/partial write if they ever overlap, and it makes "the 6am daily run" an inaccurate description of what's actually happening.

### Ford NJ — 0 real days of change history exist yet

`ford-nj-tracker/crawl.log` line 6 reads: **"No previous baseline found. Starting fresh initial scan."** — this crawler has run exactly once, ever, starting 2026-08-25 23:56 UTC (directory and files were created at that timestamp; the scheduled cron time is 06:30, so this was an off-schedule/manual first run, presumably from earlier tonight's session). Its only `daily_changes_2026-08-25.json` file shows `totalNewArrivals: 4935` exactly equal to `totalActiveInventory: 4935`, and `totalSoldOrRemoved: 0`, `totalPriceDrops: 0` — every single vehicle is counted as "new" because there is no prior day to compare against. **This is not day-over-day tracking working with a boring result — it is the mechanism correctly reporting that it has nothing to compare yet.** No real "what changed for Ford yesterday" data exists. The first real comparison will only be possible after the *next* scheduled run (06:30 UTC today, 2026-08-26) completes and diffs against this baseline. This is the most important gap to flag: anyone reading a Ford "daily changes" number right now would be looking at a meaningless first-run artifact, not a real trend.

---

## Part 2 — Dealer/make accuracy abnormalities

### Porsche: 173 of 215 configured dealers (80%) return zero inventory, every single day observed

Checked all 3 days of `dealerBreakdown` in `daily_changes_*.json`: the same 173 dealer names show `0` on 2026-08-23, 08-24, *and* 08-25 — this is not noisy/intermittent, it is a persistent, structural problem, not day-to-day flakiness. Only 41–42 of the 215 nationally-configured Porsche dealers (`dealers.json`) ever return inventory.

Root-caused by live-fetching each of the 173 dealers' configured `sitemapUrl` directly from the box (same network path the crawler uses) and classifying the failure:

| Cause | Count | What it means |
|---|---:|---|
| Vercel bot-checkpoint (HTTP 429, "Vercel Security Checkpoint" interstitial) | 115 | Site actively detects/blocks the crawler's request (likely flagging the AWS Lightsail IP/datacenter traffic) |
| HTTP 403 (Cloudflare/WAF-style block) | 19 | Same category, different vendor (e.g. `bramanporsche.com` returns Cloudflare's "Attention Required" challenge page) |
| Connection failed outright (timeout/TLS/DNS) | 19 | Site unreachable from the box under the crawler's conditions |
| HTTP 200 but 0 vehicle URLs matched | 10 | Sitemap fetch succeeds but contains no inventory URLs — see below |
| HTTP 404 (sitemap path wrong) | 10 | Configured `sitemapUrl` doesn't exist on that domain |

Concrete examples verified live:
- `porschedowntownla.com`, `porschestevenscreek.com`, `porscheirvine.com`, `porschepittsburgh.com`, `gaudinporschelv.com/sitemap.xml` (Porsche Las Vegas) all return HTTP 429 with a "Vercel Security Checkpoint" HTML challenge page — genuinely bot-blocked, not misconfigured.
- `bramanporsche.com/sitemap.xml` returns HTTP 403 with Cloudflare's "Attention Required" page.
- `circleporsche.com` (Porsche Long Beach) returns HTTP 200 with a valid but *generic* sitemap (89 `<loc>` entries, tool-generated by "Free Online Sitemap Generator www.xml-sitemaps.com") containing only top-level marketing pages (`/new-vehicles/`, `/service/schedule-service/`, etc.) — no individual vehicle detail-page URLs at all, so the crawler's URL-pattern matcher correctly finds zero vehicles because there are genuinely none in that sitemap. Same pattern confirmed for the other 9 dealers in this bucket (e.g. `porschenorthmiami.com`, `porschepensacola.com`).

**Bottom line for Porsche:** the crawler code itself isn't obviously broken — it's a single-sitemap-strategy crawler (only "Engine 1: Sitemap" appears anywhere in `cron.log`; no fallback engine actually runs despite a `fallbackUrl` field existing in `dealers.json`) up against real-world bot protection (Vercel/Cloudflare) at roughly 63% of blocked dealers, plus 10 dealers whose sitemap genuinely doesn't list inventory, plus 10 with a wrong sitemap path, plus 19 that were entirely unreachable from the box at check time. Porsche coverage is fundamentally capped at ~19–20% of the configured dealer network under the current single-strategy approach.

### Ford NJ: 10 of 28 dealers currently return zero inventory (previously reported as 11 of 28)

Root-caused each of the 10 live from the box:

| Dealer | Cause | Evidence |
|---|---|---|
| Wayne Ford | **Wrong domain entirely** | `wayneford.com` is a Los Angeles real-estate/architecture photographer's portfolio site (pages like `/laguna-beach`, `/architectureanddesignphotography`), not a Ford dealer. Web search confirms the real dealership's site is `waynefordcars.com`. |
| Woodbridge Ford | Stale/wrong domain | `woodbridgeford.com` now redirects to `freedomfordusa.com` (HTTP 403 at the destination too) — the configured domain appears to predate a dealership rebrand/domain change. |
| Lester Glenn Ford | Wrong TLD | `lesterglennford.com` redirects to `lesterglennford.net` — `.com` vs `.net` mismatch. |
| Maplecrest Ford Lincoln | Wrong domain | `maplecrestfordlincoln.com` redirects to `maplecrestfordlincolnunion.com` — missing "union" in the configured domain. |
| DCH Ford of Eatontown | Bot-blocked | `dchfordofeatontown.com/sitemap.xml` → HTTP 403, Cloudflare "Attention Required." |
| Winner Ford of Cherry Hill | Bot-blocked | `winnerford.com/sitemap.xml` → HTTP 403, Cloudflare "Attention Required." |
| Johnson Ford | SSL cert chain broken | `johnsonford.com` → curl error 60, "unable to get local issuer certificate" (server isn't sending its intermediate cert) — a real misconfiguration on the dealer's server, not a crawler bug. |
| Liccardi Ford Lincoln | SSL cert chain broken | Same failure mode as Johnson Ford. |
| Kindle Ford | SSL cert hostname mismatch | `kindleford.com` presents a `*.dealeron.com` wildcard certificate that doesn't cover `www.kindleford.com` — DealerOn (their site platform) isn't configured for this exact hostname. |
| United Ford | Sitemap has no inventory | `unitedford.com/sitemap.xml` returns valid XML with only 13 generic URLs (specials, parts, contact, terms) — no vehicle pages, same pattern as the Porsche "generic sitemap" cases. |

Note: the count moved from 11→10 since it was last flagged earlier in this session; could not determine whether that's a real fix or day-to-day variance without an earlier snapshot to diff against (this is itself an instance of the Part 1 gap — no historical Ford data exists to check).

### Inventory data-quality checks (live `inventory_latest.json` on the box)

**Porsche (5,388 records):**
- No duplicate VINs (5,388 unique VINs across 5,388 records).
- `make` field is 100% `"Porsche"` — no cross-brand mislabeling found.
- 202 records (3.7%) have a null/empty `model`. 193 of these are concentrated in one dealer: **Porsche San Diego**, which is notable because San Diego shows `0` inventory in the daily-change breakdown on 08-23 and 08-24 but jumped to 193 on 08-25 — i.e. the crawler only just started successfully reaching this dealer, and when it did, model extraction came back broken for nearly every one of its listings.
- 592 records (11%) have a null `price`, concentrated at Porsche San Diego (175), Porsche Fort Myers (148), and Porsche Naples (129).
- 15 suspiciously-low prices (under $5,000 against MSRPs of $94K–$177K) — all 15 come from exactly 2 dealers: **Porsche South Orlando (10)** and **Porsche Naples (5)**, e.g. a 2025 911 Carrera listed at $716 (MSRP $156,295), a 2025 Cayenne Coupe GTS at $407 (MSRP $134,879). This is a dealer-specific price-extraction bug (looks like it's picking up a fee/deposit/lease-payment figure instead of the vehicle price), not noise.
- 24 very-high prices (>$500K) were checked and appear to be **legitimate**, not a bug — they're all genuine ultra-limited models (911 GT2 RS, 911 S/T) which do trade in that range on the used market.

**Ford NJ (4,935 records):**
- No duplicate VINs.
- `make` field mostly says `"Ford"`, with a few `"FORD TRUCK"` / `"FORD MEDIUM TRUCK"` label variants (6 and 2 records) — a formatting inconsistency, not a wrong-brand mislabel.
- **The cross-brand make-mismatch bug from earlier this session is not fully fixed.** Searching every record's inventory URL for another brand's `/used|new|certified/<Brand>/` path while `make` still says `"Ford"` found 6 residual cases, all at 2 megadealers: **Nielsen Ford (1)** and **Nielsen Ford of Morristown (4)**, plus **ACE Ford (1)**. Examples: a `2023-Chevrolet-Tahoe` listing at `nielsenford.com` tagged `make: "Ford"`; a `2017-Jeep-Cherokee` and `2024-Jeep-Wagoneer` at `nielsenfordmorristown.com` tagged `make: "Ford"`; a `2019-Kia-Sorento` and `2025-Hyundai-Santa-Cruz` likewise; a `2020-Nissan-Rogue-Sport` at `aceford.com` tagged `make: "Ford"`. All 6 also have fabricated-looking VINs that use a real Ford VIN prefix (`1FA...`) despite being non-Ford vehicles — the VIN itself, not just the make label, is wrong for these 6 records.
- 583 records (12%) have a null/empty `model`, concentrated at **Tom's Ford (260)** and **Maplecrest Ford of Mendham (247)** — together over 85% of all Ford null-model records.
- 385 records have a null `price`, concentrated at Tom's Ford (260), All American Ford of Hackensack (55), Performance Ford of East Hanover (23).
- 34 suspiciously-low prices, **all exactly $495**, and **all from a single dealer: Malouf Ford Lincoln** (e.g. a 2026 Maverick at $495 against a $33,070 MSRP, a 2026 Bronco Sport at $495 against $36,570). The flat, identical $495 figure across every vehicle regardless of MSRP strongly suggests the scraper is picking up a fixed "dealer/doc fee" line item instead of the actual vehicle price on this dealer's site.

---

## Summary: least-reliable dealers and makes, by the numbers

**Porsche:**
- Structurally worst: 173/215 dealers (80%) return zero inventory, consistently across all 3 recorded days — dominated by anti-bot blocking (115 Vercel checkpoints + 19 Cloudflare/WAF = 134 of 173, ~78% of the zero-dealers).
- Data-quality worst dealers among *active* dealers: Porsche San Diego (193/193+ records missing `model`, 175 missing `price` — essentially all of its data is broken since it started reporting on 08-25), Porsche South Orlando and Porsche Naples (15 combined price-extraction failures returning near-zero dollar prices).

**Ford NJ:**
- 10/28 dealers (36%) return zero inventory — causes split roughly evenly between wrong/stale domains (4: Wayne, Woodbridge, Lester Glenn, Maplecrest), bot-blocking (2: DCH Eatontown, Winner Cherry Hill), broken TLS on the dealer's own server (3: Johnson, Liccardi, Kindle), and a sitemap with no inventory (1: United Ford).
- Data-quality worst: Tom's Ford and Maplecrest Ford of Mendham (null models), Malouf Ford Lincoln (100% of its low-price anomalies, all pegged at exactly $495), Nielsen Ford / Nielsen Ford of Morristown / ACE Ford (residual cross-brand make-mismatches with fabricated VIN prefixes).
- Make reliability: "Ford" is the least trustworthy make label specifically at multi-brand megadealers (Nielsen Ford, Nielsen Ford of Morristown, ACE Ford) — 6 confirmed non-Ford vehicles still mislabeled as Ford with invalid VINs.

**Overall change-tracking reliability:** Porsche's daily-change pipeline is real and verified consistent (3 days, cross-checked against per-vehicle status fields), but has one reproducible integer-overflow bug in price-drop detection for newly-added dealers, and runs under two uncoordinated schedulers. Ford's daily-change pipeline has produced zero real day-over-day data so far — everything currently labeled a "Ford daily change" is an artifact of the very first run having no baseline. The first meaningful Ford comparison depends on tonight's/today's 06:30 UTC cron run succeeding.
