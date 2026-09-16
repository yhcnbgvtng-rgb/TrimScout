# Dealer rosters — brand crawls

One folder per brand: the OEM locator pull (`roster_raw.json`), the staff-page
fetch (`fetch_results.jsonl`, page text — not committed), the extracted
contacts (`extract_results.json`), and the upload rows (`upload_rows.json`,
`<Brand>_Dealer_Contacts_NATIONWIDE.csv`). Shared tools live here:

- `cffi_staff_crawler.py` — browser-impersonated fetch of ~30 staff-page paths per site
- `extract_contacts.py` — name · title · email from page text; an email is only paired with a person when its local part matches the name
- `merge_generic.py <Brand>` (Hyundai kept its own `merge_hyundai.py`) — locator + staff page → upload rows (email precedence: staff page → locator email that matches the GM → locator email that matches the staff-page name → name only)
- `scripts/probes/push-brand-roster.mts <Brand> [folder]` — bulk upsert into the live directory (existing contacts are kept when ours has no email; an already-live rooftop keeps its notes; a rooftop live under another brand's spelling is matched on website domain + state and keeps the live name)
- `scripts/probes/dump-recovery-candidates.mts <Brand> <out.json>` → `recover_emails.py` → `scripts/probes/push-recovered-emails.mts` — HTML-source email recovery: dealer.com staff pages often carry the address in the raw HTML (mailto / CMS JSON) when the visible text only shows an "Email Me" button; re-fetches each named-but-emailless contact's staff page and pairs an address whose local part strongly matches the name (2026-09-15: Cadillac +77, Buick +63 — ~30% of candidates; the rest are hard 403s or pages with no addresses at all)
- `scripts/probes/promote-lead-inboxes.mts <Brand>` — copies a non-generic `Lead inbox:` from notes onto rows that have a named contact but no email

Same-name rooftops (Rick Case Hyundai ×4…) are disambiguated as `Name – City`
before the push; the directory keys by name.

| Brand | Pulled | Rooftops | Named | Emails | Notes |
|---|---|---|---|---|---|
| McLaren | 2026-09-15 | 26 | 11 | 6 | `cms.production.aws.mclaren.com/api/retailers` (curl_cffi; filter `country == "USA"`). Feed has no dealer websites — derived `mclaren<city>.com` + verified, 5 multi-brand stores found by search (`mclaren/crawl_locator.md`). Staff pages: 13 captured / 4 walled / 9 none. |
| Buick | 2026-09-15 | 744 | 480 | 70 (+63 recovery → 435 live) | GM quantum locator, `makeCodes=004` (`crawl_gm_quantum.py buick`; verified codes: 001 Chevrolet, 004 Buick, 006 Cadillac, 012 GMC). 719 of 744 were already live as Buick-GMC combos from the GMC crawl, so the push mostly refreshed contacts (Buick-named rows 618 → 752, emails 305 → 373). Staff pages: 487 captured / 128 walled / 114 none. |
| Nissan | 2026-09-15 | 1,040 | 500 | 75 | `graphql.nissanusa.com/graphql` `getDealersByLatLng` (public `x-api-key`), **curl_cffi chrome impersonation required** (plain curl 403) and paced at ~1 call/s (faster → 403 for minutes); `radius` is km, 100 cap → 2° grid, split on overflow (`crawl_nissan_graphql.py nissan`). No GM/email in the feed. Staff pages: 540 captured / 164 walled / 336 none. |
| INFINITI | 2026-09-15 | 190 | 96 | 10 | Same endpoint with `brand: infiniti` (`crawl_nissan_graphql.py infiniti`). Staff pages: 107 / 6 / 77. |
| Cadillac | 2026-09-15 | 565 | 341 | 60 (+77 recovery → 185 live) | GM quantum locator: `cadillac.com/bypass/pcf/quantum-dealer-locator/v1/getDealers?…&makeCodes=006&searchType=latLongSearch` — 400 without the `clientapplicationid: quantum` header; works from Python with curl_cffi (`crawl_gm_quantum.py`, 1° grid, 50 cap). No email in the feed. Staff pages: 342 captured / 117 walled / 104 none. Live count is higher (640) because Chevy/GMC-combo stores and older Cadillac rows already existed. |
| Lincoln | 2026-09-15 | 402 | 118 | 83 | lincoln.com `cxservices/dealer/Dealers.json` needs a runtime `application-id`; pulled in the Browser pane through the page's `FD.Brand.NgpServices.dealers()` (`lincoln/crawl_locator.md`; radius ≤ 500, 100 cap). Feed has a store `Email` (273/402, 211 personal-looking) → lead inbox; promotion added 34. Staff pages: 121 captured / 165 walled / 69 none. |
| Volkswagen | 2026-09-15 | 951 | 335 | 46 | vw.com's DCC feature app exposes the whole US network in one call: `v3-92-0.ds-us.dcc.feature-app.io/bff-search/dealers?serviceConfigEndpoint=…&lufthansaApiKey=…&query={"type":"DEALER","countryCode":"US","name":" "}` (954 rows; `vw/bff_dealers_raw.json` is the dump, `crawl_locator.md` the recipe). No GM/email in the feed. Staff pages: 353 captured / 179 walled / 414 none. |
| Audi | 2026-09-15 | 309 | 164 | 1 | `omnigraph.audi.com/graphql` `dealersByGeoArea` (bbox, 100 cap → 2° tiles, split on overflow). No email in the feed and Audi dealer sites publish none (0/165 staff pages) — structural. |
| Volvo | 2026-09-15 | 277 | 65 | 47 | volvocars.com is Akamai-walled to curl; the full US retailer list (280) ships inside the dealer-locator page's Next.js RSC payload (`self.__next_f.push`, look for `addressLine1`) and was lifted from the rendered page in the Browser pane (`volvo/crawl_locator.md`). Every row carries a `generalContactEmail` (175 personal-looking) → lead inbox. Staff pages: 65 captured / 135 walled / 65 none. |
| MINI | 2026-09-15 | 104 | 47 | 29 | Locator: `miniusa.com/bin/services/dealer-locator/getAllDealerByZip.json/{zip}/3000?excludeServiceOnlyDealers=false&includeSatelliteDealers=true` (radius 3000 returns the whole network; 18 spread ZIPs unioned). Feed has `dealerEmail` (70/104, often a named person). Staff pages: 47 captured / 29 walled / 23 none. |
| Mazda | 2026-09-15 | 543 | 242 | 124 | Locator: `mazdausa.com/handlers/dealer.ajax?zip=&maxDistance=150&p=` (20/page; per-department phone+email list — Sales / Internet-sales address kept as the lead inbox, 293 of 543 had one, 235 personal-looking). Staff pages: 257 captured / 137 walled / 136 none → 37 paired emails; lead-inbox promotion added 86. |
| Subaru | 2026-09-15 | 644 | 342 | 32 | Locator: `subaru.com/services/dealers/distances/by/zipcode?zipcode=&count=40&type=Active` (nearest-N, no GM/email). Staff pages: 355 captured / 180 walled / 108 none. |
| Kia | 2026-09-15 | 800 | 309 | 42 | Locator: POST `kia.com/us/services/en/dealers/search` `{"type":"zip","zipCode":…,"radius":"120"}` (no GM/email in the feed). Staff pages: 339 captured / 219 walled / 242 none. |
| Hyundai | 2026-09-15 | 858 | 855 | 65 | Locator: `hyundaiusa.com/var/hyundai/services/dealer/dealersByZip.json?brand=hyundai&model=all&lang=en&zip=&radius=150&maxdealers=200`. Dealer sites rarely publish emails (153/468 staff pages had any); locator `dealerEmail` used only when it matches the GM. |

## Vehicle inventory (scrapers/inventory/)

`crawl_inventory.py sites.json out.jsonl` — for every rooftop with a website: robots.txt + sitemaps → vehicle-page
URLs (VIN-in-URL first) → fetch each page with browser TLS at a polite per-host pace → parse the schema.org JSON-LD
every dealer platform embeds (Vehicle / Car / Product; blocks merged) → one JSONL line per VIN. Resumable per site.
`scripts/probes/push-inventory.mts out.jsonl` upserts into the box's `dealer_inventory` (by VIN) and sweeps each
crawled store so VINs no longer on the site are marked removed. The admin sheet's **Vehicles** tab reads it back.
NJ pilot 2026-09-16: 12/12 sites parsed, 40/40 pages on most (DealerOn, dealer.com, Dealer Inspire, Team Velocity).
