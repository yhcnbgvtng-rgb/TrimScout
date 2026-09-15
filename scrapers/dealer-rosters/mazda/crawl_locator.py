"""Mazda dealer roster from mazdausa.com's find-a-dealer handler (zip + maxDistance, 20 per page).

The locator publishes per-department phone/email pairs; "Sales" / "Internet sales" emails are kept as dealerEmail
(lead inbox) and the full department list as `departments` so merge_generic can pair a staff-page name to it.

  python3 crawl_locator.py ../query_zips.json roster_raw.json
"""
import asyncio, json, sys
import httpx

URL = "https://www.mazdausa.com/handlers/dealer.ajax"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "Accept": "application/json", "Referer": "https://www.mazdausa.com/find-a-dealer"}
SALES_TYPES = ("internet sales", "sales", "new", "general")

def pick_email(phones):
    by_type = {(p.get("type") or "").strip().lower(): (p.get("email") or "").strip() for p in phones or [] if (p.get("email") or "").strip()}
    for t in SALES_TYPES:
        if by_type.get(t):
            return by_type[t]
    return ""

async def fetch_page(client, zip_, page):
    r = await client.get(URL, params={"zip": zip_, "maxDistance": 150, "p": page}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    body = r.json().get("body") or {}
    return body.get("results") or [], int(body.get("total") or 0)

async def fetch_one(client, zip_, sem, out, errs):
    async with sem:
        try:
            page = 1
            while True:
                results, total = await fetch_page(client, zip_, page)
                for d in results:
                    phones = d.get("phones") or []
                    out[d["id"]] = {"code": d["id"], "name": d.get("name"), "address1": d.get("address1"), "city": d.get("city"), "state": d.get("state"), "zip": d.get("zip"),
                                    "phone": d.get("dayPhone"), "url": d.get("webUrl"), "latitude": d.get("lat"), "longitude": d.get("long"),
                                    "dealerEmail": pick_email(phones),
                                    "departments": [{"type": p.get("type"), "email": p.get("email")} for p in phones if (p.get("email") or "").strip()]}
                if not results or page * 20 >= total:
                    break
                page += 1
        except Exception as e:
            errs.append((zip_, str(e)[:80]))

async def main():
    zips = json.load(open(sys.argv[1]))
    out, errs = {}, []
    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient(http2=False) as client:
        tasks = [fetch_one(client, z, sem, out, errs) for z in zips]
        for i in range(0, len(tasks), 100):
            await asyncio.gather(*tasks[i:i + 100])
            print(f"progress: {min(i + 100, len(tasks))}/{len(tasks)} zips, {len(out)} dealers, {len(errs)} errors", flush=True)
    json.dump(sorted(out.values(), key=lambda d: (d["state"] or "", d["name"] or "")), open(sys.argv[2], "w"), indent=1)
    print("FINAL:", len(out), "dealers;", len(errs), "zip errors")

if __name__ == "__main__":
    asyncio.run(main())
