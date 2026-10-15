// scripts/box/2026-10-15-{pick-test-cars-nissan,pick-test-cars-armada,armada-propilot-test,restore-armada-test-car}.mjs: the helpers used for the 2026-10-15 box2 deploy
// tests (#525 + the ProPILOT rule). Pins what keeps them safe: the pickers and the test read with the reader account only, the test posts only to /api/inventory/bulk,
// and the one script that writes (the restore) touches a single named car inside a transaction.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const read = (f) => fs.readFileSync(path.join(repo, 'scripts/box', f), 'utf8');
const code = (s) => s.replace(/\/\/.*$/gm, '');

describe('box2 deploy test helpers (2026-10-15)', () => {
  it('the Nissan and Armada pickers are reader-only and Nissan-only (no writer account, no sync lock, no writes)', () => {
    for (const f of ['2026-10-15-pick-test-cars-nissan.mjs', '2026-10-15-pick-test-cars-armada.mjs']) {
      const s = read(f);
      assert.ok(s.includes("make = 'Nissan'") && s.includes('DB_READER_USER'), f);
      assert.doesNotMatch(code(s), /DB_WRITER|sync-lock|INSERT INTO|DELETE FROM|UPDATE |mazda/i, f);
    }
    assert.ok(read('2026-10-15-pick-test-cars-armada.mjs').includes("model LIKE 'Armada%'"));
  });
  it('the ProPILOT test posts only to /api/inventory/bulk, reads back with the reader account and never writes to the database itself', () => {
    const s = read('2026-10-15-armada-propilot-test.mjs');
    assert.ok(s.includes('/api/inventory/bulk') && s.includes('DB_READER_USER') && s.includes('ProPILOT Assist 2.1 Package'));
    assert.doesNotMatch(code(s), /DB_WRITER|INSERT INTO|DELETE FROM|UPDATE /);
  });
  it('the restore script writes one named car (vin + dealer_id) in a single transaction and nothing else', () => {
    const s = read('2026-10-15-restore-armada-test-car.mjs');
    assert.ok(s.includes('beginTransaction()') && s.includes('commit()'));
    const writes = code(s).match(/(UPDATE dealer_inventory\b|DELETE FROM dealer_inventory_options|INSERT INTO dealer_inventory_options)[^"`]*/g) || [];
    assert.equal(writes.length, 3);
    for (const w of writes.slice(0, 2)) assert.match(w, /WHERE vin=\? AND dealer_id=\?/);
    assert.doesNotMatch(code(s), /pm2|sudo|DROP |TRUNCATE|sync-lock/);
  });
});
