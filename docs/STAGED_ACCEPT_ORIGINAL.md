# Staged cash deal: accept the dealer's original offer after a declined counter

**Status: code only. Nothing is installed on any box. Install only on Paul's GO, in an idle window.**

## What it fixes
When a dealer declines the buyer's counter, the website (PR #625) shows "Counter declined: original offer stands". On a **staged cash**
deal the accept lives on the box stage endpoint, which refuses declined desks ("no longer in the running", 409), so the buyer could see
the original but not accept it. This patch lets the buyer's `accept_otd` through for exactly that case:

- the invite is `declined`, still has the buyer's counter (`buyer_counter_json`) and has a superseded quote on file;
- the actor is the **buyer** and the action is **accept_otd**; every other action on a declined desk is still a 409;
- the original quote must not be expired (else 409 `expired`, nothing written);
- on success, in the same transaction as the stage write: the desk goes back to `quoted` and the original quote's `superseded_at` is cleared,
  so later steps (trade-in, payment, final) run as on any other desk. If the desk changed meanwhile: rollback, 409 `stale`.
- the stage event gets `counterDeclinedOriginal: true`.

Lease and single-sheet cash/finance already work through `/pick` (no box change needed). One module changes: `rfqStages.js`. No edit to
`deals_api_server.js`, no schema change, no change to `dealStages.js`.

## Files and md5s (this PR)
| File | md5 |
|---|---|
| `scrapers/lightsail-crawler/src/rfqStages.js` (the new module) | `548574bc4cd2fffdfa34bc54ec682ce5` |
| `scripts/box/2026-10-29-rfq-staged-accept-original.sh` (installer) | `2b11e772874d9521e02945bffcbacad2` |

`test/` pins the module md5 above to the file in the repo; if you change the module, update this table.

## Install steps (box2 = deals box, 52.202.234.65, user ubuntu; see docs/BOXES.md)
Prereqs on the box: 2026-10-11 stage endpoint, 2026-09-13 buyer counter and 2026-10-13 deal-stages-v2 already installed (the script refuses otherwise).

1. **Idle window** only: outside 22:00-23:30 ET, no `inventory-sync` running on any box (`pgrep -f inventory-sync.mjs` empty on box1-4).
2. Record the live md5 first: `md5sum /opt/trimscout-deals/src/rfqStages.js` (write it down; it is the rollback target).
3. Fetch and run, pinning the md5:
   ```bash
   curl -fsSL -o 2026-10-29-rfq-staged-accept-original.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-29-rfq-staged-accept-original.sh
   md5sum 2026-10-29-rfq-staged-accept-original.sh   # expect 2b11e772874d9521e02945bffcbacad2
   EXPECT_MD5=548574bc4cd2fffdfa34bc54ec682ce5 bash 2026-10-29-rfq-staged-accept-original.sh
   ```
   It prints the new module md5, the live md5 before, the backup path and its md5 (must equal step 2), runs `node --check`, restarts
   `trimscout-deals-api` and curls `/health` and the stage route (401 = up and guarding).
4. Verify: `md5sum /opt/trimscout-deals/src/rfqStages.js` = `548574bc4cd2fffdfa34bc54ec682ce5`; `sudo pm2 status trimscout-deals-api` online, no restart loop.
5. **Then** in Vercel set `NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL=on` and redeploy (it is build-time). Until then the website shows the state and amount
   but no accept button, so merging this PR before the install is safe.
6. SAFE MODE check on a test-mode request (BUYER_TEST_MODE_EMAILS account): staged cash, counter, dealer declines the counter (dealer link),
   buyer accepts the original; the desk reads as locked at the original out-the-door and the dealer page shows the accepted state.

## Rollback
```bash
sudo cp /opt/trimscout-deals/src/rfqStages.js.bak.<STAMP> /opt/trimscout-deals/src/rfqStages.js
sudo pm2 restart trimscout-deals-api
md5sum /opt/trimscout-deals/src/rfqStages.js   # must equal the md5 you recorded in step 2
```
(`<STAMP>` is printed by the installer.) Also unset `NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL` and redeploy; the button then disappears and the buyer sees the
state only. A desk already reopened by an accept stays a normal quoted desk after rollback; that is the correct state, nothing to undo.
