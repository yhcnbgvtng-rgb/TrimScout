# Box2 quote patches (2026-11-04)

Installed on box2 (`/opt/trimscout-deals/src`) on 2026-11-04 with `scripts/box/2026-11-04-box2-quote-patches.py`. Written against the **live** files because
the repo mirror and the box had drifted both ways (the box has trade-in, contact-reveal, vin-search and one-per-VIN code that `main`'s
`deals_api_server.js` lacks; `main` has the whole audit harness, #430, that the box lacks). Those are untouched.

| | What | Where |
| --- | --- | --- |
| (a) | `rfq_quotes` inserts stamp `audit` / `audit_at` from the request. Quote reads skip soft-deleted quotes and never show an audit quote under a real request. | `deals_api_server.js` |
| (b) | #683: `availability_json` saved with the quote, returned as `quote.availability` (null on older quotes). | `deals_api_server.js` + `2026-11-03-rfq-quote-availability.sql` (#683) |
| (c) | Optional offer date: no `expiresAt` check, a missing date is stored as `NULL`, never defaulted. A date that is sent must still be real. | `deals_api_server.js` + `2026-11-04-rfq-quote-optional-offer-date.sql` |
| (d) | Staged-deal true OTD = original OTD − (trade − payoff) − tax the trade saves, using the same per-state rule table as `lib/trade/stateTradeCredit.ts`. | new `stateTradeCredit.js`, `dealStages.js`, `rfqStages.js` |

## (d) details
* `stateTradeCredit.js` is generated from the rule table in `lib/trade/stateTradeCredit.ts` (rule, Michigan cap, South Carolina flat fee; 51 jurisdictions). `lib/trade/stateTradeCreditBox.test.ts` compares it with the website for every state/cap year and runs 240 state × quote × trade × payoff cases through both `stagedTrueOtd()` and `trueOtdBreakdown()`.
* The old 11-state list (`TRADE_TAX_CREDIT_STATES`) is now derived from the shared table (it is a different, larger list: e.g. MA, MD, NV credit). The old box math never subtracted the saving from the true OTD at all (it only stored `taxSavings` beside it); it does now, as the website card does.
* The tax inputs (state, price, add-ons, quoted tax, new/used) are stored on `stage_json.otd.tax` when the OTD locks, so the live projections (`liveTrueOtd`) and a dealer-side accept (whose request carries no state) use the same inputs. A deal whose OTD locked before this patch has no stored inputs: it falls back to the quote on file and the state of the request.
* Without a state, a non-cash quote, or in a state with no/unconfirmed credit, nothing is subtracted.

## Install (done 2026-11-04 ~09:25 ET)
```bash
# on box2, after backups (*.bak-20261104-3) and a mariadb-dump of rfq_quotes
sudo mariadb <db> < 2026-11-03-rfq-quote-availability.sql        # additive column (from #683)
sudo mariadb <db> < 2026-11-04-rfq-quote-optional-offer-date.sql # expires_at NULLable
python3 -I 2026-11-04-box2-quote-patches.py --dir /opt/trimscout-deals/src --src <dir with the 3 repo files> --dry-run
python3 -I 2026-11-04-box2-quote-patches.py --dir /opt/trimscout-deals/src --src <dir with the 3 repo files>
sudo -u ubuntu pm2 restart deals-api
```

## Rollback
Restore `deals_api_server.js`, `dealStages.js`, `rfqStages.js` from the `*.bak-20261104-3` copies, delete `stateTradeCredit.js`, restart. The columns are additive and harmless to leave. To make `expires_at` NOT NULL again, first remove or date every quote saved without one (the ALTER fails while a NULL exists).

## Not in this patch
* `main`'s own `deals_api_server.js` still requires `expiresAt` (change (c)) and does not carry (a); after #683 merges, the same edits belong there.
* Invites (`rfq_invites`) still do not get the audit stamp on the box (only quotes, as asked); the request's `audit` is what the test flag hangs on.
