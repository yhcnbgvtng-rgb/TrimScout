#!/usr/bin/env python3
"""
Porsche New Jersey Dealership Inventory & Daily Change Tracker
With Factory Option Codes, Monroney Window Sticker URLs, and Build Sheets.
"""

import sqlite3
import datetime
import json
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "porsche_nj_inventory.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "porsche_nj_schema.sql")

# 8 Authorized Porsche Dealerships across New Jersey
PORSCHE_NJ_DEALERS = [
    {
        "dealer_code": "PORSCHE_CHERRY_HILL",
        "name": "Porsche Cherry Hill",
        "domain": "porschecherryhill.com",
        "phone": "(856) 665-5370",
        "street_address": "2261 W Route 70",
        "city": "Cherry Hill",
        "state": "NJ",
        "zip": "08002",
        "latitude": 39.9275,
        "longitude": -75.0112,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.porschecherryhill.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "RAY_CATENA_EDISON",
        "name": "Ray Catena Porsche",
        "domain": "raycatenaporsche.com",
        "phone": "(732) 205-9000",
        "street_address": "920 US Highway 1",
        "city": "Edison",
        "state": "NJ",
        "zip": "08817",
        "latitude": 40.5284,
        "longitude": -74.3725,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.raycatenaporsche.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "PORSCHE_ENGLEWOOD",
        "name": "Porsche Englewood",
        "domain": "porscheenglewood.com",
        "phone": "(201) 816-6000",
        "street_address": "105 Grand Avenue",
        "city": "Englewood",
        "state": "NJ",
        "zip": "07631",
        "latitude": 40.8929,
        "longitude": -73.9726,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.porscheenglewood.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "PORSCHE_FLEMINGTON",
        "name": "Porsche Flemington",
        "domain": "porscheflemington.com",
        "phone": "(908) 782-2025",
        "street_address": "Rt 202-31 South",
        "city": "Flemington",
        "state": "NJ",
        "zip": "08822",
        "latitude": 40.5050,
        "longitude": -74.8580,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.porscheflemington.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "PORSCHE_PRINCETON",
        "name": "Porsche Princeton",
        "domain": "porscheprinceton.com",
        "phone": "(609) 945-1500",
        "street_address": "3333 US-1",
        "city": "Lawrenceville",
        "state": "NJ",
        "zip": "08648",
        "latitude": 40.2974,
        "longitude": -74.6853,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.porscheprinceton.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "PAUL_MILLER_PARSIPPANY",
        "name": "Paul Miller Porsche",
        "domain": "paulmillerporsche.com",
        "phone": "(973) 227-3000",
        "street_address": "3419 Route 46",
        "city": "Parsippany",
        "state": "NJ",
        "zip": "07054",
        "latitude": 40.8710,
        "longitude": -74.3750,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.paulmillerporsche.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "JACK_DANIELS_USR",
        "name": "Jack Daniels Porsche",
        "domain": "jackdanielsporsche.com",
        "phone": "(201) 368-7300",
        "street_address": "335 NJ-17",
        "city": "Upper Saddle River",
        "state": "NJ",
        "zip": "07458",
        "latitude": 41.0435,
        "longitude": -74.1030,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.jackdanielsporsche.com/new-inventory/index.htm"
    },
    {
        "dealer_code": "PORSCHE_MONMOUTH",
        "name": "Porsche Monmouth",
        "domain": "porschemonmouth.com",
        "phone": "(732) 542-0707",
        "street_address": "280 NJ-36",
        "city": "West Long Branch",
        "state": "NJ",
        "zip": "07764",
        "latitude": 40.3015,
        "longitude": -74.0260,
        "cms_platform": "Dealer.com",
        "inventory_url": "https://www.porschemonmouth.com/new-inventory/index.htm"
    }
]

# Standard Porsche Factory Option Codes Catalog (PR Codes)
PORSCHE_OPTION_CATALOG = {
    "8LH": {
        "name": "Sport Chrono Package with Mode Switch & Track Precision App",
        "category": "performance",
        "price": 2790,
        "description": "Analog and digital stopwatch, steering wheel mode dial with Sport Response button, launch control"
    },
    "0P9": {
        "name": "Sport Exhaust System with Tailpipes in High Gloss Black",
        "category": "performance",
        "price": 2950,
        "description": "Switchable active exhaust valves with dual sports tailpipes"
    },
    "0P8": {
        "name": "Sport Exhaust System with Tailpipes in Silver",
        "category": "performance",
        "price": 2950,
        "description": "Switchable active exhaust valves with polished stainless steel tailpipes"
    },
    "2UH": {
        "name": "Front Axle Lift System",
        "category": "performance",
        "price": 2770,
        "description": "Electro-hydraulic front suspension lift adding ~40mm ground clearance"
    },
    "1LX": {
        "name": "Porsche Ceramic Composite Brakes (PCCB) with Black Calipers",
        "category": "performance",
        "price": 9650,
        "description": "410mm carbon-fiber reinforced ceramic brake discs with 6-piston monobloc calipers"
    },
    "1P7": {
        "name": "Porsche Dynamic Chassis Control Sport (PDCC)",
        "category": "performance",
        "price": 3170,
        "description": "Active electromechanical roll stabilization system"
    },
    "0N5": {
        "name": "Rear-Axle Steering",
        "category": "performance",
        "price": 2090,
        "description": "Active rear-wheel steering for tighter turning radius and high-speed stability"
    },
    "1BV": {
        "name": "PASM Sport Suspension (-10mm lower)",
        "category": "performance",
        "price": 1020,
        "description": "Stiffer sport dampers and shorter springs with aerodynamically optimized front lip"
    },
    "Q1J": {
        "name": "Adaptive Sports Seats Plus (18-Way) with Memory Package",
        "category": "interior",
        "price": 3030,
        "description": "Power adjustable side bolsters, lumbar support, and memory presets"
    },
    "Q4Q": {
        "name": "Full Bucket Carbon Fiber Seats",
        "category": "interior",
        "price": 5900,
        "description": "Lightweight carbon-fiber reinforced plastic (CFRP) shell seats"
    },
    "9VJ": {
        "name": "Burmester® High-End 3D Surround Sound System",
        "category": "audio_tech",
        "price": 5560,
        "description": "13 individually controlled loudspeakers, 855 watts, ribbon tweeters & active subwoofer"
    },
    "9VL": {
        "name": "BOSE® Surround Sound System",
        "category": "audio_tech",
        "price": 1600,
        "description": "12 loudspeakers with 570 watts of output and AudioPilot noise compensation"
    },
    "3FE": {
        "name": "Electric Slide/Tilt Sunroof in Glass",
        "category": "exterior",
        "price": 2000,
        "description": "Tinted laminated safety glass with integrated wind deflector"
    },
    "8JU": {
        "name": "LED-Matrix Design Headlights in Black with PDLS+",
        "category": "exterior",
        "price": 3270,
        "description": "Darkened headlight components with 84 individually controlled matrix LEDs"
    },
    "4D3": {
        "name": "Ventilated Front Seats (Cooling & Heating)",
        "category": "interior",
        "price": 840,
        "description": "Three-stage seat ventilation with active perforated cooling"
    },
    "5TX": {
        "name": "Interior Trim in Matte Carbon Fiber",
        "category": "interior",
        "price": 2100,
        "description": "Dashboard trim, door panels, and center console inlay in matte carbon fiber"
    },
    "KA6": {
        "name": "Surround View 3D Camera System",
        "category": "audio_tech",
        "price": 1430,
        "description": "360-degree overhead vehicle perspective with active curb-view guidelines"
    },
    "7Y1": {
        "name": "Lane Change Assist (Blind Spot Monitoring)",
        "category": "audio_tech",
        "price": 1060,
        "description": "Radar-based blind-spot warning indicators in side mirrors"
    },
    "PTS": {
        "name": "Paint to Sample (Porsche Exclusive Manufaktur)",
        "category": "exterior",
        "price": 14750,
        "description": "Historical or bespoke custom paint finish (e.g. Brewster Green, Viola Metallic, Rubystar)"
    }
}

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_database():
    """Initializes schema and seeds all 8 New Jersey Porsche dealerships."""
    conn = get_connection()
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    
    # Seed Dealers
    for d in PORSCHE_NJ_DEALERS:
        conn.execute("""
            INSERT OR REPLACE INTO dealers (
                dealer_code, name, domain, phone, street_address, city, state, zip,
                latitude, longitude, cms_platform, inventory_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            d["dealer_code"], d["name"], d["domain"], d["phone"], d["street_address"],
            d["city"], d["state"], d["zip"], d["latitude"], d["longitude"],
            d["cms_platform"], d["inventory_url"]
        ))
    conn.commit()
    conn.close()
    print(f"✅ Database initialized at {DB_PATH} with 8 NJ Porsche Centers.")

def resolve_window_sticker_url(vin, dealer_domain, custom_sticker_url=None):
    """
    Resolves the Monroney window sticker URL:
    - Direct dealer PDF / digital window sticker
    - Dealer.com Monroney proxy endpoint
    """
    if custom_sticker_url and custom_sticker_url.startswith("http"):
        return custom_sticker_url
    
    # Standard Dealer.com Monroney Window Sticker URL generator used by NJ dealers
    return f"https://windowsticker.dealer.com/?vin={vin}"

def sync_daily_inventory(scraped_records, today_str=None):
    """
    Ingests daily crawl with factory option codes, window stickers, and price deltas.
    """
    if today_str is None:
        today_str = datetime.date.today().isoformat()

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO scrape_runs (run_date, started_at, status)
        VALUES (?, datetime('now'), 'Running')
    """, (today_str,))
    run_id = cursor.lastrowid

    dealers_map = {row["dealer_code"]: row for row in cursor.execute("SELECT id, dealer_code, domain FROM dealers")}

    new_added = 0
    prices_changed = 0
    seen_vins_today = set()

    for item in scraped_records:
        vin = item["vin"].strip().upper()
        dealer_code = item["dealer_code"]
        dealer_info = dealers_map.get(dealer_code)
        if not dealer_info:
            continue

        dealer_id = dealer_info["id"]
        dealer_domain = dealer_info["domain"]

        seen_vins_today.add(vin)
        current_price = float(item["price"])
        mileage = int(item.get("mileage", 0))
        direct_url = item["direct_url"]
        primary_image = item.get("primary_image_url", "")
        porsche_code = item.get("porsche_code")
        porsche_code_url = f"https://porsche-code.com/{porsche_code}" if porsche_code else None
        
        window_sticker_url = resolve_window_sticker_url(
            vin, dealer_domain, item.get("window_sticker_url")
        )

        # Parse Option Codes & Total Option Cost
        raw_options = item.get("option_codes", []) or item.get("options", [])
        parsed_options = []
        total_options_price = 0.0

        for opt in raw_options:
            if isinstance(opt, str):
                code = opt.strip().upper()
                meta = PORSCHE_OPTION_CATALOG.get(code, {
                    "name": f"Option {code}",
                    "category": "package",
                    "price": 0,
                    "description": ""
                })
                parsed_options.append({
                    "code": code,
                    "name": meta["name"],
                    "category": meta["category"],
                    "price": meta["price"],
                    "description": meta.get("description", "")
                })
                total_options_price += meta["price"]
            elif isinstance(opt, dict):
                code = opt.get("code", "").upper()
                price = float(opt.get("price", 0))
                parsed_options.append({
                    "code": code,
                    "name": opt.get("name", f"Option {code}"),
                    "category": opt.get("category", "performance"),
                    "price": price,
                    "description": opt.get("description", "")
                })
                total_options_price += price

        base_msrp = float(item.get("base_msrp", current_price - total_options_price))
        msrp = float(item.get("msrp", base_msrp + total_options_price))

        # Check existing vehicle
        cursor.execute("SELECT id, current_price, original_price, first_seen_date, status FROM vehicles WHERE vin = ?", (vin,))
        existing = cursor.fetchone()

        if existing:
            vehicle_id = existing["id"]
            old_price = float(existing["current_price"])
            first_seen = existing["first_seen_date"]

            d1 = datetime.date.fromisoformat(first_seen)
            d2 = datetime.date.fromisoformat(today_str)
            days_on_lot = max(1, (d2 - d1).days)
            price_delta = current_price - old_price

            if abs(price_delta) > 0.01:
                prices_changed += 1

            cursor.execute("""
                UPDATE vehicles 
                SET current_price = ?, last_seen_date = ?, days_on_lot = ?, 
                    status = 'Active', consecutive_missing_days = 0, direct_url = ?, 
                    window_sticker_url = ?, porsche_code = ?, porsche_code_url = ?,
                    primary_image_url = ?, base_msrp = ?, total_options_price = ?, msrp = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            """, (
                current_price, today_str, days_on_lot, direct_url,
                window_sticker_url, porsche_code, porsche_code_url,
                primary_image, base_msrp, total_options_price, msrp, vehicle_id
            ))

            cursor.execute("""
                INSERT OR REPLACE INTO price_history (vehicle_id, vin, price, price_delta, mileage, status, snapshot_date)
                VALUES (?, ?, ?, ?, ?, 'Active', ?)
            """, (vehicle_id, vin, current_price, price_delta, mileage, today_str))

        else:
            # New Listing
            new_added += 1
            cursor.execute("""
                INSERT INTO vehicles (
                    vin, dealer_id, stock_number, year, make, model, trim, body_style,
                    transmission, drivetrain, engine, exterior_color, interior_color,
                    mileage, condition, status, inventory_stage, base_msrp, total_options_price,
                    current_price, original_price, msrp, direct_url, porsche_code,
                    porsche_code_url, window_sticker_url, primary_image_url, first_seen_date,
                    last_seen_date, days_on_lot
                ) VALUES (?, ?, ?, ?, 'Porsche', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                vin, dealer_id, item.get("stock_number"), item["year"], item["model"],
                item.get("trim", ""), item.get("body_style", "Coupe"), item.get("transmission", "PDK"),
                item.get("drivetrain", "RWD"), item.get("engine", ""), item.get("exterior_color", ""),
                item.get("interior_color", ""), mileage, item.get("condition", "New"),
                item.get("inventory_stage", "On-Lot"), base_msrp, total_options_price,
                current_price, current_price, msrp, direct_url, porsche_code,
                porsche_code_url, window_sticker_url, primary_image, today_str, today_str
            ))
            vehicle_id = cursor.lastrowid

            cursor.execute("""
                INSERT INTO price_history (vehicle_id, vin, price, price_delta, mileage, status, snapshot_date)
                VALUES (?, ?, ?, 0, ?, 'Active', ?)
            """, (vehicle_id, vin, current_price, mileage, today_str))

            # Store Factory Options
            for opt in parsed_options:
                cursor.execute("""
                    INSERT OR REPLACE INTO vehicle_options (vehicle_id, vin, option_code, option_name, category, price, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (vehicle_id, vin, opt["code"], opt["name"], opt["category"], opt["price"], opt.get("description", "")))

    # Detect Sold / Missing VINs
    cursor.execute("SELECT id, vin, consecutive_missing_days, first_seen_date FROM vehicles WHERE status = 'Active'")
    active_vehicles = cursor.fetchall()
    marked_sold = 0

    for row in active_vehicles:
        if row["vin"] not in seen_vins_today:
            miss_count = row["consecutive_missing_days"] + 1
            if miss_count >= 3:
                marked_sold += 1
                cursor.execute("""
                    UPDATE vehicles 
                    SET status = 'Sold', sold_date = ?, consecutive_missing_days = ?, updated_at = datetime('now')
                    WHERE id = ?
                """, (today_str, miss_count, row["id"]))
            else:
                cursor.execute("UPDATE vehicles SET consecutive_missing_days = ? WHERE id = ?", (miss_count, row["id"]))

    cursor.execute("""
        UPDATE scrape_runs 
        SET finished_at = datetime('now'), status = 'Success', dealers_scraped = 8,
            total_vehicles_found = ?, new_vehicles_added = ?, prices_changed = ?, vehicles_marked_sold = ?
        WHERE id = ?
    """, (len(scraped_records), new_added, prices_changed, marked_sold, run_id))

    conn.commit()
    conn.close()

def get_active_inventory_for_website(model=None, max_price=None, condition=None):
    """Fetches active inventory with window stickers and options breakdown."""
    conn = get_connection()
    query = "SELECT * FROM v_active_inventory WHERE 1=1"
    params = []

    if model:
        query += " AND model = ?"
        params.append(model)
    if max_price:
        query += " AND current_price <= ?"
        params.append(max_price)
    if condition:
        query += " AND condition = ?"
        params.append(condition)

    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_vehicle_full_options(vin):
    """Retrieves normalized factory options build sheet for a specific VIN."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT option_code, option_name, category, price, description 
        FROM vehicle_options 
        WHERE vin = ? 
        ORDER BY price DESC
    """, (vin,))
    options = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return options

if __name__ == "__main__":
    init_database()

def get_vehicle_price_history(vin):
    """Returns the historical daily price timeline for a specific VIN."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT snapshot_date, price, price_delta, status 
        FROM price_history 
        WHERE vin = ? 
        ORDER BY snapshot_date ASC
    """, (vin,))
    history = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return history

def get_top_price_drops():
    """Returns vehicles with the biggest price cuts across NJ dealers."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM v_top_price_drops LIMIT 15")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows
