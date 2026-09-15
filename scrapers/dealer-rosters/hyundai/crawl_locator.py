"""Hyundai dealer roster from hyundaiusa.com's locator (a plain JSON service).

  python3 crawl_locator.py ../query_zips.json roster_raw.json

950 US ZIPs × radius 150 mi × maxdealers=200 → every rooftop the locator knows, de-duped by
dealerCd. Fields worth keeping: dealerNm, address, city, state, zipCd,
phone, dealerUrl, generalManager, principalNm, dealerEmail, otherDealerNm
(a co-located Genesis store), isLocatorActive.
"""
import asyncio, json, sys
import httpx

BASE = "https://www.hyundaiusa.com/var/hyundai/services/dealer/dealersByZip.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Referer": "https://www.hyundaiusa.com/us/en/dealer-locator",
    "Accept": "application/json",
}
KEEP = ["dealerCd", "dealerNm", "otherDealerNm", "address1", "address2", "city", "state", "zipCd", "phone", "dealerUrl", "cobaltDealerURL",
        "generalManager", "principalNm", "dealerEmail", "isLocatorActive", "isAcceptsLeads", "latitude", "longitude", "region", "dealerTypeCd"]

async def fetch_one(client, zip_, sem, out, errs):
    async with sem:
        try:
            r = await client.get(BASE, params={"brand": "hyundai", "model": "all", "lang": "en", "zip": zip_, "maxdealers": 200, "radius": 150}, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                for d in r.json().get("dealers", []):
                    out[d["dealerCd"]] = {k: d.get(k) for k in KEEP}
            else:
                errs.append((zip_, r.status_code))
        except Exception as e:
            errs.append((zip_, str(e)[:80]))

async def main():
    zips = json.load(open(sys.argv[1]))
    out, errs = {}, []
    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(http2=False) as client:
        tasks = [fetch_one(client, z, sem, out, errs) for z in zips]
        for i in range(0, len(tasks), 100):
            await asyncio.gather(*tasks[i:i + 100])
            print(f"progress: {min(i + 100, len(tasks))}/{len(tasks)} zips, {len(out)} dealers, {len(errs)} errors", flush=True)
    json.dump(sorted(out.values(), key=lambda d: (d["state"] or "", d["dealerNm"] or "")), open(sys.argv[2], "w"), indent=1)
    print("FINAL:", len(out), "dealers;", len(errs), "zip errors")

if __name__ == "__main__":
    asyncio.run(main())
