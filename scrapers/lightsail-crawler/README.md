# Paul Miller Porsche Daily VIN Tracker & Scraper (Apify Actor)

A high-performance Apify Actor designed to crawl, scrape, and monitor **all vehicle inventory** at **Paul Miller Porsche** (Parsippany, NJ). It automatically tracks every vehicle by **VIN**, detects **daily inventory changes** (new arrivals, sold/removed vehicles, price drops, and spec updates), and records full pricing history over time.

---

## 🚀 Key Features

- **100% VIN Coverage**: Uses dynamic sitemap discovery to find every active vehicle detail page (New, Certified Pre-Owned, and Used Porsche inventory).
- **Persistent State Across Runs**: Uses an Apify Named Key-Value Store (`PORSCHE_PAUL_MILLER_STORE`) to compare today's crawl against yesterday's snapshot.
- **Daily Diff & Change Detection**:
  - `NEW_ARRIVAL`: Vehicles added to the dealership today.
  - `PRICE_DROP` / `PRICE_INCREASE`: Vehicles with updated pricing (calculates price difference and updates price history).
  - `SOLD_OR_REMOVED`: Vehicles that disappeared from the dealership lot since the last run.
  - `MODIFIED`: Mileage or classification changes.
  - `UNCHANGED`: Active vehicles with identical specs.
- **Days on Lot & Price History**: Tracks `firstSeen`, `lastSeen`, total days in stock (`daysOnLot`), and a chronological `priceHistory` array for every VIN.
- **Rich Specs Extraction**: Extracts VIN, Stock Number, MSRP, Sale Price, Mileage, Trim, Engine, Transmission, Drivetrain, Exterior & Interior Colors, Factory Packages/Options, and Image URLs.
- **Automated Alerts (Optional)**: Can send a JSON webhook payload to Slack, Discord, or Zapier when price drops or new inventory are detected.

---

## 📊 Extracted Data Schema

Each vehicle item pushed to the Apify Dataset has the following structure:

```json
{
  "vin": "WP1AA2A53TLB07942",
  "stockNumber": "260349",
  "inventoryType": "NEW",
  "year": 2026,
  "make": "Porsche",
  "model": "Macan",
  "trim": null,
  "bodyStyle": "SUV",
  "price": 73260,
  "msrp": 73260,
  "salePrice": 73260,
  "askingPrice": 73260,
  "mileage": 0,
  "exteriorColor": "Volcano Grey Metallic",
  "interiorColor": "Standard Interior in Black",
  "engine": "2.0L I4 Turbocharged",
  "transmission": "7-Speed Porsche Doppelkupplung (PDK)",
  "drivetrain": "All-Wheel Drive",
  "fuelEconomy": "19/25",
  "options": [
    "Premium Package Plus",
    "Panoramic Roof System",
    "14-Way Power Seats with Memory Package",
    "LED Headlights with Porsche Dynamic Light System Plus",
    "Rear Heated Seats",
    "Surround View ($1240)",
    "Heated Steering Wheel ($280)",
    "Wheel Center Caps with Colored Porsche Crest ($200)"
  ],
  "photos": [
    "https://pictures.dealer.com/p/paulmillerporscheparsippany/..."
  ],
  "url": "https://www.paulmillerporsche.com/new/Porsche/2026-Porsche-Macan-parsippany-new-jersey-dfe5c34bac1851fd6fc6447aa3ce6495.htm",
  "status": "ACTIVE",
  "changeType": "PRICE_DROP",
  "oldPrice": 74500,
  "priceDiff": -1240,
  "firstSeen": "2026-08-20",
  "lastSeen": "2026-08-23",
  "daysOnLot": 3,
  "priceHistory": [
    { "date": "2026-08-20", "price": 74500 },
    { "date": "2026-08-23", "price": 73260, "diff": -1240 }
  ],
  "updatedAt": "2026-08-23T19:15:00.000Z"
}
```

In addition to individual vehicle records, each run generates a `DAILY_SUMMARY` report:

```json
{
  "recordType": "DAILY_SUMMARY",
  "dealership": "Paul Miller Porsche",
  "date": "2026-08-23",
  "timestamp": "2026-08-23T19:15:00.000Z",
  "stats": {
    "totalActiveInventory": 302,
    "averagePrice": 104500,
    "newArrivalsCount": 4,
    "soldOrRemovedCount": 2,
    "priceDropsCount": 3,
    "priceIncreasesCount": 0,
    "modifiedCount": 0,
    "unchangedCount": 295
  }
}
```

---

## 🛠️ Deployment & Execution Options

### Option 1: Deploy to Apify via Apify CLI (Recommended)

1. Install the Apify CLI:
   ```bash
   npm install -g apify-cli
   ```
2. Log in to your Apify account:
   ```bash
   apify login
   ```
3. Inside this directory, build and deploy the Actor:
   ```bash
   apify push
   ```

### Option 2: Connect via GitHub
1. Push this folder to a GitHub repository.
2. In the [Apify Console](https://console.apify.com/), navigate to **Actors** -> **Create new** -> **Git repository**.
3. Link your GitHub repository. Apify will automatically build the container from `Dockerfile`.

### Option 3: Run Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the crawler:
   ```bash
   npm start
   ```
   Outputs will be stored locally in the `storage/` folder (`storage/datasets/default` and `storage/key_value_stores`).

---

## ⏰ Setting up Daily Automated Tracking on Apify

To automatically monitor changes every day without manual intervention:

1. Open your Actor in the **Apify Console**.
2. Click the **Schedules** tab (or go to **Actors** -> **Schedules** -> **Add schedule**).
3. Set Cron Expression to `0 6 * * *` (Runs every morning at 6:00 AM UTC).
4. Select your Actor as the target.
5. In Actor Input, you can keep default parameters or provide a `notifyWebhookUrl` for daily Slack/Discord alerts.

---

## ⚙️ Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `sitemapUrl` | String | `https://www.paulmillerporsche.com/sitemap.xml` | Discovery endpoint for all inventory |
| `storeName` | String | `PORSCHE_PAUL_MILLER_STORE` | Named KV store to persist state between runs |
| `includeSold` | Boolean | `true` | Include sold/removed vehicles in dataset output |
| `notifyWebhookUrl` | String | `""` | Optional webhook endpoint for daily summary alerts |
| `maxConcurrency` | Integer | `10` | Number of simultaneous page requests |
| `proxyConfiguration` | Object | `{ "useApifyProxy": false }` | Apify proxy settings |
