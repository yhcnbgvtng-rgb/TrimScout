# Buyer-contact reveal handler on box2 (PR #643) — code only, NOTHING IS INSTALLED

Install only on Paul's typed **GO**, on **box2** (`ssh box2`; `docs/BOXES.md`), in an idle window (not 22:00-23:30 ET), sync lock free, no sync/crawl process on any box. One `sudo -u ubuntu pm2 restart deals-api`. No schema or env change.

## Why
The "Your offer was accepted" email links to a page where the winning dealer presses "Reveal buyer contact info". The Next app checks the signed, expiring token and rate-limits; the **box** gives the details back, and is the only place that can stamp the reveal on the deal (`stage_json.release.reveals`, shown to the buyer as "Dealer viewed your contact info") and write the `rfq_events` row (`buyer_contact_revealed`: dealer, quote request, time; never the details). Until this is installed the reveal button answers "couldn't open the contact info just now" and reveals nothing (fail closed).

## What changes (three files in `/opt/trimscout-deals/src`)
| File | Before (must be exactly) | After |
|---|---|---|
| `rfqContactReveal.js` | absent | `2a9d11ebeb4322f43df8569c9f9ef119` (new: `files/`) |
| `dealStages.js` | `0e557bfdf59b07894212a47ab47205a9` (repo main at 7663585 = the 2026-10-13 v2 install; **not read from the box**, `check` proves it) | `6a3a19443aa0e1d4ecb9a0a8a42169f0` (replaced whole: adds `revealContact`; `stageForDealer` drops the contact) |
| `deals_api_server.js` | one of four starting files, below | patched by `deals_api_server.js.patch` (`fb7aaac9d7d9ea15b2151872f8532fca`): 1 import, 1 handler const, 1 route `POST /api/rfqs/:id/invites/:inviteId/reveal-contact` |

`deals_api_server.js` has **four accepted starting files**; the patch is picked by the live md5, never by guess:

| Starting file | md5 | Result md5 |
|---|---|---|
| live 2026-10-29 (read from box2) | `31d527ba8e277ff58e39f73ad1d00295` | `9ddd12a80e9e3c9bffcb23fdc4797e01` |
| + sweep-crawl-stamps (#628) | `400e943b58e972a00fcce92738ead685` | `a9ca71357ab8abfbedbe13f787cfefac` |
| + stats-warm (#623/#629) | `92716d2599883f1011535349217dc154` | `ce21b599d4834045102159a0bcf66f4d` |
| + both | `60211bdd0317514a09bc938ab1644889` | `bd11ff778117cd932c2608e1585634d4` |

Any other md5 (another package was installed since): **stop**. Do not hand-edit on the box. Pull the live file, cut a new patch from it in a PR, re-pin. The patch applies with **zero fuzz** (`patch -F0`) to all four; `scripts/box/buyer-contact-reveal-install.test.mjs` runs it against the committed box snapshots.

## Order against other packages
- **Stats-warm / sweep-crawl-stamps first, this after** is the tested path: this patch applies to every combination and its result is pinned.
- If this goes **first**, the stats-warm install refuses (its BASE md5 pin no longer matches) until it is re-cut against `9ddd12a8…`. Prefer the order above.
- `stageForDealer` is bundled into the Next app, not run by the box server, so the new `dealStages.js` on the box only adds `revealContact`. Installing it before or after the app deploy cannot change what the app already shows. **Box first, then the app** is still the order, because the reveal button needs the route.

## Steps (on box2, as `ubuntu`)
0. Mac, from the merged checkout: `scp -r docs/box-patches/2026-10-30-buyer-contact-reveal ubuntu@52.202.234.65:/tmp/bcr`. Compare the package md5s to `manifest.txt` (`PACKAGE` rows): `cd /tmp/bcr && md5sum deals_api_server.js.patch files/*`.
1. Read-only drift check (changes nothing in the live dir; dry-runs the patch on a copy, runs the smoke test on a temp copy). Must end `DRIFT CHECK PASS`:
```bash
bash /tmp/bcr/install.sh check
```
2. Gate by hand as well: last `[sync-lock]` line in `~/.pm2/logs/deals-api-out.log` is a `release`; no `inventory-sync|run_sync|run_nightly_chain|run-daily-crawl|standalone` process on box2 (it also crawls), and boxes 1/3/4 sync clients not mid-upload. `apply` and `restart` check the lock and box2's own processes again and refuse.
3. Apply: gates, **backup first** to `~/backups/box2-buyer-contact-reveal-20261030/` (`dealStages.js`, `deals_api_server.js`, `md5s.txt`), copies `rfqContactReveal.js` -> `dealStages.js` -> patched server (cut and verified on a temp copy first), checks every md5, `node --check`, the smoke test on the live files, and restores itself on any failure. **Does not restart.**
```bash
bash /tmp/bcr/install.sh apply
```
   If `/opt/trimscout-deals/src` is root-owned: `SUDO=sudo bash /tmp/bcr/install.sh apply`.
4. Restart (gates again, then `sudo -u ubuntu pm2 restart deals-api`, then checks the process is online with a fresh uptime stamp, and that `POST /api/rfqs/1/invites/1/reveal-contact` without the key answers **401** (route exists, guarded) not 404). Never `sudo pm2 ...` and never `trimscout-deals-api`: the root PM2 has no `deals-api`.
```bash
bash /tmp/bcr/install.sh restart
```
5. Verify (about 10 s after the restart): `sudo -u ubuntu pm2 logs deals-api --lines 30 --nostream` has no errors, `deals-api` stays online (restart count unchanged a minute later), `/health` 401. Then one SAFE MODE end-to-end on a **test deal** (`scripts/box/safe-mode-test-deal.mjs`): accept the final deal, open the emailed link (it lands at pausmi@outlook.com), press Reveal; the buyer's deal page shows "Dealer viewed your contact info" and `rfq_events` has one `buyer_contact_revealed` row. Not part of the install; needs a deployed app.
6. Clean up `/tmp/bcr`. Keep the backup until the app deploy has been seen working.

## Rollback
```bash
bash /tmp/bcr/install.sh restore && sudo -u ubuntu pm2 restart deals-api
```
`restore` copies the two backed-up files back, removes `rfqContactReveal.js` and checks the md5s against `md5s.txt`. The app then shows the reveal page but the button fails closed ("couldn't open the contact info just now"); no buyer detail is exposed in any state.

## What is and is not verified
- Verified in CI (`buyer-contact-reveal-install.test.mjs`): patch applies with zero fuzz to all four starting files and gives the pinned results; the patched server parses, with the import, handler and route once each; `install.sh check|apply|restart|restore` run end to end against a temp copy of the box snapshot (drift refusal, lock and process gates, backup first, md5 pins, already-patched, restore, restart with a stubbed pm2 and a stub API answering 401 and 404).
- **Not** verified: the real box2 `dealStages.js` md5 (`check` reads it; not read here), `deals-api` actually starting on the patched server, the handler against the real MariaDB. The handler's SQL (an optimistic-lock UPDATE on `stage_json`, then the `rfq_events` insert) is the same pattern as `rfqStages.js`, and is unit-tested with a mock pool in `lib/contactReveal.test.tsx`.
