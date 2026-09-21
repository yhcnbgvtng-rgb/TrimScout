#!/bin/bash
set -uo pipefail
cd /home/ubuntu/nj-scraper/scrapers/lightsail-crawler
DATE=2026-09-15
SUMMARY=/home/ubuntu/nj-scraper/scrapers/lightsail-crawler/logs/tx-timing-summary-$DATE.txt
: > "$SUMMARY"

# brand-name : dealer-file-slug pairs (only brands with >0 TX rooftops)
declare -A BRANDS=(
  [Toyota]=toyota
  [Volkswagen]=volkswagen
  [Mazda]=mazda
  [Subaru]=subaru
  [Mercedes-Benz]=mercedes-benz
  [Kia]=kia
  [Mitsubishi]=mitsubishi
  [Porsche]=porsche
  [Lexus]=lexus
  [Acura]=acura
  [Mini]=mini
  [BMW]=bmw
)

ORDER=(Toyota Volkswagen Mazda Subaru Mercedes-Benz Kia Mitsubishi Porsche Lexus Acura Mini BMW)

OVERALL_START=$(date -u +%s)
echo "TX crawl overall start (UTC epoch): $OVERALL_START ($(date -u -d @$OVERALL_START))" | tee -a "$SUMMARY"

for BRAND in "${ORDER[@]}"; do
  SLUG=${BRANDS[$BRAND]}
  LOG="logs/tx-${SLUG}-${DATE}.log"
  START=$(date -u +%s)
  echo "=== $BRAND start $(date -u -d @$START) (epoch $START) ===" | tee -a "$SUMMARY"
  CRAWLER_STATE=TX CRAWLER_DEALERS_FILE=dealers/tx/${SLUG}.json CRAWLER_BRAND="$BRAND" node src/standalone.js > "$LOG" 2>&1
  EXIT=$?
  END=$(date -u +%s)
  DUR=$((END-START))
  echo "=== $BRAND end $(date -u -d @$END) (epoch $END) duration=${DUR}s exit=${EXIT} ===" | tee -a "$SUMMARY"
done

OVERALL_END=$(date -u +%s)
TOTAL=$((OVERALL_END-OVERALL_START))
echo "TX crawl overall end (UTC epoch): $OVERALL_END ($(date -u -d @$OVERALL_END)) total_seconds=$TOTAL" | tee -a "$SUMMARY"
