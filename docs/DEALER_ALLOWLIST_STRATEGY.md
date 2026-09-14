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

`src/nj_verified_domains.js` overlays hosts from in-repo OEM dumps (Acura locator `acura-dealers.json`, Porsche `dealers.json`), listing VDP hosts in `lib/verifiedVehicles.json`, and a small curated overlay (BMW of Morristown → `morristownbmw.com`, Porsche Princeton → `princetonporsche.com`, Key Acura → `keyacuraofatlanticcity.com`).

Honda / Toyota / Lexus locators are referenced elsewhere as successful scrapes but this package has no nationwide dump for those brands. Remaining `brandofcity.com` / `volvocars{city}.com` rows stay tagged `pattern-guess` until a locator file is added. Genesis / Stellantis locators stay out of the NJ crawl.

NY lists live at `dealers/ny/<brand>.json` from the same Acura/Porsche dumps and listing hosts (`npm run write-ny-dealers`). No brandofcity guesses. Brands without an in-repo locator stay empty rather than invented.

## Probe order

1. Sitemap  
2. Inventory sitemap  
3. Domain root / homepage  

A sitemap 404 does **not** classify the rooftop as `HTTP_404` until `/` has been tried. Challenge, DNS, TLS, and reset stop immediately.

## Sales email

Collected during `standalone.js` only. The bot-protection PDF/JSON must not include a Sales email column — this pass never harvested inboxes.
