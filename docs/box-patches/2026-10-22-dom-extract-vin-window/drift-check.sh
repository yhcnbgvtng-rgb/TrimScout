#!/bin/bash
# READ-ONLY drift check + dry run for the dom_store.js box patch (#574). Run ON the box. It never writes inside the crawler checkout: it applies the patch to a COPY in a temp dir,
# syntax-checks it and smoke-tests extractVehicleDom on the copy.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (default ~/nj-scraper/scrapers/lightsail-crawler; the patch must be at /tmp/dx/01-dom-extract.patch)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=/tmp/dx/01-dom-extract.patch; cd "$C" || exit 2
echo "== md5 before"; md5sum src/dom_store.js || { echo "DRIFT CHECK FAIL - src/dom_store.js is absent"; exit 1; }
echo "   known: 3265fc4a6b070519884254a38bf61360 (git main before #574; box1, box3 and box4 all read identical on 2026-10-22)"
grep -q "Keep the page around the VIN instead" src/dom_store.js && { echo "ALREADY PATCHED - nothing to do."; exit 0; }
T=$(mktemp -d); mkdir -p $T/src; cp src/dom_store.js src/price_diff.js src/date_utils.js $T/src/ 2>/dev/null; cd $T || exit 2
patch -p1 --dry-run < $P >/dev/null 2>$T/err.txt || { echo "FAIL: patch does not apply:"; cat $T/err.txt; echo "DRIFT CHECK FAIL - stop; send the md5 above and this output back."; exit 1; }
patch -p1 -s < $P || { echo "FAIL applying to the copy"; exit 1; }
cp src/dom_store.js /tmp/dx-check.mjs; node --check /tmp/dx-check.mjs || { echo "SYNTAX FAIL"; rm -f /tmp/dx-check.mjs; exit 1; }; rm -f /tmp/dx-check.mjs
echo '{"type":"module"}' > $T/package.json
node -e "
import('$T/src/dom_store.js').then(m=>{
  const vin='2T36CRAV0TW000001';
  const dealer='<script type=\"application/ld+json\">{\"@graph\":[{\"@type\":\"AutoDealer\",\"description\":\"Stocking major brands recommended for Toyota vehicles\"}]}</script>';
  const html='<html><head>'+dealer+'</head><body>'+'<p>filler</p>'.repeat(500)+'<div>VIN: '+vin+' Stock #: ST12345</div></body></html>'; // filler: the dealer block must sit more than 4,000 chars before the VIN, as on a real page
  const a=m.extractVehicleDom(html,vin), b=m.extractVehicleDom(html.replace(vin,'XXXXXXXXXXXXXXXXX'),vin), c=m.extractVehicleDom('<p>x</p>',vin);
  const ok=a.includes('Stock #: ST12345')&&!a.includes('@graph')&&b.includes('@graph')&&c==='<p>x</p>';
  console.log('smoke:',ok?'4/4':'FAIL'); if(!ok) process.exit(1);
}).catch(e=>{console.log(e.message);process.exit(1)})" || { echo "SMOKE FAIL"; exit 1; }
echo "== md5 of the patched COPY (what the box would have after applying)"; md5sum src/dom_store.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
