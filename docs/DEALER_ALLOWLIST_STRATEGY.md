# Dealer allowlist strategy (detect only)

NJ inventory crawls **report** bot protection and infra failures. They do **not** bypass WAFs, captchas, challenges, or fingerprint checks. A rooftop that answers 403 stays skipped until the dealer allowlists the Lightsail egress (`ubuntu@98.92.140.11`) or publishes a public inventory feed.

## Why HTTP_403 is not CLOUDFLARE

`CLOUDFLARE` requires a Cloudflare fingerprint (`cf-ray`, `server: cloudflare`, `cf-mitigated`, or a Cloudflare challenge body). A plain 403 without that fingerprint is `HTTP_403`. Paul's 2026-09-14 audit had four of those — they are other edges, not a missed `cf-ray` on Cloudflare.

`detectWafVendor()` reads response headers only (Server, CF-Ray, Akamai GRN / `ak_p`, Imperva/Incapsula, AWS WAF, CloudFront `x-amz-cf-*`, Sucuri, DataDome, HUMAN/PerimeterX, Fastly). It never retries with a different client or cookie jar.

## The four HTTP_403 rooftops (2026-09-14 audit)

Detect-only GETs from a non-Lightsail IP (this agent VM). Lightsail will see the same vendors or a different 403; re-run `npm run bot-report` there and trust the `wafVendor` column.

| Dealer | Domain | HTTP | Fronting vendor | Notes |
|---|---|---|---|---|
| Acura Turnersville | `acuraturnersville.com` → `www.acuraturnersville.com` | 403 | **CloudFront** (`server: CloudFront`, `x-amz-cf-id`, `x-cache: Error from cloudfront`) | Apex is nginx 301; www is CloudFront 403. Not Cloudflare. |
| Ray Catena Audi | `www.raycatenaaudi.com` | 403 | **Akamai** (`server-timing: ak_p`) in front of nginx / Dealer.com (`DDC.postalCode` cookie) | Body: "The website you are attempting to visit is not active." Apex `raycatenaaudi.com` fails TLS. Treat as blocked/inactive, not a challenge to solve. |
| Kia of Englewood | `kiaofenglewood.com` | 403 | **Akamai** (`akamai-grn`, `x-akamai-age`, `x-akamai-cookie`) | No `cf-ray`. |
| Route 22 Toyota | `route22toyota.com` | 403 | **Akamai** (`akamai-grn`, `x-akamai-age`, `x-akamai-cookie`) | No `cf-ray`. |

Do not implement Akamai or CloudFront bypass, TLS impersonation, or cookie replay for these desks.

## What each class needs

| Class | Meaning | Fix |
|---|---|---|
| `NONE` | Homepage or sitemap returned 2xx/3xx | Crawl |
| `CLOUDFLARE` | Cloudflare challenge / bot fight | Ask dealer to allowlist Lightsail IP; skip until then |
| `VERCEL_CHECKPOINT` | Vercel Security Checkpoint | Same — allowlist, no solver |
| `HTTP_403` | 403, other WAF/CDN (see vendor column) | Allowlist with that vendor; skip |
| `HTTP_429` | Rate limit | Slow down / later window |
| `DNS_DEAD` | `ENOTFOUND` / `EAI_AGAIN` | Wrong host — replace from OEM locator, do not treat as WAF |
| `HTTP_404` | Host lives, path 404 after homepage fallback | Confirm dealer URL; not bot protection |
| `HTTP_5XX` | Origin 5xx | Retry later |
| `CONN_RESET` | `ECONNRESET` / `ECONNREFUSED` | Network/origin down |
| `TIMEOUT` | Connect/read timeout | Retry later |
| `TLS` | Certificate / TLS handshake error | Host/cert problem |
| `OTHER` | Leftover | Inspect notes |

## Domain list quality

Invented `brandofcity.com` / `volvocars{city}.com` hosts are **not** in the seed. `loadNjDealers` / `loadNyDealers` read official locator dumps only (`dealers/oem-dumps/`, in-repo Acura/Porsche files, listing VDPs). Refresh dumps with `npm run fetch-oem-locators` (detect-only — a 403 is recorded, never bypassed). Then `npm run write-nj-dealers` and `npm run write-ny-dealers`.

### Sources per IN brand

| Brand | Source | Notes |
|---|---|---|
| Acura | In-repo `acura-dealers.json` (official locator dump) | Live `acura.com` locator is Akamai 403 from some IPs — do not bypass. Overlay: Key Acura → `keyacuraofatlanticcity.com`. |
| Porsche | In-repo `dealers.json` (official US Porsche Center directory) | Overlay: Porsche Princeton → `princetonporsche.com`. |
| Lexus | Official `GET https://www.lexus.com/rest/lexus/dealers` | `dealerSiteUrl` from the OEM REST directory. |
| Toyota | Official dealer-hub city pages `https://www.toyota.com/dealers/{state}/{city}/dealers/` | Parse `dealer-card` websites. Example: Sansone Toyota is `sansonestoyota.com`, not `66toyota.com`. |
| Mercedes-Benz | Official `https://nafta-service.mbusa.com/api/dlrsrv/v1/dealers?zip=&distance=&filter=mbdealer` | Same API the MBUSA locator page calls. Open Road rows are dropped by the megadealer filter. Overlay: Paramus → `mercedesbenzparamus.com` when that rooftop exists. |
| Mitsubishi | Official `https://www.mitsubishicars.com/dealers` Apollo cache | Skip Nielsen Parts Depot and non-Mitsubishi rows. |
| BMW | Listing-verified VDPs in `lib/verifiedVehicles.json` | Live BMW localsearch timed out / unused. No invented `bmwof{city}` hosts. |
| Audi | Listing-verified VDPs | Live Audi locator is 403. |
| Volvo | Listing-verified VDPs | Live Volvo locator is 403. Overlay: Prestige Volvo → `prestigevolvo.com`. |
| Honda, Kia, Nissan, Infiniti, Subaru, Mazda, Volkswagen, Mini | Official locators tried by `fetch-oem-locators` | Honda/Acura platform APIs return Akamai 403 from this agent IP. Other locators are JS shells with no public dealer JSON. Dumps stay empty rather than inventing hosts. Re-run the script on Lightsail if those APIs answer there. |

OUT brands (Ford, GM, Stellantis, Hyundai/Genesis, EV startups) stay out even when a nationwide JSON exists in this repo.

NY uses the same dumps (`dealers/ny/<brand>.json` via `npm run write-ny-dealers`). Cloudflare / Akamai / DataDome / Vercel on a **dealer site** remain detect-only skips after the host is real.

## Probe order

1. Sitemap  
2. Inventory sitemap  
3. Domain root / homepage  

A sitemap 404 does **not** classify the rooftop as `HTTP_404` until `/` has been tried. Challenge, DNS, TLS, and reset stop immediately.

## Sales email

Collected during `standalone.js` only. The bot-protection PDF/JSON must not include a Sales email column — this pass never harvested inboxes.
