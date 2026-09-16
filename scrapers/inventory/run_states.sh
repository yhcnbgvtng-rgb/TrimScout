#!/usr/bin/env bash
# Crawl every state in state_order.txt (largest first), pushing each state to the box as it completes.
# Resumable: a state whose push marker exists is skipped; a partially crawled state resumes per site.
#   nohup bash run_states.sh > run_states.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
while read -r ST; do
  [ -z "$ST" ] && continue
  if [ -f "done_$ST.marker" ]; then echo "== $ST already pushed"; continue; fi
  echo "== $ST start $(date)"
  python3 crawl_inventory.py "sites_$ST.json" "inventory_$ST.jsonl" --max-per-site 600 --concurrency 100 --host-gap 0.6 > "crawl_$ST.log" 2>&1
  tail -2 "crawl_$ST.log"
  ( cd "$ROOT" && set -a && . ./.env.local && set +a && npx tsx scripts/probes/push-inventory.mts "scrapers/inventory/inventory_$ST.jsonl" 2>&1 | tail -1 ) && touch "done_$ST.marker"
  echo "== $ST done $(date)"
done < state_order.txt
echo "ALL STATES DONE $(date)"
