#!/bin/bash
# bigJson.js "parse each element as it is read", for crawl boxes box1 (v2) and box5. ONE file: src/bigJson.js (replaced whole; pinned before/after md5).
# Why: readJsonStreaming kept the text of every element until end of file, then parsed. A load of a 600 MB dom_index.json peaked at 1206 MB heap, 658 MB after (synthetic, node 22).
# bigJson.js is shared: dom_store.js (dom_index.json), standalone.js (state shards, daily changes), enricher, vinCacheShared, inventory_shards, legacyShardSplit all call readJsonLarge.
#
# Prerequisites, each pinned by md5 and checked (this package does NOT rewrite the 2026-11-06 packages' pins; they pin the OLD bigJson.js and refuse once this one is applied):
#   #719 heapGuard.js 452ce895, #720 dom_store.js 541b78ff, #721 dom_index_delta.js c239bd77 + pid_lock.js c5356386, standalone.js 2e4ce13a (box1) or 88d56d15 (box5).
# Self-contained (new bigJson.js embedded as base64). Run ON the box from STDIN:
#
#   ssh box1 'bash -s -- check'    < install.sh     # READ-ONLY on the box's code: gates, md5s, then a trial on COPIES in a mktemp dir (removed on exit)
#   ssh box1 'bash -s -- apply'    < install.sh     # check, backup, install, verify; restores itself on any failure
#   ssh box1 'bash -s -- restore'  < install.sh     # put the backed-up bigJson.js back
#
# REFUSES (exit 1, nothing written) on: a crawl/sync running, 21:30-07:00 ET, any md5 that is not a known state, a prerequisite missing.
# Never touches data/, crontab, env or heap settings. No restart: the next crawl is a fresh Node process.
set -u
C=${BIGJSON_CRAWLER_DIR:-/home/ubuntu/nj-scraper/scrapers/lightsail-crawler}
BK=${BIGJSON_BACKUP:-/home/ubuntu/backups/bigjson-parse-20261107}
SRC=$C/src; BJ=$SRC/bigJson.js
BJ_BEFORE=650637d98c37bf861098821826b5d696; BJ_AFTER=aa8686b14e06926567c73ab521fabca9
HG_MD5=452ce895cc5c82e86ae2b7b26a86ca48; DS_MD5=541b78ff568d0d11b740e1e67a8ba06c; DD_MD5=c239bd77b63394bea9b2e6ed365e3f48; PL_MD5=c535638661e29ecce3c964591775bc11
SA_B1=2e4ce13a348e931d264c86e9d1ac1b64; SA_B5=88d56d156968ae2081c0cedf1a3c0642

fail() { echo "REFUSED: $*" >&2; exit 1; }
md5of() { md5sum "$1" | cut -d' ' -f1; }
MODE=${1:-check}

if [ "$MODE" = restore ]; then
  [ -f "$BK/md5s-before.txt" ] || fail "no backup at $BK"
  want=$(awk '$2=="bigJson.js"{print $1}' "$BK/md5s-before.txt"); [ "$(md5of "$BK/bigJson.js.before")" = "$want" ] || fail "backup does not match its recorded md5"
  cp -p "$BK/bigJson.js.before" "$BJ.rb" && mv -f "$BJ.rb" "$BJ"
  echo "restored: bigJson.js $(md5of "$BJ")"; exit 0
fi
[ "$MODE" = check ] || [ "$MODE" = apply ] || fail "mode must be check, apply or restore (got '$MODE')"

now=$(TZ=America/New_York date +%H%M)
if [ $((10#$now)) -ge 2130 ] || [ $((10#$now)) -lt 700 ]; then fail "it is $now ET: installs only 07:00-21:30 ET (crons start at 22:00)"; fi
busy=$( { pgrep -a -x node | grep -E 'src/standalone|inventory-sync|run-daily-crawl'; pgrep -af '^(/bin/|/usr/bin/)?bash [^ ]*(run-daily-crawl|run_nightly_chain|run_sync_when_safe)'; } 2>/dev/null | grep -v pgrep )
[ -z "$busy" ] || fail "a crawl or sync is running: $busy"
for f in "$BJ" "$SRC/heapGuard.js" "$SRC/dom_store.js" "$SRC/dom_index_delta.js" "$SRC/pid_lock.js" "$SRC/price_diff.js" "$SRC/date_utils.js" "$SRC/standalone.js"; do [ -f "$f" ] || fail "$f not found (wrong box or path, or #719/#720/#721 not installed)"; done
[ "$(md5of "$SRC/heapGuard.js")" = "$HG_MD5" ] || fail "heapGuard.js md5 is not the #719 file"
[ "$(md5of "$SRC/dom_store.js")" = "$DS_MD5" ] || fail "dom_store.js md5 is not the #720 file"
[ "$(md5of "$SRC/dom_index_delta.js")" = "$DD_MD5" ] || fail "dom_index_delta.js md5 is not the #721 file"
[ "$(md5of "$SRC/pid_lock.js")" = "$PL_MD5" ] || fail "pid_lock.js md5 is not the pinned $PL_MD5"
sa=$(md5of "$SRC/standalone.js"); [ "$sa" = "$SA_B1" ] || [ "$sa" = "$SA_B5" ] || fail "standalone.js md5 $sa is not the post-#721 file of box1 ($SA_B1) or box5 ($SA_B5)"
bj=$(md5of "$BJ")
if [ "$bj" = "$BJ_AFTER" ]; then echo "ALREADY INSTALLED (bigJson.js $bj), nothing to do."; exit 0; fi
[ "$bj" = "$BJ_BEFORE" ] || fail "bigJson.js md5 $bj is not a known state ($BJ_BEFORE before / $BJ_AFTER after). Send the file back; do not improvise."

W=$(mktemp -d /tmp/bigjson-trial.XXXXXX) || fail "cannot make a temp dir"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
emit_bj() { base64 -d <<'BJEOF'
Ly8gUmVhZCBhbmQgd3JpdGUgdGhlIGNyYXdsZXIncyBiaWcgSlNPTiBkYXRhIGZpbGVzIHdpdGhv
dXQgZXZlciBidWlsZGluZyBvbmUgZ2lhbnQgc3RyaW5nLgovLwovLyBXaHk6IFY4IHJlZnVzZXMg
dG8gYnVpbGQgYSBzdHJpbmcgbG9uZ2VyIHRoYW4gfjUxMiBNQiAoIkludmFsaWQgc3RyaW5nIGxl
bmd0aCIpLiBUaGUgcGVyLXN0YXRlIGRhdGEgZmlsZXMgdGhlCi8vIGNyYXdsIGtlZXBzIChkYXRh
L2ludmVudG9yeS88U1Q+Lmpzb24sIGRhdGEvc25hcHNob3RzLzxTVD4uanNvbiwgZGF0YS9lbnJp
Y2hlZF9jYWNoZS88U1Q+Lmpzb24sIHRoZSBkYXkncwovLyBkYWlseV9jaGFuZ2VzIGZpbGUpIHVz
ZWQgdG8gYmUgd3JpdHRlbiB3aXRoIEpTT04uc3RyaW5naWZ5KHdob2xlVGhpbmcsIG51bGwsIDIp
IGFuZCByZWFkIHdpdGgKLy8gSlNPTi5wYXJzZShhd2FpdCBmcy5yZWFkRmlsZSguLi4pKSDigJQg
b25lIHN0cmluZyBob2xkaW5nIHRoZSBlbnRpcmUgZmlsZSwgYW5kIHByZXR0eS1wcmludGVkIG9u
IHRvcCwgd2hpY2ggbWFrZXMKLy8gaXQgMi0zeCBiaWdnZXIgdGhhbiB0aGUgZGF0YS4gQSBsYXJn
ZSBzdGF0ZSdzIHNoYXJkIChUWCwgRkwsIC4uLikgY2FuIGNyb3NzIHRoZSBsaW1pdCwgYW5kIHRo
ZSBicmFuZCdzIHJ1biB0aGVuCi8vIGRpZXMgaW5zaWRlIHRoZSBtZXJnZS9wZXJzaXN0IHN0ZXAg
aW5zdGVhZCBvZiBmaW5pc2hpbmcuCi8vCi8vIFdoYXQgdGhpcyBkb2VzIGluc3RlYWQ6Ci8vICAg
d3JpdGUgIOKAlCB3YWxrcyB0aGUgdG9wLWxldmVsIGFycmF5L29iamVjdCBhbmQgd3JpdGVzIE9O
RSBFTEVNRU5UIEFUIEEgVElNRSAoY29tcGFjdCBKU09OLCBvbmUgZWxlbWVudCBwZXIgbGluZSks
Ci8vICAgICAgICAgICAgaW50byBhIHRlbXAgZmlsZSB0aGF0IGlzIHJlbmFtZWQgb3ZlciB0aGUg
dGFyZ2V0IG9ubHkgd2hlbiBjb21wbGV0ZS4gVGhlIGJpZ2dlc3Qgc3RyaW5nIGV2ZXIgYnVpbHQg
aXMKLy8gICAgICAgICAgICBvbmUgcmVjb3JkIChwbHVzIGEgfjEgTUIgd3JpdGUgYnVmZmVyKS4g
VGhlIHJlbmFtZSBhbHNvIG1lYW5zIGEgcmVhZGVyICh0aGUgaW52ZW50b3J5IHN5bmMgcmVhZHMg
ZXZlcnkKLy8gICAgICAgICAgICAqLmpzb24gaW4gZGF0YS9pbnZlbnRvcnkpIG9yIGEgY3Jhc2gv
a2lsbCBzZWVzIGVpdGhlciB0aGUgb2xkIGNvbXBsZXRlIGZpbGUgb3IgdGhlIG5ldyBjb21wbGV0
ZSBmaWxlLAovLyAgICAgICAgICAgIG5ldmVyIGEgdHJ1bmNhdGVkIG9uZS4gVGVtcCBmaWxlcyBl
bmQgaW4gIi50bXAtPHBpZD4tPHRzPiIsIE5PVCAiLmpzb24iLCBzbyB0aGUgc3luYyBuZXZlciBw
aWNrcyBvbmUgdXAuCi8vICAgcmVhZCAgIOKAlCBzbWFsbCBmaWxlcyB0YWtlIHRoZSBvbGQgZmFz
dCBwYXRoIChKU09OLnBhcnNlIG9mIHRoZSB3aG9sZSB0ZXh0LCBzYW1lIHJlc3VsdCBhcyBiZWZv
cmUpLiBGaWxlcyBhYm92ZQovLyAgICAgICAgICAgIFNUUkVBTV9BQk9WRV9CWVRFUyBhcmUgcGFy
c2VkIGJ5IHNwbGl0dGluZyB0aGUgdG9wLWxldmVsIGFycmF5L29iamVjdCBpbnRvIGVsZW1lbnRz
IGFuZCBwYXJzaW5nIGVhY2ggb25lLAovLyAgICAgICAgICAgIHNvIG5vIHN0cmluZyBsYXJnZXIg
dGhhbiBvbmUgZWxlbWVudCBleGlzdHMuIE9sZCBwcmV0dHktcHJpbnRlZCBmaWxlcyBhbmQgbmV3
IGNvbXBhY3QgZmlsZXMgYm90aCByZWFkIGZpbmUuCi8vCi8vIExheW91dCBvZiB3aGF0IGlzIHdy
aXR0ZW4gaXMgc3RpbGwgYSB0b3AtbGV2ZWwgSlNPTiBhcnJheSAoaW52ZW50b3J5LCBzbmFwc2hv
dHMnIHJlY29yZHMpIG9yIG9iamVjdCAoc25hcHNob3QsCi8vIGNhY2hlLCBkYWlseV9jaGFuZ2Vz
KSDigJQgdGhlIHNhbWUgc2hhcGVzIGFzIGJlZm9yZSDigJQgc28gZXZlcnkgZXhpc3RpbmcgcmVh
ZGVyLCBpbmNsdWRpbmcgdGhlIGJveCdzIGludmVudG9yeS1zeW5jCi8vIChzY3JpcHRzL2JveC9p
bnZlbnRvcnktc3luYy5tanMgc3RyZWFtVG9wTGV2ZWxPYmplY3RzLCB3aGljaCB3YWxrcyB0b3At
bGV2ZWwgb2JqZWN0cyBvZiB0aGUgYXJyYXkpLCBrZWVwcyB3b3JraW5nCi8vIHdpdGggbm8gY2hh
bmdlLiBOb3RoaW5nIHRvIG1pZ3JhdGU6IHRoZSBmaXJzdCB3cml0ZSBvZiBlYWNoIGZpbGUgY29u
dmVydHMgaXQgdG8gdGhlIGNvbXBhY3QgbGF5b3V0LgppbXBvcnQgZnMgZnJvbSAnbm9kZTpmcyc7
CmltcG9ydCBmc3AgZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7CmltcG9ydCB7IFN0cmluZ0RlY29k
ZXIgfSBmcm9tICdub2RlOnN0cmluZ19kZWNvZGVyJzsKCmV4cG9ydCBjb25zdCBTVFJFQU1fQUJP
VkVfQllURVMgPSA2NCAqIDEwMjQgKiAxMDI0OyAvLyBiZWxvdyB0aGlzIHRoZSBwbGFpbiByZWFk
RmlsZSArIEpTT04ucGFyc2UgcGF0aCBpcyB1c2VkCmNvbnN0IFdSSVRFX0NIVU5LX0NIQVJTID0g
MSA8PCAyMDsgLy8gZmx1c2ggdGhlIHdyaXRlIGJ1ZmZlciBhdCBhYm91dCAxIE1CCgpjb25zdCBp
c1BsYWluQ29udGFpbmVyID0gKHYpID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09ICdvYmpl
Y3QnICYmICEodiBpbnN0YW5jZW9mIERhdGUpICYmIChBcnJheS5pc0FycmF5KHYpIHx8IE9iamVj
dC5nZXRQcm90b3R5cGVPZih2KSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBPYmplY3QuZ2V0UHJv
dG90eXBlT2YodikgPT09IG51bGwpOwoKZnVuY3Rpb24gc3RyaW5naWZ5RWxlbWVudCh2YWx1ZSwg
Y29udGV4dCkgewogIHRyeSB7CiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpOwogIH0g
Y2F0Y2ggKGVycikgewogICAgZXJyLm1lc3NhZ2UgPSBgJHtlcnIubWVzc2FnZX0gKHdoaWxlIHdy
aXRpbmcgJHtjb250ZXh0fSlgOwogICAgdGhyb3cgZXJyOwogIH0KfQoKLyoqCiAqIFdyaXRlIGB2
YWx1ZWAgdG8gYGZpbGVQYXRoYCBhcyBjb21wYWN0IEpTT04sIGVsZW1lbnQgYnkgZWxlbWVudCwg
YXRvbWljYWxseS4KICogQXJyYXlzIGFuZCBwbGFpbiBvYmplY3RzIGFyZSBzdHJlYW1lZDsgYW55
dGhpbmcgZWxzZSBpcyB3cml0dGVuIGFzIG9uZSBKU09OLnN0cmluZ2lmeS4KICogQHJldHVybnMg
e1Byb21pc2U8e2J5dGVzOiBudW1iZXJ9Pn0KICovCmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0
ZUpzb25MYXJnZShmaWxlUGF0aCwgdmFsdWUsIHsgY2h1bmtDaGFycyA9IFdSSVRFX0NIVU5LX0NI
QVJTIH0gPSB7fSkgewogIGNvbnN0IHRtcFBhdGggPSBgJHtmaWxlUGF0aH0udG1wLSR7cHJvY2Vz
cy5waWR9LSR7RGF0ZS5ub3coKX1gOwogIGNvbnN0IGhhbmRsZSA9IGF3YWl0IGZzcC5vcGVuKHRt
cFBhdGgsICd3Jyk7CiAgbGV0IGJ5dGVzID0gMDsKICBsZXQgYnVmID0gJyc7CiAgY29uc3QgZmx1
c2ggPSBhc3luYyAoKSA9PiB7CiAgICBpZiAoIWJ1ZikgcmV0dXJuOwogICAgY29uc3QgeyBieXRl
c1dyaXR0ZW4gfSA9IGF3YWl0IGhhbmRsZS53cml0ZShidWYpOwogICAgYnl0ZXMgKz0gYnl0ZXNX
cml0dGVuOwogICAgYnVmID0gJyc7CiAgfTsKICBjb25zdCBwdXNoID0gYXN5bmMgKHMpID0+IHsK
ICAgIGJ1ZiArPSBzOwogICAgaWYgKGJ1Zi5sZW5ndGggPj0gY2h1bmtDaGFycykgYXdhaXQgZmx1
c2goKTsKICB9OwogIHRyeSB7CiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHsKICAgICAg
YXdhaXQgcHVzaCgnWycpOwogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHZhbHVlLmxlbmd0aDsg
aSsrKSB7CiAgICAgICAgY29uc3QgcyA9IHN0cmluZ2lmeUVsZW1lbnQodmFsdWVbaV0sIGAke2Zp
bGVQYXRofVske2l9XWApOwogICAgICAgIGF3YWl0IHB1c2goKGkgPT09IDAgPyAnXG4nIDogJyxc
bicpICsgKHMgPT09IHVuZGVmaW5lZCA/ICdudWxsJyA6IHMpKTsKICAgICAgfQogICAgICBhd2Fp
dCBwdXNoKHZhbHVlLmxlbmd0aCA/ICdcbl1cbicgOiAnXVxuJyk7CiAgICB9IGVsc2UgaWYgKGlz
UGxhaW5Db250YWluZXIodmFsdWUpKSB7CiAgICAgIGF3YWl0IHB1c2goJ3snKTsKICAgICAgbGV0
IGZpcnN0ID0gdHJ1ZTsKICAgICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModmFsdWUp
KSB7CiAgICAgICAgY29uc3QgcyA9IHN0cmluZ2lmeUVsZW1lbnQodmFsdWVba2V5XSwgYCR7Zmls
ZVBhdGh9WyR7SlNPTi5zdHJpbmdpZnkoa2V5KX1dYCk7CiAgICAgICAgaWYgKHMgPT09IHVuZGVm
aW5lZCkgY29udGludWU7IC8vIHNhbWUgYXMgSlNPTi5zdHJpbmdpZnk6IHVuZGVmaW5lZC9mdW5j
dGlvbiB2YWx1ZXMgYXJlIG9taXR0ZWQKICAgICAgICBhd2FpdCBwdXNoKChmaXJzdCA/ICdcbicg
OiAnLFxuJykgKyBKU09OLnN0cmluZ2lmeShrZXkpICsgJzonICsgcyk7CiAgICAgICAgZmlyc3Qg
PSBmYWxzZTsKICAgICAgfQogICAgICBhd2FpdCBwdXNoKGZpcnN0ID8gJ31cbicgOiAnXG59XG4n
KTsKICAgIH0gZWxzZSB7CiAgICAgIGF3YWl0IHB1c2goKHN0cmluZ2lmeUVsZW1lbnQodmFsdWUs
IGZpbGVQYXRoKSA/PyAnbnVsbCcpICsgJ1xuJyk7CiAgICB9CiAgICBhd2FpdCBmbHVzaCgpOwog
ICAgYXdhaXQgaGFuZGxlLnN5bmMoKTsKICAgIGF3YWl0IGhhbmRsZS5jbG9zZSgpOwogICAgYXdh
aXQgZnNwLnJlbmFtZSh0bXBQYXRoLCBmaWxlUGF0aCk7CiAgICByZXR1cm4geyBieXRlcyB9Owog
IH0gY2F0Y2ggKGVycikgewogICAgdHJ5IHsgYXdhaXQgaGFuZGxlLmNsb3NlKCk7IH0gY2F0Y2gg
eyAvKiBhbHJlYWR5IGNsb3NlZCAqLyB9CiAgICBhd2FpdCBmc3Aucm0odG1wUGF0aCwgeyBmb3Jj
ZTogdHJ1ZSB9KS5jYXRjaCgoKSA9PiB7fSk7CiAgICB0aHJvdyBlcnI7CiAgfQp9CgovLyBTcGxp
dHMgYSBKU09OIHRleHQsIGFycml2aW5nIGFzIHN0cmluZyBjaHVua3MsIGludG8gaXRzIHRvcC1s
ZXZlbCBjb250YWluZXIncyBlbGVtZW50cyB3aXRob3V0IGhvbGRpbmcgbW9yZSB0aGFuCi8vIG9u
ZSBlbGVtZW50IGF0IGEgdGltZS4gQ2FsbHMgb25FbGVtZW50KHRleHQpIGZvciBlYWNoLiBSZXR1
cm5zICdhcnJheScgfCAnb2JqZWN0JyB8ICdzY2FsYXInLgpmdW5jdGlvbiBjcmVhdGVUb3BMZXZl
bFNwbGl0dGVyKG9uRWxlbWVudCkgewogIGxldCBraW5kID0gbnVsbDsgLy8gJ2FycmF5JyB8ICdv
YmplY3QnIHwgJ3NjYWxhcicKICBsZXQgZGVwdGggPSAwOwogIGxldCBpblN0ciA9IGZhbHNlOwog
IGxldCBlc2MgPSBmYWxzZTsKICBsZXQgY3VyID0gJyc7CiAgbGV0IGRvbmUgPSBmYWxzZTsKICBj
b25zdCBlbWl0ID0gKCkgPT4gewogICAgY29uc3QgdCA9IGN1ci50cmltKCk7CiAgICBjdXIgPSAn
JzsKICAgIGlmICh0KSBvbkVsZW1lbnQodCwga2luZCk7CiAgfTsKICByZXR1cm4gewogICAgZmVl
ZChjaHVuaykgewogICAgICBsZXQgc2VnID0gMDsgLy8gc3RhcnQgb2YgdGhlIG5vdC15ZXQtY29w
aWVkIHBhcnQgb2YgdGhpcyBjaHVuawogICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNodW5rLmxl
bmd0aDsgaSsrKSB7CiAgICAgICAgY29uc3QgY2ggPSBjaHVuay5jaGFyQ29kZUF0KGkpOwogICAg
ICAgIGlmIChraW5kID09PSBudWxsKSB7CiAgICAgICAgICBpZiAoY2ggPT09IDB4MjAgfHwgY2gg
PT09IDB4MGEgfHwgY2ggPT09IDB4MGQgfHwgY2ggPT09IDB4MDkgfHwgY2ggPT09IDB4ZmVmZikg
eyBzZWcgPSBpICsgMTsgY29udGludWU7IH0KICAgICAgICAgIGtpbmQgPSBjaCA9PT0gMHg1YiA/
ICdhcnJheScgOiBjaCA9PT0gMHg3YiA/ICdvYmplY3QnIDogJ3NjYWxhcic7CiAgICAgICAgICBp
ZiAoa2luZCA9PT0gJ3NjYWxhcicpIHsgc2VnID0gaTsgfSBlbHNlIHsgc2VnID0gaSArIDE7IH0K
ICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBpZiAoa2luZCA9PT0gJ3NjYWxh
cicpIGNvbnRpbnVlOyAvLyBhY2N1bXVsYXRlZCBhdCB0aGUgZW5kIG9mIHRoZSBjaHVuawogICAg
ICAgIGlmIChkb25lKSBjb250aW51ZTsKICAgICAgICBpZiAoaW5TdHIpIHsKICAgICAgICAgIGlm
IChlc2MpIGVzYyA9IGZhbHNlOwogICAgICAgICAgZWxzZSBpZiAoY2ggPT09IDB4NWMpIGVzYyA9
IHRydWU7CiAgICAgICAgICBlbHNlIGlmIChjaCA9PT0gMHgyMikgaW5TdHIgPSBmYWxzZTsKICAg
ICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBpZiAoY2ggPT09IDB4MjIpIHsgaW5T
dHIgPSB0cnVlOyBjb250aW51ZTsgfQogICAgICAgIGlmIChjaCA9PT0gMHg3YiB8fCBjaCA9PT0g
MHg1YikgeyBkZXB0aCsrOyBjb250aW51ZTsgfQogICAgICAgIGlmIChjaCA9PT0gMHg3ZCB8fCBj
aCA9PT0gMHg1ZCkgewogICAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7IC8vIHRoZSBjbG9zaW5n
IGJyYWNrZXQgb2YgdGhlIHRvcC1sZXZlbCBjb250YWluZXIKICAgICAgICAgICAgY3VyICs9IGNo
dW5rLnNsaWNlKHNlZywgaSk7CiAgICAgICAgICAgIGVtaXQoKTsKICAgICAgICAgICAgZG9uZSA9
IHRydWU7CiAgICAgICAgICAgIHNlZyA9IGkgKyAxOwogICAgICAgICAgICBjb250aW51ZTsKICAg
ICAgICAgIH0KICAgICAgICAgIGRlcHRoLS07CiAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9
CiAgICAgICAgaWYgKGNoID09PSAweDJjICYmIGRlcHRoID09PSAwKSB7IC8vIGEgY29tbWEgYmV0
d2VlbiB0b3AtbGV2ZWwgZWxlbWVudHMKICAgICAgICAgIGN1ciArPSBjaHVuay5zbGljZShzZWcs
IGkpOwogICAgICAgICAgZW1pdCgpOwogICAgICAgICAgc2VnID0gaSArIDE7CiAgICAgICAgfQog
ICAgICB9CiAgICAgIGlmICghZG9uZSAmJiBraW5kICE9PSBudWxsKSBjdXIgKz0gY2h1bmsuc2xp
Y2Uoc2VnKTsKICAgIH0sCiAgICBmaW5pc2goKSB7CiAgICAgIGlmIChraW5kID09PSAnc2NhbGFy
JykgeyBlbWl0KCk7IHJldHVybiBraW5kOyB9CiAgICAgIGlmIChraW5kID09PSBudWxsKSB0aHJv
dyBuZXcgRXJyb3IoJ2VtcHR5IEpTT04gZmlsZScpOwogICAgICBpZiAoIWRvbmUpIHRocm93IG5l
dyBFcnJvcihgdW50ZXJtaW5hdGVkIEpTT04gJHtraW5kfSAoZmlsZSBpcyB0cnVuY2F0ZWQgb3Ig
Y29ycnVwdClgKTsKICAgICAgcmV0dXJuIGtpbmQ7CiAgICB9LAogIH07Cn0KCmFzeW5jIGZ1bmN0
aW9uIHJlYWRKc29uU3RyZWFtaW5nKGZpbGVQYXRoLCB7IGNodW5rQnl0ZXMgfSkgewogIC8vIEVh
Y2ggZWxlbWVudCBpcyBwYXJzZWQgdGhlIG1vbWVudCB0aGUgc3BsaXR0ZXIgZW1pdHMgaXQgYW5k
IGl0cyB0ZXh0IGlzIGRyb3BwZWQsIHNvIHRoZSBwZWFrIGlzIHRoZSBwYXJzZWQgZGF0YSBwbHVz
IG9uZSBlbGVtZW50IHBsdXMgb25lIGNodW5rLiAoQ29sbGVjdGluZwogIC8vIGV2ZXJ5IGVsZW1l
bnQncyB0ZXh0IGZpcnN0IGFuZCBwYXJzaW5nIGFmdGVyd2FyZHMga2VwdCBhIHNlY29uZCBjb3B5
IG9mIHRoZSB3aG9sZSBmaWxlLCBhcyBtYW55IHNtYWxsIHN0cmluZ3MsIGFsaXZlIG5leHQgdG8g
dGhlIHBhcnNlZCBkYXRhOiBhIHRyYW5zaWVudCBvZgogIC8vIGFib3V0IHRoZSBmaWxlIHNpemUg
b24gdG9wIG9mIHRoZSBpbmRleCwgbWVhc3VyZWQgMS4yIEdCIHBlYWsgaGVhcCBsb2FkaW5nIGEg
NjAwIE1CIGluZGV4LikgQSBtYWxmb3JtZWQgZWxlbWVudCB0aHJvd3MgZnJvbSBpbnNpZGUgZmVl
ZCgpLCB3aGljaCBkZXN0cm95cyB0aGUKICAvLyBzdHJlYW0gYW5kIHJlamVjdHMgd2l0aCB0aGUg
c2FtZSBTeW50YXhFcnJvciB0aGUgdHdvLXBhc3MgdmVyc2lvbiByYWlzZWQuCiAgbGV0IGFyciA9
IG51bGwsIG9iaiA9IG51bGwsIHNjYWxhclRleHQgPSBudWxsOwogIGNvbnN0IHNwbGl0dGVyID0g
Y3JlYXRlVG9wTGV2ZWxTcGxpdHRlcigodCwga2luZCkgPT4gewogICAgaWYgKGtpbmQgPT09ICdh
cnJheScpIHsgKGFyciB8fCAoYXJyID0gW10pKS5wdXNoKEpTT04ucGFyc2UodCkpOyByZXR1cm47
IH0KICAgIGlmIChraW5kID09PSAnb2JqZWN0JykgewogICAgICBjb25zdCBlbnRyeSA9IEpTT04u
cGFyc2UoYHske3R9fWApOwogICAgICBjb25zdCBvdXQgPSBvYmogfHwgKG9iaiA9IHt9KTsKICAg
ICAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGVudHJ5KSkgT2JqZWN0LmRlZmluZVByb3Bl
cnR5KG91dCwgaywgeyB2YWx1ZTogZW50cnlba10sIGVudW1lcmFibGU6IHRydWUsIHdyaXRhYmxl
OiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUgfSk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHNj
YWxhclRleHQgPSB0OwogIH0pOwogIGNvbnN0IGRlY29kZXIgPSBuZXcgU3RyaW5nRGVjb2Rlcign
dXRmOCcpOwogIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgIGNv
bnN0IHN0cmVhbSA9IGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgsIHsgaGlnaFdhdGVyTWFy
azogY2h1bmtCeXRlcyB9KTsKICAgIHN0cmVhbS5vbignZGF0YScsIChidWYpID0+IHsgdHJ5IHsg
c3BsaXR0ZXIuZmVlZChkZWNvZGVyLndyaXRlKGJ1ZikpOyB9IGNhdGNoIChlKSB7IHN0cmVhbS5k
ZXN0cm95KGUpOyB9IH0pOwogICAgc3RyZWFtLm9uKCdlbmQnLCAoKSA9PiB7IHRyeSB7IHNwbGl0
dGVyLmZlZWQoZGVjb2Rlci5lbmQoKSk7IHJlc29sdmUoKTsgfSBjYXRjaCAoZSkgeyByZWplY3Qo
ZSk7IH0gfSk7CiAgICBzdHJlYW0ub24oJ2Vycm9yJywgcmVqZWN0KTsKICB9KTsKICBjb25zdCBr
aW5kID0gc3BsaXR0ZXIuZmluaXNoKCk7CiAgaWYgKGtpbmQgPT09ICdhcnJheScpIHJldHVybiBh
cnIgfHwgW107CiAgaWYgKGtpbmQgPT09ICdvYmplY3QnKSByZXR1cm4gb2JqIHx8IHt9OwogIHJl
dHVybiBKU09OLnBhcnNlKHNjYWxhclRleHQpOwp9CgovKioKICogUmVhZCBhIEpTT04gZmlsZS4g
U2FtZSByZXN1bHQgYXMgSlNPTi5wYXJzZShhd2FpdCBmcy5yZWFkRmlsZShwYXRoLCAndXRmLTgn
KSksIGJ1dCBmaWxlcyBhYm92ZSBgc3RyZWFtQWJvdmVCeXRlc2AKICogYXJlIHBhcnNlZCBlbGVt
ZW50IGJ5IGVsZW1lbnQgc28gdGhlIGZpbGUgbmV2ZXIgaGFzIHRvIGZpdCBpbiBvbmUgVjggc3Ry
aW5nLiBUaHJvd3MgbGlrZSByZWFkRmlsZS9KU09OLnBhcnNlIGRvCiAqIChFTk9FTlQsIFN5bnRh
eEVycm9yKSBzbyBleGlzdGluZyB0cnkvY2F0Y2ggZmFsbGJhY2tzIGtlZXAgd29ya2luZy4KICov
CmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkSnNvbkxhcmdlKGZpbGVQYXRoLCB7IHN0cmVhbUFi
b3ZlQnl0ZXMgPSBTVFJFQU1fQUJPVkVfQllURVMsIGNodW5rQnl0ZXMgPSAxIDw8IDIwIH0gPSB7
fSkgewogIGNvbnN0IHsgc2l6ZSB9ID0gYXdhaXQgZnNwLnN0YXQoZmlsZVBhdGgpOwogIGlmIChz
aXplIDw9IHN0cmVhbUFib3ZlQnl0ZXMpIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGZzcC5yZWFk
RmlsZShmaWxlUGF0aCwgJ3V0Zi04JykpOwogIHJldHVybiByZWFkSnNvblN0cmVhbWluZyhmaWxl
UGF0aCwgeyBjaHVua0J5dGVzIH0pOwp9Cg==
BJEOF
}
emit_bj > "$W/bigJson.js.new" || fail "cannot decode the embedded bigJson.js"
[ "$(md5of "$W/bigJson.js.new")" = "$BJ_AFTER" ] || fail "embedded bigJson.js does not match its pinned md5 (corrupt package)"

# Trial on COPIES: the new bigJson.js beside the box's own dom_store / dom_index_delta / pid_lock / price_diff / date_utils, in the temp dir. The real data/ is never opened.
cp "$W/bigJson.js.new" "$W/src/bigJson.js"
for f in heapGuard.js dom_store.js dom_index_delta.js pid_lock.js price_diff.js date_utils.js; do cp "$SRC/$f" "$W/src/$f"; done
[ -f "$C/package.json" ] && cp "$C/package.json" "$W/package.json"
cat > "$W/src/trial.mjs" <<'TREOF'
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { readJsonLarge, writeJsonLarge } from './bigJson.js';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
import { prepareStreamMerge } from './dom_index_delta.js';
const S = { streamAboveBytes: 0, chunkBytes: 7 };
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'bigjson-trial-data-'));
const rec = (v, d) => ({ hash: 'h' + v, price: v + d, oldPrice: null, priceDiff: 0, priceChangeType: 'NEW', blobStored: true, hashUnchanged: false });
try {
  // 1. same results as JSON.parse for object / array / scalar / empty / duplicate keys, with tiny chunks so entries straddle chunk edges
  const cases = { '{}': {}, '[]': [], '  {\n}\n': {}, '42': 42, '"x"': 'x', '{"A":1,"B":2,"A":3}': { A: 3, B: 2 }, '[{"a":"b,c}"},[1,2],"]"]': [{ a: 'b,c}' }, [1, 2], ']'] };
  for (const [text, want] of Object.entries(cases)) { const f = path.join(cwd, 'c.json'); await fs.writeFile(f, text); if (JSON.stringify(await readJsonLarge(f, S)) !== JSON.stringify(want)) throw new Error('readJsonLarge differs from JSON.parse for ' + text); }
  // 2. malformed / truncated input still throws and is not modified
  for (const text of ['{"A":{"x":1},"B":{"x":}}', '{"A":{"x":1},"B":{"2026', '', '[1,2', '{"A":1} junk']) {
    const f = path.join(cwd, 'bad.json'); await fs.writeFile(f, text);
    let threw = false; try { await readJsonLarge(f, S); } catch { threw = true; }
    if (!threw && text !== '{"A":1} junk') throw new Error('malformed input did not throw: ' + JSON.stringify(text));
    if ((await fs.readFile(f, 'utf8')) !== text) throw new Error('malformed file was modified');
  }
  // 3. dom_index save/load through the box's own dom_store.js (overlapping saves, missing -> {}, malformed -> fail closed and untouched)
  const idx = {}; for (let v = 0; v < 5000; v++) idx['V' + v] = { '2026-11-01': rec(v, 0), '2026-11-02': rec(v, 1) };
  await Promise.all([saveDomIndex(idx, cwd), saveDomIndex(idx, cwd)]);
  if (JSON.stringify(JSON.parse(await fs.readFile(domPaths(cwd).indexPath, 'utf8'))) !== JSON.stringify(idx)) throw new Error('whole-file JSON.parse does not give the index back');
  if (JSON.stringify(await loadDomIndex(cwd, { read: (f) => readJsonLarge(f, S) })) !== JSON.stringify(idx)) throw new Error('streamed loadDomIndex does not give the index back');
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigjson-trial-empty-'));
  try { if (JSON.stringify(await loadDomIndex(emptyDir)) !== '{}') throw new Error('a missing index must load as {}'); } finally { await fs.rm(emptyDir, { recursive: true, force: true }); }
  const bad = domPaths(cwd).indexPath; await fs.writeFile(bad, '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026');
  let threw = false; try { await loadDomIndex(cwd, { retryDelayMs: 1, read: (f) => readJsonLarge(f, S) }); } catch (e) { threw = e.code === 'DOM_INDEX_UNREADABLE'; }
  if (!threw) throw new Error('a malformed index must make the load throw (fail closed)');
  if ((await fs.readFile(bad, 'utf8')) !== '{"A":{"2026-11-01":{"hash":"h"}},"B":{"2026') throw new Error('the malformed index was modified');
  // 4. #721's streaming merge writes a temp file and verifies it (new VIN, existing VIN, one conflicting record), without renaming
  await saveDomIndex(idx, cwd);
  const m = await prepareStreamMerge(domPaths(cwd).indexPath, { V1: { '2026-11-03': rec(1, 9), '2026-11-02': { ...rec(1, 1), price: 1 } }, NEW1: { '2026-11-03': rec(9, 9) } });
  try { if (m.vinsOut !== 5001 || m.added < 2 || m.conflicts.length !== 1) throw new Error('merge trial gave vinsOut ' + m.vinsOut + ', added ' + m.added + ', conflicts ' + m.conflicts.length); } finally { await m.abort(); }
  const left = (await fs.readdir(domPaths(cwd).dataDir)).filter((n) => n !== 'dom_index.json');
  if (left.length) throw new Error('leftover files: ' + left.join(','));
  console.log('trial ok: readJsonLarge == JSON.parse on 7 shapes, 5 malformed inputs rejected and untouched, 5000-VIN save x2 / streamed load identical, missing -> {}, malformed -> fail closed, #721 stream merge + verify (1 conflict) ok, no temp files left');
} finally { await fs.rm(cwd, { recursive: true, force: true }); }
TREOF
( cd "$W" && node src/trial.mjs ) || fail "trial on copies failed"
echo "check ok: bigJson.js $bj -> $BJ_AFTER (#719 heapGuard, #720 dom_store, #721 dom_index_delta/pid_lock, standalone.js as pinned; data/ not touched)"
[ "$MODE" = check ] && exit 0

# apply
mkdir -p "$BK" || fail "cannot make $BK"
[ ! -e "$BK/md5s-before.txt" ] || fail "$BK already holds a backup; move it aside first"
cp -p "$BJ" "$BK/bigJson.js.before" && echo "$bj  bigJson.js" > "$BK/md5s-before.txt"
[ "$(md5of "$BK/bigJson.js.before")" = "$bj" ] || fail "backup copy does not match"
cp "$W/bigJson.js.new" "$BJ.new" && mv -f "$BJ.new" "$BJ"
if [ "$(md5of "$BJ")" != "$BJ_AFTER" ] || ! ( cd "$C" && node -e "Promise.all([import('./src/bigJson.js'),import('./src/dom_store.js'),import('./src/dom_index_delta.js')]).then(()=>process.exit(0),(e)=>{console.error(e);process.exit(1)})" ); then
  cp -p "$BK/bigJson.js.before" "$BJ.rb" && mv -f "$BJ.rb" "$BJ"; fail "installed file failed verification; restored the original ($(md5of "$BJ"))"
fi
echo "installed: bigJson.js $(md5of "$BJ"); backup $BK"
