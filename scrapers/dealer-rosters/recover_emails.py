"""HTML-source email recovery: dealer.com-style staff pages often carry the contact's real address in the raw
HTML (a mailto:, a data attribute, or a CMS JSON blob) even when the rendered text only shows an "Email Me"
button — the plain-text extractor misses those. For each candidate (named contact, known staff URL, no
email) re-fetch the page with browser TLS and pair any address whose local part strongly matches the name.

  python3 ../recover_emails.py recovery_candidates.json recovery_results.json
"""
import asyncio, json, re, sys, html
sys.path.insert(0, __import__("os").path.dirname(__file__))
from merge_generic_lib import strong_email_match, GENERIC  # noqa: E402
from curl_cffi.requests import AsyncSession

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
JUNK = re.compile(r"\.(png|jpg|jpeg|gif|svg|webp|css|js)$|sentry|example\.|wixpress|schema\.org|@2x|@3x", re.I)

def find_emails(raw):
    text = html.unescape(raw).replace("\\u0040", "@").replace("%40", "@").replace("\\/", "/")
    seen = []
    for m in EMAIL_RE.finditer(text):
        e = m.group(0).strip(".").lower()
        if not JUNK.search(e) and e not in seen:
            seen.append(e)
    return seen

async def one(session, c, sem):
    async with sem:
        try:
            r = await session.get(c["sourceUrl"], impersonate="chrome124", timeout=25)
            if r.status_code != 200:
                return {**c, "status": f"http_{r.status_code}"}
            emails = find_emails(r.text)
            match = next((e for e in emails if not GENERIC.match(e) and strong_email_match(c["contactName"], e)), None)
            return {**c, "status": "matched" if match else ("no_match" if emails else "no_emails_in_html"), "email": match, "emailsSeen": len(emails)}
        except Exception as e:
            return {**c, "status": "error", "error": str(e)[:80]}

async def main():
    cands = json.load(open(sys.argv[1]))
    sem = asyncio.Semaphore(8)
    async with AsyncSession() as session:
        results = await asyncio.gather(*[one(session, c, sem) for c in cands])
        # dealer.com's CDN 403/429s bursts from one client; one slow retry pass recovers most of those
        retry = [i for i, r in enumerate(results) if r["status"] in ("http_403", "http_429", "error")]
        if retry:
            await asyncio.sleep(20)
            slow = asyncio.Semaphore(2)
            again = await asyncio.gather(*[one(session, cands[i], slow) for i in retry])
            for i, r in zip(retry, again):
                results[i] = r
    json.dump(results, open(sys.argv[2], "w"), indent=1)
    from collections import Counter
    print(Counter(r["status"] for r in results))

if __name__ == "__main__":
    asyncio.run(main())
