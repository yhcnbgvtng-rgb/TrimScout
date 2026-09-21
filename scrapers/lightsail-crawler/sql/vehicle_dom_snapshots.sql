-- Additive MariaDB table for daily VIN+date DOM hashes and price diffs.
-- Full gzipped blobs live on disk (data/dom_blobs/) and are pruned after 7 days.
-- Hashes + prices are kept indefinitely here and in data/dom_index.json.
-- db.js create-if-missing this table; this file is the documented shape.

CREATE TABLE IF NOT EXISTS vehicle_dom_snapshots (
  vin VARCHAR(17) NOT NULL,
  snapshot_date DATE NOT NULL,
  dom_hash CHAR(64) NULL,
  price INT NULL,
  old_price INT NULL,
  price_diff INT NOT NULL DEFAULT 0,
  price_change_type VARCHAR(32) NULL,
  blob_stored TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vin, snapshot_date),
  KEY idx_vehicle_dom_date (snapshot_date)
);

-- Public sales inbox on the dealer row (homepage/contact/staff/about only).
ALTER TABLE dealers ADD COLUMN sales_email VARCHAR(255) NULL;
ALTER TABLE dealers ADD COLUMN email_source_url VARCHAR(1024) NULL;
ALTER TABLE dealers ADD COLUMN email_collected_at DATETIME NULL;
