# Options once per VIN (2026-10-09)

The crawler/sync rule for factory + dealer-listed options: **take them once per VIN, then leave them alone.** Code: `scrapers/lightsail-crawler/src/optionsCapture.js` (pure), wired into `deals_api_server.js` (`handleInventoryBulk`), the crawler (`standalone.js`, `finder_crawler.js`) and the sync client (`scripts/box/inventory-sync.mjs`, `syncRun.js`). Code only: nothing is deployed, no DB was written.

## How options work today (read-only findings, before this change)
- **Where they come from.** The nightly crawl (`standalone.js`) fetches **every in-stock VIN's listing page (VDP) every night** — that one response also carries price, stock, colors, mileage — and reads options out of it (Dealer.com `DDC.dataLayer` packages/options, or the JSON-LD description). **There is no separate options request** to skip in that crawl. Last crawl day's VDP URLs: box1 393,730 (819 dealers), box2 643,491 (1,324), box3 831,459 (2,222), box4 983,980 (2,408). None of that goes away: price/stock need the page.
- **The only separate options request** is `finder_crawler.js`'s `fetchVehicleOptions` (an extra page load per VIN). It is not on any box's crontab; it already carried previous options forward for non-empty ones, but asked again every night for an empty one.
- **Where they are written.** The shard record keeps `dealerListedOptions`; the sync maps them to `options` and POSTs `/api/inventory/bulk`; the deals API stores `dealer_inventory.options_json` (+ `options_total`) with `COALESCE(VALUES(x), x)` and rewrites that VIN's facet rows in `dealer_inventory_options` when they differ (diff-write, #376).
- **Skip for VINs we already have: none.** Every night every VIN's options were parsed, shipped, diffed against the facet rows and, when different, deleted and re-inserted. Measured per night (box sync logs, last two runs): 29–142k vehicles "replaced" per box per night even in steady state, 0.6–3.8M facet rows written; the options part of the deals-API time was **8.7–14.0 min (box1), 15.7–21.5 (box2), 45.7–50.5 (box3), 40.8 (box4)**, 24–30% of each box's deals-API time.

## The rule
| VIN state | What a night's options do |
|---|---|
| never seen | assessed: **good** → stored, `options_captured_at` + `options_source` stamped; **empty/junk** → try #1 counted (`options_attempts`=1, `options_checked_at`); real options that survive the deny rules are still stored, as before |
| captured (`options_captured_at` set) | **ignored.** price, stock, last_seen, removed still update |
| 1 failed try, < 7 days ago | ignored |
| 1 failed try, ≥ 7 days ago | one retry (good → captured; else try #2) |
| 2 failed tries | never again — no loop |

**Good** = not empty and not mostly junk under the *current* deny rules (`optionRowsFromOptions`): at least one option survives and junk is no more than half the labels (`OPTIONS_JUNK_SHARE_MAX = 0.5`). On a 3,200-car sample across 8 make/model/states: 52.5% good, 39.7% empty (Toyota/Honda publish few), 7.8% junk. Source is `vdp` (the listing page, what the nightly crawl reads), `sticker` or `feed`.

A rule or allowlist change **never triggers a re-crawl**: re-clean the stored `options_json` in the DB with `scripts/box/2026-09-28-backfill-inventory-options.mjs` (dry run by default; `--apply` writes; `--stamp` also stamps good captures). Colors, transmission and trim are not options and keep their own backfills.

Kill switch: `OPTIONS_ONCE_PER_VIN=0` in the deals-api environment restores overwrite-every-night.

## Savings estimate (modelled from the last two sync runs per box; not measured after the change)
Assumes ~11% of a box's vehicles are new each night (nightly `removed` ≈ arrivals: 10.9% / 11.2% / 11.9% of upserted on box1/2/3), so ~89% of the option work is skipped; the facet-set read is replaced by a narrower per-VIN capture-state read (kept in the estimate).

| Box | VDP requests skipped | Options minutes/night now → after (deals-API time) | Saved |
|---|---|---|---|
| box1 | 0 | 14.0 → ~4 | ~10 min |
| box2 | 0 | 21.5 → ~7 | ~15 min |
| box3 | 0 | 45.7 → ~12 | ~33 min |
| box4 | 0 | 40.8 → ~10 | ~30 min |

The four syncs run one after another under the lock, so this comes straight off the nightly sync chain: **~88 minutes**. **Crawl requests saved: none** — the listing page is fetched every night for price and stock and carries the options in the same response. Cutting crawl requests would need a price/stock source that is not the VDP (the lite crawl, #363), or conditional requests; that is a separate decision. The payload bytes of options are still sent (the sync client does not know server state); a later change could have the deals API return the captured set so the client can omit them.

## Deploy (Paul's GO, idle window, after the restart / facet-rebuild sequence)
1. Pre-check: sync lock free on two checks, no crawl/sync on any box, empty MariaDB processlist.
2. **Deals box:** `scripts/box/2026-10-09-options-once-server.sh` (installs `src/optionsCapture.js`, anchored patch of `deals_api_server.js`, backup, `node --check`; asserts exactly-one match per snippet and stops on box drift; verified to reproduce the repo file from `origin/main`'s mirror). It does not restart.
3. **One deals-api restart** (adds the four columns lazily). Smoke-test `/api/inventory`, `catalog-facets/status`.
4. **Stamp the vehicles already stored** (so the first night does not re-take them): `cd /opt/trimscout-deals && sudo node 2026-09-28-backfill-inventory-options.mjs --stamp` (dry run: counts), then with `--apply --stamp` per make (under the sync lock, background, `--batch=500 --pause-ms=50`; resumable with `--after`).
5. **Sync client** on each crawl box, when that box has no sync running: `scripts/box/2026-10-07-sync-client-update.sh` (picks up `optionsSource` and the new log line). Optional, can wait.
6. **Crawler files** (`standalone.js`, `finder_crawler.js`, `optionsCapture.js`) are bookkeeping on the shard; boxes 1/2 run older bases of these files, so deploy them with the next crawler release, not by overwriting.
7. Watch the first night's `[sync] options once per VIN: N already captured…` line; `OPTIONS_ONCE_PER_VIN=0` + restart is the rollback.
