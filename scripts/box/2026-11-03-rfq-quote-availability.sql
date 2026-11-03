-- Dealer availability confirmation on a quote: one nullable column on rfq_quotes. ADDITIVE ONLY (no drops, no rewrites, no backfill).
--   availability_json TEXT NULL   {"status":"available","vin","confirmedAt"} | {"status":"unavailable_alternative","requestedVin","alternativeVin","recordedAt"}
-- Quotes sent before this stay NULL and the buyer sees no availability line for them.
-- Same end state as the ADD COLUMN IF NOT EXISTS in ensureQuotePackageColumns() (deals_api_server.js mirror), so re-running is a no-op.
-- NOT RUN ANYWHERE by this PR. Apply on the deals box in an idle window, on Paul's GO. ALGORITHM=INSTANT is metadata-only; if it cannot be done
-- that way the statement FAILS rather than copying the table. A 5 s lock wait means a long reader makes it fail fast, and a retry is safe.
SET SESSION lock_wait_timeout = 5;
ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS availability_json TEXT NULL, ALGORITHM=INSTANT, LOCK=NONE;

-- Verify: one row, TEXT, nullable.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rfq_quotes' AND COLUMN_NAME = 'availability_json';

-- Rollback (only if told to; nothing reads the column until the app + box code are deployed):
--   ALTER TABLE rfq_quotes DROP COLUMN IF EXISTS availability_json;
