# Box patch: sync-client and deals-API wiring for `oemTrim.js` (patches only)

**Docs and patches only, nothing here is installed, no repo source file is edited.** Follow-up to the trim normalizer PR (`docs/box-patches/2026-10-27-oem-trim-normalize/STEPS.md`). The sync client and the deals-API write path are not wired in that PR because the sweep-guards install package (`docs/box-patches/2026-10-27-sweep-guards/`) pins `scripts/box/inventory-sync.mjs` and `scrapers/lightsail-crawler/src/deals_api_server.js` (md5s plus reverse-applying patches, enforced by `scripts/box/sweep-guards-install.test.mjs`). Editing those repo files before that package is installed breaks it, so the patches live here and are cut against **box2's own files** during the daytime install, on Paul's typed GO. Do not touch a box before that.

## The three patches in this directory

Cut against `origin/main` at the time of writing (the repo text), not against a box. `deals_bulk_handler.test.js.patch` is the test side and is only for the repo.

| Patch | Applies to | Repo base md5 | Result md5 | What it does |
|---|---|---|---|---|
| `deals_api_server.js.patch` | box2 `src/deals_api_server.js` | `6512f25c22306a6ac506b8ba1426ac1b` | `8df86d11c54dfad14cd1a6f6eb23903b` | import `normalizeTrimForWrite` from `./oemTrim.js` instead of `normalizeFordTrimForWrite` from `./fordTrim.js`, and call it in `handleInventoryBulk` (Ford first, then Chevrolet / GMC / Toyota / Ram; the crawler's own `trimRaw` still wins). **API restart needed.** |
| `inventory-sync.mjs.patch` | each box's `inventory-sync.mjs` | `9a872876ec7c407e03c1f1c24e7a623a` | `051c1a4f227a81a21b400dc7e25c2614` | loads `oemTrim.js` beside the script, in a sibling `src/`, or in the repo layout (fail-open: if none loads, trims go as the crawler wrote them and the line printed at start says so), and sends `trimFields(v)` instead of `trim` / `trimRaw`. Takes effect on the next sync run. |
| `deals_bulk_handler.test.js.patch` | repo test only | main's test | | injects `normalizeTrimForWrite` into the harness and adds the Chevrolet / GMC / Toyota / Ram write-path tests (Ford test kept, the Toyota "other make" case moved to Honda). |

A test (`scripts/box/oem-trim-wiring.test.mjs`) checks the first two still apply to the repo files, so a later change to them shows up here instead of on the box.

## Steps (Paul's GO each, daytime, after the normalizer PR's step 2 has put `src/oemTrim.js` on the box)

0. Preconditions per box: no `run-daily-crawl|run_nightly_chain|run_sync|standalone` process, sync lock free. If the sweep-guards package is being installed the same day, do it **first**: these patches then apply on top of its FINAL files (its `box2-refit` result), and the drift check below tells you.
1. Backup and drift check, read-only (box2 shown; for the sync client repeat per box with its own path from `docs/BOXES.md`):
```bash
ssh box2 'cd /opt/trimscout-deals && mkdir -p ~/backups/oem-trim-wiring-20261028 && for f in src/deals_api_server.js scripts/box/inventory-sync.mjs; do [ -f $f ] && md5sum $f && cp -p $f ~/backups/oem-trim-wiring-20261028/; done; ls src/oemTrim.js src/fordTrim.js'
```
2. **Try the repo patch on a copy of the box's own file** (`-F0` = no fuzz, so a drifted file fails instead of being patched wrongly):
```bash
scp docs/box-patches/2026-10-28-oem-trim-sync-api-wiring/deals_api_server.js.patch box2:/tmp/
ssh box2 'cp /opt/trimscout-deals/src/deals_api_server.js /tmp/das.test.js && cd /tmp && patch -F0 --dry-run das.test.js < deals_api_server.js.patch && patch -s -F0 das.test.js < deals_api_server.js.patch && node --check das.test.js && md5sum das.test.js && grep -n "normalizeFordTrimForWrite\|normalizeTrimForWrite" das.test.js'
```
   Expect exactly the import and the call to have changed and no `normalizeFordTrimForWrite` left. If the repo patch does not apply (the live file drifts, see `project_trimscout_deals_api_live_drift`), **cut a box-specific one**: make the same two edits on the copy with `sed` (`s#import { normalizeFordTrimForWrite } from "./fordTrim.js";#import { normalizeTrimForWrite } from "./oemTrim.js";#; s#normalizeFordTrimForWrite(#normalizeTrimForWrite(#`; `grep -c normalizeFordTrimForWrite` must be exactly 2 before it), `node --check`, then `diff -u` the backup against the copy and send that patch back to be committed next to these under `box2-refit-oem/` with its before / after md5s. Same for `inventory-sync.mjs` (its change is the loader block plus one line in the row builder; if the anchors differ, send the file back rather than guessing).
3. Install the patched copy: `install -m 644 /tmp/das.test.js /opt/trimscout-deals/src/deals_api_server.js`, `node --check` it, then restart the API the way box2 normally does it (not during a sync) and confirm it answers. For the sync client: `install -m 755` the patched copy; confirm `trim normalizer: loaded` in the next sync log's first lines.
4. Check: one small crawl or sync batch, then `SELECT trim, trim_raw FROM dealer_inventory WHERE trim_raw IS NOT NULL AND make IN ('Toyota','Chevrolet','GMC','Ram') ORDER BY last_seen_at DESC LIMIT 20` (reader account).

## After the install
Once the sweep-guards package and these patches are both on the boxes, the repo source files get the same edits in a small PR that also runs `docs/box-patches/2026-10-27-sweep-guards/make-patches.sh` (new FINAL md5s in its manifest and STEPS table) and applies `deals_bulk_handler.test.js.patch`. Until then the repo and the boxes differ by exactly these two patches.

## Rollback
`cp -p ~/backups/oem-trim-wiring-20261028/<file>` back, restart the API. Rows already written keep their normalized trim with the original in `trim_raw`; the normalizer PR's `--rollback` restores those if wanted.
