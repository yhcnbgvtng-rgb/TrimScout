// docs/box-patches/2026-11-06-dom-index-delta-boxes-15/install.sh: embedded files == the sources, pins agree with the repo and with the live files' md5s, and
// check / apply / restore behave on a fake box1 and a fake box5 built from the real live (post-#719/#720) standalone.js of each. The time-of-day gate is satisfied
// with a PATH shim for `date`, never by a switch in the script.
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
const pkg = path.resolve(crawler, '../../docs/box-patches/2026-11-06-dom-index-delta-boxes-15');
const install = fs.readFileSync(path.join(pkg, 'install.sh'), 'utf8');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const pinned = (name) => install.match(new RegExp(`(?:^|\\s)${name}=([0-9a-f]{32})`))[1];
const embedded = (tag) => Buffer.from(install.match(new RegExp(`<<'${tag}'\\n([\\s\\S]*?)\\n${tag}`))[1], 'base64');
const SRC_FILES = ['dom_store.js', 'bigJson.js', 'heapGuard.js', 'shared_data_lock.js', 'pid_lock.js', 'price_diff.js', 'date_utils.js']; // shared_data_lock.js is only there because standalone.js (untouched) imports it

let w, fake, bk, shim;
beforeEach(() => {
  w = fs.mkdtempSync(path.join(os.tmpdir(), 'domdeltapkg-'));
  fake = path.join(w, 'crawler'); bk = path.join(w, 'bk'); shim = path.join(w, 'shim');
  fs.mkdirSync(path.join(fake, 'src'), { recursive: true }); fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 1200\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(w, { recursive: true, force: true }));
const run = (mode) => spawnSync('bash', ['-s', '--', mode], { input: install, encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, DOMDELTA_CRAWLER_DIR: fake, DOMDELTA_BACKUP: bk } });
const stage = (box) => {
  for (const f of SRC_FILES) fs.copyFileSync(path.join(crawler, 'src', f), path.join(fake, 'src', f));
  fs.copyFileSync(path.join(here, 'fixtures', `${box}-standalone.before-2026-11-06.js`), path.join(fake, 'src/standalone.js'));
};

describe('dom-index-delta package', () => {
  it('embeds exactly src/dom_index_delta.js and both patches; pins match the repo copies of the dependencies', () => {
    const src = fs.readFileSync(path.join(crawler, 'src/dom_index_delta.js'));
    assert.ok(embedded('DDEOF').equals(src), 'embedded dom_index_delta.js differs from src: run build-install.py');
    assert.equal(pinned('DD_MD5'), md5(src));
    assert.ok(embedded('P1EOF').equals(fs.readFileSync(path.join(pkg, 'standalone.js.b1.patch'))));
    assert.ok(embedded('P5EOF').equals(fs.readFileSync(path.join(pkg, 'standalone.js.b5.patch'))));
    assert.equal(pinned('DS_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/dom_store.js'))));
    assert.equal(pinned('BJ_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/bigJson.js'))));
    assert.equal(pinned('HG_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/heapGuard.js'))));
    assert.equal(pinned('PL_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/pid_lock.js'))));
    for (const box of ['box1', 'box5']) assert.equal(md5(fs.readFileSync(path.join(here, 'fixtures', `${box}-standalone.before-2026-11-06.js`))), pinned(box === 'box1' ? 'B1_SA' : 'B5_SA'));
  });

  for (const box of ['box1', 'box5']) {
    it(`${box}: check changes nothing, apply installs the pinned files, a second apply is a no-op, restore puts the original back`, () => {
      stage(box);
      const before = md5(fs.readFileSync(path.join(fake, 'src/standalone.js')));
      const key = box === 'box1' ? 'B1' : 'B5';
      let r = run('check');
      assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /trial ok/);
      assert.equal(md5(fs.readFileSync(path.join(fake, 'src/standalone.js'))), before, 'check must not change standalone.js');
      assert.equal(fs.existsSync(path.join(fake, 'src/dom_index_delta.js')), false); assert.equal(fs.existsSync(bk), false);
      r = run('apply');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(md5(fs.readFileSync(path.join(fake, 'src/standalone.js'))), pinned(`${key}_SA_AFTER`));
      assert.equal(md5(fs.readFileSync(path.join(fake, 'src/dom_index_delta.js'))), pinned('DD_MD5'));
      r = run('apply'); assert.equal(r.status, 0); assert.match(r.stdout, /ALREADY INSTALLED/);
      r = run('restore');
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(md5(fs.readFileSync(path.join(fake, 'src/standalone.js'))), before);
      assert.equal(fs.existsSync(path.join(fake, 'src/dom_index_delta.js')), false);
    });
  }

  it('restore warns, and keeps the files, when unmerged delta files exist', () => {
    stage('box1');
    assert.equal(run('apply').status, 0);
    const dir = path.join(fake, 'data/dom_index_delta'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'delta-123-1.json'), '{"entries":{}}');
    const r = run('restore');
    assert.equal(r.status, 0); assert.match(r.stderr, /1 unmerged delta file/);
    assert.ok(fs.existsSync(path.join(dir, 'delta-123-1.json')));
  });

  it('refuses: unknown standalone.js, #720 not installed, outside 07:00-21:30 ET, a patch that no longer applies', () => {
    stage('box1');
    fs.writeFileSync(path.join(fake, 'src/standalone.js'), '// some other version\n');
    let r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /not a known state/);
    stage('box1'); fs.writeFileSync(path.join(fake, 'src/dom_store.js'), '// old\n');
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /install #720 first/);
    stage('box1'); fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 2315\n', { mode: 0o755 });
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /installs only 07:00-21:30/);
  });
});
