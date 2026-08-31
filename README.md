# TrimScout

Whole-market vehicle search and dealership reverse-auction bidding. Next.js + Tailwind, deployed on Vercel.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Paste-a-VIN similar lots (Ford window sticker)

This lives **inside Launch Dealership Bidding Hunt** (`components/BiddingWizard.tsx`) — not a separate page.

### How to run it

1. Click **Bid Out a Deal** / **Launch Dealership Bidding Hunt**.
2. Step 1 payment defaults to **Cash**.
3. Step 2: paste a VIN or dealer URL in the existing paste field. Placeholder / test VIN: `1FMWK8JCXTGB47204`.
4. TrimScout fetches the official Ford Direct PDF (server-side, no account):
   `https://www.windowsticker.forddirect.com/windowsticker.pdf?vin={VIN}`
5. Factory options come from that sticker. **Ultimate Package** and **Keyless Entry Keypad** are pre-checked as must-haves when those lines exist.
6. The **Increase Competition** area (2 optional secondary slots) auto-fills up to two sticker-confirmed similar lots.

Worked example must-haves: Ultimate Package **and** Keyless Entry Keypad.

| VIN | Result |
| --- | --- |
| `1FMWK8JC7TGB81309` Jim Shorkey Ford, White Oak PA | Keep |
| `1FMWK8JC1TGB69561` Battlefield Ford, Culpeper VA | Keep |
| `1FMWK8JC7TGA20216` Mall of Georgia Ford | Drop (Ultimate, no keypad) |
| `1FMUK8JH8TGB25138` All American Ford Old Bridge | Drop (2.3L VIN prefix `1FMU`) |
| `1FMWK8JC2TGB72467` / `1FMWK8JC5TGA02149` | Unreleased sticker → not a match |

### Ford rules baked in

- VIN prefix `1FMWK` = 3.0L EcoBoost V6. Prefix `1FMU` = 2.3L. A 2.3 is not a match for a 3.0 Ultimate hunt.
- `KEYLESS ENTRY W/PUSH START` is **standard**. It is never a must-have filter. User “keyless entry” means the $455 door-pillar **Keyless Entry Keypad**.
- Must-have = hard filter on sticker text. Nice-to-have = overlap score, then lower price, then closer.
- Placeholder PDFs (“The window sticker has not yet been released”) are `unreleased`. Dealer ad copy is never proof.
- Every price/option is labeled `sticker`, `listing`, or `unconfirmed`. Missing listing price → **call dealer**. Prices are never invented.

### What works without listings API keys

Ford sticker fetch + parse + demo comparables always work (they hit Ford Direct live for the subject VIN and the known demo VINs above). Nationwide live inventory search needs a key.

```bash
npm test
```

### Env vars (do not commit secrets)

| Variable | Required? | Role |
| --- | --- | --- |
| `AUTO_DEV_API_KEY` | No | Preferred coarse listings (`GET https://api.auto.dev/listings`). Free plan: listings + VIN decode, **no OEM Build**. |
| `MARKETCHECK_API_KEY` | No | Fallback listings (`/v2/search/car/active`). |

Listings APIs filter year/make/model/trim/zip. They cannot filter Ultimate / BlueCruise / keypad. After a coarse query we sticker-pass only the first 25–50 candidate VINs.

### What this is not

- Not a Visor.vin clone, VIN warehouse, or daily scrape of Ford rooftops.
- Not ChromeData / VinAudit / GoodCar as Ford source of truth.
- Not hooked to the existing BMW/Porsche scrapers, Excel, or SQLite inventory.
- Do not bulk-crawl Ford Direct. Lookups are user-initiated (subject VIN + up to 50 hunt candidates).
