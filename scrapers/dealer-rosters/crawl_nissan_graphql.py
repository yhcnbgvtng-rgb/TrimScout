"""Nissan / INFINITI dealer roster from graphql.nissanusa.com (the AppSync API behind both brands' retailer
locators; public x-api-key, Akamai-fronted so the call needs browser TLS impersonation — plain curl gets 403).

getDealersByLatLng caps at 100 per call and `radius` is in km, so the US is walked on a 2° lat/lng grid with
a 170 km radius; any cell that returns 100 is re-queried at four half-offsets with half the radius. Paced
at ~1 call/s — faster than that and the Akamai edge starts answering 403.

  python3 ../crawl_nissan_graphql.py nissan roster_raw.json
  python3 ../crawl_nissan_graphql.py infiniti roster_raw.json
"""
import json, sys, time
from curl_cffi import requests

URL = "https://graphql.nissanusa.com/graphql"
API_KEY = "da2-3gadjirlkbfdzg7fiosg4tewl4"
QUERY = """query getDealersBaseInfoByLatLng($market: Market!, $location: Geolocation!, $size: Int, $radius: Int, $isMarketingDealer: Boolean) {
  getDealersByLatLng(market: $market, location: $location, isMarketingDealer: $isMarketingDealer, size: $size, radius: $radius) {
    id name address { addressLine1 addressLine2 city state stateCode postalCode } phoneNumber distance { miles } services websiteURL geolocation { latitude longitude } } }"""

def fetch(session, brand, lat, lng, radius_km):
    body = {"operationName": "getDealersBaseInfoByLatLng", "query": QUERY,
            "variables": {"market": {"lang": "en", "region": "us", "brand": brand, "application": "inventory"}, "location": {"latitude": lat, "longitude": lng}, "size": 100, "radius": radius_km, "isMarketingDealer": False}}
    r = session.post(URL, json=body, impersonate="chrome124", timeout=60, headers={"x-api-key": API_KEY, "Origin": f"https://www.{brand}usa.com", "Referer": f"https://www.{brand}usa.com/"})
    r.raise_for_status()
    data = r.json()
    if data.get("errors"):
        raise RuntimeError(data["errors"][0].get("message"))
    return (data.get("data") or {}).get("getDealersByLatLng") or []

def main():
    brand, out_path = sys.argv[1], sys.argv[2]
    out, calls, cells = {}, 0, []
    for lat in range(24, 50, 2):                    # CONUS on a 2° grid, 170 km circles (corners are 157 km out)
        for lng in range(-125, -66, 2):
            cells.append((lat + 1.0, lng + 1.0, 170))
    for lat in range(54, 72, 3):                    # Alaska / Hawaii: coarse 3° grid, 250 km circles
        for lng in range(-170, -129, 3):
            cells.append((lat + 1.5, lng + 1.5, 250))
    for lat in range(18, 23, 3):
        for lng in range(-161, -153, 3):
            cells.append((lat + 1.5, lng + 1.5, 250))
    session, fails = requests.Session(), 0
    while cells:
        lat, lng, radius = cells.pop()
        try:
            ds = fetch(session, brand, lat, lng, radius); calls += 1; fails = 0
            time.sleep(0.8)                             # the edge starts 403ing at a few calls/sec
        except Exception as e:
            fails += 1
            print("retry", (lat, lng), str(e)[:100], "backoff", min(300, 15 * fails), flush=True)
            time.sleep(min(300, 15 * fails)); session = requests.Session(); cells.append((lat, lng, radius)); continue
        if len(ds) >= 100 and radius > 30:
            q, off = radius / 2, 0.5
            cells += [(lat + off, lng + off, q), (lat - off, lng + off, q), (lat + off, lng - off, q), (lat - off, lng - off, q)]
        for d in ds:
            a = d.get("address") or {}
            g = d.get("geolocation") or {}
            out[d["id"]] = {"code": d["id"], "name": (d.get("name") or "").strip(), "address1": a.get("addressLine1"), "city": a.get("city"), "state": a.get("stateCode") or a.get("state"), "zip": (a.get("postalCode") or "")[:5],
                            "phone": d.get("phoneNumber"), "url": d.get("websiteURL"), "latitude": g.get("latitude"), "longitude": g.get("longitude"), "services": d.get("services") or []}
        if calls % 200 == 0:
            print(f"progress: {calls} calls, {len(out)} dealers, {len(cells)} cells left", flush=True)
    rows = [d for d in out.values() if d["state"] not in ("PR", "GU", "VI")]
    json.dump(sorted(rows, key=lambda d: (d["state"] or "", d["name"])), open(out_path, "w"), indent=1)
    print("FINAL:", len(out), "seen;", len(rows), "kept;", calls, "calls")

if __name__ == "__main__":
    main()
