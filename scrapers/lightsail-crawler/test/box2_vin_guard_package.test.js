// docs/box-patches/2026-10-29-box2-vin-guard/install.sh against a simulated box2 /opt/trimscout-deals/src built from the committed "before" files.
// Covers: check/apply/restore round trip with md5 pins, refusal on drift, refusal while the sync lock is held, the restart step against a fake pm2, and that the
// package files are the repo's own (so the box gets exactly what main has).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '../../../docs/box-patches/2026-10-29-box2-vin-guard');
const SRC = path.join(HERE, '../src');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const SM_BEFORE = '4f384997f7107b66b9521bb561b7a10e', IG_BEFORE = '0ba41bc0c45b07ad75a2fd32571937da';
const SM_AFTER = '4017f1f9e24dc14d1b2cc530737e1e00', IG_AFTER = '88ec75c5d81a19dd484de0dea62add28';

describe('package files are the repo files', () => {
  for (const f of ['stellantisMake.js', 'ingestGuards.js']) it(`files/${f} == src/${f}`, () => assert.equal(md5(path.join(PKG, 'files', f)), md5(path.join(SRC, f))));
  // vinWmi.js is pinned, not compared with src/: the table in src/ may move on after this package is cut (box2 then gets the newer file in a later, separate step).
  it('files/vinWmi.js is the pinned 132e440b... table (7371d7d9 + 3MW 3HD 3GP ZAS 1HT)', () => assert.equal(md5(path.join(PKG, 'files/vinWmi.js')), '132e440bce262c00b5f6ee3e68ad2a5a'));
  it('the pinned md5s are the committed ones', () => {
    assert.equal(md5(path.join(PKG, 'fixtures/stellantisMake.box-before.js')), SM_BEFORE);
    assert.equal(md5(path.join(PKG, 'fixtures/ingestGuards.box-before.js')), IG_BEFORE);
    assert.equal(md5(path.join(PKG, 'files/stellantisMake.js')), SM_AFTER);
    assert.equal(md5(path.join(PKG, 'files/ingestGuards.js')), IG_AFTER);
  });
  it('manifest.txt lists every shipped file with its md5', () => {
    const lines = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trim().split('\n');
    assert.ok(lines.length >= 5);
    for (const l of lines) { const [sum, rel] = l.split(/\s+/); assert.equal(md5(path.join(PKG, rel)), sum, rel); }
  });
  it('ingestGuards.js only gained exports versus the box copy (no behaviour change)', () => {
    const strip = (s) => s.replace(/^export /gm, '');
    assert.equal(strip(fs.readFileSync(path.join(PKG, 'files/ingestGuards.js'), 'utf8')), strip(fs.readFileSync(path.join(PKG, 'fixtures/ingestGuards.box-before.js'), 'utf8')));
  });
  it('deals_api_server.js needs no patch: every make it writes goes through normalizeMakeForWrite', () => {
    const s = fs.readFileSync(path.join(PKG, 'fixtures/deals_api_server.snapshot-2026-10-27.js'), 'utf8');
    assert.ok(s.includes('import { normalizeMakeForWrite } from "./stellantisMake.js"'));
    const insert = s.slice(s.indexOf('INSERT INTO dealer_inventory (vin, dealer_id'), s.indexOf('INSERT INTO dealer_inventory (vin, dealer_id') + 600);
    assert.ok(insert.includes('make'), 'the insert column list names make');
    const values = s.match(/const values = chunk\.map\(\(v\) => \[[^\n]*\n/)[0];
    assert.ok(/INV_STR\(normalizeMakeForWrite\(\{ make: v\.make, vin: v\.vin, model: v\.model \}\), 64\)/.test(values), 'the make column value is normalizeMakeForWrite(...)');
    assert.ok(!/INV_STR\(v\.make/.test(s), 'no raw v.make is ever written');
  });
});

describe('install.sh on a simulated box2', () => {
  let box, D, backup, lock, bin, env;
  const run = (mode, extra = {}) => spawnSync('bash', [path.join(PKG, 'install.sh'), mode], { encoding: 'utf8', env: { ...env, ...extra }, cwd: PKG });
  beforeEach(() => {
    box = fs.mkdtempSync(path.join(os.tmpdir(), 'box2guard-'));
    D = path.join(box, 'src'); fs.mkdirSync(D); backup = path.join(box, 'backup'); lock = path.join(box, 'deals-api-out.log'); bin = path.join(box, 'pm2');
    fs.copyFileSync(path.join(PKG, 'fixtures/stellantisMake.box-before.js'), path.join(D, 'stellantisMake.js'));
    fs.copyFileSync(path.join(PKG, 'fixtures/ingestGuards.box-before.js'), path.join(D, 'ingestGuards.js'));
    fs.copyFileSync(path.join(PKG, 'fixtures/stellantisVinTable.js'), path.join(D, 'stellantisVinTable.js'));
    fs.copyFileSync(path.join(PKG, 'fixtures/deals_api_server.snapshot-2026-10-27.js'), path.join(D, 'deals_api_server.js'));
    fs.writeFileSync(path.join(D, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(lock, '[sync-lock] 2026-10-29T18:44:04.344Z release by make-from-vin-fix-397007\n');
    // fake pm2: describe ok; jlist prints a deals-api record whose pm_uptime changes on every restart; restart bumps it
    fs.writeFileSync(bin, `#!/bin/bash\nC=${box}/pm2.count; [ -e $C ] || echo 1000 > $C\ncase "$1" in describe) exit 0;; restart) echo "$*" >> ${box}/pm2.calls; echo $(( $(cat $C) + 1 )) > $C;; jlist) echo "[{\\"name\\":\\"deals-api\\",\\"pm2_env\\":{\\"status\\":\\"\${PM2_STATUS:-online}\\",\\"pm_uptime\\":$(cat $C),\\"restart_time\\":0}}]";; esac\n`, { mode: 0o755 });
    env = { PATH: process.env.PATH, HOME: box, DEALS_DIR: D, BACKUP: backup, LOCK_LOG: lock, PM2: bin, PROC_RE: 'zz-no-such-process-zz' };
  });
  afterEach(() => fs.rmSync(box, { recursive: true, force: true }));

  it('check passes on the before state and changes nothing', () => {
    const r = run('check'); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DRIFT CHECK PASS/); assert.match(r.stdout, /state: before/);
    assert.equal(md5(path.join(D, 'stellantisMake.js')), SM_BEFORE); assert.ok(!fs.existsSync(path.join(D, 'vinWmi.js')));
  });
  it('apply installs the three files, backs up, prints the rollback command, and does not restart', () => {
    const r = run('apply'); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(md5(path.join(D, 'stellantisMake.js')), SM_AFTER); assert.equal(md5(path.join(D, 'ingestGuards.js')), IG_AFTER); assert.equal(md5(path.join(D, 'vinWmi.js')), md5(path.join(PKG, 'files/vinWmi.js')));
    assert.ok(fs.existsSync(path.join(backup, 'md5s.txt'))); assert.equal(md5(path.join(backup, 'stellantisMake.js')), SM_BEFORE);
    assert.match(r.stdout, /ROLLBACK:\s+bash .*install\.sh restore && .* restart deals-api/); assert.match(r.stdout, /VIN-GUARD TEST PASS/);
    assert.ok(!fs.existsSync(path.join(box, 'pm2.calls')), 'apply must not restart');
    assert.equal(md5(path.join(D, 'deals_api_server.js')), md5(path.join(PKG, 'fixtures/deals_api_server.snapshot-2026-10-27.js')), 'the server file is untouched');
    assert.match(run('apply').stdout, /ALREADY PATCHED/);
  });
  it('restore puts the box back byte for byte and removes vinWmi.js', () => {
    assert.equal(run('apply').status, 0); const r = run('restore'); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(md5(path.join(D, 'stellantisMake.js')), SM_BEFORE); assert.equal(md5(path.join(D, 'ingestGuards.js')), IG_BEFORE); assert.ok(!fs.existsSync(path.join(D, 'vinWmi.js')));
    assert.match(r.stdout, /RESTORED/);
  });
  it('refuses on md5 drift of any involved file and changes nothing', () => {
    for (const f of ['stellantisMake.js', 'ingestGuards.js', 'stellantisVinTable.js']) {
      const p = path.join(D, f), orig = fs.readFileSync(p); fs.appendFileSync(p, '\n// drift\n');
      const r = run('apply'); assert.notEqual(r.status, 0, f); assert.match(r.stdout, /FAIL/, f); assert.ok(!fs.existsSync(path.join(D, 'vinWmi.js')), f); assert.ok(!fs.existsSync(backup), f);
      fs.writeFileSync(p, orig);
    }
  });
  it('refuses when deals_api_server.js no longer routes the make through normalizeMakeForWrite', () => {
    const p = path.join(D, 'deals_api_server.js'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('normalizeMakeForWrite({', 'someOther({'));
    const r = run('apply'); assert.notEqual(r.status, 0); assert.match(r.stdout, /call sites|does not import|no longer passes/);
  });
  it('works on the server file with the stats-warm hunks too (independent of #623/#629): only the guard markers matter', () => {
    const p = path.join(D, 'deals_api_server.js'); fs.appendFileSync(p, '\nimport { warmStatsCache } from "./statsCache.js";\n');
    assert.equal(run('check').status, 0);
  });
  it('apply refuses while the sync lock is held, and while a sync/crawl process runs', () => {
    fs.appendFileSync(lock, '[sync-lock] 2026-10-29T19:00:00.000Z acquire by sync-box3\n');
    let r = run('apply'); assert.notEqual(r.status, 0); assert.match(r.stdout, /sync lock is held/); assert.ok(!fs.existsSync(path.join(D, 'vinWmi.js')));
    fs.appendFileSync(lock, '[sync-lock] 2026-10-29T19:30:00.000Z release by sync-box3\n');
    const child = spawn('sleep', ['31']); // stands in for a running sync/crawl process
    try { r = run('apply', { PROC_RE: 'sleep 31' }); assert.notEqual(r.status, 0); assert.match(r.stdout, /process is running/); assert.ok(!fs.existsSync(path.join(D, 'vinWmi.js'))); } finally { child.kill(); }
    r = run('apply'); assert.equal(r.status, 0, r.stdout);
  });
  it('restart runs `pm2 restart deals-api` only on the patched state, and checks the process came back online', () => {
    let r = run('restart'); assert.notEqual(r.status, 0); assert.match(r.stdout, /not in the patched state/);
    assert.equal(run('apply').status, 0);
    r = run('restart'); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /RESTARTED/); assert.match(fs.readFileSync(path.join(box, 'pm2.calls'), 'utf8'), /restart deals-api/);
  });
  it('restart fails loudly and prints the rollback when the process is not online afterwards', () => {
    assert.equal(run('apply').status, 0);
    const r = run('restart', { PM2_STATUS: 'errored' }); assert.notEqual(r.status, 0); assert.match(r.stdout, /not online - roll back NOW with: bash .*install\.sh restore/);
  });
  it('the default PM2 command is `sudo -u ubuntu pm2` (the root PM2 has no deals-api)', () => {
    assert.match(fs.readFileSync(path.join(PKG, 'install.sh'), 'utf8'), /PM2=\$\{PM2:-sudo -u ubuntu pm2\}/);
  });
});
