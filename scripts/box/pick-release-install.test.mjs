// The box2 "Choose this quote releases the winner" package (docs/box-patches/2026-11-06-pick-release/): the manifest, STEPS.md and the files agree; the patch applies to the committed
// copy of the live box2 server with zero fuzz; and install.sh check|apply|restore run end to end against a temp copy of the box. Nothing here touches a box (restart and verify
// need pm2 and the live API, so they are not run here).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-11-06-pick-release');
const SRC = path.join(ROOT, 'scrapers/lightsail-crawler/src');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const rows = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => rows.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0 || spawnSync('patch', ['-v']).status === 0;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const BEFORE_SERVER = path.join(PKG, 'fixtures/deals_api_server.box-before.js.txt');
const BEFORE_STAGES = path.join(PKG, 'fixtures/dealStages.box-before.js');

describe('manifest, STEPS.md and the files agree', () => {
  it('every PACKAGE md5 is the file in this checkout; the before fixtures are the pinned live box2 files', () => {
    assert.equal(want('PACKAGE', 'files/dealStages.js'), md5(path.join(PKG, 'files/dealStages.js')));
    assert.equal(want('PACKAGE', 'deals_api_server.js.patch'), md5(path.join(PKG, 'deals_api_server.js.patch')));
    assert.equal(want('PACKAGE', 'smoke.mjs'), md5(path.join(PKG, 'smoke.mjs')));
    assert.equal(want('BASE', 'deals_api_server.js'), md5(BEFORE_SERVER));
    assert.equal(want('BASE', 'dealStages.js'), md5(BEFORE_STAGES));
  });

  it('the packaged dealStages.js is the repo crawler source (the box mirror and the box cannot differ)', () => {
    assert.equal(want('FINAL', 'dealStages.js'), md5(path.join(PKG, 'files/dealStages.js')));
    assert.equal(md5(path.join(PKG, 'files/dealStages.js')), md5(path.join(SRC, 'dealStages.js')));
  });

  it('install.sh pins the same md5s as the manifest', () => {
    const sh = fs.readFileSync(path.join(PKG, 'install.sh'), 'utf8');
    for (const [name, sum] of [['SV_BASE', want('BASE', 'deals_api_server.js')], ['SV_AFTER', want('FINAL', 'deals_api_server.js')], ['DS_BASE', want('BASE', 'dealStages.js')], ['DS_AFTER', want('FINAL', 'dealStages.js')], ['PATCH_MD5', want('PACKAGE', 'deals_api_server.js.patch')]]) {
      assert.ok(sh.includes(`${name}=${sum}`), `${name} is ${sum}`);
    }
  });

  it('STEPS.md carries exactly the manifest as its md5 table, and says nothing is installed', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    const block = /<!-- MD5S:START -->\n```\n([\s\S]*?)\n```\n<!-- MD5S:END -->/.exec(steps);
    assert.ok(block, 'md5 block present');
    assert.equal(block[1], fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trimEnd());
    for (const must of ['NOT INSTALLED', 'install.sh check', 'install.sh apply', 'install.sh restart', 'install.sh verify', 'restore', 'SAFE MODE', 'sweep-guards']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });

  it('the sweep-guards package is untouched: this package does not list its files or pin its md5s', () => {
    const sweep = fs.readFileSync(path.join(ROOT, 'docs/box-patches/2026-10-27-sweep-guards/manifest.txt'), 'utf8');
    assert.ok(!sweep.includes(want('FINAL', 'dealStages.js')), 'sweep-guards does not know the new dealStages.js');
    assert.ok(!sweep.includes(want('FINAL', 'deals_api_server.js')), 'sweep-guards does not know the live server result');
  });
});

describe('the patch', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  it('applies to the live box2 server with zero fuzz, adds exactly the import and the release block, and gives the pinned result', () => {
    const dir = tmp('pr-patch-');
    const f = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(BEFORE_SERVER, f);
    execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch')) });
    assert.equal(md5(f), want('FINAL', 'deals_api_server.js'));
    const added = fs.readFileSync(f, 'utf8').split('\n').length - fs.readFileSync(BEFORE_SERVER, 'utf8').split('\n').length;
    assert.equal(added, 19);
    const after = fs.readFileSync(f, 'utf8');
    assert.equal(after.split('import { releaseOnPick } from "./dealStages.js";').length - 1, 1);
    assert.equal(after.split('releaseOnPick(parseJsonCol(rawBefore)').length - 1, 1);
    assert.ok(after.includes('AND (stage_json <=> ?)'), 'the release is a compare-and-set, so two picks cannot both release');
    assert.ok(!fs.existsSync(f + '.rej') && !fs.existsSync(f + '.orig'));
  });

  it('the release block only runs for a non-staged request that sent a buyer contact, and never fails the pick', () => {
    const t = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'), 'utf8');
    assert.ok(t.includes('body.buyerContact && !parseJsonCol(rows[0].quote_prefs_json)?.staged'));
    assert.ok(t.includes('catch (err)') && t.includes('pick release failed'));
  });

  it('the packaged dealStages.js passes the package smoke test beside the box\'s own import', () => {
    const dir = tmp('pr-smoke-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(PKG, 'files/dealStages.js'), path.join(dir, 'dealStages.js'));
    fs.copyFileSync(path.join(SRC, 'stateTradeCredit.js'), path.join(dir, 'stateTradeCredit.js'));
    const out = execFileSync('node', [path.join(PKG, 'smoke.mjs'), dir], { encoding: 'utf8' });
    assert.match(out, /smoke ok: pick releases once/);
    assert.match(out, /null OTD stays null/);
  });
});

// ---- install.sh against a temp copy of the box ----
function fakeBox() {
  const root = tmp('pr-box-');
  const dir = path.join(root, 'src');
  fs.mkdirSync(dir);
  fs.copyFileSync(BEFORE_STAGES, path.join(dir, 'dealStages.js'));
  fs.copyFileSync(BEFORE_SERVER, path.join(dir, 'deals_api_server.js'));
  fs.copyFileSync(path.join(SRC, 'stateTradeCredit.js'), path.join(dir, 'stateTradeCredit.js'));
  const lock = path.join(root, 'deals-api-out.log');
  fs.writeFileSync(lock, '2026-11-06 06:00:00 [sync-lock] acquire box1\n2026-11-06 06:10:00 [sync-lock] release box1\n');
  return { root, dir, lock, backup: path.join(root, 'backup') };
}
const sums = (box) => Object.fromEntries(['dealStages.js', 'deals_api_server.js'].map((f) => [f, md5(path.join(box.dir, f))]));
async function install(box, mode, env = {}) {
  try {
    const r = await run('bash', [path.join(PKG, 'install.sh'), mode], { env: { ...process.env, DEALS_DIR: box.dir, BACKUP: box.backup, LOCK_LOG: box.lock, PROC_RE: 'zzz-no-such-process-zzz', ...env }, timeout: 60000 });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) { return { code: e.code ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

describe('install.sh', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  it('check passes on the live box2 starting state and changes nothing', async () => {
    const box = fakeBox();
    const before = sums(box);
    const r = await install(box, 'check');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /state: before/);
    assert.match(r.out, /smoke ok/);
    assert.match(r.out, new RegExp(`patched server: md5 ${want('FINAL', 'deals_api_server.js')}`));
    assert.match(r.out, /DRIFT CHECK PASS/);
    assert.deepEqual(sums(box), before);
    assert.ok(!fs.existsSync(box.backup), 'check takes no backup');
  });

  it('refuses when either live file has drifted; nothing is changed', async () => {
    for (const file of ['dealStages.js', 'deals_api_server.js']) {
      const box = fakeBox();
      fs.appendFileSync(path.join(box.dir, file), '\n// edited on the box\n');
      const before = sums(box);
      for (const mode of ['check', 'apply']) {
        const r = await install(box, mode);
        assert.notEqual(r.code, 0, `${file} ${mode}`);
        assert.match(r.out, /neither the pinned live pair nor the packaged pair/, r.out);
      }
      assert.deepEqual(sums(box), before);
      assert.ok(!fs.existsSync(box.backup), 'no backup on a refused apply');
    }
  });

  it('refuses a dealStages.js that already has releaseOnPick but is not the packaged file', async () => {
    const box = fakeBox();
    fs.appendFileSync(path.join(box.dir, 'dealStages.js'), '\nexport function releaseOnPick() {}\n');
    const r = await install(box, 'check');
    assert.notEqual(r.code, 0);
  });

  it('apply refuses while the sync lock is held or a sync/crawl process runs, and changes nothing', async () => {
    const box = fakeBox();
    const before = sums(box);
    fs.appendFileSync(box.lock, '2026-11-06 06:20:00 [sync-lock] acquire box3\n');
    let r = await install(box, 'apply');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /sync lock is held/);
    fs.appendFileSync(box.lock, '2026-11-06 06:30:00 [sync-lock] release box3\n');
    r = await install(box, 'apply', { PROC_RE: 'node' }); // this test run is itself a node process
    assert.notEqual(r.code, 0);
    assert.match(r.out, /process is running/);
    assert.deepEqual(sums(box), before);
    assert.ok(!fs.existsSync(box.backup));
  });

  it('apply backs up first, lands both pinned files, is idempotent; restore puts the originals back (neither restarts anything)', async () => {
    const box = fakeBox();
    const before = sums(box);
    let r = await install(box, 'apply');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FILES APPLIED/);
    assert.equal(md5(path.join(box.dir, 'dealStages.js')), want('FINAL', 'dealStages.js'));
    assert.equal(md5(path.join(box.dir, 'deals_api_server.js')), want('FINAL', 'deals_api_server.js'));
    assert.equal(md5(path.join(box.backup, 'dealStages.js')), before['dealStages.js']);
    assert.equal(md5(path.join(box.backup, 'deals_api_server.js')), before['deals_api_server.js']);
    assert.ok(fs.existsSync(path.join(box.backup, 'md5s.txt')));
    r = await install(box, 'apply');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ALREADY PATCHED/);
    r = await install(box, 'restore');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESTORED/);
    assert.deepEqual(sums(box), before);
  });

  it('restart and verify refuse unless the files are in the patched state (no pm2 is called)', async () => {
    const box = fakeBox();
    for (const mode of ['restart', 'verify']) {
      const r = await install(box, mode, { PM2: 'false' });
      assert.notEqual(r.code, 0, mode);
      assert.match(r.out, /not in the patched state/, r.out);
    }
  });

  it('an unknown mode prints the usage', async () => {
    const r = await install(fakeBox(), 'bogus');
    assert.equal(r.code, 2);
    assert.match(r.out, /usage: bash install.sh check\|apply\|restart\|verify\|restore/);
  });
});
