# Dealer domain/name drift report

## What it does

Every night, `scripts/dealer-bot-report.mjs` already probes every in-scope
dealer's configured site with a plain, detect-only HTTP client. It now also
flags two things per dealer, using data that probe already fetches (no new
network calls):

- **`domainDrift`** — the configured domain and the probe's final
  (post-redirect) URL land on different hosts. Usually means the dealer's
  site has moved, been re-platformed, or (as in the case that motivated
  this) the seed record still has a pre-rebrand domain that now redirects
  elsewhere.
- **`nameDrift`** — the page's own self-reported name (read via
  `src/dealerPageIdentityPlain.js`, a plain-JS port of
  `lib/dealerPageIdentity.ts`'s `extractDealerIdentity`) doesn't plausibly
  match the configured name (see `src/dealerDriftDetect.js` for the
  containment-based fuzzy match — deliberately tolerant of "of"-style
  template variants like "BMW of Morristown" vs "Morristown BMW").

Each state's `data/reports/dealer-bot-report-<state>-<brand>-<date>.json`
now carries a `driftFlagged` array. `scripts/dealer-drift-report.mjs` (run
from the operator's machine — `npm run dealer-drift-report`) pulls every
box's `-latest.json` reports over SSH and rolls them into one
`data/reports/drift-summary.{json,html}` table, the same pattern
`scripts/fleet-report.mjs` already uses for SLA reporting. This is a report
to check periodically, not a push alert — nothing here auto-fixes anything,
matching this codebase's detect-only, no-bypass posture end to end.

## Real case that motivated this (2026-09-23)

TrimScout's dealer record for "Mark Ficken Ford" (Charlotte, NC) still had
the dealer's pre-rebrand domain (`felixsabatesfordlincoln.net`). It redirects
to the dealer's real current site (`fordlincolncharlotte.com`), which itself
403s to a plain fetch (Akamai) — so `dealer_inventory` had zero rows for
this dealer, silently, with nothing surfacing it. Confirmed live as the
acceptance test for this feature:

```
node scripts/dealer-bot-report.mjs --state=NC --brand=Ford
...
[70/94] Ford · Mark Ficken Ford (felixsabatesfordlincoln.net)...
    drift: domain felixsabatesfordlincoln.net -> fordlincolncharlotte.com
HTTP_403 403 · Akamai
```

## A gap found and fixed along the way: expansion brands were structurally invisible

Every state's dealer loader (`loadNjDealers`, `loadNcDealers`, ...) sources
dealers exclusively from `src/oem_locator.js`'s `locatorRowsForState()`,
which reads `dealers/oem-dumps/*.json` — and that directory only ever holds
OEM-locator dumps for the **core** brand set (Toyota, Honda, BMW, Porsche,
etc.). The **expansion** brands (Ford, Lincoln, Chevrolet, GMC, Buick,
Cadillac, Stellantis) were onboarded through a separate one-off nationwide
dealer-contact-crawl instead (`scripts/materialize-expansion-dealer-
files.mjs`), which writes straight to `dealers/<state>/<brand>.json` — files
nothing except the real crawl (`standalone.js`, via `CRAWLER_DEALERS_FILE`)
ever read back.

Setting `CRAWLER_BRAND_SET=expansion` does **not** fix this: it only changes
which brands `isNjBrandIn()`/`isNjBrandOut()` allow through, not where the
dealer rows come from. So `dealer-bot-report.mjs` could never see an
expansion-brand dealer — including Mark Ficken Ford, a Ford dealer — no
matter what env var was set. This also meant every expansion-box
(`box3`/`box4`) nightly `dealer-bot-report.mjs` run has always found zero
dealers under `CRAWLER_BRAND_SET=expansion` and fallen through to
`run-daily-crawl.mjs`'s "couldn't read bot-report output — attempting every
in-scope brand" safety net, rather than actually using its WAF pre-filter
for expansion brands.

Fixed by `src/expansionDealerFiles.js`, which reads the pre-materialized
`dealers/<state>/<brand>.json` files directly and is merged into
`dealer-bot-report.mjs`'s dealer list alongside the OEM-locator-backed core
brands, regardless of `CRAWLER_BRAND_SET`. This is a genuine behavior
change for expansion boxes: `report.readyToCrawl` will now actually reflect
per-brand WAF status instead of always empty-with-fallback, so
`run-daily-crawl.mjs` will skip an expansion brand for a state only when
**every** dealer for that brand in that state is unreachable — strictly
better than today's "attempt it anyway" fallback, never worse.

## Observation, not a bug: Ford's seed domains are noisier than core brands'

Running the acceptance test above against all 94 NC Ford dealers flagged 42
(45%) with `domainDrift` — most are close variants (`.net` vs `.com`, or a
missing/extra "of") rather than full rebrands like Mark Ficken Ford. This
likely reflects the nationwide roster's domains being less rigorously
verified than the OEM-locator-backed core brands (0 drift flagged on a BMW
NJ spot-check). Worth a separate pass at some point to re-verify Ford's
seed domains against live redirects, but out of scope here — this report's
job is to surface it, not silently correct it.
