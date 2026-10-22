# Why Team Velocity and Dealer.com stock numbers (and some Team Velocity prices) stay blank

Read-only, 2026-10-22, from box1's saved data only (`data/inventory/*.json` shard records and `data/dom_blobs/<VIN>/<date>.html.gz`); no live page was fetched and nothing was written on any box. Boxes 3 and 4 could not be reached (SSH timed out from the changing source IP), so box1 is the only box read; the platforms and dealers are the same templates the other boxes crawl. What the boxes cache is **not the full page**: `dom_store.extractVehicleDom` keeps a short extract (the DDC dataLayer, or one JSON-LD block, or a window around the VIN). Where that leaves a question open it is said below.

## Dealer.com: stock is blank because the dealer publishes none (31 of 31 sampled)
Sample: 40 stock-blank and 40 stock-present new Toyotas (LA, DE, KS, RI, CT shards), newest cached extract per VIN.
| Group | Cars with an extract | dataLayer `status` | dataLayer `stockNumber` |
|---|---|---|---|
| stock blank in our data | 31 | In Transit At Factory 26, In Transit 5 | `"null"` on all 31 |
| stock present | 34 | Live 20, In Transit 7, In Transit At Factory 4 (+3 with no key) | a real value |
So the dealer's own `DDC.dataLayer['vehicles']` says `"stockNumber": "null"` for cars still on the way (some dealers assign a stock number to in-transit cars, these do not). #565's `sku` read cannot help: there is nothing to read. Fixture `dealercom_in_transit_datalayer_sample.html` (a real record, VIN/uuid made synthetic). **Not a bug; no extraction change proposed.**

## Team Velocity: stock and interior colour are never present, and #565's sku path has no Vehicle node to read
- Across box1's Team Velocity (`/viewdetails/`) cars (ID, IA, CT, DE, MN shards, 70+ dealers, many brands): **stock number is filled on 0 cars and interior colour on 0 cars**.
- For 27 sampled cars (stock-blank, plus price-OK ones) the cached extract is the dealer's `@graph` (AutoDealer, AutoRepair, GeoCoordinates, ImageObject, Offer for the store ...) and **none of those pages has a JSON-LD block that contains the car's VIN** (the extractor looks for one first). There is no Vehicle node, no `sku`, no `productID`. So #565's `@graph` parse and `sku` read have nothing to act on: the constructed fixture they were built from (`team_velocity_graph_vdp_sample.html`) does not match these pages. Fixture `team_velocity_dealer_only_jsonld_sample.html` is a real one (Idaho Toyota store).
- **Where the stock number lives on those pages is not established.** The cache stored the dealer block instead of the car (see the fix below), so it holds no stock text. Visible text / data attributes / inline JS near the VIN are the candidates; they need a saved page that includes the vehicle area.

## Team Velocity price: two groups, from record fields (does the pixel parse?)
`exteriorColor`, `transmission` and `bodyStyle` on a Team Velocity record come only from the Facebook Pixel ViewContent call (#286), so their presence shows the pixel was found and read.
| Group | Dealers (box1 shards) | Evidence | Why #569 misses |
|---|---|---|---|
| A. pixel read, price still blank for a minority (3-14% of that dealer's cars) | Girard Toyota 38/249, Lia Hyundai Hartford 203/1,510, Lia Honda Enfield 43/988, Lia Nissan Enfield 43/937, Carousel Nissan 24/167, Eden Prairie Nissan 27/332, Invergrove Toyota 18/971, Union Park Volvo 26/213, Young Mazda 54/1,303 | colour, transmission, body style present, price blank | the call itself carries no usable `price` for those cars (0, absent or text) |
| B. pixel never read: **all** cars blank | Teton Toyota 323, Smart Toyota QC 146, Colchester Toyota 86, Westbrook Toyota 94, Charles Toyota 86, plus Nissan/Honda/VW/Subaru/Hyundai/Acura stores (Harte, Tri-State, Smart Honda, Teton, Cole, ...) | colour, transmission, body style all 0; model and trim only from the title/URL | no `fbq('track','ViewContent',{content_type:'vehicle'...})` is parsed on these pages (absent, or in another form); price is shown some other way (or hidden) |
Box4's price-blank Team Velocity pages were not read (no access), so box4 is not covered here. Group B's pages are not in the cache either (dealer block only), so where their price lives is also not established.

## Dedup note
The DOM blob is keyed by VIN+date, not by store, so a VIN listed by two dealers (group inventory) keeps whichever page was crawled last: one Colchester Team Velocity VIN's blob was another dealer's DealerOn page (a JSON-LD offer with `price: 34924.0` and a `priceSpecification` whose type is `UnitPriceSpecification`). Not a cause of the blanks, but it means the blobs are not a per-store record.

## The fix in this PR (so the next look can answer the open questions)
`dom_store.extractVehicleDom` fell through to "any JSON-LD block that mentions Vehicle/Car/Product" when no block carried the car's VIN. On Team Velocity that block is the dealer graph (it matches on the word "vehicles"), so every car cached the same dealer text and nothing about the car. Now, when no block has the VIN and the VIN is on the page, it stores the page around the VIN (4,000 chars before, 8,000 after) instead, exactly the window the function already used as its last resort. Behaviour is unchanged for DDC pages, for any JSON-LD block that carries the VIN, and when the VIN is not on the page. Tomorrow's crawl then caches the vehicle area of Team Velocity pages; the follow-up is to read where stock and price live there (and to widen the window if the `fbq` call, which sits in the document head, is out of reach: that would need the extract to keep the ViewContent script too).
No extraction change for stock or price is proposed until a saved page shows where they are. Box install: `dom_store.js` is also on the boxes; no patch is included (the boxes' copies were not compared).
