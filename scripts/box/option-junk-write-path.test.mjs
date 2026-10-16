// scripts/box/2026-10-16-option-junk-write-path.mjs: the anchored box patch for the global option junk list. Runs it against a copy of the
// source files put back to their pre-patch text (the patch's own edits reversed), so it needs no git history and touches no box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const SCRIPT = path.join(here, '2026-10-16-option-junk-write-path.mjs');
const script = fs.readFileSync(SCRIPT, 'utf8');
const EDITS = JSON.parse(script.match(/const EDITS =\n(\[[\s\S]*?\n\]);\n/)[1]);
const FILES = ['inventoryOptionRows.js', 'factoryOptionAllowlist.js', 'deals_api_server.js'];

function boxCopy({ patched = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junk-box-'));
  for (const f of [...FILES, 'optionSentenceFilter.js']) {
    let t = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (!patched) for (const e of EDITS.filter((x) => x.file === f)) { assert.equal(t.split(e.replace).length - 1, 1, `${e.id}: replacement unique in the repo file`); t = t.replace(e.replace, () => e.find); }
    fs.writeFileSync(path.join(dir, f), t);
  }
  return dir;
}
const run = (dir, ...extra) => spawnSync('node', [SCRIPT, `--dir=${dir}`, `--src=${SRC}`, ...extra], { encoding: 'utf8' });
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

describe('2026-10-16-option-junk-write-path.mjs', () => {
  it('the reversed copy really is pre-patch (no engine, no install line)', () => {
    const dir = boxCopy();
    assert.ok(!fs.readFileSync(path.join(dir, 'inventoryOptionRows.js'), 'utf8').includes('activeJunkRules'));
    assert.ok(!fs.readFileSync(path.join(dir, 'deals_api_server.js'), 'utf8').includes('installJunkRulesFromEnv'));
  });
  it('dry run: every anchor found once, behaviour checks pass, nothing written', () => {
    const dir = boxCopy(); const before = snapshot(dir);
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((r.stdout.match(/will apply/g) || []).length, EDITS.length);
    assert.match(r.stdout, /DRY RUN ok/);
    assert.deepEqual(snapshot(dir), before);
  });
  it('apply: patched files equal the repo files, backups made, JSON installed, second run changes nothing', () => {
    const dir = boxCopy(); const orig = snapshot(dir);
    const r = run(dir, '--apply');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of FILES) {
      const got = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.equal(got, fs.readFileSync(path.join(SRC, f), 'utf8'), `${f}: the box ends with the repo's text`);
      const bak = fs.readdirSync(dir).find((x) => x.startsWith(`${f}.bak.`));
      assert.ok(bak, `${f} backed up`);
      assert.equal(fs.readFileSync(path.join(dir, bak), 'utf8'), orig[f], `${f} backup is the original`);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'optionJunkRules.json'), 'utf8'), fs.readFileSync(path.join(SRC, 'optionJunkRules.json'), 'utf8'));
    const after = snapshot(dir);
    const again = run(dir, '--apply');
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal((again.stdout.match(/already applied/g) || []).length, EDITS.length);
    for (const f of FILES) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), after[f], `${f} unchanged by the second run`);
  });
  it('the patched copy works end to end: RAV4 junk dropped, controls kept, OPTION_JUNK_RULES=off keeps everything', async () => {
    const dir = boxCopy(); assert.equal(run(dir, '--apply').status, 0);
    for (const f of ['inventoryOptionRows.js', 'factoryOptionAllowlist.js']) fs.copyFileSync(path.join(dir, f), path.join(dir, f.replace(/\.js$/, '.mjs')));
    const probe = `import { optionRowsFromOptions } from './inventoryOptionRows.mjs'; import { installJunkRulesFromEnv } from './factoryOptionAllowlist.mjs';
      import { optionRowsFromOptions as o2 } from './inventoryOptionRows.js';
      installJunkRulesFromEnv(process.env, { warn() {} });
      console.log(JSON.stringify(o2([{ name: 'Roadside Assistance' }, { name: 'Multipoint Point Inspection' }, { name: 'Weather Package' }]).rows.map((r) => r.label)));`;
    fs.writeFileSync(path.join(dir, 'probe.mjs'), probe);
    const on = spawnSync('node', [path.join(dir, 'probe.mjs')], { encoding: 'utf8' });
    assert.equal(on.stdout.trim().split('\n').pop(), '["Weather Package"]', on.stderr);
    const off = spawnSync('node', [path.join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, OPTION_JUNK_RULES: 'off' } });
    assert.equal(off.stdout.trim().split('\n').pop(), '["Roadside Assistance","Multipoint Point Inspection","Weather Package"]', off.stderr);
  });
  it('an anchor that is missing (the box file drifted) aborts with nothing written', () => {
    const dir = boxCopy();
    const f = path.join(dir, 'factoryOptionAllowlist.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('const base = optionRowsFromOptions(options);', 'const base = optionRowsFromOptions(options, {});'));
    const before = snapshot(dir);
    const r = run(dir, '--apply');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /ANCHOR PROBLEM|ABORT/);
    assert.deepEqual(snapshot(dir), before);
  });
  it('an anchor that occurs twice aborts too', () => {
    const dir = boxCopy();
    const f = path.join(dir, 'deals_api_server.js');
    fs.appendFileSync(f, '\nconst OPTION_CATALOG_MODE = catalogModeFromEnv();\n');
    const before = snapshot(dir);
    assert.equal(run(dir, '--apply').status, 2);
    assert.deepEqual(snapshot(dir), before);
  });
  it('never restarts or runs anything on the box', () => {
    const code = script.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code.replace(/const EDITS =[\s\S]*?\n\];\n/, ''), /pm2|sudo|systemctl|rmSync\(DIR|unlink/);
  });
});
