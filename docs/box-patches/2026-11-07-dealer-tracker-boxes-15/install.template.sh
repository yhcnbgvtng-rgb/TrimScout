#!/bin/bash
# Per-dealer crawl performance tracker for crawl boxes box1 (v2) and box5. Two files, all or nothing:
#   src/dealerTracker.js   NEW (embedded below; node built-ins only, imports nothing else from the crawler)
#   src/standalone.js      patched with a zero-fuzz, insert-only patch (14 hooks, one `} catch {}` becomes `} catch { dealerTrack.urlError(); }`),
#                          pinned against the live post-#719/#720/#721 file of each box (box1 and box5 differ)
# Does NOT touch heapGuard.js (#719), dom_store.js (#720), dom_index_delta.js (#721), bigJson.js (#726 may or may not be installed: both states are fine),
# data/, crontab, env, heap size. No restart: the next crawl is a fresh Node process.
# Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, zero-fuzz patch + smoke test on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up standalone.js back, remove dealerTracker.js (tracker records in data/dealer_tracker are left)
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, a file whose md5 is not a known state, #719/#721 files missing or changed.
# Runtime kill switch without any file change: CRAWLER_DEALER_TRACKER=off in a crawl's environment.
set -u
C=${DTRACK_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${DTRACK_BACKUP:-/home/ubuntu/backups/dealer-tracker-20261107}
SRC=$C/src; SA=$SRC/standalone.js; DT=$SRC/dealerTracker.js
DT_MD5=@@DT_MD5@@
HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48; DD_MD5=c239bd77b63394bea9b2e6ed365e3f48
BJ_OLD=650637d98c37bf861098821826b5d696; BJ_726=@@BJ_726@@
B1_SA=2e4ce13a348e931d264c86e9d1ac1b64; B1_SA_AFTER=@@B1_AFTER@@
B5_SA=88d56d156968ae2081c0cedf1a3c0642; B5_SA_AFTER=@@B5_AFTER@@

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="standalone.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/standalone.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/standalone.js.before" "$SA.rb" && mv -f "$SA.rb" "$SA"
  rm -f "$DT"
  echo "restored: standalone.js $(md5of "$SA"), dealerTracker.js removed. Records already written stay in $C/data/dealer_tracker (delete by hand if unwanted)."
  exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$SA" "$SRC/heapGuard.js" "$SRC/dom_index_delta.js" "$SRC/dom_store.js" "$SRC/bigJson.js"; do [ -f "$f" ] || fail "$f not found (wrong box or path, or #719/#720/#721 not installed)"; done
[ "$(md5of "$SRC/heapGuard.js")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$SRC/dom_index_delta.js")" = "$DD_MD5" ] || fail "dom_index_delta.js md5 is not the #721 file"
bj=$(md5of "$SRC/bigJson.js")
case "$bj" in
  "$BJ_OLD") echo "note: bigJson.js is the pre-#726 file; not used by this package";;
  "$BJ_726") echo "note: bigJson.js is the #726 file; not used by this package";;
  *) echo "note: bigJson.js md5 $bj is neither the pre-#726 nor the #726 file; this package does not use it, continuing";;
esac
node -e 'process.exit(parseInt(process.versions.node)>=18?0:1)' || fail "node $(node -v) is too old"

sa=$(md5of "$SA"); BOX=
case "$sa" in
  "$B1_SA") BOX=b1; SA_AFTER=$B1_SA_AFTER; echo "box1 variant (standalone $sa)";;
  "$B5_SA") BOX=b5; SA_AFTER=$B5_SA_AFTER; echo "box5 variant (standalone $sa)";;
  "$B1_SA_AFTER"|"$B5_SA_AFTER") [ -f "$DT" ] && [ "$(md5of "$DT")" = "$DT_MD5" ] || fail "standalone.js is patched but dealerTracker.js is missing or not the pinned file"; echo "ALREADY INSTALLED, nothing to do."; exit 0;;
  *) fail "standalone.js md5 $sa is not a known state (box1 $B1_SA, box5 $B5_SA, or the patched files). Send the file back; do not improvise.";;
esac
[ ! -e "$DT" ] || [ "$(md5of "$DT")" = "$DT_MD5" ] || fail "$DT exists with an unexpected md5"

W=$(mktemp -d /tmp/dealertracker-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_dt()  { base64 -d <<'DTEOF'
@@DT_B64@@
DTEOF
}
emit_p_b1() { base64 -d <<'P1EOF'
@@P1_B64@@
P1EOF
}
emit_p_b5() { base64 -d <<'P5EOF'
@@P5_B64@@
P5EOF
}
emit_dt > "$W/dealerTracker.js.new" || fail "cannot decode the embedded dealerTracker.js"
[ "$(md5of "$W/dealerTracker.js.new")" = "$DT_MD5" ] || fail "embedded dealerTracker.js does not match its pinned md5 (corrupt package)"
if [ "$BOX" = b1 ]; then emit_p_b1 > "$W/standalone.patch"; else emit_p_b5 > "$W/standalone.patch"; fi
# insert-only: the patch may remove exactly one line (the swallow-all catch of extractOne, replaced by the same catch plus a counter)
removed=$(grep -c '^-[^-]' "$W/standalone.patch"); [ "$removed" = 1 ] || fail "patch removes $removed lines, expected exactly 1 (corrupt package)"

# Trial on COPIES only
cp "$SA" "$W/standalone.js"
( cd "$W" && patch -F0 -s standalone.js < standalone.patch ) || fail "the patch does not apply with zero fuzz to this box's standalone.js"
[ "$(md5of "$W/standalone.js")" = "$SA_AFTER" ] || fail "patched standalone.js md5 $(md5of "$W/standalone.js") is not the pinned $SA_AFTER"
cp "$W/standalone.js" "$W/src/standalone.check.mjs"; node --check "$W/src/standalone.check.mjs" || fail "patched standalone.js has a syntax error"; rm -f "$W/src/standalone.check.mjs"
# the only lines of the original that may differ: the one replaced catch. Everything else is byte-identical (diff shows additions only).
chg=$(diff "$SA" "$W/standalone.js" | grep -c '^<'); [ "$chg" = 1 ] || fail "patched file differs from the original in $chg existing line(s), expected 1"
cp "$W/dealerTracker.js.new" "$W/src/dealerTracker.js"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { createDealerTracker } from './dealerTracker.js';
const need = (c, m) => { if (!c) throw new Error(m); };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dealertracker-trial-data-'));
try {
  const errs = [];
  const t = createDealerTracker({ cwd, state: 'ZZ', brand: 'Trial', dealerTotal: 3, runDate: '2026-01-01', box: 'trial', stderr: (m) => errs.push(m), installExitHandler: false });
  need(t.enabled, 'tracker did not start');
  t.begin({ id: 'ok', name: 'Trial Ok', domain: 'ok.example' }, { index: 0 }); t.discovered(2); t.urlStart(); t.vehicle(); t.urlStart(); t.pageBlocked('X'); t.end(() => ({ timedOut: false, heapStopped: false, wall: null }));
  t.begin({ id: 'boom', name: 'Trial Boom' }, { index: 1 }); t.error(new Error('trial error')); t.end(() => ({}));
  t.begin({ id: 'skip', name: 'Trial Skip' }, { index: 2 }); t.endProbeSkip(() => ({ classification: 'X', httpStatus: 403 }));
  t.runEnd();
  const recs = fs.readFileSync(t.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const e = recs.filter((r) => r.ev === 'end');
  need(recs.length === 8 && e.length === 3, 'wrong record count ' + recs.length);
  need(e[0].status === 'complete' && e[0].vins === 1 && e[0].urls.attempted === 2 && e[0].mem.dealerAttributable === null, 'complete record wrong');
  need(e[1].status === 'failed' && e[1].reason === 'exception' && e[2].status === 'skipped' && e[2].reason === 'probe_skip', 'failure/skip records wrong');
  // a dead disk must not throw into the caller
  const bad = createDealerTracker({ cwd, runDate: '2026-01-02', appendLine: () => { throw new Error('ENOSPC'); }, stderr: () => {}, installExitHandler: false });
  for (let i = 0; i < 10; i++) { bad.begin({ id: 'd' }, {}); bad.urlStart(); bad.end(() => ({})); }
  bad.runEnd();
  console.log('trial ok: 3 attempts recorded (complete, exception, probe skip), memory split present, failing disk did not throw');
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "smoke test on copies failed"
echo "check ok: standalone.js $sa -> $SA_AFTER (+ new dealerTracker.js $DT_MD5); heapGuard.js/dom_index_delta.js as pinned, dom_store.js/bigJson.js not touched; data/ not touched"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$SA" "$BK/standalone.js.before" && echo "$sa  standalone.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/standalone.js.before")" = "$sa" ] || fail "backup copy does not match"
cp "$W/dealerTracker.js.new" "$DT.new" && mv -f "$DT.new" "$DT"   # first: the patched standalone.js imports it
cp "$W/standalone.js" "$SA.new" && mv -f "$SA.new" "$SA"
if [ "$(md5of "$SA")" != "$SA_AFTER" ] || [ "$(md5of "$DT")" != "$DT_MD5" ] || ! ( cd "$C" && node -e "import('./src/dealerTracker.js').then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/standalone.js.before" "$SA.rb" && mv -f "$SA.rb" "$SA"; rm -f "$DT"; fail "installed files failed verification; restored the original standalone.js ($(md5of "$SA")) and removed dealerTracker.js"
fi
echo "installed: standalone.js $(md5of "$SA"), dealerTracker.js $(md5of "$DT"); backup $BK"
