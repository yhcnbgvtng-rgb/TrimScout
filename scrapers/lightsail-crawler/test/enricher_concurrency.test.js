import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergeEnrichedRecordsIntoInventory } from '../src/enricher.js';
import { withSharedDataLock } from '../src/shared_data_lock.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// enricher.js's runEnrichmentPipeline has the exact same read-modify-write
// shape as standalone.js's inventory merge (see concurrency_race.test.js),
// just discovered while reading the actual code rather than assumed from
// the task description: it reads national_inventory_latest.json /
// enriched_cache.json ONCE at pipeline start, does slow sequential NHTSA
// network lookups for potentially hours, then writes the WHOLE array/cache
// back at the end. With two states' enrichment passes able to run at once
// now, that's the same lost-update shape — just with a much longer real-
// world gap between read and write (network-bound, not just crawl-bound).
// This proves mergeEnrichedRecordsIntoInventory + the shared lock fixes it,
// using the same "unlocked control loses data, locked fix doesn't" method.
// ---------------------------------------------------------------------
describe('concurrency race: two states\' enrichment passes patching the shared inventory file at once', () => {
  let tmpDir;
  let inventoryPath;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-enrich-race-'));
    await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true });
    inventoryPath = path.join(tmpDir, 'data', 'national_inventory_latest.json');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const baseline = [
    { vin: 'NJ_MAZ_1', make: 'Mazda', model: 'CX-5', dealerListedOptions: [] },
    { vin: 'GA_MAZ_1', make: 'Mazda', model: 'CX-9', dealerListedOptions: [] },
  ];

  // Mirrors enricher.js's own persist step: read the shared inventory file
  // fresh, wait (standing in for the real network-bound NHTSA lookups that
  // happen between enricher.js's initial read and its final write), patch
  // in only this run's own enriched VIN via the real production
  // mergeEnrichedRecordsIntoInventory(), write back.
  async function simulateEnrichmentFinalize({ vin, patch, delayMs, useLock, lockOpts }) {
    async function doWork() {
      let freshInventory = [];
      try {
        freshInventory = JSON.parse(await fs.readFile(inventoryPath, 'utf-8'));
      } catch {
        freshInventory = [];
      }

      await sleep(delayMs);

      const enrichedByVin = new Map([[vin, patch]]);
      const merged = mergeEnrichedRecordsIntoInventory({ freshInventory, enrichedByVin, brand: null });
      await fs.writeFile(inventoryPath, JSON.stringify(merged, null, 2));
    }

    if (useLock) {
      await withSharedDataLock(doWork, lockOpts);
    } else {
      await doWork();
    }
  }

  it('CONTROL (no lock): one state\'s enrichment result is lost when both finish around the same time', async () => {
    await fs.writeFile(inventoryPath, JSON.stringify(baseline, null, 2));

    await Promise.all([
      simulateEnrichmentFinalize({
        vin: 'NJ_MAZ_1',
        patch: { nhtsa: { plantCountry: 'USA' }, enrichedAt: '2026-09-15T00:00:00.000Z' },
        delayMs: 80,
        useLock: false,
      }),
      simulateEnrichmentFinalize({
        vin: 'GA_MAZ_1',
        patch: { nhtsa: { plantCountry: 'Japan' }, enrichedAt: '2026-09-15T00:00:01.000Z' },
        delayMs: 10,
        useLock: false,
      }),
    ]);

    const final = JSON.parse(await fs.readFile(inventoryPath, 'utf-8'));
    const nj = final.find((v) => v.vin === 'NJ_MAZ_1');
    const ga = final.find((v) => v.vin === 'GA_MAZ_1');
    const bothEnriched = Boolean(nj?.nhtsa) && Boolean(ga?.nhtsa);
    assert.equal(bothEnriched, false, 'expected the unlocked enrichment finalize to lose one state\'s NHTSA data');
    // Confirms the specific shape: GA's own vehicle record is even still
    // present (mergeEnrichedRecordsIntoInventory never drops vehicles, it
    // just doesn't have GA's fresh nhtsa patch applied — the record itself
    // reverts to whatever NJ's own stale read of the file looked like).
    assert.ok(ga, 'GA_MAZ_1 the vehicle record should still exist even though its enrichment was lost');
    assert.equal(ga.nhtsa, undefined);
  });

  it('FIX (with the lock): both states\' enrichment results survive', async () => {
    await fs.writeFile(inventoryPath, JSON.stringify(baseline, null, 2));
    const lockPath = path.join(tmpDir, 'data', 'shared_data.lock');

    await Promise.all([
      simulateEnrichmentFinalize({
        vin: 'NJ_MAZ_1',
        patch: { nhtsa: { plantCountry: 'USA' }, enrichedAt: '2026-09-15T00:00:00.000Z' },
        delayMs: 80,
        useLock: true,
        lockOpts: { lockPath, pid: process.pid, label: 'NJ/Mazda-enrich', retryDelayMs: 15, maxWaitMs: 5000 },
      }),
      simulateEnrichmentFinalize({
        vin: 'GA_MAZ_1',
        patch: { nhtsa: { plantCountry: 'Japan' }, enrichedAt: '2026-09-15T00:00:01.000Z' },
        delayMs: 10,
        useLock: true,
        lockOpts: { lockPath, pid: process.pid, label: 'GA/Mazda-enrich', retryDelayMs: 15, maxWaitMs: 5000 },
      }),
    ]);

    const final = JSON.parse(await fs.readFile(inventoryPath, 'utf-8'));
    const nj = final.find((v) => v.vin === 'NJ_MAZ_1');
    const ga = final.find((v) => v.vin === 'GA_MAZ_1');
    assert.equal(nj.nhtsa.plantCountry, 'USA');
    assert.equal(ga.nhtsa.plantCountry, 'Japan');
    // Shape-backfill still applied to both, matching pre-existing behavior.
    assert.deepEqual(nj.factoryOptions, []);
    assert.deepEqual(ga.factoryOptions, []);
  });
});
