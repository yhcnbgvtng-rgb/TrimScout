// deals_api_server.js starts a real server the moment it is imported, so its handlers can't be imported into a
// test. This extracts the REAL source of handleInventoryBulk / selectExistingOptionRows / handleInventorySweep
// (and the INV_* helpers they use) and runs it in a vm context against an in-memory stand-in for the database
// pool — so what is tested is the code that ships, not a copy of it. If someone renames or moves one of these
// functions, extraction fails with a message saying so; update the names here.
//
// The property that matters most: with INVENTORY_OPTIONS_DIFF_WRITE on, the facet table ends up EXACTLY as it
// would with the old rewrite-everything behavior, for any sequence of nights, including when the derivation
// rules change in between.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { optionRowsFromOptions, payloadHasOptions } from '../src/inventoryOptionRows.js';
import { normalizeMakeForWrite } from '../src/stellantisMake.js';
import { buildAllowlist, resolveAllowlisted, EMPTY_ALLOWLIST } from '../src/factoryOptionAllowlist.js';
import { pairKey, diffOptionSets, groupExistingOptionRows } from '../src/inventoryOptionsDiff.js';
import { parseSweepRequest, buildSweepStatement } from '../src/inventorySweep.js';
import { resolveVehicleIds } from '../src/vehicleId.js';
import { guardPrice } from '../src/ingestGuards.js';

const SRC = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
const extractFunction = (name) => {
  const start = SRC.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `could not find "async function ${name}(" in deals_api_server.js — this test runs the real handler source; update it if the function was renamed or moved`);
  const end = SRC.indexOf('\n}\n', start);
  assert.ok(end > start, `could not find the end of ${name}`);
  return SRC.slice(start, end + 3);
};
const extractConst = (name) => {
  const m = SRC.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  assert.ok(m, `could not find "const ${name} = ..." in deals_api_server.js`);
  return m[0];
};

// ---- an in-memory database pool that understands exactly the statements these handlers issue ---------------
function makeDb() {
  const db = {
    inv: new Map(), // `${vin}|${dealer}` -> { dealerId, source, lastSeen, removed, vehicleId }
    ids: new Map(), // vehicle_ids registry: vin -> id (AUTO_INCREMENT, never reused)
    nextId: 1,
    rows: [], // every row sent to the dealer_inventory upsert, as the positional values array
    opts: new Map(), // `${vin}|${dealer}|${key}` -> { vin, dealer_id, canonical_key, label, code }
    days: new Map(),
    clock: 1_000,
    n: { optionDeletes: 0, optionInserts: 0, optionSelects: 0, upserts: 0, sweeps: [], idInserts: 0 },
  };
  const pairsOf = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
  db.pool = {
    async query(sql, params = []) {
      if (/^SELECT vin, vehicle_id FROM vehicle_ids WHERE vin IN/.test(sql)) return [params[0].filter((v) => db.ids.has(v)).map((v) => ({ vin: v, vehicle_id: db.ids.get(v) }))];
      if (/^INSERT IGNORE INTO vehicle_ids \(vin\) VALUES/.test(sql)) {
        let n = 0;
        for (const [v] of params[0]) if (!db.ids.has(v)) { db.ids.set(v, db.nextId++); n++; db.n.idInserts++; }
        return [{ affectedRows: n }];
      }
      if (/^INSERT INTO dealer_inventory \(vin, dealer_id,/.test(sql)) {
        // The statement must list vehicle_id LAST, give every row that many values, and keep an existing id on update.
        const cols = sql.match(/^INSERT INTO dealer_inventory \(([^)]*)\)/)[1].split(',').map((c) => c.trim());
        assert.equal(cols[cols.length - 1], 'vehicle_id', 'vehicle_id is the last column of the upsert');
        assert.match(sql, /vehicle_id = COALESCE\(vehicle_id, VALUES\(vehicle_id\)\)/, 'an update keeps the id already stored');
        for (const v of params[0]) {
          assert.equal(v.length, cols.length, 'every row carries one value per listed column');
          const prev = db.inv.get(`${v[0]}|${v[1]}`);
          db.inv.set(`${v[0]}|${v[1]}`, { dealerId: v[1], source: v[17], lastSeen: db.clock, removed: false, vehicleId: prev?.vehicleId ?? v[v.length - 1] });
        }
        db.n.upserts += params[0].length;
        db.rows.push(...params[0]);
        return [{ affectedRows: params[0].length }];
      }
      if (/^INSERT INTO dealer_inventory_days/.test(sql)) { for (const d of params[0]) db.days.set(`${d[0]}|${d[1]}|${d[2]}`, d); return [{ affectedRows: params[0].length }]; }
      if (/^SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE/.test(sql)) {
        db.n.optionSelects++;
        assert.equal((sql.match(/\(vin = \? AND dealer_id = \?\)/g) || []).length, params.length / 2, 'one PK probe per vehicle');
        assert.doesNotMatch(sql, /\(\s*vin\s*,\s*dealer_id\s*\)\s+IN/i, 'never a row-value IN-list');
        const want = new Set(pairsOf(params).map(([v, d]) => `${v}|${d}`));
        return [[...db.opts.values()].filter((r) => want.has(`${r.vin}|${r.dealer_id}`)).map((r) => ({ ...r }))];
      }
      if (/^DELETE FROM dealer_inventory_options WHERE/.test(sql)) {
        const want = new Set(pairsOf(params).map(([v, d]) => `${v}|${d}`));
        db.n.optionDeletes += want.size;
        let n = 0;
        for (const [k, r] of db.opts) if (want.has(`${r.vin}|${r.dealer_id}`)) { db.opts.delete(k); n++; }
        return [{ affectedRows: n }];
      }
      if (/^INSERT INTO dealer_inventory_options/.test(sql)) {
        db.n.optionInserts += params[0].length;
        for (const [vin, dealer_id, canonical_key, label, code] of params[0]) db.opts.set(`${vin}|${dealer_id}|${canonical_key}`, { vin, dealer_id, canonical_key, label, code });
        return [{ affectedRows: params[0].length }];
      }
      if (/^UPDATE dealer_inventory SET removed_at/.test(sql)) {
        db.n.sweeps.push({ sql, params });
        const batch = /dealer_id IN \(\?\)/.test(sql);
        const ids = new Set(batch ? params[0] : [params[0]]);
        const seenAfter = params[1].getTime();
        const sources = /source IN \(\?\)/.test(sql) ? params[2] : null;
        let n = 0;
        for (const r of db.inv.values()) if (ids.has(r.dealerId) && !r.removed && r.lastSeen < seenAfter && (!sources || sources.includes(r.source))) { r.removed = true; n++; }
        return [{ affectedRows: n }];
      }
      throw new Error(`the fake pool does not know this statement: ${sql.slice(0, 80)}`);
    },
    optionTable: () => JSON.stringify([...db.opts.values()].sort((a, b) => (a.vin + a.dealer_id + a.canonical_key < b.vin + b.dealer_id + b.canonical_key ? -1 : 1))),
  };
  return db;
}

// ---- load the real handlers into a context ------------------------------------------------------------------
function loadHandlers(db) {
  const out = { statuses: [], invalidations: 0, rebuilds: 0, body: null };
  const ctx = {
    getPool: () => db.pool,
    ensureInventoryTable: async () => {},
    readBody: async () => out.body,
    // JSON round trip: objects built inside the vm context have that context's Object.prototype, which strict deepEqual would reject.
    sendJson: (res, status, obj) => { res.status = status; res.json = JSON.parse(JSON.stringify(obj)); },
    badRequest: (res, message) => { res.status = 400; res.json = { error: message }; },
    invInvalidate: () => { out.invalidations++; },
    scheduleCatalogFacetRebuild: () => { out.rebuilds++; },
    normalizeMakeForWrite, optionRowsFromOptions, payloadHasOptions, resolveAllowlisted,
    OPTION_ALLOWLIST: EMPTY_ALLOWLIST,
    OPTIONS_DIFF_WRITE: true,
    pairKey, diffOptionSets, groupExistingOptionRows, parseSweepRequest, buildSweepStatement, resolveVehicleIds, guardPrice,
    performance,
  };
  vm.createContext(ctx);
  const code = [
    ...['INV_STR', 'INV_INT', 'INV_DEALER', 'INV_JSON_STR', 'INV_DATE'].map(extractConst),
    extractFunction('handleInventoryBulk'),
    extractFunction('selectExistingOptionRows'),
    extractFunction('handleInventorySweep'),
  ].join('\n');
  vm.runInContext(code, ctx);
  const call = async (fn, body) => { out.body = body; const res = {}; await ctx[fn]({}, res); return res; };
  return { ctx, out, bulk: (vehicles) => call('handleInventoryBulk', { vehicles }), sweep: (body) => call('handleInventorySweep', body) };
}

const vin = (i) => `1HGBH41JXMN${String(i).padStart(6, '0')}`;
const veh = (i, options, extra = {}) => ({ vin: vin(i), dealerId: (i % 3) + 1, dealerName: `Dealer ${(i % 3) + 1}`, make: 'Toyota', model: 'Camry', source: 'nightly', price: 30000, options, ...extra });
const opt = (name, code = null) => ({ name, code, kind: 'dealer' });
const HEATED = opt('Heated Front Seats', 'OPT-3');
const ROOF = opt('Panoramic Sunroof', 'OPT-9');
const TOW = opt('Trailer Tow Package');
const FEE = opt('$995 Dealer Document Processing Fee');

describe('handleInventoryBulk — options diff-write (the real handler, in-memory pool)', () => {
  it('first night: every set is new, so every vehicle with options is written', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const r = await h.bulk([veh(1, [HEATED, ROOF]), veh(2, [TOW]), veh(3, null)]);
    assert.equal(r.status, 200);
    assert.deepEqual({ up: r.json.upserted, rep: r.json.optionSetsReplaced, unch: r.json.optionSetsUnchanged, kept: r.json.optionSetsKept, rows: r.json.optionRowsWritten }, { up: 3, rep: 2, unch: 0, kept: 1, rows: 3 });
    assert.equal(db.opts.size, 3);
  });

  it('second night with identical payloads: nothing in the facet table is touched', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const vs = [veh(1, [HEATED, ROOF]), veh(2, [TOW]), veh(3, null)];
    await h.bulk(vs);
    const before = db.pool.optionTable();
    db.n.optionDeletes = db.n.optionInserts = 0;
    const r = await h.bulk(vs);
    assert.deepEqual({ rep: r.json.optionSetsReplaced, unch: r.json.optionSetsUnchanged, rows: r.json.optionRowsWritten }, { rep: 0, unch: 2, rows: 0 });
    assert.deepEqual({ d: db.n.optionDeletes, i: db.n.optionInserts }, { d: 0, i: 0 }, 'no DELETE, no INSERT');
    assert.equal(db.pool.optionTable(), before);
    assert.equal(db.n.upserts, 6, 'the main rows are still upserted every night (last_seen_at)');
  });

  it('a vehicle whose options changed is rewritten (and stops matching the option it lost); the rest are left alone', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, [HEATED, ROOF]), veh(2, [TOW]), veh(4, [HEATED])]);
    db.n.optionDeletes = db.n.optionInserts = 0;
    const r = await h.bulk([veh(1, [HEATED]), veh(2, [TOW]), veh(4, [HEATED])]);
    assert.deepEqual({ rep: r.json.optionSetsReplaced, unch: r.json.optionSetsUnchanged }, { rep: 1, unch: 2 });
    assert.deepEqual({ d: db.n.optionDeletes, i: db.n.optionInserts }, { d: 1, i: 1 });
    assert.ok(![...db.opts.values()].some((o) => o.vin === vin(1) && o.canonical_key === 'panoramic sunroof'));
  });

  it('a payload that is only junk clears a vehicle\'s old rows; junk-only twice in a row writes nothing the second time', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, [HEATED])]);
    const r1 = await h.bulk([veh(1, [FEE])]);
    assert.equal(r1.json.optionSetsReplaced, 1);
    assert.equal([...db.opts.values()].filter((o) => o.vin === vin(1)).length, 0);
    db.n.optionDeletes = 0;
    const r2 = await h.bulk([veh(1, [FEE])]);
    assert.deepEqual({ rep: r2.json.optionSetsReplaced, unch: r2.json.optionSetsUnchanged, d: db.n.optionDeletes }, { rep: 0, unch: 1, d: 0 });
  });

  it('a payload with no options at all leaves the stored rows alone (unchanged behavior)', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, [HEATED])]);
    const before = db.pool.optionTable();
    const r = await h.bulk([veh(1, null)]);
    assert.equal(r.json.optionSetsKept, 1);
    assert.equal(db.pool.optionTable(), before);
  });

  it('INVENTORY_OPTIONS_DIFF_WRITE off: every set is deleted and re-inserted, exactly as before', async () => {
    const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTIONS_DIFF_WRITE = false;
    const vs = [veh(1, [HEATED, ROOF]), veh(2, [TOW])];
    await h.bulk(vs);
    db.n.optionDeletes = db.n.optionInserts = db.n.optionSelects = 0;
    const r = await h.bulk(vs);
    assert.deepEqual({ rep: r.json.optionSetsReplaced, unch: r.json.optionSetsUnchanged, d: db.n.optionDeletes, i: db.n.optionInserts, sel: db.n.optionSelects }, { rep: 2, unch: 0, d: 2, i: 3, sel: 0 });
  });

  it('reports where its time went', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const r = await h.bulk([veh(1, [HEATED]), veh(2, null)]);
    const t = r.json.timings;
    for (const k of ['upsertMs', 'optionsMs', 'optionsReadMs', 'daysMs', 'totalMs']) assert.ok(Number.isInteger(t[k]) && t[k] >= 0, k);
    assert.equal(t.chunks, 1);
    assert.ok(t.totalMs >= t.upsertMs);
  });

  it('rejects a body with no vehicles array, and skips rows with a bad VIN or no dealer name, as before', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    assert.equal((await h.bulk(null)).status, 400);
    const r = await h.bulk([veh(1, [HEATED]), { ...veh(2, [TOW]), vin: 'SHORT' }, { ...veh(3, [TOW]), dealerName: '' }]);
    assert.deepEqual({ up: r.json.upserted, skipped: r.json.skipped }, { up: 1, skipped: 2 });
  });

  it('property: over random nights — including a change of derivation rules — the facet table always equals what rewrite-everything produces', async () => {
    let seed = 20261002;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const POOL = [HEATED, ROOF, TOW, FEE, opt('Leather Seats', 'OPT-5'), opt('Sky One-Touch Power Top'), opt('SKY 1-TOUCH PWR TOP'), opt('Black 3-Piece Hard Top')];
    const randomOptions = () => { const r = rnd(); if (r < 0.15) return null; if (r < 0.2) return []; const n = 1 + Math.floor(rnd() * 5); return Array.from({ length: n }, () => POOL[Math.floor(rnd() * POOL.length)]); };
    const worldA = (() => { const db = makeDb(); const h = loadHandlers(db); return { db, h }; })();
    const worldB = (() => { const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTIONS_DIFF_WRITE = false; return { db, h }; })();
    const cars = Array.from({ length: 14 }, (_, i) => ({ i, options: randomOptions() }));
    let writesDiff = 0, writesAll = 0;
    for (let night = 0; night < 40; night++) {
      if (night === 20) { // the derivation rules change (an allowlist arrives)
        const allow = buildAllowlist({ Toyota: { 'Sky One-Touch Power Top': { label: 'Sky One-Touch Power Top', aliases: ['SKY 1-TOUCH PWR TOP'] } } });
        worldA.h.ctx.OPTION_ALLOWLIST = allow; worldB.h.ctx.OPTION_ALLOWLIST = allow;
      }
      for (const c of cars) if (rnd() < 0.25) c.options = randomOptions(); // some vehicles' options change, most don't
      const tonight = cars.filter(() => rnd() < 0.9).map((c) => veh(c.i, c.options));
      worldA.db.n.optionInserts = worldB.db.n.optionInserts = 0;
      await worldA.h.bulk(tonight); await worldB.h.bulk(tonight);
      writesDiff += worldA.db.n.optionInserts; writesAll += worldB.db.n.optionInserts;
      assert.equal(worldA.db.pool.optionTable(), worldB.db.pool.optionTable(), `facet tables diverged on night ${night}`);
    }
    assert.ok(writesDiff < writesAll * 0.6, `diff-write should have written far less (${writesDiff} vs ${writesAll} rows)`);
  });
});

describe('handleInventorySweep — the real handler, in-memory pool', () => {
  const seed = async (h, db) => {
    await h.bulk([veh(1, null), veh(2, null), veh(3, null), veh(4, null), veh(5, null), veh(6, null)]); // stores 2,3,1,2,3,1
    db.clock = 5_000; // the run's cutoff will sit between the two groups
    await h.bulk([veh(1, null), veh(2, null)]); // seen again after the cutoff: stores 2 and 3
  };
  const cutoff = new Date(3_000).toISOString();

  it('single store: unchanged request, unchanged response shape, only that store\'s stale rows retired', async () => {
    const db = makeDb(); const h = loadHandlers(db); await seed(h, db);
    const r = await h.sweep({ dealerId: 1, seenAfter: cutoff, sources: ['nightly'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { removed: 2 }, 'store 1 holds vehicles 3 and 6; neither was seen after the cutoff');
    assert.match(db.n.sweeps[0].sql, /dealer_id = \? AND removed_at IS NULL AND last_seen_at < \? AND source IN \(\?\)$/);
    assert.equal(h.out.invalidations > 0, true);
  });

  it('a batch of stores: one statement, one invalidation, same rows retired as sweeping them one at a time', async () => {
    const batched = makeDb(); const hb = loadHandlers(batched); await seed(hb, batched);
    const invBefore = hb.out.invalidations;
    const r = await hb.sweep({ dealerIds: [1, 2, 3], seenAfter: cutoff, sources: ['nightly'] });
    assert.deepEqual(r.json, { removed: 4, stores: 3 });
    assert.equal(hb.out.invalidations - invBefore, 1);
    assert.equal(batched.n.sweeps.length, 1);

    const single = makeDb(); const hs = loadHandlers(single); await seed(hs, single);
    let total = 0;
    for (const id of [1, 2, 3]) total += (await hs.sweep({ dealerId: id, seenAfter: cutoff, sources: ['nightly'] })).json.removed;
    assert.equal(total, 4);
    assert.deepEqual([...batched.inv.values()].map((x) => x.removed), [...single.inv.values()].map((x) => x.removed));
  });

  it('only rows from the named sources are swept, and rows seen since the cutoff are never touched', async () => {
    const db = makeDb(); const h = loadHandlers(db); await seed(h, db);
    const r = await h.sweep({ dealerIds: [1, 2, 3], seenAfter: cutoff, sources: ['manual'] });
    assert.equal(r.json.removed, 0);
    const kept = await h.sweep({ dealerIds: [1, 2, 3], seenAfter: new Date(1).toISOString(), sources: ['nightly'] });
    assert.equal(kept.json.removed, 0, 'a cutoff before every row retires nothing');
  });

  it('a call that retires nothing does not drop the API caches', async () => {
    const db = makeDb(); const h = loadHandlers(db); await seed(h, db);
    const before = h.out.invalidations;
    await h.sweep({ dealerIds: [1, 2, 3], seenAfter: new Date(1).toISOString() });
    assert.equal(h.out.invalidations, before);
  });

  it('keeps answering what it always answered for bad requests', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    for (const body of [{ seenAfter: cutoff }, { dealerId: 1 }, { dealerId: 1, seenAfter: 'x' }]) {
      const r = await h.sweep(body);
      assert.deepEqual({ s: r.status, e: r.json.error }, { s: 400, e: 'dealerId and seenAfter (ISO) are required' });
    }
    assert.equal((await h.sweep({ dealerIds: [], seenAfter: cutoff })).status, 400);
    assert.equal((await h.sweep({ dealerId: 1, dealerIds: [1], seenAfter: cutoff })).status, 400);
    assert.equal(db.n.sweeps.length, 0);
  });
});

describe('handleInventoryBulk — stable numeric vehicle id (the real handler, in-memory pool)', () => {
  const idOf = (db, i, dealer) => db.inv.get(`${vin(i)}|${dealer ?? (i % 3) + 1}`).vehicleId;

  it('first night: every new VIN gets its own id, in order, and its row carries it', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null), veh(2, null), veh(3, null)]);
    const ids = [1, 2, 3].map((i) => idOf(db, i));
    assert.deepEqual(ids, [1, 2, 3]);
    assert.equal(new Set(ids).size, 3);
    assert.equal(db.n.idInserts, 3);
  });

  it('the same VIN listed by two stores shares ONE id', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null, { dealerId: 7, dealerName: 'Store A' }), veh(1, null, { dealerId: 8, dealerName: 'Store B' }), veh(2, null)]);
    assert.equal(idOf(db, 1, 7), idOf(db, 1, 8));
    assert.notEqual(idOf(db, 1, 7), idOf(db, 2));
    assert.equal(db.ids.size, 2, 'two VINs registered, not three rows');
  });

  it('a later night keeps every id, registers nothing for known VINs, and gives a new VIN the next id', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null), veh(2, null)]);
    const first = [idOf(db, 1), idOf(db, 2)];
    db.n.idInserts = 0;
    await h.bulk([veh(1, null), veh(2, null)]);
    assert.deepEqual([idOf(db, 1), idOf(db, 2)], first);
    assert.equal(db.n.idInserts, 0, 'known VINs never touch the registry again');
    await h.bulk([veh(1, null), veh(2, null), veh(5, null)]);
    assert.equal(idOf(db, 5), 3);
    assert.deepEqual([idOf(db, 1), idOf(db, 2)], first);
  });

  it('a VIN that leaves the crawl and comes back keeps its id; a sold car\'s id is not reused for a new VIN', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null), veh(2, null)]);
    const one = idOf(db, 1);
    await h.bulk([veh(2, null)]);
    await h.bulk([veh(9, null)]);
    assert.equal(idOf(db, 9), 3, 'VIN 1 absent: its id 1 stays taken');
    await h.bulk([veh(1, null)]);
    assert.equal(idOf(db, 1), one);
  });

  it('a row written before ids existed (NULL id) is filled on its next upsert; an id already stored is never changed', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    db.inv.set(`${vin(1)}|2`, { dealerId: 2, source: 'nightly', lastSeen: 1, removed: false, vehicleId: null });
    db.inv.set(`${vin(2)}|3`, { dealerId: 3, source: 'nightly', lastSeen: 1, removed: false, vehicleId: 999 });
    await h.bulk([veh(1, null), veh(2, null)]);
    assert.equal(idOf(db, 1), 1, 'NULL -> registry id');
    assert.equal(idOf(db, 2), 999, 'an existing id survives the update untouched');
  });

  it('a skipped (invalid) row registers no id', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null), { ...veh(2, null), vin: 'SHORT' }, { ...veh(3, null), dealerName: '' }]);
    assert.equal(db.ids.size, 1);
  });
});

describe('handleInventoryBulk — ingest guards (the real handler)', () => {
  const COL = { year: 4, make: 5, price: 12, msrp: 13 };
  const sent = (db, i) => db.rows.find((r) => r[0] === vin(i));

  it('writes null for a ten-times-MSRP price and for a >$300k non-exotic, and reports how many', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const r = await h.bulk([
      veh(1, null, { price: 459_900, msrp: 45_990 }),
      veh(2, null, { price: 450_000, msrp: null }),
      veh(3, null, { price: 24_995, msrp: 26_000 }),
    ]);
    assert.equal(sent(db, 1)[COL.price], null, 'x10 MSRP');
    assert.equal(sent(db, 1)[COL.msrp], 45_990, 'the MSRP itself is untouched');
    assert.equal(sent(db, 2)[COL.price], null, '>$300k Toyota');
    assert.equal(sent(db, 3)[COL.price], 24_995, 'a normal price passes');
    assert.equal(r.json.priceGuarded, 2);
    assert.equal(r.json.upserted, 3, 'the vehicles themselves are still written');
  });

  it('writes the MSRP as null (and KEEPS the price) when the MSRP is the corrupt half of a ~10x pair; keeps a Porsche GT and a supported >$300k price', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const r = await h.bulk([
      veh(1, null, { make: 'Ram', model: '3500', price: 75_170, msrp: 7_514 }),
      veh(2, null, { make: 'Porsche', model: '911', year: 2025, price: 336_000, msrp: 498 }),
      veh(3, null, { make: 'Chevrolet', model: 'Corvette', year: 2025, price: 330_000, msrp: 210_000 }),
      veh(4, null, { make: 'Ford', model: 'Explorer', price: 660_740, msrp: 66_074 }),
    ]);
    assert.deepEqual([sent(db, 1)[COL.price], sent(db, 1)[COL.msrp]], [75_170, null], 'correct price survives, corrupt msrp dropped');
    assert.equal(sent(db, 2)[COL.price], 336_000, 'Porsche GT');
    assert.equal(sent(db, 3)[COL.price], 330_000, 'supported by its MSRP');
    assert.deepEqual([sent(db, 4)[COL.price], sent(db, 4)[COL.msrp]], [null, 66_074], 'broken price dropped, msrp kept');
    assert.equal(r.json.priceGuarded, 2);
  });

  it('keeps an exotic above the ceiling, a pre-1996 classic, and a $2,500 used car', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    const r = await h.bulk([
      veh(1, null, { make: 'Ferrari', model: '296', year: 2024, price: 425_000, msrp: 400_000 }),
      veh(2, null, { make: 'Ford', model: 'Mustang', year: 1965, price: 440_162 }),
      veh(3, null, { year: 2009, price: 2_500 }),
    ]);
    assert.equal(sent(db, 1)[COL.price], 425_000);
    assert.equal(sent(db, 2)[COL.price], 440_162);
    assert.equal(sent(db, 3)[COL.price], 2_500);
    assert.equal(r.json.priceGuarded, 0);
  });

  it('stores LEXUS and Lexus under one make', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([veh(1, null, { make: 'LEXUS' }), veh(2, null, { make: 'Lexus' }), veh(3, null, { make: 'lexus' })]);
    assert.deepEqual([1, 2, 3].map((i) => sent(db, i)[COL.make]), ['Lexus', 'Lexus', 'Lexus']);
  });
});
