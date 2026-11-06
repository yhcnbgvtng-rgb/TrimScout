#!/bin/bash
# dom_index delta merge for crawl boxes box1 (v2) and box5 (PR #721). Two files, all or nothing:
#   src/dom_index_delta.js  NEW (embedded below)
#   src/standalone.js       patched with a zero-fuzz patch, pinned against the live post-#719 file of each box (box1 and box5 differ)
# Needs #719 (heapGuard.js) AND #720 (dom_store.js 541b78ff) already installed; refuses otherwise. Does not touch dom_store.js, bigJson.js, heapGuard.js, data/, crontab or env.
# Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, zero-fuzz patch + smoke test on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up standalone.js back, remove dom_index_delta.js (warns if unmerged delta files remain)
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, a file whose md5 is not a known state, #719/#720 missing.
# No restart, no cron or env change: the next crawl is a fresh Node process.
set -u
C=${DOMDELTA_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${DOMDELTA_BACKUP:-/home/ubuntu/backups/dom-index-delta-20261106}
SRC=$C/src; SA=$SRC/standalone.js; DD=$SRC/dom_index_delta.js
DD_MD5=@@DD_MD5@@
DS_MD5=541b78ff568d0d11b740e1e67a8ba06c; BJ_MD5=650637d98c37bf861098821826b5d696; HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48; PL_MD5=c535638661e29ecce3c964591775bc11
B1_SA=f81fbd6177e06a4060230ff9b383c4ca; B1_SA_AFTER=@@B1_AFTER@@
B5_SA=752cf191c2a71dee0fd0b23568dc28d5; B5_SA_AFTER=@@B5_AFTER@@

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="standalone.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/standalone.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/standalone.js.before" "$SA.rb" && mv -f "$SA.rb" "$SA"
  rm -f "$DD"
  left=$(ls "$C/data/dom_index_delta" 2>/dev/null | grep -cE '^(delta|claimed)-')
  echo "restored: standalone.js $(md5of "$SA"), dom_index_delta.js removed"
  [ "$left" = 0 ] || echo "WARNING: $left unmerged delta file(s) in $C/data/dom_index_delta hold crawl records that are NOT in dom_index.json yet. They are safe on disk; do not delete them. Re-apply this package (the next merge picks them up) or ask before touching them." >&2
  exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$SA" "$SRC/dom_store.js" "$SRC/bigJson.js" "$SRC/heapGuard.js" "$SRC/pid_lock.js" "$SRC/price_diff.js" "$SRC/date_utils.js"; do [ -f "$f" ] || fail "$f not found (wrong box or path, or #719/#720 not installed)"; done
[ "$(md5of "$SRC/heapGuard.js")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$SRC/dom_store.js")" = "$DS_MD5" ] || fail "dom_store.js md5 $(md5of "$SRC/dom_store.js") is not the #720 file $DS_MD5 (install #720 first, or send the file back)"
[ "$(md5of "$SRC/bigJson.js")" = "$BJ_MD5" ] || fail "bigJson.js md5 is not the pinned $BJ_MD5"
[ "$(md5of "$SRC/pid_lock.js")" = "$PL_MD5" ] || fail "pid_lock.js md5 is not the pinned $PL_MD5"
node -e 'process.exit(parseInt(process.versions.node)>=18?0:1)' || fail "node $(node -v) is too old"
{ flock --version >/dev/null 2>&1 || python3 -c 'import fcntl' >/dev/null 2>&1; } || fail "neither flock(1) nor python3 with fcntl is installed: the merge lock needs one of them"

sa=$(md5of "$SA"); BOX=
case "$sa" in
  "$B1_SA") BOX=b1; SA_AFTER=$B1_SA_AFTER; echo "box1 variant (standalone $sa)";;
  "$B5_SA") BOX=b5; SA_AFTER=$B5_SA_AFTER; echo "box5 variant (standalone $sa)";;
  "$B1_SA_AFTER"|"$B5_SA_AFTER") [ -f "$DD" ] && [ "$(md5of "$DD")" = "$DD_MD5" ] || fail "standalone.js is patched but dom_index_delta.js is missing or not the pinned file"; echo "ALREADY INSTALLED, nothing to do."; exit 0;;
  *) fail "standalone.js md5 $sa is not a known state (box1 $B1_SA, box5 $B5_SA, or the patched files). Send the file back; do not improvise.";;
esac
[ ! -e "$DD" ] || [ "$(md5of "$DD")" = "$DD_MD5" ] || fail "$DD exists with an unexpected md5"

W=$(mktemp -d /tmp/domdelta-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_dd()  { base64 -d <<'DDEOF'
@@DD_B64@@
DDEOF
}
emit_p_b1() { base64 -d <<'P1EOF'
@@P1_B64@@
P1EOF
}
emit_p_b5() { base64 -d <<'P5EOF'
@@P5_B64@@
P5EOF
}
emit_dd > "$W/dom_index_delta.js.new" || fail "cannot decode the embedded dom_index_delta.js"
[ "$(md5of "$W/dom_index_delta.js.new")" = "$DD_MD5" ] || fail "embedded dom_index_delta.js does not match its pinned md5 (corrupt package)"
if [ "$BOX" = b1 ]; then emit_p_b1 > "$W/standalone.patch"; else emit_p_b5 > "$W/standalone.patch"; fi

# Trial on COPIES only
cp "$SA" "$W/standalone.js"
( cd "$W" && patch -F0 -s standalone.js < standalone.patch ) || fail "the patch does not apply with zero fuzz to this box's standalone.js"
[ "$(md5of "$W/standalone.js")" = "$SA_AFTER" ] || fail "patched standalone.js md5 $(md5of "$W/standalone.js") is not the pinned $SA_AFTER"
cp "$W/standalone.js" "$W/src/standalone.check.mjs"; node --check "$W/src/standalone.check.mjs" || fail "patched standalone.js has a syntax error"; rm -f "$W/src/standalone.check.mjs"
for f in dom_store.js bigJson.js pid_lock.js price_diff.js date_utils.js; do cp "$SRC/$f" "$W/src/$f"; done
cp "$W/dom_index_delta.js.new" "$W/src/dom_index_delta.js"
[ -f "$C/package.json" ] && cp "$C/package.json" "$W/package.json"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
import { createDomDelta, checkpointDomDelta, mergeDomDelta, domDeltaDir, domConflictsDir, processIdentity, judgeOwner, flockPrefix, domMergeLockPath } from './dom_index_delta.js';
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'domdelta-trial-data-'));
const me = processIdentity(process.pid);
if (me.start === 'x' || me.boot === 'x' || judgeOwner(me).state !== 'alive' || judgeOwner({ ...me, start: 'deadbeef' }).state !== 'reused' || judgeOwner({ pid: 2147483000 }).state !== 'dead') throw new Error('process identity (pid + start + boot) cannot be read on this machine: ' + JSON.stringify(me));
const rec = (o = {}) => ({ hash: 'h', price: 1, oldPrice: null, priceDiff: 0, priceChangeType: 'UNCHANGED', blobStored: false, hashUnchanged: true, ...o });
const need = (c, m) => { if (!c) throw new Error(m); };
try {
  // the merge lock is a kernel flock held by the merge worker: a live holder excludes everyone, and the kernel frees it the instant the holder ends
  const prefix = flockPrefix(domMergeLockPath(cwd), 5); need(prefix, 'neither flock(1) nor python3 fcntl is available');
  await fs.mkdir(path.dirname(domMergeLockPath(cwd)), { recursive: true });
  const holder = spawn(prefix[0], [...prefix.slice(1), 'sleep', '60'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  const d0 = createDomDelta({ cwd, label: 'trial-held' });
  let blocked = false; try { await mergeDomDelta(d0, { log: () => {}, maxWaitMs: 1000 }); } catch (e) { blocked = /Timed out.*merge lock/.test(e.message); }
  need(blocked, 'a merge must wait for (and here time out on) a live holder of the flock');
  holder.kill('SIGKILL'); await new Promise((r) => holder.on('exit', r));
  await fs.rm(d0.path, { force: true }); // the probe's empty delta
  const base = {}; for (let v = 0; v < 3000; v++) base['V' + v] = { '2026-11-01': rec({ price: v }) };
  base.CONTESTED = { '2026-11-06': rec({ price: 111 }) };
  await saveDomIndex(base, cwd);
  await fs.mkdir(domDeltaDir(cwd), { recursive: true });
  await fs.writeFile(path.join(domDeltaDir(cwd), 'delta-2147483000-1.json'), JSON.stringify({ entries: { ORPHAN: { '2026-11-06': rec({ price: 9 }) } } })); // a dead process's delta
  const d = createDomDelta({ cwd, label: 'trial' });
  d.entries = { NEWVIN: { '2026-11-06': rec({ price: 5 }) }, V7: { '2026-11-06': rec({ price: 77 }) }, CONTESTED: { '2026-11-06': rec({ price: 222 }) } }; d.count = 3;
  await checkpointDomDelta(d);
  const r = await mergeDomDelta(d, { log: () => {} });
  const idx = await loadDomIndex(cwd);
  need(Object.keys(idx).length === 3003, 'wrong VIN count after merge: ' + Object.keys(idx).length);
  need(idx.ORPHAN && idx.NEWVIN && idx.V7['2026-11-01'].price === 7 && idx.V7['2026-11-06'].price === 77, 'merged records are wrong');
  need(r.conflicts === 1 && r.orphanFiles === 1, 'expected 1 conflict and 1 orphan, got ' + JSON.stringify(r));
  const cf = (await fs.readFile(r.conflictFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))[0];
  need(new Set([cf.kept.price, cf.dropped.price]).size === 2 && [cf.kept.price, cf.dropped.price].includes(111) && [cf.kept.price, cf.dropped.price].includes(222), 'the conflict file must hold both full records');
  need((await fs.readdir(domDeltaDir(cwd))).length === 0, 'delta files were not removed after the merge');
  need(!(await fs.readdir(domPaths(cwd).dataDir)).some((n) => n.includes('.tmp-')), 'a temp file was left behind');
  // fail closed: a malformed index is refused and left byte-for-byte as it was, the delta stays on disk
  const bad = '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026';
  await fs.writeFile(domPaths(cwd).indexPath, bad);
  const d2 = createDomDelta({ cwd, label: 'trial2' }); d2.entries = { X: { '2026-11-06': rec() } }; d2.count = 1; await checkpointDomDelta(d2);
  let threw = false; try { await mergeDomDelta(d2, { log: () => {}, attempts: 1 }); } catch (e) { threw = e.code === 'DOM_INDEX_UNREADABLE'; }
  need(threw, 'a malformed index must make the merge throw');
  need((await fs.readFile(domPaths(cwd).indexPath, 'utf8')) === bad, 'the malformed index was modified');
  need((await fs.readdir(domDeltaDir(cwd))).length === 1, 'the delta file must stay on disk after a failed merge');
  console.log('trial ok: process identity readable, flock merge lock exclusive and freed when its holder dies (' + me.start + '/' + me.boot.slice(0, 8) + '), streaming merge of 3003 VINs (1 new, 1 orphan delta, 1 conflict with both full records kept), malformed index refused untouched with its delta kept');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "smoke test on copies failed"
echo "check ok: standalone.js $sa -> $SA_AFTER (+ new dom_index_delta.js $DD_MD5); dom_store.js/bigJson.js/heapGuard.js/pid_lock.js as pinned (shared_data_lock.js is not used by the new code); data/ not touched"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$SA" "$BK/standalone.js.before" && echo "$sa  standalone.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/standalone.js.before")" = "$sa" ] || fail "backup copy does not match"
cp "$W/dom_index_delta.js.new" "$DD.new" && mv -f "$DD.new" "$DD"
cp "$W/standalone.js" "$SA.new" && mv -f "$SA.new" "$SA"
if [ "$(md5of "$SA")" != "$SA_AFTER" ] || [ "$(md5of "$DD")" != "$DD_MD5" ] || ! ( cd "$C" && node -e "import('./src/dom_index_delta.js').then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/standalone.js.before" "$SA.rb" && mv -f "$SA.rb" "$SA"; rm -f "$DD"; fail "installed files failed verification; restored the original standalone.js ($(md5of "$SA")) and removed dom_index_delta.js"
fi
echo "installed: standalone.js $(md5of "$SA"), dom_index_delta.js $(md5of "$DD"); backup $BK"
