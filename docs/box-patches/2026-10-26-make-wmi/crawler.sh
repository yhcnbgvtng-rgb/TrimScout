#!/bin/bash
# Make-from-VIN patch (with the dealer/shard-brand fallback, #597), CRAWLER side (box1-box4: ~/nj-scraper/scrapers/lightsail-crawler/src). Run ON the box, from the directory holding this script, files/, 02-standalone.patch and test-five-vins.mjs
# (the steps copy them to /tmp/mw).      usage:  bash crawler.sh check|apply|restore        env: CRAWLER_DIR (default ~/nj-scraper/scrapers/lightsail-crawler)  BACKUP (default ~/backups/make-wmi-20261026)
#   check    READ-ONLY. Verifies every file's md5 against a known state, applies the patch to a COPY in a temp dir, syntax-checks and runs the five-VIN test there. Never writes in the checkout.
#            Known standalone.js states: BEFORE (02-standalone.patch), OLD-PATCHED = the first version of this patch, 82fa.../6465... (03-standalone-upgrade.patch), NEW (nothing to do). Any other md5 -> stop and report.
#   apply    check, then backup, copy the 4 new files, patch standalone.js, replace brand_match.js (last), verify md5s + syntax + five-VIN test on the real files. NO restart needed: every crawl is a fresh Node process.
#   restore  put brand_match.js / standalone.js back from the backup and remove the 4 new files; verifies the original md5s.
# Do NOT git pull/merge/commit on a box.
C=${CRAWLER_DIR:-$HOME/nj-scraper/scrapers/lightsail-crawler}; S=$C/src; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/make-wmi-20261026}; MODE=${1:-check}
md() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
NEW="vinWmi.js stellantisMake.js stellantisVinTable.js ingestGuards.js"     # absent on the crawler boxes today
after() { case "$1" in vinWmi.js) echo d80c26201747ff1e2ef196e6ca9dceaf;; stellantisMake.js) echo 4017f1f9e24dc14d1b2cc530737e1e00;; stellantisVinTable.js) echo 2bb0902516fe1279adec20291096ac7b;; ingestGuards.js) echo 88ec75c5d81a19dd484de0dea62add28;; brand_match.js) echo 2b421d128ce20aab0644820bb0702271;; esac; }   # md5 AFTER (the files in files/)
BM_BEFORE=8b4d8c1fe29731cccae7c0d96c36aaad; BM_OLD=91d723fe2cf8440c1da6e719e3c5b871; VW_OLD="365a9b0dd148dcd115b442601f7c47af 422bd7190ee821d33449d28489e22d17"                                   # brand_match.js, identical on all four boxes
SA_BOX1=02f73e161e29dde0fe0633759328c9a8; SA_OTHER=2e69d8748b9addbff93dac618bb71f1e   # standalone.js before: box1 / box2,3,4
SA_OLD_BOX1=82fa1a602d6229fc5eb17114fb347e6a; SA_OLD_OTHER=6465d05d2377da81293897292e895776   # standalone.js after the FIRST version of this patch (no fallback)
# md5 of the NEW patched standalone.js cannot be computed off the box (the box copies are not in the repo). Empty = not pinned yet: the script then verifies the
# patched file by content (new call present, old fallbacks gone, syntax) and PRINTS the md5. After the first `check` on box4, put the printed values here.
SA_NEW_BOX1=""; SA_NEW_OTHER="a1f4e0bf9228bedb4ca8e2a567b2fb54"   # SA_NEW_OTHER pinned from box4 check+apply 2026-10-27
fail() { echo "FAIL: $*"; exit 1; }
sa=$(md "$S/standalone.js"); bm=$(md "$S/brand_match.js")
is_new_sa() { grep -q "resolveKeptMake(brand, vehicle, dealer)" "$1" && ! grep -q "|| dealer.make || null\||| dealer.make || brand.name" "$1"; }
case "$sa" in
  $SA_BOX1) SA_PATCH=02-standalone.patch; SA_PIN=$SA_NEW_BOX1; echo "standalone.js = box1 variant, not patched";;
  $SA_OTHER) SA_PATCH=02-standalone.patch; SA_PIN=$SA_NEW_OTHER; echo "standalone.js = box2/3/4 variant, not patched";;
  $SA_OLD_BOX1) SA_PATCH=03-standalone-upgrade.patch; SA_PIN=$SA_NEW_BOX1; echo "standalone.js = box1 variant with the FIRST version of this patch: will be upgraded";;
  $SA_OLD_OTHER) SA_PATCH=03-standalone-upgrade.patch; SA_PIN=$SA_NEW_OTHER; echo "standalone.js = box2/3/4 variant with the FIRST version of this patch: will be upgraded";;
  *) if is_new_sa "$S/standalone.js"; then SA_PATCH=""; echo "standalone.js already has the new patch (md5 $sa)"; else fail "src/standalone.js md5 $sa is not a known version (box1 $SA_BOX1, others $SA_OTHER, first patch $SA_OLD_BOX1 / $SA_OLD_OTHER); stop and report"; fi;;
esac
already=1
[ -z "$SA_PATCH" ] || already=0
[ "$bm" = "$(after brand_match.js)" ] || { { [ "$bm" = "$BM_BEFORE" ] || [ "$bm" = "$BM_OLD" ]; } && already=0 || fail "src/brand_match.js md5 $bm is neither a known box version ($BM_BEFORE / $BM_OLD) nor the patched one; stop and report"; }
for f in $NEW; do m=$(md "$S/$f"); [ -z "$m" ] && { already=0; continue; }; [ "$m" = "$(after $f)" ] && continue; { [ "$f" = vinWmi.js ] && case " $VW_OLD " in *" $m "*) true;; *) false;; esac; } && { already=0; continue; }; fail "src/$f already exists with md5 $m (expected absent or $(after $f)); stop and report"; done
[ "$MODE" = restore ] || { [ $already = 1 ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }; }
verify_sa() {   # $1 = patched standalone.js: by content always, by md5 once pinned
  is_new_sa "$1" || fail "patched standalone.js still has a roster-brand fallback or lacks the new call"
  grep -q "make unresolvable" "$1" || fail "patched standalone.js lacks the make-unresolvable log"
  m=$(md "$1"); echo "patched standalone.js md5 = $m"
  [ -z "$SA_PIN" ] || [ "$m" = "$SA_PIN" ] || fail "patched standalone.js md5 $m, expected pinned $SA_PIN"
}
check_copy() {   # patch a COPY, never the checkout
  T=$(mktemp -d); mkdir -p $T/src; echo '{"type":"module"}' > $T/package.json
  cp "$S/standalone.js" $T/src/; cp "$HERE"/files/*.js $T/src/
  if [ -n "$SA_PATCH" ]; then (cd $T && patch -p1 --dry-run < "$HERE/$SA_PATCH" >/dev/null 2>$T/err || { cat $T/err; exit 1; } && patch -p1 -s < "$HERE/$SA_PATCH") || fail "$SA_PATCH does not apply to this box's standalone.js"; fi
  verify_sa "$T/src/standalone.js"
  for f in $NEW brand_match.js standalone.js; do cp "$T/src/$f" $T/chk.mjs; node --check $T/chk.mjs || fail "syntax error in patched $f"; done
  for f in $NEW brand_match.js; do [ "$(md "$T/src/$f")" = "$(after $f)" ] || fail "$f in files/ has the wrong md5 (corrupt copy?)"; done
  node "$HERE/test-five-vins.mjs" crawler $T/src | tail -2 || fail "five-VIN test failed on the patched copy"
  rm -rf $T
}
case "$MODE" in
check) echo "== md5 before"; md5sum $S/standalone.js $S/brand_match.js; check_copy && echo "DRIFT CHECK PASS (nothing in $C was changed)";;
apply)
  [ -n "$(TZ=America/New_York date +%H%M | awk '$1>=2150')" ] && [ -z "$ALLOW_CRAWL_WINDOW" ] && fail "it is after 21:50 ET: a crawl may be starting. Install in the no-crawl window (set ALLOW_CRAWL_WINDOW=1 only on Paul's say-so)"
  pgrep -fa "${PROC_RE:-run-daily-crawl|run_nightly_chain|run_sync|standalone.js}" | grep -v pgrep | grep -v "crawler.sh" && fail "a crawl/sync process is running (above); wait for it to finish"
  check_copy || exit 1
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p $S/brand_match.js $S/standalone.js "$BACKUP/" && : > "$BACKUP/absent.txt" || fail "backup failed"
  for f in $NEW; do if [ -e "$S/$f" ]; then cp -p "$S/$f" "$BACKUP/"; else echo "$f" >> "$BACKUP/absent.txt"; fi; done
  (cd "$BACKUP" && md5sum brand_match.js standalone.js $(ls $NEW 2>/dev/null) | tee md5s.txt); echo "absent before: $(tr '\n' ' ' < $BACKUP/absent.txt)"
  for f in $NEW; do [ "$(md "$S/$f")" = "$(after $f)" ] || cp "$HERE/files/$f" "$S/$f"; done   # new files first: nothing imports them yet (an old vinWmi.js is replaced)
  if [ -n "$SA_PATCH" ]; then (cd $C && patch -p1 -s --no-backup-if-mismatch < "$HERE/$SA_PATCH") || { echo "patch failed - restoring"; bash "$0" restore; exit 1; }; fi
  cp "$HERE/files/brand_match.js" "$S/brand_match.js"                                       # last: this is the file that starts importing the new ones
  echo "== md5 after"; for f in $NEW brand_match.js; do [ "$(md "$S/$f")" = "$(after $f)" ] && echo "ok   $f" || echo "BAD  $f $(md "$S/$f")"; done; verify_sa "$S/standalone.js" && echo "ok   standalone.js"
  for f in $NEW brand_match.js standalone.js; do cp "$S/$f" /tmp/chk.mjs && node --check /tmp/chk.mjs || { echo "SYNTAX FAIL $f - restoring"; bash "$0" restore; exit 1; }; done; rm -f /tmp/chk.mjs
  node "$HERE/test-five-vins.mjs" crawler "$S" | tail -2 || { echo "five-VIN test failed on the real files - restoring"; bash "$0" restore; exit 1; }
  echo "APPLIED. No restart needed; the next crawl process uses the new files. Restore: bash crawler.sh restore";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  cp -p "$BACKUP/brand_match.js" "$BACKUP/standalone.js" "$S/" || fail "copy back failed"
  for f in $NEW; do [ -e "$BACKUP/$f" ] && cp -p "$BACKUP/$f" "$S/$f"; done                 # files that existed before (the first version's vinWmi.js)
  while read -r f; do [ -n "$f" ] && rm -f "$S/$f"; done < "$BACKUP/absent.txt"
  (cd "$S" && md5sum $(awk '{print $2}' "$BACKUP/md5s.txt") | diff - "$BACKUP/md5s.txt" && echo "RESTORED: md5s match the backup"; ls vinWmi.js stellantisMake.js stellantisVinTable.js ingestGuards.js 2>&1 | head -4);;
*) echo "usage: bash crawler.sh check|apply|restore"; exit 2;;
esac
