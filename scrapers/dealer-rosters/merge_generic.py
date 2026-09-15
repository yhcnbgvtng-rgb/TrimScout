"""Merge a locator roster (roster_raw.json: name/address1/city/state/zip/phone/url[/generalManager/dealerEmail])
with staff-page contacts into upload rows, disambiguating same-name rooftops as "Name – City" up front.

  python3 ../merge_generic.py Kia
"""
import json, re, csv, sys, collections
sys.path.insert(0, "..")
from extract_contacts import email_matches, GENERIC  # noqa: E402

brand = sys.argv[1]
roster = json.load(open("roster_raw.json"))
extracted = {r["dealer_name"]: r for r in json.load(open("extract_results.json"))}
fetch = {json.loads(l)["dealer_name"]: json.loads(l) for l in open("fetch_results.jsonl")}

NOT_A_PERSON = re.compile(r"\b(team|department|dept|desk|office|sales|manager|staff|internet|bdc|group|motors?|auto|automotive|dealership|hyundai|kia|subaru|mazda|volkswagen|vw|audi|volvo|mini|nissan|infiniti|cadillac|lincoln)\b", re.I)

def looks_like_person(name):
    return bool(name) and len(name.split()) >= 2 and not NOT_A_PERSON.search(name)

def title_case(s):
    return re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), (s or "").lower()).replace("'S", "'s")

names = collections.Counter((d.get("name") or d.get("dealerNm") or "").strip().lower() for d in roster)
seen = collections.Counter()
rows, stats = [], {"rows": 0, "staff_email": 0, "locator_email": 0, "name_only": 0, "no_contact": 0, "disambiguated": 0}
for d in roster:
    name = (d.get("name") or d.get("dealerNm") or "").strip()
    key = name.lower()
    ex, fe = extracted.get(name, {}), fetch.get(name, {})
    gm = title_case((d.get("generalManager") or "").strip())
    gm = "" if re.search(r"\bno gm\b|vacant|tbd|n/a|open position", gm, re.I) else re.sub(r"^Gm Candidate\s+", "", gm)
    lead_email = (d.get("dealerEmail") or "").strip()
    contact_name = contact_email = title = source = ""
    if ex.get("contact_email"):
        contact_name, contact_email, title, source = ex["contact_name"], ex["contact_email"], ex["contact_title"], f"Source: {ex['source_url']}"; stats["staff_email"] += 1
    elif lead_email and not GENERIC.match(lead_email) and gm and email_matches(gm, lead_email):
        contact_name, contact_email, title, source = gm, lead_email, "General Manager", f"Source: {brand} dealer locator (GM + dealer email match)"; stats["locator_email"] += 1
    elif lead_email and not GENERIC.match(lead_email) and looks_like_person(ex.get("contact_name", "")) and email_matches(ex["contact_name"], lead_email):
        contact_name, contact_email, title, source = ex["contact_name"], lead_email, ex["contact_title"], f"Source: {ex['source_url']} (name) + {brand} dealer locator (email match)"; stats["locator_email"] += 1
    elif ex.get("contact_name"):
        contact_name, title, source = ex["contact_name"], ex["contact_title"], f"Source: {ex['source_url']} (no email published for this contact)"; stats["name_only"] += 1
    elif gm:
        contact_name, title, source = gm, "General Manager", f"Source: {brand} dealer locator (GM name; no email published)"; stats["name_only"] += 1
    else:
        stats["no_contact"] += 1
    if names[key] > 1:
        seen[key] += 1
        same_city = [x for x in roster if (x.get("name") or x.get("dealerNm") or "").strip().lower() == key and (x.get("city") or "") == (d.get("city") or "")]
        name = f"{name} – {(d.get('city') or '').strip()}" + ("" if len(same_city) == 1 else f" #{seen[key]}")
        stats["disambiguated"] += 1
    site = (d.get("url") or d.get("dealerUrl") or "").strip().lower()
    website = (("https://" + site) if site and not site.startswith("http") else site).rstrip("/") + "/" if site else ""
    domain = re.sub(r"^www\.", "", re.sub(r"^https?://", "", website).split("/")[0]).lower()
    notes = " | ".join(x for x in [f"Title: {title}" if title else "", f"Website: {website}" if website else "", source,
        f"Lead inbox: {lead_email}" if lead_email and lead_email != contact_email else "",
        f"Staff page: {fe.get('status')}" if fe.get("status") in ("blocked", "no_staff_page") else "", f"Brand: {brand}"] if x)
    phone = re.sub(r"\D", "", d.get("phone") or "")
    rows.append({"dealerName": name, "address": (d.get("address1") or "").strip(), "city": (d.get("city") or "").strip(), "state": d.get("state"), "zipCode": d.get("zip") or d.get("zipCd"),
                 "phone": f"({phone[:3]}) {phone[3:6]}-{phone[6:]}" if len(phone) == 10 else (d.get("phone") or ""),
                 "contactName": contact_name, "contactEmail": contact_email, "website": website, "domains": [domain] if domain else [], "notes": notes})
    stats["rows"] += 1
json.dump(rows, open("upload_rows.json", "w"), indent=1)
with open(f"{brand}_Dealer_Contacts_NATIONWIDE.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["Dealer Name", "Address", "City", "State", "Zip", "Phone", "Contact Name", "Contact Email", "Website", "Domains", "Notes"])
    for r in rows: w.writerow([r["dealerName"], r["address"], r["city"], r["state"], r["zipCode"], r["phone"], r["contactName"], r["contactEmail"], r["website"], ",".join(r["domains"]), r["notes"]])
print(stats)
