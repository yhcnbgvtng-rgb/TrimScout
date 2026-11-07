#!/bin/bash
# bigJson.js "parse each element as it is read", for crawl boxes box1 (v2) and box5. ONE file: src/bigJson.js (replaced whole; pinned before/after md5).
# Why: readJsonStreaming kept the text of every element until end of file, then parsed. A load of a 600 MB dom_index.json peaked at 1206 MB heap, 658 MB after (synthetic, node 22).
# bigJson.js is shared: dom_store.js (dom_index.json), standalone.js (state shards, daily changes), enricher, vinCacheShared, inventory_shards, legacyShardSplit all call readJsonLarge.
#
# Prerequisites, each pinned by md5 and checked (this package does NOT rewrite the 2026-11-06 packages' pins; they pin the OLD bigJson.js and refuse once this one is applied):
#   #719 heapGuard.js 452ce895, #720 dom_store.js 541b78ff, #721 dom_index_delta.js c239bd77 + pid_lock.js c5356386, standalone.js 2e4ce13a (box1) or 88d56d15 (box5).
# Self-contained (new bigJson.js embedded as base64). Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, then a trial on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up bigJson.js back
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, any md5 that is not a known state, a prerequisite missing.
# Never touches data/, crontab, env or heap settings. No restart: the next crawl is a fresh Node process.
set -u
C=${BIGJSON_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${BIGJSON_BACKUP:-/home/ubuntu/backups/bigjson-parse-20261107}
SRC=$C/src; BJ=$SRC/bigJson.js
BJ_BEFORE=650637d98c37bf861098821826b5d696; BJ_AFTER=@@BJ_AFTER@@
HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48; DS_MD5=541b78ff568d0d11b740e1e67a8ba06c; DD_MD5=c239bd77b63394bea9b2e6ed365e3f48; PL_MD5=c535638661e29ecce3c964591775bc11
SA_B1=2e4ce13a348e931d264c86e9d1ac1b64; SA_B5=88d56d156968ae2081c0cedf1a3c0642

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="bigJson.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/bigJson.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/bigJson.js.before" "$BJ.rb" && mv -f "$BJ.rb" "$BJ"
  echo "restored: bigJson.js $(md5of "$BJ")"; exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$BJ" "$SRC/heapGuard.js" "$SRC/dom_store.js" "$SRC/dom_index_delta.js" "$SRC/pid_lock.js" "$SRC/price_diff.js" "$SRC/date_utils.js" "$SRC/standalone.js"; do [ -f "$f" ] || fail "$f not found (wrong box or path, or #719/#720/#721 not installed)"; done
[ "$(md5of "$SRC/heapGuard.js")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$SRC/dom_store.js")" = "$DS_MD5" ] || fail "dom_store.js md5 is not the #720 file"
[ "$(md5of "$SRC/dom_index_delta.js")" = "$DD_MD5" ] || fail "dom_index_delta.js md5 is not the #721 file"
[ "$(md5of "$SRC/pid_lock.js")" = "$PL_MD5" ] || fail "pid_lock.js md5 is not the pinned $PL_MD5"
sa=$(md5of "$SRC/standalone.js"); [ "$sa" = "$SA_B1" ] || [ "$sa" = "$SA_B5" ] || fail "standalone.js md5 $sa is not the post-#721 file of box1 ($SA_B1) or box5 ($SA_B5)"
bj=$(md5of "$BJ")
if [ "$bj" = "$BJ_AFTER" ]; then echo "ALREADY INSTALLED (bigJson.js $bj), nothing to do."; exit 0; fi
[ "$bj" = "$BJ_BEFORE" ] || fail "bigJson.js md5 $bj is not a known state ($BJ_BEFORE before / $BJ_AFTER after). Send the file back; do not improvise."

W=$(mktemp -d /tmp/bigjson-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_bj() { base64 -d <<'BJEOF'
@@BJ_B64@@
BJEOF
}
emit_bj > "$W/bigJson.js.new" || fail "cannot decode the embedded bigJson.js"
[ "$(md5of "$W/bigJson.js.new")" = "$BJ_AFTER" ] || fail "embedded bigJson.js does not match its pinned md5 (corrupt package)"

# Trial on COPIES: the new bigJson.js beside the box's own dom_store / dom_index_delta / pid_lock / price_diff / date_utils, in the temp dir. The real data/ is never opened.
cp "$W/bigJson.js.new" "$W/src/bigJson.js"
for f in heapGuard.js dom_store.js dom_index_delta.js pid_lock.js price_diff.js date_utils.js; do cp "$SRC/$f" "$W/src/$f"; done
[ -f "$C/package.json" ] && cp "$C/package.json" "$W/package.json"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { readJsonLarge, writeJsonLarge } from './bigJson.js';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
import { prepareStreamMerge } from './dom_index_delta.js';
const S = { streamAboveBytes: 0, chunkBytes: 7 };
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'bigjson-trial-data-'));
const rec = (v, d) => ({ hash: 'h' + v, price: v + d, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false });
try {
  // 1. same results as JSON.parse for object / array / scalar / empty / duplicate keys, with tiny chunks so entries straddle chunk edges
  const cases = { '{}': {}, '[]': [], '  {\n}\n': {}, '42': 42, '"x"': 'x', '{"A":1,"B":2,"A":3}': { A: 3, B: 2 }, '[{"a":"b,c}"},[1,2],"]"]': [{ a: 'b,c}' }, [1, 2], ']'] };
  for (const [text, want] of Object.entries(cases)) { const f = path.join(cwd, 'c.json'); await fs.writeFile(f, text); if (JSON.stringify(await readJsonLarge(f, S)) !== JSON.stringify(want)) throw new Error('readJsonLarge differs from JSON.parse for ' + text); }
  // 2. malformed / truncated input still throws and is not modified
  for (const text of ['{"A":{"x":1},"B":{"x":}}', '{"A":{"x":1},"B":{"2026', '', '[1,2', '{"A":1} junk']) {
    const f = path.join(cwd, 'bad.json'); await fs.writeFile(f, text);
    let threw = false; try { await readJsonLarge(f, S); } catch { threw = true; }
    if (!threw && text !== '{"A":1} junk') throw new Error('malformed input did not throw: ' + JSON.stringify(text));
    if ((await fs.readFile(f, 'utf8')) !== text) throw new Error('malformed file was modified');
  }
  // 3. dom_index save/load through the box's own dom_store.js (overlapping saves, missing -> {}, malformed -> fail closed and untouched)
  const idx = {}; for (let v = 0; v < 5000; v++) idx['V' + v] = { '2026-11-01': rec(v, 0), '2026-11-02': rec(v, 1) };
  await Promise.all([saveDomIndex(idx, cwd), saveDomIndex(idx, cwd)]);
  if (JSON.stringify(JSON.parse(await fs.readFile(domPaths(cwd).indexPath, 'utf8'))) !== JSON.stringify(idx)) throw new Error('whole-file JSON.parse does not give the index back');
  if (JSON.stringify(await loadDomIndex(cwd, { read: (f) => readJsonLarge(f, S) })) !== JSON.stringify(idx)) throw new Error('streamed loadDomIndex does not give the index back');
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigjson-trial-empty-'));
  try { if (JSON.stringify(await loadDomIndex(emptyDir)) !== '{}') throw new Error('a missing index must load as {}'); } finally { await fs.rm(emptyDir, { recursive: true, force: true }); }
  const bad = domPaths(cwd).indexPath; await fs.writeFile(bad, '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026');
  let threw = false; try { await loadDomIndex(cwd, { retryDelayMs: 1, read: (f) => readJsonLarge(f, S) }); } catch (e) { threw = e.code === 'DOM_INDEX_UNREADABLE'; }
  if (!threw) throw new Error('a malformed index must make the load throw (fail closed)');
  if ((await fs.readFile(bad, 'utf8')) !== '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026') throw new Error('the malformed index was modified');
  // 4. #721's streaming merge writes a temp file and verifies it (new VIN, existing VIN, one conflicting record), without renaming
  await saveDomIndex(idx, cwd);
  const m = await prepareStreamMerge(domPaths(cwd).indexPath, { V1: { '2026-11-03': rec(1, 9), '2026-11-02': { ...rec(1, 1), price: 1 } }, NEW1: { '2026-11-03': rec(9, 9) } });
  try { if (m.vinsOut !== 5001 || m.added < 2 || m.conflicts.length !== 1) throw new Error('merge trial gave vinsOut ' + m.vinsOut + ', added ' + m.added + ', conflicts ' + m.conflicts.length); } finally { await m.abort(); }
  const left = (await fs.readdir(domPaths(cwd).dataDir)).filter((n) => n !== 'dom_index.json');
  if (left.length) throw new Error('leftover files: ' + left.join(','));
  console.log('trial ok: readJsonLarge == JSON.parse on 7 shapes, 5 malformed inputs rejected and untouched, 5000-VIN save x2 / streamed load identical, missing -> {}, malformed -> fail closed, #721 stream merge + verify (1 conflict) ok, no temp files left');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "trial on copies failed"
echo "check ok: bigJson.js $bj -> $BJ_AFTER (#719 heapGuard, #720 dom_store, #721 dom_index_delta/pid_lock, standalone.js as pinned; data/ not touched)"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$BJ" "$BK/bigJson.js.before" && echo "$bj  bigJson.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/bigJson.js.before")" = "$bj" ] || fail "backup copy does not match"
cp "$W/bigJson.js.new" "$BJ.new" && mv -f "$BJ.new" "$BJ"
if [ "$(md5of "$BJ")" != "$BJ_AFTER" ] || ! ( cd "$C" && node -e "Promise.all([import('./src/bigJson.js'),import('./src/dom_store.js'),import('./src/dom_index_delta.js')]).then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/bigJson.js.before" "$BJ.rb" && mv -f "$BJ.rb" "$BJ"; fail "installed file failed verification; restored the original ($(md5of "$BJ"))"
fi
echo "installed: bigJson.js $(md5of "$BJ"); backup $BK"
