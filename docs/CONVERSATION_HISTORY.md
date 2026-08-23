# TrimScout Conversation History & Project Memory

> **Archive Scope**: All Antigravity AI pair programming sessions from August 20, 2026 to August 23, 2026.  
> **Repository**: `https://github.com/yhcnbgvtng-rgb/TrimScout.git`  
> **Target Production**: TrimScout Luxury Automotive Intelligence Platform  
> **AWS Lightsail Crawler**: `34.205.155.92` (Ubuntu 24.04 LTS)

---

## 📑 Executive Summary

Over the course of 12 distinct conversations and over 190 user interaction cycles, TrimScout evolved from an initial concept and Next.js frontend prototype into a full-scale **Automotive Market Intelligence Platform**. Key milestones achieved across these sessions include:

1. **Next.js 14 Frontend & Interactive Explorer**: Full vehicle explorer with dynamic filter chips, distance radius calculations, dealer website deep-linking, Monroney Window Sticker preview modals, and hidden administrative backends.
2. **Multi-Platform Scraper Engines (Python & Node.js)**: High-performance sitemap and VDP scrapers targeting franchise dealerships across Dealer.com, DealerOn, CDK Global, and custom dealer platforms.
3. **Nationwide Dealer Coverage**: Discovery and cataloging of all **218 official US Porsche Centers** spanning all 50 states.
4. **Dedicated AWS Lightsail Distributed Crawler**: Scaled crawler from Apify to a dedicated, low-cost AWS Lightsail instance (`34.205.155.92`) running throttled, memory-safe multi-threaded crawls.
5. **OEM & NHTSA VIN Enrichment Pipeline**: Cross-referencing 6,700+ scraped vehicle VINs with **NHTSA VPIC API** (origin plant, engine specifications) and the **Porsche Factory Options & Monroney Catalog** (extracting PR codes like `8LH` Sport Chrono, `2UH` Front Axle Lift, `1LX` PCCB, `9VJ` Burmester, `0P9` Sport Exhaust, `Q1J` 18-Way Seats).
6. **Live Market Intelligence UI**: Dedicated `/intelligence` and home view with multi-faceted filtering (Model, Condition, Options, Price Sorting, Closest to ZIP code).

---

## 🧭 Master Chronology & Conversation Breakdown

---

### Track 1: Next.js Frontend & Core Application Development
**Primary Conversation ID**: `031a48b8-0f62-4125-a9e2-c2487a48e93b`  
**User Prompts**: 89 turns | **Total Steps**: 1,788 steps  
**Timeline**: August 20, 2026 – August 23, 2026  

#### Objectives & User Prompts:
- **Repository Setup**: Initialized Git repository, connected to GitHub (`https://github.com/yhcnbgvtng-rgb/TrimScout.git`) with personal access token authentication.
- **Copywriting & Branding**: Removed references to guaranteed pricing or warranty claims; aligned branding with verified dealer transparency.
- **Live Inventory Integration**:
  - Integrated `Auto.dev` API (`sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a`) and `Marketcheck` API endpoints.
  - Resolved vehicle listing limits (bypassed 100-result pagination limits).
  - Implemented ZIP code radius search (default 25-mile radius with Haversine distance formula).
  - Built auto-populating dynamic dropdown filters for Make, Model, Year, Trim, and Condition (New / Used / Certified Pre-Owned).
- **Deep-Linking & Dealer Website Direct Linking**:
  - Explored `visor.vin` link mechanisms.
  - Implemented intelligent Dealer VDP Resolver (`lib/scrapers/dealerLinker.ts`) that matches VINs directly to the specific vehicle detail page on franchise dealer websites rather than generic search pages or portal redirects.
- **User Accounts & Deal Room**:
  - Built user signup / login modal interfaces for deal tracking.
  - Created a protected administrative portal (`app/admin/page.tsx`) to manage vehicle feeds, scraper triggers, and dealer roster mappings.
- **Pitch Deck & Monetization Strategy**:
  - Generated an automated 16:9 executive PowerPoint pitch deck (`TrimScout_Business_Case_Pitch_Deck.pptx`) via `scripts/generate_pitch_deck.js`.
  - Structured monetization models: Dealer Success Fees ($199–$399/deal), Dealership SaaS rooftop subscriptions ($499–$999/mo), and Concierge services ($149).
- **UI Bug Fixes**:
  - Fixed input field focus loss where users could only type one character at a time in filter inputs (re-rendering / key identity fix).
  - Refactored navigation to streamline search into a unified Market Intelligence interface.

---

### Track 2: Python Scraping Engines & Data Modeling
**Primary Conversation ID**: `903618a4-1d36-4e5b-8db1-b8c4a2e99a94`  
**User Prompts**: 39 turns | **Total Steps**: 445 steps  
**Timeline**: August 21, 2026  

#### Objectives & User Prompts:
- **Porsche New Jersey Pilot**:
  - Scraped all New Jersey Porsche dealerships (Paul Miller Porsche, Porsche Englewood, Porsche Monmouth, Porsche Cherry Hill, Porsche Princeton).
  - Captured VIN, stock number, MSRP, dealer price, mileage, exterior/interior colors, engine, transmission, direct dealer link, and window sticker URLs.
- **Database Architecture**:
  - Designed normalized relational SQLite schemas (`porsche_nj_schema.sql`, `porsche_usa_schema.sql`, `bmw_schema.sql`).
  - Implemented daily diff tracking: `inventory` (active snapshot), `price_history` (date, old_price, new_price, delta), `days_on_lot` calculation, and `inventory_log` (new arrivals, sold/delisted vehicles).
- **Multi-Brand Expansion**:
  - Developed `bmw_tracker.py` for nationwide BMW franchise inventory.
  - Developed `universal_automotive_engine.py` and `strict_engine.py` with strict schema validation and multi-threaded parallel downloads.
- **Spreadsheet Generation**:
  - Generated automated, styled Excel reports with openpyxl:
    - `Porsche_NJ_Inventory_Tracker.xlsx`
    - `Porsche_USA_Nationwide_Inventory_Tracker.xlsx`
    - `BMW_USA_Nationwide_Inventory_Tracker.xlsx`
    - `Universal_Automotive_Inventory_Tracker.xlsx`
    - `AI_Verified_Luxury_Inventory_Tracker.xlsx`

---

### Track 3: Distributed AWS Lightsail Crawler & Porsche VIN Enrichment
**Primary Conversation ID**: `cbd6cd6d-3dbe-4a5c-9a68-d332f8ff0342`  
**User Prompts**: 54 turns | **Total Steps**: 647 steps  
**Timeline**: August 23, 2026  

#### Objectives & User Prompts:
- **Apify Actor to AWS Lightsail Transition**:
  - Initially built an Apify Actor (`.actor/actor.json`, `src/main.js`) with Crawlee.
  - Cost analysis showed running 210+ dealerships daily on Apify would incur ongoing compute unit costs.
  - Pivoted to a dedicated AWS Lightsail instance (Ubuntu 24.04 LTS, IP: `34.205.155.92`).
- **SSH & Server Provisioning**:
  - Configured SSH keys (`~/.ssh/config` alias `ssh lightsail`).
  - Created automated remote deployment script (`deploy.sh`).
  - Resolved Lightsail CPU burst exhaustion by tuning concurrency, adding request delays, and implementing streaming JSON writes.
- **Nationwide Roster Scaling (5 → 27 → 160 → 184 → 218 Dealerships)**:
  - Iteratively discovered and validated official Porsche dealership domains.
  - Built `src/discoverDealers.js` to compile the complete, verified list of **218 authorized US Porsche Centers** across all regions (`dealers.json`).
- **Porsche Finder & Monroney Factory Option Enrichment Engine**:
  - User requested cross-referencing VINs against factory build sheets / Monroney stickers.
  - Built `src/enricher.js` and `lib/enrichmentEngine.ts`:
    - **NHTSA VPIC API**: Decodes manufacturing plant (Stuttgart-Zuffenhausen, Leipzig, Osnabrück, Bratislava), engine displacement (3.0L, 3.8L, 4.0L Boxer-6), transmission, and fuel type.
    - **Porsche OEM Option Catalog**: Regex and keyword matching against official Porsche build codes:
      - `8LH`: Sport Chrono Package with mode switch & Porsche Track Precision App
      - `2UH`: Front Axle Lift System
      - `1LX`: Porsche Ceramic Composite Brakes (PCCB)
      - `9VJ`: Burmester® High-End 3D Surround Sound System
      - `0P9`: Sport Exhaust System with dual tailpipes in High Gloss Black/Silver
      - `Q1J`: Adaptive Sports Seats Plus (18-Way, Electric) with memory
      - `1P7`: Porsche Dynamic Chassis Control Sport (PDCC)
      - `0N5`: Rear Axle Steering
      - `8IS`: LED Headlights incl. Porsche Dynamic Light System Plus (PDLS+)
      - `VR4`: SportDesign Side Skirts
      - `UD1`: Under-Door Puddle Light Projectors
    - **Immutable Caching (`data/enriched_cache.json`)**: Queries external sources only once per VIN lifetime; subsequent crawl cycles run in sub-second time.
- **Market Intelligence UI & Sorting**:
  - Integrated enriched dataset directly into TrimScout via `app/api/lightsail/route.ts` and `components/LightsailIntelligence.tsx`.
  - Added filter presets and sorting:
    - **Closest to ZIP** (Haversine geospatial distance calculation)
    - **Price: High to Low**
    - **Price: Low to High**
  - Built interactive **Monroney Window Sticker Modal** with line-by-line option prices and financial calculation (Base MSRP + Total Options + Delivery = Total Window Sticker).

---

### Track 4: Auxiliary Technical Sessions
- **`1ff81584-921e-42a9-b3d5-7227755aa414`**: AWS Lightsail console connectivity, CPU utilization throttling strategies, crawl time estimations.
- **`6f99d1dc-2254-4a36-b671-6b02a454b5f5`**: Connecting Lightsail directly to Antigravity CLI and deployment workflows.
- **`a6c79386-b1ea-4cff-b94b-f6283e901bf2`**: Data analysis techniques on Lightsail (SQLite vs JSON streaming vs Pandas).
- **`ed175bd3-667b-4589-ba56-09ebf85eb917`**: Direct Monroney window sticker URL schema investigation across Dealer.com and OEM web services.
- **`07b1d0aa-6020-42ba-86d8-5169d5cca50f`**: macOS CPU and system resource profiling commands.
- **`5b331d28-af97-4db8-9ddf-dae8a740b786`**: Custom domain email routing configuration.
- **`88808e0d-5f63-4695-8fba-5361c8773ade`**: AirPlay audio and display language configuration.
- **`8d90613b-062d-4364-b6eb-25f5abc35f85`**: Antigravity IDE architecture and capabilities.

---

## 🔑 Key Secrets & Configuration Parameters

| Service | Key / Identifier | Location | Notes |
| :--- | :--- | :--- | :--- |
| **GitHub Remote** | `https://github.com/yhcnbgvtng-rgb/TrimScout.git` | `.git/config` | Main project repository |
| **Auto.dev API** | `sk_ad_Xc5T6i3mwxFF1X8x_WbFNl5a` | `.env.local` | Vehicle inventory API key |
| **AWS Lightsail** | `34.205.155.92` (User: `admin`) | `~/.ssh/config` (`lightsail`) | Dedicated crawler host |
| **NHTSA VPIC API** | `https://vpic.nhtsa.dot.gov/api/` | `src/enricher.js` | Free federal VIN decoding API |
| **Porsche Roster** | 218 Authorized Dealerships | `dealers.json` | Complete nationwide list |

---

## 📌 Architectural Rules & Design Decisions

1. **Immutable VIN Cache**: Once a VIN is enriched with NHTSA data and OEM options, never re-query external APIs for that VIN. Spec sheets and factory options do not change after vehicle manufacture.
2. **Dealer VDP Direct Links**: Always provide a direct vehicle detail link to the originating dealership lot page rather than third-party aggregators.
3. **Zero Fake Listings**: All search results presented to the user must originate from real, verified dealer inventory feeds or validated crawl datasets.
4. **Lightweight Frontend Filtering**: Multi-category filtering and sorting (ZIP distance, price, options, model, condition) are executed client-side over memory-efficient memoized structures for instant UI response times.
