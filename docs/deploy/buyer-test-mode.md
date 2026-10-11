# Buyer test mode + mid-flow sign-in fix — deploy steps

Code is merged to `main` and Vercel deploys it. **Test mode stays inert until both steps below are done**, and the app fails
closed before then: a test-mode send on an unpatched box returns 503 and closes the request it created (nothing is emailed).

## What changed
- **Sign-in prompts (root cause):** the wizard's send step signed the account out and opened the sign-in modal whenever the
  signed-in account's stored role was not `buyer` (Paul's admin account). No 401, no expired session. Now it only says so, and the
  header "Sign in as buyer" button is the explicit switch. A buyer whose page copy of the user lags the session is also no longer
  prompted: the send step asks the live session first.
- **Test mode (`BUYER_TEST_MODE_EMAILS`):** for the listed accounts only — no one-active-request limit, accepted as a buyer
  whatever the stored role, every request flagged `audit = 1` on the box (out of metrics) with dealer email on SAFE MODE, admin
  approval email prefixed `[TEST]`, a test bar with **Walk away from all my test requests** in the wizard and the tracker.
  Real buyers keep the one-request limit.

## 1. Box patch — deals box (box2), idle window, on Paul's GO
Do not run during the nightly inventory sync (the script refuses unless `FORCE=1`). Adds `rfq_requests.audit` / `audit_at`,
honours `buyerTestMode: true` from the full key only, returns `audit` on RFQs. Does not touch the INSERT, invites, or any other
route. It restarts `deals-api` (pm2).

```bash
ssh -i ~/.ssh/lightsail_key.pem ubuntu@52.202.234.65
curl -fsSL -o 2026-10-11-buyer-test-mode.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-buyer-test-mode.sh && bash 2026-10-11-buyer-test-mode.sh
```

Dry run on a copy first (no sudo, no restart): `cp /opt/trimscout-deals/src/deals_api_server.js /tmp/d.js && TEST_ONLY=1 FILE=/tmp/d.js bash 2026-10-11-buyer-test-mode.sh`.
It was run this way against a copy of the live file on 2026-10-11: all four edits applied, `node --check` clean, second run a no-op.
Rollback: the script prints `sudo cp <file>.bak.<stamp> <file> && sudo pm2 restart deals-api`.

Note: the live box has no `audit` column on invites/quotes/events (that is the not-yet-deployed audit-key work), so on the live
box only `rfq_requests.audit` is set. Offline metric queries over `rfq_*` tables should join `rfq_requests` and filter `audit = 0`.

## 2. Vercel env var (after step 1) — Paul sets
| Var | Value | Notes |
|---|---|---|
| `BUYER_TEST_MODE_EMAILS` | `pausmi@outlook.com` | Comma-separated account emails. Unset = test mode off for everyone. Production env, then redeploy. |

No other new env. `REQUIRE_BUYER_LOGIN` is untouched.

## 3. Verify
1. Sign in as `pausmi@outlook.com`: the wizard shows the blue test bar; no "already have an active request" notice.
2. Send a request, then start and send a second one without walking away from the first: both succeed.
3. The admin approval email arrives as `[TEST] [Approval needed] …`; released invites email `pausmi@outlook.com` only.
4. **Walk away from all my test requests** → "Walked away from N test requests"; the tracker shows them walked.
5. Sign in as an ordinary buyer: no test bar, one-active-request limit still enforced.
