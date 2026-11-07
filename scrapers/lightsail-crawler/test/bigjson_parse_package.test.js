// docs/box-patches/2026-11-07-bigjson-parse-as-read-boxes-15/install.sh: the embedded file is src/bigJson.js, pins agree with the repo and the FROZEN 2026-11-06 files,
// and check / apply / restore behave on a fake box1 and box5 built from the pre-patch standalone.js fixtures plus the #721 patch (the post-#721 state the live boxes are in).
// The older packages' pins are deliberately NOT updated: they pin the old bigJson.js and must keep saying so.
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
const docs = path.resolve(crawler, '../../docs/box-patches');
const pkg = path.join(docs, '2026-11-07-bigjson-parse-as-read-boxes-15');
const deltaPkg = path.join(docs, '2026-11-06-dom-index-delta-boxes-15');
const savePkg = path.join(docs, '2026-11-06-dom-index-save-boxes-15');
const install = fs.readFileSync(path.join(pkg, 'install.sh'), 'utf8');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const pinned = (name, text = install) => text.match(new RegExp(`(?:^|\\s)${name}=([0-9a-f]{32})`))[1];
const frozenBigJson = path.join(here, 'fixtures/bigJson.2026-11-06.js');
const DEPS = ['heapGuard.js', 'dom_store.js', 'dom_index_delta.js', 'pid_lock.js', 'price_diff.js', 'date_utils.js'];

let w, fake, bk, shim;
beforeEach(() => {
  w = fs.mkdtempSync(path.join(os.tmpdir(), 'bigjsonpkg-'));
  fake = path.join(w, 'crawler'); bk = path.join(w, 'bk'); shim = path.join(w, 'shim');
  fs.mkdirSync(path.join(fake, 'src'), { recursive: true }); fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 1200\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(w, { recursive: true, force: true }));
const run = (mode) => spawnSync('bash', ['-s', '--', mode], { input: install, encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, BIGJSON_CRAWLER_DIR: fake, BIGJSON_BACKUP: bk } });
// A fake box in the post-#719/#720/#721 state: current dependency sources, the frozen old bigJson.js, and standalone.js = box fixture + the #721 patch.
function stage(box) {
  for (const f of DEPS) fs.copyFileSync(path.join(crawler, 'src', f), path.join(fake, 'src', f));
  fs.copyFileSync(frozenBigJson, path.join(fake, 'src/bigJson.js'));
  const sa = path.join(fake, 'src/standalone.js');
  fs.copyFileSync(path.join(here, 'fixtures', `${box}-standalone.before-2026-11-06.js`), sa);
  const r = spawnSync('patch', ['-F0', '-s', sa, path.join(deltaPkg, `standalone.js.${box === 'box1' ? 'b1' : 'b5'}.patch`)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
}

describe('bigjson-parse-as-read package', () => {
  it('embeds exactly src/bigJson.js; pins agree with the repo, the frozen old file and the 2026-11-06 packages', () => {
    const b64 = install.match(/<<'BJEOF'\n([\s\S]*?)\nBJEOF/)[1];
    const src = fs.readFileSync(path.join(crawler, 'src/bigJson.js'));
    assert.ok(Buffer.from(b64, 'base64').equals(src), 'embedded bigJson.js differs from src/bigJson.js: run build-install.py');
    assert.equal(pinned('BJ_AFTER'), md5(src));
    assert.equal(pinned('BJ_BEFORE'), md5(fs.readFileSync(frozenBigJson)));
    assert.notEqual(pinned('BJ_BEFORE'), pinned('BJ_AFTER'));
    for (const [name, file] of [['HG_MD5', 'heapGuard.js'], ['DS_MD5', 'dom_store.js'], ['DD_MD5', 'dom_index_delta.js'], ['PL_MD5', 'pid_lock.js']]) assert.equal(pinned(name), md5(fs.readFileSync(path.join(crawler, 'src', file))), name);
    // the historical packages keep the OLD pin: never rewritten to imply they installed the new file
    assert.equal(pinned('BJ_MD5', fs.readFileSync(path.join(savePkg, 'install.sh'), 'utf8')), pinned('BJ_BEFORE'));
    assert.equal(pinned('BJ_MD5', fs.readFileSync(path.join(deltaPkg, 'install.sh'), 'utf8')), pinned('BJ_BEFORE'));
    const dl = fs.readFileSync(path.join(deltaPkg, 'install.sh'), 'utf8');
    assert.equal(pinned('SA_B1'), pinned('B1_SA_AFTER', dl)); assert.equal(pinned('SA_B5'), pinned('B5_SA_AFTER', dl));
  });

  for (const box of ['box1', 'box5']) {
    it(`${box}: check changes nothing, apply installs the pinned file, a second apply is a no-op, restore puts the original back`, () => {
      stage(box);
      const bj = path.join(fake, 'src/bigJson.js');
      let r = run('check');
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /trial ok/);
      assert.equal(md5(fs.readFileSync(bj)), pinned('BJ_BEFORE'), 'check must not change bigJson.js'); assert.equal(fs.existsSync(bk), false);
      r = run('apply');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(md5(fs.readFileSync(bj)), pinned('BJ_AFTER'));
      r = run('apply'); assert.equal(r.status, 0); assert.match(r.stdout, /ALREADY INSTALLED/);
      r = run('restore');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(md5(fs.readFileSync(bj)), pinned('BJ_BEFORE'));
    });
  }

  it('apply never touches data/ (dom_index.json stays byte-identical)', () => {
    stage('box1');
    const data = path.join(fake, 'data/dom_index.json'); fs.mkdirSync(path.dirname(data)); fs.writeFileSync(data, '{"V1":{"2026-11-01":{"hash":"h"}}}');
    assert.equal(run('apply').status, 0);
    assert.equal(fs.readFileSync(data, 'utf8'), '{"V1":{"2026-11-01":{"hash":"h"}}}');
    assert.deepEqual(fs.readdirSync(path.dirname(data)), ['dom_index.json']);
  });

  it('the older packages refuse once the new bigJson.js is installed (intended), while their restore does not look at it', () => {
    stage('box1');
    assert.equal(run('apply').status, 0);
    const r = spawnSync('bash', ['-s', '--', 'check'], { input: fs.readFileSync(path.join(deltaPkg, 'install.sh'), 'utf8'), encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, DOMDELTA_CRAWLER_DIR: fake, DOMDELTA_BACKUP: bk + '-delta' } });
    assert.equal(r.status, 1); assert.match(r.stderr, /bigJson\.js md5 is not the pinned/);
  });

  it('refuses: unknown bigJson.js, a missing/unknown prerequisite, outside 07:00-21:30 ET, a crawl running', () => {
    stage('box1');
    const bj = path.join(fake, 'src/bigJson.js'); const good = fs.readFileSync(bj);
    fs.writeFileSync(bj, '// some other version\n');
    let r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /not a known state/);
    fs.writeFileSync(bj, good);
    fs.writeFileSync(path.join(fake, 'src/dom_index_delta.js'), '// old\n');
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /#721 file/);
    fs.copyFileSync(path.join(crawler, 'src/dom_index_delta.js'), path.join(fake, 'src/dom_index_delta.js'));
    fs.rmSync(path.join(fake, 'src/heapGuard.js'));
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /heapGuard\.js not found/);
    fs.copyFileSync(path.join(crawler, 'src/heapGuard.js'), path.join(fake, 'src/heapGuard.js'));
    fs.appendFileSync(path.join(fake, 'src/standalone.js'), '\n// drift\n');
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /standalone\.js md5/);
    stage('box1'); fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 2315\n', { mode: 0o755 });
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /installs only 07:00-21:30/);
  });
});
