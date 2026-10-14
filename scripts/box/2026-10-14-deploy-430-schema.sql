-- deploy-430 schema step: the soft-delete / audit columns PR #430 adds, applied up front instead of lazily by the deals API after its restart.
-- Same end state as ensureAuditColumns() + the dealership_contacts.is_test line in deals_api_server.js (all ADD COLUMN IF NOT EXISTS, so re-running is a no-op).
-- Live state read on box2 2026-10-14 (read-only): MariaDB 10.11.14, InnoDB, every table below is < 10 MB and <= 18,039 rows.
--   rfq_requests already has audit, audit_at (and audit_forced_safe): only deleted_at is missing.
--   rfq_invites, rfq_quotes, rfq_events, deal_requests, deal_bids, deals have none of the three.   dealership_contacts has no is_test.
-- ALGORITHM=INSTANT is metadata-only (MariaDB >= 10.3), LOCK=NONE: no table copy, no write blocking. If a statement cannot be done that way it FAILS instead of
-- silently falling back to a copying ALTER. lock_wait_timeout is cut to 5 s so a statement waits at most 5 s for a long-running reader/transaction on that
-- table (the server default is 86400 s) and never queues other queries behind it; a timeout is safe to re-run.
SET SESSION lock_wait_timeout = 5;

ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;

ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;
ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;
ALTER TABLE rfq_events ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;
ALTER TABLE deal_requests ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;
ALTER TABLE deal_bids ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ALGORITHM=INSTANT, LOCK=NONE;

ALTER TABLE dealership_contacts ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0, ALGORITHM=INSTANT, LOCK=NONE;

-- Verify: every row below must show the columns, and the counts must equal what the backup holds (nothing is rewritten).
SELECT TABLE_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS new_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('rfq_requests','rfq_invites','rfq_quotes','rfq_events','deal_requests','deal_bids','deals','dealership_contacts')
  AND COLUMN_NAME IN ('audit','audit_at','deleted_at','is_test')
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;

-- Rollback (only if told to; the columns are unused until the #430 code is deployed): drop exactly what this step added.
--   ALTER TABLE rfq_requests DROP COLUMN IF EXISTS deleted_at;
--   ALTER TABLE <rfq_invites|rfq_quotes|rfq_events|deal_requests|deal_bids|deals> DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS audit_at, DROP COLUMN IF EXISTS audit;
--   ALTER TABLE dealership_contacts DROP COLUMN IF EXISTS is_test;
-- (The table backup below can also be restored with: mysql trimscout < <backup file>.)
