# Warm `stats-cache.json` when deals-api starts (box2) — code only, NOTHING IS INSTALLED

Install only on Paul's typed GO, in an idle window. Box2 only. Two patched files in `/opt/trimscout-deals/src` (`statsCache.js`, `deals_api_server.js`), one plain `pm2 restart deals-api`. No schema or env change.

## Why
After a restart the `stats` entry of `stats-cache.json` was cold until the first request, so dealers and VINs read null. The server now runs the real `/api/inventory/stats` handler once, 5 s after `listen`, against a throwaway response (not awaited, errors logged), which fills the same `stats` key. A fresh persisted entry is not recomputed; an expired one is served while its refresh runs.

## These patches are cut from repo main, not from box2's text
`deals_api_server.js.patch` and `statsCache.js.patch` are `git diff origin/main` of this change. Box2's live files may differ from main (see `docs/box-snapshots/`), so there is no BASE md5 to quote here. At install time, on a COPY: record the live md5s, dry-run with `patch -F0`, `node --check` the result, and refit like the other packages if a hunk does not apply. Do not install a file that was not syntax-checked.

The warm lines are applied after `stats-movement-split` (it owns `handleInventoryStats`); this change does not touch that handler.

## Verify after the restart
`pm2 logs deals-api --lines 40 --nostream | grep "stats cache"` shows `warmed stats` (or `warm of stats failed: ...`, which does not stop startup). Then `/api/inventory/stats` answers at once with dealers and VINs set.

## Rollback
Restore the two `.bak` files taken before the install and `pm2 restart deals-api`. `stats-cache.json` needs no cleanup.
