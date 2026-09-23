# Porsche inventory audit — deferred follow-ups

Two findings from live verification against real Porsche-network VDPs (jackdaniels.porsche.com, 2026-09-22) that are real and fixable, but more involved than the fixes shipped in this pass — documented here so a future pass doesn't need to re-do this investigation.

## MSRP exists, but not where the code looks

`extractSchemaOrgVehicle` and `extractPorscheRetailerVehicle` both assign the same variable to `price` and `msrp` (a real bug, already flagged in the main audit findings). The natural fix — read a separate MSRP field — is more involved than expected:

- Schema.org's `Vehicle`/`Car` JSON-LD genuinely has **no separate MSRP property anywhere**, confirmed on both a used and a new real VDP. `offers.price` is the only price value in that block. Nothing to read there — this is a real data-source limitation, not a bug.
- The RSC platform's `car` object (what `extractPorscheRetailerVehicle` parses) *also* has only one price field — `car.priceTotalTotal` (confirmed: 169539 on the real Taycan sample).
- **A genuinely separate MSRP value does exist**, but in a completely different part of the RSC-streamed payload: a `detailedBreakdown.categories` array, where one entry has `"key":"total-msrp"` and a formatted currency string as its value (confirmed live: `{"label":"Total MSRP*","value":"$$168,740.00","key":"total-msrp",...}` — note the page also has a `$$` double-dollar rendering artifact to strip when parsing). This is a different top-level RSC entity than `car`, not a field on it — `extractBracketedValue(decoded, 'car', '{', '}')`'s approach can't just be extended with one more key; it needs its own bracket-matched lookup for whatever object contains `detailedBreakdown` (not yet located precisely — need to confirm the containing object's own key name from a fuller RSC stream dump before writing an extractor).
- On the real sample, `priceTotalTotal` (169,539) and the `total-msrp` category (168,740) are **different real numbers** — a $799 gap that matches a "Doc Fee" seen elsewhere on the same site. They likely represent different things (transaction total including dealer fees vs. manufacturer's suggested retail before fees) — worth keeping as two distinct, honestly-labeled fields rather than assuming one supersedes the other.

**Recommended next step**: fetch a couple more real RSC VDP page dumps, locate the exact container object for `detailedBreakdown` via `extractBracketedValue`, write a small currency-string parser for values like `"$$168,740.00"`, and add it as a second lookup in `extractPorscheRetailerVehicle` (not schema.org, which has no MSRP data at all to find).

## Window sticker: not present in the initial page load for at least some listings

`applyWindowSticker`'s regex heuristics scan the HTML the crawler already fetched — but on the real Porsche-network VDP checked live, the sticker (labeled "Window Sticker" in the UI, `data-testid="monroney-label-link"`) is a `<button>` with no `href`, and no PDF/sticker URL of any kind appears anywhere in the initial HTML response (checked directly: zero `.pdf` URLs besides an unrelated legal Terms & Conditions document). Clicking the button didn't produce an observable follow-up network request in this session either.

This means the sticker likely requires **interactive discovery** — clicking the control and capturing whatever request or modal content it produces — not a static-HTML parse, at least for this platform/listing type. That's a materially bigger feature than the current regex-scan approach: it would need the same `patchright` real-browser rendering the crawler already uses as a fallback elsewhere, extended to simulate a click and capture the result, which deserves its own dedicated design pass (including checking whether "new" vs. "preowned" listings, or other dealer platforms, behave differently) rather than a quick fix bundled into this audit.

**Recommended next step**: a focused follow-up task specifically for window-sticker capture via interactive `patchright` rendering, scoped and tested on its own.
