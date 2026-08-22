#!/usr/bin/env python3
import sys
sys.path.insert(0, '/Users/paul/Library/Python/3.9/lib/python/site-packages')

import sqlite3
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DB_PATH = os.path.join(os.path.dirname(__file__), "bmw_inventory.db")
EXCEL_PATH = os.path.join(os.path.dirname(__file__), "BMW_USA_Nationwide_Inventory_Tracker.xlsx")
NJ_EXCEL_PATH = os.path.join(os.path.dirname(__file__), "BMW_Inventory_Tracker.xlsx")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("SELECT id, vin, series, model, direct_url, dealer_id FROM vehicles")
vehicles = c.fetchall()

for v in vehicles:
    vid = v["id"]
    vin = v["vin"]
    model = v["model"]
    series = v["series"]
    old_url = v["direct_url"]
    
    if ".htm" in old_url and ("-for-sale-" in old_url or len(old_url.split('/')[-1]) > 30) and "search=" not in old_url:
        new_url = old_url
    else:
        c.execute("SELECT domain FROM dealers WHERE id = ?", (v["dealer_id"],))
        d_row = c.fetchone()
        domain = d_row["domain"] if d_row else "circlebmw.com"
        
        model_param = series
        if "X5" in series or "X5" in model:
            model_param = "X5"
        elif "iX" in series or "iX" in model:
            model_param = "iX"
        elif "3 Series" in series or "330" in model or "M340" in model:
            model_param = "3%20Series"
        elif "M3" in series or "M3" in model:
            model_param = "M3"
        elif "M4" in series or "M4" in model:
            model_param = "M4"
        elif "M5" in series or "M5" in model:
            model_param = "M5"
        elif "7 Series" in series or "760" in model:
            model_param = "7%20Series"
        elif "X3" in series or "X3" in model:
            model_param = "X3"
        elif "i4" in series or "i4" in model:
            model_param = "i4"
            
        if domain == "bmwnewton.com":
            new_url = f"https://bmwnewton.com/inventory"
        else:
            new_url = f"https://www.{domain}/new-inventory/index.htm?model={model_param}"
            
    c.execute("UPDATE vehicles SET direct_url = ? WHERE id = ?", (new_url, vid))

conn.commit()
conn.close()
print(f"✅ Updated direct links for {len(vehicles)} vehicles in database.")

import bmw_tracker as tracker
tracker.export_nationwide_bmw_excel(EXCEL_PATH)
tracker.export_nationwide_bmw_excel(NJ_EXCEL_PATH)
print("✅ Rebuilt Excel workbooks successfully.")
