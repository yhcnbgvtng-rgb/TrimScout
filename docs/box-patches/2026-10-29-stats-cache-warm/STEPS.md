# Warm `stats-cache.json` when deals-api starts (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window (not 22:00-23:30 ET; after box2's nightly sync has finished and released the lock). Box2 only. Two patched files in `/opt/trimscout-deals/src` (`statsCache.js`, `deals_api_server.js`), one `sudo -u ubuntu pm2 restart deals-api`. No schema or env change.

## Why
After a restart the `stats` entry of `stats-cache.json` was cold until the first request, so dealers and VINs read null. The server now runs the real `/api/inventory/stats` handler once, 5 s after `listen`, against a throwaway response (not awaited, errors logged), which fills the same `stats` key. A fresh persisted entry is not recomputed; an expired one is served while its refresh runs.

## The patches are cut against box2's live text (2026-10-29), not repo main
Box2's live `deals_api_server.js` has imports repo main does not (`rfqTradeConfirm.js`, `tradeConfirm.js`), so a patch cut from main failed its import hunk with `-F0`. The patches below apply to the live files exactly, with no fuzz and no hand edit on the box.

| Patch | Applies to (box2 `src/`) | BASE md5 | Result md5 | Patch md5 |
|---|---|---|---|---|
| `statsCache.js.patch` | `statsCache.js` | `44bd409e02e6d8bc03c3ab2f4e29deee` | `21b399905519efe484b2f1453121602c` | `16cbb4758be551708ca516b5604301c5` |
| `deals_api_server.js.patch` | `deals_api_server.js` **before** the sweep-crawl-stamps install (PR #628) | `31d527ba8e277ff58e39f73ad1d00295` | `92716d2599883f1011535349217dc154` | `53a87dc052bcfafc1171c10d805af76b` |
| `deals_api_server.after-crawl-stamps.js.patch` | `deals_api_server.js` **after** the sweep-crawl-stamps install (PR #628) | `400e943b58e972a00fcce92738ead685` | `60211bdd0317514a09bc938ab1644889` | `0ac6af489f02773b3a79cbf87b9ba769` |

**`deals_api_server.js` has two accepted starting files; pick the patch by the live md5, never by guess.** #628 patches the same file (31d527ba -> 400e943b) and installs first. The two patches differ only in line offsets; both give the same warm lines. Applying either order ends at the same file: 31d527ba + stats-warm + crawl-stamps = 31d527ba + crawl-stamps + stats-warm = `60211bdd...` (checked with both patches, `-F0`). The two box-text snapshots the tests run against are in `docs/box-snapshots/2026-10-29-box2-deals-api/`.

`deals_api_server.js.patch` has 3 hunks: the import (`createStatsCache, warmStatsCache`), the `STATS_WARM_DELAY_MS` constant, and the `setTimeout` warm call inside the `listen` callback. The warm lines sit after `stats-movement-split` (it owns `handleInventoryStats`); this change does not touch that handler, and `handleInventoryStats` only uses `res` through `sendJson` (`writeHead` + `end`), which the throwaway response provides.

If a live md5 matches none of the BASE values in the table (another package was installed since), **stop**: do not hand-edit on the box. Pull the live file, cut a new patch from it in a PR (`git diff --no-index` live vs edited), and re-verify the result md5.

## Steps (Paul's GO)
0. Preconditions: no `run-daily-crawl|run_nightly_chain|standalone|inventory-sync.mjs` process on box1-4 (ignore the known waiter shells), sync lock free (last `[sync-lock]` line in `/home/ubuntu/.pm2/logs/deals-api-out.log` is a `release`).
1. Backup and drift check, read-only on the live files:
```bash
ssh box2 'cd /opt/trimscout-deals/src && md5sum statsCache.js deals_api_server.js && S=$(date +%Y%m%d%H%M%S) && sudo cp -p statsCache.js statsCache.js.bak.statswarm.$S && sudo cp -p deals_api_server.js deals_api_server.js.bak.statswarm.$S && echo "backup stamp: $S"'
```
   `statsCache.js` must equal its BASE. `deals_api_server.js` must equal one of the two BASE values (`31d527ba...` = crawl-stamps not installed yet, use `deals_api_server.js.patch`; `400e943b...` = crawl-stamps installed, use `deals_api_server.after-crawl-stamps.js.patch`). Any other md5: stop. Write down the stamp and which one it was.
2. Patch a COPY, never the live file (`-F0` = no fuzz, so drift fails instead of patching wrongly):
```bash
scp docs/box-patches/2026-10-29-stats-cache-warm/*.patch box2:/tmp/
# DP below: deals_api_server.js.patch when the live md5 is 31d527ba..., deals_api_server.after-crawl-stamps.js.patch when it is 400e943b... (edit the one DP= assignment)
ssh box2 'DP=deals_api_server.js.patch; mkdir -p /tmp/statswarm && cd /tmp/statswarm && cp /opt/trimscout-deals/src/statsCache.js /opt/trimscout-deals/src/deals_api_server.js . && patch -F0 --dry-run statsCache.js < /tmp/statsCache.js.patch && patch -F0 --dry-run deals_api_server.js < /tmp/$DP && patch -F0 -s --no-backup-if-mismatch statsCache.js < /tmp/statsCache.js.patch && patch -F0 -s --no-backup-if-mismatch deals_api_server.js < /tmp/$DP && md5sum statsCache.js deals_api_server.js && ls *.rej 2>&1 | head -1'
```
   Expect no `.rej` and the Result md5s above: `21b39990…` and `92716d25…` (from 31d527ba) or `60211bdd…` (from 400e943b).
3. **Check the import after patching** (`node --check` does NOT catch a missing import: it would be a `ReferenceError` inside the startup timer):
```bash
ssh box2 'cd /tmp/statswarm && grep -n "import { createStatsCache, warmStatsCache } from \"./statsCache.js\"" deals_api_server.js && grep -n "export async function warmStatsCache" statsCache.js && grep -c "warmStatsCache" deals_api_server.js'
```
   The first two greps must each print one line; the count must be 2 (import + the call). Any miss: stop, nothing is installed yet.
4. Syntax check both: `ssh box2 'cd /tmp/statswarm && node --check statsCache.js && node --check deals_api_server.js && echo syntax ok'`.
5. Install the checked copies and restart (only the `ubuntu` PM2 runs deals-api; **never** `sudo pm2 ... trimscout-deals-api` and never a bare `sudo pm2`, which starts an empty root daemon):
```bash
ssh box2 'cd /tmp/statswarm && sudo install -m 0644 statsCache.js /opt/trimscout-deals/src/statsCache.js && sudo install -m 0644 deals_api_server.js /opt/trimscout-deals/src/deals_api_server.js && md5sum /opt/trimscout-deals/src/statsCache.js /opt/trimscout-deals/src/deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
   The installed md5s must equal the Result column for the starting file you used.
6. Verify (give it about 10 s after the restart):
```bash
ssh box2 'sudo -u ubuntu pm2 jlist | python3 -c "import sys,json; [print(p[\"name\"],p[\"pm2_env\"][\"status\"],p[\"pm2_env\"][\"restart_time\"]) for p in json.load(sys.stdin)]"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3004/health; sudo -u ubuntu pm2 logs deals-api --lines 60 --nostream | grep "stats cache"'
```
   `deals-api` online (restart count unchanged 10 s later), `/health` 401, and `stats cache: warmed stats` (or `warm of stats failed: ...`, which does not stop startup; report it). Then `/api/inventory/stats` answers at once with dealers and VINs set. Clean up `/tmp/statswarm` and the two `/tmp/*.patch` files.

## Rollback
```bash
ssh box2 'cd /opt/trimscout-deals/src && sudo cp -p statsCache.js.bak.statswarm.<STAMP> statsCache.js && sudo cp -p deals_api_server.js.bak.statswarm.<STAMP> deals_api_server.js && md5sum statsCache.js deals_api_server.js && sudo -u ubuntu pm2 restart deals-api'
```
The md5s must equal the starting md5s you wrote down in step 1. `stats-cache.json` needs no cleanup.
