-- Optional offer date on a quote: rfq_quotes.expires_at may be NULL ("the dealer gave no date"). Nothing ever writes a default date.
-- The table is small (tens of rows), so the rebuild this MODIFY needs is instant; 5 s lock wait so a long reader makes it fail fast (a retry is safe).
-- Readers on the box already treat NULL as "no date" (rfqStages.js, rfqTradeConfirm.js, publicRfqQuote).
SET SESSION lock_wait_timeout = 5;
ALTER TABLE rfq_quotes MODIFY expires_at DATETIME NULL;

-- Verify: IS_NULLABLE = YES.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rfq_quotes' AND COLUMN_NAME = 'expires_at';

-- Rollback (only after any quote saved without a date is removed or given a date by hand; this FAILS while a NULL exists):
--   ALTER TABLE rfq_quotes MODIFY expires_at DATETIME NOT NULL;
