# Box patch: oemTrim.js into the crawler on boxes 1, 3, 4 (so new rows arrive with normalized trims)

**Code, tests and this plan only. Nothing here is installed and no box was contacted.** Do it in a no-crawl window on Paul's typed GO, one box at a time. Read `docs/BOXES.md` first (IPs, `ssh` aliases: box1/3/4 are reached through box2's private IPs).

## What is already in the repo, and what is not on the boxes
PR #609 changed the repo's `standalone.js` to call `normalizeTrimForWrite` (Ford first, then Chevrolet / GMC / Toyota / Ram). The boxes run their **own** `standalone.js` (checkouts are ~150 commits behind `origin/main` with local edits, `docs/BOXES.md` "Known drift"), so none of that is live there. The repo file is therefore **never copied** to a box. `scripts/box/2026-10-28-oem-trim-crawler-patch.mjs` makes the same two edits in the box's own file and refuses (exit 2, nothing written) if the text is not what it expects.

Not in this PR (still the held follow-up, `docs/box-patches/2026-10-28-oem-trim-sync-api-wiring/`): the sync client and the deals-API write path. With only this PR, rows crawled after the install arrive in the shard already normalized, with the dealer's text in `trimRaw`. Rows already in the database are fixed by the box2 clean-up script (`2026-10-27-oem-trim-normalize.mjs`, normalizer STEPS), not by this.

## Files that go to each of boxes 1, 3, 4 (crawler `src/` = `/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src/`, confirm the path per box first)
| File | Source in repo | md5 | Notes |
|---|---|---|---|
| `src/oemTrim.js` (new) | `scrapers/lightsail-crawler/src/oemTrim.js` | `0f9bb8163921b82ff9f54748e1a64cee` | nothing imports it until the patch below |
| `src/fordTrim.js` | `scrapers/lightsail-crawler/src/fordTrim.js` | `1224e1ae9aae5528a8af39ad5da3a2f3` | entity-decode version; `oemTrim.js` imports `cleanFordTrimText` from it. **Only install it if the box's copy differs and the box's `standalone.js` already imports it** (step 1) |
| patcher (copy to `/tmp`, not left on the box) | `scripts/box/2026-10-28-oem-trim-crawler-patch.mjs` | `1744e0c96e054e2e939f108ba8fdc70c` | check / `--apply` / `--rollback` |
| `src/standalone.js` | **patched in place**, not copied | box-specific (see step 3) | next crawl, fresh Node process, no restart |

Reference: the repo's pre-#609 `standalone.js` (`a39fc06e13e52e43d371ca504f65989e`) run through the patcher gives `84100e03ad1c044257f5750c60893e65`; the repo's #609 file (`028ab103b2c71ac0fde58809d1cb6519`) differs only in one comment line. A box's result md5 depends on its own text, so it is read back and recorded, not pinned in advance (box1's `standalone.js` differs by design, see memory/jsonld notes).

## Steps (per box; box4 first is fine, it has the most recent crawler patches)
0. **Preconditions:** no `run-daily-crawl|run_nightly_chain|run_sync|standalone` process, sync lock free; not after ~21:30 ET (crons start 22:00). Stop otherwise.
1. **Read-only inventory and backup**
```bash
ssh box4 'cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src && pwd && md5sum standalone.js fordTrim.js oemTrim.js 2>&1; grep -c "normalizeFordTrimForWrite" standalone.js; grep -n "normalizeFordTrimForWrite\|normalizeTrimForWrite" standalone.js; mkdir -p ~/backups/oem-trim-crawler-20261028 && cp -p standalone.js ~/backups/oem-trim-crawler-20261028/standalone.js.$(hostname)'
```
   Expect `grep -c` = 2 (one import, one call). **If it is 0, the box has no Ford trim wiring at all**: stop and send that back; the patcher would refuse anyway, and a different, bigger edit is needed. If `fordTrim.js` is missing or not `1224e1ae…`, install the Ford entity-decode version (`docs/box-patches/2026-10-27-ford-trim-entity-decode/STEPS.md`) before step 2.
2. **Stage and verify the new files** (writes to `/tmp` only), then install them (nothing loads `oemTrim.js` yet):
```bash
scp scrapers/lightsail-crawler/src/oemTrim.js scripts/box/2026-10-28-oem-trim-crawler-patch.mjs box4:/tmp/
ssh box4 'md5sum /tmp/oemTrim.js /tmp/2026-10-28-oem-trim-crawler-patch.mjs'   # must equal the table
ssh box4 'cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src && install -m 644 /tmp/oemTrim.js oemTrim.js && node --input-type=module -e "import(\"./oemTrim.js\").then(m=>console.log(JSON.stringify([[\"Toyota\",\"Tacoma\",\"TRD Off Road V6\"],[\"Ram\",\"1500\",\"Big Hornlone Star\"],[\"Ford\",\"F-150\",\"4X4 CREWCAB XLT\"],[\"Chevrolet\",\"Silverado 1500\",\"Crew Cab Short Box\"]].map(([make,model,trim])=>m.normalizeTrimForWrite({make,model,trim})))))"'
```
   Expect `TRD Off-Road`, `Big Horn/Lone Star`, `XLT` as `fix` with the original in `trimRaw`, and `Crew Cab Short Box` `leftover` unchanged.
3. **Check, then apply the patcher** to the box's own `standalone.js`:
```bash
ssh box4 'cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src && node /tmp/2026-10-28-oem-trim-crawler-patch.mjs standalone.js'            # CHECK: prints the md5 it would write, exit 0
ssh box4 'cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src && node /tmp/2026-10-28-oem-trim-crawler-patch.mjs standalone.js --apply && md5sum standalone.js && diff ~/backups/oem-trim-crawler-20261028/standalone.js.$(hostname) standalone.js'
```
   The `diff` must show exactly two changed lines (the import and the call). Exit 2 = drift (file not touched), 3 = a dependency is missing or has a different md5, 4 = patched file did not parse (backup already restored). Record the final md5 per box here or in the install log.
4. **Verify without crawling:** `ssh box4 'cd .../src && node --check standalone.js'`. First real check is after the next 22:00 crawl: shard rows for a Toyota / Chevrolet / GMC / Ram VIN carry `trimRaw` where the trim was rewritten (`grep -m3 '"trimRaw"' ../data/inventory/<state>.json`-style, per the box's shard layout).
5. Repeat for box3, then box1 (one box fully done and watched through a night before the next is the conservative order; all three are the same procedure).

## Before the sync: one check that decides whether `trim_raw` survives
The rewritten trim reaches the database through each box's `~/inventory-sync/inventory-sync.mjs`. Boxes 1/3/4 hold `a490c373…` (pre-guard). Check `grep -c trimRaw ~/inventory-sync/inventory-sync.mjs` on a box: if 0, the trim is stored normalized but the dealer's original text is dropped (`trim_raw` stays empty) until the sync-client patch from `2026-10-28-oem-trim-sync-api-wiring/` is installed (after the sweep-guard install; it is cut for the repo text, so cut a box-specific one). The trim rewrite itself still works either way.

## Rollback (per box)
```bash
ssh box4 'cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src && node /tmp/2026-10-28-oem-trim-crawler-patch.mjs standalone.js --rollback && md5sum standalone.js ~/backups/oem-trim-crawler-20261028/standalone.js.$(hostname)'
```
The two md5s must match. `oemTrim.js` can stay on disk (nothing imports it once `standalone.js` is restored). Rows already crawled keep the normalized trim with the original in `trimRaw`/`trim_raw`; the normalizer's `--rollback=FILE` restores database rows if ever wanted.
