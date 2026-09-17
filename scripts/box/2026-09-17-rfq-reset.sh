#!/usr/bin/env bash
# Deals box: wipe every quote request (rfq_requests, rfq_invites, rfq_quotes, rfq_events) after a
# mysqldump backup. For clearing QA/smoke data before the approval gate goes live (2026-09-17: 22
# requests, all smoke-* accounts + test buyer 2, Sep 13–15). Reversible from the dump.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-rfq-reset.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-rfq-reset.sh && bash 2026-09-17-rfq-reset.sh
# Prints counts before, backs up, asks for a typed YES, deletes, prints counts after.
set -euo pipefail
ENV=/opt/trimscout-deals/.env.trimscout-db
BACKUP_DIR=/opt/trimscout-deals/backups
STAMP=$(date +%Y%m%d-%H%M%S)
[ -f "$ENV" ] || { echo "missing $ENV"; exit 1; }
set -a; . "$ENV"; set +a
: "${DB_HOST:?}" "${DB_NAME:?}" "${DB_WRITER_USER:?}" "${DB_WRITER_PASSWORD:?}"
PORT="${DB_PORT:-3306}"
M=(mysql --host="$DB_HOST" --port="$PORT" --user="$DB_WRITER_USER" --password="$DB_WRITER_PASSWORD" "$DB_NAME")

echo "== before"
"${M[@]}" -e "SELECT 'rfq_requests' t, COUNT(*) n FROM rfq_requests UNION ALL SELECT 'rfq_invites', COUNT(*) FROM rfq_invites UNION ALL SELECT 'rfq_quotes', COUNT(*) FROM rfq_quotes UNION ALL SELECT 'rfq_events', COUNT(*) FROM rfq_events;"

sudo mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/rfq-tables-$STAMP.sql"
sudo bash -c "mysqldump --host='$DB_HOST' --port='$PORT' --user='$DB_WRITER_USER' --password='$DB_WRITER_PASSWORD' --single-transaction --skip-lock-tables '$DB_NAME' rfq_requests rfq_invites rfq_quotes rfq_events > '$DUMP'"
sudo gzip -f "$DUMP"
echo "backup: $DUMP.gz ($(sudo du -h "$DUMP.gz" | cut -f1))"
echo "restore with: sudo gunzip -c $DUMP.gz | mysql --host=$DB_HOST --port=$PORT --user=$DB_WRITER_USER -p $DB_NAME"

read -r -p "Type YES to delete every quote request, invite, quote and event: " ok
[ "$ok" = "YES" ] || { echo "aborted — nothing deleted (backup kept)"; exit 0; }

"${M[@]}" -e "SET FOREIGN_KEY_CHECKS=0; DELETE FROM rfq_events; DELETE FROM rfq_quotes; DELETE FROM rfq_invites; DELETE FROM rfq_requests; SET FOREIGN_KEY_CHECKS=1;"

echo "== after"
"${M[@]}" -e "SELECT 'rfq_requests' t, COUNT(*) n FROM rfq_requests UNION ALL SELECT 'rfq_invites', COUNT(*) FROM rfq_invites UNION ALL SELECT 'rfq_quotes', COUNT(*) FROM rfq_quotes UNION ALL SELECT 'rfq_events', COUNT(*) FROM rfq_events;"
echo "done — clean slate; new requests start from the next id and land on the approval desk"
