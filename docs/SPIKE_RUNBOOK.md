# Spike runbook — "traffic just 10×'d, what do I flip?"

Browse scales on the CDN. Everything that costs money, writes rows or emails
a dealer sits behind a switch, a cap, or a queue. Flip switches in **Vercel →
Project → Settings → Environment Variables**, then redeploy (≈1 min). Nothing
needs the box.

## Switches

| Env | Default | Off means |
|---|---|---|
| `FEATURE_RFQ_SEND` | on | `POST /api/rfqs` and invites return **503 + Retry-After: 120**, buyer sees *"Quote requests are paused for a moment… your draft is saved"*, Send button disabled. No rows, no mail. |
| `FEATURE_OUTBOUND_DEALER_EMAIL` | on | Requests and invites still save (buyer HTTP 200, invite `queued`); **no dealer mail goes out**. Buyer sees *"Quotes are delayed — dealers will be notified as soon as sending resumes."* Turn back on and drain. |
| `FEATURE_STICKER_FETCH` | on | Window stickers served from cache only; misses read "pending". Quote flow never blocks on it either way. |
| `FEATURE_PAID_VIN_DECODE` / `MARKETCHECK_ENABLED` | off | Paid lookups stay off. |
| `FEATURE_LIVE_INVENTORY` | off | No live inventory calls on public routes. |

## Caps (429 + Retry-After)

Per instance (each serverless instance counts its own): RFQ create 20/IP/10 min,
12/account/10 min, 120/min global; invites 40/IP, 30/account, 300/min; signup
5/IP/10 min. (Per-account caps were 3 / 9 at launch and locked a single buyer
out mid-flow — the global caps are the spike guard, the per-client ones only
stop one hammering client.) Admins, `@trimscout.test` / `@example.com` smoke accounts, and anything in
`RATE_LIMIT_EXEMPT_ACCOUNTS` (emails or user ids) are never capped — `isRateLimitExempt`. Override with `RATE_<NAME>_LIMIT` / `RATE_<NAME>_WINDOW_MS`
(names in `lib/rateLimit.ts`). **Hard global ceilings live in Vercel Firewall
→ Rate Limiting** — add rules on `/api/rfqs*`, `/api/auth/*`, `/api/*-sticker`
before a launch; that layer is fleet-wide and free of instance math.

Structural caps that already exist: ≤3 desks per request, one open invite per
desk across all buyers (box 409), one active request per buyer, 15/desk/day.

## Queue

The invite row on the box *is* the queue. Create → `queued` → the buyer's
request returns → the email is built from stored state and sent after the
response. Anything still `queued` (killed function, provider blip, switch off)
is retried when:
- the buyer opens the deal page (`GET /api/rfqs/:id` drains that request), or
- ops drains everything: `curl -X POST https://www.trimscout.com/api/ops/drain-invites?max=100 -H "x-ops-secret: $OPS_SECRET"` (or an admin session).

No cron (Hobby plan). Upgrade to Pro → add `{"crons":[{"path":"/api/ops/drain-invites","schedule":"*/5 * * * *"}]}` to `vercel.json` and pass `CRON_SECRET`.

## Watch

`GET /api/admin/ops` (admin session): switches, this instance's counters
(`rfq_create`, `rfq_create_429`, `invite_queued`, `email_sent/failed`,
`sticker_cache_hit/fetch/pending/breaker_open`), open requests, **queued
invites**, sticker circuit-breaker state, and last-7-day ghost / decline rates
with an `advice` line when ghosting spikes. Fleet-wide request/error graphs:
Vercel → Observability.

## What to flip, in order

1. **Dealers ghosting / declining spike** (`advice` non-null): `FEATURE_RFQ_SEND=off` for a few hours. Existing quotes keep flowing; no new invites.
2. **Email provider erroring / bounce complaints**: `FEATURE_OUTBOUND_DEALER_EMAIL=off`. Buyers keep sending; invites queue. Fix, turn on, drain.
3. **Sticker hosts 403/429** — nothing to flip: the breaker opens 10 min per host on its own; if it keeps tripping, `FEATURE_STICKER_FETCH=off` until the spike passes.
4. **Box (MySQL) hot**: tighten `RATE_RFQ_CREATE_GLOBAL_LIMIT` / `RATE_INVITE_SEND_GLOBAL_LIMIT`, and add Vercel Firewall rules; last resort `FEATURE_RFQ_SEND=off`.
5. **Recovering**: turn email back on → drain → watch `email_failed`; turn sends back on.

## Fail-open / fail-hard matrix (as built)

| Path | Behavior |
|---|---|
| Marketing / legal pages | CDN `s-maxage` + stale-while-revalidate |
| Domain → desk miss | Fail open → dealer picker / "add without a dealership" |
| Sticker miss or host walled | Fail open → "pending", request proceeds |
| Signup / paid decode | 429 / 403 hard |
| RFQ over caps | 429 hard, Retry-After |
| RFQ send switch off | 503 + Retry-After, honest UI |
| Email switch off | Send fails closed; buyer HTTP OK; queued |
| Double-submit RFQ | Idempotent: same buyer + VIN while active → the existing row |
