#!/bin/bash
# READ-ONLY drift check + dry run for the 2026-10-21 Team Velocity pixel-price box patch. Run ON the box. It never writes inside the crawler checkout:
# it prints the md5 of src/facebookPixelFields.js, applies the patch to a COPY in a temp dir, syntax-checks and smoke-tests the result.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (the patch must be at /tmp/tvp/01-pixel-price.patch)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=/tmp/tvp/01-pixel-price.patch; cd "$C" || exit 2
F=src/facebookPixelFields.js
echo "== md5 before"; md5sum $F || { echo "DRIFT CHECK FAIL - $F is absent on this box (Strategy 3b was never installed); stop and report."; exit 1; }
echo "   known: 38ca8bfb10d2a91d1ea7722c16d6dd0b (git main, unchanged since #286, 2026-09-23)"
echo "== standalone.js calls it:"; grep -c "fillFromFacebookPixelViewContent(vehicle, html)" src/standalone.js
grep -q "cleanPixelPrice" $F && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
T=$(mktemp -d); mkdir -p $T/src; cp $F $T/src/
cd $T || exit 2
patch -p1 --dry-run < $P >/dev/null 2>$T/err.txt || { echo "FAIL: patch does not apply to this box's file:"; cat $T/err.txt; echo "DRIFT CHECK FAIL - stop; send the md5 above and this output back."; exit 1; }
patch -p1 -s < $P || { echo "FAIL applying to the copy"; exit 1; }
cp src/facebookPixelFields.js /tmp/tvp-check.mjs; node --check /tmp/tvp-check.mjs || { echo "SYNTAX FAIL"; exit 1; }; rm -f /tmp/tvp-check.mjs
cp src/facebookPixelFields.js $T/fpf.mjs
node -e "
import('$T/fpf.mjs').then(m=>{
  const h=\"<script>fbq('track','ViewContent',{content_type: 'vehicle',make: 'Toyota',model: 'RAV4',price: 31995});</script>\";
  const v=m.fillFromFacebookPixelViewContent({vin:'X',price:null,msrp:null},h);
  const off=(process.env.CRAWLER_PIXEL_PRICE='false',m.fillFromFacebookPixelViewContent({vin:'X',price:null,msrp:null},h));
  console.log('smoke: price='+v.price+' msrp='+v.msrp+' | switch off: price='+off.price+' msrp='+off.msrp);
  if(v.price!==31995||v.msrp!==31995||off.price!==null) process.exit(1);
}).catch(e=>{console.log(e.message);process.exit(1)})" || { echo "SMOKE FAIL"; exit 1; }
echo "== md5 of the patched COPY (what the box would have after applying)"; md5sum src/facebookPixelFields.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
