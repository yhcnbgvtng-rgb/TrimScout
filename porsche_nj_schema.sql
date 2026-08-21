-- =====================================================================
-- PORSCHE NEW JERSEY INVENTORY & DAILY CHANGE TRACKER SCHEMA
-- Includes Factory Option Codes, Monroney Window Stickers, and Build Sheets
-- =====================================================================

-- 1. DEALERS TABLE (All 8 Authorized NJ Porsche Centers)
CREATE TABLE IF NOT EXISTS dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    phone TEXT,
    street_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'NJ',
    zip TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    cms_platform TEXT DEFAULT 'Dealer.com',
    inventory_url TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. VEHICLES TABLE (Active & Historical Inventory per VIN)
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vin TEXT UNIQUE NOT NULL,
    dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    stock_number TEXT,
    
    -- Vehicle Specifications
    year INTEGER NOT NULL,
    make TEXT NOT NULL DEFAULT 'Porsche',
    model TEXT NOT NULL,                -- '911', '718 Cayman', 'Taycan', 'Macan', 'Cayenne', 'Panamera'
    trim TEXT,                          -- 'Carrera GTS T-Hybrid', 'GT3 RS', 'Turbo S', 'GTS 4.0'
    body_style TEXT,                     -- 'Coupe', 'Cabriolet', 'Targa', 'SUV', 'Sedan', 'Sport Turismo'
    transmission TEXT,                   -- '8-Speed PDK', '7-Speed Manual', '6-Speed Manual', 'Tiptronic S'
    drivetrain TEXT,                     -- 'RWD', 'AWD'
    engine TEXT,                         -- '3.6L Boxer-6 eTurbo Hybrid (532 hp)'
    exterior_color TEXT,
    interior_color TEXT,
    mileage INTEGER DEFAULT 0,
    
    -- Categorization & Lifecycle
    condition TEXT NOT NULL,             -- 'New', 'CPO', 'Used'
    status TEXT DEFAULT 'Active',        -- 'Active', 'Pending', 'Sold', 'Delisted'
    inventory_stage TEXT DEFAULT 'On-Lot',-- 'On-Lot', 'In-Transit', 'Factory-Order'
    
    -- Pricing & Option Values
    base_msrp REAL,                      -- Vehicle Base MSRP without options
    total_options_price REAL DEFAULT 0,  -- Sum of all factory options
    current_price REAL NOT NULL,
    original_price REAL NOT NULL,
    msrp REAL,
    price_type TEXT DEFAULT 'Advertised',-- 'Advertised', 'Call_For_Price', 'MSRP'
    
    -- Direct Links, Build Sheets & Window Stickers
    direct_url TEXT NOT NULL,            -- Direct vehicle detail page (VDP) link on dealer site
    porsche_code TEXT,                   -- Porsche official build code (e.g. 'PR911GTS')
    porsche_code_url TEXT,               -- Direct link to https://porsche-code.com/<code>
    window_sticker_url TEXT,             -- Direct PDF / digital Monroney window sticker URL
    primary_image_url TEXT,              -- Dealer hosted image URL
    
    -- Days on Lot & Change Tracking Dates
    first_seen_date TEXT NOT NULL,       -- YYYY-MM-DD
    last_seen_date TEXT NOT NULL,        -- YYYY-MM-DD
    sold_date TEXT,                      -- YYYY-MM-DD
    days_on_lot INTEGER DEFAULT 1,
    consecutive_missing_days INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 3. DAILY PRICE & STATUS SNAPSHOTS (Time-Series History)
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin TEXT NOT NULL,
    price REAL NOT NULL,
    price_delta REAL DEFAULT 0,          -- Price drop (-$1,500) or Increase (+$1,000) vs previous
    mileage INTEGER,
    status TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,         -- YYYY-MM-DD
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, snapshot_date)
);

-- 4. PORSCHE FACTORY OPTIONS / BUILD SHEET TABLE
CREATE TABLE IF NOT EXISTS vehicle_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vin TEXT NOT NULL,
    option_code TEXT NOT NULL,           -- e.g. '8LH' (Sport Chrono), '1LX' (PCCB), '2UH' (Front Axle Lift)
    option_name TEXT NOT NULL,           -- e.g. 'Sport Chrono Package with Mode Switch'
    category TEXT,                       -- 'performance', 'interior', 'exterior', 'package', 'audio_tech', 'wheels'
    price REAL DEFAULT 0,                -- MSRP price of the option
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
-- PERFORMANCE INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_condition ON vehicles(condition);
CREATE INDEX IF NOT EXISTS idx_vehicles_model_trim ON vehicles(model, trim);
CREATE INDEX IF NOT EXISTS idx_vehicles_current_price ON vehicles(current_price);
CREATE INDEX IF NOT EXISTS idx_vehicles_days_on_lot ON vehicles(days_on_lot);
CREATE INDEX IF NOT EXISTS idx_vehicles_dealer_id ON vehicles(dealer_id);
CREATE INDEX IF NOT EXISTS idx_price_history_vehicle ON price_history(vehicle_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_options_code ON vehicle_options(option_code);
CREATE INDEX IF NOT EXISTS idx_vehicle_options_vin ON vehicle_options(vin);

-- =====================================================================
-- APPLICATION VIEWS
-- =====================================================================

-- View 1: Active Inventory with Window Stickers, Options Total & Live Discounts
CREATE VIEW IF NOT EXISTS v_active_inventory AS
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
    v.inventory_stage,
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
    v.window_sticker_url,
    v.porsche_code,
    v.porsche_code_url,
    v.primary_image_url,
    d.name AS dealer_name,
    d.city AS dealer_city,
    d.state AS dealer_state,
    d.zip AS dealer_zip,
    d.phone AS dealer_phone,
    d.domain AS dealer_domain
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active';

-- View 2: Daily Top Price Drops
CREATE VIEW IF NOT EXISTS v_top_price_drops AS
SELECT 
    v.vin,
    v.year,
    v.model,
    v.trim,
    d.name AS dealer_name,
    v.original_price,
    v.current_price,
    (v.original_price - v.current_price) AS total_savings,
    ROUND(((v.original_price - v.current_price) / v.original_price) * 100, 1) AS percent_savings,
    v.days_on_lot,
    v.direct_url,
    v.window_sticker_url
FROM vehicles v
JOIN dealers d ON v.dealer_id = d.id
WHERE v.status = 'Active' AND (v.original_price - v.current_price) > 0
ORDER BY total_savings DESC;
