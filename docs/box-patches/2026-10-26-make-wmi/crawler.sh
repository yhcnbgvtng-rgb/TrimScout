#!/bin/bash
# Make-from-VIN patch, CRAWLER side (box1-box4: ~/nj-scraper/scrapers/lightsail-crawler/src). Run ON the box, from the directory holding this script, files/, 02-standalone.patch and test-five-vins.mjs
# (the steps copy them to /tmp/mw).      usage:  bash crawler.sh check|apply|restore        env: CRAWLER_DIR (default ~/nj-scraper/scrapers/lightsail-crawler)  BACKUP (default ~/backups/make-wmi-20261026)
#   check    READ-ONLY. Verifies every file's md5 against the expected "before" (or "after"), applies the patch to a COPY in a temp dir, syntax-checks and runs the five-VIN test there. Never writes in the checkout.
#   apply    check, then backup, copy the 4 new files, patch standalone.js, replace brand_match.js (last), verify md5s + syntax + five-VIN test on the real files. NO restart needed: every crawl is a fresh Node process.
#   restore  put brand_match.js / standalone.js back from the backup and remove the 4 new files; verifies the original md5s.
# Do NOT git pull/merge/commit on a box.
C=${CRAWLER_DIR:-$HOME/nj-scraper/scrapers/lightsail-crawler}; S=$C/src; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/make-wmi-20261026}; MODE=${1:-check}
md() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
NEW="vinWmi.js stellantisMake.js stellantisVinTable.js ingestGuards.js"     # absent on the crawler boxes today
after() { case "$1" in vinWmi.js) echo 365a9b0dd148dcd115b442601f7c47af;; stellantisMake.js) echo 4017f1f9e24dc14d1b2cc530737e1e00;; stellantisVinTable.js) echo 2bb0902516fe1279adec20291096ac7b;; ingestGuards.js) echo 88ec75c5d81a19dd484de0dea62add28;; brand_match.js) echo 91d723fe2cf8440c1da6e719e3c5b871;; esac; }   # md5 AFTER (the files in files/)
BM_BEFORE=8b4d8c1fe29731cccae7c0d96c36aaad                                   # brand_match.js, identical on all four boxes
SA_BOX1=02f73e161e29dde0fe0633759328c9a8; SA_OTHER=2e69d8748b9addbff93dac618bb71f1e   # standalone.js before: box1 / box2,3,4
SA_AFTER_BOX1=82fa1a602d6229fc5eb17114fb347e6a; SA_AFTER_OTHER=6465d05d2377da81293897292e895776
fail() { echo "FAIL: $*"; exit 1; }
sa=$(md "$S/standalone.js"); bm=$(md "$S/brand_match.js")
case "$sa" in $SA_BOX1) SA_AFTER=$SA_AFTER_BOX1; echo "standalone.js = box1 variant";; $SA_OTHER) SA_AFTER=$SA_AFTER_OTHER; echo "standalone.js = box2/3/4 variant";;
  $SA_AFTER_BOX1|$SA_AFTER_OTHER) SA_AFTER=$sa; echo "standalone.js already patched";; *) fail "src/standalone.js md5 $sa is not a known version (box1 $SA_BOX1, others $SA_OTHER); stop and report";; esac
already=1
[ "$sa" = "$SA_AFTER" ] || already=0
[ "$bm" = "$(after brand_match.js)" ] || { [ "$bm" = "$BM_BEFORE" ] && already=0 || fail "src/brand_match.js md5 $bm is neither the box version ($BM_BEFORE) nor the patched one; stop and report"; }
for f in $NEW; do m=$(md "$S/$f"); [ -z "$m" ] && { already=0; continue; }; [ "$m" = "$(after $f)" ] || fail "src/$f already exists with md5 $m (expected absent or $(after $f)); stop and report"; done
[ "$MODE" = restore ] || { [ $already = 1 ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }; }
check_copy() {   # patch a COPY, never the checkout
  T=$(mktemp -d); mkdir -p $T/src; echo '{"type":"module"}' > $T/package.json
  cp "$S/standalone.js" $T/src/; cp "$HERE"/files/*.js $T/src/
  (cd $T && patch -p1 --dry-run < "$HERE/02-standalone.patch" >/dev/null 2>$T/err || { cat $T/err; exit 1; } && patch -p1 -s < "$HERE/02-standalone.patch") || fail "02-standalone.patch does not apply to this box's standalone.js"
  [ "$(md "$T/src/standalone.js")" = "$SA_AFTER" ] || fail "patched copy of standalone.js has md5 $(md "$T/src/standalone.js"), expected $SA_AFTER"
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
  for f in $NEW; do [ -e "$S/$f" ] || echo "$f" >> "$BACKUP/absent.txt"; done
  (cd "$BACKUP" && md5sum brand_match.js standalone.js | tee md5s.txt); echo "absent before: $(tr '\n' ' ' < $BACKUP/absent.txt)"
  for f in $NEW; do [ -e "$S/$f" ] || cp "$HERE/files/$f" "$S/$f"; done                    # new files first: nothing imports them yet
  (cd $C && patch -p1 -s --no-backup-if-mismatch < "$HERE/02-standalone.patch") || { echo "patch failed - restoring"; bash "$0" restore; exit 1; }
  cp "$HERE/files/brand_match.js" "$S/brand_match.js"                                       # last: this is the file that starts importing the new ones
  echo "== md5 after"; for f in $NEW brand_match.js; do [ "$(md "$S/$f")" = "$(after $f)" ] && echo "ok   $f" || echo "BAD  $f $(md "$S/$f")"; done; [ "$(md "$S/standalone.js")" = "$SA_AFTER" ] && echo "ok   standalone.js" || echo "BAD  standalone.js $(md "$S/standalone.js")"
  for f in $NEW brand_match.js standalone.js; do cp "$S/$f" /tmp/chk.mjs && node --check /tmp/chk.mjs || { echo "SYNTAX FAIL $f - restoring"; bash "$0" restore; exit 1; }; done; rm -f /tmp/chk.mjs
  node "$HERE/test-five-vins.mjs" crawler "$S" | tail -2 || { echo "five-VIN test failed on the real files - restoring"; bash "$0" restore; exit 1; }
  echo "APPLIED. No restart needed; the next crawl process uses the new files. Restore: bash crawler.sh restore";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  cp -p "$BACKUP/brand_match.js" "$BACKUP/standalone.js" "$S/" || fail "copy back failed"
  while read -r f; do [ -n "$f" ] && rm -f "$S/$f"; done < "$BACKUP/absent.txt"
  (cd "$S" && md5sum brand_match.js standalone.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: md5s match the backup"; ls vinWmi.js stellantisMake.js stellantisVinTable.js ingestGuards.js 2>&1 | head -4);;
*) echo "usage: bash crawler.sh check|apply|restore"; exit 2;;
esac
