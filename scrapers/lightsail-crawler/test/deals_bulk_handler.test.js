// deals_api_server.js starts a real server the moment it is imported, so its handlers can't be imported into a
// test. This extracts the REAL source of handleInventoryBulk / selectExistingOptionRows / handleInventorySweep
// (and the INV_* helpers they use) and runs it in a vm context against an in-memory stand-in for the database
// pool — so what is tested is the code that ships, not a copy of it. If someone renames or moves one of these
// functions, extraction fails with a message saying so; update the names here.
//
// The property that matters most: with INVENTORY_OPTIONS_DIFF_WRITE on, the facet table ends up EXACTLY as it
// would with the old rewrite-everything behavior, for any sequence of nights, including when the derivation
// rules change in between.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { optionRowsFromOptions, payloadHasOptions } from '../src/inventoryOptionRows.js';
import { normalizeMakeForWrite } from '../src/stellantisMake.js';
import { normalizeModelForWrite, prepareMazdaVehicle } from '../src/mazdaPaidOptions.js';
import { buildAllowlist, resolveAllowlisted, EMPTY_ALLOWLIST, loadBundledModelPoliciesRaw, policyFacetRows, policyApiOptions } from '../src/factoryOptionAllowlist.js';
import { pairKey, diffOptionSets, groupExistingOptionRows } from '../src/inventoryOptionsDiff.js';
import { cleanOptionsForWrite, staleExactJunkKeys, keepPaidStoredRows } from '../src/syncOptionClean.js';
import { installJunkRulesFromEnv } from '../src/factoryOptionAllowlist.js';
import { setJunkRules } from '../src/inventoryOptionRows.js';
import { parseSweepRequest, buildSweepStatement } from '../src/inventorySweep.js';
import { resolveVehicleIds } from '../src/vehicleId.js';
import { guardPrice } from '../src/ingestGuards.js';
import { normalizeTransmission } from '../src/transmission.js';
import { normalizeState } from '../src/invState.js';

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
    json: new Map(), // `${vin}|${dealer}` -> the options_json text the upsert carried
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
          db.inv.set(`${v[0]}|${v[1]}`, { dealerId: v[1], source: v[17], lastSeen: db.clock, removed: false, vehicleId: prev?.vehicleId ?? v[v.length - 1], state: v[v.length - 2] });
        }
        for (const v of params[0]) db.json.set(`${v[0]}|${v[1]}`, v[cols.indexOf('options_json')]);
        db.n.upserts += params[0].length;
        db.rows.push(...params[0]);
        return [{ affectedRows: params[0].length }];
      }
      if (/^INSERT INTO dealer_inventory_days/.test(sql)) { for (const d of params[0]) db.days.set(`${d[0]}|${d[1]}|${d[2]}`, d); return [{ affectedRows: params[0].length }]; }
      if (/^SELECT vin, dealer_id, canonical_key, label, code FROM dealer_inventory_options WHERE/.test(sql)) {
        db.n.optionSelects++;
        assert.ok(params.length > 0, 'never an empty WHERE (a chunk whose every vehicle is skipped has nothing to look up; MariaDB rejects `WHERE ` with no condition)');
        assert.equal((sql.match(/\(vin = \? AND dealer_id = \?\)/g) || []).length, params.length / 2, 'one PK probe per vehicle');
        assert.doesNotMatch(sql, /\(\s*vin\s*,\s*dealer_id\s*\)\s+IN/i, 'never a row-value IN-list');
        const want = new Set(pairsOf(params).map(([v, d]) => `${v}|${d}`));
        return [[...db.opts.values()].filter((r) => want.has(`${r.vin}|${r.dealer_id}`)).map((r) => ({ ...r }))];
      }
      if (/^DELETE FROM dealer_inventory_options WHERE \(vin = \? AND dealer_id = \? AND canonical_key = \?\)/.test(sql)) { // exact-junk purge: full primary key
        let n = 0;
        for (let i = 0; i < params.length; i += 3) if (db.opts.delete(`${params[i]}|${params[i + 1]}|${params[i + 2]}`)) n++;
        db.n.optionDeletes += n; db.n.keyDeletes = (db.n.keyDeletes || 0) + n;
        return [{ affectedRows: n }];
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
    normalizeMakeForWrite, normalizeModelForWrite, prepareMazdaVehicle, optionRowsFromOptions, payloadHasOptions, resolveAllowlisted, policyFacetRows,
    cleanOptionsForWrite, staleExactJunkKeys, keepPaidStoredRows, OPTIONS_JSON_CLEAN: 'junk',
    OPTION_ALLOWLIST: EMPTY_ALLOWLIST,
    OPTIONS_DIFF_WRITE: true, PAID_ONLY: false,
    pairKey, diffOptionSets, groupExistingOptionRows, parseSweepRequest, buildSweepStatement, resolveVehicleIds, guardPrice, normalizeTransmission, normalizeState,
    performance,
  };
  vm.createContext(ctx);
  const code = [
    ...['INV_STR', 'INV_INT', 'INV_DEALER', 'INV_JSON_STR', 'INV_DATE'].map(extractConst),
    extractFunction('handleInventoryBulk'),
    extractFunction('selectExistingOptionRows'),
    extractFunction('purgeExactJunkRows'),
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

// ---- model option policies in the write path and in the /api/inventory options list --------------------------------------
// The live car that prompted this: 2026 RAV4 XSE JTM6CRAV3TD314853 carried 11 dealer lines, of which only the Weather Package is a factory option.
const POLICY = buildAllowlist(null, loadBundledModelPoliciesRaw());
const RAV4_VIN = 'JTM6CRAV3TD314853';
const RAV4_LINES = [
  ['PKG-37', 'Weather Package', 375], ['OPT-54', 'Heated Leather Steering Wheel', 0], ['OPT-75', 'Rain Sensing Windshield Wipers', 0], ['OPT-41', 'Windshield De-Icer', 0],
  ['OPT-20', 'Illuminated Front Emblem', 330], ['OPT-60', 'Mudguards', 160], ['OPT-44', 'Rear Bumper Protector', 130], ['OPT-8', 'All Weather Floor Liner and Cargo Tray', 339],
  ['OPT-50', 'Illuminated Door Sills', 395], ['OPT-23', 'Multimedia Glass Screen Protector', 105], ['OPT-13', 'Rear Hatch Cargo Lamps', 425],
].map(([code, name, price]) => ({ code, name, price, kind: 'dealer' }));
const rav4 = (extra = {}) => ({ vin: RAV4_VIN, dealerId: 1614, dealerName: 'Dealer 1614', make: 'Toyota', model: 'RAV4', year: 2026, trim: 'XSE', source: 'nightly', price: 38000, options: RAV4_LINES, ...extra });
const labelsIn = (db) => [...db.opts.values()].map((r) => r.label).sort();

describe('model option policies — nightly sync write path (the real handler, in-memory pool)', () => {
  it('JTM6CRAV3TD314853 (2026 RAV4 XSE): 11 options before, only the Weather Package is written with the policy loaded', async () => {
    const generic = makeDb(); const g = loadHandlers(generic);
    await g.bulk([rav4()]);
    assert.equal(generic.opts.size, 11, 'without a policy the generic rules keep all 11 lines (the "before")');
    const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTION_ALLOWLIST = POLICY;
    const r = await h.bulk([rav4()]);
    assert.deepEqual(labelsIn(db), ['Weather Package']);
    assert.equal(r.json.optionRowsWritten, 1);
  });

  it('a re-synced car converges: generic rows already in the table are replaced by the policy rows, then the next night writes nothing', async () => {
    const db = makeDb(); const h = loadHandlers(db);
    await h.bulk([rav4()]);
    assert.equal(db.opts.size, 11);
    h.ctx.OPTION_ALLOWLIST = POLICY; // the deploy
    await h.bulk([rav4()]);
    assert.deepEqual(labelsIn(db), ['Weather Package']);
    db.n.optionDeletes = db.n.optionInserts = 0;
    const r = await h.bulk([rav4()]);
    assert.deepEqual({ d: db.n.optionDeletes, i: db.n.optionInserts, unch: r.json.optionSetsUnchanged }, { d: 0, i: 0, unch: 1 });
  });

  it('a chunk whose every vehicle is skipped (untrusted trim) is a normal 200: nothing is looked up, nothing is written, the stored rows stay', async () => {
    const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTION_ALLOWLIST = POLICY;
    const rav4 = (extra = {}) => ({ vin: '4T1DAACK0TU000002', dealerId: 7, dealerName: 'Dealer 7', make: 'Toyota', model: 'RAV4', year: 2026, trim: 'XSE', source: 'nightly', price: 40000, options: [{ name: 'Weather Package' }], ...extra });
    assert.equal((await h.bulk([rav4()])).status, 200);
    const before = db.pool.optionTable();
    const r = await h.bulk([rav4({ trim: 'Totally Unknown Trim' }), rav4({ vin: '4T1DAACK0TU000003', trim: 'Another Unknown Trim' })]);
    assert.equal(r.status, 200);
    assert.deepEqual({ rep: r.json.optionSetsReplaced, rows: r.json.optionRowsWritten }, { rep: 0, rows: 0 });
    assert.equal(db.pool.optionTable(), before);
  });

  it('a payload with a blank trim says nothing about the stored trim (the upsert COALESCEs it): the stored policy rows are left alone', async () => {
    const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTION_ALLOWLIST = POLICY;
    await h.bulk([rav4()]);
    const before = db.pool.optionTable();
    const r = await h.bulk([rav4({ trim: null }), rav4({ vin: '4T1DAACK0TU000001', trim: '' })]);
    assert.equal(db.pool.optionTable(), before);
    assert.equal(r.json.optionSetsReplaced, 0);
  });

  it('a trim the policy does not trust gets no options (rule 6); other years and models of the same make stay on the generic rules', async () => {
    const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTION_ALLOWLIST = POLICY;
    await h.bulk([rav4({ vin: '4T1DAACK0TU000002', trim: 'Mystery Trim' }), veh(1, [HEATED, ROOF]), rav4({ vin: '2T3W1RFV0PW000003', year: 2023 })]);
    const mine = (v) => [...db.opts.values()].filter((r) => r.vin === v).length;
    assert.equal(mine('4T1DAACK0TU000002'), 0);
    assert.equal(mine(vin(1)), 2, 'a 2020s Camry with no year in the payload is not policy-covered: generic rows');
    assert.equal(mine('2T3W1RFV0PW000003'), 11, '2023 RAV4: no policy for that year');
  });

  it('a make with no policy is byte-for-byte what it was, with or without the policy loaded', async () => {
    const cars = [veh(1, [HEATED, ROOF], { make: 'Honda', model: 'Civic', year: 2026, trim: 'Sport' }), veh(2, [TOW, FEE], { make: 'Volkswagen', model: 'Tiguan', year: 2026, trim: 'SE' })];
    const a = makeDb(); await loadHandlers(a).bulk(cars);
    const b = makeDb(); const hb = loadHandlers(b); hb.ctx.OPTION_ALLOWLIST = POLICY; await hb.bulk(cars);
    assert.equal(b.pool.optionTable(), a.pool.optionTable());
  });
});

describe('model option policies — the per-vehicle options list in /api/inventory', () => {
  const veh2026 = { make: 'Toyota', model: 'RAV4', year: 2026, trim: 'XSE' };

  it('JTM6CRAV3TD314853: the 11-line list becomes just the Weather Package, with the policy price and kind', () => {
    const out = policyApiOptions(POLICY, veh2026, RAV4_LINES);
    assert.equal(RAV4_LINES.length, 11);
    assert.deepEqual(out.map((o) => o.name), ['Weather Package']);
    assert.equal(out[0].code, 'PKG-37');
    assert.ok(out[0].price > 0 && typeof out[0].kind === 'string');
  });

  it('the list equals the facet rows for the same car (what filters and facets see), for every line combination of the RAV4', () => {
    for (const lines of [RAV4_LINES, RAV4_LINES.slice(0, 3), RAV4_LINES.slice(3), [RAV4_LINES[0]]]) {
      const facet = policyFacetRows(POLICY, { ...veh2026 }, lines).rows.map((r) => r.label).sort();
      assert.deepEqual(policyApiOptions(POLICY, veh2026, lines).map((o) => o.name).sort(), facet);
    }
  });

  it('a make or year with no policy gets the very same array back; null / empty / unparseable stay as they are', () => {
    const honda = [{ code: 'X', name: 'Heated Seats', price: 0, kind: 'dealer' }];
    assert.equal(policyApiOptions(POLICY, { make: 'Honda', model: 'Civic', year: 2026, trim: 'Sport' }, honda), honda);
    assert.equal(policyApiOptions(POLICY, { ...veh2026, year: 2023 }, RAV4_LINES), RAV4_LINES);
    assert.equal(policyApiOptions(POLICY, veh2026, null), null);
    assert.deepEqual(policyApiOptions(POLICY, veh2026, []), []);
    assert.equal(policyApiOptions(EMPTY_ALLOWLIST, veh2026, RAV4_LINES), RAV4_LINES, 'no policy loaded (the env var unset) = nothing changes');
  });

  it('Ford is covered the same way (2026 F-150 XLT keeps its paid equipment group, drops the dealer lines)', () => {
    const lines = [{ name: 'XLT Mid (302A)', code: '302A' }, { name: 'Pinstripe Kit' }, { name: 'Window Tint' }];
    const out = policyApiOptions(POLICY, { make: 'Ford', model: 'F-150', year: 2026, trim: 'XLT' }, lines);
    assert.ok(out.length === 1 && /302A|XLT Mid/i.test(out[0].name), JSON.stringify(out));
  });

  it('inventoryRowFromDb routes options_json through policyApiOptions (source check: the function is not extractable, the server starts on import)', () => {
    const m = SRC.match(/function inventoryRowFromDb\(r\) \{[\s\S]*?\n\}\n/);
    assert.ok(m && /options: policyApiOptions\(OPTION_ALLOWLIST, \{ make: r\.make, model: r\.model, year: r\.year, trim: r\.trim \}, INV_JSON\(r\.options_json\)\)/.test(m[0]));
  });
});

// ---- the sync cleans what it writes: policies + junk list for options_json too, exact-junk rows purged on cars the policy cannot read ----
describe('nightly sync — option clean at write (the real handler, in-memory pool)', () => {
  const FORD = { make: 'Ford', model: 'F-150', year: 2026, trim: 'XLT' };
  const fordVin = (n) => `1FTFW1E50NFA${String(n).padStart(5, '0')}`;
  const fordCar = (n, extra = {}) => ({ vin: fordVin(n), dealerId: 40 + n, dealerName: `Dealer ${40 + n}`, ...FORD, source: 'nightly', price: 55000, ...extra });
  const BLACK = { code: 'X1', name: 'XLT Black Appearance Package', price: 920, kind: 'package' };
  const JUNK = ['OPTION PACKAGES', 'Exp', 'Title', 'Creators', 'Artists', '09/30/2026'].map((name) => ({ name }));
  const stored = (db, vinText) => [...db.opts.values()].filter((r) => r.vin === vinText).map((r) => r.label).sort();
  const seed = (db, v, dealerId, labels) => { for (const l of labels) db.opts.set(`${v}|${dealerId}|${l.toLowerCase()}`, { vin: v, dealer_id: dealerId, canonical_key: l.toLowerCase(), label: l, code: null }); };
  const jsonOf = (db, car) => JSON.parse(db.json.get(`${car.vin}|${car.dealerId}`));
  const setup = () => { const db = makeDb(); const h = loadHandlers(db); h.ctx.OPTION_ALLOWLIST = POLICY; return { db, h }; };
  before(() => installJunkRulesFromEnv({}, { warn() {} }));
  after(() => setJunkRules(null));

  it('a trusted covered car (default junk mode): the stored rows are the policy result; options_json keeps the payload minus junk lines (so a later policy change can be re-derived)', async () => {
    const { db, h } = setup();
    const car = fordCar(1, { options: [BLACK, ...JUNK, { name: 'Roadside Assistance' }, { name: 'Cruise Control' }] });
    await h.bulk([car]);
    assert.deepEqual(jsonOf(db, car).map((o) => o.name), ['XLT Black Appearance Package', 'Cruise Control']);
    assert.deepEqual(stored(db, car.vin), ['XLT Black Appearance Package']);
  });

  it('OPTIONS_JSON_CLEAN=full: a trusted covered car\'s options_json is the policy result', async () => {
    const { db, h } = setup(); h.ctx.OPTIONS_JSON_CLEAN = 'full';
    const car = fordCar(8, { options: [BLACK, ...JUNK, { name: 'Cruise Control' }] });
    await h.bulk([car]);
    assert.deepEqual(jsonOf(db, car), [BLACK]);
    assert.deepEqual(stored(db, car.vin), ['XLT Black Appearance Package']);
  });

  it('a covered car with a BLANK trim: exact-junk rows are purged, every other stored row stays, options_json loses only the exact-junk lines', async () => {
    const { db, h } = setup();
    const car = fordCar(2, { trim: '', options: [BLACK, ...JUNK, { name: 'Cruise Control' }] });
    seed(db, car.vin, car.dealerId, ['OPTION PACKAGES', 'Exp', 'Creators', '09/30/2026', 'Cruise Control', 'XLT Black Appearance Package']);
    const r = await h.bulk([car]);
    assert.deepEqual(stored(db, car.vin), ['Cruise Control', 'XLT Black Appearance Package']);
    assert.equal(r.json.optionExactJunkPurged, 4);
    assert.deepEqual(jsonOf(db, car).map((o) => o.name), ['XLT Black Appearance Package', 'Cruise Control']);
  });

  it('a covered car with an UNTRUSTED trim: same — only exact junk goes', async () => {
    const { db, h } = setup();
    const car = fordCar(3, { trim: 'Mystery Trim', options: [...JUNK, { name: 'Cruise Control' }] });
    seed(db, car.vin, car.dealerId, ['Title', 'Artists', 'Heated Seats']);
    const r = await h.bulk([car]);
    assert.deepEqual(stored(db, car.vin), ['Heated Seats']);
    assert.equal(r.json.optionExactJunkPurged, 2);
    assert.deepEqual(jsonOf(db, car).map((o) => o.name), ['Cruise Control']);
  });

  it('a skipped car with no exact-junk rows is not written to at all (no delete, no insert)', async () => {
    const { db, h } = setup();
    const car = fordCar(4, { trim: '', options: [{ name: 'Cruise Control' }] });
    seed(db, car.vin, car.dealerId, ['Heated Seats']);
    db.n.optionDeletes = db.n.optionInserts = 0;
    const r = await h.bulk([car]);
    assert.deepEqual({ d: db.n.optionDeletes, i: db.n.optionInserts, purged: r.json.optionExactJunkPurged }, { d: 0, i: 0, purged: 0 });
    assert.deepEqual(stored(db, car.vin), ['Heated Seats']);
  });

  it('a car no policy covers: junk-list and exact-junk lines are not stored in the rows or in options_json', async () => {
    const { db, h } = setup();
    const car = { vin: '3VV2B7AX5NM000001', dealerId: 9, dealerName: 'Dealer 9', make: 'Volkswagen', model: 'Tiguan', year: 2026, trim: 'SE', source: 'nightly', price: 30000, options: [{ name: 'Panoramic Sunroof' }, { name: 'Roadside Assistance' }, ...JUNK] };
    await h.bulk([car]);
    assert.deepEqual(stored(db, car.vin), ['Panoramic Sunroof']);
    assert.deepEqual(jsonOf(db, car).map((o) => o.name), ['Panoramic Sunroof']);
  });

  it('a paid sticker line stored for the car\'s own trim survives a night whose payload no longer lists it; the next night writes nothing', async () => {
    const { db, h } = setup();
    const car = fordCar(5, { options: [BLACK] });
    await h.bulk([car]);
    const later = { ...car, options: [{ name: 'Cruise Control' }] }; // the feed dropped the paid line (and has nothing the policy keeps)
    const r = await h.bulk([later]);
    assert.deepEqual(stored(db, car.vin), ['XLT Black Appearance Package']);
    db.n.optionDeletes = db.n.optionInserts = 0;
    await h.bulk([later]);
    assert.deepEqual({ d: db.n.optionDeletes, i: db.n.optionInserts }, { d: 0, i: 0 });
    assert.ok(r.json.optionSetsUnchanged + r.json.optionSetsReplaced >= 1);
  });

  it('OPTIONS_JSON_CLEAN=off stores options_json as sent (the rows are still cleaned)', async () => {
    const { db, h } = setup(); h.ctx.OPTIONS_JSON_CLEAN = 'off';
    const car = fordCar(6, { options: [BLACK, ...JUNK] });
    await h.bulk([car]);
    assert.deepEqual(jsonOf(db, car).map((o) => o.name), [BLACK.name, ...JUNK.map((o) => o.name)]);
    assert.deepEqual(stored(db, car.vin), ['XLT Black Appearance Package']);
  });

  it('a payload with no options leaves options_json null (the upsert keeps the stored value) and touches no rows', async () => {
    const { db, h } = setup();
    const car = fordCar(7, { options: null });
    seed(db, car.vin, car.dealerId, ['OPTION PACKAGES']);
    await h.bulk([car]);
    assert.equal(db.json.get(`${car.vin}|${car.dealerId}`), null);
    assert.deepEqual(stored(db, car.vin), ['OPTION PACKAGES']);
  });
});
