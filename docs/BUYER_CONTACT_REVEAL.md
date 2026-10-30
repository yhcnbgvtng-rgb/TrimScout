# Buyer contact reveal (accepted deals)

When the buyer accepts the final deal (`accept_final`, #493) the **winning dealer only** gets one email, **"Your offer was accepted"**:
vehicle, VIN, the accepted out-the-door total and a **"View buyer contact info"** button. The email contains no buyer name, email or
phone. This replaced the earlier "Deal accepted, here's your buyer" email and the inline `buyer-details` block on the dealer's quote
page; there is one flow, not two.

## Flow
1. `accept_final` -> the box stores the buyer's details on the winner's `stage_json.release` (unchanged) -> the buyer route sends
   `sendBuyerDetailsRelease` after the response (`lib/inviteOutbox.ts`; SAFE MODE sender: every email goes to pausmi@outlook.com).
2. The email's button is `https://www.trimscout.com/quote-request/buyer-contact?t=<token>`. The token is signed
   (`lib/contactRevealToken.ts`): `{rfqId, inviteId, expiry}` + HMAC-SHA256, 30 days, bound to that one dealer's invite. It is not the
   invite's view token (which never expires and opens the whole quote page).
3. The page loads vehicle, VIN and total (`GET /api/quote-invite/reveal-contact?t=`), no buyer details. **Reveal buyer contact info** =
   `POST /api/quote-invite/reveal-contact { t }`.
4. The route (`lib/contactReveal.ts`): per-IP rate limit (30 / 10 min) -> verify token -> per-token rate limit (12 / 10 min) -> the
   invite is the finally accepted, not-closed-out winner -> `revealBuyerContact` on the deals box. Responses are `no-store`.
5. The box handler re-checks the winner, stamps `release.reveals = { count, firstAt, lastAt }` (optimistic lock), appends a
   `buyer_contact_revealed` entry to the stage log and writes an `rfq_events` row (invite/dealer, quote request, time; never the
   details), then returns the details. **If the box can't log it, nothing is revealed** (fail closed; an unpatched box 404s -> 503).
6. The buyer's deal page shows "Dealer viewed your contact info · <time>" from `stage.release.reveals.lastAt`.

`stageForDealer` now drops `release.contact` for every dealer, so no dealer-facing route returns the details except step 5.
Env: signing uses `LIGHTSAIL_API_KEY` (same as the unsubscribe link; domain-separated prefix). Rate limits: `RATE_CONTACT_REVEAL_IP_*`,
`RATE_CONTACT_REVEAL_TOKEN_*`. The in-memory limiter is per serverless instance, like the other named limits (see `lib/rateLimit.ts`).

## Box (deals-api, box2): required, NOT applied by this PR
New: `scrapers/lightsail-crawler/src/rfqContactReveal.js` (handler) and `revealContact` / the stripped `stageForDealer` in `dealStages.js`.
`deals_api_server.js` is pinned to the live file by the box-patch checks, so this PR does **not** edit the mirror. The wiring to apply on
box2 (anchored, exactly once) in a later, separately approved step:

```js
import { createRfqContactRevealHandler } from "./rfqContactReveal.js";
// after the handleRfqNotSelected const:
const handleRfqContactReveal = createRfqContactRevealHandler({ getPool, sendJson, ensureColumns: ensureQuotePackageColumns, logRfqEvent, auditKind: (req) => req.audit?.kind || null });
// before the rfqInviteStageMatch route:
const rfqInviteRevealMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/reveal-contact$/);
if (req.method === "POST" && rfqInviteRevealMatch) return run(handleRfqContactReveal, Number(rfqInviteRevealMatch[1]), Number(rfqInviteRevealMatch[2]));
```

Deploy order: box files + wiring first, then the app. Until the box is patched, the reveal page loads but the button answers
"couldn't open the contact info just now" (nothing revealed), and the email link works only once it is.
