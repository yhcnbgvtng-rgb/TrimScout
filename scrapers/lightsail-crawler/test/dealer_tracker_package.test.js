// docs/box-patches/2026-11-07-dealer-tracker-boxes-15/install.sh: embedded files == the sources, pins agree with the repo and with the live files' md5s,
// the patches only ADD lines (plus one same-behaviour catch), every identifier a hook reads exists, and check / apply / restore behave on a fake box1 and a
// fake box5 built from the real live (post-#721) standalone.js of each. Works with the pre-#726 bigJson.js, the #726 one, and neither: the tracker never uses it.
// The time-of-day gate is satisfied with a PATH shim for `date`, never by a switch in the script.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crawler = path.resolve(here, '..');
const pkg = path.resolve(crawler, '../../docs/box-patches/2026-11-07-dealer-tracker-boxes-15');
const install = fs.readFileSync(path.join(pkg, 'install.sh'), 'utf8');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const pinned = (name) => install.match(new RegExp(`(?:^|\\s)${name}=([0-9a-f]{32})`))[1];
const embedded = (tag) => Buffer.from(install.match(new RegExp(`<<'${tag}'\\n([\\s\\S]*?)\\n${tag}`))[1], 'base64');
const fixture = (box) => path.join(here, 'fixtures', `${box}-standalone.post721-2026-11-07.js`);
const HOOKS = ['createDealerTracker', 'begin', 'endProbeSkip', 'noUrls', 'discovered', 'urlStart', 'pageBlocked', 'pageSkipped', 'urlError', 'vehicle', 'error', 'end', 'runEnd'];

let w, fake, bk, shim;
beforeEach(() => {
  w = fs.mkdtempSync(path.join(os.tmpdir(), 'dtrackpkg-'));
  fake = path.join(w, 'crawler'); bk = path.join(w, 'bk'); shim = path.join(w, 'shim');
  fs.mkdirSync(path.join(fake, 'src'), { recursive: true }); fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 1200\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(w, { recursive: true, force: true }));
const run = (mode, extraEnv = {}) => spawnSync('bash', ['-s', '--', mode], { input: install, encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, DTRACK_CRAWLER_DIR: fake, DTRACK_BACKUP: bk, ...extraEnv } });
const stage = (box, bigJson = path.join(crawler, 'src/bigJson.js')) => {
  for (const f of ['heapGuard.js', 'dom_index_delta.js', 'dom_store.js']) fs.copyFileSync(path.join(crawler, 'src', f), path.join(fake, 'src', f));
  fs.copyFileSync(bigJson, path.join(fake, 'src/bigJson.js'));
  fs.copyFileSync(fixture(box), path.join(fake, 'src/standalone.js'));
};
const sa = () => md5(fs.readFileSync(path.join(fake, 'src/standalone.js')));

describe('dealer-tracker package: contents', () => {
  it('embeds exactly src/dealerTracker.js and both patches; pins match the repo copies and the live fixtures', () => {
    const src = fs.readFileSync(path.join(crawler, 'src/dealerTracker.js'));
    assert.ok(embedded('DTEOF').equals(src), 'embedded dealerTracker.js differs from src: run docs/box-patches/2026-11-07-dealer-tracker-boxes-15/build-install.py');
    assert.equal(pinned('DT_MD5'), md5(src));
    assert.ok(embedded('P1EOF').equals(fs.readFileSync(path.join(pkg, 'standalone.js.b1.patch'))));
    assert.ok(embedded('P5EOF').equals(fs.readFileSync(path.join(pkg, 'standalone.js.b5.patch'))));
    assert.equal(pinned('HG_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/heapGuard.js'))), '#719 heapGuard.js');
    assert.equal(pinned('DD_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/dom_index_delta.js'))), '#721 dom_index_delta.js');
    assert.equal(pinned('BJ_OLD'), md5(fs.readFileSync(path.join(crawler, 'src/bigJson.js'))));
    assert.equal(pinned('BJ_726'), md5(fs.readFileSync(path.join(here, 'fixtures/bigJson.pr726.js'))), '#726 bigJson.js candidate');
    assert.equal(md5(fs.readFileSync(fixture('box1'))), pinned('B1_SA'));
    assert.equal(md5(fs.readFileSync(fixture('box5'))), pinned('B5_SA'));
  });

  for (const box of ['box1', 'box5']) {
    it(`${box}: the patch applies with zero fuzz, only adds lines (one catch aside), parses, and the guards and merge code of #719/#721 are untouched`, () => {
      const t = path.join(w, box); fs.mkdirSync(t);
      fs.copyFileSync(fixture(box), path.join(t, 'standalone.js'));
      const key = box === 'box1' ? 'b1' : 'b5';
      const r = spawnSync('patch', ['-F0', '-s', 'standalone.js', path.join(pkg, `standalone.js.${key}.patch`)], { cwd: t, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const before = fs.readFileSync(fixture(box), 'utf8').split('\n');
      const after = fs.readFileSync(path.join(t, 'standalone.js'), 'utf8').split('\n');
      assert.equal(md5(fs.readFileSync(path.join(t, 'standalone.js'))), pinned(key === 'b1' ? 'B1_SA_AFTER' : 'B5_SA_AFTER'));
      // every original line still there, in order, as a subsequence; the only original line that is gone is the swallow-all catch (replaced, not removed)
      let j = 0; const missing = [];
      for (const line of before) { while (j < after.length && after[j] !== line) j++; if (j === after.length) { missing.push(line); j = 0; } else j++; }
      assert.ok(missing.length <= 1, `original lines changed or removed: ${JSON.stringify(missing)}`);
      assert.ok(missing.length === 0 || missing[0] === '            } catch {}');
      const patchText = fs.readFileSync(path.join(pkg, `standalone.js.${key}.patch`), 'utf8').split('\n');
      assert.equal(patchText.filter((l) => /^-[^-]/.test(l)).length, 1);
      assert.equal(patchText.filter((l) => /^\+[^+]/.test(l)).length, after.length - before.length + 1);
      // the code from #719 (heap guard) and #721 (delta merge) and the sold/sweep bookkeeping are all still there, once each
      const text = after.join('\n');
      for (const needle of ['heapStopped = true;', 'formatHeapStopLine(', 'failedDealerNames.add(dealer.name);', 'await mergeDomDelta(domDelta)', 'checkpointDomDelta(domDelta)', 'domDelta.note(domIndex, vehicle.vin, todayDate)']) {
        assert.equal(text.split(needle).length, fixtureCount(box, needle), `${needle} count changed`);
      }
      fs.copyFileSync(path.join(t, 'standalone.js'), path.join(t, 'check.mjs'));
      const c = spawnSync(process.execPath, ['--check', path.join(t, 'check.mjs')], { encoding: 'utf8' });
      assert.equal(c.status, 0, c.stderr);
      // every hook the file calls exists on the tracker, and every identifier a hook reads is declared in the file
      const used = new Set([...text.matchAll(/dealerTrack\.(\w+)\(/g)].map((m) => m[1]));
      for (const h of used) assert.ok(HOOKS.includes(h), `unknown hook ${h}`);
      assert.deepEqual([...used].sort(), HOOKS.filter((h) => h !== 'createDealerTracker').sort());
      for (const id of ['failedDealerNames', 'heapGuard', 'dealerTimedOut', 'heapStopped', 'todayDate', 'brand', 'state', 'work', 'botProbe', 'discovery']) assert.match(text, new RegExp(`(const|let) (\\{[^}]*\\b)?${id}\\b`), `${id} not declared`);
    });
  }

  it('the repo standalone.js carries the same hooks as the box patches', () => {
    const main = fs.readFileSync(path.join(crawler, 'src/standalone.js'), 'utf8');
    const box = fs.readFileSync(fixture('box1'), 'utf8');
    const hooks = (t) => [...t.matchAll(/dealerTrack\.(\w+)\(/g)].map((m) => m[1]).sort().join(',');
    assert.match(main, /import \{ createDealerTracker \} from '\.\/dealerTracker\.js';/);
    assert.equal(hooks(main), hooks(spawnSync('python3', [path.join(pkg, 'mkpatch.py'), fixture('box1'), '/dev/stdout'], { encoding: 'utf8' }).stdout));
    assert.ok(box.length > 0);
  });
});

function fixtureCount(box, needle) { return fs.readFileSync(fixture(box), 'utf8').split(needle).length; }

describe('dealer-tracker package: install.sh on a fake box', () => {
  for (const box of ['box1', 'box5']) {
    it(`${box}: check changes nothing, apply installs the pinned files, a second apply is a no-op, restore puts the original back`, () => {
      stage(box);
      const before = sa(); const key = box === 'box1' ? 'B1' : 'B5';
      let r = run('check');
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /trial ok/);
      assert.equal(sa(), before, 'check must not change standalone.js');
      assert.equal(fs.existsSync(path.join(fake, 'src/dealerTracker.js')), false); assert.equal(fs.existsSync(bk), false);
      assert.equal(fs.existsSync(path.join(fake, 'data')), false, 'check must not create data/');
      r = run('apply');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(sa(), pinned(`${key}_SA_AFTER`));
      assert.equal(md5(fs.readFileSync(path.join(fake, 'src/dealerTracker.js'))), pinned('DT_MD5'));
      assert.equal(md5(fs.readFileSync(path.join(bk, 'standalone.js.before'))), before);
      for (const f of ['heapGuard.js', 'dom_index_delta.js', 'dom_store.js', 'bigJson.js']) assert.equal(md5(fs.readFileSync(path.join(fake, 'src', f))), md5(fs.readFileSync(path.join(crawler, 'src', f))), `${f} must be untouched`);
      r = run('apply');
      assert.equal(r.status, 0); assert.match(r.stdout, /ALREADY INSTALLED/);
      r = run('restore');
      assert.equal(r.status, 0, r.stderr); assert.equal(sa(), before);
      assert.equal(fs.existsSync(path.join(fake, 'src/dealerTracker.js')), false);
    });
  }

  it('works whichever bigJson.js the box has: pre-#726, the #726 file, or something else', () => {
    for (const [name, file] of [['pre', path.join(crawler, 'src/bigJson.js')], ['726', path.join(here, 'fixtures/bigJson.pr726.js')]]) {
      stage('box5', file);
      const r = run('check'); assert.equal(r.status, 0, name + r.stderr + r.stdout); assert.match(r.stdout, name === 'pre' ? /pre-#726/ : /is the #726 file/);
    }
    fs.writeFileSync(path.join(fake, 'src/bigJson.js'), '// something newer\n');
    const r = run('check'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /neither/);
  });

  it('applies on top of #726 installed, and the order does not matter to the tracker', () => {
    stage('box1', path.join(here, 'fixtures/bigJson.pr726.js'));
    assert.equal(run('apply').status, 0);
    assert.equal(md5(fs.readFileSync(path.join(fake, 'src/bigJson.js'))), pinned('BJ_726'));
  });

  it('refuses, and writes nothing, on an unknown standalone.js, a changed #719/#721 file, a running crawl, or a night-time clock', () => {
    stage('box1');
    fs.appendFileSync(path.join(fake, 'src/standalone.js'), '\n// drift\n');
    let r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /not a known state/);
    stage('box1'); fs.appendFileSync(path.join(fake, 'src/heapGuard.js'), '\n// drift\n');
    r = run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /heapGuard\.js md5/);
    stage('box1'); fs.appendFileSync(path.join(fake, 'src/dom_index_delta.js'), '\n// drift\n');
    r = run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /dom_index_delta\.js md5/);
    stage('box1');
    fs.writeFileSync(path.join(shim, 'pgrep'), '#!/bin/bash\necho "4242 node src/standalone.js"\n', { mode: 0o755 });
    r = run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /crawl or sync is running/);
    fs.rmSync(path.join(shim, 'pgrep'));
    fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 2301\n', { mode: 0o755 });
    r = run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /installs only 07:00-21:30/);
    assert.equal(fs.existsSync(path.join(fake, 'src/dealerTracker.js')), false); assert.equal(fs.existsSync(bk), false);
    assert.equal(sa(), pinned('B1_SA'));
  });

  it('refuses to overwrite an earlier backup and leaves the box as it was', () => {
    stage('box5'); fs.mkdirSync(bk); fs.writeFileSync(path.join(bk, 'md5s-before.txt'), 'x  standalone.js\n');
    let r = run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /already holds a backup/);
    assert.equal(sa(), pinned('B5_SA'));
  });

  it('after apply, the tracker module writes records through the real installed file', () => {
    stage('box5'); assert.equal(run('apply').status, 0);
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createDealerTracker } from ${JSON.stringify('file://' + path.join(fake, 'src/dealerTracker.js'))};
      const t = createDealerTracker({ cwd: ${JSON.stringify(fake)}, runDate: '2026-11-08', state: 'TX', brand: 'Infiniti' });
      t.begin({ id: 'a', name: 'A' }, {}); t.end(() => ({})); t.runEnd();`], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(fs.existsSync(path.join(fake, 'data/dealer_tracker/crawl-2026-11-08.jsonl')));
  });
});
