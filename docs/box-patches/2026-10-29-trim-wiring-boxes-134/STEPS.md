# Box patch: trim normalizer wiring for boxes 1, 3, 4 (fordTrim.js + oemTrim.js + standalone.js trim block + trimRaw in the sync client)

**Code, tests and this plan only. Nothing here is installed and no box was contacted while writing it.** Replaces the install steps of `docs/box-patches/2026-10-28-oem-trim-crawler-boxes-134/STEPS.md`, whose two-line patcher assumed the boxes already had the Ford wiring (the 2026-10-29 16:37 ET read-only check found they have none: `normalizeFordTrimForWrite` count 0, `oemTrim.js` and `fordTrim.js` absent, `trimRaw` count 0 in the sync client). Install only on Paul's typed **GO** per box, in an idle window, **box4, then box3, then box1**, each after that box's sync, all finished by 21:30 ET.

## What changes on each box
| File | Before (read 2026-10-29) | After | How |
|---|---|---|---|
| `src/standalone.js` box3, box4 | `d05cd479b8f8d22a77d4d9fb1ef2e31a` | `6f4c4f2a4b4db2ab2830e11074723dba` | `standalone.js.box3-box4.patch` (md5 `5ba598232d58955194f38931815c9304`), zero fuzz |
| `src/standalone.js` box1 | `8c39cf86d3017210d586ff3afeb33969` | `980769d114cba511aef4bc5ff033e0ae` | `standalone.js.box1.patch` (md5 `898fac9f97ebc156a483e2ba88d6e260`), zero fuzz |
| `~/inventory-sync/inventory-sync.mjs` all three | `e41f34ff8d9acd2efb025323b7f5bb80` | **not pinned** (see below) | one `sed`: `model: v.model, trim: v.trim,` becomes `... trim: v.trim, trimRaw: v.trimRaw \|\| null,` |
| `src/oemTrim.js` (new) | absent | `0f9bb8163921b82ff9f54748e1a64cee` | copied |
| `src/fordTrim.js` (new) | absent | `1224e1ae9aae5528a8af39ad5da3a2f3` | copied (self-contained, no imports) |

- **The standalone.js md5s above are exact**, not estimates: the box files were rebuilt in the repo from `2026-10-28-politeness-refit/box-src` + its patches (+ `2026-10-26-make-wmi/04-...` for box1), which reproduces `d05cd479…` and `8c39cf86…` byte for byte, and the patches were cut and applied against those (`scripts/box/trim-wiring-boxes-134.test.mjs` re-does this in CI). The patch only **adds** 7 lines: the import after `brand_match.js` and the 6-line trim block after `applyWindowSticker(...)`, the same text #609 has in the repo.
- **The sync client result md5 is not known in advance.** `e41f34ff…` is box2's live file and its text is not in the repo, so the edit is a one-line `sed` guarded by: md5 must be `e41f34ff…`, the anchor must occur exactly once, the file must have no `trimRaw` yet, and the edited copy must differ from the original by exactly one line and parse. The script prints the resulting md5 and writes it to `~/backups/trim-wiring-20261029/md5s-after.txt`; record it here after the first box so boxes 3 and 1 can be compared to it (all three start from the same md5, so all three must end on the same one).
- The sync client change only **passes `trimRaw` through** (the shard rows are already normalized by the crawler once `standalone.js` is wired). It does not normalize on its own; that is the held `2026-10-28-oem-trim-sync-api-wiring` patch, which is cut for the repo text and is not needed here.

## No restart is needed (confirmed from the code, not from a running box)
A crawl is `node src/standalone.js ...` started by cron / the chain script, and the sync is `node inventory-sync.mjs` started by `run_sync_when_safe.sh`; each is a fresh Node process that reads the files at start (`docs/BOXES.md`, make-wmi and politeness STEPS say the same). Nothing long-lived imports these files on boxes 1/3/4 (the deals API is box2 only). The script refuses if a node process on those scripts is running, so there is no process holding the old text. Active from each box's next crawl / sync.

## SSH form (not `-J`: `-i` does not reach the jump host, it fails "Permission denied" at box2)
Run from the repo checkout (a fresh worktree off `origin/main`, `docs/BOXES.md`).
```bash
K=~/.ssh/LightsailDefaultKey-us-east-1.pem
PX="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -W %h:%p ubuntu@52.202.234.65"
SSHB="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o ProxyCommand=$PX"
SCPB="scp -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o ProxyCommand=$PX"
D=docs/box-patches/2026-10-29-trim-wiring-boxes-134
# box4 172.26.11.241, box3 172.26.15.105, box1 172.26.1.32; user ubuntu. In zsh do not rely on `set -- $var` splitting.
```
The install script is fed through **stdin** (`bash -s -- check < install-trim-wiring.sh`), so the box's process list never contains the words `standalone` / `inventory-sync` from this procedure (that is what made the pgrep check see a phantom crawl: an `ssh ... 'bash -c "...standalone..."'` command line matches `pgrep -f`). Files are staged with `scp`, whose remote command (`scp -t`) matches nothing.

## Steps, per box (shown for box4; repeat with box3, then box1)
0. **Before the first box only (read-only, box2):** the live deals API has to accept the `trimRaw` the sync will now send. `$SSHB ubuntu@52.202.234.65 'grep -c "v.trimRaw" /opt/trimscout-deals/src/deals_api_server.js'` should be at least 1 (the repo's `handleInventoryBulk` reads it). If it is 0 the trim is still stored normalized but `trim_raw` stays empty for non-Ford rows; report it, it does not block the install.
1. **Idle and time:** after this box's sync has finished (`run_sync_when_safe.sh` done, sync lock free), between 07:00 and 21:30 ET. The script re-checks processes and time itself and refuses otherwise.
2. **Stage (writes only to `/tmp/trimwire-stage` on the box):**
```bash
IP=172.26.11.241
$SSHB ubuntu@$IP 'mkdir -p /tmp/trimwire-stage'
$SCPB scrapers/lightsail-crawler/src/oemTrim.js scrapers/lightsail-crawler/src/fordTrim.js $D/standalone.js.box1.patch $D/standalone.js.box3-box4.patch ubuntu@$IP:/tmp/trimwire-stage/
```
3. **Check (read-only; trial on copies in a temp dir, nothing written to the checkout):**
```bash
$SSHB ubuntu@$IP 'bash -s -- check' < $D/install-trim-wiring.sh
```
   Expect `standalone.js d05cd479… = box3/box4 variant` (box1: `8c39cf86…`), `inventory-sync.mjs e41f34ff… = sweep-guarded, no trimRaw`, `trial ok: standalone.js -> 6f4c4f2a…` (box1 `980769d1…`), `inventory-sync.mjs -> <md5> (one line changed)`, `oemTrim.js smoke test ok`, then `CHECK only`. Any `REFUSED:` line = stop and report; do not improvise.
4. **Apply, only after Paul's typed GO for this box:**
```bash
$SSHB ubuntu@$IP 'bash -s -- apply' < $D/install-trim-wiring.sh
```
   It re-runs the check, then backs up to `~/backups/trim-wiring-20261029/` (`standalone.js.before`, `inventory-sync.mjs.before`, `md5s-before.txt`, and an `oemTrim.js.absent` / `fordTrim.js.absent` marker each), installs, verifies md5s and `node --check`, and **restores everything by itself** if any step fails. It ends by printing the new md5s (also in `md5s-after.txt`) and the rollback command.
5. **Verify (read-only):** `$SSHB ubuntu@$IP 'md5sum ~/nj-scraper/scrapers/lightsail-crawler/src/{standalone,oemTrim,fordTrim}.js ~/inventory-sync/inventory-sync.mjs; cat ~/backups/trim-wiring-20261029/md5s-after.txt'`. After the box's next crawl: a Toyota / Chevrolet / GMC / Ram / Ford VIN in a fresh shard carries `trimRaw` where its trim was rewritten, and after the next sync `SELECT trim, trim_raw FROM dealer_inventory WHERE trim_raw IS NOT NULL AND make IN ('Toyota','Chevrolet','GMC','Ram') ORDER BY last_seen_at DESC LIMIT 20` (reader account) shows them.
6. Next box. Planned: box4 ~09:50 ET, box3 ~08:20 ET or after box4, box1 ~13:05 ET.

## Rollback (per box, any time; allowed while idle or not, it only copies files back)
```bash
$SSHB ubuntu@$IP 'bash -s -- rollback' < $D/install-trim-wiring.sh
```
It checks the backups against `md5s-before.txt` first, restores `standalone.js` and `inventory-sync.mjs`, and removes `oemTrim.js` / `fordTrim.js` (they were absent before). Afterwards `md5sum` of the two restored files must read `d05cd479…` (box1 `8c39cf86…`) and `e41f34ff…`. Rows already crawled or synced keep their normalized trim with the original in `trimRaw` / `trim_raw`; the normalizer's own `--rollback=FILE` (box2) restores database rows if ever wanted. By hand, if the script itself cannot run: `cp -p ~/backups/trim-wiring-20261029/standalone.js.before .../src/standalone.js; cp -p ~/backups/trim-wiring-20261029/inventory-sync.mjs.before ~/inventory-sync/inventory-sync.mjs; rm -f .../src/oemTrim.js .../src/fordTrim.js`.

## What this does not do
Existing database rows are not touched (the box2 clean-up script `2026-10-27-oem-trim-normalize.mjs` does that, separately, on its own GO). The deals-API write path on box2 is not changed here. Crawler-side pieces other than `standalone.js` (e.g. the `finder_crawler.js` path) are unchanged.
