#!/bin/bash
# dom_index.json incremental save, for crawl boxes box1 (v2) and box5. ONE file: src/dom_store.js (replaced whole; pinned before/after md5).
# Needs #719 already installed (heapGuard.js present) and bigJson.js at its pinned md5 (it is the same file on both boxes, already used by standalone.js).
# Self-contained: the new dom_store.js is embedded below (base64), so `check` stages nothing on the box. Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, then a save/load trial on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up dom_store.js back
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, a dom_store.js / bigJson.js whose md5 is not a known state, #719 missing.
# Never touches data/dom_index.json, crontab, env or heap settings. No restart: the next crawl is a fresh Node process.
set -u
C=${DOMSAVE_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${DOMSAVE_BACKUP:-/home/ubuntu/backups/dom-index-save-20261106}
SRC=$C/src; DS=$SRC/dom_store.js; BJ=$SRC/bigJson.js; HG=$SRC/heapGuard.js
DS_BEFORE=1a2e29b0166878a3561c21ca8c427bf1; DS_AFTER=541b78ff568d0d11b740e1e67a8ba06c; BJ_MD5=650637d98c37bf861098821826b5d696; HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="dom_store.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/dom_store.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/dom_store.js.before" "$DS.rb" && mv -f "$DS.rb" "$DS"
  echo "restored: dom_store.js $(md5of "$DS")"; exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$DS" "$BJ" "$HG"; do [ -f "$f" ] || fail "$f not found (wrong box, path, or #719 not installed)"; done
[ "$(md5of "$HG")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$BJ")" = "$BJ_MD5" ] || fail "bigJson.js md5 $(md5of "$BJ") is not the pinned $BJ_MD5. Send the file back; do not improvise."
ds=$(md5of "$DS")
if [ "$ds" = "$DS_AFTER" ]; then echo "ALREADY INSTALLED (dom_store.js $ds), nothing to do."; exit 0; fi
[ "$ds" = "$DS_BEFORE" ] || fail "dom_store.js md5 $ds is not a known state ($DS_BEFORE before / $DS_AFTER after). Send the file back; do not improvise."

W=$(mktemp -d /tmp/domsave-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_ds() { base64 -d <<'DSEOF'
Ly8gRGFpbHkgdmVoaWNsZSBET00gc25hcHNob3RzLgovLwovLyBGdWxsIChvciBjb21wYWN0IGV4
dHJhY3RlZCkgSFRNTCBpcyBnemlwcGVkIGFuZCBrZXllZCBieSBWSU4rZGF0ZSB1bmRlcgovLyBk
YXRhL2RvbV9ibG9icy8uIElmIHRvZGF5J3MgRE9NIGhhc2ggbWF0Y2hlcyB5ZXN0ZXJkYXkncywg
b25seSB0aGUgaGFzaAovLyBpcyByZWNvcmRlZCBhbmQgdGhlIGJsb2IgaXMgbm90IHJld3JpdHRl
bi4gRnVsbCBibG9icyBhcmUgcmV0YWluZWQgZm9yCi8vIDcgZGF5czsgaGFzaGVzICsgcHJpY2Vz
IGxpdmUgaW5kZWZpbml0ZWx5IGluIGRhdGEvZG9tX2luZGV4Lmpzb24gYW5kCi8vICh3aGVuIE1h
cmlhREIgaXMgY29uZmlndXJlZCkgdmVoaWNsZV9kb21fc25hcHNob3RzLgoKaW1wb3J0IGZzIGZy
b20gJ25vZGU6ZnMvcHJvbWlzZXMnOwppbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnOwppbXBv
cnQgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJzsKaW1wb3J0IHpsaWIgZnJvbSAnbm9kZTp6bGli
JzsKaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnbm9kZTp1dGlsJzsKaW1wb3J0IHsgcHJpY2VD
aGFuZ2VWc1llc3RlcmRheSB9IGZyb20gJy4vcHJpY2VfZGlmZi5qcyc7CmltcG9ydCB7IGVhc3Rl
cm5EYXRlU3RhbXAgfSBmcm9tICcuL2RhdGVfdXRpbHMuanMnOwppbXBvcnQgeyByZWFkSnNvbkxh
cmdlLCB3cml0ZUpzb25MYXJnZSB9IGZyb20gJy4vYmlnSnNvbi5qcyc7Cgpjb25zdCBnemlwID0g
cHJvbWlzaWZ5KHpsaWIuZ3ppcCk7CmNvbnN0IGd1bnppcCA9IHByb21pc2lmeSh6bGliLmd1bnpp
cCk7CgpleHBvcnQgY29uc3QgRE9NX1JFVEFJTl9EQVlTID0gNzsKZXhwb3J0IGNvbnN0IERPTV9J
TkRFWF9GSUxFTkFNRSA9ICdkb21faW5kZXguanNvbic7CmV4cG9ydCBjb25zdCBET01fQkxPQlNf
RElSTkFNRSA9ICdkb21fYmxvYnMnOwoKZXhwb3J0IGZ1bmN0aW9uIGRvbVBhdGhzKGN3ZCA9IHBy
b2Nlc3MuY3dkKCkpIHsKICBjb25zdCBkYXRhRGlyID0gcGF0aC5yZXNvbHZlKGN3ZCwgJ2RhdGEn
KTsKICByZXR1cm4gewogICAgZGF0YURpciwKICAgIGluZGV4UGF0aDogcGF0aC5qb2luKGRhdGFE
aXIsIERPTV9JTkRFWF9GSUxFTkFNRSksCiAgICBibG9ic0RpcjogcGF0aC5qb2luKGRhdGFEaXIs
IERPTV9CTE9CU19ESVJOQU1FKSwKICB9Owp9CgpleHBvcnQgZnVuY3Rpb24gaGFzaERvbSh0ZXh0
KSB7CiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoU3RyaW5nKHRl
eHQgfHwgJycpLCAndXRmOCcpLmRpZ2VzdCgnaGV4Jyk7Cn0KCi8vIFdoaWNoIG9jY3VycmVuY2Ug
b2YgdGhlIFZJTiB0byBidWlsZCB0aGUgd2luZG93IGFyb3VuZC4gQSBUZWFtIFZlbG9jaXR5IHBh
Z2UgbmFtZXMgdGhlIFZJTiBmaXJzdCBpbiBpdHMgPGhlYWQ+IChjYW5vbmljYWwgLyBvZzp1cmwg
LyB0d2l0dGVyOnVybAovLyBtZXRhIGFuZCBsaW5rIHRhZ3MgY2FycnkgdGhlIHBhZ2UgVVJMLCB3
aGljaCBlbmRzIGluIHRoZSBWSU4pLCBzbyB0aGUgZmlyc3Qgb2NjdXJyZW5jZSBpcyBtYXJrdXAs
IG5vdCB0aGUgY2FyOiB0aGUgd2luZG93IGFyb3VuZCBpdCB3YXMgdGhlIHBhZ2UgaGVhZAovLyAo
Ym94NCwgMjAyNi0xMC0yMzogVklOIGF0IG9mZnNldCAzMjctNzQyIG9mIDguMy04LjcgS0IgYmxv
YnMsIG5vIHN0b2NrIG9yIHByaWNlIHRleHQpLiBSdWxlcywgaW4gb3JkZXI6Ci8vICAgMS4gZHJv
cCBvY2N1cnJlbmNlcyBpbnNpZGUgPGhlYWQ+LCBpbnNpZGUgYW55IHRhZydzIGF0dHJpYnV0ZXMg
KG1ldGEvbGluayBjb250ZW50PSwgaHJlZj0sIGRhdGEtKiksIGFuZCBpbnNpZGUgYSBVUkw7Ci8v
ICAgMi4gb2Ygd2hhdCBpcyBsZWZ0ICh0aGUgcGFnZSBib2R5KSwgdGFrZSB0aGUgb25lIGNsb3Nl
c3QgdG8gc3RvY2sgLyBwcmljZSAvIE1TUlAgdGV4dCAoc2VhcmNoZWQgd2l0aGluIHRoZSB3aW5k
b3csIGFmdGVyIHRoZSBoZWFkKTsKLy8gICAzLiBubyBib2R5IG9jY3VycmVuY2UgaGFzIHN1Y2gg
dGV4dCBuZWFyIGl0OiB0aGUgbGFzdCBib2R5IG9jY3VycmVuY2U7IG5vIGJvZHkgb2NjdXJyZW5j
ZSBhdCBhbGw6IHRoZSBsYXN0IG9jY3VycmVuY2UgYW55d2hlcmUuCi8vIFJldHVybnMgLTEgd2hl
biB0aGUgVklOIGlzIG5vdCBvbiB0aGUgcGFnZS4gU2FtZSB3aW5kb3cgYXMgYmVmb3JlICg0LDAw
MCBiZWZvcmUsIDgsMDAwIGFmdGVyKS4KY29uc3QgTkVBUl9GSUVMRCA9IC9zdG9ja1xzKig/OiN8
bm9cYnxudW1iZXIpfFxic3RvY2tcYnxcYnByaWNlXGJ8XGJtc3JwXGIvZ2k7CmV4cG9ydCBmdW5j
dGlvbiBwaWNrVmluT2NjdXJyZW5jZSh0ZXh0LCB2aW4pIHsKICBjb25zdCBhbGwgPSBbXTsKICBm
b3IgKGxldCBpID0gdGV4dC5pbmRleE9mKHZpbik7IGkgIT09IC0xOyBpID0gdGV4dC5pbmRleE9m
KHZpbiwgaSArIDEpKSBhbGwucHVzaChpKTsKICBpZiAoIWFsbC5sZW5ndGgpIHJldHVybiAtMTsK
ICBjb25zdCBoZWFkRW5kID0gKCgpID0+IHsgY29uc3QgbSA9IC88XC9oZWFkXHMqPi9pLmV4ZWMo
dGV4dCk7IHJldHVybiBtID8gbS5pbmRleCArIG1bMF0ubGVuZ3RoIDogMDsgfSkoKTsKICBjb25z
dCBpblRhZyA9IChpKSA9PiB0ZXh0Lmxhc3RJbmRleE9mKCc8JywgaSkgPiB0ZXh0Lmxhc3RJbmRl
eE9mKCc+JywgaSk7CiAgY29uc3QgaW5VcmwgPSAoaSkgPT4gewogICAgY29uc3QgdG9rID0gdGV4
dC5zbGljZShNYXRoLm1heCgwLCBpIC0gODApLCBpKS5zcGxpdCgvW1xzIidgKCw7XS8pLnBvcCgp
OwogICAgcmV0dXJuIC9eKD86aHR0cHM/Oik/XC9cLy9pLnRlc3QodG9rKSB8fCB0b2suc3RhcnRz
V2l0aCgnLycpIHx8IHRvay5pbmNsdWRlcygnOi8vJyk7CiAgfTsKICBjb25zdCBib2R5ID0gYWxs
LmZpbHRlcigoaSkgPT4gaSA+PSBoZWFkRW5kICYmICFpblRhZyhpKSAmJiAhaW5VcmwoaSkpOwog
IGlmICghYm9keS5sZW5ndGgpIHJldHVybiBhbGxbYWxsLmxlbmd0aCAtIDFdOwogIGxldCBiZXN0
ID0gLTEsIGJlc3REaXN0ID0gSW5maW5pdHk7CiAgZm9yIChjb25zdCBpIG9mIGJvZHkpIHsKICAg
IGNvbnN0IGxvID0gTWF0aC5tYXgoaGVhZEVuZCwgaSAtIDQwMDApLCBoaSA9IE1hdGgubWluKHRl
eHQubGVuZ3RoLCBpICsgODAwMCk7CiAgICBjb25zdCB3aW4gPSB0ZXh0LnNsaWNlKGxvLCBoaSk7
CiAgICBORUFSX0ZJRUxELmxhc3RJbmRleCA9IDA7CiAgICBmb3IgKGxldCBtID0gTkVBUl9GSUVM
RC5leGVjKHdpbik7IG07IG0gPSBORUFSX0ZJRUxELmV4ZWMod2luKSkgewogICAgICBjb25zdCBk
ID0gTWF0aC5hYnMobG8gKyBtLmluZGV4IC0gaSk7CiAgICAgIGlmIChkIDwgYmVzdERpc3QpIHsg
YmVzdERpc3QgPSBkOyBiZXN0ID0gaTsgfQogICAgfQogIH0KICByZXR1cm4gYmVzdCAhPT0gLTEg
PyBiZXN0IDogYm9keVtib2R5Lmxlbmd0aCAtIDFdOwp9CgovLyBQcmVmZXIgYSBjb21wYWN0IHZl
aGljbGUgbm9kZSBvdmVyIHRoZSBmdWxsIHBhZ2Ugc28gd2UgYXJlIG5vdCBzdG9yaW5nCi8vIGNo
cm9tZSwgbmF2LCBhbmQgdHJhY2tlciBzY3JpcHRzIGZvciBldmVyeSBWSU4gZXZlcnkgZGF5Lgpl
eHBvcnQgZnVuY3Rpb24gZXh0cmFjdFZlaGljbGVEb20oaHRtbCwgdmluID0gbnVsbCkgewogIGNv
bnN0IHRleHQgPSBTdHJpbmcoaHRtbCB8fCAnJyk7CiAgY29uc3QgZGRjID0gdGV4dC5tYXRjaCgv
RERDXC5kYXRhTGF5ZXJcWy52ZWhpY2xlcy5cXVxzKj1ccyooXFtbXHNcU10qP1xdKTsvKQogICAg
fHwgdGV4dC5tYXRjaCgvd2luZG93XC5ERENcLmRhdGFMYXllclxbLnZlaGljbGVzLlxdXHMqPVxz
KihcW1tcc1xTXSo/XF0pOy8pOwogIGlmIChkZGMpIHJldHVybiBkZGNbMF07CgogIGNvbnN0IGxk
QmxvY2tzID0gWy4uLnRleHQubWF0Y2hBbGwoLzxzY3JpcHRbXj5dKnR5cGU9WyInXWFwcGxpY2F0
aW9uXC9sZFwranNvblsiJ11bXj5dKj4oW1xzXFNdKj8pPFwvc2NyaXB0Pi9naSldOwogIGZvciAo
Y29uc3QgbSBvZiBsZEJsb2NrcykgewogICAgaWYgKC9WZWhpY2xlfENhcnxQcm9kdWN0L2kudGVz
dChtWzFdKSAmJiAoIXZpbiB8fCBtWzFdLmluY2x1ZGVzKHZpbikpKSByZXR1cm4gbVsxXS50cmlt
KCk7CiAgfQogIC8vIE5vIEpTT04tTEQgYmxvY2sgY2FycmllcyB0aGlzIGNhcidzIFZJTi4gQSBi
bG9jayB0aGF0IG1lcmVseSBtYXRjaGVzIC9WZWhpY2xlfENhcnxQcm9kdWN0LyBpcyB0aGVuIHRo
ZSBkZWFsZXIncyBvd24gKFRlYW0gVmVsb2NpdHkncyBvbmx5CiAgLy8gSlNPTi1MRCBpcyB0aGUg
QXV0b0RlYWxlciBncmFwaCwgd2hpY2ggbWF0Y2hlcyBvbiB0aGUgd29yZCAidmVoaWNsZXMiKTog
c3RvcmluZyBpdCBrZWVwcyBub3RoaW5nIGFib3V0IHRoZSBjYXIsIHNvIGV2ZXJ5IHN1Y2ggcGFn
ZSB3YXMgY2FjaGVkCiAgLy8gYXMgdGhlIHNhbWUgZGVhbGVyIHRleHQuIEtlZXAgdGhlIHBhZ2Ug
YXJvdW5kIHRoZSBWSU4gaW5zdGVhZCAod2hlcmUgdGhlIHN0b2NrIG51bWJlciwgcHJpY2UgYW5k
IGRldGFpbHMgc2l0KS4KICBpZiAodmluKSB7CiAgICBjb25zdCBpZHggPSBwaWNrVmluT2NjdXJy
ZW5jZSh0ZXh0LCB2aW4pOwogICAgaWYgKGlkeCAhPT0gLTEpIHsKICAgICAgcmV0dXJuIHRleHQu
c2xpY2UoTWF0aC5tYXgoMCwgaWR4IC0gNDAwMCksIE1hdGgubWluKHRleHQubGVuZ3RoLCBpZHgg
KyA4MDAwKSk7CiAgICB9CiAgfQogIC8vIFZJTiBub3Qgb24gdGhlIHBhZ2UgYXQgYWxsIChvciBu
b25lIGdpdmVuKTogdGhlIGZpcnN0IFZlaGljbGUtbGlrZSBKU09OLUxEIGJsb2NrLCBhcyBiZWZv
cmUuCiAgZm9yIChjb25zdCBtIG9mIGxkQmxvY2tzKSB7CiAgICBpZiAoL1ZlaGljbGV8Q2FyfFBy
b2R1Y3QvaS50ZXN0KG1bMV0pKSByZXR1cm4gbVsxXS50cmltKCk7CiAgfQogIHJldHVybiB0ZXh0
Owp9CgpleHBvcnQgZnVuY3Rpb24gYmxvYlBhdGgodmluLCBkYXRlLCBjd2QgPSBwcm9jZXNzLmN3
ZCgpKSB7CiAgY29uc3Qgc2FmZVZpbiA9IFN0cmluZyh2aW4gfHwgJycpLnRvVXBwZXJDYXNlKCku
cmVwbGFjZSgvW15BLUhKLU5QUi1aMC05XS9nLCAnJyk7CiAgcmV0dXJuIHBhdGguam9pbihkb21Q
YXRocyhjd2QpLmJsb2JzRGlyLCBzYWZlVmluLCBgJHtkYXRlfS5odG1sLmd6YCk7Cn0KCi8vIGRv
bV9pbmRleC5qc29uIGhvbGRzIG9uZSBlbnRyeSBwZXIgVklOIGFuZCBncm93cyBldmVyeSBuaWdo
dCAoYm94MSwgMjAyNi0xMS0wNjogNDgwLDY2MywyNDkgYnl0ZXMsIDIuMzdNIHZpbi1kYXRlcyku
IFY4IGNhbm5vdCBidWlsZCBhIHN0cmluZyBsb25nZXIgdGhhbgovLyAyXjI5LTI0ID0gNTM2LDg3
MCw4ODggY2hhcmFjdGVycywgYW5kIHRoZSBvbGQgc2F2ZSBkaWQgSlNPTi5zdHJpbmdpZnkod2hv
bGVJbmRleCksIHNvIGl0IHdvdWxkIGhhdmUgc3RhcnRlZCB0aHJvd2luZyAiSW52YWxpZCBzdHJp
bmcgbGVuZ3RoIiBhYm91dCA1NiBNQgovLyAofjEyJSkgcGFzdCB0aGF0IHNpemUsIGFuZCB0aGUg
b2xkIGxvYWQgKHJlYWRGaWxlICsgSlNPTi5wYXJzZSkgZmFpbHMgdGhlIHNhbWUgd2F5LiBCb3Ro
IG5vdyBnbyB0aHJvdWdoIGJpZ0pzb24uanM6IHNhdmUgd3JpdGVzIG9uZSBWSU4gYXQgYSB0aW1l
LCBsb2FkCi8vIHBhcnNlcyBvbmUgVklOIGF0IGEgdGltZSAoZmlsZXMgYWJvdmUgU1RSRUFNX0FC
T1ZFX0JZVEVTKSwgc28gbm8gc3RyaW5nIGJpZ2dlciB0aGFuIG9uZSBWSU4ncyBoaXN0b3J5IGV2
ZXIgZXhpc3RzLiBUaGUgZmlsZSBpcyBzdGlsbCBvbmUgSlNPTiBvYmplY3QKLy8ga2V5ZWQgYnkg
VklOLCBzbyBldmVyeSBvbGRlciByZWFkZXIgKEpTT04ucGFyc2Ugb2YgdGhlIHdob2xlIGZpbGUp
IGtlZXBzIHdvcmtpbmc7IHRoZSBvbmx5IGRpZmZlcmVuY2UgaXMgYSBuZXdsaW5lIGJldHdlZW4g
VklOcy4KZXhwb3J0IGNvbnN0IERPTV9JTkRFWF9UTVBfU1RBTEVfTVMgPSA2ICogMzYwMCAqIDEw
MDA7IC8vIGEgc2F2ZSB0YWtlcyBzZWNvbmRzIHRvIG1pbnV0ZXM7IGEgdGVtcCBmaWxlIHRoaXMg
b2xkIGJlbG9uZ3MgdG8gYSBraWxsZWQgcHJvY2VzcwoKLy8gTG9hZCBmYWlscyBDTE9TRUQuIE9u
bHkgRU5PRU5UIChubyBpbmRleCB5ZXQ6IGZpcnN0IHJ1biBvbiBhIGJveCkgZ2l2ZXMgYW4gZW1w
dHkgaW5kZXguIEFueXRoaW5nIGVsc2UgKHBlcm1pc3Npb24gZXJyb3IsIG1hbGZvcm1lZCBvciB0
cnVuY2F0ZWQgSlNPTiwgYSByZWFkCi8vIHRoYXQga2VlcHMgZmFpbGluZykgdGhyb3dzIERvbUlu
ZGV4VW5yZWFkYWJsZUVycm9yIGFuZCBsZWF2ZXMgdGhlIGZpbGUgZXhhY3RseSBhcyBpdCBpczog
c3RhcnRpbmcgZnJvbSB7fSB3b3VsZCBsZXQgdGhlIG5leHQgc2F2ZSByZXBsYWNlIHRoZSB3aG9s
ZSBwcmljZQovLyBoaXN0b3J5IHdpdGggYW4gZW1wdHkgaW5kZXguIHN0YW5kYWxvbmUuanMgbG9h
ZHMgYXQgc3RhcnR1cCB3aXRoIGEgdG9wLWxldmVsIGF3YWl0LCBzbyB0aGUgYnJhbmQgcnVuIHN0
b3BzIHdpdGggYSBub24temVybyBleGl0IGFuZCB0aGUgZHJpdmVyIHJlY29yZHMgaXQgYXMKLy8g
YSBmYWlsZWQgcnVuLCBsaWtlIGFueSBvdGhlciBjcmFzaGVkIGJyYW5kLiBUcmFuc2llbnQgZXJy
b3JzIChhIGJ1c3kgb3IgaW50ZXJydXB0ZWQgcmVhZCkgYXJlIHJldHJpZWQgYSBmZXcgdGltZXMg
Zmlyc3Q7IG1hbGZvcm1lZCBKU09OIGFuZCBFQUNDRVMgYXJlIG5vdC4KZXhwb3J0IGNsYXNzIERv
bUluZGV4VW5yZWFkYWJsZUVycm9yIGV4dGVuZHMgRXJyb3IgewogIGNvbnN0cnVjdG9yKGluZGV4
UGF0aCwgY2F1c2UpIHsKICAgIHN1cGVyKGBkb21faW5kZXg6ICR7aW5kZXhQYXRofSBleGlzdHMg
YnV0IGNhbm5vdCBiZSByZWFkICgke2NhdXNlICYmIChjYXVzZS5jb2RlIHx8IGNhdXNlLm5hbWUp
fTogJHtjYXVzZSAmJiBjYXVzZS5tZXNzYWdlfSkuIEl0IHdhcyBsZWZ0IHVudG91Y2hlZDsgdGhp
cyBydW4gc3RvcHMgcmF0aGVyIHRoYW4gc3RhcnQgZnJvbSBhbiBlbXB0eSBpbmRleC4gRml4IG9y
IHJlc3RvcmUgdGhlIGZpbGUsIHRoZW4gcnVuIGFnYWluLmApOwogICAgdGhpcy5uYW1lID0gJ0Rv
bUluZGV4VW5yZWFkYWJsZUVycm9yJzsKICAgIHRoaXMuY29kZSA9ICdET01fSU5ERVhfVU5SRUFE
QUJMRSc7CiAgICB0aGlzLnBhdGggPSBpbmRleFBhdGg7CiAgICB0aGlzLmNhdXNlID0gY2F1c2U7
CiAgfQp9CmV4cG9ydCBjb25zdCBET01fSU5ERVhfVFJBTlNJRU5UX0NPREVTID0gbmV3IFNldChb
J0VBR0FJTicsICdFQlVTWScsICdFSU5UUicsICdFTUZJTEUnLCAnRU5GSUxFJywgJ0VJTycsICdF
VElNRURPVVQnLCAnRU5PTUVNJ10pOwoKZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWREb21JbmRl
eChjd2QgPSBwcm9jZXNzLmN3ZCgpLCB7IHJlYWQgPSByZWFkSnNvbkxhcmdlLCBhdHRlbXB0cyA9
IDMsIHJldHJ5RGVsYXlNcyA9IDUwMCB9ID0ge30pIHsKICBjb25zdCB7IGluZGV4UGF0aCB9ID0g
ZG9tUGF0aHMoY3dkKTsKICBmb3IgKGxldCBuID0gMTsgOyBuKyspIHsKICAgIHRyeSB7CiAgICAg
IHJldHVybiBhd2FpdCByZWFkKGluZGV4UGF0aCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAg
aWYgKGVyciAmJiBlcnIuY29kZSA9PT0gJ0VOT0VOVCcpIHJldHVybiB7fTsKICAgICAgaWYgKG4g
PCBhdHRlbXB0cyAmJiBlcnIgJiYgRE9NX0lOREVYX1RSQU5TSUVOVF9DT0RFUy5oYXMoZXJyLmNv
ZGUpKSB7CiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgcmV0
cnlEZWxheU1zICogbikpOwogICAgICAgIGNvbnRpbnVlOwogICAgICB9CiAgICAgIHRocm93IG5l
dyBEb21JbmRleFVucmVhZGFibGVFcnJvcihpbmRleFBhdGgsIGVycik7CiAgICB9CiAgfQp9Cgph
c3luYyBmdW5jdGlvbiByZW1vdmVTdGFsZURvbUluZGV4VG1wKGRhdGFEaXIsIG5vdyA9IERhdGUu
bm93KCkpIHsKICBsZXQgbmFtZXM7CiAgdHJ5IHsgbmFtZXMgPSBhd2FpdCBmcy5yZWFkZGlyKGRh
dGFEaXIpOyB9IGNhdGNoIHsgcmV0dXJuOyB9CiAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7
CiAgICBpZiAoIW5hbWUuc3RhcnRzV2l0aChgJHtET01fSU5ERVhfRklMRU5BTUV9LnRtcGApKSBj
b250aW51ZTsKICAgIGNvbnN0IGYgPSBwYXRoLmpvaW4oZGF0YURpciwgbmFtZSk7CiAgICB0cnkg
ewogICAgICBjb25zdCBzdCA9IGF3YWl0IGZzLnN0YXQoZik7CiAgICAgIGlmIChzdC5pc0ZpbGUo
KSAmJiBub3cgLSBzdC5tdGltZU1zID4gRE9NX0lOREVYX1RNUF9TVEFMRV9NUykgYXdhaXQgZnMu
dW5saW5rKGYpOwogICAgfSBjYXRjaCB7IC8qIGdvbmUgYWxyZWFkeSwgb3Igbm90IG91cnMgdG8g
cmVtb3ZlICovIH0KICB9Cn0KCi8vIFNhdmVzIGluIHRoaXMgcHJvY2VzcyBydW4gb25lIGF0IGEg
dGltZSBwZXIgZmlsZSAodHdvIG92ZXJsYXBwaW5nIHNhdmVzIHdvdWxkIG90aGVyd2lzZSB3YWxr
IHRoZSBzYW1lIG9iamVjdCB3aGlsZSBpdCBpcyBiZWluZyBjaGFuZ2VkIGFuZCByYWNlCi8vIG9u
IHRoZSByZW5hbWUpLiBBY3Jvc3MgcHJvY2Vzc2VzIGVhY2ggc2F2ZSB3cml0ZXMgaXRzIG93biB1
bmlxdWVseSBuYW1lZCB0ZW1wIGZpbGUgKC50bXAtPHBpZD4tPG1zPikgYW5kIHJlbmFtZXMgaXQg
aW50byBwbGFjZSwgc28gYSByZWFkZXIgb3IKLy8gYSBraWxsZWQgcHJvY2VzcyBzZWVzIHRoZSBw
cmV2aW91cyBjb21wbGV0ZSBpbmRleCBvciB0aGUgbmV3IGNvbXBsZXRlIG9uZSwgbmV2ZXIgYSBt
aXguIFR3byBwcm9jZXNzZXMgc2F2aW5nIGF0IG9uY2UgaXMgc3RpbGwgbGFzdC13cml0ZXItd2lu
cywKLy8gZXhhY3RseSBhcyBiZWZvcmU6IGVhY2ggaG9sZHMgaXRzIG93biBjb3B5IG9mIHRoZSBp
bmRleC4KY29uc3Qgc2F2ZUNoYWlucyA9IG5ldyBNYXAoKTsKCmV4cG9ydCBhc3luYyBmdW5jdGlv
biBzYXZlRG9tSW5kZXgoaW5kZXgsIGN3ZCA9IHByb2Nlc3MuY3dkKCkpIHsKICBjb25zdCB7IGRh
dGFEaXIsIGluZGV4UGF0aCB9ID0gZG9tUGF0aHMoY3dkKTsKICAvLyBUYWtlIHRoZSBxdWV1ZSBz
bG90IHN5bmNocm9ub3VzbHksIHNvIHNhdmVzIHJ1biBpbiBjYWxsIG9yZGVyIChhbnl0aGluZyBh
d2FpdGVkIGJlZm9yZSB0aGlzIGxpbmUgY291bGQgcmVvcmRlciB0aGVtKS4KICBjb25zdCBwcmV2
ID0gc2F2ZUNoYWlucy5nZXQoaW5kZXhQYXRoKSB8fCBQcm9taXNlLnJlc29sdmUoKTsKICBjb25z
dCBydW4gPSBwcmV2LmNhdGNoKCgpID0+IHt9KS50aGVuKGFzeW5jICgpID0+IHsKICAgIGF3YWl0
IGZzLm1rZGlyKGRhdGFEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pOwogICAgYXdhaXQgcmVtb3Zl
U3RhbGVEb21JbmRleFRtcChkYXRhRGlyKTsKICAgIC8vIHdyaXRlSnNvbkxhcmdlOiBlbGVtZW50
LWF0LWEtdGltZSwgZnN5bmMsIHJlbmFtZTsgb24gYW55IGVycm9yIGl0IGNsb3NlcyBhbmQgZGVs
ZXRlcyBpdHMgdGVtcCBmaWxlIGFuZCB0aGUgcHJldmlvdXMgaW5kZXggc3RheXMgaW4gcGxhY2Uu
CiAgICBhd2FpdCB3cml0ZUpzb25MYXJnZShpbmRleFBhdGgsIGluZGV4KTsKICB9KTsKICBzYXZl
Q2hhaW5zLnNldChpbmRleFBhdGgsIHJ1bik7CiAgdHJ5IHsKICAgIGF3YWl0IHJ1bjsKICB9IGZp
bmFsbHkgewogICAgaWYgKHNhdmVDaGFpbnMuZ2V0KGluZGV4UGF0aCkgPT09IHJ1bikgc2F2ZUNo
YWlucy5kZWxldGUoaW5kZXhQYXRoKTsKICB9Cn0KCmZ1bmN0aW9uIHByZXZpb3VzRGF0ZShkYXRl
KSB7CiAgY29uc3QgZCA9IG5ldyBEYXRlKGAke2RhdGV9VDAwOjAwOjAwWmApOwogIGQuc2V0VVRD
RGF0ZShkLmdldFVUQ0RhdGUoKSAtIDEpOwogIHJldHVybiBkLnRvSVNPU3RyaW5nKCkuc2xpY2Uo
MCwgMTApOwp9CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZVZlaGljbGVEb20oewogIHZp
biwKICBkYXRlLAogIGh0bWwsCiAgcHJpY2UgPSBudWxsLAogIHllc3RlcmRheVByaWNlID0gbnVs
bCwKICBpc05ldyA9IGZhbHNlLAogIGlzU29sZCA9IGZhbHNlLAogIGN3ZCA9IHByb2Nlc3MuY3dk
KCksCiAgaW5kZXggPSBudWxsLAp9ID0ge30pIHsKICBpZiAoIXZpbiB8fCAhZGF0ZSkgcmV0dXJu
IG51bGw7CiAgY29uc3Qga2V5ID0gU3RyaW5nKHZpbikudG9VcHBlckNhc2UoKTsKICBjb25zdCBp
ZHggPSBpbmRleCB8fCBhd2FpdCBsb2FkRG9tSW5kZXgoY3dkKTsKICBpZiAoIWlkeFtrZXldKSBp
ZHhba2V5XSA9IHt9OwoKICBjb25zdCBjb21wYWN0ID0gZXh0cmFjdFZlaGljbGVEb20oaHRtbCwg
a2V5KTsKICBjb25zdCBoYXNoID0gaGFzaERvbShjb21wYWN0KTsKICBjb25zdCB5ZGF5ID0gcHJl
dmlvdXNEYXRlKGRhdGUpOwogIGNvbnN0IHlSZWMgPSBpZHhba2V5XVt5ZGF5XTsKICBjb25zdCBo
YXNoVW5jaGFuZ2VkID0gQm9vbGVhbih5UmVjICYmIHlSZWMuaGFzaCA9PT0gaGFzaCk7CiAgY29u
c3QgeyBwcmljZUNoYW5nZVR5cGUsIG9sZFByaWNlLCBwcmljZURpZmYgfSA9IHByaWNlQ2hhbmdl
VnNZZXN0ZXJkYXkoewogICAgdG9kYXlQcmljZTogcHJpY2UsCiAgICB5ZXN0ZXJkYXlQcmljZTog
eWVzdGVyZGF5UHJpY2UgPz8geVJlYz8ucHJpY2UgPz8gbnVsbCwKICAgIGlzTmV3OiBpc05ldyB8
fCAheVJlYywKICAgIGlzU29sZCwKICB9KTsKCiAgbGV0IGJsb2JTdG9yZWQgPSBmYWxzZTsKICBp
ZiAoIWhhc2hVbmNoYW5nZWQgJiYgIWlzU29sZCAmJiBjb21wYWN0KSB7CiAgICBjb25zdCBkZXN0
ID0gYmxvYlBhdGgoa2V5LCBkYXRlLCBjd2QpOwogICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJu
YW1lKGRlc3QpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTsKICAgIGF3YWl0IGZzLndyaXRlRmlsZShk
ZXN0LCBhd2FpdCBnemlwKEJ1ZmZlci5mcm9tKGNvbXBhY3QsICd1dGY4JykpKTsKICAgIGJsb2JT
dG9yZWQgPSB0cnVlOwogIH0KCiAgaWR4W2tleV1bZGF0ZV0gPSB7CiAgICBoYXNoLAogICAgcHJp
Y2U6IHByaWNlID8/IG51bGwsCiAgICBvbGRQcmljZSwKICAgIHByaWNlRGlmZiwKICAgIHByaWNl
Q2hhbmdlVHlwZSwKICAgIGJsb2JTdG9yZWQsCiAgICBoYXNoVW5jaGFuZ2VkLAogIH07CgogIGlm
ICghaW5kZXgpIGF3YWl0IHNhdmVEb21JbmRleChpZHgsIGN3ZCk7CiAgcmV0dXJuIGlkeFtrZXld
W2RhdGVdOwp9CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb3JkU29sZERvbSh7CiAgdmluLAog
IGRhdGUsCiAgeWVzdGVyZGF5UHJpY2UgPSBudWxsLAogIGN3ZCA9IHByb2Nlc3MuY3dkKCksCiAg
aW5kZXggPSBudWxsLAp9ID0ge30pIHsKICBpZiAoIXZpbiB8fCAhZGF0ZSkgcmV0dXJuIG51bGw7
CiAgY29uc3Qga2V5ID0gU3RyaW5nKHZpbikudG9VcHBlckNhc2UoKTsKICBjb25zdCBpZHggPSBp
bmRleCB8fCBhd2FpdCBsb2FkRG9tSW5kZXgoY3dkKTsKICBpZiAoIWlkeFtrZXldKSBpZHhba2V5
XSA9IHt9OwogIGNvbnN0IHlkYXkgPSBwcmV2aW91c0RhdGUoZGF0ZSk7CiAgY29uc3QgeVJlYyA9
IGlkeFtrZXldW3lkYXldOwogIGlkeFtrZXldW2RhdGVdID0gewogICAgaGFzaDogeVJlYz8uaGFz
aCB8fCBudWxsLAogICAgcHJpY2U6IG51bGwsCiAgICBvbGRQcmljZTogeWVzdGVyZGF5UHJpY2Ug
Pz8geVJlYz8ucHJpY2UgPz8gbnVsbCwKICAgIHByaWNlRGlmZjogMCwKICAgIHByaWNlQ2hhbmdl
VHlwZTogJ1NPTEQnLAogICAgYmxvYlN0b3JlZDogZmFsc2UsCiAgICBoYXNoVW5jaGFuZ2VkOiB0
cnVlLAogIH07CiAgaWYgKCFpbmRleCkgYXdhaXQgc2F2ZURvbUluZGV4KGlkeCwgY3dkKTsKICBy
ZXR1cm4gaWR4W2tleV1bZGF0ZV07Cn0KCmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkRG9tQmxv
Yih2aW4sIGRhdGUsIGN3ZCA9IHByb2Nlc3MuY3dkKCkpIHsKICBjb25zdCBidWYgPSBhd2FpdCBm
cy5yZWFkRmlsZShibG9iUGF0aCh2aW4sIGRhdGUsIGN3ZCkpOwogIHJldHVybiAoYXdhaXQgZ3Vu
emlwKGJ1ZikpLnRvU3RyaW5nKCd1dGY4Jyk7Cn0KCmV4cG9ydCBmdW5jdGlvbiBmbGF0dGVuRG9t
SW5kZXgoaW5kZXgpIHsKICBjb25zdCByb3dzID0gW107CiAgZm9yIChjb25zdCBbdmluLCBkYXRl
c10gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXggfHwge30pKSB7CiAgICBmb3IgKGNvbnN0IFtzbmFw
c2hvdERhdGUsIHJlY10gb2YgT2JqZWN0LmVudHJpZXMoZGF0ZXMgfHwge30pKSB7CiAgICAgIHJv
d3MucHVzaCh7IHZpbiwgc25hcHNob3REYXRlLCAuLi5yZWMgfSk7CiAgICB9CiAgfQogIHJldHVy
biByb3dzOwp9CgovLyBgdG9kYXlgIGRlZmF1bHRzIHRvIHRoZSBFYXN0ZXJuIGNhbGVuZGFyIGRh
dGUgKGV2ZXJ5IHJlYWwgY2FsbGVyIGluIHRoaXMKLy8gcGlwZWxpbmUgcGFzc2VzIGl0IGV4cGxp
Y2l0bHkgYW55d2F5IOKAlCBzZWUgc3RhbmRhbG9uZS5qcydzIHRvZGF5RGF0ZSDigJQKLy8gYnV0
IHRoZSBkZWZhdWx0IG1hdHRlcnMgZm9yIGRpcmVjdC9hZC1ob2MgaW52b2NhdGlvbnMgYW5kIG11
c3QgYWdyZWUKLy8gd2l0aCB0aGUgcmVzdCBvZiB0aGUgcGlwZWxpbmUncyBkYXRlIGJ1Y2tldGlu
Zywgbm90IHNpbGVudGx5IGZhbGwgYmFjawovLyB0byBVVEMpLgpleHBvcnQgYXN5bmMgZnVuY3Rp
b24gcHJ1bmVEb21CbG9icyh7IHJldGFpbkRheXMgPSBET01fUkVUQUlOX0RBWVMsIHRvZGF5ID0g
ZWFzdGVybkRhdGVTdGFtcCgpLCBjd2QgPSBwcm9jZXNzLmN3ZCgpIH0gPSB7fSkgewogIGNvbnN0
IGN1dG9mZiA9IG5ldyBEYXRlKGAke3RvZGF5fVQwMDowMDowMFpgKTsKICBjdXRvZmYuc2V0VVRD
RGF0ZShjdXRvZmYuZ2V0VVRDRGF0ZSgpIC0gcmV0YWluRGF5cyk7CiAgY29uc3QgY3V0b2ZmU3Ry
ID0gY3V0b2ZmLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApOwogIGNvbnN0IHsgYmxvYnNEaXIg
fSA9IGRvbVBhdGhzKGN3ZCk7CiAgbGV0IHJlbW92ZWQgPSAwOwogIGxldCB2aW5EaXJzOwogIHRy
eSB7CiAgICB2aW5EaXJzID0gYXdhaXQgZnMucmVhZGRpcihibG9ic0Rpcik7CiAgfSBjYXRjaCB7
CiAgICByZXR1cm4geyByZW1vdmVkOiAwLCBjdXRvZmY6IGN1dG9mZlN0ciB9OwogIH0KICBmb3Ig
KGNvbnN0IHZpbiBvZiB2aW5EaXJzKSB7CiAgICBjb25zdCBkaXIgPSBwYXRoLmpvaW4oYmxvYnNE
aXIsIHZpbik7CiAgICBsZXQgZmlsZXM7CiAgICB0cnkgewogICAgICBmaWxlcyA9IGF3YWl0IGZz
LnJlYWRkaXIoZGlyKTsKICAgIH0gY2F0Y2ggewogICAgICBjb250aW51ZTsKICAgIH0KICAgIGZv
ciAoY29uc3QgZmlsZSBvZiBmaWxlcykgewogICAgICBjb25zdCBtID0gZmlsZS5tYXRjaCgvXihc
ZHs0fS1cZHsyfS1cZHsyfSlcLmh0bWxcLmd6JC8pOwogICAgICBpZiAoIW0pIGNvbnRpbnVlOwog
ICAgICBpZiAobVsxXSA8IGN1dG9mZlN0cikgewogICAgICAgIGF3YWl0IGZzLnVubGluayhwYXRo
LmpvaW4oZGlyLCBmaWxlKSkuY2F0Y2goKCkgPT4ge30pOwogICAgICAgIHJlbW92ZWQrKzsKICAg
ICAgfQogICAgfQogIH0KICByZXR1cm4geyByZW1vdmVkLCBjdXRvZmY6IGN1dG9mZlN0ciB9Owp9
Cg==
DSEOF
}
emit_ds > "$W/dom_store.js.new" || fail "cannot decode the embedded dom_store.js"
[ "$(md5of "$W/dom_store.js.new")" = "$DS_AFTER" ] || fail "embedded dom_store.js does not match its pinned md5 (corrupt package)"

# Trial on COPIES: the new dom_store.js beside the box's own bigJson.js / price_diff.js / date_utils.js, in the temp dir. The real data/ is never opened.
cp "$W/dom_store.js.new" "$W/src/dom_store.js"; cp "$BJ" "$W/src/bigJson.js"; cp "$SRC/price_diff.js" "$W/src/price_diff.js"; cp "$SRC/date_utils.js" "$W/src/date_utils.js"
[ -f "$C/package.json" ] && cp "$C/package.json" "$W/package.json"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'domsave-trial-data-'));
try {
  const idx = {}; for (let v = 0; v < 5000; v++) idx['V' + v] = { '2026-11-01': { hash: 'h' + v, price: v, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false }, '2026-11-02': { hash: 'h' + v, price: v + 1, oldPrice: v, priceDiff: 1, priceChangeType: 'UP', blobStored: false, hashUnchanged: true } };
  await Promise.all([saveDomIndex(idx, cwd), saveDomIndex(idx, cwd)]);
  const raw = await fs.readFile(domPaths(cwd).indexPath, 'utf8');
  if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(idx)) throw new Error('whole-file JSON.parse does not give the index back');
  if (JSON.stringify(await loadDomIndex(cwd)) !== JSON.stringify(idx)) throw new Error('loadDomIndex does not give the index back');
  const left = (await fs.readdir(domPaths(cwd).dataDir)).filter((n) => n !== 'dom_index.json');
  if (left.length) throw new Error('leftover files: ' + left.join(','));
  if (JSON.stringify(await loadDomIndex(await fs.mkdtemp(path.join(os.tmpdir(), 'domsave-trial-empty-')))) !== '{}') throw new Error('a missing index must load as {}');
  const bad = domPaths(cwd).indexPath; await fs.writeFile(bad, '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026'); // malformed: must throw and stay as it is
  let threw = false; try { await loadDomIndex(cwd, { retryDelayMs: 1 }); } catch (e) { threw = e.code === 'DOM_INDEX_UNREADABLE'; }
  if (!threw) throw new Error('a malformed index must make the load throw (fail closed)');
  if ((await fs.readFile(bad, 'utf8')) !== '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026') throw new Error('the malformed index was modified');
  console.log('trial ok: 5000 VINs saved twice (overlapping), reloaded identical, no temp files left; missing index -> {}, malformed index -> throws and is left untouched');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "trial on copies failed"
echo "check ok: dom_store.js $ds -> $DS_AFTER (bigJson.js, heapGuard.js as pinned; data/dom_index.json not touched)"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$DS" "$BK/dom_store.js.before" && echo "$ds  dom_store.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/dom_store.js.before")" = "$ds" ] || fail "backup copy does not match"
cp "$W/dom_store.js.new" "$DS.new" && mv -f "$DS.new" "$DS"
if [ "$(md5of "$DS")" != "$DS_AFTER" ] || ! ( cd "$C" && node -e "import('./src/dom_store.js').then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/dom_store.js.before" "$DS.rb" && mv -f "$DS.rb" "$DS"; fail "installed file failed verification; restored the original ($(md5of "$DS"))"
fi
echo "installed: dom_store.js $(md5of "$DS"); backup $BK"
