#!/usr/bin/env bash
# deploy-430 schema step, with a backup first. DO NOT RUN until Paul types GO. Run on box2 as ubuntu from /opt/trimscout-deals (reads .env.trimscout-db).
#   1. refuses if the sync lock is held or a crawl/sync is running here (the lock is only READ, never taken)
#   2. backs up the 8 tables (data + structure, single transaction, no locking) to ~/backups/ and checks the file
#   3. applies 2026-10-14-deploy-430-schema.sql with the WRITER login, prints the verify query
# Nothing else changes: no restart, no file patch, no data rewrite.
set -euo pipefail
cd /opt/trimscout-deals
SQL="${SQL:-$HOME/2026-10-14-deploy-430-schema.sql}"
[ -f "$SQL" ] || { echo "ERROR: $SQL not found (copy it next to this script)"; exit 1; }
set -a; . ./.env.trimscout-db; set +a
LAST=$(grep -h "sync-lock" ~/.pm2/logs/deals-api-out.log | grep -E " acquire by | release by " | tail -1)
case "$LAST" in *" acquire by "*) echo "STOP: sync lock is held: $LAST"; exit 3;; esac
if pgrep -f "inventory-sync.mjs|run-daily-crawl" >/dev/null; then echo "STOP: a sync or crawl process is running on this box"; exit 3; fi
TABLES="rfq_requests rfq_invites rfq_quotes rfq_events deal_requests deal_bids deals dealership_contacts"
mkdir -p ~/backups; OUT=~/backups/deploy430-pre-schema-$(date +%Y%m%d-%H%M%S).sql.gz
MYSQL_PWD="$DB_WRITER_PASSWORD" mysqldump -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_WRITER_USER" --single-transaction --quick --skip-lock-tables --routines=0 --triggers "$DB_NAME" $TABLES | gzip > "$OUT"
gzip -t "$OUT" && echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
zcat "$OUT" | grep -c "^INSERT INTO" | sed 's/^/insert statements in backup: /'
echo "applying $SQL"
MYSQL_PWD="$DB_WRITER_PASSWORD" mariadb -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_WRITER_USER" "$DB_NAME" -t < "$SQL"
echo "done. Rollback list is at the bottom of $SQL; backup: $OUT"
