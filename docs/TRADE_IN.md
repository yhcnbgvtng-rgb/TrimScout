# Trade-in on a quote request

Buyers can attach a trade-in to a request (cash, finance or lease). Dealers appraise it inside TrimScout, and it
shows on the compare as its own lines, never inside the dealer's price or the monthly. **No email replies anywhere**:
dealers answer on their quote page; the only emails are the existing SAFE MODE notices (including one "photos
updated" notice per batch of changes).

## What the buyer enters (Configure Quote Request, Step 3 → "I have a trade-in", default off)
Off = nothing is collected or sent. On:

| Required | Optional ("Helps you get a sharper number") |
| --- | --- |
| VIN (17 chars + check digit; decoded read-only, "Not right? Enter manually" fallback) · mileage · ZIP (defaults to account ZIP) · condition band · title status · ownership (financed/leased also need lender + approximate payoff) · keys · accident/airbag/flood (Yes needs a note) · drivetrain · value-moving options · odometer-match checkbox · **six photos** | colors · service history + notes · tire/brake life · aftermarket mods · warning lights · intent (apply to deal / open to selling outright) |

No title documents, SSN or loan account numbers are collected.

## The six required photos
`front`, `rear`, `driver_side`, `passenger_side`, `odometer` (car ON, mileage readable, warning lights visible), `interior`.
Up to six recommended extras: `rear_cargo`, `tire_tread`, `damage_1`…`damage_4`. Nothing sends with fewer than six, and that
is enforced **server-side** (the Next.js route re-validates the draft against storage, and the box refuses it again).

Browser checks before a photo is accepted: ≥1024px short edge, not near-black, not heavily blurred (Laplacian variance),
JPEG/PNG/HEIC ≤10 MB. HEIC → JPEG, resized to ≤2048px long edge, re-encoded through a canvas (drops all EXIF including GPS;
the capture timestamp is read first and kept). Phones open the camera one slot at a time; desktops get upload plus a QR code /
copy link that resumes the same draft on a phone. Drafts autosave (fields + photos) and resume on any device.

Storage: private S3 (`scripts/aws/trade-photos-bucket.sh`), `trade/{quoteRequestId}/{slot}.jpg`, served only through
5-minute presigned URLs minted for the buyer or a dealer invited on that request. Upload endpoints are rate limited per
request, per buyer and per IP. Buyers can replace/add photos until they pick a quote; invited dealers get one notice per batch.

## Dealer side (only when a trade was sent)
Read-only summary + labelled gallery with lightbox and a "6/6 required photos" chip, then: trade allowance (one number **or**
low/high), valuation basis (**Preliminary** default, or **Firm** if the car matches the description and photos), good-until
(defaults to the vehicle quote's expiry), lien payoff confirmation with live equity (allowance − payoff, positive or negative),
optional conditions, and "Request more photos" (optional slots and/or a note; one open in-app request per desk; the core six are
never requestable). An allowance more than 50% off a value guide needs confirmation, but **only if** `TRADE_GUIDE_API_URL` is set.

## How equity flows into each deal type
`net equity = allowance − payoff` (a range uses the midpoint for ranking and shows low/high). Sales tax is whatever each dealer
quoted on the full price: **no trade-in tax credit is applied** (`TODO(tax)` in `lib/trade/otd.ts`; decide per state first).

| Deal | OTD before | OTD after | How equity is applied |
| --- | --- | --- | --- |
| Cash | price + fees + tax + add-ons − rebates | before − net equity (negative equity makes it larger) | comes off / onto the total |
| Finance | same | same | positive → cash down (amount financed − equity); negative → rolled into amount financed |
| Lease | n/a | n/a | positive → cap cost reduction; negative → rolled into cap cost |

The dealer's monthly is never recomputed; the applied amount and the adjusted principal / cap cost are shown beside it.
A pending or expired trade leaves the dealer's totals exactly as quoted. Each value is labelled Preliminary or Firm as set.
Cash ranks on post-trade OTD (ties: more net equity), highlighting best net equity and best post-trade OTD separately; finance and
lease keep their existing monthly-first order with the trade beside it.

## Data model (box JSON columns, like other RFQ extensions)
`scripts/box/2026-10-08-rfq-trade-in.sh` adds `rfq_requests.trade_in_json` (trade_in + trade_photo[] metadata),
`rfq_invites.trade_appraisal_json` (dealer_trade_appraisal), `rfq_invites.trade_photo_request_json` (trade_photo_request),
plus `trade_seen_at` / `trade_photos_notified_at` for the one-notice rule. `dealer_quote_id` is the invite id so an appraisal
survives a re-quote after a counter. Photo bytes are never in the database.

Code: `lib/trade/*` (types, validation, equity math, photo checks, storage, service), `components/trade/*`, routes under
`app/api/trade/**`, `app/api/rfqs/[id]/trade/**`, `app/api/quote-invite/trade`, phone page `app/trade/draft/[id]`.
