#!/usr/bin/env bash
# Deals box: wire the Toyota + Ford model option policies into the nightly sync write path and the /api/inventory per-vehicle options list.
# Installs the files and patches deals_api_server.js. It does NOT restart deals-api and does NOT turn the policy on: the policy stays OFF until
# OPTION_MODEL_POLICY_PATH is set in deals-api's environment at the restart (docs/OPTION_POLICY_WRITE_PATH.md has the full sequence).
#
# DO NOT RUN until Paul says go, in an idle window (no crawl, no sync, sync lock free).
#
# What changes on the box (/opt/trimscout-deals/src):
#   factoryOptionAllowlist.js        replaced by the repo copy (the box has the OLD file: no model policies at all). inventoryOptionRows.js is
#                                    already identical to the repo; it is checked, not copied.
#   optionPolicies/*.json            new: toyota-rav4-2026, toyota-2026-2027, ford-2026
#   deals_api_server.js              3 anchored edits (the box copy differs from the repo's, so no whole-file copy): import line, the facet-row
#                                    derivation in handleInventoryBulk, options in inventoryRowFromDb. Each anchor must match exactly once or the
#                                    script stops before changing anything. Every replaced file gets a .bak.<timestamp> next to it.
#
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-11-option-policy-write-path.sh "$B/scripts/box/2026-10-11-option-policy-write-path.sh?cb=$(date +%s)" && bash 2026-10-11-option-policy-write-path.sh
# Test mode (no box needed): DIR=<copy of the box src> SRC_LOCAL=<repo scrapers/lightsail-crawler/src> bash 2026-10-11-option-policy-write-path.sh
set -euo pipefail
DIR=${DIR:-/opt/trimscout-deals/src}
B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src
TS=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
fetch() { # fetch <repo path under src> <dest>
  if [ -n "${SRC_LOCAL:-}" ]; then mkdir -p "$(dirname "$2")" && cp "$SRC_LOCAL/$1" "$2"; else mkdir -p "$(dirname "$2")" && curl -fsSL -o "$2" "$B/$1?cb=$(date +%s)"; fi
}

fetch factoryOptionAllowlist.js "$TMP/factoryOptionAllowlist.js"
fetch inventoryOptionRows.js "$TMP/inventoryOptionRows.js"
for p in toyota-rav4-2026 toyota-2026-2027 ford-2026; do fetch "optionPolicies/$p.json" "$TMP/optionPolicies/$p.json"; done
grep -q "export function policyFacetRows" "$TMP/factoryOptionAllowlist.js" || { echo "ERROR: fetched factoryOptionAllowlist.js lacks policyFacetRows (stale copy? merge not live yet?)" >&2; exit 1; }
cmp -s "$TMP/inventoryOptionRows.js" "$DIR/inventoryOptionRows.js" || { echo "ERROR: $DIR/inventoryOptionRows.js differs from the repo copy; the new allowlist file imports optionRowsFromOptions from it. Stop and compare." >&2; exit 1; }
for p in toyota-rav4-2026 toyota-2026-2027 ford-2026; do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TMP/optionPolicies/$p.json"; done

# Patch a COPY of deals_api_server.js first; only install if every anchor matched once and the syntax checks.
cp "$DIR/deals_api_server.js" "$TMP/deals_api_server.js"
python3 - "$TMP/deals_api_server.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
edits = [
 ('import { loadAllowlistFromEnv, resolveAllowlisted, hasAllowlistFor, catalogModeFromEnv } from "./factoryOptionAllowlist.js";',
  'import { loadAllowlistFromEnv, resolveAllowlisted, hasAllowlistFor, catalogModeFromEnv, policyFacetRows, policyApiOptions } from "./factoryOptionAllowlist.js";'),
 ('        const { rows: facetRows, junkDropped } = optionRowsFromOptions(v.options, { resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key) });',
  '''        // Model policy (OPTION_MODEL_POLICY_PATH, Toyota + Ford 2026-27): for a covered vehicle ONLY the policy's options are written, so a re-synced
        // car can't bring the generic rows back. Any other vehicle takes the generic path below, unchanged. Blank trim in the payload = no information
        // (the upsert COALESCEs trim), so the stored rows are left alone.
        const pol = policyFacetRows(OPTION_ALLOWLIST, { make, model: v.model, year: INV_INT(v.year), trim: INV_STR(v.trim, 160) }, v.options);
        if (pol && pol.skip) { optionSetsKept++; continue; }
        const { rows: facetRows, junkDropped } = pol || optionRowsFromOptions(v.options, { resolveKey: (key) => resolveAllowlisted(OPTION_ALLOWLIST, make, key) });'''),
 ('options: INV_JSON(r.options_json), optionsTotal',
  'options: policyApiOptions(OPTION_ALLOWLIST, { make: r.make, model: r.model, year: r.year, trim: r.trim }, INV_JSON(r.options_json)), optionsTotal'),
]
for old, new in edits:
    n = s.count(old)
    if n != 1:
        sys.exit("ERROR: anchor matched %d times (need exactly 1): %s" % (n, old[:90]))
    s = s.replace(old, new, 1)
open(p, "w").write(s)
print("deals_api_server.js: 3 anchored edits applied to the copy")
PY
node --check "$TMP/deals_api_server.js"
node --check "$TMP/factoryOptionAllowlist.js"
# The new allowlist module must load against the box's own inventoryOptionRows.js (catches an import mismatch before anything is installed).
mkdir -p "$TMP/chk" && cp "$DIR"/*.js "$TMP/chk/" && cp "$TMP/factoryOptionAllowlist.js" "$TMP/chk/" && cp -r "$TMP/optionPolicies" "$TMP/chk/" && echo '{"type":"module"}' > "$TMP/chk/package.json"
(cd "$TMP/chk" && node --input-type=module -e 'const m=await import("./factoryOptionAllowlist.js"); const a=m.buildAllowlist(null,m.loadBundledModelPoliciesRaw()); if(!a.models.size) throw new Error("no policies loaded"); console.log("policy module loads:", a.models.size, "model-year scopes")')

# Install (backups first).
mkdir -p "$DIR/optionPolicies"
for f in factoryOptionAllowlist.js deals_api_server.js; do cp -p "$DIR/$f" "$DIR/$f.bak.$TS"; done
cp "$TMP/factoryOptionAllowlist.js" "$DIR/factoryOptionAllowlist.js"
cp "$TMP/deals_api_server.js" "$DIR/deals_api_server.js"
cp "$TMP"/optionPolicies/*.json "$DIR/optionPolicies/"
echo "Installed. NOT restarted; policy is OFF until OPTION_MODEL_POLICY_PATH is set at the restart."
echo "Rollback: cp -p $DIR/factoryOptionAllowlist.js.bak.$TS $DIR/factoryOptionAllowlist.js && cp -p $DIR/deals_api_server.js.bak.$TS $DIR/deals_api_server.js   (then restart only if it was already restarted)"
rm -rf "$TMP"
