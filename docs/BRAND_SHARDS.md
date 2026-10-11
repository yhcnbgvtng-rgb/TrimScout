# Per-brand crawl shards (2026-10-11)

**Problem.** TX and FL state shards are ~400 MB each. A brand-run parsed the whole state snapshot, merged into it, and
rewrote the whole state inventory file, so the FL crawl peaked near 3.3 GB against a 3.6 GB heap. The writer was already
compact and streamed (#395); the cost was holding every brand of the state in memory.

**Change.** One file per (state, brand): `data/inventory/<ST>__<brand-slug>.json`, `data/snapshots/<ST>__<brand-slug>.json`,
`data/enriched_cache/<ST>__<brand-slug>.json` (`brandSlug()` in `src/inventory_shards.js`, e.g. `TX__mercedes-benz.json`).
A brand-run now reads, merges and writes only its own brand. Measured on synthetic records: parsed heap is linear in
file size (250k records / 275 MB file -> 474 MB heap; 25k records -> 51 MB), so a run's peak follows the brand's share
of the state instead of the state total.

**Compatibility.**
- `inventory-sync.mjs` reads every `*.json` in `data/inventory`; per-brand names need no sync change. Pretty-printed and compact files both parse (e2e test with a mixed directory).
- The legacy `<ST>.json` is still read. A brand-run copies the legacy records it owns (dealer name in its dealer file, same scoping as `inventory_merge.js`) into its brand shard, then strips them from the legacy file after the brand shard is on disk (file deleted when empty). A VIN is therefore in one file, apart from the moment between the two writes inside the shared-data lock.
- `listShardedStates`, `readAllInventoryShards` (dashboard, export) and the enricher backfill CLI walk both layouts.
- Enricher cache: a brand's first run seeds its cache from the legacy cache, filtered to its VINs. The legacy cache file is left in place (nothing reads it any more).

**Deploy (idle window; no crawl, no sync, do not take the lock from a live run).** Boxes 3 and 4 matter first (TX, FL).
1. Merge, then `git pull` the box checkout. Do not restart anything yet.
2. Confirm idle: no `standalone.js` / `run-daily-crawl` / `inventory-sync.mjs` processes, sync lock free.
3. Back up: `cp -a data/inventory data/inventory.pre-brandshards` and the same for `data/snapshots`.
4. Dry run (reads only, prints per-brand counts): `NODE_OPTIONS=--max-old-space-size=8192 node scripts/split-state-shards-by-brand.mjs --state=TX,FL`
5. Apply: same command with `--apply`. Records of unknown make stay in `<ST>.json`.
6. Check `ls data/inventory`, then `node inventory-sync.mjs data/inventory --dry-run` and compare total vehicle count to before the split.
7. Let the next scheduled run start. Skipping steps 3-6 is safe: brand-runs migrate their own records, but the first run per brand still loads the big legacy file once.

**Rollback.** Stop the runs, `mv data/inventory.pre-brandshards data/inventory` (same for snapshots), `git checkout` the previous commit. Older code ignores `__` files only if they are moved out of `data/inventory`, so remove them first.
