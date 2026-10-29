#!/bin/bash
# Trim wiring for crawl boxes 1, 3, 4 (oemTrim.js + fordTrim.js + the trim block in standalone.js + trimRaw in the sync client).
# Run ON the box, from STDIN, so the box's process list never contains this text (a `bash -c '...standalone...'` command line is what made pgrep see a false "crawl running"):
#
#   ssh <box ProxyCommand form, see STEPS.md> 'bash -s -- check'    < install-trim-wiring.sh     # READ-ONLY: gates, md5s, trial on copies in a temp dir
#   ssh <box ...>                              'bash -s -- apply'    < install-trim-wiring.sh     # check, backup, install, verify; restores itself on any failure
#   ssh <box ...>                              'bash -s -- rollback' < install-trim-wiring.sh     # put everything back from the backup
#
# The files it needs are staged first with scp into /tmp/trimwire-stage/ (oemTrim.js, fordTrim.js, the two standalone patches); their md5s are checked here.
# It REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, any file whose md5 is not a known state, a staged file with the wrong md5.
# No restart: a crawl and a sync are fresh Node processes, so the new code is picked up by the next run. Nothing here touches cron, a database or a service.
set -u

# Dirs are overridable ONLY so the tests can run against a fake box; the md5 pins below are the real gate.
C=${TRIMWIRE_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
SYNC=${TRIMWIRE_SYNC:-/home/ubuntu/inventory-sync/inventory-sync.mjs}
STAGE=${TRIMWIRE_STAGE:-/tmp/trimwire-stage}
BK=${TRIMWIRE_BACKUP:-/home/ubuntu/backups/trim-wiring-20261029}
SRC=$C/src

# standalone.js: box1 / box3+box4 as read 2026-10-29 16:37 ET (after the politeness + make-wmi installs), and what the patch must produce.
SA_BOX1=8c39cf86d3017210d586ff3afeb33969;   SA_BOX1_AFTER=980769d114cba511aef4bc5ff033e0ae
SA_BOX34=d05cd479b8f8d22a77d4d9fb1ef2e31a;  SA_BOX34_AFTER=6f4c4f2a4b4db2ab2830e11074723dba
# inventory-sync.mjs on all three: the sweep-guarded file (box2's). The result is not pinned: its text is not in the repo, so the script proves "exactly one line changed" instead.
SYNC_BEFORE=${TRIMWIRE_SYNC_BEFORE_MD5:-e41f34ff8d9acd2efb025323b7f5bb80}
# Staged files.
ORM5=0f9bb8163921b82ff9f54748e1a64cee; FORD5=1224e1ae9aae5528a8af39ad5da3a2f3
PATCH_BOX1_MD5=898fac9f97ebc156a483e2ba88d6e260; PATCH_BOX34_MD5=5ba598232d58955194f38931815c9304

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

rollback_cmd() { echo "ROLLBACK: rerun this script with the argument 'rollback' (same ssh form, 'bash -s -- rollback' < install-trim-wiring.sh). By hand: cp -p $BK/standalone.js.before $SRC/standalone.js; cp -p $BK/inventory-sync.mjs.before $SYNC; rm -f $SRC/oemTrim.js $SRC/fordTrim.js (only if $BK/*.absent exist)."; }

if [ "$MODE" = rollback ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want_sa=$(awk '$2=="standalone.js"{print $1}' "$BK/md5s-before.txt"); want_sy=$(awk '$2=="inventory-sync.mjs"{print $1}' "$BK/md5s-before.txt")
  [ "$(md5of "$BK/standalone.js.before")" = "$want_sa" ] || fail "backup standalone.js does not match its recorded md5"
  [ "$(md5of "$BK/inventory-sync.mjs.before")" = "$want_sy" ] || fail "backup inventory-sync.mjs does not match its recorded md5"
  cp -p "$BK/standalone.js.before" "$SRC/standalone.js.rb" && mv -f "$SRC/standalone.js.rb" "$SRC/standalone.js"
  cp -p "$BK/inventory-sync.mjs.before" "$SYNC.rb" && mv -f "$SYNC.rb" "$SYNC"
  for f in oemTrim.js fordTrim.js; do
    if [ -f "$BK/$f.absent" ]; then rm -f "$SRC/$f"; elif [ -f "$BK/$f.before" ]; then cp -p "$BK/$f.before" "$SRC/$f"; fi
  done
  echo "restored: standalone.js $(md5of "$SRC/standalone.js") (was $want_sa), inventory-sync.mjs $(md5of "$SYNC") (was $want_sy)"
  ls "$SRC/oemTrim.js" "$SRC/fordTrim.js" 2>&1 | sed 's/^/  /'
  exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or rollback (got '$MODE')"

# ---- gates ------------------------------------------------------------------------------------------------------------------------------------------------
now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
# Real work only: a node process on the crawler/sync scripts, or a cron wrapper script as argv[1]. `bash -c` watcher loops and this ssh command do not match.
busy=$( { pgrep -a -x node | grep -E 'standalone|inventory-sync|lightsail-crawler|nj-scraper'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v "pgrep" )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$SRC/standalone.js" "$SYNC"; do [ -f "$f" ] || fail "$f not found (wrong box or path)"; done

# ---- what state is each file in ------------------------------------------------------------------------------------------------------------------------
sa=$(md5of "$SRC/standalone.js"); sy=$(md5of "$SYNC")
SA_DONE=0; SY_DONE=0
case $sa in
  "$SA_BOX1")  SA_PATCH=standalone.js.box1.patch;      SA_PATCH_MD5=$PATCH_BOX1_MD5;  SA_AFTER=$SA_BOX1_AFTER;  echo "standalone.js $sa = box1 variant";;
  "$SA_BOX34") SA_PATCH=standalone.js.box3-box4.patch; SA_PATCH_MD5=$PATCH_BOX34_MD5; SA_AFTER=$SA_BOX34_AFTER; echo "standalone.js $sa = box3/box4 variant";;
  "$SA_BOX1_AFTER"|"$SA_BOX34_AFTER") SA_DONE=1; echo "standalone.js $sa = already wired";;
  *) fail "standalone.js md5 $sa is not a known state (box1 $SA_BOX1, box3/4 $SA_BOX34). Send the file back; do not improvise.";;
esac
if [ "$sy" = "$SYNC_BEFORE" ]; then echo "inventory-sync.mjs $sy = sweep-guarded, no trimRaw"
elif [ "$(grep -c 'trimRaw: v.trimRaw' "$SYNC")" -ge 1 ]; then SY_DONE=1; echo "inventory-sync.mjs $sy = already sends trimRaw"
else fail "inventory-sync.mjs md5 $sy is not $SYNC_BEFORE and does not send trimRaw. Send the file back."; fi
if [ "$SA_DONE" = 1 ] && [ "$SY_DONE" = 1 ]; then
  [ "$(md5of "$SRC/oemTrim.js" 2>/dev/null)" = "$ORM5" ] && [ "$(md5of "$SRC/fordTrim.js" 2>/dev/null)" = "$FORD5" ] && { echo "ALREADY INSTALLED, nothing to do."; exit 0; }
  fail "standalone.js and the sync client are wired but oemTrim.js / fordTrim.js are not the pinned files"
fi
# fordTrim.js / oemTrim.js: absent is the expected state; present must be exactly our files.
for pair in "oemTrim.js:$ORM5" "fordTrim.js:$FORD5"; do
  f=${pair%%:*}; want=${pair##*:}
  if [ -e "$SRC/$f" ] && [ "$(md5of "$SRC/$f")" != "$want" ]; then fail "$SRC/$f exists with md5 $(md5of "$SRC/$f"), not $want"; fi
  [ -f "$STAGE/$f" ] || fail "$STAGE/$f not staged (scp it first, see STEPS.md)"
  [ "$(md5of "$STAGE/$f")" = "$want" ] || fail "staged $f md5 $(md5of "$STAGE/$f") is not $want"
done
if [ "$SA_DONE" = 0 ]; then
  [ -f "$STAGE/$SA_PATCH" ] || fail "$STAGE/$SA_PATCH not staged"
  [ "$(md5of "$STAGE/$SA_PATCH")" = "$SA_PATCH_MD5" ] || fail "staged $SA_PATCH md5 $(md5of "$STAGE/$SA_PATCH") is not $SA_PATCH_MD5"
fi

# ---- trial on copies, off the checkout ----------------------------------------------------------------------------------------------------------------
W=$(mktemp -d /tmp/trimwire-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"; cp -p "$STAGE/oemTrim.js" "$STAGE/fordTrim.js" "$W/src/"
if [ "$SA_DONE" = 0 ]; then
  cp -p "$SRC/standalone.js" "$W/src/standalone.js"
  (cd "$W" && patch -p1 -s -F0 --no-backup-if-mismatch < "$STAGE/$SA_PATCH") || fail "$SA_PATCH does not apply to this box's standalone.js (zero fuzz)"
  m=$(md5of "$W/src/standalone.js"); [ "$m" = "$SA_AFTER" ] || fail "patched standalone.js md5 $m, expected $SA_AFTER"
  cp "$W/src/standalone.js" "$W/chk.mjs"; node --check "$W/chk.mjs" || fail "patched standalone.js does not parse"
fi
if [ "$SY_DONE" = 0 ]; then
  [ "$(grep -c 'trimRaw' "$SYNC")" = 0 ] || fail "inventory-sync.mjs already mentions trimRaw but not in the expected form"
  [ "$(grep -c 'model: v\.model, trim: v\.trim,' "$SYNC")" = 1 ] || fail "inventory-sync.mjs: the row builder anchor 'model: v.model, trim: v.trim,' is not exactly once (found $(grep -c 'model: v\.model, trim: v\.trim,' "$SYNC") line(s)). Send the file back."
  cp -p "$SYNC" "$W/inventory-sync.mjs"
  sed 's/model: v\.model, trim: v\.trim,/model: v.model, trim: v.trim, trimRaw: v.trimRaw || null,/' "$SYNC" > "$W/sync.edited" && cat "$W/sync.edited" > "$W/inventory-sync.mjs"   # cat keeps the copy's mode
  [ "$(diff "$SYNC" "$W/inventory-sync.mjs" | grep -c '^>')" = 1 ] && [ "$(diff "$SYNC" "$W/inventory-sync.mjs" | grep -c '^<')" = 1 ] || fail "sync client edit changed more than one line"
  node --check "$W/inventory-sync.mjs" || fail "patched inventory-sync.mjs does not parse"
fi
out=$(cd "$W/src" && node --input-type=module -e 'const m = await import("./oemTrim.js"); console.log(JSON.stringify([["Toyota","Tacoma","TRD Off Road V6"],["Ram","1500","Big Hornlone Star"],["Ford","F-150","4X4 CREWCAB XLT"],["Chevrolet","Silverado 1500","Crew Cab Short Box"]].map(([make,model,trim]) => m.normalizeTrimForWrite({make,model,trim}).trim)))' 2>&1)
[ "$out" = '["TRD Off-Road","Big Horn/Lone Star","XLT","Crew Cab Short Box"]' ] || fail "oemTrim.js smoke test gave: $out"
echo "trial ok: standalone.js -> $([ "$SA_DONE" = 1 ] && echo unchanged || echo "$SA_AFTER"), inventory-sync.mjs -> $([ "$SY_DONE" = 1 ] && echo unchanged || md5of "$W/inventory-sync.mjs") (one line changed), oemTrim.js smoke test ok"
if [ "$MODE" = check ]; then echo "CHECK only, nothing written. Re-run with 'apply' on Paul's GO."; rollback_cmd; exit 0; fi

# ---- apply ---------------------------------------------------------------------------------------------------------------------------------------------
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup from an earlier run; move it aside first"
mkdir -p "$BK" || fail "cannot make $BK"
cp -p "$SRC/standalone.js" "$BK/standalone.js.before"; cp -p "$SYNC" "$BK/inventory-sync.mjs.before"
for f in oemTrim.js fordTrim.js; do if [ -e "$SRC/$f" ]; then cp -p "$SRC/$f" "$BK/$f.before"; else : > "$BK/$f.absent"; fi; done
{ echo "$sa standalone.js"; echo "$sy inventory-sync.mjs"; } > "$BK/md5s-before.txt"
echo "backup in $BK:"; ls -l "$BK" | sed 's/^/  /'
restore_inline() {
  cp -p "$BK/standalone.js.before" "$SRC/standalone.js"; cp -p "$BK/inventory-sync.mjs.before" "$SYNC"
  for f in oemTrim.js fordTrim.js; do [ -f "$BK/$f.absent" ] && rm -f "$SRC/$f"; done
  echo "restored: standalone.js $(md5of "$SRC/standalone.js"), inventory-sync.mjs $(md5of "$SYNC")" >&2
}
bad() { echo "FAILED: $*" >&2; restore_inline; exit 1; }
for f in oemTrim.js fordTrim.js; do install -m 644 "$STAGE/$f" "$SRC/$f.new" && mv -f "$SRC/$f.new" "$SRC/$f" || bad "installing $f"; done
if [ "$SA_DONE" = 0 ]; then cp -p "$W/src/standalone.js" "$SRC/standalone.js.new" && mv -f "$SRC/standalone.js.new" "$SRC/standalone.js" || bad "installing standalone.js"; fi
if [ "$SY_DONE" = 0 ]; then cp -p "$W/inventory-sync.mjs" "$SYNC.new" && mv -f "$SYNC.new" "$SYNC" || bad "installing inventory-sync.mjs"; fi
# verify the real files
[ "$(md5of "$SRC/oemTrim.js")" = "$ORM5" ] && [ "$(md5of "$SRC/fordTrim.js")" = "$FORD5" ] || bad "oemTrim.js / fordTrim.js md5 after install"
case $(md5of "$SRC/standalone.js") in "$SA_BOX1_AFTER"|"$SA_BOX34_AFTER") ;; *) bad "standalone.js md5 after install is $(md5of "$SRC/standalone.js")";; esac
cp "$SRC/standalone.js" "$W/final.mjs"; node --check "$W/final.mjs" || bad "installed standalone.js does not parse"
node --check "$SYNC" || bad "installed inventory-sync.mjs does not parse"
[ "$(grep -c 'trimRaw: v.trimRaw' "$SYNC")" -ge 1 ] || bad "installed sync client has no trimRaw"
{ echo "$(md5of "$SRC/standalone.js") standalone.js"; echo "$(md5of "$SYNC") inventory-sync.mjs"; echo "$ORM5 oemTrim.js"; echo "$FORD5 fordTrim.js"; } > "$BK/md5s-after.txt"
echo "INSTALLED. md5s now:"; sed 's/^/  /' "$BK/md5s-after.txt"
echo "No restart: the next crawl / sync is a fresh Node process."
rollback_cmd
