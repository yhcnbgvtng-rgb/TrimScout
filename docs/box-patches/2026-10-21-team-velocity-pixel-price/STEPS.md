# Box patch: fill blank price from the Facebook Pixel ViewContent call (Team Velocity `/viewdetails/`)

Code only on the PR branch `feat/team-velocity-pixel-price`. Nothing here has been run on a box, and no box was read or touched while writing it. Boxes 1, 3, 4 (not box2). Do it in a no-crawl window, one box at a time, on Paul's own typed GO. No restart: every crawl is a fresh Node process, so the next 22:00 start loads the patched file.

## Why price stays blank (from the repo, no live fetch)
Team Velocity pages (`/viewdetails/<cond>/<vin>/<slug>`) reach the vehicle record two ways, and neither reads a price from what these pages actually carry:
1. **Schema.org strategy** (`extractSchemaOrgVehicle`, `standalone.js`): since #565 it finds the `@graph` Vehicle, but price comes only from `vehicle.offers` (`priceFromSchemaOrgOffers`). After #565 stock fills (box4 blank 29% -> 20%) while price stays ~100% blank, so the Vehicle node's Offer carries no usable price (missing, empty or a payment). That is inferred from the box4 result; no live page was read for this change.
2. **Last-resort scan (Strategy 3)**: only `itemprop="price" content=...` or a QUOTED `"price": 123` key within 2,000 characters of the VIN. It sets `msrp: null` by design.
3. **Strategy 3b** (`facebookPixelFields.js`, #286) runs for every car and reads the page's `fbq('track','ViewContent',{... price: 31995 ...})` call - captured live 2026-09-23 on paulmillertoyota.com and righttoyota.com, the same `/viewdetails/` platform (`test/facebookPixelFields.test.js`) - but it only ever filled model, make, colour, transmission and body style. **It never read the `price` that is in that same call**, and the unquoted `price:` key is invisible to the Strategy 3 scan.

## What it does
`fillFromFacebookPixelViewContent` now also fills a blank `price` (null or 0) from the call's `price`, never over an existing value. **MSRP is deliberately left alone** (not copied from price): the pixel price is the dealer's listed price, which can sit below the sticker MSRP. It rejects 0, the 2147483647 sentinel, anything >= $5M, and strings carrying payment copy ("$299/mo", "down").
Only `src/facebookPixelFields.js` changes (+19 lines, no new file, no import, `standalone.js` untouched). Off switch: `CRAWLER_PIXEL_PRICE=false` on the crawl cron line (price fill becomes a no-op; the other pixel fields still fill).

## Patch
| # | File | md5 |
|---|---|---|
| 1 | `01-pixel-price.patch` (paths relative to `scrapers/lightsail-crawler`, `patch -p1`) | `bf676c1ca6ac2a601d67390022cf60c6` |
| - | `drift-check.sh` | `fc31bb9bd0f01cad5af01f7a1fd69b9e` |

`src/facebookPixelFields.js` md5 before (git main, unchanged since #286): `38ca8bfb10d2a91d1ea7722c16d6dd0b`. After: `3a08479b1342588d1fa30d43e0901d17`. Repo-side proof: the patch applied to a copy of main's pre-change file produced exactly the post-change md5, and `drift-check.sh` passed against that copy. The boxes' copies were NOT read; if one differs the drift check stops.
The boxes' checkouts are hand-patched and dirty: do NOT `git pull`, `git merge` or `git commit` there. Box IPs: box1 34.203.148.79, box3 184.73.158.210, box4 100.50.85.234.

## Steps (repeat per box; set `BOX`)
0. From the Mac, in the repo checkout:
```bash
P=docs/box-patches/2026-10-21-team-velocity-pixel-price; ssh -i ~/.ssh/trimscout_box_2026 ubuntu@BOX 'mkdir -p /tmp/tvp'
scp -i ~/.ssh/trimscout_box_2026 $P/{01-pixel-price.patch,drift-check.sh} ubuntu@BOX:/tmp/tvp/
```
1. On the box, preconditions (stop if anything prints a process, or if it is past 21:30 ET) and file integrity:
```bash
TZ=America/New_York date +%H:%M; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone" | grep -v pgrep
cd /tmp/tvp && md5sum *   # patch bf676c1ca6ac..., drift-check.sh fc31bb9bd0f0...
```
2. Drift check + dry run (read-only, works on a copy); it must end `DRIFT CHECK PASS` and print the patched-copy md5 (expect `3a08479b1342588d1fa30d43e0901d17`):
```bash
bash /tmp/tvp/drift-check.sh
```
3. Backup:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/pixel-price-20261021; mkdir -p $B; cp -p src/facebookPixelFields.js $B/; md5sum $B/facebookPixelFields.js | tee $B/md5s.txt
```
4. Apply and verify:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler && patch -p1 < /tmp/tvp/01-pixel-price.patch
md5sum src/facebookPixelFields.js   # must equal the step 2 copy md5
cp src/facebookPixelFields.js /tmp/chk.mjs && node --check /tmp/chk.mjs && echo SYNTAX_OK; rm -f /tmp/chk.mjs
grep -c cleanPixelPrice src/facebookPixelFields.js   # expect 2
```
5. Restore:
```bash
cd ~/nj-scraper/scrapers/lightsail-crawler; B=~/backups/pixel-price-20261021; cp -p $B/facebookPixelFields.js src/; cat $B/md5s.txt; md5sum src/facebookPixelFields.js
```

## What to watch (first crawl after applying; values change only when a car's page is fetched again)
From box2's reader account, counts only, Team Velocity URLs, baseline new Toyota MY2025-27 price blank ~97.5%:
```sql
SELECT source_box, COUNT(*) cars, ROUND(100*AVG(price IS NULL OR price=0),1) price_blank_pct
FROM dealer_inventory WHERE removed_at IS NULL AND cond='new' AND year BETWEEN 2025 AND 2027 AND make='Toyota'
  AND REGEXP_REPLACE(vdp_url,'^https?://[^/]+','') LIKE '/viewdetails/%' GROUP BY source_box;
```
(Run it index-bounded on box2, e.g. add `AND dealer_id IN (...)` for a few Team Velocity dealers; do not scan the table.) A drop on the patched boxes only is the signal. If price stays blank, those pages carry no ViewContent price either (the dealer hides it) - then the next place to look is the page's visible price markup, which needs a saved real page; none is in the repo.
- Sanity check on a few cars: price should be a plausible vehicle price, not a payment; a spread of values well under the usual MSRP for a trim would mean the pixel `price` is a discounted figure.
- Not covered: Dealer.com / DealerOn price behaviour (unchanged), and boxes 1/3's `facebookPixelFields.js` md5s (unread).
