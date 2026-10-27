# Box2 patch: Ford trim entity decode (`fordTrim.js`) + normalizer re-run

Code only. Written on 2026-10-26 with **no box access** (crawl running): nothing here was run on any box, and box2's current `src/fordTrim.js` was **not read**, so the "before" md5 below is main's, not box2's. Do it in a no-crawl window, on Paul's own typed GO.

## What changes on the box
One file: `src/fordTrim.js` (self-contained, no new imports). It now decodes HTML entities and strips ®/™ before matching, so `Raptor®`, `Raptor&reg;`, `Tremor®`, `King Ranch®`, `Platinum®` become `Raptor` / `Tremor` / `King Ranch` / `Platinum`, and `XLT 4WD Supercrew 5.5 Box` -> `XLT`. `Truck SuperCrew` stays unreadable and untouched. An exact official trim that only differs by the mark is now a `fix` (so the stored text is rewritten and the dealer text goes to `trim_raw`).

| File | md5 (repo, this PR) | md5 (main before) |
|---|---|---|
| `scrapers/lightsail-crawler/src/fordTrim.js` | `1224e1ae9aae5528a8af39ad5da3a2f3` | `3de34c5c3dac724a7e7987fbbc2116d5` |
| `01-fordTrim-entity-decode.patch` | cut from main -> this PR | |

Who loads it: the deals API (`deals_api_server.js` imports `./fordTrim.js`; **restart needed to pick it up**), the crawl boxes' `standalone.js` (a fresh Node process each crawl, no restart), and `scripts/box/2026-10-27-ford-trim-normalize.mjs` (loads `src/fordTrim.js` from its cwd). The admin page and CSV change is web-only (Vercel), nothing for the box.

## Steps (box2 = 52.202.234.65, key `~/.ssh/trimscout_box_2026`)
0. Preconditions on box2: past the crawl/sync window, no `run-daily-crawl|run_nightly_chain|run_sync|standalone` process, sync lock free. Stop if any is running.
1. Backup + drift check (read-only). Box2's file may differ from main's; if the md5 is neither value above, send it back before patching:
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && md5sum src/fordTrim.js && mkdir -p ~/backups/ford-entity-20261027 && cp -p src/fordTrim.js ~/backups/ford-entity-20261027/ && md5sum ~/backups/ford-entity-20261027/fordTrim.js'
```
2. Copy the new file (from the merged main checkout) and verify the md5 is `1224e1ae9aae5528a8af39ad5da3a2f3`:
```bash
scp -i ~/.ssh/trimscout_box_2026 scrapers/lightsail-crawler/src/fordTrim.js ubuntu@52.202.234.65:/tmp/fordTrim.js.new
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'md5sum /tmp/fordTrim.js.new && node --input-type=module -e "import(\"/tmp/fordTrim.js.new\").then(m=>console.log(JSON.stringify([\"Raptor®\",\"Tremor&reg;\",\"King Ranch®\",\"Platinum®\",\"XLT 4WD Supercrew 5.5 Box\",\"Truck SuperCrew\"].map(t=>m.normalizeFordTrim({make:\"Ford\",model:\"F-150\",trim:t})))))"'
```
   Expect `Raptor`, `Tremor`, `King Ranch`, `Platinum`, `XLT` all `fix`, and `Truck SuperCrew` `leftover` unchanged.
3. **Normalizer dry run first, against the OLD file** (baseline; writes nothing), then install and dry-run again:
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-ford-trim-normalize.mjs --dry-run | tee ~/backups/ford-entity-20261027/dryrun-before.txt | tail -40'
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && install -m 644 /tmp/fordTrim.js.new src/fordTrim.js && md5sum src/fordTrim.js && node scripts/box/2026-10-27-ford-trim-normalize.mjs --dry-run | tee ~/backups/ford-entity-20261027/dryrun-after.txt | tail -40'
```
   (If `scripts/box/2026-10-27-ford-trim-normalize.mjs` is not on box2 yet, copy it with `config/boxes.mjs` + `boxes.json` first; it refuses to run without the retired-IP guard.) The after run should add the ®/&reg; groups (for example `Raptor®` -> `Raptor`) to the change list and nothing else; compare the two files before going on.
4. Restart the deals API the way box2 normally does it (no restart while a sync is running), then confirm `md5sum src/fordTrim.js` is still the new value and the API answers.
5. Small apply first, then the rest (each takes the sync lock and needs `--fleet-idle`, so confirm all four boxes are idle):
```bash
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-ford-trim-normalize.mjs --apply --fleet-idle --limit=5000'
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-ford-trim-normalize.mjs --apply --fleet-idle'
ssh -i ~/.ssh/trimscout_box_2026 ubuntu@52.202.234.65 'cd /opt/trimscout-deals && node scripts/box/2026-10-27-ford-trim-normalize.mjs --dry-run | tail -15'   # idempotent: nothing left to fix
```
6. Rebuild the trim facets afterwards the usual way (facets key on trim).

## Rollback
- File: `cp -p ~/backups/ford-entity-20261027/fordTrim.js /opt/trimscout-deals/src/fordTrim.js`, restart the API.
- Rows: `node scripts/box/2026-10-27-ford-trim-normalize.mjs --rollback=<backup file the apply wrote>` (count), then add `--apply --fleet-idle` (restores `trim` and `trim_raw`).
