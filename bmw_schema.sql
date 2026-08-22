-- =====================================================================
-- BMW DEALERSHIP INVENTORY & DAILY CHANGE TRACKER SCHEMA
-- Tracks Live Inventory, M Performance Models, Factory Packages, & Pricing
-- =====================================================================

-- 1. DEALERS TABLE (Authorized BMW Centers)
CREATE TABLE IF NOT EXISTS dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    phone TEXT,
    street_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    region TEXT NOT NULL,
    zip TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    cms_platform TEXT DEFAULT 'Dealer.com',
    inventory_url TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. VEHICLES TABLE (Active & Historical BMW Inventory per VIN)
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vin TEXT UNIQUE NOT NULL,            -- 17-char VIN (e.g. WBA..., 3MW...)
    dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    stock_number TEXT,
    
    -- Specifications
    year INTEGER NOT NULL,
    make TEXT NOT NULL DEFAULT 'BMW',
    series TEXT NOT NULL,                -- '3 Series', '5 Series', '7 Series', 'X3', 'X5', 'M3', 'M5', 'i4', etc.
    model TEXT NOT NULL,                -- 'M340i xDrive', 'M3 Competition', 'X5 M60i', 'i4 M50'
    trim TEXT,
    body_style TEXT,                     -- 'Sedan', 'SAV', 'Coupe', 'Gran Coupe', 'Convertible'
    drivetrain TEXT,                     -- 'xDrive (AWD)', 'sDrive (RWD)'
    transmission TEXT,                   -- '8-Speed Sport Steptronic', '6-Speed Manual'
    engine TEXT,                         -- '3.0L BMW M TwinPower Turbo Inline-6 (386 hp)'
    exterior_color TEXT,
    interior_color TEXT,
    mileage INTEGER DEFAULT 0,
    
    -- Categorization
    condition TEXT NOT NULL,             -- 'New', 'BMW Certified Pre-Owned', 'Used'
    status TEXT DEFAULT 'Active',        -- 'Active', 'Pending', 'Sold', 'Delisted'
    inventory_stage TEXT DEFAULT 'On-Lot',
    is_m_model INTEGER DEFAULT 0,        -- Flag for true M cars (M2, M3, M4, M5, X5 M) & M Performance
    
    -- Pricing
    base_msrp REAL,
    total_packages_price REAL DEFAULT 0,
    current_price REAL NOT NULL,
    original_price REAL NOT NULL,
    msrp REAL,
    price_type TEXT DEFAULT 'Advertised',
    
    -- Direct Links
    direct_url TEXT NOT NULL,
    window_sticker_url TEXT,
    primary_image_url TEXT,
    
    -- Dates & Days on Lot
    first_seen_date TEXT NOT NULL,
    last_seen_date TEXT NOT NULL,
    sold_date TEXT,
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
    snapshot_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, snapshot_date)
);

-- 4. BMW FACTORY PACKAGES & OPTIONS TABLE
CREATE TABLE IF NOT EXISTS vehicle_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin TEXT NOT NULL,
    package_code TEXT NOT NULL,          -- e.g. 'ZMP' (M Sport), 'ZPP' (Premium), 'ZPK' (Parking Assistance)
    package_name TEXT NOT NULL,          -- e.g. 'Driving Assistance Professional Package'
    category TEXT,                       -- 'package', 'technology', 'interior', 'performance', 'audio'
    price REAL DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, package_code)
);

-- 5. DAILY SCRAPE AUDIT LOGS
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
-- PERFORMANCE INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_bmw_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_bmw_series_model ON vehicles(series, model);
CREATE INDEX IF NOT EXISTS idx_bmw_price ON vehicles(current_price);
CREATE INDEX IF NOT EXISTS idx_bmw_days ON vehicles(days_on_lot);
CREATE INDEX IF NOT EXISTS idx_bmw_m_model ON vehicles(is_m_model);
CREATE INDEX IF NOT EXISTS idx_bmw_price_history_vin ON price_history(vin, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_bmw_packages_code ON vehicle_packages(package_code);

-- =====================================================================
-- APPLICATION VIEWS
-- =====================================================================

-- View 1: Active BMW Inventory with Live Savings & Dealer Info
CREATE VIEW IF NOT EXISTS v_active_bmw_inventory AS
SELECT 
    v.id AS vehicle_id,
    v.vin,
    v.year,
    v.make,
    v.series,
    v.model,
    v.trim,
    v.body_style,
    v.drivetrain,
    v.transmission,
    v.engine,
    v.exterior_color,
    v.interior_color,
    v.mileage,
    v.condition,
    v.status,
    v.is_m_model,
    v.base_msrp,
    v.total_packages_price,
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
    d.phone AS dealer_phone,
    d.domain AS dealer_domain
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active';

-- View 2: Top BMW Price Drops
CREATE VIEW IF NOT EXISTS v_top_bmw_price_drops AS
SELECT 
    v.vin,
    v.year,
    v.series,
    v.model,
    d.name AS dealer_name,
    d.city AS dealer_city,
    d.state AS dealer_state,
    v.original_price,
    v.current_price,
    (v.original_price - v.current_price) AS total_savings,
    ROUND(((v.original_price - v.current_price) / v.original_price) * 100, 1) AS percent_savings,
    v.days_on_lot,
    v.direct_url
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active' AND (v.original_price - v.current_price) > 0
ORDER BY total_savings DESC;
