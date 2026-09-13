# Overnight QA fix pack — retest notes (2026-09-13)

Branch `fix/overnight-qa-pack`. Re-run of the overnight matrix A–H against the
dev server (same code as the PR) plus API-level checks; production checked
where noted.

## What changed

| # | Report | Root cause | Fix |
|---|---|---|---|
| 1 | GM sticker flaky — UI "GM's factory-sticker service returned no data" while the public URL serves a 150–170 KB PDF | The public endpoint serves the PDF to a bare `curl`; from a cloud egress it intermittently answers a browser-shaped request with an **empty 200** (no Content-Type). The client retried the *same* request shape 3× over ~1.6 s. | `lib/gmSticker.ts`: 4 attempts over ~5 s, **rotating request profiles** (browser → bare/curl-like → browser-nav) so a shape the edge just refused isn't repeated; every attempt logs profile/status/bytes/ct/magic. Empty-body copy no longer says "no data": *"answered our server with an empty response … a block or hiccup on their side, not a missing sticker."* Content validation unchanged (`%PDF` magic, JSON 1001, text build). Buyer can still continue on the limited decode with the honest badge, and now has **"ask the manufacturer again"** inline, which refetches the same VIN and keeps the attached dealership (VIN-first still wins if the VIN now names one). |
| 2 | VIN-only path has no desk for Schumacher/Morristown/Scott | By design (no VDP host, no inventory sighting, GM stickers carry no sold-to) — but the card only said "Dealer not found · Pick dealer". | New block under the vehicle: **"No dealership attached yet — paste the dealership's listing link to attach the store, or search for it by name"** with *Paste the listing link* (focuses the input) and *Search by name* (opens the picker). |
| 3 | scottcars.net intermittently "dealer not found" before the manual pick | Two things: (a) `scottcars.net` **is** on Scott Chevrolet's `domains[]` and resolves `unique` via `alias_host` (prod + dev verified); (b) when the directory fetch itself fails, the route returns `status: none, degraded: true` and the panel said "Dealer not found" — a guess, not a fact. Also `scottcars.com` (the staff mail domain) matched nothing because the email-domain tier only indexed rows **without** a website. | `lib/deskResolve.ts`: staff mail domain indexed for every row as the lowest tier, capped at 6 rooftops (a dealer-group inbox domain is not a key) → `scottcars.com` now resolves **ambiguous: Scott Chevrolet / Scott Cadillac** (picker, two choices). Degraded directory: `parkLink` retries once after 1.5 s before showing anything; the panel then says **"Couldn't check the dealer directory just now"** with *Try the match again* instead of "Dealer not found". |
| 4 | johnsoncadillacnj.com → Johnson Cadillac (Budd Lake) | Already true: row 10693 has `domains: [johnson-gmc.com, johnsoncadillacnj.com]`, resolves `unique` via `alias_host` on prod and dev; display name "Johnson Cadillac · Budd Lake, NJ". GM sticker for 1GYKPYRKXTZ312313 = released Lyriq Signature Sport. | No data change needed; covered by the GM fix above. Browser-verified below. |
| 5 | Freedom Ford (Iselin) has no named email; Step 3 must not pretend | Row 1128 has domains + website but **no contact name / email**. Step 1 already said "no named sales contact on file yet"; Step 3 says "No sales contact on file". | Step 1 note now adds *"— you can add your sales adviser's email on the Dealers step"*; Step 3 blocked copy now points at *Also request quotes from other dealers nearby* as the other way out. The adviser-email path (PR #141) makes the desk tickable; generic mailboxes never do. |

## Matrix A–H

| | Case | Result |
|---|---|---|
| A | Freedom Ford Iselin Bronco, VIN-only `1FMEE9BP9TLA88678` | ✅ Ford sticker released, `verified_factory`, dealer **Freedom Ford (Iselin, NJ)** via `window_sticker`, NJ. No named contact → honest note on Step 1, adviser-email path on Step 3. |
| B | Schumacher Denville VDP `schumacherchevroletdenville.com` + `1GNS6NKD5TR434507` | ✅ desk `unique/alias_host` Schumacher Chevrolet of Denville (named), sticker released / FACTORY VERIFIED |
| C | Open Road Cadillac of Morristown VDP `morristowncadillac.com` | ✅ desk `unique/alias_host` (Florham Park, NJ). ⚠️ residual: row 11557 still has **no named contact** — Step 3 will need an adviser email or nearby mode (data, not code). |
| D | Scottcars Tahoe `scottcars.net` + `1GNS6MKD2TR280381` | ✅ desk unique Scott Chevrolet (Allentown, PA), sticker released. `scottcars.com` → ambiguous Scott Chevrolet / Scott Cadillac (picker). |
| E | VIN-only Scott `1GNS6MKD2TR280381` | ✅ FACTORY VERIFIED, no desk (correct), new **"No dealership attached yet"** block; *Search by name* opens the picker (browser-verified). |
| F | Junk VIN `ZZZZZZZZZZZZZZZZZ` | ✅ 200 `{handled:false, notGm:true, error:"We don't have a factory build…"}` — no crash. |
| G | Johnson Cadillac VDP `johnsoncadillacnj.com` + `1GYKPYRKXTZ312313` | ✅ browser: panel shows **Johnson Cadillac · Budd Lake, NJ · from the listing link · sales contact on file**, 2026 Cadillac Lyriq Signature Sport, FACTORY VERIFIED. |
| H | Step 3 NJ 07405 + Scott PA primary | ✅ (PR #139/#140/#141, live) pre-checked, Listing dealer badge, Continue enabled, no yellow CTA. |

## GM sticker — root cause caught live (3GNAXPEG1VL131423)

Pasting a 2027 Equinox VIN GM's CDN had never served produced, from the new client's per-attempt log:

```
attempt 1 (browser):     200 empty 0B ct=application/pdf
attempt 2 (bare):        200 empty 0B ct=application/pdf   +0.5 s
attempt 3 (browser-nav): 200 empty 0B ct=application/pdf   +1.5 s
attempt 4 (browser):     200 pdf 152480B ct=null           +3.0 s  ✅
```

A bare `curl` from a laptop got the same two 0-byte answers first, then the PDF on every later call. So the failure is **timing, not request shape**: for the first ~2 s after a never-seen VIN is asked for, GM's edge returns `200` + `Content-Type: application/pdf` + zero bytes while the origin renders the sticker. Real PDFs come back with *no* Content-Type at all — the `application/pdf` header on an empty body is the tell. The old client's three attempts fit inside that window (~1.6 s) and reported "no data".

Client now classifies that shape as **`generating`**, waits it out (4 attempts over ~5 s, plus one extra 5 s attempt if every answer was `generating`), and if it still hasn't landed says *"GM is still generating the factory sticker … Ask again in a moment"* — with the inline "ask the manufacturer again" button. Unit tests replay the live capture (3 × generating → PDF) and the give-up path (5 × generating).

## GM sticker — three VINs

All three (`1GNS6NKD5TR434507`, `1GYKPYRKXTZ312313`, `1GNS6MKD2TR280381`) return `released / verified_factory` on dev and on production at the time of retest. The empty-200 failure is intermittent on the app host and could not be reproduced from this machine (bare curl, browser headers, node fetch ×5 — all 150–172 KB PDFs). The profile rotation + longer backoff is the mitigation; per-attempt logs (`[gm-sticker] VIN attempt N (profile): status kind bytes ct magic`) will show which profile the edge accepts when it next happens. Unit tests cover: empty → retry succeeds on the next profile; four empties → typed `empty` error with rotated profiles and the new copy; Akamai denial; network error; unreleased JSON.

## Residuals (documented, not fixed here)
- Open Road Cadillac of Morristown and Freedom Ford (Iselin) have no named contact in the directory — desk resolves, invite needs an adviser address or nearby mode until a staff crawl fills them.
- GM empty-200 cause is on GM's edge; if rotation doesn't hold, the next step is a fetch through the Lightsail box (different egress), which needs a box patch.
