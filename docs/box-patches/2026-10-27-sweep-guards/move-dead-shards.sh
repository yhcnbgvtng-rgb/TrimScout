#!/usr/bin/env bash
# STEPS.md step 8 (separate from the sweep-guard install): move the dead plain state-level shard files out of the folder the sync reads.
#   bash move-dead-shards.sh /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/inventory            # DRY RUN: lists what it would move
#   bash move-dead-shards.sh /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/data/inventory --apply    # moves them
# Why: since the per-brand sharding no job writes <ST>.json; these nine hold only records last refreshed 10-07..10-18 or earlier, so every night the sync reads
# them (megabytes of JSON) and skips every record as stale. Nothing here is deleted: the files are MOVED to ~/dead-state-shards-<date>/ with an md5 list, and
# `mv ~/dead-state-shards-<date>/*.json <dir>/` puts them back. OK__mazda.json is NOT in this list: it is a live per-brand file whose job stopped being scheduled.
set -euo pipefail
DIR="${1:?usage: move-dead-shards.sh DATA_INVENTORY_DIR [--apply]}"
APPLY="${2:-}"
DEAD=(AL CO IN MD MT PA TX VT WY)
DEST="${DEAD_SHARDS_DEST:-$HOME/dead-state-shards-$(date +%Y%m%d)}"
MIN_AGE_MIN="${DEAD_SHARDS_MIN_AGE_MIN:-2880}"   # 48 h: anything written more recently is not dead

if [ "${SKIP_RUNNING_CHECK:-}" != 1 ] && pgrep -f "inventory-sync.mjs|run-daily-crawl" >/dev/null; then
  echo "REFUSING: a sync or crawl is running; run this in an idle window." >&2; exit 1
fi
[ -d "$DIR" ] || { echo "no such directory: $DIR" >&2; exit 1; }

refused=0; todo=()
for st in "${DEAD[@]}"; do
  f="$DIR/$st.json"
  if [ ! -e "$f" ]; then echo "skip   $st.json (not there)"; continue; fi
  if [ -n "$(find "$f" -mmin "-$MIN_AGE_MIN" -print 2>/dev/null)" ]; then echo "REFUSE $st.json was written in the last $((MIN_AGE_MIN / 60)) h - something still writes it; not dead"; refused=1; continue; fi
  printf 'would  move %s.json  %s bytes  mtime %s\n' "$st" "$(wc -c < "$f" | tr -d ' ')" "$(date -r "$f" '+%F %R' 2>/dev/null || stat -c %y "$f")"
  todo+=("$st")
done
[ "$refused" = 0 ] || { echo "Nothing moved: at least one file is not dead. Report this to Paul." >&2; exit 2; }
if [ "$APPLY" != "--apply" ]; then echo "DRY RUN: ${#todo[@]} file(s) would move to $DEST (add --apply)"; exit 0; fi
[ ${#todo[@]} -gt 0 ] || { echo "nothing to move"; exit 0; }
mkdir -p "$DEST"
for st in "${todo[@]}"; do
  md5sum "$DIR/$st.json" >> "$DEST/MOVED.md5"
  mv -n "$DIR/$st.json" "$DEST/$st.json"
done
echo "moved ${#todo[@]} file(s) to $DEST (md5s in MOVED.md5). Undo: mv $DEST/*.json $DIR/"
