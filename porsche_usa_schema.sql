-- =====================================================================
-- PORSCHE USA NATIONWIDE INVENTORY & DAILY CHANGE TRACKER SCHEMA
-- Covers ~204 Authorized Porsche Centers across all 50 States
-- =====================================================================

-- 1. DEALERS TABLE (All US Authorized Porsche Centers)
CREATE TABLE IF NOT EXISTS dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    phone TEXT,
    street_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,               -- e.g. 'CA', 'FL', 'TX', 'NY', 'NJ', 'IL', etc.
    region TEXT NOT NULL,              -- 'Northeast', 'Southeast', 'Midwest', 'Southwest', 'West'
    zip TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    cms_platform TEXT DEFAULT 'Dealer.com',
    inventory_url TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. VEHICLES TABLE (Nationwide Inventory per VIN)
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vin TEXT UNIQUE NOT NULL,
    dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    stock_number TEXT,
    
    -- Vehicle Specifications
    year INTEGER NOT NULL,
    make TEXT NOT NULL DEFAULT 'Porsche',
    model TEXT NOT NULL,                -- '911', '718 Cayman', '718 Boxster', 'Taycan', 'Macan', 'Cayenne', 'Panamera'
    trim TEXT,                          -- 'Carrera GTS T-Hybrid', 'GT3 RS', 'Turbo S', 'GTS 4.0'
    body_style TEXT,                     -- 'Coupe', 'Cabriolet', 'Targa', 'SUV', 'Sedan', 'Cross Turismo'
    transmission TEXT,                   -- '8-Speed PDK', '7-Speed Manual', '6-Speed Manual', 'Automatic'
    drivetrain TEXT,                     -- 'RWD', 'AWD'
    engine TEXT,
    exterior_color TEXT,
    interior_color TEXT,
    mileage INTEGER DEFAULT 0,
    
    -- Categorization & Lifecycle
    condition TEXT NOT NULL,             -- 'New', 'CPO', 'Used'
    status TEXT DEFAULT 'Active',        -- 'Active', 'Pending', 'Sold', 'Delisted'
    inventory_stage TEXT DEFAULT 'On-Lot',
    
    -- Pricing
    base_msrp REAL,
    total_options_price REAL DEFAULT 0,
    current_price REAL NOT NULL,
    original_price REAL NOT NULL,
    msrp REAL,
    price_type TEXT DEFAULT 'Advertised',
    
    -- Direct Links & Verified URLs
    direct_url TEXT NOT NULL,            -- Direct vehicle detail page (VDP) link on dealer site
    porsche_code TEXT,
    porsche_code_url TEXT,
    window_sticker_url TEXT,
    primary_image_url TEXT,
    
    -- Change Tracking Dates
    first_seen_date TEXT NOT NULL,       -- YYYY-MM-DD
    last_seen_date TEXT NOT NULL,        -- YYYY-MM-DD
    sold_date TEXT,                      -- YYYY-MM-DD
    days_on_lot INTEGER DEFAULT 1,
    consecutive_missing_days INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 3. DAILY PRICE HISTORY SNAPSHOTS
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin TEXT NOT NULL,
    price REAL NOT NULL,
    price_delta REAL DEFAULT 0,
    mileage INTEGER,
    status TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,         -- YYYY-MM-DD
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, snapshot_date)
);

-- 4. PORSCHE FACTORY OPTIONS TABLE
CREATE TABLE IF NOT EXISTS vehicle_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin TEXT NOT NULL,
    option_code TEXT NOT NULL,           -- e.g. '8LH', '1LX', '2UH', '9VJ', 'PTS'
    option_name TEXT NOT NULL,
    category TEXT,                       -- 'performance', 'interior', 'exterior', 'audio_tech', 'package'
    price REAL DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, option_code)
);

-- 5. DAILY SCRAPE RUN AUDIT LOGS
CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT DEFAULT 'Running',
    dealers_scraped INTEGER DEFAULT 0,
    total_vehicles_found INTEGER DEFAULT 0,
    new_vehicles_added INTEGER DEFAULT 0,
    prices_changed INTEGER DEFAULT 0,
    vehicles_marked_sold INTEGER DEFAULT 0,
    error_summary TEXT
);

-- =====================================================================
-- NATIONWIDE PERFORMANCE INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_usa_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_usa_vehicles_state ON vehicles(dealer_id);
CREATE INDEX IF NOT EXISTS idx_usa_vehicles_model_trim ON vehicles(model, trim);
CREATE INDEX IF NOT EXISTS idx_usa_vehicles_price ON vehicles(current_price);
CREATE INDEX IF NOT EXISTS idx_usa_vehicles_days ON vehicles(days_on_lot);
CREATE INDEX IF NOT EXISTS idx_usa_dealers_state ON dealers(state, region);
CREATE INDEX IF NOT EXISTS idx_usa_price_history_vin ON price_history(vin, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_usa_options_code ON vehicle_options(option_code);

-- =====================================================================
-- NATIONWIDE APPLICATION VIEWS
-- =====================================================================

-- View 1: Active Nationwide Inventory
CREATE VIEW IF NOT EXISTS v_active_usa_inventory AS
SELECT 
    v.id AS vehicle_id,
    v.vin,
    v.year,
    v.make,
    v.model,
    v.trim,
    v.body_style,
    v.transmission,
    v.drivetrain,
    v.engine,
    v.exterior_color,
    v.interior_color,
    v.mileage,
    v.condition,
    v.status,
    v.base_msrp,
    v.total_options_price,
    v.current_price,
    v.original_price,
    v.msrp,
    (v.original_price - v.current_price) AS total_price_drop,
    CASE 
        WHEN v.original_price > 0 THEN ROUND(((v.original_price - v.current_price) / v.original_price) * 100, 1)
        ELSE 0 
    END AS price_drop_percent,
    v.days_on_lot,
    v.first_seen_date,
    v.last_seen_date,
    v.direct_url,
    d.name AS dealer_name,
    d.city AS dealer_city,
    d.state AS dealer_state,
    d.region AS dealer_region,
    d.zip AS dealer_zip,
    d.phone AS dealer_phone,
    d.domain AS dealer_domain
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active';

-- View 2: Top 50 Nationwide Price Drops
CREATE VIEW IF NOT EXISTS v_top_usa_price_drops AS
SELECT 
    v.vin,
    v.year,
    v.model,
    v.trim,
    d.name AS dealer_name,
    d.city AS dealer_city,
    d.state AS dealer_state,
    d.region AS dealer_region,
    v.original_price,
    v.current_price,
    (v.original_price - v.current_price) AS total_savings,
    ROUND(((v.original_price - v.current_price) / v.original_price) * 100, 1) AS percent_savings,
    v.days_on_lot,
    v.direct_url
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active' AND (v.original_price - v.current_price) > 0
ORDER BY total_savings DESC
LIMIT 50;

-- View 3: State-by-State Inventory Summary
CREATE VIEW IF NOT EXISTS v_state_summary AS
SELECT 
    d.state,
    d.region,
    COUNT(DISTINCT d.id) AS total_dealerships,
    COUNT(v.id) AS total_active_vehicles,
    ROUND(AVG(v.current_price), 0) AS avg_vehicle_price,
    ROUND(AVG(v.days_on_lot), 1) AS avg_days_on_lot,
    SUM(v.current_price) AS total_inventory_value
FROM dealers d
LEFT JOIN vehicles v ON d.id = v.dealer_id AND v.status = 'Active'
GROUP BY d.state, d.region
ORDER BY total_active_vehicles DESC;
