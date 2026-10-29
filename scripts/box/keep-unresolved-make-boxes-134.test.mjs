// docs/box-patches/2026-10-29-keep-unresolved-make-boxes-134/: the standalone.js patch and the install script, run against a FAKE crawl box built here.
// The box standalone.js files are rebuilt exactly as the trim-wiring test does (politeness-refit box-src + patches, make-wmi 04 for box1) and pinned to the md5s read on
// the boxes 2026-10-29; the make-wmi files (vinWmi 7371d7d9, brand_match 2b421d12, stellantisMake, ingestGuards, stellantisVinTable) come from the make-wmi package.
// Nothing here touches a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-29-keep-unresolved-make-boxes-134');
const TW = path.join(ROOT, 'docs/box-patches/2026-10-29-trim-wiring-boxes-134');
const POL = path.join(ROOT, 'docs/box-patches/2026-10-28-politeness-refit');
const WMI = path.join(ROOT, 'docs/box-patches/2026-10-26-make-wmi');
const SRC = path.join(ROOT, 'scrapers/lightsail-crawler/src');
const SCRIPT = path.join(PKG, 'install-keep-unresolved.sh');
const PATCH = path.join(PKG, 'standalone.js.keep-unresolved.patch');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const hasPatch = spawnSync('patch', ['--version']).status === 0;
const hasMd5 = spawnSync('md5sum', ['--version']).status === 0 || spawnSync('md5', ['-q', '/dev/null']).status === 0;
const skip = hasPatch && hasMd5 ? false : 'needs patch(1) and md5sum (or macOS md5)';
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keepmake-'));

// before = the box file as read 2026-10-29; w = after the trim wiring (#630); out = after this patch (without / with the wiring)
const PIN = {
  box1:  { before: '8c39cf86d3017210d586ff3afeb33969', out: 'ede2990ec93118428f0854be09006699', wired: '980769d114cba511aef4bc5ff033e0ae', wiredOut: '84a36177398ab6408b5302d1a585cb41', tw: 'standalone.js.box1.patch' },
  box34: { before: 'd05cd479b8f8d22a77d4d9fb1ef2e31a', out: '1e3766e5d0a5b3042f766c8ea205332d', wired: '6f4c4f2a4b4db2ab2830e11074723dba', wiredOut: 'd948a134a70ea055c4a2dac235e8d474', tw: 'standalone.js.box3-box4.patch' },
};
const NEW = { 'vinWmi.js': '671ff8c06cd7f92a55190c0156cb9fde', 'brand_match.js': '255cfe545bc30d8e41d45edf4cb33180' };
const OLD = { 'vinWmi.js': '7371d7d9bd40bd9586b4ef8a848a4969', 'brand_match.js': '2b421d128ce20aab0644820bb0702271' };

function applyTo(file, patchFile) {
  const r = spawnSync('patch', ['-s', '-F0', '--no-backup-if-mismatch', file, patchFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function rebuild(which) {
  const f = path.join(mk(), 'standalone.js');
  if (which === 'box34') { fs.copyFileSync(path.join(POL, 'box-src/box4/standalone.js'), f); applyTo(f, path.join(POL, 'patches/box4/standalone.js.patch')); }
  else { fs.copyFileSync(path.join(POL, 'box-src/box1/standalone.js'), f); applyTo(f, path.join(POL, 'patches/box1/standalone.js.patch')); applyTo(f, path.join(WMI, '04-standalone-box1-politeness.patch')); }
  return f;
}

describe('package files', () => {
  it('files/ are the repo files; the patch and files have the pinned md5s', () => {
    for (const n of Object.keys(NEW)) { assert.equal(md5(fs.readFileSync(path.join(PKG, 'files', n))), NEW[n]); assert.equal(md5(fs.readFileSync(path.join(PKG, 'files', n))), md5(fs.readFileSync(path.join(SRC, n))), `${n} == src/${n}`); }
    assert.equal(md5(fs.readFileSync(PATCH)), 'b06c4d5b2f5cb1c34812c08f81678a41');
  });
  it('the files they replace are what the make-wmi package installed', () => {
    for (const n of Object.keys(OLD)) assert.equal(md5(fs.readFileSync(path.join(WMI, 'files', n))), OLD[n]);
  });
  it('manifest.txt lists every shipped file with its md5', () => {
    for (const l of fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trim().split('\n')) { const [sum, rel] = l.split(/\s+/); assert.equal(md5(fs.readFileSync(path.join(PKG, rel))), sum, rel); }
  });
});

describe('standalone.js patch', { skip }, () => {
  for (const [which, pin] of Object.entries(PIN)) {
    it(`${which}: ${pin.before} -> ${pin.out}; wired ${pin.wired} -> ${pin.wiredOut}; either order with the trim wiring reaches the same file; parses; removes only the skip`, () => {
      const a = rebuild(which); assert.equal(md5(fs.readFileSync(a)), pin.before);
      applyTo(a, PATCH); const only = fs.readFileSync(a, 'utf8'); assert.equal(md5(only), pin.out);
      assert.equal(spawnSync(process.execPath, ['--check', '--input-type=module'], { input: only }).status, 0, 'parses as ESM');
      assert.ok(!only.includes('make unresolvable'), 'the skip log line is gone');
      assert.ok(!/if \(!keptMake\) console\.log/.test(only) && !/if \(keptMake\) \{/.test(only), 'neither the skip nor the keptMake gate remains');
      assert.match(only, /vehicle\.make = keptMake;/, 'the make assignment is untouched (null is assigned for an unresolved car)');
      const p = fs.readFileSync(PATCH, 'utf8'); assert.equal((p.match(/^-[^-]/gm) || []).length, 4); assert.equal((p.match(/^\+[^+]/gm) || []).length, 3);
      // then the trim wiring
      applyTo(a, path.join(TW, pin.tw)); assert.equal(md5(fs.readFileSync(a)), pin.wiredOut, 'patch, then wiring');
      // the other order
      const b = rebuild(which); applyTo(b, path.join(TW, pin.tw)); assert.equal(md5(fs.readFileSync(b)), pin.wired); applyTo(b, PATCH); assert.equal(md5(fs.readFileSync(b)), pin.wiredOut, 'wiring, then patch');
    });
  }
  it('the block is the same text as the repo standalone.js now has', () => {
    const repo = fs.readFileSync(path.join(SRC, 'standalone.js'), 'utf8');
    const added = fs.readFileSync(PATCH, 'utf8').split('\n').filter((l) => /^\+[^+]/.test(l)).map((l) => l.slice(1));
    for (const l of added) assert.ok(repo.includes(l), `repo standalone.js has: ${l.trim().slice(0, 60)}`);
  });
});

function fakeBox(which, { now = '1200', busy = false, state = 'before' } = {}) {
  const root = mk(); const crawler = path.join(root, 'nj-scraper/scrapers/lightsail-crawler'); const src = path.join(crawler, 'src'); fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(crawler, 'package.json'), '{"type":"module"}');
  for (const n of ['stellantisMake.js', 'ingestGuards.js', 'stellantisVinTable.js', 'vinWmi.js', 'brand_match.js']) fs.copyFileSync(path.join(WMI, 'files', n), path.join(src, n));
  const sa = rebuild(which); if (state === 'wired') applyTo(sa, path.join(TW, PIN[which].tw));
  fs.copyFileSync(sa, path.join(src, 'standalone.js'));
  const stage = path.join(root, 'stage'); fs.mkdirSync(stage);
  for (const n of Object.keys(NEW)) fs.copyFileSync(path.join(PKG, 'files', n), path.join(stage, n));
  fs.copyFileSync(PATCH, path.join(stage, 'standalone.js.keep-unresolved.patch'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pgrep'), busy ? '#!/bin/sh\necho "4242 node /home/ubuntu/nj-scraper/scrapers/lightsail-crawler/src/standalone.js"\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'date'), `#!/bin/sh\necho ${now}\n`, { mode: 0o755 });
  if (spawnSync('md5sum', ['--version']).status !== 0) fs.writeFileSync(path.join(bin, 'md5sum'), '#!/bin/sh\nfor f in "$@"; do md5 -r "$f"; done\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, KEEPMAKE_CRAWLER_DIR: crawler, KEEPMAKE_STAGE: stage, KEEPMAKE_BACKUP: path.join(root, 'bk') };
  const run = (mode, e = {}) => spawnSync('bash', ['-s', '--', mode], { input: fs.readFileSync(SCRIPT), env: { ...env, ...e }, encoding: 'utf8' });
  return { root, crawler, src, stage, run, f: (n) => path.join(src, n) };
}

describe('install-keep-unresolved.sh on a fake box', { skip }, () => {
  for (const [which, pin] of Object.entries(PIN)) for (const state of ['before', 'wired']) {
    it(`${which} (${state}): check writes nothing; apply backs up, installs, lands on the pinned md5s; rollback restores byte for byte`, () => {
      const b = fakeBox(which, { state }); const was = Object.fromEntries(['standalone.js', 'vinWmi.js', 'brand_match.js'].map((n) => [n, md5(fs.readFileSync(b.f(n)))]));
      const chk = b.run('check'); assert.equal(chk.status, 0, chk.stdout + chk.stderr);
      assert.match(chk.stdout, /CHECK only/); assert.match(chk.stdout, /smoke ok \(10 cases\)/); assert.match(chk.stdout, /ROLLBACK:/);
      for (const n of Object.keys(was)) assert.equal(md5(fs.readFileSync(b.f(n))), was[n], `${n} untouched by check`);
      assert.ok(!fs.existsSync(path.join(b.root, 'bk')), 'check makes no backup');
      const ap = b.run('apply'); assert.equal(ap.status, 0, ap.stdout + ap.stderr);
      assert.match(ap.stdout, /INSTALLED/); assert.match(ap.stdout, /No restart/); assert.match(ap.stdout, /ROLLBACK:/);
      assert.equal(md5(fs.readFileSync(b.f('standalone.js'))), state === 'wired' ? pin.wiredOut : pin.out);
      for (const n of Object.keys(NEW)) assert.equal(md5(fs.readFileSync(b.f(n))), NEW[n]);
      for (const n of Object.keys(was)) assert.equal(md5(fs.readFileSync(path.join(b.root, 'bk', `${n}.before`))), was[n]);
      assert.match(b.run('apply').stdout, /ALREADY INSTALLED/);
      const rb = b.run('rollback'); assert.equal(rb.status, 0, rb.stdout + rb.stderr);
      for (const n of Object.keys(was)) assert.equal(md5(fs.readFileSync(b.f(n))), was[n], `${n} restored`);
    });
  }
  it('the trim-wiring installer accepts a box this patch already touched (the other order)', () => {
    const b = fakeBox('box34'); assert.equal(b.run('apply').status, 0);
    const sa = fs.readFileSync(b.f('standalone.js')); assert.equal(md5(sa), PIN.box34.out);
    const tmp = mk(); const d = path.join(tmp, 'standalone.js'); fs.writeFileSync(d, sa); applyTo(d, path.join(TW, PIN.box34.tw)); assert.equal(md5(fs.readFileSync(d)), PIN.box34.wiredOut);
    const twScript = fs.readFileSync(path.join(TW, 'install-trim-wiring.sh'), 'utf8');
    for (const m of [PIN.box1.out, PIN.box1.wiredOut, PIN.box34.out, PIN.box34.wiredOut]) assert.ok(twScript.includes(m), `install-trim-wiring.sh knows ${m}`);
  });
  it('refuses on time, on a running crawl, on md5 drift of any file, and on a missing/wrong staged file', () => {
    let b = fakeBox('box34', { now: '2200' }); let r = b.run('apply'); assert.notEqual(r.status, 0); assert.match(r.stderr, /installs only 07:00-21:30/);
    b = fakeBox('box34', { now: '0630' }); assert.match(b.run('check').stderr, /installs only/);
    b = fakeBox('box34', { busy: true }); r = b.run('apply'); assert.notEqual(r.status, 0); assert.match(r.stderr, /crawl or sync is running/);
    for (const n of ['standalone.js', 'vinWmi.js', 'brand_match.js', 'stellantisMake.js', 'ingestGuards.js', 'stellantisVinTable.js']) {
      b = fakeBox('box34'); fs.appendFileSync(b.f(n), '\n// drift\n'); r = b.run('apply'); assert.notEqual(r.status, 0, n); assert.match(r.stderr, /REFUSED/, n);
      assert.ok(!fs.existsSync(path.join(b.root, 'bk')), `${n}: no backup on refusal`);
    }
    b = fakeBox('box34'); fs.appendFileSync(path.join(b.stage, 'brand_match.js'), '\n// tampered\n'); r = b.run('apply'); assert.notEqual(r.status, 0); assert.match(r.stderr, /staged brand_match\.js md5/);
    b = fakeBox('box34'); fs.rmSync(path.join(b.stage, 'standalone.js.keep-unresolved.patch')); assert.match(b.run('apply').stderr, /not staged/);
  });
  it('refuses a box in mixed states (patched standalone.js, old brand_match.js) and changes nothing', () => {
    const b = fakeBox('box34'); const f = b.f('standalone.js'); fs.copyFileSync(f, f + '.x'); applyTo(f, PATCH); assert.equal(md5(fs.readFileSync(f)), PIN.box34.out);
    const r = b.run('apply'); assert.notEqual(r.status, 0); assert.match(r.stderr, /mixed states/); assert.ok(!fs.existsSync(path.join(b.root, 'bk')));
  });
});
