# Crawl data files: how they are written and read

The crawler keeps per-state JSON files that grow with the box's whole inventory:

| File | Shape |
|---|---|
| `data/inventory/<ST>.json` | array of vehicle records (this is what `inventory-sync` uploads) |
| `data/snapshots/<ST>.json` | object keyed by VIN |
| `data/enriched_cache/<ST>.json` | object keyed by VIN |
| `data/daily_changes/daily_changes_<date>.json` | object, one slot per state and brand |
| `data/checkpoint_raw_inventory_<state>-<brand>.json` | array, rewritten after every dealer |

## Why this changed

V8 cannot build a string longer than about 512 MB (`RangeError: Invalid string length`). These files were written
with `JSON.stringify(wholeThing, null, 2)` and read with `JSON.parse(await fs.readFile(...))`. Pretty-printing makes a
file two to three times bigger than its data, so a large state (TX, FL, NC ...) could cross the limit and its brand's
run died in the merge/persist step instead of finishing. A kill during `fs.writeFile` also left a truncated file in
place, and the sync reads every `*.json` in `data/inventory`.

## What it does now (`src/bigJson.js`)

* **Write** (`writeJsonLarge`): walks the top-level array/object and writes one element at a time, compact, one
  element per line, to `<file>.tmp-<pid>-<ts>`, `fsync`s, then renames over the target. The largest string built is one
  record plus a ~1 MB buffer. The rename is atomic: a reader or a killed process sees the old complete file or the new
  complete file, never a partial one. The temp name does not end in `.json`, so the sync never picks it up.
* **Read** (`readJsonLarge`): files up to 64 MB take the old path (`JSON.parse` of the text, identical result).
  Larger files are split into top-level elements and parsed one at a time, so no string bigger than one element exists.
  Truncated or corrupt files still throw, so existing `try/catch` fallbacks behave as before.

## Migration

None required. The top-level shape is unchanged (array of records / object keyed by VIN), and both the old
pretty-printed layout and the new compact layout are read by the same code. Each file converts to the compact layout
the next time the crawl writes it.

`scripts/box/inventory-sync.mjs` is unchanged. Its `streamTopLevelObjects` walks the top-level objects of the array and
does not care about whitespace; `test/bigJson.test.js` runs the real function from that script against the new layout.

## Deploying

The boxes run the crawler from `scrapers/lightsail-crawler/src`, so `src/bigJson.js` must be present beside
`standalone.js`, `enricher.js` and `inventory_shards.js` (a normal `git pull` of this branch carries it). Do not deploy
while a crawl is running: a running `standalone.js` has already loaded the old code, and a half-updated tree would not
import. A killed crawl can leave `*.tmp-*` files next to a shard; they are safe to delete and are never read.

## Not changed here

* `src/backfill_*.mjs`, `src/reverify_standard_build.mjs` and `src/finder_crawler.js` still read/write whole files with
  `JSON.stringify`/`JSON.parse`. They are one-off scripts, not part of the nightly crawl.
* `inventory-sync.mjs` decodes each 1 MB read chunk on its own, so a multi-byte character that straddles a chunk
  boundary is replaced by U+FFFD. That predates this change and is unaffected by it.
