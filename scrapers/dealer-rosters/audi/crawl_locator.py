"""Audi dealer roster from Audi's omnigraph GraphQL (the feature app behind audiusa.com/en/dealer-locator/).

dealersByGeoArea caps at 100 per call, so the US is tiled into 2°×2° cells (a cell that still hits 100 is
split in four). No GM/email in the feed.

  python3 crawl_locator.py roster_raw.json
"""
import json, sys, time
import httpx

URL = "https://omnigraph.audi.com/graphql"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
           "Content-Type": "application/json", "apollographql-client-name": "@oneaudi/fa-dealer-search", "apollographql-client-version": "4.8.8", "Origin": "https://www.audiusa.com"}
QUERY = """query Dealer($neLat: Float!, $neLng: Float!, $swLat: Float!, $swLng: Float!, $country: String, $language: String) {
  dealersByGeoArea(northEastLat: $neLat, northEastLng: $neLng, southWestLat: $swLat, southWestLng: $swLng, country: $country, language: $language) {
    dealers { dealerId kvpsId name displayName phone url email address services longitude latitude } meta { resultCount } } }"""

def fetch(client, sw_lat, sw_lng, ne_lat, ne_lng):
    r = client.post(URL, headers=HEADERS, json={"query": QUERY, "variables": {"neLat": ne_lat, "neLng": ne_lng, "swLat": sw_lat, "swLng": sw_lng, "country": "USA", "language": "en"}}, timeout=40)
    r.raise_for_status()
    body = r.json()
    if "errors" in body:
        raise RuntimeError(body["errors"][0].get("message"))
    return body["data"]["dealersByGeoArea"]["dealers"]

def main():
    out, cells, calls = {}, [], 0
    for lat in range(17, 72, 2):
        for lng in range(-180, -50, 2):
            cells.append((lat, lng, lat + 2, lng + 2))
    with httpx.Client(http2=False) as client:
        while cells:
            sw_lat, sw_lng, ne_lat, ne_lng = cells.pop()
            try:
                ds = fetch(client, sw_lat, sw_lng, ne_lat, ne_lng); calls += 1
            except Exception as e:
                print("retry", (sw_lat, sw_lng), str(e)[:80], flush=True); time.sleep(2); cells.append((sw_lat, sw_lng, ne_lat, ne_lng)); continue
            if len(ds) >= 100:
                mid_lat, mid_lng = (sw_lat + ne_lat) / 2, (sw_lng + ne_lng) / 2
                cells += [(sw_lat, sw_lng, mid_lat, mid_lng), (mid_lat, sw_lng, ne_lat, mid_lng), (sw_lat, mid_lng, mid_lat, ne_lng), (mid_lat, mid_lng, ne_lat, ne_lng)]
                continue
            for d in ds:
                addr = d.get("address") or []
                last = (addr[-1] if addr else "").split()
                state, zip_ = (last[-2], last[-1]) if len(last) >= 2 else ("", "")
                out[d["dealerId"]] = {"code": d["dealerId"], "name": (d.get("displayName") or d.get("name") or "").strip(), "address1": addr[0] if addr else "", "city": " ".join(last[:-2]) if len(last) > 2 else "",
                                      "state": state, "zip": zip_, "phone": d.get("phone"), "url": (d.get("url") or "").replace("/en/", "/") if (d.get("url") or "").endswith("/en/") else d.get("url"),
                                      "latitude": d.get("latitude"), "longitude": d.get("longitude"), "dealerEmail": d.get("email") or "", "services": d.get("services") or []}
            if calls % 100 == 0:
                print(f"progress: {calls} calls, {len(out)} dealers, {len(cells)} cells left", flush=True)
    rows = [d for d in out.values() if "sales" in d["services"] and d["state"] not in ("PR", "GU", "VI")]
    json.dump(sorted(rows, key=lambda d: (d["state"], d["name"])), open(sys.argv[1], "w"), indent=1)
    print("FINAL:", len(out), "dealers seen;", len(rows), "sales rooftops kept;", calls, "calls")

if __name__ == "__main__":
    main()
