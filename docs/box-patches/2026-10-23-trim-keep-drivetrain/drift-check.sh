#!/bin/bash
# READ-ONLY drift check + dry run for the trimClean.js box patch (keep drivetrain words in the trim). Run ON the box. It never writes inside the crawler checkout: it applies the patch to a COPY in a temp dir,
# syntax-checks it and smoke-tests cleanTrim on the copy.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (default ~/nj-scraper/scrapers/lightsail-crawler; the patch must be at /tmp/tk/01-trim-keep-drivetrain.patch, or set P=...)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=${P:-/tmp/tk/01-trim-keep-drivetrain.patch}; cd "$C" || exit 2
echo "== md5 before"; md5sum src/trimClean.js src/standalone.js || { echo "DRIFT CHECK FAIL - src/trimClean.js is absent (patch 02 of docs/box-patches/2026-10-21-trim-cleanup is not installed here; stop)"; exit 1; }
echo "   known: trimClean.js c7288942656fb4df16b2c8552e558eb4 (the #572 patch-02 file, stripping drivetrain)"
grep -q "DRIVETRAIN_WORD_RE" src/trimClean.js || { grep -q "Drivetrain words stay" src/trimClean.js && { echo "ALREADY PATCHED - nothing to do."; exit 0; }; echo "DRIFT CHECK FAIL - src/trimClean.js is neither the stripping version nor this patch's; stop."; exit 1; }
T=$(mktemp -d); mkdir -p $T/src; cp src/trimClean.js $T/src/; cd $T || exit 2
patch -p1 --dry-run < "$P" >/dev/null 2>$T/err.txt || { echo "FAIL: patch does not apply:"; cat $T/err.txt; echo "DRIFT CHECK FAIL - stop; send the md5 above and this output back."; exit 1; }
patch -p1 -s < "$P" || { echo "FAIL applying to the copy"; exit 1; }
cp src/trimClean.js $T/chk.mjs; node --check $T/chk.mjs || { echo "SYNTAX FAIL"; exit 1; }
echo '{"type":"module"}' > $T/package.json
node -e "
import('$T/src/trimClean.js').then(m=>{
  const c=m.cleanTrim, ok=c('XLT 4WD',{make:'Ford'})==='XLT 4WD'&&c('Base 2 Door 4x4')==='Base 2 Door 4x4'&&c('Platinum&reg;')==='Platinum'&&c('F-250&#174;  XLT AWD')==='F-250 XLT AWD'&&c('AWD')==='AWD'&&c(null)===null&&c('Wind AWD',{make:'Kia'})==='Wind AWD'&&m.decodeHtmlEntities('A&amp;reg;')==='A®';
  console.log('smoke:',ok?'ok':'FAIL'); if(!ok) process.exit(1);
}).catch(e=>{console.log(e.message);process.exit(1)})" || { echo "SMOKE FAIL"; exit 1; }
echo "== md5 of the patched COPY (what the box would have after applying)"; md5sum src/trimClean.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
