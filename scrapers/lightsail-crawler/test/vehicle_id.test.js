// Stable numeric vehicle id: the registry (vehicleId.js) and the resumable backfill (vehicleIdBackfill.js), run against an
// in-memory stand-in for the two tables. The handler wiring is covered in deals_bulk_handler.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVehicleIds, VEHICLE_IDS_DDL, VEHICLE_ID_COLUMN_DDL } from '../src/vehicleId.js';
import { backfillBatch, nextVinsWithoutId, BACKFILL_UPDATE_SQL } from '../src/vehicleIdBackfill.js';

function makeDb(rows = []) {
  const db = {
    ids: new Map(), nextId: 1, // vehicle_ids: vin UNIQUE, AUTO_INCREMENT, rows never deleted
    inv: rows.map(([vin, dealer, id = null]) => ({ vin, dealer, vehicleId: id })),
    calls: [], beforeInsert: null,
  };
  db.pool = {
    async query(sql, params = []) {
      db.calls.push(sql.split(' ').slice(0, 4).join(' '));
      if (/^SELECT vin, vehicle_id FROM vehicle_ids WHERE vin IN/.test(sql)) return [params[0].filter((v) => db.ids.has(v)).map((v) => ({ vin: v, vehicle_id: db.ids.get(v) }))];
      if (/^INSERT IGNORE INTO vehicle_ids \(vin\) VALUES/.test(sql)) {
        if (db.beforeInsert) { db.beforeInsert(); db.beforeInsert = null; } // another writer wins a race between our read and our insert
        let n = 0;
        for (const [v] of params[0]) if (!db.ids.has(v)) { db.ids.set(v, db.nextId++); n++; }
        return [{ affectedRows: n }];
      }
      if (/^SELECT DISTINCT vin FROM dealer_inventory FORCE INDEX \(PRIMARY\) WHERE vin > \? AND vehicle_id IS NULL ORDER BY vin LIMIT \?/.test(sql)) {
        const [after, limit] = params;
        const vins = [...new Set(db.inv.filter((r) => r.vin > after && r.vehicleId == null).map((r) => r.vin))].sort();
        return [vins.slice(0, limit).map((vin) => ({ vin }))];
      }
      if (sql === BACKFILL_UPDATE_SQL) {
        let n = 0;
        for (const r of db.inv) if (params[0].includes(r.vin) && r.vehicleId == null && db.ids.has(r.vin)) { r.vehicleId = db.ids.get(r.vin); n++; }
        return [{ affectedRows: n }];
      }
      throw new Error(`the fake pool does not know this statement: ${sql.slice(0, 80)}`);
    },
  };
  return db;
}
const V = (n) => `1HGBH41JXMN${String(n).padStart(6, '0')}`;

describe('resolveVehicleIds', () => {
  it('registers new VINs with consecutive ids and returns the same id for a VIN every time', async () => {
    const db = makeDb();
    const a = await resolveVehicleIds(db.pool, [V(2), V(1), V(3)]);
    assert.deepEqual([...a.entries()].sort(), [[V(1), 1], [V(2), 2], [V(3), 3]], 'sorted insert order');
    const b = await resolveVehicleIds(db.pool, [V(3), V(1)]);
    assert.equal(b.get(V(1)), 1); assert.equal(b.get(V(3)), 3);
  });

  it('deduplicates the input and inserts nothing when every VIN is already registered', async () => {
    const db = makeDb();
    await resolveVehicleIds(db.pool, [V(1), V(1), V(2)]);
    assert.equal(db.ids.size, 2);
    db.calls.length = 0;
    await resolveVehicleIds(db.pool, [V(1), V(2), V(2)]);
    assert.ok(!db.calls.some((c) => c.startsWith('INSERT')), 'no INSERT for known VINs');
  });

  it('only the missing VINs are inserted, and they get the next ids', async () => {
    const db = makeDb();
    await resolveVehicleIds(db.pool, [V(1), V(2)]);
    const r = await resolveVehicleIds(db.pool, [V(2), V(7), V(1)]);
    assert.equal(r.get(V(7)), 3);
    assert.equal(db.nextId, 4);
  });

  it('a lost race on a new VIN returns the winner\'s id, never a second one', async () => {
    const db = makeDb();
    db.beforeInsert = () => { db.ids.set(V(5), db.nextId++); };
    const r = await resolveVehicleIds(db.pool, [V(5), V(6)]);
    assert.equal(r.get(V(5)), 1, 'the other writer registered it first');
    assert.equal(r.get(V(6)), 2);
    assert.equal(db.ids.size, 2);
  });

  it('handles more VINs than one read chunk', async () => {
    const db = makeDb();
    const vins = Array.from({ length: 1234 }, (_, i) => V(i));
    const r = await resolveVehicleIds(db.pool, vins);
    assert.equal(r.size, 1234);
    assert.equal(new Set(r.values()).size, 1234);
  });

  it('throws if the registry cannot produce an id (never writes a NULL or made-up id)', async () => {
    const pool = { async query(sql) { return /^SELECT/.test(sql) ? [[]] : [{ affectedRows: 0 }]; } };
    await assert.rejects(() => resolveVehicleIds(pool, [V(1)]), /no id for 1 VIN/);
  });

  it('ships a nullable, index-free column and a unique-VIN registry', () => {
    assert.match(VEHICLE_ID_COLUMN_DDL, /ADD COLUMN IF NOT EXISTS vehicle_id INT UNSIGNED NULL$/);
    assert.match(VEHICLE_IDS_DDL, /vehicle_id INT UNSIGNED NOT NULL AUTO_INCREMENT/);
    assert.match(VEHICLE_IDS_DDL, /UNIQUE KEY uq_vehicle_ids_vin \(vin\)/);
  });
});

describe('backfill', () => {
  const rows = () => [[V(1), 1], [V(1), 2], [V(2), 1], [V(3), 4], [V(4), 4], [V(4), 9], [V(5), 3]];
  const runAll = async (db, batch, { stopAfter = Infinity, cursor = '' } = {}) => {
    let n = 0;
    for (;;) {
      if (n++ >= stopAfter) return { cursor, finished: false };
      const r = await backfillBatch(db.pool, cursor, batch);
      cursor = r.nextCursor;
      if (r.done) return { cursor, finished: true };
    }
  };

  it('gives every row of a VIN the same id, whichever store lists it', async () => {
    const db = makeDb(rows());
    await runAll(db, 2);
    const idOf = (vin) => new Set(db.inv.filter((r) => r.vin === vin).map((r) => r.vehicleId));
    for (const n of [1, 2, 3, 4, 5]) assert.equal(idOf(V(n)).size, 1);
    assert.ok(db.inv.every((r) => r.vehicleId != null));
    assert.equal(db.ids.size, 5);
  });

  it('never changes an id a row already has, and uses it for the VIN\'s other rows', async () => {
    const db = makeDb([[V(1), 1, 500], [V(1), 2, null], [V(2), 1, null]]);
    db.ids.set(V(1), 500); db.nextId = 501; // the registry already knows VIN 1 -> 500
    await runAll(db, 10);
    assert.equal(db.inv.find((r) => r.vin === V(1) && r.dealer === 1).vehicleId, 500);
    assert.equal(db.inv.find((r) => r.vin === V(1) && r.dealer === 2).vehicleId, 500);
    assert.equal(db.inv.find((r) => r.vin === V(2)).vehicleId, 501);
  });

  it('is resumable: stopped part-way and restarted (with or without the cursor) it ends exactly like an uninterrupted run', async () => {
    const full = makeDb(rows()); await runAll(full, 2);
    const stopped = makeDb(rows());
    const { cursor, finished } = await runAll(stopped, 2, { stopAfter: 1 });
    assert.equal(finished, false);
    assert.ok(stopped.inv.some((r) => r.vehicleId == null), 'interrupted: work remains');
    const withCursor = makeDb(rows()); Object.assign(withCursor, { ids: new Map(stopped.ids), nextId: stopped.nextId, inv: stopped.inv.map((r) => ({ ...r })) });
    await runAll(withCursor, 2, { cursor });
    await runAll(stopped, 2); // restart from the very beginning
    const snap = (d) => JSON.stringify(d.inv.map((r) => [r.vin, r.dealer, r.vehicleId]));
    assert.equal(snap(stopped), snap(full));
    assert.equal(snap(withCursor), snap(full));
  });

  it('a second full run changes nothing and registers nothing', async () => {
    const db = makeDb(rows()); await runAll(db, 3);
    const before = JSON.stringify([db.inv, [...db.ids]]);
    db.calls.length = 0;
    await runAll(db, 3);
    assert.equal(JSON.stringify([db.inv, [...db.ids]]), before);
    assert.ok(!db.calls.some((c) => c.startsWith('INSERT') || c.startsWith('UPDATE')));
  });

  it('batches stop at the requested size and report the cursor', async () => {
    const db = makeDb(rows());
    const r = await backfillBatch(db.pool, '', 2);
    assert.deepEqual({ vins: r.vins, done: r.done, next: r.nextCursor }, { vins: 2, done: false, next: V(2) });
    assert.equal(r.updated, 3, 'VIN 1 (two rows) and VIN 2 (one row)');
    assert.deepEqual(await nextVinsWithoutId(db.pool, V(2), 10), [V(3), V(4), V(5)]);
  });

  it('with nothing left it reports done and touches nothing', async () => {
    const db = makeDb([[V(1), 1, 7]]);
    const r = await backfillBatch(db.pool, '', 100);
    assert.deepEqual(r, { vins: 0, updated: 0, nextCursor: '', done: true });
  });
});
