// The box2 buyer-contact reveal package (docs/box-patches/2026-10-30-buyer-contact-reveal/): the server patch against the committed box2 snapshots (four accepted
// starting files, zero fuzz, pinned results), and install.sh check|apply|restart|restore run end to end against a temp copy of the box. Nothing here touches a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-30-buyer-contact-reveal');
const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-29-box2-deals-api');
const STATS = path.join(ROOT, 'docs/box-patches/2026-10-29-stats-cache-warm');
const SRC = path.join(ROOT, 'scrapers/lightsail-crawler/src');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const rows = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => rows.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0 || spawnSync('patch', ['-v']).status === 0;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const snapshot = (name) => path.join(SNAP, name);
const STARTS = [
  { key: 'deals_api_server.js@live-2026-10-29', make: (f) => fs.copyFileSync(snapshot('deals_api_server.31d527ba.js.txt'), f) },
  { key: 'deals_api_server.js@after-crawl-stamps', make: (f) => fs.copyFileSync(snapshot('deals_api_server.400e943b.js.txt'), f) },
  { key: 'deals_api_server.js@after-stats-warm', make: (f) => { fs.copyFileSync(snapshot('deals_api_server.31d527ba.js.txt'), f); execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: fs.readFileSync(path.join(STATS, 'deals_api_server.js.patch')) }); } },
  { key: 'deals_api_server.js@after-crawl-stamps-and-stats-warm', make: (f) => { fs.copyFileSync(snapshot('deals_api_server.400e943b.js.txt'), f); execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: fs.readFileSync(path.join(STATS, 'deals_api_server.after-crawl-stamps.js.patch')) }); } },
];

describe('manifest, STEPS.md and the files agree', () => {
  it('every PACKAGE md5 is the file in this checkout, and the AFTER files are the repo crawler sources', () => {
    for (const m of rows.filter((x) => x.role === 'PACKAGE')) assert.equal(m.sum, md5(path.join(PKG, m.file)), `${m.file} changed after the manifest was written`);
    assert.equal(want('AFTER', 'dealStages.js'), md5(path.join(SRC, 'dealStages.js')), 'files/dealStages.js must be the repo source');
    assert.equal(want('AFTER', 'rfqContactReveal.js'), md5(path.join(SRC, 'rfqContactReveal.js')), 'files/rfqContactReveal.js must be the repo source');
  });
  it('the BEFORE dealStages.js fixture and the BASE snapshots are what the manifest pins', () => {
    assert.equal(md5(path.join(PKG, 'fixtures/dealStages.box-before.js')), want('BEFORE', 'dealStages.js'));
    assert.equal(md5(snapshot('deals_api_server.31d527ba.js.txt')), want('BASE', STARTS[0].key));
    assert.equal(md5(snapshot('deals_api_server.400e943b.js.txt')), want('BASE', STARTS[1].key));
  });
  it('install.sh pins every md5 in the manifest', () => {
    const sh = fs.readFileSync(path.join(PKG, 'install.sh'), 'utf8');
    for (const m of rows.filter((x) => x.sum !== '-' && x.role !== 'PACKAGE' || x.file === 'deals_api_server.js.patch')) assert.ok(sh.includes(m.sum), `install.sh pins ${m.sum} (${m.role} ${m.file})`);
  });
  it('STEPS.md names every md5, the commands, the gates and the rollback', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const m of rows.filter((x) => x.sum !== '-')) assert.ok(steps.includes(m.sum), `STEPS.md mentions ${m.sum} (${m.role} ${m.file})`);
    for (const must of ['NOTHING IS INSTALLED', 'four accepted starting files', 'by the live md5', 'install.sh check', 'install.sh apply', 'install.sh restart', 'install.sh restore', 'sudo -u ubuntu pm2 restart deals-api', 'backup first', 'zero fuzz', 'Rollback', '[sync-lock]']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });
});

describe('deals_api_server.js patch', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  for (const s of STARTS) {
    it(`${s.key}: applies with zero fuzz, gives the pinned result, parses, and wires the route once`, () => {
      const dir = tmp('bcr-patch-');
      const f = path.join(dir, 'deals_api_server.js');
      s.make(f);
      assert.equal(md5(f), want('BASE', s.key), 'starting file');
      const p = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'));
      execFileSync('patch', ['-F0', '--dry-run', '-s', f], { input: p });
      execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
      assert.equal(md5(f), want('RESULT', s.key));
      assert.deepEqual(fs.readdirSync(dir), ['deals_api_server.js'], 'no .rej or .orig left');
      const src = fs.readFileSync(f, 'utf8');
      assert.equal(src.split('import { createRfqContactRevealHandler } from "./rfqContactReveal.js";').length - 1, 1);
      assert.equal(src.split('const handleRfqContactReveal = createRfqContactRevealHandler(').length - 1, 1);
      assert.equal(src.split('run(handleRfqContactReveal,').length - 1, 1);
      assert.ok(src.includes('/reveal-contact$/'));
      execFileSync(process.execPath, ['--check', f]);
    });
  }
});

// ---- install.sh against a temp copy of the box ----
function fakeBox(start = STARTS[0]) {
  const root = tmp('bcr-box-');
  const dir = path.join(root, 'src');
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(PKG, 'fixtures/dealStages.box-before.js'), path.join(dir, 'dealStages.js'));
  fs.copyFileSync(path.join(SRC, 'rfqStages.js'), path.join(dir, 'rfqStages.js'));
  start.make(path.join(dir, 'deals_api_server.js'));
  const lock = path.join(root, 'deals-api-out.log');
  fs.writeFileSync(lock, '2026-10-30 06:00:00 [sync-lock] acquire box1\n2026-10-30 06:10:00 [sync-lock] release box1\n');
  return { root, dir, lock, backup: path.join(root, 'backup') };
}
const sums = (box) => Object.fromEntries(['dealStages.js', 'rfqContactReveal.js', 'deals_api_server.js'].map((f) => [f, fs.existsSync(path.join(box.dir, f)) ? md5(path.join(box.dir, f)) : null]));
async function install(box, mode, env = {}) {
  try {
    const r = await run('bash', [path.join(PKG, 'install.sh'), mode], { env: { ...process.env, DEALS_DIR: box.dir, BACKUP: box.backup, LOCK_LOG: box.lock, PROC_RE: 'zzz-no-such-process-zzz', ...env }, timeout: 60000 });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) { return { code: e.code ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

describe('install.sh', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  it('check passes on the live-2026-10-29 starting state and changes nothing', async () => {
    const box = fakeBox();
    const before = sums(box);
    const r = await install(box, 'check');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DRIFT CHECK PASS/);
    assert.match(r.out, /patched server: md5 9ddd12a80e9e3c9bffcb23fdc4797e01/);
    assert.deepEqual(sums(box), before);
    assert.ok(!fs.existsSync(box.backup), 'check takes no backup');
  });

  it('refuses when an md5 has drifted: dealStages.js edited, or an unknown server file; nothing is changed', async () => {
    for (const [file, text] of [['dealStages.js', '\n// edited on the box\n'], ['deals_api_server.js', '\n// edited on the box\n']]) {
      const box = fakeBox();
      fs.appendFileSync(path.join(box.dir, file), text);
      const before = sums(box);
      for (const mode of ['check', 'apply']) {
        const r = await install(box, mode);
        assert.notEqual(r.code, 0, `${file} ${mode}`);
        assert.match(r.out, /neither the expected before/, r.out);
      }
      assert.deepEqual(sums(box), before);
      assert.ok(!fs.existsSync(box.backup), 'no backup on a refused apply');
    }
  });

  it('apply refuses while the sync lock is held or a sync/crawl process runs, and changes nothing', async () => {
    const box = fakeBox();
    const before = sums(box);
    fs.appendFileSync(box.lock, '2026-10-30 06:20:00 [sync-lock] acquire box3\n');
    let r = await install(box, 'apply');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /sync lock is held/);
    fs.appendFileSync(box.lock, '2026-10-30 06:30:00 [sync-lock] release box3\n');
    r = await install(box, 'apply', { PROC_RE: 'node' }); // this test run is itself a node process
    assert.notEqual(r.code, 0);
    assert.match(r.out, /process is running/);
    assert.deepEqual(sums(box), before);
    assert.ok(!fs.existsSync(box.backup));
  });

  for (const s of STARTS) {
    it(`apply (${s.key}): backup first, three files at their pinned md5s, smoke ok, a second apply is a no-op, restore puts every byte back`, async () => {
      const box = fakeBox(s);
      const before = sums(box);
      assert.equal(before['dealStages.js'], want('BEFORE', 'dealStages.js'));
      assert.equal(before['deals_api_server.js'], want('BASE', s.key));
      let r = await install(box, 'apply');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /FILES APPLIED/);
      assert.match(r.out, /smoke ok/);
      assert.deepEqual(sums(box), { 'dealStages.js': want('AFTER', 'dealStages.js'), 'rfqContactReveal.js': want('AFTER', 'rfqContactReveal.js'), 'deals_api_server.js': want('RESULT', s.key) });
      // the backup holds the starting bytes and an md5 list, and was taken before anything was copied
      assert.equal(md5(path.join(box.backup, 'dealStages.js')), before['dealStages.js']);
      assert.equal(md5(path.join(box.backup, 'deals_api_server.js')), before['deals_api_server.js']);
      assert.match(fs.readFileSync(path.join(box.backup, 'md5s.txt'), 'utf8'), new RegExp(before['deals_api_server.js']));
      assert.match(fs.readFileSync(path.join(box.backup, 'absent.txt'), 'utf8'), /rfqContactReveal\.js/);
      assert.ok(fs.existsSync(path.join(box.backup)) && r.out.indexOf(before['deals_api_server.js']) < r.out.indexOf('FILES APPLIED'), 'backup md5s are printed before the apply finishes');
      r = await install(box, 'apply');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /ALREADY PATCHED/);
      r = await install(box, 'restore');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /RESTORED/);
      assert.deepEqual(sums(box), before);
    });
  }

  it('apply refuses to run over an earlier backup', async () => {
    const box = fakeBox();
    assert.equal((await install(box, 'apply')).code, 0);
    assert.equal((await install(box, 'restore')).code, 0);
    const r = await install(box, 'apply');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /already exists/);
  });

  it('the modules the box already has still load beside the new dealStages.js (the smoke test imports rfqStages.js against it)', () => {
    const dir = tmp('bcr-smoke-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['dealStages.js', 'rfqContactReveal.js']) fs.copyFileSync(path.join(PKG, 'files', f), path.join(dir, f));
    fs.copyFileSync(path.join(SRC, 'rfqStages.js'), path.join(dir, 'rfqStages.js'));
    const out = execFileSync(process.execPath, [path.join(PKG, 'smoke.mjs'), dir]).toString();
    assert.match(out, /smoke ok/);
  });

  describe('restart (pm2 and the API stubbed)', () => {
    function stubPm2(box) {
      const state = path.join(box.root, 'pm2-uptime');
      fs.writeFileSync(state, '1000');
      const stub = path.join(box.root, 'pm2stub.sh');
      fs.writeFileSync(stub, `#!/bin/bash
S=${state}
case "$1" in
  describe) exit 0;;
  restart) echo $(( $(cat $S) + 1 )) > $S; exit 0;;
  jlist) echo "[{\\"name\\":\\"deals-api\\",\\"pm2_env\\":{\\"status\\":\\"online\\",\\"pm_uptime\\":$(cat $S),\\"restart_time\\":0}}]";;
esac
`);
      fs.chmodSync(stub, 0o755);
      return `bash ${stub}`;
    }
    async function withApi(routeStatus, fn) {
      const server = http.createServer((req, res) => { res.statusCode = req.url === '/health' ? 401 : routeStatus; res.end(); });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
    }

    it('refuses before apply, restarts after it, and the route answering 401 passes while 404 fails with a rollback', async () => {
      const box = fakeBox();
      const PM2 = stubPm2(box);
      let r = await install(box, 'restart', { PM2 });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /not in the patched state/);
      assert.equal((await install(box, 'apply')).code, 0);
      r = await withApi(401, (API) => install(box, 'restart', { PM2, API }));
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /online 1001/);
      assert.match(r.out, /reveal-contact without the key -> 401/);
      assert.match(r.out, /RESTARTED/);
      assert.match(r.out, /ROLLBACK: .*install\.sh restore && .*restart deals-api/);
      r = await withApi(404, (API) => install(box, 'restart', { PM2, API }));
      assert.notEqual(r.code, 0);
      assert.match(r.out, /answers 404 - roll back NOW/);
    });

    it('restart refuses while the sync lock is held', async () => {
      const box = fakeBox();
      const PM2 = stubPm2(box);
      assert.equal((await install(box, 'apply')).code, 0);
      fs.appendFileSync(box.lock, '2026-10-30 07:00:00 [sync-lock] acquire box2\n');
      const r = await install(box, 'restart', { PM2 });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /sync lock is held/);
    });
  });
});
