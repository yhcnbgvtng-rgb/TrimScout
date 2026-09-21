#!/usr/bin/env node
// Fixture for test/concurrency_race.test.js's real-child-process race test.
//
// Deliberately mirrors the exact shape of standalone.js's own locked
// merge-and-write section (fresh read -> mergeInventorySnapshot -> write),
// using the SAME production modules (shared_data_lock.js, inventory_merge.js)
// standalone.js itself uses — this is not a toy reimplementation of the
// lock or the merge, it's a minimal harness around the real ones, spawned
// as a genuinely separate OS process the same way run-daily-crawl.mjs's
// runStep() spawns one brand's real standalone.js.
//
// Args (all required): --data-dir --vin --dealer --delay-ms
// --data-dir's parent is used as process.cwd() equivalent for path
// resolution (shared_data_lock.js resolves 'data/shared_data.lock' off
// process.cwd(), so this script chdirs there first).
import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeInventorySnapshot } from '../../src/inventory_merge.js';
import { withSharedDataLock } from '../../src/shared_data_lock.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const cwd = path.resolve(args['data-dir'], '..');
process.chdir(cwd);

const snapshotPath = path.join(cwd, 'data', 'snapshots', 'latest_snapshot.json');
const vin = args.vin;
const dealerName = args.dealer;
const delayMs = Number(args['delay-ms'] || 0);
// Optional: skip the lock entirely, to reproduce the pre-fix race for real
// across real processes too (used by the "without the lock" control case).
const useLock = args['no-lock'] !== 'true';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doWork() {
  let previousSnapshot = {};
  try {
    previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
  } catch {
    previousSnapshot = {};
  }

  // Widen the window between this process's read and its write so the
  // other concurrently-spawned process's own read/write has room to land
  // in between — exactly the multi-hour real-world gap (crawling happens
  // between standalone.js's own early read and its later merge+write),
  // compressed down to milliseconds for a fast test.
  await sleep(delayMs);

  const { updatedSnapshot } = mergeInventorySnapshot({
    previousSnapshot,
    currentInventory: new Map([[vin, { vin, configDealerName: dealerName, price: 10000 }]]),
    dealers: [{ name: dealerName }],
    failedDealerNames: new Set(),
    todayDate: '2026-09-15',
    todayIso: '2026-09-15T00:00:00.000Z',
    toPriceChangeType: (t) => t,
  });

  await fs.writeFile(snapshotPath, JSON.stringify(updatedSnapshot, null, 2));
}

// scope is a fixed, shared value (not per-dealer/state) deliberately: this
// fixture's whole point is proving the lock primitive serializes access to
// ONE shared file across real concurrent processes — see
// concurrency_race.test.js's header comment. Production callers scope by
// state (or by date, for daily_changes) instead; that per-scope isolation
// is covered separately in shared_data_lock.test.js.
if (useLock) {
  await withSharedDataLock(doWork, { cwd, scope: 'concurrency-test', label: `fixture:${dealerName}`, retryDelayMs: 20 });
} else {
  await doWork();
}
