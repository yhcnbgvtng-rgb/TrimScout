#!/bin/bash
# Install the 2026-10-29 vinWmi.js (45 added WMIs) on a CRAWLER box (box1, box3, box4). One file, nothing else; no restart (every crawl is a fresh Node process).
#   bash wmi-install.sh check     read-only: md5 gate + syntax + sample-VIN test on a COPY in a temp dir
#   bash wmi-install.sh apply     check, then back up and replace src/vinWmi.js, verify md5 + syntax + sample VINs on the real file (restores itself on any failure)
#   bash wmi-install.sh restore   put the backed-up vinWmi.js back and verify its md5
# Run from the directory that holds this script and files/ (scp the whole directory to /tmp/wa first). Do NOT git pull/merge/commit on a box.
C=${CRAWLER_DIR:-$HOME/nj-scraper/scrapers/lightsail-crawler}; S=$C/src; HERE=$(cd "$(dirname "$0")" && pwd); BACKUP=${BACKUP:-$HOME/backups/wmi-additions-20261030}; MODE=${1:-check}
BEFORE=7371d7d9bd40bd9586b4ef8a848a4969      # the #597 table, installed on boxes 1/3/4 (make-wmi patch)
AFTER=274e60473eb1d83fe6b01def4e5f68dc
md() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
fail() { echo "FAIL: $*"; exit 1; }
cur=$(md "$S/vinWmi.js")
[ -n "$cur" ] || fail "$S/vinWmi.js is missing: this box has not had the make-wmi patch; stop and report"
[ "$MODE" = restore ] || { [ "$cur" = "$AFTER" ] && { echo "ALREADY PATCHED (vinWmi.js md5 $cur) - nothing to do."; exit 0; }; [ "$cur" = "$BEFORE" ] || fail "src/vinWmi.js md5 $cur is neither the expected $BEFORE nor the new $AFTER; stop and report"; }
[ "$(md "$HERE/files/vinWmi.js")" = "$AFTER" ] || fail "files/vinWmi.js has the wrong md5 (corrupt copy?)"
samples() {   # $1 = a src dir: new WMIs resolve, old ones unchanged, excluded ones still unknown
  node --input-type=module -e '
    const m = await import(process.argv[1] + "/vinWmi.js");
    const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("SAMPLE FAIL " + w + " " + JSON.stringify(a) + " != " + JSON.stringify(b)); process.exit(1); } };
    const pad = (w) => w + "0".repeat(14);
    for (const [w, mk] of [["2FD","Ford"],["3FR","Ford"],["NM0","Ford"],["3MW","BMW"],["ZAS","Alfa Romeo"],["ZN6","Maserati"],["SAD","Jaguar"],["W1Z","Mercedes-Benz"],["LVY","Volvo"],["SB1","Toyota"]]) eq(m.makeFromVin(pad(w)), mk, w);
    eq(m.makesForWmi(pad("3HD")), ["Honda","Acura"], "3HD"); eq(m.makesForWmi(pad("3GP")), ["Honda","Acura"], "3GP"); eq(m.makeFromVin(pad("3GP"), { model: "Prologue" }), "Honda", "3GP Prologue"); eq(m.makeFromVin(pad("3GP"), { model: "ZDX" }), "Acura", "3GP ZDX"); eq(m.makeFromVin(pad("1HT"), { model: "Silverado 5500HD" }), "Chevrolet", "1HT"); eq(m.makeFromVin(pad("JTN"), { model: "Corolla" }), "Toyota", "JTN"); eq(m.makeFromVin(pad("JTN"), { model: "tC" }), "Scion", "JTN tC");
    for (const w of ["1FT","1FM","5N1","7YA","JTM","WBA"]) if (!m.makesForWmi(pad(w))) { console.error("SAMPLE FAIL old WMI lost " + w); process.exit(1); }
    for (const w of ["1FV","1HA","WD3","SC6","000"]) eq(m.makesForWmi(pad(w)), null, w + " must stay unknown");
    eq(m.WMI_LIST.length, 298, "table size");
    console.log("sample VINs ok");' "$1"
}
check_copy() {
  T=$(mktemp -d); cp "$S"/stellantisVinTable.js "$S"/ingestGuards.js "$T"/ 2>/dev/null || fail "stellantisVinTable.js / ingestGuards.js missing next to vinWmi.js in $S"
  cp "$HERE/files/vinWmi.js" "$T/vinWmi.js"; echo '{"type":"module"}' > "$T/package.json"
  cp "$T/vinWmi.js" "$T/chk.mjs"; node --check "$T/chk.mjs" || fail "syntax error in the new vinWmi.js"
  samples "$T" || fail "sample-VIN test failed on the copy"
  rm -rf "$T"
}
case "$MODE" in
check) echo "== md5 now: $cur (expected before: $BEFORE)"; check_copy && echo "CHECK PASS (nothing in $C was changed)";;
apply)
  [ -n "$(TZ=America/New_York date +%H%M | awk '$1>=2150')" ] && [ -z "$ALLOW_CRAWL_WINDOW" ] && fail "it is after 21:50 ET: a crawl may be starting. Install in the no-crawl window (ALLOW_CRAWL_WINDOW=1 only on Paul's say-so)"
  pgrep -fa "${PROC_RE:-run-daily-crawl|run_nightly_chain|run_sync|standalone.js}" | grep -v pgrep | grep -v "wmi-install.sh" && fail "a crawl/sync process is running (above); wait for it to finish"
  check_copy || exit 1
  [ -e "$BACKUP/md5s.txt" ] && fail "$BACKUP already exists - a previous apply left a backup; look at it first (or set BACKUP=...)"
  mkdir -p "$BACKUP" && cp -p "$S/vinWmi.js" "$BACKUP/" && (cd "$BACKUP" && md5sum vinWmi.js | tee md5s.txt) || fail "backup failed"
  cp "$HERE/files/vinWmi.js" "$S/vinWmi.js.new" && mv "$S/vinWmi.js.new" "$S/vinWmi.js"     # atomic rename: a crawl starting mid-copy never sees half a file
  [ "$(md "$S/vinWmi.js")" = "$AFTER" ] || { echo "md5 after copy is wrong - restoring"; bash "$0" restore; exit 1; }
  cp "$S/vinWmi.js" /tmp/chk.mjs && node --check /tmp/chk.mjs || { echo "SYNTAX FAIL - restoring"; bash "$0" restore; exit 1; }; rm -f /tmp/chk.mjs
  samples "$S" || { echo "sample-VIN test failed on the real file - restoring"; bash "$0" restore; exit 1; }
  echo "APPLIED. md5 $(md "$S/vinWmi.js"). No restart needed. Restore: bash wmi-install.sh restore";;
restore)
  [ -e "$BACKUP/md5s.txt" ] || fail "no backup at $BACKUP"
  cp -p "$BACKUP/vinWmi.js" "$S/vinWmi.js.new" && mv "$S/vinWmi.js.new" "$S/vinWmi.js" || fail "copy back failed"
  (cd "$S" && md5sum vinWmi.js | diff - "$BACKUP/md5s.txt" && echo "RESTORED: vinWmi.js md5 matches the backup");;
*) echo "usage: bash wmi-install.sh check|apply|restore"; exit 2;;
esac
