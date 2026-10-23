#!/bin/bash
# READ-ONLY drift check + dry run for the dom_store.js box patch (this PR: pick the body occurrence of the VIN). Run ON the box. It never writes inside the crawler checkout: it applies the patch to a COPY in a temp dir,
# syntax-checks it and smoke-tests extractVehicleDom on the copy.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (default ~/nj-scraper/scrapers/lightsail-crawler; the patch must be at /tmp/dx/01-dom-extract.patch, or set P=...)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=${P:-/tmp/dx/01-dom-extract.patch}; cd "$C" || exit 2
echo "== md5 before"; md5sum src/dom_store.js || { echo "DRIFT CHECK FAIL - src/dom_store.js is absent"; exit 1; }
echo "   known: bba6552b946cc4a44b3e0fef1308940e (the #574 file; box4 must read this before this patch. 3265fc4a6b070519884254a38bf61360 = #574 NOT installed yet: install #574 first)"
grep -q "pickVinOccurrence" src/dom_store.js && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
grep -q "Keep the page around the VIN instead" src/dom_store.js || { echo "DRIFT CHECK FAIL - #574 is not installed on this file; stop."; exit 1; }
T=$(mktemp -d); mkdir -p $T/src; cp src/dom_store.js src/price_diff.js src/date_utils.js $T/src/ 2>/dev/null; cd $T || exit 2
patch -p1 --dry-run < "$P" >/dev/null 2>$T/err.txt || { echo "FAIL: patch does not apply:"; cat $T/err.txt; echo "DRIFT CHECK FAIL - stop; send the md5 above and this output back."; exit 1; }
patch -p1 -s < "$P" || { echo "FAIL applying to the copy"; exit 1; }
cp src/dom_store.js $T/chk.mjs; node --check $T/chk.mjs || { echo "SYNTAX FAIL"; exit 1; }
echo '{"type":"module"}' > $T/package.json
node -e "
import('$T/src/dom_store.js').then(m=>{
  const vin='WAUAGAF50RN000001';
  const head='<html><head><link rel=\"canonical\" href=\"https://x.test/viewdetails/used/'+vin+'/car\"><meta property=\"og:url\" content=\"https://x.test/viewdetails/used/'+vin+'/car\"><script>var hideVINandStock=false; var priceColor=\" \";</script></head>';
  const html=head+'<body>'+'<p>filler</p>'.repeat(500)+'<div>VIN: '+vin+' Stock #: ST12345 Price \$41,995</div>'+'<p>filler</p>'.repeat(500)+'</body></html>';
  const a=m.extractVehicleDom(html,vin);
  const none=m.extractVehicleDom(html.replace(new RegExp(vin,'g'),'XXXXXXXXXXXXXXXXX'),vin), c=m.extractVehicleDom('<p>x</p>',vin);
  const headOnly=m.extractVehicleDom('<html><head><meta content=\"'+vin+'\"></head><body>'+'<p>f</p>'.repeat(10)+'</body></html>',vin);
  const ok=a.includes('Stock #: ST12345')&&a.includes('\$41,995')&&!a.includes('canonical')&&c==='<p>x</p>'&&typeof none==='string'&&headOnly.includes(vin)&&typeof m.pickVinOccurrence==='function';
  console.log('smoke:',ok?'5/5':'FAIL'); if(!ok) process.exit(1);
}).catch(e=>{console.log(e.message);process.exit(1)})" || { echo "SMOKE FAIL"; exit 1; }
echo "== md5 of the patched COPY (what the box would have after applying)"; md5sum src/dom_store.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
