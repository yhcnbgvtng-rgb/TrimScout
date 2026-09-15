# Dealer rosters — brand crawls

One folder per brand: the OEM locator pull (`roster_raw.json`), the staff-page
fetch (`fetch_results.jsonl`, page text — not committed), the extracted
contacts (`extract_results.json`), and the upload rows (`upload_rows.json`,
`<Brand>_Dealer_Contacts_NATIONWIDE.csv`). Shared tools live here:

- `cffi_staff_crawler.py` — browser-impersonated fetch of ~30 staff-page paths per site
- `extract_contacts.py` — name · title · email from page text; an email is only paired with a person when its local part matches the name
- `merge_generic.py <Brand>` (Hyundai kept its own `merge_hyundai.py`) — locator + staff page → upload rows (email precedence: staff page → locator email that matches the GM → name only)
- `scripts/probes/push-brand-roster.mts <Brand>` — bulk upsert into the live directory (existing contacts are kept when ours has no email)

Same-name rooftops (Rick Case Hyundai ×4…) are disambiguated as `Name – City`
before the push; the directory keys by name.

| Brand | Pulled | Rooftops | Named | Emails | Notes |
|---|---|---|---|---|---|
| Kia | 2026-09-15 | 800 | 309 | 42 | Locator: POST `kia.com/us/services/en/dealers/search` `{"type":"zip","zipCode":…,"radius":"120"}` (no GM/email in the feed). Staff pages: 339 captured / 219 walled / 242 none. |
| Hyundai | 2026-09-15 | 858 | 855 | 65 | Locator: `hyundaiusa.com/var/hyundai/services/dealer/dealersByZip.json?brand=hyundai&model=all&lang=en&zip=&radius=150&maxdealers=200`. Dealer sites rarely publish emails (153/468 staff pages had any); locator `dealerEmail` used only when it matches the GM. |
