"""Kia dealer roster from kia.com's locator (POST JSON; returns every dealer within the radius).

  python3 crawl_locator.py ../query_zips.json roster_raw.json

950 US ZIPs × radius 120 mi, de-duped by dealer code. No GM/email in this
feed — name, address, phone, website only; contacts come from staff pages.
"""
import asyncio, json, sys
import httpx

URL = "https://www.kia.com/us/services/en/dealers/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Content-Type": "application/json", "Accept": "application/json",
    "Origin": "https://www.kia.com", "Referer": "https://www.kia.com/us/en/find-a-dealer/result?zipCode=07405",
}

async def fetch_one(client, zip_, sem, out, errs):
    async with sem:
        try:
            r = await client.post(URL, json={"type": "zip", "zipCode": zip_, "radius": "120"}, headers=HEADERS, timeout=25)
            if r.status_code == 200:
                for d in r.json():
                    loc = d.get("location") or {}
                    out[d["code"]] = {"code": d["code"], "name": d.get("name"), "address1": loc.get("street1"), "city": loc.get("city"), "state": loc.get("state"), "zip": loc.get("zipCode"),
                                      "phone": next((p["number"] for p in d.get("phones", []) if p.get("type") == "business"), None) or (d.get("phones") or [{}])[0].get("number"),
                                      "url": d.get("url"), "latitude": loc.get("latitude"), "longitude": loc.get("longitude")}
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
