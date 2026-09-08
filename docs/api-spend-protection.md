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
Every route below charges the guard's daily budget counter its **real**
estimated cost — see "Real MarketCheck pricing" further down — not a flat
per-request guess, since some of these fan out to several vendor calls per
request.

- `/api/inventory` when `provider=marketcheck` (the live tier; the default
  `smart_feed` tier used by ordinary browsing is unaffected and always
  free) — 1 vendor call
- `/api/manual-comparables`, `/api/ford-comparables`,
  `/api/genesis-comparables`, `/api/gm-comparables`,
  `/api/stellantis-comparables` — 1 vendor call each
- `/api/ford-sticker`, `/api/gm-sticker`, `/api/genesis-sticker`,
  `/api/stellantis-sticker` — the window-sticker PDF itself is a free
  official OEM fetch, but each of these routes also runs a
  `currentDealerForVin` lookup (who's advertising this VIN right now,
  as opposed to the sticker's factory ship-to dealer) — **1 real
  MarketCheck call per VIN pasted, on the primary homepage flow.** This
  was undiscovered and completely unguarded until 2026-09-08; it's gated
  now, and degrades to "current dealer unknown" (never fails the free
  sticker lookup) when blocked.
- `/api/listing-facts` (the compare page, auto-fires on load for up to 3
  VINs) — **up to 3 vendor calls per VIN** (search + price history,
  always; a conditional listing-detail call if one resolves) — up to 9
  calls in one request. The guard charges the worst case (all 3 fire per
  VIN), not a flat 1-unit estimate.
- Every `/api/{make}-sticker` route backed by the listing-feed engine
  (Porsche, Toyota, Honda, Nissan, Infiniti, Hyundai, Kia, Subaru, Mazda,
  Volkswagen, Audi, BMW, MINI, Mercedes-Benz, Volvo, Mitsubishi — all share
  one factory in `lib/listingFeedStickerRoute.ts`) — up to 2 vendor calls
  per VIN — **additionally off by default**, see below.
- Quote-request creation (`/api/deal-requests`, `/api/rfqs`) gets a
  per-IP cap in `middleware.ts`; `/api/rfqs/:id/invites` additionally gets
  a per-desk (per-dealer-name) cap, since one dealer's inbox shouldn't be
  spammable by many different buyers/IPs all naming the same dealer.
  (No MarketCheck cost of their own — gated for abuse, not spend.)

### A real user journey, end to end

Someone pastes a Ford VIN on the homepage, then the app navigates to the
compare page as part of the normal reverse-auction submission flow:

1. Paste VIN → 1 vendor call (`ford-sticker`'s dealer lookup) = **$0.002**
2. Compare page auto-loads → 1 call (`manual-comparables`) + up to 9 calls
   (`listing-facts` for up to 3 VINs) = **up to ~$0.032**

**Up to ~11 real MarketCheck calls, ~3.4¢, from one buyer looking at one
car — with zero clicking beyond pasting the VIN.** All of it is gated now;
before 2026-09-08 step 1 had no protection at all.

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

## Real MarketCheck pricing (confirmed 2026-09-08, marketcheck.com/apis/pricing)

The new contract charges **data fees on every call, on top of the monthly
plan fee, on every plan tier** — the plan buys you a rate limit (and, on
Basic, a monthly call allowance), not free calls. `lib/apiSpendGuard.ts`
exports `MARKETCHECK_CALL_COST_USD` with the rates that actually apply to
the endpoints TrimScout calls:

| endpoint TrimScout calls | published product name | price/call |
|---|---|---|
| `GET /v2/search/car/active` | Inventory Search API | **$0.002** |
| `GET /v2/history/car/:vin` | VIN History API | **$0.006** |
| `GET /v2/listing/car/:id` | *(no separate line item published — treated as Inventory-Search-equivalent; confirm with MarketCheck if exact precision matters)* | **$0.002** (assumption) |

TrimScout never calls MarketCheck's separately-priced "NeoVIN Enhanced
Decoder API" ($0.08/call) or "Epi VIN Decoder API" ($0.08/call) — the
15-manufacturer listing-feed engine (`lib/listingFeedBuild.ts`) uses the
same plain Inventory Search + Listing endpoints as everything else, just
per-VIN instead of per-search. If you ever wire in a real NeoVIN adapter
later (per the `OptionsProvider` interface's stated future path), it will
need its own cost constant here at $0.08/call — don't reuse
`MARKETCHECK_CALL_COST_USD.search` for it.

## Environment variables

| var | default | what it controls |
|---|---|---|
| `PAID_VIN_DECODE_ENABLED` | `false` | Kill switch for the 15-manufacturer listing-feed VIN/options decode engine. Returns a `503` (temporarily unavailable) instead of calling MarketCheck when off. **Leave this off until the seed shortlist's honesty checks are green** — flip to `true` deliberately, not as a side effect of another change. |
| `PAID_DECODE_DAILY_BUDGET_USD` | **`0` — fails closed** | Hard ceiling on estimated daily spend across every gated route. **Every gated route returns `429` until this is explicitly set** — there is no default dollar figure here anymore, on purpose: only the account holder can say what they're willing to spend per day on a real, billed contract. Once reached, gated routes return `429` (or fall through to the free tier, for `/api/inventory` specifically) until the UTC day rolls over. See "Picking a number" below. |
| `PAID_DECODE_EST_COST_USD` | `0.002` (Inventory Search rate) | Fallback per-call estimate for any call site that doesn't report its own real cost via `estCostUsd`. Every call site in this codebase currently does report its own real cost (see the table above) — this fallback only matters for a future call site that doesn't. |
| `PAID_DECODE_PER_IP_LIMIT` / `PAID_DECODE_WINDOW_MS` | `20` / `60000` | Per-IP request cap on gated routes. |
| `PAID_DECODE_ALERT_QPS_THRESHOLD` / `PAID_DECODE_ALERT_WINDOW_MS` | `30` / `600000` | Spike-without-conversion alert thresholds (see `spend_alert` above). |
| `QUOTE_REQUEST_PER_DESK_DAILY_LIMIT` | `15` | Per-dealer-name daily cap on RFQ invites, across every buyer/RFQ. |

### Picking a `PAID_DECODE_DAILY_BUDGET_USD` number

At real rates, a dollar goes a lot further than the old placeholder
implied — e.g. $5/day covers roughly 2,500 comparables searches, or ~150
full compare-page views (VIN paste + compare page, ~3.4¢ each from the
journey above), or ~2,500 VIN pastes on the primary homepage flow. The
real constraint worth checking against your MarketCheck plan tier is the
**included monthly call volume** (Free: 500/mo, Basic $299/mo: 5,000/mo,
Standard $749/mo: unlimited at higher throughput) — a $ budget here
doesn't know which plan you're on, so it can't warn you separately about
crossing your plan's included-call line versus your comfort spending
limit. Set the number based on: expected daily traffic × ~$0.002–$0.03 per
visitor interaction (see the journey above), with headroom for a bad day,
and tune down if invoices come in lower than expected.

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
