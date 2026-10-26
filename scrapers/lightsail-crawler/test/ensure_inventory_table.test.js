// ensureInventoryTable (deals_api_server.js) runs the table / index / trigger DDL once per process. Found on box2 on 2026-10-14: the FIRST requests after a
// restart can arrive together (a test upsert and live site traffic), each ran the whole sequence, and the DROP TRIGGER / CREATE TRIGGER of one interleaved with the
// other's, so one request got HTTP 500 "Trigger 'trimscout.trg_inv_rev_insert' already exists". The real source is extracted and run against a pool that behaves
// like MariaDB for triggers (CREATE TRIGGER on an existing name fails), with every statement yielding to the event loop so concurrent callers really interleave.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
const extractFunction = (name, { optional = false } = {}) => {
  const start = SRC.indexOf(`async function ${name}(`);
  if (start < 0) { assert.ok(optional, `could not find "async function ${name}(" in deals_api_server.js`); return ''; }
  const end = SRC.indexOf('\n}\n', start);
  assert.ok(end > start, `could not find the end of ${name}`);
  return SRC.slice(start, end + 3);
};

function makePool({ failOn = null } = {}) {
  const pool = {
    statements: [], triggers: new Set(), failedOnce: false,
    async query(sql) {
      pool.statements.push(sql);
      await new Promise((r) => setImmediate(r)); // let other callers run between statements, as real I/O does
      if (failOn && !pool.failedOnce && failOn.test(sql)) { pool.failedOnce = true; throw new Error('simulated connection loss'); }
      let m;
      if ((m = /^\s*DROP TRIGGER IF EXISTS (\w+)/i.exec(sql))) pool.triggers.delete(m[1]);
      else if ((m = /^\s*CREATE OR REPLACE TRIGGER (\w+)/i.exec(sql))) pool.triggers.add(m[1]);
      else if ((m = /^\s*CREATE TRIGGER (\w+)/i.exec(sql))) {
        if (pool.triggers.has(m[1])) throw new Error(`Trigger 'trimscout.${m[1]}' already exists`);
        pool.triggers.add(m[1]);
      }
      if (/SELECT COUNT\(\*\) AS n FROM information_schema\.KEY_COLUMN_USAGE/.test(sql)) return [[{ n: 2 }], []]; // the composite (vin, dealer_id) primary key already exists
      return [[], []];
    },
  };
  return pool;
}

function load(paidOnly = false, facetExtras = false) {
  const ctx = { PAID_ONLY: paidOnly, FACET_EXTRAS: facetExtras, BLOCKED_TABLE_DDL: 'CREATE TABLE IF NOT EXISTS blocked_stores (id INT)', VEHICLE_IDS_DDL: 'CREATE TABLE IF NOT EXISTS vehicle_ids (vin CHAR(17))', VEHICLE_ID_COLUMN_DDL: 'ALTER TABLE dealer_inventory ADD COLUMN IF NOT EXISTS vehicle_id INT UNSIGNED NULL', console };
  vm.createContext(ctx);
  vm.runInContext(['let inventoryReady = false;', 'let inventoryReadyPromise = null;', extractFunction('ensureInventoryTable'), extractFunction('ensureInventoryTableOnce', { optional: true }),
    'globalThis.ensureInventoryTable = ensureInventoryTable;', 'globalThis.isReady = () => inventoryReady;'].join('\n'), ctx);
  return ctx;
}
const count = (pool, re) => pool.statements.filter((s) => re.test(s)).length;

describe('ensureInventoryTable', () => {
  it('OPTIONS_PAID_ONLY off: no price column is added anywhere', async () => {
    const ctx = load(false), pool = makePool();
    await ctx.ensureInventoryTable(pool);
    assert.equal(count(pool, /min_price|max_price|dealer_inventory_options ADD COLUMN/), 0);
  });

  it('OPTIONS_PAID_ONLY on: the nullable price columns are added once (IF NOT EXISTS)', async () => {
    const ctx = load(true), pool = makePool();
    await ctx.ensureInventoryTable(pool);
    await ctx.ensureInventoryTable(pool);
    assert.equal(count(pool, /ALTER TABLE dealer_inventory_options ADD COLUMN IF NOT EXISTS price INT NULL/), 1);
    assert.equal(count(pool, /ALTER TABLE inv_option_facets ADD COLUMN IF NOT EXISTS min_price INT NULL, ADD COLUMN IF NOT EXISTS max_price INT NULL/), 1);
    assert.equal(count(pool, /ALTER TABLE inv_option_summary ADD COLUMN IF NOT EXISTS min_price INT NULL/), 1);
  });

  it('FACET_COND_PRICE off: no price-facet table or meta column is created', async () => {
    const ctx = load(false, false), pool = makePool();
    await ctx.ensureInventoryTable(pool);
    assert.equal(count(pool, /inv_price_facets|inv_price_summary|extra_ms/), 0);
  });

  it('FACET_COND_PRICE on: the price-facet tables and the two meta columns are created once (IF NOT EXISTS)', async () => {
    const ctx = load(false, true), pool = makePool();
    await ctx.ensureInventoryTable(pool);
    await ctx.ensureInventoryTable(pool);
    assert.equal(count(pool, /CREATE TABLE IF NOT EXISTS inv_price_facets/), 1);
    assert.equal(count(pool, /CREATE TABLE IF NOT EXISTS inv_price_summary/), 1);
    assert.equal(count(pool, /ALTER TABLE inv_facet_meta ADD COLUMN IF NOT EXISTS extra_ms INT NULL, ADD COLUMN IF NOT EXISTS extra_skipped INT NULL/), 1);
  });

  it('concurrent first requests do not collide: all resolve, the DDL runs once, each trigger is created once', async () => {
    const ctx = load(), pool = makePool();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => ctx.ensureInventoryTable(pool)));
    assert.deepEqual(results.map((r) => r.status), Array(6).fill('fulfilled'), JSON.stringify(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason))));
    assert.equal(count(pool, /CREATE TABLE IF NOT EXISTS dealer_inventory\b/), 1);
    assert.equal(count(pool, /CREATE (OR REPLACE )?TRIGGER trg_inv_rev_insert/i), 1);
    assert.equal(count(pool, /CREATE (OR REPLACE )?TRIGGER trg_inv_rev_update/i), 1);
    assert.deepEqual([...pool.triggers].sort(), ['trg_inv_rev_insert', 'trg_inv_rev_update']);
    assert.equal(ctx.isReady(), true);
  });

  it('once ready, later calls issue no statements at all', async () => {
    const ctx = load(), pool = makePool();
    await ctx.ensureInventoryTable(pool);
    const n = pool.statements.length;
    await Promise.all([ctx.ensureInventoryTable(pool), ctx.ensureInventoryTable(pool)]);
    assert.equal(pool.statements.length, n);
  });

  it('a failed first run rejects its waiters but does not wedge the process: the next call retries from scratch and succeeds', async () => {
    const ctx = load(), pool = makePool({ failOn: /ALTER TABLE dealer_inventory/ });
    const first = await Promise.allSettled([ctx.ensureInventoryTable(pool), ctx.ensureInventoryTable(pool), ctx.ensureInventoryTable(pool)]);
    assert.ok(first.every((r) => r.status === 'rejected'), 'every waiter of the failed run sees the failure');
    assert.equal(ctx.isReady(), false);
    await ctx.ensureInventoryTable(pool); // the simulated fault is one-shot
    assert.equal(ctx.isReady(), true);
    assert.deepEqual([...pool.triggers].sort(), ['trg_inv_rev_insert', 'trg_inv_rev_update']);
  });

  it('the trigger bodies are replaced in one statement (no DROP then CREATE window where a write would skip the *_rev / vdp_url_norm columns)', () => {
    assert.match(extractFunction('ensureInventoryTableOnce'), /CREATE OR REPLACE TRIGGER trg_inv_rev_\$\{when\.toLowerCase\(\)\}/);
    assert.doesNotMatch(extractFunction('ensureInventoryTableOnce'), /DROP TRIGGER/);
  });
});
