// Trim re-clean (scripts/box/2026-10-21-trim-reclean.mjs): the pure rule, and the whole dryrun -> plan -> apply -> verify -> restore flow run as the
// emitted stdin bundle against an in-memory fake of mysql2 and a stub of deals-api's sync-lock endpoints.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { classifyTrimChange, summarizeGroups } from '../../../scripts/lib/trimReclean.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('classifyTrimChange', () => {
  it('reports the reasons and the new trim', () => {
    assert.deepEqual(classifyTrimChange('Platinum&reg;', 'Ford'), { next: 'Platinum', reasons: ['entity', 'mark'] });
    assert.deepEqual(classifyTrimChange('Raptor&reg; 4x4', 'Ford'), { next: 'Raptor 4x4', reasons: ['entity', 'mark'] });
    assert.deepEqual(classifyTrimChange('  Big   Bend ', 'Ford'), { next: 'Big Bend', reasons: ['whitespace'] });
    assert.deepEqual(classifyTrimChange('Denali®', 'GMC'), { next: 'Denali', reasons: ['mark'] });
  });
  it('leaves clean, blank, null, drivetrain-only and drivetrain-suffixed trims alone, for every make', () => {
    for (const [t, m] of [['Lariat', 'Ford'], ['', 'Ford'], ['   ', 'Ford'], [null, 'Ford'], ['AWD', 'Ford'], ['XLT 4WD', 'Ford'], ['Base 2 Door 4x4', 'Ford'], ['Wind AWD', 'Kia'], ['Sport & Tech', 'Honda']]) assert.equal(classifyTrimChange(t, m), null, String(t));
  });
  it('SEL AWD and SEL FWD stay distinct, with or without an entity or mark', () => {
    assert.equal(classifyTrimChange('SEL AWD', 'Hyundai'), null);
    assert.equal(classifyTrimChange('SEL FWD', 'Hyundai'), null);
    assert.equal(classifyTrimChange('SEL&reg; AWD', 'Hyundai').next, 'SEL AWD');
    assert.equal(classifyTrimChange('SEL&reg; FWD', 'Hyundai').next, 'SEL FWD');
    assert.equal(classifyTrimChange('SEL® FWD', 'Hyundai').next, 'SEL FWD');
    assert.notEqual(classifyTrimChange('SEL&reg; AWD', 'Hyundai').next, classifyTrimChange('SEL&reg; FWD', 'Hyundai').next);
  });
  it('Long Range AWD and Long Range RWD stay distinct, with or without an entity or mark', () => {
    assert.equal(classifyTrimChange('Long Range AWD', 'Tesla'), null);
    assert.equal(classifyTrimChange('Long Range RWD', 'Tesla'), null);
    assert.equal(classifyTrimChange('Long Range™ AWD', 'Tesla').next, 'Long Range AWD');
    assert.equal(classifyTrimChange('Long Range&trade; RWD', 'Tesla').next, 'Long Range RWD');
    assert.notEqual(classifyTrimChange('Long Range™ AWD', 'Tesla').next, classifyTrimChange('Long Range™ RWD', 'Tesla').next);
  });
  it('never drops or changes a drivetrain word: every word, every make, dirty or clean', () => {
    for (const make of ['Ford', 'Kia', 'Tesla', 'Toyota', 'Porsche']) for (const w of ['4WD', 'AWD', '4x4', 'RWD', 'FWD', '2WD', 'awd', '4X4']) {
      for (const t of [`XLT ${w}`, `XLT&reg; ${w}`, `  XLT   ${w} `, `${w} Lariat`, `Lariat ${w} Crew&reg;`]) {
        const c = classifyTrimChange(t, make);
        if (c) assert.ok(c.next.toLowerCase().includes(w.toLowerCase()), `${make}: ${t} -> ${c.next}`);
      }
    }
  });
  it('has no "drivetrain" reason any more', () => {
    for (const t of ['XLT 4WD', 'Raptor&reg; 4x4', 'SEL&reg; FWD', 'Long Range™ AWD']) assert.ok(!(classifyTrimChange(t, 'Ford')?.reasons || []).includes('drivetrain'), t);
  });
});

describe('summarizeGroups', () => {
  it('counts rows by reason, merges into an existing trim, and keeps no VIN', () => {
    const s = summarizeGroups('Ford', [
      { model: 'F-150', trim: 'Platinum&reg;', n: 3 }, { model: 'F-150', trim: 'Platinum', n: 5 }, { model: 'F-150', trim: 'XLT 4WD', n: 2 },
      { model: 'Bronco', trim: 'Big Bend&reg;', n: 4 }, { model: 'F-150', trim: null, n: 9 }, { model: 'F-150', trim: 'Lariat', n: 1 },
    ]);
    assert.equal(s.distinctTrims, 6); assert.equal(s.changedTrims, 2); assert.equal(s.rowsToChange, 7); // XLT 4WD is not a change
    assert.deepEqual(s.byReason, { entity: 7, mark: 7 });
    assert.equal(s.mergesIntoExistingTrim, 1); // Platinum& reg; -> Platinum, which already exists on F-150
    assert.deepEqual(s.pairs[0], { model: 'Bronco', from: 'Big Bend&reg;', to: 'Big Bend', rows: 4, reasons: ['entity', 'mark'] });
    assert.ok(!JSON.stringify(s).match(/vin/i));
  });
});

// ---- the flow, end to end ----
const FAKE_MYSQL = String.raw`
const fs = require('fs');
const DB = process.env.FAKE_DB_FILE;
const load = () => JSON.parse(fs.readFileSync(DB, 'utf8'));
const save = (t) => fs.writeFileSync(DB, JSON.stringify(t));
const ci = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function run(sqlIn, params, rows) {
  const sql = sqlIn.replace(/^SET STATEMENT max_statement_time=\d+ FOR /, '').replace(/\s+/g, ' ').trim();
  let m;
  fs.appendFileSync(process.env.FAKE_LOG, sql + '\n');
  if ((m = /^SELECT make FROM dealer_inventory FORCE INDEX \(idx_inv_make_model\) WHERE make > \? ORDER BY make LIMIT 1$/.exec(sql))) { const v = [...new Set(rows.map((r) => r.make))].sort().filter((x) => x.toLowerCase() > params[0].toLowerCase()); return v.length ? [{ make: v[0] }] : []; }
  if (/^SELECT model FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model > \? ORDER BY model LIMIT 1$/.test(sql)) { const v = [...new Set(rows.filter((r) => ci(r.make, params[0]) && r.model).map((r) => r.model))].sort().filter((x) => x.toLowerCase() > params[1].toLowerCase()); return v.length ? [{ model: v[0] }] : []; }
  if (/^SELECT trim, COUNT\(\*\) AS n FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model = \? GROUP BY BINARY trim$/.test(sql)) { const g = new Map(); for (const r of rows.filter((r) => ci(r.make, params[0]) && ci(r.model, params[1]))) g.set(r.trim, (g.get(r.trim) || 0) + 1); return [...g].map(([trim, n]) => ({ trim, n })); }
  if ((m = /^SELECT vin, dealer_id, make, trim FROM dealer_inventory FORCE INDEX \(idx_inv_make_model_trim\) WHERE make = \? AND model = \? AND trim = \?( AND .*)?$/.exec(sql))) return rows.filter((r) => ci(r.make, params[0]) && ci(r.model, params[1]) && r.trim !== null && ci(String(r.trim).trimEnd(), String(params[2]).trimEnd())).map(({ vin, dealer_id, make, trim }) => ({ vin, dealer_id, make, trim }));
  if (/^SELECT vin, dealer_id, make, trim FROM dealer_inventory WHERE /.test(sql)) { const pairs = []; for (let i = 0; i < params.length; i += 2) pairs.push([params[i], params[i + 1]]); return rows.filter((r) => pairs.some(([v, d]) => r.vin === v && r.dealer_id === d)).map(({ vin, dealer_id, make, trim }) => ({ vin, dealer_id, make, trim })); }
  if (/^UPDATE dealer_inventory SET trim = \? WHERE BINARY trim = BINARY \? AND \(/.test(sql)) {
    const [next, old, ...rest] = params; const pairs = []; for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
    let n = 0; for (const r of rows) if (r.trim === old && pairs.some(([v, d]) => r.vin === v && r.dealer_id === d)) { r.trim = next; n++; }
    if (process.env.FAKE_WRITE_LOG) fs.appendFileSync(process.env.FAKE_WRITE_LOG, n + ' rows in one UPDATE of ' + pairs.length + ' keys\n');
    return { affectedRows: n };
  }
  throw new Error('fake mysql: unexpected SQL: ' + sql);
}
class Conn {
  constructor() { this.t = null; this.snap = null; }
  async query(sql, params) { const isW = /UPDATE dealer_inventory/.test(sql); const t = this.t || load(); const out = run(sql, params || [], t.rows); if (isW) { if (!this.t) save(t); } return [out]; }
  async beginTransaction() { this.t = load(); this.snap = JSON.stringify(this.t); }
  async commit() { save(this.t); this.t = null; }
  async rollback() { this.t = null; }
  release() {}
}
module.exports = { createPool: (o) => { fs.appendFileSync(process.env.FAKE_LOG, 'POOL user=' + o.user + '\n'); return { getConnection: async () => new Conn(), query: (...a) => new Conn().query(...a), end: async () => {} }; } };
module.exports.default = module.exports;
`;

function rowsFixture() {
  let n = 0; // a unique VIN per row: (vin, dealer_id) is the table's primary key
  const R = (count, make, model, trim) => Array.from({ length: count }, (_, i) => ({ vin: `TESTVIN${String(++n).padStart(10, '0')}`, dealer_id: 100 + i, make, model, trim }));
  return [
    ...R(3, 'Ford', 'F-150', 'Platinum&reg;'), ...R(5, 'Ford', 'F-150', 'Platinum'), ...R(2, 'Ford', 'F-150', 'XLT 4WD'), ...R(1, 'Ford', 'F-150', 'Lariat'),
    ...R(4, 'Ford', 'Bronco', 'Big Bend&reg;'), ...R(1, 'Ford', 'Bronco', null), ...R(2, 'Ford', 'Ranger', 'AWD'),
    ...R(2, 'Kia', 'EV3', 'Wind AWD'), ...R(2, 'Kia', 'EV3', 'GT-Line&reg; AWD'), ...R(1, 'GMC', 'Sierra 1500', 'Denali&reg;'),
    ...R(2, 'Hyundai', 'Tucson', 'SEL AWD'), ...R(2, 'Hyundai', 'Tucson', 'SEL FWD'), ...R(2, 'Hyundai', 'Tucson', 'SEL&reg; FWD'),
    ...R(2, 'Tesla', 'Model 3', 'Long Range AWD'), ...R(1, 'Tesla', 'Model 3', 'Long Range RWD'),
  ];
}

function startLockStub(acquired = true) {
  const calls = [];
  const srv = http.createServer((req, res) => { calls.push(req.url); let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url.endsWith('acquire') ? { acquired } : { renewed: true, released: true })); }); });
  srv.unref(); // a failed assertion must never leave the stub holding the process open
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, calls, port: srv.address().port })));
}

let bundle = null;
try { await import('esbuild'); bundle = execFileSync('node', [path.join(repo, 'scripts/box/2026-10-21-trim-reclean.mjs'), '--emit'], { maxBuffer: 64 << 20 }); } catch {}
const skip = !bundle && 'esbuild is not installed here';

describe('trim re-clean flow (emitted bundle, fake DB, stub lock)', () => {

  // --deadline-et=24:00 (a later flag wins): the script's real default hard-stops at 21:40 ET, which made this suite fail on any CI run after that time.
  async function setup({ lock = true } = {}) {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'trc-'));
    fs.mkdirSync(path.join(dir, 'node_modules/mysql2'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/mysql2/package.json'), JSON.stringify({ name: 'mysql2', version: '0.0.0', exports: { './promise': './promise.js' } }));
    fs.writeFileSync(path.join(dir, 'node_modules/mysql2/promise.js'), FAKE_MYSQL);
    const db = path.join(dir, 'db.json'); fs.writeFileSync(db, JSON.stringify({ rows: rowsFixture() }));
    const stub = await startLockStub(lock);
    fs.writeFileSync(path.join(dir, 'env'), `DB_READER_USER=reader\nDB_READER_PASSWORD=r\nDB_WRITER_USER=writer\nDB_WRITER_PASSWORD=w\nTRIMSCOUT_API_KEY=k\nDEALS_API_PORT=${stub.port}\n`);
    fs.writeFileSync(path.join(dir, 'lock.log'), '[sync-lock] 2026-10-21T00:00:00Z release by x\n');
    const env = { ...process.env, FAKE_DB_FILE: db, FAKE_LOG: path.join(dir, 'sql.log'), FAKE_WRITE_LOG: path.join(dir, 'writes.log') };
    const run = (...a) => new Promise((resolve) => { const c = execFile('node', ['--input-type=module', '-', `--env=${path.join(dir, 'env')}`, `--lock-log=${path.join(dir, 'lock.log')}`, `--out=${path.join(dir, 'out')}`, '--deadline-et=24:00', ...a], { cwd: dir, env, maxBuffer: 64 << 20 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })); c.stdin.end(bundle); });
    return { dir, db, stub, run, table: () => JSON.parse(fs.readFileSync(db, 'utf8')).rows, sql: () => fs.readFileSync(path.join(dir, 'sql.log'), 'utf8') };
  }

  it('dryrun: counts only, reader account, writes nothing', { skip }, async () => {
    const t = await setup(); const before = JSON.stringify(t.table());
    const r = await t.run('--phase=dryrun', '--pause-ms=0'); t.stub.srv.close();
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.wrote, 'nothing'); assert.equal(out.complete, true);
    assert.equal(out.total.rowsToChange, 3 + 4 + 2 + 1 + 2); // Platinum&reg;, Big Bend&reg;, GT-Line&reg; AWD, Denali&reg;, SEL&reg; FWD (no drivetrain-only change)
    assert.equal(out.total.mergesIntoExistingTrim, 2); // Platinum&reg; -> Platinum and SEL&reg; FWD -> SEL FWD both already exist on their model
    assert.deepEqual(out.makesWithNothingToDo, ['Tesla']); // Long Range AWD / RWD: nothing to clean, and nothing to strip
    assert.equal(JSON.stringify(t.table()), before);
    assert.ok(!/ [A-Z0-9]{17} /.test(r.stdout) && !/"vin"/.test(r.stdout));
    assert.ok(t.sql().includes('POOL user=reader') && !t.sql().includes('user=writer'));
    assert.ok(!fs.existsSync(path.join(t.dir, 'out')), 'dryrun created no output files');
    assert.equal(t.stub.calls.length, 0, 'dryrun takes no lock');
    const selects = t.sql().split('\n').filter((l) => l.startsWith('SELECT'));
    assert.ok(selects.length > 5 && selects.every((l) => /FORCE INDEX \(idx_inv_make_model(_trim)?\)/.test(l) && /WHERE make [=>] \?/.test(l)), 'every dryrun read is index-forced and starts from make (and model)');
    assert.ok(selects.filter((l) => /GROUP BY/.test(l)).every((l) => /AND model = \?/.test(l)), 'every per-trim read is bounded by model too');
  });

  it('plan -> apply (batches <= 2) -> verify -> restore puts every old trim back', { skip }, async () => {
    const t = await setup(); const original = JSON.stringify(t.table());
    let r = await t.run('--phase=plan', '--batch=2', '--pause-ms=0'); assert.equal(r.code, 0, r.stderr);
    const summary = JSON.parse(fs.readFileSync(path.join(t.dir, 'out/plan-summary.json'), 'utf8'));
    assert.equal(summary.complete, true); assert.equal(summary.rowsPlanned, 12); assert.equal(summary.batches, 6);
    assert.ok(!fs.readFileSync(path.join(t.dir, 'out/plan.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).some((l) => /(?:4wd|awd|4x4|rwd|fwd|2wd)/i.test(l.old || '') !== /(?:4wd|awd|4x4|rwd|fwd|2wd)/i.test(l.next || '')), 'no plan line adds or drops a drivetrain word');
    assert.ok(t.sql().includes('POOL user=reader') && !t.sql().includes('user=writer'));
    assert.equal((fs.statSync(path.join(t.dir, 'out/plan.jsonl')).mode & 0o777), 0o600);
    assert.ok(!/"vin"|[A-Z0-9]{17}/.test(JSON.stringify(summary)), 'plan-summary holds counts only');
    assert.equal(JSON.stringify(t.table()), original, 'plan wrote nothing to the table');

    r = await t.run('--phase=apply', '--batch=2', '--pause-ms=0'); assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /rows 12\/12/);
    assert.deepEqual(t.stub.calls.filter((c) => /acquire|release/.test(c)), ['/api/ops/sync-lock/acquire', '/api/ops/sync-lock/release']);
    const after = t.table().map((x) => x.trim);
    assert.equal(after.filter((x) => x && /&|®/.test(x)).length, 0);
    for (const keep of ['GT-Line AWD', 'Wind AWD', 'AWD', 'Denali', 'XLT 4WD', 'SEL AWD', 'SEL FWD', 'Long Range AWD', 'Long Range RWD']) assert.ok(after.includes(keep), keep);
    const dt = (x) => /(?:4wd|awd|4x4|rwd|fwd|2wd)/i.test(x || '');
    assert.equal(after.filter(dt).length, JSON.parse(original).map((x) => x.trim).filter(dt).length, 'the same rows carry a drivetrain word after the apply as before');
    assert.equal(after.filter((x) => x === 'SEL FWD').length, 4, 'SEL&reg; FWD merged into SEL FWD'); assert.equal(after.filter((x) => x === 'SEL AWD').length, 2);
    assert.equal(after.filter((x) => x === 'Long Range AWD').length, 2); assert.equal(after.filter((x) => x === 'Long Range RWD').length, 1);
    assert.ok(fs.readFileSync(path.join(t.dir, 'writes.log'), 'utf8').split('\n').filter(Boolean).every((l) => Number(l.split(' ')[0]) <= 2 + 0), 'no UPDATE touched more rows than the batch size');

    r = await t.run('--phase=verify', '--pause-ms=0'); assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.replace(/^VERIFY /, '')), { appliedRows: 12, atPlannedValue: 12, cleanButDifferent: 0, stillDirty: 0, missing: 0 });

    r = await t.run('--phase=restore', '--pause-ms=0'); assert.match(r.stdout, /\[DRY\] restore 12 rows/);
    assert.equal(JSON.stringify(t.table()) === original, false, 'dry restore changed nothing');
    r = await t.run('--phase=restore', '--go', '--batch=4', '--pause-ms=0'); assert.match(r.stdout, /12 of 12 rows put back/);
    assert.equal(JSON.stringify(t.table()), original);
    t.stub.srv.close();
  });

  it('apply leaves a row whose trim changed since the plan, and a second apply resumes after the checkpoint', { skip }, async () => {
    const t = await setup();
    await t.run('--phase=plan', '--batch=3', '--pause-ms=0');
    const rows = t.table(); const hit = rows.find((x) => x.trim === 'Platinum&reg;'); hit.trim = 'XLT Premium'; fs.writeFileSync(t.db, JSON.stringify({ rows }));
    let r = await t.run('--phase=apply', '--batch=3', '--pause-ms=0'); assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /rows 11\/12 \(changed-since skipped 1\)/);
    assert.equal(t.table().find((x) => x.vin === hit.vin && x.dealer_id === hit.dealer_id).trim, 'XLT Premium');
    const calls = t.stub.calls.length;
    r = await t.run('--phase=apply', '--batch=3', '--pause-ms=0'); assert.match(r.stdout, /resume after batch 4 of 4/);
    assert.equal(t.table().filter((x) => /&/.test(x.trim || '')).length, 0);
    assert.ok(t.stub.calls.length > calls);
    r = await t.run('--phase=verify', '--pause-ms=0'); assert.match(r.stdout, /"stillDirty":0/);
    t.stub.srv.close();
  });

  it('refuses a batch over 5000, and stops (nothing written) when the sync lock is busy or held', { skip }, async () => {
    const t = await setup({ lock: false });
    let r = await t.run('--phase=plan', '--batch=5001'); assert.notEqual(r.code, 0); assert.match(r.stderr, /--batch must be a whole number from 1 to 5000/);
    await t.run('--phase=plan', '--pause-ms=0');
    const before = JSON.stringify(t.table());
    r = await t.run('--phase=apply', '--pause-ms=0'); assert.equal(r.code, 4); assert.match(r.stdout, /LOCK BUSY/);
    assert.equal(JSON.stringify(t.table()), before);
    fs.writeFileSync(path.join(t.dir, 'lock.log'), '[sync-lock] 2026-10-21T00:00:00Z acquire by x\n');
    r = await t.run('--phase=dryrun', '--pause-ms=0'); assert.equal(r.code, 3); assert.match(r.stderr, /sync lock is held/);
    t.stub.srv.close();
  });

  it('apply refuses a plan.jsonl that no longer matches its summary', { skip }, async () => {
    const t = await setup();
    await t.run('--phase=plan', '--pause-ms=0');
    fs.appendFileSync(path.join(t.dir, 'out/plan.jsonl'), '\n');
    const r = await t.run('--phase=apply', '--pause-ms=0'); assert.notEqual(r.code, 0); assert.match(r.stderr, /does not match plan-summary/);
    t.stub.srv.close();
  });
});
