import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergeInventorySnapshot } from '../src/inventory_merge.js';
import { inventoryChangeTypeToPriceChangeType } from '../src/price_diff.js';
import { runEnrichmentPipeline } from '../src/enricher.js';

// ---------------------------------------------------------------------
// Bug 2: inventory_latest.json / national_inventory_latest.json must
// accumulate across brand runs, not overwrite. Root cause (confirmed by
// reading standalone.js's old inline diff loop): a vehicle not seen in
// this run's `currentInventory` was marked SOLD_OR_REMOVED unless its
// dealer was in *this run's own* `failedDealerNames` — but that set is
// only ever populated from this run's own brand's dealer list, so every
// OTHER brand's dealers (never even attempted this run) always failed
// that check and got mislabeled sold. A second run later dropped those
// mislabeled records entirely (the "carry ACTIVE forward" branch requires
// prev.status === 'ACTIVE'). mergeInventorySnapshot fixes this by scoping
// all mutation to dealers in *this run's* `dealers` list.
// ---------------------------------------------------------------------
describe('mergeInventorySnapshot (bug 2: cross-brand accumulation)', () => {
  const todayDate = '2026-09-14';
  const todayIso = '2026-09-14T12:00:00.000Z';

  it('leaves a different brand\'s active inventory completely untouched', () => {
    const previousSnapshot = {
      KIA0000000000001: {
        vin: 'KIA0000000000001',
        make: 'Kia',
        configDealerName: 'Kia of Anywhere',
        status: 'ACTIVE',
        price: 25000,
        firstSeen: '2026-09-01',
      },
    };
    const currentInventory = new Map([
      ['MAZ0000000000001', { vin: 'MAZ0000000000001', make: 'Mazda', configDealerName: 'Mazda of Somewhere', price: 30000 }],
    ]);
    const dealers = [{ name: 'Mazda of Somewhere' }]; // this run is Mazda-only

    const result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory,
      dealers,
      failedDealerNames: new Set(),
      todayDate,
      todayIso,
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });

    // Kia's vehicle: untouched, still ACTIVE, not marked sold.
    assert.deepEqual(result.updatedSnapshot.KIA0000000000001, previousSnapshot.KIA0000000000001);
    assert.ok(!result.soldVehicles.some((v) => v.vin === 'KIA0000000000001'));

    // Mazda's vehicle: present as a fresh new arrival.
    const mazdaRecord = result.updatedSnapshot.MAZ0000000000001;
    assert.ok(mazdaRecord);
    assert.equal(mazdaRecord.status, 'ACTIVE');
    assert.equal(mazdaRecord.changeType, 'NEW_ARRIVAL');

    // Both brands present in the merged output — this is the accumulation
    // the bug report says was missing entirely.
    const vinsInOutput = new Set(result.allRecords.map((r) => r.vin));
    assert.ok(vinsInOutput.has('KIA0000000000001'));
    assert.ok(vinsInOutput.has('MAZ0000000000001'));
  });

  it('marks a genuinely-sold vehicle SOLD_OR_REMOVED only when its own dealer was actually re-crawled this run', () => {
    const previousSnapshot = {
      MAZ1111111111111: {
        vin: 'MAZ1111111111111',
        make: 'Mazda',
        configDealerName: 'Mazda of Somewhere',
        status: 'ACTIVE',
        price: 28000,
        firstSeen: '2026-09-01',
      },
    };
    const currentInventory = new Map(); // this run of Mazda no longer sees that VIN anywhere
    const dealers = [{ name: 'Mazda of Somewhere' }];

    const result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory,
      dealers,
      failedDealerNames: new Set(), // dealer crawl succeeded, vehicle is just gone
      todayDate,
      todayIso,
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });

    assert.equal(result.updatedSnapshot.MAZ1111111111111.status, 'SOLD_OR_REMOVED');
    assert.equal(result.soldVehicles.length, 1);
    assert.equal(result.soldVehicles[0].vin, 'MAZ1111111111111');
  });

  it('carries a vehicle forward unchanged when its dealer failed this run instead of marking it sold', () => {
    const previousSnapshot = {
      MAZ2222222222222: {
        vin: 'MAZ2222222222222',
        configDealerName: 'Mazda of Somewhere',
        status: 'ACTIVE',
        price: 28000,
      },
    };
    const currentInventory = new Map();
    const dealers = [{ name: 'Mazda of Somewhere' }];

    const result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory,
      dealers,
      failedDealerNames: new Set(['Mazda of Somewhere']), // bot-blocked/errored this run
      todayDate,
      todayIso,
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });

    assert.equal(result.updatedSnapshot.MAZ2222222222222.status, 'ACTIVE');
    assert.equal(result.soldVehicles.length, 0);
  });

  it('ages out an already-sold in-scope record on the next run, but never an out-of-scope one', () => {
    const previousSnapshot = {
      // Same brand, already reported sold on an earlier run of this brand.
      MAZ3333333333333: {
        vin: 'MAZ3333333333333',
        configDealerName: 'Mazda of Somewhere',
        status: 'SOLD_OR_REMOVED',
      },
      // A different brand's vehicle that some other (buggy, pre-fix) run
      // already mislabeled sold. Even though its status isn't ACTIVE, it
      // must still be preserved untouched since it's out of this run's scope.
      KIA0000000000002: {
        vin: 'KIA0000000000002',
        configDealerName: 'Kia of Anywhere',
        status: 'SOLD_OR_REMOVED',
        price: 22000,
      },
    };
    const currentInventory = new Map();
    const dealers = [{ name: 'Mazda of Somewhere' }];

    const result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory,
      dealers,
      failedDealerNames: new Set(),
      todayDate,
      todayIso,
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });

    // In-scope + already sold: aged out (dropped), matching the pre-existing
    // single-brand day-over-day pruning behavior.
    assert.equal(result.updatedSnapshot.MAZ3333333333333, undefined);
    // Out-of-scope: preserved byte-for-byte regardless of its status.
    assert.deepEqual(result.updatedSnapshot.KIA0000000000002, previousSnapshot.KIA0000000000002);
  });

  it('simulates three sequential brand runs and confirms nothing vanishes across the whole sequence', () => {
    // Run 1: Kia
    let previousSnapshot = {};
    let run1CurrentInventory = new Map([['KIA1', { vin: 'KIA1', configDealerName: 'Kia Dealer', price: 20000 }]]);
    let result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory: run1CurrentInventory,
      dealers: [{ name: 'Kia Dealer' }],
      failedDealerNames: new Set(),
      todayDate: '2026-09-12',
      todayIso: '2026-09-12T00:00:00.000Z',
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });
    previousSnapshot = result.updatedSnapshot;
    assert.equal(previousSnapshot.KIA1.status, 'ACTIVE');

    // Run 2: Mazda (Kia dealer not re-crawled — different brand entirely)
    let run2CurrentInventory = new Map([['MAZ1', { vin: 'MAZ1', configDealerName: 'Mazda Dealer', price: 30000 }]]);
    result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory: run2CurrentInventory,
      dealers: [{ name: 'Mazda Dealer' }],
      failedDealerNames: new Set(),
      todayDate: '2026-09-13',
      todayIso: '2026-09-13T00:00:00.000Z',
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });
    previousSnapshot = result.updatedSnapshot;
    // Kia must still be ACTIVE — untouched by the Mazda run.
    assert.equal(previousSnapshot.KIA1.status, 'ACTIVE');
    assert.equal(previousSnapshot.MAZ1.status, 'ACTIVE');

    // Run 3: Toyota (yet another brand)
    let run3CurrentInventory = new Map([['TOY1', { vin: 'TOY1', configDealerName: 'Toyota Dealer', price: 35000 }]]);
    result = mergeInventorySnapshot({
      previousSnapshot,
      currentInventory: run3CurrentInventory,
      dealers: [{ name: 'Toyota Dealer' }],
      failedDealerNames: new Set(),
      todayDate: '2026-09-14',
      todayIso: '2026-09-14T00:00:00.000Z',
      toPriceChangeType: inventoryChangeTypeToPriceChangeType,
    });
    previousSnapshot = result.updatedSnapshot;

    // After three brand runs, ALL THREE brands' vehicles must still be
    // present and ACTIVE — this is exactly the "14 brands crawled, only
    // the last 2 survived" bug, reproduced at small scale and shown fixed.
    assert.equal(previousSnapshot.KIA1.status, 'ACTIVE');
    assert.equal(previousSnapshot.MAZ1.status, 'ACTIVE');
    assert.equal(previousSnapshot.TOY1.status, 'ACTIVE');
  });
});

// ---------------------------------------------------------------------
// Bug 1: enrichment must only process the vehicles the current run
// actually has fresh data for (vinsToEnrich), not the whole cumulative
// national_inventory_latest.json. We isolate this in a scratch data/
// directory (enricher.js resolves its paths from process.cwd()) and use
// SKIP_NHTSA_ENRICHMENT=true so this test never hits the real network.
// ---------------------------------------------------------------------
describe('runEnrichmentPipeline (bug 1: scope to this run\'s own VINs)', () => {
  let tmpDir;
  let originalCwd;
  let originalSkipEnv;

  before(async () => {
    originalCwd = process.cwd();
    originalSkipEnv = process.env.SKIP_NHTSA_ENRICHMENT;
    process.env.SKIP_NHTSA_ENRICHMENT = 'true';
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-enricher-test-'));
    await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true });
  });

  after(async () => {
    process.chdir(originalCwd);
    if (originalSkipEnv === undefined) delete process.env.SKIP_NHTSA_ENRICHMENT;
    else process.env.SKIP_NHTSA_ENRICHMENT = originalSkipEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeInventory(vehicles) {
    await fs.writeFile(path.join(tmpDir, 'data', 'national_inventory_latest.json'), JSON.stringify(vehicles, null, 2));
  }
  async function readInventory() {
    const raw = await fs.readFile(path.join(tmpDir, 'data', 'national_inventory_latest.json'), 'utf-8');
    return JSON.parse(raw);
  }

  it('only touches vehicles in vinsToEnrich, leaving the rest of the cumulative file untouched', async () => {
    process.chdir(tmpDir);

    // "Old" vehicle: simulates a vehicle from a brand that ran earlier
    // today and was already enriched. Sentinel fields make it obvious if
    // the pipeline reprocesses it (it would recompute factoryOptions from
    // dealerListedOptions — undefined here — producing [] / 0, and would
    // overwrite nhtsa with null under SKIP_NHTSA_ENRICHMENT).
    const oldVehicle = {
      vin: 'OLD00000000000001',
      make: 'Kia',
      model: 'Sportage',
      nhtsa: { sentinel: true },
      factoryOptions: [{ code: 'SENTINEL', name: 'Should not change', price: 111 }],
      optionCodes: ['SENTINEL'],
      totalOptionsPrice: 999999,
      baseMsrp: 12345,
    };
    // "New" vehicle: this run's own brand, freshly crawled, needs enrichment.
    const newVehicle = {
      vin: 'NEW00000000000001',
      make: 'Mazda',
      model: 'CX-5',
      dealerListedOptions: [{ code: 'OPT-1', name: 'Sunroof', price: 1200 }],
    };

    await writeInventory([oldVehicle, newVehicle]);

    await runEnrichmentPipeline(Infinity, null, null, ['NEW00000000000001']);

    const after1 = await readInventory();
    const oldAfter = after1.find((v) => v.vin === 'OLD00000000000001');
    const newAfter = after1.find((v) => v.vin === 'NEW00000000000001');

    // Old (out-of-scope) vehicle: completely untouched.
    assert.deepEqual(oldAfter.nhtsa, { sentinel: true });
    assert.deepEqual(oldAfter.factoryOptions, [{ code: 'SENTINEL', name: 'Should not change', price: 111 }]);
    assert.equal(oldAfter.totalOptionsPrice, 999999);

    // New (in-scope) vehicle: freshly enriched from its own scraped options.
    assert.equal(newAfter.nhtsa, null); // SKIP_NHTSA_ENRICHMENT path
    assert.deepEqual(newAfter.factoryOptions, [{ code: 'OPT-1', name: 'Sunroof', price: 1200 }]);
    assert.equal(newAfter.totalOptionsPrice, 1200);
  });

  it('still supports the full-backfill CLI use case when vinsToEnrich is omitted', async () => {
    process.chdir(tmpDir);

    const staleVehicle = {
      vin: 'STALE0000000000001',
      make: 'Kia',
      nhtsa: { sentinel: true },
      factoryOptions: [{ code: 'SENTINEL', name: 'stale', price: 1 }],
      totalOptionsPrice: 1,
    };
    await writeInventory([staleVehicle]);

    // No vinsToEnrich passed — should process everything, same as the
    // pre-existing `node src/enricher.js` manual backfill behavior.
    await runEnrichmentPipeline();

    const after2 = await readInventory();
    const staleAfter = after2.find((v) => v.vin === 'STALE0000000000001');
    assert.equal(staleAfter.nhtsa, null); // reprocessed under SKIP_NHTSA_ENRICHMENT
    assert.deepEqual(staleAfter.factoryOptions, []); // recomputed from (absent) dealerListedOptions
  });
});
