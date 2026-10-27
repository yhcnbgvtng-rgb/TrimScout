# Box patch: Chevrolet / GMC / Toyota / Ram trim normalizer (`oemTrim.js`) + existing-rows clean-up

**Code only.** Written 2026-10-27 with the only box contact being a read-only probe on box2 (reader account, 20 s cap, `docs/trim-normalize/oem-probe-2026-10-27.md`). Nothing below has been run. Do it in a no-crawl window, on Paul's own typed GO, one numbered step at a time. The lists and judgment calls are in the probe doc; read its "Judgment calls" first and say if any should change before step 3.

## What changes on the boxes

| File | md5 (repo, this PR) | Where | Picked up by |
|---|---|---|---|
| `scrapers/lightsail-crawler/src/oemTrim.js` (new) | `0f9bb8163921b82ff9f54748e1a64cee` | every box `src/` | needs `src/fordTrim.js` beside it (md5 `1224e1ae9aae5528a8af39ad5da3a2f3`, the Ford entity-decode version) |
| `scrapers/lightsail-crawler/src/standalone.js` | `028ab103b2c71ac0fde58809d1cb6519` (main: `a39fc06e13e52e43d371ca504f65989e`) | crawl boxes | next crawl (fresh Node process) |
| `scripts/box/2026-10-27-oem-trim-normalize.mjs` (new) | `6477dd4bc3380e4acbb292c84c98c3b9` | box2 only | run by hand |

**Scope of this PR.** It wires the crawler (`standalone.js`) only. The sync client (`inventory-sync.mjs`) and the deals-API write path (`deals_api_server.js`) are NOT edited here: the sweep-guards install package (`docs/box-patches/2026-10-27-sweep-guards/`) pins both files' md5s and patches, so they are wired in a follow-up PR with patches cut against box2's own files at install time. Until that is installed, rows written through the sync / API are stored as the crawler sent them (new crawls arrive normalized; the box2 clean-up script in step 5 fixes the rest).

**The live box files drift from the repo** (`project_trimscout_deals_api_live_drift`): do not copy `standalone.js` over a box. Patch the box's own text with the edit below, anchored on the box's actual lines, and test each on a copy first. The repo files above are only the reference for what the edit should produce.

The `standalone.js` edit is two things: the import line `import { normalizeFordTrimForWrite } from './fordTrim.js'` becomes `import { normalizeTrimForWrite } from './oemTrim.js'` and the one call `normalizeFordTrimForWrite(` becomes `normalizeTrimForWrite(`. `normalizeTrimForWrite` runs the Ford normalizer first and returns its result unless Ford skipped the row, so Ford behaviour is byte-for-byte what it is today.

Safe order: `oemTrim.js` first (nothing imports it yet), then the script, then `standalone.js` on each crawl box. The sync client and the API (follow-up PR) come after, API last.

## Steps (box2 = `ssh box2`, `/opt/trimscout-deals`; other boxes: `ssh box1|box3|box4`, crawler dir per `docs/BOXES.md`)

0. **Preconditions** on each box before touching it: no `run-daily-crawl|run_nightly_chain|run_sync|standalone` process, sync lock free (`scripts/box/sync-lock-probe.mjs`). Stop if any is running. Confirm `docs/BOXES.md` IPs again; never trust IPs in old comments.
1. **Backup + drift check (read-only)**, per file you will touch:
```bash
ssh box2 'cd /opt/trimscout-deals && mkdir -p ~/backups/oem-trim-20261027 && for f in src/fordTrim.js src/standalone.js; do md5sum $f; cp -p $f ~/backups/oem-trim-20261027/; done; ls src/oemTrim.js 2>&1 | head -1'
```
   `src/fordTrim.js` must be `1224e1ae9aae5528a8af39ad5da3a2f3`. If it is not, install the Ford entity-decode patch first (`docs/box-patches/2026-10-27-ford-trim-entity-decode/STEPS.md`): `oemTrim.js` re-uses its `cleanFordTrimText`.
2. **Install the new files** (nothing loads them yet) and check them:
```bash
scp scrapers/lightsail-crawler/src/oemTrim.js box2:/tmp/oemTrim.js.new
scp scripts/box/2026-10-27-oem-trim-normalize.mjs box2:/tmp/
ssh box2 'md5sum /tmp/oemTrim.js.new /tmp/2026-10-27-oem-trim-normalize.mjs && cd /opt/trimscout-deals && install -m 644 /tmp/oemTrim.js.new src/oemTrim.js && install -m 644 /tmp/2026-10-27-oem-trim-normalize.mjs scripts/box/ && node --input-type=module -e "import(\"/opt/trimscout-deals/src/oemTrim.js\").then(m=>console.log(JSON.stringify([[\"Chevrolet\",\"Silverado 1500\",\"LT 2FL\"],[\"Toyota\",\"Tacoma\",\"TRD Off Road V6\"],[\"Ram\",\"1500\",\"Big Hornlone Star\"],[\"Ford\",\"F-150\",\"4X4 CREWCAB XLT\"],[\"Chevrolet\",\"Silverado 1500\",\"Crew Cab Short Box\"]].map(([make,model,trim])=>m.normalizeTrimForWrite({make,model,trim})))))"'
```
   Expect `LT`, `TRD Off-Road`, `Big Horn/Lone Star`, `XLT` all `fix` with the original in `trimRaw`, and `Crew Cab Short Box` `leftover` unchanged. (`scripts/box/` also needs `config/boxes.mjs` + `boxes.json` for the retired-IP guard, same as the Ford script.)
3. **Dry run first (writes nothing, reader account, 12 bounded queries):**
```bash
ssh box2 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-oem-trim-normalize.mjs --dry-run | tee ~/backups/oem-trim-20261027/dryrun.txt | tail -60'
```
   Compare against the probe doc's table (about 50,000 rewrites). Read the top-40 change list line by line; anything that looks wrong goes back to the repo, not onto the box. `ambiguous` and `leftover` counts are rows that will stay as they are.
4. **Patch `standalone.js` on each crawl box** (on a copy first; the anchors are the box's own text):
```bash
ssh box3 'cd <crawler dir per docs/BOXES.md> && cp src/standalone.js /tmp/sa.test.js && grep -n "normalizeFordTrimForWrite" /tmp/sa.test.js'
# expect exactly 2 hits (the import and one call). If the count differs the live file has drifted: stop and send it back.
ssh box3 'cd /tmp && sed -i "s#import { normalizeFordTrimForWrite } from .\./fordTrim.js.;#import { normalizeTrimForWrite } from \x27./oemTrim.js\x27;#; s#normalizeFordTrimForWrite(#normalizeTrimForWrite(#" sa.test.js && node --check sa.test.js && grep -n "normalizeTrimForWrite\|normalizeFordTrimForWrite" sa.test.js'
```
   When the copy checks clean, apply the same `sed` to the real file (backup from step 1 exists) and `node --check` it. A crawl is a fresh Node process, so there is no restart. The sync client and the API wiring: see the follow-up PR's `STEPS.md`.
5. **Small apply first, then the rest** (each takes the sync lock and needs `--fleet-idle`, so confirm all four boxes are idle):
```bash
ssh box2 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-oem-trim-normalize.mjs --apply --fleet-idle --limit=5000'
ssh box2 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-oem-trim-normalize.mjs --apply --fleet-idle'
ssh box2 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-oem-trim-normalize.mjs --dry-run | tail -15'   # idempotent: nothing left to fix
```
   After the 5,000-row run, eyeball a few rows (`SELECT trim, trim_raw FROM dealer_inventory WHERE trim_raw IS NOT NULL AND make = 'Toyota' LIMIT 20`, reader account) before the full run.
6. **Rebuild the trim facets** the usual way (they key on trim), then check /search for a Tacoma, a Silverado and a Ram 1500: the Trim filter should list the official trims, with "—" only for unreadable text.

## Rollback
- Files: `cp -p ~/backups/oem-trim-20261027/<file> /opt/trimscout-deals/src/<file>`, restart the API. `oemTrim.js` can stay (nothing imports it once the callers are restored).
- Rows: `node scripts/box/2026-10-27-oem-trim-normalize.mjs --rollback=<backup file the apply wrote>` (count only), then add `--apply --fleet-idle` (restores `trim` and `trim_raw`, only where the trim is still what this script wrote).

## Not in this change
- No row is touched until step 5; steps 1 to 4 change no data.
- VIN-based fill for blank / unreadable trims (the Ford `ford-trim-vin-fill` idea) is not built for these makes.
- The web side (`/search` "—" rule) deploys with the Vercel merge; nothing for the box.
