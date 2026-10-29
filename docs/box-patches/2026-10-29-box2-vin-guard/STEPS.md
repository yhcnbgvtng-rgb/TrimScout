# box2 deals-API VIN guard (PR A) — code, tests and docs only. NOTHING IS INSTALLED by this PR.

Install only on Paul's typed **GO**, on **box2** (`ssh box2`; `docs/BOXES.md`), once the sync lock is clear. Planned: box2 around 06:00 ET on 2026-10-30, done well before the 22:00 crawl.

## Why this exists
2026-10-29 read-only checks: box2's write path has no `vinWmi.js`, `stellantisMake.js` is the pre-#580 file (`4f384997`), and 121 of the 200 rows fixed in last night's trial were back to the wrong make by the full run. Crawl boxes 1/3/4 already have the guard (vinWmi `7371d7d9`), box2 does not. `normalizeMakeForWrite` is the choke point for every upload from every box, so this closes the hole whichever box (or stale shard) sends the wrong make.

## What it changes (three files in `/opt/trimscout-deals/src`, replaced whole, so there is no patch to drift)
| File | before (box2 live) | after |
|---|---|---|
| `vinWmi.js` | absent | `274e60473eb1d83fe6b01def4e5f68dc` (new: main's table from #632, `63d37197`, plus the `3GP` / `3HD` / `1HT` rules below; copy it from `docs/box-patches/2026-10-29-wmi-additions/files/vinWmi.js`, never from the old `7371d7d9`) |
| `stellantisMake.js` | `4f384997f7107b66b9521bb561b7a10e` | `4017f1f9e24dc14d1b2cc530737e1e00` (`normalizeMakeForWrite` ends with `reconcileMake`) |
| `ingestGuards.js` | `0ba41bc0c45b07ad75a2fd32571937da` (2026-10-07) | `88ec75c5d81a19dd484de0dea62add28` (the repo's; the only difference is three `export` keywords, so no behaviour change; a test pins that) |
| `stellantisVinTable.js` | `2bb0902516fe1279adec20291096ac7b` | unchanged (checked, not copied) |
| `deals_api_server.js` | live `31d527ba…` (`92716d25…` after the #623/#629 stats-warm patch) | **not touched** |

### Why `deals_api_server.js` is not patched
The task asked for a patch that calls `reconcileMake`. It is not needed: the server already calls `normalizeMakeForWrite({ make: v.make, vin: v.vin, model: v.model })` at every place a make is written (lines ~2548, 2552, 2557 and 2617 of the 2026-10-27 snapshot, including the insert `values`), and the new `stellantisMake.js` runs `reconcileMake` last inside that function. Replacing the module is enough, and a server patch would only add drift risk. `test/box2_vin_guard_package.test.js` pins this against the committed snapshot (every `make` value written is the `normalizeMakeForWrite(...)` result; no raw `v.make`), and `install.sh` re-checks the same markers on the live file and refuses if they are gone.

**Order against #623/#629 (stats-warm):** none. The two touch disjoint files, and `install.sh` does not pin the server's md5 (it prints it). Install either first.

## What this PR adds on top of #632's 45 prefixes (NHTSA vPIC DecodeWMI, 2026-10-29)
`3MW` and `ZAS` (BMW, Alfa Romeo) and the `3HD` family are already in #632's table; only the model rules for `3HD` and `3GP` and the `1HT` family are new here. #632's `3GP` was Honda-only; it is now shared Honda/Acura, and its `wmi-install.sh` pin was moved to match.

`3MW` BMW (BMW Mexico) · `ZAS` Alfa Romeo · `3HD` Honda/Acura (Honda de Mexico; model picks the make for a blank or contradicted one) · `3GP` Honda/Acura (GM-built Prologue = Honda, ZDX = Acura) · `1HT` International/Chevrolet (International Motors medium-duty; a Silverado 4500HD–6500HD model picks Chevrolet, anything else stays unresolved). A make the page gave that is inside the family is kept exactly as before.

## Steps (on box2, as `ubuntu`)
0. Mac, from the merged checkout: `scp -r docs/box-patches/2026-10-29-box2-vin-guard ubuntu@52.202.234.65:/tmp/vg` then on the box `cd /tmp/vg && md5sum -c manifest.txt` (all OK).
1. Read-only drift check (patches nothing in the live dir, runs the VIN-guard test on a temp copy). Must end `DRIFT CHECK PASS`:
```bash
bash /tmp/vg/install.sh check
```
2. Gate by hand as well: last `[sync-lock]` line in `~/.pm2/logs/deals-api-out.log` is a release; no `inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|standalone` process on box2 (box2 also crawls); boxes 1/3/4 sync clients not mid-upload (`ssh -J box2 …`). `apply` and `restart` check the lock and box2's own processes again and refuse.
3. Apply (backup to `~/backups/box2-vin-guard-20261029/`, copies vinWmi → ingestGuards → stellantisMake, verifies md5s, syntax and the VIN-guard test on the live files, restores itself on any failure; **does not restart**):
```bash
bash /tmp/vg/install.sh apply
```
It ends by printing `ROLLBACK:  bash /tmp/vg/install.sh restore && sudo -u ubuntu pm2 restart deals-api`.
4. Restart (gates again, then `sudo -u ubuntu pm2 restart deals-api`, then checks the process is online with a fresh uptime stamp; the root PM2 has no `deals-api`. `docs/BOXES.md` still says `trimscout-deals-api`, which is stale):
```bash
bash /tmp/vg/install.sh restart
sudo -u ubuntu pm2 logs deals-api --lines 30 --nostream     # no import/syntax error
```
5. Read-only checks afterwards (reader account, PK-bounded, 10 s cap): re-run `docs/box-snapshots/2026-10-29-make-dealer-count/dealer-make-count.src.mjs` bundled as before (conflicts should stay at ~0 after the next upload), and look at the next sync's `[bulk]`/upload log for errors. Rows already stored wrong are fixed by `scripts/box/2026-10-28-make-from-vin-fix.mjs`, not by this install.

## Rollback
```bash
bash /tmp/vg/install.sh restore && sudo -u ubuntu pm2 restart deals-api
```
`restore` puts back `stellantisMake.js` and `ingestGuards.js` from the backup (md5-verified against `md5s.txt`) and removes `vinWmi.js`.

## What was tested (no box access)
`scrapers/lightsail-crawler/test/box2_vin_guard_package.test.js` runs `install.sh` against a simulated `/opt/trimscout-deals/src` built from the committed before-files (box's `stellantisMake.js` `4f384997` from git, `ingestGuards.js` `0ba41bc0` from git, the 2026-10-27 server snapshot) with a fake pm2: check/apply/restore round trip, md5 pins, refusal on drift of any file, refusal when the server no longer routes makes through `normalizeMakeForWrite`, refusal while the sync lock is held or a sync process runs, restart only on the patched state, failure path when pm2 reports the process not online. `vin_wmi.test.js` covers the five new prefixes. **Not tested:** a real `sudo -u ubuntu pm2` on box2, and the live `deals_api_server.js` (31d527ba / 92716d25) itself; the install script greps it for the call-site markers and refuses if they are missing.
