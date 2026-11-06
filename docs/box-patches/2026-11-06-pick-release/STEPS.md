# "Choose this quote" releases the winner on box2 (PR #710, box half) — INSTALLED 2026-11-06 ~11:30 ET

**Status: INSTALLED on box2 by Paul, 2026-11-06 ~11:30 ET: `apply` OK (`deals_api_server.js` `af0269fc…`, `dealStages.js` `8e853ba4…`), `restart` OK (deals-api online, restarts=4, up since 16:30:10Z), `verify` OK. Backup: `~/backups/box2-pick-release-20261106/` (`deals_api_server.js` `d63818f0…`, `dealStages.js` `ac03cf8c…`, `md5s.txt`); keep about a week. Step 5 (the SAFE MODE test pick) is separate and is recorded below when done.**
Install only on Paul's typed **GO**, on **box2** (`ssh box2`, 52.202.234.65, `docs/BOXES.md`), in an idle window (not 22:00-23:30 ET), sync lock free, no sync/crawl process on any box. One `pm2 restart deals-api`. No schema or env change.

## Why
#710 (merged as d262b2fd) made the Next app send the buyer's contact with a non-staged pick and queue the "Your offer was accepted" email. The box has to record the release on the winner's invite first; until it does, the app skips the email (`awardWinnerOnPick` returns `no_release`), so shipping the app first is harmless and nothing is sent twice.

## What changes (two files in `/opt/trimscout-deals/src`)
| File | Before (live box2, read 2026-11-06) | After |
|---|---|---|
| `dealStages.js` | `ac03cf8c496a89fcbe9ec1bfefc2ab67` | `8e853ba43911504784f431c6b34c495e` (replaced whole from `files/`; the only difference is the new `releaseOnPick` export, 19 lines) |
| `deals_api_server.js` | `d63818f09574575a7b593d144687dead` (the My Quotes install result) | `af0269fc579aa51ee5b7d9499bc8a265`, patched by `deals_api_server.js.patch` (`aeb9ef88…`): 1 import + the release block in `handlePickRfqQuote` (2 hunks, 19 added lines) |

Live `dealStages.js` already has `cleanContact`, `done`, `initialStageState`, `fail`, and its one import `stateTradeCredit.js` matches the repo (`c4c22951…`).
Behaviour: on a pick with a `buyerContact` and a non-staged request, the winner's `stage_json` gets the same closed / accepted / released state `accept_final` writes (OTD from the quote), once, by a compare-and-set `UPDATE`; an invite that already has a release is untouched. A failure is logged (`pick release failed`) and the pick still succeeds.

## Differences from the repo mirror (why this is its own package)
- The patch is cut from the **live** file, not the mirror. `scrapers/lightsail-crawler/src/deals_api_server.js` in the repo already contains this change (it was #710) and its md5 (`78dceb27…`) is pinned by `2026-10-27-sweep-guards`; that package is **not touched** and its md5s were **not** regenerated. The live file is not the mirror: it has the My Quotes handlers and lacks the sweep-guards changes.
- Live `deals_api_server.js` had no `./dealStages.js` import, so the patch adds one.

## Steps (box2 only)
1. `scp -r docs/box-patches/2026-11-06-pick-release box2:/tmp/pkr && ssh box2 'bash /tmp/pkr/install.sh check'` — read-only. Must end `DRIFT CHECK PASS`. If it stops on an md5, the live file drifted: do not hand-edit, re-cut.
2. On GO, in an idle window: `bash /tmp/pkr/install.sh apply` — gates (sync lock, processes), backup to `~/backups/box2-pick-release-20261106/` with `md5s.txt`, copy, md5 + syntax + smoke on the live files, auto-restores on any failure. Does not restart.
3. `bash /tmp/pkr/install.sh restart` — gates again, `pm2 restart deals-api`, checks online + fresh uptime + `/health` answers (a keyless `/health` is **401** on the live box because the key guard sits in front of every route, so 200 or 401 both mean up; 000 means down) + `POST /api/rfqs/0/pick` without the key -> 401. (The first install on 2026-11-06 stopped here with a false FAIL because the check demanded 200; the files and the restart were fine.)
4. `bash /tmp/pkr/install.sh verify` — read-only: with the box's own key a pick of a nonexistent quote answers 404 (the handler returns before any write) and the live `dealStages.js` passes the smoke test.
5. End-to-end (separate, writes, needs GO): one non-staged test RFQ in SAFE MODE, pick a quote with the test buyer; expect `stage_json.release` on the winner, one `buyer_details_released` event, and one email to pausmi@ with the SAFE MODE tag and no contact details in the body.

Rollback: `bash /tmp/pkr/install.sh restore && pm2 restart deals-api` (both files back from the backup; no schema change to undo).

## Known limitations
- A quote with a null / missing `total_otd_price` is recorded as OTD `null` in the release summary (fixed in this PR; the first draft recorded `0` because `Number(null)` is 0).
- Trade-in picks (the confirmation step) are not released by this change.

<!-- MD5S:START -->
```
# md5  role  file
8e853ba43911504784f431c6b34c495e  PACKAGE  files/dealStages.js
aeb9ef881d2163af4ec603a787691af4  PACKAGE  deals_api_server.js.patch
8811cdd151733cfc4ede4d9a32085e67  PACKAGE  smoke.mjs
d63818f09574575a7b593d144687dead  BASE  deals_api_server.js (live box2, read 2026-11-06)
af0269fc579aa51ee5b7d9499bc8a265  FINAL  deals_api_server.js
ac03cf8c496a89fcbe9ec1bfefc2ab67  BASE  dealStages.js (live box2, read 2026-11-06)
8e853ba43911504784f431c6b34c495e  FINAL  dealStages.js
```
<!-- MD5S:END -->
