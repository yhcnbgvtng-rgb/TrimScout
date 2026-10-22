#!/bin/bash
# READ-ONLY drift check + dry run for the 2026-10-21 trim-cleanup (#570) box patch. Run ON the box. It never writes inside the crawler checkout:
# it prints the md5s of the two files the patch touches, applies the patch to a COPY in a temp dir, syntax-checks and smoke-tests the result.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (the patch must be at /tmp/tc/01-clean-trim.patch)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=/tmp/tc/01-clean-trim.patch; cd "$C" || exit 2
echo "== md5 before"; md5sum src/standalone.js src/ingestSanitize.js || { echo "DRIFT CHECK FAIL - a file is absent; stop and report."; exit 1; }
echo "   main b7a1e1d (pre-#570): standalone.js 6f45cc081243bbc7ab0ce41d66d3f27d   ingestSanitize.js 5104868c6d9639f377c3bf948b603b06"
echo "   main f49fa59 (#570):     standalone.js ee0df6ee1b69e1c622ff8451123727b8   ingestSanitize.js 58e0bd3167a0f19a20e6521bd360a62f"
echo "   (a box's standalone.js is hand-patched and normally differs from main; this check is the authority, not those md5s)"
n_clean_s=$(grep -c "cleanTrim" src/standalone.js); n_clean_i=$(grep -c "export function cleanTrim" src/ingestSanitize.js); n_mile=$(grep -c "resolveMileage(vehicle.mileage" src/standalone.js)
echo "== state: standalone.js cleanTrim=$n_clean_s (0=needed)  ingestSanitize.js export cleanTrim=$n_clean_i (0=needed)  standalone.js resolveMileage call=$n_mile (must be 1)"
[ "$n_clean_s" != 0 ] && [ "$n_clean_i" != 0 ] && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
{ [ "$n_clean_s" != 0 ] || [ "$n_clean_i" != 0 ]; } && { echo "DRIFT CHECK FAIL - only one of the two files already has cleanTrim; stop and report."; exit 1; }
T=$(mktemp -d); mkdir -p $T/src; cp src/standalone.js src/ingestSanitize.js $T/src/
cd $T || exit 2
patch -p1 --dry-run < $P >/dev/null 2>$T/err.txt || { echo "FAIL: patch does not apply to this box's files:"; cat $T/err.txt; echo "DRIFT CHECK FAIL - stop; send the md5s above and this output back."; exit 1; }
patch -p1 -s < $P || { echo "FAIL applying to the copies"; exit 1; }
for f in src/standalone.js src/ingestSanitize.js; do cp $f /tmp/tc-check.mjs; node --check /tmp/tc-check.mjs || { echo "SYNTAX FAIL $f"; rm -f /tmp/tc-check.mjs; exit 1; }; done; rm -f /tmp/tc-check.mjs
a=$(grep -n "cleanTrim(vehicle.trim" src/standalone.js | head -1 | cut -d: -f1); b=$(grep -n "resolveMileage(vehicle.mileage" src/standalone.js | head -1 | cut -d: -f1); c2=$(grep -n "applyWindowSticker(vehicle, html" src/standalone.js | head -1 | cut -d: -f1)
echo "== order in the patched copy: resolveMileage line $b < cleanTrim line $a < applyWindowSticker line $c2"
{ [ -n "$a" ] && [ -n "$b" ] && [ -n "$c2" ] && [ "$b" -lt "$a" ] && [ "$a" -lt "$c2" ]; } || { echo "ORDER FAIL"; exit 1; }
cp src/ingestSanitize.js $T/is.mjs
node -e "
import('$T/is.mjs').then(m=>{
  const t=[['Platinum&reg;','Ford','Platinum'],['F-250&#174; XLT 4WD','Ford','F-250 XLT'],['Base 2 Door 4x4','Ford','Base 2 Door'],['Wind AWD','Kia','Wind AWD'],['AWD','Ford','AWD'],['Lariat','Ford','Lariat']];
  const bad=t.filter(([i,mk,o])=>m.cleanTrim(i,{make:mk})!==o);
  console.log('smoke: '+(t.length-bad.length)+'/'+t.length+' cases');
  if(bad.length) process.exit(1);
}).catch(e=>{console.log(e.message);process.exit(1)})" || { echo "SMOKE FAIL"; exit 1; }
echo "== md5 of the patched COPIES (what the box would have after applying)"; md5sum src/standalone.js src/ingestSanitize.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
