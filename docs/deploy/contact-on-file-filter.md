# Deploy: "Dealer contact on file" buyer filter (deals-api on box2)

**Status: code only.** The web app ships the filter dark (checkbox hidden, `contactOnFile` ignored) until the deals-api has the two new
endpoints. Nothing here was applied to a box. Run it in an idle window; do not hot-patch.

## What changed in deals-api

| File (box2 `/opt/trimscout-deals/src/`) | Change |
|---|---|
| `inventoryListQuery.js` | `inventoryListQuery(params, opts)` takes `opts.contactDealerIds` and adds one `i.dealer_id IN (...)` predicate (page, count and capped count share it). New exports: `contactDealerIdsOf`, `contactIdsPredicate`, `contactFacetQueries`, `MAX_CONTACT_DEALER_IDS`. |
| `deals_api_server.js` | Imports the two new helpers. `handleListInventory(req, res, params, extra)` echoes `contactFilter: {dealers}` when a set was applied. New `handleContactSearch` (`POST /api/inventory/contact-search`) and `handleContactFacets` (`POST /api/inventory/contact-facets`) plus two route lines next to `/api/inventory/stats`. |

No schema change, no new index, no new file, no new pm2 process. `GET /api/inventory` and `GET /api/inventory/facets` are untouched.

## Why POST

The web app decides which dealers qualify with the shared contact function (the same one behind the Contact column and Step 3) and sends the
ids. Measured 2026-10-10 against the live directory: 18,224 rows, 7,794 qualify, a 41 KB id list. That does not fit a URL.

## Before you start

1. The box files drift from the repo mirrors (see `docs/BOXES.md`: the deals-api is "patched separately"). Do **not** copy the repo files over. Diff first and apply the hunks to the box's text:
   ```bash
   ssh -i ~/.ssh/lightsail_key.pem ubuntu@<box2> 'cd /opt/trimscout-deals/src && md5sum inventoryListQuery.js deals_api_server.js'
   ```
   Compare against `git show origin/main:scrapers/lightsail-crawler/src/<file> | md5sum` from before this PR (`git show <merge-commit>^:...`). If they match, copying this PR's two files is safe; if not, hand-apply the hunks from `git diff <merge-commit>^ <merge-commit> -- scrapers/lightsail-crawler/src/`.
2. Idle window: no nightly sync running (cross-box sync lock released on all 4 boxes) and no restart already queued. A restart drops in-flight buyer searches.
3. Back up: `cp inventoryListQuery.js inventoryListQuery.js.pre-contact && cp deals_api_server.js deals_api_server.js.pre-contact`.

## Apply

```bash
cd /opt/trimscout-deals/src
node --check inventoryListQuery.js && node --check deals_api_server.js
pm2 restart trimscout-deals-api
pm2 logs trimscout-deals-api --lines 30 --nostream     # expect a clean start
```

Restart note (from earlier incidents): start-up `ALTER`s can hang behind a long SELECT. If `/health` is not back in about a minute, check `SHOW PROCESSLIST` for a long query before restarting again.

## Verify (read-only; `KEY` = the shared X-Trimscout-Api-Key)

```bash
H="X-Trimscout-Api-Key: $KEY"; U=http://127.0.0.1:3004
# 1. empty set matches nothing, and the echo is present
curl -s -H "$H" -H 'Content-Type: application/json' -d '{"query":"make=Toyota&inStock=1&retailOnly=1&limit=5","dealerIds":[]}' $U/api/inventory/contact-search
#    -> {"total":0,...,"contactFilter":{"dealers":0}}
# 2. a real set: total must equal the number of rows paged, and every vehicle's dealerId must be in the set
curl -s -H "$H" -H 'Content-Type: application/json' -d '{"query":"make=Toyota&state=NJ&inStock=1&retailOnly=1&seenWithinDays=7&limit=50&countCap=1000","dealerIds":[<a few ids>]}' $U/api/inventory/contact-search
# 3. facets for the same set; the makes/states n must sum to that search's total (uncapped case)
curl -s -H "$H" -H 'Content-Type: application/json' -d '{"make":"Toyota","state":"NJ","seenWithinDays":7,"dealerIds":[<same ids>]}' $U/api/inventory/contact-facets
# 4. bad input is a 400, not a 500
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H 'Content-Type: application/json' -d '{"dealerIds":"x"}' $U/api/inventory/contact-search   # 400
```

**Measure before turning it on (not measured yet).** `contact-facets` filters on `stale_at`, `cond`, `last_seen_at` and `dealer_id`, which the facet indexes
do not all cover. Time the `make=Ford` and `make=Toyota` cases with the full ~7.8k-id set; every statement runs under `max_statement_time`, so the worst case is a 503 to the buyer, not a hung
query. If Ford exceeds a few seconds, `EXPLAIN` the `states` query and consider an index on `(removed_at, make, dealer_id)`; do not add it blind.

## Turn it on (web)

Set `NEXT_PUBLIC_CONTACT_FILTER=1` in Vercel (Production) and redeploy. The checkbox appears under "More filters" and `?contactOnFile=1` is honored.

## Roll back

- Web: unset `NEXT_PUBLIC_CONTACT_FILTER` and redeploy. The filter disappears and the URL param is ignored. Nothing else depends on the box change.
- Box: restore the `.pre-contact` copies and `pm2 restart trimscout-deals-api`.

## Failure behavior (by design)

- Box not updated yet (404) or an answer without the `contactFilter` echo: the search returns an error. It never shows an unfiltered list under a checked box.
- Dealer directory down: 503 "Dealer contacts are unavailable", same reason.

## Rule note

"Contact on file" is the `isQuoteReachable` rule: a reachable email, **named or not**, is Yes in the search column, passes the filter and counts, and gets Step 3's green badge. An unverified address shows "Unverified email" and no email shows No; neither passes the filter. The rule lives in `isReachableState` / `hasContactOnFile` (`lib/dealerContactLookup.ts`), so all three move together.
