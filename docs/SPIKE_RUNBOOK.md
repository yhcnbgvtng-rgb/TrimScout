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

**Unassigned invites (`no_desk` in the drain result).** Since 2026-09-16 a
known rooftop with no named sales contact is *not* blocked: the invite queues
with no address (`invite_unassigned` counter) and the buyer is told our team
routes it by hand. The drain skips these every time — they are not stuck, they
are yours. Attach an address (a named person or the store's sales inbox) on the
dealer's directory row, then drain again; or reach the store by phone with the
request reference. `GET /api/admin/ops` lists them under queued invites.

## Deals box (3.208.49.1 — deals API :3004, auth/directory API :3003)

Symptoms when it's down: every free VIN import says "Dealer not found", Step 3
shows "Checking…" forever, buyer/dealer sign-in fails, `/api/admin/inventory`
503s. From a laptop, `nc -z 3.208.49.1 3004` refusing while `:22` answers means
the box is up but the API processes are dead — almost always the OOM killer
after a crawl/sync spike. The Lightsail browser SSH shows `UPSTREAM_ERROR
[515]` while the instance thrashes; use a plain SSH client, or **Reboot** from
the Lightsail console if that also hangs.

Restart the APIs (idempotent):

```bash
pm2 resurrect; pm2 restart all; pm2 save; pm2 ls
curl -s -o /dev/null -w "3003 %{http_code}\n" "http://127.0.0.1:3003/api/dealerships?limit=1" -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"
curl -s -o /dev/null -w "3004 %{http_code}\n" http://127.0.0.1:3004/api/inventory/stats -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY"
```

If `pm2 ls` is empty, the daemon lost its list — start them by hand from
`/opt/trimscout-deals` (`pm2 start deals_api_server.js --name trimscout-deals-api`,
same for `auth_api_server.js` → `trimscout-auth-api`), then `pm2 save` and
`pm2 startup` so they survive a reboot.

Confirm it was memory, and stop it recurring:

```bash
free -m; swapon --show; dmesg -T | grep -iE "out of memory|killed process" | tail -5; ps aux --sort=-%mem | head -6
```

The box has no swap by default. A 2 GB swap file gives the OOM killer
headroom during the nightly inventory sync (06:15 ET) and the peer crawl jobs
without restarting anything — do this once (idempotent script; it checks disk
space, creates the file, enables it, persists it in fstab, sets swappiness 10):

```bash
curl -fsSL -o 2026-09-17-swapfile.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-swapfile.sh && bash 2026-09-17-swapfile.sh
```

By hand, the same thing is:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-trimscout-swap.conf
free -m
```

(`fallocate` needs ~3 GB free on the root disk — `df -h /` first; on a 40 GB
Lightsail disk that's fine.) If `dmesg` keeps naming the same process, cap it
instead of the box: `pm2 restart trimscout-deals-api --max-memory-restart 600M`
and `pm2 save`. Swap is a cushion, not a fix, for a job that genuinely needs
more RAM than the instance has.

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
