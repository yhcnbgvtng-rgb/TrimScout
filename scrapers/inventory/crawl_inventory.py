"""Dealer inventory crawler — sitemap → vehicle pages → structured rows.

Platform-agnostic on purpose: every dealer-site platform (dealer.com, DealerOn, Dealer Inspire, Team Velocity,
Overfuel, …) publishes vehicle pages in its sitemaps and embeds schema.org JSON-LD (Vehicle / Car / Product,
or an ItemList of them on listing pages) with VIN, year/make/model/trim, price, mileage, colors and stock
number. So: read robots.txt + sitemaps, keep URLs that look like vehicle pages, fetch each with browser TLS
at a polite per-host pace, and parse the JSON-LD. A page with no JSON-LD falls back to a VIN + slug parse.

  python3 crawl_inventory.py sites.json out.jsonl [--max-per-site 600] [--concurrency 60]

sites.json: [{id, name, state, website, brand}] (the directory rows with a website).
out.jsonl: one line per vehicle: {dealerId, dealerName, vin, condition, year, make, model, trim, bodyStyle,
  exteriorColor, interiorColor, mileage, price, msrp, stockNumber, vdpUrl, imageUrl, seenAt, source}
Resumable: sites already present in out.jsonl (or in <out>.sites.jsonl) are skipped.
"""
import asyncio, json, re, sys, time, html, argparse, collections
from urllib.parse import urljoin, urlparse
from curl_cffi.requests import AsyncSession

VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")
VDP_HINT = re.compile(r"(?i)/(new|used|certified|cpo|pre-owned|inventory|vehicle|vdp|viewdetails|auto)[-/]|[-/](19|20)\d{2}[-/]")
NOT_VDP = re.compile(r"(?i)/(blog|news|specials|service|parts|finance|about|contact|staff|reviews|hours|directions|research|compare|model[-_]?(?:research|info)|showroom|brochure|gallery|category|search|inventory/?$|inventory/(new|used|certified)/?$)|\.(jpg|png|pdf|xml)$|locations_kml|/[a-z-]+/?$")
SITEMAP_KEEP = re.compile(r"(?i)inventory|vehicle|vdp|new|used|certified|cars|listing|srp|product|auto")
LD_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
COND = {"new": "new", "used": "used", "certified": "cpo", "cpo": "cpo", "pre-owned": "used", "preowned": "used"}

def condition_from_url(u):
    m = re.search(r"(?i)/(new|used|certified|cpo|pre-owned|preowned)[-/]", u)
    return COND.get((m.group(1) if m else "").lower(), "")

def slug_ymm(u):
    m = re.search(r"(?i)((?:19|20)\d{2})[-/+ ]([a-z]+)[-/+ ]([a-z0-9]+)", urlparse(u).path)
    return (int(m.group(1)), m.group(2).title(), m.group(3).upper() if len(m.group(3)) <= 3 else m.group(3).title()) if m else (None, "", "")

def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return int(v)
    m = re.search(r"[\d,]+(?:\.\d+)?", str(v))
    return int(float(m.group(0).replace(",", ""))) if m else None

def walk_ld(obj, out):
    if isinstance(obj, list):
        for x in obj: walk_ld(x, out)
    elif isinstance(obj, dict):
        t = obj.get("@type"); t = t if isinstance(t, str) else (t[0] if isinstance(t, list) and t else "")
        if t in ("Vehicle", "Car", "Product", "Motorcycle", "Truck", "AutomobileModel") or obj.get("vehicleIdentificationNumber"):
            out.append(obj)
        for k in ("@graph", "itemListElement", "item", "mainEntity", "offers", "hasVariant"):
            if k in obj: walk_ld(obj[k], out)

def from_ld(obj, url):
    vin = obj.get("vehicleIdentificationNumber") or obj.get("identifier") or obj.get("sku") or ""
    vin = vin if isinstance(vin, str) and VIN_RE.fullmatch(vin.strip()) else ""
    offers = obj.get("offers") or {}
    if isinstance(offers, list): offers = offers[0] if offers else {}
    brand = obj.get("brand") or obj.get("manufacturer") or {}
    brand = brand.get("name") if isinstance(brand, dict) else brand
    color = obj.get("color") or obj.get("vehicleExteriorColor") or ""
    interior = obj.get("vehicleInteriorColor") or ""
    mileage = obj.get("mileageFromOdometer")
    mileage = mileage.get("value") if isinstance(mileage, dict) else mileage
    cond = (obj.get("itemCondition") or offers.get("itemCondition") or "")
    cond = "new" if "New" in str(cond) else ("used" if "Used" in str(cond) or "Refurbished" in str(cond) else "")
    return {"vin": vin, "year": num(obj.get("vehicleModelDate") or obj.get("modelDate") or obj.get("productionDate") or obj.get("releaseDate")),
            "make": (brand or "").strip() if isinstance(brand, str) else "", "model": (obj.get("model") or "").strip() if isinstance(obj.get("model"), str) else (obj.get("model", {}) or {}).get("name", "") if isinstance(obj.get("model"), dict) else "",
            "trim": (obj.get("vehicleConfiguration") or obj.get("trim") or "").strip() if isinstance(obj.get("vehicleConfiguration") or obj.get("trim") or "", str) else "",
            "bodyStyle": (obj.get("bodyType") or "") if isinstance(obj.get("bodyType"), str) else "", "exteriorColor": color if isinstance(color, str) else "", "interiorColor": interior if isinstance(interior, str) else "",
            "mileage": num(mileage), "price": num(offers.get("price")), "msrp": num(obj.get("msrp") or offers.get("priceSpecification", {}).get("price") if isinstance(offers.get("priceSpecification"), dict) else obj.get("msrp")),
            "stockNumber": (obj.get("sku") if obj.get("sku") and not VIN_RE.fullmatch(str(obj.get("sku"))) else "") or "", "condition": cond, "name": obj.get("name") or "",
            "imageUrl": (obj.get("image")[0] if isinstance(obj.get("image"), list) and obj.get("image") else obj.get("image") if isinstance(obj.get("image"), str) else (obj.get("image") or {}).get("url", "") if isinstance(obj.get("image"), dict) else "")}

def parse_vdp(url, text):
    # Platforms split the facts across blocks (DealerOn: a Vehicle with VIN/year/body, then a Product with
    # color/condition/price) — merge every block, first non-empty value wins, VIN from any of them or the URL.
    merged = None
    for m in LD_RE.finditer(text):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except Exception:
            try: data = json.loads(html.unescape(raw))
            except Exception: continue
        found = []; walk_ld(data, found)
        for obj in found:
            row = from_ld(obj, url)
            if merged is None: merged = row
            else:
                for k, v in row.items():
                    if (merged.get(k) in (None, "", 0)) and v not in (None, "", 0): merged[k] = v
    if merged:
        if not merged["vin"]:
            mm = VIN_RE.search(url)
            if mm: merged["vin"] = mm.group(1)
        if merged["vin"]:
            if not merged["trim"] and merged["name"]:
                ymm = " ".join(str(x) for x in (merged["year"], merged["make"], merged["model"]) if x)
                rest = re.sub(re.escape(ymm), "", merged["name"], flags=re.I).strip(" -–|,") if ymm else ""
                if rest and len(rest) <= 40 and not VIN_RE.search(rest): merged["trim"] = rest
            return merged, "jsonld"
    # fallback: VIN + slug
    vin = (VIN_RE.search(url) or VIN_RE.search(re.sub(r"[^A-Z0-9]", " ", text[:200000].upper()) if "VIN" in text[:200000].upper() else "") )
    vin = vin.group(1) if vin else ""
    if not vin: return None, ""
    y, mk, md = slug_ymm(url)
    return {"vin": vin, "year": y, "make": mk, "model": md, "trim": "", "bodyStyle": "", "exteriorColor": "", "interiorColor": "", "mileage": None, "price": None, "msrp": None, "stockNumber": "", "condition": "", "name": "", "imageUrl": ""}, "slug"

async def get(s, url, timeout=25):
    r = await s.get(url, impersonate="chrome124", timeout=timeout)
    return r

async def vehicle_urls(s, base):
    """robots + sitemaps → candidate vehicle-page URLs. Returns (urls, listing_pages)."""
    cands = []
    try:
        rb = await get(s, urljoin(base, "/robots.txt"), 15)
        if rb.status_code == 200: cands += [m.strip() for m in re.findall(r"(?i)sitemap:\s*(\S+)", rb.text)]
    except Exception: pass
    cands += [urljoin(base, p) for p in ("/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemaps/sitemap.xml", "/vehicle-sitemap.xml", "/inventory-sitemap.xml")]
    seen, urls, queue, hops = set(), [], list(dict.fromkeys(cands)), 0
    while queue and hops < 20:
        u = queue.pop(0); hops += 1
        if u in seen: continue
        seen.add(u)
        x = None
        for attempt in range(3):
            try: x = await get(s, u, 25)
            except Exception: x = None; break
            if x.status_code == 429: await asyncio.sleep(8 * (attempt + 1)); continue
            break
        if x is None or x.status_code != 200 or "<" not in x.text[:300]: continue
        locs = [html.unescape(l) for l in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", x.text)]  # sitemaps entity-encode "+" and "&"
        if "<sitemapindex" in x.text[:600] or "<sitemap>" in x.text[:2000]:
            queue += [l for l in locs if SITEMAP_KEEP.search(l)][:10]
        else:
            urls += locs
    vdp = [u for u in dict.fromkeys(urls) if (VIN_RE.search(u) or VDP_HINT.search(u)) and not NOT_VDP.search(u)]
    # Pages with the VIN in the URL are certainly vehicles; year-make-model-only slugs are usually model
    # research pages, so they go last (and only get fetched when the site exposes nothing better).
    vin_first = [u for u in vdp if VIN_RE.search(u)]
    cond = [u for u in vdp if not VIN_RE.search(u) and re.search(r"(?i)/(new|used|certified|cpo|pre-owned|inventory|vehicle|viewdetails|auto)[-/]", u)]
    rest = [u for u in vdp if u not in set(vin_first) | set(cond)]
    return vin_first + cond + rest

async def crawl_site(s, site, sem, host_gap, max_per_site, out, sites_out):
    base = site["website"] if site["website"].startswith("http") else "https://" + site["website"]
    rec = {"dealerId": site["id"], "dealerName": site["name"], "website": base, "status": "", "candidates": 0, "fetched": 0, "vehicles": 0, "jsonld": 0, "slug": 0, "blocked": 0, "seconds": 0}
    t0 = time.time()
    async with sem:
        try:
            r = await get(s, base, 25)
            if r.status_code in (403, 429, 503):
                rec["status"] = f"home_{r.status_code}"
            base = str(r.url) if r.status_code < 400 else base
            urls = await vehicle_urls(s, base)
            rec["candidates"] = len(urls)
            if not urls:
                rec["status"] = rec["status"] or "no_vehicle_urls"
            vins = set()
            for u in urls[:max_per_site]:
                try:
                    x = await get(s, u, 25)
                except Exception:
                    continue
                finally:
                    await asyncio.sleep(host_gap)
                rec["fetched"] += 1
                if x.status_code in (403, 429):
                    rec["blocked"] += 1
                    if rec["blocked"] >= 5 and rec["vehicles"] == 0: rec["status"] = "vdp_blocked"; break
                    continue
                if x.status_code != 200: continue
                row, how = parse_vdp(str(x.url), x.text)
                if not row or row["vin"] in vins: continue
                vins.add(row["vin"])
                cond = row["condition"] or condition_from_url(u)
                y, mk, md = slug_ymm(u)
                out.write(json.dumps({"dealerId": site["id"], "dealerName": site["name"], "vin": row["vin"], "condition": cond, "year": row["year"] or y, "make": row["make"] or mk, "model": row["model"] or md, "trim": row["trim"], "bodyStyle": row["bodyStyle"],
                                      "exteriorColor": row["exteriorColor"], "interiorColor": row["interiorColor"], "mileage": row["mileage"], "price": row["price"], "msrp": row["msrp"], "stockNumber": row["stockNumber"], "vdpUrl": str(x.url), "imageUrl": row["imageUrl"], "seenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": how}) + "\n")
                rec["vehicles"] += 1; rec[how] += 1
            rec["status"] = rec["status"] or ("ok" if rec["vehicles"] else "no_vehicles_parsed")
        except Exception as e:
            rec["status"] = "error:" + str(e)[:60]
    rec["seconds"] = round(time.time() - t0)
    sites_out.write(json.dumps(rec) + "\n"); sites_out.flush(); out.flush()
    print(f"{site['name'][:34]:34} {rec['status']:20} cand={rec['candidates']:5} fetched={rec['fetched']:4} vehicles={rec['vehicles']:4} (ld {rec['jsonld']}, slug {rec['slug']}) {rec['seconds']}s", flush=True)

async def main():
    ap = argparse.ArgumentParser(); ap.add_argument("sites"); ap.add_argument("out"); ap.add_argument("--max-per-site", type=int, default=600); ap.add_argument("--concurrency", type=int, default=60); ap.add_argument("--host-gap", type=float, default=0.7)
    a = ap.parse_args()
    sites = json.load(open(a.sites))
    done = set()
    try:
        for l in open(a.out + ".sites.jsonl"): done.add(json.loads(l)["dealerId"])
    except FileNotFoundError: pass
    todo = [x for x in sites if x["id"] not in done and x.get("website")]
    print(f"{len(todo)} sites to crawl ({len(done)} already done)", flush=True)
    sem = asyncio.Semaphore(a.concurrency)
    with open(a.out, "a") as out, open(a.out + ".sites.jsonl", "a") as sites_out:
        async with AsyncSession(max_clients=a.concurrency + 5) as s:
            await asyncio.gather(*[crawl_site(s, x, sem, a.host_gap, a.max_per_site, out, sites_out) for x in todo])
    recs = [json.loads(l) for l in open(a.out + ".sites.jsonl")]
    print("STATUS:", collections.Counter(r["status"].split(":")[0] for r in recs).most_common())
    print("VEHICLES:", sum(r["vehicles"] for r in recs), "from", sum(1 for r in recs if r["vehicles"]), "sites")

if __name__ == "__main__":
    asyncio.run(main())
