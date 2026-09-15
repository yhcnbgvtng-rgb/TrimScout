"""Merge the locator roster with staff-page contacts into the upload rows.

Email precedence: staff page (person + matching email) → the locator's
dealerEmail when its local part matches the General Manager's name →
none (name only; the locator's store email, if any, goes in the notes as
"lead inbox", never as the contact). Every row gets the brand, the source,
and the co-located Genesis store when the locator names one.
"""
import json, re, csv, sys
sys.path.insert(0, "..")
from extract_contacts import email_matches, GENERIC  # noqa: E402

roster = json.load(open("roster_raw.json"))
extracted = {r["dealer_name"]: r for r in json.load(open("extract_results.json"))}
fetch = {json.loads(l)["dealer_name"]: json.loads(l) for l in open("fetch_results.jsonl")}

def title_case(s):
    return re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), (s or "").lower()).replace("'S", "'s")

rows = []
stats = {"rows": 0, "staff_email": 0, "locator_email": 0, "name_only": 0, "no_contact": 0}
for d in roster:
    name = d["dealerNm"].strip()
    ex = extracted.get(name, {})
    fe = fetch.get(name, {})
    gm = title_case((d.get("generalManager") or "").strip())
    lead_email = (d.get("dealerEmail") or "").strip()
    contact_name, contact_email, title, source = "", "", "", ""
    if ex.get("contact_email"):
        contact_name, contact_email, title, source = ex["contact_name"], ex["contact_email"], ex["contact_title"], f"Source: {ex['source_url']}"
        stats["staff_email"] += 1
    elif lead_email and not GENERIC.match(lead_email) and gm and email_matches(gm, lead_email):
        contact_name, contact_email, title, source = gm, lead_email, "General Manager", "Source: Hyundai dealer locator (GM + dealer email match)"
        stats["locator_email"] += 1
    elif ex.get("contact_name"):
        contact_name, title, source = ex["contact_name"], ex["contact_title"], f"Source: {ex['source_url']} (no email published for this contact)"
        stats["name_only"] += 1
    elif gm:
        contact_name, title, source = gm, "General Manager", "Source: Hyundai dealer locator (GM name; no email published)"
        stats["name_only"] += 1
    else:
        stats["no_contact"] += 1
    site = (d["dealerUrl"] or "").strip()
    website = ("https://" + site if site and not site.startswith("http") else site).rstrip("/") + "/" if site else ""
    domain = re.sub(r"^www\.", "", re.sub(r"^https?://", "", website).split("/")[0]).lower()
    notes = " | ".join(x for x in [
        f"Title: {title}" if title else "",
        f"Website: {website}" if website else "",
        source,
        f"Lead inbox: {lead_email}" if lead_email and lead_email != contact_email else "",
        f"Co-located: {d['otherDealerNm'].strip()}" if (d.get("otherDealerNm") or "").strip() else "",
        f"Staff page: {fe.get('status')}" if fe.get("status") in ("blocked", "no_staff_page") else "",
        "Brand: Hyundai",
    ] if x)
    phone = re.sub(r"\D", "", d.get("phone") or "")
    rows.append({
        "dealerName": name, "address": (d["address1"] or "").strip(), "city": (d["city"] or "").strip(), "state": d["state"], "zipCode": d["zipCd"],
        "phone": f"({phone[:3]}) {phone[3:6]}-{phone[6:]}" if len(phone) == 10 else (d.get("phone") or ""),
        "contactName": contact_name, "contactEmail": contact_email, "website": website, "domains": [domain] if domain else [], "notes": notes,
    })
    stats["rows"] += 1
json.dump(rows, open("upload_rows.json", "w"), indent=1)
with open("Hyundai_Dealer_Contacts_NATIONWIDE.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["Dealer Name", "Address", "City", "State", "Zip", "Phone", "Contact Name", "Contact Email", "Website", "Domains", "Notes"])
    for r in rows: w.writerow([r["dealerName"], r["address"], r["city"], r["state"], r["zipCode"], r["phone"], r["contactName"], r["contactEmail"], r["website"], ",".join(r["domains"]), r["notes"]])
print(stats)
