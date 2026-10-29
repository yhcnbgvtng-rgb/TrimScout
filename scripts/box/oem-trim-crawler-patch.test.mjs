// scripts/box/2026-10-28-oem-trim-crawler-patch.mjs: the in-place edit of a box's own standalone.js. Nothing here touches a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planPatch, checkDeps, DEPS, BACKUP_SUFFIX } from './2026-10-28-oem-trim-crawler-patch.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'scrapers/lightsail-crawler/src');
const SCRIPT = fileURLToPath(new URL('./2026-10-28-oem-trim-crawler-patch.mjs', import.meta.url));
const md5 = (b) => createHash('md5').update(b).digest('hex');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// A box-shaped file: its own surrounding text, the Ford import and the one Ford call (as in the repo before #609).
const BOX = [
  "import fs from 'node:fs';",
  "import { normalizeFordTrimForWrite } from './fordTrim.js';",
  "const other = 1; // box-local drift lives here",
  "function f(vehicle) {",
  "  if (vehicle.trim) {",
  "    const ft = normalizeFordTrimForWrite({ make: vehicle.make, model: vehicle.model, trim: vehicle.trim });",
  "    if (ft.status === 'fix' && ft.trimRaw) { vehicle.trimRaw = ft.trimRaw; vehicle.trim = ft.trim; }",
  "  }",
  "}",
  "",
].join('\n');

function stage({ standalone = BOX, deps = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oem-crawler-'));
  const file = path.join(dir, 'standalone.js');
  fs.writeFileSync(file, standalone);
  if (deps) for (const n of Object.keys(DEPS)) fs.copyFileSync(path.join(SRC, n), path.join(dir, n));
  return { dir, file };
}

describe('planPatch', () => {
  it('changes exactly the import line and the call, nothing else', () => {
    const r = planPatch(BOX);
    assert.equal(r.status, 'patch');
    const a = BOX.split('\n'), b = r.text.split('\n');
    assert.equal(a.length, b.length);
    const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
    assert.deepEqual(changed, [1, 5]);
    assert.match(b[1], /^import \{ normalizeTrimForWrite \} from '\.\/oemTrim\.js';/);
    assert.match(b[5], /normalizeTrimForWrite\(\{ make: vehicle\.make/);
    assert.ok(!r.text.includes('normalizeFordTrimForWrite'));
  });
  it('is idempotent: its own output reads as wired', () => {
    assert.equal(planPatch(planPatch(BOX).text).status, 'wired');
  });
  it('the repo standalone.js (already wired by #609) reads as wired', () => {
    assert.equal(planPatch(fs.readFileSync(path.join(SRC, 'standalone.js'), 'utf8')).status, 'wired');
  });
  it('reports drift instead of guessing', () => {
    assert.equal(planPatch("const x = 1;\n").status, 'drift'); // no Ford wiring at all
    assert.equal(planPatch(BOX.replace("'./fordTrim.js'", "'./fordTrim.js?v=2'")).status, 'drift'); // import shape changed
    assert.equal(planPatch(BOX + "normalizeFordTrimForWrite({});\n").status, 'drift'); // a second call
    assert.equal(planPatch(BOX.replace('const ft = normalizeFordTrimForWrite(', 'const ft = await normalizeFordTrimForWrite(')).status, 'patch'); // call args untouched
  });
});

describe('dependency pins', () => {
  it('match the repo files this PR ships', () => {
    for (const [n, want] of Object.entries(DEPS)) assert.equal(md5(fs.readFileSync(path.join(SRC, n))), want, n);
  });
  it('checkDeps flags a missing or different file', () => {
    const { dir } = stage();
    assert.ok(checkDeps(dir).every((d) => d.ok));
    fs.appendFileSync(path.join(dir, 'fordTrim.js'), '\n// local edit\n');
    fs.rmSync(path.join(dir, 'oemTrim.js'));
    const r = Object.fromEntries(checkDeps(dir).map((d) => [d.name, d]));
    assert.equal(r['oemTrim.js'].md5, null);
    assert.equal(r['fordTrim.js'].ok, false);
  });
});

describe('the script', () => {
  it('check (default) writes nothing', () => {
    const { file } = stage();
    const r = run(file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CHECK only/);
    assert.equal(fs.readFileSync(file, 'utf8'), BOX);
    assert.ok(!fs.existsSync(file + BACKUP_SUFFIX));
  });
  it('--apply backs up, patches, the result parses and loads its imports; --rollback restores byte for byte', () => {
    const { file } = stage({ standalone: BOX.replace("import fs from 'node:fs';\n", '') });
    const orig = fs.readFileSync(file);
    const r = run(file, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(md5(fs.readFileSync(file + BACKUP_SUFFIX)), md5(orig));
    assert.match(fs.readFileSync(file, 'utf8'), /from '\.\/oemTrim\.js'/);
    assert.equal(run(file, '--apply').stdout.includes('already wired'), true);
    assert.equal(md5(fs.readFileSync(file + BACKUP_SUFFIX)), md5(orig), 'a second run does not overwrite the backup');
    // The patched module really imports oemTrim.js -> fordTrim.js beside it and exports a working normalizer.
    const mod = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(path.join(path.dirname(file), 'oemTrim.js'))}).then(m=>console.log(JSON.stringify(m.normalizeTrimForWrite({make:'Toyota',model:'Tacoma',trim:'TRD Off Road V6'}))))`], { encoding: 'utf8' });
    assert.match(mod.stdout, /"trim":"TRD Off-Road"/);
    assert.equal(run(file, '--rollback').status, 0);
    assert.equal(md5(fs.readFileSync(file)), md5(orig));
  });
  it('refuses a drifted file (exit 2) and a missing dependency (exit 3), writing nothing', () => {
    const d = stage({ standalone: 'const x = 1;\n' });
    assert.equal(run(d.file, '--apply').status, 2);
    const m = stage({ deps: false });
    const r = run(m.file, '--apply');
    assert.equal(r.status, 3);
    assert.equal(fs.readFileSync(m.file, 'utf8'), BOX);
    assert.ok(!fs.existsSync(m.file + BACKUP_SUFFIX));
  });
  it('--rollback with no backup is an error, not a silent success', () => {
    assert.equal(run(stage().file, '--rollback').status, 5);
  });
});
