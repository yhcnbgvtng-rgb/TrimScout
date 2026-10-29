#!/bin/bash
# Keep cars whose make nothing can name, on crawl boxes 1, 3, 4 (vinWmi.js + brand_match.js replaced, standalone.js patched). Run ON the box, from STDIN (same form as #630):
#
#   ssh <box ProxyCommand form, see STEPS.md> 'bash -s -- check'    < install-keep-unresolved.sh     # READ-ONLY: gates, md5s, trial on copies in a temp dir
#   ssh <box ...>                              'bash -s -- apply'    < install-keep-unresolved.sh     # check, backup, install, verify; restores itself on any failure
#   ssh <box ...>                              'bash -s -- rollback' < install-keep-unresolved.sh     # put everything back from the backup
#
# Staged first with scp into /tmp/keepmake-stage/: vinWmi.js, brand_match.js, standalone.js.keep-unresolved.patch (md5s checked here).
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, any file whose md5 is not a known state, a staged file with the wrong md5.
# Independent of the trim wiring (#630): the standalone.js patch applies before or after it and reaches the same file; install-trim-wiring.sh knows the states this leaves behind.
# No restart: a crawl is a fresh Node process. Nothing here touches cron, a database or a service.
set -u

C=${KEEPMAKE_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
STAGE=${KEEPMAKE_STAGE:-/tmp/keepmake-stage}
BK=${KEEPMAKE_BACKUP:-/home/ubuntu/backups/keep-unresolved-make-20261029}
SRC=$C/src

# standalone.js as read on the boxes 2026-10-29 (box1 / box3+box4), with the trim wiring (#630) not yet / already on, and what the patch must produce.
SA_BOX1=8c39cf86d3017210d586ff3afeb33969;   SA_BOX1_OUT=ede2990ec93118428f0854be09006699
SA_BOX1_W=980769d114cba511aef4bc5ff033e0ae; SA_BOX1_W_OUT=84a36177398ab6408b5302d1a585cb41
SA_BOX34=d05cd479b8f8d22a77d4d9fb1ef2e31a;   SA_BOX34_OUT=1e3766e5d0a5b3042f766c8ea205332d
SA_BOX34_W=6f4c4f2a4b4db2ab2830e11074723dba; SA_BOX34_W_OUT=d948a134a70ea055c4a2dac235e8d474
# vinWmi.js: the make-wmi install (7371d7d9) or the box2 VIN-guard package's table (274e6047); brand_match.js: the make-wmi install.
VW_BEFORE_1=7371d7d9bd40bd9586b4ef8a848a4969; VW_BEFORE_2=274e60473eb1d83fe6b01def4e5f68dc; VW_AFTER=ca01f12109ab5eb40901d68b022486db
BM_BEFORE=2b421d128ce20aab0644820bb0702271; BM_AFTER=255cfe545bc30d8e41d45edf4cb33180
# files the new ones import, which must already be the make-wmi versions
SM=4017f1f9e24dc14d1b2cc530737e1e00; IG=88ec75c5d81a19dd484de0dea62add28; VT=2bb0902516fe1279adec20291096ac7b
PATCH_MD5=b06c4d5b2f5cb1c34812c08f81678a41

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
MODE=${1:-check}
rollback_cmd() { echo "ROLLBACK: rerun this script with the argument 'rollback' (same ssh form, 'bash -s -- rollback' < install-keep-unresolved.sh). By hand: cp -p $BK/standalone.js.before $SRC/standalone.js; cp -p $BK/brand_match.js.before $SRC/brand_match.js; cp -p $BK/vinWmi.js.before $SRC/vinWmi.js"; }

if [ "$MODE" = rollback ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  for f in standalone.js brand_match.js vinWmi.js; do
    want=$(awk -v f="$f" '$2==f{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/$f.before")" = "$want" ] || fail "backup $f does not match its recorded md5"
  done
  for f in vinWmi.js brand_match.js standalone.js; do cp -p "$BK/$f.before" "$SRC/$f.rb" && mv -f "$SRC/$f.rb" "$SRC/$f"; done
  for f in standalone.js brand_match.js vinWmi.js; do echo "restored $f $(md5of "$SRC/$f") (was $(awk -v f="$f" '$2==f{print $1}' "$BK/md5s-before.txt"))"; done
  exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or rollback (got '$MODE')"

# ---- gates -------------------------------------------------------------------------------------------------------------------------------------------
now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'standalone|inventory-sync|lightsail-crawler|nj-scraper'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v "pgrep" )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in standalone.js brand_match.js vinWmi.js stellantisMake.js ingestGuards.js stellantisVinTable.js; do [ -f "$SRC/$f" ] || fail "$SRC/$f not found (wrong box, path, or the make-wmi install is missing)"; done

# ---- what state is each file in ----------------------------------------------------------------------------------------------------------------------
[ "$(md5of "$SRC/stellantisMake.js")" = "$SM" ] && [ "$(md5of "$SRC/ingestGuards.js")" = "$IG" ] && [ "$(md5of "$SRC/stellantisVinTable.js")" = "$VT" ] || fail "stellantisMake.js / ingestGuards.js / stellantisVinTable.js are not the make-wmi versions ($SM / $IG / $VT); install make-wmi first"
sa=$(md5of "$SRC/standalone.js"); vw=$(md5of "$SRC/vinWmi.js"); bm=$(md5of "$SRC/brand_match.js")
SA_DONE=0
case $sa in
  "$SA_BOX1")    SA_AFTER=$SA_BOX1_OUT;    echo "standalone.js $sa = box1 variant";;
  "$SA_BOX1_W")  SA_AFTER=$SA_BOX1_W_OUT;  echo "standalone.js $sa = box1 variant with the trim wiring (#630)";;
  "$SA_BOX34")   SA_AFTER=$SA_BOX34_OUT;   echo "standalone.js $sa = box3/box4 variant";;
  "$SA_BOX34_W") SA_AFTER=$SA_BOX34_W_OUT; echo "standalone.js $sa = box3/box4 variant with the trim wiring (#630)";;
  "$SA_BOX1_OUT"|"$SA_BOX1_W_OUT"|"$SA_BOX34_OUT"|"$SA_BOX34_W_OUT") SA_DONE=1; echo "standalone.js $sa = already patched";;
  *) fail "standalone.js md5 $sa is not a known state (box1 $SA_BOX1 / $SA_BOX1_W, box3/4 $SA_BOX34 / $SA_BOX34_W). Send the file back; do not improvise.";;
esac
VW_DONE=0; BM_DONE=0
case $vw in "$VW_BEFORE_1"|"$VW_BEFORE_2") ;; "$VW_AFTER") VW_DONE=1;; *) fail "vinWmi.js md5 $vw is neither $VW_BEFORE_1, $VW_BEFORE_2 nor $VW_AFTER";; esac
case $bm in "$BM_BEFORE") ;; "$BM_AFTER") BM_DONE=1;; *) fail "brand_match.js md5 $bm is neither $BM_BEFORE nor $BM_AFTER";; esac
if [ "$SA_DONE" = 1 ] && [ "$VW_DONE" = 1 ] && [ "$BM_DONE" = 1 ]; then echo "ALREADY INSTALLED, nothing to do."; exit 0; fi
if [ "$SA_DONE" != "$BM_DONE" ] || [ "$SA_DONE" != "$VW_DONE" ]; then fail "the three files are in mixed states (standalone.js done=$SA_DONE, brand_match.js done=$BM_DONE, vinWmi.js done=$VW_DONE); send this back, do not improvise"; fi
for pair in "vinWmi.js:$VW_AFTER" "brand_match.js:$BM_AFTER" "standalone.js.keep-unresolved.patch:$PATCH_MD5"; do
  f=${pair%%:*}; want=${pair##*:}
  [ -f "$STAGE/$f" ] || fail "$STAGE/$f not staged (scp it first, see STEPS.md)"
  [ "$(md5of "$STAGE/$f")" = "$want" ] || fail "staged $f md5 $(md5of "$STAGE/$f") is not $want"
done

# ---- trial on copies, off the checkout ---------------------------------------------------------------------------------------------------------------
W=$(mktemp -d /tmp/keepmake-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"; echo '{"type":"module"}' > "$W/src/package.json"
cp -p "$SRC/stellantisMake.js" "$SRC/ingestGuards.js" "$SRC/stellantisVinTable.js" "$W/src/"; cp -p "$STAGE/vinWmi.js" "$STAGE/brand_match.js" "$W/src/"
cp -p "$SRC/standalone.js" "$W/src/standalone.js"
(cd "$W" && patch -p1 -s -F0 --no-backup-if-mismatch < "$STAGE/standalone.js.keep-unresolved.patch") || fail "the patch does not apply to this box's standalone.js (zero fuzz)"
m=$(md5of "$W/src/standalone.js"); [ "$m" = "$SA_AFTER" ] || fail "patched standalone.js md5 $m, expected $SA_AFTER"
for f in vinWmi.js brand_match.js standalone.js; do cp "$W/src/$f" "$W/chk.mjs"; node --check "$W/chk.mjs" || fail "$f does not parse"; done
cat > "$W/smoke.mjs" <<'JS'
import { resolveKeptMakeDetailed } from "./src/brand_match.js";
const HONDA = { name: "Honda", vinPrefixes: ["1HG", "2HG", "JHM"] }, GMC = { name: "GMC", vinPrefixes: ["1GT", "1GK", "3GT", "3GK"] };
const cases = [
  [HONDA, { make: null, vin: "5N1AT2MT8KC702673", model: "Rogue" }, { make: "Honda" }, "Nissan", "vin"],
  [HONDA, { make: null, vin: "5N1DL0MM1HC501234", model: "QX60" }, { make: "Honda" }, "Infiniti", "vin"],
  [HONDA, { make: null, vin: "KNDPM3AC8L7807729", model: "Sportage" }, { make: "Honda" }, "Kia", "vin"],
  [HONDA, { make: null, vin: "5TDBSKFC4NS062179", model: "Sienna" }, { make: "Honda" }, "Toyota", "vin"],
  [HONDA, { make: null, vin: "5N1AT2MT8KC702673", model: "Mystery" }, { make: "Honda" }, null, "unresolved"],
  [HONDA, { make: null, vin: "5N1AT2MT8KC702673" }, { make: "Honda" }, null, "unresolved"],
  [GMC, { make: null, vin: "2B3LJ54T19H594202", model: "Challenger" }, { make: "GMC" }, "Dodge", "vin"],
  [GMC, { make: null, vin: "1GKB0RDC6RU100924", model: "Yukon" }, { make: "GMC" }, "GMC", "vin"],
  [GMC, { make: null, vin: "XZZCJ1DH0NUL16894", model: "X" }, { make: "GMC" }, "GMC", "fallback"],
  [GMC, { make: "Honda", vin: "XZZCJ1DH0NUL16894", model: "Fit" }, { make: "GMC" }, "Honda", "page"],
];
let bad = 0;
const log = console.log; console.log = () => {};
for (const [brand, v, d, make, src] of cases) { const r = resolveKeptMakeDetailed(brand, v, d); if (r.make !== make || r.makeSource !== src) { bad++; log(`FAIL ${v.vin} ${v.model ?? "-"}: got ${r.make}/${r.makeSource}, want ${make}/${src}`); } }
console.log = log; console.log(bad ? `SMOKE FAILED ${bad}` : `smoke ok (${cases.length} cases)`); process.exit(bad ? 1 : 0);
JS
out=$(cd "$W" && node smoke.mjs 2>&1); echo "$out"; case $out in *"smoke ok"*) ;; *) fail "smoke test failed against the box's own stellantisMake/ingestGuards/stellantisVinTable";; esac
echo "trial ok: standalone.js -> $SA_AFTER, vinWmi.js -> $VW_AFTER, brand_match.js -> $BM_AFTER"
if [ "$MODE" = check ]; then echo "CHECK only, nothing written. Re-run with 'apply' on Paul's GO."; rollback_cmd; exit 0; fi

# ---- apply -------------------------------------------------------------------------------------------------------------------------------------------
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup from an earlier run; move it aside first"
mkdir -p "$BK" || fail "cannot make $BK"
for f in standalone.js brand_match.js vinWmi.js; do cp -p "$SRC/$f" "$BK/$f.before"; done
{ echo "$sa standalone.js"; echo "$bm brand_match.js"; echo "$vw vinWmi.js"; } > "$BK/md5s-before.txt"
echo "backup in $BK:"; ls -l "$BK" | sed 's/^/  /'
restore_inline() { for f in vinWmi.js brand_match.js standalone.js; do cp -p "$BK/$f.before" "$SRC/$f"; done; echo "restored: standalone.js $(md5of "$SRC/standalone.js"), brand_match.js $(md5of "$SRC/brand_match.js"), vinWmi.js $(md5of "$SRC/vinWmi.js")" >&2; }
bad() { echo "FAILED: $*" >&2; restore_inline; exit 1; }
# order: vinWmi (imported by brand_match) -> brand_match -> standalone last
for f in vinWmi.js brand_match.js; do install -m 644 "$STAGE/$f" "$SRC/$f.new" && mv -f "$SRC/$f.new" "$SRC/$f" || bad "installing $f"; done
cp -p "$W/src/standalone.js" "$SRC/standalone.js.new" && mv -f "$SRC/standalone.js.new" "$SRC/standalone.js" || bad "installing standalone.js"
[ "$(md5of "$SRC/vinWmi.js")" = "$VW_AFTER" ] && [ "$(md5of "$SRC/brand_match.js")" = "$BM_AFTER" ] && [ "$(md5of "$SRC/standalone.js")" = "$SA_AFTER" ] || bad "md5 after install"
for f in vinWmi.js brand_match.js standalone.js; do cp "$SRC/$f" "$W/final.mjs"; node --check "$W/final.mjs" || bad "installed $f does not parse"; done
(cd "$SRC/.." && node --input-type=module -e 'const m = await import("./src/brand_match.js"); const r = m.resolveKeptMakeDetailed({ name: "Honda", vinPrefixes: ["1HG"] }, { make: null, vin: "5N1AT2MT8KC702673", model: "Rogue" }, { make: "Honda" }); if (r.make !== "Nissan") process.exit(1)') || bad "the installed brand_match.js does not load or resolve a Rogue on a Honda roster"
{ echo "$(md5of "$SRC/standalone.js") standalone.js"; echo "$BM_AFTER brand_match.js"; echo "$VW_AFTER vinWmi.js"; } > "$BK/md5s-after.txt"
echo "INSTALLED. md5s now:"; sed 's/^/  /' "$BK/md5s-after.txt"
echo "No restart: the next crawl is a fresh Node process."
rollback_cmd
