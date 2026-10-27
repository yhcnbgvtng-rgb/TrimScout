-- Sweep guards, step 1 of STEPS.md: the two columns behind the "missing from 2 healthy crawls" rule. Run on box2 as an admin DB user:
--   sudo mysql trimscout < schema.sql
-- Both are added at the end of the table with ALGORITHM=INSTANT (metadata only, no row copy). If MariaDB cannot do it instantly the ALTER FAILS and changes
-- nothing; do not retry with another algorithm without asking Paul, because a table copy of dealer_inventory is a long outage-grade operation.
-- lock_wait_timeout makes it give up in 10 s instead of queueing behind a long SELECT (a queued ALTER blocks every query that arrives after it).
SET SESSION lock_wait_timeout = 10;
ALTER TABLE dealer_inventory
  ADD COLUMN IF NOT EXISTS sweep_miss_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_miss_at DATETIME NULL,
  ALGORITHM=INSTANT;
SHOW COLUMNS FROM dealer_inventory WHERE Field IN ('sweep_miss_count', 'sweep_miss_at');
