#!/usr/bin/env bash
# Copies the contact-email cleanup script and the two modules it needs into one folder, so the whole thing runs from there
# (e.g. /tmp/cec) and nothing is installed into /opt/trimscout-deals/src.
#   scripts/box/contact-email-cleanup-bundle.sh /tmp/cec
set -euo pipefail
out="${1:?usage: contact-email-cleanup-bundle.sh <folder>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$out"
cp "$root/scripts/box/2026-10-30-contact-email-cleanup.mjs" "$root/scrapers/lightsail-crawler/src/contactEmailCleanup.js" "$root/scrapers/lightsail-crawler/src/quoteReachable.js" "$out/"
echo "Bundled into $out: $(ls "$out" | tr '\n' ' ')"
