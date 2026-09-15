"""Name/email helpers shared by merge_generic.py and recover_emails.py."""
import re, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from extract_contacts import GENERIC  # noqa: E402,F401

NOT_A_PERSON = re.compile(r"\b(team|department|dept|desk|office|sales|manager|staff|internet|bdc|group|motors?|auto|automotive|dealership|hyundai|kia|subaru|mazda|volkswagen|vw|audi|volvo|mini|nissan|infiniti|cadillac|lincoln|buick|gmc|chevrolet|chevy)\b", re.I)

def strong_email_match(name, email):
    """Tighter than extract_contacts.email_matches: the local part must *be* the first or last name, or start with
    a first+last combination — "jon.scott@" must not pair with Scott Ostrum just because it ends in "scott"."""
    local = email.split("@")[0].lower()
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in name.split()]
    toks = [t for t in toks if len(t) >= 2]
    if len(toks) < 2:
        return False
    first, last = toks[0], toks[-1]
    combos = {first + last, first + "." + last, first + "_" + last, first[0] + last, first + last[0], last + first, last + first[0], last + "." + first}
    return local == first or local == last or any(local == c or local.startswith(c) for c in combos)

def looks_like_person(name):
    return bool(name) and len(name.split()) >= 2 and not NOT_A_PERSON.search(name)

