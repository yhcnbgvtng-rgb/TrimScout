import asyncio
import csv
import json
import re
import sys
from urllib.parse import urljoin, urlparse

from curl_cffi.requests import AsyncSession
from bs4 import BeautifulSoup

STAFF_PATHS = [
    "/staff.htm", "/staff", "/meet-our-staff", "/about-us/staff",
    "/our-team", "/meet-the-staff", "/dealership/staff.htm",
    "/staff-directory", "/about/meet-our-team", "/staff.aspx",
    "/meet-our-staff/", "/meet-our-team", "/meet-our-team.htm",
    "/about-us/meet-our-staff", "/about-us/meet-the-team",
    "/our-team.htm", "/our-staff", "/staff/", "/team",
    "/dealership/staff/", "/dealership/meet-our-staff.htm",
    "/about/staff.htm", "/about/our-team", "/employees.htm",
    "/sales-staff.htm", "/meet-the-team", "/meet-the-team.htm",
    "/staff-members", "/about-us/our-team",
]

TITLE_RE = re.compile(r"\b(general manager|sales manager|sales consultant|sales rep|salesperson)\b", re.I)

def base_url(website):
    p = urlparse(website)
    return f"{p.scheme}://{p.netloc}"

def decode_cfemail(cfemail):
    try:
        r = int(cfemail[:2], 16)
        return "".join(chr(int(cfemail[i:i + 2], 16) ^ r) for i in range(2, len(cfemail), 2))
    except Exception:
        return None

def decloudflare(soup):
    """Replace Cloudflare email-obfuscation spans with their decoded plaintext, in place,
    so the real (not guessed) address shows up naturally in get_text() next to the person's name."""
    for el in soup.find_all(attrs={"data-cfemail": True}):
        decoded = decode_cfemail(el["data-cfemail"])
        if decoded and "@" in decoded:
            el.replace_with(decoded)
    for a in soup.find_all("a", href=re.compile(r"^/cdn-cgi/l/email-protection", re.I)):
        m = re.search(r"data-cfemail=\"([a-f0-9]+)\"", str(a))
        if m:
            decoded = decode_cfemail(m.group(1))
            if decoded and "@" in decoded:
                a.replace_with(decoded)

def clean_text(html):
    soup = BeautifulSoup(html, "html.parser")
    decloudflare(soup)
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)
    return text

async def fetch_dealer(session, dealer, sem):
    name, address, city, state, zip_, phone, website = dealer
    result = {
        "dealer_name": name, "address": address, "city": city, "state": state,
        "zip": zip_, "phone": phone, "website": website,
        "status": "", "source_url": "", "page_text": "", "notes": "",
    }
    if not website:
        result["status"] = "no_website"
        result["notes"] = "no website in source data"
        return result

    async with sem:
        base = base_url(website)
        blocked_seen = False
        for path in STAFF_PATHS:
            url = urljoin(base, path)
            try:
                r = await session.get(url, impersonate="chrome124", timeout=10)
                if r.status_code == 200 and len(r.text) > 500:
                    text = clean_text(r.text)
                    if TITLE_RE.search(text):
                        result["status"] = "fetched"
                        result["source_url"] = str(r.url)
                        result["page_text"] = text[:20000]
                        return result
                elif r.status_code in (403, 401, 429):
                    blocked_seen = True
            except Exception:
                continue
        result["status"] = "blocked" if blocked_seen else "no_staff_page"
        result["notes"] = "blocked even with TLS impersonation" if blocked_seen else "no staff page found - even with TLS impersonation"
    return result

async def run(dealers, concurrency=8):
    sem = asyncio.Semaphore(concurrency)
    async with AsyncSession() as session:
        tasks = [fetch_dealer(session, d, sem) for d in dealers]
        return await asyncio.gather(*tasks)

def main():
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    with open(in_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        dealers = list(reader)

    results = asyncio.run(run(dealers))

    with open(out_path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    fetched = sum(1 for r in results if r["status"] == "fetched")
    blocked = sum(1 for r in results if r["status"] == "blocked")
    no_staff = sum(1 for r in results if r["status"] == "no_staff_page")
    print(f"processed={len(results)} fetched_staff_content={fetched} blocked={blocked} no_staff_page={no_staff}")

if __name__ == "__main__":
    main()
