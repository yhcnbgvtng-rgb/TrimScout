"""GM-brand dealer roster from the quantum dealer locator (cadillac.com / buick.com / gmc.com share it).

The endpoint needs the `clientapplicationid: quantum` header (400 without it) and browser TLS (Akamai), caps
at 50 per call, and takes a lat/lng + distance (miles). The US is walked on a 1° grid with 80-mile circles;
a cell that returns 50 is re-queried at quarter offsets with half the radius.

  python3 ../crawl_gm_quantum.py cadillac roster_raw.json
"""
import json, sys, time
from curl_cffi import requests

BRANDS = {"cadillac": ("www.cadillac.com", "006"), "buick": ("www.buick.com", "001"), "gmc": ("www.gmc.com", "003")}

def fetch(session, host, make, lat, lng, miles):
    r = session.get(f"https://{host}/bypass/pcf/quantum-dealer-locator/v1/getDealers", params={"desiredCount": 50, "distance": miles, "makeCodes": make, "serviceCodes": "", "latitude": lat, "longitude": lng, "searchType": "latLongSearch"},
                    impersonate="chrome124", timeout=40, headers={"clientapplicationid": "quantum", "locale": "en-US", "Content-Type": "application/json; charset=utf-8", "Referer": f"https://{host}/locate-dealer", "Accept": "application/json"})
    r.raise_for_status()
    return ((r.json().get("payload") or {}).get("dealers")) or []

def main():
    brand, out_path = sys.argv[1], sys.argv[2]
    host, make = BRANDS[brand]
    out, calls, cells = {}, 0, []
    for lat in range(24, 50):
        for lng in range(-125, -66):
            cells.append((lat + 0.5, lng + 0.5, 80))
    for lat in range(54, 72, 3):
        for lng in range(-170, -129, 3):
            cells.append((lat + 1.5, lng + 1.5, 200))
    for lat in range(18, 23, 3):
        for lng in range(-161, -153, 3):
            cells.append((lat + 1.5, lng + 1.5, 200))
    session = requests.Session()
    while cells:
        lat, lng, miles = cells.pop()
        try:
            ds = fetch(session, host, make, lat, lng, miles); calls += 1
        except Exception as e:
            print("retry", (lat, lng), str(e)[:100], flush=True); time.sleep(3); cells.append((lat, lng, miles)); continue
        if len(ds) >= 50 and miles > 20:
            q = miles / 2
            cells += [(lat + 0.25, lng + 0.25, q), (lat - 0.25, lng + 0.25, q), (lat + 0.25, lng - 0.25, q), (lat - 0.25, lng - 0.25, q)]
        for d in ds:
            a = d.get("address") or {}
            sales = next((x for x in d.get("departments") or [] if (x.get("name") or "").lower() == "sales"), None)
            geo = (sales or {}).get("geoLocation") or {}
            out[d["dealerCode"]] = {"code": d["dealerCode"], "bac": d.get("bac"), "name": (d.get("dealerName") or "").strip(), "address1": a.get("addressLine1"), "city": a.get("cityName"), "state": a.get("countrySubdivisionCode"),
                                    "zip": a.get("postalCodeFormatted") or (a.get("postalCode") or "")[:5], "phone": (sales or {}).get("phoneNumber") or d.get("phoneNumber"), "url": d.get("dealerUrl"),
                                    "latitude": geo.get("latitude"), "longitude": geo.get("longitude"), "hasSales": sales is not None}
        if calls % 200 == 0:
            print(f"progress: {calls} calls, {len(out)} dealers, {len(cells)} cells left", flush=True)
    rows = [d for d in out.values() if d["state"] not in ("PR", "GU", "VI")]
    json.dump(sorted(rows, key=lambda d: (d["state"] or "", d["name"])), open(out_path, "w"), indent=1)
    print("FINAL:", len(out), "seen;", len(rows), "kept;", calls, "calls")

if __name__ == "__main__":
    main()
