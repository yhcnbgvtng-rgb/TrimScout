# Last-seen staleness rule (code only, flag OFF)

Cars at stores the nightly sweep never reads (403s, dead sites, failed syncs) keep `removed_at IS NULL` forever. We never bypass a 403, so they age out by what we last SAW.

| line | default | effect | write? |
|---|---|---|---|
| show "Last seen" | 3 days (already shipped, #457) | label only | no |
| **hide** | **4 days** (shipped line is 7) | out of buyer search, counts and facets; rows kept | no, query-time (`seenWithinDays`) |
| **retire** | **14 days** | `removed_at` set; a later sighting brings the car back | yes, `--apply` only |

Open RFQ / quote / deal: a car with an open RFQ (collecting/picked), an unexpired un-superseded quote, an invite still invited/quoted, an active deal request or any live deal is never retired (`OPEN_VINS_SQL`). Hiding it from search does not touch the quote, which stores its own vehicle snapshot.

## Switches (all default off)
- Web env `STALE_RULE=1` (optionally `STALE_RULE_HIDE_DAYS`, 2..30): buyer search sends `seenWithinDays=4` instead of 7. Off = unchanged 7.
- Box env `STALE_HIDE_DAYS` (catalog rebuild default, 7) should be set to the same number when the flag goes on.
- `scripts/box/2026-10-16-stale-rule.mjs`: dry run by default, reader account, reports per brand and per box what would be hidden / retired and how many an open quote spares. `--apply` refuses unless `STALE_RULE=1`.

## Deploy gate
Nothing here is deployed. Run the dry run in an idle window (fleet idle, sync lock free), read the numbers, then ask Paul for GO before flipping the web flag; retire is a separate GO.
