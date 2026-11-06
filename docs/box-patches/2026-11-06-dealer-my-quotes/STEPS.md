# Dealer My Quotes on box2 (PR #712) — INSTALLED 2026-11-05 22:14 ET

Box2 only (`ssh box2`, `docs/BOXES.md`). Installed and restarted by this session; no other box, no Vercel env, no mail.

## What changed on box2 (`/opt/trimscout-deals/src`)
| File | Before | After |
|---|---|---|
| `rfqDealerInvites.js` | absent | `d29f70aa2eecc186bd9232e1d3b60895` (`files/`) |
| `deals_api_server.js` | `846d8cabac356b37798fb047f334c387` (live 2026-11-05) | `d63818f09574575a7b593d144687dead`, patched by `deals_api_server.js.patch` (`cbfa562e…`): 1 import, 1 handler const, `GET /api/dealer-invites`, `POST /api/dealer-invites/claim`, `rfq_invites.dealer_user_id` column + index (created lazily by `ensureQuotePackageColumns`) |

Backup: `~/backups/box2-dealer-my-quotes-20261106/` (`deals_api_server.js`, `md5s.txt`). Rollback: `bash /tmp/mqi/install.sh restore && pm2 restart deals-api` (the column is additive and stays).

## Differences from the repo mirror (why this is its own package)
- The patch is cut from the **live** file, not the mirror. `scrapers/lightsail-crawler/src/deals_api_server.js` is NOT edited: its md5 is pinned by `2026-10-27-sweep-guards`, so the sweep-guards md5s were **not** regenerated (nothing required it).
- The live `auditKey.js` predates `isTestInvite`/`loadTestDealers`, so `rfqDealerInvites.js` carries its own `isTestInvite`, and the wiring reads `dealership_contacts.is_test` itself (a failed lookup means "no test dealers": audit RFQs stay hidden).

## Re-run / check (any time, read-only)
`scp -r docs/box-patches/2026-11-06-dealer-my-quotes box2:/tmp/mqi && ssh box2 'bash /tmp/mqi/install.sh check'` — prints `ALREADY PATCHED` once installed; if the live server md5 drifts, `check` stops: re-cut the patch from the live file.
`bash install.sh verify` — key-authenticated empty list for an unknown account, then the column + index exist.

## Verified 2026-11-05
`GET /health`, `GET /api/dealer-invites` and `POST /api/dealer-invites/claim` without the key -> 401; with the key an unknown account gets `200 {"invites":[]}`; `rfq_invites.dealer_user_id` and `idx_rfq_invites_dealer_user` exist. `invites` have no `dealer_user_id` yet: a dealer's tab fills as they open links while signed in. A real-dealer end-to-end (claim then list) was NOT run: it needs a real dealer session and a live invite.

<!-- MD5S:START -->
```
# md5  role  file
d29f70aa2eecc186bd9232e1d3b60895  PACKAGE  files/rfqDealerInvites.js
cbfa562e25f60fd79300e4c067c92ecd  PACKAGE  deals_api_server.js.patch
51145090e2242b514d919189eed50acb  PACKAGE  smoke.mjs
846d8cabac356b37798fb047f334c387  BASE  deals_api_server.js (live box2, 2026-11-05)
d63818f09574575a7b593d144687dead  FINAL  deals_api_server.js
```
<!-- MD5S:END -->
