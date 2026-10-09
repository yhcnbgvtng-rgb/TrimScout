// scripts/box/2026-10-06-mileage-cleanup-pk.mjs: the used/CPO "mileage = 0 -> NULL" cleanup, walked by PRIMARY-key (vin) ranges.
// The script is run as a child process against a stand-in for mysql2 (an in-memory dealer_inventory kept in a JSON file so a
// second run can resume) and a fake deals API for the sync lock. Covers: dry run writes nothing, only used/CPO zero-mileage
// rows are touched, the lock is taken and released, the hard time limit stops between batches, the checkpoint resumes,
// a past --stop-at and a busy lock refuse without writing, and bad flags are rejected.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SRC = path.resolve(here, '../../../scripts/box/2026-10-06-mileage-cleanup-pk.mjs');

const STUB_MYSQL = `
import fs from "node:fs";
const FILE = new URL("./table.json", import.meta.url);
const load = () => JSON.parse(fs.readFileSync(FILE, "utf-8"));
export default { createPool() {
  return {
    async query(sql, args = []) {
      const t = load();
      if (/^SELECT vin FROM dealer_inventory WHERE vin > \\? ORDER BY vin LIMIT 1 OFFSET \\?/.test(sql)) {
        const rows = t.vins.filter((v) => v > args[0]);
        return [rows.length > args[1] ? [{ vin: rows[args[1]] }] : []];
      }
      const ranged = /vin <= \\?/.test(sql);
      const inRange = (v) => v > args[0] && (!ranged || v <= args[1]);
      const matches = (i) => (t.cond[i] === "used" || t.cond[i] === "cpo") && t.mileage[i] === 0;
      if (/^EXPLAIN/.test(sql)) return [[{ type: "range" }]];
      if (/^SELECT COUNT/.test(sql)) {
        const n = t.vins.reduce((a, v, i) => a + ((!/vin >/.test(sql) || inRange(v)) && matches(i) ? 1 : 0), 0);
        return [[{ n }]];
      }
      if (/^UPDATE dealer_inventory SET mileage = NULL/.test(sql)) {
        let n = 0;
        t.vins.forEach((v, i) => { if (inRange(v) && matches(i)) { t.mileage[i] = null; n++; } });
        if (n) fs.writeFileSync(FILE, JSON.stringify(t));
        return [{ affectedRows: n }];
      }
      throw new Error("stub: unexpected SQL " + sql);
    },
    async end() {},
  };
} };
`;

let dir, api, apiPort, lockCalls, busy;
const vin = (i) => `V${String(i).padStart(6, '0')}`;

function seed(n) {
  const t = { vins: [], cond: [], mileage: [] };
  for (let i = 0; i < n; i++) {
    t.vins.push(vin(i));
    t.cond.push(i % 5 === 0 ? 'new' : i % 7 === 0 ? 'cpo' : 'used');
    t.mileage.push(i % 3 === 0 ? 0 : 1000 + i); // every third row is 0; the "new" ones must stay 0
  }
  fs.writeFileSync(path.join(dir, 'node_modules/mysql2/table.json'), JSON.stringify(t));
  return t;
}
const table = () => JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/mysql2/table.json'), 'utf-8'));
const remaining = (t) => t.vins.filter((_, i) => (t.cond[i] === 'used' || t.cond[i] === 'cpo') && t.mileage[i] === 0).length;

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, 'cleanup.mjs'), ...args], {
      cwd: dir, env: { ...process.env, DEALS_API_PORT: String(apiPort), TRIMSCOUT_API_KEY: 'test-key', MILEAGE_PAUSE_MS: '0', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mileage-cleanup-'));
  fs.mkdirSync(path.join(dir, 'node_modules/mysql2'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/mysql2/package.json'), JSON.stringify({ name: 'mysql2', version: '0.0.0', type: 'module', exports: { './promise': './promise.js' } }));
  fs.writeFileSync(path.join(dir, 'node_modules/mysql2/promise.js'), STUB_MYSQL);
  fs.writeFileSync(path.join(dir, '.env.trimscout-db'), 'DB_HOST=stub-db\nDB_WRITER_USER=u\nDB_WRITER_PASSWORD=p\n');
  fs.copyFileSync(SCRIPT_SRC, path.join(dir, 'cleanup.mjs'));
  lockCalls = []; busy = false;
  api = http.createServer((req, res) => {
    const action = req.url.split('/').pop();
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      lockCalls.push({ action, key: req.headers['x-trimscout-api-key'], owner: JSON.parse(body || '{}').owner });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(action === 'acquire' ? { acquired: !busy } : { ok: true }));
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  apiPort = api.address().port;
});
after(async () => { await new Promise((r) => api.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

describe('mileage cleanup by primary-key ranges', () => {
  it('dry run (no flags) writes nothing and never touches the sync lock', async () => {
    const t = seed(3000); lockCalls.length = 0;
    const before = remaining(t);
    const { code, out } = await run(['--range=1000']);
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN — nothing was changed/);
    assert.equal(remaining(table()), before);
    assert.deepEqual(lockCalls, []);
  });

  it('--apply walks the table once in vin ranges, clears only used/CPO zero-mileage rows, and takes then releases the lock', async () => {
    const t = seed(4500); lockCalls.length = 0;
    const newZeros = t.vins.filter((_, i) => t.cond[i] === 'new' && t.mileage[i] === 0).length;
    assert.ok(newZeros > 0 && remaining(t) > 0);
    const cp = path.join(dir, 'cp-a.json');
    const { code, out } = await run(['--apply', '--fleet-idle', '--range=1000', `--checkpoint=${cp}`]);
    assert.equal(code, 0, out);
    assert.match(out, /walked the whole table/);
    assert.match(out, /remaining used\/CPO miles = 0: 0/);
    const after = table();
    assert.equal(remaining(after), 0);
    assert.equal(after.vins.filter((_, i) => after.cond[i] === 'new' && after.mileage[i] === 0).length, newZeros, 'new-car rows must be left alone');
    assert.equal(after.mileage.filter((m) => m === null).length, t.vins.filter((_, i) => (t.cond[i] === 'used' || t.cond[i] === 'cpo') && t.mileage[i] === 0).length);
    assert.deepEqual(lockCalls.map((c) => c.action).filter((a) => a !== 'heartbeat'), ['acquire', 'release']);
    assert.ok(lockCalls.every((c) => c.key === 'test-key' && /^ingest-cleanup-mileage-\d+$/.test(c.owner)));
    assert.ok(JSON.parse(fs.readFileSync(cp, 'utf-8')).lastVin, 'checkpoint written');
  });

  it('the hard time limit stops between batches, keeps the checkpoint, and a rerun resumes after it and finishes', async () => {
    const t = seed(60000);
    const total = remaining(t);
    const cp = path.join(dir, 'cp-b.json');
    const first = await run(['--apply', '--fleet-idle', '--range=1000', '--max-minutes=0.05', `--checkpoint=${cp}`], { MILEAGE_PAUSE_MS: '150' });
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /STOPPED at the time limit/);
    const mid = remaining(table());
    assert.ok(mid > 0 && mid < total, `stopped part-way (${mid} of ${total} left)`);
    assert.ok(JSON.parse(fs.readFileSync(cp, 'utf-8')).lastVin);
    const second = await run(['--apply', '--fleet-idle', '--range=1000', `--checkpoint=${cp}`]);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /resuming after vin V\d+/);
    assert.match(second.out, /walked the whole table/);
    assert.equal(remaining(table()), 0);
  });

  it('--from-start ignores the checkpoint', async () => {
    seed(3000);
    const cp = path.join(dir, 'cp-c.json');
    fs.writeFileSync(cp, JSON.stringify({ lastVin: 'V009999' })); // past the end: a resumed run would do nothing
    const resumed = await run(['--apply', '--fleet-idle', '--range=1000', `--checkpoint=${cp}`]);
    assert.match(resumed.out, /resuming after vin V009999/);
    assert.ok(remaining(table()) > 0, 'checkpoint past the end skipped everything');
    const full = await run(['--apply', '--fleet-idle', '--range=1000', '--from-start', `--checkpoint=${cp}`]);
    assert.doesNotMatch(full.out, /resuming after/);
    assert.equal(remaining(table()), 0);
  });

  it('refuses a --stop-at that has already passed, writing nothing and never taking the lock', async () => {
    const t = seed(2000); lockCalls.length = 0;
    const before = remaining(t);
    const { code, out } = await run(['--apply', '--fleet-idle', '--stop-at=00:00']);
    assert.equal(code, 1);
    assert.match(out, /past --stop-at=00:00/);
    assert.equal(remaining(table()), before);
    assert.deepEqual(lockCalls, []);
  });

  it('exits 4 and changes nothing when the sync lock is held', async () => {
    const t = seed(2000); lockCalls.length = 0; busy = true;
    const before = remaining(t);
    const { code, out } = await run(['--apply', '--fleet-idle', '--range=1000']);
    busy = false;
    assert.equal(code, 4, out);
    assert.match(out, /LOCK BUSY/);
    assert.equal(remaining(table()), before);
    assert.deepEqual(lockCalls.map((c) => c.action), ['acquire']);
  });

  it('rejects --apply without --fleet-idle and malformed flags', async () => {
    seed(1000); lockCalls.length = 0;
    for (const args of [['--apply'], ['--range=10'], ['--stop-at=7pm'], ['--max-minutes=0'], ['--max-minutes=abc']]) {
      const { code } = await run(args);
      assert.equal(code, 1, args.join(' '));
    }
    assert.deepEqual(lockCalls, []);
  });
});
