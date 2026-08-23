---
description: TrimScout project memory, architecture guidelines, and conversation history
globs: ["**/*"]
---

# TrimScout Project Memory & Rules

## Project Identity & Stack
- **Project**: TrimScout – Luxury Automotive Marketplace & Market Intelligence Engine.
- **Frontend**: Next.js 14 (App Router), React, TypeScript, TailwindCSS, Lucide Icons.
- **Scraper & Crawler**: AWS Lightsail (`34.205.155.92`, Ubuntu 24.04 LTS), Node.js (Crawlee / Axios / Cheerio) + Python (BeautifulSoup / openpyxl / sqlite3).
- **GitHub**: `https://github.com/yhcnbgvtng-rgb/TrimScout.git`

## Core Rules & Architecture
1. **Zero Fake Listings**: Search results must be backed by live verified dealer inventory feeds or validated crawl datasets.
2. **Dealer VDP Direct Links**: Always prioritize direct vehicle detail links on originating franchise dealer websites.
3. **Immutable VIN Cache**: Vehicle VIN specifications (NHTSA plant origin, engine specs, Porsche PR option codes) are immutable once manufactured. Cache in `data/enriched_cache.json` and never repeat external API calls for already-enriched VINs.
4. **Market Intelligence Filtering**: Support instant client-side filtering by Model, Condition (New/CPO/Used), Factory Options (e.g. `8LH`, `2UH`, `1LX`), Price Sorting (High to Low, Low to High), and Geo Distance (Closest to ZIP).
5. **Documentation**: Detailed conversation logs and architectural designs are maintained in `docs/CONVERSATION_HISTORY.md` and `docs/PROJECT_KNOWLEDGE_BASE.md`.
