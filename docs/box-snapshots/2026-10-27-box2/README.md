# box2 live-file snapshot, 2026-10-27 17:27 ET

Verbatim, read-only copies (`scp` from `/opt/trimscout-deals/src/`, nothing on the box changed) of the two files that had drifted from the repo:

| File | md5 | Lines | Note |
|---|---|---|---|
| `deals_api_server.js` | see `MD5S.txt` | 4,355 | the live deals API, plus the one-per-VIN import and `onePerVin:true` echo installed today |
| `inventoryListQuery.js` | see `MD5S.txt` | 409 | the live list query, plus the one-per-VIN predicate hunk |

Why they are here and not over `scrapers/lightsail-crawler/src/`: the repo's copies are pinned by `scripts/box/sweep-guards-install.test.mjs` and carry merged work the box does not have (the box lacks `withExportFastSort` and the superseded-retire handler's invalidate line, for example; 454 and 26 differing lines). Overwriting them would silently "install" that work in the next patch run. Box patches are written against **these** files (a test applies them with zero fuzz). To refresh: `scp` again, `md5` into `MD5S.txt`, and re-run `docs/box-patches/*/` patch tests.

`test/one_per_vin_losers.test.js` fails if a snapshot no longer matches `MD5S.txt`.
