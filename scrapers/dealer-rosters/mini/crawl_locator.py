"""MINI dealer roster from miniusa.com's locator service (nearest-N to a ZIP; radius 3000 returns the whole
network from one query, so a few spread ZIPs union to the full list). Feed carries a dealerEmail (often a
named person's address) and dealer URL.

  python3 crawl_locator.py roster_raw.json
"""
import json, sys
import httpx

URL = "https://www.miniusa.com/bin/services/dealer-locator/getAllDealerByZip.json/{zip}/3000?excludeServiceOnlyDealers=false&includeSatelliteDealers=true"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "Accept": "application/json", "Referer": "https://www.miniusa.com/tools/shopping/find-a-dealer.html"}
ZIPS = ["66101", "07405", "90001", "33101", "98101", "80202", "75201", "30301", "60601", "85001", "97201", "55401", "63101", "96813", "99501", "04101", "59601", "87101"]

def main():
    out = {}
    with httpx.Client(http2=False) as client:
        for z in ZIPS:
            r = client.get(URL.format(zip=z), headers=HEADERS, timeout=40)
            r.raise_for_status()
            objs = (((r.json().get("dealerLocator") or {}).get("dealerDetails") or {}).get("dealerDetailsObjects")) or []
            for o in objs:
                for s in o.get("newVehicleSales") or []:
                    if s.get("serviceOnlyCenter") or s.get("NonMini") == "true":
                        continue
                    a = (s.get("address") or [{}])[0]
                    url = (s.get("dealerURL") or "").strip()
                    out[s["dpNumber"]] = {"code": s["dpNumber"], "name": (s.get("dealerName") or "").strip(), "address1": a.get("lineOne"), "city": a.get("city"), "state": a.get("state"), "zip": (a.get("zipcode") or "")[:5],
                                          "phone": s.get("phoneNumber"), "url": url if not url or url.startswith("http") else "https://" + url, "latitude": s.get("latitude"), "longitude": s.get("longitude"),
                                          "dealerEmail": (s.get("dealerEmail") or "").strip().lower()}
            print(f"{z}: {len(objs)} objects, {len(out)} unique so far", flush=True)
    rows = [d for d in out.values() if d["state"] not in ("PR", "GU", "VI")]
    json.dump(sorted(rows, key=lambda d: (d["state"] or "", d["name"])), open(sys.argv[1], "w"), indent=1)
    print("FINAL:", len(rows), "dealers")

if __name__ == "__main__":
    main()
