# Porsche inventory audit — WAF note

Per the audit brief's detect-only requirement, this documents dealers confirmed blocked by real bot protection rather than a parsing bug — no bypass attempted or recommended.

## Porsche Fort Myers, Porsche Naples — confirmed Akamai, already correctly handled

The audit flagged these two as the worst price-gap dealers (~91% and ~73% missing, respectively). Root-caused live 2026-09-22 against real VDP URLs from the audit's own export:

- `porschefortmyers.com` and `porschenaples.com` both return `HTTP 403` with response header `server: AkamaiGHost` to a plain HTTP fetch (the kind of request the crawler's primary extraction strategies make).
- Akamai's own diagnostic cookie on that response — `set-cookie: ddc_akam_bot=3990001|curl_<hash>` — explicitly fingerprints the request's TLS/client signature as `curl`. This is fingerprint-based bot detection, not a missing header (ruled out: added a full realistic browser header set — `Sec-Fetch-*`, `sec-ch-ua-*`, `Accept-Language`, a real Chrome `User-Agent` — no change, still 403).
- A real browser render **does** get past it (confirmed: the actual VDP loaded, revealing both dealers run the DDC/Dealer.com platform, not schema.org or Porsche's own official retailer platform).
- The crawler's own `bot_protection.js` already classifies a bare `HTTP_403` as a member of `WAF_CLASSES`, and `decideProbeNext()` deliberately returns `'stop'` for it — the file's own header comment states "Forbidden here, and nowhere else in this package should add it: WAF/captcha/challenge bypass, fingerprint spoofing, cookie replay..." This is the crawler correctly honoring the same detect-only policy this audit itself requires, not a gap.
- The audit's ~91%/73% figures (partial, not 0% or 100%) are consistent with Akamai's blocking being probabilistic/session-based rather than an absolute wall — some requests get through, most don't.

**Conclusion: no code change recommended for these two dealers.** The missing prices are a real, correctly-detected, and correctly-declined-to-bypass bot-protection outcome, not an extraction bug. Re-litigating this would mean weakening the crawler's own stated no-bypass policy.

## Porsche Norwell, Porsche Brooklyn, Porsche Fort Collins — not yet checked

No Listing URL was available for these three at time of writing. Given two of the five originally-flagged dealers turned out to be genuine WAF blocks rather than parsing gaps, these three should be checked the same way (a real VDP fetch + response headers) before assuming either verdict — they could be the Akamai case above, a different WAF vendor, or an actual template/parsing gap worth fixing. Follow-up, not blocking the rest of this audit's fixes.
