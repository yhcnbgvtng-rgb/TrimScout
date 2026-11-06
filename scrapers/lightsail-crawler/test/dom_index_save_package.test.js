// The box package docs/box-patches/2026-11-06-dom-index-save-boxes-15/install.sh: embedded file == src/dom_store.js, pinned md5s agree, and check / apply /
// restore behave on a fake crawler dir (the time-of-day gate is satisfied with a PATH shim for `date`, never by a switch in the script).
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
const pkg = path.resolve(crawler, '../../docs/box-patches/2026-11-06-dom-index-save-boxes-15');
const install = fs.readFileSync(path.join(pkg, 'install.sh'), 'utf8');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const pinned = (name) => install.match(new RegExp(`${name}=([0-9a-f]{32})`))[1];

let w, fake, bk, shim;
beforeEach(() => {
  w = fs.mkdtempSync(path.join(os.tmpdir(), 'domsavepkg-'));
  fake = path.join(w, 'crawler'); bk = path.join(w, 'bk'); shim = path.join(w, 'shim');
  fs.mkdirSync(path.join(fake, 'src'), { recursive: true }); fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 1200\n', { mode: 0o755 }); // "12:00 ET"
});
afterEach(() => fs.rmSync(w, { recursive: true, force: true }));

const run = (mode, extraEnv = {}) => spawnSync('bash', ['-s', '--', mode], {
  input: install, encoding: 'utf8',
  env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, DOMSAVE_CRAWLER_DIR: fake, DOMSAVE_BACKUP: bk, ...extraEnv },
});
const stageBefore = () => fs.readFileSync(path.join(here, 'fixtures/dom_store.before-2026-11-06.js')); // the file on box1/box5 after #719 (md5 pinned in install.sh)

describe('dom-index-save package', () => {
  it('embeds exactly src/dom_store.js and pins its md5', () => {
    const b64 = install.match(/<<'DSEOF'\n([\s\S]*?)\nDSEOF/)[1];
    const embedded = Buffer.from(b64, 'base64');
    const src = fs.readFileSync(path.join(crawler, 'src/dom_store.js'));
    assert.ok(embedded.equals(src), 'embedded dom_store.js differs from src/dom_store.js: rebuild install.sh from install.template.sh');
    assert.equal(pinned('DS_AFTER'), md5(src));
    assert.equal(pinned('BJ_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/bigJson.js'))));
    assert.equal(pinned('HG_MD5'), md5(fs.readFileSync(path.join(crawler, 'src/heapGuard.js'))));
  });

  it('check/apply/restore on a fake box that is in the pinned before-state', () => {
    const before = stageBefore();
    assert.equal(md5(before), pinned('DS_BEFORE'));
    for (const f of ['bigJson.js', 'heapGuard.js', 'price_diff.js', 'date_utils.js']) fs.copyFileSync(path.join(crawler, 'src', f), path.join(fake, 'src', f));
    fs.writeFileSync(path.join(fake, 'src/dom_store.js'), before);
    const dataFile = path.join(fake, 'data/dom_index.json'); fs.mkdirSync(path.dirname(dataFile)); fs.writeFileSync(dataFile, '{"V1":{"2026-11-01":{"hash":"h"}}}');

    let r = run('check');
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /trial ok/);
    assert.equal(md5(fs.readFileSync(path.join(fake, 'src/dom_store.js'))), pinned('DS_BEFORE'), 'check must not change the box file');
    assert.equal(fs.existsSync(bk), false, 'check must not write a backup');

    r = run('apply');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(md5(fs.readFileSync(path.join(fake, 'src/dom_store.js'))), pinned('DS_AFTER'));
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '{"V1":{"2026-11-01":{"hash":"h"}}}', 'apply must never touch dom_index.json');
    assert.equal(run('apply').status, 0); assert.match(run('apply').stdout, /ALREADY INSTALLED/);

    r = run('restore');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(md5(fs.readFileSync(path.join(fake, 'src/dom_store.js'))), pinned('DS_BEFORE'));
  });

  it('refuses an unknown dom_store.js, outside 07:00-21:30 ET, and without #719', () => {
    for (const f of ['bigJson.js', 'heapGuard.js', 'price_diff.js', 'date_utils.js']) fs.copyFileSync(path.join(crawler, 'src', f), path.join(fake, 'src', f));
    fs.writeFileSync(path.join(fake, 'src/dom_store.js'), '// some other version\n');
    let r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /not a known state/);
    fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 2315\n', { mode: 0o755 });
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /installs only 07:00-21:30/);
    fs.writeFileSync(path.join(shim, 'date'), '#!/bin/bash\necho 1200\n', { mode: 0o755 });
    fs.rmSync(path.join(fake, 'src/heapGuard.js'));
    r = run('check'); assert.equal(r.status, 1); assert.match(r.stderr, /#719 not installed/);
  });
});
