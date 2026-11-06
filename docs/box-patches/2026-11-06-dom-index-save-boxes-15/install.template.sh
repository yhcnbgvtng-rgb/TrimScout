#!/bin/bash
# dom_index.json incremental save, for crawl boxes box1 (v2) and box5. ONE file: src/dom_store.js (replaced whole; pinned before/after md5).
# Needs #719 already installed (heapGuard.js present) and bigJson.js at its pinned md5 (it is the same file on both boxes, already used by standalone.js).
# Self-contained: the new dom_store.js is embedded below (base64), so `check` stages nothing on the box. Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, then a save/load trial on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up dom_store.js back
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, a dom_store.js / bigJson.js whose md5 is not a known state, #719 missing.
# Never touches data/dom_index.json, crontab, env or heap settings. No restart: the next crawl is a fresh Node process.
set -u
C=${DOMSAVE_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${DOMSAVE_BACKUP:-/home/ubuntu/backups/dom-index-save-20261106}
SRC=$C/src; DS=$SRC/dom_store.js; BJ=$SRC/bigJson.js; HG=$SRC/heapGuard.js
DS_BEFORE=1a2e29b0166878a3561c21ca8c427bf1; DS_AFTER=@@DS_AFTER@@; BJ_MD5=650637d98c37bf861098821826b5d696; HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="dom_store.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/dom_store.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/dom_store.js.before" "$DS.rb" && mv -f "$DS.rb" "$DS"
  echo "restored: dom_store.js $(md5of "$DS")"; exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$DS" "$BJ" "$HG"; do [ -f "$f" ] || fail "$f not found (wrong box, path, or #719 not installed)"; done
[ "$(md5of "$HG")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$BJ")" = "$BJ_MD5" ] || fail "bigJson.js md5 $(md5of "$BJ") is not the pinned $BJ_MD5. Send the file back; do not improvise."
ds=$(md5of "$DS")
if [ "$ds" = "$DS_AFTER" ]; then echo "ALREADY INSTALLED (dom_store.js $ds), nothing to do."; exit 0; fi
[ "$ds" = "$DS_BEFORE" ] || fail "dom_store.js md5 $ds is not a known state ($DS_BEFORE before / $DS_AFTER after). Send the file back; do not improvise."

W=$(mktemp -d /tmp/domsave-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_ds() { base64 -d <<'DSEOF'
@@DS_B64@@
DSEOF
}
emit_ds > "$W/dom_store.js.new" || fail "cannot decode the embedded dom_store.js"
[ "$(md5of "$W/dom_store.js.new")" = "$DS_AFTER" ] || fail "embedded dom_store.js does not match its pinned md5 (corrupt package)"

# Trial on COPIES: the new dom_store.js beside the box's own bigJson.js / price_diff.js / date_utils.js, in the temp dir. The real data/ is never opened.
cp "$W/dom_store.js.new" "$W/src/dom_store.js"; cp "$BJ" "$W/src/bigJson.js"; cp "$SRC/price_diff.js" "$W/src/price_diff.js"; cp "$SRC/date_utils.js" "$W/src/date_utils.js"
[ -f "$C/package.json" ] && cp "$C/package.json" "$W/package.json"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'domsave-trial-data-'));
try {
  const idx = {}; for (let v = 0; v < 5000; v++) idx['V' + v] = { '2026-11-01': { hash: 'h' + v, price: v, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false }, '2026-11-02': { hash: 'h' + v, price: v + 1, oldPrice: v, priceDiff: 1, priceChangeType: 'UP', blobStored: false, hashUnchanged: true } };
  await Promise.all([saveDomIndex(idx, cwd), saveDomIndex(idx, cwd)]);
  const raw = await fs.readFile(domPaths(cwd).indexPath, 'utf8');
  if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(idx)) throw new Error('whole-file JSON.parse does not give the index back');
  if (JSON.stringify(await loadDomIndex(cwd)) !== JSON.stringify(idx)) throw new Error('loadDomIndex does not give the index back');
  const left = (await fs.readdir(domPaths(cwd).dataDir)).filter((n) => n !== 'dom_index.json');
  if (left.length) throw new Error('leftover files: ' + left.join(','));
  console.log('trial ok: 5000 VINs saved twice (overlapping), reloaded identical, no temp files left');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "trial on copies failed"
echo "check ok: dom_store.js $ds -> $DS_AFTER (bigJson.js, heapGuard.js as pinned; data/dom_index.json not touched)"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$DS" "$BK/dom_store.js.before" && echo "$ds  dom_store.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/dom_store.js.before")" = "$ds" ] || fail "backup copy does not match"
cp "$W/dom_store.js.new" "$DS.new" && mv -f "$DS.new" "$DS"
if [ "$(md5of "$DS")" != "$DS_AFTER" ] || ! ( cd "$C" && node -e "import('./src/dom_store.js').then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/dom_store.js.before" "$DS.rb" && mv -f "$DS.rb" "$DS"; fail "installed file failed verification; restored the original ($(md5of "$DS"))"
fi
echo "installed: dom_store.js $(md5of "$DS"); backup $BK"
