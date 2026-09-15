# Dealer rosters — brand crawls

One folder per brand: the OEM locator pull (`roster_raw.json`), the staff-page
fetch (`fetch_results.jsonl`, page text — not committed), the extracted
contacts (`extract_results.json`), and the upload rows (`upload_rows.json`,
`<Brand>_Dealer_Contacts_NATIONWIDE.csv`). Shared tools live here:

- `cffi_staff_crawler.py` — browser-impersonated fetch of ~30 staff-page paths per site
- `extract_contacts.py` — name · title · email from page text; an email is only paired with a person when its local part matches the name
- `merge_generic.py <Brand>` (Hyundai kept its own `merge_hyundai.py`) — locator + staff page → upload rows (email precedence: staff page → locator email that matches the GM → locator email that matches the staff-page name → name only)
- `scripts/probes/push-brand-roster.mts <Brand>` — bulk upsert into the live directory (existing contacts are kept when ours has no email)

Same-name rooftops (Rick Case Hyundai ×4…) are disambiguated as `Name – City`
before the push; the directory keys by name.

| Brand | Pulled | Rooftops | Named | Emails | Notes |
|---|---|---|---|---|---|
| Volkswagen | 2026-09-15 | 951 | 335 | 46 | vw.com's DCC feature app exposes the whole US network in one call: `v3-92-0.ds-us.dcc.feature-app.io/bff-search/dealers?serviceConfigEndpoint=…&lufthansaApiKey=…&query={"type":"DEALER","countryCode":"US","name":" "}` (954 rows; `vw/bff_dealers_raw.json` is the dump, `crawl_locator.md` the recipe). No GM/email in the feed. Staff pages: 353 captured / 179 walled / 414 none. |
| Audi | 2026-09-15 | 309 | 164 | 1 | `omnigraph.audi.com/graphql` `dealersByGeoArea` (bbox, 100 cap → 2° tiles, split on overflow). No email in the feed and Audi dealer sites publish none (0/165 staff pages) — structural. |
| Volvo | 2026-09-15 | 277 | 65 | 47 | volvocars.com is Akamai-walled to curl; the full US retailer list (280) ships inside the dealer-locator page's Next.js RSC payload (`self.__next_f.push`, look for `addressLine1`) and was lifted from the rendered page in the Browser pane (`volvo/crawl_locator.md`). Every row carries a `generalContactEmail` (175 personal-looking) → lead inbox. Staff pages: 65 captured / 135 walled / 65 none. |
| MINI | 2026-09-15 | 104 | 47 | 29 | Locator: `miniusa.com/bin/services/dealer-locator/getAllDealerByZip.json/{zip}/3000?excludeServiceOnlyDealers=false&includeSatelliteDealers=true` (radius 3000 returns the whole network; 18 spread ZIPs unioned). Feed has `dealerEmail` (70/104, often a named person). Staff pages: 47 captured / 29 walled / 23 none. |
| Mazda | 2026-09-15 | 543 | 242 | 124 | Locator: `mazdausa.com/handlers/dealer.ajax?zip=&maxDistance=150&p=` (20/page; per-department phone+email list — Sales / Internet-sales address kept as the lead inbox, 293 of 543 had one, 235 personal-looking). Staff pages: 257 captured / 137 walled / 136 none → 37 paired emails; lead-inbox promotion added 86. |
| Subaru | 2026-09-15 | 644 | 342 | 32 | Locator: `subaru.com/services/dealers/distances/by/zipcode?zipcode=&count=40&type=Active` (nearest-N, no GM/email). Staff pages: 355 captured / 180 walled / 108 none. |
| Kia | 2026-09-15 | 800 | 309 | 42 | Locator: POST `kia.com/us/services/en/dealers/search` `{"type":"zip","zipCode":…,"radius":"120"}` (no GM/email in the feed). Staff pages: 339 captured / 219 walled / 242 none. |
| Hyundai | 2026-09-15 | 858 | 855 | 65 | Locator: `hyundaiusa.com/var/hyundai/services/dealer/dealersByZip.json?brand=hyundai&model=all&lang=en&zip=&radius=150&maxdealers=200`. Dealer sites rarely publish emails (153/468 staff pages had any); locator `dealerEmail` used only when it matches the GM. |
