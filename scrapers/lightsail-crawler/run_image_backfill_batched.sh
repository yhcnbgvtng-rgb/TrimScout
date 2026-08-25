#!/bin/bash
# backfill_images.mjs leaks memory across a long single run (OOM crashes
# around 2000-5000 records even with a raised heap limit, likely from
# repeated vm.runInNewContext sandbox creation not being GC'd promptly).
# Each fresh process starts with clean memory, so run it in small batches,
# looping until nothing is left to do (the script always resumes from
# whatever still lacks an imageUrl).
cd "/Users/paul/Claude - GitHub/TrimScout/scrapers/lightsail-crawler"
while true; do
  remaining=$(node -e "
    const inv = require('/Users/paul/Claude - GitHub/TrimScout/data/lightsail_inventory.json');
    console.log(inv.filter(v => !v.imageUrl && v.url).length);
  ")
  echo "=== Remaining targets: $remaining ==="
  if [ "$remaining" -eq 0 ]; then
    echo "=== ALL DONE ==="
    break
  fi
  BACKFILL_LIMIT=2000 node --max-old-space-size=4096 src/backfill_images.mjs
  sleep 2
done
