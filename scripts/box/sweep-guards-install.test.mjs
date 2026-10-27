// The box2 install package for the sweep guards (docs/box-patches/2026-10-27-sweep-guards/): the patches, the manifest and STEPS.md's md5 table must describe the
// files in this checkout, because the install is done from them by hand and a stale patch is only discovered on the box. Also runs the dead-shard mover on a
// scratch directory and the EXPLAIN printer against the repo's sweep module.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-27-sweep-guards');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const SOURCES = {
  'inventory-sync.mjs': 'scripts/box/inventory-sync.mjs',
  'syncRun.js': 'scripts/box/syncRun.js',
  'syncSweep.js': 'scripts/box/syncSweep.js',
  'deals_api_server.js': 'scrapers/lightsail-crawler/src/deals_api_server.js',
  'inventorySweep.js': 'scrapers/lightsail-crawler/src/inventorySweep.js',
  'syncSweepGuard.js': 'scripts/box/syncSweepGuard.js',
};
const manifest = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => manifest.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0;

describe('the manifest and STEPS.md describe the files in this checkout', () => {
  it('every FINAL md5 equals the real file (regenerate with make-patches.sh after editing any of them)', () => {
    for (const [name, rel] of Object.entries(SOURCES)) assert.equal(want('FINAL', name), md5(path.join(ROOT, rel)), `${name} changed since make-patches.sh ran`);
  });

  it('STEPS.md carries exactly the manifest as its md5 table', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    const block = /<!-- MD5S:START -->\n```\n([\s\S]*?)\n```\n<!-- MD5S:END -->/.exec(steps);
    assert.ok(block, 'md5 block present');
    assert.equal(block[1], fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trimEnd());
  });

  it('STEPS.md has the pieces an install needs: backup + md5s, drift check, restart gate, rollback, the dead-shard step, and says nothing was installed', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const must of ['Nothing is installed', 'drift-check.sh', 'md5s-before.txt', 'pm2 restart trimscout-deals-api', 'Rollback', 'move-dead-shards.sh', 'AL.json CO.json IN.json MD.json MT.json PA.json TX.json VT.json WY.json', 'ALGORITHM=INSTANT', 'EXPLAIN']) {
      assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
    }
  });
});

describe('the patches', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  for (const name of ['inventory-sync.mjs', 'syncRun.js', 'syncSweep.js', 'deals_api_server.js']) {
    it(`${name}: undoing it gives BASE, redoing it with zero fuzz gives FINAL`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-patch-'));
      const f = path.join(dir, name);
      fs.copyFileSync(path.join(ROOT, SOURCES[name]), f);
      const p = path.join(PKG, `${name}.patch`);
      execFileSync('patch', ['-s', '-F0', '-R', f], { input: fs.readFileSync(p) });
      assert.equal(md5(f), want('BASE', name), 'reverse-applying the patch reproduces the pre-change file');
      execFileSync('patch', ['-s', '-F0', f], { input: fs.readFileSync(p) });
      assert.equal(md5(f), want('FINAL', name), 'applying it again reproduces this checkout');
    });
  }

  it('a box file that differs where a hunk lands is REJECTED, not half-patched (--dry-run reports it and writes nothing)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-drift-'));
    const f = path.join(dir, 'syncSweep.js');
    execFileSync('patch', ['-s', '-F0', '-R', '-o', f, path.join(ROOT, SOURCES['syncSweep.js'])], { input: fs.readFileSync(path.join(PKG, 'syncSweep.js.patch')) });
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('maxConsecutiveStoreFailures = 5,', 'maxConsecutiveStoreFailures = 7,'));
    const before = md5(f);
    const r = spawnSync('patch', ['-F0', '--dry-run', f], { input: fs.readFileSync(path.join(PKG, 'syncSweep.js.patch')) });
    assert.notEqual(r.status, 0);
    assert.equal(md5(f), before, 'dry run wrote nothing');
  });
});

describe('move-dead-shards.sh', () => {
  const script = path.join(PKG, 'move-dead-shards.sh');
  const setup = (ageDays = 5, files = ['AL', 'CO', 'IN', 'MD', 'MT', 'PA', 'TX', 'VT', 'WY']) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-shards-'));
    const dest = path.join(os.tmpdir(), `dead-dest-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const old = new Date(Date.now() - ageDays * 86_400_000);
    for (const n of [...files, 'AL__acura', 'OK__mazda', 'CA__toyota']) { const f = path.join(dir, `${n}.json`); fs.writeFileSync(f, '[]'); fs.utimesSync(f, old, old); }
    return { dir, dest };
  };
  const run = (dir, dest, ...args) => spawnSync('bash', [script, dir, ...args], { encoding: 'utf8', env: { ...process.env, DEAD_SHARDS_DEST: dest, SKIP_RUNNING_CHECK: '1' } });

  it('dry run lists the nine plain state files and moves nothing', () => {
    const { dir, dest } = setup();
    const r = run(dir, dest);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN: 9 file\(s\) would move/);
    assert.equal(fs.readdirSync(dir).length, 12);
    assert.equal(fs.existsSync(dest), false);
  });

  it('--apply moves exactly those nine (with an md5 list) and leaves per-brand files, including OK__mazda, alone; mv puts them back', () => {
    const { dir, dest } = setup();
    const r = run(dir, dest, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['AL__acura.json', 'CA__toyota.json', 'OK__mazda.json']);
    assert.deepEqual(fs.readdirSync(dest).sort(), ['AL.json', 'CO.json', 'IN.json', 'MD.json', 'MOVED.md5', 'MT.json', 'PA.json', 'TX.json', 'VT.json', 'WY.json']);
    assert.equal(fs.readFileSync(path.join(dest, 'MOVED.md5'), 'utf8').trim().split('\n').length, 9);
  });

  it('refuses everything when any of them was written in the last 48 h (something still writes it: not dead)', () => {
    const { dir, dest } = setup();
    const now = new Date(); fs.utimesSync(path.join(dir, 'PA.json'), now, now);
    const r = run(dir, dest, '--apply');
    assert.equal(r.status, 2);
    assert.match(r.stdout, /REFUSE PA\.json was written in the last 48 h/);
    assert.equal(fs.readdirSync(dir).length, 12, 'nothing moved');
  });

  it('refuses while a sync or crawl is running (without the test override)', () => {
    const { dir, dest } = setup();
    const child = spawnSync('bash', ['-c', `exec -a "node inventory-sync.mjs" sleep 3 & sleep 0.3; bash "${script}" "${dir}" --apply; echo rc=$?; wait`], { encoding: 'utf8', env: { ...process.env, DEAD_SHARDS_DEST: dest } });
    assert.match(child.stdout + child.stderr, /REFUSING: a sync or crawl is running|rc=1/);
    assert.equal(fs.readdirSync(dir).length, 12);
  });

  it('missing files are skipped, an empty folder is not an error', () => {
    const { dir, dest } = setup(5, ['AL']);
    const r = run(dir, dest);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN: 1 file\(s\) would move/);
  });
});

describe('print-explain-sql.mjs', () => {
  it('prints one EXPLAIN per guarded statement with literal values only (no placeholders left), against the repo module', () => {
    const out = execFileSync(process.execPath, [path.join(PKG, 'print-explain-sql.mjs')], { encoding: 'utf8', env: { ...process.env, SWEEP_MODULE: path.join(ROOT, SOURCES['inventorySweep.js']) } });
    const statements = out.trim().split('\n');
    assert.equal(statements.length, 4, 'retire, restart, increment, freshness counts');
    for (const s of statements) { assert.match(s, /^EXPLAIN (UPDATE|SELECT) /); assert.doesNotMatch(s, /\?/); assert.match(s, /\\G$/); }
    assert.match(statements[0], /LEFT JOIN dealer_inventory o ON o\.vin = a\.vin/);
    assert.match(statements[0], /a\.dealer_id IN \(5100, 12225, 12226\)/);
  });
});
