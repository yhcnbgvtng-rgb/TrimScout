# 2026 RAV4 blank-trim fill — read-only dry run (2026-10-09)

Nothing was written and no dealer page was fetched. Sources: the stored listing URL (`recoverTrimFromUrl`) and the newest nightly-crawl DOM snapshot kept on the crawl boxes (`data/dom_blobs/<VIN>/<date>.html.gz`, read-only file reads), run through the existing `recoverTrim` on THIS VIN's own JSON-LD vehicle block / page title only. A value is accepted only if it resolves, through #432's trim rules (drivetrain / Hybrid / HEV / CVT / Natl words stripped, bare XLE = XLE Premium), to LE, SE, XLE Premium, Woodland, XSE or Limited. URL and snapshot disagreeing = left blank. No VIN-pattern guess.

`trim_fill_dry_run.csv` — one row per car (786 blank + 272 untrusted-string cars): VIN, dealer, current trim, proposed trim, source (url / snapshot / url+snapshot), status, evidence string, listing URL.

Accuracy check first (500 random RAV4s that already have a trusted trim): url 219/219 match, snapshot 237/237 match, combined 245/245 (100%, 0 mismatches), 0 url-vs-snapshot conflicts. Coverage on those 500 is 49%: the extractor returns nothing for the rest rather than a wrong value.
