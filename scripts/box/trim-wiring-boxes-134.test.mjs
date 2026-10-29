// docs/box-patches/2026-10-29-trim-wiring-boxes-134/: the standalone.js patches and the install script, run against a FAKE box built here.
// The box standalone.js files are rebuilt from the repo's own copies (politeness-refit box-src + patches, make-wmi 04 for box1) and pinned to the md5s read on
// the boxes 2026-10-29. The sync client's text is not in the repo (box2's live file), so its test uses a stand-in (the repo's client without trimRaw) with the md5 pin
// overridden; the real pin is checked separately. Nothing here touches a box.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-29-trim-wiring-boxes-134');
const POL = path.join(ROOT, 'docs/box-patches/2026-10-28-politeness-refit');
const WMI = path.join(ROOT, 'docs/box-patches/2026-10-26-make-wmi');
const SRC = path.join(ROOT, 'scrapers/lightsail-crawler/src');
const SCRIPT = path.join(PKG, 'install-trim-wiring.sh');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const hasPatch = spawnSync('patch', ['--version']).status === 0;
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trimwire-'));

const PIN = {
  box1: { before: '8c39cf86d3017210d586ff3afeb33969', after: '980769d114cba511aef4bc5ff033e0ae', patch: 'standalone.js.box1.patch' },
  box34: { before: 'd05cd479b8f8d22a77d4d9fb1ef2e31a', after: '6f4c4f2a4b4db2ab2830e11074723dba', patch: 'standalone.js.box3-box4.patch' },
};
const STAGED = { 'oemTrim.js': '0f9bb8163921b82ff9f54748e1a64cee', 'fordTrim.js': '1224e1ae9aae5528a8af39ad5da3a2f3' };

function applyTo(file, patchFile) {
  const r = spawnSync('patch', ['-s', '-F0', '--no-backup-if-mismatch', file, patchFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
/** The box standalone.js as read on 2026-10-29, rebuilt from repo sources. */
function rebuild(which) {
  const d = mk(); const f = path.join(d, 'standalone.js');
  if (which === 'box34') {
    fs.copyFileSync(path.join(POL, 'box-src/box4/standalone.js'), f); applyTo(f, path.join(POL, 'patches/box4/standalone.js.patch'));
  } else {
    fs.copyFileSync(path.join(POL, 'box-src/box1/standalone.js'), f); applyTo(f, path.join(POL, 'patches/box1/standalone.js.patch'));
    applyTo(f, path.join(WMI, '04-standalone-box1-politeness.patch'));
  }
  return f;
}

describe('standalone.js patches', { skip: hasPatch ? false : 'no patch(1)' }, () => {
  for (const [which, pin] of Object.entries(PIN)) {
    it(`${which}: the rebuilt box file is ${pin.before}; the patch gives ${pin.after}, parses, and only ADDS the import and the trim block`, () => {
      const f = rebuild(which);
      const before = fs.readFileSync(f);
      assert.equal(md5(before), pin.before, 'rebuilt file equals what was read on the box');
      applyTo(f, path.join(PKG, pin.patch));
      const after = fs.readFileSync(f, 'utf8');
      assert.equal(md5(after), pin.after);
      assert.equal(spawnSync(process.execPath, ['--check', '--input-type=module'], { input: after }).status, 0, 'parses as ESM');
      const patchText = fs.readFileSync(path.join(PKG, pin.patch), 'utf8');
      assert.equal((patchText.match(/^-[^-]/gm) || []).length, 0, 'removes no line');
      assert.equal((patchText.match(/^\+[^+]/gm) || []).length, 7, 'adds exactly the import (1) and the block (6)');
      assert.equal((after.match(/normalizeTrimForWrite/g) || []).length, 2, 'one import, one call');
      assert.match(after, /import \{ normalizeTrimForWrite \} from '\.\/oemTrim\.js'/);
      assert.match(after, /if \(ft\.status === 'fix' && ft\.trimRaw\) \{ vehicle\.trimRaw = ft\.trimRaw; vehicle\.trim = ft\.trim; \}/);
    });
  }
  it('the block is the same text as the repo standalone.js (#609) has', () => {
    const repo = fs.readFileSync(path.join(SRC, 'standalone.js'), 'utf8');
    const block = repo.slice(repo.indexOf('                        // Trim (fordTrim.js for Ford'), repo.indexOf('                        currentInventory.set(vehicle.vin, vehicle);'));
    for (const pin of Object.values(PIN)) {
      const added = fs.readFileSync(path.join(PKG, pin.patch), 'utf8').split('\n').filter((l) => /^\+[^+]/.test(l)).map((l) => l.slice(1));
      assert.equal(added.slice(1).join('\n') + '\n', block, pin.patch);
    }
  });
});

describe('pins', () => {
  it('the staged files and patches match the repo, and the script carries the same md5s', () => {
    const sh = fs.readFileSync(SCRIPT, 'utf8');
    for (const [n, m] of Object.entries(STAGED)) { assert.equal(md5(fs.readFileSync(path.join(SRC, n))), m, n); assert.ok(sh.includes(m), n); }
    for (const pin of Object.values(PIN)) { assert.ok(sh.includes(pin.before)); assert.ok(sh.includes(pin.after)); assert.ok(sh.includes(md5(fs.readFileSync(path.join(PKG, pin.patch)))), pin.patch); }
    assert.ok(sh.includes('e41f34ff8d9acd2efb025323b7f5bb80'));
  });
  it('STEPS.md quotes every md5 the script pins', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const m of [...Object.values(STAGED), 'e41f34ff8d9acd2efb025323b7f5bb80', ...Object.values(PIN).flatMap((p) => [p.before, p.after, md5(fs.readFileSync(path.join(PKG, p.patch)))])]) assert.ok(steps.includes(m), m);
    assert.match(steps, /ProxyCommand/);
    assert.doesNotMatch(steps, / -J /);
    assert.match(steps, /No restart/i);
    assert.match(steps, /Nothing here is installed|nothing here is installed/i);
  });
});

// ---- the install script against a fake box ---------------------------------------------------------------------------------------------------------
function fakeBox(which, { now = '0900', busy = false, syncText } = {}) {
  const root = mk();
  const crawler = path.join(root, 'nj/scrapers/lightsail-crawler'); fs.mkdirSync(path.join(crawler, 'src'), { recursive: true });
  fs.copyFileSync(rebuild(which), path.join(crawler, 'src/standalone.js'));
  const sync = path.join(root, 'inventory-sync/inventory-sync.mjs'); fs.mkdirSync(path.dirname(sync), { recursive: true });
  const repoSync = fs.readFileSync(path.join(ROOT, 'scripts/box/inventory-sync.mjs'), 'utf8');
  const standIn = syncText ?? repoSync.replace(' trimRaw: v.trimRaw || null,', '');
  fs.writeFileSync(sync, standIn, { mode: 0o755 });
  const stage = path.join(root, 'stage'); fs.mkdirSync(stage);
  for (const n of Object.keys(STAGED)) fs.copyFileSync(path.join(SRC, n), path.join(stage, n));
  for (const p of Object.values(PIN)) fs.copyFileSync(path.join(PKG, p.patch), path.join(stage, p.patch));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pgrep'), busy ? '#!/bin/sh\necho "4242 node /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src/standalone.js"\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'date'), `#!/bin/sh\necho ${now}\n`, { mode: 0o755 });
  if (spawnSync('md5sum', ['--version']).status !== 0) fs.writeFileSync(path.join(bin, 'md5sum'), '#!/bin/sh\nfor f in "$@"; do md5 -r "$f"; done\n', { mode: 0o755 }); // macOS has md5, not md5sum
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TRIMWIRE_CRAWLER_DIR: crawler, TRIMWIRE_SYNC: sync, TRIMWIRE_STAGE: stage, TRIMWIRE_BACKUP: path.join(root, 'bk'), TRIMWIRE_SYNC_BEFORE_MD5: md5(standIn) };
  const run = (mode, e = {}) => spawnSync('bash', ['-s', '--', mode], { input: fs.readFileSync(SCRIPT), env: { ...env, ...e }, encoding: 'utf8' });
  return { root, crawler, sync, stage, run, standIn, sa: path.join(crawler, 'src/standalone.js') };
}
const hasMd5 = spawnSync('md5sum', ['--version']).status === 0 || spawnSync('md5', ['-q', '/dev/null']).status === 0;
const skip = hasPatch && hasMd5 ? false : 'needs patch(1) and md5sum (or macOS md5) for the fake box';

describe('install-trim-wiring.sh on a fake box', { skip }, () => {
  for (const [which, pin] of Object.entries(PIN)) {
    it(`${which}: check writes nothing; apply backs up, installs, lands on the pinned md5s; rollback restores byte for byte`, () => {
      const b = fakeBox(which);
      const saBefore = md5(fs.readFileSync(b.sa)), syBefore = md5(fs.readFileSync(b.sync));
      const chk = b.run('check');
      assert.equal(chk.status, 0, chk.stdout + chk.stderr);
      assert.match(chk.stdout, /CHECK only/); assert.match(chk.stdout, /ROLLBACK:/);
      assert.equal(md5(fs.readFileSync(b.sa)), saBefore); assert.ok(!fs.existsSync(path.join(b.crawler, 'src/oemTrim.js')));
      assert.ok(!fs.existsSync(path.join(b.root, 'bk')), 'check makes no backup');
      const ap = b.run('apply');
      assert.equal(ap.status, 0, ap.stdout + ap.stderr);
      assert.match(ap.stdout, /INSTALLED/); assert.match(ap.stdout, /No restart/); assert.match(ap.stdout, /ROLLBACK:/);
      assert.equal(md5(fs.readFileSync(b.sa)), pin.after);
      for (const [n, m] of Object.entries(STAGED)) assert.equal(md5(fs.readFileSync(path.join(b.crawler, 'src', n))), m);
      const sync = fs.readFileSync(b.sync, 'utf8');
      assert.equal((sync.match(/trimRaw: v\.trimRaw/g) || []).length, 1);
      assert.equal(fs.statSync(b.sync).mode & 0o777, 0o755, 'sync client keeps its mode');
      assert.equal(md5(fs.readFileSync(path.join(b.root, 'bk/standalone.js.before'))), saBefore);
      assert.equal(md5(fs.readFileSync(path.join(b.root, 'bk/inventory-sync.mjs.before'))), syBefore);
      assert.match(b.run('apply').stdout + b.run('apply').stderr, /ALREADY INSTALLED/);
      const rb = b.run('rollback');
      assert.equal(rb.status, 0, rb.stdout + rb.stderr);
      assert.equal(md5(fs.readFileSync(b.sa)), saBefore); assert.equal(md5(fs.readFileSync(b.sync)), syBefore);
      assert.ok(!fs.existsSync(path.join(b.crawler, 'src/oemTrim.js')) && !fs.existsSync(path.join(b.crawler, 'src/fordTrim.js')), 'files that were absent are removed again');
    });
  }
  it('refuses on md5 drift of standalone.js (one byte) and writes nothing', () => {
    const b = fakeBox('box34'); fs.appendFileSync(b.sa, '\n// local edit\n');
    const r = b.run('apply');
    assert.equal(r.status, 1); assert.match(r.stderr, /not a known state/);
    assert.ok(!fs.existsSync(path.join(b.root, 'bk'))); assert.ok(!fs.existsSync(path.join(b.crawler, 'src/oemTrim.js')));
  });
  it('refuses the sync client when its md5 is not the sweep-guarded e41f34ff (no override)', () => {
    const b = fakeBox('box34');
    const r = b.run('apply', { TRIMWIRE_SYNC_BEFORE_MD5: '' });
    assert.equal(r.status, 1); assert.match(r.stderr, /inventory-sync\.mjs md5/);
    assert.ok(!fs.existsSync(path.join(b.root, 'bk')));
  });
  it('refuses when the sync client text lacks the row-builder anchor', () => {
    const b = fakeBox('box34', { syncText: 'rows.push({ trim: v.trim });\n' });
    const r = b.run('apply'); assert.equal(r.status, 1); assert.match(r.stderr, /anchor/);
  });
  it('refuses a staged file with the wrong md5, a missing one, and a different fordTrim.js already on the box', () => {
    const b = fakeBox('box34'); fs.appendFileSync(path.join(b.stage, 'oemTrim.js'), '//x\n');
    assert.match(b.run('check').stderr, /staged oemTrim\.js md5/);
    const c = fakeBox('box34'); fs.rmSync(path.join(c.stage, 'fordTrim.js'));
    assert.match(c.run('check').stderr, /not staged/);
    const d = fakeBox('box34'); fs.writeFileSync(path.join(d.crawler, 'src/fordTrim.js'), 'old');
    assert.match(d.run('check').stderr, /fordTrim\.js exists with md5/);
  });
  it('refuses while a crawl is running, and outside 07:00-21:30 ET', () => {
    assert.match(fakeBox('box34', { busy: true }).run('apply').stderr, /crawl or sync is running/);
    for (const now of ['2131', '2200', '0300', '0659']) assert.match(fakeBox('box34', { now }).run('apply').stderr, /installs only 07:00-21:30/, now);
    assert.equal(fakeBox('box34', { now: '2129' }).run('check').status, 0);
    assert.equal(fakeBox('box34', { now: '0700' }).run('check').status, 0);
  });
  it('an unknown mode is refused', () => {
    assert.match(fakeBox('box34').run('frobnicate').stderr, /mode must be/);
  });
});
