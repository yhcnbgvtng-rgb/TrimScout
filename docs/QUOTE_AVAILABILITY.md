# Dealer availability confirmation on a quote

Before a dealer can submit a quote on the invite-link page (`/quote-request/received?t=…`), they answer one required question for the exact car (VIN shown):

- **Yes, this exact vehicle (VIN shown) is in stock and available.** The quote is for that car. The server stamps the confirmation time (never the browser's).
- **No, it's sold or unavailable.** The dealer either **declines the quote request** (the existing decline, nothing new stored) or **offers a comparable vehicle** under its own, different 17-character VIN. That quote is saved as an alternative; the sheet says it is a different vehicle.

An unanswered question blocks the submit in the form (client) and with a 422 in `used-quote` / `lease-quote` (server, `lib/quoteAvailability.ts: resolveAvailability`).

## What the buyer sees (Deal Tracker, per quoting desk)

- `Dealer confirmed available · Nov 3, 2:05pm`
- `Dealer says sold, offered an alternative`
- Quotes sent before this change show nothing. Only the desk name and the line are shown: no contact details.

## Storage and deploy order (nothing below has been run)

1. **Migration (additive):** `scripts/box/2026-11-03-rfq-quote-availability.sql` adds `rfq_quotes.availability_json TEXT NULL`. No drops, no backfill. Rollback: `DROP COLUMN IF EXISTS availability_json` (unused until step 3).
2. **Box code:** `python3 scripts/box/rfq-quote-availability-patch.py /opt/trimscout-deals/src/deals_api_server.js` stores the field on insert and returns it as `availability` on the quote. It refuses if an anchor is missing and is a no-op when already applied. It needs the usual idle window and a deals-api restart, on Paul's GO. Test it on a copy first.
3. **App:** the Vercel deploy. If the app ships before step 2, the dealer is still asked and the server still enforces the answer, but the box ignores the extra field, so the buyer sees no line until the box is patched. Ship the box first.

The repo mirror `scrapers/lightsail-crawler/src/deals_api_server.js` is md5-pinned by the box install packages, so it is intentionally not edited here; regenerate it from the box after step 2.
