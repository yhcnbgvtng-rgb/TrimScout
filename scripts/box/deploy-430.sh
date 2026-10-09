#!/usr/bin/env bash
# PR #430 (+ #429) box pre-flight: READ-ONLY anchor checks. Prints PASS / FAIL per anchor and changes nothing.
#
# The box copies of deals_api_server.js and auth_api_server.js have drifted from the repo, so the audit
# harness patch can't be a file copy. Every edit the patch makes is described in
# deploy-430.anchors.json as { id, file, old, new }, where `old` is the exact text (with just enough
# surrounding lines to be unique) as it stands BEFORE the patch. For each anchor this prints:
#   PASS             `old` occurs exactly once in the box file: the patch can be anchored here
#   PASS (applied)   `new` is already there: this edit is already in
#   FAIL             neither, or `old` is ambiguous: the box text has drifted; patch this one by hand
# Exit status is 0 only if there are no FAILs. It never writes, copies, restarts or connects anywhere.
#
# On the box (reads only):
#   curl -fsSL -O https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/deploy-430.sh
#   curl -fsSL -O https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/deploy-430.anchors.json
#   bash deploy-430.sh
# Override the paths if the layout differs:
#   DEALS_FILE=/opt/trimscout-deals/src/deals_api_server.js AUTH_FILE=/opt/trimscout-auth/src/auth_api_server.js bash deploy-430.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEALS_FILE="${DEALS_FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
export AUTH_FILE="${AUTH_FILE:-/opt/trimscout-auth/src/auth_api_server.js}"
export ANCHORS="${ANCHORS:-$HERE/deploy-430.anchors.json}"

python3 - <<'PY'
import json, os, sys
files = {"deals": os.environ["DEALS_FILE"], "auth": os.environ["AUTH_FILE"]}
anchors = json.load(open(os.environ["ANCHORS"]))
texts, fails, applied, bad = {}, 0, 0, 0
for key, path in files.items():
    try:
        texts[key] = open(path, encoding="utf-8").read()
        print(f"file  {key:<5} {path}  ({len(texts[key])} bytes)")
    except OSError as e:
        texts[key] = None
        print(f"FAIL  {key:<5} cannot read {path}: {e}")
        fails += 1
for a in anchors:
    s = texts.get(a["file"])
    if s is None:
        print(f"FAIL  {a['id']}  (file unreadable)")
        bad += 1
        continue
    if a["new"] in s:
        print(f"PASS (applied)  {a['id']}")
        applied += 1
    else:
        n = s.count(a["old"])
        if n == 1:
            print(f"PASS  {a['id']}")
        else:
            first = a["old"].strip().splitlines()[0][:90]
            print(f"FAIL  {a['id']}  old text found {n}x (need exactly 1): {first}")
            fails += 1
            bad += 1
total = len(anchors)
print(f"\n{total - bad}/{total} anchors ok ({applied} already applied), {bad} FAIL" + (" (plus unreadable file)" if fails > bad else ""))
print("Read-only check: no files were changed.")
sys.exit(1 if fails else 0)
PY
