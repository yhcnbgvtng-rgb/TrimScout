# Plan: store the priced package lines that are missing today

Status: plan only, no code. Follows the paid-only catalog filter (`OPTIONS_PAID_ONLY`, `docs/OPTIONS_PAID_ONLY_CATALOG_NOTE.md`).

## Problem
A paid-only filter counts only stored option rows with a price above 0. Some cars have a priced package in `dealer_inventory.options_json` but no
matching row in `dealer_inventory_options`, so the filter cannot show them. Cars affected (priced package line, no stored row):

| Make | Cars |
|---|---|
| Nissan | 13,749 |
| Subaru | 4,983 |
| Hyundai | 3,367 |
| Mazda | 1,559 |

(The 2026-10-18 audit put the overall gap at 16% of priced package rows, 139k of 847k, mostly Honda, Nissan, Subaru, Hyundai and Mazda. Honda is out of scope here.)

## Step 0: find out why each row is missing (read-only, before any design choice)
Do not assume one cause. For a sample of about 50 cars per make, per make, classify each priced package line that has no stored row by what dropped it:
1. the global junk rules or `looksLikeNonOptionText` (label looks like a sentence, a fee, a date, a bare number);
2. the model policy for that make (`nissan`/`subaru`/`mazda`/`hyundai` policy files): the line is not in the policy's trim list, or the trim was not trusted and the sync skipped the car;
3. the `zero-price` rule or a price-in-label split (`splitOptionLabel`) that separated the package from its price;
4. the 80-character key or 160-character label cut making two packages collide on one key;
5. a car whose rows were never written (no options payload on the nights it was synced, or retired and revived).
The existing dry-run reports (`scripts/box/2026-10-14-*-option-policy-dry-run.mjs`, `docs/option-catalogs-2026-10-14/POLICY_REPORT_*.md`) already hold part of this; start there, then run the sample on box2 read-only.

## Step 1: decide what a "package line" is, per make
- Write down for each make how packages appear in `options_json` (name, code, price, `kind`). The earlier finding stands: the JSON has no link from a part to its package, so a package's price cannot be pushed down to its parts. The row to store is the package itself, priced.
- Decide the key rule: the stored `canonical_key` for a package should be the policy/allowlist key where one exists, else the normalized label, so the same package on two cars is one filter entry.

## Step 2: fix by cause, smallest change first
- Cause 1 or 3: add the exempt shape to the junk exemption rule (a priced package line is never dropped by the sentence or zero-price rules), with a unit test using the real labels found in step 0.
- Cause 2: add the missing packages to that make's policy file with their prices. Treat the policy file as data, one PR per make, reviewed against the sticker/build-and-price source already used for that make.
- Cause 4: widen the key or keep the label-derived suffix only for colliding packages.
- Cause 5: nothing to fix in code; the nightly sync fills these as cars are re-synced.
Each fix stays behind the existing write path, so the same rules run on the nightly upsert and on the backfill.

## Step 3: repair existing cars
Reuse the idempotent backfill pattern (`scripts/box/2026-09-28-backfill-inventory-options.mjs`: dry run by default, keyset paging, small batches, memory guard), restricted to the affected makes and, better, to the affected VINs found in step 0. Dry run first with per-make counts of rows that would be added, then apply one small make (Mazda, 1,559 cars) with the sync lock held, then Subaru, Hyundai, Nissan. Run the price backfill (`2026-10-19-backfill-option-prices.mjs`) after, or fold it in, so new rows carry their price.

## Step 4: prove it
Re-run the audit query that produced the counts above. Done means: per make, cars with a priced package and no stored row drops to the residue explained in step 0 (for example retired or blank-trim cars), the paid-only catalog for each make lists the packages with their price range, and a facet rebuild shows the expected `vehicle_count` change versus the dry-run prediction.

## Risks and order of operations
- Do not widen the junk rules or the policies for all makes at once; a loose exemption brings back the marketing-sentence rows removed in #333.
- Every apply needs a quiet fleet and the sync lock; nothing in this plan is run until Paul says GO per box step.
- Counts above are the ones supplied for this task; step 0 should re-measure them on box2 first, because the cars can change nightly.
