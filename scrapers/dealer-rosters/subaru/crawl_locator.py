"""Subaru retailer roster from subaru.com's distance service (nearest N to a ZIP, no radius cap).

  python3 crawl_locator.py ../query_zips.json roster_raw.json
"""
import asyncio, json, sys
import httpx

URL = "https://www.subaru.com/services/dealers/distances/by/zipcode"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "Accept": "application/json", "Referer": "https://www.subaru.com/find/a-retailer.html"}

async def fetch_one(client, zip_, sem, out, errs):
    async with sem:
        try:
            r = await client.get(URL, params={"zipcode": zip_, "count": 40, "type": "Active"}, headers=HEADERS, timeout=25)
            if r.status_code == 200:
                for row in r.json():
                    d = row.get("dealer") or {}
                    a = d.get("address") or {}
                    out[d["id"]] = {"code": d["id"], "name": d.get("name"), "address1": a.get("street"), "city": a.get("city"), "state": a.get("state"), "zip": a.get("zipcode"), "phone": d.get("phoneNumber"), "url": d.get("siteUrl"), "latitude": (d.get("location") or {}).get("latitude"), "longitude": (d.get("location") or {}).get("longitude")}
            else:
                errs.append((zip_, r.status_code))
        except Exception as e:
            errs.append((zip_, str(e)[:80]))

async def main():
    zips = json.load(open(sys.argv[1]))
    out, errs = {}, []
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(http2=False) as client:
        tasks = [fetch_one(client, z, sem, out, errs) for z in zips]
        for i in range(0, len(tasks), 100):
            await asyncio.gather(*tasks[i:i + 100])
            print(f"progress: {min(i + 100, len(tasks))}/{len(tasks)} zips, {len(out)} dealers, {len(errs)} errors", flush=True)
    json.dump(sorted(out.values(), key=lambda d: (d["state"] or "", d["name"] or "")), open(sys.argv[2], "w"), indent=1)
    print("FINAL:", len(out), "dealers;", len(errs), "zip errors")

if __name__ == "__main__":
    asyncio.run(main())
