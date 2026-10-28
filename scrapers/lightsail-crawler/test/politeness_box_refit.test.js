// Pins the 2026-10-28 politeness refit (docs/box-patches/2026-10-28-politeness-refit): the copies of each box's own files taken
// read-only on 2026-10-28, the md5 of each, and what each per-box patch produces. If a box-src file or a patch changes, this fails,
// so STEPS.md and its md5 checks cannot drift from what was tested.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '../../../docs/box-patches/2026-10-28-politeness-refit');
const MAKE_WMI = path.join(HERE, '../../../docs/box-patches/2026-10-26-make-wmi/02-standalone.patch');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const POLITENESS_MD5 = 'f42053242068b414cb400da303ddee9d';
const FILES = { 'standalone.js': 'src', 'http_probe.js': 'src', 'dealer-bot-report.mjs': 'scripts' };
// [md5 of the box's file, md5 after the patch]
const PINS = {
  box4: { 'standalone.js': ['a1f4e0bf9228bedb4ca8e2a567b2fb54', 'd05cd479b8f8d22a77d4d9fb1ef2e31a'], 'http_probe.js': ['5930f6d2e458c12797151b59b4a6ced4', '099540146a853c5e36fbfadd0d25e50d'], 'dealer-bot-report.mjs': ['b1fe50a16ae9043f622ca5c6d92d360d', '35a0904b5566ad619be0aac5e4a84400'] },
  box3: { 'standalone.js': ['2e69d8748b9addbff93dac618bb71f1e', '3523e7367d3b862a38b00a4dd6a62695'], 'http_probe.js': ['5930f6d2e458c12797151b59b4a6ced4', '099540146a853c5e36fbfadd0d25e50d'], 'dealer-bot-report.mjs': ['b1fe50a16ae9043f622ca5c6d92d360d', '35a0904b5566ad619be0aac5e4a84400'] },
  box1: { 'standalone.js': ['02f73e161e29dde0fe0633759328c9a8', '627a49f3fe9c470469dd203d95de1bf6'], 'http_probe.js': ['f4ee7e9eb577fa83e06ffafc2ebf3289', '018a7068f43b6ce5a3ff4e21b25287cb'], 'dealer-bot-report.mjs': ['e566bafffd5627888cd1d5e1bf8cc6ff', '6272b480e5e0a81fb7034953d4a8ae98'] },
};

function stage(box, { makeWmi = false } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), `polite-${box}-`));
  fs.mkdirSync(path.join(t, 'src')); fs.mkdirSync(path.join(t, 'scripts'));
  for (const [f, d] of Object.entries(FILES)) fs.copyFileSync(path.join(DIR, 'box-src', box, f), path.join(t, d, f));
  if (makeWmi) assert.equal(spawnSync('patch', ['-p1', '-s'], { cwd: t, input: fs.readFileSync(MAKE_WMI) }).status, 0, 'make-wmi 02-standalone.patch applies');
  return t;
}
const applyPatch = (t, box, f, extra = []) => spawnSync('patch', ['-p1', '-s', ...extra], { cwd: t, input: fs.readFileSync(path.join(DIR, 'patches', box, `${f}.patch`)), encoding: 'utf8' });
const syntaxOk = (p) => { const c = p.endsWith('.mjs') ? p : `${p}.mjs`; if (c !== p) fs.copyFileSync(p, c); return spawnSync(process.execPath, ['--check', c]).status === 0; };

describe('politeness refit: the copies are the box files, byte for byte', () => {
  for (const [box, files] of Object.entries(PINS)) {
    for (const [f, [before]] of Object.entries(files)) {
      it(`${box} ${f} is md5 ${before}`, () => assert.equal(md5(path.join(DIR, 'box-src', box, f)), before));
    }
  }
  it('box4 standalone.js is the make-wmi-patched file (a1f4e0bf...)', () => assert.match(md5(path.join(DIR, 'box-src/box4/standalone.js')), /^a1f4e0bf/));
  it('politeness.js is the one from #605', () => assert.equal(md5(path.join(DIR, 'politeness.js')), POLITENESS_MD5));
  it('no secrets or config were copied', () => {
    for (const box of Object.keys(PINS)) assert.deepEqual(fs.readdirSync(path.join(DIR, 'box-src', box)).sort(), Object.keys(FILES).sort());
  });
});

describe('politeness refit: each patch produces the pinned file', () => {
  for (const [box, files] of Object.entries(PINS)) {
    it(`${box}: patches apply, md5s match, syntax is valid`, () => {
      const t = stage(box);
      for (const [f, [, after]] of Object.entries(files)) {
        const r = applyPatch(t, box, f); assert.equal(r.status, 0, `${box}/${f}: ${r.stdout}${r.stderr}`);
        assert.equal(md5(path.join(t, FILES[f], f)), after, `${box}/${f} after`);
      }
      fs.copyFileSync(path.join(DIR, 'politeness.js'), path.join(t, 'src/politeness.js'));
      for (const [f, d] of Object.entries(FILES)) assert.ok(syntaxOk(path.join(t, d, f)), `${box}/${f} syntax`);
      assert.ok(syntaxOk(path.join(t, 'src/politeness.js')));
    });
    it(`${box}: patched standalone.js uses the gate and has no browser fallback`, () => {
      const t = stage(box); applyPatch(t, box, 'standalone.js');
      const s = fs.readFileSync(path.join(t, 'src/standalone.js'), 'utf8');
      assert.match(s, /from '\.\/politeness\.js'/);
      assert.match(s, /pMapStoppable\(vehicleUrls, extractOne, PAGE_WORKERS/);
      assert.match(s, /🛡️ SKIP/);
      assert.doesNotMatch(s, /patchright|pMapWithPages|tryPatchrightFallback|withProbeRetry/i);
    });
    it(`${box}: the patch is not applied twice`, () => {
      const t = stage(box); applyPatch(t, box, 'standalone.js');
      assert.notEqual(applyPatch(t, box, 'standalone.js', ['--dry-run', '-N']).status, 0);
    });
  }
  it('box3 + make-wmi reaches box4\'s md5, so box4\'s standalone patch applies to it in either order', () => {
    const t = stage('box3', { makeWmi: true });
    assert.match(md5(path.join(t, 'src/standalone.js')), /^a1f4e0bf/);
    assert.equal(applyPatch(t, 'box4', 'standalone.js').status, 0);
    assert.equal(md5(path.join(t, 'src/standalone.js')), PINS.box4['standalone.js'][1]);
  });
  it('box1 standalone patch still applies after make-wmi', () => {
    const t = stage('box1', { makeWmi: true });
    const r = applyPatch(t, 'box1', 'standalone.js'); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(syntaxOk(path.join(t, 'src/standalone.js')));
  });
});
