# Ford trim fill from the VIN (box2 script, not run)

`scripts/box/2026-10-27-ford-trim-vin-fill.mjs` fills blank and unreadable Ford trims on the nine profiled models (F-150, Super Duty, Ranger, Maverick, Bronco, Explorer, Escape, Expedition, Mustang) from the VIN. It complements `2026-10-27-ford-trim-normalize.mjs`, which only rewrites text it can read; run that one first.

- **Rule:** key = VIN positions 5-7 + position 10, per model. Learned from CLEAN rows only (trim already exactly an official trim). A key is trusted when >= 5 clean rows carry it and >= 95% agree on one trim. Anything else is left as is.
- **Targets:** blank, NULL, and unreadable trims (`Preferred`, `8 FOOT BED`, engine text). Never a clean trim; never a row the text normalizer can read.
- **`trim_raw`** gets the original text (a blank original stays NULL; an existing `trim_raw` is kept). The script never alters the table: `trim_raw` must already exist.
- **Run (box2, `/opt/trimscout-deals`, needs `src/fordTrim.js`):** `node 2026-10-27-ford-trim-vin-fill.mjs` is a dry run (counts per model only). `--apply --fleet-idle --limit=N` fills under the sync lock; `--limit` is required and a hard cap. Every batch is written to `ford-trim-vin-fill-<ts>.rollback.jsonl` before its UPDATE; `--rollback=FILE [--apply --fleet-idle]` restores.
- **Status:** code only. Not run, not deployed, no dry-run numbers yet.
