"""Pull the best sales contact (name · title · email) out of each fetched staff page.

Deterministic: a title we want, the 2–4 capitalized words right before it as
the name, and an email within ~250 chars after it. Titles ranked GM/GSM →
Sales Manager → Internet/BDC → other. An email is only accepted when its
local part shares a token with the name (first, last, initial+last), so a
store's info@ or another person's address is never pinned on the wrong
person. Emits one row per dealer, best-first.
"""
import json, re, sys

TITLES = [
    (0, r"general sales manager"), (0, r"general manager"), (0, r"executive manager"), (0, r"dealer principal"),
    (1, r"new car sales manager"), (1, r"sales manager"), (1, r"sales director"), (1, r"director of sales"),
    (2, r"internet (?:sales )?(?:manager|director)"), (2, r"e-?commerce (?:manager|director)"), (2, r"bdc (?:manager|director)"), (2, r"digital sales manager"),
    (3, r"sales team lead"), (3, r"assistant sales manager"), (3, r"sales consultant"), (3, r"product specialist"), (3, r"sales (?:associate|professional|specialist|advisor)"),
    (4, r"sales representative"), (4, r"sales & leasing consultant"), (4, r"sales team"), (4, r"sales and leasing"), (4, r"hyundai sales"),
]
NAME_RE = r"((?:[A-Z][a-zA-Z'\-\.]+\s+){1,3}[A-Z][a-zA-Z'\-\.]+)"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
GENERIC = re.compile(r"^(info|sales|internet|leads?|contact|hello|service|parts|bdc|marketing|webmaster|admin|team|office|support|customerservice|crm|dealer|reception|inquiries)@", re.I)
STOP = {"Sales", "Service", "Parts", "Hours", "Department", "Management", "Staff", "Our", "Meet", "The", "Team", "Contact", "Email", "Phone", "Call", "Text", "View", "Directions", "Saved", "Hyundai", "Genesis", "Finance", "Manager", "New", "Used", "Pre-Owned", "Certified", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Speaks", "English", "Spanish"}

def name_ok(n):
    toks = n.split()
    if any(t.strip(".") in STOP for t in toks): return False
    if any(len(t.strip(".")) < 2 and not t.endswith(".") for t in toks): return False
    return 2 <= len(toks) <= 4

def email_matches(name, email):
    local = email.split("@")[0].lower()
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in name.split()]
    toks = [t for t in toks if len(t) >= 2]
    if not toks: return False
    first, last = toks[0], toks[-1]
    cands = {first, last, first + last, first + "." + last, first[0] + last, first + last[0], first + "_" + last, last + first, last + first[0], first[:3] + last}
    return any(c and (local == c or local.startswith(c) or local.endswith(c) or (len(c) >= 5 and c in local)) for c in cands)

def extract(text):
    best = None
    for rank, t in TITLES:
        for m in re.finditer(NAME_RE + r"[\s,\-–|]*(?:\([^)]*\)\s*)?" + t, text, re.I):
            raw_name = m.group(1).strip().split()
            # Greedy capture drags in leading page furniture ("lesterglenn.com Close Jerry Ojeda") — keep the trailing person name.
            name = " ".join(raw_name[-3:] if len(raw_name) >= 3 and (len(raw_name[-2]) <= 2 or raw_name[-2].lower() in {"de", "van", "von", "la", "del", "st."}) else raw_name[-2:])
            if not name_ok(name): continue
            title = re.search(t, m.group(0), re.I).group(0).title()
            window = text[m.end(): m.end() + 450]
            email = None
            for e in EMAIL_RE.findall(window):
                if GENERIC.match(e): continue
                if email_matches(name, e): email = e; break
            # A named person WITH an email beats a higher title without one — the email is what makes a desk contact_ready.
            cand = (0 if email else 1, rank, name, title, email)
            if best is None or cand[:2] < best[:2]: best = cand
        if best and best[0] == 0 and best[1] <= rank: break
    return best

if __name__ == "__main__":
    rows = [json.loads(l) for l in open(sys.argv[1])]
    out = []
    stats = {"fetched": 0, "with_contact": 0, "with_email": 0}
    for r in rows:
        rec = {"dealer_name": r["dealer_name"], "status": r["status"], "source_url": r["source_url"], "contact_name": "", "contact_title": "", "contact_email": ""}
        if r["status"] == "fetched":
            stats["fetched"] += 1
            b = extract(r["page_text"])
            if b:
                _, _, name, title, email = b
                rec.update(contact_name=name, contact_title=title, contact_email=email or "")
                stats["with_contact"] += 1
                if email: stats["with_email"] += 1
        out.append(rec)
    json.dump(out, open(sys.argv[2], "w"), indent=1)
    print(stats)
