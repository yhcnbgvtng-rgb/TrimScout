#!/usr/bin/env node
// One-off reconciliation for daily_changes files split across Eastern
// midnight by the bug fixed in src/date_utils.js#resolveRunDate() (see
// that function's comment, and standalone.js's todayDate): before that
// fix, a brand subprocess starting after Eastern midnight computed its
// own date independently of the driver's canonical one, filing its
// state/brand slot into a freshly-created daily_changes_<next-date>.json
// instead of merging into the run's real daily_changes_<date>.json.
//
// This script merges the misfiled state/brand slots from one file (the
// "wrong", later-dated file the split ones actually landed in) back into
// the other (the "right" file — the driver's canonical date for that
// run) using the exact same merge logic (daily_changes.js's
// mergeDailyChangesDocument) standalone.js itself uses, so the merged
// result is structurally identical to what a single correctly-dated run
// would have produced. Each moved brand slot's own internal `date` /
// `priceChanges[].date` fields (originally stamped with the wrong file's
// date) are corrected to the canonical date so nothing inside the merged
// file disagrees with the file's own top-level `date`.
//
// This does NOT touch national_inventory_latest.json, inventory_latest
// .json, snapshots/latest_snapshot.json, or firstSeen/lastSeen/soldDate
// on any vehicle record — the bug this reconciles only ever affected
// daily_changes bucketing, never the inventory snapshot itself (see the
// task notes: "no inventory data was lost").
//
// Usage (run from scrapers/lightsail-crawler/, against the box's actual
// data/ directory — this repo's own data/ is just the committed
// baseline):
//   node scripts/reconcile-split-daily-changes.mjs --into=2026-09-15 --from=2026-09-16
//   node scripts/reconcile-split-daily-changes.mjs --into=2026-09-15 --from=2026-09-16 --write
//
// Dry-run by default (prints what would move, changes nothing on disk).
// Pass --write to actually merge into <into>'s file. Never deletes the
// <from> file itself — after a --write run, confirm the merged <into>
// file looks right, then remove/archive <from> by hand.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDailyChangesDocument } from '../src/daily_changes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHANGES_DIR = path.join(ROOT, 'data', 'daily_changes');

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const intoDate = arg('into');
const fromDate = arg('from');
const write = process.argv.includes('--write');

if (!intoDate || !fromDate) {
  console.error('Usage: node scripts/reconcile-split-daily-changes.mjs --into=YYYY-MM-DD --from=YYYY-MM-DD [--write]');
  process.exit(1);
}
if (intoDate === fromDate) {
  console.error('--into and --from must be different dates.');
  process.exit(1);
}

async function readDoc(date) {
  try {
    return JSON.parse(await fs.readFile(path.join(CHANGES_DIR, `daily_changes_${date}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

const intoDoc = await readDoc(intoDate);
const fromDoc = await readDoc(fromDate);

if (!fromDoc) {
  console.log(`No daily_changes_${fromDate}.json found — nothing to reconcile.`);
  process.exit(0);
}

let merged = intoDoc && intoDoc.date === intoDate ? { ...intoDoc, states: { ...intoDoc.states } } : { date: intoDate, states: {} };

let movedCount = 0;
for (const [state, stateEntry] of Object.entries(fromDoc.states || {})) {
  for (const [brand, brandRecord] of Object.entries(stateEntry.brands || {})) {
    movedCount++;
    console.log(`  moving ${state}/${brand} from ${fromDate} -> ${intoDate}${intoDoc?.states?.[state]?.brands?.[brand] ? ' (REPLACES an existing slot already in the target file — check this is really the same run before using --write)' : ''}`);

    // Correct the internal date stamps so nothing inside the merged
    // record disagrees with the file it now lives in.
    const correctedRecord = {
      ...brandRecord,
      date: intoDate,
      priceChanges: (brandRecord.priceChanges || []).map((c) => ({ ...c, date: intoDate })),
    };

    merged = mergeDailyChangesDocument({
      existing: merged,
      state,
      brand,
      brandRecord: correctedRecord,
      todayDate: intoDate,
      todayIso: fromDoc.generatedAt || new Date().toISOString(),
    });
  }
}

if (movedCount === 0) {
  console.log(`daily_changes_${fromDate}.json has no state/brand slots — nothing to reconcile.`);
  process.exit(0);
}

console.log(`\n${movedCount} state/brand slot(s) would move from daily_changes_${fromDate}.json into daily_changes_${intoDate}.json.`);

if (!write) {
  console.log('Dry run only — nothing written. Re-run with --write to apply.');
  process.exit(0);
}

const outPath = path.join(CHANGES_DIR, `daily_changes_${intoDate}.json`);
await fs.writeFile(outPath, JSON.stringify(merged, null, 2));
console.log(`Wrote merged file: ${outPath}`);
console.log(`daily_changes_${fromDate}.json was left untouched — remove/archive it by hand once you've confirmed the merge looks right.`);
