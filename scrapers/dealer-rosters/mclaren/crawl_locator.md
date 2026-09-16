McLaren roster source (2026-09-15): `https://cms.production.aws.mclaren.com/api/retailers` (no params — the
`country=` filter returns nothing for the US; filter client-side on `country == "USA"`). Needs browser TLS
(curl_cffi chrome124); plain curl is 403. 26 US retailers with name, address (free-text, one line — parsed
into street/city/state/zip by hand-tolerant rules), sales phone, lat/lng, `retailer_id`. Saved as
`cms_retailers_raw.json`.

The feed carries **no dealer website** — only `cars.mclaren.com` retailer pages, and the `<city>.mclaren.com`
subdomains just redirect there. Sites were derived as `mclaren<city>.com` and verified (page must be 200 and
mention McLaren); the five that didn't fit the pattern (Denver, San Diego, Troy, Orlando, Walnut Creek) were
found by web search — they're multi-brand exotic stores (mclaren-denver.com, sandiegoluxurymotors.com,
exoticmotorcarsofmichigan.com, mclarencf.com, theluxurycollectionwc.com). `us_retailers.json` holds the
feed rows plus the resolved `website`.
