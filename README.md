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
3. Step 2: paste a VIN or dealer URL in the existing paste field. Some dealer URLs (e.g. Dealer.com hash paths) have **no VIN in the URL**. TrimScout fetches that page once and reads JSON-LD / labeled VIN fields. It will not treat AWS instance ids or hashes as VINs. If the dealer site blocks the fetch, paste the 17-character VIN — we will not decode a mock Explorer/Porsche.
4. Enter **your ZIP** and **search radius in miles** next to that box (placeholders like `07405` / `100` are examples only — fields stay empty until you type). Those values are required before suggestions run. They are never hardcoded and never silently defaulted to 100.
5. TrimScout fetches the official Ford Direct PDF (server-side, no account):
   `https://www.windowsticker.forddirect.com/windowsticker.pdf?vin={VIN}`
6. Factory options come from that sticker as **checkboxes** (not mock package lists). **Every box starts unchecked** — Ultimate Package and keypad are examples of filters, not defaults. Exterior (and interior, if parsed) color is listed. Standard `KEYLESS ENTRY W/PUSH START` is never a filter even if the user ticks other lines. Toggling must-haves re-runs the hunt when ZIP + radius are set. Empty ticks = same model in radius, no option filter.
7. After paste **and** zip+radius, the **Increase Competition** slots **are** the two nearest sticker-confirmed similar lots **within your radius of your ZIP** that have **every ticked must-have** on their Ford sticker (including color if ticked). No extra “Fill both slots” click. Each card shows dealer, VIN, and miles-from-your-ZIP even when the lot has no dealer URL. Distance from your ZIP decides the two slots — not price or optional overlap. Lots outside the radius or missing a must-have are dropped — we do not pad. If ZIP/radius are missing, the hunt is in flight, nothing is in range, demo inventory is Explorer-only (e.g. a Bronco Sport), or the search errors, **that block shows one clear reason** instead of empty paste boxes. Demo Explorer lots are not applied to a Bronco Sport (or any other model).

Worked example must-haves: Ultimate Package **and** Keyless Entry Keypad. Distance is from the **user ZIP**, not the subject dealer ZIP.

| VIN | Result |
| --- | --- |
| `1FMWK8JC7TGB81309` Jim Shorkey Ford, White Oak PA | Keep **only if** your radius covers ~300 mi from your ZIP (e.g. 07405 + 400+). At 07405 + 100 mi → drop `outside_radius`. |
| `1FMWK8JC1TGB69561` Battlefield Ford, Culpeper VA | Keep **only if** your radius covers ~250 mi. At 07405 + 100 mi → drop `outside_radius`. |
| `1FMWK8JC7TGA20216` Mall of Georgia Ford | Drop (Ultimate, no keypad) |
| `1FMUK8JH8TGB25138` All American Ford Old Bridge | Drop (2.3L VIN prefix `1FMU`) |
| `3FMCR9BN8TRE94740` Route 23 Bronco Sport Big Bend | Subject vehicle (not Explorer). Demo Tremor lots are not suggestions. |

### Ford rules baked in

- VIN prefix `1FMWK` = 3.0L EcoBoost V6. Prefix `1FMU` = 2.3L. A 2.3 is not a match for a 3.0 Ultimate hunt.
- `KEYLESS ENTRY W/PUSH START` is **standard**. It is never a must-have filter. User “keyless entry” means the $455 door-pillar **Keyless Entry Keypad**.
- Must-have = hard filter on sticker text. Nice-to-have = overlap score, then lower price, then closer.
- Placeholder PDFs (“The window sticker has not yet been released”) are `unreleased`. Dealer ad copy is never proof.
- Every price/option is labeled `sticker`, `listing`, or `unconfirmed`. For **any** Ford VIN: a pasted VDP’s advertised selling price (JSON-LD `offers.price` / Sale / Internet / Our price) is the listing number; Ford Direct TOTAL MSRP is the MSRP line. VIN-only or a blocked scrape → sticker MSRP, listing omitted/`unconfirmed`. Increase Competition lots use listings-API price, else that lot’s VDP sale price, else that VIN’s sticker MSRP. Never invent a number and never print **call dealer**.

### What works without listings API keys

Ford sticker fetch + parse always work. Demo Increase Competition for Explorer Tremor uses bundled sticker fixtures (no listings key, no live PDF round-trip for those example lots). Nationwide live inventory search for other models needs a key.

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
