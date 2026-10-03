# TrimScout buyer <-> dealer messaging audit

Repo: /private/tmp/trimscout-vinlink (detached at origin/main c0f8a04). Read-only audit; nothing was run against production. All file:line cites are against that checkout. `deals_api_server.js` = `scrapers/lightsail-crawler/src/deals_api_server.js`; `auth_api_server.js` is in the same dir.

Not verifiable from code (live env): whether `RESEND_API_KEY` is set, whether `DEALER_EMAIL_FROM` is overridden, whether `FEATURE_OUTBOUND_DEALER_EMAIL` is on, and whether the safe-mode override has been lifted by a newer deploy. Everything below assumes the code as checked in.

---

## Executive summary (worst first)

1. **No email can reach a real dealer or buyer today.** Every send function hardcodes `to: [SAFE_MODE_RECIPIENT]` (pausmi@outlook.com) (lib/dealerEmail.ts:32, :219). Worse, the outbox then marks the invite `sent` (lib/inviteOutbox.ts:94), so the buyer's tracker says dealers have it when none does. The buyer has never been sent a single email by any code path; buyer-side notification is 100% in-app polling.
2. **The pick is a dead end and the dealer is never told.** `POST /rfqs/:id/pick` fires nothing (app/api/rfqs/[id]/pick/route.ts:30-31; box handlePickRfqQuote deals_api_server.js:1578-1601). The tracker says "the dealer has your pick" (lib/rfqTracker.ts:159), which is false. The dealer's own link then says "The buyer has closed this request — no quote is needed" (app/quote-request/received/page.tsx:164-166) — to the dealer who just won. The buyer's end state is a green box "You chose this quote" (app/rfq/[id]/page.tsx:534-538) with no next step. The trade-in step promised for RFQs has no code path (the trade-in route only works on a paid legacy deal, app/api/deals/[id]/trade-in/route.ts:35).
3. **Counter is destructive and can strand the buyer.** A counter supersedes the live quote (deals_api_server.js:1426). If the dealer clicks "I can't do better than my quote" (received/page.tsx:189) the invite becomes `declined` (deals_api_server.js:1464-1465), the original quote is no longer live, the compare row shows "declined" with no numbers (lib/leaseCompare.ts:117-120), and the buyer can't pick the number the dealer just said it stands behind. The dealer is told the opposite ("Your earlier quote stays on their compare", received/page.tsx:142). If the dealer never answers, there is no "withdraw counter" and the quote is greyed and unpickable.
4. **Privacy/consent gaps.** (a) "Known-named contacts only" is not enforced: invites go to named people, to generic rooftop inboxes (`sales@`), or to an unverified buyer-typed address (lib/inviteDesk.ts:36-40; lib/quotePackage.ts:162-182). (b) Opt-out is not re-checked at send time (lib/inviteOutbox.ts:68-98) and the counter email ignores both opt-out and the email kill switch (counter/route.ts:48-61). (c) The counter note is not contact-info filtered (lib/buyerCounter.ts:54), unlike the request note (app/api/rfqs/route.ts:102-106). (d) A buyer can forge dealer quotes/declines through buyer-authenticated routes (quotes/route.ts:7-22; decline/route.ts:8-26).
5. **Silent failures and dead invites.** Unassigned-desk invites (no address) stay `queued` forever and the buyer sees "Sending to N dealers…" (lib/inviteOutbox.ts:87; lib/rfqTracker.ts:127,144-145). There is no reminder, expiry or follow-up on any unanswered invite, and an unanswered invite blocks that desk for every other buyer indefinitely (deals_api_server.js:1317-1327).
6. **User-visible "bid/auction" copy persists** in the site `<title>`/meta (SEO and link previews), the dealer portal, the Auth modal, the Tracker, and README (section 4).

---

## 1. Happy path, step by step

Two parallel systems exist. The **v1 core loop** is `/api/rfqs` (packageKind "links"), reached from the wizard's direct-offer mode (components/BiddingWizard.tsx:2285, :2342, :2397-2402). The **legacy** `/api/deal-requests` + `deal_bids` path is the "legacy demo path" (BiddingWizard.tsx:2411-2419) and still has live UI (DealerPortal, LiveDealRoom, AiNegotiatorAssistant). The v1 loop is traced first.

### Global fact: SAFE MODE
`sendViaResend()` has no `to` parameter; recipient is the constant `pausmi@outlook.com` (lib/dealerEmail.ts:32, :210-226, `to` at :219). If `RESEND_API_KEY` is missing it logs and returns `false` (:211-215). Default From is `TrimScout <onboarding@resend.dev>` unless `DEALER_EMAIL_FROM` is set (:38). No `Reply-To`, no `List-Unsubscribe` header (:216-220). Senders that all route through it: `sendQuoteInviteEmail` (:234), `sendDealerUnsubscribedNotice` (:264), `sendAdminApprovalAlert` (:279), `notifyDealerOfTradeIn` (:290), `notifyDealersOfNewOffer` (:327). The only other email code in the repo is the outbound sales crawler `scrapers/lightsail-crawler/src/sales_email.js` (not messaging). There is **no buyer-addressed email anywhere**.

### Step 1: Buyer sends the quote request

| Event | Fires | Recipient | Real or draft |
|---|---|---|---|
| `POST /api/rfqs` creates the request (`approval_status='pending'`, deals_api_server.js:1249) | Admin alert "[Approval needed] ..." via `after()` (app/api/rfqs/route.ts:153-155; lib/approvalAlertEmail.ts:15-40) | Safe-mode inbox, not a configured admin (`ADMIN_NOTIFY_EMAIL` appears only in a comment, lib/dealerEmail.ts:277) | Real Resend call, but failure is swallowed `.catch(() => false)` (route.ts:154). If it fails the request sits pending with nobody alerted. |
| `POST /api/rfqs/:id/invites` per desk | Nothing is sent. Invite row is created `queued` with a 24-byte view token (box :1331, :1127-1129). Buyer gets `notice: DEGRADE_COPY.underReview` "released to your dealers within 1 business day" (app/api/rfqs/[id]/invites/route.ts:83; lib/featureFlags.ts:65). | none | Queue only |
| Admin approves (`POST /api/admin/rfqs/:id/approval`) | Synchronous `drainQueuedInvites` (admin/rfqs/[id]/approval/route.ts:29-31) -> `sendQueuedInvite` -> quote-request email (lib/inviteOutbox.ts:68-98; template lib/quoteInviteEmail.ts:104-179) | Safe-mode inbox (intended: desk contact) | Real Resend call, then `markRfqInviteDelivery(...,"sent")` with `.catch(() => null)` (inviteOutbox.ts:94). |
| Admin rejects | Writes reason + event only (box :1640-1643). **No email to the buyer**; buyer sees it only in-app (components/DealTrackerDashboard.tsx:167-170). | none | In-app only |
| Retry of stuck queue | Buyer opening `GET /api/rfqs/:id` triggers `after(() => drainQueuedInvites)` (app/api/rfqs/[id]/route.ts:31); also `POST /api/ops/drain-invites` (admin or `x-ops-secret`) | | Real, opportunistic. Admin viewing someone else's RFQ also triggers it (route.ts:20-31). |

Dealer email copy (quoteInviteEmail.ts): title "OTD quote request ... / Lease quote request ... / Finance quote request ..." (:48-52, :111-114); body "a buyer wants a <type> quote on this unit. Submit in TrimScout — don't reply to this email." (:134); CTA "Submit OTD/lease/finance quote" (:48-52); shows ZIP-level area, timeline, rooftop, buyer note word for word (:166-171), "Trade-in: Coming — handled after the out-the-door price is agreed" (:171); footer "Sent to <contact>, <role> · <dealer> · ref", Unsubscribe link "stops these emails and closes out any open request still waiting on you", and "Non-binding quote request — not an auction, not a bid, no deadline on you." (:57, :172-178). Buyer name/email/phone never appear (header :6-13). That part is good.

Gating order inside `sendQueuedInvite`: status must be `invited` and delivery `queued` (:70-71) -> admin release (:77) -> `outboundDealerEmail` flag (:81) -> build email, `no_desk` if no address (:86-87) -> send -> mark sent (:89-95). Not checked: dealer opt-out, `dealerUnsubscribedAt`.

### Step 2: Dealer view

- Email CTA = `/api/quote-invite/view?t=<token>` (inviteOutbox.ts:54). It marks `viewed` (view/route.ts:17) and redirects to `/quote-request/received?t=...` (:11, :27). Failure to mark is swallowed (:23-25). First `viewed` also locks the buyer's lease sheet (box :1376-1380).
- `GET /api/quote-invite/context?t=` also marks `viewed` server-side (context/route.ts:19) and returns vehicle, prefs, buyer note, `tradeInExpected` (boolean only), buyer counter and prior quote (:31-51). It does not expose trade-in detail. Good.
- Token never expires and is not bound to anything but the invite row. A forwarded email gives anyone quote rights (no login on lease/finance/cash paths).
- The "portal" path: for invites with neither `leasePrefs` nor `quotePrefs` the page says "Log in to quote ... Quotes don't go by email reply" (received/page.tsx:205-216), but `DealerPortal` only lists `deal_requests` (app/api/dealer-requests/route.ts:63-136; DealerPortal.tsx has no `rfq`/`quote-invite` reference). So that dealer has nowhere to quote (see section 3, item 6).
- `/d/[token]` (app/d/[token]/route.ts) belongs to the legacy engagement store. Tokens are minted (lib/dealEngagement.ts:92-96, 150-152) but `dealerOfferPath` is never used in any email or link (grep: only its definition). The legacy email contains only a signup URL and a request id (lib/dealerEmail.ts:168-193). So `/d/[token]` is currently unreachable from any message.

### Step 3: Dealer quotes

`POST /api/quote-invite/lease-quote` / `used-quote` validate then `submitRfqQuote` (lease-quote/route.ts:29-46; used-quote/route.ts:60-70) -> box inserts quote, sets invite `quoted` (box :1545-1552), logs `quote_received` (:1562). **No notification to the buyer** — no email, no push. The buyer finds out only when the tracker polls (app/page.tsx:195 `fetch("/api/rfqs")`). Dealer sees "Quote submitted. Thank you." (received/page.tsx:147-163).

### Step 4: Buyer Deal Tracker

Status strings are generated from invite state (lib/rfqTracker.ts:117-176): "Sent — awaiting dealer response", "N of M dealers replied — compare and pick one, or walk away." Compare tables in `LeaseCompare`/`UsedCompare`. Expired quotes are greyed and unpickable in UI only (UsedCompare.tsx:172; leaseCompare.ts:163). Quote expiry fires nothing.

### Step 5: Buyer counter

`POST /api/rfqs/:id/invites/:inviteId/counter` (counter/route.ts): rebuilds the sheet from the stored quote (:37-42), calls box (supersedes quote, reopens invite, box :1424-1438), then emails the desk (`buyerCounterHtml`, quoteInviteEmail.ts:229-246): "The buyer looked at your quote ... and sent a counter ... This is a request, not a bid, and there's no deadline on you." Recipient: safe-mode inbox. Send is best effort: only if `invite.viewToken && invite.desk` (:48), result ignored, `.catch(() => false)` (:61). No queue, no retry, no ledger. Not gated on the kill switch, release state, or opt-out (see section 2).

### Step 6: Dealer revise

Dealer reopens the same tracked link; page shows "The buyer countered your quote." with before/after (received/page.tsx:174-198, :217-241), prefilled form, or "I can't do better than my quote" (:189, :235) which declines the invite with reason hardcoded `"other"` (:82). Revise = same submit routes; box allows only when invite is `invited` (box :1533-1535). Buyer notification of the revised quote: none (same as step 3). Buyer notification of a decline: none.

### Step 7: Lock / pick / walk
- `pick`: records choice only (box :1578-1601). No email to dealer, none to buyer, no admin alert.
- `walk`: box :1605-1620; no dealer email; dealer link flips to "buyer has closed this request".
- Legacy lock = Stripe `checkout` -> `deals` (`status: paid`). Trade-in submit emails the winning dealer (trade-in/route.ts:73-81; lib/dealerEmail.ts:290-318), copy: "has sent their trade-in for you to price ... Open the Won Deals tab". Safe-mode inbox. Uses `void notifyDealerOfTradeIn(...)` (:73), a bare un-awaited promise after the response, unlike `after()` used elsewhere (the repo's own comment at app/api/deal-requests/route.ts:94-97 says bare promises can be frozen on Vercel).

### Legacy path (deal-requests), for completeness
- Create -> `after(() => notifyDealersOfNewOffer(mapped))` (deal-requests/route.ts:98-102) -> one "[SAFE MODE] New quote request for <dealer> ..." per invited rooftop (lib/dealerEmail.ts:87, :327-378). Opt-out honored here (:351-354). Results of the send are discarded (route.ts:99-101 only logs).
- Dealer replies by logging in and using DealerPortal -> `POST /api/deal-requests/:id/bids` (bids/route.ts:54-155). No buyer email.
- Buyer "negotiate" (`POST /api/deal-requests/:id/negotiate`) computes a message and stores it as a move (negotiate/route.ts:95-117). **It is never sent to the dealer** (draft only). No dealer-facing read of `negotiation.moves` exists in dealer-requests/bids routes.

---

## 2. Gaps

### 2.1 Missing notifications (who is never told)
| Event | Buyer told? | Dealer told? | Evidence |
|---|---|---|---|
| Request created | In-app only | n/a | no buyer email code anywhere |
| Request rejected by admin | In-app only | n/a | approval/route.ts:25 returns, no send |
| Request released | In-app text changes | email (safe-mode) | inviteOutbox.ts |
| Dealer quoted / revised | No | n/a | quote routes have no send; box :1562 only logs event |
| Dealer declined | No | n/a | decline/route.ts:18-22; box :1471 logs only |
| Quote expired | No (UI greys) | No | no expiry job; box has no `expired` writer for `rfq_invites` (`'expired'` occurs only in deal_bids/deal_requests, :403, :631) |
| Buyer countered | n/a | email, best effort, safe-mode | counter/route.ts:61 |
| Buyer picked | n/a | **No** | pick/route.ts |
| Buyer walked | n/a | **No** (link just says closed) | walk/route.ts; received/page.tsx:164 |
| Dealer unsubscribed | Notice goes to the safe inbox only, once per click not per buyer, without `rfqUrl`; log line says "buyer_notified" but nothing was sent to a buyer | n/a | dealer-unsubscribe/route.ts:57-67; lib/dealerEmail.ts:264-272 |
| Admin edited the quote sheet before release | In-app "adminEdits" only | n/a | box :1679 |
| Admin approval pending past the 1-business-day promise | n/a | No escalation, no SLA timer | lib/rfqTracker.ts:108 |
| Unanswered invite | No reminder to dealer, no nudge to buyer | | no code |

### 2.2 Silent failures
- Admin alert: `.catch(() => false)` (app/api/rfqs/route.ts:154).
- "sent" marking: `.catch(() => null)` (inviteOutbox.ts:94). If Resend accepted but the mark fails, the invite stays `queued` and the next buyer page open **re-sends the email** (idempotency is only as good as that call).
- Counter email: result ignored (counter/route.ts:61) and skipped silently if `viewToken`/`desk` missing (:48).
- "viewed" marking swallowed (view/route.ts:23-25; context/route.ts:19).
- Legacy new-offer email: per-dealer result array dropped (deal-requests/route.ts:98-102).
- Trade-in nudge: bare `void` promise (trade-in/route.ts:73).
- Resubmit after rejection fires `/walk` with `.catch(() => {})` and flips local state to "walked" regardless (app/page.tsx:388-390). If the walk fails, the buyer's next send is blocked by "You already have an active request" (app/api/rfqs/route.ts:113-124) and the UI shows no error.
- The wizard sends the RFQ, then each invite separately (BiddingWizard.tsx:2285, :2342). If every desk is blocked, an empty `collecting` RFQ remains and counts as the buyer's one active request (route.ts:113-124; wizard keeps the buyer on the page, :2397-2402). Whether the page then offers a walk is UNVERIFIED; `rfqs.walk` exists.
- Engagement store (legacy) is read-modify-write of one JSON blob pushed whole to the box (lib/dealEngagementStore.ts:108-130, :136-146); concurrent writes can lose updates.

### 2.3 Draft-only vs real send
- Real (to the safe inbox only): invite, counter, admin alert, trade-in nudge, legacy offer, unsubscribe notice.
- Draft-only: negotiator counter message (negotiate/route.ts:95-117, never delivered), unsubscribe buyer notice text ("draft-then-approve", lib/dealerEmail.ts:238-245), `unassigned` invites ("ops routes by hand", lib/inviteDesk.ts:5-8; no tool to assign an address or send after release; ApprovalsClient.tsx:21 only labels it).

### 2.4 Privacy Shield and trade-in sharing
What holds:
- Dealers only see `buyerZip`/area and a buyer note; no name/email/phone (quoteInviteEmail.ts:6-13, context/route.ts:31-51). Buyers get a stable alias (lib/buyerAlias.ts) used in the legacy dealer feed (dealer-requests/route.ts:115).
- Request note is scrubbed by `findContactInfo` client and in the Next route (app/api/rfqs/route.ts:102-106; lib/piiFilter.ts). The box does NOT re-check the RFQ note (deals_api_server.js:1223 only trims/slices), unlike the comment's claim for deal requests; admin patch also accepts `buyerNote` unfiltered (box :1670).
- RFQ trade-in is a boolean (`tradeInExpected`); no trade detail or photo reaches dealers before pick (context/route.ts:38).
- Legacy buyer view masks dealer identity until paid (deal-requests/[id]/bids/route.ts:11-20, :42).
- Legacy trade-in photos go only to the winning dealer after `status === "paid"` (trade-in/route.ts:35). Dealer-side trade-in/contract routes verify `deal.dealerName === user.dealerName` (appraisal/route.ts:26; contract/route.ts:33).

What does not hold:
- **Counter note unfiltered.** `parseCounterEdits` only slices to 300 chars (lib/buyerCounter.ts:54); the counter route never calls `findContactInfo`. A buyer can paste a phone/email into a counter and it is emailed and displayed to the dealer (received/page.tsx:180-181). The Privacy Shield claim (app/disclaimer/page.tsx:90-96) assumes otherwise.
- **Dealer->buyer free text is unfiltered too:** `lease.notes`/`used.notes` (used-quote/route.ts:39) are shown to buyers verbatim. Lower risk, but dealers can put a phone number in and route around TrimScout, so for a buyer-leverage product this is a non-issue; flagging only because "messages pass through" copy implies neutrality.
- **After pick, nothing discloses buyer contact or trade-in to the dealer in the RFQ path**, so the "Privacy Shield gate" at that moment doesn't exist. The box `wonDeals` endpoint returns buyer name/email/phone for accepted legacy bids (deals_api_server.js:~930-947) and the Next route passes it straight through (app/api/dealer-won-deals/route.ts:13). That is the legacy post-payment reveal; it is not an RFQ one.
- The box trade-in endpoint has no ownership check (box :288-303); only the Next route checks buyer ownership (trade-in/route.ts:32). Defense relies on the API key.

### 2.5 "Known-named contacts only" enforcement
It is a label, not a gate.
- `knownNamed` = person-like name and non-generic email (lib/quotePackage.ts:123, :144-157 for rooftop fallback).
- `resolveInviteDesk` never refuses a non-named desk; it falls back to `deskFromRooftop` (a generic inbox such as `sales@`) or an empty address (lib/inviteDesk.ts:39-41). `inviteRouting` returns `named | rooftop_inbox | unassigned` (quotePackage.ts:162-165). `planDeskSelection` pre-ticks any known rooftop (lib/deskSelection.ts:96-99). The header of inviteDesk.ts says explicitly "A known rooftop is never a dead end".
- Buyer-typed adviser email is trusted: `deskFromBuyerEmail` sets `knownNamed: true`, any non-generic address, no domain match against the dealership (quotePackage.ts:168-182; inviteDesk.ts:36-38). A buyer can therefore make TrimScout email an arbitrary mailbox with an official-looking quote email. The admin gate (approve before send) is the only mitigation; the approvals UI shows the address (ApprovalsClient.tsx:232), so it relies on a human noticing.
- Match-package invites (`packageKind !== "links"`) take the **client-supplied** `dealerContactEmail` (inviteDesk.ts:32, :73; invites/route.ts:68), contradicting "callers never supply the address". They then never send, since `buildInviteEmailFromStored` returns null without a `desk` (inviteOutbox.ts:42-43, :87) — dead invites, not a leak. The wizard only creates "links" packages (BiddingWizard.tsx:2289), so this is latent.

---

## 3. Bugs and dead ends

1. **Pick is silent and terminal.** See summary #2. Evidence: pick/route.ts:30-31; box :1578-1601; rfqTracker.ts:159; received/page.tsx:164-166; rfq/[id]/page.tsx:534-538. Pick also accepts any `quoteId` on the RFQ, including a superseded or expired one, and does not check release or invite status (box :1584-1591), and the pick route does not enforce quote expiry/superseded either (UI-only).
2. **Counter strands the quote.** Evidence in summary #3: box :1426 supersedes, :1464-1465 decline, leaseCompare.ts:114-120 only shows the prior quote while `invite.status === "invited"`, received/page.tsx:142 copy contradicts. No "withdraw counter". Concurrent double-submit of a counter (double click) passes the pre-check twice (box :1422 is a plain read, not `WHERE status='quoted'`), overwrites the counter and sends two emails; no limit on counter count (the legacy negotiator has `maxCountersPerDealer`, rfq counters do not) and no rate limit on the counter route.
3. **Expired quote, no remedy.** UI says "Expired — ask the dealer to re-quote" (leaseCompare.ts:163; UsedCompare.tsx:93) but no control exists to ask, and the invite remains `quoted`, so the dealer's link says "This invite already has a response (quoted). Nothing more to do." (received/page.tsx:166-171; box :1533-1535 refuses a second quote). Counter is also not offered on expired quotes (UsedCompare.tsx:172). Expiry is dealer-set and unbounded; the box accepts any parseable date (box :1519-1525).
4. **Buyer-penalizing "strikes".** `cancelled_after_quote` (walking after seeing quotes) and `ghosted` (7 days no action) cut the buyer's invite cap from 3 to 1 after two strikes (lib/rfqLogic.ts:113-154; invites/route.ts:56-60), silently, while UI says "pick one or walk away" (received/page.tsx:151; rfqTracker.ts:151). Walking after quotes is the buyer-leverage product's core move.
5. **Unanswered invites block the desk for everyone.** One open invite per desk across all buyers, with no TTL (box :1317-1327). A buyer who never walks (or a stuck `queued` invite) locks that named desk for all other buyers; `invite expired` is a status the schema has (lib/rfq.ts:40) but nothing ever sets for RFQs. Combined with no reminder, there is no way for either side to unstick it except walking.
6. **Dealer with no way to quote.** Invites that have neither `leasePrefs` nor `quotePrefs` get "Log in to quote" (received/page.tsx:205-216) but the dealer portal doesn't show RFQ invites. When can this occur: finance quote with no credit band yields `quotePrefs: null` and no lease (BiddingWizard.tsx:2316-2320); alternate lane may also hit it. UNVERIFIED how often the wizard allows it; the dead end is real in code.
7. **Unassigned-desk invites hang.** `no_desk` leaves delivery `queued`; lifecycle remains "Sending to N dealers…" (rfqTracker.ts:127,144-145). Buyer is never told it's waiting on a human to route; the approvals notice only tells the admin a count (ApprovalsClient.tsx:101). `parked_switch_off` behaves the same (banner `emailOff`, featureFlags.ts:62).
8. **Opt-out leaks.**
   - Send-time: `sendQueuedInvite`/`buildInviteEmailFromStored` don't check `emailOptOut` or `dealerUnsubscribedAt` (inviteOutbox.ts:33-98); the check exists only at desk resolution (inviteDesk.ts:42). A rooftop that unsubscribes between queue and release (up to a business day by design) still gets the mail. (Cascade does flag queued 'invited' invites, auth_api_server.js:394-402, but the sender ignores the flag.)
   - Counter email ignores opt-out and the kill switch (counter/route.ts:44-62); UI disables the button only (inviteState.ts:30-32; UsedCompare.tsx:175), and the route is directly callable.
   - Counter email has **no unsubscribe link or footer** (quoteInviteEmail.ts:229-246); the invite email has one (:176).
   - Cascade matches by `dealer_name` string only, not rooftop id/state (auth_api_server.js:394, :402), so same-named rooftops get flagged together.
   - Unsubscribe is a GET with side effects, executed on click (dealer-unsubscribe/route.ts:25-51). Mail scanners that prefetch links will unsubscribe rooftops silently. No `List-Unsubscribe` header (dealerEmail.ts:216-220).
   - Page and email copy overpromise: "Any open request ... has been closed out and those buyers were asked to choose another dealership" (dealer-unsubscribe/route.ts:71; email :176). Reality: invites are only flagged, token remains valid, status unchanged (auth_api_server.js:376-378), and the buyer ask is a banner (components/UnsubscribedBanner.tsx), not a message.
   - The legacy notice is sent per click, not per buyer, to the safe inbox, with no link (dealer-unsubscribe/route.ts:63).
9. **Forgeable dealer actions by buyers.** `POST /api/rfqs/:id/invites/:inviteId/quotes` and `/decline` authenticate only that the caller owns the RFQ (quotes/route.ts:7-22, decline/route.ts:8-26). A buyer can record any price as "the dealer's quote", before release, with `mustHaveAcknowledgement` forced by `Boolean(body.mustHaveAcknowledgement)` (quotes/route.ts:51,64), burning the invite so the real dealer later sees "already has a response", and polluting response-rate/responsiveness analytics. The UI for this exists as "Record decline"/quote-intake on `/rfq/[id]` (app/rfq/[id]/page.tsx:244-266), so it is presumably meant for ops relay, but it is open to every buyer.
10. **Admin vs buyer visibility mismatches.**
    - `GET /api/admin/rfqs` returns invites with cleartext `dealerContactEmail` plus a working dealer token URL (admin/rfqs/route.ts:26-32). Opening it counts as a dealer view and locks the lease sheet (doc comment :4-6), so an admin click shows the buyer "Opened by dealer" (rfq/[id]/page.tsx:260ff chip) and freezes their sheet.
    - Admin edits are shown to buyers as a summary (adminEdits) but not emailed (box :1679).
    - Buyer's `GET /api/rfqs/:id` for admin returns the buyer-safe view (route.ts:25), good, but admin quotes "as the dealer" via the same buyer-auth routes (item 9), so audit trail shows `quote_received` with no actor.
11. **Lease-sheet lock races.** Lock set on first view (box :1376-1380). `PATCH lease-prefs` reads lock then updates non-atomically (box :1394-1400) and doesn't check RFQ status; only lease has a lock — finance/cash locks (`quotePrefs`) are never frozen after dealers view. Tiny window, but a dealer can view then buyer edit land together.
12. **Tokens and links.** Quote-invite token: 24 random bytes, no expiry, no revocation after walk/pick other than server-side status checks (box :1127-1129). Unsubscribe and dealer-signup HMAC links never expire (lib/dealerUnsubscribe.ts:20-35; lib/dealerSignupInvite.ts:21-39), yet the signup invite endpoint says "invalid or has expired" (app/api/dealer-signup-invite/route.ts:19) and returns the on-file contact name and email to any holder (:28-32). Dealer signup trusts a status supplied by the Next layer (auth_api_server.js:152).
13. **Approval SLA.** "within 1 business day" is shown to buyers (featureFlags.ts:65; rfqTracker.ts:108) with no timer, alert, or auto-release; the only trigger is the single admin email in item 2.2.
14. **Legacy dead ends.** Negotiator counters never reach a dealer (section 2.3). `/d/[token]` is unreachable (section 1, step 2). Buyer-facing dealer bids with `status: expired` are set when another bid wins (box :403); legacy requests expire (:631) but no buyer notice.
15. **SAFE MODE side effects in product state.** Because send succeeds to the owner inbox, invites turn `sent`/`viewed`-capable and the buyer's tracker says "N dealers have it — none has replied yet. They answer on their own time." (rfqTracker.ts:147-148). Dealers never see it, and the "responsiveness"/ghosting math (lib/rfqLogic.ts) will punish buyers for dealer silence that is actually our override. Subject lines for RFQ invites and counters carry no `[SAFE MODE]` tag, unlike legacy ones (dealerEmail.ts:87, :248), so the owner can't distinguish test from intended.

---

## 4. Trust / copy: user-visible "auction / bid / broker / live deal room" strings

Distinguishing identifiers (BiddingWizard, `deal_bids`, `dealer-bids`, `DealerBid`, `BiddingRequest`, route paths) are excluded. Strings below are rendered to users.

**Public / SEO (highest priority)**
- app/layout.tsx:7-9 — title "TrimScout | Whole Market Vehicle Search & Dealership Bidding"; meta description "...let dealerships compete for your business with transparent out-the-door bids." Also feeds OpenGraph (layout.tsx:13-18). Replace with: title "TrimScout | Exact-Car Search and Dealer Quote Requests"; description "Search cars by exact option package, compare real market prices, and request out-the-door quotes from dealerships through TrimScout — you compare and choose."
- app/opengraph-image.tsx:4 — alt text uses the same title; update to match.
- README.md:3 — "dealership reverse-auction bidding" (not user-facing in-app, but public repo/readme); also README.md:16, :20 ("Bid Out a Deal", "Launch Dealership Bidding Hunt").

**Buyer app**
- components/AuthModal.tsx:109 — "Access your live deal room & track bids" -> "Track your quote requests and compare dealer replies".
- components/DealTrackerDashboard.tsx:344 — "Leading bid" -> "Lowest quote". (:36 comment says "auction deals", internal.)
- components/LiveDealRoom.tsx:492 — "Dealers review these photos to formulate binding trade-in allowances on your leaderboard bids." -> "The dealer you choose reviews these photos to price your trade-in after you agree on the out-the-door price." (also removes "binding", "leaderboard").
- app/page.tsx:686 comment mentions "Reverse Bidding Program Intro" (internal). components/BidProgramIntro.tsx has no "auction/bid" in text, only the identifier. Its "No broker cut" (BidProgramIntro.tsx:29) is OK posture-wise but "broker" appears as a feature claim; keep, but note the disclaimer says TrimScout is "not a ... vehicle broker" (app/disclaimer/page.tsx:49-51), consistent.
- components/AiNegotiatorAssistant.tsx:111, :277, :297 — "Could not load bids for this deal.", "Hold for more bids under this", "Loading bids…" -> "quotes". Also lib/negotiationPolicy.ts:81,99,130,144 builds messages like "Bid $X is above walk-away..." / "Thanks <dealer> — appreciate the offer" and the message is shown to the buyer as draft text; change "Bid" -> "Quote", "competing bids" -> "other quotes".
- lib/contractVerification.ts:84-107 flags "than the accepted bid" and "winning bid's dealer" — visible to the dealer/buyer after upload; use "accepted quote".
- app/api/checkout/create-session/route.ts:31, deal-requests/[id]/negotiate/route.ts:53,57 — error strings "That bid no longer exists.", "Could not load this bid.", "Bid not found" are shown to users; use "quote".

**Dealer app (legacy portal, user-visible to dealers)**
- components/DealerPortal.tsx:365 "Bids Transmitted"; :408 "Active Bids & Tracker"; :494 "Exact Match Auction" (strategy label); :545 "Best OTD Bid"; :569 "Be the first to bid"; :579 "Submit Binding OTD Bid"; :593 "Status of your submitted real bids"; :614 "You haven't submitted any bids yet."; :1042 "Submit Binding Out-The-Door Bid"; :1192 "the number your bid is ranked/competed on"; :1269 "Binding Partner Commitment: ... until they pay to lock in your bid"; :1296 "Transmit Binding Bid"; :273/:277 "Could not submit bid." Replacements: "Quotes sent", "Open quote requests", "Exact match request", "Best out-the-door price", "Be the first to reply", "Send quote", "Submit your out-the-door quote", "Your quote is shown to the buyer next to other quotes", "Your dealership identity stays hidden until the buyer chooses your quote". Remove "binding" everywhere; the product's legal copy says responses are non-binding (app/disclaimer/page.tsx:58-66; quotePackage.ts:353).
- app/api/deal-requests/[id]/bids/route.ts:76 "This request is no longer accepting bids." -> "quotes"; :58 "to submit a bid."

**Email / quote sheet (acceptable, listed for consistency)**
- The only "bid/auction" in emails is the disclaimer "not an auction, not a bid" (quoteInviteEmail.ts:57, :242; received/page.tsx:200, :213; leaseQuote.ts:238; rfqLogic.ts:73; buyerCounter.ts:16; counter page app/rfq/[id]/counter/[inviteId]/page.tsx:68). These deliberately negate the words. Consider dropping the repeated negation in dealer-facing emails ("not an auction, not a bid") since it plants the framing; shorter: "A non-binding request for a quote — reply on your own time."
- The legacy unsubscribe notice avoids the words (dealerEmail.ts:238-245) and is clean.
- Legacy offer email: "A buyer wants to move forward on this vehicle ... send back your best price" (dealerEmail.ts:129, :183) and "Target out-the-door price" (:161) reads as a bid solicitation with a ceiling; reword "A buyer asked for a quote on this vehicle" and drop the target line, consistent with "no target price anywhere" (app/api/rfqs/route.ts:63-67).

**Blurs of "request, not a bid" in flow**
- Dealer-side "Quote through the calculator... A monthly-only reply can't be submitted" is fine. "binding" in LiveDealRoom and DealerPortal conflicts with "Quotes Aren't Binding" (disclaimer) — treat as a legal-consistency bug, not just tone.
- "You chose a quote — the dealer has your pick." (rfqTracker.ts:159) asserts a delivery that doesn't happen (section 1, step 7).
- Unsubscribe copy claims buyers "were asked to choose another dealership" (dealer-unsubscribe/route.ts:71, quoteInviteEmail.ts:176, dealerEmail.ts:199) but no ask is sent.
- "Replies come back through TrimScout" / "We pass messages between you and the buyer" (quoteInviteEmail.ts:244, received/page.tsx:262-264). TrimScout does not pass messages; there is no messaging channel.
- Buyer "Privacy Shield active" badge (components/Navbar.tsx:159) is shown to every logged-in buyer, while the counter note and dealer notes are unfiltered (section 2.4).

---

## 5. Prioritized fix list

Standing rule for every prompt below: **fresh worktree from origin/main; no deploy and no production DB/API calls without asking; no pushes to main; add/adjust tests (node:test files in lib/*.test.ts are the repo pattern); keep the SAFE MODE override exactly as is unless the user lifts it; no changes to `deals_api_server.js` live box without producing a patch for the user to apply.**

### P0 (trust-breaking or silently loses a buyer's money-relevant action)

**P0-1. Pick/walk/counter-decline notify the right party, and the "dealer has your pick" claim becomes true**
- Problem: pick sends nothing and the dealer sees "no quote is needed"; walk the same; buyer's end state has no next step.
- Evidence: app/api/rfqs/[id]/pick/route.ts:30-31; box :1578-1601; lib/rfqTracker.ts:159; app/quote-request/received/page.tsx:164-166; app/rfq/[id]/page.tsx:534-538.
- Impact: winning dealer is never told; buyer is told they succeeded while nothing happened; trade-in step unreachable.
- Prompt:
```
In a fresh worktree from origin/main of /private/tmp/trimscout-vinlink (Next.js), fix the RFQ pick dead end. Do not deploy, do not call production, do not edit the live box.
Scope: (1) In app/api/rfqs/[id]/pick/route.ts, after pickRfqQuote succeeds, send the picking invite's desk ONE "Buyer chose your quote" email using the existing SAFE MODE sender (lib/dealerEmail.ts -> add sendBuyerPickedEmail alongside sendQuoteInviteEmail; DO NOT add a `to` parameter, keep the safe-mode recipient). Body: vehicle, VIN, dealer reference (lib/dealerReference), the picked number, and "next step: contact the buyer through TrimScout"; no buyer name/email/phone. Run the send in `after()` and log failures with console.error plus bump() an ops metric; never fail the pick on send failure. (2) Build the email in lib/quoteInviteEmail.ts as a pure function with a unit test. Respect the outboundDealerEmail flag, the rfqIsReleased gate and dealerUnsubscribedAt/emailOptOut (no send if opted out). (3) Add the same for walk (one "Request closed" email to every invite that is still `invited`/`quoted`). (4) Change app/quote-request/received/page.tsx:164-166 so a dealer whose quote was picked sees "The buyer chose your quote. Next step: ..." and others see "The buyer chose another quote / closed this request. Thanks for looking." This needs ctx to carry pickedQuoteId vs the invite's quote id (extend app/api/quote-invite/context/route.ts). (5) Change lib/rfqTracker.ts:159 to only claim the dealer was told if the pick email was queued (store `pickNotifiedAt` is NOT possible without a box change; instead soften to "You chose this quote. We'll let the dealer know." and keep the claim honest). (6) On pick, also block picking a superseded or expired quote server-side in the Next route (look at invite.quote.supersededAt and quote.expiresAt via getRfq) with a clear 409 message.
Acceptance: unit tests for the new email builder and for the pick route (pick of superseded/expired quote -> 409; send failure still returns 200); `npm test` and `npx tsc --noEmit` pass; copy never contains "bid" or "auction"; no buyer PII in the email.
DON'T: change SAFE_MODE_RECIPIENT, add a `to` param, deploy, push to main, touch deals_api_server.js, or add a new dependency.
```

**P0-2. Counter must not destroy the quote; give the buyer a withdraw and keep the original pickable when the dealer declines**
- Problem: counter supersedes the live quote, decline leaves the buyer with nothing.
- Evidence: box :1426, :1464-1465; lib/leaseCompare.ts:114-120; app/quote-request/received/page.tsx:142, :189; components/UsedCompare.tsx:172.
- Impact: buyer loses a valid dealer quote by countering; dealer is told the opposite.
- Prompt:
```
In a fresh worktree from origin/main, fix the counter-destroys-quote bug without deploying. Because the invite state machine lives in scrapers/lightsail-crawler/src/deals_api_server.js, produce (a) the Next.js app change and (b) a reviewed, idempotent patch file for the box at scrapers/lightsail-crawler/patches/ (do not apply it anywhere).
Behavior to implement: when a dealer declines a counter ("I can't do better than my quote", received/page.tsx:189), the original superseded quote is RESTORED as the live quote (clear superseded_at on the latest superseded rfq_quotes row for that invite), invite.status returns to `quoted`, and buyerCounter is kept on the invite as history with `declinedAt`. Add a buyer-side "Withdraw counter" action (new route app/api/rfqs/[id]/invites/[inviteId]/counter/withdraw/route.ts, buyer auth, owner check) that does the same restore. In lib/leaseCompare.ts and components/UsedCompare.tsx show a countered row with the prior numbers plus a "Withdraw counter" control, and a "Dealer held its quote" chip after a decline. Fix received/page.tsx copy so it matches behavior. Also add a server-side guard in the counter route: reject if rfq.status !== "collecting" (already) AND if a counter is already pending on that invite (409), and rate limit with firstTrippedLimit like invites/route.ts.
Acceptance: pure-function tests in lib/ for the restore logic and compare rows; route tests for withdraw and for double-counter (409); the patch file has a header comment explaining how to apply and roll back; `npm test` + tsc pass.
DON'T: apply the box patch, deploy, touch production, change SAFE MODE, or alter the counter email wording beyond what is needed.
```

**P0-3. Make "sent" honest: stop marking invites `sent`/telling buyers "dealers have it" while SAFE MODE swallows the mail**
- Problem: SAFE MODE returns success, the invite is marked `sent`, and the tracker says dealers have it.
- Evidence: lib/dealerEmail.ts:32, :219; lib/inviteOutbox.ts:94; lib/rfqTracker.ts:147-148.
- Impact: buyers wait on dealers that were never contacted; ghosting/response-rate math is polluted; the strike system punishes buyers.
- Prompt:
```
In a fresh worktree from origin/main, add an explicit "held in safe mode" delivery outcome so product state never claims a dealer was emailed while the SAFE MODE override is active. Do not remove or weaken the override.
Implement: export `export const SAFE_MODE_ACTIVE = true` next to SAFE_MODE_RECIPIENT in lib/dealerEmail.ts (derived from the constant, not env). In lib/inviteOutbox.ts, when SAFE_MODE_ACTIVE, send as today to the safe inbox but DO NOT call markRfqInviteDelivery(..."sent") (leave the invite queued) and return a new OutboxResult "redirected_safe_mode"; count it via bump(). In lib/rfqTracker.ts add a lifecycle detail line "Held for review — not yet delivered to the dealer" for that state (add a unit test). Add [SAFE MODE] + the intended dealer/contact to the subject of invite and counter emails (lib/quoteInviteEmail.ts quoteInviteSubject/buyerCounterSubject), covered by tests. Update the admin approvals notice (app/admin/approvals/ApprovalsClient.tsx:101) to show a safe-mode count. Also exclude safe-mode-redirected invites from buyerRfqStrikeCount in lib/rfqLogic.ts so buyers are not penalized.
Acceptance: existing outbox tests updated + new ones; tsc + npm test pass.
DON'T: change recipients, add a `to` parameter, flip any env var, deploy, or hit production.
```

### P1 (privacy, consent, and loss-of-trust)

**P1-1. Opt-out and kill switch at every send point (invite at send time, counter, notices); add unsubscribe footer to counter email; make unsubscribe a confirm POST**
- Evidence: lib/inviteOutbox.ts:68-98; counter/route.ts:44-62; quoteInviteEmail.ts:229-246 (no footer); dealer-unsubscribe/route.ts:25-51; auth_api_server.js:394,402 (name match); dealerEmail.ts:216-220 (no List-Unsubscribe).
- Prompt:
```
In a fresh worktree from origin/main, enforce opt-out and the email kill switch everywhere a dealer email is sent. No deploys, no production calls.
(1) lib/inviteOutbox.ts sendQueuedInvite: return a new "opted_out" result and send nothing if invite.dealerUnsubscribedAt is set or the matched directory row has emailOptOut. (2) app/api/rfqs/[id]/invites/[inviteId]/counter/route.ts: refuse the counter with 409 + reason when inviteUnsubscribedNoQuote/!inviteAcceptsCounter (lib/inviteState.ts) is true; skip the email when featureEnabled("outboundDealerEmail") is false or the rfq is not released (rfqIsReleased) and log+bump a metric instead of swallowing; build the counter email's unsubscribe link via unsubscribeUrlFor with the directory row (reuse buildInviteEmailFromStored's lookup) and add the same footer lines as quoteInviteHtml. (3) Add `headers: { "List-Unsubscribe": "<url>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }` support to sendViaResend for emails that have an unsubscribe URL (do NOT add a `to` parameter). (4) Change app/api/dealer-unsubscribe from a state-changing GET to GET = confirmation page with a button + POST = action (protects against link scanners). Keep the HMAC verification. (5) Fix the dealer-facing and email copy that claims buyers "were asked to choose another dealership" so it says "buyers see that you are no longer accepting requests". (6) In scrapers/lightsail-crawler/src/auth_api_server.js opt-out cascade (:394,:402), do NOT edit the file in place; write a patch under scrapers/lightsail-crawler/patches/ that matches by dealership id/rooftop (add a dealership_id column on rfq_invites if needed) instead of dealer_name, with rollback notes.
Acceptance: tests for each refusal path; counter email test asserts the unsubscribe URL; tsc + npm test pass.
DON'T: touch SAFE_MODE_RECIPIENT, apply the box patch, deploy, or push to main.
```

**P1-2. Close the Privacy Shield holes: filter counter notes (and dealer notes) for contact info; make the box the authoritative check**
- Evidence: lib/buyerCounter.ts:54; counter route has no findContactInfo; box :1223 and :1670 (no PII check on RFQ note); lib/piiFilter.ts.
- Prompt:
```
In a fresh worktree from origin/main, apply lib/piiFilter.ts findContactInfo to every free-text field that crosses buyer -> dealer: the counter note (parseCounterEdits in lib/buyerCounter.ts and the counter route) and the admin patch of buyerNote (app/api/admin/rfqs/[id]/route.ts). Return a 400 with the same wording as app/api/rfqs/route.ts:104-106. Also add a defensive scrub when rendering an already-stored note on app/quote-request/received/page.tsx (replace a detected contact string with "[contact info removed]"). For the dealer -> buyer direction (used-quote notes, lease notes) do not block, but add a visible banner on the buyer compare "Dealers can't share contact details here; ask TrimScout to relay" only if findContactInfo matches (log a metric). Add tests with email, phone, spelled-out phone and obfuscated email in each field.
Acceptance: tsc + npm test pass; no change to the request-note flow behavior.
DON'T: weaken the existing filter, deploy, or touch the box.
```

**P1-3. Authentication for dealer-only actions (quote and decline routes)**
- Evidence: app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts:7-22; decline/route.ts:8-26; app/rfq/[id]/page.tsx:244-266.
- Prompt:
```
In a fresh worktree from origin/main, restrict app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts and .../decline/route.ts to admin sessions only (use requireAdminSession from lib/adminAuth, as app/api/admin/* does), because they let a buyer author a dealer's quote or decline. Remove buyer access entirely (ops relays phone quotes through the admin desk), and update app/rfq/[id]/page.tsx InviteRow (~:244-266) to hide the "Record quote"/"Record decline" controls for non-admins. Also refuse these routes when the rfq is not released (rfqIsReleased) or status !== "collecting". Add route tests (buyer -> 403, admin -> 200, unreleased -> 409).
Acceptance: tsc + npm test pass; the admin quote-entry flow is unchanged.
DON'T: deploy, change the box, or touch dealer-facing token routes.
```

**P1-4. Do not penalize buyers for walking after quotes; remove silent strikes or tell the buyer**
- Evidence: lib/rfqLogic.ts:113-154; app/api/rfqs/[id]/invites/route.ts:56-60.
- Prompt:
```
In a fresh worktree from origin/main, change the buyer reputation rule so "cancelled_after_quote" (buyer walks after seeing quotes) and "ghosted" are NOT strikes by default (lib/rfqLogic.ts classifyRfqOutcome/buyerRfqStrikeCount). Only abusive patterns should reduce the invite cap: e.g. 3+ requests opened and walked with zero action within 24h, or repeated counters above a rate limit. Make the cap reduction visible: when reputationInviteCap < RFQ_MAX_INVITES, the invites route response must include `reducedCap: true` with copy "To protect dealers from spam, you can add N dealers right now." and the wizard must show it (components/BiddingWizard.tsx). Update tests in lib/rfqLogic.test.ts.
Acceptance: tests assert that walking after a quote is `walked_after_quote` with zero strikes; tsc + npm test pass.
DON'T: remove the one-active-request rule, deploy, or touch production data.
```

**P1-5. Buyer notifications (first email to a buyer): quote arrived, counter declined, request rejected, quote expiring**
- Evidence: no buyer-addressed email exists; quote routes lib send none (used-quote/route.ts:60-70; lease-quote/route.ts:29-46); approval/route.ts:25.
- Prompt:
```
In a fresh worktree from origin/main, add buyer notification emails. Today the only email path is lib/dealerEmail.ts sendViaResend which hardcodes the SAFE MODE recipient; keep that behavior: build a sibling `sendBuyerEmail(subject, html)` that ALSO goes to SAFE_MODE_RECIPIENT with a "[SAFE MODE — intended buyer <masked>]" subject prefix, so nothing reaches real buyers until the owner lifts the override. Build pure builders in lib/buyerEmail.ts for: "A dealer replied to your quote request" (lease-quote and used-quote routes, `after()`), "Your request wasn't released: <reason>" (admin approval route on reject), "A dealer can't do better on your counter" (quote-invite/decline route), "A quote you're comparing expires in 24 hours" (this one needs a schedule: do NOT add a cron; instead expose it as a function the existing ops drain endpoint app/api/ops/drain-invites can call). Copy rules: "quote request", never "bid"/"auction"; no dealer contact info in the buyer email; link to /rfq/<id>. Respect an opt-in setting only if one exists; otherwise send transactional emails only. Add tests for each builder and for failure-swallowing (log + bump a metric).
Acceptance: tsc + npm test pass; no new dependency.
DON'T: remove SAFE MODE, send to real buyer addresses, add a cron, or deploy.
```

### P2 (cleanup and hardening)

**P2-1. User-visible "bid/auction/binding" copy sweep** — evidence and replacement text are in section 4.
```
In a fresh worktree from origin/main, replace every user-visible "bid", "bids", "bidding", "auction", "binding" string listed in /private/tmp/trimscout-audit/messaging_audit.md section 4 (app/layout.tsx:7-9, app/opengraph-image.tsx:4, components/AuthModal.tsx:109, components/DealTrackerDashboard.tsx:344, components/LiveDealRoom.tsx:492, components/DealerPortal.tsx lines 365,408,494,545,569,579,593,614,1042,1192,1269,1296,273,277, components/AiNegotiatorAssistant.tsx:111,277,297, lib/negotiationPolicy.ts:81-144 messages, lib/contractVerification.ts:84-107, app/api/checkout/create-session/route.ts:31, app/api/deal-requests/[id]/negotiate/route.ts:53,57, app/api/deal-requests/[id]/bids/route.ts:58,76, README.md:3,16,20) using the suggested replacements. Do NOT rename identifiers, routes, DB columns, types (BiddingWizard, DealerBid, deal_bids, /bids, dealer-bids) or test ids. Update affected tests/snapshots (e.g. lib/listingSheet.test.ts:466 expects the string "Review & Privacy Shield", leave that). Add a test that greps the changed user-visible strings (a lib/copyGuard.test.ts scanning app/ and components/ JSX text for /\b(auction|bid(s|ding)?)\b/i excluding an explicit allowlist of identifiers and the "not an auction, not a bid" legal disclaimers).
Acceptance: tsc + npm test pass; the guard test fails when a banned word is reintroduced.
DON'T: touch the DB/box, rename files, or deploy.
```

**P2-2. Unassigned and parked invites: a visible state and an ops path**
- Evidence: lib/inviteOutbox.ts:87; lib/rfqTracker.ts:127,144-145; ApprovalsClient.tsx:21,101.
```
In a fresh worktree from origin/main, make `no_desk` and `parked_switch_off` invites visible. Add a lifecycle state "waiting_on_routing" in lib/rfqTracker.ts (detail: "We're routing this to the dealership by hand; we'll update this page when it's out.") instead of "Sending to N dealers…". In the admin approvals UI (app/admin/approvals/ApprovalsClient.tsx) add an "Assign address" action for unassigned invites: new admin route PATCH app/api/admin/rfqs/[id]/invites/[inviteId] (check the existing folder) that stores a dealer_contact_email via the box API ONLY for admin sessions, validates with isPlausibleDealerEmail and refuses generic mailboxes unless the admin confirms, then calls drainQueuedInvites. Tests for the tracker state and the route.
DON'T: change SAFE MODE, apply any box change in place (write a patch file), or deploy.
```

**P2-3. Invite lifecycle: expire unanswered invites, free the desk, nudge once**
- Evidence: box :1317-1327; lib/rfq.ts:40 has `expired` status unused for RFQs.
```
In a fresh worktree from origin/main, design (do not deploy) invite expiry. Write a patch for scrapers/lightsail-crawler/src/deals_api_server.js as a separate file under scrapers/lightsail-crawler/patches/ that: sets rfq_invites.status='expired' for invites still `invited` 7 days after sent_at (with a rfq_events row), excludes expired from the one-open-invite-per-desk check, and exposes GET /api/rfq-invites/due-reminders for invites that are 48h old and unviewed. In the Next app add lib/inviteReminders.ts (pure) + a drain-style route app/api/ops/remind-invites (admin or x-ops-secret, same auth as app/api/ops/drain-invites/route.ts) that sends ONE reminder email per invite via the safe-mode sender. Update components/UsedCompare.tsx/LeaseCompare.tsx to show "Expired invite — try another dealership". Tests for pure logic.
DON'T: add a cron, apply the box patch, or deploy.
```

**P2-4. Expired quote remedy: "Ask for a refresh"**
- Evidence: leaseCompare.ts:163; UsedCompare.tsx:93; box :1533-1535 refuses re-quote.
```
In a fresh worktree from origin/main, add a buyer action "Ask this dealer to refresh" on an expired quote. App: new route app/api/rfqs/[id]/invites/[inviteId]/refresh (buyer auth, owner check, quote must be expired, rate limited) that calls a new box endpoint to reopen the invite (supersede the expired quote, keep it in priorQuotes) and emails the desk "Your quote expired — submit a refreshed one" via the safe-mode sender with opt-out checks. Provide the box endpoint as a patch file in scrapers/lightsail-crawler/patches/ (do not apply). Update received/page.tsx to prefill from the expired quote. Tests for the route and the compare UI chip.
DON'T: deploy, apply the box patch, or change SAFE MODE.
```

**P2-5. Reliability of sends: idempotent "sent" mark, trade-in nudge in `after()`, counter send ledger**
- Evidence: inviteOutbox.ts:94 (swallowed mark), trade-in/route.ts:73 (`void`), counter/route.ts:61.
```
In a fresh worktree from origin/main: (1) wrap trade-in/route.ts:73 `void notifyDealerOfTradeIn(...)` in `after()` like app/api/deal-requests/route.ts:98. (2) In lib/inviteOutbox.ts, if Resend accepts but markRfqInviteDelivery fails, retry the mark once and bump("mark_sent_failed"); never leave an accepted send in `queued` without a metric. (3) For the counter email, persist the outcome: new box event via logRfqEvent is out of scope, so instead return `{ emailed: boolean }` from the counter route and show "We couldn't notify the dealer — we'll retry" to the buyer; retry through the existing ops drain endpoint by adding a `counter_pending` filter derived from rfq.invites where buyerCounter exists and deliveryStatus did not advance (pure function + test). Add console.error with rfqId/inviteId for every swallowed failure listed in section 2.2.
DON'T: change the safe-mode recipient, add a queue service, or deploy.
```

**P2-6. Token hygiene**
- Evidence: dealerUnsubscribe.ts/dealerSignupInvite.ts (no expiry), dealer-signup-invite/route.ts:19, :28-32.
```
In a fresh worktree from origin/main, add expiry to the HMAC links: include an issued-at timestamp in the signed payload for unsubscribe and dealer-signup invite links (lib/dealerUnsubscribe.ts, lib/dealerSignupInvite.ts), accept links up to 30 days old for signup and 365 days for unsubscribe (unsubscribe should stay honored), keep backward compatibility with existing links for 30 days via a legacy verify path flagged with a metric. Stop returning contactEmail from app/api/dealer-signup-invite/route.ts (return a masked email via maskEmail). Tests for expiry, tamper and legacy tokens.
DON'T: rotate LIGHTSAIL_API_KEY, break existing outstanding links without the legacy path, or deploy.
```

---

### Appendix: items I could not verify from code
- Live values of `RESEND_API_KEY`, `DEALER_EMAIL_FROM`, `FEATURE_OUTBOUND_DEALER_EMAIL`, `FEATURE_RFQ_SEND`, `OPS_SECRET`, `APP_BASE_URL`, and whether the box runs this exact revision of deals_api_server.js / auth_api_server.js (memory notes say live box files drift from the repo mirrors).
- Whether the wizard can actually produce an RFQ with neither lease nor quote prefs (item 3.6) and whether the post-"all desks blocked" screen allows walking the orphan RFQ (section 2.2).
- Whether Resend deliverability from `onboarding@resend.dev` matters (not an issue while SAFE MODE routes to the owner).
