# API spend protection

Guardrails against runaway MarketCheck (and future NeoVIN) spend, without
putting a login wall or a CAPTCHA in front of the free match/shortlist
experience. No CAPTCHA on pageview, no login before a match, NeoVIN stays
off — none of that changed here.

## Two tiers

**Open (free, no vendor cost) — stays public:**
- The homepage and the "Find matches" / must-have shortlist flow
  (`components/FactoryMatchFlow.tsx` → `lib/seedOptionsProvider.ts`). This
  reads `MOCK_VEHICLES` entirely client-side — there's no server call to
  gate in the first place.
- `/admin` was already signed-in-admin-only before this change
  (`lib/adminAuth.ts`'s `requireAdminSession()`, enforced on the page and
  every `/api/admin/*` route) — nothing to add there beyond the polite
  `robots.txt` entry below.

**Gated (rate-limited + a hard daily $ budget, 429 before the vendor call):**
- `/api/inventory` when `provider=marketcheck` (the live tier; the default
  `smart_feed` tier used by ordinary browsing is unaffected and always
  free)
- `/api/manual-comparables`, `/api/ford-comparables`,
  `/api/genesis-comparables`, `/api/gm-comparables`,
  `/api/stellantis-comparables`
- `/api/listing-facts`
- Every `/api/{make}-sticker` route backed by the listing-feed engine
  (Porsche, Toyota, Honda, Nissan, Infiniti, Hyundai, Kia, Subaru, Mazda,
  Volkswagen, Audi, BMW, MINI, Mercedes-Benz, Volvo, Mitsubishi — all share
  one factory in `lib/listingFeedStickerRoute.ts`) — **additionally off by
  default**, see below. Ford/GM/Stellantis/Genesis's own `-sticker` routes
  parse free official OEM PDFs, not MarketCheck, and aren't touched.
- Quote-request creation (`/api/deal-requests`, `/api/rfqs`) gets a
  per-IP cap in `middleware.ts`; `/api/rfqs/:id/invites` additionally gets
  a per-desk (per-dealer-name) cap, since one dealer's inbox shouldn't be
  spammable by many different buyers/IPs all naming the same dealer.

## Where the code lives

- `lib/apiSpendGuard.ts` — the guard everything above calls into:
  `guardPaidDecode({ kind, request })` (rate limit + daily budget, returns
  `null` when allowed or `{ status: 429, message }` when not),
  `guardPerDeskCap(dealerName)`, `isPaidVinDecodeEnabled()`,
  `recordQuoteRequest()`, `logSpendEvent(type, payload)`.
- `lib/clientIp.ts` — the one shared "best guess at the caller's IP"
  helper, used by both `middleware.ts` (Edge runtime) and
  `lib/apiSpendGuard.ts` (Node route handlers). These are two different
  runtimes/processes on Vercel and do **not** share memory — see the
  limitation below.
- `middleware.ts` — per-IP request caps on auth/checkout/deal-requests/rfqs
  paths. Paid-vendor routes are deliberately **not** listed here; they're
  gated inside their own route handlers instead, because that gate also
  needs the shared daily-$-budget counter, not just a request count.
- `app/robots.ts` — disallows `/admin` and `/api` for well-behaved
  crawlers. This is the "polite" layer only — see below.
- `app/api/events/seed-match/route.ts` — a free, ungated beacon
  `FactoryMatchFlow` calls once per load, logged as its own event type so
  it's never conflated with paid_decode in the logs.

## Events (no dashboard — grep the logs or pipe them somewhere)

Every call to `logSpendEvent` writes one JSON line to stdout (`console.log`
for routine events, `console.error` for `paid_decode_blocked` and
`spend_alert` so they're easy to filter in Vercel's log viewer):

| event | fires when |
|---|---|
| `seed_match` | the free seed-match flow loads inventory |
| `paid_decode` | a paid-vendor call is about to be made (after the guard allows it) |
| `paid_decode_blocked` | the guard blocked a call — `reason` is `"daily_budget_exceeded"` or `"rate_limited"` |
| `quote_request` | a real deal-request or RFQ was created (the "did this paid traffic convert" signal) |
| `spend_alert` | `paid_decode` volume crossed `PAID_DECODE_ALERT_QPS_THRESHOLD` calls within `PAID_DECODE_ALERT_WINDOW_MS` with no `quote_request` in that same window |

Scoring (spend per IP/user per day, QPS, conversion rate) is meant to be
done **offline** against these log lines — no aggregation endpoint or
dashboard exists here, same pattern as the RFQ experiment's event log.
`paid_decode`'s payload includes `ip`, `kind` (which route/vendor call),
`estCostUsd`, and the running `dailyTotalUsd`, so per-IP $/day and QPS are
both directly computable from the raw lines.

## Environment variables

| var | default | what it controls |
|---|---|---|
| `PAID_VIN_DECODE_ENABLED` | `false` | Kill switch for the 15-manufacturer listing-feed VIN/options decode engine. Returns a `503` (temporarily unavailable) instead of calling MarketCheck when off. **Leave this off until the seed shortlist's honesty checks are green** — flip to `true` deliberately, not as a side effect of another change. |
| `PAID_DECODE_DAILY_BUDGET_USD` | `15` | Hard ceiling on estimated daily spend across every gated route. Once reached, every gated route returns `429` (or falls through to the free tier, for `/api/inventory` specifically) until the UTC day rolls over. |
| `PAID_DECODE_EST_COST_USD` | `0.05` | Flat per-call cost estimate used to decrement the budget — MarketCheck doesn't hand back real-time billing here, so this is a deliberately conservative placeholder. Tune it against real invoice data once you have some. |
| `PAID_DECODE_PER_IP_LIMIT` / `PAID_DECODE_WINDOW_MS` | `20` / `60000` | Per-IP request cap on gated routes. |
| `PAID_DECODE_ALERT_QPS_THRESHOLD` / `PAID_DECODE_ALERT_WINDOW_MS` | `30` / `600000` | Spike-without-conversion alert thresholds (see `spend_alert` above). |
| `QUOTE_REQUEST_PER_DESK_DAILY_LIMIT` | `15` | Per-dealer-name daily cap on RFQ invites, across every buyer/RFQ. |

None of these need to be set for the defaults above to apply — they only
need to exist in Vercel's env config once you want to tune them.

## Known limitation: this is in-memory, not distributed

Same tradeoff `middleware.ts` already made and documented before this
change: every counter here (`Map` in module scope) lives in one warm
serverless instance's memory. On Vercel, that means the real ceiling is
"per-instance limit × however many instances happen to be warm," not one
true global number — a determined attacker spread across enough cold
starts or regions could exceed these numbers. This still stops the common
case (one client, one leaked script, one hot instance) outright, and is a
large step up from no limit at all. A durable fix needs a shared store —
Vercel KV or Upstash Redis — and is a deliberate follow-up, not done here
(no such store is currently provisioned for this project).

## Why `/api/inventory` doesn't hard-fail on a block

Every other gated route's entire purpose is the paid call — there's
nothing free to fall back to, so a block returns a real `429`.
`/api/inventory` is different: it already has a legitimate, always-free
fallback tier (`smart_feed`) built into the same handler. When the
MarketCheck branch is blocked, the route falls through to that tier
instead of hard-failing, the same way it already falls through on a
missing API key or a failed vendor call. In practice this rarely matters —
the client (`lib/inventoryConnector.ts`) defaults to `smart_feed` already,
and nothing in the app currently opts into `provider=marketcheck`.
