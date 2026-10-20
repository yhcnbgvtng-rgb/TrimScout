#!/bin/bash
# READ-ONLY drift check + dry run for the 2026-10-19 schema-graph-stock box patch chain. Run ON the box. It never writes inside the crawler checkout:
# it prints the md5s of the files the patches touch, then applies the needed patches IN ORDER to a COPY of those files in a temp dir and syntax-checks the result.
#   usage: bash drift-check.sh [CRAWLER_DIR]      (patches must be in /tmp/gs/: 564-02-..., 564-01-..., 01-schema-graph.patch, 02-jsonld-stock.patch)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; P=/tmp/gs; cd "$C" || exit 2
echo "== md5 before"; md5sum src/standalone.js src/porscheSchemaOrgFields.js; ls -l src/listingColors.js src/jsonLdColors.js src/jsonLdStock.js 2>&1 | sed 's/^/   /'
echo "   known standalone.js: 91aff00082ce8639305f4f59bfa7d4bd (robots-sitemap applied; box3/box4), 4a83d1f219e15123645aeca3f27d22e6 (box1 if robots-sitemap applied)"
echo "   known porscheSchemaOrgFields.js: 91c97852ce6e62845aae7889e34afcda (git fb63fd2, box4 read 2026-10-19; unread on box1/box3)"
n_labels=$(grep -c fillColorsFromLabels src/standalone.js); n_graph=$(grep -c findVehicleLd src/standalone.js); n_jsonld=$(grep -c fillColorsFromJsonLd src/standalone.js); n_stock=$(grep -c fillStockFromJsonLd src/standalone.js)
echo "== state: fillColorsFromLabels=$n_labels findVehicleLd=$n_graph fillColorsFromJsonLd=$n_jsonld fillStockFromJsonLd=$n_stock  (0 = that patch is still needed; anything else = already applied)"
T=$(mktemp -d); mkdir -p $T/src; cp src/standalone.js src/porscheSchemaOrgFields.js $T/src/
for f in listingColors.js jsonLdColors.js jsonLdStock.js; do [ -f src/$f ] && cp src/$f $T/src/; done
chain=""; [ "$n_labels" = 0 ] && chain="$chain 564-02-label-colors-pr416.patch"; [ "$n_jsonld" = 0 ] && chain="$chain 564-01-jsonld-colors.patch"
[ "$n_graph" = 0 ] && chain="$chain 01-schema-graph.patch"; [ "$n_stock" = 0 ] && chain="$chain 02-jsonld-stock.patch"
echo "== patches needed, in order:${chain:- none}"
cd $T || exit 2
for p in $chain; do
  patch -p1 --dry-run < $P/$p >/dev/null 2>$T/err.txt || { echo "FAIL: $p does not apply to this box's file (rc=$?):"; cat $T/err.txt; ls *.rej 2>/dev/null; echo "DRIFT CHECK FAIL - stop; send the md5s above and this output back."; exit 1; }
  patch -p1 -s < $P/$p || { echo "FAIL applying $p to the copy"; exit 1; }; echo "ok: $p"
done
for f in src/standalone.js src/porscheSchemaOrgFields.js src/jsonLdColors.js src/jsonLdStock.js src/listingColors.js; do [ -f $f ] && { cp $f /tmp/gs-check.mjs; node --check /tmp/gs-check.mjs || { echo "SYNTAX FAIL $f"; exit 1; }; }; done; rm -f /tmp/gs-check.mjs
echo "== md5 of the patched COPIES (what the box would have after applying)"; md5sum src/*.js
echo "DRIFT CHECK PASS (nothing in $C was changed)"
