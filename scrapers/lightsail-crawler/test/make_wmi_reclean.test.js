// Make-vs-VIN dry run (scripts/box/2026-10-24-make-wmi-reclean.mjs): the pure grouping rule, and the dryrun / lookup / selftest phases run as the emitted
// stdin bundle against an in-memory fake of mysql2. The script has no write path: the fake rejects anything that is not a SELECT.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { classifyGroup, summarizeGroups, summarizeBlank } from '../../../scripts/lib/makeWmiReclean.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('classifyGroup / summarizeGroups', () => {
  it('names the make a contradicted prefix would get, and keeps agreeing prefixes', () => {
    assert.deepEqual(classifyGroup({ make: 'GMC', key: '2B3LJ', model: 'Challenger' }), { next: 'Dodge', via: 'wmi-conflict' });
    assert.deepEqual(classifyGroup({ make: 'GMC', key: '1GKB0', model: 'Yukon' }), { next: 'GMC', via: 'kept' });
    assert.deepEqual(classifyGroup({ make: 'GMC', key: 'XZZCJ', model: 'X' }), { next: 'GMC', via: 'kept' }); // unknown WMI: never touched
    assert.deepEqual(classifyGroup({ make: 'Ford', key: 'JN8AZ', model: 'QX80' }), { next: null, via: 'conflict-unresolved' }); // shared WMI, needs vPIC
  });
  it('counts by target make, keeps no VIN, caps the group list', () => {
    const s = summarizeGroups('GMC', [
      { model: 'Challenger', key: '2B3LJ', n: 3 }, { model: 'Impreza', key: '4S3GT', n: 2 }, { model: 'Encore', key: 'KL4CJ', n: 1 },
      { model: 'Sierra 1500', key: '1GTU9', n: 40 }, { model: 'QX80', key: 'JN8AZ', n: 1 },
    ], { top: 2 });
    assert.equal(s.rowsChecked, 47); assert.equal(s.rowsAgree, 40); assert.equal(s.rowsConflict, 7); assert.equal(s.rowsToMake, 6); assert.equal(s.rowsToNull, 1);
    assert.deepEqual(s.byTarget, { Dodge: 3, Subaru: 2, Buick: 1, '(null: shared WMI)': 1 });
    assert.equal(s.conflictGroups.length, 2); assert.equal(s.conflictGroups[0].key, '2B3LJ');
    assert.ok(!/[A-HJ-NPR-Z0-9]{17}/.test(JSON.stringify(s)));
  });
  it('blank makes are reported as fills, not disagreements', () => {
    const b = summarizeBlank([{ key: 'JHMGK', n: 4 }, { key: 'XZZCJ', n: 2 }]);
    assert.deepEqual(b, { rowsChecked: 6, rowsFilledFromVin: 4, rowsStayBlank: 2, byTarget: { Honda: 4 } });
  });
});

const FAKE_MYSQL = String.raw`
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.env.FAKE_DB_FILE, 'utf8')).rows;
const ci = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function run(sqlIn, params) {
  const sql = sqlIn.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '').replace(/\s+/g, ' ').trim();
  fs.appendFileSync(process.env.FAKE_LOG, sql + '\n');
  if (!/^SELECT /.test(sql)) throw new Error('fake mysql: the make-vs-VIN script may only SELECT: ' + sql);
  if (/^SELECT make FROM dealer_inventory FORCE INDEX \(idx_inv_make_model\) WHERE make > \? ORDER BY make LIMIT 1$/.test(sql)) { const v = [...new Set(rows.map((r) => r.make).filter(Boolean))].sort().filter((x) => x.toLowerCase() > params[0].toLowerCase()); return v.length ? [{ make: v[0] }] : []; }
  if (/^SELECT model FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model > \? ORDER BY model LIMIT 1$/.test(sql)) { const v = [...new Set(rows.filter((r) => ci(r.make, params[0])).map((r) => r.model))].sort().filter((x) => x.toLowerCase() > params[1].toLowerCase()); return v.length ? [{ model: v[0] }] : []; }
  if (/^SELECT LEFT\(vin, 5\) AS k, COUNT\(\*\) AS n FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model = \? GROUP BY LEFT\(vin, 5\)$/.test(sql)) { const g = new Map(); for (const r of rows.filter((r) => ci(r.make, params[0]) && ci(r.model, params[1]))) g.set(r.vin.slice(0, 5), (g.get(r.vin.slice(0, 5)) || 0) + 1); return [...g].map(([k, n]) => ({ k, n })); }
  if (/^SELECT LEFT\(vin, 5\) AS k, COUNT\(\*\) AS n FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make (IS NULL|= '') GROUP BY LEFT\(vin, 5\)$/.test(sql)) { const isNull = /IS NULL/.test(sql); const g = new Map(); for (const r of rows.filter((r) => (isNull ? r.make === null : r.make === ''))) g.set(r.vin.slice(0, 5), (g.get(r.vin.slice(0, 5)) || 0) + 1); return [...g].map(([k, n]) => ({ k, n })); }
  if (/^SELECT dealer_name, COUNT\(\*\) AS n FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model = \? AND vin LIKE \? GROUP BY dealer_name$/.test(sql)) { const g = new Map(); for (const r of rows.filter((r) => ci(r.make, params[0]) && ci(r.model, params[1]) && r.vin.startsWith(params[2].replace('%', '')))) g.set(r.dealer_name, (g.get(r.dealer_name) || 0) + 1); return [...g].map(([dealer_name, n]) => ({ dealer_name, n })); }
  if (/^SELECT vin, dealer_id, dealer_name, make, model, year, source, vdp_url, removed_at FROM dealer_inventory WHERE vin IN \(/.test(sql)) return rows.filter((r) => params.includes(r.vin));
  throw new Error('fake mysql: unexpected SQL: ' + sql);
}
class Conn { async query(sql, params) { return [run(sql, params || [])]; } release() {} }
module.exports = { createPool: (o) => { fs.appendFileSync(process.env.FAKE_LOG, 'POOL user=' + o.user + '\n'); return { getConnection: async () => new Conn(), end: async () => {} }; } };
module.exports.default = module.exports;
`;

const V = { challenger: '2B3LJ54T19H594202', impreza: '4S3GTAV69P3713237', corsair: '5LMCJ1DH0NUL16894', fit: 'JHMGK5H76HS000056', encore: 'KL4CJCSB4JB582999', yukon: '1GKB0RDC6RU100924', terrain: '3GKALTEV5LL187300', buick: '5GAEVAKW9RJ101917', cadillac: '1G6DF5RK5T0107960' };
const row = (vin, make, model, dealer, id = 1) => ({ vin, dealer_id: id, dealer_name: dealer, make, model, year: 2020, source: 'crawl', vdp_url: `https://www.${dealer.replace(/\W/g, '').toLowerCase()}.example/used/${vin}`, removed_at: null });
const ROWS = [
  row(V.challenger, 'GMC', 'Challenger', 'Roster Buick GMC', 1), row(V.impreza, 'GMC', 'Impreza', 'Roster Buick GMC', 1), row(V.corsair, 'GMC', 'Corsair', 'Other Auto Group', 2),
  row(V.fit, 'GMC', 'Fit', 'Roster Buick GMC', 1), row(V.encore, 'GMC', 'Encore', 'Other Auto Group', 2),
  row(V.yukon, 'GMC', 'Yukon', 'Roster Buick GMC', 1), row(V.terrain, 'GMC', 'Terrain', 'Other Auto Group', 2),
  row(V.buick, 'Buick', 'Enclave', 'Roster Buick GMC', 1), row(V.cadillac, 'Cadillac', 'CT5', 'Cadillac Of Somewhere', 3),
  row('JHMGK5H76HS000099', null, 'Fit', 'Blank Make Motors', 4), row('XZZGK5H76HS000099', '', 'Fit', 'Blank Make Motors', 4),
];

let bundle = null;
try { await import('esbuild'); bundle = execFileSync('node', [path.join(repo, 'scripts/box/2026-10-24-make-wmi-reclean.mjs'), '--emit'], { maxBuffer: 64 << 20 }); } catch {}
const skip = !bundle && 'esbuild is not installed here';

describe('make-vs-VIN dry run (emitted bundle, fake DB)', () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mwr-'));
    fs.mkdirSync(path.join(dir, 'node_modules/mysql2'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/mysql2/package.json'), JSON.stringify({ name: 'mysql2', version: '0.0.0', exports: { './promise': './promise.js' } }));
    fs.writeFileSync(path.join(dir, 'node_modules/mysql2/promise.js'), FAKE_MYSQL);
    const db = path.join(dir, 'db.json'); fs.writeFileSync(db, JSON.stringify({ rows: ROWS }));
    fs.writeFileSync(path.join(dir, 'env'), 'DB_READER_USER=reader\nDB_READER_PASSWORD=r\nDB_WRITER_USER=writer\nDB_WRITER_PASSWORD=w\n');
    fs.writeFileSync(path.join(dir, 'lock.log'), '[sync-lock] 2026-10-24T00:00:00Z release by x\n');
    const env = { ...process.env, FAKE_DB_FILE: db, FAKE_LOG: path.join(dir, 'sql.log') };
    const run = (...a) => new Promise((resolve) => { const c = execFile('node', ['--input-type=module', '-', `--env=${path.join(dir, 'env')}`, `--lock-log=${path.join(dir, 'lock.log')}`, ...a], { cwd: dir, env, maxBuffer: 64 << 20 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })); c.stdin.end(bundle); });
    return { dir, run, sql: () => (fs.existsSync(path.join(dir, 'sql.log')) ? fs.readFileSync(path.join(dir, 'sql.log'), 'utf8') : ''), lockLog: path.join(dir, 'lock.log') };
  }

  it('dryrun: counts the contradicted GMC rows by target make and names the dealers; reader only, SELECT only, no VIN printed', { skip }, async () => {
    const t = setup();
    const r = await t.run('--phase=dryrun', '--pause-ms=0');
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.wrote, 'nothing'); assert.equal(out.complete, true);
    const gmc = out.perMake.find((m) => m.make === 'GMC');
    assert.equal(gmc.rowsChecked, 7); assert.equal(gmc.rowsAgree, 2); assert.equal(gmc.rowsConflict, 5);
    assert.deepEqual(gmc.byTarget, { Dodge: 1, Subaru: 1, Lincoln: 1, Honda: 1, Buick: 1 });
    assert.deepEqual(gmc.dealersOfLargestConflictGroups, [{ dealer: 'Roster Buick GMC', rows: 3 }, { dealer: 'Other Auto Group', rows: 2 }]);
    assert.deepEqual(out.makesWithNothingToDo.sort(), ['Buick', 'Cadillac']);
    assert.deepEqual(out.blankMake, { rowsChecked: 2, rowsFilledFromVin: 1, rowsStayBlank: 1, byTarget: { Honda: 1 } });
    assert.ok(!/[A-HJ-NPR-Z0-9]{17}/.test(r.stdout), 'no whole VIN in the output');
    assert.ok(t.sql().includes('POOL user=reader') && !t.sql().includes('user=writer'));
    const selects = t.sql().split('\n').filter((l) => l.startsWith('SELECT'));
    assert.ok(selects.length > 5 && selects.every((l) => /FORCE INDEX \(idx_inv_make_model(_trim)?\)/.test(l)), 'every read is index-forced');
    assert.ok(selects.filter((l) => /GROUP BY/.test(l) && !/make (IS NULL|= '')/.test(l)).every((l) => /WHERE make = \? AND model = \?/.test(l)), 'every grouped read is bounded by make and model');
  });

  it('dryrun refuses while the sync lock is held, and reads nothing', { skip }, async () => {
    const t = setup(); fs.writeFileSync(t.lockLog, '[sync-lock] 2026-10-24T00:00:00Z acquire by x\n');
    const r = await t.run('--phase=dryrun', '--pause-ms=0');
    assert.equal(r.code, 3); assert.match(r.stderr, /sync lock is held/);
    assert.ok(!t.sql().split('\n').some((l) => l.startsWith('SELECT')));
  });

  it('dryrun stops at the deadline (a time that has already passed)', { skip }, async () => {
    const t = setup(); const r = await t.run('--phase=dryrun', '--pause-ms=0', '--deadline-et=00:00');
    assert.equal(r.code, 0); const out = JSON.parse(r.stdout);
    assert.equal(out.complete, false); assert.match(out.stopReason, /deadline 0:00 ET/); assert.equal(out.total.rowsChecked, 0);
  });

  it('lookup: one primary-key read, prints what the VIN says the make is', { skip }, async () => {
    const t = setup(); const r = await t.run('--phase=lookup', `--vins=${V.challenger},${V.yukon}`);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.found, 2);
    const c = out.rows.find((x) => x.vin === V.challenger);
    assert.equal(c.make, 'GMC'); assert.equal(c.wouldBeMake, 'Dodge'); assert.equal(c.dealer, 'Roster Buick GMC'); assert.equal(c.vdpHost, 'www.rosterbuickgmc.example');
    assert.equal(out.rows.find((x) => x.vin === V.yukon).wouldBeMake, 'GMC');
    assert.ok(t.sql().split('\n').filter((l) => l.startsWith('SELECT')).every((l) => /WHERE vin IN \(/.test(l)));
  });

  it('selftest needs no database', { skip }, async () => {
    const t = setup(); const r = await t.run('--phase=selftest');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).map((x) => x[2]), ['Dodge', 'Subaru', 'Lincoln', 'Honda', 'Buick', 'GMC']);
  });
});
